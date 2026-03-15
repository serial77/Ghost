#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ghost-ops-common.sh"

SKIP_BUILD=false
INCLUDE_DELEGATED_PROBE=false
RUN_DB_BACKUP=false
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/backups/workflow-promotions/$(timestamp_utc)}"
PROBE_ARGS=()
EXISTING_PRE_BACKUPS=()
EXISTING_POST_EXPORTS=()

usage() {
  cat <<'EOF'
Usage:
  ops/promote-live-workflow-safe.sh [--skip-build] [--include-delegated-probe] [--with-db-backup] [--output-dir PATH]

What it does:
  1. Optionally regenerates the workflow JSON from source.
  2. Validates the candidate workflow artifact.
  3. Activates the workflow using the existing activation script.
  4. Runs post-activation smoke probe(s).
  5. Automatically rolls back to pre-activation backup if activation/probe fails.

Notes:
  - This wrapper does not change runtime contracts.
  - Rollback restores workflow state only; DB rollback remains an explicit separate action.
  - Rollback uses only the pre-activation backup created during the current wrapper run.
EOF
}

while (($# > 0)); do
  case "$1" in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --include-delegated-probe)
      INCLUDE_DELEGATED_PROBE=true
      shift
      ;;
    --with-db-backup)
      RUN_DB_BACKUP=true
      shift
      ;;
    --output-dir)
      (($# >= 2)) || fail "--output-dir requires a path argument"
      OUTPUT_DIR="$2"
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

require_cmds bash curl docker jq find sort tail
[[ -f "$WORKFLOW_JSON" ]] || fail "workflow JSON not found: $WORKFLOW_JSON"
mkdir -p "$OUTPUT_DIR"

if [[ "$SKIP_BUILD" == "false" ]]; then
  require_cmds node
  [[ -f "$WORKFLOW_BUILDER" ]] || fail "workflow builder not found: $WORKFLOW_BUILDER"
fi

if [[ "$RUN_DB_BACKUP" == "true" ]]; then
  [[ -f "$PROJECT_ROOT/scripts/backup-db.sh" ]] || fail "DB backup script not found: $PROJECT_ROOT/scripts/backup-db.sh"
fi

if [[ "$INCLUDE_DELEGATED_PROBE" == "true" ]]; then
  PROBE_ARGS+=("--include-delegated")
fi

validate_candidate_workflow() {
  local candidate_json="$1"
  local candidate_id

  log "validating candidate workflow artifact $(basename "$candidate_json")"

  jq -e 'type == "array" and length == 1' "$candidate_json" >/dev/null \
    || fail "candidate workflow must be a single-workflow JSON array"

  candidate_id="$(jq -r '.[0].id // empty' "$candidate_json")"
  [[ "$candidate_id" == "$WORKFLOW_ID" ]] \
    || fail "candidate workflow id '$candidate_id' does not match live workflow id '$WORKFLOW_ID'"

  jq -e '.[0].nodes and (.[0].nodes | type == "array" and length > 0)' "$candidate_json" >/dev/null \
    || fail "candidate workflow has no nodes"

  jq -e '.[0].connections and (.[0].connections | type == "object")' "$candidate_json" >/dev/null \
    || fail "candidate workflow has no connections object"

  jq -e --arg webhook_path "$WEBHOOK_PATH" '
    [.[0].nodes[]?
      | select(.type == "n8n-nodes-base.webhook")
      | select((.parameters.path // "") == $webhook_path)
      | select((.parameters.httpMethod // "POST") == "POST")
    ] | length > 0
  ' "$candidate_json" >/dev/null \
    || fail "candidate workflow missing POST /webhook/$WEBHOOK_PATH"
}

find_latest_pre_backup() {
  find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'ghost-runtime-live-backup-*.json' | sort | tail -n 1
}

find_latest_post_export() {
  find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'ghost-runtime-live-post-activate-*.json' | sort | tail -n 1
}

capture_existing_artifacts() {
  mapfile -t EXISTING_PRE_BACKUPS < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'ghost-runtime-live-backup-*.json' | sort)
  mapfile -t EXISTING_POST_EXPORTS < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'ghost-runtime-live-post-activate-*.json' | sort)
}

path_in_array() {
  local needle="$1"
  shift
  local value
  for value in "$@"; do
    [[ "$value" == "$needle" ]] && return 0
  done
  return 1
}

find_new_pre_backup() {
  local candidate
  local latest=""
  while IFS= read -r candidate; do
    path_in_array "$candidate" "${EXISTING_PRE_BACKUPS[@]}" && continue
    latest="$candidate"
  done < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'ghost-runtime-live-backup-*.json' | sort)
  printf '%s\n' "$latest"
}

find_new_post_export() {
  local candidate
  local latest=""
  while IFS= read -r candidate; do
    path_in_array "$candidate" "${EXISTING_POST_EXPORTS[@]}" && continue
    latest="$candidate"
  done < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'ghost-runtime-live-post-activate-*.json' | sort)
  printf '%s\n' "$latest"
}

rollback_from_pre_backup() {
  local pre_backup="$1"
  local reason="$2"
  local remote_backup

  [[ -f "$pre_backup" ]] || fail "rollback requested but backup file not found: $pre_backup"

  log "rollback triggered: $reason"
  remote_backup="/tmp/ghost-runtime-rollback-$(timestamp_utc).json"

  log "copying rollback backup into n8n container"
  docker cp "$pre_backup" "$N8N_MAIN_CONTAINER:$remote_backup" >/dev/null

  log "importing rollback workflow backup"
  docker exec "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$remote_backup" >/dev/null

  log "publishing rollback workflow $WORKFLOW_ID"
  docker exec "$N8N_MAIN_CONTAINER" n8n publish:workflow --id="$WORKFLOW_ID" >/dev/null

  log "restarting n8n runtime containers after rollback"
  docker_compose restart "$N8N_MAIN_CONTAINER" "$N8N_WORKER_CONTAINER" >/dev/null

  log "verifying rollback activation state"
  wait_for_n8n_ready
  wait_for_workflow_active
  ensure_workflow_row_is_active
  wait_for_webhook_registration
  ensure_webhook_registered

  log "running post-rollback probe"
  "$SCRIPT_DIR/smoke-runtime.sh" "${PROBE_ARGS[@]}"

  log "rollback completed successfully"
}

if [[ "$RUN_DB_BACKUP" == "true" ]]; then
  log "running optional DB backup before workflow promotion"
  bash "$PROJECT_ROOT/scripts/backup-db.sh"
fi

if [[ "$SKIP_BUILD" == "false" ]]; then
  log "regenerating workflow JSON from source"
  node "$WORKFLOW_BUILDER"
else
  log "skipping workflow rebuild"
fi

validate_candidate_workflow "$WORKFLOW_JSON"
capture_existing_artifacts

log "running bounded activation step (backup + activate, probes deferred)"
if ! "$SCRIPT_DIR/activate-live-workflow.sh" --skip-build --output-dir "$OUTPUT_DIR"; then
  pre_backup="$(find_new_pre_backup || true)"
  if [[ -n "$pre_backup" ]]; then
    rollback_from_pre_backup "$pre_backup" "activation step failed"
    fail "activation failed and rollback was executed"
  fi
  fail "activation failed and no fresh pre-activation backup was produced in this run; refusing rollback to older artifacts"
fi

pre_backup="$(find_new_pre_backup || true)"
[[ -n "$pre_backup" && -f "$pre_backup" ]] || fail "activation succeeded but no fresh pre-activation backup artifact was found in $OUTPUT_DIR"

post_export="$(find_new_post_export || true)"
if [[ -z "$post_export" || ! -f "$post_export" ]]; then
  rollback_from_pre_backup "$pre_backup" "post-activation export artifact missing"
  fail "post-activation export artifact missing and rollback was executed"
fi

log "running post-activation probe"
if ! "$SCRIPT_DIR/smoke-runtime.sh" "${PROBE_ARGS[@]}"; then
  rollback_from_pre_backup "$pre_backup" "post-activation probe failed"
  fail "post-activation probe failed and rollback was executed"
fi

log "safe promotion envelope passed"
log "pre-activation backup: $pre_backup"
log "post-activation export: $post_export"
log "artifact directory: $OUTPUT_DIR"
