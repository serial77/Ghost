const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const projectRoot = "/home/deicide/dev/ghost-stack";
const sourcePath = path.join(projectRoot, "workflows", "ghost-chat-v3.phase5d-backup-20260312T211951Z.json");
const targetPath = path.join(projectRoot, "workflows", "ghost-chat-v3-phase5d-runtime-ledger.json");

function makeId() {
  return crypto.randomUUID();
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

function ensureAssignment(node, assignment) {
  const assignments = node.parameters.assignments.assignments;
  const existing = assignments.find((entry) => entry.name === assignment.name);
  if (existing) {
    Object.assign(existing, assignment);
    return;
  }
  assignments.push(assignment);
}

function appendConnection(connections, fromNode, toNode) {
  const output = connections[fromNode]?.main?.[0];
  if (!output) {
    throw new Error(`Missing main output for ${fromNode}`);
  }
  if (!output.some((entry) => entry.node === toNode)) {
    output.push({ node: toNode, type: "main", index: 0 });
  }
}

function removeConnection(connections, fromNode, toNode) {
  const output = connections[fromNode]?.main?.[0];
  if (!output) {
    return;
  }
  connections[fromNode].main[0] = output.filter((entry) => entry.node !== toNode);
}

function addNode(workflow, node) {
  if (!workflow.nodes.some((entry) => entry.name === node.name)) {
    workflow.nodes.push(node);
  }
}

const [workflowWrapper] = loadWorkflow(sourcePath);
const workflow = workflowWrapper;

const normalizeInput = findNode(workflow, "Normalize Input");
ensureAssignment(normalizeInput, {
  id: makeId(),
  name: "entrypoint",
  value: "={{ $json.headers['x-ghost-entry-point'] || $json.headers['X-Ghost-Entry-Point'] || 'direct_webhook' }}",
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
} }];`;

addNode(workflow, {
  parameters: {
    jsCode: `const context = $input.first().json;
const normalized = $('Normalize Input').item.json;
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
  }),
  context_json: JSON.stringify({
    entrypoint: normalized.entrypoint || 'direct_webhook',
    execution_target: 'webhook/ghost-chat-v3',
    workflow_name: 'GHOST by Codex',
  }),
} }];`,
  },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [-2672, 96],
  id: makeId(),
  name: "Build Runtime Ledger Start Payload",
});

addNode(workflow, {
  parameters: {
    operation: "executeQuery",
    query: `SELECT
  task_id::text,
  task_run_id::text
FROM public.ghost_runtime_start_task_ledger(
  NULLIF($1, '')::uuid,
  $2,
  $3,
  'webhook/ghost-chat-v3',
  'GHOST by Codex',
  $4::jsonb,
  $5::jsonb
);`,
    options: {
      queryReplacement: "={{ [$json.conversation_id || '', $json.message || '', $json.entrypoint || 'direct_webhook', $json.input_payload_json || '{}', $json.context_json || '{}'] }}",
    },
  },
  type: "n8n-nodes-base.postgres",
  typeVersion: 2.6,
  position: [-2448, 96],
  id: makeId(),
  name: "Start Runtime Ledger",
  credentials: {
    postgres: {
      id: "r4pH8PimgUf2t9oM",
      name: "Postgres account",
    },
  },
  continueOnFail: true,
});

addNode(workflow, {
  parameters: {
    jsCode: `const item = $input.first().json;
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
  entrypoint: normalized.entrypoint || 'direct_webhook',
} }];`,
  },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1584, 96],
  id: makeId(),
  name: "Build Runtime Ledger Completion Payload",
});

addNode(workflow, {
  parameters: {
    operation: "executeQuery",
    query: `SELECT public.ghost_runtime_complete_task_ledger(
  NULLIF($1, '')::uuid,
  NULLIF($2, '')::uuid,
  200,
  $3::jsonb,
  NULLIF($4, '')::uuid,
  NULLIF($5, ''),
  NULLIF($6, ''),
  NULLIF($7, ''),
  COALESCE($8, false),
  $9,
  NULLIF($10, ''),
  NULLIF($11, ''),
  NULLIF($12, ''),
  NULLIF($13, '')
);`,
    options: {
      queryReplacement: "={{ [$json.task_id || '', $json.task_run_id || '', $json.output_payload_json || '{}', $json.conversation_id || '', $json.task_class || '', $json.provider_used || '', $json.model_used || '', $json.approval_required || false, $json.command_success, $json.error_type || '', $json.task_summary || '', $json.artifact_path || '', $json.entrypoint || 'direct_webhook'] }}",
    },
  },
  type: "n8n-nodes-base.postgres",
  typeVersion: 2.6,
  position: [1808, 96],
  id: makeId(),
  name: "Complete Runtime Ledger",
  credentials: {
    postgres: {
      id: "r4pH8PimgUf2t9oM",
      name: "Postgres account",
    },
  },
  continueOnFail: true,
});

removeConnection(workflow.connections, "Conversation Context", "Start Runtime Ledger");
appendConnection(workflow.connections, "Conversation Context", "Build Runtime Ledger Start Payload");
workflow.connections["Build Runtime Ledger Start Payload"] = {
  main: [[{ node: "Start Runtime Ledger", type: "main", index: 0 }]],
};

removeConnection(workflow.connections, "Build API Response", "Complete Runtime Ledger");
appendConnection(workflow.connections, "Build API Response", "Build Runtime Ledger Completion Payload");
workflow.connections["Build Runtime Ledger Completion Payload"] = {
  main: [[{ node: "Complete Runtime Ledger", type: "main", index: 0 }]],
};

fs.writeFileSync(targetPath, JSON.stringify([workflow], null, 2) + "\n");
console.log(targetPath);
