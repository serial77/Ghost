# Ghost Naming Migration Checklist

See `docs/naming-standard.md` for the policy that drives these changes.

---

## Current live names (as of 2026-03-14, post-tranche-2)

| Surface | Current name | Target name | Risk | Status |
|---|---|---|---|---|
| n8n workflow display | `Ghost Runtime` | — | cosmetic | **done** |
| Webhook path (canonical) | `ghost-runtime` | — | contract-sensitive | **done** |
| Webhook path (legacy) | `ghost-chat-v3` | retire after migration window | contract-sensitive | **legacy active** |
| Builder script | `scripts/build-ghost-runtime-workflow.js` | — | cosmetic | **done** |
| Generated workflow JSON | `workflows/ghost-runtime-workflow.json` | — | cosmetic | **done** |
| Source workflow JSON | `workflows/ghost-runtime-workflow-base.json` | — | cosmetic | **done** |
| `WORKFLOW_NAME` default | `Ghost Runtime` | — | cosmetic | **done** |
| `WEBHOOK_PATH` default | `ghost-runtime` | — | contract-sensitive | **done** |
| `parentExecutionTarget` in builder | `webhook/ghost-runtime` | — | contract-sensitive (in DB) | **done** |
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

## Tranche 2 — Dual-path webhook migration: EXECUTED (2026-03-14)

### What was done ✓

**Workflow builder and modules:**
- [x] Added `"Incoming chat (runtime)"` webhook node (`path: ghost-runtime`) to builder, connecting to `Normalize Input`
- [x] `"Incoming chat"` (`path: ghost-chat-v3`) kept as legacy trigger — both active simultaneously
- [x] `parentExecutionTarget` changed from `webhook/ghost-chat-v3` → `webhook/ghost-runtime`
- [x] `legacyWebhookPath = "ghost-chat-v3"` declared in builder as named constant
- [x] `applyIngressConversationTailModule`: `source: 'ghost-chat-v3'` → `source: 'ghost-runtime'` in Save User Message metadata
- [x] `assertIngressConversationTailContract`: assertions updated to verify `ghost-runtime` canonical path
- [x] New assertion added: `"Incoming chat (runtime)"` → `"Normalize Input"` connection check

**Base workflow JSON:**
- [x] `Create New Conversation` queryReplacement source updated: `'ghost-chat-v3'` → `'ghost-runtime'`

**Ops scripts:**
- [x] `ops/lib/ghost-ops-common.sh`: `WEBHOOK_PATH` default → `ghost-runtime`
- [x] `ops/lib/ghost-ops-common.sh`: export remote tmp path → `/tmp/ghost-runtime-export.json`
- [x] `ops/activate-live-workflow.sh`: backup/export filenames → `ghost-runtime-live-backup-*`
- [x] `ops/promote-live-workflow-safe.sh`: backup/rollback filenames → `ghost-runtime-live-*`

**Application code:**
- [x] `scripts/retry-governed-followthrough.js`: default WEBHOOK_PATH → `ghost-runtime`
- [x] `app/ui/lib/chat.ts`: `defaultBackendUrl` → `…/webhook/ghost-runtime`
- [x] `app/ui/lib/server/task-ledger.ts`: all fallback strings → `ghost-runtime`
- [x] `app/ui/lib/server/system-health.ts`: `CANONICAL_WEBHOOK_PATH` → `ghost-runtime`

### Legacy path retirement (pending migration window)

`ghost-chat-v3` remains active as a dual-path compatibility trigger. When ready to retire:
1. [ ] Confirm no traffic arriving via `ghost-chat-v3` (check `webhook_entity` and access logs)
2. [ ] Remove `"Incoming chat"` node from builder (`removeNode(workflow, "Incoming chat")`)
3. [ ] Remove `legacyWebhookPath` constant from builder
4. [ ] Remove legacy connection assertion from `ingress-conversation-tail.js`
5. [ ] Rebuild, import, activate — only `ghost-runtime` remains in `webhook_entity`
6. [ ] Update `docs/naming-standard.md` to mark `ghost-chat-v3` fully retired

---

## Remaining archive doc cleanup (low priority, non-blocking)

These are historical records and are not runtime-affecting:
- [ ] `scripts/build-phase5d-runtime-ledger-workflow.js` — archive builder, hardcodes `'GHOST by Codex'`; mark as archive or delete
- [ ] `scripts/build-phase4a-memory-workflow.js` — archive, references deactivated Phase4A workflow
- [ ] `docs/ghost-phase3-handoff.md` — historical; consider moving to `docs/archive/`
- [ ] `docs/ghost-phase4a-memory-handoff.md` — historical; consider moving to `docs/archive/`
- [ ] `docs/ghost-runtime-topology-map.md` — has `GHOST by Codex`; update current-state sections when touched
