"use strict";

const {
  fail,
  materializeActionRecords,
  parseArgs,
  requirePositiveInt,
} = require("./action-record-runtime");
const defaultRecentHours = 24;
const defaultLimit = 40;

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const recentHours = requirePositiveInt(args["recent-hours"], "--recent-hours", defaultRecentHours);
    const limit = requirePositiveInt(args.limit, "--limit", defaultLimit);
    const records = materializeActionRecords({ recentHours, limit });

    console.log(JSON.stringify({
      recent_hours: recentHours,
      limit,
      record_count: records.length,
      records,
    }, null, 2));
  } catch (error) {
    fail(error.message);
  }
}

main();
