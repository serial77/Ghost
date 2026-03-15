# Ghost Stack — Current State
*Generated: 2026-03-15 | Last completed task: TASK-008*

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
| Ghost_Memory | 11 nodes | Published |

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

## Key Decisions Made This Session

1. **Inline memory pipeline in Ghost Runtime**: The sub-workflow approach (`Execute Ghost_Memory Sub-Workflow`) was attempted but blocked by n8n's `workflow_published_version` lookup. The inline approach (79 nodes) is used instead — architecturally correct since `Build Memory Extraction Input` references parent workflow nodes (`$('Build API Response')`, `$('Normalize Input')`).

2. **Store to Memories (pipeline)**: Added as the 79th node in Ghost Runtime, positioned between `Save Structured Memory` and `Summarize Memory Write Outcome`. Dual-write confirmed.

3. **RETURNING clause fix**: The original Store SQL was missing `conversation_id` in the `inserted` CTE's RETURNING clause, causing the supersession logic to fail. Fixed in both Ghost Runtime and Ghost_Memory sub-workflow.

4. **Filter node Phase 4F upgrade**: The inline `Filter Structured Memory Candidates` node was upgraded from the pre-Phase 4F version (no `memory_write_rows`) to the Phase 4F version (calls `consolidateMemories` + `storeMemories` from `memory.ts`).

## Open Issues

- Ghost_Memory sub-workflow (ID: `u7omvbq1Lkn7We5F`) is published but the `Execute Ghost_Memory Sub-Workflow` executeWorkflow node in Ghost Runtime fails with "Workflow does not exist" due to an n8n `WorkflowRepository.get` issue. The inline approach works correctly and is the active path.
- No `schema_migrations` tracking table exists — migrations are applied manually.
