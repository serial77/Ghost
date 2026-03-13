## Ghost Phase 4A.1f Postgres Parameter Safety Audit

Status:
- Live production workflow remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- Dev memory workflow remains `kvNzP8BQxXlrtKFG`
- Dev memory webhook remains `/webhook/ghost-chat-v3-memory-dev`

### Summary

Phase 4A.1f audited every Postgres node in the dev workflow and converted the one remaining multi-parameter comma-delimited replacement to array-style.

Root-risk class addressed:
- delimiter-driven parameter corruption in Postgres `queryReplacement`
- especially when free-form text contains commas or JSON-like content
- failure mode: parameters shift across `$1`, `$2`, `$3...` boundaries and can land in JSON/JSONB slots incorrectly

No schema change was made.

Note:
- the user request referenced `/home/deicide/dev/ghost-stack/build-phase4a-memory-workflow.js`
- the actual generator file in this repo is `/home/deicide/dev/ghost-stack/scripts/build-phase4a-memory-workflow.js`

### Backup created before edits

- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T131522Z.json`

### Audit table

| Node | Status | Reason |
|---|---|---|
| `Find Conversation By ID` | safe | single UUID-like parameter only; no free-text packing |
| `Create New Conversation` | converted | multi-parameter node previously used comma-delimited replacement; not currently exposed to free-text, but converted for consistency and future safety |
| `Save User Message` | safe already | already converted in Phase 4A.1e to array-style; accepts raw user message safely |
| `Load Recent Messages` | safe | single conversation UUID parameter only |
| `Save Assistant Reply` | safe already | already uses array-style replacement and explicit metadata object; accepts reply/stdout/stderr safely |
| `Touch Conversation Timestamp` | safe | single conversation UUID parameter only |
| `Touch Conversation Timestamp After Reply` | safe | single conversation UUID parameter only |
| `Load Ghost Memory` | safe | single conversation UUID parameter only |
| `Save Structured Memory` | safe | single JSON payload parameter via `JSON.stringify($json.memory_items || [])`; no delimiter packing across multiple params |

### Nodes converted

Changed:
- `Create New Conversation`
  - before: comma-delimited replacement string
  - after: array-style replacement

Already safe before this task:
- `Save User Message`
- `Save Assistant Reply`

### Exact node changes

`Create New Conversation` now uses:

```js
={{ [
  $('Normalize Input').item.json.conversation_id || '00000000-0000-0000-0000-000000000000',
  (($('Normalize Input').item.json.user_id || '').match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/) ? $('Normalize Input').item.json.user_id : 'NULL'),
  'Ghost Chat',
  'ghost-chat-v3',
  'active',
  {}
] }}
```

No SQL was changed. Only parameter passing was made structured.

### Test cases run

1. User message containing commas
   - conversation: `b2bf7343-a063-413e-87e2-a6f46f415a79`
   - webhook: `200`
   - stored messages:
     - `user|Hello, Ghost, please answer this, with commas, and keep it short.`
     - `assistant|Hello, how can I help you today?`

2. User message containing commas plus JSON-looking text
   - conversation: `9ab226ce-7680-4671-ab6a-10c1d7994492`
   - webhook: `200`
   - stored user message preserved the full JSON-like text with commas
   - assistant reply also saved correctly

3. Assistant path still saves reply correctly
   - verified in conversations:
     - `b2bf7343-a063-413e-87e2-a6f46f415a79`
     - `9ab226ce-7680-4671-ab6a-10c1d7994492`
     - `d96badb1-c774-40a2-bb7a-3e2fa2b8675c`
   - assistant rows were present and intact in `messages`

4. Memory write path still works for a clean decision
   - conversation: `89356e6e-0ade-421a-bd53-3026c5fc27ba`
   - webhook: `200`
   - row: `decision|conversation|use Postgres for Ghost memory first, and do not add pgvector in this phase`

5. Memory write path still soft-fails for `invalid_json` mode
   - conversation: `7cf6bec1-5a7c-47ba-96b4-d37ac7a826f2`
   - webhook: `200`
   - active memory rows: `0`

6. `technical_work` path still succeeds
   - conversation: `d96badb1-c774-40a2-bb7a-3e2fa2b8675c`
   - webhook: `200`
   - provider/model: `codex_oauth_worker / gpt-5.4`

7. `lightweight_local_task` path still succeeds
   - conversation: `d82a314f-cb10-4f4e-a116-f384bf187b21`
   - webhook: `200`
   - provider/model: `ollama / qwen2.5:3b-instruct`

### Execution-data check

I inspected recent dev executions in `ghost_core.execution_entity` and `ghost_core.execution_data`.

Results:
- executions `307` through `312` are `success`
- no fresh `invalid input syntax for type json`
- no fresh `Save User Message` Postgres parameter-splitting errors

### Live workflow check

Live production remained untouched and healthy:
- conversation: `ed7bce46-473a-4374-b4c3-f74c44d2f583`
- webhook: `200`
- reply: `live unchanged`

### Rollback instructions

Restore the previous dev export:

```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T131522Z.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json

docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json \
  --projectId=Dy430kHXAiPu4Qrc

docker exec ghost-n8n-main n8n publish:workflow --id=kvNzP8BQxXlrtKFG

docker exec ghost-n8n-main n8n update:workflow --id=kvNzP8BQxXlrtKFG --active=true

docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker
```

No database rollback is required for Phase 4A.1f because the schema did not change.

### Recommendation for the next short task

Add one lightweight automated regression harness that posts a fixed matrix of comma-heavy webhook payloads to the dev workflow and then checks `messages`, `ghost_memory`, and recent execution status so Postgres parameter-safety regressions are caught immediately.
