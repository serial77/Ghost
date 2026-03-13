#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/home/deicide/dev/ghost-stack}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/base/docker-compose.yml}"
N8N_MAIN_CONTAINER="${N8N_MAIN_CONTAINER:-ghost-n8n-main}"
N8N_WORKER_CONTAINER="${N8N_WORKER_CONTAINER:-ghost-n8n-worker}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ghost-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-ghost-redis}"
POSTGRES_USER="${POSTGRES_USER:-ghost}"
APP_DB="${APP_DB:-ghost_app}"
CORE_DB="${CORE_DB:-ghost_core}"
WORKFLOW_ID="${WORKFLOW_ID:-Yh6h9OJyVCfREbp3}"
WORKFLOW_NAME="${WORKFLOW_NAME:-GHOST by Codex}"
WORKFLOW_JSON="${WORKFLOW_JSON:-$PROJECT_ROOT/workflows/ghost-chat-v3-phase5gd-openclaw.json}"
WORKFLOW_BUILDER="${WORKFLOW_BUILDER:-$PROJECT_ROOT/scripts/build-phase5gd-openclaw-workflow.js}"
WEBHOOK_PATH="${WEBHOOK_PATH:-ghost-chat-v3}"
N8N_BASE_URL="${N8N_BASE_URL:-http://127.0.0.1:5678}"
WEBHOOK_URL="${WEBHOOK_URL:-$N8N_BASE_URL/webhook/$WEBHOOK_PATH}"

log() {
  printf '[ghost-ops] %s\n' "$*"
}

fail() {
  printf '[ghost-ops] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmds() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || fail "required command not found: $cmd"
  done
}

timestamp_utc() {
  date -u +"%Y%m%dT%H%M%SZ"
}

docker_compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

psql_core() {
  local sql="${1:-}"
  docker exec -i "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$CORE_DB" -P pager=off ${sql:+-c "$sql"}
}

psql_core_at() {
  local sql="${1:-}"
  docker exec -i "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$CORE_DB" -At -P pager=off -c "$sql"
}

psql_app() {
  local sql="${1:-}"
  docker exec -i "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$APP_DB" -P pager=off ${sql:+-c "$sql"}
}

psql_app_at() {
  local sql="${1:-}"
  docker exec -i "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$APP_DB" -At -P pager=off -c "$sql"
}

ensure_workflow_row_is_active() {
  local row
  row="$(psql_core_at "SELECT active::text || '|' || COALESCE(\"activeVersionId\"::text, '') FROM workflow_entity WHERE id = '$WORKFLOW_ID';")"
  [[ -n "$row" ]] || fail "workflow $WORKFLOW_ID not found in $CORE_DB.workflow_entity"
  local active="${row%%|*}"
  local active_version_id="${row#*|}"
  [[ "$active" == "t" || "$active" == "true" ]] || fail "workflow $WORKFLOW_ID is not marked active"
  [[ -n "$active_version_id" ]] || fail "workflow $WORKFLOW_ID has no activeVersionId"
}

ensure_webhook_registered() {
  local row
  row="$(psql_core_at "SELECT method || '|' || \"webhookPath\" FROM webhook_entity WHERE \"workflowId\" = '$WORKFLOW_ID' AND method = 'POST' AND \"webhookPath\" = '$WEBHOOK_PATH' LIMIT 1;")"
  [[ "$row" == "POST|$WEBHOOK_PATH" ]] || fail "webhook registration missing for POST $WEBHOOK_PATH"
}

wait_for_http_ok() {
  local url="$1"
  local attempts="${2:-30}"
  local sleep_seconds="${3:-2}"
  local code=""
  local i
  for ((i = 1; i <= attempts; i++)); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep "$sleep_seconds"
  done
  fail "timed out waiting for HTTP 200 from $url, last code=$code"
}

wait_for_container_running() {
  local container="$1"
  local attempts="${2:-30}"
  local sleep_seconds="${3:-2}"
  local state=""
  local i
  for ((i = 1; i <= attempts; i++)); do
    state="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
    if [[ "$state" == "running" ]]; then
      return 0
    fi
    sleep "$sleep_seconds"
  done
  fail "timed out waiting for container $container to be running"
}

wait_for_n8n_ready() {
  wait_for_container_running "$N8N_MAIN_CONTAINER"
  wait_for_container_running "$N8N_WORKER_CONTAINER"
  wait_for_http_ok "$N8N_BASE_URL"
}

wait_for_workflow_active() {
  local attempts="${1:-30}"
  local sleep_seconds="${2:-2}"
  local row=""
  local i
  for ((i = 1; i <= attempts; i++)); do
    row="$(psql_core_at "SELECT active::text || '|' || COALESCE(\"activeVersionId\"::text, '') FROM workflow_entity WHERE id = '$WORKFLOW_ID';" || true)"
    if [[ ( "${row%%|*}" == "t" || "${row%%|*}" == "true" ) && -n "${row#*|}" ]]; then
      return 0
    fi
    sleep "$sleep_seconds"
  done
  fail "timed out waiting for workflow $WORKFLOW_ID to become active, last row=${row:-<none>}"
}

wait_for_webhook_registration() {
  local attempts="${1:-30}"
  local sleep_seconds="${2:-2}"
  local row=""
  local i
  for ((i = 1; i <= attempts; i++)); do
    row="$(psql_core_at "SELECT method || '|' || \"webhookPath\" FROM webhook_entity WHERE \"workflowId\" = '$WORKFLOW_ID' AND method = 'POST' AND \"webhookPath\" = '$WEBHOOK_PATH' LIMIT 1;" || true)"
    if [[ "$row" == "POST|$WEBHOOK_PATH" ]]; then
      return 0
    fi
    sleep "$sleep_seconds"
  done
  fail "timed out waiting for webhook registration for POST $WEBHOOK_PATH"
}

json_require_fields() {
  local json_file="$1"
  shift
  local field
  for field in "$@"; do
    jq -e --arg field "$field" '.[$field] != null and .[$field] != ""' "$json_file" >/dev/null \
      || fail "JSON response missing required field: $field"
  done
}
