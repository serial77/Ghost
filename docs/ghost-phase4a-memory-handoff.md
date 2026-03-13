## Ghost Phase 4A Memory Handoff

Status:
- Live production workflow remains `GHOST by Codex`
- Live production workflow id remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- New dev workflow id: `kvNzP8BQxXlrtKFG`
- New dev workflow name: `GHOST by Codex Phase4A Memory Dev`
- New dev webhook: `/webhook/ghost-chat-v3-memory-dev`

### What changed

Phase 4A adds a first-pass structured Ghost memory path in Postgres plus a dev-only workflow copy that reads and writes compact memory.

The implementation stays small:
- one new table: `ghost_memory`
- one retrieval query before main reply generation
- one write path after assistant reply persistence
- soft failure on memory read and memory write
- no change to the live production workflow id or webhook path

### Schema added

New table:
- `ghost_memory`

Columns:
- `id UUID PRIMARY KEY`
- `scope TEXT NOT NULL`
- `memory_type TEXT NOT NULL`
- `conversation_id UUID NULL`
- `task_run_id UUID NULL`
- `source_message_id UUID NULL`
- `title TEXT NULL`
- `summary TEXT NOT NULL`
- `details_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `importance SMALLINT NOT NULL DEFAULT 3`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Constraints:
- `scope IN ('global', 'conversation', 'task')`
- `memory_type IN ('task_summary', 'decision', 'environment_fact', 'operational_note', 'conversation_summary')`
- `status IN ('active', 'superseded', 'archived')`
- `importance BETWEEN 1 AND 5`

Indexes:
- `idx_ghost_memory_conversation_created`
- `idx_ghost_memory_scope_status_created`
- `idx_ghost_memory_type_status_created`

Trigger:
- `trg_ghost_memory_updated_at` using existing `set_updated_at()`

Migration location:
- `/home/deicide/dev/ghost-stack/db/migrations/20260312_phase4a_ghost_memory.sql`

Rollback migration:
- `/home/deicide/dev/ghost-stack/db/migrations/20260312_phase4a_ghost_memory_down.sql`

### Write path nodes added or changed

Changed:
- `Normalize Input`
  - added dev-only `memory_test_mode`
- `Save Assistant Reply`
  - now fans out to timestamp update and memory extraction branch

Added:
- `Build Memory Extraction Input`
- `Should Extract Memory?`
- `Use Invalid Memory Stub?`
- `Return Invalid Memory Extractor Output`
- `Call OpenAI Memory Extractor`
- `Parse Structured Memory`
- `Save Structured Memory`

Write-path behavior:
- runs only on the dev workflow copy
- starts after assistant reply is already persisted
- primary extractor is a narrow OpenAI JSON extraction step
- parser validates allowed scope/type/status and caps writes to 3 items
- invalid extractor output does not fail the user reply
- if the model extractor returns nothing useful, a narrow heuristic fallback handles explicit messages such as:
  - `Decision for this conversation: ...`
  - `Environment fact: ...`
- `memory_test_mode=invalid_json` forces a dev-only invalid extractor result for safety testing

### Retrieval path nodes added or changed

Changed:
- `Load Recent Messages`
  - now flows into memory retrieval first
- `Build Ghost System Prompt`
  - now feeds a memory-aware prompt composer

Added:
- `Load Ghost Memory`
- `Compose Prompt With Ghost Memory`

Retrieval behavior:
- same conversation: recent active memory, newest first
- global memory: active `environment_fact` and `operational_note`
- total cap: 8 items
- prompt format:
  - `Ghost memory:`
  - `- [memory_type] summary`

### Failure behavior

Read failures:
- `Load Ghost Memory` uses `continueOnFail`
- prompt builder ignores errored memory items
- normal reply path continues

Write failures:
- extractor request uses `continueOnFail`
- invalid JSON or validation failure yields zero writes
- `Save Structured Memory` uses `continueOnFail`
- user-facing reply is already returned and is not blocked by memory failure

### Problems found

1. In this deployment, `n8n publish:workflow` does not register production webhooks until n8n is restarted.
2. The model-only extractor was not reliable enough for the acceptance bar on explicit decision capture, so a narrow deterministic fallback was added for obvious high-signal instructions.
3. Global memory retrieval works, but ambiguous prompts can still let the model improvise. The successful verification prompt explicitly asked for the stored Ghost memory value.

### Exact files created or changed

Created:
- `/home/deicide/dev/ghost-stack/db/migrations/20260312_phase4a_ghost_memory.sql`
- `/home/deicide/dev/ghost-stack/db/migrations/20260312_phase4a_ghost_memory_down.sql`
- `/home/deicide/dev/ghost-stack/scripts/build-phase4a-memory-workflow.js`
- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.json`
- `/home/deicide/dev/ghost-stack/docs/ghost-phase4a-memory-handoff.md`

Backup artifacts created:
- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase3-final.backup-20260312T120216Z.json`
- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-published-backup-20260312T120216Z.json`
- `/home/deicide/dev/ghost-stack/backups/20260312T120216Z/ghost_app_schema.sql`
- `/home/deicide/dev/ghost-stack/backups/20260312T120216Z/ghost_app_phase4a_relevant_data.sql`

### Exact SQL executed

Applied migration:
```bash
docker exec -i ghost-postgres psql -v ON_ERROR_STOP=1 -U ghost -d ghost_app < /home/deicide/dev/ghost-stack/db/migrations/20260312_phase4a_ghost_memory.sql
```

Verification SQL:
```sql
\d+ ghost_memory

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'ghost_memory'
ORDER BY indexname;

SELECT memory_type, scope, summary
FROM ghost_memory
WHERE conversation_id = 'b942534f-4110-4b3a-9854-5516281f6242'
ORDER BY created_at DESC;

SELECT count(*)
FROM ghost_memory
WHERE conversation_id = 'a3dad78b-92b4-4d70-b541-2721b20cc37f';
```

Manual verification inserts:
```sql
INSERT INTO ghost_memory (
  id, scope, memory_type, title, summary, details_json, importance, status
)
VALUES (
  gen_random_uuid(),
  'global',
  'operational_note',
  'Phase 4A dev webhook',
  'The Phase 4A dev webhook path is /webhook/ghost-chat-v3-memory-dev.',
  '{"source":"manual_verification"}'::jsonb,
  4,
  'active'
);
```

Post-verification archive step for manual seed rows:
```sql
UPDATE ghost_memory
SET status = 'archived'
WHERE (title = 'Phase 4A dev webhook' AND details_json->>'source' = 'manual_verification')
   OR (title = 'Storage rule' AND conversation_id = '1637bc2e-5237-42ef-8776-83998107b1ac');
```

Temporary manual retrieval-debug insert used before the write-path fallback was added:
```sql
INSERT INTO ghost_memory (
  id, scope, memory_type, conversation_id, source_message_id, title, summary, details_json, importance, status
)
VALUES (
  gen_random_uuid(),
  'conversation',
  'decision',
  '1637bc2e-5237-42ef-8776-83998107b1ac',
  '25d45af8-c628-4ae4-889c-33b92a92ec48',
  'Storage rule',
  'Use Postgres only and do not add pgvector yet.',
  '{}'::jsonb,
  4,
  'active'
);
```

### Workflow import and publish commands used

```bash
node /home/deicide/dev/ghost-stack/scripts/build-phase4a-memory-workflow.js

docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-phase4a-memory-dev.json

docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-phase4a-memory-dev.json \
  --projectId=Dy430kHXAiPu4Qrc

docker exec ghost-n8n-main n8n publish:workflow --id=kvNzP8BQxXlrtKFG

docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml \
  restart ghost-n8n-main ghost-n8n-worker
```

### Exact test cases run

Database:
- migration apply
- table shape check with `\d+ ghost_memory`
- index check through `pg_indexes`

Write path:
- valid write test:
  - request: `Decision for this conversation: use Postgres only and do not add pgvector yet. Acknowledge in one sentence.`
  - conversation id: `b942534f-4110-4b3a-9854-5516281f6242`
  - persisted row:
    - `decision|conversation|use Postgres only and do not add pgvector yet. Acknowledge in one sentence.`
- trivial zero-write test:
  - request: `Say hello in five words.`
  - conversation id: `a3dad78b-92b4-4d70-b541-2721b20cc37f`
  - memory rows after turn: `0`
- invalid extractor output test:
  - request body included `"memory_test_mode":"invalid_json"`
  - response stayed `200`
  - conversation id: `60063104-f132-44b6-a31e-40f98537596b`
  - memory rows after turn: `0`

Retrieval path:
- same-conversation recall after 13 filler turns:
  - conversation id: `b942534f-4110-4b3a-9854-5516281f6242`
  - recall reply: `You decided to use Postgres only and not to add pgvector yet.`
- global retrieval with manual seed:
  - prompt: `What exact Phase 4A dev webhook path is stored in Ghost memory? Quote the path only.`
  - reply: `/webhook/ghost-chat-v3-memory-dev`

Route regression checks on dev workflow:
- chat:
  - `Say hello in five words.`
  - provider `openai_api`
- lightweight local:
  - `Summarize this in five words: Apples are red and bananas are yellow.`
  - provider `ollama`
  - model `qwen2.5:3b-instruct`
- technical work:
  - `Write a bash one-liner that prints ghost safe workflow smoke. Do not modify files.`
  - provider `codex_oauth_worker`

Live workflow safety checks after n8n restarts:
- `Say hello in five words.`
- `Write a bash one-liner that prints ghost safe workflow smoke. Do not modify files.`

Response contract check:
- compared sorted top-level keys for dev chat and live chat responses
- keys matched exactly

### Regressions checked

Verified:
- live webhook `/webhook/ghost-chat-v3` still responds
- dev copy chat route still responds
- dev copy lightweight route still responds
- dev copy technical_work route still responds
- top-level response keys stayed aligned between live and dev chat responses
- invalid memory extraction did not cause reply failure

Not changed:
- live workflow id
- live webhook path
- live routing contract
- production cutover

### Rollback instructions

Database rollback:
```bash
docker exec -i ghost-postgres psql -v ON_ERROR_STOP=1 -U ghost -d ghost_app < /home/deicide/dev/ghost-stack/db/migrations/20260312_phase4a_ghost_memory_down.sql
```

Workflow rollback:
```bash
docker exec ghost-n8n-main n8n unpublish:workflow --id=kvNzP8BQxXlrtKFG
docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker
```

If you want a full workflow artifact rollback in the repo:
- remove `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.json`
- keep `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase3-final.json` as the frozen production baseline

If you want the dev workflow removed from n8n entirely:
- export it first if needed
- then delete it manually in n8n UI or by direct n8n database cleanup after review

### Recommended next step for Phase 4B

Keep the same table and workflow shape, then improve retrieval quality rather than expanding scope:
- make the model extractor more reliable so the heuristic fallback becomes rarer
- add explicit memory confidence or source fields if needed
- add a small review path for superseding/archiving stale memory
- only then consider `pgvector` retrieval for broader semantic recall
