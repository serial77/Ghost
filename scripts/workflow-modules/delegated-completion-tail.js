"use strict";

function assertHasSingleMainConnection(workflow, fromNode, toNode) {
  const outputs = workflow.connections[fromNode]?.main || [];
  const firstOutput = Array.isArray(outputs[0]) ? outputs[0] : [];
  if (!firstOutput.some((entry) => entry.node === toNode)) {
    throw new Error(`Delegated-tail contract check failed: missing connection ${fromNode} -> ${toNode}`);
  }
}

function applyDelegatedCompletionTailModule({ workflow, addNode, makeCodeNode, makePostgresNode, delegatedExecutionTarget }) {
  addNode(
    workflow,
    makePostgresNode(
      "Save Delegated Worker Reply",
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
  'assistant',
  $2,
  'text',
  $3,
  $4::jsonb,
  NOW()
)
RETURNING id::text, conversation_id::text, role, content, created_at;`,
      "={{ [$json.worker_conversation_id || '', $json.reply || '', $json.model_used || null, { provider_used: $json.provider_used || null, task_class: 'delegated_worker_task', delegation_id: $json.delegation_id || null, orchestration_task_id: $json.orchestration_task_id || null, runtime_task_id: $json.task_id || null, runtime_task_run_id: $json.task_run_id || null, command_success: $json.command_success === true, command_exit_code: $json.command_exit_code !== undefined && $json.command_exit_code !== null ? $json.command_exit_code : null, stdout_summary: $json.stdout_summary || '', stderr_summary: $json.stderr_summary || '', artifact_path: $json.artifact_path || null, codex_command_status: $json.codex_command_status || 'not_applicable', error_type: $json.error_type || null, n8n_execution_id: $json.n8n_execution_id || null, worker_execution: true }] }}",
      [3264, -208],
      false,
    ),
  );

  addNode(
    workflow,
    makeCodeNode(
      "Build Delegated Completion Context",
      `const worker = $('Normalize Delegated Codex Reply').item.json;
const saved = $input.first().json;
return [{ json: {
  ...worker,
  worker_assistant_message_id: saved.id || '',
} }];`,
      [3376, -208],
    ),
  );

  addNode(
    workflow,
    makePostgresNode(
      "Complete Delegated Runtime",
      `WITH runtime_ledger AS (
  SELECT public.ghost_runtime_complete_task_ledger(
    NULLIF($1, '')::uuid,
    NULLIF($2, '')::uuid,
    200,
    $3::jsonb,
    NULLIF($4, '')::uuid,
    'delegated_worker_task',
    NULLIF($5, ''),
    NULLIF($6, ''),
    FALSE,
    $7,
    NULLIF($8, ''),
    NULLIF($9, ''),
    NULLIF($10, ''),
    '${delegatedExecutionTarget}'
  ) AS runtime_completed
),
delegation_finalized AS (
  SELECT public.ghost_finalize_delegation(
    NULLIF($11, '')::uuid,
    NULLIF($1, '')::uuid,
    NULLIF($12, ''),
    $13,
    NULLIF($10, '')
  ) AS delegation_completed
)
SELECT runtime_completed, delegation_completed
FROM runtime_ledger, delegation_finalized;`,
      "={{ [$json.task_id || '', $json.task_run_id || '', JSON.stringify($json), $json.worker_conversation_id || '', $json.provider_used || '', $json.model_used || '', $json.command_success === true, $json.error_type || '', $json.task_summary || '', $json.artifact_path || '', $json.delegation_id || '', $json.runtime_status || 'failed', $json.result_summary || ''] }}",
      [3488, -208],
      false,
    ),
  );

  addNode(
    workflow,
    makePostgresNode(
      "Annotate Delegation Completion Event",
      `WITH target_event AS (
  SELECT id
  FROM tool_events
  WHERE task_id = NULLIF($1, '')::uuid
    AND event_type = 'delegation_completed'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
)
UPDATE tool_events AS te
SET
  task_run_id = COALESCE(te.task_run_id, NULLIF($2, '')::uuid),
  payload = COALESCE(te.payload, '{}'::jsonb) || jsonb_build_object(
    'task_run_id', NULLIF($2, ''),
    'n8n_execution_id', NULLIF($3, ''),
    'command_success', $4,
    'command_exit_code', $5,
    'error_type', NULLIF($6, ''),
    'stdout_summary', NULLIF($7, ''),
    'stderr_summary', NULLIF($8, ''),
    'artifact_path', NULLIF($9, ''),
    'codex_command_status', NULLIF($10, '')
  )
FROM target_event
WHERE te.id = target_event.id
RETURNING te.id::text AS tool_event_id;`,
      "={{ [$json.task_id || '', $json.task_run_id || '', $json.n8n_execution_id || '', $json.command_success === true, $json.command_exit_code !== undefined && $json.command_exit_code !== null ? $json.command_exit_code : null, $json.error_type || '', $json.stdout_summary || '', $json.stderr_summary || '', $json.artifact_path || '', $json.codex_command_status || 'not_applicable'] }}",
      [3712, -208],
      false,
    ),
  );

  addNode(
    workflow,
    makeCodeNode(
      "Build Parent Delegation Response",
      `const item = $('Normalize Delegated Codex Reply').item.json;
const parent = $('Build Delegation Context').item.json;
const workerLabel = parent.worker_agent_label || 'Codex Worker';
const failureLabel = item.error_type === 'delegated_worker_timeout'
  ? 'timed out'
  : item.error_type === 'delegated_worker_invalid_result'
    ? 'returned an invalid result'
    : 'reported a failure';
const summary = item.command_success
  ? \`\${parent.parent_owner_label || 'Ghost'} delegated this work to \${workerLabel} in a separate worker session and kept the parent conversation under Ghost ownership.\`
  : \`\${parent.parent_owner_label || 'Ghost'} delegated this work to \${workerLabel}, but the worker session \${failureLabel}.\`;
const workerBlock = item.reply ? \`Worker result:\\n\${item.reply}\` : (item.stderr_summary || 'No additional worker output was captured.');
return [{ json: {
  conversation_id: parent.conversation_id || '',
  reply: [summary, workerBlock].join('\\n\\n'),
  provider_used: parent.parent_provider || '',
  model_used: parent.parent_model || '',
  task_class: parent.task_class || 'technical_work',
  approval_required: false,
  risk_level: parent.risk_level || 'safe',
  risk_reasons: parent.risk_reasons || [],
  task_summary: parent.task_summary || '',
  command_success: item.command_success === true,
  command_exit_code: item.command_exit_code !== undefined ? item.command_exit_code : null,
  stdout_summary: item.stdout_summary || '',
  stderr_summary: item.stderr_summary || '',
  artifact_path: item.artifact_path || '',
  codex_command_status: item.codex_command_status || 'not_applicable',
  error_type: item.error_type || null,
  delegation_id: parent.delegation_id || '',
  orchestration_task_id: parent.orchestration_task_id || '',
  runtime_task_id: item.task_id || '',
  runtime_task_run_id: item.task_run_id || '',
  worker_conversation_id: parent.worker_conversation_id || '',
  n8n_execution_id: parent.n8n_execution_id || item.n8n_execution_id || null,
  response_mode: 'delegated_worker_result',
  parent_owner_label: parent.parent_owner_label || 'Ghost',
} }];`,
      [3936, -208],
    ),
  );
}

function assertDelegatedCompletionTailContract({ workflow, findNode, assertIncludes }) {
  const saveDelegatedWorkerReply = findNode(workflow, "Save Delegated Worker Reply");
  const buildDelegatedCompletionContext = findNode(workflow, "Build Delegated Completion Context");
  const completeDelegatedRuntime = findNode(workflow, "Complete Delegated Runtime");
  const annotateDelegationCompletionEvent = findNode(workflow, "Annotate Delegation Completion Event");
  const buildParentDelegationResponse = findNode(workflow, "Build Parent Delegation Response");
  const normalizeDelegatedCodexReply = findNode(workflow, "Normalize Delegated Codex Reply");

  const workerMetadata = saveDelegatedWorkerReply.parameters.options.queryReplacement;
  const completionContextCode = buildDelegatedCompletionContext.parameters.jsCode;
  const completeRuntimeQuery = completeDelegatedRuntime.parameters.query;
  const completeRuntimeReplacement = completeDelegatedRuntime.parameters.options.queryReplacement;
  const annotateQuery = annotateDelegationCompletionEvent.parameters.query;
  const annotateReplacement = annotateDelegationCompletionEvent.parameters.options.queryReplacement;
  const parentResponseCode = buildParentDelegationResponse.parameters.jsCode;
  const delegatedNormalizeCode = normalizeDelegatedCodexReply.parameters.jsCode;

  for (const field of [
    "runtime_task_id: $json.task_id || null",
    "runtime_task_run_id: $json.task_run_id || null",
    "command_success",
    "command_exit_code",
    "stderr_summary",
    "artifact_path",
    "codex_command_status",
    "error_type",
    "n8n_execution_id",
    "worker_execution: true",
  ]) {
    assertIncludes(workerMetadata, field, "Save Delegated Worker Reply metadata");
  }

  assertIncludes(completionContextCode, "worker_assistant_message_id", "Build Delegated Completion Context");

  for (const field of [
    "ghost_runtime_complete_task_ledger",
    "ghost_finalize_delegation",
    "'delegated_worker_task'",
    "delegatedExecutionTarget",
  ]) {
    assertIncludes(completeRuntimeQuery, field === "delegatedExecutionTarget" ? "delegated_codex_session" : field, "Complete Delegated Runtime query");
  }

  for (const field of [
    "task_id",
    "task_run_id",
    "JSON.stringify($json)",
    "command_success === true",
    "error_type",
    "artifact_path",
    "delegation_id",
    "runtime_status",
    "result_summary",
  ]) {
    assertIncludes(completeRuntimeReplacement, field, "Complete Delegated Runtime queryReplacement");
  }

  for (const field of [
    "'task_run_id'",
    "'n8n_execution_id'",
    "'command_success'",
    "'command_exit_code'",
    "'error_type'",
    "'stdout_summary'",
    "'stderr_summary'",
    "'artifact_path'",
    "'codex_command_status'",
  ]) {
    assertIncludes(annotateQuery, field, "Annotate Delegation Completion Event query");
  }

  for (const field of [
    "task_id",
    "task_run_id",
    "n8n_execution_id",
    "command_success === true",
    "command_exit_code",
    "error_type",
    "stdout_summary",
    "stderr_summary",
    "artifact_path",
    "codex_command_status",
  ]) {
    assertIncludes(annotateReplacement, field, "Annotate Delegation Completion Event queryReplacement");
  }

  for (const field of [
    "delegated_worker_timeout",
    "delegated_worker_invalid_result",
    "command_success: item.command_success === true",
    "command_exit_code",
    "stderr_summary",
    "artifact_path",
    "codex_command_status",
    "error_type",
    "runtime_task_id: item.task_id || ''",
    "runtime_task_run_id: item.task_run_id || ''",
    "response_mode: 'delegated_worker_result'",
    "n8n_execution_id",
  ]) {
    assertIncludes(parentResponseCode, field, "Build Parent Delegation Response");
  }

  for (const field of [
    "command_success",
    "command_exit_code",
    "stdout_summary",
    "stderr_summary",
    "artifact_path",
    "codex_command_status",
    "error_type",
    "runtime_status",
    "result_summary",
  ]) {
    assertIncludes(delegatedNormalizeCode, field, "Normalize Delegated Codex Reply");
  }

  assertHasSingleMainConnection(workflow, "Normalize Delegated Codex Reply", "Save Delegated Worker Reply");
  assertHasSingleMainConnection(workflow, "Save Delegated Worker Reply", "Build Delegated Completion Context");
  assertHasSingleMainConnection(workflow, "Build Delegated Completion Context", "Complete Delegated Runtime");
  assertHasSingleMainConnection(workflow, "Complete Delegated Runtime", "Annotate Delegation Completion Event");
  assertHasSingleMainConnection(workflow, "Annotate Delegation Completion Event", "Build Parent Delegation Response");
  assertHasSingleMainConnection(workflow, "Build Parent Delegation Response", "Build API Response");
}

module.exports = {
  applyDelegatedCompletionTailModule,
  assertDelegatedCompletionTailContract,
};
