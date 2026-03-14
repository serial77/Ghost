"use strict";

function assertHasSingleMainConnection(workflow, fromNode, toNode) {
  const outputs = workflow.connections[fromNode]?.main || [];
  const firstOutput = Array.isArray(outputs[0]) ? outputs[0] : [];
  if (!firstOutput.some((entry) => entry.node === toNode)) {
    throw new Error(`Delegated-control contract check failed: missing connection ${fromNode} -> ${toNode}`);
  }
}

function applyDelegatedControlTailModule({ workflow, addNode, makeCodeNode, makePostgresNode }) {
  addNode(
    workflow,
    makePostgresNode(
      "Finalize Blocked Delegation",
      `SELECT public.ghost_finalize_delegation(
  NULLIF($1, '')::uuid,
  NULL,
  'blocked',
  $2,
  NULL
);`,
      "={{ [$json.delegation_id || '', $json.blocked_result_summary || 'Approval required before delegated worker execution.'] }}",
      [1920, -352],
      false,
    ),
  );

  addNode(
    workflow,
    makeCodeNode(
      "Build Parent Blocked Delegation Response",
      `const item = $('Build Delegation Context').item.json;
const reasons = Array.isArray(item.risk_reasons) && item.risk_reasons.length
  ? item.risk_reasons.join(' ')
  : 'Risk policy requires review before Ghost can start the delegated worker session.';
const reply = [
  \`${item.parent_owner_label || 'Ghost'} kept this conversation under its current owner and opened a delegated worker task instead of silently switching models.\`,
  \`Execution is blocked pending approval. The delegated task is now visible on the Task Board for review.\`,
  reasons,
].join('\\n\\n');
return [{ json: {
  conversation_id: item.conversation_id || '',
  reply,
  provider_used: item.parent_provider || '',
  model_used: item.parent_model || '',
  task_class: item.task_class || 'technical_work',
  approval_required: true,
  risk_level: item.risk_level || 'caution',
  risk_reasons: item.risk_reasons || [],
  task_summary: item.task_summary || '',
  command_success: false,
  command_exit_code: null,
  stdout_summary: '',
  stderr_summary: reasons,
  artifact_path: '',
  codex_command_status: 'blocked_pending_approval',
  error_type: 'delegation_blocked_pending_approval',
  delegation_id: item.delegation_id || '',
  orchestration_task_id: item.orchestration_task_id || '',
  runtime_task_id: null,
  worker_conversation_id: item.worker_conversation_id || '',
  n8n_execution_id: item.n8n_execution_id || null,
  response_mode: 'delegated_blocked',
  parent_owner_label: item.parent_owner_label || 'Ghost',
} }];`,
      [2144, -352],
    ),
  );

  addNode(
    workflow,
    makePostgresNode(
      "Finalize Unsupported Delegation",
      `SELECT public.ghost_finalize_delegation(
  NULLIF($1, '')::uuid,
  NULL,
  'blocked',
  $2,
  NULL
);`,
      "={{ [$json.delegation_id || '', $json.unsupported_result_summary || 'Delegated execution is not available in the current runtime.'] }}",
      [2144, 64],
      false,
    ),
  );

  addNode(
    workflow,
    makeCodeNode(
      "Build Parent Unsupported Delegation Response",
      `const item = $('Build Delegation Context').item.json;
const workerLabel = item.worker_agent_label || item.delegated_provider || 'the delegated worker';
const reply = [
  \`${item.parent_owner_label || 'Ghost'} kept ownership of this conversation and opened delegated work for ${workerLabel}.\`,
  'Delegated execution is not available in the current runtime, so the worker task could not be started automatically in this phase.',
  item.unsupported_result_summary || '',
].join('\\n\\n');
return [{ json: {
  conversation_id: item.conversation_id || '',
  reply,
  provider_used: item.parent_provider || '',
  model_used: item.parent_model || '',
  task_class: item.task_class || 'technical_work',
  approval_required: false,
  risk_level: item.risk_level || 'safe',
  risk_reasons: item.risk_reasons || [],
  task_summary: item.task_summary || '',
  command_success: false,
  command_exit_code: null,
  stdout_summary: '',
  stderr_summary: item.unsupported_result_summary || '',
  artifact_path: '',
  codex_command_status: 'blocked_execution_unavailable',
  error_type: 'delegation_execution_not_available',
  delegation_id: item.delegation_id || '',
  orchestration_task_id: item.orchestration_task_id || '',
  runtime_task_id: null,
  worker_conversation_id: item.worker_conversation_id || '',
  n8n_execution_id: item.n8n_execution_id || null,
  response_mode: 'delegated_execution_unavailable',
  parent_owner_label: item.parent_owner_label || 'Ghost',
} }];`,
      [2368, 64],
    ),
  );
}

function assertDelegatedControlTailContract({ workflow, findNode, assertIncludes }) {
  const finalizeBlocked = findNode(workflow, "Finalize Blocked Delegation");
  const blockedResponse = findNode(workflow, "Build Parent Blocked Delegation Response");
  const finalizeUnsupported = findNode(workflow, "Finalize Unsupported Delegation");
  const unsupportedResponse = findNode(workflow, "Build Parent Unsupported Delegation Response");

  assertIncludes(finalizeBlocked.parameters.query, "'blocked'", "Finalize Blocked Delegation query");
  assertIncludes(finalizeBlocked.parameters.options.queryReplacement, "blocked_result_summary", "Finalize Blocked Delegation queryReplacement");

  for (const field of [
    "approval_required: true",
    "codex_command_status: 'blocked_pending_approval'",
    "error_type: 'delegation_blocked_pending_approval'",
    "response_mode: 'delegated_blocked'",
    "runtime_task_id: null",
  ]) {
    assertIncludes(blockedResponse.parameters.jsCode, field, "Build Parent Blocked Delegation Response");
  }

  assertIncludes(finalizeUnsupported.parameters.query, "'blocked'", "Finalize Unsupported Delegation query");
  assertIncludes(finalizeUnsupported.parameters.options.queryReplacement, "unsupported_result_summary", "Finalize Unsupported Delegation queryReplacement");

  for (const field of [
    "Delegated execution is not available in the current runtime",
    "codex_command_status: 'blocked_execution_unavailable'",
    "error_type: 'delegation_execution_not_available'",
    "response_mode: 'delegated_execution_unavailable'",
    "runtime_task_id: null",
  ]) {
    assertIncludes(unsupportedResponse.parameters.jsCode, field, "Build Parent Unsupported Delegation Response");
  }

  assertHasSingleMainConnection(workflow, "Delegation Approval Required?", "Finalize Blocked Delegation");
  assertHasSingleMainConnection(workflow, "Finalize Blocked Delegation", "Build Parent Blocked Delegation Response");
  assertHasSingleMainConnection(workflow, "Build Parent Blocked Delegation Response", "Build API Response");

  const delegatedWorkerOutputs = workflow.connections["Delegated Worker Is Codex?"]?.main || [];
  const secondOutput = Array.isArray(delegatedWorkerOutputs[1]) ? delegatedWorkerOutputs[1] : [];
  if (!secondOutput.some((entry) => entry.node === "Finalize Unsupported Delegation")) {
    throw new Error("Delegated-control contract check failed: missing connection Delegated Worker Is Codex? -> Finalize Unsupported Delegation");
  }
  assertHasSingleMainConnection(workflow, "Finalize Unsupported Delegation", "Build Parent Unsupported Delegation Response");
  assertHasSingleMainConnection(workflow, "Build Parent Unsupported Delegation Response", "Build API Response");
}

module.exports = {
  applyDelegatedControlTailModule,
  assertDelegatedControlTailContract,
};
