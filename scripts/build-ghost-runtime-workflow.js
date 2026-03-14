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
  makeWorkerRuntimeConfig,
} = require("./foundation-runtime");

const projectRoot = path.join(__dirname, "..");
const sourcePath = path.join(projectRoot, "workflows", "ghost-runtime-workflow-base.json");
const targetPath = path.join(projectRoot, "workflows", "ghost-runtime-workflow.json");
const postgresCredential = {
  id: "r4pH8PimgUf2t9oM",
  name: "Postgres account",
};
const workflowName = "Ghost Runtime";
const parentExecutionTarget = "webhook/ghost-chat-v3";
const delegatedExecutionTarget = "delegated_codex_session";
const phase7Foundations = loadPhase7Foundations(projectRoot);
const approvalRuntimeConfigLiteral = JSON.stringify(makeApprovalRuntimeConfig(phase7Foundations));
const workerRuntimeConfigLiteral = JSON.stringify(makeWorkerRuntimeConfig(phase7Foundations));

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
workflow.name = workflowName;

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
const blockedByEnvironment = governancePolicy.state === 'environment_restricted';
const reply = blockedByEnvironment
  ? \`Codex execution is blocked by \${approvalItem.environment} environment policy. Risk level: \${context.risk_level || 'unknown'}. \${governancePolicy.summary} \${reasons}\`
  : \`Approval required before Codex execution. Risk level: \${context.risk_level || 'unknown'}. \${reasons}\`;
return [{ json: {
  ...context,
  reply,
  provider_used: context.provider || '',
  model_used: context.selected_model || '',
  task_class: context.task_class || '',
  approval_required: true,
  command_success: false,
  error_type: blockedByEnvironment ? 'environment_capability_blocked' : 'approval_required',
  codex_command_status: blockedByEnvironment ? 'blocked_environment_policy' : 'blocked_pending_approval',
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

const assessApprovalRisk = findNode(workflow, "Assess Approval Risk");
assessApprovalRisk.parameters.jsCode = `${makeApprovalRuntimeHelpersCode()}
const item = $input.first().json;
const messages = Array.isArray(item.messages) ? item.messages : [];
const lastUser = [...messages].reverse().find((message) => message.role === 'user');
const sourceText = (lastUser?.content || item.prompt || '').trim();
const findings = [];
let riskLevel = 'safe';

const destructiveRules = [
  { label: 'delete_or_rm', pattern: /(^|\\s)(rm\\s+-rf|rm\\s+-r|rm\\s+|delete\\s+(the\\s+)?file|delete\\s+(the\\s+)?directory|remove\\s+(the\\s+)?file|unlink\\s+|shred\\s+)/i, reason: 'Requests file deletion or removal.' },
  { label: 'docker_live_change', pattern: /docker\\s+compose\\s+(down|restart|up|stop)|docker\\s+(restart|stop)\\b/i, reason: 'Requests live container lifecycle changes.' },
  { label: 'destructive_sql', pattern: /\\b(drop\\s+table|drop\\s+database|truncate\\s+table|delete\\s+from|alter\\s+table\\s+.*drop\\s+column)\\b/i, reason: 'Contains destructive SQL operations.' },
  { label: 'critical_move', pattern: /\\b(move|mv|rename)\\b.*\\b(docker-compose\\.ya?ml|\\.env|systemd|workflow|workflows\\/|base\\/)\\b/i, reason: 'Moves or renames critical runtime files.' },
];

const cautionRules = [
  { label: 'critical_file_edit', pattern: /\\b(edit|modify|change|update|patch|rewrite)\\b.*\\b(docker-compose\\.ya?ml|\\.env(\\.|\\b)|systemd|service unit|workflow id|production workflow|ghost-chat-v3|Yh6h9OJyVCfREbp3)\\b/i, reason: 'Touches critical runtime configuration or live workflow identifiers.' },
  { label: 'broad_sql', pattern: /\\b(update|delete)\\b.*\\b(sql|postgres|database|table)\\b/i, reason: 'Requests a database-changing operation.' },
  { label: 'infrastructure_change', pattern: /\\b(deploy|deployment|infrastructure|nginx|kubernetes|compose file|dockerfile)\\b/i, reason: 'Requests infrastructure-related changes.' },
];

for (const rule of destructiveRules) {
  if (rule.pattern.test(sourceText)) findings.push({ level: 'destructive', code: rule.label, reason: rule.reason });
}
if (!findings.length) {
  for (const rule of cautionRules) {
    if (rule.pattern.test(sourceText)) findings.push({ level: 'caution', code: rule.label, reason: rule.reason });
  }
}
if (findings.some((finding) => finding.level === 'destructive')) riskLevel = 'destructive';
else if (findings.some((finding) => finding.level === 'caution')) riskLevel = 'caution';

const isCodexDirect = item.provider === 'codex_oauth_worker';
const directCapabilities = isCodexDirect ? ['code.write', 'artifact.publish'] : [];
const approvalItem = isCodexDirect ? __buildApprovalItem({
  workerId: 'ghost_main',
  requestedBy: 'ghost-main-runtime',
  summary: 'Direct Codex execution requires approval before mutation-capable work can start.',
  reason: findings.map((finding) => finding.reason).join(' ') || 'Risk policy requires review.',
  category: 'destructive_change',
  riskLevel,
  capabilities: directCapabilities,
  requestedForWorkerId: 'ghost_main',
}) : null;
const governancePolicy = approvalItem ? __buildApprovalPolicy(approvalItem) : null;
const blockedByEnvironment = governancePolicy?.state === 'environment_restricted';
const approvalRequired = isCodexDirect && (riskLevel !== 'safe' || blockedByEnvironment);
const taskSummary = sourceText.replace(/\\s+/g, ' ').trim().slice(0, 180);

return [{ json: {
  ...item,
  task_summary: taskSummary,
  approval_required: approvalRequired,
  risk_level: riskLevel,
  risk_reasons: findings.map((finding) => finding.reason),
  risk_codes: findings.map((finding) => finding.code),
  governance_policy: governancePolicy,
  governance_environment: approvalItem?.environment || item.governance_environment || null,
  requested_capabilities: directCapabilities,
  codex_command_status: approvalRequired
    ? (blockedByEnvironment ? 'blocked_environment_policy' : 'blocked_pending_approval')
    : (isCodexDirect ? 'pending' : 'not_applicable'),
} }];`;

addNode(
  workflow,
  makePostgresNode(
    "Persist Approval Queue Item",
    `WITH payload AS (
  SELECT
    NULLIF($1, '')::uuid AS task_id,
    NULLIF($2, '') AS approval_contract_id,
    NULLIF($3, '') AS approval_type,
    NULLIF($4, '') AS prompt_text,
    COALESCE($5::jsonb, '{}'::jsonb) AS approval_metadata,
    NULLIF($6, '') AS requester_agent_key,
    COALESCE($7::jsonb, '{}'::jsonb) AS payload_json
), existing AS (
  SELECT
    a.id::text AS approval_queue_id,
    a.status AS approval_queue_status,
    a.requested_at
  FROM approvals a
  JOIN payload p ON TRUE
  WHERE a.task_id = p.task_id
    AND COALESCE(a.metadata ->> 'approval_contract_id', '') = COALESCE(p.approval_contract_id, '')
  ORDER BY a.requested_at DESC, a.id DESC
  LIMIT 1
), inserted AS (
  INSERT INTO approvals (
    task_id,
    requested_by_agent_id,
    approval_type,
    status,
    prompt_text,
    metadata
  )
  SELECT
    p.task_id,
    (SELECT id FROM agents WHERE agent_key = p.requester_agent_key LIMIT 1),
    COALESCE(p.approval_type, 'governed_approval'),
    'pending',
    COALESCE(p.prompt_text, 'Approval required before execution can continue.'),
    p.approval_metadata
  FROM payload p
  WHERE p.task_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM existing)
  RETURNING id::text AS approval_queue_id, status AS approval_queue_status, requested_at
)
SELECT
  COALESCE(inserted.approval_queue_id, existing.approval_queue_id, '') AS approval_queue_id,
  COALESCE(inserted.approval_queue_status, existing.approval_queue_status, '') AS approval_queue_status,
  COALESCE(inserted.requested_at, existing.requested_at)::text AS approval_requested_at,
  payload.payload_json::text AS approval_payload_json
FROM payload
LEFT JOIN inserted ON TRUE
LEFT JOIN existing ON TRUE;`,
    "={{ [$items('Start Runtime Ledger', 0, 0)[0]?.json.task_id || '', $json.approval_item?.approval_id || '', ($json.governance_policy?.state === 'environment_restricted' ? ($json.response_mode === 'delegated_blocked' ? 'delegated_environment_restricted' : 'direct_environment_restricted') : ($json.response_mode === 'delegated_blocked' ? 'delegated_blocked' : 'direct_approval_required')), $json.reply || 'Approval required before execution can continue.', { approval_contract_id: $json.approval_item?.approval_id || null, approval_item: $json.approval_item || null, governance_policy: $json.governance_policy || null, governance_environment: $json.governance_environment || null, requested_capabilities: $json.requested_capabilities || [], conversation_id: $json.conversation_id || null, delegation_id: $json.delegation_id || null, orchestration_task_id: $json.orchestration_task_id || null, runtime_task_id: $items('Start Runtime Ledger', 0, 0)[0]?.json.task_id || null, runtime_task_run_id: $items('Start Runtime Ledger', 0, 0)[0]?.json.task_run_id || null, n8n_execution_id: $json.n8n_execution_id || null, response_mode: $json.response_mode || null, parent_owner_label: $json.parent_owner_label || null, source_path: ($json.governance_policy?.state === 'environment_restricted' ? ($json.response_mode === 'delegated_blocked' ? 'delegated_environment_restricted' : 'direct_environment_restricted') : ($json.response_mode === 'delegated_blocked' ? 'delegated_blocked' : 'direct_approval_required')) }, 'ghost-main', $json] }}",
    [2144, -544],
    false,
  ),
);

addNode(
  workflow,
  makeCodeNode(
    "Attach Persisted Approval Queue Metadata",
    `const row = $input.first().json || {};
let payload = {};
try {
  payload = row.approval_payload_json ? JSON.parse(row.approval_payload_json) : {};
} catch (error) {
  payload = {};
}
const approvalItem = payload.approval_item && typeof payload.approval_item === 'object' && !Array.isArray(payload.approval_item)
  ? {
      ...payload.approval_item,
      queue_id: row.approval_queue_id || null,
      queue_status: row.approval_queue_status || 'pending',
      queue_requested_at: row.approval_requested_at || null,
    }
  : payload.approval_item || null;
return [{ json: {
  ...payload,
  approval_item: approvalItem,
  approval_queue_id: row.approval_queue_id || null,
  approval_queue_status: row.approval_queue_status || null,
} }];`,
    [2368, -544],
  ),
);

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
  workerRuntimeConfigLiteral,
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
setMainConnections(workflow.connections, "Build Parent Blocked Delegation Response", [[{ node: "Persist Approval Queue Item" }]]);
setMainConnections(workflow.connections, "Finalize Unsupported Delegation", [[{ node: "Build Parent Unsupported Delegation Response" }]]);
setMainConnections(workflow.connections, "Build Parent Unsupported Delegation Response", [[{ node: "Build API Response" }]]);
setMainConnections(workflow.connections, "Build Approval Required Response", [[{ node: "Persist Approval Queue Item" }]]);
setMainConnections(workflow.connections, "Persist Approval Queue Item", [[{ node: "Attach Persisted Approval Queue Metadata" }]]);
setMainConnections(workflow.connections, "Attach Persisted Approval Queue Metadata", [[{ node: "Build API Response" }]]);
setMainConnections(workflow.connections, "Save Delegated Worker Reply", [[{ node: "Build Delegated Completion Context" }]]);
setMainConnections(workflow.connections, "Build Delegated Completion Context", [[{ node: "Complete Delegated Runtime" }]]);
setMainConnections(workflow.connections, "Complete Delegated Runtime", [[{ node: "Annotate Delegation Completion Event" }]]);
setMainConnections(workflow.connections, "Annotate Delegation Completion Event", [[{ node: "Build Parent Delegation Response" }]]);
setMainConnections(workflow.connections, "Build Parent Delegation Response", [[{ node: "Build API Response" }]]);
setMainConnections(workflow.connections, "Complete Runtime Ledger", [[{ node: "Annotate Direct Runtime Event" }]]);

const persistApprovalQueueItem = findNode(workflow, "Persist Approval Queue Item");
const attachPersistedApprovalQueueMetadata = findNode(workflow, "Attach Persisted Approval Queue Metadata");
for (const field of [
  "INSERT INTO approvals",
  "approval_contract_id",
  "requested_by_agent_id",
  "approval_queue_id",
  "approval_payload_json",
]) {
  assertIncludes(persistApprovalQueueItem.parameters.query, field, "Persist Approval Queue Item query");
}
for (const field of [
  "approval_queue_id",
  "approval_queue_status",
  "approval_item",
  "queue_requested_at",
]) {
  assertIncludes(attachPersistedApprovalQueueMetadata.parameters.jsCode, field, "Attach Persisted Approval Queue Metadata");
}

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
