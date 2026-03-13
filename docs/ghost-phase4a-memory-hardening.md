## Ghost Phase 4A.1 Memory Hardening

Status:
- Live production workflow remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- Hardened dev workflow remains `kvNzP8BQxXlrtKFG`
- Hardened dev webhook remains `/webhook/ghost-chat-v3-memory-dev`

### Summary

Phase 4A.1 hardens the dev-only structured memory write path without changing the schema or the external response contract.

Main changes:
- stricter extractor prompt with a single required JSON object shape
- parser now expects `{ "items": [...] }` and rejects bad shapes
- new deterministic filtering node before DB write
- narrower fallback logic
- internal debug counters in node output for attempted/skipped, candidate count, filtered count, saved count, and fallback usage

### Backup created before edits

- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T122141Z.json`

### Exact workflow node changes

Changed:
- `Build Memory Extraction Input`
  - added stricter extraction contract
  - added `meaningful_technical_work`
  - added initial `memory_debug` metadata
  - tightened `should_extract_memory`
- `Parse Structured Memory`
  - now extracts only a single JSON object
  - validates top-level shape `{items:[...]}`
  - drops invalid scope/type/summary/detail payloads earlier
  - rejects noisy summaries
  - narrows fallback to explicit durable instruction, explicit architectural decision, or explicit environment/runtime fact
  - emits candidate counts and fallback flags in `memory_debug`
- `Save Structured Memory`
  - unchanged SQL contract
  - still soft-fails with `continueOnFail`

Added:
- `Filter Structured Memory Candidates`
  - dedupes items within the pass
  - rejects trivial chit-chat and runtime noise
  - rejects weak `task_summary`
  - prioritizes `decision`, `environment_fact`, `operational_note`
  - caps writes to 3 items
- `Summarize Memory Write Outcome`
  - records `saved_count` and saved item summaries in execution output only

Connection changes:
- `Parse Structured Memory -> Filter Structured Memory Candidates -> Save Structured Memory -> Summarize Memory Write Outcome`

### Schema changed?

No. Phase 4A.1 made zero schema changes.

### Problems found

1. The deployment still requires `ghost-n8n-main` and `ghost-n8n-worker` restarts after `publish:workflow` for the dev webhook to serve the updated published workflow.
2. The stricter filter is intentionally conservative. In the mixed noisy prompt test it chose `0` writes rather than risk storing a polluted summary.
3. The duplicate-ish test wrote only one row, but the resulting summary is still more verbose than ideal. Deduplication worked; normalization can still be tightened further.
4. One immediate post-restart live smoke returned `{\"message\":\"Workflow execution failed\"}` once, then the same test succeeded on retry while containers were healthy. I treated that as transient runtime noise, not a persistent regression.

### Test cases run

1. Trivial chat -> 0 writes
   - request: `Say hello in five words.`
   - conversation: `df996d3e-68ad-4378-8560-4b64826bd61f`
   - active memory rows: `0`

2. Explicit architectural decision -> 1 decision write
   - request: `Architectural decision: use Postgres for Ghost memory first and do not add pgvector in this phase. Confirm briefly.`
   - conversation: `fc2051d2-e38d-409c-8573-47af37875999`
   - row: `decision|conversation|use Postgres for Ghost memory first and do not add pgvector in this phase. Confirm briefly.`

3. Explicit environment fact -> 1 environment_fact write
   - request: `Environment fact: the Ghost runtime uses Postgres 16 in the local docker compose stack. Confirm briefly.`
   - conversation: `a843a632-8957-4a76-9d0f-afa6a53820c4`
   - row: `environment_fact|conversation|the Ghost runtime uses Postgres 16 in the local docker compose stack. Confirm briefly.`

4. Mixed noisy prompt -> 0 writes
   - request included runtime-noise text plus one architectural-decision sentence
   - conversation: `932e1d3f-eb58-4978-83b6-601eee65c74c`
   - active memory rows: `0`

5. `invalid_json` test mode -> 200 response, 0 writes
   - request body included `"memory_test_mode":"invalid_json"`
   - conversation: `d6e560a1-3636-456e-86ac-8b6963de0fa9`
   - active memory rows: `0`

6. Duplicate-ish extraction case -> duplicates not written
   - request repeated the same architectural decision
   - conversation: `4b297828-97e7-4d22-8430-eef7e4933e54`
   - active memory rows: `1`
   - row: `decision|conversation|use Postgres only. Architectural decision: use Postgres only. Save only the durable decision.`

### Sample DB rows written

```sql
SELECT conversation_id, memory_type, scope, summary
FROM ghost_memory
WHERE conversation_id IN (
  'fc2051d2-e38d-409c-8573-47af37875999',
  'a843a632-8957-4a76-9d0f-afa6a53820c4',
  '4b297828-97e7-4d22-8430-eef7e4933e54'
)
  AND status = 'active'
ORDER BY created_at;
```

Observed rows:
- `fc2051d2-e38d-409c-8573-47af37875999 | decision | conversation | use Postgres for Ghost memory first and do not add pgvector in this phase. Confirm briefly.`
- `a843a632-8957-4a76-9d0f-afa6a53820c4 | environment_fact | conversation | the Ghost runtime uses Postgres 16 in the local docker compose stack. Confirm briefly.`
- `4b297828-97e7-4d22-8430-eef7e4933e54 | decision | conversation | use Postgres only. Architectural decision: use Postgres only. Save only the durable decision.`

### Rollback instructions

Workflow artifact rollback:
- restore `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T122141Z.json` over the current dev export

Workflow publish rollback:
```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T122141Z.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json

docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json \
  --projectId=Dy430kHXAiPu4Qrc

docker exec ghost-n8n-main n8n publish:workflow --id=kvNzP8BQxXlrtKFG

docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml \
  restart ghost-n8n-main ghost-n8n-worker
```

No database rollback is required for Phase 4A.1 because the schema did not change.

### Recommendation for the next short task

Next short task:
- tighten summary normalization for explicit decision/fact prompts so the stored summary strips framing like `Confirm briefly.` and repeated lead-in text while keeping the same schema and workflow shape.
