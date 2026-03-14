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

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSql(recentHours, limit, filters, order) {
  const clauses = [`occurred_at >= NOW() - INTERVAL '${recentHours} hours'`];
  if (filters.eventType) {
    clauses.push(`event_type = ${sqlLiteral(filters.eventType)}`);
  }
  if (filters.conversationId) {
    clauses.push(`conversation_id = ${sqlLiteral(filters.conversationId)}`);
  }
  if (filters.approvalId) {
    clauses.push(`approval_id = ${sqlLiteral(filters.approvalId)}`);
  }
  if (filters.runtimeTaskId) {
    clauses.push(`runtime_task_id = ${sqlLiteral(filters.runtimeTaskId)}`);
  }
  if (filters.delegationId) {
    clauses.push(`delegation_id = ${sqlLiteral(filters.delegationId)}`);
  }
  const orderKeyword = order === "asc" ? "ASC" : "DESC";

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
  WHERE ${clauses.join("\n    AND ")}
  ORDER BY occurred_at ${orderKeyword}, action_id ${orderKeyword}
  LIMIT ${limit}
) AS selected;`;
}

function groupRecords(records, groupBy) {
  if (!groupBy || groupBy === "none") {
    return [];
  }
  const keyForRecord = (record) => {
    switch (groupBy) {
      case "conversation":
        return record.conversation_id || "";
      case "approval":
        return record.approval_id || "";
      case "delegation":
        return record.delegation_id || "";
      case "runtime":
        return record.runtime_task_id || "";
      default:
        return "";
    }
  };

  const groups = new Map();
  for (const record of records) {
    const key = keyForRecord(record);
    if (!key) {
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, {
        group_by: groupBy,
        group_key: key,
        record_count: 0,
        first_occurred_at: record.occurred_at,
        last_occurred_at: record.occurred_at,
        event_types: {},
        records: [],
      });
    }
    const group = groups.get(key);
    group.record_count += 1;
    group.first_occurred_at = group.first_occurred_at < record.occurred_at ? group.first_occurred_at : record.occurred_at;
    group.last_occurred_at = group.last_occurred_at > record.occurred_at ? group.last_occurred_at : record.occurred_at;
    group.event_types[record.event_type] = (group.event_types[record.event_type] || 0) + 1;
    group.records.push(record);
  }
  return Array.from(groups.values()).sort((left, right) => right.record_count - left.record_count || left.group_key.localeCompare(right.group_key));
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const recentHours = requirePositiveInt(args["recent-hours"], "--recent-hours", defaultRecentHours);
    const limit = requirePositiveInt(args.limit, "--limit", defaultLimit);
    const filters = {
      eventType: args["event-type"] ? String(args["event-type"]).trim() : "",
      conversationId: args["conversation-id"] ? String(args["conversation-id"]).trim() : "",
      approvalId: args["approval-id"] ? String(args["approval-id"]).trim() : "",
      runtimeTaskId: args["runtime-task-id"] ? String(args["runtime-task-id"]).trim() : "",
      delegationId: args["delegation-id"] ? String(args["delegation-id"]).trim() : "",
    };
    const groupBy = args["group-by"] ? String(args["group-by"]).trim() : "none";
    const order = args.order ? String(args.order).trim().toLowerCase() : "desc";
    if (!["none", "conversation", "approval", "delegation", "runtime"].includes(groupBy)) {
      fail("--group-by must be one of: none, conversation, approval, delegation, runtime");
    }
    if (!["asc", "desc"].includes(order)) {
      fail("--order must be one of: asc, desc");
    }
    ensureActionHistoryTable();
    const rows = JSON.parse(runPsql(buildSql(recentHours, limit, filters, order)));
    const groups = groupRecords(rows, groupBy);

    console.log(JSON.stringify({
      recent_hours: recentHours,
      limit,
      filters: {
        event_type: filters.eventType || null,
        conversation_id: filters.conversationId || null,
        approval_id: filters.approvalId || null,
        runtime_task_id: filters.runtimeTaskId || null,
        delegation_id: filters.delegationId || null,
      },
      group_by: groupBy,
      order,
      record_count: rows.length,
      records: rows,
      groups,
    }, null, 2));
  } catch (error) {
    fail(error.message);
  }
}

main();
