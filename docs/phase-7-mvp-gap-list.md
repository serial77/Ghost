# Phase 7 MVP Gap List

## Durable and authoritative now

- approval requests persist durably in `approvals`
- approval rows resolve durably with governed outcome metadata
- governed follow-through persists durably in `ghost_governed_followthrough`
- approval lifecycle events persist durably in `ghost_action_history`
- governed flow traces can be reconstructed through:
  - approval queue reporting
  - governed follow-through reporting
  - action history grouped timelines
  - governed flow trace reporting
- capability/environment policy affects bounded live admission points
- worker registry affects bounded live worker-selection and governed output slices
- recent direct and delegated parity remain green

## Thin but acceptable for MVP

- approval queue has operator UI (Task Overview panel); retry queue is still shell/helper only
- retry dispatch is durable and inspectable, but triggered by operator/script — not automated; UI surfaces the command guidance
- action history is durable, but mostly helper-consumed; no UI panel
- policy gating is authoritative in bounded slices, not broad policy-engine form
- worker registry authority is real, but not system-wide

## Completed since last gap list (2026-03)

- live loop proven end-to-end on live stack (blocked execution 489 → approval → resolve → execute → retry → execution 490 succeeded)
- fixed `$items('Start Runtime Ledger', 0, 0)[0]?.json.task_id` accessor in builder (was silently skipping approval INSERT)
- operator approval API: `GET /api/operations/approvals`, `POST /api/operations/approvals/[id]/resolve`
- operator approval UI in Task Overview: pending/resolved display, Approve/Reject buttons, follow-through guidance
- controlled unblock/retry executor added (`scripts/retry-governed-followthrough.js`)
  - consumes `retry_enqueued` rows from `ghost_governed_followthrough`
  - validates `outcome_status = allowed` before dispatch
  - POSTs to Ghost webhook with `conversation_id` and approval-continuation message
  - records `retry_dispatched` or `retry_failed` durably in `ghost_governed_followthrough`
  - emits `governance.retry_dispatched` or `governance.retry_failed` to `ghost_action_history`
  - `--dry-run true` mode for validation without live webhook hit
  - `governance.retry_dispatched` and `governance.retry_failed` added to action-model.json
  - scenario harness extended with `--with-retry` dry-run probe

## Still missing for a stronger post-MVP claim

- first-class operator UI surface for retry queue (approval queue UI is closed)
- dedicated UI panel for action history (currently shell/helper only)
- broader authoritative worker/capability policy checks in more than one routing/execution slice
- automated retry trigger (current: operator-invoked script; UI surfaces guidance)

## Do not weaken

- direct-path persistence truth
- delegated-path persistence truth
- approval lifecycle semantics
- governed follow-through execution-state semantics
- action event naming coherence
- recent direct/delegated parity guarantees
