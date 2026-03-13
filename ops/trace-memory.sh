#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ghost-ops-common.sh"

CONVERSATION_ID=""
WORKER_CONVERSATION_ID=""
DELEGATION_ID=""
RUNTIME_TASK_ID=""
LATEST_MEMORY=""

usage() {
  cat <<'EOF'
Usage:
  ops/trace-memory.sh [one selector]

Selectors:
  --conversation-id UUID
  --worker-conversation-id UUID
  --delegation-id UUID
  --runtime-task-id UUID
  --latest-memory N

The script focuses on:
  - conversation metadata
  - parent/worker linkage
  - latest conversation messages
  - ghost_memory rows
  - task/delegation references tied to the same thread
EOF
}

while (($# > 0)); do
  case "$1" in
    --conversation-id)
      CONVERSATION_ID="$2"
      shift 2
      ;;
    --worker-conversation-id)
      WORKER_CONVERSATION_ID="$2"
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
    --latest-memory)
      LATEST_MEMORY="$2"
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

if [[ -n "$LATEST_MEMORY" ]]; then
  psql_app "
SELECT id, created_at, scope, memory_type, conversation_id, task_run_id, summary, details_json
FROM ghost_memory
ORDER BY created_at DESC
LIMIT $LATEST_MEMORY;
"
  exit 0
fi

selector_count=0
[[ -n "$CONVERSATION_ID" ]] && selector_count=$((selector_count + 1))
[[ -n "$WORKER_CONVERSATION_ID" ]] && selector_count=$((selector_count + 1))
[[ -n "$DELEGATION_ID" ]] && selector_count=$((selector_count + 1))
[[ -n "$RUNTIME_TASK_ID" ]] && selector_count=$((selector_count + 1))
(( selector_count == 1 )) || fail "choose exactly one selector or use --latest-memory"

if [[ -n "$DELEGATION_ID" ]]; then
  CONVERSATION_ID="$(psql_app_at "SELECT parent_conversation_id::text FROM conversation_delegations WHERE id = '$DELEGATION_ID'::uuid;")"
  WORKER_CONVERSATION_ID="$(psql_app_at "SELECT worker_conversation_id::text FROM conversation_delegations WHERE id = '$DELEGATION_ID'::uuid;")"
fi

if [[ -n "$RUNTIME_TASK_ID" ]]; then
  CONVERSATION_ID="$(psql_app_at "SELECT COALESCE(conversation_id::text, context ->> 'parent_conversation_id', '') FROM tasks WHERE id = '$RUNTIME_TASK_ID'::uuid;")"
  if [[ -z "$CONVERSATION_ID" ]]; then
    CONVERSATION_ID="$(psql_app_at "SELECT parent_conversation_id::text FROM conversation_delegations WHERE runtime_task_id = '$RUNTIME_TASK_ID'::uuid;")"
  fi
  WORKER_CONVERSATION_ID="$(psql_app_at "SELECT COALESCE(context ->> 'worker_conversation_id', '') FROM tasks WHERE id = '$RUNTIME_TASK_ID'::uuid;")"
  if [[ -z "$WORKER_CONVERSATION_ID" ]]; then
    WORKER_CONVERSATION_ID="$(psql_app_at "SELECT worker_conversation_id::text FROM conversation_delegations WHERE runtime_task_id = '$RUNTIME_TASK_ID'::uuid;")"
  fi
fi

if [[ -n "$WORKER_CONVERSATION_ID" && -z "$CONVERSATION_ID" ]]; then
  CONVERSATION_ID="$(psql_app_at "SELECT parent_conversation_id::text FROM conversation_delegations WHERE worker_conversation_id = '$WORKER_CONVERSATION_ID'::uuid ORDER BY created_at DESC LIMIT 1;")"
fi

if [[ -n "$CONVERSATION_ID" ]]; then
  psql_app "
SELECT id, source, status, title, metadata
FROM conversations
WHERE id = '$CONVERSATION_ID'::uuid;

SELECT id, parent_conversation_id, worker_conversation_id, worker_provider, worker_model, status, orchestration_task_id, runtime_task_id, metadata
FROM conversation_delegations
WHERE parent_conversation_id = '$CONVERSATION_ID'::uuid
ORDER BY created_at DESC;

SELECT id, role, created_at, left(content, 160) AS content_preview, metadata
FROM messages
WHERE conversation_id = '$CONVERSATION_ID'::uuid
ORDER BY created_at DESC
LIMIT 20;

SELECT id, created_at, scope, memory_type, task_run_id, source_message_id, summary, details_json
FROM ghost_memory
WHERE conversation_id = '$CONVERSATION_ID'::uuid
ORDER BY created_at DESC
LIMIT 20;
"
fi

if [[ -n "$WORKER_CONVERSATION_ID" ]]; then
  psql_app "
SELECT id, source, status, title, metadata
FROM conversations
WHERE id = '$WORKER_CONVERSATION_ID'::uuid;

SELECT id, role, created_at, left(content, 160) AS content_preview, metadata
FROM messages
WHERE conversation_id = '$WORKER_CONVERSATION_ID'::uuid
ORDER BY created_at DESC
LIMIT 20;

SELECT id, created_at, scope, memory_type, task_run_id, source_message_id, summary, details_json
FROM ghost_memory
WHERE conversation_id = '$WORKER_CONVERSATION_ID'::uuid
ORDER BY created_at DESC
LIMIT 20;
"
fi
