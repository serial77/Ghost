## Ghost Runtime Topology Map

Live workflow:
- workflow id: `Yh6h9OJyVCfREbp3`
- name: `GHOST by Codex`
- production webhook: `POST /webhook/ghost-chat-v3`
- source generator: [scripts/build-phase5gd-openclaw-workflow.js](/home/deicide/dev/ghost-stack/scripts/build-phase5gd-openclaw-workflow.js)
- generated source of truth: [workflows/ghost-chat-v3-phase5gd-openclaw.json](/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase5gd-openclaw.json)

## Main Sections

Ingress / normalization:
- `Incoming chat`
- `Normalize Input`

Conversation load / owner resolution:
- `Find Conversation By ID`
- `Conversation Exists?`
- `Create New Conversation`
- `Conversation Context`
- `Ensure Conversation Owner`
- `Conversation Context With Owner`

History / memory shaping:
- `Save User Message`
- `Touch Conversation Timestamp`
- `Load Recent Messages`
- `Load Ghost Memory`
- `Build Ghost System Prompt`
- `Compose Prompt With Ghost Memory`
- `Build Structured Messages`
- `Render Model Prompt`

Delegation decision / routing:
- `Runtime Policy Config`
- `Classify request`
- `Select Route Plan`
- `Assess Approval Risk`
- `Resolve Parent Conversation Strategy`
- `Delegation Required?`

Direct owner path:
- `Expose Route Metadata`
- provider branch nodes
- `Normalize OpenAI Reply`
- `Normalize Ollama Reply`
- `Build API Response`
- `Save Assistant Reply`
- `Respond to Webhook`

Delegated worker path:
- `Build Delegation Request`
- `Create Conversation Delegation`
- `Build Delegation Context`
- `Save Delegated Worker Message`
- `Start Delegated Runtime`
- `Build Delegated Codex Context`
- `Build Delegated Codex Command`
- `Execute Delegated Codex Command`
- `Normalize Delegated Codex Reply`
- `Save Delegated Worker Reply`
- `Complete Delegated Runtime`
- `Finalize Successful Delegation`
- `Build Parent Delegation Response`

Runtime ledger persistence:
- `Build Runtime Ledger Start Payload`
- `Start Runtime Ledger`
- `Build Runtime Ledger Completion Payload`
- `Complete Runtime Ledger`

Memory write side path:
- `Build Memory Extraction Input`
- `Should Extract Memory?`
- extractor / parser / filter nodes
- `Save Structured Memory`

## Correlation Injection Points

`n8n_execution_id` is injected or propagated at:
- `Normalize Input`
- `Expose Route Metadata`
- runtime ledger start payload
- runtime ledger completion payload
- delegation context
- delegated codex context
- delegated worker reply persistence
- parent and worker response payload builders

## Failure Shaping Points

Primary operator-facing failure shaping happens at:
- `Normalize Codex Reply`
- `Normalize Delegated Codex Reply`
- `Build Approval Required Response`
- `Build Parent Blocked Delegation Response`
- `Build Parent Unsupported Delegation Response`
- `ghost_runtime_complete_task_ledger(...)` in the DB layer

## Fragile Clusters

Most fragile node clusters:
- `Build Delegation Context`
  - dense parent/worker correlation handoff
  - easy place to break board linkage or worker separation
- `Normalize Codex Reply` and `Normalize Delegated Codex Reply`
  - execution result parsing and failure summary shaping
- runtime ledger start/complete nodes
  - key bridge between live webhook execution and task/task_run/tool_event traceability
- memory side path after `Save Assistant Reply`
  - should remain non-blocking and separate from user-facing response success

## Maintenance Rules

When editing this workflow:
- do not break pinned-owner resolution
- do not silently switch provider/model inside the parent conversation
- do not bypass explicit delegation
- do not collapse parent and worker conversations into one thread
- keep response assembly and runtime ledger correlation in sync

## Reproducibility Note

The generator path is the intended source of truth, but this n8n deployment requires:
- import
- publish
- restart `ghost-n8n-main`
- restart `ghost-n8n-worker`

before production webhook registrations reflect the new live workflow version.

Observed live-vs-generated drift after activation:
- node count matched
- node name set matched
- connection key set matched
- webhook path matched
- expected drift remained in live n8n version metadata such as `versionId`, `activeVersionId`, and timestamps
