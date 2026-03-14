# Phase 7 Governed-Flow Completion

## Completed through governed follow-through

The governed loop is now durable across request, resolution, follow-through, and timeline surfaces.

- Added governed approval resolution backend path
  - `scripts/resolve-approval-queue.js`
  - `ops/resolve-approval-queue.sh`
- Added governed follow-through executor and durable follow-through store
  - `scripts/governed-followthrough-runtime.js`
  - `scripts/execute-governed-followthrough.js`
  - `ops/execute-governed-followthrough.sh`
  - `ghost_governed_followthrough`
- Extended approval queue reporting with durable resolution/outcome visibility and follow-through state visibility
- Added governed outcome transitions and follow-through lifecycle events to durable action history
- Strengthened action-history retrieval into grouped timeline reporting
- Added governed flow trace reporting
  - `scripts/report-governed-flow.js`
  - `ops/report-governed-flow.sh`
- Moved capability/environment policy into:
  - live delegated setup gating
  - direct admission gating for Codex approval-needed work
- Made worker registry authoritative in:
  - delegated worker selection metadata
  - governed follow-through worker identity
- Added repeatable governed-core scenario harness
  - `scripts/run-governed-flow-scenarios.js`
  - `ops/run-governed-flow-scenarios.sh`
- Re-ran the full Phase 6 builder + Phase 7 governed-flow validation suite

## Durable governed surfaces now in play

- `approvals`
  - durable approval request queue
  - durable terminal resolution state
  - durable resolution metadata
  - durable governed outcome / transition metadata
- `ghost_governed_followthrough`
  - durable approval follow-through records
  - retry vs close-without-retry execution state
  - durable worker/environment/capability linkage for follow-through
- `ghost_action_history`
  - durable request/runtime/outcome history
  - durable approval resolution history
  - durable governed transition history
  - durable governed follow-through lifecycle history

## Stable validation posture

The following remain required after future governed-flow changes:

- `node --check scripts/build-phase5gd-openclaw-workflow.js`
- `for f in scripts/workflow-modules/*.js; do node --check \"$f\"; done`
- `node scripts/build-phase5gd-openclaw-workflow.js`
- `ops/reconcile-runtime.sh --recent-hours 12 --limit 25`
- `node scripts/validate-phase7-foundations.js`
- approval queue report/probe
- approval resolution probe
- governed follow-through report/probe
- governed flow trace probe
- action-history report/probe
- diagnostics probe
- environment-policy probe
- worker-selection probe
- governed-flow scenario harness

## Added: controlled retry executor (Phase 7 follow-through completion)

- `scripts/retry-governed-followthrough.js`
  - consumes `retry_enqueued` rows durably
  - validates `outcome_status = allowed` before any dispatch
  - POSTs to Ghost webhook (`N8N_BASE_URL/webhook/WEBHOOK_PATH`) with `conversation_id`,
    approval-continuation message, and `X-Ghost-Entry-Point: approval_retry` header
  - transitions `execution_state`: `retry_enqueued` → `retry_dispatched` (or `retry_failed`)
  - embeds retry result (`retry_n8n_execution_id`, `retry_dispatched_at`, reply summary)
    into `next_step_payload` of `ghost_governed_followthrough`
  - records `governance.retry_dispatched` or `governance.retry_failed` in `ghost_action_history`
  - `--dry-run true` mode for safe inspection without live webhook hit
- `ops/retry-governed-followthrough.sh` — operator wrapper
- `ops/foundation/action-model.json` — added `governance.retry_dispatched` and `governance.retry_failed`
- `scripts/run-governed-flow-scenarios.js` — `--with-retry` flag runs dry-run probe

## Remaining thin areas

- no first-class operator UI for approval queue or retry queue
- retry is operator-invoked (script); not automated or event-driven
- worker registry authority is stronger, but not yet system-wide
- broad policy admission remains intentionally narrow and bounded

## MVP posture after retry executor

The governed loop is now end-to-end executable:

- approval request → durable queue
- operator resolution → durable governed outcome
- follow-through planning → durable `retry_enqueued` intent
- retry executor → real webhook dispatch → durable `retry_dispatched` + new n8n execution
- action history captures full timeline at every stage
