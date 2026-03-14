# Phase 7 Durable Governance Completion

Phase 7 is no longer just a foundation/scaffolding layer.

## Durable now

- Approval-needed direct and delegated blocked paths write durable queue rows to `approvals`.
- Approval queue metadata flows back into:
  - API response
  - assistant message metadata
- Action records are no longer only synthesized; they are persisted in `ghost_action_history`.
- Diagnostics now consume:
  - durable approval queue state
  - durable action-history coverage
  - existing runtime/delegation truth surfaces

## Live authority now

- Capability/environment policy now changes blocked-path semantics in live backend logic.
- Worker registry now shapes delegated setup metadata for the Forge worker path.
- Builder/runtime truth contracts remain intact:
  - direct recent parity `OK no findings`
  - delegated recent parity `OK no findings`

## Still partial

- No terminal approval-resolution write path yet
- No first-class operator approval workflow yet
- No broad routing admission control driven by capability/environment policy yet
- No fully expanded operator timeline/history UI or query surface yet

## Do Not Touch Casually

- `ops/foundation/*.json`
- `scripts/foundation-runtime.js`
- blocked approval-path builders
- durable queue/report helpers
- durable action-history sync/report helpers
- reconciliation helpers

## Best Next Supervised Step

Implement approval resolution against the durable approval queue and emit the matching durable action-history events.
