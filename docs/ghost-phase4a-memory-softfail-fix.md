## Ghost Phase 4A.1e Soft-Fail Fix

Status:
- Live production workflow remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- Dev memory workflow remains `kvNzP8BQxXlrtKFG`
- Dev memory webhook remains `/webhook/ghost-chat-v3-memory-dev`

### Summary

Phase 4A.1e eliminates the remaining mixed-noisy prompt webhook `500`s in the dev workflow.

The failure was not in the structured memory nodes. It happened earlier in `Save User Message`, which still used comma-delimited `queryReplacement` values. User messages containing commas caused the Postgres parameter parser to mis-split the replacements, which shifted the raw message into the `$3::jsonb` metadata slot and produced `invalid input syntax for type json`.

The fix changes `Save User Message` to use array-style replacements, so message text can contain commas safely. After that fix, the memory path resumes normal soft-fail behavior: mixed/noisy prompts return `200` and write either `0` rows or only valid rows.

No schema change was made.

### Backup created before edits

- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T131030Z.json`

### Exact root cause

- Failing node: `Save User Message`
- Failing condition: messages with commas were passed through a comma-delimited `queryReplacement` string
- Exact mechanism:
  - `Save User Message` expected three parameters: `conversation_id`, `message`, and metadata JSON
  - mixed/noisy prompts contained commas
  - n8n split the replacement string on those commas
  - the message payload shifted into the `metadata` position
  - Postgres rejected it with `invalid input syntax for type json`
- Evidence from execution records in `ghost_core.execution_data`:
  - executions `293`, `295`, `296`, `297`, and `298`
  - error node: `Save User Message`
  - error message: `invalid input syntax for type json`

### Exact node changes

Changed:
- `Save User Message`
  - replaced comma-delimited `queryReplacement` with array-style replacement:
  - `[$json.conversation_id, $('Normalize Input').item.json.message, { source: 'ghost-chat-v3', type: 'user_message' }]`

Unchanged:
- `Build Memory Extraction Input`
- `Should Extract Memory?`
- `Call OpenAI Memory Extractor`
- `Parse Structured Memory`
- `Filter Structured Memory Candidates`
- `Save Structured Memory`
- `Summarize Memory Write Outcome`

No new node was added.

### Before / after behavior for the failing prompts

Before:
- prompt: `Here is noise: stack trace stderr stdout tokens used session id: 12345. Also, hello hi thanks. Architectural decision: use Postgres only! Save only the durable decision.`
  - webhook: `500`
  - memory rows: `0`
  - failure: `Save User Message` JSON parse error

- prompt: `This prompt includes noisy runtime words like stderr and stdout, plus filler like hello and thanks. User preference for this conversation: keep answers concise! Save this preference.`
  - webhook: `500`
  - memory rows: `0`
  - failure: `Save User Message` JSON parse error

After:
- same prompt 1
  - conversation: `8f470ee8-2f15-4cc9-adc0-c277134287fb`
  - webhook: `200`
  - memory rows: `0`

- same prompt 2
  - conversation: `702398d1-8684-4fa7-aa14-98cf622b96a0`
  - webhook: `200`
  - memory rows: `0`

### Test cases run

1. Previously failing mixed-noisy prompt variant
   - conversation: `8f470ee8-2f15-4cc9-adc0-c277134287fb`
   - webhook: `200`
   - active memory rows: `0`

2. Second previously failing mixed-noisy prompt variant
   - conversation: `702398d1-8684-4fa7-aa14-98cf622b96a0`
   - webhook: `200`
   - active memory rows: `0`

3. Clean explicit architectural decision
   - conversation: `f910d4ba-4536-4503-b314-0f94f7f4969c`
   - webhook: `200`
   - row: `decision|conversation|use Postgres for Ghost memory first and do not add pgvector in this phase`

4. Clean explicit environment fact
   - conversation: `2e27d3ac-e641-470d-a10f-e79636b387c1`
   - webhook: `200`
   - row: `environment_fact|conversation|the Ghost runtime uses Postgres 16 in the local docker compose stack`

5. Trivial chat
   - conversation: `bc089046-bf4e-4add-a1b7-4e7eb42e54cb`
   - webhook: `200`
   - active memory rows: `0`

6. `invalid_json` mode
   - conversation: `17f95d6f-5289-4ea2-aa1d-4ac47d3b9f25`
   - webhook: `200`
   - active memory rows: `0`

### Additional verification

- Recent dev executions after the fix are all `success`:
  - `300`, `301`, `302`, `303`, `304`, `305`
- Live webhook smoke also succeeded:
  - conversation: `38b4d76b-9a57-4700-8a9c-c1900772b19e`
  - webhook: `200`
  - reply: `live webhook healthy`

### Rollback instructions

Restore the previous dev export:

```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T131030Z.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json

docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json \
  --projectId=Dy430kHXAiPu4Qrc

docker exec ghost-n8n-main n8n publish:workflow --id=kvNzP8BQxXlrtKFG

docker exec ghost-n8n-main n8n update:workflow --id=kvNzP8BQxXlrtKFG --active=true

docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker
```

No database rollback is required for Phase 4A.1e because the schema did not change.

### Recommendation for the next short task

Convert any remaining Postgres nodes that still use comma-delimited `queryReplacement` with dynamic free-text inputs to array-style replacements, so this class of delimiter-driven failures is removed systematically.
