# Phase 7 Governed-Flow Freeze Check

## Current judgment

Ghost is now materially closer to a Phase 7 MVP-grade governed operator core.

The governed surfaces are no longer only scaffolding:

- blocked direct and delegated approval-needed paths emit durable approval queue rows
- approval queue rows can now be resolved through a governed backend path
- approval resolution writes durable terminal state, resolution metadata, and governed outcome metadata
- governed approval outcomes now produce durable action-history events:
  - `approval.resolved`
  - `governance.transitioned`
- action history now supports grouped timeline retrieval by conversation, runtime, delegation, and approval
- capability/environment policy now affects live delegated setup gating upstream, not just blocked response shaping
- worker registry now participates in delegated worker selection metadata, not just downstream labeling
- direct-path and delegated-path recent parity still pass after the governed-flow changes

## What is truly real

- Durable approval queue
  - persisted in `approvals`
  - readable through `ops/report-approval-queue.sh`
  - resolvable through `ops/resolve-approval-queue.sh`
- Durable action history
  - persisted in `ghost_action_history`
  - synced via `ops/sync-action-history.sh`
  - reported through `ops/report-action-history.sh`
- Governed approval lifecycle
  - transition validation against `ops/foundation/approval-model.json`
  - terminal outcomes: `approved`, `rejected`, `expired`, `cancelled`, `superseded`
- Upstream policy consumption
  - delegated setup consumes capability/environment policy before worker start
- Worker contract consumption
  - delegated setup chooses the worker from the worker registry for `technical_work`

## What is still partial but acceptable for near-MVP

- Approval resolution is backend/CLI-driven, not yet an operator queue UI
- Governed outcomes are durable and explicit, but they do not yet replay or resume blocked work asynchronously
- Action history is durable and queryable, but not yet exposed through a richer operator surface
- Capability/environment policy is consumed in bounded live slices, not yet as a broad policy engine
- Worker registry is authoritative in delegated setup, but not yet across all routing/selection logic

## What still blocks a stronger MVP-ready claim

- no first-class approval resolution consumer in a UI/operator queue
- no durable retry/resume executor for approved blocked work
- no first-class durable approval-resolution follow-through into orchestration replay
- historical delegated linkage residue still exists:
  - `missing_orchestration_task`
  - stale runtime rows

## MVP readiness judgment

Current state is best described as:

- Phase 7 governed core: **near-MVP-ready**
- durable governance foundation: **real**
- operator-governed backend loop: **real but still supervised/manual**

One or two more supervised backend steps would make the MVP claim much stronger:

1. durable approval resolution follow-through into a controlled unblock/retry executor
2. durable operator-facing approval/action retrieval surface beyond shell/report helpers

## Do not touch casually

- direct-path truth contract
- delegated-path truth contract
- recent parity expectations in `ops/reconcile-runtime.sh`
- approval lifecycle semantics in `ops/foundation/approval-model.json`
- action vocabulary semantics in `ops/foundation/action-model.json`
- delegated setup policy/worker selection slices without re-running the full governed-flow probes
