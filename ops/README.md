# Ghost Runtime Ops Toolkit

This directory is the operator lane for the live `ghost-chat-v3` runtime on workflow `Yh6h9OJyVCfREbp3`.

It is intentionally narrow:
- live workflow activation
- post-deploy smoke checks
- runtime trace/debug queries
- memory separation/debug queries

It does not change product behavior by itself.

## Canonical workflow promotion path

This is the canonical operator path for promoting the live workflow `Yh6h9OJyVCfREbp3` behind `POST /webhook/ghost-chat-v3`.

Preferred bounded command:

```bash
ops/promote-live-workflow-safe.sh
```

Optional variants:

```bash
ops/promote-live-workflow-safe.sh --include-delegated-probe
ops/promote-live-workflow-safe.sh --with-db-backup
ops/promote-live-workflow-safe.sh --skip-build
ops/promote-live-workflow-safe.sh --output-dir /tmp/ghost-promotion-artifacts
```

The safety envelope is:
- backup (pre-activation workflow export)
- validate (candidate artifact checks)
- activate (import/publish/restart/registration checks)
- probe (`ops/smoke-runtime.sh`)
- rollback (automatic workflow restore if activation/probe fails)

1. Optional pre-promotion DB backup:

```bash
scripts/backup-db.sh
```

2. Run the live activation with smoke gate:

```bash
ops/activate-live-workflow.sh --smoke
```

Use delegated smoke when delegation/runtime-worker behavior changed:

```bash
ops/activate-live-workflow.sh --smoke --delegated-smoke
```

Promotion contract for `ops/activate-live-workflow.sh`:
- optionally rebuilds workflow JSON from source
- captures pre-activation workflow backup at `workflows/ghost-chat-v3-live-backup-<UTCSTAMP>.json`
- imports workflow, publishes it, restarts `ghost-n8n-main` and `ghost-n8n-worker`
- verifies workflow active state and `POST /webhook/ghost-chat-v3` registration
- captures post-activation export at `workflows/ghost-chat-v3-live-post-activate-<UTCSTAMP>.json`
- fails loudly if any activation check fails

### Smoke gate semantics

Promotion is successful only when activation checks pass and smoke checks pass.

### Rollback semantics

Workflow rollback (first-line rollback):
1. Use the pre-activation backup path printed by `ops/activate-live-workflow.sh`.
2. Re-import that backup over workflow `Yh6h9OJyVCfREbp3`.
3. Publish, restart n8n runtime containers, and re-run smoke.

```bash
docker cp <pre-activation-backup>.json ghost-n8n-main:/tmp/ghost-chat-v3-rollback.json
docker exec ghost-n8n-main n8n import:workflow --input=/tmp/ghost-chat-v3-rollback.json
docker exec ghost-n8n-main n8n publish:workflow --id=Yh6h9OJyVCfREbp3
docker compose -f base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker
ops/smoke-runtime.sh
```

DB rollback is a separate decision and is not part of default workflow rollback.
- apply DB down migration or DB restore only when the promoted change included schema/data-contract changes
- if no DB migration shipped, workflow rollback alone is the expected rollback path

### Artifact handling

- pre-activation backup path is the rollback input of record for that promotion attempt
- post-activation export is for audit/diff and should not replace the rollback baseline by default
- workflow backups (`workflows/...`) and DB backups (`backups/...`) are separate artifact classes

## Scripts

### `ops/promote-live-workflow-safe.sh`
Bounded promotion wrapper for safer workflow deployment.

Behavior:
- optionally rebuilds workflow JSON from source
- validates workflow artifact identity/shape/webhook path before activation
- runs activation via `ops/activate-live-workflow.sh`
- runs post-activation smoke probes
- auto-rolls back to the pre-activation backup if activation or probes fail
- if `--skip-build` is used, no workflow rebuild is attempted

Examples:

```bash
ops/promote-live-workflow-safe.sh
ops/promote-live-workflow-safe.sh --include-delegated-probe
ops/promote-live-workflow-safe.sh --with-db-backup
ops/promote-live-workflow-safe.sh --skip-build
```

Safety boundary:
- workflow rollback is automatic inside the wrapper on activation/probe failure
- DB rollback is not automatic and remains an explicit operator decision
- rollback never targets older pre-existing backups in a reused output directory; it uses the fresh backup produced by the current wrapper run only

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
- recent direct-path parity mismatches across `tasks`, `task_runs`, assistant `messages`, and `tool_events`

Examples:

```bash
ops/reconcile-runtime.sh
ops/reconcile-runtime.sh --stale-minutes 15 --recent-hours 6
ops/reconcile-runtime.sh --limit 50
```

## Direct Path Contract

v0.1 direct owner execution is considered persistence-correct only when the same core fields remain visible across the canonical direct truth surfaces:

- API/build contract via `Build API Response`
- assistant reply metadata in `messages.metadata`
- latest `task_runs.output_payload`
- latest annotated direct `tool_events.payload`

Core fields:

- `response_mode`
- `parent_owner_label`
- `provider_used`
- `model_used`
- `task_class`
- `n8n_execution_id`
- `runtime_task_id`
- `runtime_task_run_id`
- `command_success`
- `command_exit_code`
- `error_type`
- `stdout_summary`
- `stderr_summary`
- `artifact_path`
- `codex_command_status`
- `direct_execution` marker on direct `tool_events`

Intended semantics:

- direct owner replies should use `response_mode=direct_owner_reply`
- `parent_owner_label` should reflect the resolved conversation owner kept on the parent path
- assistant metadata and `task_runs.output_payload` should agree on normalized result/error fields
- the latest direct `tool_event` should carry direct execution context and correlation, not just a thin completion row

Regression guard:

- `scripts/build-ghost-runtime-workflow.js` now asserts that the generated workflow still preserves the required direct-path contract fields in:
  - `Normalize Codex Reply`
  - `Build API Response`
  - `Save Assistant Reply`
  - `Build Runtime Ledger Completion Payload`
  - `Annotate Direct Runtime Event`

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
