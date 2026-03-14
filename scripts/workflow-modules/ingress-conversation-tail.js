"use strict";

function assertHasConnection(workflow, fromNode, toNode, outputIndex = 0) {
  const outputs = workflow.connections[fromNode]?.main || [];
  const output = Array.isArray(outputs[outputIndex]) ? outputs[outputIndex] : [];
  if (!output.some((entry) => entry.node === toNode)) {
    throw new Error(`Ingress contract check failed: missing connection ${fromNode} -> ${toNode}`);
  }
}

function applyIngressConversationTailModule({ workflow, findNode, ensureAssignment, makeId }) {
  const normalizeInput = findNode(workflow, "Normalize Input");
  ensureAssignment(normalizeInput, {
    id: makeId("assignment:Normalize Input:entrypoint"),
    name: "entrypoint",
    value: "={{ $json.headers['x-ghost-entry-point'] || $json.headers['X-Ghost-Entry-Point'] || 'direct_webhook' }}",
    type: "string",
  });
  ensureAssignment(normalizeInput, {
    id: makeId("assignment:Normalize Input:n8n_execution_id"),
    name: "n8n_execution_id",
    value: "={{ $execution?.id || $executionId || '' }}",
    type: "string",
  });

  const exposeRouteMetadata = findNode(workflow, "Expose Route Metadata");
  ensureAssignment(exposeRouteMetadata, {
    id: makeId("assignment:Expose Route Metadata:n8n_execution_id"),
    name: "n8n_execution_id",
    value: "={{ $('Normalize Input').item.json.n8n_execution_id || $execution?.id || $executionId || '' }}",
    type: "string",
  });

  const saveUserMessage = findNode(workflow, "Save User Message");
  saveUserMessage.parameters.options.queryReplacement =
    "={{ [$json.conversation_id, $('Normalize Input').item.json.message, JSON.stringify({ source: 'ghost-runtime', type: 'user_message', entrypoint: $('Normalize Input').item.json.entrypoint || 'direct_webhook', n8n_execution_id: $('Normalize Input').item.json.n8n_execution_id || null })] }}";
}

function assertIngressConversationTailContract({ workflow, findNode, assertIncludes }) {
  const normalizeInput = findNode(workflow, "Normalize Input");
  const findConversationById = findNode(workflow, "Find Conversation By ID");
  const createNewConversation = findNode(workflow, "Create New Conversation");
  const saveUserMessage = findNode(workflow, "Save User Message");
  const loadRecentMessages = findNode(workflow, "Load Recent Messages");
  const exposeRouteMetadata = findNode(workflow, "Expose Route Metadata");

  const normalizeAssignments = JSON.stringify(normalizeInput.parameters.assignments.assignments);
  const findConversationQuery = findConversationById.parameters.query;
  const createConversationQuery = createNewConversation.parameters.query;
  const createConversationReplacement = createNewConversation.parameters.options.queryReplacement;
  const saveUserMessageReplacement = saveUserMessage.parameters.options.queryReplacement;
  const recentMessagesQuery = loadRecentMessages.parameters.query;
  const routeAssignments = JSON.stringify(exposeRouteMetadata.parameters.assignments.assignments);

  for (const field of [
    "\"name\":\"conversation_id\"",
    "\"name\":\"message\"",
    "\"name\":\"user_id\"",
    "\"name\":\"entrypoint\"",
    "\"name\":\"n8n_execution_id\"",
  ]) {
    assertIncludes(normalizeAssignments, field, "Normalize Input assignments");
  }

  for (const field of [
    "FROM conversations",
    "WHERE id = NULLIF($1, '')::uuid",
    "UNION ALL",
  ]) {
    assertIncludes(findConversationQuery, field, "Find Conversation By ID query");
  }

  for (const field of [
    "INSERT INTO conversations",
    "RETURNING id AS conversation_id",
  ]) {
    assertIncludes(createConversationQuery, field, "Create New Conversation query");
  }
  for (const field of [
    "'Ghost Chat'",
    "'ghost-runtime'",
    "'active'",
  ]) {
    assertIncludes(createConversationReplacement, field, "Create New Conversation queryReplacement");
  }

  for (const field of [
    "source: 'ghost-runtime'",
    "entrypoint: $('Normalize Input').item.json.entrypoint || 'direct_webhook'",
    "n8n_execution_id: $('Normalize Input').item.json.n8n_execution_id || null",
  ]) {
    assertIncludes(saveUserMessageReplacement, field, "Save User Message queryReplacement");
  }

  for (const field of [
    "FROM messages",
    "WHERE conversation_id = $1",
    "LIMIT 12",
  ]) {
    assertIncludes(recentMessagesQuery, field, "Load Recent Messages query");
  }

  for (const field of [
    "\"name\":\"provider_used\"",
    "\"name\":\"model_used\"",
    "\"name\":\"conversation_id\"",
    "\"name\":\"n8n_execution_id\"",
  ]) {
    assertIncludes(routeAssignments, field, "Expose Route Metadata assignments");
  }

  assertHasConnection(workflow, "Incoming chat", "Normalize Input");
  assertHasConnection(workflow, "Incoming chat (runtime)", "Normalize Input");
  assertHasConnection(workflow, "Normalize Input", "Find Conversation By ID");
  assertHasConnection(workflow, "Find Conversation By ID", "Conversation Exists?");
  assertHasConnection(workflow, "Conversation Exists?", "Create New Conversation", 1);
  assertHasConnection(workflow, "Conversation Exists?", "Use Existing Conversation Context", 0);
  assertHasConnection(workflow, "Create New Conversation", "Conversation Context");
  assertHasConnection(workflow, "Use Existing Conversation Context", "Conversation Context");
  assertHasConnection(workflow, "Conversation Context", "Ensure Conversation Owner");
  assertHasConnection(workflow, "Save User Message", "Touch Conversation Timestamp");
  assertHasConnection(workflow, "Touch Conversation Timestamp", "Load Recent Messages");
}

module.exports = {
  applyIngressConversationTailModule,
  assertIngressConversationTailContract,
};
