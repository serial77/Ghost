# Ghost Stack — Current State
*Generated: 2026-03-15 | Last completed task: TASK-009*

## Last Completed Task

**TASK-009 — Backend Canon Reconciliation Against v3.0**

- Branch: `task-009-v3-backend-canon-reconciliation`
- Status: Complete
- Type: inspection / reconciliation / docs-only
- Deliverables:
  - `docs/status/TASK-009_BACKEND_CANON_RECONCILIATION.md` — full reconciliation matrix, branch merge status, sub-workflow recommendation
  - `docs/status/CURRENT_STATE.md` — this file

**Previous completed task: TASK-008 — Phase 4F: Ghost_Memory Structured Pipeline**
- Branch: `phase4/4F-ghost-memory-subworkflow` (merged to main)
- Deliverables: `src/runtime/memory.ts`, `db/migrations/008_phase4f_memories.sql`, 203/203 tests, inline memory pipeline in Ghost Runtime

## Next Task

**TASK-010 — Merge Unmerged Branches and Implement Ghost_Classify Logical Boundary**
- Scope: Merge TASK-006 (circuit breaker), TASK-007 (sub-workflow interfaces), renumber/merge 7D-ii (ghost_events 009); wire circuit breaker into Select Route Plan Code node; create Ghost_Classify test payloads; formalize Ghost_Classify as first Tier 2 logical boundary
- Prerequisites: TASK-009 complete ✓
- Branch: to be created from main

## Architecture Snapshot (as of 2026-03-15)

### Live Infrastructure
| Service | Version | Status |
|---------|---------|--------|
| n8n | 2.11.3 | Active |
| Postgres | 16 | Active |
| Redis | 7 | Active |
| Ghost Runtime | 79 nodes | Active — inline pipeline accepted |
| Ghost_Memory | 11 nodes | Published (reference artifact only) |

### Database State
| Table | Rows | Notes |
|-------|------|-------|
| `ghost_memory` | 57+ | Legacy memory table (Phase 4A), preserved |
| `memories` | 1+ | Phase 4F pipeline table, migration 008 applied |
| `conversations` | — | Active |
| `messages` | — | Active |
| `ghost_events` | — | Migration written (009 after renumber), NOT yet applied to live |

### Migration State
Migrations applied to live `ghost_app` database:
- 001–008 applied (008 = `008_phase4f_memories.sql`, 2026-03-15)
- 009 (`009_ghost_events.sql`) — pending renumber + merge from `phase7/7D-ghost-events-table` branch

### src/runtime Modules (on main)
| Module | Public API | Tests |
|--------|-----------|-------|
| `classifier.ts` | `classifyRequest` | ✓ |
| `config.ts` | `getProviderPolicies`, `getOllamaModels`, `getOpenAIConfig`, `getCodexConfig` | ✓ |
| `router.ts` | `selectRoute` (no circuit integration on main yet) | ✓ |
| `approval.ts` | `APPROVAL_CONFIG`, `detectRiskLevel`, `assessApprovalRisk` | ✓ |
| `memory.ts` | `extractMemories`, `consolidateMemories`, `storeMemories`, `shouldExtractMemory`, `buildExtractionPrompt` | ✓ 203 tests |
| `delegation.ts` | `buildDelegationRequest`, `resolveWorkerByIntent`, etc. | ✓ |
| `circuit-breaker.ts` | `fetchCircuitStates`, `recordFailure`, `recordSuccess` | On branch — not merged |

### Unmerged Branches (ready or near-ready for main)
| Branch | Task | Content | Blocker |
|--------|------|---------|---------|
| `phase3/3C-circuit-breaker` | TASK-006 | `circuit-breaker.ts` + router integration, 32 tests, CI green | None — merge ready |
| `phase3/3E-subworkflow-interfaces` | TASK-007 | `docs/sub-workflow-interfaces.md` (1136 lines, all 5 sub-workflows) | Merge after TASK-006 |
| `phase7/7D-ghost-events-table` | — | `ghost_events` append-only migration | Number conflict: rename 008 → 009 |

## Architecture Decisions

1. **Inline memory pipeline is the accepted active path**: Ghost Runtime uses the inline 10-node memory pipeline (nodes 70–79). The `Build Memory Extraction Input` node references parent workflow nodes (`$('Build API Response')`, `$('Normalize Input')`) which are only accessible inline.

2. **Ghost_Memory sub-workflow is a reference artifact**: Published (ID: `u7omvbq1Lkn7We5F`) and preserved as a reference. NOT the active execution path. The `Execute Ghost_Memory Sub-Workflow` node was removed from Ghost Runtime.

3. **Canonical architecture is Inline Runtime + TypeScript Module Boundaries**: n8n `Execute Sub-Workflow` is not proven reliable in this deployment (see TASK-009 reconciliation). Sub-workflow interface documents define logical contracts. TypeScript modules in `src/runtime/` are the testable business logic layer. n8n Code nodes are thin wrappers.

4. **Ghost_Classify, Ghost_Approve are functionally inline already**: Both sub-workflows are wired (TASK-005) — Code nodes call `classifyRequest()` and `assessApprovalRisk()` from src/runtime. Their logical boundaries need formal documentation, not new nodes.

5. **Store to Memories (pipeline)**: 79th node in Ghost Runtime, dual-write confirmed (`ghost_memory` + `memories`).

6. **RETURNING clause fix**: `inserted` CTE's RETURNING clause had missing `conversation_id`, fixed in both Ghost Runtime and Ghost_Memory sub-workflow.

## Known Issues / Follow-up

- **n8n Execute Sub-Workflow failure (non-blocking, architectural)**: The executeWorkflow node failed with "Workflow does not exist" from `WorkflowRepository.get` during TASK-008. Root cause unresolved. Inline approach adopted as canonical. See TASK-009 reconciliation for full architectural recommendation.
- **Circuit breaker not on main**: TASK-006 (`phase3/3C-circuit-breaker`) is CI-green and merge-ready. All routing currently operates without trip-detection. Merge as TASK-010 step 1.
- **ghost_events migration number conflict**: `phase7/7D-ghost-events-table` has `008_ghost_events.sql` which conflicts with `008_phase4f_memories.sql` on main. Must be renumbered to `009_ghost_events.sql` before merge.
- **No `ghost:delegation:queue`, `ghost:events` Redis keys**: Redis is running (n8n BullMQ only). Ghost application-layer activation deferred until Ghost_Delegate sub-workflow + 3F Redis activation task.
- **`followthrough_intents` / `followthrough_executions` missing**: Pre-v3 `ghost_governed_followthrough` exists (migration 001) but does not meet 7C-ii spec (no `pre_state_snapshot`, `intent_id`, `intended_action`). 7C-ii requires a design document before implementation.

## Phase Progress Summary (as of TASK-009)

| Phase | Step | Status |
|-------|------|--------|
| 2 | 2E — Migration system | **COMPLETE** |
| 3 | 3E-ii — src/runtime extraction | **COMPLETE** (minus circuit-breaker, on branch) |
| 3 | 3E-ii — Module wiring into Code nodes | **COMPLETE** (TASK-005, 7 nodes wired) |
| 3 | 3C-ii — Circuit breaker | **BRANCH READY** (TASK-006, not merged) |
| 3 | 3E — Sub-workflow interface contracts | **BRANCH READY** (TASK-007, not merged) |
| 3 | 3E — Sub-workflow implementation | **MISSING** |
| 3 | 3B-ii — Async delegation | **MISSING** (deferred) |
| 3 | 3F — Redis app-layer activation | **MISSING** (deferred) |
| 4 | 4F — Ghost_Memory structured pipeline | **COMPLETE** |
| 7 | 7D-ii — ghost_events table | **BRANCH READY** (number conflict, not merged) |
| 7 | 7C-ii — Write-ahead / followthrough_intents | **MISSING** (design doc required first) |
| 7 | 7C-iii — Rollback | **MISSING** (blocked on 7C-ii) |
| 7 | 7H — Notification integration | **MISSING** |
| 7 | 7I — Multi-user schema prep | **PARTIAL** (memories.user_id only) |
