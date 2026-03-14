"use strict";

const { execFileSync } = require("child_process");

const defaultRecentHours = 72;
const defaultLimit = 25;

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

function buildSql(recentHours, limit, status) {
  const statusFilter = status
    ? `AND a.status = '${String(status).replace(/'/g, "''")}'`
    : "";

  return `SELECT COALESCE(JSON_AGG(row_to_json(selected) ORDER BY selected.requested_at DESC), '[]'::json)
FROM (
  SELECT
    a.id::text AS approval_queue_id,
    a.status,
    a.approval_type,
    a.task_id::text AS task_id,
    ag.agent_key AS requested_by_agent_key,
    ag.display_name AS requested_by_label,
    a.prompt_text AS summary,
    COALESCE(a.metadata ->> 'source_path', '') AS source_path,
    COALESCE(a.metadata ->> 'conversation_id', '') AS conversation_id,
    COALESCE(a.metadata ->> 'delegation_id', '') AS delegation_id,
    COALESCE(a.metadata ->> 'orchestration_task_id', '') AS orchestration_task_id,
    COALESCE(a.metadata ->> 'runtime_task_id', '') AS runtime_task_id,
    COALESCE(a.metadata ->> 'runtime_task_run_id', '') AS runtime_task_run_id,
    COALESCE(a.metadata ->> 'n8n_execution_id', '') AS n8n_execution_id,
    COALESCE(a.metadata ->> 'response_mode', '') AS response_mode,
    COALESCE(a.metadata ->> 'parent_owner_label', '') AS parent_owner_label,
    COALESCE(a.metadata ->> 'governance_environment', a.metadata -> 'approval_item' ->> 'environment', '') AS environment,
    COALESCE(a.metadata -> 'approval_item' ->> 'category', '') AS category,
    COALESCE(a.metadata -> 'approval_item' ->> 'risk_level', '') AS risk_level,
    COALESCE(a.metadata -> 'approval_item' ->> 'reason', '') AS reason,
    COALESCE(a.metadata -> 'approval_item' ->> 'approval_id', a.metadata ->> 'approval_contract_id', '') AS approval_contract_id,
    COALESCE(a.metadata -> 'approval_item' -> 'capabilities', a.metadata -> 'requested_capabilities', '[]'::jsonb) AS capabilities,
    a.requested_at::text AS requested_at,
    COALESCE(a.responded_at, a.requested_at)::text AS updated_at
  FROM approvals a
  LEFT JOIN agents ag ON ag.id = a.requested_by_agent_id
  WHERE a.requested_at >= NOW() - INTERVAL '${recentHours} hours'
    ${statusFilter}
  ORDER BY a.requested_at DESC, a.id DESC
  LIMIT ${limit}
) AS selected;`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const recentHours = requirePositiveInt(args["recent-hours"], "--recent-hours", defaultRecentHours);
  const limit = requirePositiveInt(args.limit, "--limit", defaultLimit);
  const status = args.status ? String(args.status).trim() : "";
  const rows = JSON.parse(runPsql(buildSql(recentHours, limit, status)));

  console.log(JSON.stringify({
    recent_hours: recentHours,
    limit,
    status_filter: status || null,
    queue_count: rows.length,
    approvals: rows,
  }, null, 2));
}

main();
