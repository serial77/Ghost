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

"$SCRIPT_DIR/sync-action-history.sh" --recent-hours "$RECENT_HOURS" --limit 200 >/dev/null

recent_failures="$(psql_app_at "SELECT COUNT(*) FROM tasks WHERE status = 'failed' AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
delegated_failures="$(psql_app_at "SELECT COUNT(*) FROM conversation_delegations WHERE status = 'failed' AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
stale_tasks="$(psql_app_at "SELECT COUNT(*) FROM tasks WHERE status = 'running' AND COALESCE(started_at, updated_at, created_at) < NOW() - INTERVAL '${STALE_MINUTES} minutes';")"
stale_delegations="$(psql_app_at "SELECT COUNT(*) FROM conversation_delegations WHERE status IN ('queued', 'running') AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '${STALE_MINUTES} minutes';")"
direct_parity_gaps="$(psql_app_at "SELECT COUNT(*) FROM messages WHERE role = 'assistant' AND created_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' AND COALESCE(metadata ->> 'response_mode', '') = 'direct_owner_reply' AND COALESCE(metadata ->> 'runtime_task_id', '') <> '' AND COALESCE(metadata ->> 'runtime_task_run_id', '') = '';")"
delegated_parity_gaps="$(psql_app_at "SELECT COUNT(*) FROM messages WHERE role = 'assistant' AND created_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' AND COALESCE(metadata ->> 'response_mode', '') IN ('delegated_worker_result', 'delegated_blocked', 'delegated_execution_unavailable') AND COALESCE(metadata ->> 'delegation_id', '') <> '' AND COALESCE(metadata ->> 'runtime_task_run_id', '') = '' AND COALESCE(metadata ->> 'response_mode', '') = 'delegated_worker_result';")"
blocked_approvals="$(psql_app_at "SELECT COUNT(*) FROM conversation_delegations WHERE status = 'blocked' AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
pending_approval_queue="$(psql_app_at "SELECT COUNT(*) FROM approvals WHERE status = 'pending' AND requested_at >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
stale_pending_approval_queue="$(psql_app_at "SELECT COUNT(*) FROM approvals WHERE status = 'pending' AND requested_at < NOW() - INTERVAL '${STALE_MINUTES} minutes';")"
terminal_awaiting_followthrough="$(psql_app_at "SELECT COUNT(*) FROM approvals a WHERE a.status IN ('approved','rejected','expired','cancelled','superseded') AND a.requested_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' AND NOT EXISTS (SELECT 1 FROM ghost_governed_followthrough gf WHERE gf.approval_queue_id = a.id::text);")"
retry_enqueued_followthrough="$(psql_app_at "SELECT COUNT(*) FROM ghost_governed_followthrough WHERE execution_state = 'retry_enqueued' AND COALESCE(executed_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
closed_followthrough="$(psql_app_at "SELECT COUNT(*) FROM ghost_governed_followthrough WHERE execution_state = 'closed_without_retry' AND COALESCE(executed_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
approval_pressure_by_environment_json="$(psql_app_at "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.pending_count DESC, x.environment), '[]'::json) FROM (SELECT COALESCE(metadata ->> 'governance_environment', metadata -> 'approval_item' ->> 'environment', 'unknown') AS environment, COUNT(*) FILTER (WHERE status = 'pending') AS pending_count, COUNT(*) AS total_count FROM approvals WHERE requested_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' GROUP BY 1 LIMIT 5) x;")"
approval_pressure_by_capability_json="$(psql_app_at "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.pending_count DESC, x.capability_id), '[]'::json) FROM (SELECT capability_id, COUNT(*) FILTER (WHERE status = 'pending') AS pending_count, COUNT(*) AS total_count FROM approvals a CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.metadata -> 'requested_capabilities', '[]'::jsonb)) AS capability_id WHERE a.requested_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' GROUP BY 1 LIMIT 8) x;")"
approval_pressure_by_source_json="$(psql_app_at "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.pending_count DESC, x.source_path), '[]'::json) FROM (SELECT COALESCE(metadata ->> 'source_path', 'unknown') AS source_path, COUNT(*) FILTER (WHERE status = 'pending') AS pending_count, COUNT(*) AS total_count FROM approvals WHERE requested_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' GROUP BY 1 LIMIT 5) x;")"
top_worker_provider="$(psql_app_at "SELECT COALESCE(worker_provider, 'unknown') || '|' || COUNT(*) FROM conversation_delegations WHERE COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours' GROUP BY worker_provider ORDER BY COUNT(*) DESC, worker_provider NULLS LAST LIMIT 1;")"
worker_fragility_json="$(psql_app_at "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.blocked_count DESC, x.failed_count DESC, x.total_count DESC, x.worker_provider), '[]'::json) FROM (SELECT COALESCE(worker_provider, 'unknown') AS worker_provider, COUNT(*) FILTER (WHERE status = 'failed') AS failed_count, COUNT(*) FILTER (WHERE status = 'blocked') AS blocked_count, COUNT(*) FILTER (WHERE status IN ('queued', 'running')) AS non_terminal_count, COUNT(*) AS total_count FROM conversation_delegations WHERE COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${RECENT_HOURS} hours' GROUP BY 1 LIMIT 5) x;")"
durable_action_count="$(psql_app_at "SELECT COUNT(*) FROM ghost_action_history WHERE occurred_at >= NOW() - INTERVAL '${RECENT_HOURS} hours';")"
durable_action_mix_json="$(psql_app_at "SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.count DESC, x.event_type), '[]'::json) FROM (SELECT event_type, COUNT(*) AS count FROM ghost_action_history WHERE occurred_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' GROUP BY 1 LIMIT 8) x;")"
approval_action_gaps="$(psql_app_at "SELECT COUNT(*) FROM approvals a WHERE a.requested_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' AND NOT EXISTS (SELECT 1 FROM ghost_action_history gah WHERE gah.event_type = 'approval.requested' AND gah.approval_id = a.id::text);")"
outcome_action_gaps="$(psql_app_at "SELECT COUNT(*) FROM messages m WHERE m.role = 'assistant' AND m.created_at >= NOW() - INTERVAL '${RECENT_HOURS} hours' AND COALESCE(m.metadata ->> 'response_mode', '') <> '' AND NOT EXISTS (SELECT 1 FROM ghost_action_history gah WHERE gah.event_type = 'outcome.recorded' AND gah.request_id = m.id::text);")"

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
export PENDING_APPROVAL_QUEUE="$pending_approval_queue"
export STALE_PENDING_APPROVAL_QUEUE="$stale_pending_approval_queue"
export TERMINAL_AWAITING_FOLLOWTHROUGH="$terminal_awaiting_followthrough"
export RETRY_ENQUEUED_FOLLOWTHROUGH="$retry_enqueued_followthrough"
export CLOSED_FOLLOWTHROUGH="$closed_followthrough"
export APPROVAL_PRESSURE_BY_ENVIRONMENT_JSON="$approval_pressure_by_environment_json"
export APPROVAL_PRESSURE_BY_CAPABILITY_JSON="$approval_pressure_by_capability_json"
export APPROVAL_PRESSURE_BY_SOURCE_JSON="$approval_pressure_by_source_json"
export TOP_WORKER_PROVIDER TOP_WORKER_COUNT
export WORKER_FRAGILITY_JSON="$worker_fragility_json"
export DURABLE_ACTION_COUNT="$durable_action_count"
export DURABLE_ACTION_MIX_JSON="$durable_action_mix_json"
export APPROVAL_ACTION_GAPS="$approval_action_gaps"
export OUTCOME_ACTION_GAPS="$outcome_action_gaps"

node - <<'NODE'
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const projectRoot = '/home/deicide/dev/ghost-stack-codex';
const diagnostics = JSON.parse(fs.readFileSync(path.join(projectRoot, 'ops/foundation/diagnostics.json'), 'utf8'));
const actionFeed = JSON.parse(execFileSync(
  path.join(projectRoot, 'ops/report-action-history.sh'),
  ['--recent-hours', process.env.RECENT_HOURS, '--limit', '200'],
  { encoding: 'utf8' },
));
const workerFragility = JSON.parse(process.env.WORKER_FRAGILITY_JSON || '[]');
const approvalPressureByEnvironment = JSON.parse(process.env.APPROVAL_PRESSURE_BY_ENVIRONMENT_JSON || '[]');
const approvalPressureByCapability = JSON.parse(process.env.APPROVAL_PRESSURE_BY_CAPABILITY_JSON || '[]');
const approvalPressureBySource = JSON.parse(process.env.APPROVAL_PRESSURE_BY_SOURCE_JSON || '[]');
const durableActionMix = JSON.parse(process.env.DURABLE_ACTION_MIX_JSON || '[]');
const eventCounts = {};
for (const record of actionFeed.records || []) {
  eventCounts[record.event_type] = (eventCounts[record.event_type] || 0) + 1;
}
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
    approval_queue_pressure: {
      pending_approvals_24h: Number(process.env.PENDING_APPROVAL_QUEUE),
      stale_pending_approvals: Number(process.env.STALE_PENDING_APPROVAL_QUEUE),
      terminal_awaiting_followthrough_24h: Number(process.env.TERMINAL_AWAITING_FOLLOWTHROUGH),
      retry_enqueued_followthrough_24h: Number(process.env.RETRY_ENQUEUED_FOLLOWTHROUGH),
      closed_followthrough_24h: Number(process.env.CLOSED_FOLLOWTHROUGH),
      pressure_by_environment: approvalPressureByEnvironment,
      pressure_by_capability: approvalPressureByCapability,
      pressure_by_source_path: approvalPressureBySource
    },
    worker_overload_imbalance: {
      top_worker_provider: process.env.TOP_WORKER_PROVIDER,
      top_worker_count_24h: Number(process.env.TOP_WORKER_COUNT),
      worker_fragility: workerFragility
    },
    action_history_gaps: {
      durable_action_records_24h: Number(process.env.DURABLE_ACTION_COUNT),
      durable_action_mix: durableActionMix,
      approval_request_gaps_24h: Number(process.env.APPROVAL_ACTION_GAPS),
      outcome_record_gaps_24h: Number(process.env.OUTCOME_ACTION_GAPS)
    },
    fragile_module_hotspots: {
      hotspot_count: diagnostics.hotspot_modules.length,
      hotspot_modules: diagnostics.hotspot_modules,
      action_event_mix: durableActionMix.slice(0, 5),
      materialized_action_records: actionFeed.record_count || 0,
      runtime_completed_actions_24h: eventCounts['runtime.completed'] || 0,
      outcome_recorded_actions_24h: eventCounts['outcome.recorded'] || 0
    }
  }
};
console.log(JSON.stringify(out, null, 2));
NODE
