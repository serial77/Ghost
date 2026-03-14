"use strict";

const {
  ensureActionHistoryTable,
  parseArgs,
  requirePositiveInt,
  runPsql,
  fail,
} = require("./action-record-runtime");

const defaultRecentHours = 72;
const defaultLimit = 25;

function buildSql(recentHours, limit, eventType) {
  const eventTypeFilter = eventType
    ? `AND event_type = '${String(eventType).replace(/'/g, "''")}'`
    : "";

  return `SELECT COALESCE(JSON_AGG(row_to_json(selected) ORDER BY selected.occurred_at DESC), '[]'::json)
FROM (
  SELECT
    action_id,
    event_type,
    entity,
    occurred_at::text AS occurred_at,
    conversation_id,
    request_id,
    delegation_id,
    runtime_task_id,
    approval_id,
    artifact_id,
    outcome_status,
    summary,
    source_surface,
    payload,
    created_at::text AS created_at,
    updated_at::text AS updated_at
  FROM ghost_action_history
  WHERE occurred_at >= NOW() - INTERVAL '${recentHours} hours'
    ${eventTypeFilter}
  ORDER BY occurred_at DESC, action_id DESC
  LIMIT ${limit}
) AS selected;`;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const recentHours = requirePositiveInt(args["recent-hours"], "--recent-hours", defaultRecentHours);
    const limit = requirePositiveInt(args.limit, "--limit", defaultLimit);
    const eventType = args["event-type"] ? String(args["event-type"]).trim() : "";
    ensureActionHistoryTable();
    const rows = JSON.parse(runPsql(buildSql(recentHours, limit, eventType)));

    console.log(JSON.stringify({
      recent_hours: recentHours,
      limit,
      event_type_filter: eventType || null,
      record_count: rows.length,
      records: rows,
    }, null, 2));
  } catch (error) {
    fail(error.message);
  }
}

main();
