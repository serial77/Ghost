# Phase 6 High-Risk Extraction Package

This document is the canonical supervised extraction package for the remaining higher-risk Phase 6 regions after the completed downstream builder-level module work.

It assumes the following completed extractions remain unchanged:

- Phase 6A direct runtime tail
- Phase 6B memory extraction tail
- Phase 6C delegated completion/result tail
- Phase 6D blocked/unsupported delegated control tail

This artifact is planning-only. It does not change runtime behavior.

## Phase 6E judgment

The remaining delegated setup / creation cluster is still the least risky outstanding extraction candidate, but it is not unattended-safe.

Why 6E remains planning-only:

- it owns creation-time truth across `conversation_delegations`, orchestration linkage, worker conversation setup, and delegated runtime start
- parity checks are useful but not sufficient by themselves to prove there is no subtle creation-time drift
- a boundary mistake here can create fresh `missing_orchestration_task` or linkage drift without immediately breaking late-stage tails

Recommended status:

- supervised-only

## Region A: Remaining delegated setup / creation cluster

### Exact inside boundary

- `Build Delegation Request`
- `Create Conversation Delegation`
- `Build Delegation Context`
- `Save Delegated Worker Message`
- `Build Delegation Execution Context`
- `Start Delegated Runtime`

### Exact outside boundary

- `Resolve Parent Conversation Strategy`
- `Delegation Required?`
- `Delegation Approval Required?`
- `Delegated Worker Is Codex?`
- `Build Delegated Codex Context`
- delegated control tail module
- delegated completion tail module

### Persisted truth surfaces affected

- `conversation_delegations`
- orchestration `tasks`
- delegated runtime `tasks`
- delegated runtime `task_runs`
- worker conversation `messages`

### Invariants that must not change

- `ghost_create_conversation_delegation(...)` call arguments and returned identifiers
- delegation metadata JSON content, especially parent/delegated provider/model and `n8n_execution_id`
- worker user-message creation before delegated runtime execution handoff
- `ghost_start_delegation_runtime(...)` call semantics and returned `task_id` / `task_run_id`
- linkage continuity across:
  - delegation id
  - orchestration task id
  - worker conversation id
  - runtime task id
  - runtime task run id

### Likely regression patterns

- fresh `missing_orchestration_task`
- fresh `delegated_runtime_missing_linked_delegation`
- worker conversation message missing or written too late
- delegated runtime started without stable delegation linkage
- `n8n_execution_id` drift between delegation and runtime surfaces

### Required validation commands

- `node --check scripts/build-phase5gd-openclaw-workflow.js`
- `node --check <new-module>.js`
- `node scripts/build-phase5gd-openclaw-workflow.js`
- `bash -n ops/reconcile-runtime.sh`
- `ops/reconcile-runtime.sh --recent-hours 12 --limit 25`

### Required targeted probes

- blocked delegated path still creates delegation and worker user message correctly
- unsupported delegated path still creates delegation and worker user message correctly
- executable delegated path still starts runtime with stable `task_id` / `task_run_id`
- delegated setup context still carries:
  - `delegation_id`
  - `orchestration_task_id`
  - `worker_conversation_id`
  - `n8n_execution_id`

### Rollback conditions

- any new recent delegated parity finding tied to linkage or orchestration creation
- any uncertainty in worker-message before runtime-start ordering
- any need to absorb routing or approval nodes into the boundary

### Builder-level extraction viability

- viable only with close supervision

### Recommendation

- best next supervised extraction candidate

## Region B: Request ingress / conversation load

### Exact inside boundary

- `Incoming chat`
- `Normalize Input`
- `Find Conversation By ID`
- `Conversation Exists?`
- `Create New Conversation`
- `Use Existing Conversation Context`
- `Conversation Context`
- `Save User Message`
- `Load Recent Messages`
- `Expose Route Metadata`

### Exact outside boundary

- `Ensure Conversation Owner`
- `Conversation Context With Owner`
- runtime ledger nodes
- direct/delegated execution branches
- downstream persistence tails

### Persisted truth surfaces affected

- `conversations`
- user `messages`
- route metadata consumed later by runtime and assistant persistence

### Invariants that must not change

- conversation resolution/creation behavior
- user-message ordering and metadata
- `entrypoint` propagation
- `n8n_execution_id` propagation from request normalization onward
- recent-message load semantics used for prompts and policy

### Likely regression patterns

- wrong conversation chosen
- user message missing or saved with wrong metadata
- route metadata missing `entrypoint` or `n8n_execution_id`
- prompt assembly fed from wrong history

### Required targeted probes

- new conversation path
- existing conversation path
- explicit conversation id path
- `entrypoint` / `n8n_execution_id` propagation path

### Builder-level extraction viability

- supervised-only

### Recommendation

- lower priority than delegated setup / creation

## Region C: Owner resolution / approval policy

### Exact inside boundary

- `Ensure Conversation Owner`
- `Conversation Context With Owner`
- `Resolve Parent Conversation Strategy`
- `Assess Approval Risk`

### Exact outside boundary

- ingress/load region
- delegation router
- provider execution branches

### Persisted truth surfaces affected

- parent assistant metadata
- delegated context shaping
- approval/blocking semantics

### Invariants that must not change

- owner lock semantics
- parent provider/model choice
- `delegation_required` output
- risk/approval semantics

### Likely regression patterns

- wrong parent provider/model
- silent direct-vs-delegated route drift
- approval-required semantics changing without obvious runtime failure

### Required targeted probes

- direct safe request
- technical-work delegated request
- approval-required request
- owner-locked conversation

### Builder-level extraction viability

- supervised-only

### Recommendation

- may be better left inlined if maintenance pressure remains low

## Region D: Delegation router

### Exact inside boundary

- `Delegation Required?`
- `Delegation Approval Required?`
- `Delegated Worker Is Codex?`
- the handoffs from those nodes into direct, blocked, unsupported, and executable delegated branches

### Exact outside boundary

- owner policy internals
- delegated setup / creation
- delegated control tail
- worker runtime branch
- direct runtime branch

### Persisted truth surfaces affected

- all persisted truth surfaces indirectly through branch selection

### Invariants that must not change

- direct vs delegated branch choice
- blocked vs unsupported vs executable delegated branch choice
- parent-visible truth semantics for those branch choices

### Likely regression patterns

- route drift without immediate SQL/runtime failure
- blocked/unsupported contradiction reappearing
- wrong branch receiving valid data

### Required targeted probes

- direct safe request
- delegated technical-work request
- blocked delegated request
- unsupported delegated request

### Builder-level extraction viability

- technically possible, but currently too risky for builder-level extraction value

### Recommendation

- leave inlined unless there is a strong future maintenance reason

## Region E: Worker runtime branches

### Exact inside boundary

- `Build Delegated Codex Context`
- `Build Delegated Codex Command`
- `Execute Delegated Codex Command`
- `Normalize Delegated Codex Reply`
- `Save Delegated Worker Reply`

### Exact outside boundary

- delegated setup / creation
- delegated control tail
- delegated completion tail

### Persisted truth surfaces affected

- delegated runtime `task_runs`
- worker assistant metadata
- delegated completion event inputs
- parent delegated response inputs

### Invariants that must not change

- delegated success/failure classification
- timeout/invalid-result semantics
- worker reply metadata linkage
- runtime-to-parent truth alignment

### Likely regression patterns

- worker/parent mismatch
- completion event mismatch
- delegated failure classes drifting

### Required targeted probes

- delegated success
- delegated timeout
- delegated invalid result
- delegated generic failure

### Builder-level extraction viability

- supervised-only and late in order

### Recommendation

- do not attempt before Region A is either extracted safely or explicitly frozen in place

## Practical stop point for Phase 6

Phase 6 should stop after:

- the already completed downstream tail extractions
- the current planning/spec package for the remaining higher-risk regions

It should not keep chasing theoretical modularization value into the router or worker-runtime core without a stronger supervised justification.
