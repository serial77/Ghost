## Ghost Phase 4A.2 Retrieval And Lifecycle Batch

Status:
- Live production workflow remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- Dev memory workflow remains `kvNzP8BQxXlrtKFG`
- Dev memory webhook remains `/webhook/ghost-chat-v3-memory-dev`

### Summary

This batch hardens Postgres-backed memory retrieval and basic lifecycle behavior in the dev workflow without changing schema or live production.

Main outcomes:
- retrieval now ranks conversation memory ahead of global memory
- injected memory is compact, scoped, and deduped
- durable memory now has a conservative supersede path using the existing `status` column
- durable user preferences remain stored as `decision` intentionally, with explicit metadata marking them as preference-origin decisions
- the regression harness now verifies recall and supersede behavior, not only write-path stability

Validation tier used:
- Tier 2
- reason: workflow logic and retrieval/lifecycle behavior changed, but schema and external response contract did not

### Problems found

Before this batch, the dev retrieval path had five clear weaknesses:

1. Retrieval was mostly recency-based.
   - `Load Ghost Memory` returned conversation and global rows almost entirely by `created_at DESC`
   - durable decisions could lose priority to newer, weaker summaries

2. Conversation/global separation was weak.
   - global memory was appended with the same shape and no clear ranking boundary
   - prompt injection did not clearly communicate scope

3. Prompt injection was too loose.
   - format was `- [type] summary`
   - scope was omitted
   - dedupe was minimal
   - prompt sensitivity remained high for recall

4. Lifecycle was effectively append-only with no conflict handling.
   - older active environment facts or durable notes stayed active even when a newer statement clearly replaced them

5. Durable user preferences were stored as decisions, but that rule was implicit.
   - retrieval could still use them correctly, but the behavior was not explicit or observable

### Retrieval policy implemented

`Load Ghost Memory` now applies this policy:

1. Conversation memory first
   - only `status = 'active'`
   - same `conversation_id`
   - deduped by `details_json.topic_key` when present, otherwise by normalized summary
   - capped to 4 items

2. Global memory second
   - only `status = 'active'`
   - only durable high-confidence types:
     - `decision`
     - `environment_fact`
     - `operational_note`
   - only `importance >= 4`
   - capped to 2 items

3. Ranking order
   - `decision`
   - `environment_fact`
   - `operational_note`
   - `task_summary`
   - `conversation_summary`
   - then `importance DESC`
   - then `created_at DESC`

4. Injection cap
   - 6 total items max

### Prompt format used for injected memory

`Compose Prompt With Ghost Memory` now injects:

```text
Ghost memory:
- [decision][conversation] use Postgres for Ghost memory first and do not add pgvector in this phase
- [environment_fact][global] Ghost runtime uses Postgres 16 in the local docker compose stack
```

Rules:
- no raw `details_json`
- no metadata dump
- no duplicate summaries
- no filler when there is no qualifying memory
- conversation memory appears before global memory

### Lifecycle / supersede rules implemented

No schema change was needed.

`Save Structured Memory` now keeps append-only history but updates older rows conservatively:

1. New rows are inserted first.
2. Older rows are marked `superseded` when all of these are true:
   - same `scope`
   - same `memory_type`
   - same `conversation_id` for conversation memory
   - durable type:
     - `decision`
     - `environment_fact`
     - `operational_note`
   - same `details_json.topic_key` when present, or exact normalized summary match

This is intentionally conservative.

Current practical effect:
- exact duplicate durable rows do not remain multiply active
- environment facts with the same derived subject topic can replace older facts cleanly
- tested example:
  - `the Ghost runtime uses Postgres 15...` -> later `the Ghost runtime uses Postgres 16...`
  - result: old row `superseded`, new row `active`

### Durable user preferences decision

Durable user preferences continue to map into `decision` intentionally in Phase 4A.

New explicit rule:
- fallback-created preference rows keep `memory_type = 'decision'`
- `details_json.memory_origin = 'durable_user_preference'`

Reason:
- keeps schema stable
- keeps retrieval priority high for future-behavior instructions
- avoids a schema redesign in this batch

### Exact workflow node changes

Changed:
- `Load Ghost Memory`
  - replaced recency-only selection with scoped ranking and dedupe
  - caps to 4 conversation + 2 global items

- `Compose Prompt With Ghost Memory`
  - compacted summaries
  - added `[memory_type][scope]` formatting
  - dedupes injected lines
  - caps injected block to 6 items

- `Filter Structured Memory Candidates`
  - adds conservative `details_json.topic_key`
  - explicit preference-as-decision metadata
  - dedupe now benefits from topic keys

- `Save Structured Memory`
  - insert remains append-first
  - adds conservative `superseded` update step for durable active rows

- `Summarize Memory Write Outcome`
  - now exposes `superseded_count` in internal debug output

### Schema changed?

No.

### Harness changes

Updated:
- `/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh`
- `/home/deicide/dev/ghost-stack/docs/ghost-phase4a-regression-harness.md`

Added recall/lifecycle coverage:
- `recall_decision_after_fillers`
- `recall_environment_fact`
- `supersede_environment_fact`
- `no_memory_no_hallucinated_recall`

Current full harness result:
- `13 passed, 0 failed`

### Tests run

Targeted during implementation:
- `trivial_chat`
- `forced_technical_work`
- `forced_lightweight_local_task`
- `recall_decision_after_fillers`
- `recall_environment_fact`
- `supersede_environment_fact`
- `no_memory_no_hallucinated_recall`

Full harness at end:
- `/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh`
- result: `13 passed, 0 failed`

Live untouched check:
- conversation: `e3b59cca-fb6c-4b42-a5bb-e52480d0d22b`
- webhook: `200`
- reply: `live retrieval batch untouched`

### Before / after recall examples

Before:
- recall was more prompt-sensitive
- retrieval block omitted scope
- no tested lifecycle rule prevented stale environment facts staying active

After:
- same conversation recall still works after 7 filler turns:
  - question: `What architecture decision did I set for this conversation about memory?`
  - reply: `You decided to use Postgres for Ghost memory first and not to add pgvector in this phase.`

- supersede now works for tested environment facts:

```text
environment_fact|superseded|the Ghost runtime uses Postgres 15 in the local docker compose stack
environment_fact|active|the Ghost runtime uses Postgres 16 in the local docker compose stack
```

- recall prefers the active fact:
  - reply: `The current environment fact states the Ghost runtime uses Postgres 16 in the local Docker Compose stack.`

### Files changed

Updated:
- `/home/deicide/dev/ghost-stack/scripts/build-phase4a-memory-workflow.js`
- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.json`
- `/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh`
- `/home/deicide/dev/ghost-stack/docs/ghost-phase4a-regression-harness.md`

Created:
- `/home/deicide/dev/ghost-stack/docs/ghost-phase4a-retrieval-lifecycle-batch.md`

Backup:
- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T144118Z.json`

### Rollback instructions

Workflow rollback:

```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T144118Z.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json

docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json \
  --projectId=Dy430kHXAiPu4Qrc

docker exec ghost-n8n-main n8n publish:workflow --id=kvNzP8BQxXlrtKFG

docker exec ghost-n8n-main n8n update:workflow --id=kvNzP8BQxXlrtKFG --active=true

docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker
```

No database rollback is required for this batch because schema did not change.

### Recommendation for Phase 4A completion / next step

Phase 4A is close to complete for dev validation.

Recommended next major step:
- run one final dev-focused review pass on memory write quality and retrieval recall across a slightly broader real-world prompt set
- if that remains stable, prepare a controlled production cutover plan for the existing structured memory path before considering any Phase 4B vector retrieval work
