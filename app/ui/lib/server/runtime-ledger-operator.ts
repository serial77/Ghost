import { getPool } from "@/lib/server/postgres";

const STALE_RUN_AGE_MS = 15 * 60 * 1000;
const STALE_IDLE_MS = 10 * 60 * 1000;
const OPERATOR_SOURCE = "ghost-operator-ui";

export interface RuntimeLedgerRow {
  taskId: string;
  taskStatus: string | null;
  taskStartedAt: string | null;
  taskUpdatedAt: string | null;
  taskCompletedAt: string | null;
  taskCurrentPhase: string | null;
  taskContext: Record<string, unknown> | null;
  taskErrorSummary: string | null;
  runId: string | null;
  runStatus: string | null;
  runStartedAt: string | null;
  runFinishedAt: string | null;
  runDurationMs: number | null;
  runWorkerName: string | null;
  runExecutionTarget: string | null;
  runWorkflowName: string | null;
  runExecutionId: string | null;
  runInputPayload: Record<string, unknown> | null;
  runOutputPayload: Record<string, unknown> | null;
  runErrorText: string | null;
  latestEventAt: string | null;
}

interface RuntimeLedgerQueryRow {
  task_id: string;
  task_status: string | null;
  task_started_at: string | null;
  task_updated_at: string | null;
  task_completed_at: string | null;
  task_current_phase: string | null;
  task_context: Record<string, unknown> | null;
  task_error_summary: string | null;
  run_id: string | null;
  run_status: string | null;
  run_started_at: string | null;
  run_finished_at: string | null;
  run_duration_ms: number | null;
  run_worker_name: string | null;
  run_execution_target: string | null;
  run_workflow_name: string | null;
  run_execution_id: string | null;
  run_input_payload: Record<string, unknown> | null;
  run_output_payload: Record<string, unknown> | null;
  run_error_text: string | null;
  latest_event_at: string | null;
}

export interface StaleAssessment {
  isRunning: boolean;
  staleCandidate: boolean;
  startedAt: string | null;
  lastActivityAt: string | null;
  ageMs: number | null;
  idleMs: number | null;
  freshnessLabel: string;
  detail: string;
}

export interface StaleEvidenceSnapshot {
  isRunning: boolean;
  hasTerminalLedgerState: boolean;
  startedAt: string | null;
  lastActivityAt: string | null;
  ageMs: number | null;
  idleMs: number | null;
}

interface ReconciliationMetadata {
  reconciled_at: string;
  reconciled_by: string;
  operator_identity: string;
  operator_identity_source: "operator_provided";
  operator_source: string;
  operator_session_id: string | null;
  operator_session_started_at: string | null;
  request_context: {
    origin: string | null;
    referer: string | null;
    user_agent: string | null;
  };
  terminal_status: "failed";
  reason: "stale_running_task";
  note: string;
  runtime_confirmed: false;
  stale_rule: {
    age_ms: number;
    idle_ms: number;
  };
  stale_observation: {
    started_at: string | null;
    last_activity_at: string | null;
    age_ms: number | null;
    idle_ms: number | null;
  };
  previous_state: {
    task_status: string | null;
    task_phase: string | null;
    run_status: string | null;
  };
}

interface ReconciliationSessionContext {
  operatorSessionId: string | null;
  operatorSessionStartedAt: string | null;
  requestOrigin: string | null;
  requestReferer: string | null;
  requestUserAgent: string | null;
}

function maxDate(values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function formatDuration(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) {
    return "unknown";
  }

  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s`;
  }

  return `${Math.round(ms / 60_000)}m`;
}

export function buildStaleEvidenceSnapshot(row: RuntimeLedgerRow, now = new Date()): StaleEvidenceSnapshot {
  const effectiveRunStatus = String(row.runStatus || row.taskStatus || "").toLowerCase();
  const isRunning = effectiveRunStatus === "running";
  const startedAt = row.runStartedAt || row.taskStartedAt || null;
  const lastActivityAt = maxDate([row.latestEventAt, row.taskUpdatedAt, row.runStartedAt, row.taskStartedAt]);
  const hasTerminalLedgerState = Boolean(row.taskCompletedAt || row.runFinishedAt);

  if (!isRunning || !startedAt) {
    return {
      isRunning,
      hasTerminalLedgerState,
      startedAt,
      lastActivityAt,
      ageMs: null,
      idleMs: null,
    };
  }

  const ageMs = Math.max(0, now.getTime() - new Date(startedAt).getTime());
  const idleMs = lastActivityAt ? Math.max(0, now.getTime() - new Date(lastActivityAt).getTime()) : ageMs;

  return {
    isRunning,
    hasTerminalLedgerState,
    startedAt,
    lastActivityAt,
    ageMs,
    idleMs,
  };
}

export function assessStaleRun(row: RuntimeLedgerRow, now = new Date(), evidence = buildStaleEvidenceSnapshot(row, now)): StaleAssessment {

  if (!evidence.isRunning || !evidence.startedAt) {
    return {
      isRunning: evidence.isRunning,
      staleCandidate: false,
      startedAt: evidence.startedAt,
      lastActivityAt: evidence.lastActivityAt,
      ageMs: evidence.ageMs,
      idleMs: evidence.idleMs,
      freshnessLabel: evidence.hasTerminalLedgerState ? "runtime completed" : "not running",
      detail: evidence.hasTerminalLedgerState ? "Terminal state recorded in the ledger." : "No running task/run requires review.",
    };
  }

  const staleCandidate = evidence.ageMs! >= STALE_RUN_AGE_MS && evidence.idleMs! >= STALE_IDLE_MS;

  if (staleCandidate) {
    return {
      isRunning: true,
      staleCandidate: true,
      startedAt: evidence.startedAt,
      lastActivityAt: evidence.lastActivityAt,
      ageMs: evidence.ageMs,
      idleMs: evidence.idleMs,
      freshnessLabel: "stale needs review",
      detail: `Running for ${formatDuration(evidence.ageMs)} with no ledger activity for ${formatDuration(evidence.idleMs)}.`,
    };
  }

  return {
    isRunning: true,
    staleCandidate: false,
    startedAt: evidence.startedAt,
    lastActivityAt: evidence.lastActivityAt,
    ageMs: evidence.ageMs,
    idleMs: evidence.idleMs,
    freshnessLabel: "runtime active",
    detail: `Running for ${formatDuration(evidence.ageMs)}. Last ledger activity ${formatDuration(evidence.idleMs)} ago.`,
  };
}

export async function getRuntimeLedgerRow(taskId: string) {
  const pool = getPool("app");
  const result = await pool.query<RuntimeLedgerQueryRow>(
    `
      WITH latest_run AS (
        SELECT
          id::text AS run_id,
          task_id::text AS task_id,
          status AS run_status,
          started_at AS run_started_at,
          finished_at AS run_finished_at,
          duration_ms AS run_duration_ms,
          worker_name AS run_worker_name,
          execution_target AS run_execution_target,
          n8n_workflow_name AS run_workflow_name,
          n8n_execution_id AS run_execution_id,
          input_payload AS run_input_payload,
          output_payload AS run_output_payload,
          error_text AS run_error_text
        FROM task_runs
        WHERE task_id = $1::uuid
        ORDER BY started_at DESC
        LIMIT 1
      ),
      latest_event AS (
        SELECT MAX(created_at) AS latest_event_at
        FROM tool_events
        WHERE task_id = $1::uuid
      )
      SELECT
        task.id::text AS task_id,
        task.status AS task_status,
        task.started_at AS task_started_at,
        task.updated_at AS task_updated_at,
        task.completed_at AS task_completed_at,
        task.current_phase AS task_current_phase,
        task.context AS task_context,
        task.error_summary AS task_error_summary,
        latest_run.run_id AS run_id,
        latest_run.run_status,
        latest_run.run_started_at,
        latest_run.run_finished_at,
        latest_run.run_duration_ms,
        latest_run.run_worker_name,
        latest_run.run_execution_target,
        latest_run.run_workflow_name,
        latest_run.run_execution_id,
        latest_run.run_input_payload,
        latest_run.run_output_payload,
        latest_run.run_error_text,
        latest_event.latest_event_at
      FROM tasks task
      LEFT JOIN latest_run ON latest_run.task_id = task.id::text
      CROSS JOIN latest_event
      WHERE task.id = $1::uuid
      LIMIT 1
    `,
    [taskId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    taskId: row.task_id,
    taskStatus: row.task_status,
    taskStartedAt: row.task_started_at,
    taskUpdatedAt: row.task_updated_at,
    taskCompletedAt: row.task_completed_at,
    taskCurrentPhase: row.task_current_phase,
    taskContext: row.task_context,
    taskErrorSummary: row.task_error_summary,
    runId: row.run_id,
    runStatus: row.run_status,
    runStartedAt: row.run_started_at,
    runFinishedAt: row.run_finished_at,
    runDurationMs: row.run_duration_ms,
    runWorkerName: row.run_worker_name,
    runExecutionTarget: row.run_execution_target,
    runWorkflowName: row.run_workflow_name,
    runExecutionId: row.run_execution_id,
    runInputPayload: row.run_input_payload,
    runOutputPayload: row.run_output_payload,
    runErrorText: row.run_error_text,
    latestEventAt: row.latest_event_at,
  };
}

export async function reconcileStaleTask(
  taskId: string,
  note: string,
  operatorIdentity: string,
  sessionContext: ReconciliationSessionContext,
) {
  const pool = getPool("app");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const taskResult = await client.query<{
      task_status: string | null;
      task_started_at: string | null;
      task_updated_at: string | null;
      task_completed_at: string | null;
      task_current_phase: string | null;
      task_context: Record<string, unknown> | null;
      task_error_summary: string | null;
    }>(
      `
        SELECT
          status AS task_status,
          started_at AS task_started_at,
          updated_at AS task_updated_at,
          completed_at AS task_completed_at,
          current_phase AS task_current_phase,
          context AS task_context,
          error_summary AS task_error_summary
        FROM tasks
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [taskId],
    );

    if (!taskResult.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false as const, status: 404, error: "Task not found." };
    }

    const runResult = await client.query<{
      run_id: string;
      run_status: string | null;
      run_started_at: string | null;
      run_finished_at: string | null;
      run_duration_ms: number | null;
      run_worker_name: string | null;
      run_execution_target: string | null;
      run_workflow_name: string | null;
      run_execution_id: string | null;
      run_input_payload: Record<string, unknown> | null;
      run_output_payload: Record<string, unknown> | null;
      run_error_text: string | null;
    }>(
      `
        SELECT
          id::text AS run_id,
          status AS run_status,
          started_at AS run_started_at,
          finished_at AS run_finished_at,
          duration_ms AS run_duration_ms,
          worker_name AS run_worker_name,
          execution_target AS run_execution_target,
          n8n_workflow_name AS run_workflow_name,
          n8n_execution_id AS run_execution_id,
          input_payload AS run_input_payload,
          output_payload AS run_output_payload,
          error_text AS run_error_text
        FROM task_runs
        WHERE task_id = $1::uuid
        ORDER BY started_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [taskId],
    );

    const latestEventResult = await client.query<{ latest_event_at: string | null }>(
      `
        SELECT MAX(created_at)::text AS latest_event_at
        FROM tool_events
        WHERE task_id = $1::uuid
      `,
      [taskId],
    );

    const row: RuntimeLedgerRow = {
      taskId,
      taskStatus: taskResult.rows[0].task_status,
      taskStartedAt: taskResult.rows[0].task_started_at,
      taskUpdatedAt: taskResult.rows[0].task_updated_at,
      taskCompletedAt: taskResult.rows[0].task_completed_at,
      taskCurrentPhase: taskResult.rows[0].task_current_phase,
      taskContext: taskResult.rows[0].task_context,
      taskErrorSummary: taskResult.rows[0].task_error_summary,
      runId: runResult.rows[0]?.run_id ?? null,
      runStatus: runResult.rows[0]?.run_status ?? null,
      runStartedAt: runResult.rows[0]?.run_started_at ?? null,
      runFinishedAt: runResult.rows[0]?.run_finished_at ?? null,
      runDurationMs: runResult.rows[0]?.run_duration_ms ?? null,
      runWorkerName: runResult.rows[0]?.run_worker_name ?? null,
      runExecutionTarget: runResult.rows[0]?.run_execution_target ?? null,
      runWorkflowName: runResult.rows[0]?.run_workflow_name ?? null,
      runExecutionId: runResult.rows[0]?.run_execution_id ?? null,
      runInputPayload: runResult.rows[0]?.run_input_payload ?? null,
      runOutputPayload: runResult.rows[0]?.run_output_payload ?? null,
      runErrorText: runResult.rows[0]?.run_error_text ?? null,
      latestEventAt: latestEventResult.rows[0]?.latest_event_at ?? null,
    };

    const staleEvidence = buildStaleEvidenceSnapshot(row);
    const assessment = assessStaleRun(row, new Date(), staleEvidence);
    if (!row.runId || !assessment.staleCandidate || String(row.taskStatus || "").toLowerCase() !== "running") {
      await client.query("ROLLBACK");
      return {
        ok: false as const,
        status: 409,
        error: assessment.staleCandidate
          ? "Task is no longer reconcilable."
          : `Task is not a stale running candidate. ${assessment.detail}`,
      };
    }

    const reconciledAt = new Date();
    const startedAt = row.runStartedAt ? new Date(row.runStartedAt) : reconciledAt;
    const durationMs = Math.max(0, reconciledAt.getTime() - startedAt.getTime());
    const trimmedNote = note.trim();
    const trimmedOperatorIdentity = operatorIdentity.trim();
    const reconciliation: ReconciliationMetadata = {
      reconciled_at: reconciledAt.toISOString(),
      reconciled_by: trimmedOperatorIdentity,
      operator_identity: trimmedOperatorIdentity,
      operator_identity_source: "operator_provided",
      operator_source: OPERATOR_SOURCE,
      operator_session_id: sessionContext.operatorSessionId,
      operator_session_started_at: sessionContext.operatorSessionStartedAt,
      request_context: {
        origin: sessionContext.requestOrigin,
        referer: sessionContext.requestReferer,
        user_agent: sessionContext.requestUserAgent,
      },
      terminal_status: "failed",
      reason: "stale_running_task",
      note: trimmedNote,
      runtime_confirmed: false,
      stale_rule: {
        age_ms: STALE_RUN_AGE_MS,
        idle_ms: STALE_IDLE_MS,
      },
      stale_observation: {
        started_at: staleEvidence.startedAt,
        last_activity_at: staleEvidence.lastActivityAt,
        age_ms: staleEvidence.ageMs,
        idle_ms: staleEvidence.idleMs,
      },
      previous_state: {
        task_status: row.taskStatus,
        task_phase: row.taskCurrentPhase,
        run_status: row.runStatus,
      },
    };

    const reconciliationJson = JSON.stringify({ operator_reconciliation: reconciliation });
    const summary = `Operator reconciled stale running task. ${trimmedNote}`;

    await client.query(
      `
        UPDATE task_runs
        SET
          status = 'failed',
          finished_at = NOW(),
          duration_ms = $3,
          error_text = $4,
          output_payload = output_payload || $5::jsonb
        WHERE id = $1::uuid
          AND task_id = $2::uuid
          AND status = 'running'
      `,
      [row.runId, taskId, durationMs, summary, reconciliationJson],
    );

    await client.query(
      `
        UPDATE tasks
        SET
          status = 'failed',
          current_phase = 'operator_reconciled',
          context = context || jsonb_build_object('reconciliation', $2::jsonb),
          error_summary = $3,
          updated_at = NOW(),
          completed_at = NOW()
        WHERE id = $1::uuid
          AND status = 'running'
      `,
      [taskId, JSON.stringify(reconciliation), summary],
    );

    await client.query(
      `
        INSERT INTO tool_events (
          task_id,
          task_run_id,
          tool_name,
          event_type,
          status,
          payload
        )
        VALUES ($1::uuid, $2::uuid, 'ghost-operator-ui', 'operator_reconciled', 'warn', $3::jsonb)
      `,
      [
        taskId,
        row.runId,
        JSON.stringify({
          detail: "Operator marked stale running task as failed. Runtime did not confirm a terminal state.",
          note: trimmedNote,
          reconciled_at: reconciliation.reconciled_at,
          reconciled_by: reconciliation.reconciled_by,
          operator_identity: reconciliation.operator_identity,
          operator_identity_source: reconciliation.operator_identity_source,
          operator_source: reconciliation.operator_source,
          operator_session_id: reconciliation.operator_session_id,
          operator_session_started_at: reconciliation.operator_session_started_at,
          request_origin: reconciliation.request_context.origin,
          request_referer: reconciliation.request_context.referer,
          request_user_agent: reconciliation.request_context.user_agent,
          terminal_status: reconciliation.terminal_status,
          runtime_confirmed: false,
          stale_age_ms: assessment.ageMs,
          stale_idle_ms: assessment.idleMs,
          previous_task_status: row.taskStatus,
          previous_run_status: row.runStatus,
        }),
      ],
    );

    await client.query("COMMIT");
    return {
      ok: true as const,
      status: 200,
      taskId,
      taskRunId: row.runId,
      reconciliation,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const staleRunPolicy = {
  staleRunAgeMs: STALE_RUN_AGE_MS,
  staleIdleMs: STALE_IDLE_MS,
};
