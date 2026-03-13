#!/usr/bin/env bash
set -u

WEBHOOK_URL="${WEBHOOK_URL:-http://127.0.0.1:5678/webhook/ghost-chat-v3-memory-dev}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ghost-postgres}"
POSTGRES_USER="${POSTGRES_USER:-ghost}"
APP_DB="${APP_DB:-ghost_app}"
CORE_DB="${CORE_DB:-ghost_core}"
DEV_WORKFLOW_ID="${DEV_WORKFLOW_ID:-kvNzP8BQxXlrtKFG}"
JSON_STDOUT=false
REPORT_JSON_PATH=""
TEST_FILTER=""

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 2
fi

if ! command -v uuidgen >/dev/null 2>&1; then
  echo "uuidgen is required"
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

usage() {
  cat <<'EOF'
Usage:
  test-phase4a-memory-dev.sh [--json] [--report-json PATH] [--test NAME]

Options:
  --json                Print machine-readable JSON report to stdout
  --report-json PATH    Write machine-readable JSON report to PATH
  --test NAME           Run a single named test case
  --help                Show this help
EOF
}

while (($# > 0)); do
  case "$1" in
    --json)
      JSON_STDOUT=true
      shift
      ;;
    --report-json)
      if (($# < 2)); then
        echo "--report-json requires a file path"
        exit 2
      fi
      REPORT_JSON_PATH="$2"
      shift 2
      ;;
    --test)
      if (($# < 2)); then
        echo "--test requires a test name"
        exit 2
      fi
      TEST_FILTER="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 2
      ;;
  esac
done

pass_count=0
fail_count=0
total_count=0
RESULTS_FILE="$TMP_DIR/results.jsonl"
TEXT_MODE=true

if [[ "$JSON_STDOUT" == "true" ]]; then
  TEXT_MODE=false
fi

psql_app() {
  local sql="$1"
  docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$APP_DB" -At -c "$sql"
}

psql_core() {
  local sql="$1"
  docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$CORE_DB" -At -c "$sql"
}

record_pass() {
  local name="$1"
  if [[ "$TEXT_MODE" == "true" ]]; then
    echo "PASS ${name}"
  fi
  pass_count=$((pass_count + 1))
}

record_fail() {
  local name="$1"
  local reason="$2"
  if [[ "$TEXT_MODE" == "true" ]]; then
    echo "FAIL ${name}: ${reason}"
  fi
  fail_count=$((fail_count + 1))
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "$message: expected '$expected' got '$actual'"
    return 1
  fi
  return 0
}

assert_nonzero() {
  local actual="$1"
  local message="$2"
  if [[ "${actual:-0}" =~ ^[0-9]+$ ]] && (( actual > 0 )); then
    return 0
  fi
  echo "$message: expected > 0 got '$actual'"
  return 1
}

latest_execution_status() {
  psql_core "SELECT status FROM execution_entity WHERE \"workflowId\"='${DEV_WORKFLOW_ID}' ORDER BY id DESC LIMIT 1;"
}

wait_for_query_value() {
  local sql="$1"
  local expected="$2"
  local attempts="${3:-10}"
  local sleep_seconds="${4:-1}"
  local value=""

  for ((i = 1; i <= attempts; i++)); do
    value="$(psql_app "$sql")"
    if [[ "$value" == "$expected" ]]; then
      echo "$value"
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "$value"
  return 1
}

wait_for_nonzero_query_value() {
  local sql="$1"
  local attempts="${2:-10}"
  local sleep_seconds="${3:-1}"
  local value=""

  for ((i = 1; i <= attempts; i++)); do
    value="$(psql_app "$sql")"
    if [[ "${value:-0}" =~ ^[0-9]+$ ]] && (( value > 0 )); then
      echo "$value"
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "$value"
  return 1
}

wait_for_execution_success() {
  local attempts="${1:-10}"
  local sleep_seconds="${2:-1}"
  local value=""

  for ((i = 1; i <= attempts; i++)); do
    value="$(latest_execution_status)"
    if [[ "$value" == "success" ]]; then
      echo "$value"
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "$value"
  return 1
}

append_result() {
  local result_json="$1"
  printf '%s\n' "$result_json" >> "$RESULTS_FILE"
}

should_run_test() {
  local name="$1"
  if [[ -n "$TEST_FILTER" && "$TEST_FILTER" != "$name" ]]; then
    return 1
  fi
  return 0
}

run_case() {
  local name="$1"
  local payload_json="$2"
  local expected_memory_count="$3"
  local expected_memory_type="$4"
  local expected_summary="$5"

  if ! should_run_test "$name"; then
    return
  fi

  total_count=$((total_count + 1))

  local response_file="$TMP_DIR/${name}.json"
  local http_code
  http_code="$(curl -sS -o "$response_file" -w '%{http_code}' -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -d "$payload_json")"

  local conversation_id
  conversation_id="$(jq -r '.conversation_id // empty' "$response_file" 2>/dev/null)"
  local response_compact
  response_compact="$(jq -c '.' "$response_file" 2>/dev/null || jq -Rn --arg raw "$(cat "$response_file" 2>/dev/null)" '$raw')"

  local user_message_saved=false
  local assistant_message_saved=false
  local memory_row_count_ok=false
  local execution_status_ok=false
  local conversation_id_ok=false
  local http_status_ok=false
  local memory_type_ok=true
  local memory_summary_ok=true

  if [[ "$http_code" != "200" ]]; then
    record_fail "$name" "expected HTTP 200 got ${http_code}"
    append_result "$(jq -nc \
      --arg name "$name" \
      --arg status "fail" \
      --argjson http_status "$http_code" \
      --arg conversation_id "$conversation_id" \
      --arg response "$response_compact" \
      '{
        name: $name,
        status: $status,
        http_status: $http_status,
        conversation_id: ($conversation_id | if . == "" then null else . end),
        checks: {
          http_status_ok: false,
          conversation_id_ok: false,
          user_message_saved: false,
          assistant_message_saved: false,
          memory_row_count_ok: false,
          execution_status_ok: false
        },
        response: ($response | fromjson? // $response),
        errors: ["expected HTTP 200"]
      }')"
    return
  fi
  http_status_ok=true

  if [[ -z "$conversation_id" ]]; then
    record_fail "$name" "missing conversation_id in response"
    append_result "$(jq -nc \
      --arg name "$name" \
      --arg status "fail" \
      --argjson http_status "$http_code" \
      --arg response "$response_compact" \
      '{
        name: $name,
        status: $status,
        http_status: $http_status,
        conversation_id: null,
        checks: {
          http_status_ok: true,
          conversation_id_ok: false,
          user_message_saved: false,
          assistant_message_saved: false,
          memory_row_count_ok: false,
          execution_status_ok: false
        },
        response: ($response | fromjson? // $response),
        errors: ["missing conversation_id"]
      }')"
    return
  fi
  conversation_id_ok=true

  local user_count assistant_count memory_count execution_status
  user_count="$(wait_for_nonzero_query_value "SELECT COUNT(*) FROM messages WHERE conversation_id='${conversation_id}'::uuid AND role='user';" 10 1)"
  assistant_count="$(wait_for_nonzero_query_value "SELECT COUNT(*) FROM messages WHERE conversation_id='${conversation_id}'::uuid AND role='assistant';" 10 1)"
  memory_count="$(wait_for_query_value "SELECT COUNT(*) FROM ghost_memory WHERE conversation_id='${conversation_id}'::uuid AND status='active';" "$expected_memory_count" 12 1)"
  execution_status="$(wait_for_execution_success 10 1)"

  local errors=()
  local actual_type=""
  local actual_summary=""

  if ! assert_nonzero "$user_count" "user message count"; then
    errors+=("user message row missing")
  else
    user_message_saved=true
  fi
  if ! assert_nonzero "$assistant_count" "assistant message count"; then
    errors+=("assistant message row missing")
  else
    assistant_message_saved=true
  fi
  if ! assert_eq "$memory_count" "$expected_memory_count" "memory row count"; then
    errors+=("memory row count mismatch")
  else
    memory_row_count_ok=true
  fi
  if ! assert_eq "$execution_status" "success" "latest execution status"; then
    errors+=("latest execution status=${execution_status}")
  else
    execution_status_ok=true
  fi

  if [[ "$expected_memory_count" == "1" ]]; then
    actual_type="$(psql_app "SELECT memory_type FROM ghost_memory WHERE conversation_id='${conversation_id}'::uuid AND status='active' ORDER BY created_at DESC LIMIT 1;")"
    actual_summary="$(psql_app "SELECT summary FROM ghost_memory WHERE conversation_id='${conversation_id}'::uuid AND status='active' ORDER BY created_at DESC LIMIT 1;")"
    if ! assert_eq "$actual_type" "$expected_memory_type" "memory type"; then
      errors+=("memory type mismatch")
      memory_type_ok=false
    fi
    if ! assert_eq "$actual_summary" "$expected_summary" "memory summary"; then
      errors+=("memory summary mismatch")
      memory_summary_ok=false
    fi
  fi

  if ((${#errors[@]} > 0)); then
    record_fail "$name" "$(IFS='; '; echo "${errors[*]}")"
    if [[ "$TEXT_MODE" == "true" ]]; then
      echo "  response: $(tr '\n' ' ' < "$response_file" | sed 's/  */ /g')"
    fi
    append_result "$(jq -nc \
      --arg name "$name" \
      --arg status "fail" \
      --argjson http_status "$http_code" \
      --arg conversation_id "$conversation_id" \
      --argjson user_message_saved "$user_message_saved" \
      --argjson assistant_message_saved "$assistant_message_saved" \
      --argjson memory_row_count_ok "$memory_row_count_ok" \
      --argjson execution_status_ok "$execution_status_ok" \
      --argjson memory_type_ok "$memory_type_ok" \
      --argjson memory_summary_ok "$memory_summary_ok" \
      --arg expected_memory_count "$expected_memory_count" \
      --arg actual_memory_count "$memory_count" \
      --arg expected_memory_type "$expected_memory_type" \
      --arg actual_memory_type "$actual_type" \
      --arg expected_summary "$expected_summary" \
      --arg actual_summary "$actual_summary" \
      --arg execution_status "$execution_status" \
      --arg response "$response_compact" \
      --argjson errors "$(printf '%s\n' "${errors[@]}" | jq -R . | jq -s .)" \
      '{
        name: $name,
        status: $status,
        http_status: $http_status,
        conversation_id: $conversation_id,
        checks: {
          http_status_ok: true,
          conversation_id_ok: true,
          user_message_saved: $user_message_saved,
          assistant_message_saved: $assistant_message_saved,
          memory_row_count_ok: $memory_row_count_ok,
          execution_status_ok: $execution_status_ok,
          memory_type_ok: $memory_type_ok,
          memory_summary_ok: $memory_summary_ok
        },
        expected: {
          memory_count: ($expected_memory_count | tonumber),
          memory_type: ($expected_memory_type | if . == "" then null else . end),
          summary: ($expected_summary | if . == "" then null else . end)
        },
        actual: {
          memory_count: ($actual_memory_count | tonumber),
          memory_type: ($actual_memory_type | if . == "" then null else . end),
          summary: ($actual_summary | if . == "" then null else . end),
          execution_status: $execution_status
        },
        response: ($response | fromjson? // $response),
        errors: $errors
      }')"
    return
  fi

  record_pass "$name"
  append_result "$(jq -nc \
    --arg name "$name" \
    --arg status "pass" \
    --argjson http_status "$http_code" \
    --arg conversation_id "$conversation_id" \
    --argjson expected_memory_count "$expected_memory_count" \
    --arg expected_memory_type "$expected_memory_type" \
    --arg expected_summary "$expected_summary" \
    --arg execution_status "$execution_status" \
    --arg actual_type "$actual_type" \
    --arg actual_summary "$actual_summary" \
    '{
      name: $name,
      status: $status,
      http_status: $http_status,
      conversation_id: $conversation_id,
      checks: {
        http_status_ok: true,
        conversation_id_ok: true,
        user_message_saved: true,
        assistant_message_saved: true,
        memory_row_count_ok: true,
        execution_status_ok: true,
        memory_type_ok: (if $expected_memory_type == "" then true else ($actual_type == $expected_memory_type) end),
        memory_summary_ok: (if $expected_summary == "" then true else ($actual_summary == $expected_summary) end)
      },
      expected: {
        memory_count: $expected_memory_count,
        memory_type: ($expected_memory_type | if . == "" then null else . end),
        summary: ($expected_summary | if . == "" then null else . end)
      },
      actual: {
        memory_count: $expected_memory_count,
        memory_type: ($actual_type | if . == "" then null else . end),
        summary: ($actual_summary | if . == "" then null else . end),
        execution_status: $execution_status
      }
    }')"
}

run_recall_case() {
  local name="$1"
  local write_message="$2"
  local recall_message="$3"
  local filler_turns="$4"
  local expected_contains_one="$5"
  local expected_contains_two="$6"

  if ! should_run_test "$name"; then
    return
  fi

  total_count=$((total_count + 1))

  local conversation_id
  conversation_id="$(uuidgen | tr 'A-Z' 'a-z')"
  local write_payload recall_payload response_file recall_file reply execution_status memory_count
  write_payload="$(build_payload_for_conversation "$conversation_id" "$write_message" "" "")"
  response_file="$TMP_DIR/${name}-write.json"
  recall_file="$TMP_DIR/${name}-recall.json"

  local write_http
  write_http="$(curl -sS -o "$response_file" -w '%{http_code}' -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -d "$write_payload")"
  if [[ "$write_http" != "200" ]]; then
    record_fail "$name" "initial write expected HTTP 200 got ${write_http}"
    append_result "$(jq -nc --arg name "$name" --arg status "fail" --argjson http_status "$write_http" --arg conversation_id "$conversation_id" '{name:$name,status:$status,http_status:$http_status,conversation_id:$conversation_id,checks:{initial_write_ok:false},errors:["initial write failed"]}')"
    return
  fi

  memory_count="$(wait_for_query_value "SELECT COUNT(*) FROM ghost_memory WHERE conversation_id='${conversation_id}'::uuid AND status='active';" "1" 12 1)"

  local i filler_payload filler_http
  for ((i = 1; i <= filler_turns; i++)); do
    filler_payload="$(build_payload_for_conversation "$conversation_id" "Reply with exactly: filler ${i}" "" "")"
    filler_http="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -d "$filler_payload")"
    if [[ "$filler_http" != "200" ]]; then
      record_fail "$name" "filler turn ${i} expected HTTP 200 got ${filler_http}"
      append_result "$(jq -nc --arg name "$name" --arg status "fail" --argjson http_status "$filler_http" --arg conversation_id "$conversation_id" '{name:$name,status:$status,http_status:$http_status,conversation_id:$conversation_id,checks:{filler_turns_ok:false},errors:["filler turn failed"]}')"
      return
    fi
  done

  recall_payload="$(build_payload_for_conversation "$conversation_id" "$recall_message" "" "")"
  local recall_http
  recall_http="$(curl -sS -o "$recall_file" -w '%{http_code}' -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -d "$recall_payload")"
  reply="$(jq -r '.reply // ""' "$recall_file" 2>/dev/null)"
  local reply_lower expected_one_lower expected_two_lower
  reply_lower="$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')"
  expected_one_lower="$(printf '%s' "$expected_contains_one" | tr '[:upper:]' '[:lower:]')"
  expected_two_lower="$(printf '%s' "$expected_contains_two" | tr '[:upper:]' '[:lower:]')"
  execution_status="$(wait_for_execution_success 10 1)"

  local reply_contains_one=false
  local reply_contains_two=true
  local memory_count_ok=false
  local execution_status_ok=false
  local errors=()

  if [[ "$recall_http" != "200" ]]; then
    errors+=("recall HTTP ${recall_http}")
  fi
  if [[ "$memory_count" == "1" ]]; then
    memory_count_ok=true
  else
    errors+=("memory row count mismatch")
  fi
  if [[ "$reply_lower" == *"$expected_one_lower"* ]]; then
    reply_contains_one=true
  else
    errors+=("reply missing expected memory text")
  fi
  if [[ -n "$expected_contains_two" ]]; then
    if [[ "$reply_lower" == *"$expected_two_lower"* ]]; then
      reply_contains_two=true
    else
      reply_contains_two=false
      errors+=("reply missing secondary memory text")
    fi
  fi
  if [[ "$execution_status" == "success" ]]; then
    execution_status_ok=true
  else
    errors+=("latest execution status=${execution_status}")
  fi

  if ((${#errors[@]} > 0)); then
    record_fail "$name" "$(IFS='; '; echo "${errors[*]}")"
    if [[ "$TEXT_MODE" == "true" ]]; then
      echo "  recall response: $(tr '\n' ' ' < "$recall_file" | sed 's/  */ /g')"
    fi
    append_result "$(jq -nc \
      --arg name "$name" \
      --arg status "fail" \
      --argjson http_status "$recall_http" \
      --arg conversation_id "$conversation_id" \
      --arg reply "$reply" \
      --arg execution_status "$execution_status" \
      --argjson memory_count_ok "$memory_count_ok" \
      --argjson execution_status_ok "$execution_status_ok" \
      --argjson reply_contains_expected "$reply_contains_one" \
      --argjson reply_contains_secondary "$reply_contains_two" \
      --argjson errors "$(printf '%s\n' "${errors[@]}" | jq -R . | jq -s .)" \
      '{
        name:$name,
        status:$status,
        http_status:$http_status,
        conversation_id:$conversation_id,
        checks:{
          memory_row_count_ok:$memory_count_ok,
          execution_status_ok:$execution_status_ok,
          reply_contains_expected:$reply_contains_expected,
          reply_contains_secondary:$reply_contains_secondary
        },
        actual:{reply:$reply, execution_status:$execution_status},
        errors:$errors
      }')"
    return
  fi

  record_pass "$name"
  append_result "$(jq -nc \
    --arg name "$name" \
    --arg status "pass" \
    --argjson http_status "$recall_http" \
    --arg conversation_id "$conversation_id" \
    --arg reply "$reply" \
    --arg execution_status "$execution_status" \
    '{
      name:$name,
      status:$status,
      http_status:$http_status,
      conversation_id:$conversation_id,
      checks:{
        memory_row_count_ok:true,
        execution_status_ok:true,
        reply_contains_expected:true,
        reply_contains_secondary:true
      },
      actual:{reply:$reply, execution_status:$execution_status}
    }')"
}

run_supersede_case() {
  local name="$1"
  local initial_message="$2"
  local replacement_message="$3"
  local recall_message="$4"
  local expected_active_summary="$5"
  local stale_fragment="$6"

  if ! should_run_test "$name"; then
    return
  fi

  total_count=$((total_count + 1))

  local conversation_id
  conversation_id="$(uuidgen | tr 'A-Z' 'a-z')"
  local first_http second_http recall_http recall_file reply execution_status
  first_http="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -d "$(build_payload_for_conversation "$conversation_id" "$initial_message" "" "")")"
  second_http="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -d "$(build_payload_for_conversation "$conversation_id" "$replacement_message" "" "")")"
  recall_file="$TMP_DIR/${name}-recall.json"
  recall_http="$(curl -sS -o "$recall_file" -w '%{http_code}' -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -d "$(build_payload_for_conversation "$conversation_id" "$recall_message" "" "")")"
  reply="$(jq -r '.reply // ""' "$recall_file" 2>/dev/null)"
  local reply_lower expected_active_lower stale_lower
  reply_lower="$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')"
  expected_active_lower="$(printf '%s' "$expected_active_summary" | tr '[:upper:]' '[:lower:]')"
  stale_lower="$(printf '%s' "$stale_fragment" | tr '[:upper:]' '[:lower:]')"

  local active_count superseded_count active_summary execution_status
  active_count="$(wait_for_query_value "SELECT COUNT(*) FROM ghost_memory WHERE conversation_id='${conversation_id}'::uuid AND memory_type='environment_fact' AND status='active';" "1" 12 1)"
  superseded_count="$(wait_for_query_value "SELECT COUNT(*) FROM ghost_memory WHERE conversation_id='${conversation_id}'::uuid AND memory_type='environment_fact' AND status='superseded';" "1" 12 1)"
  active_summary="$(psql_app "SELECT summary FROM ghost_memory WHERE conversation_id='${conversation_id}'::uuid AND memory_type='environment_fact' AND status='active' ORDER BY created_at DESC LIMIT 1;")"
  execution_status="$(wait_for_execution_success 10 1)"

  local checks_ok=true
  local errors=()
  if [[ "$first_http" != "200" || "$second_http" != "200" || "$recall_http" != "200" ]]; then
    checks_ok=false
    errors+=("expected HTTP 200 for all supersede steps")
  fi
  if [[ "$active_count" != "1" ]]; then
    checks_ok=false
    errors+=("active count mismatch")
  fi
  if [[ "$superseded_count" != "1" ]]; then
    checks_ok=false
    errors+=("superseded count mismatch")
  fi
  if [[ "$active_summary" != "$expected_active_summary" ]]; then
    checks_ok=false
    errors+=("active summary mismatch")
  fi
  if [[ "$reply_lower" != *"$expected_active_lower"* || "$reply_lower" == *"$stale_lower"* ]]; then
    checks_ok=false
    errors+=("recall reply did not prefer active memory")
  fi
  if [[ "$execution_status" != "success" ]]; then
    checks_ok=false
    errors+=("latest execution status=${execution_status}")
  fi

  if [[ "$checks_ok" != "true" ]]; then
    record_fail "$name" "$(IFS='; '; echo "${errors[*]}")"
    append_result "$(jq -nc \
      --arg name "$name" --arg status "fail" --arg conversation_id "$conversation_id" --arg reply "$reply" \
      --arg active_summary "$active_summary" --arg execution_status "$execution_status" \
      --argjson errors "$(printf '%s\n' "${errors[@]}" | jq -R . | jq -s .)" \
      '{
        name:$name,
        status:$status,
        conversation_id:$conversation_id,
        checks:{
          supersede_status_ok:false,
          recall_prefers_active:false,
          execution_status_ok:false
        },
        actual:{reply:$reply, active_summary:$active_summary, execution_status:$execution_status},
        errors:$errors
      }')"
    return
  fi

  record_pass "$name"
  append_result "$(jq -nc \
    --arg name "$name" --arg status "pass" --arg conversation_id "$conversation_id" --arg reply "$reply" --arg active_summary "$active_summary" \
    '{
      name:$name,
      status:$status,
      conversation_id:$conversation_id,
      checks:{
        supersede_status_ok:true,
        recall_prefers_active:true,
        execution_status_ok:true
      },
      actual:{reply:$reply, active_summary:$active_summary}
    }')"
}

run_no_memory_recall_case() {
  local name="$1"
  local recall_message="$2"
  local forbidden_one="$3"
  local forbidden_two="$4"

  if ! should_run_test "$name"; then
    return
  fi

  total_count=$((total_count + 1))

  local conversation_id recall_file recall_http reply execution_status memory_count
  conversation_id="$(uuidgen | tr 'A-Z' 'a-z')"
  recall_file="$TMP_DIR/${name}.json"
  recall_http="$(curl -sS -o "$recall_file" -w '%{http_code}' -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -d "$(build_payload_for_conversation "$conversation_id" "$recall_message" "" "")")"
  reply="$(jq -r '.reply // ""' "$recall_file" 2>/dev/null)"
  memory_count="$(wait_for_query_value "SELECT COUNT(*) FROM ghost_memory WHERE conversation_id='${conversation_id}'::uuid AND status='active';" "0" 12 1)"
  execution_status="$(wait_for_execution_success 10 1)"

  local errors=()
  if [[ "$recall_http" != "200" ]]; then
    errors+=("recall HTTP ${recall_http}")
  fi
  if [[ "$memory_count" != "0" ]]; then
    errors+=("unexpected memory rows")
  fi
  if [[ "$reply" == *"$forbidden_one"* || "$reply" == *"$forbidden_two"* ]]; then
    errors+=("reply appears to hallucinate stored memory")
  fi
  if [[ "$execution_status" != "success" ]]; then
    errors+=("latest execution status=${execution_status}")
  fi

  if ((${#errors[@]} > 0)); then
    record_fail "$name" "$(IFS='; '; echo "${errors[*]}")"
    append_result "$(jq -nc \
      --arg name "$name" --arg status "fail" --argjson http_status "$recall_http" --arg conversation_id "$conversation_id" \
      --arg reply "$reply" --arg execution_status "$execution_status" \
      --argjson errors "$(printf '%s\n' "${errors[@]}" | jq -R . | jq -s .)" \
      '{
        name:$name,
        status:$status,
        http_status:$http_status,
        conversation_id:$conversation_id,
        checks:{
          memory_row_count_ok:false,
          no_hallucinated_recall:false,
          execution_status_ok:false
        },
        actual:{reply:$reply, execution_status:$execution_status},
        errors:$errors
      }')"
    return
  fi

  record_pass "$name"
  append_result "$(jq -nc \
    --arg name "$name" --arg status "pass" --argjson http_status "$recall_http" --arg conversation_id "$conversation_id" --arg reply "$reply" \
    '{
      name:$name,
      status:$status,
      http_status:$http_status,
      conversation_id:$conversation_id,
      checks:{
        memory_row_count_ok:true,
        no_hallucinated_recall:true,
        execution_status_ok:true
      },
      actual:{reply:$reply}
    }')"
}

build_payload_for_conversation() {
  local conversation_id="$1"
  local message="$2"
  local force_task_class="${3:-}"
  local memory_test_mode="${4:-}"
  jq -nc \
    --arg conversation_id "$conversation_id" \
    --arg message "$message" \
    --arg force_task_class "$force_task_class" \
    --arg memory_test_mode "$memory_test_mode" \
    '{
      conversation_id: $conversation_id,
      message: $message
    }
    + (if $force_task_class != "" then {force_task_class: $force_task_class} else {} end)
    + (if $memory_test_mode != "" then {memory_test_mode: $memory_test_mode} else {} end)'
}

build_payload() {
  build_payload_for_conversation "$(uuidgen | tr 'A-Z' 'a-z')" "$1" "${2:-}" "${3:-}"
}

emit_report() {
  local summary_status="pass"
  if (( fail_count > 0 )); then
    summary_status="fail"
  fi

  local report
  report="$(jq -n \
    --arg harness "phase4a-memory-dev" \
    --arg webhook "$WEBHOOK_URL" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg test_filter "$TEST_FILTER" \
    --argjson passed "$pass_count" \
    --argjson failed "$fail_count" \
    --argjson total "$total_count" \
    --arg status "$summary_status" \
    --slurpfile tests "$RESULTS_FILE" \
    '{
      harness: $harness,
      webhook: $webhook,
      timestamp: $timestamp,
      test_filter: ($test_filter | if . == "" then null else . end),
      summary: {
        passed: $passed,
        failed: $failed,
        total: $total,
        status: $status
      },
      tests: $tests
    }')"

  if [[ -n "$REPORT_JSON_PATH" ]]; then
    printf '%s\n' "$report" > "$REPORT_JSON_PATH"
  fi
  if [[ "$JSON_STDOUT" == "true" ]]; then
    printf '%s\n' "$report"
  fi
}

if [[ "$TEXT_MODE" == "true" ]]; then
  echo "Running Phase 4A dev memory regression harness"
  echo "Webhook: ${WEBHOOK_URL}"
fi

run_case \
  "trivial_chat" \
  "$(build_payload 'Say hello in five words.')" \
  "0" "" ""

run_case \
  "architectural_decision" \
  "$(build_payload 'Architectural decision: use Postgres for Ghost memory first and do not add pgvector in this phase. Confirm briefly.')" \
  "1" "decision" "use Postgres for Ghost memory first and do not add pgvector in this phase"

run_case \
  "environment_fact" \
  "$(build_payload 'Environment fact: the Ghost runtime uses Postgres 16 in the local docker compose stack. Confirm briefly.')" \
  "1" "environment_fact" "the Ghost runtime uses Postgres 16 in the local docker compose stack"

run_case \
  "comma_heavy_message" \
  "$(build_payload 'Hello, Ghost, please answer this, with commas, and keep it short.')" \
  "0" "" ""

run_case \
  "comma_heavy_json_text" \
  "$(build_payload 'Here is JSON-looking text, with commas: {\"alpha\":1,\"beta\":[2,3],\"note\":\"keep, commas\"}. Explain briefly.')" \
  "0" "" ""

run_case \
  "invalid_json_mode" \
  "$(build_payload 'Architectural decision: use Postgres only.' '' 'invalid_json')" \
  "0" "" ""

run_case \
  "mixed_noisy_prompt" \
  "$(build_payload 'Here is noise: stack trace stderr stdout tokens used session id: 12345. Also, hello hi thanks. Architectural decision: use Postgres only! Save only the durable decision.')" \
  "0" "" ""

run_case \
  "forced_lightweight_local_task" \
  "$(build_payload 'Summarize this, with commas, into three bullets: apples, oranges, bananas.' 'lightweight_local_task' '')" \
  "0" "" ""

run_case \
  "forced_technical_work" \
  "$(build_payload 'Implement a tiny SQL example, with commas in the explanation, and keep it to two lines.' 'technical_work' '')" \
  "0" "" ""

run_recall_case \
  "recall_decision_after_fillers" \
  "Architectural decision: use Postgres for Ghost memory first and do not add pgvector in this phase. Confirm briefly." \
  "What architecture decision did I set for this conversation about memory? Answer in one sentence." \
  "7" \
  "Postgres" \
  "pgvector"

run_recall_case \
  "recall_environment_fact" \
  "Environment fact: the Ghost runtime uses Postgres 16 in the local docker compose stack. Confirm briefly." \
  "What environment fact did I set for this conversation? Answer in one sentence." \
  "4" \
  "Postgres 16" \
  "docker compose"

run_supersede_case \
  "supersede_environment_fact" \
  "Environment fact: the Ghost runtime uses Postgres 15 in the local docker compose stack. Confirm briefly." \
  "Environment fact: the Ghost runtime uses Postgres 16 in the local docker compose stack. Confirm briefly." \
  "What environment fact is currently set for this conversation? Answer in one sentence." \
  "the Ghost runtime uses Postgres 16 in the local docker compose stack" \
  "Postgres 15"

run_no_memory_recall_case \
  "no_memory_no_hallucinated_recall" \
  "What durable memory have I set for this conversation? If none, say that directly." \
  "Postgres 16" \
  "pgvector"

if [[ "$TEXT_MODE" == "true" ]]; then
  echo
  echo "Result: ${pass_count} passed, ${fail_count} failed"
fi

emit_report

if (( fail_count > 0 )); then
  exit 1
fi
