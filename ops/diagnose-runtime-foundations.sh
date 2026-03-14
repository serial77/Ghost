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
worker_fragility_json="$(psql_app_at "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.blocked_count DESC, x.failed_count DESC, x.total_count DESC, x.worker_provider), '[]'::json) FROM (SELECT COALESCE(worker_provider, 'unknown') AS worker_provider, COUNT(*) FILTER (WHERE status = 'failed') AS failed_count, COUNT(*) FILTER (WHERE status = 'blocked') AS blocked_count, COUNT(*) FILTER (WHERE status IN ('queued', 'running')) AS non_terminal_count, COUNT(*) AS total_count FROM conversation_delegations WHERE COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours' GROUP BY 1 LIMIT 5) x;")"

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
export WORKER_FRAGILITY_JSON="$worker_fragility_json"

node - <<'NODE'
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const projectRoot = '/home/deicide/dev/ghost-stack-codex';
const diagnostics = JSON.parse(fs.readFileSync(path.join(projectRoot, 'ops/foundation/diagnostics.json'), 'utf8'));
const actionFeed = JSON.parse(execFileSync(
  path.join(projectRoot, 'ops/materialize-action-records.sh'),
  ['--recent-hours', process.env.RECENT_HOURS, '--limit', '200'],
  { encoding: 'utf8' },
));
const workerFragility = JSON.parse(process.env.WORKER_FRAGILITY_JSON || '[]');
const eventCounts = {};
for (const record of actionFeed.records || []) {
  eventCounts[record.event_type] = (eventCounts[record.event_type] || 0) + 1;
}
const topActionEvents = Object.entries(eventCounts)
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  .slice(0, 5)
  .map(([event_type, count]) => ({ event_type, count }));
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
      blocked_delegations_24h: Number(process.env.BLOCKED_APPROVALS),
      approval_requested_actions_24h: eventCounts['approval.requested'] || 0,
      delegation_blocked_actions_24h: eventCounts['delegation.blocked'] || 0
    },
    worker_overload_imbalance: {
      top_worker_provider: process.env.TOP_WORKER_PROVIDER,
      top_worker_count_24h: Number(process.env.TOP_WORKER_COUNT),
      worker_fragility: workerFragility
    },
    fragile_module_hotspots: {
      hotspot_count: diagnostics.hotspot_modules.length,
      hotspot_modules: diagnostics.hotspot_modules,
      action_event_mix: topActionEvents,
      materialized_action_records: actionFeed.record_count || 0,
      runtime_completed_actions_24h: eventCounts['runtime.completed'] || 0,
      outcome_recorded_actions_24h: eventCounts['outcome.recorded'] || 0
    }
  }
};
console.log(JSON.stringify(out, null, 2));
NODE
