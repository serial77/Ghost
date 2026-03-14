# Ghost Naming Standard

## Core principle

Runtime and contract-facing names should reflect **present system role**, not historical ancestry.
Docs may record history. Durable artifacts should not carry it.

---

## Canonical naming direction

The main runtime surface is a **general orchestration runtime**, not a product-line-specific chat interface. Canonical naming should reflect this:

- **prefer:** `Ghost Runtime`, `ghost-runtime`
- **retire:** `ghost-chat-*` as the canonical umbrella for the main runtime surface

The webhook path `ghost-chat-v3` is an established live contract identifier. It is **not** being renamed cosmetically — it requires a coordinated migration. See below.

---

## Naming rules by surface

### Runtime workflow (n8n)

- Display name: short, role-describing, no version markers, no phase labels
  - **correct:** `Ghost Runtime` ✓ (live)
  - **wrong:** `GHOST by Codex`, `Ghost Chat Runtime`, `GHOST by Codex Phase5GD`, `Ghost Chat v3`
- Workflow ID: treat as an opaque contract identifier; do not embed in human-facing names
- One canonical live workflow; no secondary active workflows unless a deliberate migration arrangement is in place

### Webhook / endpoint names

- Webhook paths are **live contract identifiers** — embedded in external callers, message metadata, task ledger rows, and ops scripts
- Change only in a **coordinated migration** (never cosmetically)
- Current canonical: `ghost-chat-v3` — accepted as a legacy-stable contract name, pending explicit migration
- Preferred future: `ghost-runtime` (no chat qualifier, no version number)
- When a new webhook path is introduced, the old one must be kept active during migration

### Builder / generator scripts

- Pattern: `build-<runtime-surface>-workflow.js`
  - **correct:** `build-ghost-runtime-workflow.js` ✓ (now live)
  - **retired:** `build-phase5gd-openclaw-workflow.js`
- The script name should describe **what it builds**, not when it was written or which feature iteration spawned it
- Phase/milestone names belong in a changelog or commit message, not in the filename

### Generated workflow artifact files

- Pattern: `<runtime-surface>-workflow.json`
  - **correct:** `ghost-runtime-workflow.json` ✓ (now live)
  - **retired:** `ghost-chat-v3-phase5gd-openclaw.json`
- One canonical output file per live runtime surface

### Source / base workflow files

- Pattern: `<runtime-surface>-workflow-base.json`
  - **correct:** `ghost-runtime-workflow-base.json` ✓ (now live)
  - **retired:** `ghost-chat-v3-phase5d-runtime-ledger.json`

### Ops scripts

- Pattern: `<verb>-<surface>.sh`
  - `activate-live-workflow.sh` — acceptable (describes action + target)
  - `smoke-runtime.sh` — acceptable
  - `reconcile-runtime.sh` — acceptable
  - `promote-live-workflow-safe.sh` — acceptable (describes action + qualifier)
- Avoid embedding version numbers or feature-line names in ops script filenames

### Docs

- Historical milestone docs (`docs/phase-6-*.md`, `docs/phase-7-*.md`) may keep phase labels — these are records, not contracts
- Living operational docs (`docs/claude-handoff-current-state.md`, `docs/naming-standard.md`) should reflect current state, not historical labels

### UI and product labels

- Runtime-facing display labels in the UI should match the canonical workflow display name
- Internal metadata stored in DB (`n8n_workflow_name` in `task_runs`) should match the live canonical name

---

## Terms retired from durable artifact names

| Term | Status | Notes |
|---|---|---|
| `openclaw` | **Retired** — builder/artifact files renamed | Was feature-era label |
| `phase5gd` | **Retired** — builder/artifact files renamed | Was milestone marker |
| `phase5d` | **Retired** — source artifact renamed | Was milestone marker |
| `GHOST by Codex` | **Retired** — cleaned from n8n, ops lib, builder, task-ledger | Encoded agent identity into runtime name |
| `Ghost Chat Runtime` | **Retired** — display name is now `Ghost Runtime` | Was transitional |
| `chat` in webhook path | **Deferred** — `ghost-chat-v3` is a live contract; migration required | Do not rename casually |
| `v3` in webhook path | **Deferred** — `ghost-chat-v3` is a live contract; migration required | Do not rename casually |

---

## What requires a controlled migration vs a safe cosmetic rename

### Safe cosmetic rename (can execute in a single controlled PR)
- Builder script filename — **done** (`build-ghost-runtime-workflow.js`)
- Generated workflow JSON filename — **done** (`ghost-runtime-workflow.json`)
- Source workflow JSON filename — **done** (`ghost-runtime-workflow-base.json`)
- `WORKFLOW_NAME` / `workflowName` constant / n8n display name — **done** (`Ghost Runtime`)
- `n8n_workflow_name` insert in `task-ledger.ts` — **done** (`Ghost Runtime`)
- `WORKFLOW_JSON` and `WORKFLOW_BUILDER` in ops lib — **done**

### Contract-sensitive migration (own coordinated pass — not done yet)

**Webhook path `ghost-chat-v3` → `ghost-runtime`:**
Embedded in: `WEBHOOK_PATH` in ops lib, `parentExecutionTarget` in builder (stored in DB task context), all ops scripts, `retry-governed-followthrough.js` dispatch, external callers, `ghost_core.webhook_entity`.

Migration requires: old path active during transition, new path added, callers migrated, validation window, then old path retired.

**Workflow node names** (e.g., `Start Runtime Ledger`, `Persist Approval Queue Item`): embedded in `$items()` accessors in builder code. Any rename requires finding and updating every accessor reference. These are internal identifiers, not user-visible names.
