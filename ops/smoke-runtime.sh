#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ghost-ops-common.sh"

INCLUDE_DELEGATED=false
VERIFY_DB=true
JSON_OUTPUT=false
QUIET=false
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

usage() {
  cat <<'EOF'
Usage:
  ops/smoke-runtime.sh [--include-delegated] [--skip-db-checks] [--json] [--quiet]

Checks:
  - n8n reachable
  - workflow active and webhook registered
  - Postgres reachable
  - Redis reachable
  - normal POST to /webhook/ghost-chat-v3
  - optional delegated technical POST
  - response shape includes execution metadata
  - DB records exist for execution-linked messages/task runs/tool events
EOF
}

while (($# > 0)); do
  case "$1" in
    --include-delegated)
      INCLUDE_DELEGATED=true
      shift
      ;;
    --skip-db-checks)
      VERIFY_DB=false
      shift
      ;;
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --quiet)
      QUIET=true
      shift
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

require_cmds bash curl docker jq

report_lines=()

report() {
  report_lines+=("$*")
  if [[ "$QUIET" != "true" && "$JSON_OUTPUT" != "true" ]]; then
    printf '%s\n' "$*"
  fi
}

post_json() {
  local payload="$1"
  local output_file="$2"
  local http_code
  http_code="$(curl -sS -o "$output_file" -w '%{http_code}' \
    -X POST "$WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "$payload")"
  [[ "$http_code" == "200" ]] || fail "webhook POST failed with HTTP $http_code"
}

verify_execution_records() {
  local execution_id="$1"
  local task_runs
  local messages
  local events
  task_runs="$(psql_app_at "SELECT COUNT(*) FROM task_runs WHERE n8n_execution_id = '$execution_id';")"
  messages="$(psql_app_at "SELECT COUNT(*) FROM messages WHERE metadata ->> 'n8n_execution_id' = '$execution_id';")"
  events="$(psql_app_at "SELECT COUNT(*) FROM tool_events WHERE payload ->> 'n8n_execution_id' = '$execution_id';")"
  [[ "${task_runs:-0}" =~ ^[0-9]+$ ]] && (( task_runs > 0 )) || fail "no task_runs found for n8n_execution_id=$execution_id"
  [[ "${messages:-0}" =~ ^[0-9]+$ ]] && (( messages > 0 )) || fail "no messages found for n8n_execution_id=$execution_id"
  [[ "${events:-0}" =~ ^[0-9]+$ ]] && (( events > 0 )) || fail "no tool_events found for n8n_execution_id=$execution_id"
}

wait_for_n8n_ready
ensure_workflow_row_is_active
ensure_webhook_registered

psql_app_at "SELECT 1;" >/dev/null
docker exec "$REDIS_CONTAINER" redis-cli ping >/dev/null

report "PASS n8n reachable"
report "PASS workflow active"
report "PASS webhook registered"
report "PASS postgres reachable"
report "PASS redis reachable"

NORMAL_JSON="$TMP_DIR/normal.json"
post_json '{"message":"Reply with the single word pong."}' "$NORMAL_JSON"
json_require_fields "$NORMAL_JSON" conversation_id reply provider_used task_class n8n_execution_id response_mode
jq -e '.reply == "pong"' "$NORMAL_JSON" >/dev/null || fail "normal smoke reply was not pong"
jq -e '.response_mode == "direct_owner_reply"' "$NORMAL_JSON" >/dev/null || fail "normal smoke did not stay on direct owner path"
NORMAL_EXECUTION_ID="$(jq -r '.n8n_execution_id' "$NORMAL_JSON")"

if [[ "$VERIFY_DB" == "true" ]]; then
  verify_execution_records "$NORMAL_EXECUTION_ID"
fi

report "PASS normal webhook POST"
report "PASS direct response shape includes n8n_execution_id=$NORMAL_EXECUTION_ID"

DELEGATED_JSON=""
if [[ "$INCLUDE_DELEGATED" == "true" ]]; then
  DELEGATED_JSON="$TMP_DIR/delegated.json"
  post_json '{"message":"Inspect this Python function for a likely bug and propose a code fix: def add(a, b): return a - b"}' "$DELEGATED_JSON"
  json_require_fields "$DELEGATED_JSON" conversation_id reply provider_used task_class delegation_id orchestration_task_id runtime_task_id worker_conversation_id n8n_execution_id response_mode
  jq -e '.task_class == "technical_work"' "$DELEGATED_JSON" >/dev/null || fail "delegated smoke did not classify as technical_work"
  jq -e '.response_mode == "delegated_worker_result"' "$DELEGATED_JSON" >/dev/null || fail "delegated smoke did not produce delegated_worker_result"
  DELEGATED_EXECUTION_ID="$(jq -r '.n8n_execution_id' "$DELEGATED_JSON")"
  if [[ "$VERIFY_DB" == "true" ]]; then
    verify_execution_records "$DELEGATED_EXECUTION_ID"
  fi
  report "PASS delegated webhook POST"
  report "PASS delegated response shape includes execution + task linkage"
fi

if [[ "$JSON_OUTPUT" == "true" ]]; then
  jq -n \
    --arg normal_execution_id "$NORMAL_EXECUTION_ID" \
    --argjson include_delegated "$INCLUDE_DELEGATED" \
    --slurpfile normal "$NORMAL_JSON" \
    --slurpfile delegated "${DELEGATED_JSON:-$NORMAL_JSON}" \
    '{
      ok: true,
      normal_execution_id: $normal_execution_id,
      include_delegated: $include_delegated,
      normal_response: $normal[0],
      delegated_response: (if $include_delegated then $delegated[0] else null end)
    }'
fi
