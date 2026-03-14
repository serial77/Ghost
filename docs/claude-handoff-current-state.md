# Claude Handoff: Current Ghost State

## 1. Current branch / status (updated 2026-03-14)

- `main` is up to date with:
  - MVP governed loop (Phase 7)
  - naming tranche 1 (Ghost Runtime display name, builder/artifact rename)
  - System Health live data page
  - dual-path webhook migration (`ghost-runtime` canonical, `ghost-chat-v3` legacy)
  - repo consolidation (self-contained docker-compose, worktree structure documented)
  - Mission Control UI polish (WebGL FloatingLines/GhostAurora/GhostOrb, desaturated palette, three.js + ogl)
- Active working worktree: `~/dev/ghost-stack-codex` on `main` — authoritative development copy, UI server running here
- UI worktree: `~/dev/ghost-stack-claude` on `claude-mission-control-polish` — merged to main; `next dev` stopped here
- Review/operator worktree: `~/dev/ghost-stack` on `chore/normalize-canonical-artifact-names` (stale, but holds live `.env` and `db/`)

## 2. What is complete

- Phase 6: effectively complete as builder modularization
  - direct runtime tail extracted
  - memory extraction tail extracted
  - delegated completion/result tail extracted
  - delegated control/setup/router/worker-runtime regions extracted
  - builder modularization baseline is established and validated
- Phase 7: **MVP-ready** — governed loop proven live end-to-end, operator approval UI shipped
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
- Completed in MVP closure pass (2026-03):
  - fixed `$items('Start Runtime Ledger', 0, 0)[0]?.json.task_id` accessor in builder (was silently skipping approval INSERT due to sink-node paired-item resolution failure)
  - live loop proven end-to-end: blocked execution → approval persisted → resolved via shell → follow-through executed → retry dispatched → new n8n execution succeeded
  - operator approval API: `GET /api/operations/approvals`, `POST /api/operations/approvals/[id]/resolve`
  - operator approval UI panel in Task Overview: pending/resolved display, Approve/Reject buttons, follow-through guidance
- MVP-ready now means:
  - the governed operator core is durable, inspectable, parity-clean, and live-loop verified
  - operator can see and act on pending approvals directly in the UI
  - follow-through (resolve → execute → retry) is manual/operator-invoked, not automated — intentional posture

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
  - generated workflow must remain reproducible from [`scripts/build-ghost-runtime-workflow.js`](/home/deicide/dev/ghost-stack-codex/scripts/build-ghost-runtime-workflow.js) (Copilot's naming branch may rename this post-merge — do not rename on this branch)
  - `$items('Start Runtime Ledger', 0, 0)[0]?.json` is the correct accessor for sink nodes — do not revert to `$('Start Runtime Ledger').item.json`
- Governance contract surfaces that should not be casually rewritten
  - [`ops/foundation/approval-model.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/approval-model.json)
  - [`ops/foundation/action-model.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/action-model.json)
  - [`ops/foundation/workers.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/workers.json)
  - [`ops/foundation/capabilities.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/capabilities.json)
  - [`ops/foundation/environments.json`](/home/deicide/dev/ghost-stack-codex/ops/foundation/environments.json)

## 4. What remains incomplete

- Remaining operator posture gap
  - follow-through after UI approve is manual: operator must run `bash ops/resolve-approval-queue.sh` then `bash ops/execute-governed-followthrough.sh` then `bash ops/retry-governed-followthrough.sh`; the UI surfaces this guidance but does not automate it
  - retry queue has no dedicated UI surface (approval queue UI shows approved items; retry queue visibility is shell/helper)
  - action history surface is durable and inspectable via shell helpers but has no dedicated UI panel
- Remaining broader authority gap
  - capability/environment and worker authority are real in bounded slices, not yet system-wide
- Worktree state
  - Three git worktrees: `ghost-stack` (main), `ghost-stack-codex` (dev/canonical), `ghost-stack-claude` (UI/running)
  - `ghost-stack-claude` is on `claude-mission-control-polish` — has Mission Control UI polish not yet merged to main
  - No more manual file mirroring — use `git merge main` inside the UI worktree to sync changes
  - `ghost-stack` is stale on an old branch but must not be deleted — holds live `.env` and DB artifacts

## 5. Best next supervised step (updated 2026-03-14)

Main is green with the full stack including WebGL UI. Remaining next steps:

- **Legacy webhook retirement** — `ghost-chat-v3` trigger removal after a migration window (see `docs/naming-migration-checklist.md`)
- **Automated follow-through** — current posture is manual operator-invoked; automating resolve→execute→retry is the next governance UX step
- **Retry queue UI panel** — no dedicated surface yet; shell/helper only
- **Action history UI panel** — durable and inspectable via shell, no dedicated UI panel yet
- **Broad policy authority** — capability/environment and worker authority are real in bounded slices, not yet system-wide
- **ghost-stack main worktree** — stale on `chore/normalize-canonical-artifact-names`, 90+ commits behind main; update when convenient (`git fetch && git checkout main && git pull`)

## 6. Validation contract

Run before and after runtime-affecting changes:

- `node --check /home/deicide/dev/ghost-stack-codex/scripts/build-ghost-runtime-workflow.js`
- `for f in /home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/*.js; do node --check "$f"; done`
- `node /home/deicide/dev/ghost-stack-codex/scripts/build-ghost-runtime-workflow.js`
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

- [`scripts/build-ghost-runtime-workflow.js`](/home/deicide/dev/ghost-stack-codex/scripts/build-ghost-runtime-workflow.js)
- [`scripts/workflow-modules/delegated-setup-tail.js`](/home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/delegated-setup-tail.js)
- [`scripts/workflow-modules/owner-policy-tail.js`](/home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/owner-policy-tail.js)
- [`scripts/workflow-modules/delegation-router-tail.js`](/home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/delegation-router-tail.js)
- [`scripts/workflow-modules/delegated-worker-runtime-tail.js`](/home/deicide/dev/ghost-stack-codex/scripts/workflow-modules/delegated-worker-runtime-tail.js)
- [`scripts/resolve-approval-queue.js`](/home/deicide/dev/ghost-stack-codex/scripts/resolve-approval-queue.js)
- [`scripts/governed-followthrough-runtime.js`](/home/deicide/dev/ghost-stack-codex/scripts/governed-followthrough-runtime.js)
- [`scripts/execute-governed-followthrough.js`](/home/deicide/dev/ghost-stack-codex/scripts/execute-governed-followthrough.js)
- [`scripts/action-record-runtime.js`](/home/deicide/dev/ghost-stack-codex/scripts/action-record-runtime.js)

## 8. Near-term objective

Ghost is **MVP-ready**.

Why:

- the governed operator core is durable, authoritative in bounded slices, and operationally coherent
- direct/delegated parity remains green
- approvals, action history, follow-through, policy, and worker identity are all real backend surfaces
- the governed loop is live-verified end-to-end (blocked execution → approval persisted → shell resolve → follow-through → retry dispatch → new execution succeeded)
- operator approval UI exists: pending approvals visible and actionable in Task Overview, follow-through guidance surfaced inline
- remaining gaps (automated retry, retry queue UI, action history UI, broad policy) are post-MVP scope

## 9. Pending branch consolidation

**This branch (`codex-direct-truth-reconcile`) is ready to merge.** TypeScript checks pass, workflow fix live-proven, approval surface functional.

**Copilot's `chore/normalize-canonical-artifact-names` branch — actual state:**

- Despite the branch name, no file renames have been committed yet (builder and workflow files still have the old names)
- Actual changes: adds `.github/copilot-instructions.md`, `docs/ai-workspace-playbook.md`, `ops/promote-live-workflow-safe.sh`, extends `ops/README.md` with a canonical promotion path section

**Conflict surface:**

- Only `ops/README.md` is modified in both branches — a docs-only conflict
- Our branch rewrote the `activate-live-workflow.sh` description
- Copilot's branch added a new "Canonical workflow promotion path" section using `promote-live-workflow-safe.sh`
- Resolution: additive — keep both sections, order Copilot's canonical path first, then existing script entries

**Recommended merge order:**

1. Copilot's naming branch first (no functional changes, small conflict surface)
2. Then this branch (resolve `ops/README.md` by incorporating both sections)

**After merge:**

- consolidate `ghost-stack-claude` and `ghost-stack-codex` two-repo operational debt
- ensure live UI server switches to the merged version
- update validation contract references if builder file is eventually renamed
