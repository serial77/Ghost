"use strict";

function assertHasSingleMainConnection(workflow, fromNode, toNode) {
  const outputs = workflow.connections[fromNode]?.main || [];
  const firstOutput = Array.isArray(outputs[0]) ? outputs[0] : [];
  if (!firstOutput.some((entry) => entry.node === toNode)) {
    throw new Error(`Delegated-setup contract check failed: missing connection ${fromNode} -> ${toNode}`);
  }
}

function applyDelegatedSetupTailModule({
  workflow,
  addNode,
  makeCodeNode,
  makePostgresNode,
  delegatedExecutionTarget,
  workflowName,
  workerRuntimeConfigLiteral,
}) {
  addNode(
    workflow,
    makeCodeNode(
      "Build Delegation Execution Context",
      `const context = $('Build Delegation Context').item.json;
const saved = $input.first().json;
return [{ json: {
  ...context,
  worker_user_message_id: saved.id || '',
} }];`,
      [1600, -208],
    ),
  );

  addNode(
    workflow,
    makeCodeNode(
      "Build Delegation Request",
      `const __ghostWorkerRuntime = ${workerRuntimeConfigLiteral};
const item = $input.first().json;
const normalized = $('Normalize Input').item.json;
const userMessage = $items('Save User Message', 0, 0)[0]?.json || {};
const compact = (value, limit = 600) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
const candidateWorkers = Object.values(__ghostWorkerRuntime.workers_by_id || {});
const selectedWorker = candidateWorkers.find((worker) => Array.isArray(worker.invocation_intent) && worker.invocation_intent.includes(item.task_class || ''))
  || __ghostWorkerRuntime.workers_by_id.forge
  || null;
if (!selectedWorker) {
  throw new Error('No delegated worker registry entry is available for technical work');
}
const requestTitle = compact(item.task_summary || normalized.message || 'Ghost delegated worker task', 160) || 'Ghost delegated worker task';
const requestSummary = compact(normalized.message || item.task_summary || '');
const metadata = {
  source: 'conversation_delegation',
  entrypoint: normalized.entrypoint || 'direct_webhook',
  parent_owner_agent_id: item.parent_owner_agent_id || null,
  parent_owner_agent_key: item.parent_owner_agent_key || 'ghost-main',
  parent_owner_label: item.parent_owner_label || 'Ghost',
  parent_provider: item.parent_provider || '',
  parent_model: item.parent_model || '',
  delegated_provider: item.delegated_provider || '',
  delegated_model: item.delegated_model || '',
  parent_message_id: userMessage.id || null,
  n8n_execution_id: item.n8n_execution_id || normalized.n8n_execution_id || null,
};
return [{ json: {
  ...item,
  delegated_worker_id: selectedWorker.id,
  delegated_worker_label: selectedWorker.visibility_label || 'Forge',
  delegated_worker_role: selectedWorker.role || 'implementation_worker',
  delegated_worker_operator_identity: selectedWorker.operator_identity || 'delegated-worker',
  parent_message_id: userMessage.id || '',
  request_title: requestTitle,
  request_summary: requestSummary,
  worker_message_content: normalized.message || requestSummary || requestTitle,
  worker_execution_prompt: item.prompt || normalized.message || requestSummary || requestTitle,
  delegation_metadata_json: JSON.stringify(metadata),
} }];`,
      [800, -208],
    ),
  );

  addNode(
    workflow,
    makePostgresNode(
      "Create Conversation Delegation",
      `SELECT
  delegation_id::text,
  orchestration_task_id::text,
  worker_conversation_id::text,
  worker_agent_id::text,
  worker_agent_label,
  worker_provider,
  worker_model
FROM public.ghost_create_conversation_delegation(
  NULLIF($1, '')::uuid,
  NULLIF($2, '')::uuid,
  NULLIF($3, ''),
  NULLIF($4, ''),
  NULLIF($5, ''),
  $6,
  $7::jsonb
);`,
      "={{ [$json.conversation_id || '', $json.parent_message_id || '', $json.delegated_provider || 'codex_oauth_worker', $json.delegated_model || '', $json.request_title || '', $json.request_summary || '', $json.delegation_metadata_json || '{}'] }}",
      [1024, -208],
      false,
    ),
  );

  addNode(
    workflow,
    makeCodeNode(
      "Build Delegation Context",
      `const __ghostWorkerRuntime = ${workerRuntimeConfigLiteral};
const parent = $('Build Delegation Request').item.json;
const workerId = parent.delegated_worker_id || 'forge';
const workerRegistry = __ghostWorkerRuntime.workers_by_id[workerId];
const workerCapabilities = Array.isArray(__ghostWorkerRuntime.worker_capabilities[workerId])
  ? __ghostWorkerRuntime.worker_capabilities[workerId]
  : [];
const requiredCapabilities = ['code.write', 'artifact.publish'];
const runtimeEnvironment = (() => {
  const explicit = typeof process !== 'undefined'
    ? String(process.env.GHOST_RUNTIME_ENV || process.env.GHOST_ENV || process.env.NODE_ENV || '').trim()
    : '';
  if (explicit === 'production' && __ghostWorkerRuntime.environments_by_id.prod) return 'prod';
  if (explicit && __ghostWorkerRuntime.environments_by_id[explicit]) return explicit;
  return 'lab';
})();
const environmentDoc = __ghostWorkerRuntime.environments_by_id[runtimeEnvironment] || __ghostWorkerRuntime.environments_by_id.lab || { governance_posture: 'moderate', restricted_capabilities: [] };
const capabilityRecords = requiredCapabilities
  .map((capabilityId) => __ghostWorkerRuntime.capabilities_by_id[capabilityId] || null)
  .filter(Boolean);
const approvalRequiredCapabilities = capabilityRecords
  .filter((entry) => entry.approval_required)
  .map((entry) => entry.id);
const restrictedCapabilities = capabilityRecords
  .filter((entry) => (environmentDoc.restricted_capabilities || []).includes(entry.id))
  .map((entry) => entry.id);
const outOfScopeCapabilities = capabilityRecords
  .filter((entry) => !(entry.environment_restriction || []).includes(runtimeEnvironment))
  .map((entry) => entry.id);
const workerGovernanceState = restrictedCapabilities.length > 0 || outOfScopeCapabilities.length > 0
  ? 'environment_restricted'
  : approvalRequiredCapabilities.length > 0
    ? 'approval_required'
    : 'allowed';
const workerGovernancePolicy = {
  state: workerGovernanceState,
  summary: [
    approvalRequiredCapabilities.length ? \`approval required for \${approvalRequiredCapabilities.join(', ')}\` : '',
    restrictedCapabilities.length ? \`restricted in \${runtimeEnvironment}: \${restrictedCapabilities.join(', ')}\` : '',
    outOfScopeCapabilities.length ? \`outside \${runtimeEnvironment} scope: \${outOfScopeCapabilities.join(', ')}\` : '',
    \`environment posture \${environmentDoc.governance_posture || 'unknown'}\`,
  ].filter(Boolean).join('; '),
  environment: runtimeEnvironment,
  environment_posture: environmentDoc.governance_posture || null,
  approval_required_capabilities: approvalRequiredCapabilities,
  restricted_capabilities: restrictedCapabilities,
  out_of_scope_capabilities: outOfScopeCapabilities,
  blocking_capabilities: Array.from(new Set([...restrictedCapabilities, ...outOfScopeCapabilities])),
};
const missingCapabilities = requiredCapabilities.filter((capabilityId) => !workerCapabilities.includes(capabilityId));
if (!workerRegistry) {
  throw new Error(\`Missing delegated worker registry definition for \${workerId}\`);
}
if (missingCapabilities.length > 0) {
  throw new Error(\`\${workerRegistry.visibility_label || workerId} worker is missing required capabilities: \${missingCapabilities.join(', ')}\`);
}
const delegation = $input.first().json;
const normalized = $('Normalize Input').item.json;
const compact = (value, limit = 800) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
const workerRuntimeInput = {
  request_summary: parent.request_summary || '',
  delegated_from_conversation_id: parent.conversation_id || '',
  delegated_from_message_id: parent.parent_message_id || '',
  delegated_provider: delegation.worker_provider || parent.delegated_provider || '',
  delegated_model: delegation.worker_model || parent.delegated_model || '',
};
const workerRuntimeContext = {
  delegation_id: delegation.delegation_id || '',
  orchestration_task_id: delegation.orchestration_task_id || '',
  parent_conversation_id: parent.conversation_id || '',
  parent_owner_label: parent.parent_owner_label || 'Ghost',
  worker_registry_id: workerRegistry.id,
  worker_role: workerRegistry.role,
  worker_operator_identity: workerRegistry.operator_identity,
  delegated_provider: delegation.worker_provider || parent.delegated_provider || '',
  delegated_model: delegation.worker_model || parent.delegated_model || '',
  entrypoint: normalized.entrypoint || 'direct_webhook',
  n8n_execution_id: parent.n8n_execution_id || normalized.n8n_execution_id || '',
};
return [{ json: {
  ...parent,
  delegation_id: delegation.delegation_id || '',
  orchestration_task_id: delegation.orchestration_task_id || '',
  worker_conversation_id: delegation.worker_conversation_id || '',
  worker_agent_id: delegation.worker_agent_id || '',
  approval_required: parent.approval_required === true || workerGovernancePolicy.state === 'environment_restricted',
  governance_environment: runtimeEnvironment,
  governance_policy: workerGovernancePolicy,
  requested_capabilities: requiredCapabilities,
  risk_reasons: Array.from(new Set([
    ...(Array.isArray(parent.risk_reasons) ? parent.risk_reasons : []),
    workerGovernancePolicy.state === 'environment_restricted' ? workerGovernancePolicy.summary : '',
  ].filter(Boolean))),
  worker_registry_id: workerRegistry.id,
  worker_agent_label: workerRegistry.visibility_label,
  worker_role: workerRegistry.role,
  worker_operator_identity: workerRegistry.operator_identity,
  worker_environment_scope: workerRegistry.environment_scope || [],
  worker_allowed_capabilities: workerCapabilities,
  delegated_provider: delegation.worker_provider || parent.delegated_provider || '',
  delegated_model: delegation.worker_model || parent.delegated_model || '',
  worker_runtime_input_json: JSON.stringify(workerRuntimeInput),
  worker_runtime_context_json: JSON.stringify(workerRuntimeContext),
  worker_user_metadata_json: JSON.stringify({
    source: 'conversation_delegation',
    delegation_id: delegation.delegation_id || null,
    orchestration_task_id: delegation.orchestration_task_id || null,
    parent_conversation_id: parent.conversation_id || null,
    parent_message_id: parent.parent_message_id || null,
    delegated_provider: delegation.worker_provider || parent.delegated_provider || null,
    delegated_model: delegation.worker_model || parent.delegated_model || null,
    parent_owner_label: parent.parent_owner_label || 'Ghost',
    worker_registry_id: workerRegistry.id,
    worker_role: workerRegistry.role,
    worker_operator_identity: workerRegistry.operator_identity,
    worker_allowed_capabilities: workerCapabilities,
    governance_environment: runtimeEnvironment,
    governance_policy: workerGovernancePolicy,
    requested_capabilities: requiredCapabilities,
    n8n_execution_id: parent.n8n_execution_id || normalized.n8n_execution_id || null,
  }),
  blocked_result_summary: compact(\`Approval required before delegated worker execution. \${(parent.risk_reasons || []).join(' ')}\`, 400),
  unsupported_result_summary: compact(\`Delegated execution is not available for \${workerRegistry.visibility_label || delegation.worker_provider || parent.delegated_provider || 'the selected worker'} in the current runtime. The task cannot start automatically in this phase.\`, 400),
} }];`,
      [1248, -208],
    ),
  );

  addNode(
    workflow,
    makePostgresNode(
      "Save Delegated Worker Message",
      `INSERT INTO messages (
  id,
  conversation_id,
  role,
  content,
  content_format,
  model_name,
  metadata,
  created_at
)
VALUES (
  gen_random_uuid(),
  NULLIF($1, '')::uuid,
  'user',
  $2,
  'text',
  NULL,
  $3::jsonb,
  NOW()
)
RETURNING id::text, conversation_id::text, role, content, created_at;`,
      "={{ [$json.worker_conversation_id || '', $json.worker_message_content || '', $json.worker_user_metadata_json || '{}'] }}",
      [1472, -208],
      false,
    ),
  );

  addNode(
    workflow,
    makePostgresNode(
      "Start Delegated Runtime",
      `SELECT
  task_id::text,
  task_run_id::text
FROM public.ghost_start_delegation_runtime(
  NULLIF($1, '')::uuid,
  '${delegatedExecutionTarget}',
  '${workflowName}',
  $2::jsonb,
  $3::jsonb
);`,
      "={{ [$json.delegation_id || '', $json.worker_runtime_input_json || '{}', $json.worker_runtime_context_json || '{}'] }}",
      [2144, -208],
      false,
    ),
  );
}

function assertDelegatedSetupTailContract({ workflow, findNode, assertIncludes }) {
  const buildDelegationRequest = findNode(workflow, "Build Delegation Request");
  const createConversationDelegation = findNode(workflow, "Create Conversation Delegation");
  const buildDelegationContext = findNode(workflow, "Build Delegation Context");
  const saveDelegatedWorkerMessage = findNode(workflow, "Save Delegated Worker Message");
  const buildDelegationExecutionContext = findNode(workflow, "Build Delegation Execution Context");
  const startDelegatedRuntime = findNode(workflow, "Start Delegated Runtime");

  const requestCode = buildDelegationRequest.parameters.jsCode;
  const createQuery = createConversationDelegation.parameters.query;
  const createReplacement = createConversationDelegation.parameters.options.queryReplacement;
  const contextCode = buildDelegationContext.parameters.jsCode;
  const workerMessageReplacement = saveDelegatedWorkerMessage.parameters.options.queryReplacement;
  const executionContextCode = buildDelegationExecutionContext.parameters.jsCode;
  const startQuery = startDelegatedRuntime.parameters.query;
  const startReplacement = startDelegatedRuntime.parameters.options.queryReplacement;

  for (const field of [
    "selectedWorker",
    "delegated_worker_id",
    "delegated_worker_label",
    "delegated_worker_role",
    "delegated_worker_operator_identity",
    "request_title",
    "request_summary",
    "worker_message_content",
    "worker_execution_prompt",
    "delegation_metadata_json",
    "n8n_execution_id",
  ]) {
    assertIncludes(requestCode, field, "Build Delegation Request");
  }

  for (const field of [
    "ghost_create_conversation_delegation",
    "orchestration_task_id::text",
    "worker_conversation_id::text",
  ]) {
    assertIncludes(createQuery, field, "Create Conversation Delegation query");
  }
  for (const field of [
    "parent_message_id",
    "delegated_provider",
    "delegation_metadata_json",
  ]) {
    assertIncludes(createReplacement, field, "Create Conversation Delegation queryReplacement");
  }

  for (const field of [
    "workerId = parent.delegated_worker_id || 'forge'",
    "runtimeEnvironment",
    "workerGovernancePolicy",
    "approval_required: parent.approval_required === true || workerGovernancePolicy.state === 'environment_restricted'",
    "governance_environment",
    "governance_policy",
    "requested_capabilities",
    "orchestration_task_id",
    "worker_conversation_id",
    "worker_registry_id",
    "worker_role",
    "worker_operator_identity",
    "worker_environment_scope",
    "worker_allowed_capabilities",
    "worker_runtime_input_json",
    "worker_runtime_context_json",
    "worker_user_metadata_json",
    "blocked_result_summary",
    "unsupported_result_summary",
  ]) {
    assertIncludes(contextCode, field, "Build Delegation Context");
  }

  for (const field of [
    "worker_conversation_id",
    "worker_message_content",
    "worker_user_metadata_json",
  ]) {
    assertIncludes(workerMessageReplacement, field, "Save Delegated Worker Message queryReplacement");
  }

  assertIncludes(executionContextCode, "worker_user_message_id", "Build Delegation Execution Context");

  for (const field of [
    "ghost_start_delegation_runtime",
    "task_id::text",
    "task_run_id::text",
    "delegated_codex_session",
  ]) {
    assertIncludes(startQuery, field, "Start Delegated Runtime query");
  }
  for (const field of [
    "delegation_id",
    "worker_runtime_input_json",
    "worker_runtime_context_json",
  ]) {
    assertIncludes(startReplacement, field, "Start Delegated Runtime queryReplacement");
  }

  assertHasSingleMainConnection(workflow, "Build Delegation Request", "Create Conversation Delegation");
  assertHasSingleMainConnection(workflow, "Create Conversation Delegation", "Build Delegation Context");
  assertHasSingleMainConnection(workflow, "Build Delegation Context", "Save Delegated Worker Message");
  assertHasSingleMainConnection(workflow, "Save Delegated Worker Message", "Build Delegation Execution Context");
  assertHasSingleMainConnection(workflow, "Start Delegated Runtime", "Build Delegated Codex Context");
}

module.exports = {
  applyDelegatedSetupTailModule,
  assertDelegatedSetupTailContract,
};
