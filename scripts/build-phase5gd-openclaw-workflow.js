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
const {
  applyDelegationRouterTailModule,
  assertDelegationRouterTailContract,
} = require("./workflow-modules/delegation-router-tail");
const {
  applyDelegatedWorkerRuntimeTailModule,
  assertDelegatedWorkerRuntimeTailContract,
} = require("./workflow-modules/delegated-worker-runtime-tail");
const {
  loadPhase7Foundations,
  makeApprovalRuntimeConfig,
} = require("./foundation-runtime");

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
const phase7Foundations = loadPhase7Foundations(projectRoot);
const approvalRuntimeConfigLiteral = JSON.stringify(makeApprovalRuntimeConfig(phase7Foundations));

function makeApprovalRuntimeHelpersCode() {
  return `const __ghostApprovalConfig = ${approvalRuntimeConfigLiteral};
const __approvalText = (value) => value === undefined || value === null ? '' : String(value).trim();
const __approvalList = (value) => Array.isArray(value) ? value.map((entry) => __approvalText(entry)).filter(Boolean) : [];
const __approvalHash = (value) => {
  let hash = 0;
  const text = __approvalText(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return \`approval_\${Math.abs(hash).toString(16).slice(0, 12)}\`;
};
const __approvalEnvironment = () => {
  const explicit = typeof process !== 'undefined'
    ? __approvalText(process.env.GHOST_RUNTIME_ENV || process.env.GHOST_ENV || process.env.NODE_ENV || '')
    : '';
  if (explicit === 'production' && __ghostApprovalConfig.environments_by_id.prod) return 'prod';
  if (explicit && __ghostApprovalConfig.environments_by_id[explicit]) return explicit;
  return 'lab';
};
const __buildApprovalItem = ({ workerId, requestedBy, summary, reason, category, riskLevel, capabilities, requestedForWorkerId }) => {
  const worker = __ghostApprovalConfig.workers_by_id[workerId] || null;
  if (!worker) {
    throw new Error(\`Unknown approval worker: \${workerId}\`);
  }
  const targetWorker = requestedForWorkerId ? (__ghostApprovalConfig.workers_by_id[requestedForWorkerId] || null) : null;
  const environment = __approvalEnvironment();
  const environmentDoc = __ghostApprovalConfig.environments_by_id[environment] || __ghostApprovalConfig.environments_by_id.lab;
  const normalizedCapabilities = Array.from(new Set(__approvalList(capabilities))).filter((capabilityId) => __ghostApprovalConfig.capabilities_by_id[capabilityId]);
  const capabilityRecords = normalizedCapabilities.map((capabilityId) => __ghostApprovalConfig.capabilities_by_id[capabilityId]);
  const approvalRequiredCapabilities = capabilityRecords.filter((entry) => entry.approval_required).map((entry) => entry.id);
  const destructiveCapabilities = capabilityRecords.filter((entry) => entry.class === 'destructive').map((entry) => entry.id);
  const restrictedCapabilities = capabilityRecords.filter((entry) => (environmentDoc.restricted_capabilities || []).includes(entry.id)).map((entry) => entry.id);
  const outOfScopeCapabilities = capabilityRecords.filter((entry) => !(entry.environment_restriction || []).includes(environment)).map((entry) => entry.id);
  const approvalSource = [workerId, requestedBy, summary, environment, category, normalizedCapabilities.join(','), targetWorker?.id || ''].join('|');
  return {
    approval_id: __approvalHash(approvalSource),
    state: __ghostApprovalConfig.approval_model.initial_state,
    requested_at: new Date().toISOString(),
    requested_by: __approvalText(requestedBy),
    requester_worker_id: worker.id,
    requester_label: worker.visibility_label,
    environment,
    category: __approvalText(category),
    risk_level: __approvalText(riskLevel) || 'caution',
    capabilities: normalizedCapabilities,
    summary: __approvalText(summary),
    reason: __approvalText(reason),
    target_worker_id: targetWorker?.id || null,
    target_worker_label: targetWorker?.visibility_label || null,
    governance: {
      environment_posture: environmentDoc.governance_posture || 'moderate',
      restricted_capabilities: restrictedCapabilities,
      out_of_scope_capabilities: outOfScopeCapabilities,
      approval_required_capabilities: approvalRequiredCapabilities,
      destructive_capabilities: destructiveCapabilities,
      operator_identity: worker.operator_identity,
      worker_environment_scope: Array.isArray(worker.environment_scope) ? worker.environment_scope : [],
    },
  };
};
const __buildApprovalPolicy = (approvalItem) => {
  const governance = approvalItem && approvalItem.governance && typeof approvalItem.governance === 'object'
    ? approvalItem.governance
    : {};
  const restricted = Array.isArray(governance.restricted_capabilities) ? governance.restricted_capabilities : [];
  const outOfScope = Array.isArray(governance.out_of_scope_capabilities) ? governance.out_of_scope_capabilities : [];
  const approvalRequired = Array.isArray(governance.approval_required_capabilities) ? governance.approval_required_capabilities : [];
  const blockingCapabilities = Array.from(new Set([...restricted, ...outOfScope]));
  const state = blockingCapabilities.length > 0
    ? 'environment_restricted'
    : approvalRequired.length > 0
      ? 'approval_required'
      : 'allowed';
  const summaryParts = [];
  if (approvalRequired.length > 0) summaryParts.push(\`approval required for \${approvalRequired.join(', ')}\`);
  if (restricted.length > 0) summaryParts.push(\`restricted in \${approvalItem.environment}: \${restricted.join(', ')}\`);
  if (outOfScope.length > 0) summaryParts.push(\`outside \${approvalItem.environment} scope: \${outOfScope.join(', ')}\`);
  summaryParts.push(\`environment posture \${governance.environment_posture || 'unknown'}\`);
  return {
    state,
    summary: summaryParts.join('; '),
    blocking_capabilities: blockingCapabilities,
    environment: approvalItem.environment || null,
    environment_posture: governance.environment_posture || null,
    approval_required_capabilities: approvalRequired,
    restricted_capabilities: restricted,
    out_of_scope_capabilities: outOfScope,
    destructive_capabilities: Array.isArray(governance.destructive_capabilities) ? governance.destructive_capabilities : [],
    operator_identity: governance.operator_identity || null,
    worker_environment_scope: Array.isArray(governance.worker_environment_scope) ? governance.worker_environment_scope : [],
  };
};`;
}

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
buildApprovalRequiredResponse.parameters.jsCode = `${makeApprovalRuntimeHelpersCode()}
const context = $input.first().json;
const reasons = Array.isArray(context.risk_reasons) && context.risk_reasons.length
  ? context.risk_reasons.join(' ')
  : 'Risk policy requires review.';
const approvalItem = __buildApprovalItem({
  workerId: 'ghost_main',
  requestedBy: 'ghost-main-runtime',
  summary: 'Direct Codex execution requires approval before mutation-capable work can start.',
  reason: reasons,
  category: 'destructive_change',
  riskLevel: context.risk_level || 'caution',
  capabilities: ['code.write', 'artifact.publish'],
  requestedForWorkerId: 'ghost_main',
});
const governancePolicy = __buildApprovalPolicy(approvalItem);
const reply = \`Approval required before Codex execution. Risk level: \${context.risk_level || 'unknown'}. \${reasons}\`;
return [{ json: {
  ...context,
  reply,
  provider_used: context.provider || '',
  model_used: context.selected_model || '',
  task_class: context.task_class || '',
  approval_required: true,
  command_success: false,
  error_type: 'approval_required',
  codex_command_status: 'blocked_pending_approval',
  artifact_path: '',
  stdout_summary: '',
  stderr_summary: [reasons, governancePolicy.summary].filter(Boolean).join(' '),
  command_exit_code: null,
  n8n_execution_id: context.n8n_execution_id || null,
  approval_item: approvalItem,
  governance_policy: governancePolicy,
  governance_environment: approvalItem.environment,
  requested_capabilities: approvalItem.capabilities,
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

removeNode(workflow, "Build Finalize Delegation Context");
removeNode(workflow, "Finalize Successful Delegation");
applyDelegationRouterTailModule({
  workflow,
  addNode,
  makeIfNode,
  setMainConnections,
});

applyDelegatedSetupTailModule({
  workflow,
  addNode,
  makeCodeNode,
  makePostgresNode,
  delegatedExecutionTarget,
  workflowName,
});

applyDelegatedWorkerRuntimeTailModule({
  workflow,
  findNode,
  addNode,
  makeCodeNode,
  makeId,
  setMainConnections,
});

applyDelegatedCompletionTailModule({ workflow, addNode, makeCodeNode, makePostgresNode, delegatedExecutionTarget });
applyDelegatedControlTailModule({
  workflow,
  addNode,
  makeCodeNode,
  makePostgresNode,
  approvalRuntimeHelpersCode: makeApprovalRuntimeHelpersCode(),
});

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
setMainConnections(workflow.connections, "Build Delegation Request", [[{ node: "Create Conversation Delegation" }]]);
setMainConnections(workflow.connections, "Create Conversation Delegation", [[{ node: "Build Delegation Context" }]]);
setMainConnections(workflow.connections, "Build Delegation Context", [[{ node: "Save Delegated Worker Message" }]]);
setMainConnections(workflow.connections, "Save Delegated Worker Message", [[{ node: "Build Delegation Execution Context" }]]);
setMainConnections(workflow.connections, "Finalize Blocked Delegation", [[{ node: "Build Parent Blocked Delegation Response" }]]);
setMainConnections(workflow.connections, "Build Parent Blocked Delegation Response", [[{ node: "Build API Response" }]]);
setMainConnections(workflow.connections, "Finalize Unsupported Delegation", [[{ node: "Build Parent Unsupported Delegation Response" }]]);
setMainConnections(workflow.connections, "Build Parent Unsupported Delegation Response", [[{ node: "Build API Response" }]]);
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
assertDelegationRouterTailContract({ workflow, findNode, assertIncludes });
assertDelegatedWorkerRuntimeTailContract({ workflow, findNode, assertIncludes });
fs.writeFileSync(targetPath, JSON.stringify([workflow], null, 2) + "\n");
console.log(targetPath);
