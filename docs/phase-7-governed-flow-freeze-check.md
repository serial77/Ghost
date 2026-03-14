# Phase 7 Governed-Flow Freeze Check

## Current judgment

Ghost is now materially closer to a Phase 7 MVP-grade governed operator core, and the governed loop is no longer limited to request-only persistence.

The governed surfaces are no longer only scaffolding:

- blocked direct and delegated approval-needed paths emit durable approval queue rows
- approval queue rows can now be resolved through a governed backend path
- approval resolution writes durable terminal state, resolution metadata, and governed outcome metadata
- resolved approval rows can now drive a controlled governed follow-through executor
- governed follow-through persists durable lifecycle state in `ghost_governed_followthrough`
- governed approval outcomes now produce durable action-history events:
  - `approval.resolved`
  - `governance.transitioned`
  - `governance.allowed`
  - `governance.denied`
  - `governance.retry_enqueued`
  - `governance.closed_without_retry`
- action history now supports grouped timeline retrieval by conversation, runtime, delegation, and approval
- governed flow trace reporting can now reconstruct approval -> follow-through -> action history -> runtime/delegation linkage
- capability/environment policy now affects:
  - live delegated setup gating upstream
  - direct Codex admission gating upstream
- worker registry now participates in:
  - delegated worker selection metadata
  - governed follow-through identity and durable governed outputs
- governed-flow scenario harness now exercises approved and denied direct/delegated flows repeatably
- direct-path and delegated-path recent parity still pass after the governed-flow changes

## What is truly real

- Durable approval queue
  - persisted in `approvals`
  - readable through `ops/report-approval-queue.sh`
  - resolvable through `ops/resolve-approval-queue.sh`
- Durable governed follow-through
  - persisted in `ghost_governed_followthrough`
  - executable through `ops/execute-governed-followthrough.sh`
  - readable through `ops/report-governed-followthrough.sh`
  - traceable through `ops/report-governed-flow.sh`
- Durable action history
  - persisted in `ghost_action_history`
  - synced via `ops/sync-action-history.sh`
  - reported through `ops/report-action-history.sh`
- Governed approval lifecycle
  - transition validation against `ops/foundation/approval-model.json`
  - terminal outcomes: `approved`, `rejected`, `expired`, `cancelled`, `superseded`
  - controlled follow-through outcomes:
    - `retry_enqueued`
    - `closed_without_retry`
- Upstream policy consumption
  - delegated setup consumes capability/environment policy before worker start
  - direct Codex admission consumes capability/environment policy before the approval response is built
- Worker contract consumption
  - delegated setup chooses the worker from the worker registry for `technical_work`
  - governed follow-through records authoritative worker registry identity
- Repeatable governed-flow regression coverage
  - `ops/run-governed-flow-scenarios.sh`
  - approved and denied direct/delegated scenarios
  - grouped approval timeline reconstruction

## What is still partial but acceptable for near-MVP

- Approval resolution is backend/CLI-driven, not yet an operator queue UI
- Governed outcomes are durable and explicit, but approved rows still stop at controlled retry/unblock intent rather than a full asynchronous replay executor
- Action history is durable and queryable, but not yet exposed through a richer operator surface
- Capability/environment policy is consumed in bounded live slices, not yet as a broad policy engine
- Worker registry is authoritative in bounded slices, but not yet across all routing/selection logic

## What still blocks a stronger MVP-ready claim

- no first-class approval resolution consumer in a UI/operator queue
- no durable retry/resume executor that actually replays blocked work after follow-through intent is recorded
- no first-class durable approval-resolution follow-through into orchestration replay
- historical delegated linkage residue still exists:
  - `missing_orchestration_task`
  - stale runtime rows

## MVP readiness judgment

Current state is best described as:

- Phase 7 governed core: **near-MVP-ready**
- durable governance foundation: **real**
- operator-governed backend loop: **real and durable, but still supervised/manual**

One or two more supervised backend steps would make the MVP claim much stronger:

1. durable approval resolution follow-through into a controlled unblock/retry executor that actually retries one blocked path
2. durable operator-facing approval/action retrieval surface beyond shell/report helpers

## Do not touch casually

- direct-path truth contract
- delegated-path truth contract
- recent parity expectations in `ops/reconcile-runtime.sh`
- approval lifecycle semantics in `ops/foundation/approval-model.json`
- action vocabulary semantics in `ops/foundation/action-model.json`
- delegated setup policy/worker selection slices without re-running the full governed-flow probes
- governed follow-through lifecycle semantics without re-running the scenario harness and governed trace reporters
