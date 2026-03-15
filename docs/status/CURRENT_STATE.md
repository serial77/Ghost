# Ghost Stack — Current State
*Generated: 2026-03-15 | Last completed task: TASK-008 (closeout: TASK-008-CLOSEOUT)*

## Last Completed Task

**TASK-008 — Phase 4F: Ghost_Memory Structured Pipeline**

- Branch: `phase4/4F-ghost-memory-subworkflow`
- Status: Complete, merged to main pending CI
- Deliverables:
  - `src/runtime/memory.ts` — Extract→Consolidate→Store pipeline, public API: `extractMemories`, `consolidateMemories`, `storeMemories`, `shouldExtractMemory`, `buildExtractionPrompt`
  - `db/migrations/008_phase4f_memories.sql` — `memories` table (15 structural columns + conditional embedding)
  - `db/migrations/008_phase4f_memories_down.sql` — rollback
  - `tests/runtime/memory.test.ts` — 203/203 tests passing
  - Ghost Runtime workflow updated to 79 nodes with inline Phase 4F pipeline
  - Dual-write verified: `ghost_memory` (legacy) + `memories` (pipeline) both receive writes

## Next Task

**TASK-009 — Create Ghost_Classify Sub-Workflow**
- Goal: Extract the classification logic into a dedicated sub-workflow following the runtime decomposition sequence
- Prerequisites: TASK-008 complete ✓
- Branch: to be created from main

## Architecture Snapshot (as of 2026-03-15)

### Live Infrastructure
| Service | Version | Status |
|---------|---------|--------|
| n8n | 2.11.3 | Active |
| Postgres | 16 | Active |
| Redis | 7 | Active |
| Ghost Runtime | 79 nodes | Active |
| Ghost_Memory | 11 nodes | Published (reference artifact) |

### Database State
| Table | Rows | Notes |
|-------|------|-------|
| `ghost_memory` | 57+ | Legacy memory table (Phase 4A), preserved |
| `memories` | 1+ | Phase 4F pipeline table, migration 008 applied |
| `conversations` | — | Active |
| `messages` | — | Active |

### Migration State
Migrations applied manually (no schema_migrations tracking table):
- 001–007: applied (legacy, pre-phase-4F)
- 008 (`008_phase4f_memories.sql`): applied 2026-03-15

### src/runtime Modules
| Module | Public API | Tests |
|--------|-----------|-------|
| `classifier.ts` | `classifyRequest` | ✓ |
| `config.ts` | `getProviderPolicies`, `getOllamaModels`, `getOpenAIConfig`, `getCodexConfig` | ✓ |
| `router.ts` | `selectRoute` | ✓ |
| `approval.ts` | `APPROVAL_CONFIG`, `detectRiskLevel`, `assessApprovalRisk` | ✓ |
| `memory.ts` | `extractMemories`, `consolidateMemories`, `storeMemories`, `shouldExtractMemory`, `buildExtractionPrompt` | ✓ 203 tests |
| `delegation.ts` | `buildDelegationRequest`, `resolveWorkerByIntent`, etc. | ✓ |

## Architecture Decisions

1. **Inline memory pipeline is the accepted active path**: Ghost Runtime uses the inline 10-node memory pipeline (nodes 70–79). This is the deliberate accepted architecture — not a fallback. The `Build Memory Extraction Input` node references parent workflow nodes (`$('Build API Response')`, `$('Normalize Input')`) which are only accessible inline, making this approach architecturally correct.

2. **Ghost_Memory sub-workflow is a reference artifact**: The Ghost_Memory sub-workflow (ID: `u7omvbq1Lkn7We5F`) is published and preserved as a reference artifact containing the canonical Phase 4F pipeline logic. It is **not** the active execution path. The `Execute Ghost_Memory Sub-Workflow` node was removed from Ghost Runtime.

3. **Store to Memories (pipeline)**: Added as the 79th node in Ghost Runtime, positioned between `Save Structured Memory` and `Summarize Memory Write Outcome`. Dual-write confirmed.

4. **RETURNING clause fix**: The original Store SQL was missing `conversation_id` in the `inserted` CTE's RETURNING clause, causing the supersession logic to fail. Fixed in both Ghost Runtime and Ghost_Memory sub-workflow.

5. **Filter node Phase 4F upgrade**: The inline `Filter Structured Memory Candidates` node was upgraded from the pre-Phase 4F version (no `memory_write_rows`) to the Phase 4F version (calls `consolidateMemories` + `storeMemories` from `memory.ts`).

## Known Issues / Follow-up

- **Execute Ghost_Memory Sub-Workflow failure (follow-up, non-blocking)**: When the `Execute Ghost_Memory Sub-Workflow` executeWorkflow node was active in Ghost Runtime, it failed with "Workflow does not exist" from n8n's `WorkflowRepository.get` / `workflow_published_version` lookup. Root cause: unclear (DB entries were correct, manual SQL confirmed the row, but in-memory resolution failed). The inline approach is the accepted fix. Investigating or resolving the n8n sub-workflow lookup behavior is a potential follow-up but does not block any current work.
- **No `schema_migrations` tracking table**: Migrations are applied manually. A migration runner is tracked as active architecture work (step 2E).
