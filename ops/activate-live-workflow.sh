#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ghost-ops-common.sh"

SKIP_BUILD=false
RUN_SMOKE=true
AUTO_ROLLBACK=true
ROLLBACK_FROM=""
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/workflows}"
SMOKE_ARGS=()

usage() {
  cat <<'EOF'
Usage:
  ops/activate-live-workflow.sh [--skip-build] [--skip-smoke] [--delegated-smoke] [--no-rollback] [--output-dir PATH]
  ops/activate-live-workflow.sh --rollback-from PATH [--skip-smoke] [--delegated-smoke]

What it does:
  Promotion mode:
    1. Optionally regenerates the workflow JSON from source.
    2. Validates the target workflow JSON before activation.
    3. Exports a pre-activation live backup from n8n.
    4. Imports and publishes the target workflow.
    5. Restarts ghost-n8n-main and ghost-n8n-worker.
    6. Verifies workflow active state and webhook registration.
    7. Runs the runtime smoke script by default.
    8. Rolls back to the backup automatically if smoke fails, unless --no-rollback is set.

  Rollback mode:
    1. Validates the supplied backup/export JSON.
    2. Re-imports and publishes it.
    3. Restarts n8n runtime containers.
    4. Verifies activation and optionally reruns smoke.

Notes:
  - In this n8n deployment, publish/import changes do not become live until the
    n8n main and worker containers are restarted.
  - The script fails loudly if validation, activation, or smoke checks do not pass.
EOF
}

run_smoke() {
  "$SCRIPT_DIR/smoke-runtime.sh" "${SMOKE_ARGS[@]}"
}

rollback_to_export() {
  local rollback_json="$1"
  log "validating rollback workflow export -> $rollback_json"
  validate_workflow_json "$rollback_json"

  log "importing rollback workflow from $(basename "$rollback_json")"
  import_publish_workflow "$rollback_json"
  restart_and_verify_live_workflow
}

while (($# > 0)); do
  case "$1" in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-smoke)
      RUN_SMOKE=false
      shift
      ;;
    --delegated-smoke)
      RUN_SMOKE=true
      SMOKE_ARGS+=("--include-delegated")
      shift
      ;;
    --no-rollback)
      AUTO_ROLLBACK=false
      shift
      ;;
    --rollback-from)
      ROLLBACK_FROM="$2"
      shift 2
      ;;
    --output-dir)
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

require_cmds bash curl docker jq node
[[ -f "$WORKFLOW_JSON" ]] || fail "workflow JSON not found: $WORKFLOW_JSON"
[[ -f "$WORKFLOW_BUILDER" ]] || fail "workflow builder not found: $WORKFLOW_BUILDER"
mkdir -p "$OUTPUT_DIR"

STAMP="$(timestamp_utc)"
PRE_EXPORT="$OUTPUT_DIR/ghost-runtime-live-backup-$STAMP.json"
POST_EXPORT="$OUTPUT_DIR/ghost-runtime-live-post-activate-$STAMP.json"

if [[ -n "$ROLLBACK_FROM" ]]; then
  [[ -f "$ROLLBACK_FROM" ]] || fail "rollback export not found: $ROLLBACK_FROM"
  rollback_to_export "$ROLLBACK_FROM"
  if [[ "$RUN_SMOKE" == "true" ]]; then
    log "running runtime smoke validation after rollback"
    run_smoke
  fi
  log "rollback checks passed"
  exit 0
fi

if [[ "$SKIP_BUILD" == "false" ]]; then
  log "regenerating workflow JSON from source"
  node "$WORKFLOW_BUILDER"
else
  log "skipping workflow rebuild"
fi

log "validating target workflow JSON -> $WORKFLOW_JSON"
validate_workflow_json "$WORKFLOW_JSON"

log "capturing live pre-activation export -> $PRE_EXPORT"
export_live_workflow "$PRE_EXPORT" "/tmp/ghost-runtime-pre-activate.json"

log "importing and publishing target workflow -> $(basename "$WORKFLOW_JSON")"
import_publish_workflow "$WORKFLOW_JSON"
restart_and_verify_live_workflow

log "capturing live post-activation export -> $POST_EXPORT"
export_live_workflow "$POST_EXPORT" "/tmp/ghost-runtime-post-activate.json"

if [[ "$RUN_SMOKE" == "true" ]]; then
  log "running runtime smoke validation"
  if ! run_smoke; then
    if [[ "$AUTO_ROLLBACK" == "true" ]]; then
      log "smoke failed; rolling back using $PRE_EXPORT"
      rollback_to_export "$PRE_EXPORT"
      log "rollback completed; rerunning smoke against restored workflow"
      run_smoke
      fail "promotion smoke failed; rollback restored the previous live workflow from $PRE_EXPORT"
    fi
    fail "promotion smoke failed; rollback command: ops/activate-live-workflow.sh --rollback-from $PRE_EXPORT${SMOKE_ARGS:+ ${SMOKE_ARGS[*]}}"
  fi
fi

log "promotion checks passed"
log "pre-activation backup: $PRE_EXPORT"
log "post-activation export: $POST_EXPORT"
