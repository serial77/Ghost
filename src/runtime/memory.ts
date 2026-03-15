// Ghost memory pipeline: extract, consolidate, and persist structured memories.
// Extracted from Ghost_Memory sub-workflow nodes:
//   - Build Memory Extraction Input  (shouldExtractMemory, buildExtractionPrompt)
//   - Parse Structured Memory        (extractMemories)
//   - Filter Structured Memory Candidates (consolidateMemories)
//   - Filter Structured Memory Candidates (storeMemories)
//
// Public contract:
//   extractMemories(rawOutput, ctx)  — parse LLM output into validated candidates
//   consolidateMemories(candidates, ctx) — deduplicate, normalize, filter, sort
//   storeMemories(memories, ctx)     — map to approved memories table write rows
//
// Supporting exports (used by workflow pre-LLM nodes):
//   shouldExtractMemory(ctx)         — extraction gate decision
//   buildExtractionPrompt(ctx)       — build prompt for the LLM extractor

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemoryScope = 'global' | 'conversation' | 'task';
export type MemoryCategory =
  | 'task_summary'
  | 'decision'
  | 'environment_fact'
  | 'operational_note'
  | 'conversation_summary';
export type MemoryTier = 'working' | 'long_term' | 'semantic';
export type MemoryStatus = 'active' | 'superseded' | 'archived';
export type MemorySourceType =
  | 'llm_extraction'
  | 'heuristic_fallback'
  | 'operator_direct'
  | 'system';

export interface MemoryContext {
  conversation_id?: string | null;
  user_id?: string | null;
  source_message_id?: string | null;
  task_run_id?: string | null;
  task_class?: string;
  assistant_reply?: string;
  latest_user_message?: string;
  command_success?: boolean | null;
  response_mode?: string;
  approval_required?: boolean;
  error_type?: string;
  memory_test_mode?: string;
  provider_used?: string;
  model_used?: string;
  risk_level?: string;
  meaningful_technical_work?: boolean;
}

export interface ShouldExtractResult {
  should_extract: boolean;
  meaningful_technical_work: boolean;
  explicit_memory_cue: boolean;
}

// Internal candidate shape — preserves original extraction fields across pipeline stages
export interface MemoryCandidate {
  scope: MemoryScope;
  memory_type: MemoryCategory;
  title: string;
  summary: string;
  details_json: Record<string, unknown>;
  importance: number;
  conversation_id?: string | null;
  source_message_id?: string | null;
  task_run_id?: string | null;
  status?: MemoryStatus;
}

// Approved store-side row shape — maps to the memories table
export interface MemoryWriteRow {
  user_id: string | null;
  conversation_id: string | null;
  memory_tier: MemoryTier;
  content: string;
  category: MemoryCategory;
  confidence: number;
  status: MemoryStatus;
  superseded_by: string | null;
  supersedes: string | null;
  source_type: MemorySourceType;
  source_message: string | null;
}

export interface ExtractMemoriesResult {
  candidates: MemoryCandidate[];
  parse_status: string;
  parse_error: string;
  fallback_used: boolean;
  raw_text: string;
}

export interface ConsolidationResult {
  memories: MemoryCandidate[];
  filtered_out_count: number;
  filtered_out_reasons: Array<{ reason: string; key: string }>;
  normalization_changes: Array<{ memory_type: string; before: string; after: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_SCOPES = new Set<string>(['global', 'conversation', 'task']);
const ALLOWED_CATEGORIES = new Set<string>([
  'task_summary',
  'decision',
  'environment_fact',
  'operational_note',
  'conversation_summary',
]);
const CONSERVATIVE_TYPES = new Set<string>(['decision', 'environment_fact', 'operational_note']);
const CANONICAL_PUNCTUATION_TYPES = new Set<string>([
  'decision',
  'environment_fact',
  'operational_note',
]);

const MEMORY_TYPE_PRIORITY: Record<string, number> = {
  decision: 100,
  environment_fact: 90,
  operational_note: 80,
  conversation_summary: 40,
  task_summary: 30,
};

const SKIP_PATTERNS = [
  /^hello\b/i,
  /^hi\b/i,
  /^thanks\b/i,
  /^thank you\b/i,
  /^okay\b/i,
  /^understood\b/i,
  /^ping\d+$/i,
  /^say hello/i,
  /^reply with exactly/i,
];

const NOISE_PATTERNS = [
  /```/,
  /stack trace/i,
  /traceback/i,
  /stderr/i,
  /stdout/i,
  /openai codex/i,
  /session id:/i,
  /tokens used/i,
  /error:/i,
  /exception:/i,
];

const NOISY_SUMMARY_RE =
  /```|stack trace|exception:|error:|stderr|stdout|traceback|OpenAI Codex|session id:|tokens used|^hi$|^hello$|^thanks$|^ok$|^okay$|^understood$/i;

// Scope → memory_tier mapping
const SCOPE_TO_TIER: Record<MemoryScope, MemoryTier> = {
  global: 'long_term',
  conversation: 'working',
  task: 'working',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function extractJsonText(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function sanitizeRawItem(entry: Record<string, unknown>): MemoryCandidate {
  return {
    scope: String(entry.scope ?? '').trim() as MemoryScope,
    memory_type: String(entry.memory_type ?? '').trim() as MemoryCategory,
    title: entry.title ? String(entry.title).replace(/\s+/g, ' ').trim().slice(0, 160) : '',
    summary: String(entry.summary ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240),
    details_json:
      entry.details_json &&
      typeof entry.details_json === 'object' &&
      !Array.isArray(entry.details_json)
        ? (entry.details_json as Record<string, unknown>)
        : {},
    importance: Number.isFinite(Number(entry.importance))
      ? Math.max(1, Math.min(5, Math.round(Number(entry.importance))))
      : 3,
  };
}

function normalizeClause(value: string): string {
  return normalizeWhitespace(value)
    .replace(/[.!?]+$/g, '')
    .toLowerCase();
}

function normalizeTopicText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s:_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripWrapperPhrases(summary: string, memoryType: string): string {
  let text = normalizeWhitespace(summary);
  if (!text || !CONSERVATIVE_TYPES.has(memoryType)) return text;
  text = text
    .replace(
      /^(architectural decision|architecture decision|decision(?: for this conversation)?|environment fact|runtime fact|operational note|runtime note|user preference(?: for this conversation)?|durable preference|preference|durable instruction)\s*:\s*/i,
      '',
    )
    .replace(/^remember\s+(?:that\s+)?/i, '')
    .replace(/^please\s+/i, '')
    .replace(
      /\s*[.?!]?\s*(confirm briefly|confirm clearly|confirm|briefly confirm|save only the durable decision|save only the durable fact|save only the durable note|save this note|save this preference|remember this preference|remember this note|remember this preference for future responses|keep only the durable decision|keep only the durable fact|keep only the durable note|remember this preference)\s*[.?!]*$/i,
      '',
    );
  return normalizeWhitespace(text);
}

function collapseDuplicateClauses(summary: string, memoryType: string): string {
  const text = normalizeWhitespace(summary);
  if (!text || !CONSERVATIVE_TYPES.has(memoryType)) return text;
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map(normalizeWhitespace)
    .filter(Boolean);
  if (!parts.length) return text;
  const deduped: string[] = [];
  const seenClauses = new Set<string>();
  for (const part of parts) {
    const key = normalizeClause(part);
    if (!key || seenClauses.has(key)) continue;
    seenClauses.add(key);
    deduped.push(part);
  }
  if (!deduped.length) return text;
  if (deduped.length === 2) {
    const first = normalizeClause(deduped[0]);
    const second = normalizeClause(deduped[1]);
    if (first && second && (first.includes(second) || second.includes(first))) {
      return normalizeWhitespace(first.length <= second.length ? deduped[0] : deduped[1]);
    }
  }
  return normalizeWhitespace(deduped.join(' '));
}

function canonicalizeShortFallbackSummary(
  summary: string,
  memoryType: string,
  detailsJson: Record<string, unknown>,
): string {
  const text = normalizeWhitespace(summary);
  if (!text) return text;
  if (!CANONICAL_PUNCTUATION_TYPES.has(memoryType)) return text;
  if (!detailsJson || detailsJson.source !== 'heuristic_fallback') return text;
  if (text.length > 120) return text;
  if (/[?;:]$/.test(text)) return text;
  return normalizeWhitespace(text.replace(/[.!]+$/g, ''));
}

function normalizeSummary(
  summary: string,
  memoryType: string,
  detailsJson: Record<string, unknown>,
): string {
  const original = normalizeWhitespace(summary);
  if (!original) return '';
  let cleaned = stripWrapperPhrases(original, memoryType);
  cleaned = collapseDuplicateClauses(cleaned, memoryType);
  cleaned = stripWrapperPhrases(cleaned, memoryType);
  cleaned = canonicalizeShortFallbackSummary(cleaned, memoryType, detailsJson);
  cleaned = normalizeWhitespace(cleaned);
  if (!cleaned) return original;
  if (cleaned.length < 12 && original.length >= 12) return original;
  return cleaned;
}

function deriveTopicKey(summary: string, memoryType: string): string {
  const normalized = normalizeTopicText(summary);
  if (!normalized || !CONSERVATIVE_TYPES.has(memoryType)) return '';
  if (memoryType === 'environment_fact') {
    const subjectMatch = normalized.match(
      /^(?:the\s+)?(.+?)\s+(uses|is|runs|has|requires|needs|supports|remains|stays)\b/,
    );
    if (subjectMatch?.[1]) return `environment_fact:${subjectMatch[1].trim().slice(0, 64)}`;
  }
  if (memoryType === 'operational_note') {
    const opMatch = normalized.match(
      /^(restart|reload|publish|deploy|run|use)\s+(.+?)(?:\s+(after|before|when|for)\b|$)/,
    );
    if (opMatch?.[1] && opMatch?.[2])
      return `operational_note:${opMatch[1]}:${opMatch[2].trim().slice(0, 64)}`;
  }
  return `exact:${memoryType}:${normalized.slice(0, 120)}`;
}

function decorateDetailsJson(
  entry: MemoryCandidate,
  normalizedSummary: string,
): Record<string, unknown> {
  const details: Record<string, unknown> =
    entry.details_json &&
    typeof entry.details_json === 'object' &&
    !Array.isArray(entry.details_json)
      ? { ...entry.details_json }
      : {};
  const topicKey = deriveTopicKey(normalizedSummary, entry.memory_type);
  if (topicKey) details.topic_key = topicKey;
  if (
    entry.memory_type === 'decision' &&
    ['explicit_preference', 'preference_sentence'].includes(String(details.trigger ?? ''))
  ) {
    details.memory_origin = 'durable_user_preference';
  }
  return details;
}

function normalizeKey(
  entry: Pick<MemoryCandidate, 'scope' | 'memory_type' | 'details_json'> & { summary: string },
): string {
  const details =
    entry.details_json &&
    typeof entry.details_json === 'object' &&
    !Array.isArray(entry.details_json)
      ? entry.details_json
      : {};
  const topicKey = normalizeWhitespace(String(details.topic_key ?? ''));
  return `${entry.scope}|${entry.memory_type}|${topicKey || entry.summary.toLowerCase()}`;
}

// ─── shouldExtractMemory (supporting export) ──────────────────────────────────

export function shouldExtractMemory(ctx: MemoryContext): ShouldExtractResult {
  const taskClass = ctx.task_class ?? 'chat';
  const assistantReply = (ctx.assistant_reply ?? '').trim();
  const latestUserMessage = (ctx.latest_user_message ?? '').trim();
  const responseMode = ctx.response_mode ?? 'direct_owner_reply';

  const meaningfulTechnicalWork =
    taskClass === 'technical_work' &&
    ctx.command_success === true &&
    /(implement|implemented|fix|fixed|update|updated|patch|patched|migrate|migration|refactor|created|added|write|wrote|build|built)/i.test(
      `${latestUserMessage} ${assistantReply}`,
    ) &&
    assistantReply.length >= 24;

  const explicitMemoryCue =
    /(decision|architectural decision|architecture decision|environment fact|runtime fact|operational note|runtime note|user preference|durable preference|remember this|preference|for future responses|always|never)/i.test(
      latestUserMessage,
    );

  const delegatedResponse = responseMode.startsWith('delegated_');

  const shouldExtract =
    Boolean(ctx.source_message_id && assistantReply) &&
    !delegatedResponse &&
    !ctx.approval_required &&
    ctx.error_type !== 'approval_required' &&
    (taskClass !== 'technical_work' || ctx.command_success !== false) &&
    (explicitMemoryCue || meaningfulTechnicalWork || assistantReply.length >= 40);

  return {
    should_extract: shouldExtract,
    meaningful_technical_work: meaningfulTechnicalWork,
    explicit_memory_cue: explicitMemoryCue,
  };
}

// ─── buildExtractionPrompt (supporting export) ────────────────────────────────

export function buildExtractionPrompt(ctx: MemoryContext): string {
  const taskClass = ctx.task_class ?? 'chat';
  const assistantReply = (ctx.assistant_reply ?? '').trim();
  const latestUserMessage = (ctx.latest_user_message ?? '').trim();
  const responseMode = ctx.response_mode ?? 'direct_owner_reply';
  const meaningfulTechnicalWork =
    taskClass === 'technical_work' &&
    ctx.command_success === true &&
    /(implement|implemented|fix|fixed|update|updated|patch|patched|migrate|migration|refactor|created|added|write|wrote|build|built)/i.test(
      `${latestUserMessage} ${assistantReply}`,
    ) &&
    assistantReply.length >= 24;

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

  return [
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
      provider_used: ctx.provider_used ?? '',
      model_used: ctx.model_used ?? '',
      command_success: ctx.command_success,
      risk_level: ctx.risk_level ?? 'safe',
      meaningful_technical_work: meaningfulTechnicalWork,
      response_mode: responseMode,
      latest_user_message: latestUserMessage,
      assistant_reply: assistantReply,
    }),
  ].join('\n');
}

// ─── extractMemories (primary public export) ──────────────────────────────────
//
// Parses raw LLM output into validated MemoryCandidate[].
// Activates heuristic fallback when the LLM returns empty or unparseable output.

function buildFallbackItems(ctx: MemoryContext): MemoryCandidate[] {
  if (ctx.memory_test_mode === 'invalid_json') return [];
  const userText = normalizeWhitespace(ctx.latest_user_message);
  const fallbackItems: MemoryCandidate[] = [];

  const preferenceMatch = userText.match(
    /(?:user preference(?: for this conversation)?|durable preference|preference|instruction|remember this|for future responses)\s*:\s*(.+)$/i,
  );
  if (
    preferenceMatch?.[1] &&
    /(always|never|prefer|prefers|avoid|use|do not|don't|keep|concise|verbose|full config files|snippets)/i.test(
      preferenceMatch[1],
    )
  ) {
    fallbackItems.push({
      scope: 'conversation',
      memory_type: 'decision',
      title: 'Durable preference',
      summary: preferenceMatch[1],
      details_json: { source: 'heuristic_fallback', trigger: 'explicit_preference' },
      importance: 4,
    });
  }

  const prefersSentence = userText.match(
    /(the user prefers .+?)(?:\.\s*(remember this preference|remember this|save this preference))?$/i,
  );
  if (prefersSentence?.[1] && /(prefers|avoid|use|do not|don't)/i.test(prefersSentence[1])) {
    fallbackItems.push({
      scope: 'conversation',
      memory_type: 'decision',
      title: 'Durable preference',
      summary: prefersSentence[1],
      details_json: { source: 'heuristic_fallback', trigger: 'preference_sentence' },
      importance: 4,
    });
  }

  const architectureMatch = userText.match(
    /(?:architectural decision|architecture decision|decision(?: for this conversation)?)\s*:\s*(.+)$/i,
  );
  if (
    architectureMatch?.[1] &&
    /(use|prefer|keep|avoid|do not|don't)/i.test(architectureMatch[1])
  ) {
    fallbackItems.push({
      scope: 'conversation',
      memory_type: 'decision',
      title: 'Architectural decision',
      summary: architectureMatch[1],
      details_json: { source: 'heuristic_fallback', trigger: 'explicit_decision' },
      importance: 5,
    });
  }

  const envFactMatch = userText.match(/(?:environment fact|runtime fact)\s*:\s*(.+)$/i);
  if (envFactMatch?.[1] && envFactMatch[1].length >= 16) {
    fallbackItems.push({
      scope: 'conversation',
      memory_type: 'environment_fact',
      title: 'Environment fact',
      summary: envFactMatch[1],
      details_json: { source: 'heuristic_fallback', trigger: 'explicit_fact' },
      importance: 4,
    });
  }

  const operationalNoteMatch = userText.match(/(?:operational note|runtime note)\s*:\s*(.+)$/i);
  if (operationalNoteMatch?.[1] && operationalNoteMatch[1].length >= 16) {
    fallbackItems.push({
      scope: 'conversation',
      memory_type: 'operational_note',
      title: 'Operational note',
      summary: operationalNoteMatch[1],
      details_json: { source: 'heuristic_fallback', trigger: 'explicit_operational_note' },
      importance: 4,
    });
  }

  const seen = new Set<string>();
  return fallbackItems.filter((entry) => {
    const sanitized = sanitizeRawItem(entry as unknown as Record<string, unknown>);
    const key = `${sanitized.scope}|${sanitized.memory_type}|${sanitized.summary.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractMemories(
  rawOutput: unknown,
  ctx: MemoryContext,
): ExtractMemoriesResult {
  let rawText = '';
  const response = rawOutput as Record<string, unknown>;
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    rawText = response.output_text.trim();
  } else if (Array.isArray(response?.output)) {
    rawText = (
      response.output as Array<{ content?: Array<{ text?: string; value?: string }> }>
    )
      .flatMap((e) => (Array.isArray(e.content) ? e.content : []))
      .map((e) => e.text ?? e.value ?? '')
      .join('')
      .trim();
  } else if (typeof response?.response === 'string' && response.response.trim()) {
    rawText = response.response.trim();
  }

  let parseStatus = ctx.source_message_id ? 'attempted' : 'skipped';
  let parseError = '';
  let parsedItems: Array<Record<string, unknown>> = [];
  const trimmedJsonText = extractJsonText(rawText);

  if (response?.error) {
    parseStatus = 'extractor_error';
    const err = response.error;
    parseError =
      typeof err === 'string'
        ? err
        : ((err as { message?: string }).message ?? 'memory extractor request failed');
  } else if (trimmedJsonText) {
    try {
      const parsed = JSON.parse(trimmedJsonText) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Array.isArray((parsed as Record<string, unknown>).items)
      ) {
        parsedItems = (parsed as { items: Array<Record<string, unknown>> }).items;
        parseStatus = 'parsed';
      } else {
        parseStatus = 'invalid_shape';
        parseError = 'Extractor response did not match {items:[...]}';
      }
    } catch (e) {
      parseStatus = 'invalid_json';
      parseError = (e as Error).message;
    }
  }

  let candidates: MemoryCandidate[] = parsedItems
    .filter((entry) => entry && typeof entry === 'object')
    .map(sanitizeRawItem)
    .filter(
      (entry) =>
        ALLOWED_SCOPES.has(entry.scope) &&
        ALLOWED_CATEGORIES.has(entry.memory_type) &&
        entry.summary,
    )
    .filter((entry) => JSON.stringify(entry.details_json).length <= 800)
    .filter((entry) => !NOISY_SUMMARY_RE.test(entry.summary))
    .map((entry) => ({
      ...entry,
      conversation_id:
        entry.scope === 'conversation' ? (ctx.conversation_id ?? null) : null,
      task_run_id: null,
      source_message_id: ctx.source_message_id ?? null,
      status: 'active' as MemoryStatus,
    }));

  let fallbackUsed = false;
  if (!candidates.length) {
    const fallbackItems = buildFallbackItems(ctx).map((entry) => ({
      ...sanitizeRawItem(entry as unknown as Record<string, unknown>),
      conversation_id: ctx.conversation_id ?? null,
      task_run_id: null,
      source_message_id: ctx.source_message_id ?? null,
      status: 'active' as MemoryStatus,
    }));
    if (fallbackItems.length) {
      candidates = fallbackItems;
      fallbackUsed = true;
      parseStatus =
        parseStatus === 'parsed' ? 'parsed_with_fallback' : 'heuristic_fallback';
    }
  }

  return {
    candidates,
    parse_status: parseStatus,
    parse_error: parseError,
    fallback_used: fallbackUsed,
    raw_text: trimmedJsonText.slice(0, 2000),
  };
}

// ─── consolidateMemories (primary public export) ──────────────────────────────
//
// Normalizes summaries, derives topic keys, deduplicates, filters noise,
// sorts by priority, and caps at 3 items.

export function consolidateMemories(
  candidates: MemoryCandidate[],
  ctx: MemoryContext,
): ConsolidationResult {
  const lowerUser = String(ctx.latest_user_message ?? '').toLowerCase();
  const meaningfulTaskSummary =
    ctx.task_class === 'technical_work' &&
    ctx.meaningful_technical_work === true &&
    /(implement|implemented|fix|fixed|update|updated|patch|patched|migrate|migration|refactor|created|added|write|wrote|build|built)/i.test(
      `${ctx.latest_user_message} ${ctx.assistant_reply}`,
    );

  const filteredOut: Array<{ reason: string; key: string }> = [];
  const normalizationChanges: Array<{
    memory_type: string;
    before: string;
    after: string;
  }> = [];
  const seen = new Set<string>();

  const memories = candidates
    .map((entry) => {
      const originalSummary = normalizeWhitespace(entry.summary);
      const normalizedSummary = normalizeSummary(
        originalSummary,
        entry.memory_type,
        entry.details_json ?? {},
      );
      const nextSummary = normalizedSummary || originalSummary;
      const nextDetailsJson = decorateDetailsJson(entry, nextSummary);
      if (originalSummary && nextSummary && originalSummary !== nextSummary) {
        normalizationChanges.push({
          memory_type: entry.memory_type,
          before: originalSummary,
          after: nextSummary,
        });
      }
      return { ...entry, summary: nextSummary, details_json: nextDetailsJson };
    })
    .filter((entry) => {
      const summary = normalizeWhitespace(entry.summary);
      const key = normalizeKey({ ...entry, summary });
      if (!summary) {
        filteredOut.push({ reason: 'empty_summary', key });
        return false;
      }
      if (summary.length < 16) {
        filteredOut.push({ reason: 'too_short', key });
        return false;
      }
      if (
        SKIP_PATTERNS.some((p) => p.test(summary)) ||
        SKIP_PATTERNS.some((p) => p.test(lowerUser))
      ) {
        filteredOut.push({ reason: 'trivial_chitchat', key });
        return false;
      }
      if (NOISE_PATTERNS.some((p) => p.test(summary))) {
        filteredOut.push({ reason: 'runtime_noise', key });
        return false;
      }
      if (entry.memory_type === 'task_summary' && !meaningfulTaskSummary) {
        filteredOut.push({ reason: 'weak_task_summary', key });
        return false;
      }
      if (seen.has(key)) {
        filteredOut.push({ reason: 'duplicate_in_pass', key });
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        (MEMORY_TYPE_PRIORITY[b.memory_type] ?? 0) -
        (MEMORY_TYPE_PRIORITY[a.memory_type] ?? 0),
    )
    .slice(0, 3);

  return {
    memories,
    filtered_out_count: filteredOut.length,
    filtered_out_reasons: filteredOut.slice(0, 10),
    normalization_changes: normalizationChanges.slice(0, 10),
  };
}

// ─── storeMemories (primary public export) ────────────────────────────────────
//
// Maps consolidated MemoryCandidate[] to MemoryWriteRow[] aligned with the
// approved memories table schema (memory_id, user_id, conversation_id,
// memory_tier, content, category, confidence, status, superseded_by,
// supersedes, source_type, source_message, created_at, updated_at, last_accessed).

export function storeMemories(
  memories: MemoryCandidate[],
  ctx: MemoryContext,
): MemoryWriteRow[] {
  return memories.map((entry) => {
    const details = entry.details_json ?? {};
    const sourceType: MemorySourceType =
      details.source === 'heuristic_fallback' ? 'heuristic_fallback' : 'llm_extraction';
    const tier: MemoryTier = SCOPE_TO_TIER[entry.scope] ?? 'working';
    // confidence: map importance 1–5 to 0.20–1.00
    const confidence = Math.round((Math.max(1, Math.min(5, entry.importance ?? 3)) / 5) * 100) / 100;
    const sourceMessage = ctx.latest_user_message
      ? normalizeWhitespace(ctx.latest_user_message).slice(0, 500) || null
      : null;

    return {
      user_id: ctx.user_id ?? null,
      conversation_id:
        entry.scope === 'conversation'
          ? (entry.conversation_id ?? ctx.conversation_id ?? null)
          : null,
      memory_tier: tier,
      content: normalizeWhitespace(entry.summary),
      category: entry.memory_type,
      confidence,
      status: 'active' as MemoryStatus,
      superseded_by: null,
      supersedes: null,
      source_type: sourceType,
      source_message: sourceMessage,
    };
  });
}
