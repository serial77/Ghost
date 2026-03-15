"use strict";

function assertHasConnection(workflow, fromNode, toNode, outputIndex = 0) {
  const outputs = workflow.connections[fromNode]?.main || [];
  const output = Array.isArray(outputs[outputIndex]) ? outputs[outputIndex] : [];
  if (!output.some((entry) => entry.node === toNode)) {
    throw new Error(`Delegated-worker contract check failed: missing connection ${fromNode} -> ${toNode}`);
  }
}

function applyDelegatedWorkerRuntimeTailModule({
  workflow,
  findNode,
  addNode,
  makeCodeNode,
  makeId,
  setMainConnections,
}) {
  addNode(
    workflow,
    makeCodeNode(
      "Build Delegated Codex Context",
      `const item = $('Build Delegation Context').item.json;
const runtime = $input.first().json;
return [{ json: {
  ...item,
  task_id: runtime.task_id || '',
  task_run_id: runtime.task_run_id || '',
  conversation_id: item.worker_conversation_id || '',
  selected_model: item.delegated_model || 'gpt-5.4',
  provider: item.delegated_provider || 'codex_oauth_worker',
  provider_used: item.delegated_provider || 'codex_oauth_worker',
  model_used: item.delegated_model || 'gpt-5.4',
  prompt: item.worker_execution_prompt || item.worker_message_content || item.task_summary || '',
  config: item.config || {},
  approval_required: false,
  risk_level: item.risk_level || 'safe',
  risk_reasons: item.risk_reasons || [],
  task_summary: item.task_summary || '',
  n8n_execution_id: item.n8n_execution_id || '',
} }];`,
      [2368, -208],
    ),
  );

  const buildCodexCommand = findNode(workflow, "Build Codex Command");
  buildCodexCommand.parameters.jsCode = buildCodexCommand.parameters.jsCode.replace(
    "if (/^mcp startup:/i.test(line)) return false;",
    "if (/^mcp startup:/i.test(line)) return false; if (/state db returned stale rollout path/i.test(line)) return false; if (/^codex_core::rollout::list:/i.test(line)) return false;",
  );
  addNode(
    workflow,
    {
      ...buildCodexCommand,
      id: makeId("node:Build Delegated Codex Command"),
      name: "Build Delegated Codex Command",
      position: [2592, -208],
    },
  );

  const executeCodexCommand = findNode(workflow, "Execute Codex Command");
  addNode(
    workflow,
    {
      ...executeCodexCommand,
      id: makeId("node:Execute Delegated Codex Command"),
      name: "Execute Delegated Codex Command",
      position: [2816, -208],
    },
  );

  addNode(
    workflow,
    makeCodeNode(
      "Normalize Delegated Codex Reply",
      `const result = $input.first().json;
const context = $('Build Delegated Codex Context').item.json;
const rawStdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
const nodeError = typeof result.error === 'string' ? result.error : (result.error?.message || '');
let payload = {};
let payloadParseFailed = false;
if (rawStdout) {
  try {
    payload = JSON.parse(rawStdout);
  } catch (error) {
    payloadParseFailed = true;
    payload = {
      reply: rawStdout,
      success: false,
      command_exit_code: typeof result.exitCode === 'number' ? result.exitCode : 0,
      stdout_summary: rawStdout.slice(0, 600),
      stderr_summary: typeof result.stderr === 'string' ? result.stderr.trim().slice(0, 600) : '',
      artifact_path: '',
    };
  }
}
const commandExitCode = payload.command_exit_code ?? (typeof result.exitCode === 'number' ? result.exitCode : (nodeError ? 127 : null));
const stderrSummaryBase = payload.stderr_summary || (typeof result.stderr === 'string' ? result.stderr.trim().slice(0, 600) : '') || nodeError.slice(0, 600);
const replyText = typeof payload.reply === 'string' ? payload.reply.trim() : '';
const invalidPayload = payloadParseFailed || !payload || typeof payload !== 'object' || Array.isArray(payload);
const timedOut = /timed?\\s*out|timeout/i.test((nodeError || '') + ' ' + (stderrSummaryBase || ''));
const commandSuccess = Boolean(payload.success) && !invalidPayload && replyText.length > 0;
const derivedErrorType = commandSuccess
  ? ''
  : (timedOut
      ? 'delegated_worker_timeout'
      : (invalidPayload || !replyText.length)
          ? 'delegated_worker_invalid_result'
          : 'codex_command_failed');
const stderrSummary = commandSuccess
  ? stderrSummaryBase
  : (stderrSummaryBase || (invalidPayload
      ? 'Delegated worker returned an invalid result payload.'
      : !replyText.length
          ? 'Delegated worker returned no reply content.'
          : 'Delegated worker execution failed.'));
const failureSuffix = commandExitCode !== undefined && commandExitCode !== null ? \` (exit \${commandExitCode})\` : '';
const failureReason = stderrSummary || 'No additional stderr was captured.';
const reply = commandSuccess ? replyText : \`Delegated worker failed\${failureSuffix}. \${failureReason}\`;
return [{ json: {
  ...context,
  ...result,
  codex_raw_result: payload,
  reply,
  command_success: commandSuccess,
  command_exit_code: commandExitCode,
  stdout_summary: payload.stdout_summary || '',
  stderr_summary: stderrSummary,
  artifact_path: payload.artifact_path || '',
  codex_command_status: commandSuccess ? 'succeeded' : 'failed',
  error_type: derivedErrorType,
  n8n_execution_id: context.n8n_execution_id || null,
  runtime_status: commandSuccess ? 'succeeded' : 'failed',
  result_summary: reply.replace(/\\s+/g, ' ').trim().slice(0, 600),
} }];`,
      [3040, -208],
    ),
  );

  setMainConnections(workflow.connections, "Start Delegated Runtime", [[{ node: "Build Delegated Codex Context" }]]);
  setMainConnections(workflow.connections, "Build Delegated Codex Context", [[{ node: "Build Delegated Codex Command" }]]);
  setMainConnections(workflow.connections, "Build Delegated Codex Command", [[{ node: "Execute Delegated Codex Command" }]]);
  setMainConnections(workflow.connections, "Execute Delegated Codex Command", [[{ node: "Normalize Delegated Codex Reply" }]]);
  setMainConnections(workflow.connections, "Normalize Delegated Codex Reply", [[{ node: "Save Delegated Worker Reply" }]]);
}

function assertDelegatedWorkerRuntimeTailContract({ workflow, findNode, assertIncludes }) {
  const buildDelegatedCodexContext = findNode(workflow, "Build Delegated Codex Context");
  const buildDelegatedCodexCommand = findNode(workflow, "Build Delegated Codex Command");
  const executeDelegatedCodexCommand = findNode(workflow, "Execute Delegated Codex Command");
  const normalizeDelegatedCodexReply = findNode(workflow, "Normalize Delegated Codex Reply");

  const contextCode = buildDelegatedCodexContext.parameters.jsCode;
  const commandCode = buildDelegatedCodexCommand.parameters.jsCode;
  const executeCommand = executeDelegatedCodexCommand.parameters.command;
  const normalizeCode = normalizeDelegatedCodexReply.parameters.jsCode;

  for (const field of [
    "task_id",
    "task_run_id",
    "provider_used",
    "model_used",
    "approval_required: false",
    "n8n_execution_id",
  ]) {
    assertIncludes(contextCode, field, "Build Delegated Codex Context");
  }

  for (const field of [
    "state db returned stale rollout path",
    "codex_core::rollout::list:",
    "codex-safe",
  ]) {
    assertIncludes(commandCode, field, "Build Delegated Codex Command");
  }

  assertIncludes(executeCommand, "={{ $json.codex_command }}", "Execute Delegated Codex Command");

  for (const field of [
    "delegated_worker_timeout",
    "delegated_worker_invalid_result",
    "codex_command_failed",
    "command_success",
    "command_exit_code",
    "stdout_summary",
    "stderr_summary",
    "artifact_path",
    "codex_command_status",
    "runtime_status",
    "result_summary",
  ]) {
    assertIncludes(normalizeCode, field, "Normalize Delegated Codex Reply");
  }

  assertHasConnection(workflow, "Start Delegated Runtime", "Build Delegated Codex Context");
  assertHasConnection(workflow, "Build Delegated Codex Context", "Build Delegated Codex Command");
  assertHasConnection(workflow, "Build Delegated Codex Command", "Execute Delegated Codex Command");
  assertHasConnection(workflow, "Execute Delegated Codex Command", "Normalize Delegated Codex Reply");
  assertHasConnection(workflow, "Normalize Delegated Codex Reply", "Save Delegated Worker Reply");
}

module.exports = {
  applyDelegatedWorkerRuntimeTailModule,
  assertDelegatedWorkerRuntimeTailContract,
};
