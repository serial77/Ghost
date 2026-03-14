# Phase 7 Starter

This document is the planning handoff that becomes relevant once the practical Phase 6 stop point is reached.

It is planning-only. It does not authorize Phase 7 implementation by itself.

## What Phase 7 should mean for Ghost

Phase 7 should focus on post-modularization hardening and architectural follow-up now that the intended builder-level extraction queue is implemented:

- stronger contract validation around the newly extracted semantically sensitive modules
- long-lived confidence in routing, creation-time linkage, and worker-runtime truth
- decisions about what should stay builder-level permanently versus what should remain centralized glue
- whether any future architecture work should move beyond builder modularization at all

Phase 7 should not be a generic refactor sprint.

## Open architectural questions after Phase 6

- Are the current module boundaries stable enough to freeze as the long-term builder architecture?
- Should route/policy/worker-runtime contract checks be strengthened before any further semantic changes?
- Which small amount of remaining glue in the main builder is worth keeping centralized rather than extracting further?
- Are runtime subworkflow semantics ever worth investigating, or is the current builder-level modular architecture already sufficient?

## Preconditions that should stay frozen before Phase 7 implementation

- direct-path truth contract
- delegated failure/return truth contract
- current direct and delegated reconciliation parity semantics
- current builder-level module boundaries and their assertions

## What not to touch first in Phase 7

- do not start by reshaping the newly extracted router module
- do not start by reinterpreting the worker-runtime or delegated-setup modules
- do not start with runtime `Execute Workflow` semantics
- do not reopen frozen direct-path hardening as speculative cleanup

## Recommended first supervised Phase 7 step

- add or tighten module-level contract validation around the most semantically sensitive extracted regions:
  - delegated setup / creation
  - delegation router
  - delegated worker runtime
  - owner / policy

The first Phase 7 step should be validation-first, not another structural extraction.

## Runtime subworkflow semantics judgment

Runtime subworkflow semantics should remain deferred.

If investigated later, it should be a dedicated architecture/validation lane with explicit attention to:

- response timing
- write ordering
- task/task_run correlation
- event annotation ordering
- reconciliation helper expectations

That is no longer a natural continuation of Phase 6, because the builder-level modularization queue is already complete.

## Not-yet items for Phase 7

- no broad delegated/direct unification
- no generalized observability platform
- no UI-driven architecture changes
- no historical cleanup spree masquerading as architecture work
