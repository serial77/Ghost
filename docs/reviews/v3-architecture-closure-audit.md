# Ghost v3 Architecture Closure Audit
**Phase 2 / 3 / 7 Reconciliation**

- **Branch:** `claude-arch-closure-audit`
- **Date:** 2026-03-15
- **Auditor:** Claude (external implementation worker)
- **Canonical sources:** `docs/Ghost_Roadmap_v3.docx`, `docs/Ghost_Phase_Requirements_v3.docx`
- **Tracker anchor:** phase-2 / p2e-schema-migration-strategy / assigned

---

## A. Executive Judgment

### What is truly already real

1. **Runtime infrastructure** — Postgres 16, Redis 7, n8n 2.11.3 (main + worker), Next.js UI are all running under Docker Compose with health checks and AOF-persistent Redis.
2. **Core schema (init)** — `scripts/init-ghost-app.sql` creates all Phase 2B tables: `users`, `agents`, `conversations`, `messages`, `tasks`, `task_runs`, `artifacts`, `approvals`, `service_health`, `tool_events`. Triggers and indexes are in place.
3. **Runtime ledger** — `ghost_runtime_start_task_ledger` / `ghost_runtime_complete_task_ledger` functions exist and are wired into the live workflow via Postgres nodes.
4. **Delegation data model** — `conversation_delegations`, `orchestration_tasks`, `orchestration_task_events` tables exist (Phase 5 migrations). Helper functions `ghost_create_conversation_delegation`, `ghost_start_delegation_runtime`, `ghost_finalize_delegation` are implemented.
5. **Pinned conversation ownership** — `ghost_ensure_conversation_owner` function enforces one owner per conversation. Migration `20260313_phase5gd_openclaw_alignment.sql` adds `owner_agent_id`, `owner_locked_at` to conversations.
6. **Worker identity routing** — Live workflow has classification (`Classify request`), route selection (`Select Route Plan`), and provider branches (OpenAI, Ollama, Codex). Three provider routes are functional.
7. **BullMQ queue via Redis** — n8n uses `QUEUE_BULL_REDIS_HOST: ghost-redis` for its own workflow execution queue. Redis infrastructure is operational.
8. **Approval system (primitive)** — Approval risk assessment node exists in workflow; Codex execution is blocked when `approval_required=true`.
9. **Memory plane** — `ghost_memory` table, extraction pipeline, and retrieval nodes are live. Memory feeds into system prompt.
10. **Structured migration files** — `db/migrations/` contains 7 dated SQL files. Down-migrations pair with each up-migration.

### What is partially real but below v3 contract

1. **Migration system** — Migration files exist but there is no migration runner, no `001_initial_schema` unifying the init SQL, no auto-execution on compose up, and no `docs/contracts/migration-guide.md`. The init SQL (`scripts/init-ghost-app.sql`) is not a migration.
2. **Delegation model** — `conversation_delegations` table and delegation helper functions exist, but delegation execution is **synchronous and inline** within the 75-node monolith. There is no Redis delegation queue, no separate dispatcher workflow, and no immediate user response with task reference.
3. **Route fallback** — `ROUTING.md` specifies fallback chains (premium → local), and the workflow has route selection logic, but there is **no circuit breaker**. Provider failures cause cascading timeouts without trip-detection or cooldown.
4. **Redis role** — Redis is running and used as n8n's BullMQ executor queue. It is **not** activated for Ghost application-layer purposes: no `ghost:delegation:queue`, no `ghost:events` pub/sub, no capability cache keys.
5. **Event logging** — `tool_events` table provides an execution trace, but it is mutable (no append-only constraint), lacks `entity_type/actor_type` fields, and does not serve as the `ghost_events` event sourcing backbone specified by 7D-ii.

### What is missing

- `src/runtime/` TypeScript source directory — does not exist
- Five n8n sub-workflows (Ghost_Ingress, Ghost_Classify, Ghost_Delegate, Ghost_Approve, Ghost_Memory) — none exist
- Circuit breaker in `src/runtime/circuit-breaker.ts` with Redis state (`ghost:circuit:{provider}`) — missing
- Redis application-layer keys: `ghost:delegation:queue`, `ghost:events`, `ghost:cache:capabilities`, `ghost:cache:worker_grants` — none exist
- `followthrough_intents` table — missing
- `followthrough_executions` table — missing
- `ghost_events` table (append-only event sourcing layer) — missing
- `docs/contracts/migration-guide.md` — missing
- Migration #001 (`001_initial_schema.sql`) unifying existing init SQL — missing
- Automated migration execution wired into Compose boot — missing
- Unit tests in `/tests/runtime/` — missing

### Whether Ghost can safely continue forward without closing these gaps

**No — not for all forward work, but yes for targeted Phase 4/5/6 UI work.**

The hardest blocker is **2E (migration system)**. Phase 5 (capability model) and Phase 7 (followthrough, ghost_events) will add new tables. Without a migration runner wired into compose boot, every schema change is a manual operation with no replay guarantee. This is the root structural risk.

**3E / 3E-ii** (decomposition and source extraction) are load-bearing for **3F** (Redis activation) and **3C-ii** (circuit breaker), which both require `src/runtime/` modules. The current n8n Code nodes cannot be unit-tested and have no import path for a circuit breaker.

**7C-ii** (write-ahead) depends on Phase 7 infrastructure that does not exist yet and requires a standalone design document before implementation. **7D-ii** (ghost_events) is foundational to audit and Phase 8 — it should be created as a migration before new tables proliferate.

---

## B. Step-by-Step Reconciliation Matrix

### 2E — Schema Migration Strategy

**Canonical requirement summary**
Adopt a versioned migration system (node-pg-migrate or numbered SQL files). Migration #001 captures the full current schema. Every future change is a numbered migration with up/down. Auto-execute on compose boot before n8n/Next.js start. Document workflow in `docs/contracts/migration-guide.md`.
_(REQ-2E-01 through REQ-2E-05)_

**Current repo/runtime evidence**
- `db/migrations/` contains 7 dated SQL files (phase4a, phase5d, phase5gc, phase5gd, phase5gf, runtime_observability_hardening). Each has a down-migration pair.
- `scripts/init-ghost-app.sql` is the initial schema but is not a migration — it is a standalone idempotent `CREATE TABLE IF NOT EXISTS` script.
- Docker Compose (`base/docker-compose.yml`) has no migrate step. n8n boots directly against Postgres after healthcheck with no schema versioning.
- No `node-pg-migrate` or equivalent in any `package.json` or requirements file visible in the repo.
- No `docs/contracts/migration-guide.md`.
- Migration numbering is date-based (not sequential integer), which is valid but differs slightly from REQ-2E-02 which calls for `001_initial_schema.sql`.

**Gap assessment**
| Requirement | Status |
|---|---|
| Migration runner installed | **MISSING** |
| Migration #001 for current schema | **MISSING** — init SQL is not a migration |
| Numbered up/down pattern | **Partially present** — files exist but no runner enforces them |
| Auto-run on compose boot | **MISSING** |
| Migration guide doc | **MISSING** |

**Risk if deferred**
Phase 5 capability tables, Phase 7 `followthrough_intents`, `followthrough_executions`, `ghost_events`, and notification tables all require schema additions. Without a versioned runner, each addition is a manual `psql` command with no replay path. In a failure/restore scenario, schema state and data state will diverge. This is the primary data integrity risk.

**Recommended next move**
1. Create `db/migrations/001_initial_schema.sql` that captures `scripts/init-ghost-app.sql` exactly (idempotent, all current tables).
2. Add a lightweight bash migration runner script (`scripts/migrate.sh`) that executes numbered SQL files in order, tracking applied migrations in a `schema_migrations` table.
3. Wire the runner into a new Docker Compose service (`ghost-migrate`) that runs once before `ghost-n8n-main` depends on it.
4. Create `docs/contracts/migration-guide.md`.
5. Rename future migration files to `NNN_description.sql` pattern (existing dated files can be wrapped or preserved as-is in a legacy pass).

**Dependency notes**
Blocks all Phase 5, 7 schema additions. Should be first closure item.

---

### 3B-ii — Asynchronous Delegation via Message Bus

**Canonical requirement summary**
Decouple delegation from parent workflow. Ghost Main publishes to a Redis list `ghost:delegation:queue`, responds to user immediately with task reference. A separate `Ghost_Worker_Dispatcher` workflow (5-second cron) consumes and executes delegations. Worker completion publishes a result event. Prevents worker failures from cascading to parent conversation.
_(Roadmap 3B-ii; REQ-3F-01 for Redis delegation queue)_

**Current repo/runtime evidence**
- Live workflow (`ghost-chat-v3-live-post-runtime-hardening-20260313T035028Z.json`, 75 nodes) executes delegation **inline and synchronously**:
  - `Delegation Required?` → `Build Delegation Request` → `Create Conversation Delegation` → `Execute Delegated Codex Command` → `Normalize Delegated Codex Reply` → `Finalize Successful Delegation` — all in the parent workflow thread.
- If Codex execution takes 60 seconds, the parent webhook holds the connection for 60 seconds.
- If Codex fails, the parent workflow fails.
- Redis (`ghost-redis`) is running but has no `ghost:delegation:queue` list. No separate dispatcher workflow exists.
- `conversation_delegations` table exists and is populated synchronously at delegation time.

**Gap assessment**
The async delegation pattern is **entirely missing**. Current delegation is synchronous and inline.

**Risk if deferred**
Worker execution time is unbounded (Codex can run for minutes). Long-running workers will cause n8n webhook timeouts. Worker failures propagate directly to the parent conversation response. Real parallel worker execution is impossible. As delegation workloads increase, the system becomes increasingly fragile.

**Recommended next move**
Depends on **3E** (decomposition) and **3F** (Redis activation). Cannot be implemented cleanly in the monolith. Sequence:
1. Complete 3E: extract `Ghost_Delegate` sub-workflow.
2. Complete 3F: activate `ghost:delegation:queue` in Redis.
3. Modify `Ghost_Delegate` to LPUSH to queue and return immediately.
4. Create `Ghost_Worker_Dispatcher` n8n workflow on 5-second cron.
5. Update `conversation_delegations` status tracking for async lifecycle.

**Dependency notes**
Hard dependency on 3E and 3F. Do not implement in the monolith.

---

### 3C-ii — Circuit Breaker for Model Routing

**Canonical requirement summary**
Implement circuit breaker in `src/runtime/circuit-breaker.ts`. State machine: closed → open → half-open. Trip: 3 failures in 5 minutes. Cooldown: 5 minutes. Half-open probe request. State stored in Redis `ghost:circuit:{provider}`. Route selection skips open circuits. All providers tripped → task blocked. Trip/recovery events logged to `tool_events` and Redis event bus.
_(REQ-3C-01 through REQ-3C-04)_

**Current repo/runtime evidence**
- No `src/runtime/` directory exists in the repo.
- No circuit breaker implementation anywhere in the codebase.
- `ROUTING.md` specifies fallback chains (premium chat → qwen3:14b, premium coding → qwen2.5-coder) but these are static policy fallbacks, not trip-detecting circuit breakers.
- The `Select Route Plan` node in the workflow selects a provider but does not query any failure state.
- Redis has no `ghost:circuit:*` keys.

**Gap assessment**
**Entirely missing.** No circuit breaker code, no Redis state keys, no integration with route selection.

**Risk if deferred**
If OpenAI or Ollama is down, the current workflow will attempt the call, wait for timeout, and return an error. With the planned multi-provider fallback chain, each timed-out provider adds latency before the next is tried. Three providers × 30-second timeout = 90-second worst-case per request. No operator visibility into provider health degradation.

**Recommended next move**
Depends on **3E-ii** (`src/runtime/` directory) and **3F** (Redis for state). Sequence:
1. Create `src/runtime/` directory (part of 3E-ii).
2. Implement `src/runtime/circuit-breaker.ts` with Redis-backed state.
3. Integrate into `src/runtime/router.ts` route selection.
4. Wire n8n Code nodes as thin callers of `circuit-breaker.ts`.

**Dependency notes**
Depends on 3E-ii for `src/runtime/` scaffold and 3F for Redis keys. Cannot be tested without Redis state.

---

### 3E — Runtime Decomposition

**Canonical requirement summary**
Decompose the 78-node monolith into 5 sub-workflows: Ghost_Ingress, Ghost_Classify, Ghost_Delegate, Ghost_Approve, Ghost_Memory. Parent workflow becomes a thin orchestrator under 20 nodes. Each sub-workflow independently testable via direct webhook with mock payloads. Create `/tests/workflows/` with test payloads.
_(REQ-3E-01 through REQ-3E-08)_

**Current repo/runtime evidence**
- Live workflow has **75 nodes** (confirmed by inspection of `ghost-chat-v3-live-post-runtime-hardening-20260313T035028Z.json`).
- `ghost-runtime-topology-map.md` documents the workflow sections: Ingress, Conversation load, History/memory, Delegation, Direct owner path, Delegated worker path, Runtime ledger, Memory write side path. The logical boundaries for the 5 sub-workflows are clearly identifiable in this map.
- No sub-workflows exist in n8n (only one workflow: `GHOST by Codex`, id `Yh6h9OJyVCfREbp3`).
- No `/tests/workflows/` directory.
- `scripts/build-ghost-chat-workflow.js` is the generator for the current monolith — it would need to be refactored for sub-workflow generation.

**Gap assessment**
**Entirely missing.** The topology documentation is useful prior art. The logical decomposition is well understood from `ghost-runtime-topology-map.md`. The implementation does not exist.

**Risk if deferred**
All of 3B-ii, 3C-ii, 3E-ii, and 3F application-layer activation are blocked or severely complicated by the monolith. Business logic cannot be extracted to testable source files while it lives in inline Code nodes of a 75-node workflow. Redis delegation queue requires a separate dispatcher workflow that assumes clean delegation interface — difficult to bolt onto the monolith.

**Recommended next move**
This is the largest single work item. Phased approach:
1. Plan sub-workflow interfaces first (input/output contracts for each of the 5).
2. Create Ghost_Memory first — it is the most self-contained side path and lowest risk.
3. Create Ghost_Classify next — clean input/output boundary.
4. Create Ghost_Ingress.
5. Create Ghost_Approve.
6. Create Ghost_Delegate last — most complex, requires 3B-ii and 3F.
7. Reduce parent to thin orchestrator.

This is a multi-lane effort. Do not attempt in a single implementation pass.

**Dependency notes**
Foundational for 3B-ii, 3C-ii (integration), and 3E-ii. 3E-ii can begin in parallel (scaffolding `src/runtime/`) but final wiring requires 3E completion.

---

### 3E-ii — Extract Business Logic to Source Files

**Canonical requirement summary**
Create `src/runtime/` TypeScript directory. Priority extractions: `config.ts` (Runtime Policy Config), `classifier.ts` (Classify Request), `router.ts` (Select Route Plan), `approval.ts` (Assess Approval Risk), `delegation.ts` (Build Delegation Request). n8n Code nodes become thin wrappers. Unit tests at `/tests/runtime/`.
_(REQ-3E-09 through REQ-3E-15)_

**Current repo/runtime evidence**
- No `src/runtime/` directory in the repo. The full repo tree shows only `app/`, `base/`, `db/`, `docs/`, `ops/`, `scripts/`, `workflows/` at the root.
- All five target logic blocks are inline JavaScript in n8n Code nodes within the workflow JSON.
- `Runtime Policy Config` node contains provider chain definitions, model choices, and fallback logic.
- `Classify Request` contains keyword-signal classification logic.
- `Select Route Plan` contains route chain logic with force_provider/force_model handling.
- `Assess Approval Risk` contains the full approval model and environment restrictions.
- `Build Delegation Request` contains worker role definitions and context building.
- These are not accessible for diffing, code review, or unit testing without extracting the JSON.

**Gap assessment**
**Entirely missing.** All business logic is locked inside n8n Code nodes.

**Risk if deferred**
1. No unit test coverage for classification or routing logic.
2. Circuit breaker (`src/runtime/circuit-breaker.ts`) and router integration impossible to implement cleanly.
3. Every business logic change requires modifying workflow JSON and re-importing/re-publishing — no standard code review path.
4. Cognitive load for future lanes is high: auditors must extract logic from JSON to understand behavior.

**Recommended next move**
Can begin immediately and in parallel with 3E planning:
1. Create `src/runtime/` directory structure.
2. Extract `classifier.ts` first (pure logic, no external dependencies).
3. Extract `config.ts` (static policy data).
4. Extract `router.ts` (depends on config + circuit breaker stub).
5. Extract `approval.ts`.
6. Extract `delegation.ts`.
7. Write unit tests for each.
8. Wire n8n Code nodes as thin callers once sub-workflows are created (3E).

**Dependency notes**
Scaffolding can start now. Final wiring into n8n requires 3E sub-workflows. Unit tests can be written and run before n8n integration. 3C-ii circuit breaker implementation belongs here.

---

### 3F — Redis Activation

**Canonical requirement summary**
Three activation targets: (1) `ghost:delegation:queue` list for async delegation dispatch. (2) `ghost:events` pub/sub channel for real-time Live Feed WebSocket. (3) `ghost:cache:capabilities` and `ghost:cache:worker_grants` with TTL 300s for capability/policy cache. Redis health check on System Health page.
_(REQ-3F-01 through REQ-3F-04)_

**Current repo/runtime evidence**
- Redis 7 container running with AOF persistence and healthcheck (`redis-cli ping`). Port 6379 exposed.
- n8n uses Redis as BullMQ execution queue (`QUEUE_BULL_REDIS_HOST: ghost-redis`, `EXECUTIONS_MODE: queue`). This is n8n's internal use only.
- System Health page references backend block status — Redis block likely in the UI but only for infra-level ping, not Ghost application keys.
- No Ghost application code writes to or reads from any `ghost:*` Redis keys.
- `ghost:delegation:queue` — **does not exist**.
- `ghost:events` — **does not exist**.
- `ghost:cache:capabilities` / `ghost:cache:worker_grants` — **do not exist**.

**Gap assessment**
Redis infrastructure is **healthy and available** but Ghost application-layer activation is **entirely missing**. The service is ready; the application layer using it is not.

**Risk if deferred**
- 3B-ii (async delegation) cannot be implemented without the delegation queue.
- Real-time Live Feed (6B) requires the event bus — without it, frontend must poll Postgres.
- Capability registry loads from Postgres on every request (no Phase 5 capability tables yet, so this is theoretical risk but becomes real in Phase 5).

**Recommended next move**
3F activation has three distinct sub-tasks that can be sequenced:
1. **Delegation queue** (depends on 3E Ghost_Delegate sub-workflow existing first).
2. **Event bus** (can begin once `src/runtime/` is scaffolded and a simple emit helper is written).
3. **Capability cache** (depends on Phase 5 capability tables — defer until Phase 5).

Redis health check on System Health page: small item, can be done now.

**Dependency notes**
Delegation queue: depends on 3E (Ghost_Delegate). Event bus: can begin with 3E-ii scaffolding. Capability cache: Phase 5 dependency.

---

### 7C-ii — Write-Ahead Pattern

**Canonical requirement summary**
Create `followthrough_intents` table: `intent_id`, `execution_id` (FK to followthrough_executions), `intended_action`, `intended_target`, `intended_payload`, `pre_state_snapshot`, `written_at`, `executed_at`, `outcome`. Before any mutation: write intent with pre-state. After success: update executed_at, outcome = 'executed'. On crash: unmatched intents (outcome = 'pending', written_at < now() - 10 min) surface for operator review.
_(REQ-7C-10 through REQ-7C-13)_

**Current repo/runtime evidence**
- No `followthrough_intents` table in any migration or init SQL.
- No `followthrough_executions` table.
- The Followthrough Executor (Phase 7C) has not been designed or implemented. v3 requires a **standalone design document** before any implementation.
- `tool_events` table logs execution events but is not a write-ahead log and does not capture pre-state snapshots.
- No crash recovery logic in any workflow or script.

**Gap assessment**
**Entirely missing.** The entire Phase 7C infrastructure does not exist. This is the critical path for MVP.

**Risk if deferred**
Without write-ahead intent capture, any worker execution that crashes mid-mutation leaves the system in an unknown state with no recovery path. This is particularly risky for code changes (partial writes), DB mutations, and artifact publishes. At MVP, this makes the governance system unreliable as an operational tool.

**Recommended next move**
7C requires a **standalone design document first** (this is explicitly stated as a prerequisite in v3). The design document must cover:
- State machine for `followthrough_executions`
- Intent capture protocol per capability type (code/db/artifact)
- Pre-state snapshot schema per capability type
- Crash recovery procedure
- Retry/unblock/cancel state transitions

**The followthrough design doc is the prerequisite.** After the design doc is approved, create `db/migrations/NNN_followthrough_intents.sql` and `NNN_followthrough_executions.sql`.

**Dependency notes**
Blocked on followthrough design document (7C). The design doc is the immediate next deliverable for this step. 7C-iii rollback depends on `pre_state_snapshot` being populated by 7C-ii, so rollback cannot be designed until intent schema is finalized.

---

### 7D-ii — Event Sourcing Layer

**Canonical requirement summary**
Create `ghost_events` table: `event_id` (uuid PK), `event_type`, `entity_type`, `entity_id`, `actor`, `actor_type` (user/worker/system/operator), `payload` (jsonb), `conversation_id`, `user_id`, `created_at`. Immutable append-only. Indexes on (entity_type, entity_id, created_at), (event_type, created_at), (conversation_id, created_at), (actor, created_at). Event emission from all state changes. Audit API: GET /api/audit/:entity_type/:entity_id.
_(REQ-7D-03 through REQ-7D-07)_

**Current repo/runtime evidence**
- `tool_events` table exists in `scripts/init-ghost-app.sql` and is used actively in the live workflow. Fields: `id`, `task_id`, `task_run_id`, `agent_id`, `tool_name`, `event_type`, `status`, `payload`, `created_at`. Indexes on `(task_id, created_at)` and `(task_run_id, created_at)`.
- `tool_events` is NOT the `ghost_events` table:
  - Not append-only by constraint (no trigger or rule preventing UPDATE/DELETE).
  - Missing `entity_type`, `entity_id` (uses `task_id` and `agent_id` only).
  - Missing `actor`, `actor_type` fields.
  - Missing `conversation_id`, `user_id`.
  - Not designed as the single audit backbone.
- `orchestration_task_events` table exists (Phase 5gf migration) for orchestration task events only — not a general event sourcing table.
- No `/api/audit/` routes exist in the Next.js app.

**Gap assessment**
`tool_events` provides partial execution tracing but does not meet the `ghost_events` specification. `ghost_events` is **missing**.

**Risk if deferred**
- Phase 8 observability and tracing build on `ghost_events`. Retrofitting event sourcing after tables have been added without event emission is painful.
- The five auditable questions (What/Why/Who/Which policy/What environment) cannot be answered programmatically from the current event log.
- `followthrough_intents` and `followthrough_executions` (7C-ii) reference `ghost_events` for rollback auditing.

**Recommended next move**
`ghost_events` can be created before Phase 7 implementation begins — it is additive, does not modify existing tables, and existing `tool_events` can coexist.
1. Create `db/migrations/NNN_ghost_events.sql` with the specified schema and indexes.
2. Add append-only constraint (trigger that raises exception on UPDATE/DELETE).
3. Begin emitting events from existing sub-workflows as they are created (3E).
4. Add Audit API routes once the table is populated.

**Dependency notes**
Can be created immediately as a migration. Event emission wiring depends on 3E (sub-workflows). Audit API routes depend on Next.js `app/ui` route additions. `ghost_events` should be created **before** Phase 7C infrastructure to serve as the audit backbone for followthrough events.

---

## C. Earliest Safe Execution Order

The following order respects real dependencies and avoids speculative parallelism where dependencies are hard:

### Tier 0 — Unblock everything (do first, no dependencies)

**Step 1: 2E — Migration runner**
Create `db/migrations/001_initial_schema.sql`, migration runner script (`scripts/migrate.sh`), Docker Compose migration service, and `docs/contracts/migration-guide.md`. This is a pure addition with zero risk to existing runtime and unlocks all future schema work.

**Step 2: 3E-ii scaffolding — `src/runtime/` directory**
Create the directory and extract `classifier.ts` and `config.ts` with unit tests. These are the simplest extractions (no external dependencies, no Redis, no n8n wiring). Classifier and config extraction can be written and tested without changing the live workflow. This scaffolds the environment for circuit breaker and router.

**Step 3: 7D-ii — ghost_events table migration**
Create the `ghost_events` migration now — before Phase 7 infrastructure. It is additive, does not break anything, and should be in place before any new tables reference it. No event emission required yet; the table can sit empty until sub-workflows are wired.

### Tier 1 — Source extraction completes (depends on Tier 0 scaffold)

**Step 4: 3E-ii completion — remaining modules**
Extract `router.ts`, `approval.ts`, `delegation.ts` with unit tests. Wire circuit breaker stub into router.

**Step 5: 3C-ii — Circuit breaker**
Implement `src/runtime/circuit-breaker.ts` with Redis state. Requires: `src/runtime/` scaffold (Tier 0), Redis available (yes — infra running), `router.ts` stub for integration (Tier 1 Step 4).

### Tier 2 — Runtime decomposition (depends on Tier 1 completion)

**Step 6: 3E — Sub-workflow creation**
Create the 5 sub-workflows in order of ascending complexity:
1. Ghost_Memory (most self-contained)
2. Ghost_Classify
3. Ghost_Ingress
4. Ghost_Approve
5. Ghost_Delegate

Reduce parent workflow from 75 nodes to under 20. This is the largest implementation effort and should be treated as its own multi-session lane.

### Tier 3 — Redis application-layer activation (depends on Tier 2)

**Step 7: 3F — Redis delegation queue + event bus**
Wire `ghost:delegation:queue` LPUSH into Ghost_Delegate sub-workflow. Create `Ghost_Worker_Dispatcher` cron workflow. Wire `ghost:events` pub/sub emit into sub-workflow state transitions. (Capability cache deferred to Phase 5.)

### Tier 4 — Async delegation complete (depends on Tier 3)

**Step 8: 3B-ii — Async delegation**
With Ghost_Delegate pushing to queue and dispatcher consuming it, async delegation is the behavioral result of Tier 3. Validate end-to-end: Ghost Main responds with task reference immediately, dispatcher executes worker, completion published to `ghost:events`.

### Tier 5 — Phase 7 design then implementation

**Step 9: 7C design document**
Write the Governed Followthrough Executor design document. This must precede any 7C implementation. The design doc covers: execution state machine, intent capture protocol, pre-state snapshot schema per capability type, retry/rollback logic, crash recovery procedure.

**Step 10: 7C-ii — followthrough_intents migration and executor**
After design doc is approved: create migrations for `followthrough_executions` and `followthrough_intents`. Implement executor logic. Wire write-ahead pattern into Phase 7 execution path.

---

## D. Followthrough Design Document — Recommendation

**Do not begin the followthrough executor design doc immediately.**

**Blockers that must close first:**
1. **3E-ii** — The executor will call business logic modules. Those modules must exist and be testable before the executor is designed to call them.
2. **3E** — The followthrough executor is a sub-workflow or a caller of sub-workflows. The sub-workflow decomposition must be at least designed (if not implemented) before the executor can specify its integration points.
3. **ghost_events** — The design doc will specify event emission from the executor. The `ghost_events` schema must be finalized before the design doc locks in event shapes.

**What can begin now without risk:**
- Migration runner (2E) — completely independent
- `src/runtime/` scaffolding with classifier and config (3E-ii partial) — independent
- `ghost_events` migration creation — independent

**When the followthrough design doc can begin:**
Once `ghost_events` table schema is finalized (Step 3 in Tier 0), `src/runtime/` is scaffolded with the five modules (Step 4 in Tier 1), and the 3E sub-workflow interfaces have been designed (even if not yet implemented). At that point, the design doc can specify: which sub-workflow the executor calls, which modules it imports, which Redis channels it publishes to, and what shape the `ghost_events` entries take.

**Conservative estimate:** Followthrough design doc is safe to begin after Tier 1 completes (Steps 1–5 above).

---

## E. Specific Verification Results

| Item | Present | Evidence |
|---|---|---|
| Real migration system with runner | **NO** | No node-pg-migrate, no runner script, no `schema_migrations` table |
| Migration #001 path (initial schema as migration) | **NO** | `scripts/init-ghost-app.sql` is not a migration |
| Startup migration execution wired into Compose/boot | **NO** | n8n boots directly; no migrate service in `base/docker-compose.yml` |
| Five-sub-workflow runtime decomposition plan or actual decomposition | **NO** | `ghost-runtime-topology-map.md` documents logical sections but no sub-workflows exist in n8n |
| Business logic extracted into `/src/runtime` modules | **NO** | No `/src/runtime/` directory anywhere in repo |
| Unit-test scaffolding for extracted runtime modules | **NO** | No `/tests/runtime/` directory |
| Redis serving as delegation queue | **NO** | No `ghost:delegation:queue` key; Redis only used for n8n BullMQ |
| Redis serving as event bus | **NO** | No `ghost:events` pub/sub channel |
| Redis serving as capability cache | **NO** | No `ghost:cache:*` keys |
| Circuit breaker implementation and state location | **NO** | Not implemented; would live in `src/runtime/circuit-breaker.ts` + Redis `ghost:circuit:{provider}` |
| `followthrough_intents` table or write-ahead substrate | **NO** | Not in any migration or init SQL |
| `ghost_events` table or append-only event layer | **NO** | `tool_events` exists but does not meet the spec |
| Existing pieces reusable rather than rebuilt | **YES (partial)** | `tool_events` can be a staging companion; `ghost-runtime-topology-map.md` is valid decomposition prior art; existing delegation SQL functions (`ghost_create_conversation_delegation`, etc.) are reusable in Ghost_Delegate sub-workflow; Redis infrastructure is running and available |

---

## F. Files Inspected (Highest Relevance)

- `base/docker-compose.yml` — runtime topology, Redis and Postgres config, n8n worker config
- `scripts/init-ghost-app.sql` — canonical initial schema (not a migration)
- `db/migrations/20260312_phase4a_ghost_memory.sql` — ghost_memory table
- `db/migrations/20260312_phase5d_runtime_ledger.sql` — runtime ledger functions (original)
- `db/migrations/20260313_phase5gc_orchestration_tasks.sql` — orchestration_tasks table
- `db/migrations/20260313_phase5gd_openclaw_alignment.sql` — conversation_delegations, worker agents, delegation helper functions
- `db/migrations/20260313_phase5gf_orchestration_controls.sql` — orchestration_task_events table
- `db/migrations/20260313_runtime_observability_hardening.sql` — updated ledger functions with n8n_execution_id correlation
- `workflows/ghost-chat-v3-live-post-runtime-hardening-20260313T035028Z.json` — 75-node live workflow (inspected node list)
- `docs/ghost-runtime-topology-map.md` — workflow section boundaries
- `docs/ghost-phase3-handoff.md` — Phase 3 baseline, response contracts, known limitations
- `app/identity/ROUTING.md` — provider fallback policy
- `ops/build-tracker/project-tracker.json` — tracker state
- `docs/Ghost_Roadmap_v3.docx` — canonical roadmap (full extraction)
- `docs/Ghost_Phase_Requirements_v3.docx` — canonical requirements (full extraction)

---

## G. Architecture Reconciliation Verdict by Step

| Step | Verdict | Primary Gap |
|---|---|---|
| **2E Schema Migration Strategy** | **Missing runner** | Init SQL is not a migration; no runner; no compose boot wiring |
| **3B-ii Async Delegation** | **Missing** | Delegation is synchronous inline; no Redis queue; no dispatcher |
| **3C-ii Circuit Breaker** | **Missing** | No implementation, no Redis state, no route integration |
| **3E Runtime Decomposition** | **Missing** | 75-node monolith; no sub-workflows exist |
| **3E-ii Business Logic Extraction** | **Missing** | No `src/runtime/`, no modules, no tests |
| **3F Redis Activation** | **Infrastructure only** | Redis running but zero Ghost application-layer keys |
| **7C-ii Write-Ahead Pattern** | **Missing** | No `followthrough_intents`, no `followthrough_executions` |
| **7D-ii Event Sourcing Layer** | **Predecessor exists** | `tool_events` partial; `ghost_events` not created |

---

## H. Recommended Execution Order (Summary)

```
[Tier 0 — No dependencies, start immediately]
  1. 2E  — Migration runner + 001_initial_schema + docs/contracts/migration-guide.md
  2. 3E-ii partial — src/runtime/ scaffold + classifier.ts + config.ts + tests
  3. 7D-ii — ghost_events migration (additive, no breaking changes)

[Tier 1 — Depends on Tier 0 scaffold]
  4. 3E-ii completion — router.ts + approval.ts + delegation.ts + tests
  5. 3C-ii — circuit-breaker.ts + Redis state + router integration

[Tier 2 — Depends on Tier 1, largest work unit]
  6. 3E — Five sub-workflows (Memory → Classify → Ingress → Approve → Delegate)
            Parent reduced to thin orchestrator

[Tier 3 — Depends on Tier 2]
  7. 3F — ghost:delegation:queue + ghost:events activation
            Ghost_Worker_Dispatcher workflow

[Tier 4 — Behavioral result of Tier 3]
  8. 3B-ii — Validated async delegation end-to-end

[Tier 5 — Design then implement]
  9. 7C design document (prerequisite: Tier 1 complete + ghost_events schema finalized)
  10. 7C-ii — followthrough_intents migration + executor implementation
```

---

## I. Tracker Recommendation at Finish

Tracker updates recommended after this audit completes:

1. **Claude position** — update summary to reflect audit complete, phase/step anchor can remain `p2e-schema-migration-strategy` as the first implementation lane.
2. **p2e-schema-migration-strategy** — status remains `active`. Add worker: Claude with task "Audit complete — migration runner implementation lane ready to begin."
3. **p3e-runtime-decomposition** — remains `active`. Add note: "5-sub-workflow decomposition is the largest single work unit; must precede 3B-ii and 3F application activation."
4. **p3f-redis-activation** — remains `active`. Add note: "Redis infrastructure confirmed healthy; application-layer activation blocked on 3E decomposition."
5. **Phase 7 steps** — `p7c-ii` and `p7d-ii` (if tracked) should reflect: `ghost_events` migration can begin immediately (Tier 0); `followthrough_intents` blocked on design doc.

---

*This document is the durable handoff artifact for the claude-arch-closure-audit lane. It should be updated or superseded as implementation lanes close the gaps identified above.*
