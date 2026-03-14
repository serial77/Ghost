import { PoolClient } from "pg";
import { getPool } from "@/lib/server/postgres";
import { getGhostBackendUrl } from "@/lib/chat";

type LedgerStatus = "queued" | "running" | "succeeded" | "failed" | "blocked";

interface LedgerStartInput {
  message: string;
  conversationId?: string | null;
}

interface LedgerCompleteInput {
  taskId: string;
  taskRunId: string;
  responseStatus: number;
  reply?: string | null;
  conversationId?: string | null;
  taskClass?: string | null;
  providerUsed?: string | null;
  modelUsed?: string | null;
  approvalRequired?: boolean;
  artifactPath?: string | null;
  commandSuccess?: boolean | null;
  errorType?: string | null;
  taskSummary?: string | null;
  rawOutput: unknown;
}

function summarizePrompt(message: string) {
  const trimmed = message.trim().replace(/\s+/g, " ");
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

function extractWebhookTarget() {
  try {
    const url = new URL(getGhostBackendUrl());
    return url.pathname.replace(/^\/+/, "") || "ghost-chat-v3";
  } catch {
    return "ghost-chat-v3";
  }
}

async function getGhostAgentId(client: PoolClient) {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM agents WHERE agent_key = 'ghost-main' LIMIT 1`,
  );
  return result.rows[0]?.id ?? null;
}

export async function startLedgerTask(input: LedgerStartInput) {
  const pool = getPool("app");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const agentId = await getGhostAgentId(client);
    const now = new Date().toISOString();
    const title = summarizePrompt(input.message);

    const taskResult = await client.query<{ id: string }>(
      `
        INSERT INTO tasks (
          conversation_id,
          assigned_agent_id,
          title,
          task_type,
          source,
          status,
          current_phase,
          input,
          context,
          started_at
        )
        VALUES ($1, $2, $3, 'ghost_request', 'ghost_ui_proxy', 'running', 'awaiting_webhook_reply', $4::jsonb, $5::jsonb, NOW())
        RETURNING id
      `,
      [
        input.conversationId ?? null,
        agentId,
        title,
        JSON.stringify({
          message: input.message,
          conversation_id: input.conversationId ?? null,
        }),
        JSON.stringify({
          channel: "ui_proxy",
          target_webhook: extractWebhookTarget(),
          started_at: now,
        }),
      ],
    );

    const taskId = taskResult.rows[0].id;
    const runResult = await client.query<{ id: string }>(
      `
        INSERT INTO task_runs (
          task_id,
          run_number,
          execution_target,
          status,
          n8n_workflow_name,
          worker_name,
          input_payload,
          started_at
        )
        VALUES ($1, 1, $2, 'running', $3, 'ghost-ui-proxy', $4::jsonb, NOW())
        RETURNING id
      `,
      [
        taskId,
        extractWebhookTarget(),
        "Ghost Runtime",
        JSON.stringify({
          message: input.message,
          conversation_id: input.conversationId ?? null,
        }),
      ],
    );

    const taskRunId = runResult.rows[0].id;

    await client.query(
      `
        INSERT INTO tool_events (
          task_id,
          task_run_id,
          agent_id,
          tool_name,
          event_type,
          status,
          payload
        )
        VALUES
          ($1, $2, $3, 'ghost-ui-proxy', 'task_created', 'ok', $4::jsonb),
          ($1, $2, $3, 'ghost-webhook', 'upstream_dispatch_started', 'ok', $5::jsonb)
      `,
      [
        taskId,
        taskRunId,
        agentId,
        JSON.stringify({ title, conversation_id: input.conversationId ?? null }),
        JSON.stringify({ target_webhook: extractWebhookTarget() }),
      ],
    );

    await client.query("COMMIT");
    return { taskId, taskRunId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function deriveStatus(input: LedgerCompleteInput): LedgerStatus {
  if (input.approvalRequired) {
    return "blocked";
  }

  if (input.responseStatus >= 400 || input.commandSuccess === false || input.errorType) {
    return "failed";
  }

  return "succeeded";
}

export async function completeLedgerTask(input: LedgerCompleteInput) {
  const pool = getPool("app");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const status = deriveStatus(input);
    const eventStatus = status === "failed" ? "error" : status === "blocked" ? "warn" : "ok";
    const finishedAt = new Date();
    const startedRow = await client.query<{ started_at: string }>(
      `SELECT started_at FROM task_runs WHERE id = $1`,
      [input.taskRunId],
    );
    const startedAt = startedRow.rows[0]?.started_at ? new Date(startedRow.rows[0].started_at) : finishedAt;
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

    const resultSummary = input.reply?.trim() || input.taskSummary || null;
    const errorSummary =
      status === "failed"
        ? input.errorType || (typeof input.rawOutput === "string" ? input.rawOutput.slice(0, 300) : `HTTP ${input.responseStatus}`)
        : null;

    await client.query(
      `
        UPDATE task_runs
        SET
          status = $2,
          worker_name = $3,
          output_payload = $4::jsonb,
          error_text = $5,
          finished_at = NOW(),
          duration_ms = $6
        WHERE id = $1
      `,
      [
        input.taskRunId,
        status,
        input.providerUsed || "ghost-ui-proxy",
        JSON.stringify(input.rawOutput),
        errorSummary,
        durationMs,
      ],
    );

    await client.query(
      `
        UPDATE tasks
        SET
          conversation_id = COALESCE($2::uuid, conversation_id),
          status = $3,
          current_phase = $4,
          context = context || $5::jsonb,
          result_summary = $6,
          error_summary = $7,
          updated_at = NOW(),
          completed_at = CASE WHEN $3 IN ('succeeded', 'failed', 'blocked') THEN NOW() ELSE completed_at END
        WHERE id = $1
      `,
      [
        input.taskId,
        input.conversationId ?? null,
        status,
        status === "blocked" ? "approval_required" : status === "failed" ? "failed" : "completed",
        JSON.stringify({
          task_class: input.taskClass ?? null,
          provider_used: input.providerUsed ?? null,
          model_used: input.modelUsed ?? null,
          approval_required: input.approvalRequired ?? false,
          artifact_path: input.artifactPath ?? null,
          latest_run_id: input.taskRunId,
        }),
        resultSummary,
        errorSummary,
      ],
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
        VALUES
          ($1, $2, 'ghost-webhook', 'upstream_dispatch_completed', $3, $4::jsonb),
          ($1, $2, 'ghost-ledger', 'assistant_reply_recorded', $3, $5::jsonb)
      `,
      [
        input.taskId,
        input.taskRunId,
        eventStatus,
        JSON.stringify({
          response_status: input.responseStatus,
          task_class: input.taskClass ?? null,
          provider_used: input.providerUsed ?? null,
        }),
        JSON.stringify({
          conversation_id: input.conversationId ?? null,
          summary: resultSummary,
        }),
      ],
    );

    if (input.approvalRequired) {
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
          VALUES ($1, $2, 'ghost-ledger', 'approval_required', 'warn', $3::jsonb)
        `,
        [
          input.taskId,
          input.taskRunId,
          JSON.stringify({
            response_status: input.responseStatus,
            detail: "Ghost reported approval_required=true",
          }),
        ],
      );
    }

    if (input.artifactPath) {
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
          VALUES ($1, $2, 'ghost-ledger', 'artifact_recorded', 'ok', $3::jsonb)
        `,
        [
          input.taskId,
          input.taskRunId,
          JSON.stringify({
            artifact_path: input.artifactPath,
          }),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function failLedgerTask(taskId: string, taskRunId: string, errorMessage: string) {
  const pool = getPool("app");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const startedRow = await client.query<{ started_at: string }>(
      `SELECT started_at FROM task_runs WHERE id = $1`,
      [taskRunId],
    );
    const startedAt = startedRow.rows[0]?.started_at ? new Date(startedRow.rows[0].started_at) : new Date();
    const durationMs = Math.max(0, Date.now() - startedAt.getTime());

    await client.query(
      `
        UPDATE task_runs
        SET
          status = 'failed',
          error_text = $3,
          finished_at = NOW(),
          duration_ms = $4
        WHERE id = $1 AND task_id = $2
      `,
      [taskRunId, taskId, errorMessage, durationMs],
    );

    await client.query(
      `
        UPDATE tasks
        SET
          status = 'failed',
          current_phase = 'failed',
          error_summary = $3,
          updated_at = NOW(),
          completed_at = NOW()
        WHERE id = $1
      `,
      [taskId, taskRunId, errorMessage],
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
        VALUES ($1, $2, 'ghost-webhook', 'upstream_dispatch_failed', 'error', $3::jsonb)
      `,
      [taskId, taskRunId, JSON.stringify({ error: errorMessage })],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
