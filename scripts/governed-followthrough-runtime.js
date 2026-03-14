"use strict";

const crypto = require("crypto");
const path = require("path");
const { execFileSync } = require("child_process");
const { loadPhase7Foundations } = require("./foundation-runtime");

const projectRoot = path.join(__dirname, "..");
const foundations = loadPhase7Foundations(projectRoot);

function fail(message) {
  throw new Error(message);
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

function sqlJson(value) {
  return `'${JSON.stringify(value || {}).replace(/'/g, "''")}'::jsonb`;
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

function ensureGovernedFollowthroughTable() {
  runPsql(`CREATE TABLE IF NOT EXISTS ghost_governed_followthrough (
  followthrough_id text PRIMARY KEY,
  approval_queue_id text NOT NULL,
  source_path text,
  conversation_id text,
  delegation_id text,
  orchestration_task_id text,
  runtime_task_id text,
  runtime_task_run_id text,
  n8n_execution_id text,
  governance_environment text,
  resolution_state text NOT NULL,
  outcome_status text NOT NULL,
  followthrough_type text NOT NULL,
  execution_state text NOT NULL,
  worker_registry_id text,
  worker_label text,
  worker_operator_identity text,
  close_reason text,
  executor_label text NOT NULL,
  requested_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_step_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  executed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ghost_governed_followthrough_approval_queue_idx
  ON ghost_governed_followthrough (approval_queue_id);
ALTER TABLE ghost_governed_followthrough ADD COLUMN IF NOT EXISTS worker_registry_id text;
ALTER TABLE ghost_governed_followthrough ADD COLUMN IF NOT EXISTS worker_label text;
ALTER TABLE ghost_governed_followthrough ADD COLUMN IF NOT EXISTS worker_operator_identity text;`);
}

function lookupWorker(workerId) {
  const workers = Array.isArray(foundations?.workers?.workers) ? foundations.workers.workers : [];
  return workers.find((entry) => entry.id === workerId) || null;
}

function makeFollowthroughId(approvalQueueId) {
  return crypto.createHash("md5").update(`followthrough|${approvalQueueId}`).digest("hex").slice(0, 16);
}

function loadApprovalForFollowthrough(approvalQueueId) {
  const sql = `SELECT COALESCE(row_to_json(selected), '{}'::json)::text
FROM (
  SELECT
    a.id::text AS approval_queue_id,
    a.status,
    a.response_text,
    a.responded_at::text AS responded_at,
    COALESCE(a.metadata, '{}'::jsonb) AS metadata
  FROM approvals a
  WHERE a.id::text = ${sqlString(approvalQueueId)}
) AS selected;`;
  return JSON.parse(runPsql(sql) || "{}");
}

function deriveFollowthroughPlan(approvalRow) {
  const metadata = approvalRow.metadata && typeof approvalRow.metadata === "object" ? approvalRow.metadata : {};
  const sourcePath = String(metadata.source_path || "").trim();
  const resolutionState = String(approvalRow.status || "").trim();
  const requestedCapabilities = Array.isArray(metadata.requested_capabilities)
    ? metadata.requested_capabilities
    : Array.isArray(metadata.approval_item?.capabilities)
      ? metadata.approval_item.capabilities
      : [];
  const base = {
    source_path: sourcePath || null,
    conversation_id: metadata.conversation_id || null,
    delegation_id: metadata.delegation_id || null,
    orchestration_task_id: metadata.orchestration_task_id || null,
    runtime_task_id: metadata.runtime_task_id || null,
    runtime_task_run_id: metadata.runtime_task_run_id || null,
    n8n_execution_id: metadata.n8n_execution_id || null,
    governance_environment: metadata.governance_environment || metadata.approval_item?.environment || null,
    requested_capabilities: requestedCapabilities,
  };
  const workerRegistryId = (() => {
    if (sourcePath.startsWith("delegated_")) {
      return metadata.worker_registry_id || metadata.approval_item?.target_worker_id || "forge";
    }
    return metadata.worker_registry_id || metadata.approval_item?.target_worker_id || "ghost_main";
  })();
  const worker = lookupWorker(workerRegistryId);
  const workerFields = {
    worker_registry_id: worker?.id || workerRegistryId || null,
    worker_label: worker?.visibility_label || metadata.worker_agent_label || null,
    worker_operator_identity: worker?.operator_identity || null,
  };

  if (resolutionState === "approved") {
    if (sourcePath === "direct_approval_required") {
      return {
        ...base,
        ...workerFields,
        outcome_status: "allowed",
        followthrough_type: "direct_codex_retry",
        execution_state: "retry_enqueued",
        close_reason: null,
        next_step_payload: {
          next_step: "direct_codex_retry",
          retry_scope: "direct_path",
          approval_queue_id: approvalRow.approval_queue_id,
          conversation_id: base.conversation_id,
          runtime_task_id: base.runtime_task_id,
          runtime_task_run_id: base.runtime_task_run_id,
          n8n_execution_id: base.n8n_execution_id,
          requested_capabilities: requestedCapabilities,
        },
      };
    }
    if (sourcePath === "delegated_blocked") {
      return {
        ...base,
        ...workerFields,
        outcome_status: "allowed",
        followthrough_type: "delegated_worker_retry",
        execution_state: "retry_enqueued",
        close_reason: null,
        next_step_payload: {
          next_step: "delegated_worker_retry",
          retry_scope: "delegated_path",
          approval_queue_id: approvalRow.approval_queue_id,
          conversation_id: base.conversation_id,
          delegation_id: base.delegation_id,
          orchestration_task_id: base.orchestration_task_id,
          runtime_task_id: base.runtime_task_id,
          requested_capabilities: requestedCapabilities,
        },
      };
    }
    if (sourcePath === "direct_environment_restricted" || sourcePath === "delegated_environment_restricted") {
      return {
        ...base,
        ...workerFields,
        outcome_status: "allowed",
        followthrough_type: "environment_restriction_closure",
        execution_state: "closed_without_retry",
        close_reason: "environment_restricted",
        next_step_payload: {
          next_step: "none",
          closure_reason: "environment_restricted",
          approval_queue_id: approvalRow.approval_queue_id,
        },
      };
    }
  }

  return {
    ...base,
    ...workerFields,
    outcome_status: resolutionState === "rejected" ? "denied" : resolutionState || "closed",
    followthrough_type: "closed_without_retry",
    execution_state: "closed_without_retry",
    close_reason: resolutionState || "closed",
    next_step_payload: {
      next_step: "none",
      closure_reason: resolutionState || "closed",
      approval_queue_id: approvalRow.approval_queue_id,
    },
  };
}

function upsertFollowthrough({
  approvalQueueId,
  executorLabel,
  plan,
}) {
  const followthroughId = makeFollowthroughId(approvalQueueId);
  const sql = `WITH upserted AS (
INSERT INTO ghost_governed_followthrough (
  followthrough_id,
  approval_queue_id,
  source_path,
  conversation_id,
  delegation_id,
  orchestration_task_id,
  runtime_task_id,
  runtime_task_run_id,
  n8n_execution_id,
  governance_environment,
  resolution_state,
  outcome_status,
  followthrough_type,
  execution_state,
  worker_registry_id,
  worker_label,
  worker_operator_identity,
  close_reason,
  executor_label,
  requested_capabilities,
  next_step_payload,
  executed_at
) VALUES (
  ${sqlString(followthroughId)},
  ${sqlString(approvalQueueId)},
  ${sqlString(plan.source_path)},
  ${sqlString(plan.conversation_id)},
  ${sqlString(plan.delegation_id)},
  ${sqlString(plan.orchestration_task_id)},
  ${sqlString(plan.runtime_task_id)},
  ${sqlString(plan.runtime_task_run_id)},
  ${sqlString(plan.n8n_execution_id)},
  ${sqlString(plan.governance_environment)},
  ${sqlString(plan.resolution_state)},
  ${sqlString(plan.outcome_status)},
  ${sqlString(plan.followthrough_type)},
  ${sqlString(plan.execution_state)},
  ${sqlString(plan.worker_registry_id)},
  ${sqlString(plan.worker_label)},
  ${sqlString(plan.worker_operator_identity)},
  ${sqlString(plan.close_reason)},
  ${sqlString(executorLabel)},
  ${sqlJson(plan.requested_capabilities)},
  ${sqlJson(plan.next_step_payload)},
  NOW()
)
ON CONFLICT (approval_queue_id) DO UPDATE SET
  source_path = EXCLUDED.source_path,
  conversation_id = EXCLUDED.conversation_id,
  delegation_id = EXCLUDED.delegation_id,
  orchestration_task_id = EXCLUDED.orchestration_task_id,
  runtime_task_id = EXCLUDED.runtime_task_id,
  runtime_task_run_id = EXCLUDED.runtime_task_run_id,
  n8n_execution_id = EXCLUDED.n8n_execution_id,
  governance_environment = EXCLUDED.governance_environment,
  resolution_state = EXCLUDED.resolution_state,
  outcome_status = EXCLUDED.outcome_status,
  followthrough_type = EXCLUDED.followthrough_type,
  execution_state = EXCLUDED.execution_state,
  worker_registry_id = EXCLUDED.worker_registry_id,
  worker_label = EXCLUDED.worker_label,
  worker_operator_identity = EXCLUDED.worker_operator_identity,
  close_reason = EXCLUDED.close_reason,
  executor_label = EXCLUDED.executor_label,
  requested_capabilities = EXCLUDED.requested_capabilities,
  next_step_payload = EXCLUDED.next_step_payload,
  executed_at = NOW(),
  updated_at = NOW()
RETURNING *
)
SELECT COALESCE(row_to_json(upserted), '{}'::json)::text
FROM upserted;`;
  return JSON.parse(runPsql(sql) || "{}");
}

module.exports = {
  ensureGovernedFollowthroughTable,
  fail,
  loadApprovalForFollowthrough,
  makeFollowthroughId,
  parseArgs,
  runPsql,
  sqlJson,
  sqlString,
  deriveFollowthroughPlan,
  lookupWorker,
  upsertFollowthrough,
};
