#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ghost-ops-common.sh"

SKIP_BUILD=false
RUN_SMOKE=false
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/workflows}"
TMP_REMOTE_JSON="/tmp/$(basename "$WORKFLOW_JSON")"
SMOKE_ARGS=()

usage() {
  cat <<'EOF'
Usage:
  ops/activate-live-workflow.sh [--skip-build] [--smoke] [--delegated-smoke] [--output-dir PATH]

What it does:
  1. Optionally regenerates the workflow JSON from source.
  2. Exports a pre-activation live backup from n8n.
  3. Imports the generated workflow into n8n.
  4. Publishes the workflow.
  5. Restarts ghost-n8n-main and ghost-n8n-worker.
  6. Verifies workflow active state and webhook registration.
  7. Optionally runs the runtime smoke script.

Notes:
  - In this n8n deployment, publish/import changes do not become live until the
    n8n main and worker containers are restarted.
  - The script fails loudly if activation checks do not pass.
EOF
}

while (($# > 0)); do
  case "$1" in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --smoke)
      RUN_SMOKE=true
      shift
      ;;
    --delegated-smoke)
      RUN_SMOKE=true
      SMOKE_ARGS+=("--include-delegated")
      shift
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
PRE_EXPORT="$OUTPUT_DIR/ghost-chat-v3-live-backup-$STAMP.json"
POST_EXPORT="$OUTPUT_DIR/ghost-chat-v3-live-post-activate-$STAMP.json"

if [[ "$SKIP_BUILD" == "false" ]]; then
  log "regenerating workflow JSON from source"
  node "$WORKFLOW_BUILDER"
else
  log "skipping workflow rebuild"
fi

log "capturing live pre-activation export -> $PRE_EXPORT"
docker exec "$N8N_MAIN_CONTAINER" n8n export:workflow --id "$WORKFLOW_ID" --output /tmp/ghost-chat-v3-pre-activate.json >/dev/null
docker cp "$N8N_MAIN_CONTAINER:/tmp/ghost-chat-v3-pre-activate.json" "$PRE_EXPORT" >/dev/null

log "copying generated workflow into n8n container"
docker cp "$WORKFLOW_JSON" "$N8N_MAIN_CONTAINER:$TMP_REMOTE_JSON" >/dev/null

log "importing workflow $WORKFLOW_ID from $(basename "$WORKFLOW_JSON")"
docker exec "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$TMP_REMOTE_JSON" >/dev/null

log "publishing workflow $WORKFLOW_ID"
docker exec "$N8N_MAIN_CONTAINER" n8n publish:workflow --id="$WORKFLOW_ID" >/dev/null

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

log "capturing live post-activation export -> $POST_EXPORT"
docker exec "$N8N_MAIN_CONTAINER" n8n export:workflow --id "$WORKFLOW_ID" --output /tmp/ghost-chat-v3-post-activate.json >/dev/null
docker cp "$N8N_MAIN_CONTAINER:/tmp/ghost-chat-v3-post-activate.json" "$POST_EXPORT" >/dev/null

if [[ "$RUN_SMOKE" == "true" ]]; then
  log "running runtime smoke validation"
  "$SCRIPT_DIR/smoke-runtime.sh" "${SMOKE_ARGS[@]}"
fi

log "activation checks passed"
log "pre-activation backup: $PRE_EXPORT"
log "post-activation export: $POST_EXPORT"
