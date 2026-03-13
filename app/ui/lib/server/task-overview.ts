import type {
  OperationalActor,
  OperationalEvent,
  OperationalRun,
  OperationalRunStatus,
  OperationalSourceHealth,
  OperationalTask,
  TaskOverviewPayload,
} from "@/lib/operations";
import { getPool } from "@/lib/server/postgres";
import { formatRuntimeActivityPresentation } from "@/lib/server/runtime-activity-presentation";
import { assessStaleRun, staleRunPolicy } from "@/lib/server/runtime-ledger-operator";
import { getOperationsRuntimeConfig } from "@/lib/server/runtime-env";
import {
  deriveApprovalRequired,
  deriveArtifactPath,
  normalizeExecutionTarget,
  normalizeModelName,
  normalizeProviderName,
  normalizeWorkflowName,
} from "@/lib/server/runtime-presentation-normalizer";

const ledgerProvenance = {
  sourceId: "ghost_app" as const,
  label: "Ghost runtime ledger",
  detail: "ghost_app.tasks + task_runs + tool_events",
};

const ghostFallbackProvenance = {
  sourceId: "ghost_app" as const,
  label: "Ghost conversation turns",
  detail: "ghost_app.messages + conversations",
};

const n8nFallbackProvenance = {
  sourceId: "n8n_core" as const,
  label: "n8n workflow executions",
  detail: "ghost_core.execution_entity + workflow_entity",
};

interface LedgerTaskRow {
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

interface LedgerEventRow {
  id: string;
  task_id: string;
  task_run_id: string | null;
  tool_name: string;
  event_type: string;
  status: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface GhostFallbackRow {
  assistant_message_id: string;
  conversation_id: string;
  assistant_content: string;
  assistant_created_at: string;
  user_content: string | null;
  user_created_at: string | null;
  model_name: string | null;
  metadata: {
    task_class?: string;
    provider_used?: string;
    command_success?: boolean;
    approval_required?: boolean;
    error_type?: string | null;
    artifact_path?: string | null;
    task_summary?: string | null;
  } | null;
}

interface ExecutionFallbackRow {
  id: string;
  status: string;
  finished: boolean;
  mode: string;
  workflow_id: string;
  workflow_name: string;
  started_at: string | null;
  stopped_at: string | null;
  wait_till: string | null;
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

function payloadValue(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

function objectValue(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function eventGroups(rows: LedgerEventRow[]) {
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

async function getLedgerView(limit: number) {
  const pool = getPool("app");
  const [tasksResult, eventsResult] = await Promise.all([
    pool.query<LedgerTaskRow>(
      `
        WITH latest_runs AS (
          SELECT DISTINCT ON (task_id)
            id,
            task_id,
            status,
            started_at,
            finished_at,
            duration_ms,
            worker_name,
            execution_target,
            n8n_workflow_name,
            n8n_execution_id,
            input_payload,
            output_payload,
            error_text
          FROM task_runs
          ORDER BY task_id, started_at DESC
        ),
        event_stats AS (
          SELECT
            task_id,
            COUNT(*)::text AS event_count,
            MAX(created_at) AS latest_event_at
          FROM tool_events
          GROUP BY task_id
        ),
        run_counts AS (
          SELECT task_id, COUNT(*)::text AS run_count
          FROM task_runs
          GROUP BY task_id
        )
        SELECT
          task.id AS task_id,
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
          latest_runs.id AS latest_run_id,
          latest_runs.status AS latest_run_status,
          latest_runs.started_at AS latest_run_started_at,
          latest_runs.finished_at AS latest_run_finished_at,
          latest_runs.duration_ms AS latest_run_duration_ms,
          latest_runs.worker_name AS latest_run_worker_name,
          latest_runs.execution_target AS latest_run_target,
          latest_runs.n8n_workflow_name AS latest_run_workflow_name,
          latest_runs.n8n_execution_id AS latest_run_execution_id,
          latest_runs.input_payload AS latest_run_input_payload,
          latest_runs.output_payload AS latest_run_output_payload,
          latest_runs.error_text AS latest_run_error_text,
          event_stats.latest_event_at AS latest_event_at,
          agent.id AS agent_id,
          agent.display_name AS agent_name,
          COALESCE(event_stats.event_count, '0') AS event_count,
          COALESCE(run_counts.run_count, '0') AS run_count
        FROM tasks task
        LEFT JOIN latest_runs ON latest_runs.task_id = task.id
        LEFT JOIN agents agent ON agent.id = task.assigned_agent_id
        LEFT JOIN event_stats ON event_stats.task_id = task.id
        LEFT JOIN run_counts ON run_counts.task_id = task.id
        ORDER BY task.updated_at DESC
        LIMIT $1
      `,
      [limit],
    ),
    pool.query<LedgerEventRow>(
      `
        SELECT
          id::text,
          task_id::text,
          task_run_id::text,
          tool_name,
          event_type,
          status,
          payload,
          created_at
        FROM tool_events
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit * 6],
    ),
  ]);

  const now = new Date();
  const runEventGroups = eventGroups(eventsResult.rows);
  const tasks = tasksResult.rows.map<OperationalTask>((row) => {
    const output = row.latest_run_output_payload || {};
    const input = row.latest_run_input_payload || {};
    const context = row.context || {};
    const taskClass = payloadValue(output, "task_class");
    const providerUsed = normalizeProviderName(payloadValue(output, "provider_used"));
    const modelUsed = normalizeModelName(payloadValue(output, "model_used"));
    const runEvents = row.latest_run_id ? runEventGroups.get(row.latest_run_id) ?? [] : [];
    const artifactPath = deriveArtifactPath(output, runEvents);
    const approvalRequired = deriveApprovalRequired(output, runEvents);
    const reconciliation = objectValue(context, "reconciliation") || objectValue(output, "operator_reconciliation");
    const actor = toActor(taskClass, providerUsed, row.agent_id, row.agent_name);
    const stale = assessStaleRun(
      {
        taskId: row.task_id,
        taskStatus: row.status,
        taskStartedAt: row.started_at,
        taskUpdatedAt: row.updated_at,
        taskCompletedAt: row.completed_at,
        taskCurrentPhase: row.current_phase,
        taskContext: context,
        taskErrorSummary: row.error_summary,
        runId: row.latest_run_id,
        runStatus: row.latest_run_status,
        runStartedAt: row.latest_run_started_at,
        runFinishedAt: row.latest_run_finished_at,
        runDurationMs: row.latest_run_duration_ms,
        runWorkerName: row.latest_run_worker_name,
        runExecutionTarget: row.latest_run_target,
        runWorkflowName: row.latest_run_workflow_name,
        runExecutionId: row.latest_run_execution_id,
        runInputPayload: input,
        runOutputPayload: output,
        runErrorText: row.latest_run_error_text,
        latestEventAt: row.latest_event_at,
      },
      now,
    );

    return {
      id: row.task_id,
      title: row.title,
      status: normalizeStatus(row.status),
      source: row.source,
      summary: summarizeText(row.result_summary, summarizeText(row.error_summary, row.title)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      currentPhase: row.current_phase,
      conversationId: row.conversation_id,
      taskType: row.task_type,
      assignedActor: actor,
      latestRunId: row.latest_run_id,
      latestRunStatus: normalizeStatus(row.latest_run_status),
      latestRunDurationMs: row.latest_run_duration_ms ? Number(row.latest_run_duration_ms) : null,
      eventCount: Number(row.event_count),
      runCount: Number(row.run_count),
      approvalRequired,
      artifactPath,
      latestUserMessage: payloadValue(input, "message"),
      latestAssistantReply: summarizeText(row.result_summary, ""),
      errorSummary: row.error_summary,
      resultSummary: row.result_summary,
      entrypoint: payloadValue(context, "entrypoint"),
      executionTarget: normalizeExecutionTarget(payloadValue(context, "execution_target") || row.latest_run_target),
      workflowName: normalizeWorkflowName(payloadValue(context, "workflow_name") || row.latest_run_workflow_name),
      routeProvider: providerUsed,
      routeModel: modelUsed,
      lastEventAt: row.latest_event_at,
      freshnessLabel: stale.freshnessLabel,
      freshnessDetail: stale.detail,
      staleCandidate: stale.staleCandidate,
      completionSource: completionSource(context, output, row.completed_at),
      reconciledAt: payloadValue(reconciliation, "reconciled_at"),
      reconciledBy: payloadValue(reconciliation, "reconciled_by"),
      operatorIdentity: payloadValue(reconciliation, "operator_identity"),
      operatorIdentitySource: payloadValue(reconciliation, "operator_identity") ? "operator_provided" : null,
      operatorSource: payloadValue(reconciliation, "operator_source"),
      operatorSessionId: payloadValue(reconciliation, "operator_session_id"),
      operatorSessionStartedAt: payloadValue(reconciliation, "operator_session_started_at"),
      requestOrigin: payloadValue(objectValue(reconciliation, "request_context"), "origin"),
      requestReferer: payloadValue(objectValue(reconciliation, "request_context"), "referer"),
      reconciliationNote: payloadValue(reconciliation, "note"),
      provenance: ledgerProvenance,
    };
  });

  const runs = tasksResult.rows
    .filter((row) => row.latest_run_id)
    .map<OperationalRun>((row) => {
      const output = row.latest_run_output_payload || {};
      const input = row.latest_run_input_payload || {};
      const context = row.context || {};
      const taskClass = payloadValue(output, "task_class");
      const providerUsed = normalizeProviderName(payloadValue(output, "provider_used"));
      const modelUsed = normalizeModelName(payloadValue(output, "model_used"));
      const runEvents = row.latest_run_id ? runEventGroups.get(row.latest_run_id) ?? [] : [];
      const artifactPath = deriveArtifactPath(output, runEvents);
      const approvalRequired = deriveApprovalRequired(output, runEvents);
      const reconciliation = objectValue(context, "reconciliation") || objectValue(output, "operator_reconciliation");
      const actor = toActor(taskClass, providerUsed, row.agent_id, row.agent_name);
      const stale = assessStaleRun(
        {
          taskId: row.task_id,
          taskStatus: row.status,
          taskStartedAt: row.started_at,
          taskUpdatedAt: row.updated_at,
          taskCompletedAt: row.completed_at,
          taskCurrentPhase: row.current_phase,
          taskContext: context,
          taskErrorSummary: row.error_summary,
          runId: row.latest_run_id,
          runStatus: row.latest_run_status,
          runStartedAt: row.latest_run_started_at,
          runFinishedAt: row.latest_run_finished_at,
          runDurationMs: row.latest_run_duration_ms,
          runWorkerName: row.latest_run_worker_name,
          runExecutionTarget: row.latest_run_target,
          runWorkflowName: row.latest_run_workflow_name,
          runExecutionId: row.latest_run_execution_id,
          runInputPayload: input,
          runOutputPayload: output,
          runErrorText: row.latest_run_error_text,
          latestEventAt: row.latest_event_at,
        },
        now,
      );

      return {
        id: row.latest_run_id!,
        taskId: row.task_id,
        title: row.title,
        status: normalizeStatus(row.latest_run_status),
        sourceType: "ghost_turn",
        summary: summarizeText(row.result_summary, summarizeText(row.latest_run_error_text, row.title)),
        startedAt: row.latest_run_started_at || row.started_at || row.updated_at,
        updatedAt: row.updated_at,
        finishedAt: row.latest_run_finished_at,
        durationMs: row.latest_run_duration_ms ? Number(row.latest_run_duration_ms) : null,
        conversationId: row.conversation_id,
        executionId: row.latest_run_execution_id,
        workflowName: normalizeWorkflowName(row.latest_run_workflow_name),
        taskClass,
        providerUsed,
        modelUsed,
        artifactPath,
        approvalRequired,
        latestUserMessage: payloadValue(input, "message"),
        latestAssistantReply: row.result_summary,
        actor,
        executionTarget: normalizeExecutionTarget(row.latest_run_target),
        lastEventAt: row.latest_event_at,
        freshnessLabel: stale.freshnessLabel,
        freshnessDetail: stale.detail,
        staleCandidate: stale.staleCandidate,
        completionSource: completionSource(context, output, row.latest_run_finished_at || row.completed_at),
        reconciledAt: payloadValue(reconciliation, "reconciled_at"),
        reconciledBy: payloadValue(reconciliation, "reconciled_by"),
        operatorIdentity: payloadValue(reconciliation, "operator_identity"),
        operatorIdentitySource: payloadValue(reconciliation, "operator_identity") ? "operator_provided" : null,
        operatorSource: payloadValue(reconciliation, "operator_source"),
        operatorSessionId: payloadValue(reconciliation, "operator_session_id"),
        operatorSessionStartedAt: payloadValue(reconciliation, "operator_session_started_at"),
        requestOrigin: payloadValue(objectValue(reconciliation, "request_context"), "origin"),
        requestReferer: payloadValue(objectValue(reconciliation, "request_context"), "referer"),
        reconciliationNote: payloadValue(reconciliation, "note"),
        provenance: ledgerProvenance,
      };
    });

  const events = eventsResult.rows.map<OperationalEvent>((row) => {
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

  return {
    tasks,
    runs,
    activity: events,
    lastSeenAt: tasks[0]?.updatedAt ?? null,
  };
}

async function getGhostFallback(limit: number) {
  const pool = getPool("app");
  const result = await pool.query<GhostFallbackRow>(
    `
      SELECT
        assistant.id AS assistant_message_id,
        assistant.conversation_id,
        assistant.content AS assistant_content,
        assistant.created_at AS assistant_created_at,
        assistant.model_name,
        assistant.metadata,
        user_message.content AS user_content,
        user_message.created_at AS user_created_at
      FROM messages assistant
      LEFT JOIN LATERAL (
        SELECT content, created_at
        FROM messages
        WHERE conversation_id = assistant.conversation_id
          AND role = 'user'
          AND created_at <= assistant.created_at
        ORDER BY created_at DESC
        LIMIT 1
      ) user_message ON true
      WHERE assistant.role = 'assistant'
      ORDER BY assistant.created_at DESC
      LIMIT $1
    `,
    [limit],
  );

  const runs = result.rows.map<OperationalRun>((row) => {
    const metadata = row.metadata || {};
    const providerUsed = normalizeProviderName(metadata.provider_used || null);
    const actor = toActor(metadata.task_class, providerUsed);
    const status =
      metadata.approval_required ? "blocked" : metadata.command_success === false || metadata.error_type ? "failed" : "succeeded";
    const startedAt = row.user_created_at || row.assistant_created_at;
    const durationMs =
      row.user_created_at && row.assistant_created_at
        ? Math.max(0, new Date(row.assistant_created_at).getTime() - new Date(row.user_created_at).getTime())
        : null;

    return {
      id: `fallback-ghost:${row.assistant_message_id}`,
      title: summarizeText(metadata.task_summary, summarizeText(row.user_content, "Ghost turn")),
      status,
      sourceType: "ghost_turn",
      summary: summarizeText(row.assistant_content, "Ghost returned no reply."),
      startedAt,
      updatedAt: row.assistant_created_at,
      finishedAt: row.assistant_created_at,
      durationMs,
      conversationId: row.conversation_id,
      taskClass: metadata.task_class || null,
      providerUsed,
      modelUsed: normalizeModelName(row.model_name),
      artifactPath: metadata.artifact_path || null,
      approvalRequired: metadata.approval_required === true,
      latestUserMessage: row.user_content,
      latestAssistantReply: row.assistant_content,
      executionTarget: normalizeExecutionTarget("ghost_app.messages"),
      lastEventAt: row.assistant_created_at,
      freshnessLabel: "fallback projection",
      freshnessDetail: "Derived from conversation messages because the canonical ledger had no rows.",
      staleCandidate: false,
      completionSource: "runtime_confirmed",
      actor,
      provenance: ghostFallbackProvenance,
    };
  });

  return { runs, lastSeenAt: runs[0]?.updatedAt ?? null };
}

async function getExecutionFallback(limit: number) {
  const pool = getPool("core");
  const result = await pool.query<ExecutionFallbackRow>(
    `
      SELECT
        execution.id::text AS id,
        execution.status,
        execution.finished,
        execution.mode,
        execution."workflowId" AS workflow_id,
        workflow.name AS workflow_name,
        execution."startedAt" AS started_at,
        execution."stoppedAt" AS stopped_at,
        execution."waitTill" AS wait_till
      FROM execution_entity execution
      JOIN workflow_entity workflow
        ON workflow.id = execution."workflowId"
      WHERE execution."deletedAt" IS NULL
      ORDER BY execution.id DESC
      LIMIT $1
    `,
    [limit],
  );

  const runs = result.rows.map<OperationalRun>((row) => {
    const startedAt = row.started_at || row.wait_till || new Date().toISOString();
    const status = !row.finished ? "running" : normalizeStatus(row.status);

    return {
      id: `fallback-execution:${row.id}`,
      title: row.workflow_name,
      status,
      sourceType: "workflow_execution",
      summary: `${row.mode} execution ${row.status.toLowerCase()}`,
      startedAt,
      updatedAt: row.stopped_at || startedAt,
      finishedAt: row.stopped_at,
      durationMs:
        row.started_at && row.stopped_at
          ? Math.max(0, new Date(row.stopped_at).getTime() - new Date(row.started_at).getTime())
          : null,
      executionId: row.id,
      workflowId: row.workflow_id,
      workflowName: normalizeWorkflowName(row.workflow_name),
      executionTarget: normalizeExecutionTarget(row.workflow_name),
      lastEventAt: row.stopped_at || row.started_at,
      freshnessLabel: row.finished ? "runtime completed" : "runtime active",
      freshnessDetail: row.finished ? "Fallback execution data is terminal." : "Fallback execution data is still active.",
      staleCandidate: false,
      completionSource: row.finished ? "runtime_confirmed" : null,
      actor: { id: row.workflow_id, label: row.workflow_name, kind: "workflow" },
      provenance: n8nFallbackProvenance,
    };
  });

  return { runs, lastSeenAt: runs[0]?.updatedAt ?? null };
}

function buildMockPayload(): TaskOverviewPayload {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      activeNow: 0,
      recentRuns: 0,
      technicalRuns: 0,
      blockedRuns: 0,
      failedRuns: 0,
      staleRuns: 0,
      lastUpdatedAt: null,
    },
    tasks: [],
    runs: [],
    activity: [],
    sourceHealth: [
      { sourceId: "ghost_app", label: "Ghost runtime ledger", status: "degraded", detail: "Mock fallback active.", lastSeenAt: null },
    ],
    degraded: true,
    errors: ["Mock operations payload active."],
  };
}

export async function getTaskOverviewPayload(): Promise<TaskOverviewPayload> {
  const config = getOperationsRuntimeConfig();
  const errors: string[] = [];
  const sourceHealth: OperationalSourceHealth[] = [];

  try {
    const ledger = await getLedgerView(20);
    if (ledger.tasks.length > 0) {
      sourceHealth.push({
        sourceId: "ghost_app",
        label: ledgerProvenance.label,
        status: "live",
        detail: `${ledger.tasks.length} durable tasks available. Stale review rule: ${staleRunPolicy.staleRunAgeMs / 60000}m age, ${staleRunPolicy.staleIdleMs / 60000}m idle.`,
        lastSeenAt: ledger.lastSeenAt,
      });

      return {
        generatedAt: new Date().toISOString(),
        summary: {
          activeNow: ledger.tasks.filter((task) => task.status === "running").length,
          recentRuns: ledger.runs.length,
          technicalRuns: ledger.runs.filter((run) => run.taskClass === "technical_work").length,
          blockedRuns: ledger.tasks.filter((task) => task.status === "blocked").length,
          failedRuns: ledger.tasks.filter((task) => task.status === "failed").length,
          staleRuns: ledger.tasks.filter((task) => task.staleCandidate).length,
          lastUpdatedAt: ledger.lastSeenAt,
        },
        tasks: ledger.tasks,
        runs: ledger.runs,
        activity: ledger.activity.slice(0, 60),
        sourceHealth,
        degraded: false,
        errors,
      };
    }

    sourceHealth.push({
      sourceId: "ghost_app",
      label: ledgerProvenance.label,
      status: "degraded",
      detail: `Ledger reachable but empty; stale review rule: ${staleRunPolicy.staleRunAgeMs / 60000}m age, ${staleRunPolicy.staleIdleMs / 60000}m idle.`,
      lastSeenAt: null,
    });
  } catch (error) {
    errors.push(`ledger: ${error instanceof Error ? error.message : "query failed"}`);
    sourceHealth.push({
      sourceId: "ghost_app",
      label: ledgerProvenance.label,
      status: "unavailable",
      detail: "Durable ledger query failed; using fallback sources.",
      lastSeenAt: null,
    });
  }

  const [ghostFallback, executionFallback] = await Promise.allSettled([getGhostFallback(12), getExecutionFallback(12)]);
  const ghostRuns = ghostFallback.status === "fulfilled" ? ghostFallback.value.runs : [];
  const executionRuns = executionFallback.status === "fulfilled" ? executionFallback.value.runs : [];

  if (ghostFallback.status === "fulfilled") {
    sourceHealth.push({
      sourceId: "ghost_app",
      label: ghostFallbackProvenance.label,
      status: "live",
      detail: `${ghostRuns.length} fallback Ghost turns available.`,
      lastSeenAt: ghostFallback.value.lastSeenAt,
    });
  } else {
    errors.push(`ghost_fallback: ${ghostFallback.reason instanceof Error ? ghostFallback.reason.message : "query failed"}`);
  }

  if (executionFallback.status === "fulfilled") {
    sourceHealth.push({
      sourceId: "n8n_core",
      label: n8nFallbackProvenance.label,
      status: "live",
      detail: `${executionRuns.length} fallback workflow executions available.`,
      lastSeenAt: executionFallback.value.lastSeenAt,
    });
  } else {
    errors.push(`execution_fallback: ${executionFallback.reason instanceof Error ? executionFallback.reason.message : "query failed"}`);
  }

  if (!ghostRuns.length && !executionRuns.length && config.enableOperationsMocks) {
    return buildMockPayload();
  }

  const runs = [...ghostRuns, ...executionRuns]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 24);

  const tasks = runs.map<OperationalTask>((run) => ({
    id: `fallback-task:${run.id}`,
    title: run.title,
    status: run.status,
    source: "fallback_live_stream",
    summary: run.summary,
    createdAt: run.startedAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.finishedAt ?? null,
    currentPhase: "fallback_projection",
    conversationId: run.conversationId ?? null,
    taskType: run.taskClass ?? run.sourceType,
    assignedActor: run.actor,
    latestRunId: run.id,
    latestRunStatus: run.status,
    latestRunDurationMs: run.durationMs ?? null,
    eventCount: 0,
    runCount: 1,
    approvalRequired: run.approvalRequired ?? false,
    artifactPath: run.artifactPath ?? null,
    latestUserMessage: run.latestUserMessage ?? null,
    latestAssistantReply: run.latestAssistantReply ?? null,
    errorSummary: run.status === "failed" ? run.summary : null,
    resultSummary: run.status === "failed" ? null : run.summary,
    executionTarget: run.executionTarget ?? null,
    workflowName: run.workflowName ?? null,
    routeProvider: run.providerUsed ?? null,
    routeModel: run.modelUsed ?? null,
    lastEventAt: run.lastEventAt ?? null,
    freshnessLabel: run.freshnessLabel ?? null,
    freshnessDetail: run.freshnessDetail ?? null,
    staleCandidate: run.staleCandidate ?? false,
    completionSource: run.completionSource ?? null,
    reconciledAt: run.reconciledAt ?? null,
    reconciledBy: run.reconciledBy ?? null,
    operatorIdentity: run.operatorIdentity ?? null,
    operatorIdentitySource: run.operatorIdentitySource ?? null,
    operatorSource: run.operatorSource ?? null,
    operatorSessionId: run.operatorSessionId ?? null,
    operatorSessionStartedAt: run.operatorSessionStartedAt ?? null,
    requestOrigin: run.requestOrigin ?? null,
    requestReferer: run.requestReferer ?? null,
    reconciliationNote: run.reconciliationNote ?? null,
    provenance: run.provenance,
  }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      activeNow: executionRuns.filter((run) => run.status === "running").length,
      recentRuns: runs.length,
      technicalRuns: runs.filter((run) => run.taskClass === "technical_work").length,
      blockedRuns: runs.filter((run) => run.status === "blocked").length,
      failedRuns: runs.filter((run) => run.status === "failed").length,
      staleRuns: 0,
      lastUpdatedAt: runs[0]?.updatedAt ?? null,
    },
    tasks,
    runs,
    activity: [],
    sourceHealth,
    degraded: true,
    errors,
  };
}
