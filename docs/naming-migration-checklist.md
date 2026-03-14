# Ghost Naming Migration Checklist

See `docs/naming-standard.md` for the policy that drives these changes.

---

## Current live names (as of 2026-03-14, post-tranche-1)

| Surface | Current name | Target name | Risk | Status |
|---|---|---|---|---|
| n8n workflow display | `Ghost Runtime` | — | cosmetic | **done** |
| Webhook path | `ghost-chat-v3` | `ghost-runtime` | **contract-sensitive** | deferred |
| Builder script | `scripts/build-ghost-runtime-workflow.js` | — | cosmetic | **done** |
| Generated workflow JSON | `workflows/ghost-runtime-workflow.json` | — | cosmetic | **done** |
| Source workflow JSON | `workflows/ghost-runtime-workflow-base.json` | — | cosmetic | **done** |
| `WORKFLOW_NAME` default | `Ghost Runtime` | — | cosmetic | **done** |
| `WORKFLOW_JSON` default | `…/ghost-runtime-workflow.json` | — | cosmetic | **done** |
| `WORKFLOW_BUILDER` default | `…/build-ghost-runtime-workflow.js` | — | cosmetic | **done** |
| `WEBHOOK_PATH` default | `ghost-chat-v3` | `ghost-runtime` | **contract-sensitive** | deferred |
| `parentExecutionTarget` in builder | `webhook/ghost-chat-v3` | `webhook/ghost-runtime` | contract-sensitive (in DB) | deferred |
| `task_runs.n8n_workflow_name` insert | `Ghost Runtime` | — | cosmetic | **done** |

---

## Tranche 1 — Cosmetic renames: EXECUTED (2026-03-14)

### Builder script rename ✓
- [x] `scripts/build-phase5gd-openclaw-workflow.js` → `scripts/build-ghost-runtime-workflow.js`
- [x] `WORKFLOW_BUILDER` in `ops/lib/ghost-ops-common.sh`
- [x] `sourcePath` and `targetPath` inside builder
- [x] `workflowName` constant updated to `"Ghost Runtime"`
- [x] `workflow.name = workflowName` explicit setter retained
- [x] Living docs updated: `docs/claude-handoff-current-state.md`, `docs/phase-7-governed-flow-completion.md`, `ops/README.md`

### Generated workflow JSON rename ✓
- [x] `workflows/ghost-chat-v3-phase5gd-openclaw.json` → `workflows/ghost-runtime-workflow.json`
- [x] `WORKFLOW_JSON` in `ops/lib/ghost-ops-common.sh`
- [x] `targetPath` in builder (done with builder rename)

### Source workflow JSON rename ✓
- [x] `workflows/ghost-chat-v3-phase5d-runtime-ledger.json` → `workflows/ghost-runtime-workflow-base.json`
- [x] `sourcePath` in builder (done with builder rename)

### Display name ✓
- [x] `WORKFLOW_NAME` → `Ghost Runtime`
- [x] `workflowName` constant → `"Ghost Runtime"`
- [x] Rebuilt, re-imported, published, restarted; n8n shows `Ghost Runtime`

### Foundation and metadata ✓
- [x] `ops/foundation/baseline.json`: workflow name, builder path, workflow_json path
- [x] `app/ui/lib/server/task-ledger.ts` insert value

---

## Remaining archive doc cleanup (low priority, non-blocking)

These are historical records and are not runtime-affecting:
- [ ] `scripts/build-phase5d-runtime-ledger-workflow.js` — archive builder, hardcodes `'GHOST by Codex'`; mark as archive or delete
- [ ] `scripts/build-phase4a-memory-workflow.js` — archive, references deactivated Phase4A workflow
- [ ] `docs/ghost-phase3-handoff.md` — historical; consider moving to `docs/archive/`
- [ ] `docs/ghost-phase4a-memory-handoff.md` — historical; consider moving to `docs/archive/`
- [ ] `docs/ghost-runtime-topology-map.md` — has `GHOST by Codex`; update current-state sections when touched

---

## Tranche 2 — Contract-sensitive webhook migration (NOT YET PLANNED)

### Webhook path: `ghost-chat-v3` → `ghost-runtime`

**Why this is contract-sensitive:**
- `WEBHOOK_PATH` used by every ops script
- `parentExecutionTarget = 'webhook/ghost-chat-v3'` stored in `tasks.context_json` and `task_runs.context_json` for every execution
- `scripts/retry-governed-followthrough.js` dispatches to this path
- `ghost_core.webhook_entity` must be updated in sync with n8n activation
- External callers (MCP, clients) pointing to `/webhook/ghost-chat-v3` need migration

**Migration steps (when ready):**
1. [ ] Add `ghost-runtime` webhook alongside `ghost-chat-v3` (both active)
2. [ ] Update caller configs to new path
3. [ ] Validate smoke against new path
4. [ ] Update `WEBHOOK_PATH` in ops lib + rebuild workflow
5. [ ] Activate with new path, run smoke
6. [ ] Monitor `ghost_action_history` and `task_runs` for correct new path recording
7. [ ] After clean window, remove old `ghost-chat-v3` webhook node
8. [ ] Update `parentExecutionTarget` in builder

---

## Files that still reference `ghost-chat-v3` or `ghost-chat` (post-tranche-1)

These are intentional — `ghost-chat-v3` is a live contract, not a cosmetic name:
```
ops/lib/ghost-ops-common.sh          WEBHOOK_PATH default (contract — deferred)
ops/README.md                         docs reference to live contract
ops/promote-live-workflow-safe.sh     docs reference to live contract
scripts/build-ghost-runtime-workflow.js  parentExecutionTarget (contract — deferred)
scripts/governed-followthrough-runtime.js
scripts/retry-governed-followthrough.js  webhook dispatch
scripts/resolve-approval-queue.js
scripts/run-governed-flow-scenarios.js
scripts/validate-phase7-foundations.js
scripts/workflow-modules/delegated-setup-tail.js
scripts/workflow-modules/direct-runtime-tail.js
workflows/ghost-runtime-workflow.json  internal webhook node path parameter
workflows/ghost-runtime-workflow-base.json  internal node
docs/*                                scattered references (non-binding)
```

---

## Coordination dependencies for Tranche 2

- [ ] Confirm no active external callers depend on `/webhook/ghost-chat-v3` without going through the ops-controlled stack
- [ ] Confirm `ghost_app` DB has no running tasks that would be mid-flight when path changes
- [ ] Align two-repo consolidation (ghost-stack-codex / ghost-stack-claude) so rename lands in one canonical place
- [ ] Plan whether `tasks.context_json` / `task_runs.context_json` historical data needs normalization (optional)
