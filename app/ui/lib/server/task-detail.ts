import type {
  OperationalActor,
  OperationalEvent,
  OperationalRun,
  OperationalRunStatus,
  OperationalTask,
  OperatorSessionContext,
  TaskDetailPayload,
} from "@/lib/operations";
import { formatRuntimeActivityPresentation } from "@/lib/server/runtime-activity-presentation";
import { buildTaskStateEvidenceSnapshot } from "@/lib/server/canonical-state-evidence";
import { assessStaleRun } from "@/lib/server/runtime-ledger-operator";
import {
  deriveApprovalRequired,
  deriveArtifactPath,
  normalizeExecutionTarget,
  normalizeModelName,
  normalizeProviderName,
  normalizeWorkflowName,
} from "@/lib/server/runtime-presentation-normalizer";
import { getPool } from "@/lib/server/postgres";
import { deriveTaskAttentionHints, deriveTaskDiffs } from "@/lib/server/task-diffing";
import { deriveTaskTransitions } from "@/lib/server/task-transition-summary";

const ledgerProvenance = {
  sourceId: "ghost_app" as const,
  label: "Ghost runtime ledger",
  detail: "ghost_app.tasks + task_runs + tool_events",
};

const DEFAULT_EVENT_LIMIT = 30;
const MAX_EVENT_LIMIT = 100;

interface TaskDetailRow {
  task_id: string;
  title: string;
  task_type: string;
  source: string;
  status: string;
  current_phase: string | null;
  conversation_id: string | null;
  context: Record<string, unknown> | null;
  result_summary: string | null;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_run_started_at: string | null;
  latest_run_finished_at: string | null;
  latest_run_duration_ms: number | null;
  latest_run_worker_name: string | null;
  latest_run_target: string | null;
  latest_run_workflow_name: string | null;
  latest_run_execution_id: string | null;
  latest_run_input_payload: Record<string, unknown> | null;
  latest_run_output_payload: Record<string, unknown> | null;
  latest_run_error_text: string | null;
  latest_event_at: string | null;
  agent_id: string | null;
  agent_name: string | null;
  event_count: string;
  run_count: string;
}

interface RunRow {
  run_id: string;
  task_id: string;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  worker_name: string | null;
  execution_target: string | null;
  workflow_name: string | null;
  execution_id: string | null;
  input_payload: Record<string, unknown> | null;
  output_payload: Record<string, unknown> | null;
  error_text: string | null;
}

interface EventRow {
  id: string;
  task_id: string;
  task_run_id: string | null;
  tool_name: string;
  event_type: string;
  status: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

function normalizeStatus(status: string | null | undefined): OperationalRunStatus {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "ok") return "succeeded";
  if (normalized === "queued" || normalized === "inbox") return "queued";
  if (normalized === "running" || normalized === "in_progress" || normalized === "processing") return "running";
  if (normalized === "succeeded" || normalized === "success" || normalized === "done" || normalized === "completed") return "succeeded";
  if (normalized === "failed" || normalized === "error") return "failed";
  if (normalized === "blocked" || normalized === "approval_required") return "blocked";
  if (normalized === "attention" || normalized === "warn" || normalized === "warning") return "attention";
  return "unknown";
}

function summarizeText(value: string | null | undefined, fallback: string) {
  const text = String(value || "").trim();
  return text ? text : fallback;
}

function payloadValue(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

function objectValue(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function eventGroups(rows: EventRow[]) {
  const byRunId = new Map<string, Array<{ eventType: string; payload: Record<string, unknown> | null }>>();

  for (const row of rows) {
    if (!row.task_run_id) {
      continue;
    }

    const group = byRunId.get(row.task_run_id) ?? [];
    group.push({
      eventType: row.event_type,
      payload: row.payload,
    });
    byRunId.set(row.task_run_id, group);
  }

  return byRunId;
}

function toActor(taskClass?: string | null, providerUsed?: string | null, agentId?: string | null, agentName?: string | null): OperationalActor | null {
  if (agentId || agentName) {
    return {
      id: agentId || "ghost-main",
      label: agentName || "Ghost",
      kind: "agent",
    };
  }

  if (providerUsed === "Codex Worker" || taskClass === "technical_work") {
    return { id: "codex-worker", label: "Codex Worker", kind: "worker" };
  }

  if (providerUsed === "Ollama" || taskClass === "lightweight_local_task") {
    return { id: "local-worker", label: "Local Worker", kind: "worker" };
  }

  if (providerUsed === "OpenAI API") {
    return { id: "openai-api", label: "OpenAI API", kind: "workflow" };
  }

  return { id: "ghost-core", label: "Ghost Core", kind: "agent" };
}

function completionSource(
  context: Record<string, unknown> | null | undefined,
  output: Record<string, unknown> | null | undefined,
  completedAt?: string | null,
) {
  if (objectValue(context, "reconciliation") || objectValue(output, "operator_reconciliation")) {
    return "operator_reconciled" as const;
  }

  if (completedAt) {
    return "runtime_confirmed" as const;
  }

  return null;
}

function parseLimit(input: number | undefined) {
  if (!input || !Number.isFinite(input)) {
    return DEFAULT_EVENT_LIMIT;
  }

  return Math.min(MAX_EVENT_LIMIT, Math.max(10, Math.round(input)));
}

export async function getTaskDetailPayload(
  taskId: string,
  options?: {
    eventLimit?: number;
    before?: string | null;
  },
): Promise<TaskDetailPayload> {
  const pool = getPool("app");
  const eventLimit = parseLimit(options?.eventLimit);
  const before = options?.before ?? null;

  const taskResult = await pool.query<TaskDetailRow>(
    `
      WITH latest_run AS (
        SELECT
          id::text AS latest_run_id,
          task_id::text AS task_id,
          status AS latest_run_status,
          started_at AS latest_run_started_at,
          finished_at AS latest_run_finished_at,
          duration_ms AS latest_run_duration_ms,
          worker_name AS latest_run_worker_name,
          execution_target AS latest_run_target,
          n8n_workflow_name AS latest_run_workflow_name,
          n8n_execution_id AS latest_run_execution_id,
          input_payload AS latest_run_input_payload,
          output_payload AS latest_run_output_payload,
          error_text AS latest_run_error_text
        FROM task_runs
        WHERE task_id = $1::uuid
        ORDER BY started_at DESC
        LIMIT 1
      ),
      event_stats AS (
        SELECT
          COUNT(*)::text AS event_count,
          MAX(created_at)::text AS latest_event_at
        FROM tool_events
        WHERE task_id = $1::uuid
      ),
      run_counts AS (
        SELECT COUNT(*)::text AS run_count
        FROM task_runs
        WHERE task_id = $1::uuid
      )
      SELECT
        task.id::text AS task_id,
        task.title,
        task.task_type,
        task.source,
        task.status,
        task.current_phase,
        task.conversation_id,
        task.context,
        task.result_summary,
        task.error_summary,
        task.created_at,
        task.updated_at,
        task.started_at,
        task.completed_at,
        latest_run.latest_run_id,
        latest_run.latest_run_status,
        latest_run.latest_run_started_at,
        latest_run.latest_run_finished_at,
        latest_run.latest_run_duration_ms,
        latest_run.latest_run_worker_name,
        latest_run.latest_run_target,
        latest_run.latest_run_workflow_name,
        latest_run.latest_run_execution_id,
        latest_run.latest_run_input_payload,
        latest_run.latest_run_output_payload,
        latest_run.latest_run_error_text,
        event_stats.latest_event_at,
        agent.id AS agent_id,
        agent.display_name AS agent_name,
        COALESCE(event_stats.event_count, '0') AS event_count,
        COALESCE(run_counts.run_count, '0') AS run_count
      FROM tasks task
      LEFT JOIN latest_run ON latest_run.task_id = task.id::text
      LEFT JOIN agents agent ON agent.id = task.assigned_agent_id
      CROSS JOIN event_stats
      CROSS JOIN run_counts
      WHERE task.id = $1::uuid
      LIMIT 1
    `,
    [taskId],
  );

  const taskRow = taskResult.rows[0];
  if (!taskRow) {
    return {
      generatedAt: new Date().toISOString(),
      task: null,
      runs: [],
      activity: [],
      transitions: [],
      diffs: [],
      attentionHints: [],
      operatorSession: null,
      eventPage: {
        limit: eventLimit,
        hasMore: false,
        nextBefore: null,
      },
      degraded: true,
      errors: ["Task not found in canonical ledger."],
    };
  }

  const [runsResult, eventsResult, summaryEventsResult] = await Promise.all([
    pool.query<RunRow>(
      `
        SELECT
          id::text AS run_id,
          task_id::text AS task_id,
          status,
          started_at,
          finished_at,
          duration_ms,
          worker_name,
          execution_target,
          n8n_workflow_name AS workflow_name,
          n8n_execution_id AS execution_id,
          input_payload,
          output_payload,
          error_text
        FROM task_runs
        WHERE task_id = $1::uuid
        ORDER BY started_at DESC NULLS LAST
        LIMIT 20
      `,
      [taskId],
    ),
    pool.query<EventRow>(
      `
        SELECT
          id::text,
          task_id::text,
          task_run_id::text,
          tool_name,
          event_type,
          status,
          payload,
          created_at::text
        FROM tool_events
        WHERE task_id = $1::uuid
          AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
        ORDER BY created_at DESC
        LIMIT $3
      `,
      [taskId, before, eventLimit + 1],
    ),
    pool.query<EventRow>(
      `
        SELECT
          id::text,
          task_id::text,
          task_run_id::text,
          tool_name,
          event_type,
          status,
          payload,
          created_at::text
        FROM tool_events
        WHERE task_id = $1::uuid
        ORDER BY created_at ASC
        LIMIT 500
      `,
      [taskId],
    ),
  ]);

  const now = new Date();
  const runEventGroups = eventGroups(summaryEventsResult.rows);
  const output = taskRow.latest_run_output_payload || {};
  const input = taskRow.latest_run_input_payload || {};
  const context = taskRow.context || {};
  const reconciliation = objectValue(context, "reconciliation") || objectValue(output, "operator_reconciliation");
  const taskClass = payloadValue(output, "task_class");
  const providerUsed = normalizeProviderName(payloadValue(output, "provider_used"));
  const modelUsed = normalizeModelName(payloadValue(output, "model_used"));
  const artifactPath = deriveArtifactPath(output, taskRow.latest_run_id ? runEventGroups.get(taskRow.latest_run_id) ?? [] : []);
  const approvalRequired = deriveApprovalRequired(output, taskRow.latest_run_id ? runEventGroups.get(taskRow.latest_run_id) ?? [] : []);
  const actor = toActor(taskClass, providerUsed, taskRow.agent_id, taskRow.agent_name);
  const stale = assessStaleRun(
    {
      taskId: taskRow.task_id,
      taskStatus: taskRow.status,
      taskStartedAt: taskRow.started_at,
      taskUpdatedAt: taskRow.updated_at,
      taskCompletedAt: taskRow.completed_at,
      taskCurrentPhase: taskRow.current_phase,
      taskContext: context,
      taskErrorSummary: taskRow.error_summary,
      runId: taskRow.latest_run_id,
      runStatus: taskRow.latest_run_status,
      runStartedAt: taskRow.latest_run_started_at,
      runFinishedAt: taskRow.latest_run_finished_at,
      runDurationMs: taskRow.latest_run_duration_ms,
      runWorkerName: taskRow.latest_run_worker_name,
      runExecutionTarget: taskRow.latest_run_target,
      runWorkflowName: taskRow.latest_run_workflow_name,
      runExecutionId: taskRow.latest_run_execution_id,
      runInputPayload: input,
      runOutputPayload: output,
      runErrorText: taskRow.latest_run_error_text,
      latestEventAt: taskRow.latest_event_at,
    },
    now,
  );

  const task: OperationalTask = {
    id: taskRow.task_id,
    title: taskRow.title,
    status: normalizeStatus(taskRow.status),
    source: taskRow.source,
    summary: summarizeText(taskRow.result_summary, summarizeText(taskRow.error_summary, taskRow.title)),
    createdAt: taskRow.created_at,
    updatedAt: taskRow.updated_at,
    startedAt: taskRow.started_at,
    completedAt: taskRow.completed_at,
    currentPhase: taskRow.current_phase,
    conversationId: taskRow.conversation_id,
    taskType: taskRow.task_type,
    assignedActor: actor,
    latestRunId: taskRow.latest_run_id,
    latestRunStatus: normalizeStatus(taskRow.latest_run_status),
    latestRunDurationMs: taskRow.latest_run_duration_ms ? Number(taskRow.latest_run_duration_ms) : null,
    eventCount: Number(taskRow.event_count),
    runCount: Number(taskRow.run_count),
    approvalRequired,
    artifactPath,
    latestUserMessage: payloadValue(input, "message"),
    latestAssistantReply: summarizeText(taskRow.result_summary, ""),
    errorSummary: taskRow.error_summary,
    resultSummary: taskRow.result_summary,
    entrypoint: payloadValue(context, "entrypoint"),
    executionTarget: normalizeExecutionTarget(payloadValue(context, "execution_target") || taskRow.latest_run_target),
    workflowName: normalizeWorkflowName(payloadValue(context, "workflow_name") || taskRow.latest_run_workflow_name),
    routeProvider: providerUsed,
    routeModel: modelUsed,
    lastEventAt: taskRow.latest_event_at,
    freshnessLabel: stale.freshnessLabel,
    freshnessDetail: stale.detail,
    staleCandidate: stale.staleCandidate,
    completionSource: completionSource(context, output, taskRow.completed_at),
    reconciledAt: payloadValue(reconciliation, "reconciled_at"),
    reconciledBy: payloadValue(reconciliation, "reconciled_by"),
    operatorIdentity: payloadValue(reconciliation, "operator_identity"),
    operatorIdentitySource: payloadValue(reconciliation, "operator_identity") ? "operator_provided" : null,
    operatorSource: payloadValue(reconciliation, "operator_source"),
    operatorSessionId: payloadValue(reconciliation, "operator_session_id"),
    operatorSessionStartedAt: payloadValue(reconciliation, "operator_session_started_at"),
    requestOrigin: stringValue(objectValue(reconciliation, "request_context")?.origin),
    requestReferer: stringValue(objectValue(reconciliation, "request_context")?.referer),
    reconciliationNote: payloadValue(reconciliation, "note"),
    provenance: ledgerProvenance,
  };

  const runs = runsResult.rows.map<OperationalRun>((row) => {
    const runOutput = row.output_payload || {};
    const runInput = row.input_payload || {};
    const runReconciliation = objectValue(runOutput, "operator_reconciliation");
    const runTaskClass = payloadValue(runOutput, "task_class");
    const runEvents = runEventGroups.get(row.run_id) ?? [];
    const runProviderUsed = normalizeProviderName(payloadValue(runOutput, "provider_used"));
    const runModelUsed = normalizeModelName(payloadValue(runOutput, "model_used"));
    const runArtifactPath = deriveArtifactPath(runOutput, runEvents);
    const runApprovalRequired = deriveApprovalRequired(runOutput, runEvents);
    const runActor = toActor(runTaskClass, runProviderUsed, taskRow.agent_id, taskRow.agent_name);
    const runStale = assessStaleRun(
      {
        taskId: taskRow.task_id,
        taskStatus: taskRow.status,
        taskStartedAt: taskRow.started_at,
        taskUpdatedAt: taskRow.updated_at,
        taskCompletedAt: taskRow.completed_at,
        taskCurrentPhase: taskRow.current_phase,
        taskContext: context,
        taskErrorSummary: taskRow.error_summary,
        runId: row.run_id,
        runStatus: row.status,
        runStartedAt: row.started_at,
        runFinishedAt: row.finished_at,
        runDurationMs: row.duration_ms,
        runWorkerName: row.worker_name,
        runExecutionTarget: row.execution_target,
        runWorkflowName: row.workflow_name,
        runExecutionId: row.execution_id,
        runInputPayload: runInput,
        runOutputPayload: runOutput,
        runErrorText: row.error_text,
        latestEventAt: taskRow.latest_event_at,
      },
      now,
    );

    return {
      id: row.run_id,
      taskId: row.task_id,
      title: taskRow.title,
      status: normalizeStatus(row.status),
      sourceType: "ghost_turn",
      summary: summarizeText(taskRow.result_summary, summarizeText(row.error_text, taskRow.title)),
      startedAt: row.started_at || taskRow.started_at || taskRow.updated_at,
      updatedAt: taskRow.updated_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms ? Number(row.duration_ms) : null,
      conversationId: taskRow.conversation_id,
      executionId: row.execution_id,
      workflowName: normalizeWorkflowName(row.workflow_name),
      taskClass: runTaskClass,
      providerUsed: runProviderUsed,
      modelUsed: runModelUsed,
      artifactPath: runArtifactPath,
      approvalRequired: runApprovalRequired,
      latestUserMessage: payloadValue(runInput, "message"),
      latestAssistantReply: taskRow.result_summary,
      actor: runActor,
      executionTarget: normalizeExecutionTarget(row.execution_target),
      lastEventAt: taskRow.latest_event_at,
      freshnessLabel: runStale.freshnessLabel,
      freshnessDetail: runStale.detail,
      staleCandidate: runStale.staleCandidate,
      completionSource: completionSource(context, runOutput, row.finished_at || taskRow.completed_at),
      reconciledAt: payloadValue(runReconciliation, "reconciled_at"),
      reconciledBy: payloadValue(runReconciliation, "reconciled_by"),
      operatorIdentity: payloadValue(runReconciliation, "operator_identity"),
      operatorIdentitySource: payloadValue(runReconciliation, "operator_identity") ? "operator_provided" : null,
      operatorSource: payloadValue(runReconciliation, "operator_source"),
      operatorSessionId: payloadValue(runReconciliation, "operator_session_id"),
      operatorSessionStartedAt: payloadValue(runReconciliation, "operator_session_started_at"),
      requestOrigin: stringValue(objectValue(runReconciliation, "request_context")?.origin),
      requestReferer: stringValue(objectValue(runReconciliation, "request_context")?.referer),
      reconciliationNote: payloadValue(runReconciliation, "note"),
      provenance: ledgerProvenance,
    };
  });

  const pagedEvents = eventsResult.rows.slice(0, eventLimit);
  const oldestVisibleEvent = pagedEvents[pagedEvents.length - 1] ?? null;

  const activity = [...pagedEvents]
    .reverse()
    .map<OperationalEvent>((row) => {
      const status = normalizeStatus(row.status);
      const presentation = formatRuntimeActivityPresentation({
        eventType: row.event_type,
        toolName: row.tool_name,
        status,
        payload: row.payload,
      });

      return {
        id: row.id,
        taskId: row.task_id,
        runId: row.task_run_id || row.task_id,
        type: presentation.type,
        status,
        title: presentation.title,
        detail: presentation.detail,
        timestamp: row.created_at,
        toolName: row.tool_name,
        payload: row.payload,
        provenance: ledgerProvenance,
      };
    });

  const summaryActivity = summaryEventsResult.rows.map<OperationalEvent>((row) => {
    const status = normalizeStatus(row.status);
    const presentation = formatRuntimeActivityPresentation({
      eventType: row.event_type,
      toolName: row.tool_name,
      status,
      payload: row.payload,
    });

    return {
      id: row.id,
      taskId: row.task_id,
      runId: row.task_run_id || row.task_id,
      type: presentation.type,
      status,
      title: presentation.title,
      detail: presentation.detail,
      timestamp: row.created_at,
      toolName: row.tool_name,
      payload: row.payload,
      provenance: ledgerProvenance,
    };
  });

  const operatorSession: OperatorSessionContext | null =
    task.operatorIdentity ||
    task.operatorSessionId ||
    task.requestOrigin ||
    task.requestReferer ||
    task.operatorSource
      ? {
          operatorIdentity: task.operatorIdentity ?? null,
          operatorIdentitySource: task.operatorIdentitySource ?? null,
          operatorSource: task.operatorSource ?? null,
          operatorSessionId: task.operatorSessionId ?? null,
          operatorSessionStartedAt: task.operatorSessionStartedAt ?? null,
          requestOrigin: task.requestOrigin ?? null,
          requestReferer: task.requestReferer ?? null,
          requestUserAgent: stringValue(objectValue(reconciliation, "request_context")?.user_agent),
        }
      : null;

  const stateEvidence = buildTaskStateEvidenceSnapshot(task, runs, summaryActivity);

  return {
    generatedAt: new Date().toISOString(),
    task,
    runs,
    activity,
    transitions: deriveTaskTransitions(task, summaryActivity, stateEvidence),
    diffs: deriveTaskDiffs(task, runs, stateEvidence),
    attentionHints: deriveTaskAttentionHints(task, runs, summaryActivity, stateEvidence),
    operatorSession,
    eventPage: {
      limit: eventLimit,
      hasMore: eventsResult.rows.length > eventLimit,
      nextBefore: oldestVisibleEvent?.created_at ?? null,
    },
    degraded: false,
    errors: [],
  };
}
