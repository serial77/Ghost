# Phase 6 Execution Briefs

This document extends the Phase 6 roadmap with the invariants, validation matrices, and supervised execution briefs for the remaining workflow regions.

It is planning-only. It does not change runtime behavior.

## Candidate 1: Remaining delegated setup / creation cluster

### Proposed boundary

Inside:

- `Build Delegation Request`
- `Create Conversation Delegation`
- `Build Delegation Context`
- `Save Delegated Worker Message`
- `Build Delegation Execution Context`
- `Start Delegated Runtime`

Outside:

- `Resolve Parent Conversation Strategy`
- `Delegation Required?`
- `Delegation Approval Required?`
- `Delegated Worker Is Codex?`
- `Build Delegated Codex Context`
- delegated control tail
- delegated completion tail

### Why this is the least risky remaining extraction

- It is still downstream of route selection and upstream of worker execution normalization.
- It owns creation-time truth, but not the branching semantics that choose blocked vs unsupported vs executable.
- It is narrower than ingress, owner policy, router, or worker runtime extraction.

### Persisted truth surfaces affected

- `conversation_delegations`
- orchestration `tasks`
- delegated runtime `tasks` / `task_runs`
- worker conversation `messages`

### Invariants that must not change

- `ghost_create_conversation_delegation(...)` arguments and returned linkage semantics
- delegation metadata JSON shape and execution correlation fields
- worker conversation creation and worker user-message persistence ordering
- `ghost_start_delegation_runtime(...)` arguments and returned `task_id` / `task_run_id`
- `n8n_execution_id` propagation into delegated creation/runtime context where currently present
- no change to blocked/unsupported branching decisions

### What would count as regression

- `conversation_delegations` rows missing expected orchestration or worker conversation linkage
- worker message no longer created before delegated execution handoff
- delegated runtime task not linked back to the intended delegation
- recent delegated parity showing new:
  - `delegated_runtime_missing_linked_delegation`
  - `worker_reply_missing_for_terminal_runtime`
  - `delegation_missing_orchestration_task_id`
  - `worker_reply_missing_execution_id`

### Validation matrix

Required checks:

- `node --check scripts/build-phase5gd-openclaw-workflow.js`
- `node --check` on any new module
- regenerate `workflows/ghost-chat-v3-phase5gd-openclaw.json`
- `bash -n ops/reconcile-runtime.sh`
- `ops/reconcile-runtime.sh --recent-hours 12 --limit 25`

Required probes:

- approval-blocked delegated path still creates delegation and worker user message correctly
- unsupported delegated path still creates delegation and worker user message correctly
- executable delegated path still starts delegated runtime with expected `task_id` / `task_run_id`
- delegated worker context still carries `n8n_execution_id`, `delegation_id`, `orchestration_task_id`

Success criteria:

- direct parity remains `OK no findings`
- delegated parity remains `OK no findings`
- no new linkage-related delegated findings appear

Rollback conditions:

- any new recent `missing_orchestration_task` on fresh rows
- delegated runtime start loses `task_id` / `task_run_id`
- blocked/unsupported semantics drift because the extraction boundary leaked into control logic

### Supervised execution brief

Scope:

- extract the creation-time delegated setup cluster into one builder module

Out of scope:

- route selection
- approval policy
- blocked/unsupported control tail
- worker runtime execution and normalization
- delegated completion/result tail

Hard stops:

- if the boundary requires pulling in `Delegation Required?`, `Delegation Approval Required?`, or `Delegated Worker Is Codex?`
- if reconciliation produces new delegated parity findings on recent rows
- if worker-message or runtime-start ordering becomes uncertain

Judgment:

- supervised only

## Candidate 2: Request ingress / conversation load

### Proposed boundary

Inside:

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
- possibly `Touch Conversation Timestamp`

Outside:

- owner resolution
- runtime ledger
- direct/delegated execution branches
- downstream persistence tails

### Persisted truth surfaces affected

- `conversations`
- user `messages`
- downstream route metadata used by nearly all later truth surfaces

### Invariants that must not change

- conversation selection/creation semantics
- user message persistence and ordering
- `entrypoint` / `n8n_execution_id` exposure semantics
- recent message load semantics used for prompts and policy

### What would count as regression

- wrong conversation reused or new conversation not created
- user message not saved or saved with wrong metadata
- route metadata missing `n8n_execution_id`
- prompts built from wrong conversation history

### Validation matrix

Required checks:

- builder checks
- workflow regeneration
- reconciliation helper

Required probes:

- new conversation request
- existing conversation request
- forced conversation id path
- metadata exposure path for `entrypoint` and `n8n_execution_id`

Success criteria:

- no change in conversation/message persistence semantics
- direct and delegated parity remain green

Rollback conditions:

- any uncertainty around conversation identity or user-message ordering

### Supervised execution brief

Scope:

- extract ingress and conversation load only

Out of scope:

- owner policy
- route selection
- runtime ledger
- execution branches

Hard stops:

- if prompt assembly or route metadata staging must move with it
- if the boundary becomes broad enough to change early-pipeline semantics

Judgment:

- supervised only
- lower priority than delegated setup/creation

## Candidate 3: Owner resolution / policy

### Proposed boundary

Inside:

- `Ensure Conversation Owner`
- `Conversation Context With Owner`
- `Resolve Parent Conversation Strategy`
- `Assess Approval Risk`
- any tightly coupled owner-policy staging node needed to preserve semantics

Outside:

- ingress/load
- delegation router
- direct/delegated execution

### Persisted truth surfaces affected

- parent assistant metadata
- delegated context fields
- policy-derived approval/blocking semantics

### Invariants that must not change

- owner assignment and lock semantics
- parent provider/model resolution
- `delegation_required` semantics
- approval-required inputs and risk reasoning

### What would count as regression

- wrong owner/provider/model selected
- approval gating semantics change
- direct path selected when delegated path should run, or vice versa

### Validation matrix

Required checks:

- builder checks
- workflow regeneration
- reconciliation helper

Required probes:

- direct safe request
- technical-work request
- approval-required request
- owner-locked conversation

Success criteria:

- same owner/provider/model/policy outputs as current flow

Rollback conditions:

- any ambiguity in route selection or approval gating

### Supervised execution brief

Scope:

- extract owner/policy resolution only if outputs can be contract-asserted first

Out of scope:

- delegation router
- execution branches

Hard stops:

- if extraction begins to absorb `Delegation Required?`
- if policy outputs cannot be compared deterministically in probes

Judgment:

- supervised only
- may be better left inlined

## Candidate 4: Delegation router

### Proposed boundary

Inside:

- `Delegation Required?`
- `Delegation Approval Required?`
- `Delegated Worker Is Codex?`
- route handoffs into direct, blocked, unsupported, and executable delegated paths

Outside:

- owner resolution internals
- worker execution
- completion tails

### Persisted truth surfaces affected

- all of them indirectly, because this is the branch-selection center

### Invariants that must not change

- direct vs delegated branch choice
- blocked vs unsupported vs executable delegated branch choice
- response-mode truthfulness

### What would count as regression

- any route drift
- any contradiction between parent-visible meaning and delegated/runtime state

### Validation matrix

Required checks:

- builder checks
- workflow regeneration
- reconciliation helper
- full branch scenario matrix

Required probes:

- direct safe request
- direct approval-required request
- technical-work delegated request
- blocked delegated request
- unsupported delegated request

Success criteria:

- identical branch decisions under the same inputs

Rollback conditions:

- any ambiguity in route decision or control semantics

### Supervised execution brief

Scope:

- do not attempt until route-contract documentation is stronger

Judgment:

- too risky for unattended builder extraction
- possibly not worth extracting at all

## Candidate 5: Worker runtime branches

### Proposed boundary

Inside:

- `Build Delegated Codex Context`
- `Build Delegated Codex Command`
- `Execute Delegated Codex Command`
- `Normalize Delegated Codex Reply`
- `Save Delegated Worker Reply`

Outside:

- delegated setup/creation
- delegated control tail
- delegated completion tail

### Persisted truth surfaces affected

- delegated runtime `tasks` / `task_runs`
- worker assistant metadata
- delegated completion event annotation inputs
- parent delegated response inputs

### Invariants that must not change

- delegated worker success/failure classification
- timeout/invalid-result semantics
- worker assistant metadata fields
- linkage to delegated completion truth surfaces

### What would count as regression

- delegated failure classes drift
- worker reply metadata loses linkage or classification fields
- parent delegated truth diverges from worker/runtime truth

### Validation matrix

Required checks:

- builder checks
- workflow regeneration
- reconciliation helper

Required probes:

- delegated success
- delegated timeout
- delegated invalid result
- delegated generic failure

Success criteria:

- delegated parity remains clean
- worker and parent delegated surfaces still agree

Rollback conditions:

- any new delegated parity issue involving worker/parent mismatch or completion event mismatch

### Supervised execution brief

Scope:

- only attempt after creation-time cluster is stable and worker-runtime contracts are explicitly guarded

Judgment:

- supervised only
- not suitable for unattended extraction

## Recommended next supervised sequence

1. Remaining delegated setup / creation cluster
2. Reassess whether any residual response-shaping helper cluster is worth extracting
3. Decide whether owner resolution / policy should remain inlined
4. Leave delegation router inlined unless there is a strong maintenance case
5. Treat worker runtime branches as the last serious extraction candidate

## Builder-level vs runtime-subworkflow judgment

All remaining feasible work should stay builder-level for now.

Do not consider runtime `Execute Workflow` semantics before:

- creation-time delegated contracts are explicitly guarded
- owner/policy outputs are documented more rigorously
- route decisions have a stronger validation matrix than the current parity helper alone
