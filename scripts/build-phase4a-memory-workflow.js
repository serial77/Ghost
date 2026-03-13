const fs = require('fs');
const crypto = require('crypto');

const sourcePath = '/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase3-final.json';
const targetPath = '/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.json';

const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))[0];
const existingWorkflowId = fs.existsSync(targetPath)
  ? JSON.parse(fs.readFileSync(targetPath, 'utf8'))[0]?.id
  : null;

const makeId = () => crypto.randomUUID();
const makeWorkflowId = () => crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
const findNode = (name) => {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
};

const normalizeInput = findNode('Normalize Input');
normalizeInput.parameters.assignments.assignments.push({
  id: makeId(),
  name: 'memory_test_mode',
  value: "={{ $json.body.memory_test_mode || '' }}",
  type: 'string',
});

const buildGhostSystemPrompt = findNode('Build Ghost System Prompt');
buildGhostSystemPrompt.parameters.assignments.assignments.push({
  id: makeId(),
  name: 'memory_test_mode',
  value: "={{ $('Normalize Input').item.json.memory_test_mode || '' }}",
  type: 'string',
});

const saveUserMessage = findNode('Save User Message');
saveUserMessage.parameters.options = {
  queryReplacement: `={{ [
  $json.conversation_id,
  $('Normalize Input').item.json.message,
  { source: 'ghost-chat-v3', type: 'user_message' }
] }}`,
};

const createNewConversation = findNode('Create New Conversation');
createNewConversation.parameters.options = {
  queryReplacement: `={{ [
  $('Normalize Input').item.json.conversation_id || '00000000-0000-0000-0000-000000000000',
  (($('Normalize Input').item.json.user_id || '').match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/) ? $('Normalize Input').item.json.user_id : 'NULL'),
  'Ghost Chat',
  'ghost-chat-v3',
  'active',
  {}
] }}`,
};

const loadGhostMemoryNode = {
  parameters: {
    operation: 'executeQuery',
    query: "WITH prioritized_memory AS (\n  SELECT\n    scope,\n    memory_type,\n    summary,\n    created_at,\n    importance,\n    COALESCE(NULLIF(details_json->>'topic_key', ''), lower(summary)) AS dedupe_key,\n    CASE scope\n      WHEN 'conversation' THEN 0\n      WHEN 'global' THEN 1\n      ELSE 2\n    END AS scope_rank,\n    CASE memory_type\n      WHEN 'decision' THEN 0\n      WHEN 'environment_fact' THEN 1\n      WHEN 'operational_note' THEN 2\n      WHEN 'task_summary' THEN 3\n      WHEN 'conversation_summary' THEN 4\n      ELSE 9\n    END AS type_rank\n  FROM ghost_memory\n  WHERE status = 'active'\n    AND (\n      conversation_id = NULLIF($1, '')::uuid\n      OR (\n        scope = 'global'\n        AND memory_type IN ('decision', 'environment_fact', 'operational_note')\n        AND importance >= 4\n      )\n    )\n), deduped_memory AS (\n  SELECT\n    scope,\n    memory_type,\n    summary,\n    created_at,\n    importance,\n    scope_rank,\n    type_rank,\n    ROW_NUMBER() OVER (\n      PARTITION BY scope, dedupe_key\n      ORDER BY type_rank ASC, importance DESC, created_at DESC\n    ) AS dedupe_rank\n  FROM prioritized_memory\n), conversation_memory AS (\n  SELECT\n    scope,\n    memory_type,\n    summary,\n    created_at,\n    importance,\n    scope_rank,\n    type_rank,\n    ROW_NUMBER() OVER (\n      ORDER BY type_rank ASC, importance DESC, created_at DESC\n    ) AS scope_row\n  FROM deduped_memory\n  WHERE dedupe_rank = 1\n    AND scope = 'conversation'\n), global_memory AS (\n  SELECT\n    scope,\n    memory_type,\n    summary,\n    created_at,\n    importance,\n    scope_rank,\n    type_rank,\n    ROW_NUMBER() OVER (\n      ORDER BY type_rank ASC, importance DESC, created_at DESC\n    ) AS scope_row\n  FROM deduped_memory\n  WHERE dedupe_rank = 1\n    AND scope = 'global'\n)\nSELECT scope, memory_type, summary, created_at, importance\nFROM (\n  SELECT * FROM conversation_memory WHERE scope_row <= 4\n  UNION ALL\n  SELECT * FROM global_memory WHERE scope_row <= 2\n) memory_items\nORDER BY scope_rank ASC, type_rank ASC, importance DESC, created_at DESC;",
    options: {
      queryReplacement: "={{ $('Touch Conversation Timestamp').item.json.conversation_id || $('Create New Conversation').item.json.conversation_id || $('Use Existing Conversation Context').item.json.conversation_id || '' }}",
    },
  },
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [-1904, 192],
  id: makeId(),
  name: 'Load Ghost Memory',
  credentials: {
    postgres: {
      id: 'r4pH8PimgUf2t9oM',
      name: 'Postgres account',
    },
  },
  continueOnFail: true,
};

const composePromptNode = {
  parameters: {
    jsCode: "const item = $input.first().json;\nconst priority = { decision: 0, environment_fact: 1, operational_note: 2, task_summary: 3, conversation_summary: 4 };\nconst normalizeWhitespace = (value) => String(value || '').replace(/\\s+/g, ' ').trim();\nconst normalizeKey = (entry) => `${entry.memory_type}|${entry.scope}|${normalizeWhitespace(entry.summary).toLowerCase()}`;\nconst compactSummary = (entry) => {\n  const limit = entry.memory_type === 'task_summary' || entry.memory_type === 'conversation_summary' ? 160 : 190;\n  return normalizeWhitespace(entry.summary).slice(0, limit);\n};\nconst memoryItems = $items('Load Ghost Memory')\n  .map((entry) => entry.json || {})\n  .filter((entry) => !entry.error && entry.memory_type && entry.summary && entry.scope)\n  .map((entry) => ({\n    scope: String(entry.scope).trim(),\n    memory_type: String(entry.memory_type).trim(),\n    importance: Number.isFinite(Number(entry.importance)) ? Number(entry.importance) : 3,\n    summary: compactSummary(entry),\n  }))\n  .filter((entry) => entry.summary)\n  .sort((a, b) => {\n    const scopeDiff = (a.scope === 'conversation' ? 0 : 1) - (b.scope === 'conversation' ? 0 : 1);\n    if (scopeDiff !== 0) return scopeDiff;\n    const typeDiff = (priority[a.memory_type] ?? 9) - (priority[b.memory_type] ?? 9);\n    if (typeDiff !== 0) return typeDiff;\n    return (b.importance || 0) - (a.importance || 0);\n  });\nconst seen = new Set();\nconst filteredMemoryItems = [];\nfor (const entry of memoryItems) {\n  const key = normalizeKey(entry);\n  if (!key || seen.has(key)) continue;\n  seen.add(key);\n  filteredMemoryItems.push(entry);\n  if (filteredMemoryItems.length >= 6) break;\n}\nconst ghostMemoryBlock = filteredMemoryItems.length\n  ? 'Ghost memory:\\n' + filteredMemoryItems.map((entry) => `- [${entry.memory_type}][${entry.scope}] ${entry.summary}`).join('\\n')\n  : '';\nconst systemPrompt = ghostMemoryBlock\n  ? `${item.system_prompt}\\nUse Ghost memory only when it is directly relevant. Prefer conversation memory over global memory when both exist.\\n\\n${ghostMemoryBlock}`\n  : item.system_prompt;\n\nreturn [{ json: {\n  ...item,\n  ghost_memory_items: filteredMemoryItems,\n  ghost_memory_block: ghostMemoryBlock,\n  system_prompt: systemPrompt,\n} }];",
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [-1680, 192],
  id: makeId(),
  name: 'Compose Prompt With Ghost Memory',
};

const buildMemoryExtractionInputNode = {
  parameters: {
    jsCode: "const savedMessage = $input.first().json;\nconst routeContext = $('Expose Route Metadata').item.json;\nconst replyContext = $('Build API Response').item.json;\nconst messages = Array.isArray(routeContext.messages) ? routeContext.messages : [];\nconst lastUser = [...messages].reverse().find((message) => message.role === 'user');\nconst latestUserMessage = (lastUser?.content || '').trim();\nconst assistantReply = (replyContext.reply || '').trim();\nconst memoryTestMode = $('Normalize Input').item.json.memory_test_mode || '';\nconst taskClass = replyContext.task_class || 'chat';\nconst meaningfulTechnicalWork = taskClass === 'technical_work'\n  && replyContext.command_success === true\n  && /(implement|implemented|fix|fixed|update|updated|patch|patched|migrate|migration|refactor|created|added|write|wrote|build|built)/i.test(`${latestUserMessage} ${assistantReply}`)\n  && assistantReply.length >= 24;\nconst explicitMemoryCue = /(decision|architectural decision|architecture decision|environment fact|runtime fact|operational note|runtime note|user preference|durable preference|remember this|preference|for future responses|always|never)/i.test(latestUserMessage);\nconst shouldExtractMemory = Boolean(savedMessage.id && assistantReply)\n  && !replyContext.approval_required\n  && replyContext.error_type !== 'approval_required'\n  && (taskClass !== 'technical_work' || replyContext.command_success !== false)\n  && (explicitMemoryCue || meaningfulTechnicalWork || assistantReply.length >= 40);\nconst extractionContract = {\n  items: [\n    {\n      scope: 'global|conversation|task',\n      memory_type: 'task_summary|decision|environment_fact|operational_note|conversation_summary',\n      title: 'short title or empty string',\n      summary: 'durable compact summary',\n      details_json: {},\n      importance: 1,\n    },\n  ],\n};\nconst extractionPrompt = [\n  'You extract durable structured Ghost memory.',\n  'Return JSON only. No markdown. No explanation. No surrounding prose.',\n  'Return exactly one object with one key: items.',\n  'If nothing qualifies, return {\"items\":[]}.',\n  'Each item must contain exactly these keys: scope, memory_type, title, summary, details_json, importance.',\n  'Allowed scope: global, conversation, task.',\n  'Allowed memory_type: task_summary, decision, environment_fact, operational_note, conversation_summary.',\n  'importance must be an integer 1..5.',\n  'title should be short. summary should be compact, durable, and under 240 characters.',\n  'details_json must be a small object. Use {} when not needed.',\n  'Do not store chit-chat, greetings, vague acknowledgements, raw runtime noise, stack traces, banners, code fences, or duplicate restatements.',\n  'Prefer decision, environment_fact, operational_note over weak summaries.',\n  'Only emit task_summary when meaningful work completed successfully.',\n  'Return at most 3 items.',\n  '',\n  'JSON schema shape:',\n  JSON.stringify(extractionContract),\n  '',\n  'Turn context JSON:',\n  JSON.stringify({\n    task_class: taskClass,\n    provider_used: replyContext.provider_used || '',\n    model_used: replyContext.model_used || '',\n    command_success: replyContext.command_success,\n    risk_level: replyContext.risk_level || 'safe',\n    meaningful_technical_work: meaningfulTechnicalWork,\n    latest_user_message: latestUserMessage,\n    assistant_reply: assistantReply,\n  }),\n].join('\\n');\n\nreturn [{ json: {\n  conversation_id: replyContext.conversation_id || '',\n  source_message_id: savedMessage.id || '',\n  task_class: taskClass,\n  latest_user_message: latestUserMessage,\n  assistant_reply: assistantReply,\n  memory_test_mode: memoryTestMode,\n  should_extract_memory: shouldExtractMemory,\n  meaningful_technical_work: meaningfulTechnicalWork,\n  extraction_prompt: extractionPrompt,\n  memory_debug: {\n    extractor_attempted: shouldExtractMemory,\n    extractor_skipped: !shouldExtractMemory,\n    fallback_used: false,\n    candidate_count: 0,\n    filtered_count: 0,\n    saved_count: 0,\n  },\n} }];",
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1264, 480],
  id: makeId(),
  name: 'Build Memory Extraction Input',
};

const shouldExtractMemoryNode = {
  parameters: {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'strict',
        version: 2,
      },
      conditions: [
        {
          id: makeId(),
          leftValue: '={{ $json.should_extract_memory }}',
          rightValue: true,
          operator: {
            type: 'boolean',
            operation: 'true',
            singleValue: true,
          },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [1488, 480],
  id: makeId(),
  name: 'Should Extract Memory?',
};

const useInvalidStubNode = {
  parameters: {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'strict',
        version: 2,
      },
      conditions: [
        {
          id: makeId(),
          leftValue: "={{ $json.memory_test_mode === 'invalid_json' }}",
          rightValue: true,
          operator: {
            type: 'boolean',
            operation: 'true',
            singleValue: true,
          },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [1712, 480],
  id: makeId(),
  name: 'Use Invalid Memory Stub?',
};

const invalidExtractorOutputNode = {
  parameters: {
    jsCode: "const item = $input.first().json;\nreturn [{ json: { ...item, output_text: 'not valid json', memory_extractor_debug: 'invalid_json' } }];",
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1936, 384],
  id: makeId(),
  name: 'Return Invalid Memory Extractor Output',
};

const callOpenAIMemoryExtractorNode = {
  parameters: {
    method: 'POST',
    url: '=https://api.openai.com/v1/responses',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        {
          name: 'Content-Type',
          value: 'application/json',
        },
      ],
    },
    sendBody: true,
    bodyParameters: {
      parameters: [
        {
          name: 'model',
          value: '=gpt-4.1-mini',
        },
        {
          name: 'input',
          value: '={{ $json.extraction_prompt }}',
        },
        {
          name: 'max_output_tokens',
          value: '=350',
        },
      ],
    },
    options: {},
  },
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.4,
  position: [1936, 576],
  id: makeId(),
  name: 'Call OpenAI Memory Extractor',
  credentials: {
    httpHeaderAuth: {
      id: 'YQzVSBDDIUnZHT10',
      name: 'Header Auth account',
    },
  },
  continueOnFail: true,
};

const parseStructuredMemoryNode = {
  parameters: {
    jsCode: "const response = $input.first().json;\nconst context = $('Build Memory Extraction Input').item.json;\nconst allowedScopes = new Set(['global', 'conversation', 'task']);\nconst allowedTypes = new Set(['task_summary', 'decision', 'environment_fact', 'operational_note', 'conversation_summary']);\nconst parseOutputText = () => {\n  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();\n  if (Array.isArray(response.output)) {\n    const text = response.output\n      .flatMap((entry) => Array.isArray(entry.content) ? entry.content : [])\n      .map((entry) => entry.text || entry.value || '')\n      .join('')\n      .trim();\n    if (text) return text;\n  }\n  if (typeof response.response === 'string' && response.response.trim()) return response.response.trim();\n  return '';\n};\nconst extractJsonText = (text) => {\n  if (!text) return '';\n  const trimmed = text.trim();\n  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;\n  const start = trimmed.indexOf('{');\n  const end = trimmed.lastIndexOf('}');\n  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;\n};\nconst sanitizeItem = (entry) => ({\n  scope: String(entry.scope || '').trim(),\n  memory_type: String(entry.memory_type || '').trim(),\n  title: entry.title ? String(entry.title).replace(/\\s+/g, ' ').trim().slice(0, 160) : '',\n  summary: String(entry.summary || '').replace(/\\s+/g, ' ').trim().slice(0, 240),\n  details_json: entry.details_json && typeof entry.details_json === 'object' && !Array.isArray(entry.details_json) ? entry.details_json : {},\n  importance: Number.isFinite(Number(entry.importance)) ? Math.max(1, Math.min(5, Math.round(Number(entry.importance)))) : 3,\n});\nconst hasNoisySummary = (summary) => /```|stack trace|exception:|error:|stderr|stdout|traceback|OpenAI Codex|session id:|tokens used|^hi$|^hello$|^thanks$|^ok$|^okay$|^understood$/i.test(summary);\nconst normalizedKey = (entry) => `${entry.scope}|${entry.memory_type}|${entry.summary.toLowerCase()}`;\nconst buildFallbackItems = () => {\n  if (context.memory_test_mode === 'invalid_json') return [];\n  const userText = String(context.latest_user_message || '').trim();\n  const normalizedUser = userText.replace(/\\s+/g, ' ').trim();\n  const fallbackItems = [];\n  const pushFallback = (entry) => fallbackItems.push(entry);\n  const preferenceMatch = normalizedUser.match(/(?:user preference(?: for this conversation)?|durable preference|preference|instruction|remember this|for future responses)\\s*:\\s*(.+)$/i);\n  if (preferenceMatch?.[1] && /(always|never|prefer|prefers|avoid|use|do not|don't|keep|concise|verbose|full config files|snippets)/i.test(preferenceMatch[1])) {\n    pushFallback({\n      scope: 'conversation',\n      memory_type: 'decision',\n      title: 'Durable preference',\n      summary: preferenceMatch[1],\n      details_json: { source: 'heuristic_fallback', trigger: 'explicit_preference' },\n      importance: 4,\n    });\n  }\n  const prefersSentence = normalizedUser.match(/(the user prefers .+?)(?:\\.\\s*(remember this preference|remember this|save this preference))?$/i);\n  if (prefersSentence?.[1] && /(prefers|avoid|use|do not|don't)/i.test(prefersSentence[1])) {\n    pushFallback({\n      scope: 'conversation',\n      memory_type: 'decision',\n      title: 'Durable preference',\n      summary: prefersSentence[1],\n      details_json: { source: 'heuristic_fallback', trigger: 'preference_sentence' },\n      importance: 4,\n    });\n  }\n  const architectureMatch = normalizedUser.match(/(?:architectural decision|architecture decision|decision(?: for this conversation)?)\\s*:\\s*(.+)$/i);\n  if (architectureMatch?.[1] && /(use|prefer|keep|avoid|do not|don't)/i.test(architectureMatch[1])) {\n    pushFallback({\n      scope: 'conversation',\n      memory_type: 'decision',\n      title: 'Architectural decision',\n      summary: architectureMatch[1],\n      details_json: { source: 'heuristic_fallback', trigger: 'explicit_decision' },\n      importance: 5,\n    });\n  }\n  const envFactMatch = normalizedUser.match(/(?:environment fact|runtime fact)\\s*:\\s*(.+)$/i);\n  if (envFactMatch?.[1] && envFactMatch[1].length >= 16) {\n    pushFallback({\n      scope: 'conversation',\n      memory_type: 'environment_fact',\n      title: 'Environment fact',\n      summary: envFactMatch[1],\n      details_json: { source: 'heuristic_fallback', trigger: 'explicit_fact' },\n      importance: 4,\n    });\n  }\n  const operationalNoteMatch = normalizedUser.match(/(?:operational note|runtime note)\\s*:\\s*(.+)$/i);\n  if (operationalNoteMatch?.[1] && operationalNoteMatch[1].length >= 16) {\n    pushFallback({\n      scope: 'conversation',\n      memory_type: 'operational_note',\n      title: 'Operational note',\n      summary: operationalNoteMatch[1],\n      details_json: { source: 'heuristic_fallback', trigger: 'explicit_operational_note' },\n      importance: 4,\n    });\n  }\n  const seen = new Set();\n  return fallbackItems.filter((entry) => {\n    const key = normalizedKey(sanitizeItem(entry));\n    if (seen.has(key)) return false;\n    seen.add(key);\n    return true;\n  });\n};\n\nlet rawText = parseOutputText();\nlet parsedItems = [];\nlet parseStatus = context.should_extract_memory ? 'attempted' : 'skipped';\nlet parseError = '';\nconst trimmedJsonText = extractJsonText(rawText);\n\nif (response.error) {\n  parseStatus = 'extractor_error';\n  parseError = typeof response.error === 'string' ? response.error : (response.error.message || 'memory extractor request failed');\n} else if (trimmedJsonText) {\n  try {\n    const parsed = JSON.parse(trimmedJsonText);\n    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.items)) {\n      parsedItems = parsed.items;\n      parseStatus = 'parsed';\n    } else {\n      parseStatus = 'invalid_shape';\n      parseError = 'Extractor response did not match {items:[...]}';\n    }\n  } catch (error) {\n    parseStatus = 'invalid_json';\n    parseError = error.message;\n  }\n}\n\nlet candidateItems = parsedItems\n  .filter((entry) => entry && typeof entry === 'object')\n  .map(sanitizeItem)\n  .filter((entry) => allowedScopes.has(entry.scope) && allowedTypes.has(entry.memory_type) && entry.summary)\n  .filter((entry) => JSON.stringify(entry.details_json).length <= 800)\n  .filter((entry) => !hasNoisySummary(entry.summary))\n  .map((entry) => ({\n    ...entry,\n    conversation_id: entry.scope === 'conversation' ? (context.conversation_id || null) : null,\n    task_run_id: null,\n    source_message_id: context.source_message_id || null,\n    status: 'active',\n  }));\n\nlet fallbackUsed = false;\nif (!candidateItems.length) {\n  const fallbackItems = buildFallbackItems().map((entry) => ({\n    ...sanitizeItem(entry),\n    conversation_id: context.conversation_id || null,\n    task_run_id: null,\n    source_message_id: context.source_message_id || null,\n    status: 'active',\n  }));\n  if (fallbackItems.length) {\n    candidateItems = fallbackItems;\n    fallbackUsed = true;\n    parseStatus = parseStatus === 'parsed' ? 'parsed_with_fallback' : 'heuristic_fallback';\n  }\n}\n\nreturn [{ json: {\n  ...context,\n  memory_parse_status: parseStatus,\n  memory_parse_error: parseError,\n  memory_raw_text: trimmedJsonText.slice(0, 2000),\n  memory_candidate_items: candidateItems,\n  memory_debug: {\n    ...(context.memory_debug || {}),\n    extractor_attempted: Boolean(context.should_extract_memory),\n    extractor_skipped: !context.should_extract_memory,\n    candidate_count: candidateItems.length,\n    fallback_used: fallbackUsed,\n    parse_status: parseStatus,\n  },\n} }];",
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [2160, 480],
  id: makeId(),
  name: 'Parse Structured Memory',
};

const filterStructuredMemoryCandidatesNode = {
  parameters: {
    jsCode: "const item = $input.first().json;\nconst priority = { decision: 100, environment_fact: 90, operational_note: 80, conversation_summary: 40, task_summary: 30 };\nconst lowerUser = String(item.latest_user_message || '').toLowerCase();\nconst memoryCandidates = Array.isArray(item.memory_candidate_items) ? item.memory_candidate_items : [];\nconst meaningfulTaskSummary = item.task_class === 'technical_work'\n  && item.meaningful_technical_work === true\n  && /(implement|implemented|fix|fixed|update|updated|patch|patched|migrate|migration|refactor|created|added|write|wrote|build|built)/i.test(`${item.latest_user_message} ${item.assistant_reply}`);\nconst skipPatterns = [/^hello\\b/i, /^hi\\b/i, /^thanks\\b/i, /^thank you\\b/i, /^okay\\b/i, /^understood\\b/i, /^ping\\d+$/i, /^say hello/i, /^reply with exactly/i];\nconst noisePatterns = [/```/, /stack trace/i, /traceback/i, /stderr/i, /stdout/i, /openai codex/i, /session id:/i, /tokens used/i, /error:/i, /exception:/i];\nconst normalizeWhitespace = (value) => String(value || '').replace(/\\s+/g, ' ').trim();\nconst normalizeClause = (value) => normalizeWhitespace(value).replace(/[.!?]+$/g, '').toLowerCase();\nconst normalizeTopicText = (value) => normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9\\s:_-]/g, ' ').replace(/\\s+/g, ' ').trim();\nconst conservativeTypes = new Set(['decision', 'environment_fact', 'operational_note']);\nconst canonicalPunctuationTypes = new Set(['decision', 'environment_fact', 'operational_note']);\nconst stripWrapperPhrases = (summary, memoryType) => {\n  let text = normalizeWhitespace(summary);\n  if (!text || !conservativeTypes.has(memoryType)) return text;\n  text = text\n    .replace(/^(architectural decision|architecture decision|decision(?: for this conversation)?|environment fact|runtime fact|operational note|runtime note|user preference(?: for this conversation)?|durable preference|preference|durable instruction)\\s*:\\s*/i, '')\n    .replace(/^remember\\s+(?:that\\s+)?/i, '')\n    .replace(/^please\\s+/i, '')\n    .replace(/\\s*[.?!]?\\s*(confirm briefly|confirm clearly|confirm|briefly confirm|save only the durable decision|save only the durable fact|save only the durable note|save this note|save this preference|remember this preference|remember this note|remember this preference for future responses|keep only the durable decision|keep only the durable fact|keep only the durable note|remember this preference)\\s*[.?!]*$/i, '');\n  return normalizeWhitespace(text);\n};\nconst collapseDuplicateClauses = (summary, memoryType) => {\n  const text = normalizeWhitespace(summary);\n  if (!text || !conservativeTypes.has(memoryType)) return text;\n  const parts = text.split(/(?<=[.!?])\\s+/).map((part) => normalizeWhitespace(part)).filter(Boolean);\n  if (!parts.length) return text;\n  const deduped = [];\n  const seenClauses = new Set();\n  for (const part of parts) {\n    const key = normalizeClause(part);\n    if (!key || seenClauses.has(key)) continue;\n    seenClauses.add(key);\n    deduped.push(part);\n  }\n  if (!deduped.length) return text;\n  if (deduped.length === 2) {\n    const first = normalizeClause(deduped[0]);\n    const second = normalizeClause(deduped[1]);\n    if (first && second && (first.includes(second) || second.includes(first))) {\n      return normalizeWhitespace(first.length <= second.length ? deduped[0] : deduped[1]);\n    }\n  }\n  return normalizeWhitespace(deduped.join(' '));\n};\nconst canonicalizeShortFallbackSummary = (summary, memoryType, detailsJson) => {\n  const text = normalizeWhitespace(summary);\n  if (!text) return text;\n  if (!canonicalPunctuationTypes.has(memoryType)) return text;\n  if (!detailsJson || detailsJson.source !== 'heuristic_fallback') return text;\n  if (text.length > 120) return text;\n  if (/[?;:]$/.test(text)) return text;\n  return normalizeWhitespace(text.replace(/[.!]+$/g, ''));\n};\nconst normalizeSummary = (summary, memoryType, detailsJson) => {\n  const original = normalizeWhitespace(summary);\n  if (!original) return '';\n  let cleaned = stripWrapperPhrases(original, memoryType);\n  cleaned = collapseDuplicateClauses(cleaned, memoryType);\n  cleaned = stripWrapperPhrases(cleaned, memoryType);\n  cleaned = canonicalizeShortFallbackSummary(cleaned, memoryType, detailsJson);\n  cleaned = normalizeWhitespace(cleaned);\n  if (!cleaned) return original;\n  if (cleaned.length < 12 && original.length >= 12) return original;\n  return cleaned;\n};\nconst deriveTopicKey = (summary, memoryType) => {\n  const normalized = normalizeTopicText(summary);\n  if (!normalized || !conservativeTypes.has(memoryType)) return '';\n  if (memoryType === 'environment_fact') {\n    const subjectMatch = normalized.match(/^(?:the\\s+)?(.+?)\\s+(uses|is|runs|has|requires|needs|supports|remains|stays)\\b/);\n    if (subjectMatch?.[1]) return `environment_fact:${subjectMatch[1].trim().slice(0, 64)}`;\n  }\n  if (memoryType === 'operational_note') {\n    const opMatch = normalized.match(/^(restart|reload|publish|deploy|run|use)\\s+(.+?)(?:\\s+(after|before|when|for)\\b|$)/);\n    if (opMatch?.[1] && opMatch?.[2]) return `operational_note:${opMatch[1]}:${opMatch[2].trim().slice(0, 64)}`;\n  }\n  return `exact:${memoryType}:${normalized.slice(0, 120)}`;\n};\nconst decorateDetailsJson = (entry, summary) => {\n  const details = entry.details_json && typeof entry.details_json === 'object' && !Array.isArray(entry.details_json)\n    ? { ...entry.details_json }\n    : {};\n  const topicKey = deriveTopicKey(summary, entry.memory_type);\n  if (topicKey) details.topic_key = topicKey;\n  if (entry.memory_type === 'decision' && ['explicit_preference', 'preference_sentence'].includes(String(details.trigger || ''))) {\n    details.memory_origin = 'durable_user_preference';\n  }\n  return details;\n};\nconst normalizeKey = (entry) => {\n  const details = entry.details_json && typeof entry.details_json === 'object' && !Array.isArray(entry.details_json) ? entry.details_json : {};\n  const topicKey = normalizeWhitespace(details.topic_key || '');\n  return `${entry.scope}|${entry.memory_type}|${(topicKey || String(entry.summary || '').toLowerCase())}`;\n};\nconst filteredOut = [];\nconst normalizationChanges = [];\nconst seen = new Set();\nconst filtered = memoryCandidates.map((entry) => {\n  const originalSummary = normalizeWhitespace(entry.summary || '');\n  const normalizedSummary = normalizeSummary(originalSummary, entry.memory_type, entry.details_json || {});\n  const nextSummary = normalizedSummary || originalSummary;\n  const nextDetailsJson = decorateDetailsJson(entry, nextSummary);\n  if (originalSummary && nextSummary && originalSummary !== nextSummary) {\n    normalizationChanges.push({ memory_type: entry.memory_type, before: originalSummary, after: nextSummary });\n  }\n  return { ...entry, summary: nextSummary, details_json: nextDetailsJson };\n}).filter((entry) => {\n  const summary = normalizeWhitespace(entry.summary || '');\n  const key = normalizeKey({ ...entry, summary });\n  if (!summary) { filteredOut.push({ reason: 'empty_summary', key }); return false; }\n  if (summary.length < 16) { filteredOut.push({ reason: 'too_short', key }); return false; }\n  if (skipPatterns.some((pattern) => pattern.test(summary)) || skipPatterns.some((pattern) => pattern.test(lowerUser))) { filteredOut.push({ reason: 'trivial_chitchat', key }); return false; }\n  if (noisePatterns.some((pattern) => pattern.test(summary))) { filteredOut.push({ reason: 'runtime_noise', key }); return false; }\n  if (entry.memory_type === 'task_summary' && !meaningfulTaskSummary) { filteredOut.push({ reason: 'weak_task_summary', key }); return false; }\n  if (seen.has(key)) { filteredOut.push({ reason: 'duplicate_in_pass', key }); return false; }\n  seen.add(key);\n  return true;\n}).sort((a, b) => (priority[b.memory_type] || 0) - (priority[a.memory_type] || 0)).slice(0, 3);\n\nreturn [{ json: {\n  ...item,\n  memory_items: filtered,\n  memory_debug: {\n    ...(item.memory_debug || {}),\n    candidate_count: memoryCandidates.length,\n    filtered_count: filtered.length,\n    filtered_out_count: filteredOut.length,\n    filtered_out_reasons: filteredOut.slice(0, 10),\n    normalization_changes: normalizationChanges.slice(0, 10),\n  },\n} }];",
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [2384, 480],
  id: makeId(),
  name: 'Filter Structured Memory Candidates',
};

const saveStructuredMemoryNode = {
  parameters: {
    operation: 'executeQuery',
    query: "WITH input_rows AS (\n  SELECT *\n  FROM jsonb_to_recordset($1::jsonb) AS x(\n    scope TEXT,\n    memory_type TEXT,\n    conversation_id UUID,\n    task_run_id UUID,\n    source_message_id UUID,\n    title TEXT,\n    summary TEXT,\n    details_json JSONB,\n    importance SMALLINT,\n    status TEXT\n  )\n), validated AS (\n  SELECT\n    gen_random_uuid() AS id,\n    scope,\n    memory_type,\n    conversation_id,\n    task_run_id,\n    source_message_id,\n    NULLIF(title, '') AS title,\n    summary,\n    COALESCE(details_json, '{}'::jsonb) AS details_json,\n    GREATEST(1, LEAST(5, COALESCE(importance, 3)))::smallint AS importance,\n    COALESCE(status, 'active') AS status\n  FROM input_rows\n  WHERE scope IN ('global', 'conversation', 'task')\n    AND memory_type IN ('task_summary', 'decision', 'environment_fact', 'operational_note', 'conversation_summary')\n    AND COALESCE(status, 'active') IN ('active', 'superseded', 'archived')\n    AND NULLIF(summary, '') IS NOT NULL\n), inserted AS (\n  INSERT INTO ghost_memory (\n    id,\n    scope,\n    memory_type,\n    conversation_id,\n    task_run_id,\n    source_message_id,\n    title,\n    summary,\n    details_json,\n    importance,\n    status\n  )\n  SELECT\n    id,\n    scope,\n    memory_type,\n    conversation_id,\n    task_run_id,\n    source_message_id,\n    title,\n    summary,\n    details_json,\n    importance,\n    status\n  FROM validated\n  RETURNING id, scope, memory_type, conversation_id, summary, details_json, created_at\n), superseded AS (\n  UPDATE ghost_memory older\n  SET status = 'superseded', updated_at = NOW()\n  FROM inserted newer\n  WHERE older.id <> newer.id\n    AND older.status = 'active'\n    AND older.memory_type = newer.memory_type\n    AND older.scope = newer.scope\n    AND older.memory_type IN ('decision', 'environment_fact', 'operational_note')\n    AND COALESCE(older.conversation_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(newer.conversation_id, '00000000-0000-0000-0000-000000000000'::uuid)\n    AND (\n      (\n        COALESCE(NULLIF(newer.details_json->>'topic_key', ''), '') <> ''\n        AND NULLIF(older.details_json->>'topic_key', '') = NULLIF(newer.details_json->>'topic_key', '')\n      )\n      OR lower(older.summary) = lower(newer.summary)\n    )\n  RETURNING older.id\n)\nSELECT\n  inserted.id,\n  inserted.scope,\n  inserted.memory_type,\n  inserted.summary,\n  inserted.created_at,\n  (SELECT COUNT(*) FROM superseded) AS superseded_count\nFROM inserted;",
    options: {
      queryReplacement: '={{ JSON.stringify($json.memory_items || []) }}',
    },
  },
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [2608, 480],
  id: makeId(),
  name: 'Save Structured Memory',
  credentials: {
    postgres: {
      id: 'r4pH8PimgUf2t9oM',
      name: 'Postgres account',
    },
  },
  continueOnFail: true,
};

const summarizeMemoryWriteOutcomeNode = {
  parameters: {
    jsCode: "const rows = $input.all().map((entry) => entry.json || {});\nconst context = $('Filter Structured Memory Candidates').item.json;\nconst savedRows = rows.filter((row) => !row.error && row.id);\nconst supersededCount = savedRows.length ? Number(savedRows[0].superseded_count || 0) : 0;\nreturn [{ json: {\n  conversation_id: context.conversation_id || '',\n  source_message_id: context.source_message_id || '',\n  memory_debug: {\n    ...(context.memory_debug || {}),\n    saved_count: savedRows.length,\n    superseded_count: supersededCount,\n    saved_items: savedRows.map((row) => ({\n      id: row.id,\n      scope: row.scope,\n      memory_type: row.memory_type,\n      summary: row.summary,\n    })),\n  },\n} }];",
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [2832, 480],
  id: makeId(),
  name: 'Summarize Memory Write Outcome',
};

workflow.nodes.push(
  loadGhostMemoryNode,
  composePromptNode,
  buildMemoryExtractionInputNode,
  shouldExtractMemoryNode,
  useInvalidStubNode,
  invalidExtractorOutputNode,
  callOpenAIMemoryExtractorNode,
  parseStructuredMemoryNode,
  filterStructuredMemoryCandidatesNode,
  saveStructuredMemoryNode,
  summarizeMemoryWriteOutcomeNode,
);

workflow.connections['Load Recent Messages'].main = [[{ node: 'Load Ghost Memory', type: 'main', index: 0 }]];
workflow.connections['Load Ghost Memory'] = {
  main: [[{ node: 'Build Ghost System Prompt', type: 'main', index: 0 }]],
};
workflow.connections['Build Ghost System Prompt'].main = [[{ node: 'Compose Prompt With Ghost Memory', type: 'main', index: 0 }]];
workflow.connections['Compose Prompt With Ghost Memory'] = {
  main: [[{ node: 'Build Structured Messages', type: 'main', index: 0 }]],
};
workflow.connections['Save Assistant Reply'].main = [[
  { node: 'Touch Conversation Timestamp After Reply', type: 'main', index: 0 },
  { node: 'Build Memory Extraction Input', type: 'main', index: 0 },
]];
workflow.connections['Build Memory Extraction Input'] = {
  main: [[{ node: 'Should Extract Memory?', type: 'main', index: 0 }]],
};
workflow.connections['Should Extract Memory?'] = {
  main: [
    [{ node: 'Use Invalid Memory Stub?', type: 'main', index: 0 }],
    [],
  ],
};
workflow.connections['Use Invalid Memory Stub?'] = {
  main: [
    [{ node: 'Return Invalid Memory Extractor Output', type: 'main', index: 0 }],
    [{ node: 'Call OpenAI Memory Extractor', type: 'main', index: 0 }],
  ],
};
workflow.connections['Return Invalid Memory Extractor Output'] = {
  main: [[{ node: 'Parse Structured Memory', type: 'main', index: 0 }]],
};
workflow.connections['Call OpenAI Memory Extractor'] = {
  main: [[{ node: 'Parse Structured Memory', type: 'main', index: 0 }]],
};
workflow.connections['Parse Structured Memory'] = {
  main: [[{ node: 'Filter Structured Memory Candidates', type: 'main', index: 0 }]],
};
workflow.connections['Filter Structured Memory Candidates'] = {
  main: [[{ node: 'Save Structured Memory', type: 'main', index: 0 }]],
};
workflow.connections['Save Structured Memory'] = {
  main: [[{ node: 'Summarize Memory Write Outcome', type: 'main', index: 0 }]],
};

workflow.id = existingWorkflowId || makeWorkflowId();
workflow.name = 'GHOST by Codex Phase4A Memory Dev';
workflow.description = 'Phase 4A structured Ghost memory dev workflow';
workflow.active = false;
workflow.isArchived = false;
delete workflow.versionId;
delete workflow.activeVersionId;
delete workflow.versionCounter;
delete workflow.triggerCount;
delete workflow.updatedAt;
delete workflow.createdAt;
delete workflow.shared;
delete workflow.versionMetadata;

const incomingChat = findNode('Incoming chat');
incomingChat.parameters.path = 'ghost-chat-v3-memory-dev';
incomingChat.webhookId = makeId();

fs.writeFileSync(targetPath, JSON.stringify([workflow], null, 2) + '\n');
