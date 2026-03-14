"use strict";

const {
  ensureGovernedFollowthroughTable,
  fail,
  parseArgs,
  requirePositiveInt,
  runPsql,
} = (() => {
  const runtime = require("./governed-followthrough-runtime");
  return {
    ensureGovernedFollowthroughTable: runtime.ensureGovernedFollowthroughTable,
    fail: runtime.fail,
    parseArgs: runtime.parseArgs,
    runPsql: runtime.runPsql,
    requirePositiveInt(value, flagName, fallback) {
      if (value === undefined) {
        return fallback;
      }
      if (!/^[0-9]+$/.test(String(value))) {
        fail(`${flagName} must be a positive integer`);
      }
      return Number(value);
    },
  };
})();

const defaultRecentHours = 72;
const defaultLimit = 25;

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSql(recentHours, limit, executionState) {
  const stateFilter = executionState ? `AND execution_state = ${sqlLiteral(executionState)}` : "";
  return `SELECT COALESCE(JSON_AGG(row_to_json(selected) ORDER BY selected.executed_at DESC), '[]'::json)
FROM (
  SELECT
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
    close_reason,
    executor_label,
    requested_capabilities,
    next_step_payload,
    created_at::text AS created_at,
    updated_at::text AS updated_at,
    executed_at::text AS executed_at
  FROM ghost_governed_followthrough
  WHERE COALESCE(executed_at, created_at) >= NOW() - INTERVAL '${recentHours} hours'
    ${stateFilter}
  ORDER BY COALESCE(executed_at, created_at) DESC, followthrough_id DESC
  LIMIT ${limit}
) AS selected;`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const recentHours = requirePositiveInt(args["recent-hours"], "--recent-hours", defaultRecentHours);
    const limit = requirePositiveInt(args.limit, "--limit", defaultLimit);
    const executionState = args["execution-state"] ? String(args["execution-state"]).trim() : "";
    ensureGovernedFollowthroughTable();
    const rows = JSON.parse(runPsql(buildSql(recentHours, limit, executionState)));
    console.log(JSON.stringify({
      recent_hours: recentHours,
      limit,
      execution_state_filter: executionState || null,
      record_count: rows.length,
      records: rows,
    }, null, 2));
  } catch (error) {
    fail(error.message);
  }
}

main();
