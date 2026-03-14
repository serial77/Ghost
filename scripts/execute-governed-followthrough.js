"use strict";

const {
  ensureGovernedFollowthroughTable,
  fail,
  parseArgs,
  loadApprovalForFollowthrough,
  deriveFollowthroughPlan,
  runPsql,
  sqlJson,
  sqlString,
  upsertFollowthrough,
} = require("./governed-followthrough-runtime");
const { ensureActionHistoryTable, upsertActionRecord } = require("./action-record-runtime");

function updateApprovalMetadata(approvalQueueId, plan, followthroughRecord) {
  runPsql(`UPDATE approvals
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
  'followthrough', ${sqlJson({
    followthrough_id: followthroughRecord.followthrough_id,
    followthrough_type: followthroughRecord.followthrough_type,
    execution_state: followthroughRecord.execution_state,
    close_reason: followthroughRecord.close_reason,
    executor_label: followthroughRecord.executor_label,
    executed_at: followthroughRecord.executed_at,
    next_step_payload: followthroughRecord.next_step_payload,
  })}
)
WHERE id::text = ${sqlString(approvalQueueId)};`);
}

function recordActionEvents(approvalRow, followthroughRecord) {
  const base = {
    occurred_at: followthroughRecord.executed_at,
    conversation_id: followthroughRecord.conversation_id || "",
    request_id: followthroughRecord.approval_queue_id,
    delegation_id: followthroughRecord.delegation_id || null,
    runtime_task_id: followthroughRecord.runtime_task_id || null,
    approval_id: followthroughRecord.approval_queue_id,
    artifact_id: null,
    source_surface: "ghost_governed_followthrough",
    summary: approvalRow.metadata?.approval_item?.summary || approvalRow.response_text || approvalRow.metadata?.approval_item?.reason || "Governed follow-through executed",
  };

  const events = [];
  if (followthroughRecord.outcome_status === "allowed") {
    events.push({
      event_type: "governance.allowed",
      entity: "approval",
      outcome_status: "allowed",
      payload: {
        followthrough_id: followthroughRecord.followthrough_id,
        execution_state: followthroughRecord.execution_state,
        next_step_payload: followthroughRecord.next_step_payload,
      },
    });
  } else if (followthroughRecord.outcome_status === "denied") {
    events.push({
      event_type: "governance.denied",
      entity: "approval",
      outcome_status: "denied",
      payload: {
        followthrough_id: followthroughRecord.followthrough_id,
        execution_state: followthroughRecord.execution_state,
        close_reason: followthroughRecord.close_reason,
      },
    });
  }

  if (followthroughRecord.execution_state === "retry_enqueued") {
    events.push({
      event_type: "governance.retry_enqueued",
      entity: "approval",
      outcome_status: followthroughRecord.outcome_status,
      payload: {
        followthrough_id: followthroughRecord.followthrough_id,
        followthrough_type: followthroughRecord.followthrough_type,
        next_step_payload: followthroughRecord.next_step_payload,
      },
    });
  } else if (followthroughRecord.execution_state === "closed_without_retry") {
    events.push({
      event_type: "governance.closed_without_retry",
      entity: "approval",
      outcome_status: followthroughRecord.outcome_status,
      payload: {
        followthrough_id: followthroughRecord.followthrough_id,
        close_reason: followthroughRecord.close_reason,
      },
    });
  }

  for (const event of events) {
    upsertActionRecord({
      action_id: `${followthroughRecord.followthrough_id}:${event.event_type}`,
      ...base,
      ...event,
    });
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const approvalQueueId = String(args["approval-queue-id"] || "").trim();
    const executorLabel = String(args.executor || "ghost-governor").trim();

    if (!approvalQueueId) {
      fail("required args: --approval-queue-id [--executor ghost-governor]");
    }

    const approvalRow = loadApprovalForFollowthrough(approvalQueueId);
    if (!approvalRow.approval_queue_id) {
      fail(`approval queue item not found: ${approvalQueueId}`);
    }
    if (!["approved", "rejected", "expired", "cancelled", "superseded"].includes(String(approvalRow.status || ""))) {
      fail(`approval queue item is not terminal: ${approvalQueueId} (${approvalRow.status || "unknown"})`);
    }

    const plan = {
      ...deriveFollowthroughPlan(approvalRow),
      resolution_state: String(approvalRow.status || ""),
    };

    ensureGovernedFollowthroughTable();
    ensureActionHistoryTable();
    const followthroughRecord = upsertFollowthrough({
      approvalQueueId,
      executorLabel,
      plan,
    });
    updateApprovalMetadata(approvalQueueId, plan, followthroughRecord);
    recordActionEvents(approvalRow, followthroughRecord);

    console.log(JSON.stringify({
      approval_queue_id: approvalQueueId,
      resolution_state: plan.resolution_state,
      followthrough_id: followthroughRecord.followthrough_id,
      followthrough_type: followthroughRecord.followthrough_type,
      execution_state: followthroughRecord.execution_state,
      outcome_status: followthroughRecord.outcome_status,
      close_reason: followthroughRecord.close_reason,
      next_step_payload: followthroughRecord.next_step_payload,
    }, null, 2));
  } catch (error) {
    fail(error.message);
  }
}

main();
