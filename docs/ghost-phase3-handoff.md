## Ghost Phase 3 Handoff

Status:
- Live workflow name: `GHOST by Codex`
- Live workflow id: `Yh6h9OJyVCfREbp3`
- Live webhook path: `ghost-chat-v3`
- Phase 3 is live and near-final; this handoff reflects the post-polish target baseline.

Stable route classes:
- `chat`
  - provider: `openai_api`
  - model: `gpt-4.1-mini`
- `lightweight_local_task`
  - provider: `ollama`
  - model: `qwen2.5:3b-instruct`
- `technical_work`
  - provider: `codex_oauth_worker`
  - model: `gpt-5.4`
  - fallback chain remains local coder models in policy config, but current stable success path is Codex safe execution

Current response contract:
- Preserved top-level fields:
  - `conversation_id`
  - `reply`
  - `provider_used`
  - `model_used`
  - `task_class`
- Current normalized extra fields:
  - `approval_required` as boolean
  - `risk_level` as string
  - `risk_reasons` as array
  - `task_summary` as concise string
  - `command_success` as boolean
  - `command_exit_code` as integer or `null`
  - `stdout_summary` as concise string
  - `stderr_summary` as concise string
  - `artifact_path` as absolute path or `null`
  - `codex_command_status` as string
  - `error_type` as string or `null`

Approval logic:
- Approval assessment runs after route selection and before provider execution.
- Enforcement only applies to Codex-bound requests.
- `approval_required=true` blocks Codex execution and returns structured metadata instead of running the command.
- Current destructive/caution matching covers:
  - file deletion and removal requests
  - live Docker lifecycle changes
  - destructive SQL
  - moves/renames of critical runtime files
  - edits touching critical runtime config or live workflow identifiers

Artifact and log capture:
- Artifact base directory:
  - `/home/node/.n8n/ghost-artifacts`
- Successful Codex runs write:
  - `*.reply.txt`
  - `*.stdout.txt`
  - `*.stderr.txt`
- `artifact_path` points to the reply artifact.
- Assistant message metadata in `ghost_app.messages` stores concise summaries and the reply artifact path, not large raw blobs.
- Successful Codex `stderr_summary` is filtered to reduce banner/session noise while keeping meaningful failure text when present.

Runtime dependencies to preserve:
- `N8N_ENABLE_EXECUTE_COMMAND=true`
- `NODE_FUNCTION_ALLOW_EXTERNAL=*`
- worker mount: `/home/deicide/.codex:/home/node/.codex`
- worker mount: `/home/deicide/bin/codex-auth.sh:/opt/ghost/bin/codex-auth.sh:ro`
- worker mount: `/home/deicide/dev/ghost-stack/base/bin/codex-safe:/opt/ghost/bin/codex-safe:ro`
- current publish + restart behavior for n8n main/worker

Backup, export, restore:
- Fresh live backup before promotion:
  - `docker exec ghost-n8n-main n8n export:workflow --id Yh6h9OJyVCfREbp3 --output /tmp/live-export.json`
  - `docker cp ghost-n8n-main:/tmp/live-export.json /home/deicide/dev/ghost-stack/workflows/<backup-name>.json`
- Import updated workflow:
  - `docker exec ghost-n8n-main n8n import:workflow --input=/tmp/ghost-chat-v3-phase3-final.json`
- Publish:
  - `docker exec ghost-n8n-main n8n update:workflow --id Yh6h9OJyVCfREbp3 --active=true`
  - `docker exec ghost-n8n-main n8n export:workflow --id Yh6h9OJyVCfREbp3 --output /tmp/post-publish.json`
- Restart to apply published version in this setup:
  - `docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker`
- Restore rollback from backup:
  - copy backup JSON into the container
  - import that backup over the same workflow id
  - publish if needed
  - restart main and worker

Recommended curl smoke tests:
```bash
curl -sS -X POST http://127.0.0.1:5678/webhook/ghost-chat-v3 \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say hello in five words."}' | python3 -m json.tool

curl -sS -X POST http://127.0.0.1:5678/webhook/ghost-chat-v3 \
  -H 'Content-Type: application/json' \
  -d '{"message":"Summarize this in five words: Ghost is routing work safely."}' | python3 -m json.tool

curl -sS -X POST http://127.0.0.1:5678/webhook/ghost-chat-v3 \
  -H 'Content-Type: application/json' \
  -d '{"message":"Write a bash one-liner that prints ghost safe workflow smoke. Do not modify files."}' | python3 -m json.tool

curl -sS -X POST http://127.0.0.1:5678/webhook/ghost-chat-v3 \
  -H 'Content-Type: application/json' \
  -d '{"message":"Run rm -rf on a temp folder and docker compose restart the service."}' | python3 -m json.tool
```

Recommended DB verification queries:
```sql
SELECT role, model_name, metadata
FROM messages
WHERE conversation_id = '<conversation-id>'
ORDER BY created_at;

SELECT id, metadata IS NOT NULL AS has_metadata, jsonb_typeof(metadata) AS metadata_type
FROM messages
WHERE role = 'assistant'
ORDER BY created_at DESC
LIMIT 20;
```

After live workflow promotion:
- export one more post-publish backup
- restart `ghost-n8n-main` and `ghost-n8n-worker`
- rerun the four route smoke tests
- verify one same-conversation Codex follow-up
- verify assistant metadata JSON shape in `ghost_app.messages`
- verify the latest successful Codex `artifact_path` exists on disk

Known limitations:
- Approval rules are still keyword/pattern based rather than intent-classifier based.
- Codex failures still depend on CLI/runtime behavior and wrapper availability.
- n8n published workflow changes still require container restart in this deployment pattern.
- Artifact indexing is file-path based only; artifacts are not yet mirrored into the `ghost_app.artifacts` table.

Canonical post-Phase-3 baseline:
- Treat `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase3-final.json` as the canonical post-Phase-3 workflow export after live promotion and verification.

Phase 4 next:
- Start with structured Postgres memory in `ghost_app`.
- Add retrieval with `pgvector` only after memory write/read flows are stable.
- Keep future workers documentation-first until memory is in place.
