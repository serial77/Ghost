"use strict";

const {
  ensureActionHistoryTable,
  fail,
  materializeActionRecords,
  parseArgs,
  requirePositiveInt,
  runPsql,
} = require("./action-record-runtime");

const defaultRecentHours = 24;
const defaultLimit = 60;

function sqlString(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `'${JSON.stringify(value || {}).replace(/'/g, "''")}'::jsonb`;
}

function upsertRecord(record) {
  runPsql(`INSERT INTO ghost_action_history (
  action_id,
  event_type,
  entity,
  occurred_at,
  conversation_id,
  request_id,
  delegation_id,
  runtime_task_id,
  approval_id,
  artifact_id,
  outcome_status,
  summary,
  source_surface,
  payload
) VALUES (
  ${sqlString(record.action_id)},
  ${sqlString(record.event_type)},
  ${sqlString(record.entity)},
  ${sqlString(record.occurred_at)}::timestamptz,
  ${sqlString(record.conversation_id)},
  ${sqlString(record.request_id)},
  ${sqlString(record.delegation_id)},
  ${sqlString(record.runtime_task_id)},
  ${sqlString(record.approval_id)},
  ${sqlString(record.artifact_id)},
  ${sqlString(record.outcome_status)},
  ${sqlString(record.summary)},
  ${sqlString(record.source_surface)},
  ${sqlJson(record.payload)}
)
ON CONFLICT (action_id) DO UPDATE
SET
  event_type = EXCLUDED.event_type,
  entity = EXCLUDED.entity,
  occurred_at = EXCLUDED.occurred_at,
  conversation_id = EXCLUDED.conversation_id,
  request_id = EXCLUDED.request_id,
  delegation_id = EXCLUDED.delegation_id,
  runtime_task_id = EXCLUDED.runtime_task_id,
  approval_id = EXCLUDED.approval_id,
  artifact_id = EXCLUDED.artifact_id,
  outcome_status = EXCLUDED.outcome_status,
  summary = EXCLUDED.summary,
  source_surface = EXCLUDED.source_surface,
  payload = EXCLUDED.payload,
  updated_at = NOW();`);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const recentHours = requirePositiveInt(args["recent-hours"], "--recent-hours", defaultRecentHours);
    const limit = requirePositiveInt(args.limit, "--limit", defaultLimit);
    const records = materializeActionRecords({ recentHours, limit });
    ensureActionHistoryTable();
    for (const record of records) {
      upsertRecord(record);
    }
    console.log(JSON.stringify({
      recent_hours: recentHours,
      limit,
      synced_count: records.length,
      action_ids: records.map((record) => record.action_id),
    }, null, 2));
  } catch (error) {
    fail(error.message);
  }
}

main();
