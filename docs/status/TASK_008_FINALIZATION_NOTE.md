# TASK-008 Finalization Note
*Date: 2026-03-15*

## Summary

TASK-008 (Phase 4F: Ghost_Memory Structured Pipeline) is complete. This note documents the finalization pass, including what was verified, what was fixed, and the final verified state.

## Deliverables Verified

### 1. Database Migration
- **File**: `db/migrations/008_phase4f_memories.sql`
- **Applied**: 2026-03-15 (this session, manually via `psql`)
- **Table**: `memories` — 15 structural columns + `embedding TEXT NULL` (pgvector-prepared)
- **Columns**: `memory_id`, `user_id`, `conversation_id`, `memory_tier`, `content`, `category`, `confidence`, `status`, `superseded_by`, `supersedes`, `source_type`, `source_message`, `created_at`, `updated_at`, `last_accessed`
- **Constraints**: tier `(working|long_term|episodic)`, category `(task_summary|decision|environment_fact|operational_note|conversation_summary)`, status `(active|superseded|conflicted|archived)`, source_type `(llm_extraction|heuristic_fallback|operator_direct|system)`
- **Indexes**: 4 indexes for conversation timeline, tier/status/category, supersession chain, active confidence recall

### 2. src/runtime/memory.ts
- **Public API**: `extractMemories`, `consolidateMemories`, `storeMemories`, `shouldExtractMemory`, `buildExtractionPrompt`
- **Types exported**: `MemoryScope`, `MemoryCategory`, `MemoryTier`, `MemoryStatus`, `MemorySourceType`, `MemoryContext`, `MemoryCandidate`, `MemoryWriteRow`, `ExtractMemoriesResult`, `ConsolidationResult`, `ShouldExtractResult`
- **Key behaviors**:
  - `shouldExtractMemory()` gates on: task class, response mode (delegated responses blocked), explicit memory cues, meaningful technical work
  - `storeMemories()` returns `MemoryWriteRow[]` — does NOT perform DB write (write is done by n8n Postgres node)
  - Scope→tier mapping: `global→long_term`, `conversation→working`, `task→working`
  - Importance→confidence: `importance / 5.0` (clamped 0.00–1.00)

### 3. Tests
- **File**: `tests/runtime/memory.test.ts`
- **Result**: 203/203 passing
- **Coverage**: `shouldExtractMemory`, `buildExtractionPrompt`, `extractMemories`, `consolidateMemories`, `storeMemories`, taxonomy guards, full pipeline integration

### 4. Ghost Runtime Workflow Updates
The Ghost Runtime workflow was updated in two stages:

**Stage 1 (previous session)**: Memory pipeline nodes added inline (nodes 79→78: `Build Memory Extraction Input`, `Should Extract Memory?`, `Use Invalid Memory Stub?`, `Return Invalid Memory Extractor Output`, `Call OpenAI Memory Extractor`, `Parse Structured Memory`, `Filter Structured Memory Candidates`, `Save Structured Memory`, `Summarize Memory Write Outcome`)

**Stage 2 (this session)**:
- `Store to Memories (pipeline)` node added (node 79)
- `Filter Structured Memory Candidates` node upgraded from pre-Phase 4F code to Phase 4F code (adds `consolidateMemories`/`storeMemories` calls, produces `memory_write_rows`)
- `Store to Memories (pipeline)` SQL fixed: added `conversation_id` to `inserted` CTE RETURNING clause (required by supersession logic)
- Final topology: `Save Structured Memory → Store to Memories (pipeline) → Summarize Memory Write Outcome`

### 5. Ghost_Memory Sub-Workflow
- **ID**: `u7omvbq1Lkn7We5F`
- **Nodes**: 11 (complete Phase 4F pipeline)
- **Status**: Published and active
- **Note**: The `Execute Ghost_Memory Sub-Workflow` node in Ghost Runtime was attempted but fails with "Workflow does not exist" due to an n8n internal repository lookup issue. The inline approach in Ghost Runtime is the active pipeline path.

## E2E Verification Evidence

**Test message**: "remember this: always confirm before destructive operations"
**Execution**: n8n execution #518 (success)
**DB verification**:
```
ghost_memory: 57 rows (+1 from baseline 56)
memories:      1 row (new from 0)
```

**Verified row in `memories`**:
```
memory_id:    ee85e919-dcbf-40d9-90f3-0324a5f3f403
memory_tier:  working
category:     decision
confidence:   0.80
status:       active
source_type:  heuristic_fallback
content:      always confirm before destructive operations
created_at:   2026-03-15 13:03:42 UTC
```

## Issues Encountered and Resolved

| Issue | Root Cause | Resolution |
|-------|-----------|------------|
| `memories` table missing | Migration not applied at session start | Applied `008_phase4f_memories.sql` via psql |
| Ghost Runtime using old 78-node cached version | n8n worker cached workflow at startup | Restarted ghost-n8n-worker |
| "Workflow does not exist" error | Ghost_Memory sub-workflow had no `workflow_published_version` entry | Inserted published version row; ultimately bypassed by using inline approach |
| Store SQL: `column newer.conversation_id does not exist` | `inserted` CTE RETURNING clause missing `conversation_id` | Added `conversation_id` to RETURNING clause |
| `memory_write_rows` not produced | Inline Filter node was pre-Phase 4F code without `storeMemories` call | Replaced Filter node code with Phase 4F version from Ghost_Memory sub-workflow |

## What Was NOT Changed

- `ghost_memory` table: unchanged, dual-write preserved
- Migration numbering: `008` is correct (007 was last on main)
- `src/runtime/index.ts`: exports already correct from previous session
- Test suite: 203/203, no changes needed
- `docs/claude-handoff-current-state.md`: not modified (this file supersedes it for current state)

## Branch and CI State

- **Branch**: `phase4/4F-ghost-memory-subworkflow`
- **CI**: Green (run 23109296151, commit 4d1707b — pre-finalization)
- **New commits**: pending (finalization changes to tracker + docs + workflow exports)
