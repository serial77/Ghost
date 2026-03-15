"use strict";

const {
  ensureActionHistoryTable,
  fail,
  materializeActionRecords,
  parseArgs,
  requirePositiveInt,
  upsertActionRecord,
} = require("./action-record-runtime");

const defaultRecentHours = 24;
const defaultLimit = 60;

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const recentHours = requirePositiveInt(args["recent-hours"], "--recent-hours", defaultRecentHours);
    const limit = requirePositiveInt(args.limit, "--limit", defaultLimit);
    const records = materializeActionRecords({ recentHours, limit });
    ensureActionHistoryTable();
    for (const record of records) {
      upsertActionRecord(record);
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
