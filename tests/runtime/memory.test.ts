import { describe, it, expect } from 'vitest';
import {
  shouldExtractMemory,
  buildExtractionPrompt,
  extractMemories,
  consolidateMemories,
  storeMemories,
} from '../../src/runtime/memory.js';
import type { MemoryContext, MemoryCandidate } from '../../src/runtime/memory.js';

// ─── shouldExtractMemory ──────────────────────────────────────────────────────

describe('shouldExtractMemory — basic extraction gate', () => {
  const base: MemoryContext = {
    source_message_id: 'msg-1',
    assistant_reply: 'This is a long enough assistant reply to pass the length gate.',
    task_class: 'chat',
    response_mode: 'direct_owner_reply',
  };

  it('returns should_extract=true for a substantive chat reply', () => {
    const result = shouldExtractMemory(base);
    expect(result.should_extract).toBe(true);
  });

  it('returns should_extract=false when source_message_id is missing', () => {
    const result = shouldExtractMemory({ ...base, source_message_id: null });
    expect(result.should_extract).toBe(false);
  });

  it('returns should_extract=false when assistant_reply is empty', () => {
    const result = shouldExtractMemory({ ...base, assistant_reply: '' });
    expect(result.should_extract).toBe(false);
  });

  it('returns should_extract=false for delegated responses', () => {
    const result = shouldExtractMemory({ ...base, response_mode: 'delegated_worker_reply' });
    expect(result.should_extract).toBe(false);
  });

  it('returns should_extract=false when approval_required is true', () => {
    const result = shouldExtractMemory({ ...base, approval_required: true });
    expect(result.should_extract).toBe(false);
  });

  it('returns should_extract=false when error_type is approval_required', () => {
    const result = shouldExtractMemory({ ...base, error_type: 'approval_required' });
    expect(result.should_extract).toBe(false);
  });

  it('returns should_extract=false for short reply without explicit cue', () => {
    const result = shouldExtractMemory({ ...base, assistant_reply: 'Short.' });
    expect(result.should_extract).toBe(false);
  });

  it('returns should_extract=false for technical_work with command_success=false', () => {
    const result = shouldExtractMemory({
      ...base,
      task_class: 'technical_work',
      command_success: false,
      assistant_reply: 'Some long output that failed but is over 40 characters long.',
    });
    expect(result.should_extract).toBe(false);
  });
});

describe('shouldExtractMemory — explicit memory cues', () => {
  const base: MemoryContext = {
    source_message_id: 'msg-1',
    assistant_reply: 'Understood.',
    task_class: 'chat',
    response_mode: 'direct_owner_reply',
  };

  it('detects "durable preference" cue', () => {
    const result = shouldExtractMemory({
      ...base,
      latest_user_message: 'Durable preference: always use concise replies',
    });
    expect(result.should_extract).toBe(true);
    expect(result.explicit_memory_cue).toBe(true);
  });

  it('detects "architectural decision" cue', () => {
    const result = shouldExtractMemory({
      ...base,
      latest_user_message: 'Architectural decision: use Postgres for all persistence',
    });
    expect(result.should_extract).toBe(true);
    expect(result.explicit_memory_cue).toBe(true);
  });

  it('detects "remember this" cue', () => {
    const result = shouldExtractMemory({
      ...base,
      latest_user_message: 'Remember this: always keep the docker-compose files intact',
    });
    expect(result.should_extract).toBe(true);
    expect(result.explicit_memory_cue).toBe(true);
  });

  it('detects "always" keyword', () => {
    const result = shouldExtractMemory({
      ...base,
      latest_user_message: 'Always prefer full config files over snippets',
    });
    expect(result.should_extract).toBe(true);
    expect(result.explicit_memory_cue).toBe(true);
  });
});

describe('shouldExtractMemory — meaningful technical work', () => {
  const base: MemoryContext = {
    source_message_id: 'msg-1',
    task_class: 'technical_work',
    command_success: true,
    response_mode: 'direct_owner_reply',
  };

  it('detects meaningful technical work for "implemented"', () => {
    const result = shouldExtractMemory({
      ...base,
      latest_user_message: 'Add the login endpoint',
      assistant_reply: 'I have implemented the login endpoint successfully with JWT tokens.',
    });
    expect(result.meaningful_technical_work).toBe(true);
    expect(result.should_extract).toBe(true);
  });

  it('does not flag meaningful technical work when command_success=false', () => {
    const result = shouldExtractMemory({
      ...base,
      command_success: false,
      latest_user_message: 'fix the bug',
      assistant_reply: 'I fixed the authentication bug in the login flow.',
    });
    expect(result.meaningful_technical_work).toBe(false);
  });

  it('does not flag meaningful technical work for short reply', () => {
    const result = shouldExtractMemory({
      ...base,
      latest_user_message: 'implement login',
      assistant_reply: 'Done.',
    });
    expect(result.meaningful_technical_work).toBe(false);
  });
});

// ─── buildExtractionPrompt ────────────────────────────────────────────────────

describe('buildExtractionPrompt', () => {
  const ctx: MemoryContext = {
    task_class: 'chat',
    assistant_reply: 'The answer to your question is 42.',
    latest_user_message: 'What is the answer?',
    response_mode: 'direct_owner_reply',
  };

  it('returns a non-empty string', () => {
    const prompt = buildExtractionPrompt(ctx);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('contains required instructions', () => {
    const prompt = buildExtractionPrompt(ctx);
    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('"items"');
    expect(prompt).toContain('importance must be an integer 1..5');
  });

  it('embeds turn context JSON', () => {
    const prompt = buildExtractionPrompt(ctx);
    expect(prompt).toContain('latest_user_message');
    expect(prompt).toContain('assistant_reply');
  });

  it('uses gpt-5.4 style context passthrough', () => {
    const prompt = buildExtractionPrompt({ ...ctx, model_used: 'gpt-5.4' });
    expect(prompt).toContain('gpt-5.4');
  });
});

// ─── extractMemories ────────────────────────────────────────────────────

describe('extractMemories — valid JSON output', () => {
  const ctx: MemoryContext = {
    source_message_id: 'msg-abc',
    conversation_id: 'conv-xyz',
    task_class: 'chat',
  };

  it('parses a valid items array', () => {
    const output = {
      output_text: JSON.stringify({
        items: [
          {
            scope: 'global',
            memory_type: 'environment_fact',
            title: 'Node version',
            summary: 'The project uses Node.js 24.13.1 with native TypeScript stripping.',
            details_json: {},
            importance: 4,
          },
        ],
      }),
    };
    const result = extractMemories(output, ctx);
    expect(result.parse_status).toBe('parsed');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].scope).toBe('global');
    expect(result.candidates[0].memory_type).toBe('environment_fact');
  });

  it('sets source_message_id from context on each candidate', () => {
    const output = {
      output_text: JSON.stringify({
        items: [
          {
            scope: 'conversation',
            memory_type: 'decision',
            title: 'Pref',
            summary: 'Always use full config files instead of snippets.',
            details_json: {},
            importance: 4,
          },
        ],
      }),
    };
    const result = extractMemories(output, ctx);
    expect(result.candidates[0].source_message_id).toBe('msg-abc');
  });

  it('sets conversation_id only for conversation-scoped items', () => {
    const output = {
      output_text: JSON.stringify({
        items: [
          {
            scope: 'global',
            memory_type: 'environment_fact',
            title: 'Env',
            summary: 'Production runs on Ubuntu 24.04 with Docker Compose.',
            details_json: {},
            importance: 3,
          },
          {
            scope: 'conversation',
            memory_type: 'decision',
            title: 'Dec',
            summary: 'Use verbose output for all future responses in this conversation.',
            details_json: {},
            importance: 4,
          },
        ],
      }),
    };
    const result = extractMemories(output, ctx);
    const global = result.candidates.find((c) => c.scope === 'global');
    const convo = result.candidates.find((c) => c.scope === 'conversation');
    expect(global?.conversation_id).toBeNull();
    expect(convo?.conversation_id).toBe('conv-xyz');
  });

  it('strips noisy summaries containing code fences', () => {
    const output = {
      output_text: JSON.stringify({
        items: [
          {
            scope: 'global',
            memory_type: 'task_summary',
            title: 'Code',
            summary: '```javascript\nconsole.log("hello");\n```',
            details_json: {},
            importance: 2,
          },
        ],
      }),
    };
    const result = extractMemories(output, ctx);
    expect(result.candidates).toHaveLength(0);
  });

  it('strips items with invalid scope', () => {
    const output = {
      output_text: JSON.stringify({
        items: [
          {
            scope: 'invalid_scope',
            memory_type: 'decision',
            title: 'T',
            summary: 'Some decision with an invalid scope value.',
            details_json: {},
            importance: 3,
          },
        ],
      }),
    };
    const result = extractMemories(output, ctx);
    expect(result.candidates).toHaveLength(0);
  });

  it('returns empty candidates for empty items array', () => {
    const output = { output_text: '{"items":[]}' };
    const result = extractMemories(output, ctx);
    expect(result.candidates).toHaveLength(0);
    expect(result.parse_status).toBe('parsed');
  });
});

describe('extractMemories — malformed output', () => {
  const ctx: MemoryContext = { source_message_id: 'msg-1', task_class: 'chat' };

  it('sets parse_status=invalid_json for non-JSON output', () => {
    const output = { output_text: 'not valid json' };
    const result = extractMemories(output, ctx);
    expect(result.parse_status).toBe('invalid_json');
    expect(result.candidates).toHaveLength(0);
  });

  it('sets parse_status=invalid_shape when items key missing', () => {
    const output = { output_text: '{"something_else": []}' };
    const result = extractMemories(output, ctx);
    expect(result.parse_status).toBe('invalid_shape');
  });

  it('sets parse_status=extractor_error when response contains error', () => {
    const output = { error: 'API call failed with 503' };
    const result = extractMemories(output, ctx);
    expect(result.parse_status).toBe('extractor_error');
    expect(result.parse_error).toBe('API call failed with 503');
  });

  it('extracts JSON from prose-wrapped response', () => {
    const output = {
      output_text:
        'Here is the memory: {"items":[{"scope":"global","memory_type":"decision","title":"T","summary":"Always use explicit types in TypeScript interfaces.","details_json":{},"importance":4}]}',
    };
    const result = extractMemories(output, ctx);
    expect(result.parse_status).toBe('parsed');
    expect(result.candidates).toHaveLength(1);
  });
});

describe('extractMemories — heuristic fallback', () => {
  it('falls back for explicit durable preference pattern', () => {
    const ctx: MemoryContext = {
      source_message_id: 'msg-1',
      latest_user_message: 'durable preference: always use full config files not snippets',
      task_class: 'chat',
    };
    const result = extractMemories({ output_text: 'not valid json' }, ctx);
    expect(result.fallback_used).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].memory_type).toBe('decision');
  });

  it('falls back for "the user prefers" pattern', () => {
    const ctx: MemoryContext = {
      source_message_id: 'msg-2',
      latest_user_message: 'the user prefers concise replies without preamble',
      task_class: 'chat',
    };
    const result = extractMemories({ output_text: '{"items":[]}' }, ctx);
    expect(result.fallback_used).toBe(true);
    expect(result.candidates[0].details_json).toMatchObject({ trigger: 'preference_sentence' });
  });

  it('falls back for environment fact pattern', () => {
    const ctx: MemoryContext = {
      source_message_id: 'msg-3',
      latest_user_message: 'environment fact: n8n version is 2.11.3 running on Docker',
      task_class: 'chat',
    };
    const result = extractMemories({ output_text: '{"items":[]}' }, ctx);
    expect(result.fallback_used).toBe(true);
    expect(result.candidates[0].memory_type).toBe('environment_fact');
  });

  it('does not fall back for invalid_json memory_test_mode', () => {
    const ctx: MemoryContext = {
      source_message_id: 'msg-4',
      latest_user_message: 'durable preference: always use full config files not snippets',
      memory_test_mode: 'invalid_json',
      task_class: 'chat',
    };
    const result = extractMemories({ output_text: 'not valid json' }, ctx);
    expect(result.fallback_used).toBe(false);
    expect(result.candidates).toHaveLength(0);
  });
});

// ─── consolidateMemories ──────────────────────────────────────────────────────

const makeCandidate = (overrides: Partial<MemoryCandidate>): MemoryCandidate => ({
  scope: 'global',
  memory_type: 'decision',
  title: 'Test memory',
  summary: 'Use Postgres as the primary persistence layer for all structured data.',
  details_json: {},
  importance: 4,
  status: 'active',
  ...overrides,
});

describe('consolidateMemories — filtering', () => {
  const ctx: MemoryContext = { task_class: 'chat' };

  it('passes valid candidates through', () => {
    const result = consolidateMemories([makeCandidate({})], ctx);
    expect(result.memories).toHaveLength(1);
  });

  it('filters out empty summaries', () => {
    const result = consolidateMemories([makeCandidate({ summary: '' })], ctx);
    expect(result.memories).toHaveLength(0);
    expect(result.filtered_out_reasons[0]?.reason).toBe('empty_summary');
  });

  it('filters out too-short summaries (<16 chars)', () => {
    const result = consolidateMemories([makeCandidate({ summary: 'short' })], ctx);
    expect(result.memories).toHaveLength(0);
    expect(result.filtered_out_reasons[0]?.reason).toBe('too_short');
  });

  it('filters out runtime noise with code fences', () => {
    const result = consolidateMemories(
      [makeCandidate({ summary: '```bash\nrm -rf /tmp\n```' })],
      ctx,
    );
    expect(result.memories).toHaveLength(0);
    expect(result.filtered_out_reasons[0]?.reason).toBe('runtime_noise');
  });

  it('filters out trivial chitchat when user message matches skip pattern', () => {
    const result = consolidateMemories(
      [makeCandidate({ summary: 'Hello, how can I help you today?' })],
      { ...ctx, latest_user_message: 'hi' },
    );
    expect(result.memories).toHaveLength(0);
    expect(result.filtered_out_reasons[0]?.reason).toBe('trivial_chitchat');
  });

  it('filters out duplicate candidates (same normalizeKey)', () => {
    const c = makeCandidate({});
    const result = consolidateMemories([c, c], ctx);
    expect(result.memories).toHaveLength(1);
    expect(result.filtered_out_count).toBe(1);
    expect(result.filtered_out_reasons[0]?.reason).toBe('duplicate_in_pass');
  });

  it('caps output at 3 items', () => {
    const candidates = [
      makeCandidate({ summary: 'First distinct memory item that is long enough to pass.' }),
      makeCandidate({ summary: 'Second distinct memory item that is long enough to pass.' }),
      makeCandidate({ summary: 'Third distinct memory item that is long enough to pass.' }),
      makeCandidate({ summary: 'Fourth distinct memory item that is long enough to pass.' }),
    ];
    const result = consolidateMemories(candidates, ctx);
    expect(result.memories).toHaveLength(3);
  });

  it('filters out weak task_summary when not meaningful technical work', () => {
    const result = consolidateMemories(
      [makeCandidate({ memory_type: 'task_summary' })],
      { ...ctx, task_class: 'chat' },
    );
    expect(result.memories).toHaveLength(0);
    expect(result.filtered_out_reasons[0]?.reason).toBe('weak_task_summary');
  });

  it('allows task_summary when meaningful_technical_work=true and task_class=technical_work', () => {
    const result = consolidateMemories(
      [
        makeCandidate({
          memory_type: 'task_summary',
          summary: 'Implemented the login endpoint with JWT authentication and refresh token support.',
        }),
      ],
      {
        task_class: 'technical_work',
        meaningful_technical_work: true,
        latest_user_message: 'implement the login endpoint',
        assistant_reply: 'I have implemented the login endpoint successfully.',
      },
    );
    expect(result.memories).toHaveLength(1);
  });
});

describe('consolidateMemories — normalization', () => {
  const ctx: MemoryContext = { task_class: 'chat' };

  it('strips wrapper phrases from decision summaries', () => {
    const result = consolidateMemories(
      [
        makeCandidate({
          memory_type: 'decision',
          summary: 'Durable preference: always use full config files instead of snippets.',
        }),
      ],
      ctx,
    );
    expect(result.memories[0].summary).not.toMatch(/^Durable preference:/i);
    // trailing period is preserved — canonicalizeShortFallbackSummary only strips punctuation
    // for heuristic_fallback items; this candidate has an empty details_json
    expect(result.memories[0].summary).toBe(
      'always use full config files instead of snippets.',
    );
  });

  it('strips "remember that" prefix', () => {
    const result = consolidateMemories(
      [
        makeCandidate({
          memory_type: 'operational_note',
          summary: 'Remember that n8n must be restarted after updating environment variables.',
        }),
      ],
      ctx,
    );
    expect(result.memories[0].summary).not.toMatch(/^Remember that/i);
  });

  it('derives topic_key for environment_fact', () => {
    const result = consolidateMemories(
      [
        makeCandidate({
          memory_type: 'environment_fact',
          summary: 'n8n is running on port 5678 with Docker Compose.',
        }),
      ],
      ctx,
    );
    const details = result.memories[0].details_json as Record<string, unknown>;
    expect(details.topic_key).toMatch(/^environment_fact:n8n/);
  });

  it('records normalization changes when summary changes', () => {
    const result = consolidateMemories(
      [
        makeCandidate({
          memory_type: 'decision',
          summary: 'Architectural decision: use Postgres for all structured data storage.',
        }),
      ],
      ctx,
    );
    expect(result.normalization_changes.length).toBeGreaterThan(0);
    expect(result.normalization_changes[0].before).toMatch(/Architectural decision:/);
  });
});

describe('consolidateMemories — priority ordering', () => {
  const ctx: MemoryContext = { task_class: 'chat' };

  it('sorts decision before environment_fact before operational_note', () => {
    const result = consolidateMemories(
      [
        makeCandidate({
          memory_type: 'operational_note',
          summary: 'Restart n8n after editing the docker-compose environment variables.',
        }),
        makeCandidate({
          memory_type: 'environment_fact',
          summary: 'Docker Compose version 2.36 is used on the host system.',
        }),
        makeCandidate({
          memory_type: 'decision',
          summary: 'Use Postgres 16 as the only persistence layer for all structured state.',
        }),
      ],
      ctx,
    );
    expect(result.memories[0].memory_type).toBe('decision');
    expect(result.memories[1].memory_type).toBe('environment_fact');
    expect(result.memories[2].memory_type).toBe('operational_note');
  });
});

// ─── storeMemories ────────────────────────────────────────────────────────────

describe('storeMemories — approved schema mapping', () => {
  const ctx: MemoryContext = {
    conversation_id: 'conv-123',
    user_id: 'user-abc',
    source_message_id: 'msg-456',
    task_run_id: 'run-789',
    latest_user_message: 'durable preference: always use full config files not snippets',
  };

  it('produces one MemoryWriteRow per input candidate', () => {
    const candidates: MemoryCandidate[] = [
      {
        scope: 'global',
        memory_type: 'environment_fact',
        title: 'Postgres version',
        summary: 'Postgres 16 is used as the primary database.',
        details_json: {},
        importance: 4,
        status: 'active',
      },
    ];
    const rows = storeMemories(candidates, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('environment_fact');
    expect(rows[0].status).toBe('active');
  });

  it('maps scope→memory_tier: global→long_term', () => {
    const candidates: MemoryCandidate[] = [
      {
        scope: 'global',
        memory_type: 'environment_fact',
        title: 'Fact',
        summary: 'The system runs on Ubuntu 24.04 LTS with Docker Compose.',
        details_json: {},
        importance: 3,
      },
    ];
    const rows = storeMemories(candidates, ctx);
    expect(rows[0].memory_tier).toBe('long_term');
  });

  it('maps scope→memory_tier: conversation→working', () => {
    const candidates: MemoryCandidate[] = [
      {
        scope: 'conversation',
        memory_type: 'decision',
        title: 'Pref',
        summary: 'Always prefer verbose output in all assistant responses.',
        details_json: {},
        importance: 4,
        conversation_id: 'conv-123',
      },
    ];
    const rows = storeMemories(candidates, ctx);
    expect(rows[0].memory_tier).toBe('working');
  });

  it('maps summary→content', () => {
    const candidates: MemoryCandidate[] = [
      {
        scope: 'global',
        memory_type: 'decision',
        title: 'T',
        summary: 'Use TypeScript strict mode in all source files.',
        details_json: {},
        importance: 4,
      },
    ];
    const rows = storeMemories(candidates, ctx);
    expect(rows[0].content).toBe('Use TypeScript strict mode in all source files.');
  });

  it('maps importance to confidence on 0–1 scale', () => {
    const cases: Array<[number, number]> = [
      [1, 0.20],
      [2, 0.40],
      [3, 0.60],
      [4, 0.80],
      [5, 1.00],
    ];
    for (const [importance, expected] of cases) {
      const rows = storeMemories(
        [{ scope: 'global', memory_type: 'decision', title: '', summary: 'A long enough summary text here.', details_json: {}, importance }],
        ctx,
      );
      expect(rows[0].confidence).toBe(expected);
    }
  });

  it('clamps out-of-range importance before confidence mapping', () => {
    const rows = storeMemories(
      [{ scope: 'global', memory_type: 'decision', title: '', summary: 'Strict type checking in all files.', details_json: {}, importance: 99 }],
      ctx,
    );
    expect(rows[0].confidence).toBe(1.00);
  });

  it('sets conversation_id only for conversation-scoped rows', () => {
    const candidates: MemoryCandidate[] = [
      {
        scope: 'global',
        memory_type: 'environment_fact',
        title: 'Fact',
        summary: 'The system runs on Ubuntu 24.04 LTS with kernel 6.17.',
        details_json: {},
        importance: 3,
      },
      {
        scope: 'conversation',
        memory_type: 'decision',
        title: 'Pref',
        summary: 'Always prefer verbose output in all assistant responses.',
        details_json: {},
        importance: 4,
        conversation_id: 'conv-123',
      },
    ];
    const rows = storeMemories(candidates, ctx);
    const global = rows.find((r) => r.memory_tier === 'long_term');
    const convo = rows.find((r) => r.memory_tier === 'working');
    expect(global?.conversation_id).toBeNull();
    expect(convo?.conversation_id).toBe('conv-123');
  });

  it('sets user_id from ctx', () => {
    const rows = storeMemories(
      [{ scope: 'global', memory_type: 'decision', title: '', summary: 'Use strict types in all modules.', details_json: {}, importance: 4 }],
      ctx,
    );
    expect(rows[0].user_id).toBe('user-abc');
  });

  it('sets user_id to null when ctx has no user_id', () => {
    const rows = storeMemories(
      [{ scope: 'global', memory_type: 'decision', title: '', summary: 'Use strict types in all modules.', details_json: {}, importance: 4 }],
      { ...ctx, user_id: undefined },
    );
    expect(rows[0].user_id).toBeNull();
  });

  it('initialises superseded_by and supersedes to null', () => {
    const rows = storeMemories(
      [{ scope: 'global', memory_type: 'decision', title: '', summary: 'Use Postgres for all data.', details_json: {}, importance: 5 }],
      ctx,
    );
    expect(rows[0].superseded_by).toBeNull();
    expect(rows[0].supersedes).toBeNull();
  });

  it('detects heuristic_fallback source_type', () => {
    const rows = storeMemories(
      [{
        scope: 'conversation',
        memory_type: 'decision',
        title: 'Pref',
        summary: 'always use full config files not snippets',
        details_json: { source: 'heuristic_fallback', trigger: 'explicit_preference' },
        importance: 4,
      }],
      ctx,
    );
    expect(rows[0].source_type).toBe('heuristic_fallback');
  });

  it('defaults to llm_extraction source_type for normal candidates', () => {
    const rows = storeMemories(
      [{ scope: 'global', memory_type: 'environment_fact', title: '', summary: 'n8n is running on port 5678.', details_json: {}, importance: 3 }],
      ctx,
    );
    expect(rows[0].source_type).toBe('llm_extraction');
  });

  it('populates source_message from ctx.latest_user_message', () => {
    const rows = storeMemories(
      [{ scope: 'global', memory_type: 'decision', title: '', summary: 'Use full config files.', details_json: {}, importance: 4 }],
      ctx,
    );
    expect(rows[0].source_message).toBe(
      'durable preference: always use full config files not snippets',
    );
  });

  it('returns empty array for empty input', () => {
    expect(storeMemories([], ctx)).toHaveLength(0);
  });
});

// ─── Integration: full pipeline ───────────────────────────────────────────────

describe('memory pipeline — full Extract→Consolidate→Store pass', () => {
  it('processes a durable preference end-to-end into a write row', () => {
    const ctx: MemoryContext = {
      source_message_id: 'msg-e2e',
      conversation_id: 'conv-e2e',
      task_class: 'chat',
      assistant_reply: 'Understood, I will always use full config files.',
      latest_user_message: 'Durable preference: always use full config files not snippets',
      response_mode: 'direct_owner_reply',
    };

    // Step 1: extraction gate
    const { should_extract } = shouldExtractMemory(ctx);
    expect(should_extract).toBe(true);

    // Step 2: parse (LLM returned empty, fallback kicks in)
    const parseResult = extractMemories({ output_text: '{"items":[]}' }, ctx);
    expect(parseResult.fallback_used).toBe(true);
    expect(parseResult.candidates.length).toBeGreaterThan(0);

    // Step 3: consolidate
    const { memories } = consolidateMemories(parseResult.candidates, ctx);
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].memory_type).toBe('decision');

    // Step 4: build write rows (approved schema)
    const rows = storeMemories(memories, ctx);
    expect(rows).toHaveLength(memories.length);
    expect(rows[0].status).toBe('active');
    expect(rows[0].content).toBeTruthy();
    expect(rows[0].content.length).toBeGreaterThanOrEqual(16);
    expect(rows[0].category).toBe('decision');
    expect(rows[0].memory_tier).toBe('working'); // conversation scope → working tier
    expect(rows[0].superseded_by).toBeNull();
    expect(rows[0].supersedes).toBeNull();
  });

  it('skips the pipeline when extraction gate returns false', () => {
    const ctx: MemoryContext = {
      source_message_id: null,
      task_class: 'chat',
      assistant_reply: 'ok',
    };
    const { should_extract } = shouldExtractMemory(ctx);
    expect(should_extract).toBe(false);
    // No further pipeline steps needed when gate is false
  });

  it('deduplicates repeated candidates in consolidation', () => {
    const ctx: MemoryContext = {
      task_class: 'chat',
      latest_user_message: 'decision: use Postgres for all structured data',
    };
    const repeated: MemoryCandidate = {
      scope: 'global',
      memory_type: 'decision',
      title: 'DB',
      summary: 'use Postgres for all structured data',
      details_json: {},
      importance: 5,
    };
    const { memories, filtered_out_count } = consolidateMemories([repeated, repeated], ctx);
    expect(memories).toHaveLength(1);
    expect(filtered_out_count).toBe(1);
  });
});
