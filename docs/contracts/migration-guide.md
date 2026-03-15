# Ghost Database Migration Guide

Target database: `ghost_app` (Postgres 16)
Runner: `scripts/migrate.sh`
Tracking table: `schema_migrations`

---

## 1. Overview

Ghost uses numbered, append-only SQL migration files under `db/migrations/`. The migration runner (`scripts/migrate.sh`) connects to `ghost_app`, creates the `schema_migrations` tracking table on first run, then applies every up-migration file in filename-ascending order, skipping files already recorded in the tracking table.

Every migration file is a standalone SQL transaction (`BEGIN` … `COMMIT`). Up-migrations are plain `NNN_*.sql` files. Down-migrations are `NNN_*_down.sql` files and are **never executed automatically** — they are run manually to reverse a specific migration.

The `ghost-migrate` Docker Compose service runs the runner at stack startup. Both `ghost-n8n-main` and `ghost-n8n-worker` declare `ghost-migrate: condition: service_completed_successfully` so they will not start if migration fails.

---

## 2. Adding a new migration

1. Choose the next sequence number by inspecting `db/migrations/` — take `MAX(NNN) + 1`.
2. Create `db/migrations/NNN_short_description.sql`.  Wrap all statements in `BEGIN; … COMMIT;`.  Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `CREATE OR REPLACE FUNCTION` so the file is safe to replay on a schema that already includes the change.
3. Create the corresponding `db/migrations/NNN_short_description_down.sql` that reverses every change from the up-migration (drop tables, drop columns, drop functions). The down file is never tracked by the runner — it is for operator use only.
4. Test locally:
   ```bash
   # Apply
   PGHOST=localhost PGPORT=5433 PGUSER=ghost PGPASSWORD=<pw> PGDATABASE=ghost_app \
     bash scripts/migrate.sh

   # Verify
   psql -h localhost -p 5433 -U ghost ghost_app \
     -c "SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at;"
   ```
5. Commit both files on a feature branch.

---

## 3. Running migrations

### Via Docker Compose (standard)

```bash
docker compose -f base/docker-compose.yml up ghost-migrate
```

The service exits 0 on success. n8n services will start automatically once it exits successfully.

### Manually on host (psql port 5433)

```bash
export PGHOST=localhost
export PGPORT=5433
export PGUSER=ghost
export PGPASSWORD=Pulp77fwowcata+post
export PGDATABASE=ghost_app

bash scripts/migrate.sh
```

### Inside the Docker network

```bash
docker run --rm \
  --network ghost-net \
  -e PGHOST=ghost-postgres \
  -e PGPORT=5432 \
  -e PGUSER=ghost \
  -e PGPASSWORD=Pulp77fwowcata+post \
  -e PGDATABASE=ghost_app \
  -e MIGRATIONS_DIR=/migrations \
  -v /home/deicide/dev/ghost-stack/db/migrations:/migrations:ro \
  -v /home/deicide/dev/ghost-stack/scripts/migrate.sh:/migrate.sh:ro \
  postgres:16 bash /migrate.sh
```

---

## 4. Rollback procedure

Down-migrations must be run **manually, in reverse order**, after confirming the target migration is safe to reverse.

```bash
# Example: roll back 007 then 006
psql -h localhost -p 5433 -U ghost ghost_app \
  -f db/migrations/007_runtime_observability_hardening_down.sql  # does not exist — 007 has no down
psql -h localhost -p 5433 -U ghost ghost_app \
  -f db/migrations/006_phase5gf_orchestration_controls_down.sql

# Remove tracking rows for reversed migrations
psql -h localhost -p 5433 -U ghost ghost_app -c \
  "DELETE FROM schema_migrations WHERE filename IN (
    '007_runtime_observability_hardening.sql',
    '006_phase5gf_orchestration_controls.sql'
  );"
```

After removing the tracking rows, the runner will re-apply those files on the next run.

> **Note:** `007_runtime_observability_hardening.sql` has no corresponding down-migration. Rolling it back requires manually reverting the functions to their `003_phase5d_runtime_ledger.sql` versions and the `ghost_start_delegation_runtime` function to the `005_phase5gd_openclaw_alignment.sql` version.

---

## 5. Legacy migration rename history

The six dated migration files created during Phase 4a/5d/5gc/5gd/5gf were renamed to numbered files on 2026-03-15 (TASK-001) to establish a consistent ordering convention. The mapping is:

| Old name | New name |
|---|---|
| `20260312_phase4a_ghost_memory.sql` | `002_phase4a_ghost_memory.sql` |
| `20260312_phase5d_runtime_ledger.sql` | `003_phase5d_runtime_ledger.sql` |
| `20260313_phase5gc_orchestration_tasks.sql` | `004_phase5gc_orchestration_tasks.sql` |
| `20260313_phase5gd_openclaw_alignment.sql` | `005_phase5gd_openclaw_alignment.sql` |
| `20260313_phase5gf_orchestration_controls.sql` | `006_phase5gf_orchestration_controls.sql` |
| `20260313_runtime_observability_hardening.sql` | `007_runtime_observability_hardening.sql` |

Because the `db/migrations/` directory had never been committed to git before TASK-001, there are no git renames to track — the old filenames exist only in documentation references.

**Live databases that were bootstrapped before TASK-001** (i.e., before the `schema_migrations` table existed) will have all 17 tables present but no rows in `schema_migrations`. Before running the runner against such a database, mark all existing migrations as applied:

```sql
INSERT INTO schema_migrations (filename) VALUES
  ('001_initial_schema.sql'),
  ('002_phase4a_ghost_memory.sql'),
  ('003_phase5d_runtime_ledger.sql'),
  ('004_phase5gc_orchestration_tasks.sql'),
  ('005_phase5gd_openclaw_alignment.sql'),
  ('006_phase5gf_orchestration_controls.sql'),
  ('007_runtime_observability_hardening.sql')
ON CONFLICT DO NOTHING;
```

---

## 6. Schema state reference

Current table count: **17** in `ghost_app`.

### Core application tables (from `001_initial_schema.sql`)

| Table | Purpose |
|---|---|
| `users` | Human users (owner role) |
| `agents` | AI agent registry (orchestrators + workers) |
| `conversations` | Chat session SOR; owns `owner_agent_id` since Phase 5gd |
| `messages` | Individual chat messages per conversation |
| `tasks` | Execution units tracked per runtime dispatch |
| `task_runs` | Individual run records per task (n8n execution IDs) |
| `artifacts` | Files produced by task runs |
| `approvals` | Human-in-the-loop approval requests |
| `service_health` | Point-in-time health check records |
| `tool_events` | Structured audit log of tool/runtime events |

### Extended tables (added by migrations 002–007)

| Table | Migration | Purpose |
|---|---|---|
| `ghost_memory` | 002 | Scoped memory notes per conversation/task |
| `orchestration_tasks` | 004 | Orchestration board entries for delegated work |
| `conversation_delegations` | 005 | Tracks parent→worker conversation delegation lifecycle |
| `orchestration_task_events` | 006 | Audit log of operator actions on orchestration tasks |

### Orphan tables (no migration source — bootstrapped directly)

| Table | Purpose |
|---|---|
| `ghost_governed_followthrough` | Approval-gated action queue (write-ahead pattern, pre-7C-ii) |
| `ghost_action_history` | Broad-scope action log across runtime events |
| `system_prompts` | Named system prompt store |

### Key stored functions

| Function | Version | Purpose |
|---|---|---|
| `ghost_runtime_summarize_prompt(text)` | 003/007 | Truncates prompt text to ≤140 chars |
| `ghost_runtime_start_task_ledger(…)` | 007 | Opens task + task_run at webhook entry |
| `ghost_runtime_complete_task_ledger(…)` | 007 | Closes task + task_run at webhook exit |
| `ghost_create_conversation_delegation(…)` | 005 | Creates delegation + worker conversation + orchestration task |
| `ghost_start_delegation_runtime(…)` | 007 | Opens task + task_run for a delegated worker session |
| `ghost_finalize_delegation(…)` | 005 | Closes delegation and updates orchestration task status |
| `ghost_ensure_conversation_owner(uuid)` | 005 | Sets default owner agent on a conversation if unset |
| `ghost_resolve_worker_agent(text, text)` | 005 | Maps provider string to worker agent row |
| `ghost_get_default_owner_policy()` | 005 | Returns hardcoded default owner policy (ghost-main/openai_api) |
