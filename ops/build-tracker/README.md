# Ghost Build Tracker (Operator Side Tool)

This is a small standalone local tracker page for operators.

It is intentionally separate from product UI and runtime workflows.

It is a side build-tracker tool and is not Mission Control.

## Roadmap seeding policy

- The tracker follows Ghost v3.0 canonical roadmap and phase requirements.
- The canonical 10-phase spine is stable; subphases remain flexible.
- Sparse truth is mandatory: do not invent implementation history or fake completions.
- Core framing remains visible at top-level (governance, delegation, rollout order).
- Canonical runtime worker registry is fixed to: Ghost Main, Forge, Probe, Rector, Archivist, Operator, Scout.
- MVP target is end of Phase 7; Phase 8 is explicitly post-MVP.
- Home Assistant remains the control boundary for the Home domain.

Current phase status snapshot:

- Phase 1–2: established / complete
- Phase 3: substantially complete but active (reopened load-bearing architecture work)
- Phase 4: emerging
- Phase 5: partially underway
- Phase 6: partially implemented
- Phase 7: active delivery zone
- Phase 8: planned post-MVP
- Phase 9: planned
- Phase 10: long-range

Phase 7 includes the v3.0 17-item MVP gate checklist (step `7G`) and gate note requirements around schema migration and version-controlled runtime source files with unit tests.

## Files

- `index.html` - standalone roadmap tree page
- `project-tracker.json` - single source of truth for roadmap + worker markers
- `project-tracker.schema.json` - formal JSON contract for the tracker file
- `validate_tracker.py` - contract + structure validator (safe, read-only)
- `update_tracker.py` - small helper for common tracker updates
- `snapshot_tracker.py` - creates timestamped snapshots under `snapshots/`
- `diff_tracker.py` - compares tracker files/snapshots and prints concise change report
- `snapshots/` - historical snapshot copies (derivative artifacts only)

## Source-of-truth model

- `project-tracker.json` is the only authoritative live tracker file.
- `snapshots/*.json` are historical copies only.
- Do not edit snapshots as if they were the live tracker.

## Worker positioning model

The tracker includes a compact top-level `worker_positions` section for live coordination.

- `canonical_runtime_workers` is the runtime worker set only:
  - Ghost Main, Forge, Probe, Rector, Archivist, Operator, Scout
- `external_implementation_workers` is for auxiliary implementation coordination:
  - e.g. Claude, Copilot, Codex
- Keep canonical and external workers separated; do not mix them.
- Active assignments should point to canonical IDs using:
  - `assigned_phase_id` (e.g. `phase-3`)
  - `assigned_step_id` (e.g. `p3e-runtime-decomposition`)

Current emphasis lanes are:

- `p2e-schema-migration-strategy`
- `p3b-ii-asynchronous-delegation-via-message-bus`
- `p3c-ii-circuit-breaker-for-model-routing`
- `p3e-runtime-decomposition`
- `p3e-ii-extract-business-logic-to-source-files`
- `p3f-redis-activation`
- `p7c-ii-write-ahead-pattern`
- `p7c-iii-rollback-undo-capability`
- `p7d-ii-event-sourcing-layer`

## Run locally

From repo root:

```bash
cd ops/build-tracker
python3 -m http.server 8787
```

Open:

- `http://127.0.0.1:8787/`

## Validate tracker JSON

Run from repo root:

```bash
python3 ops/build-tracker/validate_tracker.py
```

Optional strict mode (warnings fail):

```bash
python3 ops/build-tracker/validate_tracker.py --strict
```

The validator checks:

- JSON parse errors
- required fields and structure
- allowed status values
- duplicate phase/step/substep ids
- malformed timestamps
- malformed worker markers
- recent activity references to unknown step ids

## Snapshot workflow

Create a snapshot of the current tracker:

```bash
python3 ops/build-tracker/snapshot_tracker.py
```

Create a labeled snapshot:

```bash
python3 ops/build-tracker/snapshot_tracker.py --label after-session
```

Snapshots are saved under `ops/build-tracker/snapshots/` with timestamped names.

## Diff/report workflow

Compare current tracker against latest snapshot (default behavior):

```bash
python3 ops/build-tracker/diff_tracker.py
```

Compare two specific files/snapshots:

```bash
python3 ops/build-tracker/diff_tracker.py --from ops/build-tracker/snapshots/tracker-snapshot-20260314T010000Z.json --to ops/build-tracker/project-tracker.json
```

Compare by using latest shorthand:

```bash
python3 ops/build-tracker/diff_tracker.py --from latest --to ops/build-tracker/project-tracker.json
```

Markdown output:

```bash
python3 ops/build-tracker/diff_tracker.py --format markdown
```

Ignore metadata-only noise (`name`, `schema_version`, `last_updated`, `current_focus`):

```bash
python3 ops/build-tracker/diff_tracker.py --ignore-metadata
```

Script-friendly exit code when changes are found:

```bash
python3 ops/build-tracker/diff_tracker.py --exit-nonzero-on-changes
```

Diff report highlights:

- phase status changes
- step/substep status changes
- worker marker moves/additions/removals/field updates
- recent activity additions
- project metadata changes (unless ignored)

## Common updates with helper

The helper is file-based only and updates `project.last_updated` automatically.

### 1) Set step/substep status

```bash
python3 ops/build-tracker/update_tracker.py set-status --id p7c-ii-write-ahead-pattern --status active
```

### 2) Add or update active worker marker

```bash
python3 ops/build-tracker/update_tracker.py worker-upsert --id p3e-runtime-decomposition --name Operator --status working --task "Track runtime decomposition architecture queue"
```

### 3) Remove active worker marker

```bash
python3 ops/build-tracker/update_tracker.py worker-remove --id p3e-runtime-decomposition --name Operator
```

### 4) Add recent activity

```bash
python3 ops/build-tracker/update_tracker.py add-activity --worker Ghost\ Main --status review --step-id p7g-mvp-v3-gate --note "Reviewed v3.0 MVP gate criteria alignment"
```

### 5) Upsert top-level worker position (recommended for live placement)

Set/refresh a canonical runtime worker position:

```bash
python3 ops/build-tracker/update_tracker.py position-upsert --group canonical --name Operator --lane architecture-closure --status assigned --phase-id phase-2 --step-id p2e-schema-migration-strategy --summary "Tracking schema migration strategy closure lane"
```

Set/refresh an external implementation worker position:

```bash
python3 ops/build-tracker/update_tracker.py position-upsert --group external --name Claude --lane implementation --status pending_assignment --summary "Pending assignment; no active step started"
```

Move Claude from `3E` to `7C-ii` (single command update):

```bash
python3 ops/build-tracker/update_tracker.py position-upsert --group external --name Claude --lane implementation --status assigned --phase-id phase-7 --step-id p7c-ii-write-ahead-pattern --summary "Assigned to write-ahead followthrough lane"
```

Update-only usage note:

- `position-upsert` preserves existing lane/summary/assignment fields unless you override them.
- Use `--clear-assignment` when switching a worker back to pending/standby without a roadmap target.

### Claude quick commands (copy/paste)

Assign Claude to `2E`:

```bash
python3 ops/build-tracker/update_tracker.py position-upsert --group external --name Claude --lane implementation --status assigned --phase-id phase-2 --step-id p2e-schema-migration-strategy --summary "Claude assigned to 2E schema migration strategy"
```

Move Claude to `3E`:

```bash
python3 ops/build-tracker/update_tracker.py position-upsert --group external --name Claude --status assigned --phase-id phase-3 --step-id p3e-runtime-decomposition --summary "Claude moved to 3E runtime decomposition"
```

Mark Claude completed:

```bash
python3 ops/build-tracker/update_tracker.py position-upsert --group external --name Claude --status completed --summary "Claude completed assigned implementation slice"
```

Mark Claude blocked (example on `7C-ii` with short reason):

```bash
python3 ops/build-tracker/update_tracker.py position-upsert --group external --name Claude --status blocked --phase-id phase-7 --step-id p7c-ii-write-ahead-pattern --summary "Claude blocked on 7C-ii write-ahead lane" --note "Blocked on dependency from 3E-ii extraction"
```

Clear assignment / return to pending assignment:

```bash
python3 ops/build-tracker/update_tracker.py position-upsert --group external --name Claude --status pending_assignment --clear-assignment --summary "Claude pending next assignment"
```

Remove a worker position entry:

```bash
python3 ops/build-tracker/update_tracker.py position-remove --group external --name Claude
```

### Worker examples

Set Operator on a step:

```bash
python3 ops/build-tracker/update_tracker.py worker-upsert --id p3c-ii-circuit-breaker-for-model-routing --name Operator --status working --task "Track circuit-breaker hardening lane"
```

Set Forge on a step:

```bash
python3 ops/build-tracker/update_tracker.py worker-upsert --id p7c-ii-write-ahead-pattern --name Forge --status review --task "Review write-ahead followthrough criteria"
```

Set Scout on a step:

```bash
python3 ops/build-tracker/update_tracker.py worker-upsert --id p2e-schema-migration-strategy --name Scout --status waiting --task "Prepare migration strategy validation checklist"
```

## Contract notes

`project-tracker.json` contract is defined by `project-tracker.schema.json`.

Current schema expectations include:

- project metadata (`name`, `schema_version`, `last_updated`, `current_focus`)
- core framing (`title`, `principles`, `openclaw_alignment`, `rollout_order`, `canonical_worker_registry`)
- worker positions (`canonical_runtime_workers`, `external_implementation_workers`)
- phases with `id`, `title`, optional `summary`, `status`, `steps`
- steps/substeps with `id`, `title`, `status`, `active_workers`
- status enums:
  - step/phase: `complete|active|pending|blocked|frozen`
  - worker/activity: `working|blocked|waiting|review|done`
- optional recent activity list with timestamped entries tied to valid step ids

## Suggested operator flow

1. Use `update_tracker.py` for status/worker/activity updates.
2. Run `validate_tracker.py`.
3. Create a snapshot with `snapshot_tracker.py`.
4. Later, run `diff_tracker.py` to see what changed.
5. Refresh the local page.
6. Keep historic phases concise unless new authoritative detail is available.

If needed, raw JSON sanity check still works:

```bash
jq . ops/build-tracker/project-tracker.json >/dev/null
```
