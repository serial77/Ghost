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
- follow-through records retry intent, but does not yet replay blocked work
- action history is durable, but mostly helper-consumed
- policy gating is authoritative in bounded slices, not broad policy-engine form
- worker registry authority is real, but not system-wide

## Still missing for a stronger MVP claim

- one controlled unblock/retry executor that consumes approved follow-through rows
- one durable operator-facing retrieval surface beyond shell helpers
- broader authoritative worker/capability policy checks in more than one routing/execution slice

## Do not weaken

- direct-path persistence truth
- delegated-path persistence truth
- approval lifecycle semantics
- governed follow-through execution-state semantics
- action event naming coherence
- recent direct/delegated parity guarantees
