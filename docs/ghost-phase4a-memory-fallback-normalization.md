## Ghost Phase 4A.1c Fallback Normalization

Status:
- Live production workflow remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- Dev workflow remains `kvNzP8BQxXlrtKFG`
- Dev webhook remains `/webhook/ghost-chat-v3-memory-dev`

### Summary

Phase 4A.1c tightens fallback-path normalization for durable user preferences and operational notes in the dev workflow only.

The change stays narrow:
- no schema change
- no new workflow node
- fallback remained limited to explicit durable preference, explicit operational note, explicit architectural decision, and explicit environment/runtime fact
- existing protections remained in place: dedupe, conservative filtering, soft fail, max 3 writes

### Backup created before edits

- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T123817Z.json`

### Exact node changes

Changed:
- `Parse Structured Memory`
  - extended fallback detection for:
    - `User preference for this conversation: ...`
    - `The user prefers ...`
    - `Operational note: ...`
    - `Runtime note: ...`
  - kept fallback narrow to explicit high-signal cases only
- `Filter Structured Memory Candidates`
  - extended conservative normalization coverage so fallback-created preference and operational-note summaries strip wrappers like:
    - `User preference for this conversation:`
    - `Preference:`
    - `Operational note:`
    - `Runtime note:`
    - `Save this preference`
    - `Remember this preference`
    - `Save this note`
  - kept duplicate-clause collapse conservative

Unchanged:
- `Save Structured Memory`
- `Summarize Memory Write Outcome`

### New node added?

No. Phase 4A.1c did not add a new node.

### Before / after stored summary examples

Preference example:
- before target: `User preference for this conversation: keep answers concise. Confirm briefly.`
- after stored summary: `keep answers concise`

Operational note example:
- before target: `Operational note: restart ghost-n8n-main and ghost-n8n-worker after publish:workflow. Save this note.`
- after stored summary: `restart ghost-n8n-main and ghost-n8n-worker after publish:workflow`

Preference sentence example:
- before target: `The user prefers full config files, not snippets. Remember this preference.`
- after stored summary: `The user prefers full config files, not snippets`

### Test cases run

1. Explicit durable user preference with wrapper text -> 1 clean stored row
   - request: `User preference for this conversation: keep answers concise. Confirm briefly.`
   - conversation: `d97f0e98-4d90-400b-a9c8-162982beffc7`
   - stored row: `decision|conversation|keep answers concise`

2. Explicit operational note with wrapper text -> 1 clean stored row
   - request: `Operational note: restart ghost-n8n-main and ghost-n8n-worker after publish:workflow. Save this note.`
   - conversation: `70c31753-b331-453d-8eab-fe7b1c2689ff`
   - stored row: `operational_note|conversation|restart ghost-n8n-main and ghost-n8n-worker after publish:workflow`

3. Duplicate-ish preference phrasing -> single clean row
   - request: `User preference for this conversation: keep answers concise. User preference for this conversation: keep answers concise. Save this preference.`
   - conversation: `a7324659-3e14-4978-ba96-f02352fbd91f`
   - stored row: `decision|conversation|keep answers concise.`

4. Trivial chat -> 0 writes
   - conversation: `e438f8fa-ada3-498a-866f-d65640f2ddf4`
   - active memory rows: `0`

5. Mixed noisy prompt -> still 0 writes
   - conversation: `b1ac4fd4-1062-4835-80a6-d807013c0afd`
   - active memory rows: `0`

6. `invalid_json` mode -> 200 response, 0 writes
   - conversation: `0a2fed28-7eac-46db-86e9-43c6e4c92d8f`
   - active memory rows: `0`

### Verification queries used

```sql
SELECT conversation_id, memory_type, scope, summary
FROM ghost_memory
WHERE conversation_id IN (
  'd97f0e98-4d90-400b-a9c8-162982beffc7',
  '70c31753-b331-453d-8eab-fe7b1c2689ff',
  'a7324659-3e14-4978-ba96-f02352fbd91f'
)
  AND status = 'active'
ORDER BY created_at;
```

### Rollback instructions

Workflow artifact rollback:
- restore `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T123817Z.json`

Workflow import/publish rollback:
```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T123817Z.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json

docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json \
  --projectId=Dy430kHXAiPu4Qrc

docker exec ghost-n8n-main n8n publish:workflow --id=kvNzP8BQxXlrtKFG
docker exec ghost-n8n-main n8n update:workflow --id=kvNzP8BQxXlrtKFG --active=true

docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml \
  restart ghost-n8n-main ghost-n8n-worker
```

### Recommendation for the next short task

Normalize the final trailing punctuation on short fallback-written preference summaries so similar rows collapse to one canonical form, for example `keep answers concise` versus `keep answers concise.`.
