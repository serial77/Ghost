"use strict";

const { execFileSync } = require("child_process");

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
      args[key] = "true";
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function runCommand(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function runNodeScript(scriptPath, args) {
  const output = runCommand("node", [scriptPath, ...args]);
  return output ? JSON.parse(output) : {};
}

function runPsql(sql) {
  return runCommand("docker", [
    "exec",
    "-i",
    process.env.POSTGRES_CONTAINER || "ghost-postgres",
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    process.env.POSTGRES_USER || "ghost",
    "-d",
    process.env.APP_DB || "ghost_app",
    "-At",
    "-P",
    "pager=off",
    "-c",
    sql,
  ]);
}

function sql(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function lookupFixtureIds() {
  const taskId = runPsql("SELECT id::text FROM tasks ORDER BY created_at DESC LIMIT 1;");
  const agentId = runPsql("SELECT id::text FROM agents ORDER BY created_at ASC LIMIT 1;");
  if (!taskId || !agentId) {
    fail("could not locate a task and agent fixture for governed flow scenarios");
  }
  return { taskId, agentId };
}

function insertApproval({ taskId, agentId, promptText, status, metadata }) {
  const sqlText = `WITH ins AS (
  INSERT INTO approvals (
    task_id,
    requested_by_agent_id,
    approval_type,
    prompt_text,
    status,
    metadata
  ) VALUES (
    ${sql(taskId)}::uuid,
    ${sql(agentId)}::uuid,
    'operator',
    ${sql(promptText)},
    ${sql(status)},
    ${sql(JSON.stringify(metadata))}::jsonb
  )
  RETURNING id::text
)
SELECT id FROM ins;`;
  return runPsql(sqlText);
}

function cleanupScenarioRows(approvalIds) {
  if (!approvalIds.length) {
    return;
  }
  const inList = approvalIds.map((id) => sql(id)).join(", ");
  runPsql(`DELETE FROM ghost_action_history WHERE approval_id IN (${inList});
DELETE FROM ghost_governed_followthrough WHERE approval_queue_id IN (${inList});
DELETE FROM approvals WHERE id::text IN (${inList});`);
}

function buildScenarioMetadata({ sourcePath, conversationId, delegationId, taskId, environment, workerRegistryId }) {
  const base = {
    source_path: sourcePath,
    conversation_id: conversationId,
    runtime_task_id: taskId,
    runtime_task_run_id: `run-${conversationId}`,
    n8n_execution_id: `exec-${conversationId}`,
    governance_environment: environment,
    requested_capabilities: ["code.write", "artifact.publish"],
    approval_item: {
      approval_id: `contract-${conversationId}`,
      summary: `Governed scenario ${conversationId}`,
      environment,
      capabilities: ["code.write", "artifact.publish"],
    },
  };
  if (delegationId) {
    base.delegation_id = delegationId;
    base.worker_registry_id = workerRegistryId || "forge";
    base.approval_item.target_worker_id = workerRegistryId || "forge";
  }
  return base;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const keepRows = args.keep === "true";
  const root = args["project-root"] || process.cwd();
  const resolveScript = `${root}/scripts/resolve-approval-queue.js`;
  const followthroughScript = `${root}/scripts/execute-governed-followthrough.js`;
  const reportApprovalScript = `${root}/scripts/report-approval-queue.js`;
  const reportActionScript = `${root}/scripts/report-action-history.js`;
  const reportFlowScript = `${root}/scripts/report-governed-flow.js`;
  const reportPolicyScript = `${root}/scripts/render-environment-policy.js`;

  const { taskId, agentId } = lookupFixtureIds();
  const approvals = [];
  try {
    const directApprovedId = insertApproval({
      taskId,
      agentId,
      promptText: "Scenario direct approved",
      status: "pending",
      metadata: buildScenarioMetadata({
        sourcePath: "direct_approval_required",
        conversationId: "scenario-direct-approved",
        taskId,
        environment: "lab",
      }),
    });
    approvals.push(directApprovedId);
    const directDeniedId = insertApproval({
      taskId,
      agentId,
      promptText: "Scenario direct denied",
      status: "pending",
      metadata: buildScenarioMetadata({
        sourcePath: "direct_approval_required",
        conversationId: "scenario-direct-denied",
        taskId,
        environment: "lab",
      }),
    });
    approvals.push(directDeniedId);
    const delegatedApprovedId = insertApproval({
      taskId,
      agentId,
      promptText: "Scenario delegated approved",
      status: "pending",
      metadata: buildScenarioMetadata({
        sourcePath: "delegated_blocked",
        conversationId: "scenario-delegated-approved",
        delegationId: "scenario-del-approved",
        taskId,
        environment: "lab",
        workerRegistryId: "forge",
      }),
    });
    approvals.push(delegatedApprovedId);
    const delegatedDeniedId = insertApproval({
      taskId,
      agentId,
      promptText: "Scenario delegated denied",
      status: "pending",
      metadata: buildScenarioMetadata({
        sourcePath: "delegated_blocked",
        conversationId: "scenario-delegated-denied",
        delegationId: "scenario-del-denied",
        taskId,
        environment: "lab",
        workerRegistryId: "forge",
      }),
    });
    approvals.push(delegatedDeniedId);

    const resolved = {
      direct_approved: runNodeScript(resolveScript, [
        "--approval-queue-id", directApprovedId,
        "--outcome", "approved",
        "--resolved-by", "scenario-harness",
        "--response-text", "approved in governed scenario harness",
      ]),
      direct_denied: runNodeScript(resolveScript, [
        "--approval-queue-id", directDeniedId,
        "--outcome", "rejected",
        "--resolved-by", "scenario-harness",
        "--response-text", "denied in governed scenario harness",
      ]),
      delegated_approved: runNodeScript(resolveScript, [
        "--approval-queue-id", delegatedApprovedId,
        "--outcome", "approved",
        "--resolved-by", "scenario-harness",
        "--response-text", "approved delegated scenario",
      ]),
      delegated_denied: runNodeScript(resolveScript, [
        "--approval-queue-id", delegatedDeniedId,
        "--outcome", "rejected",
        "--resolved-by", "scenario-harness",
        "--response-text", "denied delegated scenario",
      ]),
    };

    const followthrough = {
      direct_approved: runNodeScript(followthroughScript, ["--approval-queue-id", directApprovedId]),
      direct_denied: runNodeScript(followthroughScript, ["--approval-queue-id", directDeniedId]),
      delegated_approved: runNodeScript(followthroughScript, ["--approval-queue-id", delegatedApprovedId]),
      delegated_denied: runNodeScript(followthroughScript, ["--approval-queue-id", delegatedDeniedId]),
    };

    const approvalReport = runNodeScript(reportApprovalScript, ["--recent-hours", "1", "--limit", "20"]);
    const directApprovedTimeline = runNodeScript(reportActionScript, [
      "--recent-hours", "1",
      "--limit", "20",
      "--approval-id", directApprovedId,
      "--group-by", "approval",
      "--order", "asc",
    ]);
    const delegatedDeniedTimeline = runNodeScript(reportActionScript, [
      "--recent-hours", "1",
      "--limit", "20",
      "--approval-id", delegatedDeniedId,
      "--group-by", "approval",
      "--order", "asc",
    ]);
    const delegatedApprovedTrace = runNodeScript(reportFlowScript, [
      "--approval-queue-id", delegatedApprovedId,
      "--recent-hours", "1",
      "--limit", "5",
    ]);
    const directProdPolicy = runNodeScript(reportPolicyScript, ["--environment", "prod"]);
    const directLabPolicy = runNodeScript(reportPolicyScript, ["--environment", "lab"]);

    console.log(JSON.stringify({
      scenario_count: 4,
      approvals: {
        direct_approved: directApprovedId,
        direct_denied: directDeniedId,
        delegated_approved: delegatedApprovedId,
        delegated_denied: delegatedDeniedId,
      },
      resolved,
      followthrough,
      approval_queue_sample: approvalReport.approvals.filter((entry) =>
        [
          directApprovedId,
          directDeniedId,
          delegatedApprovedId,
          delegatedDeniedId,
        ].includes(entry.approval_queue_id),
      ),
      direct_approved_timeline: directApprovedTimeline.groups,
      delegated_denied_timeline: delegatedDeniedTimeline.groups,
      delegated_approved_trace: delegatedApprovedTrace.traces,
      environment_policy: {
        prod: directProdPolicy.environment,
        lab: directLabPolicy.environment,
      },
      worker_registry_assertion: {
        delegated_approved_worker_registry_id:
          delegatedApprovedTrace.traces[0]?.followthrough_worker_registry_id || null,
        delegated_approved_worker_label:
          delegatedApprovedTrace.traces[0]?.followthrough_worker_label || null,
      },
      kept_rows: keepRows,
    }, null, 2));
  } finally {
    if (!keepRows) {
      cleanupScenarioRows(approvals);
    }
  }
}

main();
