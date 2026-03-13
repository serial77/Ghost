## Ghost Memory Trace Audit

Scope:
- current Postgres-first memory layer only
- no architecture change
- no semantic/vector expansion

## Current Memory Path

Parent conversation memory read:
- `Load Ghost Memory` reads memory during parent prompt assembly
- `Compose Prompt With Ghost Memory` injects the retrieved memory into the parent prompt

Parent conversation memory write:
- `Save Assistant Reply` fans into the memory extraction side path
- `Build Memory Extraction Input`
- extraction / parse / filter nodes
- `Save Structured Memory`

Runtime / delegation / task history:
- task/task_run/tool_event records are written through runtime ledger DB functions
- worker execution history is written to `tasks`, `task_runs`, `tool_events`, `conversation_delegations`, and worker `messages`

Worker context separation:
- delegated work gets its own `worker_conversation_id`
- worker assistant replies are saved to the worker conversation
- worker runtime records remain tied to `ghost_worker_runtime`
- worker reply persistence does not feed the parent memory extraction branch

## Contract Check

Current separation still holds:
- parent conversation memory remains parent-thread memory
- worker execution is kept in a separate worker conversation
- delegation/runtime records stay distinct from `ghost_memory`
- the parent assistant reply can summarize delegated work, but worker messages are not directly written into parent `ghost_memory`

## Retrieval Audit

Over-fetch risk:
- parent prompt assembly uses recent messages plus retrieved memory, so dense long-running threads can still accumulate prompt pressure

Under-fetch risk:
- current retrieval is conversation scoped plus selected global memory; narrow retrieval can miss older but still relevant facts if they are not among the active rows returned

Duplicate context risk:
- parent recent message history and durable memory can restate similar facts
- the filter path helps, but this is still a maintenance hotspot

Stale context risk:
- memory relies on status and recency discipline in `ghost_memory`
- outdated active rows can still be loaded if they are not superseded or archived

No low-risk runtime patch was applied here because the current separation was verified and the risks above need a supervised memory phase, not an unattended rewrite.

## Debug Helpers

Operator helpers added in this pass:
- [ops/trace-memory.sh](/home/deicide/dev/ghost-stack/ops/trace-memory.sh)
- [ops/trace-runtime.sh](/home/deicide/dev/ghost-stack/ops/trace-runtime.sh)

Useful examples:

```bash
ops/trace-memory.sh --conversation-id <parent_conversation_id>
ops/trace-memory.sh --worker-conversation-id <worker_conversation_id>
ops/trace-memory.sh --delegation-id <delegation_id>
ops/trace-memory.sh --runtime-task-id <runtime_task_id>
ops/trace-memory.sh --latest-memory 20
```

## What Still Needs a Supervised Future Memory Phase

- tighter retrieval ranking if prompt pressure becomes visible
- better stale-memory lifecycle controls
- explicit duplicate-context review rules between recent messages and durable memory
- targeted memory regression harnesses for delegated-parent summary edge cases
