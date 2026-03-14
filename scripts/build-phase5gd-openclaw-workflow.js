const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

const buildApiResponse = findNode(workflow, "Build API Response");
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
return [{ json: {
  conversation_id: asText(item.conversation_id),
  reply: asText(item.reply),
  provider_used: asText(item.provider_used),
  model_used: asText(item.model_used),
  task_class: asText(item.task_class),
  approval_required: Boolean(item.approval_required),
  risk_level: asText(item.risk_level) || 'safe',
  risk_reasons: Array.isArray(item.risk_reasons) ? item.risk_reasons : [],
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
  worker_conversation_id: asText(item.worker_conversation_id) || null,
  n8n_execution_id: asText(item.n8n_execution_id) || null,
  response_mode: asText(item.response_mode) || 'direct_owner_reply',
  parent_owner_label: asText(item.parent_owner_label) || null,
} }];`;

const saveUserMessage = findNode(workflow, "Save User Message");
saveUserMessage.parameters.options.queryReplacement =
  "={{ [$json.conversation_id, $('Normalize Input').item.json.message, JSON.stringify({ source: 'ghost-chat-v3', type: 'user_message', entrypoint: $('Normalize Input').item.json.entrypoint || 'direct_webhook', n8n_execution_id: $('Normalize Input').item.json.n8n_execution_id || null })] }}";

const saveAssistantReply = findNode(workflow, "Save Assistant Reply");
saveAssistantReply.parameters.options.queryReplacement =
  "={{ [$json.conversation_id, $json.reply, $json.model_used || null, { provider_used: $json.provider_used || null, task_class: $json.task_class || null, approval_required: $json.approval_required || false, risk_level: $json.risk_level || 'safe', risk_reasons: $json.risk_reasons || [], task_summary: $json.task_summary || '', command_success: $json.command_success === true, command_exit_code: $json.command_exit_code !== undefined && $json.command_exit_code !== null ? $json.command_exit_code : null, stdout_summary: $json.stdout_summary || '', stderr_summary: $json.stderr_summary || '', artifact_path: $json.artifact_path || null, codex_command_status: $json.codex_command_status || 'not_applicable', error_type: $json.error_type || null, delegation_id: $json.delegation_id || null, orchestration_task_id: $json.orchestration_task_id || null, runtime_task_id: $json.runtime_task_id || null, worker_conversation_id: $json.worker_conversation_id || null, n8n_execution_id: $json.n8n_execution_id || null, response_mode: $json.response_mode || 'direct_owner_reply', parent_owner_label: $json.parent_owner_label || null }] }}";

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
} }];`;

const normalizeCodexReply = findNode(workflow, "Normalize Codex Reply");
normalizeCodexReply.parameters.jsCode = `const result = $input.first().json;
const context = $('Expose Route Metadata').item.json;
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
const commandSuccess = Boolean(payload.success) && !invalidPayload && replyText.length > 0;
const derivedErrorType = commandSuccess
  ? ''
  : (invalidPayload || !replyText.length)
      ? 'codex_invalid_result'
      : 'codex_command_failed';
const stderrSummary = commandSuccess
  ? stderrSummaryBase
  : (stderrSummaryBase || (invalidPayload
      ? 'Codex returned an invalid result payload.'
      : !replyText.length
          ? 'Codex returned no reply content.'
          : 'Codex execution failed.'));
const failureSuffix = commandExitCode !== undefined && commandExitCode !== null ? \` (exit \${commandExitCode})\` : '';
const failureReason = stderrSummary || 'No additional stderr was captured.';
const reply = commandSuccess
  ? replyText
  : \`Codex execution failed\${failureSuffix}. \${failureReason}\`;
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
  n8n_execution_id: context.n8n_execution_id || null,
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

const buildRuntimeLedgerCompletionPayload = findNode(workflow, "Build Runtime Ledger Completion Payload");
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
  error_type: item.error_type || '',
  task_summary: item.task_summary || '',
  artifact_path: item.artifact_path || '',
  n8n_execution_id: item.n8n_execution_id || normalized.n8n_execution_id || '',
  entrypoint: normalized.entrypoint || 'direct_webhook',
} }];`;

const buildMemoryExtractionInput = findNode(workflow, "Build Memory Extraction Input");
buildMemoryExtractionInput.parameters.jsCode = `const savedMessage = $input.first().json;
const replyContext = $('Build API Response').item.json;
let routeContext = { messages: [] };
try {
  routeContext = $('Expose Route Metadata').item.json;
} catch (error) {
  routeContext = { messages: [] };
}
const responseMode = replyContext.response_mode || 'direct_owner_reply';
const messages = Array.isArray(routeContext.messages) ? routeContext.messages : [];
const lastUserFromRoute = [...messages].reverse().find((message) => message.role === 'user');
const latestUserMessage = (lastUserFromRoute?.content || $('Normalize Input').item.json.message || '').trim();
const assistantReply = (replyContext.reply || '').trim();
const memoryTestMode = $('Normalize Input').item.json.memory_test_mode || '';
const taskClass = replyContext.task_class || 'chat';
const meaningfulTechnicalWork = taskClass === 'technical_work'
  && replyContext.command_success === true
  && /(implement|implemented|fix|fixed|update|updated|patch|patched|migrate|migration|refactor|created|added|write|wrote|build|built)/i.test(\`\${latestUserMessage} \${assistantReply}\`)
  && assistantReply.length >= 24;
const explicitMemoryCue = /(decision|architectural decision|architecture decision|environment fact|runtime fact|operational note|runtime note|user preference|durable preference|remember this|preference|for future responses|always|never)/i.test(latestUserMessage);
const delegatedResponse = responseMode.startsWith('delegated_');
const shouldExtractMemory = Boolean(savedMessage.id && assistantReply)
  && !delegatedResponse
  && !replyContext.approval_required
  && replyContext.error_type !== 'approval_required'
  && (taskClass !== 'technical_work' || replyContext.command_success !== false)
  && (explicitMemoryCue || meaningfulTechnicalWork || assistantReply.length >= 40);
const extractionContract = {
  items: [
    {
      scope: 'global|conversation|task',
      memory_type: 'task_summary|decision|environment_fact|operational_note|conversation_summary',
      title: 'short title or empty string',
      summary: 'durable compact summary',
      details_json: {},
      importance: 1,
    },
  ],
};
const extractionPrompt = [
  'You extract durable structured Ghost memory.',
  'Return JSON only. No markdown. No explanation. No surrounding prose.',
  'Return exactly one object with one key: items.',
  'If nothing qualifies, return {"items":[]}.',
  'Each item must contain exactly these keys: scope, memory_type, title, summary, details_json, importance.',
  'Allowed scope: global, conversation, task.',
  'Allowed memory_type: task_summary, decision, environment_fact, operational_note, conversation_summary.',
  'importance must be an integer 1..5.',
  'title should be short. summary should be compact, durable, and under 240 characters.',
  'details_json must be a small object. Use {} when not needed.',
  'Do not store chit-chat, greetings, vague acknowledgements, raw runtime noise, stack traces, banners, code fences, or duplicate restatements.',
  'Prefer decision, environment_fact, operational_note over weak summaries.',
  'Only emit task_summary when meaningful work completed successfully.',
  'Return at most 3 items.',
  '',
  'JSON schema shape:',
  JSON.stringify(extractionContract),
  '',
  'Turn context JSON:',
  JSON.stringify({
    task_class: taskClass,
    provider_used: replyContext.provider_used || '',
    model_used: replyContext.model_used || '',
    command_success: replyContext.command_success,
    risk_level: replyContext.risk_level || 'safe',
    meaningful_technical_work: meaningfulTechnicalWork,
    response_mode: responseMode,
    latest_user_message: latestUserMessage,
    assistant_reply: assistantReply,
  }),
].join('\\n');

return [{ json: {
  conversation_id: replyContext.conversation_id || '',
  source_message_id: savedMessage.id || '',
  task_class: taskClass,
  latest_user_message: latestUserMessage,
  assistant_reply: assistantReply,
  memory_test_mode: memoryTestMode,
  should_extract_memory: shouldExtractMemory,
  meaningful_technical_work: meaningfulTechnicalWork,
  extraction_prompt: extractionPrompt,
  memory_debug: {
    extractor_attempted: shouldExtractMemory,
    extractor_skipped: !shouldExtractMemory,
    fallback_used: false,
    candidate_count: 0,
    filtered_count: 0,
    saved_count: 0,
  },
} }];`;

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
  makeIfNode(
    "Delegation Required?",
    "={{ $json.delegation_required }}",
    "true",
    [576, -64],
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

removeNode(workflow, "Build Finalize Delegation Context");
removeNode(workflow, "Finalize Successful Delegation");

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
  unsupported_result_summary: compact(\`Delegated work was queued for \${delegation.worker_provider || parent.delegated_provider || 'the selected worker'}, but only explicit Codex execution is wired in this phase.\`, 400),
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
  makeIfNode(
    "Delegation Approval Required?",
    "={{ $('Build Delegation Context').item.json.approval_required }}",
    "true",
    [1696, -208],
  ),
);

addNode(
  workflow,
  makePostgresNode(
    "Finalize Blocked Delegation",
    `SELECT public.ghost_finalize_delegation(
  NULLIF($1, '')::uuid,
  NULL,
  'blocked',
  $2,
  NULL
);`,
    "={{ [$json.delegation_id || '', $json.blocked_result_summary || 'Approval required before delegated worker execution.'] }}",
    [1920, -352],
    false,
  ),
);

addNode(
  workflow,
  makeCodeNode(
    "Build Parent Blocked Delegation Response",
    `const item = $('Build Delegation Context').item.json;
const reasons = Array.isArray(item.risk_reasons) && item.risk_reasons.length
  ? item.risk_reasons.join(' ')
  : 'Risk policy requires review before Ghost can start the delegated worker session.';
const reply = [
  \`\${item.parent_owner_label || 'Ghost'} kept this conversation under its current owner and opened a delegated worker task instead of silently switching models.\`,
  \`Execution is blocked pending approval. The delegated task is now visible on the Task Board for review.\`,
  reasons,
].join('\\n\\n');
return [{ json: {
  conversation_id: item.conversation_id || '',
  reply,
  provider_used: item.parent_provider || '',
  model_used: item.parent_model || '',
  task_class: item.task_class || 'technical_work',
  approval_required: true,
  risk_level: item.risk_level || 'caution',
  risk_reasons: item.risk_reasons || [],
  task_summary: item.task_summary || '',
  command_success: false,
  command_exit_code: null,
  stdout_summary: '',
  stderr_summary: reasons,
  artifact_path: '',
  codex_command_status: 'blocked_pending_approval',
  error_type: 'delegation_blocked_pending_approval',
  delegation_id: item.delegation_id || '',
  orchestration_task_id: item.orchestration_task_id || '',
  runtime_task_id: null,
  worker_conversation_id: item.worker_conversation_id || '',
  n8n_execution_id: item.n8n_execution_id || null,
  response_mode: 'delegated_blocked',
  parent_owner_label: item.parent_owner_label || 'Ghost',
} }];`,
    [2144, -352],
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

addNode(
  workflow,
  makePostgresNode(
    "Finalize Unsupported Delegation",
    `SELECT public.ghost_finalize_delegation(
  NULLIF($1, '')::uuid,
  NULL,
  'blocked',
  $2,
  NULL
);`,
    "={{ [$json.delegation_id || '', $json.unsupported_result_summary || 'Delegated worker execution is queued for later handling.'] }}",
    [2144, 64],
    false,
  ),
);

addNode(
  workflow,
  makeCodeNode(
    "Build Parent Unsupported Delegation Response",
    `const item = $('Build Delegation Context').item.json;
const workerLabel = item.worker_agent_label || item.delegated_provider || 'the delegated worker';
const reply = [
  \`\${item.parent_owner_label || 'Ghost'} kept ownership of this conversation and opened delegated work for \${workerLabel}.\`,
  'The work is now visible on the Task Board, but only explicit Codex execution is wired in this phase.',
].join('\\n\\n');
return [{ json: {
  conversation_id: item.conversation_id || '',
  reply,
  provider_used: item.parent_provider || '',
  model_used: item.parent_model || '',
  task_class: item.task_class || 'technical_work',
  approval_required: false,
  risk_level: item.risk_level || 'safe',
  risk_reasons: item.risk_reasons || [],
  task_summary: item.task_summary || '',
  command_success: false,
  command_exit_code: null,
  stdout_summary: '',
  stderr_summary: item.unsupported_result_summary || '',
  artifact_path: '',
  codex_command_status: 'queued_for_worker',
  error_type: 'delegation_execution_not_available',
  delegation_id: item.delegation_id || '',
  orchestration_task_id: item.orchestration_task_id || '',
  runtime_task_id: null,
  worker_conversation_id: item.worker_conversation_id || '',
  n8n_execution_id: item.n8n_execution_id || null,
  response_mode: 'delegated_queued',
  parent_owner_label: item.parent_owner_label || 'Ghost',
} }];`,
    [2368, 64],
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
    "={{ [$json.worker_conversation_id || '', $json.reply || '', $json.model_used || null, { provider_used: $json.provider_used || null, task_class: 'delegated_worker_task', delegation_id: $json.delegation_id || null, orchestration_task_id: $json.orchestration_task_id || null, runtime_task_id: $json.task_id || null, command_success: $json.command_success === true, command_exit_code: $json.command_exit_code !== undefined && $json.command_exit_code !== null ? $json.command_exit_code : null, stdout_summary: $json.stdout_summary || '', stderr_summary: $json.stderr_summary || '', artifact_path: $json.artifact_path || null, codex_command_status: $json.codex_command_status || 'not_applicable', error_type: $json.error_type || null, n8n_execution_id: $json.n8n_execution_id || null, worker_execution: true }] }}",
    [3264, -208],
    false,
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
    'n8n_execution_id', NULLIF($3, '')
  )
FROM target_event
WHERE te.id = target_event.id
  AND NULLIF($3, '') IS NOT NULL
RETURNING te.id::text AS tool_event_id;`,
    "={{ [$json.task_id || '', $json.task_run_id || '', $json.n8n_execution_id || ''] }}",
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
  worker_conversation_id: parent.worker_conversation_id || '',
  n8n_execution_id: parent.n8n_execution_id || item.n8n_execution_id || null,
  response_mode: 'delegated_worker_result',
  parent_owner_label: parent.parent_owner_label || 'Ghost',
} }];`,
    [3936, -208],
  ),
);

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

fs.writeFileSync(targetPath, JSON.stringify([workflow], null, 2) + "\n");
console.log(targetPath);
