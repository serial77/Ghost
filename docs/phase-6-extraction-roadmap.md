# Phase 6 Extraction Roadmap

This document captures the remaining Phase 6 builder-level extraction plan after:

- Phase 6A direct runtime tail extraction
- Phase 6B memory extraction tail extraction
- Phase 6C delegated completion/result tail extraction
- Phase 6D blocked/unsupported delegated control tail extraction

It is a planning artifact only. It does not change runtime behavior.

## Current extraction status

Completed safe builder-level modules:

- `scripts/workflow-modules/direct-runtime-tail.js`
- `scripts/workflow-modules/memory-extraction-tail.js`
- `scripts/workflow-modules/delegated-completion-tail.js`
- `scripts/workflow-modules/delegated-control-tail.js`

These regions were safe because they were downstream, contiguous, and contract-checkable without changing orchestration semantics.

## Remaining candidate regions

### 1. Request ingress / conversation load

Likely boundary:

- webhook ingress setup
- request normalization
- conversation lookup/create
- user message persistence
- route metadata staging that is tightly coupled to initial request handling

Keep outside:

- owner resolution / approval policy
- delegation router
- direct execution branches
- delegated worker runtime branches

Blast radius:

- High. Early-pipeline breakage can affect every path.

Semantic sensitivity:

- High. This region establishes conversation identity, message identity, and context used by all later truth surfaces.

Validation difficulty:

- High. Requires broad end-to-end validation, not just tail probes.

Builder-level extraction suitability:

- Supervised only.

Judgment:

- Do not extract unattended.
- Do not extract before the remaining downstream delegated/runtime regions are considered stable.

### 2. Owner resolution / policy

Likely boundary:

- owner strategy resolution
- approval-required policy checks
- provider/owner gating context

Keep outside:

- conversation ingress/load
- delegation router
- execution branches
- downstream result tails

Blast radius:

- High. This region changes who answers, whether approval is required, and which branch runs.

Semantic sensitivity:

- Very high. A small drift here can silently change policy semantics.

Validation difficulty:

- High. Requires scenario coverage across direct, blocked, delegated, and provider-selected paths.

Builder-level extraction suitability:

- Supervised only.

Judgment:

- Not suitable for unattended extraction.
- Do not extract before route/branch contracts are documented more explicitly.

### 3. Delegation router

Likely boundary:

- branch selection for direct vs delegated
- delegated worker eligibility checks
- handoff into blocked, unsupported, or executable delegated branches

Keep outside:

- owner policy
- worker runtime execution
- direct runtime tail
- delegated completion/control tails

Blast radius:

- Very high. This is the center of orchestration semantics.

Semantic sensitivity:

- Very high. Drift here can invalidate both direct and delegated truth contracts at once.

Validation difficulty:

- Very high. Requires full route matrix validation and close parity inspection.

Builder-level extraction suitability:

- Too risky for unattended builder-level extraction.

Judgment:

- Supervised only, and possibly not worth extracting until there is stronger route-contract coverage.

### 4. Worker runtime branches

Likely boundary:

- delegated worker execution branch
- worker command invocation
- worker result normalization input staging
- worker-side reply persistence handoff into delegated completion tail

Keep outside:

- router
- blocked/unsupported control tail
- parent response tail

Blast radius:

- Very high. This region produces delegated runtime truth directly.

Semantic sensitivity:

- Very high. It shapes worker failure classes, runtime state, and parent return truth.

Validation difficulty:

- Very high. Requires success/failure/timeout/invalid-result path coverage.

Builder-level extraction suitability:

- Supervised only.

Judgment:

- Do not attempt unattended.
- Do not extract before there is a dedicated worker-runtime contract check comparable to the direct-path contract guard.

### 5. Remaining delegated setup / creation cluster

Likely boundary:

- delegation creation
- orchestration task linkage creation
- delegated runtime start handoff

Keep outside:

- router decision logic
- worker runtime branch
- delegated completion/control tails

Blast radius:

- Medium-high. This cluster is narrower than the router, but still owns creation-time truth.

Semantic sensitivity:

- High. It affects `conversation_delegations`, orchestration linkage, and runtime start correlation.

Validation difficulty:

- Medium-high. Requires reconciliation confirmation and delegated path coverage.

Builder-level extraction suitability:

- Supervised only.

Judgment:

- This is the next plausible extraction target, but only with close supervision.
- It is safer than router or worker runtime, but not clearly safe for unattended work.

### 6. Residual response-shaping helpers

Likely boundary:

- any remaining downstream response-shaping node groups not already extracted

Keep outside:

- routing
- provider execution
- worker runtime
- persistence tails already extracted

Blast radius:

- Medium at most, if the region is truly downstream.

Semantic sensitivity:

- Medium. Response wording can create operator/user truth drift even if runtime state is correct.

Validation difficulty:

- Medium. Probe-driven validation is possible.

Builder-level extraction suitability:

- Possibly safe unattended, but only if the exact node group is strictly downstream and already contract-like.

Judgment:

- No clear candidate remained after 6D that met the unattended safety bar.
- Re-evaluate only after a precise boundary is documented from the live builder.

## Recommended extraction order from here

1. Remaining delegated setup / creation cluster
2. Residual response-shaping helper cluster, if a truly narrow downstream group is identified
3. Owner resolution / policy
4. Request ingress / conversation load
5. Delegation router
6. Worker runtime branches

This is an execution order recommendation, not a mandate to extract all of them.

## Supervision roadmap

### Safe unattended

- No additional region is currently approved for unattended extraction.

### Supervised only

- remaining delegated setup / creation cluster
- owner resolution / policy
- request ingress / conversation load
- delegation router
- worker runtime branches

### Too risky for builder-level extraction right now

- delegation router, unless route-contract coverage is expanded first
- worker runtime branches, unless worker-runtime contracts are guarded first

### May be better left inlined

- delegation router
- owner resolution / policy

These are central orchestration regions where inlining may remain clearer than artificial modular boundaries.

## Do-not-extract notes

- Do not extract owner resolution / policy before the route/approval contract is written down more explicitly.
- Do not extract the delegation router before delegated setup and downstream delegated tails are already stable and well-guarded.
- Do not extract worker runtime branches before there is stronger contract validation for worker failure classes and runtime linkage.
- Do not introduce runtime `Execute Workflow` semantics as part of Phase 6 builder modularization.

## Runtime-subworkflow judgment

Phase 6 should remain builder-level.

If runtime subworkflow semantics are ever considered, that should be a later, separate phase with explicit validation for:

- response timing
- persistence ordering
- runtime/task/task_run correlation
- tool event timing
- parity helper expectations

That is not a safe continuation of the current builder-only extraction pattern.
