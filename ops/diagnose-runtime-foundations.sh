#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ghost-ops-common.sh"

RECENT_HOURS="${RECENT_HOURS:-24}"
STALE_MINUTES="${STALE_MINUTES:-30}"

usage() {
  cat <<'EOF'
Usage:
  ops/diagnose-runtime-foundations.sh [--recent-hours N] [--stale-minutes N]

Outputs a compact JSON diagnostic summary using existing Ghost truth surfaces.
EOF
}

while (($# > 0)); do
  case "$1" in
    --recent-hours)
      RECENT_HOURS="$2"
      shift 2
      ;;
    --stale-minutes)
      STALE_MINUTES="$2"
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

[[ "$RECENT_HOURS" =~ ^[0-9]+$ ]] || fail "--recent-hours must be an integer"
[[ "$STALE_MINUTES" =~ ^[0-9]+$ ]] || fail "--stale-minutes must be an integer"
require_cmds bash docker node

recent_failures="$(psql_app_at "SELECT COUNT(*) FROM tasks WHERE status = 'failed' AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
delegated_failures="$(psql_app_at "SELECT COUNT(*) FROM conversation_delegations WHERE status = 'failed' AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
stale_tasks="$(psql_app_at "SELECT COUNT(*) FROM tasks WHERE status = 'running' AND COALESCE(started_at, updated_at, created_at) < NOW() - INTERVAL '${STALE_MINUTES} minutes';")"
stale_delegations="$(psql_app_at "SELECT COUNT(*) FROM conversation_delegations WHERE status IN ('queued', 'running') AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '${STALE_MINUTES} minutes';")"
direct_parity_gaps="$(psql_app_at "SELECT COUNT(*) FROM messages WHERE role = 'assistant' AND created_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' AND COALESCE(metadata ->> 'response_mode', '') = 'direct_owner_reply' AND COALESCE(metadata ->> 'runtime_task_id', '') <> '' AND COALESCE(metadata ->> 'runtime_task_run_id', '') = '';")"
delegated_parity_gaps="$(psql_app_at "SELECT COUNT(*) FROM messages WHERE role = 'assistant' AND created_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' AND COALESCE(metadata ->> 'response_mode', '') IN ('delegated_worker_result', 'delegated_blocked', 'delegated_execution_unavailable') AND COALESCE(metadata ->> 'delegation_id', '') <> '' AND COALESCE(metadata ->> 'runtime_task_run_id', '') = '' AND COALESCE(metadata ->> 'response_mode', '') = 'delegated_worker_result';")"
blocked_approvals="$(psql_app_at "SELECT COUNT(*) FROM conversation_delegations WHERE status = 'blocked' AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
top_worker_provider="$(psql_app_at "SELECT COALESCE(worker_provider, 'unknown') || '|' || COUNT(*) FROM conversation_delegations WHERE COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours' GROUP BY worker_provider ORDER BY COUNT(*) DESC, worker_provider NULLS LAST LIMIT 1;")"

TOP_WORKER_PROVIDER="${top_worker_provider%%|*}"
TOP_WORKER_COUNT="${top_worker_provider#*|}"
if [[ -z "${TOP_WORKER_PROVIDER:-}" || "$top_worker_provider" == "$TOP_WORKER_PROVIDER" ]]; then
  TOP_WORKER_PROVIDER="unknown"
  TOP_WORKER_COUNT="0"
fi

export RECENT_HOURS STALE_MINUTES
export RECENT_FAILURES="$recent_failures"
export DELEGATED_FAILURES="$delegated_failures"
export STALE_TASKS="$stale_tasks"
export STALE_DELEGATIONS="$stale_delegations"
export DIRECT_PARITY_GAPS="$direct_parity_gaps"
export DELEGATED_PARITY_GAPS="$delegated_parity_gaps"
export BLOCKED_APPROVALS="$blocked_approvals"
export TOP_WORKER_PROVIDER TOP_WORKER_COUNT

node - <<'NODE'
const fs = require('fs');
const path = require('path');
const projectRoot = '/home/deicide/dev/ghost-stack-codex';
const diagnostics = JSON.parse(fs.readFileSync(path.join(projectRoot, 'ops/foundation/diagnostics.json'), 'utf8'));
const out = {
  recent_hours: Number(process.env.RECENT_HOURS),
  stale_minutes: Number(process.env.STALE_MINUTES),
  categories: {
    recurring_failures: {
      failed_tasks_24h: Number(process.env.RECENT_FAILURES),
      failed_delegations_24h: Number(process.env.DELEGATED_FAILURES)
    },
    stale_runtime_residue: {
      stale_running_tasks: Number(process.env.STALE_TASKS),
      stale_non_terminal_delegations: Number(process.env.STALE_DELEGATIONS)
    },
    parity_drift_patterns: {
      recent_direct_runtime_task_run_gaps: Number(process.env.DIRECT_PARITY_GAPS),
      recent_delegated_runtime_task_run_gaps: Number(process.env.DELEGATED_PARITY_GAPS)
    },
    repeated_blocked_approvals: {
      blocked_delegations_24h: Number(process.env.BLOCKED_APPROVALS)
    },
    worker_overload_imbalance: {
      top_worker_provider: process.env.TOP_WORKER_PROVIDER,
      top_worker_count_24h: Number(process.env.TOP_WORKER_COUNT)
    },
    fragile_module_hotspots: {
      hotspot_count: diagnostics.hotspot_modules.length,
      hotspot_modules: diagnostics.hotspot_modules
    }
  }
};
console.log(JSON.stringify(out, null, 2));
NODE
