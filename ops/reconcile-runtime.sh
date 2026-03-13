#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ghost-ops-common.sh"

STALE_MINUTES="${STALE_MINUTES:-30}"
RECENT_HOURS="${RECENT_HOURS:-24}"
ROW_LIMIT="${ROW_LIMIT:-20}"

usage() {
  cat <<'EOF'
Usage:
  ops/reconcile-runtime.sh [--stale-minutes N] [--recent-hours N] [--limit N]

What it checks:
  - stale or orphaned conversation_delegations
  - running task/task_run rows that look stuck or contradictory
  - recent rows missing execution/correlation metadata that current flows normally provide
  - recent delegation/runtime state disagreement across delegation, task, task_run, and assistant metadata
EOF
}

while (($# > 0)); do
  case "$1" in
    --stale-minutes)
      STALE_MINUTES="$2"
      shift 2
      ;;
    --recent-hours)
      RECENT_HOURS="$2"
      shift 2
      ;;
    --limit)
      ROW_LIMIT="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

require_cmds bash docker
[[ "$STALE_MINUTES" =~ ^[0-9]+$ ]] || fail "--stale-minutes must be an integer"
[[ "$RECENT_HOURS" =~ ^[0-9]+$ ]] || fail "--recent-hours must be an integer"
[[ "$ROW_LIMIT" =~ ^[0-9]+$ ]] || fail "--limit must be an integer"

STALE_INTERVAL="${STALE_MINUTES} minutes"
RECENT_INTERVAL="${RECENT_HOURS} hours"

section() {
  printf '\n== %s ==\n' "$1"
}

run_check() {
  local title="$1"
  local count_sql="$2"
  local detail_sql="$3"
  local count
  section "$title"
  count="$(psql_app_at "$count_sql")"
  [[ "${count:-0}" =~ ^[0-9]+$ ]] || fail "invalid reconciliation count for '$title': ${count:-<empty>}"
  if (( count == 0 )); then
    printf 'OK no findings\n'
    return 0
  fi
  printf 'FOUND %s\n' "$count"
  psql_app "$detail_sql"
}

run_check \
  "Delegation Reconciliation" \
  "WITH latest_runtime_run AS (
     SELECT DISTINCT ON (task_id)
       task_id,
       status,
       started_at,
       finished_at
     FROM task_runs
     ORDER BY task_id, started_at DESC NULLS LAST, id DESC
   )
   SELECT COUNT(*)
   FROM conversation_delegations d
   LEFT JOIN conversations parent_conv ON parent_conv.id = d.parent_conversation_id
   LEFT JOIN conversations worker_conv ON worker_conv.id = d.worker_conversation_id
   LEFT JOIN tasks runtime_task ON runtime_task.id = d.runtime_task_id
   LEFT JOIN tasks orchestration_task ON orchestration_task.id = d.orchestration_task_id
   LEFT JOIN latest_runtime_run latest_run ON latest_run.task_id = d.runtime_task_id
   WHERE parent_conv.id IS NULL
      OR worker_conv.id IS NULL
      OR (d.runtime_task_id IS NOT NULL AND runtime_task.id IS NULL)
      OR (d.orchestration_task_id IS NOT NULL AND orchestration_task.id IS NULL)
      OR (d.status IN ('queued', 'running') AND COALESCE(d.updated_at, d.created_at) < NOW() - INTERVAL '$STALE_INTERVAL')
      OR (d.status IN ('succeeded', 'failed', 'blocked') AND d.completed_at IS NULL)
      OR (d.status = 'succeeded' AND runtime_task.status IS DISTINCT FROM 'succeeded')
      OR (d.status IN ('failed', 'blocked') AND runtime_task.id IS NOT NULL AND runtime_task.status NOT IN ('failed', 'succeeded'))
      OR (d.status = 'running' AND latest_run.status = 'succeeded');" \
  "WITH latest_runtime_run AS (
     SELECT DISTINCT ON (task_id)
       task_id,
       id AS task_run_id,
       status,
       started_at,
       finished_at
     FROM task_runs
     ORDER BY task_id, started_at DESC NULLS LAST, id DESC
   ),
   findings AS (
     SELECT
       CASE
         WHEN parent_conv.id IS NULL THEN 'missing_parent_conversation'
         WHEN worker_conv.id IS NULL THEN 'missing_worker_conversation'
         WHEN d.runtime_task_id IS NOT NULL AND runtime_task.id IS NULL THEN 'missing_runtime_task'
         WHEN d.orchestration_task_id IS NOT NULL AND orchestration_task.id IS NULL THEN 'missing_orchestration_task'
         WHEN d.status IN ('queued', 'running') AND COALESCE(d.updated_at, d.created_at) < NOW() - INTERVAL '$STALE_INTERVAL' THEN 'stale_non_terminal_delegation'
         WHEN d.status IN ('succeeded', 'failed', 'blocked') AND d.completed_at IS NULL THEN 'terminal_delegation_missing_completed_at'
         WHEN d.status = 'succeeded' AND runtime_task.status IS DISTINCT FROM 'succeeded' THEN 'delegation_runtime_status_mismatch'
         WHEN d.status IN ('failed', 'blocked') AND runtime_task.id IS NOT NULL AND runtime_task.status NOT IN ('failed', 'succeeded') THEN 'terminal_delegation_runtime_not_terminal'
         WHEN d.status = 'running' AND latest_run.status = 'succeeded' THEN 'delegation_still_running_after_successful_run'
       END AS issue_code,
       d.id AS delegation_id,
       d.status AS delegation_status,
       d.parent_conversation_id,
       d.worker_conversation_id,
       d.orchestration_task_id,
       d.runtime_task_id,
       runtime_task.status AS runtime_task_status,
       latest_run.task_run_id,
       latest_run.status AS latest_run_status,
       AGE(NOW(), COALESCE(d.updated_at, d.created_at)) AS age,
       d.updated_at,
       d.completed_at,
       LEFT(COALESCE(d.request_summary, ''), 120) AS request_summary
     FROM conversation_delegations d
     LEFT JOIN conversations parent_conv ON parent_conv.id = d.parent_conversation_id
     LEFT JOIN conversations worker_conv ON worker_conv.id = d.worker_conversation_id
     LEFT JOIN tasks runtime_task ON runtime_task.id = d.runtime_task_id
     LEFT JOIN tasks orchestration_task ON orchestration_task.id = d.orchestration_task_id
     LEFT JOIN latest_runtime_run latest_run ON latest_run.task_id = d.runtime_task_id
   )
   SELECT *
   FROM findings
   WHERE issue_code IS NOT NULL
   ORDER BY updated_at DESC NULLS LAST, delegation_id DESC
   LIMIT $ROW_LIMIT;"

run_check \
  "Task And Run Reconciliation" \
  "WITH latest_run AS (
     SELECT DISTINCT ON (task_id)
       task_id,
       id,
       status,
       started_at,
       finished_at,
       n8n_execution_id
     FROM task_runs
     ORDER BY task_id, started_at DESC NULLS LAST, id DESC
   )
   SELECT COUNT(*)
   FROM tasks t
   LEFT JOIN latest_run lr ON lr.task_id = t.id
   WHERE (t.status = 'running' AND COALESCE(t.started_at, t.updated_at, t.created_at) < NOW() - INTERVAL '$STALE_INTERVAL')
      OR (lr.status = 'running' AND lr.started_at < NOW() - INTERVAL '$STALE_INTERVAL')
      OR (t.status = 'running' AND lr.status IN ('succeeded', 'failed'))
      OR (t.status = 'succeeded' AND lr.status = 'failed')
      OR (t.status = 'failed' AND lr.status = 'succeeded')
      OR (t.status IN ('succeeded', 'failed') AND t.completed_at IS NULL);" \
  "WITH latest_run AS (
     SELECT DISTINCT ON (task_id)
       task_id,
       id AS task_run_id,
       status,
       started_at,
       finished_at,
       n8n_execution_id
     FROM task_runs
     ORDER BY task_id, started_at DESC NULLS LAST, id DESC
   ),
   findings AS (
     SELECT
       CASE
         WHEN t.status = 'running' AND COALESCE(t.started_at, t.updated_at, t.created_at) < NOW() - INTERVAL '$STALE_INTERVAL' THEN 'stale_running_task'
         WHEN lr.status = 'running' AND lr.started_at < NOW() - INTERVAL '$STALE_INTERVAL' THEN 'stale_running_task_run'
         WHEN t.status = 'running' AND lr.status IN ('succeeded', 'failed') THEN 'task_status_not_finalized_after_run'
         WHEN t.status = 'succeeded' AND lr.status = 'failed' THEN 'task_succeeded_but_latest_run_failed'
         WHEN t.status = 'failed' AND lr.status = 'succeeded' THEN 'task_failed_but_latest_run_succeeded'
         WHEN t.status IN ('succeeded', 'failed') AND t.completed_at IS NULL THEN 'terminal_task_missing_completed_at'
       END AS issue_code,
       t.id AS task_id,
       t.source,
       t.task_type,
       t.status AS task_status,
       lr.task_run_id,
       lr.status AS latest_run_status,
       lr.n8n_execution_id,
       AGE(NOW(), COALESCE(lr.started_at, t.started_at, t.updated_at, t.created_at)) AS age,
       t.updated_at,
       t.completed_at,
       LEFT(COALESCE(t.title, ''), 120) AS title
     FROM tasks t
     LEFT JOIN latest_run lr ON lr.task_id = t.id
   )
   SELECT *
   FROM findings
   WHERE issue_code IS NOT NULL
   ORDER BY updated_at DESC NULLS LAST, task_id DESC
   LIMIT $ROW_LIMIT;"

run_check \
  "Recent Metadata Coverage" \
  "WITH recent_runtime_tasks AS (
     SELECT id, context
     FROM tasks
     WHERE created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND source IN ('ghost_runtime', 'ghost_worker_runtime')
   )
   SELECT COUNT(*)
   FROM (
     SELECT t.id
     FROM tasks t
     WHERE t.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND t.source IN ('ghost_runtime', 'ghost_worker_runtime')
       AND COALESCE(t.context ->> 'n8n_execution_id', '') = ''
     UNION ALL
     SELECT tr.id
     FROM task_runs tr
     JOIN tasks t ON t.id = tr.task_id
     WHERE tr.started_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND t.source IN ('ghost_runtime', 'ghost_worker_runtime')
       AND COALESCE(tr.n8n_execution_id, '') = ''
     UNION ALL
     SELECT d.id
     FROM conversation_delegations d
     WHERE d.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND (d.runtime_task_id IS NOT NULL OR d.status <> 'queued')
       AND COALESCE(d.metadata ->> 'n8n_execution_id', '') = ''
     UNION ALL
     SELECT m.id
     FROM messages m
     LEFT JOIN tasks runtime_task ON runtime_task.id = NULLIF(m.metadata ->> 'runtime_task_id', '')::uuid
     WHERE m.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND m.role = 'assistant'
       AND (
         COALESCE(m.metadata ->> 'delegation_id', '') <> ''
         OR COALESCE(m.metadata ->> 'runtime_task_id', '') <> ''
         OR COALESCE(m.metadata ->> 'worker_execution', '') = 'true'
       )
       AND (
         COALESCE(runtime_task.context ->> 'n8n_execution_id', '') <> ''
         OR COALESCE(m.metadata ->> 'delegation_id', '') <> ''
       )
       AND COALESCE(m.metadata ->> 'n8n_execution_id', '') = ''
     UNION ALL
     SELECT te.id
     FROM tool_events te
     LEFT JOIN task_runs tr ON tr.id = te.task_run_id
     JOIN recent_runtime_tasks rrt ON rrt.id = te.task_id
     WHERE te.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND COALESCE(tr.n8n_execution_id, rrt.context ->> 'n8n_execution_id', '') <> ''
       AND COALESCE(te.payload ->> 'n8n_execution_id', '') = ''
   ) findings;" \
  "WITH recent_runtime_tasks AS (
     SELECT id, context
     FROM tasks
     WHERE created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND source IN ('ghost_runtime', 'ghost_worker_runtime')
   ),
   findings AS (
     SELECT
       'task_missing_execution_id' AS issue_code,
       t.id::text AS row_id,
       t.source AS source_layer,
       t.created_at AS row_created_at,
       LEFT(COALESCE(t.title, ''), 120) AS summary,
       jsonb_build_object('task_type', t.task_type, 'status', t.status) AS context_json
     FROM tasks t
     WHERE t.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND t.source IN ('ghost_runtime', 'ghost_worker_runtime')
       AND COALESCE(t.context ->> 'n8n_execution_id', '') = ''
     UNION ALL
     SELECT
       'task_run_missing_execution_id',
       tr.id::text,
       'task_runs',
       tr.started_at,
       LEFT(COALESCE(t.title, ''), 120),
       jsonb_build_object('task_id', tr.task_id, 'status', tr.status, 'execution_target', tr.execution_target)
     FROM task_runs tr
     JOIN tasks t ON t.id = tr.task_id
     WHERE tr.started_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND t.source IN ('ghost_runtime', 'ghost_worker_runtime')
       AND COALESCE(tr.n8n_execution_id, '') = ''
     UNION ALL
     SELECT
       'delegation_missing_execution_id',
       d.id::text,
       'conversation_delegations',
       d.created_at,
       LEFT(COALESCE(d.request_summary, ''), 120),
       jsonb_build_object('status', d.status, 'runtime_task_id', d.runtime_task_id, 'orchestration_task_id', d.orchestration_task_id)
     FROM conversation_delegations d
     WHERE d.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND (d.runtime_task_id IS NOT NULL OR d.status <> 'queued')
       AND COALESCE(d.metadata ->> 'n8n_execution_id', '') = ''
     UNION ALL
     SELECT
       'assistant_message_missing_execution_id',
       m.id::text,
       'messages',
       m.created_at,
       LEFT(COALESCE(m.content, ''), 120),
       jsonb_build_object('conversation_id', m.conversation_id, 'runtime_task_id', m.metadata ->> 'runtime_task_id', 'delegation_id', m.metadata ->> 'delegation_id')
     FROM messages m
     LEFT JOIN tasks runtime_task ON runtime_task.id = NULLIF(m.metadata ->> 'runtime_task_id', '')::uuid
     WHERE m.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND m.role = 'assistant'
       AND (
         COALESCE(m.metadata ->> 'delegation_id', '') <> ''
         OR COALESCE(m.metadata ->> 'runtime_task_id', '') <> ''
         OR COALESCE(m.metadata ->> 'worker_execution', '') = 'true'
       )
       AND (
         COALESCE(runtime_task.context ->> 'n8n_execution_id', '') <> ''
         OR COALESCE(m.metadata ->> 'delegation_id', '') <> ''
       )
       AND COALESCE(m.metadata ->> 'n8n_execution_id', '') = ''
     UNION ALL
     SELECT
       'tool_event_missing_execution_id',
       te.id::text,
       'tool_events',
       te.created_at,
       LEFT(COALESCE(te.event_type, ''), 120),
       jsonb_build_object('task_id', te.task_id, 'task_run_id', te.task_run_id, 'status', te.status)
     FROM tool_events te
     LEFT JOIN task_runs tr ON tr.id = te.task_run_id
     JOIN recent_runtime_tasks rrt ON rrt.id = te.task_id
     WHERE te.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND COALESCE(tr.n8n_execution_id, rrt.context ->> 'n8n_execution_id', '') <> ''
       AND COALESCE(te.payload ->> 'n8n_execution_id', '') = ''
   )
   SELECT *
   FROM findings
   ORDER BY row_created_at DESC, issue_code
   LIMIT $ROW_LIMIT;"

run_check \
  "Recent Cross-Layer Agreement" \
  "WITH latest_runtime_run AS (
     SELECT DISTINCT ON (task_id)
       task_id,
       id,
       status,
       n8n_execution_id,
       started_at,
       finished_at
     FROM task_runs
     ORDER BY task_id, started_at DESC NULLS LAST, id DESC
   ),
   latest_parent_reply AS (
     SELECT DISTINCT ON (metadata ->> 'delegation_id')
       metadata ->> 'delegation_id' AS delegation_id,
       metadata ->> 'runtime_task_id' AS message_runtime_task_id,
       metadata ->> 'orchestration_task_id' AS message_orchestration_task_id,
       metadata ->> 'response_mode' AS response_mode,
       metadata ->> 'n8n_execution_id' AS message_execution_id,
       created_at
     FROM messages
     WHERE role = 'assistant'
       AND COALESCE(metadata ->> 'delegation_id', '') <> ''
     ORDER BY metadata ->> 'delegation_id', created_at DESC, id DESC
   )
   SELECT COUNT(*)
   FROM conversation_delegations d
   LEFT JOIN tasks runtime_task ON runtime_task.id = d.runtime_task_id
   LEFT JOIN latest_runtime_run latest_run ON latest_run.task_id = d.runtime_task_id
   LEFT JOIN latest_parent_reply parent_reply ON parent_reply.delegation_id = d.id::text
   WHERE d.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
     AND (
       (d.status = 'running' AND latest_run.status = 'succeeded')
       OR (d.status = 'succeeded' AND runtime_task.status IS DISTINCT FROM 'succeeded')
       OR (COALESCE(parent_reply.message_runtime_task_id, '') <> '' AND parent_reply.message_runtime_task_id IS DISTINCT FROM COALESCE(d.runtime_task_id::text, ''))
       OR (COALESCE(parent_reply.message_orchestration_task_id, '') <> '' AND parent_reply.message_orchestration_task_id IS DISTINCT FROM COALESCE(d.orchestration_task_id::text, ''))
       OR (COALESCE(parent_reply.response_mode, '') = 'delegated_worker_result' AND COALESCE(d.runtime_task_id::text, '') = '')
       OR (COALESCE(parent_reply.message_execution_id, '') <> '' AND latest_run.n8n_execution_id IS NOT NULL AND parent_reply.message_execution_id IS DISTINCT FROM latest_run.n8n_execution_id)
     );" \
  "WITH latest_runtime_run AS (
     SELECT DISTINCT ON (task_id)
       task_id,
       id AS task_run_id,
       status,
       n8n_execution_id,
       started_at,
       finished_at
     FROM task_runs
     ORDER BY task_id, started_at DESC NULLS LAST, id DESC
   ),
   latest_parent_reply AS (
     SELECT DISTINCT ON (metadata ->> 'delegation_id')
       metadata ->> 'delegation_id' AS delegation_id,
       id AS message_id,
       metadata ->> 'runtime_task_id' AS message_runtime_task_id,
       metadata ->> 'orchestration_task_id' AS message_orchestration_task_id,
       metadata ->> 'response_mode' AS response_mode,
       metadata ->> 'n8n_execution_id' AS message_execution_id,
       created_at
     FROM messages
     WHERE role = 'assistant'
       AND COALESCE(metadata ->> 'delegation_id', '') <> ''
     ORDER BY metadata ->> 'delegation_id', created_at DESC, id DESC
   ),
   findings AS (
     SELECT
       CASE
         WHEN d.status = 'running' AND latest_run.status = 'succeeded' THEN 'delegation_status_lagging_runtime_success'
         WHEN d.status = 'succeeded' AND runtime_task.status IS DISTINCT FROM 'succeeded' THEN 'delegation_succeeded_but_runtime_not_succeeded'
         WHEN COALESCE(parent_reply.message_runtime_task_id, '') <> '' AND parent_reply.message_runtime_task_id IS DISTINCT FROM COALESCE(d.runtime_task_id::text, '') THEN 'parent_reply_runtime_task_mismatch'
         WHEN COALESCE(parent_reply.message_orchestration_task_id, '') <> '' AND parent_reply.message_orchestration_task_id IS DISTINCT FROM COALESCE(d.orchestration_task_id::text, '') THEN 'parent_reply_orchestration_task_mismatch'
         WHEN COALESCE(parent_reply.response_mode, '') = 'delegated_worker_result' AND COALESCE(d.runtime_task_id::text, '') = '' THEN 'parent_reply_claims_worker_result_without_runtime_task'
         WHEN COALESCE(parent_reply.message_execution_id, '') <> '' AND latest_run.n8n_execution_id IS NOT NULL AND parent_reply.message_execution_id IS DISTINCT FROM latest_run.n8n_execution_id THEN 'parent_reply_execution_id_mismatch'
       END AS issue_code,
       d.id AS delegation_id,
       d.status AS delegation_status,
       d.orchestration_task_id,
       d.runtime_task_id,
       runtime_task.status AS runtime_task_status,
       latest_run.task_run_id,
       latest_run.status AS latest_run_status,
       latest_run.n8n_execution_id AS latest_run_execution_id,
       parent_reply.message_id,
       parent_reply.response_mode,
       parent_reply.message_runtime_task_id,
       parent_reply.message_orchestration_task_id,
       parent_reply.message_execution_id,
       d.updated_at
     FROM conversation_delegations d
     LEFT JOIN tasks runtime_task ON runtime_task.id = d.runtime_task_id
     LEFT JOIN latest_runtime_run latest_run ON latest_run.task_id = d.runtime_task_id
     LEFT JOIN latest_parent_reply parent_reply ON parent_reply.delegation_id = d.id::text
     WHERE d.created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
   )
   SELECT *
   FROM findings
   WHERE issue_code IS NOT NULL
   ORDER BY updated_at DESC NULLS LAST, delegation_id DESC
   LIMIT $ROW_LIMIT;"
