"use strict";

const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const {
  assertApprovalTransitionAllowed,
  loadPhase7Foundations,
  normalizeApprovalState,
} = require("./foundation-runtime");
const {
  ensureActionHistoryTable,
  loadJson,
  upsertActionRecord,
} = require("./action-record-runtime");

const projectRoot = path.join(__dirname, "..");
const foundations = loadPhase7Foundations(projectRoot);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      fail(`unknown argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      fail(`missing value for --${key}`);
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function runPsql(sql) {
  const postgresContainer = process.env.POSTGRES_CONTAINER || "ghost-postgres";
  const postgresUser = process.env.POSTGRES_USER || "ghost";
  const appDb = process.env.APP_DB || "ghost_app";
  const output = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      postgresContainer,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      postgresUser,
      "-d",
      appDb,
      "-At",
      "-P",
      "pager=off",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  return output.trim() || "[]";
}

function sqlString(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function deriveGovernedOutcomeStatus(state) {
  switch (state) {
    case "approved":
      return "allowed";
    case "rejected":
      return "denied";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    case "superseded":
      return "superseded";
    default:
      return "pending";
  }
}

function deriveGovernedTransition(governedOutcome) {
  switch (governedOutcome.resolution_state) {
    case "approved":
      return {
        transition_type: "approval.unblocked",
        retry_state: "allowed",
        governed_status: "allowed",
      };
    case "rejected":
      return {
        transition_type: "approval.denied",
        retry_state: "blocked",
        governed_status: "denied",
      };
    case "expired":
      return {
        transition_type: "approval.expired",
        retry_state: "requires_reissue",
        governed_status: "expired",
      };
    case "cancelled":
      return {
        transition_type: "approval.cancelled",
        retry_state: "cancelled",
        governed_status: "cancelled",
      };
    case "superseded":
      return {
        transition_type: "approval.superseded",
        retry_state: "requires_reissue",
        governed_status: "superseded",
      };
    default:
      return {
        transition_type: "approval.pending",
        retry_state: "blocked",
        governed_status: "pending",
      };
  }
}

function makeActionId(parts) {
  return crypto.createHash("md5").update(parts.join("|")).digest("hex").slice(0, 16);
}

function loadApprovalRow(approvalQueueId) {
  const sql = `SELECT COALESCE(row_to_json(selected), '{}'::json)::text
FROM (
  SELECT
    a.id::text AS approval_queue_id,
    a.status,
    a.approval_type,
    a.task_id::text AS task_id,
    a.prompt_text,
    a.response_text,
    a.requested_at::text AS requested_at,
    a.responded_at::text AS responded_at,
    a.responded_by_user_id::text AS responded_by_user_id,
    COALESCE(a.metadata, '{}'::jsonb) AS metadata
  FROM approvals a
  WHERE a.id::text = ${sqlString(approvalQueueId)}
) AS selected;`;
  return JSON.parse(runPsql(sql) || "{}");
}

function updateApprovalRow({
  approvalQueueId,
  nextState,
  responseText,
  resolvedBy,
  resolvedByUserId,
  governedOutcome,
  governedTransition,
}) {
  const sql = `WITH current_row AS (
  SELECT
    a.id,
    a.status,
    COALESCE(a.metadata, '{}'::jsonb) AS metadata
  FROM approvals a
  WHERE a.id::text = ${sqlString(approvalQueueId)}
  FOR UPDATE
),
updated AS (
  UPDATE approvals a
  SET
    status = ${sqlString(nextState)},
    response_text = ${sqlString(responseText)},
    responded_at = NOW(),
    responded_by_user_id = ${resolvedByUserId ? `${sqlString(resolvedByUserId)}::uuid` : "a.responded_by_user_id"},
    metadata = current_row.metadata
      || jsonb_build_object(
        'resolution', jsonb_build_object(
          'state', ${sqlString(nextState)},
          'response_text', ${sqlString(responseText)},
          'resolved_by', ${sqlString(resolvedBy)},
          'resolved_by_user_id', ${sqlString(resolvedByUserId || "")},
          'resolved_at', NOW()::text
        ),
        'governed_outcome', ${sqlString(JSON.stringify(governedOutcome))}::jsonb,
        'governed_transition', ${sqlString(JSON.stringify(governedTransition))}::jsonb
      )
  FROM current_row
  WHERE a.id = current_row.id
  RETURNING
    a.id::text AS approval_queue_id,
    a.status,
    a.response_text,
    a.responded_at::text AS responded_at,
    a.responded_by_user_id::text AS responded_by_user_id,
    a.metadata
)
SELECT COALESCE(row_to_json(updated), '{}'::json)::text
FROM updated;`;
  return JSON.parse(runPsql(sql) || "{}");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const approvalQueueId = String(args["approval-queue-id"] || "").trim();
  const outcome = normalizeApprovalState(foundations, args.outcome, "approval resolution outcome");
  const resolvedBy = String(args["resolved-by"] || "").trim();
  const resolvedByUserId = String(args["resolved-by-user-id"] || "").trim();
  const responseText = String(args["response-text"] || "").trim();

  if (!approvalQueueId || !outcome || !resolvedBy) {
    fail("required args: --approval-queue-id --outcome --resolved-by [--response-text ...] [--resolved-by-user-id ...]");
  }

  const current = loadApprovalRow(approvalQueueId);
  if (!current || !current.approval_queue_id) {
    fail(`approval queue item not found: ${approvalQueueId}`);
  }

  const fromState = normalizeApprovalState(foundations, current.status || "pending", "approval current state");
  const effectiveFromState = fromState === "proposed" ? "pending" : fromState;
  assertApprovalTransitionAllowed(foundations, effectiveFromState, outcome);

  const metadata = current.metadata && typeof current.metadata === "object" ? current.metadata : {};
  const governedOutcome = {
    approval_queue_id: approvalQueueId,
    resolution_state: outcome,
    outcome_status: deriveGovernedOutcomeStatus(outcome),
    source_path: metadata.source_path || null,
    conversation_id: metadata.conversation_id || null,
    delegation_id: metadata.delegation_id || null,
    orchestration_task_id: metadata.orchestration_task_id || null,
    runtime_task_id: metadata.runtime_task_id || current.task_id || null,
    runtime_task_run_id: metadata.runtime_task_run_id || null,
    n8n_execution_id: metadata.n8n_execution_id || null,
    response_mode: metadata.response_mode || null,
    parent_owner_label: metadata.parent_owner_label || null,
    governance_environment: metadata.governance_environment || metadata.approval_item?.environment || null,
    requested_capabilities: Array.isArray(metadata.requested_capabilities)
      ? metadata.requested_capabilities
      : Array.isArray(metadata.approval_item?.capabilities)
        ? metadata.approval_item.capabilities
        : [],
    resolved_by: resolvedBy,
    resolved_by_user_id: resolvedByUserId || null,
    resolved_at: new Date().toISOString(),
  };
  const governedTransition = {
    ...deriveGovernedTransition(governedOutcome),
    approval_queue_id: approvalQueueId,
    source_path: governedOutcome.source_path,
    conversation_id: governedOutcome.conversation_id,
    delegation_id: governedOutcome.delegation_id,
    runtime_task_id: governedOutcome.runtime_task_id,
    runtime_task_run_id: governedOutcome.runtime_task_run_id,
    orchestration_task_id: governedOutcome.orchestration_task_id,
    governance_environment: governedOutcome.governance_environment,
    requested_capabilities: governedOutcome.requested_capabilities,
    resolved_by: governedOutcome.resolved_by,
    resolved_by_user_id: governedOutcome.resolved_by_user_id,
    resolved_at: governedOutcome.resolved_at,
  };

  const updated = updateApprovalRow({
    approvalQueueId,
    nextState: outcome,
    responseText,
    resolvedBy,
    resolvedByUserId,
    governedOutcome,
    governedTransition,
  });

  ensureActionHistoryTable();
  const actionModel = loadJson("ops/foundation/action-model.json");
  const actionTypes = new Map(actionModel.event_types.map((entry) => [entry.id, entry]));
  const resolvedAt = updated.responded_at || governedOutcome.resolved_at;
  const resolvedSummary = current.metadata?.approval_item?.summary || current.prompt_text || "Approval resolved";
  const actionBase = {
    occurred_at: resolvedAt,
    conversation_id: metadata.conversation_id || "",
    request_id: approvalQueueId,
    delegation_id: metadata.delegation_id || null,
    runtime_task_id: metadata.runtime_task_id || current.task_id || null,
    approval_id: approvalQueueId,
    artifact_id: null,
    source_surface: "approvals",
  };
  for (const record of [
    {
      event_type: "approval.resolved",
      entity: actionTypes.get("approval.resolved")?.entity || "approval",
      outcome_status: updated.status,
      summary: resolvedSummary,
      payload: {
        approval_queue_id: approvalQueueId,
        resolution: updated.metadata?.resolution || null,
        governed_outcome: updated.metadata?.governed_outcome || null,
      },
    },
    {
      event_type: "governance.transitioned",
      entity: actionTypes.get("governance.transitioned")?.entity || "approval",
      outcome_status: governedTransition.governed_status,
      summary: resolvedSummary,
      payload: {
        approval_queue_id: approvalQueueId,
        governed_transition: updated.metadata?.governed_transition || governedTransition,
        governed_outcome: updated.metadata?.governed_outcome || null,
      },
    },
  ]) {
    upsertActionRecord({
      action_id: makeActionId([
        record.event_type,
        actionBase.conversation_id,
        actionBase.request_id,
        record.summary,
        actionBase.occurred_at,
      ]),
      ...actionBase,
      ...record,
    });
  }

  console.log(JSON.stringify({
    approval_queue_id: updated.approval_queue_id,
    previous_state: effectiveFromState,
    resolved_state: updated.status,
    responded_at: updated.responded_at,
    responded_by_user_id: updated.responded_by_user_id,
    response_text: updated.response_text,
    governed_outcome: updated.metadata?.governed_outcome || null,
    governed_transition: updated.metadata?.governed_transition || null,
    resolution: updated.metadata?.resolution || null,
  }, null, 2));
}

main();
