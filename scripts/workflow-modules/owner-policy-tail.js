"use strict";

function assertHasConnection(workflow, fromNode, toNode, outputIndex = 0) {
  const outputs = workflow.connections[fromNode]?.main || [];
  const output = Array.isArray(outputs[outputIndex]) ? outputs[outputIndex] : [];
  if (!output.some((entry) => entry.node === toNode)) {
    throw new Error(`Owner-policy contract check failed: missing connection ${fromNode} -> ${toNode}`);
  }
}

function applyOwnerPolicyTailModule({ workflow, addNode, makePostgresNode, makeCodeNode }) {
  addNode(
    workflow,
    makePostgresNode(
      "Ensure Conversation Owner",
      `SELECT
  conversation_id::text,
  owner_agent_id::text,
  owner_agent_key,
  owner_label,
  owner_provider,
  owner_model,
  owner_locked_at,
  owner_was_created
FROM public.ghost_ensure_conversation_owner(
  NULLIF($1, '')::uuid
);`,
      "={{ [$json.conversation_id || ''] }}",
      [-2420, -96],
      false,
    ),
  );

  addNode(
    workflow,
    makeCodeNode(
      "Conversation Context With Owner",
      `const context = $('Conversation Context').item.json;
const owner = $input.first().json;
return [{ json: { ...context, ...owner } }];`,
      [-2196, -96],
    ),
  );

  addNode(
    workflow,
    makeCodeNode(
      "Resolve Parent Conversation Strategy",
      `const item = $input.first().json;
const owner = $items('Ensure Conversation Owner', 0, 0)[0]?.json || {};
const taskClass = item.task_class || item.request_type || 'chat';
const parentProvider = String(owner.owner_provider || item.provider || 'ollama').trim() || 'ollama';
const parentModel = String(owner.owner_model || item.selected_model || 'qwen3:14b').trim() || 'qwen3:14b';
const delegatedProvider = String(item.provider || '').trim();
const delegatedModel = String(item.selected_model || '').trim();
const delegationRequired = taskClass === 'technical_work';
return [{ json: {
  ...item,
  task_class: taskClass,
  parent_owner_agent_id: owner.owner_agent_id || '',
  parent_owner_agent_key: owner.owner_agent_key || 'ghost-main',
  parent_owner_label: owner.owner_label || 'Ghost',
  parent_provider: parentProvider,
  parent_model: parentModel,
  delegated_provider: delegatedProvider,
  delegated_model: delegatedModel,
  delegation_required: delegationRequired,
  provider: parentProvider,
  selected_model: parentModel,
  owner_locked_at: owner.owner_locked_at || '',
  n8n_execution_id: $('Normalize Input').item.json.n8n_execution_id || item.n8n_execution_id || '',
} }];`,
      [352, -64],
    ),
  );
}

function assertOwnerPolicyTailContract({ workflow, findNode, assertIncludes }) {
  const ensureConversationOwner = findNode(workflow, "Ensure Conversation Owner");
  const conversationContextWithOwner = findNode(workflow, "Conversation Context With Owner");
  const assessApprovalRisk = findNode(workflow, "Assess Approval Risk");
  const resolveParentConversationStrategy = findNode(workflow, "Resolve Parent Conversation Strategy");

  const ensureQuery = ensureConversationOwner.parameters.query;
  const ensureReplacement = ensureConversationOwner.parameters.options.queryReplacement;
  const contextWithOwnerCode = conversationContextWithOwner.parameters.jsCode;
  const assessApprovalRiskCode = assessApprovalRisk.parameters.jsCode;
  const resolveCode = resolveParentConversationStrategy.parameters.jsCode;

  for (const field of [
    "ghost_ensure_conversation_owner",
    "owner_agent_id::text",
    "owner_provider",
    "owner_model",
    "owner_locked_at",
  ]) {
    assertIncludes(ensureQuery, field, "Ensure Conversation Owner query");
  }
  assertIncludes(ensureReplacement, "conversation_id", "Ensure Conversation Owner queryReplacement");

  for (const field of [
    "$('Conversation Context').item.json",
    "...context",
    "...owner",
  ]) {
    assertIncludes(contextWithOwnerCode, field, "Conversation Context With Owner");
  }

  for (const field of [
    "riskLevel",
    "risk_reasons",
    "approval_required",
  ]) {
    assertIncludes(assessApprovalRiskCode, field, "Assess Approval Risk");
  }

  for (const field of [
    "task_class",
    "parent_owner_agent_id",
    "parent_owner_agent_key",
    "parent_owner_label",
    "parent_provider",
    "parent_model",
    "delegated_provider",
    "delegated_model",
    "delegation_required",
    "provider: parentProvider",
    "selected_model: parentModel",
    "owner_locked_at",
    "n8n_execution_id",
  ]) {
    assertIncludes(resolveCode, field, "Resolve Parent Conversation Strategy");
  }

  assertHasConnection(workflow, "Conversation Context", "Ensure Conversation Owner");
  assertHasConnection(workflow, "Ensure Conversation Owner", "Conversation Context With Owner");
  assertHasConnection(workflow, "Conversation Context With Owner", "Save User Message");
  assertHasConnection(workflow, "Conversation Context With Owner", "Build Runtime Ledger Start Payload");
  assertHasConnection(workflow, "Assess Approval Risk", "Resolve Parent Conversation Strategy");
  assertHasConnection(workflow, "Resolve Parent Conversation Strategy", "Delegation Required?");
}

module.exports = {
  applyOwnerPolicyTailModule,
  assertOwnerPolicyTailContract,
};
