# TASK-009 — Backend Canon Reconciliation Against v3.0

*Date: 2026-03-15*
*Branch: `task-009-v3-backend-canon-reconciliation`*
*Auditor: Claude (external implementation worker)*
*Canonical sources: `docs/Ghost_Claude_Workplan_v3_2_Merged.docx`, `docs/Ghost_Roadmap_v3_1_Merged.docx`, `docs/reviews/v3-architecture-closure-audit.md`*

---

## Executive Summary

The Ghost repo has made material progress since the v3 architecture closure audit (2026-03-15 early session). Several previously-MISSING items are now COMPLETE on main or COMPLETE on ready-to-merge branches. The core runtime extraction work (3E-ii), migration infrastructure (2E), and the memory pipeline (Phase 4F) are all done. However, significant Tier 2 work remains absent: no sub-workflow decomposition exists, Redis has no Ghost application-layer activation, the ghost_events audit backbone is on a branch with a migration number conflict, and the write-ahead/followthrough infrastructure does not meet the v3 spec.

**The most important finding from this reconciliation is architectural**: n8n's Execute Sub-Workflow mechanism is not proven reliable enough to serve as the canonical Ghost extraction pattern. The Ghost_Memory failure (TASK-008) is the only data point but it is an unresolved failure with no root cause confirmed. The inline + TypeScript module boundary pattern is working today and is architecturally better suited for workflows that must access parent execution context. This changes the expected implementation shape for all Tier 2 sub-workflows.

**Three most load-bearing gaps:**
1. **Circuit breaker not on main** — TASK-006 is green on its branch but unmerged. router.ts on main has no circuit integration. All routing operates without trip-detection.
2. **ghost_events migration not on main** — TASK-005 (7D-ii branch) exists but has a migration number conflict (`008_ghost_events` vs `008_phase4f_memories`). Must be renumbered to `009` before merge.
3. **No Tier 2 sub-workflow implementation** — Ghost_Classify, Ghost_Route, Ghost_Approve, Ghost_Delegate are entirely absent. Interface contracts exist on a branch (TASK-007) but no n8n workflows, no implementations.

**Recommended next task: TASK-010 — Merge pending branches + unblock Tier 2**
Before implementing any sub-workflow, three unmerged branches (TASK-006, TASK-007, and 7D-ii) must be merged with conflict resolution. Then the first sub-workflow implementation can begin. The recommended first sub-workflow is `Ghost_Classify` (lowest risk, clean boundary, TypeScript module already extracted).

---

## Reconciliation Matrix

### Phase 2

---

#### 2E — Schema Migration Strategy

**Canonical requirement**: Versioned migration runner (`scripts/migrate.sh`), numbered files `001–NNN`, `schema_migrations` tracking table, `ghost-migrate` Docker Compose service, `docs/contracts/migration-guide.md`. Auto-execute before n8n boot.

**Status: COMPLETE**

**Evidence**:
- `scripts/migrate.sh` — full bash runner with `schema_migrations` tracking, skip-if-applied logic, `ON_ERROR_STOP=1`
- `db/migrations/001_initial_schema.sql` — schema snapshot (idempotent)
- `db/migrations/001–008` — 8 sequential numbered up/down migration pairs
- `base/docker-compose.yml:54-72` — `ghost-migrate` service using `postgres:16` image, mounts migrations + runner, `restart: "no"`
- `base/docker-compose.yml:86,151` — `ghost-n8n-main` and `ghost-n8n-worker` both declare `ghost-migrate: condition: service_completed_successfully`
- `docs/contracts/migration-guide.md` — full guide including add/rollback procedure, schema state reference, table inventory

**Notes**: No drift. All 5 v3 requirements met. Migration #001 is idempotent and captures the full current schema. `schema_migrations` table is created automatically on first runner execution.

**Recommended next action**: None. COMPLETE. Future schema additions must follow the migration guide.

---

### Phase 3

---

#### 3E-ii — Extract Business Logic to Source Files

**Canonical requirement**: `src/runtime/` TypeScript directory with modules: `classifier.ts`, `config.ts`, `router.ts`, `approval.ts`, `delegation.ts`, `circuit-breaker.ts`. Unit tests in `tests/runtime/`. n8n Code nodes become thin wrappers calling these modules.

**Status: PARTIAL** — all modules except `circuit-breaker.ts` are on main; module wiring into Code nodes is complete on main; circuit breaker is MISSING from main.

**Evidence (on main)**:
- `src/runtime/classifier.ts` — `classifyRequest`, signals exports
- `src/runtime/config.ts` — `getProviderPolicies`, `getOllamaModels`, `getOpenAIConfig`, `getCodexConfig`
- `src/runtime/router.ts` — `selectRoute` (no circuit breaker integration on main)
- `src/runtime/approval.ts` — `APPROVAL_CONFIG`, `detectRiskLevel`, `assessApprovalRisk`
- `src/runtime/delegation.ts` — `buildDelegationRequest`, `resolveWorkerByIntent`, etc.
- `src/runtime/memory.ts` — `extractMemories`, `consolidateMemories`, `storeMemories`, `shouldExtractMemory`, `buildExtractionPrompt`
- `src/runtime/index.ts` — re-exports all public APIs
- `tests/runtime/` — 6 test files, 203/203 passing
- Live workflow `ghost-runtime-phase4f-finalized-20260315T131000Z.json` — 7 Code nodes confirmed calling `require('/opt/ghost/src/runtime/...')`: `Classify request`, `Select Route Plan`, `Assess Approval Risk`, `Runtime Policy Config`, `Filter Structured Memory Candidates`, `Build Delegation Request`, `Build Delegation Context`

**Missing from main**:
- `src/runtime/circuit-breaker.ts` — on `phase3/3C-circuit-breaker` (TASK-006), not merged
- `router.ts` on main: no `circuit_states` parameter, no circuit-aware filtering

**Notes**: The v3 architecture closure audit (dated early 2026-03-15) listed all `src/runtime/` as MISSING. This is stale — the scaffold was TASK-003, extraction was TASK-004/TASK-005, all merged. The circuit breaker (TASK-006) is the remaining 3E-ii gap.

**Recommended next action**: Merge `phase3/3C-circuit-breaker` to main. Verify router.ts integration (circuit_states param).

---

#### 3C-ii — Circuit Breaker for Model Routing

**Canonical requirement**: `src/runtime/circuit-breaker.ts` with Redis-backed state (`ghost:circuit:{provider}`). State machine: closed → open → half_open. Trip threshold 3 failures, cooldown 300s, half-open probe. Router integration: open circuits are skipped. All-tripped → task blocked.

**Status: PARTIAL** — fully implemented on `phase3/3C-circuit-breaker` branch (TASK-006), CI green, 32 new tests. NOT merged to main.

**Evidence (on branch `phase3/3C-circuit-breaker`)**:
- `src/runtime/circuit-breaker.ts` — Redis key prefix `ghost:circuit:`, state machine, `fetchCircuitStates()`, `recordFailure()`, `recordSuccess()`, `FailureCategory` enum
- `tests/runtime/circuit-breaker.test.ts` — 32 tests covering state transitions, cooldown, half-open probe, failure categorization
- `src/runtime/router.ts` (on branch) — imports `CircuitState`, `fetchCircuitStates`; `circuit_states` param added to `SelectRouteOverrides`; open-circuit providers filtered from chain; `circuit_blocked: true` on all-open
- CI run 23103695613: success
- Commit: `94770d2` (code), `3070dbf` (state update)

**Missing from main**:
- `circuit-breaker.ts` not on main
- `router.ts` on main does not have `circuit_states` parameter or circuit-aware filtering
- No Redis `ghost:circuit:*` key emission in live workflow Code nodes (requires wiring step after merge)

**Notes**: Implementation is complete and tested. The only gap is it is not merged. The Redis client uses Node.js `net` module (no npm dependency). Injectable client pattern enables in-memory mocking for tests.

**Recommended next action**: Merge `phase3/3C-circuit-breaker` branch. Then add circuit state fetch to the live `Select Route Plan` Code node (next wiring task).

---

#### 3E — Runtime Decomposition into Sub-Workflows

**Canonical requirement**: Decompose monolith into 5 sub-workflows: Ghost_Ingress, Ghost_Classify, Ghost_Route, Ghost_Approve, Ghost_Delegate. Parent workflow < 20 nodes. Each sub-workflow independently testable via direct webhook.

**Status: MISSING** — no sub-workflows implemented. Parent workflow is 79 nodes (39 above target).

**Evidence**:
- `workflows/ghost-runtime-phase4f-finalized-20260315T131000Z.json` — 79 nodes, 0 Execute Sub-Workflow nodes
- No workflow exports named Ghost_Classify, Ghost_Route, Ghost_Approve, Ghost_Delegate
- `docs/sub-workflow-interfaces.md` — on branch `phase3/3E-subworkflow-interfaces` (TASK-007), NOT merged; contains full interface contracts (1136 lines) for all 5 sub-workflows

**Interface contracts (on branch, TASK-007)**:
- Ghost_Classify: Input `{conversation_id, message_window, task_summary?}` → Output `{conversation_id, request_type, classified_at, message_window}`
- Ghost_Route: Input `{request_type, provider_policies, circuit_states?}` → Output `{route_chain, selected_provider, model, circuit_blocked}`
- Ghost_Approve: Input `{request_type, route_chain, message_window}` → Output `{approval_required, risk_level, risk_reasons}`
- Ghost_Delegate: Input `{conversation_id, task_class, worker_intent, context}` → Output `{delegation_id, orchestration_task_id, worker_conversation_id}`
- Ghost_Memory: Already inline (accepted decision); sub-workflow interface exists as reference

**Notes**: This is the largest remaining implementation gap. The interface contracts exist (TASK-007) but must be merged first. Implementation shape is affected by the n8n Execute Sub-Workflow reliability concern — see dedicated section below.

**Recommended next action**: (1) Merge `phase3/3E-subworkflow-interfaces`. (2) Implement Ghost_Classify first (lowest risk). (3) Do NOT use n8n Execute Sub-Workflow — see recommendation section.

---

#### 3E-ii — Sub-Workflow Interfaces Documentation

**Canonical requirement**: Input/output contracts for all 5 sub-workflows, independently testable via webhook mock payloads.

**Status: PARTIAL** — contracts documented (TASK-007) on `phase3/3E-subworkflow-interfaces` branch. NOT merged. No test payloads in `tests/workflows/`.

**Evidence (on branch)**:
- `docs/sub-workflow-interfaces.md` — full TypeScript interface contracts, MCP compatibility notes, A2A Agent Cards, security boundaries for all 5 sub-workflows
- No `tests/workflows/` directory on any branch

**Recommended next action**: Merge branch. Create `tests/workflows/` with mock webhook payloads as part of first sub-workflow implementation task.

---

#### 3B-ii — Asynchronous Delegation via Message Bus

**Canonical requirement**: Ghost Main publishes to `ghost:delegation:queue` Redis list, responds immediately with task reference. Separate `Ghost_Worker_Dispatcher` cron workflow (5s interval) consumes queue and executes delegation. Worker completion publishes to `ghost:events`.

**Status: MISSING** — delegation is synchronous and inline. Redis delegation queue does not exist.

**Evidence**:
- Live workflow delegation nodes: `Build Delegation Request` → `Create Conversation Delegation` → `Execute Delegated Codex Command` → `Complete Delegated Runtime` (21 delegation-related nodes, all inline, synchronous)
- No `Ghost_Worker_Dispatcher` workflow
- No `ghost:delegation:queue` Redis key
- No immediate-return-with-task-reference response pattern

**Notes**: This is correctly deferred — it depends on 3F (Redis activation) and 3E (Ghost_Delegate sub-workflow). Cannot implement cleanly in a monolith.

**Recommended next action**: No action yet. Implement after 3E Ghost_Delegate sub-workflow and 3F Redis delegation queue are both in place.

---

#### 3F — Redis Application-Layer Activation

**Canonical requirement**: Three activation targets: (1) `ghost:delegation:queue` list for async dispatch, (2) `ghost:events` pub/sub for real-time Live Feed, (3) `ghost:cache:capabilities` / `ghost:cache:worker_grants` with TTL 300s.

**Status: MISSING** — Redis infrastructure healthy, no Ghost application-layer keys.

**Evidence**:
- `base/docker-compose.yml` — Redis 7 running with AOF persistence, healthcheck
- `QUEUE_BULL_REDIS_HOST: ghost-redis` — n8n internal BullMQ usage only
- No `ghost:*` key references in `src/runtime/`, `scripts/`, `app/`, or workflow Code nodes (main)
- `circuit-breaker.ts` on branch uses `ghost:circuit:{provider}` — this is one Ghost app-layer key (to merge)

**Notes**: Redis is available and healthy. Ghost application-layer activation is a clean next step after 3E sub-workflow decomposition (delegation queue needs Ghost_Delegate; event bus needs sub-workflow state transitions to emit to).

**Recommended next action**: After 3E Ghost_Delegate and 3C-ii circuit breaker are in place: (1) wire `ghost:delegation:queue` LPUSH, (2) wire `ghost:events` PUBLISH from sub-workflow state transitions. Capability cache deferred to Phase 5.

---

### Phase 7

---

#### 7D-ii — Event Sourcing Layer (`ghost_events` Table)

**Canonical requirement**: `ghost_events` table — append-only, immutable. Columns: `event_id`, `event_type`, `entity_type`, `entity_id`, `actor`, `actor_type`, `payload`, `conversation_id`, `user_id`, `created_at`. Append-only trigger blocking UPDATE/DELETE. 4 indexes. Audit API `/api/audit/:entity_type/:entity_id`.

**Status: PARTIAL** — migration written (TASK-005 on branch), NOT merged. Migration number conflicts with main. No Audit API.

**Evidence**:
- `phase7/7D-ghost-events-table` branch — commit `ac8ebf6`: `db/migrations/008_ghost_events.sql` with full schema, append-only trigger, 4 indexes
- **Migration number conflict**: branch uses `008_ghost_events.sql` but main already has `008_phase4f_memories.sql` from TASK-008. Must be renumbered to `009_ghost_events.sql` before merge.
- `tool_events` table on main: lacks `entity_type`, `entity_id`, `actor`, `actor_type`, `conversation_id`, `user_id` — does NOT meet spec
- No `/api/audit/` routes in `app/ui/app/api/`

**Notes**: Migration content is correct. The only merge blocker is the numbering conflict. Renumber to 009 + create `009_ghost_events_down.sql` = merge-ready. This should be merged before any Phase 7C implementation since followthrough tables will reference ghost_events.

**Recommended next action**: Renumber `008_ghost_events.sql` → `009_ghost_events.sql` on branch (or as part of next merge task). Merge to main. Audit API can follow later — table should exist first.

---

#### 7C-ii — Write-Ahead Intent Pattern (`followthrough_intents`)

**Canonical requirement**: `followthrough_intents` table with `intent_id`, `execution_id`, `intended_action`, `intended_target`, `intended_payload`, `pre_state_snapshot`, `written_at`, `executed_at`, `outcome`. Write intent before mutation, update after success/failure. Unmatched intents (pending > 10 min) surface for operator review.

**Status: MISSING** — no `followthrough_intents` table. `ghost_governed_followthrough` in migration 001 is a pre-v3 predecessor but does not meet spec.

**Evidence**:
- `db/migrations/001_initial_schema.sql` — `ghost_governed_followthrough` table has `outcome_status`, `executed_at`, `execution_state` fields but lacks `pre_state_snapshot`, `intent_id`, `intended_action`, `intended_target`, `intended_payload`
- No `followthrough_intents` migration on any branch
- No `followthrough_executions` migration on any branch
- `docs/reviews/v3-architecture-closure-audit.md` — explicitly calls this MISSING and requires standalone design document as prerequisite

**Notes**: The pre-v3 `ghost_governed_followthrough` table captures some intent state but was designed for a different purpose (approval queue followthrough, not write-ahead audit). It cannot serve as the 7C-ii foundation without redesign. The v3 spec requires a design document before implementation.

**Recommended next action**: Write a Governed Followthrough Executor design document covering: execution state machine, intent capture protocol per capability type, pre-state snapshot schema, crash recovery, retry/rollback transitions. Implementation follows design approval.

---

#### 7C-iii — Rollback / Undo Capability

**Canonical requirement**: Rollback capability across code/DB/artifact layers. Requires `followthrough_executions` + `followthrough_intents` + `ghost_events` as foundation.

**Status: MISSING** — no rollback implementation. Foundation tables not yet on main.

**Evidence**: No rollback scripts, no undo API routes, no `followthrough_executions` table.

**Recommended next action**: Blocked on 7C-ii. Address after followthrough design doc and `ghost_events` are in place.

---

#### 7H — Notification Integration

**Canonical requirement**: Notification system delivering UI notifications + at least one push channel (SMS/email/push). Notification center surface. Runtime state changes → notifications.

**Status: MISSING** — no notification system, no push channels.

**Evidence**: No notification tables in migrations. No notification API routes. No push channel configuration.

**Recommended next action**: Post-7C. Defer until Phase 7C and event sourcing are in place (notification triggers need ghost_events).

---

#### 7I — Multi-User Schema Preparation

**Canonical requirement**: Multi-user schema columns present (schema-prepared) without full activation. `user_id` FK columns on relevant tables.

**Status: PARTIAL** — `user_id UUID NULL` is present on `memories` table (migration 008, no FK enforced). Core tables (`conversations`, `messages`) reference `users.id` but single-user assumption is baked into workflow logic.

**Evidence**:
- `db/migrations/008_phase4f_memories.sql` — `user_id UUID NULL` with comment: "Future: REFERENCES users(id) ON DELETE SET NULL"
- `db/migrations/005_phase5gd_openclaw_alignment.sql` — `conversations.owner_user_id`, `conversations.owner_agent_id`
- No multi-user activation, no tenant isolation, no household profile boundaries

**Recommended next action**: No action yet. Schema columns are present on memories table. Enforce FK and add `user_id` to other tables when Phase 9G multi-user activation is scheduled.

---

## Branch Merge Status — Unblocking Map

| Branch | Task | Content | Merge Blocker | Action Required |
|--------|------|---------|---------------|-----------------|
| `phase3/3C-circuit-breaker` | TASK-006 | `circuit-breaker.ts`, router.ts integration, 32 tests | None — CI green | Merge to main |
| `phase3/3E-subworkflow-interfaces` | TASK-007 | `docs/sub-workflow-interfaces.md`, overnight report | Contains TASK-006 commits (stack merge needed) | Merge after TASK-006 merged |
| `phase7/7D-ghost-events-table` | — | `008_ghost_events.sql` migration | Migration number conflict (008 taken by memories) | Renumber to `009_ghost_events.sql`, update down file, then merge |

---

## Sub-Workflow vs Inline Runtime Recommendation

### Finding

The n8n `Execute Sub-Workflow` (executeWorkflow node) is **not proven reliable enough** to serve as the canonical Ghost extraction pattern.

**Evidence**:
- TASK-008 attempted to use `Execute Ghost_Memory Sub-Workflow` in Ghost Runtime. The node failed with `"Workflow does not exist"` from n8n's `WorkflowRepository.get` despite: (1) workflow entity row present in DB, (2) `activeVersionId` set, (3) `workflow_published_version` entry inserted, (4) manual SQL LEFT JOIN returning the row, (5) worker restarted.
- Root cause was never resolved. The failure mode is opaque (in-memory resolution behavior unclear without n8n source debug access).
- The inline approach was chosen as the accepted architecture — not because the sub-workflow approach was merely inconvenient, but because the inline approach is architecturally correct: `Build Memory Extraction Input` references parent workflow nodes (`$('Build API Response')`, `$('Normalize Input')`) that are only accessible inline.
- Zero other `executeWorkflow` nodes exist in the live Ghost Runtime. No positive evidence of this n8n feature working reliably in this deployment.

### Recommendation

**Ghost should adopt Inline Runtime + TypeScript Module Boundaries as the canonical architecture.**

Sub-workflow interface documents (`docs/sub-workflow-interfaces.md`) should serve as **logical contracts** — they define the interface shape and testability boundaries, not active n8n execution boundaries.

**What this means concretely**:

1. **Logical boundary, not execution boundary**: Each "sub-workflow" (Ghost_Classify, Ghost_Route, Ghost_Approve, Ghost_Delegate) should be a dedicated section of inline nodes within the parent workflow, with a clearly-named first and last node serving as the logical entry/exit point.

2. **TypeScript module as the real test boundary**: Business logic lives in `src/runtime/`. Code nodes are thin wrappers: `const { fn } = require('/opt/ghost/src/runtime/module.ts'); return [{ json: fn(input) }]`. Tests at `tests/runtime/` are the unit test layer. The n8n Code node is just a runner.

3. **Reference sub-workflows as documentation artifacts**: Ghost_Memory sub-workflow is the model. Keep it published. It documents the pipeline shape and serves as the canonical reference. It is not the execution path.

### Implications for each planned sub-workflow

**Ghost_Classify**:
- Implementation: inline Code node section in Ghost Runtime, calling `classifyRequest()` from `classifier.ts`
- Logical boundary entry: `Runtime Policy Config` → `Classify Request` section (currently 2 nodes, can stay as-is)
- Wiring already done (TASK-005). This sub-workflow is functionally complete as an inline section.
- Action: Document logical boundary. No new n8n nodes needed.

**Ghost_Route**:
- Implementation: inline Code node section calling `selectRoute()` from `router.ts` + `fetchCircuitStates()` from `circuit-breaker.ts`
- Current gap: `router.ts` on main lacks circuit integration (blocked on TASK-006 merge)
- Action: Merge TASK-006, wire `fetchCircuitStates()` call into `Select Route Plan` Code node.

**Ghost_Approve**:
- Implementation: inline Code node section calling `assessApprovalRisk()` from `approval.ts`
- Already wired (TASK-005). Functionally complete as inline section.
- Action: Document logical boundary only.

**Ghost_Delegate**:
- Implementation: inline delegation section (21 nodes currently). These nodes are too complex to reduce to a single Code node call — they include Postgres nodes, conditional branching, Codex execution.
- Async delegation (3B-ii) will eventually restructure this section (Redis queue + dispatcher pattern).
- Action: Keep inline. After 3F Redis activation, replace `Execute Delegated Codex Command` path with `LPUSH ghost:delegation:queue` + return-with-task-reference.

### Does the v3.0 canon need reinterpretation?

**Yes — one clarification is needed.**

The v3 canon (workplan §E) describes 5 sub-workflows as n8n workflow entities connected via Execute Sub-Workflow nodes. Based on runtime evidence, this approach is unreliable in the current n8n 2.11.3 deployment. The canonical architecture should be reinterpreted as:

> *A Ghost sub-workflow is a named logical boundary within the parent runtime, backed by a TypeScript module in `src/runtime/`. The sub-workflow interface document defines the contract. The n8n Code node is the runner. The TypeScript test is the unit test.*

This reinterpretation preserves the decomposition goals (testability, independence, logical separation) while removing the dependency on a broken n8n mechanism.

**No follow-up tasking is needed specifically for this clarification.** The inline approach is already accepted (Architecture Decision 1 in CURRENT_STATE.md). This reconciliation formalizes it as the canonical pattern for all Tier 2 sub-workflows.

---

## Implementation Readiness Matrix

| Area | Main Branch State | Ready to Implement? | Blocker |
|------|------------------|--------------------|---------|
| Migration system (2E) | COMPLETE | — | — |
| src/runtime extraction (3E-ii) | COMPLETE (minus circuit-breaker) | PARTIAL | Merge TASK-006 |
| Circuit breaker (3C-ii) | On branch, unmerged | After merge | Merge `phase3/3C-circuit-breaker` |
| Sub-workflow interfaces (TASK-007) | On branch, unmerged | After merge | Merge `phase3/3E-subworkflow-interfaces` |
| ghost_events migration (7D-ii) | On branch, number conflict | After renumber+merge | Renumber to 009 |
| Ghost_Classify implementation | Functionally inline already | Yes after branch merges | Interface doc merge |
| Ghost_Route implementation | Missing circuit integration | After TASK-006 merge + wiring | Circuit breaker merge |
| Ghost_Approve implementation | Functionally inline already | Yes after branch merges | Interface doc merge |
| Ghost_Delegate implementation | Inline, sync, 21 nodes | Deferred | Needs 3F Redis first |
| Redis app-layer (3F) | MISSING | Not yet | Needs Ghost_Delegate + circuit-breaker |
| Async delegation (3B-ii) | MISSING | Not yet | Needs 3F Redis |
| followthrough_intents (7C-ii) | MISSING | Not yet | Needs design doc |
| ghost_governed_followthrough | Pre-v3 predecessor present | Not v3-spec | Redesign required |
| Rollback (7C-iii) | MISSING | Not yet | Needs 7C-ii |
| Notification system (7H) | MISSING | Not yet | Needs 7D-ii + ghost_events |
| Multi-user prep (7I) | PARTIAL (memories only) | Low priority | Phase 9 concern |

---

## Three Most Load-Bearing Gaps

### Gap 1 — Circuit Breaker Not on Main (3C-ii)

TASK-006 is green on `phase3/3C-circuit-breaker` (commit `94770d2`, CI 23103695613). The circuit breaker TypeScript module is complete, Redis-backed, with 32 tests. But it is not merged to main. All current routing operates without failure trip-detection. A provider outage causes cascading timeouts instead of fast-fail with failover.

**Unblocking action**: Merge `phase3/3C-circuit-breaker`. Wire `fetchCircuitStates()` into the live `Select Route Plan` Code node.

### Gap 2 — ghost_events Migration Number Conflict (7D-ii)

The `ghost_events` append-only event sourcing table is designed and migration SQL is correct (on `phase7/7D-ghost-events-table`, commit `ac8ebf6`). But `008_ghost_events.sql` conflicts with `008_phase4f_memories.sql` already on main. Until renumbered to `009`, it cannot be merged. `followthrough_intents` (7C-ii) and notification triggers (7H) should reference `ghost_events`. The longer this merge is deferred, the more Phase 7 work lands without an event backbone.

**Unblocking action**: Rename `008_ghost_events.sql` → `009_ghost_events.sql` + matching down file. Merge.

### Gap 3 — No Tier 2 Sub-Workflow Implementation

Ghost_Classify, Ghost_Route, Ghost_Approve, Ghost_Delegate have interface contracts (TASK-007 on branch) but zero implementation. The Ghost Runtime is a 79-node monolith with no extraction boundaries yet formalized in n8n. The sub-workflow interface doc is not merged. The circuit breaker (required for Ghost_Route) is not merged.

**Unblocking action**: Merge TASK-006, TASK-007 branches + renumber/merge 7D-ii. Then implement Ghost_Classify as the first sub-workflow (it is functionally wired already; the task is to formalize the logical boundary and create test payloads).

---

## Single Recommended Next Implementation Task

**TASK-010 — Merge unmerged branches and implement Ghost_Classify logical boundary**

Scope:
1. Merge `phase3/3C-circuit-breaker` to main
2. Merge `phase3/3E-subworkflow-interfaces` to main
3. Renumber `008_ghost_events.sql` → `009_ghost_events.sql` on `phase7/7D-ghost-events-table`, create `009_ghost_events_down.sql`, merge to main
4. Wire `fetchCircuitStates()` into the live `Select Route Plan` Code node (thin wrapper update only)
5. Create `tests/workflows/ghost-classify/` with mock webhook payload and expected output for direct testability validation
6. Document Ghost_Classify as the first formally-closed logical boundary in Ghost Runtime

This is not a large task — steps 1-3 are merges, step 4 is a one-line Code node update, steps 5-6 are docs/tests. The result is: all three unmerged branches on main, circuit-aware routing active, ghost_events migration in place, and Ghost_Classify formalized as the first Tier 2 logical boundary.

---

## Repo Cleanliness Notes

- This task only creates/modifies `docs/status/TASK-009_BACKEND_CANON_RECONCILIATION.md` and `docs/status/CURRENT_STATE.md`.
- No runtime, workflow, schema, or code files were modified.
- `ops/build-tracker/project-tracker.json` tracker start/end entries only.
