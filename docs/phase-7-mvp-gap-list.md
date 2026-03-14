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

## Thin but acceptable for near-MVP

- approval queue is backend/report-helper driven, not operator UI driven
- retry dispatch is durable and inspectable, but triggered by operator/script — not automated
- action history is durable, but mostly helper-consumed
- policy gating is authoritative in bounded slices, not broad policy-engine form
- worker registry authority is real, but not system-wide

## Completed since last gap list

- controlled unblock/retry executor added (`scripts/retry-governed-followthrough.js`)
  - consumes `retry_enqueued` rows from `ghost_governed_followthrough`
  - validates `outcome_status = allowed` before dispatch
  - POSTs to Ghost webhook with `conversation_id` and approval-continuation message
  - records `retry_dispatched` or `retry_failed` durably in `ghost_governed_followthrough`
  - emits `governance.retry_dispatched` or `governance.retry_failed` to `ghost_action_history`
  - `--dry-run true` mode for validation without live webhook hit
  - `governance.retry_dispatched` and `governance.retry_failed` added to action-model.json
  - scenario harness extended with `--with-retry` dry-run probe

## Still missing for a stronger MVP claim

- first-class operator UI surface for approval queue and retry queue
- broader authoritative worker/capability policy checks in more than one routing/execution slice
- automated retry trigger (current: operator-invoked script)

## Do not weaken

- direct-path persistence truth
- delegated-path persistence truth
- approval lifecycle semantics
- governed follow-through execution-state semantics
- action event naming coherence
- recent direct/delegated parity guarantees
