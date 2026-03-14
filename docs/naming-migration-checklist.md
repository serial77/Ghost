# Ghost Naming Migration Checklist

Status: **NOT YET EXECUTED** — this is the pre-migration planning document.
See `docs/naming-standard.md` for the policy that drives these changes.

---

## Current live names (as of 2026-03-14)

| Surface | Current name | Target name | Risk |
|---|---|---|---|
| n8n workflow display | `Ghost Chat Runtime` | `Ghost Runtime` | cosmetic |
| Webhook path | `ghost-chat-v3` | `ghost-runtime` | **contract-sensitive** |
| Builder script | `scripts/build-phase5gd-openclaw-workflow.js` | `scripts/build-ghost-runtime-workflow.js` | cosmetic |
| Generated workflow JSON | `workflows/ghost-chat-v3-phase5gd-openclaw.json` | `workflows/ghost-runtime-workflow.json` | cosmetic |
| Source workflow JSON | `workflows/ghost-chat-v3-phase5d-runtime-ledger.json` | `workflows/ghost-runtime-workflow-base.json` | cosmetic |
| `WORKFLOW_NAME` default | `Ghost Chat Runtime` | `Ghost Runtime` | cosmetic |
| `WORKFLOW_JSON` default | `…/ghost-chat-v3-phase5gd-openclaw.json` | `…/ghost-runtime-workflow.json` | cosmetic |
| `WORKFLOW_BUILDER` default | `…/build-phase5gd-openclaw-workflow.js` | `…/build-ghost-runtime-workflow.js` | cosmetic |
| `WEBHOOK_PATH` default | `ghost-chat-v3` | `ghost-runtime` | **contract-sensitive** |
| `parentExecutionTarget` in builder | `webhook/ghost-chat-v3` | `webhook/ghost-runtime` | contract-sensitive (stored in DB) |
| `task_runs.n8n_workflow_name` insert | `Ghost Chat Runtime` | `Ghost Runtime` | cosmetic |

---

## Cosmetic renames — safe to do in a single controlled PR

All of these can be done together once the webhook migration is separately planned.

### 1. Builder script rename
- [ ] Rename `scripts/build-phase5gd-openclaw-workflow.js` → `scripts/build-ghost-runtime-workflow.js`
- [ ] Update `WORKFLOW_BUILDER` default in `ops/lib/ghost-ops-common.sh`
- [ ] Update `targetPath` and `sourcePath` references inside the builder itself
- [ ] Update all docs that reference the old builder filename:
  - `docs/claude-handoff-current-state.md` (Section 3, Section 6, Section 7)
  - `docs/phase-7-governed-flow-completion.md`
  - `ops/README.md` (Direct Path Contract section references `scripts/build-phase5gd-openclaw-workflow.js`)
  - `docs/naming-standard.md` (this will update automatically)

### 2. Generated workflow JSON rename
- [ ] Rename `workflows/ghost-chat-v3-phase5gd-openclaw.json` → `workflows/ghost-runtime-workflow.json`
- [ ] Update `targetPath` in builder (done as part of builder rename)
- [ ] Update `WORKFLOW_JSON` default in `ops/lib/ghost-ops-common.sh`
- [ ] Update gitignore if needed (current patterns are timestamp-based, should still apply)

### 3. Source workflow JSON rename
- [ ] Rename `workflows/ghost-chat-v3-phase5d-runtime-ledger.json` → `workflows/ghost-runtime-workflow-base.json`
- [ ] Update `sourcePath` in builder (done as part of builder rename)

### 4. Workflow display name final step
- [ ] Update `WORKFLOW_NAME` from `Ghost Chat Runtime` → `Ghost Runtime` when ready
- [ ] Update `workflowName` constant in builder
- [ ] Rebuild, re-import, republish, restart
- [ ] Update `task-ledger.ts` `n8n_workflow_name` insert value

### 5. Remaining legacy references in archive docs/scripts
- [ ] `scripts/build-phase5d-runtime-ledger-workflow.js` — hardcodes `'GHOST by Codex'` in code node strings; update or mark as archive-only
- [ ] `scripts/build-phase4a-memory-workflow.js` — references `GHOST by Codex Phase4A Memory Dev`; mark as archive since Phase4A is deactivated
- [ ] `docs/ghost-phase3-handoff.md` — historical, consider moving to `docs/archive/`
- [ ] `docs/ghost-phase4a-memory-handoff.md` — historical, consider moving to `docs/archive/`
- [ ] `docs/ghost-runtime-topology-map.md` — references `GHOST by Codex`; update current-state sections

---

## Contract-sensitive migration — requires its own controlled pass

These changes affect live runtime behavior, stored data, or external callers. Do NOT include in the cosmetic rename PR.

### Webhook path migration: `ghost-chat-v3` → `ghost-runtime`

**Why this is contract-sensitive:**
- `WEBHOOK_PATH` in `ops/lib/ghost-ops-common.sh` is used by every ops script (smoke, activate, reconcile, etc.)
- `parentExecutionTarget = 'webhook/ghost-chat-v3'` in the builder is stored in `tasks.context_json` and `task_runs.context_json` for every execution — historical rows keep the old value; new rows need the new value
- `scripts/retry-governed-followthrough.js` dispatches to `${N8N_BASE_URL}/webhook/${WEBHOOK_PATH}` — if `WEBHOOK_PATH` changes, retry dispatch changes
- Webhook entity in `ghost_core.webhook_entity` must be updated
- Any external callers (MCP server, mobile clients, etc.) pointing to `/webhook/ghost-chat-v3` must be migrated before the old path is removed

**Migration steps (when ready):**
1. [ ] Add new webhook path `ghost-runtime` alongside `ghost-chat-v3` (keep both active)
2. [ ] Update caller configs to use new path
3. [ ] Validate smoke against new path
4. [ ] Update `WEBHOOK_PATH` in ops lib + rebuild workflow
5. [ ] Activate workflow with new path
6. [ ] Monitor `ghost_action_history` and `task_runs` for correct new path recording
7. [ ] After a clean window, deactivate the old `ghost-chat-v3` webhook node
8. [ ] Update `parentExecutionTarget` in builder (new DB rows will use new path; old rows are historical)

---

## Files that reference `ghost-chat-v3` or `ghost-chat` (full list)

```
ops/lib/ghost-ops-common.sh          WEBHOOK_PATH default
ops/README.md                         docs reference
ops/promote-live-workflow-safe.sh     docs reference
scripts/build-phase5gd-openclaw-workflow.js  parentExecutionTarget, targetPath, sourcePath
scripts/governed-followthrough-runtime.js    contract references
scripts/retry-governed-followthrough.js      webhook dispatch
scripts/resolve-approval-queue.js            contract references
scripts/run-governed-flow-scenarios.js       test data
scripts/validate-phase7-foundations.js       foundation checks
scripts/workflow-modules/delegated-setup-tail.js  execution target references
scripts/workflow-modules/direct-runtime-tail.js   execution target references
workflows/ghost-chat-v3-phase5gd-openclaw.json  filename + internal references
workflows/ghost-chat-v3-phase5d-runtime-ledger.json  filename + internal references
docs/*                                scattered references (non-binding)
```

---

## Coordination dependencies

Before executing the contract-sensitive migration:
- [ ] Confirm no active external callers depend on `/webhook/ghost-chat-v3` without going through the ops-controlled stack
- [ ] Confirm `ghost_app` DB has no running tasks that would be mid-flight when the path changes
- [ ] Align two-repo consolidation (ghost-stack-codex / ghost-stack-claude) so the rename lands in one canonical place
- [ ] Plan DB migration for `tasks.context_json` / `task_runs.context_json` if historical data normalization is wanted (optional — historical rows are informational, not binding)
