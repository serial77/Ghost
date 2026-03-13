# Ghost Phase 5D Runtime Ledger

- Phase: `5D`
- Live workflow target: `Yh6h9OJyVCfREbp3`
- Live webhook: `/webhook/ghost-chat-v3`
- Backup export created before modification:
  - `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3.phase5d-backup-20260312T211951Z.json`

## Rollout

1. Apply `/home/deicide/dev/ghost-stack/db/migrations/20260312_phase5d_runtime_ledger.sql` to `ghost_app`.
2. Import `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase5d-runtime-ledger.json` into n8n.
3. Publish workflow `Yh6h9OJyVCfREbp3`.
4. Restart `ghost-n8n-main` and `ghost-n8n-worker`.

## Rollback

1. Copy the backup export into `ghost-n8n-main`:

```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3.phase5d-backup-20260312T211951Z.json \
  ghost-n8n-main:/tmp/ghost-chat-v3.phase5d-backup-20260312T211951Z.json
```

2. Re-import and publish the backup:

```bash
docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3.phase5d-backup-20260312T211951Z.json
docker exec ghost-n8n-main n8n publish:workflow --id=Yh6h9OJyVCfREbp3
docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker
```

3. Remove the DB helper functions only if the runtime rollback requires it:

```bash
docker exec -i ghost-postgres psql -U ghost -d ghost_app \
  < /home/deicide/dev/ghost-stack/db/migrations/20260312_phase5d_runtime_ledger_down.sql
```

## Current Limits

- `n8n_execution_id` is intentionally left null because this workflow path does not expose a trustworthy execution identifier through the runtime payload.
- If the workflow is interrupted catastrophically before the completion side branch runs, the ledger can retain a `running` task/run. This phase does not fake a terminal state for that case.
