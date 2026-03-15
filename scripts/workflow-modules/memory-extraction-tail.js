"use strict";

function assertHasSingleMainConnection(workflow, fromNode, toNode) {
  const outputs = workflow.connections[fromNode]?.main || [];
  const firstOutput = Array.isArray(outputs[0]) ? outputs[0] : [];
  if (!firstOutput.some((entry) => entry.node === toNode)) {
    throw new Error(`Memory-tail contract check failed: missing connection ${fromNode} -> ${toNode}`);
  }
}

function applyMemoryExtractionTailModule({ workflow, findNode }) {
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
}

function assertMemoryExtractionTailContract({ workflow, findNode, assertIncludes }) {
  const buildMemoryExtractionInput = findNode(workflow, "Build Memory Extraction Input");
  const parseStructuredMemory = findNode(workflow, "Parse Structured Memory");
  const filterStructuredMemoryCandidates = findNode(workflow, "Filter Structured Memory Candidates");
  const summarizeMemoryWriteOutcome = findNode(workflow, "Summarize Memory Write Outcome");

  const extractionInputCode = buildMemoryExtractionInput.parameters.jsCode;
  const parseCode = parseStructuredMemory.parameters.jsCode;
  const filterCode = filterStructuredMemoryCandidates.parameters.jsCode;
  const summarizeCode = summarizeMemoryWriteOutcome.parameters.jsCode;

  for (const field of [
    "should_extract_memory",
    "meaningful_technical_work",
    "memory_test_mode",
    "extraction_prompt",
    "memory_debug",
    "responseMode.startsWith('delegated_')",
    "replyContext.command_success !== false",
  ]) {
    assertIncludes(extractionInputCode, field, "Build Memory Extraction Input");
  }

  for (const field of ["JSON.parse", "items", "memory_debug"]) {
    assertIncludes(parseCode, field, "Parse Structured Memory");
  }

  for (const field of ["memory_type", "filtered_count", "weak_task_summary"]) {
    assertIncludes(filterCode, field, "Filter Structured Memory Candidates");
  }

  for (const field of ["saved_count", "superseded_count", "saved_items"]) {
    assertIncludes(summarizeCode, field, "Summarize Memory Write Outcome");
  }

  assertHasSingleMainConnection(workflow, "Build Memory Extraction Input", "Should Extract Memory?");
  assertHasSingleMainConnection(workflow, "Should Extract Memory?", "Use Invalid Memory Stub?");
  assertHasSingleMainConnection(workflow, "Use Invalid Memory Stub?", "Return Invalid Memory Extractor Output");
  const useInvalidOutputs = workflow.connections["Use Invalid Memory Stub?"]?.main || [];
  const secondOutput = Array.isArray(useInvalidOutputs[1]) ? useInvalidOutputs[1] : [];
  if (!secondOutput.some((entry) => entry.node === "Call OpenAI Memory Extractor")) {
    throw new Error("Memory-tail contract check failed: missing connection Use Invalid Memory Stub? -> Call OpenAI Memory Extractor");
  }
  assertHasSingleMainConnection(workflow, "Return Invalid Memory Extractor Output", "Parse Structured Memory");
  assertHasSingleMainConnection(workflow, "Call OpenAI Memory Extractor", "Parse Structured Memory");
  assertHasSingleMainConnection(workflow, "Parse Structured Memory", "Filter Structured Memory Candidates");
  assertHasSingleMainConnection(workflow, "Filter Structured Memory Candidates", "Save Structured Memory");
  assertHasSingleMainConnection(workflow, "Save Structured Memory", "Summarize Memory Write Outcome");
}

module.exports = {
  applyMemoryExtractionTailModule,
  assertMemoryExtractionTailContract,
};
