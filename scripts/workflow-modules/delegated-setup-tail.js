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
      `const item = $input.first().json;
const normalized = $('Normalize Input').item.json;
const userMessage = $items('Save User Message', 0, 0)[0]?.json || {};
const compact = (value, limit = 600) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
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
      `const parent = $('Build Delegation Request').item.json;
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
  worker_agent_label: delegation.worker_agent_label || 'Delegated worker',
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
    n8n_execution_id: parent.n8n_execution_id || normalized.n8n_execution_id || null,
  }),
  blocked_result_summary: compact(\`Approval required before delegated worker execution. \${(parent.risk_reasons || []).join(' ')}\`, 400),
  unsupported_result_summary: compact(\`Delegated execution is not available for \${delegation.worker_provider || parent.delegated_provider || 'the selected worker'} in the current runtime. The task cannot start automatically in this phase.\`, 400),
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
    "orchestration_task_id",
    "worker_conversation_id",
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
