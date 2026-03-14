#!/usr/bin/env bash
set -euo pipefail

OPS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS_DIR="$(cd "$OPS_LIB_DIR/.." && pwd)"
DEFAULT_PROJECT_ROOT="$(cd "$OPS_DIR/.." && pwd)"

PROJECT_ROOT="${PROJECT_ROOT:-$DEFAULT_PROJECT_ROOT}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/base/docker-compose.yml}"
N8N_MAIN_CONTAINER="${N8N_MAIN_CONTAINER:-ghost-n8n-main}"
N8N_WORKER_CONTAINER="${N8N_WORKER_CONTAINER:-ghost-n8n-worker}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ghost-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-ghost-redis}"
POSTGRES_USER="${POSTGRES_USER:-ghost}"
APP_DB="${APP_DB:-ghost_app}"
CORE_DB="${CORE_DB:-ghost_core}"
WORKFLOW_ID="${WORKFLOW_ID:-Yh6h9OJyVCfREbp3}"
WORKFLOW_NAME="${WORKFLOW_NAME:-Ghost Runtime}"
WORKFLOW_JSON="${WORKFLOW_JSON:-$PROJECT_ROOT/workflows/ghost-runtime-workflow.json}"
WORKFLOW_BUILDER="${WORKFLOW_BUILDER:-$PROJECT_ROOT/scripts/build-ghost-runtime-workflow.js}"
WEBHOOK_PATH="${WEBHOOK_PATH:-ghost-runtime}"
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

validate_workflow_json() {
  local workflow_json="$1"
  [[ -f "$workflow_json" ]] || fail "workflow JSON not found: $workflow_json"

  jq -e '
    type == "array" and
    length == 1 and
    .[0].id != null and
    .[0].name != null and
    (.[0].nodes | type == "array" and length > 0) and
    (.[0].connections | type == "object")
  ' "$workflow_json" >/dev/null || fail "workflow JSON must be a single-workflow n8n export with nodes and connections: $workflow_json"

  local workflow_id
  workflow_id="$(jq -r '.[0].id' "$workflow_json")"
  [[ "$workflow_id" == "$WORKFLOW_ID" ]] || fail "workflow JSON id mismatch: expected $WORKFLOW_ID, got $workflow_id"

  local workflow_name
  workflow_name="$(jq -r '.[0].name' "$workflow_json")"
  [[ "$workflow_name" == "$WORKFLOW_NAME" ]] || fail "workflow JSON name mismatch: expected '$WORKFLOW_NAME', got '$workflow_name'"

  jq -e --arg webhook_path "$WEBHOOK_PATH" '
    [.[0].nodes[]? |
      select(
        (.type | type == "string") and
        (
          .type == "n8n-nodes-base.webhook" or
          (.type | ascii_downcase | contains("webhook"))
        ) and
        (.parameters.path? == $webhook_path)
      )
    ] | length > 0
  ' "$workflow_json" >/dev/null || fail "workflow JSON does not include a webhook node for path '$WEBHOOK_PATH'"
}

export_live_workflow() {
  local output_path="$1"
  local remote_path="${2:-/tmp/ghost-runtime-export.json}"
  docker exec "$N8N_MAIN_CONTAINER" n8n export:workflow --id "$WORKFLOW_ID" --output "$remote_path" >/dev/null
  docker cp "$N8N_MAIN_CONTAINER:$remote_path" "$output_path" >/dev/null
}

import_publish_workflow() {
  local workflow_json="$1"
  local remote_path="/tmp/$(basename "$workflow_json")"
  docker cp "$workflow_json" "$N8N_MAIN_CONTAINER:$remote_path" >/dev/null
  docker exec "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$remote_path" >/dev/null
  docker exec "$N8N_MAIN_CONTAINER" n8n publish:workflow --id="$WORKFLOW_ID" >/dev/null
}

restart_and_verify_live_workflow() {
  log "restarting n8n runtime containers so webhook registrations refresh"
  docker_compose restart "$N8N_MAIN_CONTAINER" "$N8N_WORKER_CONTAINER" >/dev/null

  log "waiting for n8n to become reachable again"
  wait_for_n8n_ready

  log "waiting for workflow active state to settle"
  wait_for_workflow_active
  ensure_workflow_row_is_active

  log "waiting for webhook registration for POST /webhook/$WEBHOOK_PATH"
  wait_for_webhook_registration
  ensure_webhook_registered
}
