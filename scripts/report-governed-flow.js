"use strict";

const { execFileSync } = require("child_process");

const defaultRecentHours = 72;
const defaultLimit = 10;

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

function requirePositiveInt(value, flagName, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (!/^[0-9]+$/.test(String(value))) {
    fail(`${flagName} must be a positive integer`);
  }
  return Number(value);
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
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

function buildSql({ recentHours, limit, approvalQueueId, conversationId, delegationId, runtimeTaskId }) {
  const filters = [`a.requested_at >= NOW() - INTERVAL '${recentHours} hours'`];
  if (approvalQueueId) {
    filters.push(`a.id::text = ${sqlLiteral(approvalQueueId)}`);
  }
  if (conversationId) {
    filters.push(`COALESCE(a.metadata ->> 'conversation_id', '') = ${sqlLiteral(conversationId)}`);
  }
  if (delegationId) {
    filters.push(`COALESCE(a.metadata ->> 'delegation_id', '') = ${sqlLiteral(delegationId)}`);
  }
  if (runtimeTaskId) {
    filters.push(`COALESCE(a.metadata ->> 'runtime_task_id', a.task_id::text, '') = ${sqlLiteral(runtimeTaskId)}`);
  }
  return `SELECT COALESCE(JSON_AGG(row_to_json(selected) ORDER BY selected.requested_at DESC), '[]'::json)
FROM (
  SELECT
    a.id::text AS approval_queue_id,
    a.status,
    a.approval_type,
    a.requested_at::text AS requested_at,
    a.responded_at::text AS responded_at,
    a.prompt_text AS summary,
    COALESCE(a.response_text, '') AS response_text,
    COALESCE(a.metadata ->> 'source_path', '') AS source_path,
    COALESCE(a.metadata ->> 'conversation_id', '') AS conversation_id,
    COALESCE(a.metadata ->> 'delegation_id', '') AS delegation_id,
    COALESCE(a.metadata ->> 'orchestration_task_id', '') AS orchestration_task_id,
    COALESCE(a.metadata ->> 'runtime_task_id', a.task_id::text, '') AS runtime_task_id,
    COALESCE(a.metadata ->> 'runtime_task_run_id', '') AS runtime_task_run_id,
    COALESCE(a.metadata ->> 'n8n_execution_id', '') AS n8n_execution_id,
    COALESCE(a.metadata ->> 'governance_environment', a.metadata -> 'approval_item' ->> 'environment', '') AS governance_environment,
    COALESCE(a.metadata -> 'approval_item', '{}'::jsonb) AS approval_item,
    COALESCE(a.metadata -> 'governance_policy', '{}'::jsonb) AS governance_policy,
    COALESCE(a.metadata -> 'governed_outcome', '{}'::jsonb) AS governed_outcome,
    COALESCE(a.metadata -> 'governed_transition', '{}'::jsonb) AS governed_transition,
    COALESCE(a.metadata -> 'followthrough', '{}'::jsonb) AS approval_followthrough,
    COALESCE(gf.followthrough_id, '') AS followthrough_id,
    COALESCE(gf.followthrough_type, '') AS followthrough_type,
    COALESCE(gf.execution_state, '') AS followthrough_execution_state,
    COALESCE(gf.outcome_status, '') AS followthrough_outcome_status,
    COALESCE(gf.close_reason, '') AS followthrough_close_reason,
    COALESCE(gf.executor_label, '') AS followthrough_executor_label,
    COALESCE(gf.requested_capabilities, '[]'::jsonb) AS followthrough_requested_capabilities,
    COALESCE(gf.next_step_payload, '{}'::jsonb) AS followthrough_next_step_payload,
    COALESCE((
      SELECT JSON_AGG(row_to_json(action_rows) ORDER BY action_rows.occurred_at ASC, action_rows.action_id ASC)
      FROM (
        SELECT
          ah.action_id,
          ah.event_type,
          ah.entity,
          ah.occurred_at::text AS occurred_at,
          ah.conversation_id,
          ah.request_id,
          ah.delegation_id,
          ah.runtime_task_id,
          ah.approval_id,
          ah.outcome_status,
          ah.summary,
          ah.source_surface,
          ah.payload
        FROM ghost_action_history ah
        WHERE ah.approval_id = a.id::text
        ORDER BY ah.occurred_at ASC, ah.action_id ASC
      ) AS action_rows
    ), '[]'::json) AS action_history,
    COALESCE((
      SELECT row_to_json(delegation_row)
      FROM (
        SELECT
          d.id::text AS delegation_id,
          d.status,
          d.parent_conversation_id::text AS parent_conversation_id,
          d.runtime_task_id::text AS runtime_task_id,
          d.orchestration_task_id::text AS orchestration_task_id,
          d.worker_provider,
          d.worker_model,
          d.created_at::text AS created_at,
          d.updated_at::text AS updated_at,
          d.completed_at::text AS completed_at
        FROM conversation_delegations d
        WHERE d.id::text = COALESCE(a.metadata ->> 'delegation_id', '')
      ) AS delegation_row
    ), '{}'::json) AS delegation,
    COALESCE((
      SELECT row_to_json(task_row)
      FROM (
        SELECT
          t.id::text AS task_id,
          t.task_type,
          t.title,
          t.status,
          t.source,
          t.created_at::text AS created_at,
          t.updated_at::text AS updated_at,
          t.completed_at::text AS completed_at,
          COALESCE((
            SELECT row_to_json(task_run_row)
            FROM (
              SELECT
                tr.id::text AS task_run_id,
                tr.status,
                tr.started_at::text AS started_at,
                tr.finished_at::text AS finished_at,
                tr.output_payload
              FROM task_runs tr
              WHERE tr.task_id = t.id
              ORDER BY COALESCE(tr.finished_at, tr.started_at) DESC, tr.id DESC
              LIMIT 1
            ) AS task_run_row
          ), '{}'::json) AS latest_task_run
        FROM tasks t
        WHERE t.id::text = COALESCE(a.metadata ->> 'runtime_task_id', a.task_id::text, '')
      ) AS task_row
    ), '{}'::json) AS runtime_task
  FROM approvals a
  LEFT JOIN ghost_governed_followthrough gf ON gf.approval_queue_id = a.id::text
  WHERE ${filters.join("\n    AND ")}
  ORDER BY a.requested_at DESC, a.id DESC
  LIMIT ${limit}
) AS selected;`;
}

function summarize(records) {
  return records.map((record) => ({
    approval_queue_id: record.approval_queue_id,
    status: record.status,
    source_path: record.source_path || null,
    conversation_id: record.conversation_id || null,
    delegation_id: record.delegation_id || null,
    orchestration_task_id: record.orchestration_task_id || null,
    runtime_task_id: record.runtime_task_id || null,
    runtime_task_run_id: record.runtime_task_run_id || null,
    n8n_execution_id: record.n8n_execution_id || null,
    governance_environment: record.governance_environment || null,
    followthrough_id: record.followthrough_id || null,
    followthrough_execution_state: record.followthrough_execution_state || null,
    action_count: Array.isArray(record.action_history) ? record.action_history.length : 0,
    trace_complete: Boolean(
      record.approval_queue_id
        && ((Array.isArray(record.action_history) && record.action_history.length > 0) || record.followthrough_id)
    ),
  }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const recentHours = requirePositiveInt(args["recent-hours"], "--recent-hours", defaultRecentHours);
  const limit = requirePositiveInt(args.limit, "--limit", defaultLimit);
  const approvalQueueId = args["approval-queue-id"] ? String(args["approval-queue-id"]).trim() : "";
  const conversationId = args["conversation-id"] ? String(args["conversation-id"]).trim() : "";
  const delegationId = args["delegation-id"] ? String(args["delegation-id"]).trim() : "";
  const runtimeTaskId = args["runtime-task-id"] ? String(args["runtime-task-id"]).trim() : "";
  const records = JSON.parse(runPsql(buildSql({
    recentHours,
    limit,
    approvalQueueId,
    conversationId,
    delegationId,
    runtimeTaskId,
  })));
  console.log(JSON.stringify({
    recent_hours: recentHours,
    limit,
    filters: {
      approval_queue_id: approvalQueueId || null,
      conversation_id: conversationId || null,
      delegation_id: delegationId || null,
      runtime_task_id: runtimeTaskId || null,
    },
    record_count: records.length,
    traces: records,
    summary: summarize(records),
  }, null, 2));
}

main();
