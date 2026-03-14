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
  - recent delegated-path mismatch checks across delegations, runtime tasks/runs, worker replies, parent replies, and tool_events
  - recent direct-path mismatch checks across tasks, task_runs, assistant metadata, and tool_events
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

run_check \
  "Recent Delegated Path Surface Parity" \
  "WITH recent_delegated_tasks AS (
     SELECT id, title, status, created_at
     FROM tasks
     WHERE created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND source = 'ghost_worker_runtime'
   ),
   latest_run AS (
     SELECT DISTINCT ON (tr.task_id)
       tr.task_id,
       tr.id AS task_run_id,
       tr.status,
       tr.n8n_execution_id,
       tr.output_payload
     FROM task_runs tr
     JOIN recent_delegated_tasks rdt ON rdt.id = tr.task_id
     ORDER BY tr.task_id, tr.started_at DESC NULLS LAST, tr.id DESC
   ),
   linked_delegation AS (
     SELECT
       d.id AS delegation_id,
       d.status AS delegation_status,
       d.orchestration_task_id,
       d.runtime_task_id,
       d.metadata,
       d.updated_at,
       d.completed_at
     FROM conversation_delegations d
     JOIN recent_delegated_tasks rdt ON rdt.id = d.runtime_task_id
   ),
   latest_worker_reply AS (
     SELECT DISTINCT ON (m.metadata ->> 'runtime_task_id')
       m.metadata ->> 'runtime_task_id' AS message_runtime_task_id,
       m.id AS message_id,
       m.metadata,
       m.created_at
     FROM messages m
     WHERE m.role = 'assistant'
       AND COALESCE(m.metadata ->> 'worker_execution', '') = 'true'
       AND COALESCE(m.metadata ->> 'runtime_task_id', '') <> ''
     ORDER BY m.metadata ->> 'runtime_task_id', m.created_at DESC, m.id DESC
   ),
   latest_parent_reply AS (
     SELECT DISTINCT ON (m.metadata ->> 'delegation_id')
       m.metadata ->> 'delegation_id' AS delegation_id,
       m.id AS message_id,
       m.metadata,
       m.created_at
     FROM messages m
     WHERE m.role = 'assistant'
       AND COALESCE(m.metadata ->> 'delegation_id', '') <> ''
       AND COALESCE(m.metadata ->> 'worker_execution', '') <> 'true'
       AND COALESCE(m.metadata ->> 'response_mode', '') LIKE 'delegated_%'
     ORDER BY m.metadata ->> 'delegation_id', m.created_at DESC, m.id DESC
   ),
   latest_completion_event AS (
     SELECT DISTINCT ON (te.task_id)
       te.task_id,
       te.id AS tool_event_id,
       te.task_run_id,
       te.payload,
       te.created_at
     FROM tool_events te
     JOIN recent_delegated_tasks rdt ON rdt.id = te.task_id
     WHERE te.event_type = 'delegation_completed'
     ORDER BY te.task_id, te.created_at DESC, te.id DESC
   )
   SELECT COUNT(*)
   FROM (
     SELECT rdt.id
     FROM recent_delegated_tasks rdt
     LEFT JOIN latest_run lr ON lr.task_id = rdt.id
     LEFT JOIN linked_delegation ld ON ld.runtime_task_id = rdt.id
     LEFT JOIN latest_worker_reply lwr ON lwr.message_runtime_task_id = rdt.id::text
     LEFT JOIN latest_parent_reply lpr ON lpr.delegation_id = ld.delegation_id::text
     LEFT JOIN latest_completion_event lce ON lce.task_id = rdt.id
     WHERE ld.delegation_id IS NULL
        OR ld.orchestration_task_id IS NULL
        OR (ld.delegation_status = 'running' AND lr.status IN ('succeeded', 'failed'))
        OR (ld.delegation_status = 'succeeded' AND lr.status IS DISTINCT FROM 'succeeded')
        OR (ld.delegation_status = 'failed' AND lr.status IS DISTINCT FROM 'failed')
        OR (lwr.message_id IS NOT NULL AND COALESCE(lwr.metadata ->> 'runtime_task_id', '') = '')
        OR (lwr.message_id IS NOT NULL AND lwr.metadata ->> 'runtime_task_id' IS DISTINCT FROM rdt.id::text)
        OR (lwr.message_id IS NOT NULL AND COALESCE(lwr.metadata ->> 'runtime_task_run_id', '') = '')
        OR (lwr.message_id IS NOT NULL AND lr.task_run_id IS NOT NULL AND lwr.metadata ->> 'runtime_task_run_id' IS DISTINCT FROM lr.task_run_id::text)
        OR (lwr.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND COALESCE(lwr.metadata ->> 'n8n_execution_id', '') = '')
        OR (lwr.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND lwr.metadata ->> 'n8n_execution_id' IS DISTINCT FROM lr.n8n_execution_id)
        OR (lr.status IN ('succeeded', 'failed') AND lwr.message_id IS NULL)
        OR (lr.status IN ('succeeded', 'failed') AND lpr.message_id IS NULL)
        OR (lpr.message_id IS NOT NULL AND COALESCE(lpr.metadata ->> 'runtime_task_id', '') = '')
        OR (lpr.message_id IS NOT NULL AND lpr.metadata ->> 'runtime_task_id' IS DISTINCT FROM rdt.id::text)
        OR (lpr.message_id IS NOT NULL AND COALESCE(lpr.metadata ->> 'runtime_task_run_id', '') = '')
        OR (lpr.message_id IS NOT NULL AND lr.task_run_id IS NOT NULL AND lpr.metadata ->> 'runtime_task_run_id' IS DISTINCT FROM lr.task_run_id::text)
        OR (lpr.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND COALESCE(lpr.metadata ->> 'n8n_execution_id', '') = '')
        OR (lpr.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND lpr.metadata ->> 'n8n_execution_id' IS DISTINCT FROM lr.n8n_execution_id)
        OR lce.tool_event_id IS NULL
        OR (lr.task_run_id IS NOT NULL AND lce.task_run_id IS DISTINCT FROM lr.task_run_id)
        OR (lr.n8n_execution_id IS NOT NULL AND COALESCE(lce.payload ->> 'n8n_execution_id', '') = '')
        OR ((lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lwr.metadata ->> 'command_success', ''))
        OR ((lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lpr.metadata ->> 'command_success', ''))
        OR ((lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lce.payload ->> 'command_success', ''))
        OR (COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lwr.metadata ->> 'error_type', ''), '<none>'))
        OR (COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lpr.metadata ->> 'error_type', ''), '<none>'))
        OR (COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lce.payload ->> 'error_type', ''), '<none>'))
        OR (COALESCE(NULLIF(lr.output_payload ->> 'codex_command_status', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lwr.metadata ->> 'codex_command_status', ''), '<none>'))
        OR (COALESCE(NULLIF(lr.output_payload ->> 'codex_command_status', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lpr.metadata ->> 'codex_command_status', ''), '<none>'))
        OR (COALESCE(NULLIF(lr.output_payload ->> 'codex_command_status', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lce.payload ->> 'codex_command_status', ''), '<none>'))
   ) findings;" \
  "WITH recent_delegated_tasks AS (
     SELECT id, title, status, created_at
     FROM tasks
     WHERE created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND source = 'ghost_worker_runtime'
   ),
   latest_run AS (
     SELECT DISTINCT ON (tr.task_id)
       tr.task_id,
       tr.id AS task_run_id,
       tr.status AS latest_run_status,
       tr.n8n_execution_id,
       tr.output_payload
     FROM task_runs tr
     JOIN recent_delegated_tasks rdt ON rdt.id = tr.task_id
     ORDER BY tr.task_id, tr.started_at DESC NULLS LAST, tr.id DESC
   ),
   linked_delegation AS (
     SELECT
       d.id AS delegation_id,
       d.status AS delegation_status,
       d.orchestration_task_id,
       d.runtime_task_id,
       d.metadata,
       d.updated_at,
       d.completed_at
     FROM conversation_delegations d
     JOIN recent_delegated_tasks rdt ON rdt.id = d.runtime_task_id
   ),
   latest_worker_reply AS (
     SELECT DISTINCT ON (m.metadata ->> 'runtime_task_id')
       m.metadata ->> 'runtime_task_id' AS message_runtime_task_id,
       m.id AS message_id,
       m.metadata,
       m.created_at
     FROM messages m
     WHERE m.role = 'assistant'
       AND COALESCE(m.metadata ->> 'worker_execution', '') = 'true'
       AND COALESCE(m.metadata ->> 'runtime_task_id', '') <> ''
     ORDER BY m.metadata ->> 'runtime_task_id', m.created_at DESC, m.id DESC
   ),
   latest_parent_reply AS (
     SELECT DISTINCT ON (m.metadata ->> 'delegation_id')
       m.metadata ->> 'delegation_id' AS delegation_id,
       m.id AS message_id,
       m.metadata,
       m.created_at
     FROM messages m
     WHERE m.role = 'assistant'
       AND COALESCE(m.metadata ->> 'delegation_id', '') <> ''
       AND COALESCE(m.metadata ->> 'worker_execution', '') <> 'true'
       AND COALESCE(m.metadata ->> 'response_mode', '') LIKE 'delegated_%'
     ORDER BY m.metadata ->> 'delegation_id', m.created_at DESC, m.id DESC
   ),
   latest_completion_event AS (
     SELECT DISTINCT ON (te.task_id)
       te.task_id,
       te.id AS tool_event_id,
       te.task_run_id,
       te.payload,
       te.created_at
     FROM tool_events te
     JOIN recent_delegated_tasks rdt ON rdt.id = te.task_id
     WHERE te.event_type = 'delegation_completed'
     ORDER BY te.task_id, te.created_at DESC, te.id DESC
   ),
   findings AS (
     SELECT
       CASE
         WHEN ld.delegation_id IS NULL THEN 'delegated_runtime_missing_linked_delegation'
         WHEN ld.orchestration_task_id IS NULL THEN 'delegation_missing_orchestration_task_id'
         WHEN ld.delegation_status = 'running' AND lr.latest_run_status IN ('succeeded', 'failed') THEN 'delegation_status_lagging_terminal_runtime'
         WHEN ld.delegation_status = 'succeeded' AND lr.latest_run_status IS DISTINCT FROM 'succeeded' THEN 'delegation_succeeded_but_runtime_not_succeeded'
         WHEN ld.delegation_status = 'failed' AND lr.latest_run_status IS DISTINCT FROM 'failed' THEN 'delegation_failed_but_runtime_not_failed'
         WHEN lr.latest_run_status IN ('succeeded', 'failed') AND lwr.message_id IS NULL THEN 'worker_reply_missing_for_terminal_runtime'
         WHEN lwr.message_id IS NOT NULL AND COALESCE(lwr.metadata ->> 'runtime_task_id', '') = '' THEN 'worker_reply_missing_runtime_task_id'
         WHEN lwr.message_id IS NOT NULL AND lwr.metadata ->> 'runtime_task_id' IS DISTINCT FROM rdt.id::text THEN 'worker_reply_runtime_task_mismatch'
         WHEN lwr.message_id IS NOT NULL AND COALESCE(lwr.metadata ->> 'runtime_task_run_id', '') = '' THEN 'worker_reply_missing_runtime_task_run_id'
         WHEN lwr.message_id IS NOT NULL AND lr.task_run_id IS NOT NULL AND lwr.metadata ->> 'runtime_task_run_id' IS DISTINCT FROM lr.task_run_id::text THEN 'worker_reply_runtime_task_run_mismatch'
         WHEN lwr.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND COALESCE(lwr.metadata ->> 'n8n_execution_id', '') = '' THEN 'worker_reply_missing_execution_id'
         WHEN lwr.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND lwr.metadata ->> 'n8n_execution_id' IS DISTINCT FROM lr.n8n_execution_id THEN 'worker_reply_execution_id_mismatch'
         WHEN lr.latest_run_status IN ('succeeded', 'failed') AND lpr.message_id IS NULL THEN 'parent_reply_missing_for_terminal_runtime'
         WHEN lpr.message_id IS NOT NULL AND COALESCE(lpr.metadata ->> 'runtime_task_id', '') = '' THEN 'parent_reply_missing_runtime_task_id'
         WHEN lpr.message_id IS NOT NULL AND lpr.metadata ->> 'runtime_task_id' IS DISTINCT FROM rdt.id::text THEN 'parent_reply_runtime_task_mismatch'
         WHEN lpr.message_id IS NOT NULL AND COALESCE(lpr.metadata ->> 'runtime_task_run_id', '') = '' THEN 'parent_reply_missing_runtime_task_run_id'
         WHEN lpr.message_id IS NOT NULL AND lr.task_run_id IS NOT NULL AND lpr.metadata ->> 'runtime_task_run_id' IS DISTINCT FROM lr.task_run_id::text THEN 'parent_reply_runtime_task_run_mismatch'
         WHEN lpr.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND COALESCE(lpr.metadata ->> 'n8n_execution_id', '') = '' THEN 'parent_reply_missing_execution_id'
         WHEN lpr.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND lpr.metadata ->> 'n8n_execution_id' IS DISTINCT FROM lr.n8n_execution_id THEN 'parent_reply_execution_id_mismatch'
         WHEN lce.tool_event_id IS NULL THEN 'delegation_completion_event_missing'
         WHEN lr.task_run_id IS NOT NULL AND lce.task_run_id IS DISTINCT FROM lr.task_run_id THEN 'delegation_completion_event_task_run_mismatch'
         WHEN lr.n8n_execution_id IS NOT NULL AND COALESCE(lce.payload ->> 'n8n_execution_id', '') = '' THEN 'delegation_completion_event_missing_execution_id'
         WHEN COALESCE(lce.payload ->> 'command_success', '') = '' THEN 'delegation_completion_event_missing_command_success'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '') <> '' AND COALESCE(lce.payload ->> 'error_type', '') = '' THEN 'delegation_completion_event_missing_error_type'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'codex_command_status', ''), '') <> '' AND COALESCE(lce.payload ->> 'codex_command_status', '') = '' THEN 'delegation_completion_event_missing_codex_command_status'
         WHEN (lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lwr.metadata ->> 'command_success', '') THEN 'worker_reply_command_success_mismatch'
         WHEN (lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lpr.metadata ->> 'command_success', '') THEN 'parent_reply_command_success_mismatch'
         WHEN (lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lce.payload ->> 'command_success', '') THEN 'delegation_completion_event_command_success_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lwr.metadata ->> 'error_type', ''), '<none>') THEN 'worker_reply_error_type_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lpr.metadata ->> 'error_type', ''), '<none>') THEN 'parent_reply_error_type_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lce.payload ->> 'error_type', ''), '<none>') THEN 'delegation_completion_event_error_type_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'codex_command_status', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lwr.metadata ->> 'codex_command_status', ''), '<none>') THEN 'worker_reply_codex_command_status_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'codex_command_status', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lpr.metadata ->> 'codex_command_status', ''), '<none>') THEN 'parent_reply_codex_command_status_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'codex_command_status', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lce.payload ->> 'codex_command_status', ''), '<none>') THEN 'delegation_completion_event_codex_command_status_mismatch'
         WHEN lwr.message_id IS NOT NULL AND lpr.message_id IS NOT NULL AND COALESCE(NULLIF(lwr.metadata ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lpr.metadata ->> 'error_type', ''), '<none>') THEN 'worker_parent_error_type_mismatch'
         WHEN lwr.message_id IS NOT NULL AND lpr.message_id IS NOT NULL AND COALESCE(NULLIF(lwr.metadata ->> 'codex_command_status', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lpr.metadata ->> 'codex_command_status', ''), '<none>') THEN 'worker_parent_codex_command_status_mismatch'
       END AS issue_code,
       ld.delegation_id,
       rdt.id AS runtime_task_id,
       lr.task_run_id,
       ld.delegation_status,
       rdt.status AS runtime_task_status,
       lr.latest_run_status,
       lwr.message_id AS worker_message_id,
       lpr.message_id AS parent_message_id,
       lce.tool_event_id,
       rdt.created_at,
       LEFT(COALESCE(rdt.title, ''), 120) AS title,
       jsonb_build_object(
         'orchestration_task_id', ld.orchestration_task_id,
         'run_execution_id', lr.n8n_execution_id,
         'worker_runtime_task_run_id', lwr.metadata ->> 'runtime_task_run_id',
         'parent_runtime_task_run_id', lpr.metadata ->> 'runtime_task_run_id',
         'event_execution_id', lce.payload ->> 'n8n_execution_id'
       ) AS context_json
     FROM recent_delegated_tasks rdt
     LEFT JOIN latest_run lr ON lr.task_id = rdt.id
     LEFT JOIN linked_delegation ld ON ld.runtime_task_id = rdt.id
     LEFT JOIN latest_worker_reply lwr ON lwr.message_runtime_task_id = rdt.id::text
     LEFT JOIN latest_parent_reply lpr ON lpr.delegation_id = ld.delegation_id::text
     LEFT JOIN latest_completion_event lce ON lce.task_id = rdt.id
   )
   SELECT *
   FROM findings
   WHERE issue_code IS NOT NULL
   ORDER BY created_at DESC, issue_code
   LIMIT $ROW_LIMIT;"

run_check \
  "Recent Direct Path Surface Parity" \
  "WITH recent_direct_tasks AS (
     SELECT id, title, status, created_at
     FROM tasks
     WHERE created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND source = 'ghost_runtime'
   ),
   latest_run AS (
     SELECT DISTINCT ON (tr.task_id)
       tr.task_id,
       tr.id AS task_run_id,
       tr.status,
       tr.n8n_execution_id,
       tr.output_payload
     FROM task_runs tr
     JOIN recent_direct_tasks rdt ON rdt.id = tr.task_id
     ORDER BY tr.task_id, tr.started_at DESC NULLS LAST, tr.id DESC
   ),
   latest_reply AS (
     SELECT DISTINCT ON (m.metadata ->> 'runtime_task_id')
       m.metadata ->> 'runtime_task_id' AS message_runtime_task_id,
       m.id AS message_id,
       m.metadata,
       m.created_at
     FROM messages m
     WHERE m.role = 'assistant'
       AND COALESCE(m.metadata ->> 'response_mode', '') = 'direct_owner_reply'
       AND COALESCE(m.metadata ->> 'runtime_task_id', '') <> ''
     ORDER BY m.metadata ->> 'runtime_task_id', m.created_at DESC, m.id DESC
   ),
   latest_event AS (
     SELECT DISTINCT ON (te.task_id)
       te.task_id,
       te.id AS tool_event_id,
       te.task_run_id,
       te.event_type,
       te.status,
       te.payload,
       te.created_at
     FROM tool_events te
     JOIN recent_direct_tasks rdt ON rdt.id = te.task_id
     ORDER BY te.task_id, te.created_at DESC, te.id DESC
   )
   SELECT COUNT(*)
   FROM (
     SELECT rdt.id
     FROM recent_direct_tasks rdt
     LEFT JOIN latest_run lr ON lr.task_id = rdt.id
     LEFT JOIN latest_reply lrm ON lrm.message_runtime_task_id = rdt.id::text
     LEFT JOIN latest_event lre ON lre.task_id = rdt.id
     WHERE lrm.message_id IS NOT NULL
       AND (
         COALESCE(lrm.metadata ->> 'runtime_task_run_id', '') = ''
         OR (lr.task_run_id IS NOT NULL AND lrm.metadata ->> 'runtime_task_run_id' IS DISTINCT FROM lr.task_run_id::text)
         OR (lr.n8n_execution_id IS NOT NULL AND COALESCE(lrm.metadata ->> 'n8n_execution_id', '') = '')
         OR (lr.n8n_execution_id IS NOT NULL AND lrm.metadata ->> 'n8n_execution_id' IS DISTINCT FROM lr.n8n_execution_id)
         OR lre.tool_event_id IS NULL
         OR (lr.task_run_id IS NOT NULL AND lre.task_run_id IS DISTINCT FROM lr.task_run_id)
         OR COALESCE(lre.payload ->> 'direct_execution', '') <> 'true'
         OR (lr.n8n_execution_id IS NOT NULL AND COALESCE(lre.payload ->> 'n8n_execution_id', '') = '')
         OR (lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lrm.metadata ->> 'command_success', '')
         OR (lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lre.payload ->> 'command_success', '')
         OR COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'error_type', ''), '<none>')
         OR COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lre.payload ->> 'error_type', ''), '<none>')
         OR COALESCE(NULLIF(lr.output_payload ->> 'provider_used', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'provider_used', ''), '<none>')
         OR COALESCE(NULLIF(lr.output_payload ->> 'provider_used', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lre.payload ->> 'provider_used', ''), '<none>')
         OR COALESCE(NULLIF(lr.output_payload ->> 'model_used', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'model_used', ''), '<none>')
         OR COALESCE(NULLIF(lr.output_payload ->> 'task_class', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'task_class', ''), '<none>')
         OR COALESCE(NULLIF(lr.output_payload ->> 'parent_owner_label', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'parent_owner_label', ''), '<none>')
         OR (
           COALESCE(NULLIF(lr.output_payload ->> 'artifact_path', ''), '') <> ''
           AND (
             COALESCE(NULLIF(lrm.metadata ->> 'artifact_path', ''), '') = ''
             OR COALESCE(NULLIF(lre.payload ->> 'artifact_path', ''), '') = ''
           )
         )
         OR (
           COALESCE(NULLIF(lr.output_payload ->> 'stderr_summary', ''), '') <> ''
           AND (
             COALESCE(NULLIF(lrm.metadata ->> 'stderr_summary', ''), '') = ''
             OR COALESCE(NULLIF(lre.payload ->> 'stderr_summary', ''), '') = ''
           )
         )
       )
   ) findings;" \
  "WITH recent_direct_tasks AS (
     SELECT id, title, status, created_at
     FROM tasks
     WHERE created_at >= NOW() - INTERVAL '$RECENT_INTERVAL'
       AND source = 'ghost_runtime'
   ),
   latest_run AS (
     SELECT DISTINCT ON (tr.task_id)
       tr.task_id,
       tr.id AS task_run_id,
       tr.status AS latest_run_status,
       tr.n8n_execution_id,
       tr.output_payload
     FROM task_runs tr
     JOIN recent_direct_tasks rdt ON rdt.id = tr.task_id
     ORDER BY tr.task_id, tr.started_at DESC NULLS LAST, tr.id DESC
   ),
   latest_reply AS (
     SELECT DISTINCT ON (m.metadata ->> 'runtime_task_id')
       m.metadata ->> 'runtime_task_id' AS message_runtime_task_id,
       m.id AS message_id,
       m.metadata,
       m.created_at
     FROM messages m
     WHERE m.role = 'assistant'
       AND COALESCE(m.metadata ->> 'response_mode', '') = 'direct_owner_reply'
       AND COALESCE(m.metadata ->> 'runtime_task_id', '') <> ''
     ORDER BY m.metadata ->> 'runtime_task_id', m.created_at DESC, m.id DESC
   ),
   latest_event AS (
     SELECT DISTINCT ON (te.task_id)
       te.task_id,
       te.id AS tool_event_id,
       te.task_run_id,
       te.event_type,
       te.status AS event_status,
       te.payload,
       te.created_at
     FROM tool_events te
     JOIN recent_direct_tasks rdt ON rdt.id = te.task_id
     ORDER BY te.task_id, te.created_at DESC, te.id DESC
   ),
   findings AS (
     SELECT
       CASE
         WHEN lrm.message_id IS NOT NULL AND COALESCE(lrm.metadata ->> 'runtime_task_run_id', '') = '' THEN 'assistant_reply_missing_runtime_task_run_id'
         WHEN lrm.message_id IS NOT NULL AND lr.task_run_id IS NOT NULL AND lrm.metadata ->> 'runtime_task_run_id' IS DISTINCT FROM lr.task_run_id::text THEN 'assistant_reply_runtime_task_run_mismatch'
         WHEN lrm.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND COALESCE(lrm.metadata ->> 'n8n_execution_id', '') = '' THEN 'assistant_reply_missing_execution_id'
         WHEN lrm.message_id IS NOT NULL AND lr.n8n_execution_id IS NOT NULL AND lrm.metadata ->> 'n8n_execution_id' IS DISTINCT FROM lr.n8n_execution_id THEN 'assistant_reply_execution_id_mismatch'
         WHEN lre.tool_event_id IS NULL THEN 'direct_tool_event_missing'
         WHEN lr.task_run_id IS NOT NULL AND lre.task_run_id IS DISTINCT FROM lr.task_run_id THEN 'direct_tool_event_task_run_mismatch'
         WHEN COALESCE(lre.payload ->> 'direct_execution', '') <> 'true' THEN 'direct_tool_event_missing_direct_execution_marker'
         WHEN lr.n8n_execution_id IS NOT NULL AND COALESCE(lre.payload ->> 'n8n_execution_id', '') = '' THEN 'direct_tool_event_missing_execution_id'
         WHEN (lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lrm.metadata ->> 'command_success', '') THEN 'message_command_success_mismatch'
         WHEN (lr.output_payload ->> 'command_success') IS DISTINCT FROM COALESCE(lre.payload ->> 'command_success', '') THEN 'tool_event_command_success_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'error_type', ''), '<none>') THEN 'message_error_type_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'error_type', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lre.payload ->> 'error_type', ''), '<none>') THEN 'tool_event_error_type_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'provider_used', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'provider_used', ''), '<none>') THEN 'message_provider_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'provider_used', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lre.payload ->> 'provider_used', ''), '<none>') THEN 'tool_event_provider_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'model_used', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'model_used', ''), '<none>') THEN 'message_model_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'task_class', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'task_class', ''), '<none>') THEN 'message_task_class_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'parent_owner_label', ''), '<none>') IS DISTINCT FROM COALESCE(NULLIF(lrm.metadata ->> 'parent_owner_label', ''), '<none>') THEN 'message_parent_owner_mismatch'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'artifact_path', ''), '') <> '' AND COALESCE(NULLIF(lrm.metadata ->> 'artifact_path', ''), '') = '' THEN 'assistant_reply_missing_artifact_path'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'artifact_path', ''), '') <> '' AND COALESCE(NULLIF(lre.payload ->> 'artifact_path', ''), '') = '' THEN 'direct_tool_event_missing_artifact_path'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'stderr_summary', ''), '') <> '' AND COALESCE(NULLIF(lrm.metadata ->> 'stderr_summary', ''), '') = '' THEN 'assistant_reply_missing_stderr_summary'
         WHEN COALESCE(NULLIF(lr.output_payload ->> 'stderr_summary', ''), '') <> '' AND COALESCE(NULLIF(lre.payload ->> 'stderr_summary', ''), '') = '' THEN 'direct_tool_event_missing_stderr_summary'
       END AS issue_code,
       rdt.id AS task_id,
       lr.task_run_id,
       rdt.status AS task_status,
       lr.latest_run_status,
       lrm.message_id,
       lre.tool_event_id,
       lre.event_type,
       rdt.created_at,
       LEFT(COALESCE(rdt.title, ''), 120) AS title,
       jsonb_build_object(
         'message_runtime_task_run_id', lrm.metadata ->> 'runtime_task_run_id',
         'message_execution_id', lrm.metadata ->> 'n8n_execution_id',
         'event_execution_id', lre.payload ->> 'n8n_execution_id',
         'event_direct_execution', lre.payload ->> 'direct_execution'
       ) AS context_json
     FROM recent_direct_tasks rdt
     LEFT JOIN latest_run lr ON lr.task_id = rdt.id
     LEFT JOIN latest_reply lrm ON lrm.message_runtime_task_id = rdt.id::text
     LEFT JOIN latest_event lre ON lre.task_id = rdt.id
     WHERE lrm.message_id IS NOT NULL
   )
   SELECT *
   FROM findings
   WHERE issue_code IS NOT NULL
   ORDER BY created_at DESC, issue_code
   LIMIT $ROW_LIMIT;"
