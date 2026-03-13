#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ghost-ops-common.sh"

CONVERSATION_ID=""
DELEGATION_ID=""
RUNTIME_TASK_ID=""
EXECUTION_ID=""
LATEST_COUNT=""
LATEST_FAILURES=""

usage() {
  cat <<'EOF'
Usage:
  ops/trace-runtime.sh [one selector]

Selectors:
  --conversation-id UUID
  --delegation-id UUID
  --runtime-task-id UUID
  --execution-id TEXT
  --latest N
  --latest-failures N

The script prints operator-friendly sections for:
  - conversations
  - delegations
  - tasks / task_runs
  - messages
  - tool events
EOF
}

while (($# > 0)); do
  case "$1" in
    --conversation-id)
      CONVERSATION_ID="$2"
      shift 2
      ;;
    --delegation-id)
      DELEGATION_ID="$2"
      shift 2
      ;;
    --runtime-task-id)
      RUNTIME_TASK_ID="$2"
      shift 2
      ;;
    --execution-id)
      EXECUTION_ID="$2"
      shift 2
      ;;
    --latest)
      LATEST_COUNT="$2"
      shift 2
      ;;
    --latest-failures)
      LATEST_FAILURES="$2"
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

if [[ -n "$LATEST_COUNT" ]]; then
  psql_app "
SELECT tr.id AS task_run_id, tr.started_at, tr.status, tr.execution_target, tr.n8n_execution_id,
       t.id AS task_id, t.task_type, t.source, t.status AS task_status, t.title
FROM task_runs tr
JOIN tasks t ON t.id = tr.task_id
ORDER BY tr.started_at DESC
LIMIT $LATEST_COUNT;
"
  exit 0
fi

if [[ -n "$LATEST_FAILURES" ]]; then
  psql_app "
SELECT tr.id AS task_run_id, tr.started_at, tr.status, tr.execution_target, tr.n8n_execution_id,
       t.id AS task_id, t.task_type, t.source, t.status AS task_status, t.error_summary
FROM task_runs tr
JOIN tasks t ON t.id = tr.task_id
WHERE tr.status <> 'succeeded' OR COALESCE(t.error_summary, '') <> ''
ORDER BY tr.started_at DESC
LIMIT $LATEST_FAILURES;
"
  exit 0
fi

selector_count=0
[[ -n "$CONVERSATION_ID" ]] && selector_count=$((selector_count + 1))
[[ -n "$DELEGATION_ID" ]] && selector_count=$((selector_count + 1))
[[ -n "$RUNTIME_TASK_ID" ]] && selector_count=$((selector_count + 1))
[[ -n "$EXECUTION_ID" ]] && selector_count=$((selector_count + 1))
(( selector_count == 1 )) || fail "choose exactly one selector or use --latest/--latest-failures"

if [[ -n "$CONVERSATION_ID" ]]; then
  psql_app "
SELECT id, source, status, title, metadata
FROM conversations
WHERE id = '$CONVERSATION_ID'::uuid;

SELECT id, parent_conversation_id, worker_conversation_id, worker_provider, worker_model, status,
       orchestration_task_id, runtime_task_id, metadata
FROM conversation_delegations
WHERE parent_conversation_id = '$CONVERSATION_ID'::uuid
   OR worker_conversation_id = '$CONVERSATION_ID'::uuid
ORDER BY created_at DESC;

SELECT id, role, created_at, left(content, 160) AS content_preview, metadata
FROM messages
WHERE conversation_id = '$CONVERSATION_ID'::uuid
ORDER BY created_at DESC
LIMIT 20;

SELECT t.id, t.task_type, t.source, t.status, t.title, t.context, tr.id AS task_run_id, tr.n8n_execution_id, tr.status AS task_run_status
FROM tasks t
LEFT JOIN task_runs tr ON tr.task_id = t.id
WHERE t.conversation_id = '$CONVERSATION_ID'::uuid
   OR t.context ->> 'worker_conversation_id' = '$CONVERSATION_ID'
ORDER BY t.created_at DESC, tr.started_at DESC NULLS LAST;
"
  exit 0
fi

if [[ -n "$DELEGATION_ID" ]]; then
  psql_app "
SELECT id, parent_conversation_id, worker_conversation_id, worker_provider, worker_model, status,
       orchestration_task_id, runtime_task_id, request_summary, result_summary, metadata
FROM conversation_delegations
WHERE id = '$DELEGATION_ID'::uuid;

SELECT id, source, task_type, status, title, context, result_summary, error_summary
FROM tasks
WHERE context ->> 'delegation_id' = '$DELEGATION_ID'
   OR id = (SELECT runtime_task_id FROM conversation_delegations WHERE id = '$DELEGATION_ID'::uuid)
   OR id = (SELECT orchestration_task_id FROM conversation_delegations WHERE id = '$DELEGATION_ID'::uuid)
ORDER BY created_at DESC;

SELECT id, task_id, run_number, execution_target, status, n8n_execution_id, started_at, finished_at
FROM task_runs
WHERE task_id IN (
  SELECT orchestration_task_id FROM conversation_delegations WHERE id = '$DELEGATION_ID'::uuid
  UNION
  SELECT runtime_task_id FROM conversation_delegations WHERE id = '$DELEGATION_ID'::uuid
)
ORDER BY started_at DESC;
"
  exit 0
fi

if [[ -n "$RUNTIME_TASK_ID" ]]; then
  psql_app "
SELECT id, parent_task_id, conversation_id, task_type, source, status, title, context, result_summary, error_summary
FROM tasks
WHERE id = '$RUNTIME_TASK_ID'::uuid
   OR parent_task_id = '$RUNTIME_TASK_ID'::uuid;

SELECT id, task_id, run_number, execution_target, status, n8n_execution_id, input_payload, output_payload, error_text, started_at, finished_at
FROM task_runs
WHERE task_id = '$RUNTIME_TASK_ID'::uuid
ORDER BY started_at DESC;

SELECT id, task_id, task_run_id, event_type, status, payload, created_at
FROM tool_events
WHERE task_id = '$RUNTIME_TASK_ID'::uuid
ORDER BY created_at DESC;
"
  exit 0
fi

psql_app "
SELECT tr.id AS task_run_id, tr.task_id, tr.run_number, tr.execution_target, tr.status, tr.n8n_execution_id,
       tr.started_at, tr.finished_at, t.task_type, t.source, t.title, t.context
FROM task_runs tr
JOIN tasks t ON t.id = tr.task_id
WHERE tr.n8n_execution_id = '$EXECUTION_ID'
   OR t.context ->> 'n8n_execution_id' = '$EXECUTION_ID'
ORDER BY tr.started_at DESC;

SELECT id, conversation_id, role, created_at, left(content, 160) AS content_preview, metadata
FROM messages
WHERE metadata ->> 'n8n_execution_id' = '$EXECUTION_ID'
ORDER BY created_at DESC;

SELECT id, task_id, task_run_id, event_type, status, created_at, payload
FROM tool_events
WHERE payload ->> 'n8n_execution_id' = '$EXECUTION_ID'
ORDER BY created_at DESC;

SELECT id, parent_conversation_id, worker_conversation_id, status, orchestration_task_id, runtime_task_id, metadata
FROM conversation_delegations
WHERE metadata ->> 'n8n_execution_id' = '$EXECUTION_ID'
ORDER BY created_at DESC;
"
