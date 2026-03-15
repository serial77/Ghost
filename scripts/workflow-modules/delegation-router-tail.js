"use strict";

function assertHasConnection(workflow, fromNode, toNode, outputIndex = 0) {
  const outputs = workflow.connections[fromNode]?.main || [];
  const output = Array.isArray(outputs[outputIndex]) ? outputs[outputIndex] : [];
  if (!output.some((entry) => entry.node === toNode)) {
    throw new Error(`Delegation-router contract check failed: missing connection ${fromNode} -> ${toNode}`);
  }
}

function applyDelegationRouterTailModule({ workflow, addNode, makeIfNode, setMainConnections }) {
  addNode(
    workflow,
    makeIfNode(
      "Delegation Required?",
      "={{ $json.delegation_required }}",
      "true",
      [576, -64],
    ),
  );

  addNode(
    workflow,
    makeIfNode(
      "Delegation Approval Required?",
      "={{ $('Build Delegation Context').item.json.approval_required }}",
      "true",
      [1696, -208],
    ),
  );

  addNode(
    workflow,
    makeIfNode(
      "Delegated Worker Is Codex?",
      "={{ ($json.delegated_provider || '') === 'codex_oauth_worker' }}",
      "true",
      [1920, -64],
    ),
  );

  setMainConnections(workflow.connections, "Resolve Parent Conversation Strategy", [[{ node: "Delegation Required?" }]]);
  setMainConnections(workflow.connections, "Delegation Required?", [
    [{ node: "Build Delegation Request" }],
    [{ node: "Expose Route Metadata" }],
  ]);
  setMainConnections(workflow.connections, "Build Delegation Execution Context", [[{ node: "Delegation Approval Required?" }]]);
  setMainConnections(workflow.connections, "Delegation Approval Required?", [
    [{ node: "Finalize Blocked Delegation" }],
    [{ node: "Delegated Worker Is Codex?" }],
  ]);
  setMainConnections(workflow.connections, "Delegated Worker Is Codex?", [
    [{ node: "Start Delegated Runtime" }],
    [{ node: "Finalize Unsupported Delegation" }],
  ]);
}

function assertDelegationRouterTailContract({ workflow, findNode, assertIncludes }) {
  const delegationRequired = findNode(workflow, "Delegation Required?");
  const delegationApprovalRequired = findNode(workflow, "Delegation Approval Required?");
  const delegatedWorkerIsCodex = findNode(workflow, "Delegated Worker Is Codex?");

  assertIncludes(
    JSON.stringify(delegationRequired.parameters),
    "={{ $json.delegation_required }}",
    "Delegation Required? condition",
  );
  assertIncludes(
    JSON.stringify(delegationApprovalRequired.parameters),
    "={{ $('Build Delegation Context').item.json.approval_required }}",
    "Delegation Approval Required? condition",
  );
  assertIncludes(
    JSON.stringify(delegatedWorkerIsCodex.parameters),
    "codex_oauth_worker",
    "Delegated Worker Is Codex? condition",
  );

  assertHasConnection(workflow, "Resolve Parent Conversation Strategy", "Delegation Required?");
  assertHasConnection(workflow, "Delegation Required?", "Build Delegation Request", 0);
  assertHasConnection(workflow, "Delegation Required?", "Expose Route Metadata", 1);
  assertHasConnection(workflow, "Build Delegation Execution Context", "Delegation Approval Required?");
  assertHasConnection(workflow, "Delegation Approval Required?", "Finalize Blocked Delegation", 0);
  assertHasConnection(workflow, "Delegation Approval Required?", "Delegated Worker Is Codex?", 1);
  assertHasConnection(workflow, "Delegated Worker Is Codex?", "Start Delegated Runtime", 0);
  assertHasConnection(workflow, "Delegated Worker Is Codex?", "Finalize Unsupported Delegation", 1);
}

module.exports = {
  applyDelegationRouterTailModule,
  assertDelegationRouterTailContract,
};
