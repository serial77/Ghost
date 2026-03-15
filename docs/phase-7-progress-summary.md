# Phase 7 Progress Summary

Phase 7 now has real backend/operator foundations, durable governed surfaces, and first live backend consumers in place.

## Implemented foundations

### 7A Baseline package

Implemented:

- `ops/foundation/baseline.json`
- `scripts/validate-phase7-foundations.js`
- `ops/report-phase7-foundations.sh`
- `docs/phase-7-baseline.md`

What is real:

- machine-readable frozen contracts
- stable truth surface inventory
- stable builder-module inventory
- explicit do-not-touch boundaries

### 7B Worker role system

Implemented:

- `ops/foundation/workers.json`

What is real:

- canonical worker ids and operator-facing labels
- explicit role/purpose/intention/responsibility contracts
- initial environment scope per worker

### 7C Governed capability layer

Implemented:

- `ops/foundation/capabilities.json`

What is real:

- capability taxonomy
- destructive vs non-destructive class
- approval-required metadata
- environment restriction metadata
- worker to capability mapping

### 7D Approval/governance foundation

Implemented:

- `ops/foundation/approval-model.json`
- `scripts/render-approval-item.js`
- `ops/render-approval-item.sh`

What is real:

- approval state machine
- approval categories and risk levels
- required approval item fields
- renderable approval item skeleton for future queue/backend consumers

### 7I Approval/governance consumption

Implemented:

- live consumption in `Build Approval Required Response`
- live consumption in `Build Parent Blocked Delegation Response`
- shared persistence flow through `Build API Response` and `Save Assistant Reply`
- shared helper logic in `scripts/foundation-runtime.js`

What is real:

- approval-needed direct replies now emit a structured `approval_item`
- approval-needed delegated blocked replies now emit the same structured `approval_item`
- approval item metadata now persists through the current assistant-message surface
- governance environment and requested-capability metadata now survive the live blocked path

### 7N Durable approval queue

Implemented:

- durable queue writes through `Persist Approval Queue Item`
- queue metadata merge through `Attach Persisted Approval Queue Metadata`
- queue inspection helper:
  - `scripts/report-approval-queue.js`
  - `ops/report-approval-queue.sh`

What is real:

- blocked direct approval-needed paths now write durable records into `approvals`
- blocked delegated approval-needed paths now write durable records into `approvals`
- persisted queue records keep:
  - source path classification
  - conversation/runtime/delegation linkage
  - governance environment and requested capabilities
  - approval contract id
- API response and assistant metadata now preserve:
  - `approval_queue_id`
  - `approval_queue_status`

### 7E Audit/action-history foundation

Implemented:

- `ops/foundation/action-model.json`
- `scripts/render-action-record.js`
- `ops/render-action-record.sh`

What is real:

- normalized event vocabulary
- entity relationship framing across request/owner/delegation/runtime/approval/artifact/outcome
- renderable action-record skeleton

### 7K / 7O Durable action history

Implemented:

- `scripts/action-record-runtime.js`
- `scripts/materialize-action-records.js`
- `ops/materialize-action-records.sh`
- `scripts/sync-action-history.js`
- `ops/sync-action-history.sh`
- `scripts/report-action-history.js`
- `ops/report-action-history.sh`

What is real:

- recent request/runtime/outcome/delegation/approval actions can now be synthesized from live Ghost truth surfaces
- the action model is now consumed by a real backend helper rather than example rendering only
- action records can now be persisted into the durable `ghost_action_history` table
- the durable action timeline can be queried back as an operator/backend surface

### 7F Self-observation / diagnostics foundation

Implemented:

- `ops/foundation/diagnostics.json`
- `ops/diagnose-runtime-foundations.sh`

What is real:

- diagnostic category taxonomy
- lightweight runtime diagnostic summary synthesized from current truth surfaces
- explicit fragile-module hotspot list

### 7L / 7S Diagnostic integration

Implemented:

- action-history sync/read integration in `ops/diagnose-runtime-foundations.sh`
- approval-queue pressure integration in `ops/diagnose-runtime-foundations.sh`
- worker fragility rollup integration in `ops/diagnose-runtime-foundations.sh`

What is real:

- diagnostics now consume the durable action-history surface
- diagnostics now describe approval backlog and action-history coverage gaps
- diagnostics now describe event mix and worker fragility instead of only raw parity/staleness counters
- diagnostic output stays grounded in existing persisted truth surfaces

### 7G Environment-awareness foundation

Implemented:

- `ops/foundation/environments.json`
- `scripts/render-environment-policy.js`
- `ops/render-environment-policy.sh`

What is real:

- environment taxonomy
- environment governance posture
- promotion-source framing
- restricted capability mapping per environment

### 7J / 7P Capability/environment policy consumption

Implemented:

- capability/environment policy shaping for live approval-needed responses
- policy summary/state derivation in `scripts/foundation-runtime.js`

What is real:

- approval-needed live paths now emit a governed `governance_policy` object
- that policy reflects environment posture, approval-required capabilities, restricted capabilities, and out-of-scope capabilities
- approval-related stderr/operator context now includes policy-derived reasoning
- blocked approval paths now switch to explicit environment-policy blocking semantics when the environment registry says capabilities are restricted or out of scope
- durable approval queue records now preserve environment-policy source classification

### 7Q Worker registry consumption

Implemented:

- worker runtime config derivation in `scripts/foundation-runtime.js`
- live worker registry consumption in `Build Delegation Context`

What is real:

- the delegated Codex/Forge path now stamps worker identity from the worker registry instead of treating it as an informal label
- live delegated setup now carries:
  - `worker_registry_id`
  - `worker_agent_label`
  - `worker_role`
  - `worker_operator_identity`
  - `worker_environment_scope`
  - `worker_allowed_capabilities`
- delegated setup now fails loudly if the selected worker registry entry is missing required capabilities for the bounded delegated implementation path

## Partially scaffolded rather than fully integrated

- approval items are durably queued, but there is still no first-class operator approval UI or terminal-resolution write path
- action records are durably stored, but not yet linked to a broader operator-facing history UI/timeline
- diagnostic summaries synthesize existing truth surfaces and durable read models, not a dedicated observability pipeline
- environment/capability policy now gates blocked approval semantics, but does not yet shape broader routing or execution admission control

## What needs supervision next

- approval queue resolution lifecycle:
  - terminal state writes
  - operator claim/assignment semantics
  - queue aging/expiry policy
- durable action history expansion:
  - approval resolution emission from real operator actions
  - richer deployment/promotion and owner-decision milestones
- capability/environment policy enforcement at one broader admission-control point
- worker registry authority beyond delegated setup metadata, especially if routing starts selecting among multiple worker classes

## Do not touch casually

- `ops/foundation/baseline.json`
- `ops/foundation/workers.json`
- `ops/foundation/capabilities.json`
- `ops/foundation/approval-model.json`
- `ops/foundation/action-model.json`
- `ops/foundation/diagnostics.json`
- `ops/foundation/environments.json`
- `scripts/validate-phase7-foundations.js`

These now form the Phase 7 source-of-truth layer.

## Useful validation / reporting commands

```bash
node scripts/validate-phase7-foundations.js
ops/report-phase7-foundations.sh
ops/render-approval-item.sh --worker operator --requested-by ghost-main-runtime --summary "Promote live workflow" --reason "deploy.promote requires explicit operator approval" --environment prod --category production_promotion --risk-level high --capability deploy.promote
ops/render-action-record.sh --event-type delegation.created --conversation-id conv-1 --request-id req-1 --delegation-id del-1 --summary "Delegated technical work created"
ops/materialize-action-records.sh --recent-hours 24 --limit 20
ops/report-approval-queue.sh --recent-hours 72 --limit 10
ops/sync-action-history.sh --recent-hours 24 --limit 20
ops/report-action-history.sh --recent-hours 24 --limit 10
ops/diagnose-runtime-foundations.sh --recent-hours 24 --stale-minutes 30
ops/render-environment-policy.sh --environment prod
```

## Next best Phase 7 implementation step

The best next supervised Phase 7 step is:

- add the first real approval-resolution path against the durable approval queue without breaking the frozen truth contracts

The cleanest candidates are:

1. approval queue terminal-state write path plus action-history emission
2. broader capability/environment admission control at one owner/policy decision point
3. richer durable action coverage for deployment/promotion and owner-resolution milestones
