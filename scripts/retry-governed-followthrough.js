"use strict";

const http = require("http");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const {
  ensureGovernedFollowthroughTable,
  fail,
  parseArgs,
  runPsql,
  sqlJson,
  sqlString,
} = require("./governed-followthrough-runtime");
const { ensureActionHistoryTable, upsertActionRecord } = require("./action-record-runtime");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActionId(parts) {
  return crypto.createHash("md5").update(parts.join("|")).digest("hex").slice(0, 16);
}

function loadFollowthroughByApprovalQueueId(approvalQueueId) {
  const sql = `SELECT COALESCE(row_to_json(ft), '{}'::json)::text
FROM (
  SELECT *
  FROM ghost_governed_followthrough
  WHERE approval_queue_id = ${sqlString(approvalQueueId)}
  LIMIT 1
) AS ft;`;
  return JSON.parse(runPsql(sql) || "{}");
}

function loadApprovalRow(approvalQueueId) {
  const sql = `SELECT COALESCE(row_to_json(a), '{}'::json)::text
FROM (
  SELECT
    id::text AS approval_queue_id,
    status,
    prompt_text,
    response_text,
    COALESCE(metadata, '{}'::jsonb) AS metadata
  FROM approvals
  WHERE id::text = ${sqlString(approvalQueueId)}
  LIMIT 1
) AS a;`;
  return JSON.parse(runPsql(sql) || "{}");
}

function updateFollowthroughRetryState({
  approvalQueueId,
  executionState,
  retryPayload,
}) {
  const sql = `UPDATE ghost_governed_followthrough
SET
  execution_state = ${sqlString(executionState)},
  next_step_payload = next_step_payload || ${sqlJson(retryPayload)},
  retry_dispatched_at = CASE WHEN ${sqlString(executionState)} = 'retry_dispatched' THEN NOW() ELSE retry_dispatched_at END,
  updated_at = NOW()
WHERE approval_queue_id = ${sqlString(approvalQueueId)}
RETURNING execution_state, approval_queue_id;`;
  const result = runPsql(sql);
  return result && result !== "[]" ? result.trim() : null;
}

function addRetryDispatchedAtColumn() {
  runPsql(`ALTER TABLE ghost_governed_followthrough
ADD COLUMN IF NOT EXISTS retry_dispatched_at timestamptz;`);
}

// ---------------------------------------------------------------------------
// Webhook dispatch
// ---------------------------------------------------------------------------

function buildRetryMessage(followthroughRow, approvalRow) {
  const responseText = String(approvalRow.response_text || "").trim();
  const summary = approvalRow.metadata?.approval_item?.summary
    || String(approvalRow.prompt_text || "").trim();

  if (responseText) {
    return `Approval granted: ${responseText}. Please proceed with the previously requested action.`;
  }
  if (summary) {
    return `Approval granted. Please proceed with: ${summary}`;
  }
  return "Approval granted. Please proceed with the previously requested action.";
}

function postWebhook({ webhookUrl, conversationId, message, approvalQueueId, followthroughId }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      conversation_id: conversationId,
      message,
      entrypoint: "approval_retry",
      approval_queue_id: approvalQueueId,
      followthrough_id: followthroughId,
    });

    const parsedUrl = new URL(webhookUrl);
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ""),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Ghost-Entry-Point": "approval_retry",
      },
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`webhook returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (_err) {
          // Non-JSON response is acceptable; surface raw
          resolve({ raw_response: data.slice(0, 500) });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("webhook request timed out after 30s"));
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Action history
// ---------------------------------------------------------------------------

function recordRetryAction({ followthroughRow, executionState, retryPayload, errorMessage }) {
  const approvalQueueId = followthroughRow.approval_queue_id;
  const occurredAt = new Date().toISOString();
  const eventType = executionState === "retry_dispatched"
    ? "governance.retry_dispatched"
    : "governance.retry_failed";
  const summary = executionState === "retry_dispatched"
    ? `Retry dispatched for approved follow-through ${followthroughRow.followthrough_id}`
    : `Retry dispatch failed for follow-through ${followthroughRow.followthrough_id}: ${errorMessage || "unknown error"}`;

  upsertActionRecord({
    action_id: makeActionId([eventType, approvalQueueId, occurredAt]),
    event_type: eventType,
    entity: "approval",
    occurred_at: occurredAt,
    conversation_id: followthroughRow.conversation_id || "",
    request_id: approvalQueueId,
    delegation_id: followthroughRow.delegation_id || null,
    runtime_task_id: followthroughRow.runtime_task_id || null,
    approval_id: approvalQueueId,
    artifact_id: null,
    source_surface: "ghost_governed_followthrough",
    outcome_status: executionState === "retry_dispatched" ? "dispatched" : "failed",
    summary,
    payload: retryPayload || { error: errorMessage || "unknown error" },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const approvalQueueId = String(args["approval-queue-id"] || "").trim();
  const dryRun = args["dry-run"] === "true";
  const webhookUrl = process.env.WEBHOOK_URL
    || `${process.env.N8N_BASE_URL || "http://127.0.0.1:5678"}/webhook/${process.env.WEBHOOK_PATH || "ghost-runtime"}`;

  if (!approvalQueueId) {
    fail("required arg: --approval-queue-id [--dry-run true]");
  }

  addRetryDispatchedAtColumn();
  ensureGovernedFollowthroughTable();
  ensureActionHistoryTable();

  const followthroughRow = loadFollowthroughByApprovalQueueId(approvalQueueId);
  if (!followthroughRow.approval_queue_id) {
    fail(`no follow-through record found for approval_queue_id: ${approvalQueueId}`);
  }
  if (followthroughRow.execution_state !== "retry_enqueued") {
    fail(`follow-through is not in retry_enqueued state: ${followthroughRow.execution_state} (approval_queue_id=${approvalQueueId})`);
  }
  if (followthroughRow.outcome_status !== "allowed") {
    fail(`follow-through outcome_status is not allowed: ${followthroughRow.outcome_status}`);
  }

  const conversationId = followthroughRow.conversation_id;
  if (!conversationId) {
    fail(`follow-through has no conversation_id — cannot dispatch retry (approval_queue_id=${approvalQueueId})`);
  }

  const approvalRow = loadApprovalRow(approvalQueueId);
  const message = buildRetryMessage(followthroughRow, approvalRow);

  if (dryRun) {
    const dryRunResult = {
      dry_run: true,
      approval_queue_id: approvalQueueId,
      followthrough_id: followthroughRow.followthrough_id,
      execution_state: followthroughRow.execution_state,
      conversation_id: conversationId,
      webhook_url: webhookUrl,
      retry_message: message,
      followthrough_type: followthroughRow.followthrough_type,
    };
    console.log(JSON.stringify(dryRunResult, null, 2));
    return;
  }

  let webhookResponse;
  try {
    webhookResponse = await postWebhook({
      webhookUrl,
      conversationId,
      message,
      approvalQueueId,
      followthroughId: followthroughRow.followthrough_id,
    });
  } catch (dispatchError) {
    // Record failure durably before surfacing
    const failPayload = {
      retry_error: dispatchError.message,
      retry_attempted_at: new Date().toISOString(),
      webhook_url: webhookUrl,
      conversation_id: conversationId,
    };
    updateFollowthroughRetryState({
      approvalQueueId,
      executionState: "retry_failed",
      retryPayload: failPayload,
    });
    recordRetryAction({
      followthroughRow,
      executionState: "retry_failed",
      retryPayload: failPayload,
      errorMessage: dispatchError.message,
    });
    fail(`retry dispatch failed: ${dispatchError.message}`);
  }

  const retryNow = new Date().toISOString();
  const retryPayload = {
    retry_dispatched_at: retryNow,
    retry_n8n_execution_id: webhookResponse.n8n_execution_id || null,
    retry_reply_summary: typeof webhookResponse.reply === "string"
      ? webhookResponse.reply.slice(0, 500)
      : null,
    retry_conversation_id: webhookResponse.conversation_id || conversationId,
    retry_approval_required: webhookResponse.approval_required === true,
    webhook_url: webhookUrl,
    entrypoint: "approval_retry",
  };

  updateFollowthroughRetryState({
    approvalQueueId,
    executionState: "retry_dispatched",
    retryPayload,
  });

  recordRetryAction({
    followthroughRow,
    executionState: "retry_dispatched",
    retryPayload,
  });

  console.log(JSON.stringify({
    approval_queue_id: approvalQueueId,
    followthrough_id: followthroughRow.followthrough_id,
    followthrough_type: followthroughRow.followthrough_type,
    previous_execution_state: "retry_enqueued",
    execution_state: "retry_dispatched",
    conversation_id: conversationId,
    retry_n8n_execution_id: retryPayload.retry_n8n_execution_id,
    retry_reply_summary: retryPayload.retry_reply_summary,
    retry_dispatched_at: retryNow,
    retry_approval_required: retryPayload.retry_approval_required,
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
