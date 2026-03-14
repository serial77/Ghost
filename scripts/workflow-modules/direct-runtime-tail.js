"use strict";

function applyDirectRuntimeTailModule({ workflow, findNode, addNode, makePostgresNode }) {
  const buildApiResponse = findNode(workflow, "Build API Response");
  // Phase 6A extraction boundary:
  // This node remains the canonical direct owner reply contract. The extracted tail
  // module owns the direct API response, assistant persistence metadata contract,
  // runtime completion payload, and direct tool_event annotation semantics together.
  buildApiResponse.parameters.jsCode = `const item = $input.first().json;
const asText = (value) => value === undefined || value === null ? '' : String(value).trim();
const summarize = (value) => asText(value).replace(/\\s+/g, ' ').trim().slice(0, 600);
const normalizeExitCode = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : asText(value);
};
const normalizeNullableBoolean = (value) => (
  value === undefined || value === null || value === '' ? null : Boolean(value)
);
const normalizeArray = (value) => Array.isArray(value) ? value : [];
const normalizeObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : null
);
return [{ json: {
  conversation_id: asText(item.conversation_id),
  reply: asText(item.reply),
  provider_used: asText(item.provider_used),
  model_used: asText(item.model_used),
  task_class: asText(item.task_class),
  approval_required: Boolean(item.approval_required),
  risk_level: asText(item.risk_level) || 'safe',
  risk_reasons: normalizeArray(item.risk_reasons),
  approval_item: normalizeObject(item.approval_item),
  governance_policy: normalizeObject(item.governance_policy),
  governance_environment: asText(item.governance_environment) || null,
  requested_capabilities: normalizeArray(item.requested_capabilities),
  task_summary: summarize(item.task_summary),
  command_success: normalizeNullableBoolean(item.command_success),
  command_exit_code: normalizeExitCode(item.command_exit_code),
  stdout_summary: summarize(item.stdout_summary),
  stderr_summary: summarize(item.stderr_summary),
  artifact_path: asText(item.artifact_path) || null,
  codex_command_status: asText(item.codex_command_status) || 'not_applicable',
  error_type: asText(item.error_type) || null,
  delegation_id: asText(item.delegation_id) || null,
  orchestration_task_id: asText(item.orchestration_task_id) || null,
  runtime_task_id: asText(item.runtime_task_id) || null,
  runtime_task_run_id: asText(item.runtime_task_run_id) || null,
  worker_conversation_id: asText(item.worker_conversation_id) || null,
  n8n_execution_id: asText(item.n8n_execution_id) || null,
  response_mode: asText(item.response_mode) || 'direct_owner_reply',
  parent_owner_label: asText(item.parent_owner_label) || null,
} }];`;

  const saveAssistantReply = findNode(workflow, "Save Assistant Reply");
  // The parent assistant message remains the persisted operator/debug surface for the
  // direct path. The extracted tail must preserve the full direct contract here.
  saveAssistantReply.parameters.options.queryReplacement =
    "={{ [$json.conversation_id, $json.reply, $json.model_used || null, { provider_used: $json.provider_used || null, task_class: $json.task_class || null, approval_required: $json.approval_required || false, risk_level: $json.risk_level || 'safe', risk_reasons: $json.risk_reasons || [], approval_item: $json.approval_item || null, governance_policy: $json.governance_policy || null, governance_environment: $json.governance_environment || null, requested_capabilities: $json.requested_capabilities || [], task_summary: $json.task_summary || '', command_success: $json.command_success === true, command_exit_code: $json.command_exit_code !== undefined && $json.command_exit_code !== null ? $json.command_exit_code : null, stdout_summary: $json.stdout_summary || '', stderr_summary: $json.stderr_summary || '', artifact_path: $json.artifact_path || null, codex_command_status: $json.codex_command_status || 'not_applicable', error_type: $json.error_type || null, delegation_id: $json.delegation_id || null, orchestration_task_id: $json.orchestration_task_id || null, runtime_task_id: $json.runtime_task_id || null, runtime_task_run_id: $json.runtime_task_run_id || null, worker_conversation_id: $json.worker_conversation_id || null, n8n_execution_id: $json.n8n_execution_id || null, response_mode: $json.response_mode || 'direct_owner_reply', parent_owner_label: $json.parent_owner_label || null }] }}";

  const buildRuntimeLedgerCompletionPayload = findNode(workflow, "Build Runtime Ledger Completion Payload");
  // task_runs.output_payload and the direct completion tool_event must keep sharing
  // the same core execution fields so reconciliation can compare surfaces directly.
  buildRuntimeLedgerCompletionPayload.parameters.jsCode = `const item = $input.first().json;
const startRows = $items('Start Runtime Ledger', 0, 0);
const started = startRows[0]?.json || {};
const normalized = $('Normalize Input').item.json;
return [{ json: {
  task_id: started.task_id || '',
  task_run_id: started.task_run_id || '',
  output_payload_json: JSON.stringify(item),
  conversation_id: item.conversation_id || '',
  task_class: item.task_class || '',
  provider_used: item.provider_used || '',
  model_used: item.model_used || '',
  approval_required: item.approval_required === true,
  command_success: item.command_success === undefined ? null : item.command_success,
  command_exit_code: item.command_exit_code === undefined ? null : item.command_exit_code,
  error_type: item.error_type || '',
  task_summary: item.task_summary || '',
  artifact_path: item.artifact_path || '',
  stdout_summary: item.stdout_summary || '',
  stderr_summary: item.stderr_summary || '',
  codex_command_status: item.codex_command_status || 'not_applicable',
  n8n_execution_id: item.n8n_execution_id || normalized.n8n_execution_id || '',
  entrypoint: normalized.entrypoint || 'direct_webhook',
  response_mode: item.response_mode || 'direct_owner_reply',
  parent_owner_label: item.parent_owner_label || 'Ghost',
} }];`;

  addNode(
    workflow,
    makePostgresNode(
      "Annotate Direct Runtime Event",
      `WITH target_event AS (
  SELECT id
  FROM tool_events
  WHERE task_id = NULLIF($1, '')::uuid
  ORDER BY created_at DESC, id DESC
  LIMIT 1
)
UPDATE tool_events AS te
SET
  task_run_id = COALESCE(te.task_run_id, NULLIF($2, '')::uuid),
  payload = COALESCE(te.payload, '{}'::jsonb) || jsonb_build_object(
    'n8n_execution_id', NULLIF($3, ''),
    'entrypoint', NULLIF($4, ''),
    'response_mode', NULLIF($5, ''),
    'parent_owner_label', NULLIF($6, ''),
    'provider_used', NULLIF($7, ''),
    'model_used', NULLIF($8, ''),
    'task_class', NULLIF($9, ''),
    'command_success', $10,
    'command_exit_code', $11,
    'error_type', NULLIF($12, ''),
    'stdout_summary', NULLIF($13, ''),
    'stderr_summary', NULLIF($14, ''),
    'artifact_path', NULLIF($15, ''),
    'codex_command_status', NULLIF($16, ''),
    'direct_execution', TRUE
  )
FROM target_event
WHERE te.id = target_event.id
RETURNING te.id::text AS tool_event_id;`,
      "={{ [$json.task_id || '', $json.task_run_id || '', $json.n8n_execution_id || '', $json.entrypoint || 'direct_webhook', $json.response_mode || 'direct_owner_reply', $json.parent_owner_label || 'Ghost', $json.provider_used || '', $json.model_used || '', $json.task_class || '', $json.command_success, $json.command_exit_code !== undefined ? $json.command_exit_code : null, $json.error_type || '', $json.stdout_summary || '', $json.stderr_summary || '', $json.artifact_path || '', $json.codex_command_status || 'not_applicable'] }}",
      [2032, 96],
      false,
    ),
  );
}

function assertDirectRuntimeTailContract({ workflow, findNode, assertIncludes }) {
  const buildApiResponse = findNode(workflow, "Build API Response");
  const saveAssistantReply = findNode(workflow, "Save Assistant Reply");
  const normalizeCodexReply = findNode(workflow, "Normalize Codex Reply");
  const buildRuntimeLedgerCompletionPayload = findNode(workflow, "Build Runtime Ledger Completion Payload");
  const annotateDirectRuntimeEvent = findNode(workflow, "Annotate Direct Runtime Event");

  const apiCode = buildApiResponse.parameters.jsCode;
  const assistantMetadata = saveAssistantReply.parameters.options.queryReplacement;
  const codexCode = normalizeCodexReply.parameters.jsCode;
  const completionPayloadCode = buildRuntimeLedgerCompletionPayload.parameters.jsCode;
  const directEventQuery = annotateDirectRuntimeEvent.parameters.query;
  const directEventReplacement = annotateDirectRuntimeEvent.parameters.options.queryReplacement;

  const coreFields = [
    "response_mode",
    "parent_owner_label",
    "approval_item",
    "governance_policy",
    "governance_environment",
    "requested_capabilities",
    "provider_used",
    "model_used",
    "task_class",
    "n8n_execution_id",
    "runtime_task_id",
    "runtime_task_run_id",
    "command_success",
    "command_exit_code",
    "error_type",
    "stdout_summary",
    "stderr_summary",
    "artifact_path",
    "codex_command_status",
  ];

  for (const field of coreFields) {
    assertIncludes(apiCode, field, "Build API Response");
    assertIncludes(assistantMetadata, field, "Save Assistant Reply metadata");
  }

  for (const field of [
    "runtime_task_id",
    "runtime_task_run_id",
    "n8n_execution_id",
    "response_mode",
    "parent_owner_label",
    "command_success",
    "command_exit_code",
    "error_type",
    "stdout_summary",
    "stderr_summary",
    "artifact_path",
    "codex_command_status",
  ]) {
    assertIncludes(codexCode, field, "Normalize Codex Reply");
  }

  for (const field of [
    "task_id",
    "task_run_id",
    "provider_used",
    "model_used",
    "task_class",
    "command_success",
    "command_exit_code",
    "error_type",
    "stdout_summary",
    "stderr_summary",
    "artifact_path",
    "codex_command_status",
    "n8n_execution_id",
    "response_mode",
    "parent_owner_label",
  ]) {
    assertIncludes(completionPayloadCode, field, "Build Runtime Ledger Completion Payload");
  }

  for (const field of [
    "'direct_execution', TRUE",
    "'n8n_execution_id'",
    "'response_mode'",
    "'parent_owner_label'",
    "'provider_used'",
    "'model_used'",
    "'task_class'",
    "'command_success'",
    "'command_exit_code'",
    "'error_type'",
    "'stdout_summary'",
    "'stderr_summary'",
    "'artifact_path'",
    "'codex_command_status'",
  ]) {
    assertIncludes(directEventQuery, field, "Annotate Direct Runtime Event query");
  }

  for (const field of [
    "task_id",
    "task_run_id",
    "n8n_execution_id",
    "response_mode",
    "parent_owner_label",
    "provider_used",
    "model_used",
    "task_class",
    "command_success",
    "command_exit_code",
    "error_type",
    "stdout_summary",
    "stderr_summary",
    "artifact_path",
    "codex_command_status",
  ]) {
    assertIncludes(directEventReplacement, field, "Annotate Direct Runtime Event queryReplacement");
  }
}

module.exports = {
  applyDirectRuntimeTailModule,
  assertDirectRuntimeTailContract,
};
