"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const defaultRecentHours = 24;
const defaultLimit = 40;

function fail(message) {
  console.error(message);
  process.exit(1);
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

function buildSql(recentHours, limit) {
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
    'messages.user'::text AS source_surface
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
    'conversation_delegations'::text AS source_surface
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
    NULLIF(m.metadata -> 'approval_item' ->> 'approval_id', '') AS approval_id,
    NULL::text AS artifact_id,
    NULLIF(m.metadata ->> 'error_type', '') AS outcome_status,
    'messages.assistant'::text AS source_surface
  FROM messages m
  WHERE m.role = 'assistant'
    AND m.created_at >= NOW() - INTERVAL '${recentHours} hours'
    AND COALESCE(m.metadata ->> 'response_mode', '') IN ('delegated_blocked', 'delegated_execution_unavailable')

  UNION ALL

  SELECT
    'approval.requested'::text AS event_type,
    m.created_at AS occurred_at,
    m.conversation_id::text AS conversation_id,
    m.id::text AS request_id,
    LEFT(REGEXP_REPLACE(COALESCE(m.metadata -> 'approval_item' ->> 'summary', m.content, 'Approval requested'), '\\s+', ' ', 'g'), 200) AS summary,
    NULLIF(m.metadata ->> 'delegation_id', '') AS delegation_id,
    NULLIF(m.metadata ->> 'runtime_task_id', '') AS runtime_task_id,
    NULLIF(m.metadata -> 'approval_item' ->> 'approval_id', '') AS approval_id,
    NULL::text AS artifact_id,
    COALESCE(NULLIF(m.metadata -> 'approval_item' ->> 'state', ''), 'proposed') AS outcome_status,
    'messages.assistant'::text AS source_surface
  FROM messages m
  WHERE m.role = 'assistant'
    AND m.created_at >= NOW() - INTERVAL '${recentHours} hours'
    AND m.metadata ? 'approval_item'

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
    'task_runs'::text AS source_surface
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
    NULLIF(m.metadata -> 'approval_item' ->> 'approval_id', '') AS approval_id,
    NULLIF(m.metadata ->> 'artifact_path', '') AS artifact_id,
    COALESCE(NULLIF(m.metadata ->> 'codex_command_status', ''), NULLIF(m.metadata ->> 'error_type', ''), 'recorded') AS outcome_status,
    'messages.assistant'::text AS source_surface
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const recentHours = requirePositiveInt(args["recent-hours"], "--recent-hours", defaultRecentHours);
  const limit = requirePositiveInt(args.limit, "--limit", defaultLimit);
  const actionModel = loadJson("ops/foundation/action-model.json");
  const actionTypes = new Map(actionModel.event_types.map((entry) => [entry.id, entry]));
  const raw = JSON.parse(runPsql(buildSql(recentHours, limit)));

  const records = raw.map((row) => {
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
    };
  });

  console.log(JSON.stringify({
    recent_hours: recentHours,
    limit,
    record_count: records.length,
    records,
  }, null, 2));
}

main();
