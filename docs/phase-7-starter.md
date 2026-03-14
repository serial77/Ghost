# Phase 7 Starter

This document is the planning handoff that becomes relevant once the practical Phase 6 stop point is reached.

It is planning-only. It does not authorize Phase 7 implementation by itself.

## What Phase 7 should mean for Ghost

Phase 7 should focus on higher-confidence architectural tightening around the regions that Phase 6 intentionally left inlined:

- creation-time orchestration truth
- route/policy contract clarity
- worker-runtime contract clarity
- long-term modularization boundaries that are worth the risk

Phase 7 should not be a generic refactor sprint.

## Open architectural questions after Phase 6

- Should delegated setup / creation remain inlined or become the last serious builder-level extraction?
- Should owner-policy and router logic stay inlined permanently for clarity?
- Is there enough validation coverage to justify touching worker-runtime branches?
- Are runtime subworkflow semantics ever worth investigating, or is builder-level modularization sufficient?

## Preconditions that should stay frozen before Phase 7 implementation

- direct-path truth contract
- delegated failure/return truth contract
- current direct and delegated reconciliation parity semantics
- current builder-level tail modules and their assertions

## What not to touch first in Phase 7

- do not start with the delegation router
- do not start with worker runtime branches
- do not start with runtime `Execute Workflow` semantics
- do not reopen frozen direct-path hardening as speculative cleanup

## Recommended first supervised Phase 7 step

- reassess the delegated setup / creation cluster with the supervised brief from Phase 6

If that reassessment still judges extraction risk too high, the right Phase 7 action may be to freeze that region in place and improve contract documentation rather than extract it.

## Runtime subworkflow semantics judgment

Runtime subworkflow semantics should remain deferred.

If investigated later, it should be a dedicated architecture/validation lane with explicit attention to:

- response timing
- write ordering
- task/task_run correlation
- event annotation ordering
- reconciliation helper expectations

That is not a natural continuation of Phase 6 builder modularization.

## Not-yet items for Phase 7

- no broad delegated/direct unification
- no generalized observability platform
- no UI-driven architecture changes
- no historical cleanup spree masquerading as architecture work
