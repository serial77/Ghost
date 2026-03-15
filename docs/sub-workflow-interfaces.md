# Ghost Sub-Workflow Interface Contracts

> **Version:** 1.0 (2026-03-15)
> **Source:** Derived from `src/runtime/` TypeScript modules and `workflows/ghost-runtime-workflow.json`
> **Workplan ref:** Ghost_Workplan_Amendment_v3_2 §E (TASK-007)
> **Status:** Design documentation — implementation in TASK-008 through TASK-012

---

## Overview

This document defines the input/output contracts for the five Ghost sub-workflows planned for extraction from the monolithic `ghost-chat-v3` workflow. Each section covers:

- Interface contract (TypeScript types)
- Handoff pattern (required fields, message window)
- MCP tool mapping
- A2A Agent Card
- Security boundary

The five sub-workflows are derived from code nodes already extracted into `src/runtime/`:

| Sub-workflow       | Source module(s)                              | Phase |
|--------------------|-----------------------------------------------|-------|
| `Ghost_Classify`   | `src/runtime/classifier.ts`                   | 3E    |
| `Ghost_Memory`     | (planned — TASK-008)                          | 3E    |
| `Ghost_Route`      | `src/runtime/router.ts` + `circuit-breaker.ts`| 3E    |
| `Ghost_Approve`    | `src/runtime/approval.ts`                     | 3E    |
| `Ghost_Delegate`   | `src/runtime/delegation.ts`                   | 3E    |

---

## 1. Ghost_Classify

### A. Interface Contract

```typescript
/**
 * Input to Ghost_Classify.
 * Trigger: sub-workflow call from parent Ghost_Chat workflow.
 */
interface Ghost_Classify_Input {
  /** Conversation identifier passed through for correlation. */
  conversation_id: string;

  /**
   * The message window to classify against.
   * Recommended N=5 (last 5 messages): sufficient for intent detection without
   * exceeding typical sub-workflow payload limits. The classifier only uses the
   * most recent user message, but full window allows future context expansion.
   */
  message_window: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;

  /** Optional task summary from parent for logging / trace correlation. */
  task_summary?: string;
}

/**
 * Output from Ghost_Classify.
 */
interface Ghost_Classify_Output {
  conversation_id: string;
  request_type: 'chat' | 'technical_work' | 'lightweight_local_task';
  /** ISO-8601 timestamp of classification. */
  classified_at: string;
  /** Echo of input message window for downstream chaining. */
  message_window: Ghost_Classify_Input['message_window'];
}

/**
 * Error response from Ghost_Classify.
 */
interface Ghost_Classify_Error {
  code: 'CLASSIFY_INVALID_INPUT' | 'CLASSIFY_INTERNAL_ERROR';
  message: string;
  retryable: boolean;
}
```

**Trigger mechanism:** Sub-workflow call (n8n Execute Workflow node)

**Classification logic** (from `src/runtime/classifier.ts`):
1. Find the last message with `role === 'user'` in `message_window`
2. Lowercase the content text
3. If text contains any `lightweightLocalSignals` → `lightweight_local_task`
4. If text contains any `technicalWorkSignals` OR `technicalIntentSignals` → `technical_work` (overrides lightweight)
5. Default: `chat`

Signal sets (48 total):
- `lightweightLocalSignals` (18 terms): summarize, classify, extract, tag, title, metadata, etc.
- `technicalWorkSignals` (40 terms): code, python, sql, bug, debug, docker, git, etc.
- `technicalIntentSignals` (10 phrases): write a, implement, patch, investigate, etc.

### B. Handoff Pattern

```
Parent Ghost_Chat
  │
  ├─ sends: { conversation_id, message_window[N=5], task_summary }
  │
  └─► Ghost_Classify
        │
        └─ returns: { conversation_id, request_type, classified_at, message_window }
              │
              └─► Used by Ghost_Route to select provider chain
```

Required handoff fields from classifier output to downstream:
- `conversation_id` — thread correlation
- `request_type` — drives route selection
- `message_window` — passed through to Ghost_Route (no re-fetch needed)

**Message window N=5 rationale:** The classifier only reads the last user message. N=5 is chosen as a minimum viable window that (a) satisfies the classifier's single-message scan and (b) provides enough history for future classifiers that may use multi-turn context. Larger windows (N=10+) are unnecessary and increase payload cost.

### C. MCP Compatibility Note

MCP tool primitive mapping:
```json
{
  "name": "ghost_classify",
  "description": "Classify the intent of the most recent user message in a conversation window.",
  "inputSchema": {
    "type": "object",
    "required": ["conversation_id", "message_window"],
    "properties": {
      "conversation_id": { "type": "string" },
      "message_window": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["role", "content"],
          "properties": {
            "role": { "type": "string", "enum": ["user", "assistant", "system"] },
            "content": { "type": "string" }
          }
        }
      },
      "task_summary": { "type": "string" }
    }
  },
  "outputSchema": {
    "type": "object",
    "required": ["conversation_id", "request_type", "classified_at"],
    "properties": {
      "conversation_id": { "type": "string" },
      "request_type": { "type": "string", "enum": ["chat", "technical_work", "lightweight_local_task"] },
      "classified_at": { "type": "string", "format": "date-time" }
    }
  }
}
```

In an MCP context, this tool is pure (no side effects), takes a message array, and returns a string enum. It maps cleanly to an MCP `tool` with `annotations: { readOnlyHint: true }`.

### D. A2A Agent Card

```json
{
  "name": "Ghost_Classify",
  "description": "Signal-based request classifier for Ghost AI. Categorizes the most recent user message as chat, technical_work, or lightweight_local_task using keyword and intent signal matching. Stateless and side-effect free.",
  "capabilities": [
    "request_classification",
    "intent_detection",
    "message_window_passthrough"
  ],
  "inputSchema": {
    "type": "object",
    "required": ["conversation_id", "message_window"],
    "properties": {
      "conversation_id": { "type": "string", "description": "Conversation identifier for correlation" },
      "message_window": {
        "type": "array",
        "maxItems": 10,
        "description": "Recent message history (recommended N=5)"
      },
      "task_summary": { "type": "string", "description": "Optional parent task label" }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "conversation_id": { "type": "string" },
      "request_type": { "type": "string", "enum": ["chat", "technical_work", "lightweight_local_task"] },
      "classified_at": { "type": "string" },
      "message_window": { "type": "array" }
    }
  },
  "authentication": "internal — n8n service account bearer token",
  "endpoint": "POST /webhook/ghost-classify (n8n sub-workflow trigger)"
}
```

### E. Security Boundary

**Read access:**
- `message_window` array (user-provided content)
- No database, filesystem, or external network access

**Write / side effects:**
- None. Ghost_Classify is fully stateless.

**Input validation requirements:**
- `message_window` must be an array; truncate to max N=10 entries
- `content` fields must be strings; strip or reject non-string values
- Prevent prompt injection: the classifier operates on lowercase keyword matching only — it does not pass user content to an LLM during classification, eliminating the injection attack surface for this sub-workflow
- Tool injection: not applicable (no tool calls from within Ghost_Classify)

**Data isolation guarantees:**
- No memory persistence
- No cross-conversation data access
- Output contains only `request_type` (enum) + echo of input — no derived secrets or PII

---

## 2. Ghost_Memory

> **Note:** Ghost_Memory source module is planned in TASK-008 and does not yet exist in `src/runtime/`. This contract is forward-designed based on the memory trace/audit patterns documented in `docs/ghost-memory-trace-audit.md` and the broader architecture.

### A. Interface Contract

```typescript
/**
 * Input to Ghost_Memory.
 * Supports two operations: 'load' (read) and 'write' (persist).
 * Trigger: sub-workflow call from parent Ghost_Chat workflow.
 */
interface Ghost_Memory_Input {
  operation: 'load' | 'write';
  conversation_id: string;

  /**
   * message_window used for 'write' operation to extract relevant facts.
   * Recommended N=10: memory writes need more context than classification
   * to identify facts worth persisting across sessions.
   * For 'load' only: N=1 (just the latest user message for retrieval query).
   */
  message_window: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;

  task_summary?: string;

  /**
   * For 'write' operation: structured facts to persist.
   * If omitted on write, the sub-workflow derives facts from message_window.
   */
  facts_to_write?: Array<{
    key: string;
    value: string;
    source_conversation_id: string;
    written_at: string;
  }>;

  /** Retrieval query for 'load' operation. Defaults to last user message content. */
  retrieval_query?: string;
}

/**
 * Output from Ghost_Memory.
 */
interface Ghost_Memory_Output {
  conversation_id: string;
  operation: 'load' | 'write';

  /** Populated on 'load' operations. */
  relevant_facts?: Array<{
    key: string;
    value: string;
    source_conversation_id: string;
    written_at: string;
    relevance_score?: number;
  }>;

  /** Populated on 'write' operations. */
  facts_written?: number;
  write_status?: 'ok' | 'partial' | 'skipped';

  /** ISO-8601 */
  completed_at: string;

  /** For chaining — caller passes these downstream. */
  route_metadata?: {
    conversation_id: string;
    relevant_facts_count: number;
  };
}

interface Ghost_Memory_Error {
  code:
    | 'MEMORY_INVALID_INPUT'
    | 'MEMORY_DB_UNAVAILABLE'
    | 'MEMORY_WRITE_FAILED'
    | 'MEMORY_LOAD_FAILED';
  message: string;
  retryable: boolean;
}
```

**Trigger mechanism:** Sub-workflow call (n8n Execute Workflow node)

### B. Handoff Pattern

```
Parent Ghost_Chat
  │
  ├─ LOAD path: sends { operation: 'load', conversation_id, message_window[N=1], retrieval_query }
  │   └─► Ghost_Memory returns { relevant_facts[], route_metadata }
  │         └─► relevant_facts passed to Ghost_Route as context
  │
  └─ WRITE path (post-response): sends { operation: 'write', conversation_id, message_window[N=10] }
      └─► Ghost_Memory returns { facts_written, write_status }
```

Required handoff fields to downstream:
- `conversation_id` — thread correlation
- `relevant_facts` — injected into system prompt or context window for Ghost_Route/LLM call
- `route_metadata.relevant_facts_count` — used by Ghost_Route to decide whether to expand context

**Message window N values:**
- Load: N=1 (retrieval query built from last user message)
- Write: N=10 (extract facts from full recent exchange, including assistant responses)

### C. MCP Compatibility Note

Ghost_Memory maps to two MCP tool primitives:

1. `ghost_memory_load` — `annotations: { readOnlyHint: true }` — reads from Postgres memory table
2. `ghost_memory_write` — no `readOnlyHint` — writes to Postgres memory table, requires `memory.write` capability

MCP input schema for load:
```json
{
  "name": "ghost_memory_load",
  "inputSchema": {
    "type": "object",
    "required": ["conversation_id"],
    "properties": {
      "conversation_id": { "type": "string" },
      "retrieval_query": { "type": "string" },
      "message_window": { "type": "array" }
    }
  }
}
```

### D. A2A Agent Card

```json
{
  "name": "Ghost_Memory",
  "description": "Loads relevant facts from long-term memory store or writes new facts derived from conversation. Backed by Postgres. Requires memory.write capability for write operations.",
  "capabilities": [
    "memory_load",
    "memory_write",
    "fact_retrieval",
    "context_injection"
  ],
  "inputSchema": {
    "type": "object",
    "required": ["operation", "conversation_id", "message_window"],
    "properties": {
      "operation": { "type": "string", "enum": ["load", "write"] },
      "conversation_id": { "type": "string" },
      "message_window": { "type": "array", "description": "N=1 for load, N=10 for write" },
      "facts_to_write": { "type": "array" },
      "retrieval_query": { "type": "string" }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "relevant_facts": { "type": "array" },
      "facts_written": { "type": "number" },
      "write_status": { "type": "string" },
      "completed_at": { "type": "string" }
    }
  },
  "authentication": "internal — n8n service account bearer token",
  "endpoint": "POST /webhook/ghost-memory (n8n sub-workflow trigger)"
}
```

### E. Security Boundary

**Read access:**
- Postgres memory table (scoped to `conversation_id` or retrieval query)
- `message_window` content (for fact derivation on write)

**Write / side effects:**
- `write` operation: inserts/upserts rows in Postgres memory table
- Requires `memory.write` capability — subject to governance approval in `prod` and `staging`

**Input validation requirements:**
- `operation` must be exactly `'load'` or `'write'`; reject unknown values
- `conversation_id` must match UUID or short-id format; reject if empty or malformed
- `message_window` content fields: sanitize — strip null bytes, enforce max length per item (2000 chars)
- Prompt injection via `facts_to_write`: validate `key` and `value` as string scalars; do not execute value as code or SQL
- Tool injection: `relevant_facts` returned to caller must be treated as untrusted text — do not execute

**Data isolation guarantees:**
- Load queries scoped by `conversation_id` or retrieval query match — no cross-conversation data leakage by default
- Write operations only persist to the memory table; no other side effects
- No cross-user data access (conversation_id is the isolation boundary)

---

## 3. Ghost_Route

### A. Interface Contract

```typescript
/**
 * Input to Ghost_Route.
 * Trigger: sub-workflow call from parent Ghost_Chat workflow.
 */
interface Ghost_Route_Input {
  conversation_id: string;

  /** request_type from Ghost_Classify output. */
  request_type: 'chat' | 'technical_work' | 'lightweight_local_task';

  /**
   * message_window for context (passed through, not used in route selection itself).
   * Recommended N=5.
   */
  message_window: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;

  task_summary?: string;

  /** Relevant facts from Ghost_Memory load (injected into context). */
  relevant_facts?: Array<{ key: string; value: string }>;

  /**
   * Route metadata from prior context (optional — for retry/override scenarios).
   */
  route_metadata?: {
    force_provider?: string;
    force_model?: string;
    force_task_class?: string;
  };
}

/**
 * Output from Ghost_Route.
 */
interface Ghost_Route_Output {
  conversation_id: string;
  task_class: 'chat' | 'technical_work' | 'lightweight_local_task';
  provider: string;
  selected_model: string;
  route_chain: Array<{ provider: string; model: string }>;
  fallback_chain: Array<{ provider: string; model: string }>;
  /** True if all providers in the chain have open circuit breakers. */
  circuit_blocked?: boolean;
  /** Circuit states at time of routing (for operator inspection). */
  circuit_states?: Record<string, 'closed' | 'open' | 'half_open'>;
  /** Passed through for downstream chaining. */
  message_window: Ghost_Route_Input['message_window'];
  relevant_facts?: Ghost_Route_Input['relevant_facts'];
}

interface Ghost_Route_Error {
  code:
    | 'ROUTE_INVALID_INPUT'
    | 'ROUTE_CIRCUIT_BLOCKED'
    | 'ROUTE_REDIS_UNAVAILABLE'
    | 'ROUTE_INTERNAL_ERROR';
  message: string;
  retryable: boolean;
  /** If retryable: when to retry (unix ms). */
  retry_after_ms?: number;
}
```

**Trigger mechanism:** Sub-workflow call (n8n Execute Workflow node)

**Route selection logic** (from `src/runtime/router.ts` + `circuit-breaker.ts`):

Provider chains (from `src/runtime/config.ts`):
```
chat:                  openai_api/gpt-4.1-mini → ollama/qwen3:8b → ollama/qwen3:14b
technical_work:        codex_oauth_worker/gpt-5.4 → ollama/qwen2.5-coder:14b → ollama/qwen3-coder:30b-a3b-q4_K_M
lightweight_local_task: ollama/qwen2.5:3b-instruct → ollama/qwen3:8b
```

Circuit breaker integration (`ghost:circuit:{provider}` Redis key):
- Providers with `state: 'open'` are skipped
- If all providers in chain are open → `circuit_blocked: true`
- Circuit trips at 3 failures; cooldown: 529→60s, others→300s

### B. Handoff Pattern

```
Ghost_Classify ──────────────────────────────────────────────► Ghost_Route
  { request_type }                                                │
                                                                  │
Ghost_Memory ─────────────────────────────────────────────────► │
  { relevant_facts }                                             │
                                                                  │
                                              Ghost_Route returns │
  { conversation_id, task_class, provider, selected_model,       │
    route_chain, fallback_chain, circuit_blocked?,                │
    message_window[N=5], relevant_facts }                        │
                                                                  │
                                                                  ▼
                                                         LLM call / Ghost_Delegate
```

Required handoff fields from Ghost_Route to downstream:
- `conversation_id`
- `provider` + `selected_model` — used for the LLM API call
- `task_class` — used by Ghost_Delegate to select the worker
- `fallback_chain` — used for retry if primary call fails
- `circuit_blocked` — if true, parent must surface a degraded-service response
- `message_window` — passed to LLM call
- `relevant_facts` — injected into system prompt

**Message window N=5 rationale:** Routing does not need the full history — it receives `request_type` from Ghost_Classify and uses it directly. The window is carried through for the downstream LLM call without re-fetching.

### C. MCP Compatibility Note

```json
{
  "name": "ghost_route",
  "description": "Select the best available LLM provider and model for a given request type, respecting circuit breaker state.",
  "annotations": { "readOnlyHint": false },
  "inputSchema": {
    "type": "object",
    "required": ["conversation_id", "request_type"],
    "properties": {
      "conversation_id": { "type": "string" },
      "request_type": { "type": "string", "enum": ["chat", "technical_work", "lightweight_local_task"] },
      "route_metadata": {
        "type": "object",
        "properties": {
          "force_provider": { "type": "string" },
          "force_model": { "type": "string" },
          "force_task_class": { "type": "string" }
        }
      }
    }
  }
}
```

Ghost_Route has a Redis side effect (reads circuit state, may write on circuit state transition via `recordFailure`/`recordSuccess` called by the parent after the LLM call returns). MCP `readOnlyHint: false` is correct.

### D. A2A Agent Card

```json
{
  "name": "Ghost_Route",
  "description": "Selects the optimal LLM provider and model for a request, with circuit-breaker-aware fallback. Reads per-provider circuit state from Redis (ghost:circuit:{provider}). Returns full fallback chain for caller-managed retry.",
  "capabilities": [
    "route_selection",
    "circuit_breaker_integration",
    "fallback_chain_provision",
    "provider_availability_check"
  ],
  "inputSchema": {
    "type": "object",
    "required": ["conversation_id", "request_type"],
    "properties": {
      "conversation_id": { "type": "string" },
      "request_type": { "type": "string", "enum": ["chat", "technical_work", "lightweight_local_task"] },
      "message_window": { "type": "array" },
      "relevant_facts": { "type": "array" },
      "route_metadata": { "type": "object" }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "provider": { "type": "string" },
      "selected_model": { "type": "string" },
      "route_chain": { "type": "array" },
      "fallback_chain": { "type": "array" },
      "circuit_blocked": { "type": "boolean" }
    }
  },
  "authentication": "internal — n8n service account bearer token",
  "endpoint": "POST /webhook/ghost-route (n8n sub-workflow trigger)"
}
```

### E. Security Boundary

**Read access:**
- Redis: `ghost:circuit:{provider}` keys (read-only during route selection)
- Input payload fields: `request_type`, `route_metadata`

**Write / side effects:**
- Redis: potential circuit state write if `selectRouteWithCircuit` is called (reads only; writes happen when parent calls `recordFailure`/`recordSuccess`)
- No database writes
- No external network calls

**Input validation requirements:**
- `request_type` must be one of the three enum values; reject unknown values
- `route_metadata.force_provider` / `force_model`: validate as non-empty strings if provided; do not allow injection of Redis key patterns
- Circuit state from Redis is internal state only — never trust user-provided `circuit_states` directly

**Data isolation guarantees:**
- Route selection is stateless from a conversation perspective; no cross-conversation leakage
- Circuit state is global per-provider (shared across all conversations for the same provider) — this is intentional and by design

---

## 4. Ghost_Approve

### A. Interface Contract

```typescript
/**
 * Input to Ghost_Approve.
 * Trigger: sub-workflow call when risk detection or governance gate is needed.
 */
interface Ghost_Approve_Input {
  conversation_id: string;
  task_summary: string;

  /**
   * message_window for risk text analysis.
   * Recommended N=3: only the most recent 1-3 user messages are relevant
   * for destructive pattern matching. Risk detection is purely pattern-based.
   */
  message_window: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;

  /** Worker requesting approval. Must be a key in APPROVAL_CONFIG.workers_by_id. */
  requester_worker_id: string;

  /** Capabilities the worker intends to use. */
  requested_capabilities: string[];

  /** Deployment environment. One of: prod | staging | lab | sandbox | scratch */
  environment: string;

  /** ISO-8601 timestamp. */
  requested_at: string;

  /** Optional override: pass pre-computed risk text for pattern matching. */
  risk_text?: string;

  relevant_facts?: Array<{ key: string; value: string }>;
  route_metadata?: {
    provider?: string;
    model?: string;
    task_class?: string;
  };
}

/**
 * Output from Ghost_Approve.
 */
interface Ghost_Approve_Output {
  conversation_id: string;
  approval_id: string;
  state: 'allowed' | 'approval_required' | 'environment_restricted';

  /** From detectRiskLevel() */
  risk_level: 'safe' | 'caution' | 'destructive';
  risk_findings: Array<{
    level: 'destructive' | 'caution';
    code: string;
    reason: string;
  }>;

  /** From assessApprovalRisk() */
  governance_policy: {
    state: 'allowed' | 'approval_required' | 'environment_restricted';
    summary: string;
    blocking_capabilities: string[];
    environment: string;
    environment_posture: string | null;
    approval_required_capabilities: string[];
    restricted_capabilities: string[];
    out_of_scope_capabilities: string[];
    destructive_capabilities: string[];
    operator_identity: string | null;
    worker_environment_scope: string[];
  };

  approval_required: boolean;
  blocking_reason?: string;

  /** Pass-through for chaining. */
  task_summary: string;
  route_metadata?: Ghost_Approve_Input['route_metadata'];
}

interface Ghost_Approve_Error {
  code:
    | 'APPROVE_INVALID_WORKER'
    | 'APPROVE_INVALID_CAPABILITY'
    | 'APPROVE_INVALID_ENVIRONMENT'
    | 'APPROVE_INTERNAL_ERROR';
  message: string;
  retryable: boolean;
}
```

**Trigger mechanism:** Sub-workflow call (n8n Execute Workflow node) — called conditionally when `task_class === 'technical_work'` or when risk detection fires

**Risk detection logic** (from `src/runtime/approval.ts`):
- `detectRiskLevel(sourceText)`: pattern matches against 4 destructive rules (delete/rm, docker lifecycle, destructive SQL, critical file moves) and 3 caution rules (critical file edit, broad SQL, infrastructure change)
- `assessApprovalRisk(workerId, capabilities, environment)`: evaluates governance policy — checks environment restrictions, out-of-scope capabilities, approval requirements

**Workers defined:** `ghost_main`, `forge`, `probe`, `rector`, `archivist`, `operator`, `scout`

**Capabilities defined:** `code.read`, `code.write`, `shell.safe`, `shell.destructive`, `git.inspect`, `git.write`, `deploy.promote`, `db.read`, `db.write`, `memory.write`, `web.research`, `artifact.publish`

### B. Handoff Pattern

```
Ghost_Classify → request_type: technical_work
                        │
                        ▼
Ghost_Route → selected route
                        │
                        ▼
Ghost_Approve ─ input: { conversation_id, task_summary, message_window[N=3],
                          requester_worker_id, requested_capabilities, environment }
                        │
                        ├─ approval_required: false → proceed to LLM call / Ghost_Delegate
                        └─ approval_required: true  → surface approval gate to operator
```

Required handoff fields from Ghost_Approve to downstream:
- `conversation_id`
- `approval_required` — gate for delegation
- `governance_policy.state` — used by Ghost_Delegate to set approval flags
- `risk_level` + `risk_findings` — operator visibility
- `task_summary` — passed to Ghost_Delegate
- `route_metadata` — carries provider selection through

**Message window N=3 rationale:** Risk detection operates on user text content only. N=3 captures the most recent user turn(s) where the risky instruction would appear. Going beyond N=3 risks false positives from earlier unrelated messages and increases payload size for a pattern-matching operation with no LLM cost.

### C. MCP Compatibility Note

```json
{
  "name": "ghost_approve",
  "description": "Assess approval risk for a requested action. Returns governance policy and risk classification. Does not perform the action itself.",
  "annotations": { "readOnlyHint": true },
  "inputSchema": {
    "type": "object",
    "required": ["conversation_id", "task_summary", "requester_worker_id", "requested_capabilities", "environment"],
    "properties": {
      "conversation_id": { "type": "string" },
      "task_summary": { "type": "string" },
      "message_window": { "type": "array" },
      "requester_worker_id": { "type": "string" },
      "requested_capabilities": { "type": "array", "items": { "type": "string" } },
      "environment": { "type": "string" }
    }
  }
}
```

Ghost_Approve is `readOnlyHint: true` — it only evaluates and returns policy; it does not create database records or send approvals. Approval state persistence is the responsibility of the parent workflow.

### D. A2A Agent Card

```json
{
  "name": "Ghost_Approve",
  "description": "Governance gate for Ghost AI. Evaluates destructive risk patterns in user requests and assesses approval requirements based on worker identity, capabilities, and environment posture. Returns policy state and risk findings without executing or persisting the action.",
  "capabilities": [
    "risk_detection",
    "governance_policy_evaluation",
    "capability_restriction_check",
    "environment_posture_assessment"
  ],
  "inputSchema": {
    "type": "object",
    "required": ["conversation_id", "task_summary", "requester_worker_id", "requested_capabilities", "environment"],
    "properties": {
      "conversation_id": { "type": "string" },
      "task_summary": { "type": "string" },
      "message_window": { "type": "array", "description": "N=3 recommended" },
      "requester_worker_id": { "type": "string", "description": "Must be a valid worker id: ghost_main|forge|probe|rector|archivist|operator|scout" },
      "requested_capabilities": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Capability ids from the governance model"
      },
      "environment": { "type": "string", "enum": ["prod", "staging", "lab", "sandbox", "scratch"] }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "approval_id": { "type": "string" },
      "state": { "type": "string" },
      "risk_level": { "type": "string" },
      "risk_findings": { "type": "array" },
      "governance_policy": { "type": "object" },
      "approval_required": { "type": "boolean" }
    }
  },
  "authentication": "internal — n8n service account bearer token",
  "endpoint": "POST /webhook/ghost-approve (n8n sub-workflow trigger)"
}
```

### E. Security Boundary

**Read access:**
- `message_window` content (for pattern matching)
- Static governance config (`APPROVAL_CONFIG` embedded in module — not from user input)

**Write / side effects:**
- None directly. Approval state records are created by the parent workflow, not by Ghost_Approve itself.

**Input validation requirements:**
- `requester_worker_id` must match a key in `APPROVAL_CONFIG.workers_by_id`; throw `APPROVE_INVALID_WORKER` if not
- `requested_capabilities` items must match keys in `APPROVAL_CONFIG.capabilities_by_id`; unknown capabilities are silently filtered (matching live module behavior)
- `environment` must match one of the five known env keys; default to `lab` if unknown (matching `assessApprovalRisk` behavior)
- Prompt injection in `task_summary` and `message_window`: risk detection uses regex pattern matching only — user content is never forwarded to an LLM within this sub-workflow
- Tool injection: not applicable

**Data isolation guarantees:**
- All governance config is static/embedded — no Postgres reads
- No cross-conversation data; only evaluates the provided input
- Returns classification results only; actual approval gating enforced by parent

---

## 5. Ghost_Delegate

### A. Interface Contract

```typescript
/**
 * Input to Ghost_Delegate.
 * Trigger: sub-workflow call when task_class === 'technical_work' and approval gate is passed.
 */
interface Ghost_Delegate_Input {
  conversation_id: string;
  task_summary: string;

  /**
   * message_window for delegation context.
   * Recommended N=10: delegation requires full request context and parent
   * conversation history for the worker to complete the task accurately.
   */
  message_window: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;

  /** task_class from Ghost_Classify (drives worker selection by invocation_intent). */
  task_class: string;

  relevant_facts?: Array<{ key: string; value: string }>;

  route_metadata: {
    provider: string;
    model: string;
    task_class: string;
    conversation_id: string;
    parent_message_id?: string;
    parent_owner_agent_id?: string;
    parent_owner_agent_key?: string;
    parent_owner_label?: string;
    n8n_execution_id?: string;
    entrypoint?: string;
  };

  /** From Ghost_Approve output. */
  approval_required: boolean;
  risk_level?: 'safe' | 'caution' | 'destructive';

  /** Delegation DB record fields (from Create Delegation DB Record workflow node). */
  worker_config?: {
    delegation_id?: string;
    orchestration_task_id?: string;
    worker_conversation_id?: string;
    worker_agent_id?: string;
    worker_provider?: string;
    worker_model?: string;
  };

  governance_environment?: string;
}

/**
 * Output from Ghost_Delegate.
 */
interface Ghost_Delegate_Output {
  conversation_id: string;
  delegation_id: string;
  orchestration_task_id: string;
  delegated_worker_id: string;
  delegated_worker_label: string;
  delegated_worker_role: string;
  request_title: string;
  request_summary: string;
  approval_required: boolean;
  governance_environment: string;
  governance_policy: {
    state: string;
    summary: string;
    blocking_capabilities: string[];
    approval_required_capabilities: string[];
  };

  /** Full DelegationResult.worker_runtime_input for worker invocation. */
  worker_runtime_input: {
    request_summary: string;
    delegated_from_conversation_id: string;
    delegated_from_message_id: string;
    delegated_provider: string;
    delegated_model: string;
  };

  /** Full DelegationResult.worker_runtime_context for worker bootstrap. */
  worker_runtime_context: {
    delegation_id: string;
    orchestration_task_id: string;
    parent_conversation_id: string;
    parent_owner_label: string;
    worker_registry_id: string;
    worker_role: string;
    worker_operator_identity: string;
    delegated_provider: string;
    delegated_model: string;
    entrypoint: string;
    n8n_execution_id: string;
  };
}

interface Ghost_Delegate_Error {
  code:
    | 'DELEGATE_NO_WORKER'
    | 'DELEGATE_MISSING_CAPABILITIES'
    | 'DELEGATE_APPROVAL_BLOCKED'
    | 'DELEGATE_INVALID_INPUT'
    | 'DELEGATE_INTERNAL_ERROR';
  message: string;
  retryable: boolean;
}
```

**Trigger mechanism:** Sub-workflow call (n8n Execute Workflow node)

**Delegation logic** (from `src/runtime/delegation.ts`):
1. Worker selection by `invocation_intent` match against `task_class`
2. Fallback to `forge` worker if no intent match
3. Governance policy evaluation for the resolved worker in the given environment
4. Required capabilities: `['code.write', 'artifact.publish']` (hardcoded from `DELEGATION_REQUIRED_CAPABILITIES`)
5. Builds `worker_runtime_input` and `worker_runtime_context` structs for worker bootstrap

**Worker routing** (from `WORKER_RUNTIME.workers_by_id`):
- `technical_work` / `code_change` / `artifact_build` → `forge`
- `smoke_check` / `runtime_probe` / `post_change_verification` → `probe`
- `guarded_cleanup` / `narrow_remediation` → `rector`
- `memory_write` / `audit_packaging` / `history_summary` → `archivist`
- `deployment_promotion` / `rollback` → `operator`
- `recon` / `research` / `preflight_discovery` → `scout`

### B. Handoff Pattern

```
Ghost_Classify → task_class: technical_work
        │
        ▼
Ghost_Route → { provider, model, fallback_chain }
        │
        ▼
Ghost_Approve → { approval_required: false, governance_policy }
        │
        ▼
Ghost_Delegate ─ input: { conversation_id, task_summary, message_window[N=10],
                            task_class, route_metadata, worker_config,
                            approval_required, governance_environment }
        │
        └─► worker_runtime_input + worker_runtime_context
               │
               └─► Triggers delegated worker sub-workflow (forge / probe / rector etc.)
```

Required handoff fields from Ghost_Delegate to delegated worker:
- `worker_runtime_input.request_summary` — what the worker should do
- `worker_runtime_input.delegated_from_conversation_id` — parent context reference
- `worker_runtime_input.delegated_provider` + `delegated_model` — which LLM to use
- `worker_runtime_context.delegation_id` — audit trail
- `worker_runtime_context.parent_owner_label` — for worker self-identification
- `worker_runtime_context.entrypoint` — how the delegation was initiated

**Message window N=10 rationale:** Delegated workers need sufficient context to complete technical tasks that may reference prior conversation turns (e.g., "fix the bug we discussed earlier"). N=10 provides 5 exchange pairs which covers typical task-framing depth. Workers needing deeper history can request additional context via Ghost_Memory.

### C. MCP Compatibility Note

```json
{
  "name": "ghost_delegate",
  "description": "Build a delegation request and worker runtime context for a technical task. Selects the appropriate worker by task intent and evaluates governance policy.",
  "annotations": { "readOnlyHint": false },
  "inputSchema": {
    "type": "object",
    "required": ["conversation_id", "task_summary", "task_class", "route_metadata"],
    "properties": {
      "conversation_id": { "type": "string" },
      "task_summary": { "type": "string" },
      "task_class": { "type": "string" },
      "message_window": { "type": "array", "description": "N=10 recommended" },
      "route_metadata": { "type": "object" },
      "worker_config": { "type": "object" },
      "approval_required": { "type": "boolean" },
      "governance_environment": { "type": "string" }
    }
  }
}
```

Ghost_Delegate is `readOnlyHint: false` because it writes delegation state (creates the delegation record) and initiates the worker invocation.

### D. A2A Agent Card

```json
{
  "name": "Ghost_Delegate",
  "description": "Selects and bootstraps a delegated worker for technical tasks. Matches task intent to worker registry, evaluates governance policy, and builds worker_runtime_input and worker_runtime_context payloads for worker invocation. Requires governance approval gate to have been cleared by Ghost_Approve.",
  "capabilities": [
    "worker_selection",
    "delegation_request_building",
    "worker_context_building",
    "governance_policy_integration",
    "capability_validation"
  ],
  "inputSchema": {
    "type": "object",
    "required": ["conversation_id", "task_summary", "task_class", "route_metadata"],
    "properties": {
      "conversation_id": { "type": "string" },
      "task_summary": { "type": "string", "maxLength": 800 },
      "task_class": { "type": "string" },
      "message_window": { "type": "array", "description": "N=10 recommended" },
      "route_metadata": {
        "type": "object",
        "required": ["provider", "model"],
        "properties": {
          "provider": { "type": "string" },
          "model": { "type": "string" },
          "conversation_id": { "type": "string" },
          "parent_message_id": { "type": "string" },
          "n8n_execution_id": { "type": "string" },
          "entrypoint": { "type": "string" }
        }
      },
      "worker_config": { "type": "object" },
      "approval_required": { "type": "boolean" },
      "governance_environment": { "type": "string", "enum": ["prod", "staging", "lab", "sandbox", "scratch"] }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "delegation_id": { "type": "string" },
      "delegated_worker_id": { "type": "string" },
      "approval_required": { "type": "boolean" },
      "worker_runtime_input": { "type": "object" },
      "worker_runtime_context": { "type": "object" }
    }
  },
  "authentication": "internal — n8n service account bearer token",
  "endpoint": "POST /webhook/ghost-delegate (n8n sub-workflow trigger)"
}
```

### E. Security Boundary

**Read access:**
- Static worker runtime config (`WORKER_RUNTIME` — embedded in module)
- `message_window` content (passed through to `worker_runtime_input.request_summary`)
- `task_summary` (truncated to 800 chars via `compact()` in module)

**Write / side effects:**
- Initiates delegated worker sub-workflow invocation
- Creates/updates delegation DB record (via parent workflow node, not directly in this module)
- Calls that can trigger `code.write`, `git.write`, `artifact.publish` in downstream workers

**Input validation requirements:**
- `task_class` is used for intent matching only (string comparison); no code execution
- `task_summary` and `message_window` content: the `compact()` utility in `delegation.ts` already truncates to 800 chars — enforce this in the sub-workflow input handling
- Prompt injection: `request_summary` is passed verbatim to the delegated worker — the worker itself must validate and scope execution; Ghost_Delegate does not sanitize beyond truncation
- `governance_environment`: must resolve to one of the five known envs or default to `lab`; prevents environment-confusion attacks
- Do not accept `worker_config.worker_agent_id` or `worker_config.delegation_id` from untrusted external callers — these should be generated server-side by the parent workflow's DB record step

**Data isolation guarantees:**
- Worker context is scoped to the originating `conversation_id`
- `parent_conversation_id` in `worker_runtime_context` is the isolation anchor for the delegated task
- No cross-conversation context mixing
- Governance policy is evaluated fresh per call; no caching of prior approval decisions

---

## Cross-Cutting Handoff Field Reference

The following fields are required to flow through the entire sub-workflow chain for full traceability:

| Field                  | Where set         | Flows through                          |
|------------------------|-------------------|----------------------------------------|
| `conversation_id`      | Ghost_Chat parent | All sub-workflows                      |
| `task_summary`         | Ghost_Chat parent | Classify → Route → Approve → Delegate  |
| `request_type`         | Ghost_Classify    | Route → Approve → Delegate             |
| `relevant_facts`       | Ghost_Memory      | Route → LLM context / Delegate context |
| `provider`/`model`     | Ghost_Route       | Approve → Delegate                     |
| `fallback_chain`       | Ghost_Route       | Parent retry logic                     |
| `approval_required`    | Ghost_Approve     | Delegate gate                          |
| `governance_policy`    | Ghost_Approve     | Delegate, operator visibility          |
| `delegation_id`        | Ghost_Delegate    | Worker runtime context                 |

## Message Window N Summary

| Sub-workflow    | N   | Rationale                                                           |
|-----------------|-----|---------------------------------------------------------------------|
| Ghost_Classify  | 5   | Only last user message used; N=5 for future multi-turn expansion    |
| Ghost_Memory    | 1 / 10 | Load: 1 (retrieval query); Write: 10 (fact extraction)          |
| Ghost_Route     | 5   | Passed through; route decision uses `request_type`, not raw text   |
| Ghost_Approve   | 3   | Pattern matching only; last 1-3 messages sufficient                 |
| Ghost_Delegate  | 10  | Worker needs full task context; technical tasks reference history   |

---

*Generated: 2026-03-15 by Claude Code (TASK-007)*
*Source modules: src/runtime/classifier.ts, config.ts, router.ts, circuit-breaker.ts, approval.ts, delegation.ts*
