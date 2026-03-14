# Ghost Naming Standard

## Core principle

Runtime and contract-facing names should reflect **present system role**, not historical ancestry.
Docs may record history. Durable artifacts should not carry it.

---

## Naming rules by surface

### Runtime workflow (n8n)

- Display name: short, role-describing, no version markers
  - **correct:** `Ghost Chat Runtime`, `Ghost Runtime`
  - **wrong:** `GHOST by Codex`, `GHOST by Codex Phase5GD`, `Ghost Chat v3`
- Workflow ID: treat as an opaque contract identifier; do not embed in human-facing names
- One canonical live workflow; no secondary active workflows unless a deliberate A/B or migration arrangement is in place

### Webhook / endpoint names

- Webhook paths are **live contract identifiers** — they are embedded in external callers, message metadata, task ledger rows, and ops scripts
- Change only in a **coordinated migration** (never cosmetically)
- Current canonical: `ghost-chat-v3` — accepted as a legacy-stable contract name pending explicit migration planning
- Preferred future pattern: `ghost-runtime` or `ghost` (no version or product-line qualifier in the path unless versioning is deliberately managed)
- When a new webhook path is introduced, the old one must be kept active during migration, not dropped

### Builder / generator scripts

- Pattern: `build-<runtime-surface>-workflow.js`
  - **correct:** `build-ghost-runtime-workflow.js`
  - **wrong:** `build-phase5gd-openclaw-workflow.js`, `build-ghost-chat-workflow.js`
- The script name should describe **what it builds**, not when it was written or which feature iteration spawned it
- Phase/milestone names belong in a changelog or doc, not in the filename

### Generated workflow artifact files

- Pattern: `<runtime-surface>-workflow.json`
  - **correct:** `ghost-runtime-workflow.json`
  - **wrong:** `ghost-chat-v3-phase5gd-openclaw.json`
- One canonical output file per live runtime surface
- Backup and export files follow a timestamp pattern and are not committed: `workflows/*backup*.json`, `workflows/*post-activate*.json`

### Source / base workflow files

- Pattern: `<runtime-surface>-workflow-base.json` or similar
  - **correct:** `ghost-runtime-workflow-base.json`
  - Source files are the builder's input; they should be renamed in step with the builder and output file

### Ops scripts

- Pattern: `<verb>-<surface>.sh`
  - `activate-live-workflow.sh` — acceptable (describes action + target)
  - `smoke-runtime.sh` — acceptable
  - `reconcile-runtime.sh` — acceptable
  - `promote-live-workflow-safe.sh` — acceptable (describes action + qualifier)
- Avoid embedding version numbers or feature-line names in ops script filenames
- Milestone or incident names belong in commit messages, not script names

### Docs

- Historical milestone docs (`docs/phase-6-*.md`, `docs/phase-7-*.md`) may keep phase labels — these are records, not contracts
- Living operational docs (`docs/claude-handoff-current-state.md`, `docs/naming-standard.md`) should reflect current state, not historical labels
- Preferred pattern for living docs: `<topic>.md` — no version prefix

### UI and product labels

- Runtime-facing display labels in the UI (workflow name shown in task ledger, approval queue, etc.) should match the canonical workflow display name
- Internal metadata stored in DB (e.g., `n8n_workflow_name` in `task_runs`) should match the live canonical name

---

## Terms to retire from durable artifact names

| Term | Why retire | Where it still appears (to be cleaned) |
|---|---|---|
| `openclaw` | Feature-era label, not the system identity | `build-phase5gd-openclaw-workflow.js`, `ghost-chat-v3-phase5gd-openclaw.json` |
| `phase5gd` | Milestone marker | same files above |
| `phase5d` | Milestone marker | `ghost-chat-v3-phase5d-runtime-ledger.json` |
| `GHOST by Codex` | Old display name; encodes the agent identity into the runtime name | now cleaned from n8n, ops lib, builder, task-ledger |
| `v3` in paths | Implicit version without a real versioning contract | `ghost-chat-v3` webhook path (contract-sensitive, defer migration) |
| `chat` | Product-line specificity when the runtime serves broader orchestration | `ghost-chat-v3`, builder files, workflow JSONs |

---

## Naming preference: interface-oriented over product-line-specific

Ghost is an orchestration runtime, not only a chat interface. As the system matures, canonical names should reflect the **runtime interface** it exposes, not the surface-level product feature it was first built for.

- **prefer:** `ghost-runtime`, `Ghost Runtime`
- **acceptable now:** `Ghost Chat Runtime` (transitional — already used as display name)
- **retire eventually:** `ghost-chat-*` naming for the primary runtime surface

This does not require an immediate sweep. It is a directional preference to apply at the next natural rename opportunity.

---

## What requires a controlled migration vs a safe cosmetic rename

### Safe cosmetic rename (low risk, can do in a single PR)
- n8n workflow display name — already done (`Ghost Chat Runtime`)
- `WORKFLOW_NAME` in ops lib — already done
- `workflowName` constant in builder — already done
- `n8n_workflow_name` insert value in `task-ledger.ts` — already done
- Builder script filename (requires updating all import references and docs that cite it)
- Generated workflow JSON filename (requires updating `ghost-ops-common.sh`, builder `targetPath`, gitignore patterns, docs)

### Contract-sensitive migration (requires coordination, not a single PR)
- Webhook path `ghost-chat-v3` — embedded in: `ghost-ops-common.sh`, builder `parentExecutionTarget`, all ops scripts via `WEBHOOK_PATH`, `ghost_action_history` metadata already written to DB, `retry-governed-followthrough.js` webhook dispatch
  - migration requires: old path kept active, new path added, caller configs updated, post-migration old path removed
- Source workflow JSON ID (`Yh6h9OJyVCfREbp3`) — never rename; this is an opaque DB key
- Workflow node names (e.g., `Start Runtime Ledger`, `Persist Approval Queue Item`) — embedded in `$items()` accessors in builder code; any rename requires finding and updating every accessor reference
