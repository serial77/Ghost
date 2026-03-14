"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");

function fail(message) {
  throw new Error(message);
}

function loadJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relPath), "utf8"));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      fail(`unknown argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function requirePositiveInt(value, flagName, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (!/^[0-9]+$/.test(String(value))) {
    fail(`${flagName} must be a positive integer`);
  }
  return Number(value);
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

function ensureActionHistoryTable() {
  runPsql(`CREATE TABLE IF NOT EXISTS ghost_action_history (
  action_id text PRIMARY KEY,
  event_type text NOT NULL,
  entity text NOT NULL,
  occurred_at timestamptz NOT NULL,
  conversation_id text NOT NULL,
  request_id text NOT NULL,
  delegation_id text,
  runtime_task_id text,
  approval_id text,
  artifact_id text,
  outcome_status text,
  summary text NOT NULL,
  source_surface text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);`);
}

function buildActionSql(recentHours, limit) {
  return `WITH raw_events AS (
  SELECT
    'request.received'::text AS event_type,
    m.created_at AS occurred_at,
    m.conversation_id::text AS conversation_id,
    m.id::text AS request_id,
    LEFT(REGEXP_REPLACE(COALESCE(m.content, ''), '\\s+', ' ', 'g'), 200) AS summary,
    NULL::text AS delegation_id,
    NULL::text AS runtime_task_id,
    NULL::text AS approval_id,
    NULL::text AS artifact_id,
    NULL::text AS outcome_status,
    'messages.user'::text AS source_surface,
    jsonb_build_object(
      'message_id', m.id::text,
      'role', m.role
    ) AS payload
  FROM messages m
  WHERE m.role = 'user'
    AND m.created_at >= NOW() - INTERVAL '${recentHours} hours'

  UNION ALL

  SELECT
    'delegation.created'::text AS event_type,
    d.created_at AS occurred_at,
    d.parent_conversation_id::text AS conversation_id,
    COALESCE(d.orchestration_task_id::text, d.id::text) AS request_id,
    LEFT(REGEXP_REPLACE(COALESCE(d.request_summary, 'Delegated work created'), '\\s+', ' ', 'g'), 200) AS summary,
    d.id::text AS delegation_id,
    d.runtime_task_id::text AS runtime_task_id,
    NULL::text AS approval_id,
    NULL::text AS artifact_id,
    d.status::text AS outcome_status,
    'conversation_delegations'::text AS source_surface,
    jsonb_build_object(
      'delegation_id', d.id::text,
      'orchestration_task_id', d.orchestration_task_id::text,
      'worker_provider', d.worker_provider,
      'worker_model', d.worker_model
    ) AS payload
  FROM conversation_delegations d
  WHERE d.created_at >= NOW() - INTERVAL '${recentHours} hours'

  UNION ALL

  SELECT
    'delegation.blocked'::text AS event_type,
    m.created_at AS occurred_at,
    m.conversation_id::text AS conversation_id,
    m.id::text AS request_id,
    LEFT(REGEXP_REPLACE(COALESCE(m.metadata -> 'approval_item' ->> 'summary', m.content, 'Delegated execution blocked'), '\\s+', ' ', 'g'), 200) AS summary,
    NULLIF(m.metadata ->> 'delegation_id', '') AS delegation_id,
    NULLIF(m.metadata ->> 'runtime_task_id', '') AS runtime_task_id,
    COALESCE(
      NULLIF(m.metadata -> 'approval_item' ->> 'queue_id', ''),
      NULLIF(m.metadata -> 'approval_item' ->> 'approval_id', ''),
      ''
    ) AS approval_id,
    NULL::text AS artifact_id,
    NULLIF(m.metadata ->> 'error_type', '') AS outcome_status,
    'messages.assistant'::text AS source_surface,
    jsonb_build_object(
      'message_id', m.id::text,
      'response_mode', m.metadata ->> 'response_mode',
      'approval_item', COALESCE(m.metadata -> 'approval_item', 'null'::jsonb),
      'approval_queue_id', NULLIF(m.metadata ->> 'approval_queue_id', '')
    ) AS payload
  FROM messages m
  WHERE m.role = 'assistant'
    AND m.created_at >= NOW() - INTERVAL '${recentHours} hours'
    AND COALESCE(m.metadata ->> 'response_mode', '') IN ('delegated_blocked', 'delegated_execution_unavailable')

  UNION ALL

  SELECT
    'approval.requested'::text AS event_type,
    a.requested_at AS occurred_at,
    COALESCE(a.metadata ->> 'conversation_id', '') AS conversation_id,
    a.id::text AS request_id,
    LEFT(REGEXP_REPLACE(COALESCE(a.metadata -> 'approval_item' ->> 'summary', a.prompt_text, 'Approval requested'), '\\s+', ' ', 'g'), 200) AS summary,
    COALESCE(a.metadata ->> 'delegation_id', '') AS delegation_id,
    COALESCE(a.metadata ->> 'runtime_task_id', a.task_id::text, '') AS runtime_task_id,
    a.id::text AS approval_id,
    NULL::text AS artifact_id,
    a.status::text AS outcome_status,
    'approvals'::text AS source_surface,
    jsonb_build_object(
      'approval_queue_id', a.id::text,
      'approval_type', a.approval_type,
      'task_id', a.task_id::text,
      'source_path', COALESCE(a.metadata ->> 'source_path', ''),
      'approval_item', COALESCE(a.metadata -> 'approval_item', 'null'::jsonb)
    ) AS payload
  FROM approvals a
  WHERE a.requested_at >= NOW() - INTERVAL '${recentHours} hours'

  UNION ALL

  SELECT
    'approval.resolved'::text AS event_type,
    COALESCE(a.responded_at, a.requested_at) AS occurred_at,
    COALESCE(a.metadata ->> 'conversation_id', '') AS conversation_id,
    a.id::text AS request_id,
    LEFT(REGEXP_REPLACE(COALESCE(a.metadata -> 'approval_item' ->> 'summary', a.prompt_text, 'Approval resolved'), '\\s+', ' ', 'g'), 200) AS summary,
    COALESCE(a.metadata ->> 'delegation_id', '') AS delegation_id,
    COALESCE(a.metadata ->> 'runtime_task_id', a.task_id::text, '') AS runtime_task_id,
    a.id::text AS approval_id,
    NULL::text AS artifact_id,
    a.status::text AS outcome_status,
    'approvals'::text AS source_surface,
    jsonb_build_object(
      'approval_queue_id', a.id::text,
      'approval_type', a.approval_type,
      'responded_at', a.responded_at,
      'response_text', a.response_text
    ) AS payload
  FROM approvals a
  WHERE COALESCE(a.responded_at, a.requested_at) >= NOW() - INTERVAL '${recentHours} hours'
    AND a.status IN ('approved', 'rejected', 'expired', 'cancelled', 'superseded')

  UNION ALL

  SELECT
    'runtime.completed'::text AS event_type,
    COALESCE(tr.finished_at, t.completed_at, t.updated_at, tr.started_at) AS occurred_at,
    COALESCE(t.conversation_id::text, t.context ->> 'parent_conversation_id', '') AS conversation_id,
    tr.id::text AS request_id,
    LEFT(REGEXP_REPLACE(COALESCE(t.title, t.task_type, 'Runtime completed'), '\\s+', ' ', 'g'), 200) AS summary,
    NULL::text AS delegation_id,
    t.id::text AS runtime_task_id,
    NULL::text AS approval_id,
    NULLIF(tr.output_payload ->> 'artifact_path', '') AS artifact_id,
    COALESCE(NULLIF(tr.output_payload ->> 'codex_command_status', ''), tr.status::text, t.status::text) AS outcome_status,
    'task_runs'::text AS source_surface,
    jsonb_build_object(
      'task_id', t.id::text,
      'task_run_id', tr.id::text,
      'output_payload', COALESCE(tr.output_payload, '{}'::jsonb)
    ) AS payload
  FROM task_runs tr
  JOIN tasks t ON t.id = tr.task_id
  WHERE COALESCE(tr.finished_at, t.completed_at, t.updated_at, tr.started_at) >= NOW() - INTERVAL '${recentHours} hours'
    AND COALESCE(tr.status, '') IN ('succeeded', 'failed')

  UNION ALL

  SELECT
    'outcome.recorded'::text AS event_type,
    m.created_at AS occurred_at,
    m.conversation_id::text AS conversation_id,
    m.id::text AS request_id,
    LEFT(REGEXP_REPLACE(COALESCE(m.content, 'Outcome recorded'), '\\s+', ' ', 'g'), 200) AS summary,
    NULLIF(m.metadata ->> 'delegation_id', '') AS delegation_id,
    NULLIF(m.metadata ->> 'runtime_task_id', '') AS runtime_task_id,
    COALESCE(
      NULLIF(m.metadata ->> 'approval_queue_id', ''),
      NULLIF(m.metadata -> 'approval_item' ->> 'queue_id', ''),
      NULLIF(m.metadata -> 'approval_item' ->> 'approval_id', ''),
      ''
    ) AS approval_id,
    NULLIF(m.metadata ->> 'artifact_path', '') AS artifact_id,
    COALESCE(NULLIF(m.metadata ->> 'codex_command_status', ''), NULLIF(m.metadata ->> 'error_type', ''), 'recorded') AS outcome_status,
    'messages.assistant'::text AS source_surface,
    jsonb_build_object(
      'message_id', m.id::text,
      'response_mode', m.metadata ->> 'response_mode',
      'provider_used', m.metadata ->> 'provider_used'
    ) AS payload
  FROM messages m
  WHERE m.role = 'assistant'
    AND m.created_at >= NOW() - INTERVAL '${recentHours} hours'
    AND COALESCE(m.metadata ->> 'response_mode', '') <> ''
)
SELECT COALESCE(JSON_AGG(row_to_json(selected) ORDER BY selected.occurred_at DESC), '[]'::json)
FROM (
  SELECT *
  FROM raw_events
  WHERE COALESCE(conversation_id, '') <> ''
    AND COALESCE(request_id, '') <> ''
    AND COALESCE(summary, '') <> ''
  ORDER BY occurred_at DESC
  LIMIT ${limit}
) AS selected;`;
}

function materializeActionRecords({ recentHours, limit }) {
  const actionModel = loadJson("ops/foundation/action-model.json");
  const actionTypes = new Map(actionModel.event_types.map((entry) => [entry.id, entry]));
  const raw = JSON.parse(runPsql(buildActionSql(recentHours, limit)));

  return raw.map((row) => {
    const actionType = actionTypes.get(row.event_type);
    if (!actionType) {
      fail(`query returned unknown action event type: ${row.event_type}`);
    }
    return {
      action_id: crypto.createHash("md5")
        .update([
          row.event_type,
          row.conversation_id,
          row.request_id,
          row.summary,
          row.occurred_at,
        ].join("|"))
        .digest("hex")
        .slice(0, 16),
      event_type: row.event_type,
      entity: actionType.entity,
      occurred_at: row.occurred_at,
      conversation_id: row.conversation_id,
      request_id: row.request_id,
      delegation_id: row.delegation_id || null,
      runtime_task_id: row.runtime_task_id || null,
      approval_id: row.approval_id || null,
      artifact_id: row.artifact_id || null,
      outcome_status: row.outcome_status || null,
      summary: row.summary,
      source_surface: row.source_surface,
      payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    };
  });
}

module.exports = {
  buildActionSql,
  fail,
  loadJson,
  materializeActionRecords,
  parseArgs,
  projectRoot,
  requirePositiveInt,
  ensureActionHistoryTable,
  runPsql,
};
