const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  applyDirectRuntimeTailModule,
  assertDirectRuntimeTailContract,
} = require("./workflow-modules/direct-runtime-tail");
const {
  applyMemoryExtractionTailModule,
  assertMemoryExtractionTailContract,
} = require("./workflow-modules/memory-extraction-tail");
const {
  applyDelegatedCompletionTailModule,
  assertDelegatedCompletionTailContract,
} = require("./workflow-modules/delegated-completion-tail");
const {
  applyDelegatedControlTailModule,
  assertDelegatedControlTailContract,
} = require("./workflow-modules/delegated-control-tail");
const {
  applyDelegatedSetupTailModule,
  assertDelegatedSetupTailContract,
} = require("./workflow-modules/delegated-setup-tail");
const {
  applyIngressConversationTailModule,
  assertIngressConversationTailContract,
} = require("./workflow-modules/ingress-conversation-tail");
const {
  applyOwnerPolicyTailModule,
  assertOwnerPolicyTailContract,
} = require("./workflow-modules/owner-policy-tail");

const projectRoot = path.join(__dirname, "..");
const sourcePath = path.join(projectRoot, "workflows", "ghost-chat-v3-phase5d-runtime-ledger.json");
const targetPath = path.join(projectRoot, "workflows", "ghost-chat-v3-phase5gd-openclaw.json");
const postgresCredential = {
  id: "r4pH8PimgUf2t9oM",
  name: "Postgres account",
};
const workflowName = "GHOST by Codex";
const parentExecutionTarget = "webhook/ghost-chat-v3";
const delegatedExecutionTarget = "delegated_codex_session";

function makeId(label) {
  if (!label) {
    throw new Error("makeId requires a stable label");
  }
  const digest = crypto.createHash("md5").update(`phase5gd:${label}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function loadWorkflow(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw) || raw.length !== 1) {
    throw new Error(`Expected single-workflow array in ${filePath}`);
  }
  return raw;
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) {
    throw new Error(`Missing node: ${name}`);
  }
  return node;
}

function addNode(workflow, node) {
  const existingIndex = workflow.nodes.findIndex((entry) => entry.name === node.name);
  if (existingIndex >= 0) {
    workflow.nodes[existingIndex] = node;
    return;
  }
  workflow.nodes.push(node);
}

function removeNode(workflow, name) {
  workflow.nodes = workflow.nodes.filter((entry) => entry.name !== name);
  delete workflow.connections[name];
}

function ensureAssignment(node, assignment) {
  const assignments = node.parameters.assignments.assignments;
  const existing = assignments.find((entry) => entry.name === assignment.name);
  if (existing) {
    Object.assign(existing, assignment);
    return;
  }
  assignments.push(assignment);
}

function setMainConnections(connections, fromNode, outputs) {
  connections[fromNode] = {
    main: outputs.map((output) =>
      output.map((entry) => ({
        node: entry.node,
        type: "main",
        index: entry.index ?? 0,
      })),
    ),
  };
}

function appendConnection(connections, fromNode, toNode, outputIndex = 0) {
  if (!connections[fromNode]) {
    connections[fromNode] = { main: [] };
  }
  if (!connections[fromNode].main[outputIndex]) {
    connections[fromNode].main[outputIndex] = [];
  }
  if (!connections[fromNode].main[outputIndex].some((entry) => entry.node === toNode)) {
    connections[fromNode].main[outputIndex].push({ node: toNode, type: "main", index: 0 });
  }
}

function removeConnection(connections, fromNode, toNode) {
  if (!connections[fromNode]?.main) {
    return;
  }
  connections[fromNode].main = connections[fromNode].main.map((output) =>
    Array.isArray(output) ? output.filter((entry) => entry.node !== toNode) : output,
  );
}

function makeCodeNode(name, jsCode, position) {
  return {
    parameters: { jsCode },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    id: makeId(`node:${name}`),
    name,
  };
}

function makePostgresNode(name, query, queryReplacement, position, continueOnFail = true) {
  return {
    parameters: {
      operation: "executeQuery",
      query,
      options: {
        queryReplacement,
      },
    },
    type: "n8n-nodes-base.postgres",
    typeVersion: 2.6,
    position,
    id: makeId(`node:${name}`),
    name,
    credentials: {
      postgres: postgresCredential,
    },
    continueOnFail,
  };
}

function assertIncludes(haystack, needle, context) {
  if (!String(haystack || "").includes(needle)) {
    throw new Error(`Direct-path contract check failed: missing '${needle}' in ${context}`);
  }
}

function makeIfNode(name, leftValue, operation, position, rightValue = undefined) {
  const condition = {
    id: makeId(`condition:${name}:${leftValue}:${operation}:${rightValue ?? ""}`),
    leftValue,
    operator: {
      type: "boolean",
      operation,
      singleValue: true,
    },
  };

  if (rightValue !== undefined) {
    condition.rightValue = rightValue;
  }

  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        conditions: [condition],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position,
    id: makeId(`node:${name}`),
    name,
  };
}

const [workflow] = loadWorkflow(sourcePath);

applyIngressConversationTailModule({
  workflow,
  findNode,
  ensureAssignment,
  makeId,
});

const normalizeOllamaReply = findNode(workflow, "Normalize Ollama Reply");
normalizeOllamaReply.parameters.jsCode = `${normalizeOllamaReply.parameters.jsCode.replace(
  "} }];",
  "  response_mode: 'direct_owner_reply',\n  parent_owner_label: context.parent_owner_label || 'Ghost',\n} }];",
)}`;

const normalizeOpenAIReply = findNode(workflow, "Normalize OpenAI Reply");
normalizeOpenAIReply.parameters.jsCode = `${normalizeOpenAIReply.parameters.jsCode.replace(
  "} }];",
  "  response_mode: 'direct_owner_reply',\n  parent_owner_label: context.parent_owner_label || 'Ghost',\n} }];",
)}`;

const buildApprovalRequiredResponse = findNode(workflow, "Build Approval Required Response");
buildApprovalRequiredResponse.parameters.jsCode = `const context = $input.first().json;
const reasons = Array.isArray(context.risk_reasons) && context.risk_reasons.length
  ? context.risk_reasons.join(' ')
  : 'Risk policy requires review.';
const reply = \`Approval required before Codex execution. Risk level: \${context.risk_level || 'unknown'}. \${reasons}\`;
return [{ json: {
  ...context,
  reply,
  provider_used: context.provider || '',
  model_used: context.selected_model || '',
  task_class: context.task_class || '',
  command_success: false,
  error_type: 'approval_required',
  codex_command_status: 'blocked_pending_approval',
  artifact_path: '',
  stdout_summary: '',
  stderr_summary: reasons,
  command_exit_code: null,
  n8n_execution_id: context.n8n_execution_id || null,
  response_mode: 'direct_owner_reply',
  parent_owner_label: context.parent_owner_label || 'Ghost',
} }];`;

const normalizeCodexReply = findNode(workflow, "Normalize Codex Reply");
normalizeCodexReply.parameters.jsCode = `const result = $input.first().json;
const context = $('Expose Route Metadata').item.json;
const started = $items('Start Runtime Ledger', 0, 0)[0]?.json || {};
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
const commandFailedWithoutStructuredOutput = !rawStdout
  && !replyText.length
  && !payloadParseFailed
  && Boolean(nodeError || stderrSummaryBase || (commandExitCode !== null && commandExitCode !== 0));
const commandSuccess = Boolean(payload.success) && !invalidPayload && replyText.length > 0;
const derivedErrorType = commandSuccess
  ? ''
  : timedOut
      ? 'codex_command_timeout'
      : commandFailedWithoutStructuredOutput
          ? 'codex_command_failed'
      : invalidPayload || !replyText.length
          ? 'codex_invalid_result'
          : 'codex_command_failed';
const stderrSummary = commandSuccess
  ? stderrSummaryBase
  : stderrSummaryBase || (timedOut
      ? 'Codex execution timed out.'
      : commandFailedWithoutStructuredOutput
          ? 'Codex execution failed.'
      : invalidPayload
          ? 'Codex returned an invalid result payload.'
          : !replyText.length
              ? 'Codex returned no reply content.'
              : 'Codex execution failed.');
const failureSuffix = commandExitCode !== undefined && commandExitCode !== null ? \` (exit \${commandExitCode})\` : '';
const failureReason = stderrSummary || 'No additional stderr was captured.';
const failureLabel = derivedErrorType === 'codex_command_timeout'
  ? 'timed out'
  : derivedErrorType === 'codex_invalid_result'
      ? 'returned an invalid result'
      : 'failed';
const reply = commandSuccess
  ? replyText
  : \`Codex execution \${failureLabel}\${failureSuffix}. \${failureReason}\`;
return [{ json: {
  ...context,
  ...result,
  codex_raw_result: payload,
  conversation_id: context.conversation_id || '',
  reply,
  provider_used: context.provider || '',
  model_used: context.selected_model || '',
  task_class: context.task_class || '',
  approval_required: context.approval_required || false,
  risk_level: context.risk_level || 'safe',
  risk_reasons: context.risk_reasons || [],
  risk_codes: context.risk_codes || [],
  task_summary: context.task_summary || '',
  command_success: commandSuccess,
  command_exit_code: commandExitCode,
  stdout_summary: payload.stdout_summary || '',
  stderr_summary: stderrSummary,
  artifact_path: payload.artifact_path || '',
  codex_command_status: commandSuccess ? 'succeeded' : 'failed',
  error_type: derivedErrorType,
  runtime_task_id: started.task_id || '',
  runtime_task_run_id: started.task_run_id || '',
  n8n_execution_id: context.n8n_execution_id || null,
  response_mode: 'direct_owner_reply',
  parent_owner_label: context.parent_owner_label || 'Ghost',
} }];`;

const buildRuntimeLedgerStartPayload = findNode(workflow, "Build Runtime Ledger Start Payload");
buildRuntimeLedgerStartPayload.parameters.jsCode = `const context = $input.first().json;
const normalized = $('Normalize Input').item.json;
const executionId = normalized.n8n_execution_id || '';
return [{ json: {
  conversation_id: context.conversation_id || '',
  message: normalized.message || '',
  entrypoint: normalized.entrypoint || 'direct_webhook',
  input_payload_json: JSON.stringify({
    message: normalized.message || '',
    conversation_id: context.conversation_id || '',
    user_id: normalized.user_id || '',
    force_provider: normalized.force_provider || '',
    force_model: normalized.force_model || '',
    force_task_class: normalized.force_task_class || '',
    entrypoint: normalized.entrypoint || 'direct_webhook',
    n8n_execution_id: executionId || null,
  }),
  context_json: JSON.stringify({
    entrypoint: normalized.entrypoint || 'direct_webhook',
    execution_target: '${parentExecutionTarget}',
    workflow_name: '${workflowName}',
    n8n_execution_id: executionId || null,
  }),
} }];`;

const startRuntimeLedger = findNode(workflow, "Start Runtime Ledger");
startRuntimeLedger.parameters.query = `SELECT
  task_id::text,
  task_run_id::text
FROM public.ghost_runtime_start_task_ledger(
  NULLIF($1, '')::uuid,
  $2,
  $3,
  '${parentExecutionTarget}',
  '${workflowName}',
  $4::jsonb,
  $5::jsonb
);`;
applyDirectRuntimeTailModule({ workflow, findNode, addNode, makePostgresNode });
applyMemoryExtractionTailModule({ workflow, findNode });

applyOwnerPolicyTailModule({
  workflow,
  addNode,
  makePostgresNode,
  makeCodeNode,
});

addNode(
  workflow,
  makeIfNode(
    "Delegation Required?",
    "={{ $json.delegation_required }}",
    "true",
    [576, -64],
  ),
);

removeNode(workflow, "Build Finalize Delegation Context");
removeNode(workflow, "Finalize Successful Delegation");
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

applyDelegatedSetupTailModule({
  workflow,
  addNode,
  makeCodeNode,
  makePostgresNode,
  delegatedExecutionTarget,
  workflowName,
});

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

applyDelegatedCompletionTailModule({ workflow, addNode, makeCodeNode, makePostgresNode, delegatedExecutionTarget });
applyDelegatedControlTailModule({ workflow, addNode, makeCodeNode, makePostgresNode });

setMainConnections(workflow.connections, "Conversation Context", [[{ node: "Ensure Conversation Owner" }]]);
setMainConnections(workflow.connections, "Ensure Conversation Owner", [[{ node: "Conversation Context With Owner" }]]);
setMainConnections(workflow.connections, "Conversation Context With Owner", [
  [
    { node: "Save User Message" },
    { node: "Build Runtime Ledger Start Payload" },
  ],
]);

removeConnection(workflow.connections, "Assess Approval Risk", "Expose Route Metadata");
setMainConnections(workflow.connections, "Assess Approval Risk", [[{ node: "Resolve Parent Conversation Strategy" }]]);
setMainConnections(workflow.connections, "Resolve Parent Conversation Strategy", [[{ node: "Delegation Required?" }]]);
setMainConnections(workflow.connections, "Delegation Required?", [
  [{ node: "Build Delegation Request" }],
  [{ node: "Expose Route Metadata" }],
]);
setMainConnections(workflow.connections, "Build Delegation Request", [[{ node: "Create Conversation Delegation" }]]);
setMainConnections(workflow.connections, "Create Conversation Delegation", [[{ node: "Build Delegation Context" }]]);
setMainConnections(workflow.connections, "Build Delegation Context", [[{ node: "Save Delegated Worker Message" }]]);
setMainConnections(workflow.connections, "Save Delegated Worker Message", [[{ node: "Build Delegation Execution Context" }]]);
setMainConnections(workflow.connections, "Build Delegation Execution Context", [[{ node: "Delegation Approval Required?" }]]);
setMainConnections(workflow.connections, "Delegation Approval Required?", [
  [{ node: "Finalize Blocked Delegation" }],
  [{ node: "Delegated Worker Is Codex?" }],
]);
setMainConnections(workflow.connections, "Finalize Blocked Delegation", [[{ node: "Build Parent Blocked Delegation Response" }]]);
setMainConnections(workflow.connections, "Build Parent Blocked Delegation Response", [[{ node: "Build API Response" }]]);
setMainConnections(workflow.connections, "Delegated Worker Is Codex?", [
  [{ node: "Start Delegated Runtime" }],
  [{ node: "Finalize Unsupported Delegation" }],
]);
setMainConnections(workflow.connections, "Finalize Unsupported Delegation", [[{ node: "Build Parent Unsupported Delegation Response" }]]);
setMainConnections(workflow.connections, "Build Parent Unsupported Delegation Response", [[{ node: "Build API Response" }]]);
setMainConnections(workflow.connections, "Start Delegated Runtime", [[{ node: "Build Delegated Codex Context" }]]);
setMainConnections(workflow.connections, "Build Delegated Codex Context", [[{ node: "Build Delegated Codex Command" }]]);
setMainConnections(workflow.connections, "Build Delegated Codex Command", [[{ node: "Execute Delegated Codex Command" }]]);
setMainConnections(workflow.connections, "Execute Delegated Codex Command", [[{ node: "Normalize Delegated Codex Reply" }]]);
setMainConnections(workflow.connections, "Normalize Delegated Codex Reply", [[{ node: "Save Delegated Worker Reply" }]]);
setMainConnections(workflow.connections, "Save Delegated Worker Reply", [[{ node: "Build Delegated Completion Context" }]]);
setMainConnections(workflow.connections, "Build Delegated Completion Context", [[{ node: "Complete Delegated Runtime" }]]);
setMainConnections(workflow.connections, "Complete Delegated Runtime", [[{ node: "Annotate Delegation Completion Event" }]]);
setMainConnections(workflow.connections, "Annotate Delegation Completion Event", [[{ node: "Build Parent Delegation Response" }]]);
setMainConnections(workflow.connections, "Build Parent Delegation Response", [[{ node: "Build API Response" }]]);
setMainConnections(workflow.connections, "Complete Runtime Ledger", [[{ node: "Annotate Direct Runtime Event" }]]);

assertDirectRuntimeTailContract({ workflow, findNode, assertIncludes });
assertMemoryExtractionTailContract({ workflow, findNode, assertIncludes });
assertDelegatedCompletionTailContract({ workflow, findNode, assertIncludes });
assertDelegatedControlTailContract({ workflow, findNode, assertIncludes });
assertDelegatedSetupTailContract({ workflow, findNode, assertIncludes });
assertIngressConversationTailContract({ workflow, findNode, assertIncludes });
assertOwnerPolicyTailContract({ workflow, findNode, assertIncludes });
fs.writeFileSync(targetPath, JSON.stringify([workflow], null, 2) + "\n");
console.log(targetPath);
