# Ghost Runtime Ops Toolkit

This directory is the operator lane for the live `ghost-chat-v3` runtime on workflow `Yh6h9OJyVCfREbp3`.

It is intentionally narrow:
- live workflow activation
- post-deploy smoke checks
- runtime trace/debug queries
- memory separation/debug queries

It does not change product behavior by itself.

## Scripts

### `ops/activate-live-workflow.sh`
Primary operator promotion path for the live workflow.

Default promotion flow:
- rebuild the workflow from source
- validate the target workflow JSON before activation
- export a live backup from n8n
- import and publish the target workflow
- restart the n8n runtime containers
- verify active state and webhook registration
- run smoke by default
- automatically roll back to the pre-activation export if smoke fails

Examples:

```bash
ops/activate-live-workflow.sh
ops/activate-live-workflow.sh --delegated-smoke
ops/activate-live-workflow.sh --skip-build
ops/activate-live-workflow.sh --skip-smoke
ops/activate-live-workflow.sh --rollback-from workflows/ghost-chat-v3-live-backup-<STAMP>.json
```

Important deployment note:
- In this n8n `2.11.3` stack, import/publish changes do not fully take effect until `ghost-n8n-main` and `ghost-n8n-worker` are restarted.

Operator usage:

```bash
# Standard promotion path, including backup, validation, activation, probe, and auto-rollback on probe failure.
ops/activate-live-workflow.sh

# Heavier probe that also exercises delegated runtime behavior.
ops/activate-live-workflow.sh --delegated-smoke

# Exact manual rollback command if you need to restore a captured export later.
ops/activate-live-workflow.sh --rollback-from workflows/ghost-chat-v3-live-backup-<STAMP>.json
```

Notes:
- The shared ops defaults now resolve `PROJECT_ROOT` from the checked-out repo containing the script, so running from `~/dev/ghost-stack-codex` uses that lane's workflow JSON and builder by default.
- `--no-rollback` disables the automatic rollback step and prints the exact manual rollback command if smoke fails.

### `ops/smoke-runtime.sh`
Lightweight runtime health check for operators.

Checks:
- n8n reachable
- workflow active
- webhook registered
- Postgres reachable
- Redis reachable
- normal chat POST works
- optional delegated technical POST works
- `n8n_execution_id` and linked DB records exist

Examples:

```bash
ops/smoke-runtime.sh
ops/smoke-runtime.sh --include-delegated
ops/smoke-runtime.sh --json
```

### `ops/trace-runtime.sh`
Trace live runtime records by a single selector.

Examples:

```bash
ops/trace-runtime.sh --execution-id 473
ops/trace-runtime.sh --conversation-id 64660f03-759b-4b19-a602-d53a924b3544
ops/trace-runtime.sh --delegation-id b6aeb49e-7034-42dc-9dc3-1c68d54c8eb8
ops/trace-runtime.sh --runtime-task-id 261cf6f7-a189-447b-816e-48ce3a161485
ops/trace-runtime.sh --latest 10
ops/trace-runtime.sh --latest-failures 10
```

### `ops/reconcile-runtime.sh`
Lightweight reconciliation report across delegation, task, task_run, message, and tool-event truth layers.

Checks:
- stale or orphaned `conversation_delegations`
- stuck or contradictory `tasks` / `task_runs`
- recent rows missing `n8n_execution_id` where the current flow should normally provide it
- recent cross-layer disagreement between delegation state and linked runtime/message metadata

Examples:

```bash
ops/reconcile-runtime.sh
ops/reconcile-runtime.sh --stale-minutes 15 --recent-hours 6
ops/reconcile-runtime.sh --limit 50
```

### `ops/trace-memory.sh`
Trace parent/worker memory separation and conversation memory state.

Examples:

```bash
ops/trace-memory.sh --conversation-id 64660f03-759b-4b19-a602-d53a924b3544
ops/trace-memory.sh --worker-conversation-id 0da18328-f449-4688-b21d-222c543b37f9
ops/trace-memory.sh --delegation-id b6aeb49e-7034-42dc-9dc3-1c68d54c8eb8
ops/trace-memory.sh --runtime-task-id 261cf6f7-a189-447b-816e-48ce3a161485
ops/trace-memory.sh --latest-memory 20
```

## Assumptions

- Docker containers use the current names from `base/docker-compose.yml`
- `ghost_core` holds n8n workflow metadata
- `ghost_app` holds Ghost conversations, tasks, task runs, tool events, and memory
- the live production webhook remains `POST /webhook/ghost-chat-v3`

## Safety Notes

- The smoke script defaults to one normal parent-chat request only.
- Delegated smoke is opt-in because it is heavier and can consume more runtime/provider work.
- None of these scripts modify the Ghost orchestration contract.
