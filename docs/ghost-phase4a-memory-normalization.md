## Ghost Phase 4A.1b Memory Normalization

Status:
- Live production workflow remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- Dev workflow remains `kvNzP8BQxXlrtKFG`
- Dev webhook remains `/webhook/ghost-chat-v3-memory-dev`

### Summary

Phase 4A.1b tightens structured memory summary normalization in the dev workflow only.

The change stays narrow:
- no schema change
- no new workflow node
- normalization added inside `Filter Structured Memory Candidates`
- existing hardening behavior preserved: dedupe, conservative filtering, soft fail, max 3 writes, narrow fallback

### Backup created before edits

- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T123043Z.json`

### Exact node changes

Changed:
- `Filter Structured Memory Candidates`
  - added type-aware summary normalization for `decision`, `environment_fact`, and `operational_note`
  - trims and collapses whitespace
  - strips low-value framing prefixes such as:
    - `Architectural decision:`
    - `Environment fact:`
    - `Decision for this conversation:`
    - `Operational note:`
  - strips low-value suffixes such as:
    - `Confirm briefly`
    - `Confirm`
    - `Save only the durable decision`
    - `Keep only the durable decision`
  - collapses near-identical repeated clauses conservatively
  - records normalization changes in `memory_debug.normalization_changes`

Unchanged:
- `Parse Structured Memory`
- `Save Structured Memory`
- `Summarize Memory Write Outcome`

### New node added?

No. Phase 4A.1b did not add a new node.

### Before / after summary examples

Architectural decision example:
- before: `use Postgres for Ghost memory first and do not add pgvector in this phase. Confirm briefly.`
- after: `use Postgres for Ghost memory first and do not add pgvector in this phase`

Environment fact example:
- before: `the Ghost runtime uses Postgres 16 in the local docker compose stack. Confirm briefly.`
- after: `the Ghost runtime uses Postgres 16 in the local docker compose stack`

Duplicate-ish decision example:
- before: `use Postgres only. Architectural decision: use Postgres only. Save only the durable decision.`
- after: `use Postgres only.`

### Test cases run

1. Explicit architectural decision with wrapper text -> 1 clean decision row
   - conversation: `a821ef70-d205-47bb-a3ee-442a8194c196`
   - stored row: `decision|conversation|use Postgres for Ghost memory first and do not add pgvector in this phase`

2. Explicit environment fact with wrapper text -> 1 clean environment_fact row
   - conversation: `b750ef5c-f574-436e-ade7-7d7f738b03cf`
   - stored row: `environment_fact|conversation|the Ghost runtime uses Postgres 16 in the local docker compose stack`

3. Duplicate-ish decision phrasing -> single clean row
   - conversation: `09423841-7afe-4244-a4ec-05faed4663de`
   - stored row: `decision|conversation|use Postgres only.`

4. Trivial chat -> 0 writes
   - conversation: `5745af67-aa7f-4f9d-bf48-c608e91e606f`
   - active memory rows: `0`

5. Mixed noisy prompt -> still 0 writes
   - conversation: `a1925d85-c832-4802-aa00-ab9ff57e4dca`
   - active memory rows: `0`

6. `invalid_json` mode -> 200 response, 0 writes
   - conversation: `3d840508-443e-4c64-b6ae-a6b9400f71d2`
   - active memory rows: `0`

### Verification query used

```sql
SELECT memory_type, scope, summary
FROM ghost_memory
WHERE conversation_id IN (
  'a821ef70-d205-47bb-a3ee-442a8194c196',
  'b750ef5c-f574-436e-ade7-7d7f738b03cf',
  '09423841-7afe-4244-a4ec-05faed4663de'
)
  AND status = 'active'
ORDER BY created_at;
```

### Rollback instructions

Workflow artifact rollback:
- restore `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T123043Z.json`

Workflow publish rollback:
```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T123043Z.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json

docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json \
  --projectId=Dy430kHXAiPu4Qrc

docker exec ghost-n8n-main n8n publish:workflow --id=kvNzP8BQxXlrtKFG

docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml \
  restart ghost-n8n-main ghost-n8n-worker
```

### Recommendation for the next short task

Tighten fallback summary extraction so explicit durable user preferences and operational notes normalize as cleanly as decisions and environment facts, while staying conservative and keeping the same schema and workflow shape.
