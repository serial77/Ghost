# Claude Handoff: Current Ghost State

## 1. Current branch / status

- Branch: `codex-direct-truth-reconcile`
- Remote state: pushed to `origin`
- Merge state: not merged
- Working tree at handoff creation: clean before this docs-only file; only this handoff doc was added in this step

## 2. What is complete

- Phase 6: effectively complete as builder modularization
  - direct runtime tail extracted
  - memory extraction tail extracted
  - delegated completion/result tail extracted
  - delegated control/setup/router/worker-runtime regions extracted
  - builder modularization baseline is established and validated
- Phase 7: materially real and near-MVP-ready on the backend/governance side
  - durable approval request persistence in `approvals`
  - durable approval resolution
  - durable governed outcome metadata
  - durable governed follow-through in `ghost_governed_followthrough`
  - durable action history in `ghost_action_history`
  - grouped action-history timeline reporting
  - governed flow trace reporting
  - capability/environment policy consumed in bounded live admission slices
  - worker registry consumed in delegated setup and governed follow-through identity
  - governed-flow scenario harness exists and runs
- Near-MVP-ready now means:
  - the governed operator core is durable, inspectable, and parity-clean
  - the main remaining backend gap is follow-through execution, not truth persistence

## 3. What is frozen / do not drift

- Direct truth contract
  - API response
  - assistant metadata
  - `task_runs.output_payload`
  - direct `tool_events.payload`
- Delegated truth contract
  - `conversation_delegations`
  - delegated runtime `tasks` / `task_runs`
  - worker assistant metadata
  - parent assistant metadata
  - delegated completion `tool_events`
- Reconciliation expectations
  - `Recent Direct Path Surface Parity = OK no findings`
  - `Recent Delegated Path Surface Parity = OK no findings`
- Deployment safety expectations
  - do not introduce runtime `Execute Workflow` semantics casually
  - do not merge without an explicit request
  - do not widen changes into UI or historical DB cleanup
- Phase 6 builder modularization baseline
  - builder modules under [`scripts/workflow-modules`](/home/deicide/dev/ghost-stack-codex/scripts/workflow-modules)
  - generated workflow must remain reproducible from [`scripts/build-phase5gd-openclaw-workflow.js`](/home/deicide/dev/ghost-stack-codex/scripts/build-phase5gd-openclaw-workflow.js)
- Governance contract surfaces that should not be casually rewritten
  - [`ops/foundation/approval-model.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/approval-model.json)
  - [`ops/foundation/action-model.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/action-model.json)
  - [`ops/foundation/workers.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/workers.json)
  - [`ops/foundation/capabilities.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/capabilities.json)
  - [`ops/foundation/environments.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/environments.json)

## 4. What remains incomplete

- Remaining backend gap
  - approved follow-through rows record durable `retry_enqueued` intent, but Ghost does not yet execute one real blocked-work retry/unblock path end to end
- Remaining operator/UI gap
  - no first-class approval queue UI
  - durable action and approval surfaces are still mostly shell/helper consumed
- Remaining broader authority gap
  - capability/environment and worker authority are real in bounded slices, not yet system-wide

## 5. Best next supervised step

Implement one controlled approved-followthrough executor that consumes a durable `retry_enqueued` row and actually retries or unblocks one blocked path end to end.

Target shape:

- choose one blocked path only
- approved row -> durable governed outcome already says `allowed`
- consume the follow-through row
- execute one narrow retry/unblock action
- keep the result durable and inspectable across:
  - `approvals`
  - `ghost_governed_followthrough`
  - `ghost_action_history`
  - existing runtime/delegation truth surfaces

Do not start with a broad replay engine.

## 6. Validation contract

Run before and after runtime-affecting changes:

- `node --check /home/deicide/dev/ghost-stack-codex/scripts/build-phase5gd-openclaw-workflow.js`
- `for f in /home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/*.js; do node --check "$f"; done`
- `node /home/deicide/dev/ghost-stack-codex/scripts/build-phase5gd-openclaw-workflow.js`
- `bash -n /home/deicide/dev/ghost-stack-codex/ops/reconcile-runtime.sh`
- `/home/deicide/dev/ghost-stack-codex/ops/reconcile-runtime.sh --recent-hours 12 --limit 25`
- `node /home/deicide/dev/ghost-stack-codex/scripts/validate-phase7-foundations.js`

Run the Phase 7 helper/report suite when governance surfaces are touched:

- `/home/deicide/dev/ghost-stack-codex/ops/report-phase7-foundations.sh`
- `/home/deicide/dev/ghost-stack-codex/ops/report-approval-queue.sh --recent-hours 72 --limit 10`
- `/home/deicide/dev/ghost-stack-codex/ops/report-governed-followthrough.sh --recent-hours 72 --limit 10`
- `/home/deicide/dev/ghost-stack-codex/ops/report-governed-flow.sh --recent-hours 72 --limit 5`
- `/home/deicide/dev/ghost-stack-codex/ops/report-action-history.sh --recent-hours 24 --limit 10 --group-by conversation`
- `/home/deicide/dev/ghost-stack-codex/ops/diagnose-runtime-foundations.sh --recent-hours 24 --stale-minutes 30`
- `/home/deicide/dev/ghost-stack-codex/ops/render-environment-policy.sh --environment prod`
- `/home/deicide/dev/ghost-stack-codex/ops/render-environment-policy.sh --environment lab`

Run the governed-flow scenario harness when approval/follow-through/action linkage changes:

- `/home/deicide/dev/ghost-stack-codex/ops/run-governed-flow-scenarios.sh`

Expected parity result after runtime-affecting changes:

- `Recent Direct Path Surface Parity = OK no findings`
- `Recent Delegated Path Surface Parity = OK no findings`

## 7. Do not touch casually

- direct-path persistence truth shaping
- delegated-path persistence truth shaping
- approval lifecycle state semantics
- governed follow-through execution-state semantics
- action event naming/vocabulary
- delegated setup policy/worker selection slices
- direct admission policy slice
- reconciliation helper expectations
- generated workflow connection semantics unless the builder is regenerated and probed immediately

High-risk files/areas:

- [`scripts/build-phase5gd-openclaw-workflow.js`](/home/deicide/dev/ghost-stack-codex/scripts/build-phase5gd-openclaw-workflow.js)
- [`scripts/workflow-modules/delegated-setup-tail.js`](/home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/delegated-setup-tail.js)
- [`scripts/workflow-modules/owner-policy-tail.js`](/home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/owner-policy-tail.js)
- [`scripts/workflow-modules/delegation-router-tail.js`](/home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/delegation-router-tail.js)
- [`scripts/workflow-modules/delegated-worker-runtime-tail.js`](/home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/delegated-worker-runtime-tail.js)
- [`scripts/resolve-approval-queue.js`](/home/deicide/dev/ghost-stack-codex/scripts/resolve-approval-queue.js)
- [`scripts/governed-followthrough-runtime.js`](/home/deicide/dev/ghost-stack-codex/scripts/governed-followthrough-runtime.js)
- [`scripts/execute-governed-followthrough.js`](/home/deicide/dev/ghost-stack-codex/scripts/execute-governed-followthrough.js)
- [`scripts/action-record-runtime.js`](/home/deicide/dev/ghost-stack-codex/scripts/action-record-runtime.js)

## 8. Near-term objective

Ghost is **near-MVP-ready**, not fully MVP-ready.

Why:

- the governed operator core is now durable, authoritative in bounded slices, and operationally coherent
- direct/delegated parity remains green
- approvals, action history, follow-through, policy, and worker identity are all real backend surfaces
- the main remaining gap is not truth persistence; it is executing one real approved follow-through path end to end
