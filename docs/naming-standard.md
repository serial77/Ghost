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
- Current canonical: `ghost-runtime` — live as of 2026-03-14
- Legacy path: `ghost-chat-v3` — active as dual-path compatibility trigger, pending retirement after migration window
- When retiring the legacy path: remove `"Incoming chat"` node from builder, confirm no live callers, rebuild and re-activate

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
| `chat` in webhook path | **Migrated** — `ghost-runtime` is canonical; `ghost-chat-v3` is legacy-active | Retire after migration window |
| `v3` in webhook path | **Migrated** — `ghost-runtime` is canonical; `ghost-chat-v3` is legacy-active | Retire after migration window |

---

## What requires a controlled migration vs a safe cosmetic rename

### Safe cosmetic rename (can execute in a single controlled PR)
- Builder script filename — **done** (`build-ghost-runtime-workflow.js`)
- Generated workflow JSON filename — **done** (`ghost-runtime-workflow.json`)
- Source workflow JSON filename — **done** (`ghost-runtime-workflow-base.json`)
- `WORKFLOW_NAME` / `workflowName` constant / n8n display name — **done** (`Ghost Runtime`)
- `n8n_workflow_name` insert in `task-ledger.ts` — **done** (`Ghost Runtime`)
- `WORKFLOW_JSON` and `WORKFLOW_BUILDER` in ops lib — **done**

### Contract-sensitive migration (done — 2026-03-14)

**Webhook path `ghost-chat-v3` → `ghost-runtime`:**
Dual-path approach: `ghost-runtime` added as canonical trigger; `ghost-chat-v3` retained as legacy trigger in the same workflow. Both paths connect to `Normalize Input` and register in `webhook_entity`. All code/config now points to `ghost-runtime` as canonical; `ghost-chat-v3` is legacy compatibility only.

Retirement of `ghost-chat-v3` trigger: deferred pending a clean traffic migration window. See `docs/naming-migration-checklist.md` for the retirement checklist.

**Workflow node names** (e.g., `Start Runtime Ledger`, `Persist Approval Queue Item`): embedded in `$items()` accessors in builder code. Any rename requires finding and updating every accessor reference. These are internal identifiers, not user-visible names.
