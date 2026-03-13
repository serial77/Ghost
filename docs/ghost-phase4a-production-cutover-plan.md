## Ghost Phase 4A Production Cutover Plan

Status:
- This document is a plan only
- Live production remains unchanged in this task
- Live workflow remains `Yh6h9OJyVCfREbp3`
- Live webhook remains `/webhook/ghost-chat-v3`

Prepared artifact:
- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-prod-ready.json`

Prepared artifact properties:
- workflow id set to `Yh6h9OJyVCfREbp3`
- webhook path set to `ghost-chat-v3`
- `active = false`
- intended for controlled promotion only

### Recommendation

Use the prepared prod-ready export to replace the live workflow definition in a controlled cutover.

Preferred method:
- promote the dev memory logic into the live workflow by importing the prod-ready artifact over the existing live workflow id
- then publish and reactivate explicitly

Reason:
- keeps workflow identity stable
- preserves the live webhook path
- avoids ambiguity from running parallel prod-like workflows with the same route

### Prerequisites

1. Dev validation must still be green
   - `/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh`
   - expected: `13 passed, 0 failed`

2. Postgres migration must already exist in production DB
   - `ghost_memory` table present
   - expected columns/indexes/checks present

3. Current live export must be backed up
   - workflow id `Yh6h9OJyVCfREbp3`

4. Operators must have restart access for:
   - `ghost-n8n-main`
   - `ghost-n8n-worker`

### Exact backup steps

1. Export current live workflow:

```bash
docker exec ghost-n8n-main n8n export:workflow \
  --id=Yh6h9OJyVCfREbp3 \
  --output=/tmp/ghost-chat-v3-live-pre-phase4a.json

docker cp ghost-n8n-main:/tmp/ghost-chat-v3-live-pre-phase4a.json \
  /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-live-pre-phase4a.json
```

2. Back up current workflow publish state if desired:

```bash
docker exec ghost-n8n-main n8n export:workflow \
  --id=kvNzP8BQxXlrtKFG \
  --output=/tmp/ghost-chat-v3-memory-dev-reference.json
```

3. Back up relevant DB data:

```bash
mkdir -p /home/deicide/dev/ghost-stack/backups/phase4a-cutover

docker exec ghost-postgres pg_dump -U ghost -d ghost_app \
  --table=ghost_memory \
  --data-only \
  > /home/deicide/dev/ghost-stack/backups/phase4a-cutover/ghost_memory_data.sql
```

### Exact workflow import / publish plan

1. Copy prod-ready artifact into `ghost-n8n-main`:

```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-prod-ready.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-phase4a-prod-ready.json
```

2. Import it over the live workflow id:

```bash
docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-phase4a-prod-ready.json \
  --projectId=Dy430kHXAiPu4Qrc
```

3. Publish the live workflow:

```bash
docker exec ghost-n8n-main n8n publish:workflow --id=Yh6h9OJyVCfREbp3
```

4. Reactivate it explicitly:

```bash
docker exec ghost-n8n-main n8n update:workflow --id=Yh6h9OJyVCfREbp3 --active=true
```

5. Restart n8n services so the published workflow is served:

```bash
docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker
```

### Immediate post-cutover smoke tests

Run these immediately after restart:

1. Live chat smoke

```bash
curl -sS -X POST http://127.0.0.1:5678/webhook/ghost-chat-v3 \
  -H 'Content-Type: application/json' \
  -d '{"conversation_id":"'"$(uuidgen | tr 'A-Z' 'a-z')"'", "message":"Reply with exactly: phase4a live smoke"}'
```

Expected:
- HTTP `200`
- reply `phase4a live smoke`

2. Live technical-work smoke

```bash
curl -sS -X POST http://127.0.0.1:5678/webhook/ghost-chat-v3 \
  -H 'Content-Type: application/json' \
  -d '{"conversation_id":"'"$(uuidgen | tr 'A-Z' 'a-z')"'", "message":"Implement a tiny SQL example, with commas, and keep it to two lines."}'
```

Expected:
- HTTP `200`
- technical_work route still succeeds

3. Live lightweight-local smoke

```bash
curl -sS -X POST http://127.0.0.1:5678/webhook/ghost-chat-v3 \
  -H 'Content-Type: application/json' \
  -d '{"conversation_id":"'"$(uuidgen | tr 'A-Z' 'a-z')"'", "message":"Summarize this, with commas, into three bullets: apples, oranges, bananas.", "force_task_class":"lightweight_local_task"}'
```

Expected:
- HTTP `200`
- lightweight_local_task route still succeeds

4. Live memory smoke

```bash
live_memory_conv=$(uuidgen | tr 'A-Z' 'a-z')

curl -sS -X POST http://127.0.0.1:5678/webhook/ghost-chat-v3 \
  -H 'Content-Type: application/json' \
  -d "{\"conversation_id\":\"$live_memory_conv\",\"message\":\"Architectural decision: use Postgres for Ghost memory first and do not add pgvector in this phase. Confirm briefly.\"}"
```

Then confirm one active row:

```bash
docker exec ghost-postgres psql -U ghost -d ghost_app -At -c \
  "SELECT memory_type, summary FROM ghost_memory WHERE conversation_id='$live_memory_conv'::uuid AND status='active';"
```

### Success criteria for cutover

Cutover is successful only if:
- live webhook returns `200`
- chat route still works
- technical_work route still works
- lightweight_local_task route still works
- at least one explicit durable memory write works in live
- no `500` appears from the memory path
- no unexpected response-contract change appears at the top level

### Rollback plan

1. Restore the pre-cutover live export:

```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-live-pre-phase4a.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-live-pre-phase4a.json

docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-live-pre-phase4a.json \
  --projectId=Dy430kHXAiPu4Qrc
```

2. Publish and reactivate the restored live workflow:

```bash
docker exec ghost-n8n-main n8n publish:workflow --id=Yh6h9OJyVCfREbp3
docker exec ghost-n8n-main n8n update:workflow --id=Yh6h9OJyVCfREbp3 --active=true
```

3. Restart n8n services:

```bash
docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker
```

4. Re-run the live chat smoke to confirm rollback success.

### Recommendation on keeping the dev webhook

Recommendation:
- keep `/webhook/ghost-chat-v3-memory-dev` during the initial live observation window
- use it for verification and comparison only
- remove or retire it only after live Phase 4A behavior is stable enough that the extra endpoint is no longer useful
