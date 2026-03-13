## Ghost Phase 4A Regression Harness

Status:
- Live production workflow remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- Dev memory workflow remains `kvNzP8BQxXlrtKFG`
- Dev memory webhook remains `/webhook/ghost-chat-v3-memory-dev`

### Summary

This harness adds a repeatable local smoke/regression check for the Phase 4A dev workflow memory path.

Script:
- `/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh`

The script posts a fixed test matrix to the dev webhook, captures `conversation_id`, then verifies:
- HTTP status is `200`
- at least one user message row exists
- at least one assistant message row exists
- active `ghost_memory` row count matches the case expectation
- normalized `ghost_memory.summary` matches expected text for decision/fact cases
- the latest dev workflow execution status is `success`
- recall-specific cases can also verify same-conversation memory recall and supersede behavior

It supports both:
- human-readable terminal output by default
- optional machine-readable JSON reporting for CI or archival

### How to run it

```bash
/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh
```

JSON to stdout:

```bash
/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh --json
```

Write JSON report to a file while keeping normal terminal output:

```bash
/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh \
  --report-json /tmp/phase4a-memory-dev-report.json
```

Run a single named test case:

```bash
/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh --test trivial_chat
```

Optional env overrides:
- `WEBHOOK_URL`
- `POSTGRES_CONTAINER`
- `POSTGRES_USER`
- `APP_DB`
- `CORE_DB`
- `DEV_WORKFLOW_ID`

### Fixed test matrix

1. `trivial_chat`
   - payload: `Say hello in five words.`
   - expects: `200`, `0` memory rows

2. `architectural_decision`
   - payload: `Architectural decision: use Postgres for Ghost memory first and do not add pgvector in this phase. Confirm briefly.`
   - expects: `200`, `1` `decision` row
   - expected summary: `use Postgres for Ghost memory first and do not add pgvector in this phase`

3. `environment_fact`
   - payload: `Environment fact: the Ghost runtime uses Postgres 16 in the local docker compose stack. Confirm briefly.`
   - expects: `200`, `1` `environment_fact` row
   - expected summary: `the Ghost runtime uses Postgres 16 in the local docker compose stack`

4. `comma_heavy_message`
   - payload contains multiple commas
   - expects: `200`

5. `comma_heavy_json_text`
   - payload contains commas plus JSON-looking text
   - expects: `200`

6. `invalid_json_mode`
   - payload includes `memory_test_mode=invalid_json`
   - expects: `200`, `0` memory rows

7. `mixed_noisy_prompt`
   - payload includes runtime-noise phrases plus a decision sentence
   - expects: `200`, `0` memory rows

8. `forced_lightweight_local_task`
   - payload includes `force_task_class=lightweight_local_task`
   - expects: `200`

9. `forced_technical_work`
   - payload includes `force_task_class=technical_work`
   - expects: `200`

10. `recall_decision_after_fillers`
   - writes a decision
   - adds 7 filler turns to push the original turn out of recent-message history
   - asks for recall in the same conversation
   - expects: reply still references the stored decision

11. `recall_environment_fact`
   - writes an environment fact
   - adds filler turns
   - asks for recall in the same conversation
   - expects: reply references the stored environment fact

12. `supersede_environment_fact`
   - writes an older environment fact
   - writes a newer replacement fact for the same topic
   - asks for recall
   - expects: one `active` row, one `superseded` row, and recall prefers the active fact

13. `no_memory_no_hallucinated_recall`
   - asks for durable memory in a fresh conversation
   - expects: `200`, `0` memory rows, and no obvious hallucinated recall

### Example output

```text
Running Phase 4A dev memory regression harness
Webhook: http://127.0.0.1:5678/webhook/ghost-chat-v3-memory-dev
PASS trivial_chat
PASS architectural_decision
PASS environment_fact
PASS comma_heavy_message
PASS comma_heavy_json_text
PASS invalid_json_mode
PASS mixed_noisy_prompt
PASS forced_lightweight_local_task
PASS forced_technical_work
PASS recall_decision_after_fillers
PASS recall_environment_fact
PASS supersede_environment_fact
PASS no_memory_no_hallucinated_recall

Result: 13 passed, 0 failed
```

### Example JSON shape

```json
{
  "harness": "phase4a-memory-dev",
  "webhook": "http://127.0.0.1:5678/webhook/ghost-chat-v3-memory-dev",
  "timestamp": "2026-03-12T13:00:00Z",
  "test_filter": null,
  "summary": {
    "passed": 13,
    "failed": 0,
    "total": 13,
    "status": "pass"
  },
  "tests": [
    {
      "name": "trivial_chat",
      "status": "pass",
      "http_status": 200,
      "conversation_id": "00000000-0000-0000-0000-000000000000",
      "checks": {
        "http_status_ok": true,
        "conversation_id_ok": true,
        "user_message_saved": true,
        "assistant_message_saved": true,
        "memory_row_count_ok": true,
        "execution_status_ok": true,
        "memory_type_ok": true,
        "memory_summary_ok": true
      }
    }
  ]
}
```

### Known limitations

- The workflow returns the user-facing response before the memory path is always fully persisted, so the harness uses short polling against Postgres for `messages`, `ghost_memory`, and execution status.
- The execution-status check reads the latest dev workflow execution globally, not a conversation-linked execution row.
- Because the execution-status check is workflow-global, multiple concurrent harness runs can race each other. Run the harness sequentially.
- The harness is a local smoke check, not a full isolated integration test framework.
- `--json` writes JSON to stdout and suppresses the normal human-readable lines.
- `--report-json PATH` writes the final structured report to disk after the run completes.
- `--test NAME` is intended for targeted local validation and should not replace the full matrix for handoff verification.
- It assumes:
  - `jq`
  - `uuidgen`
  - Docker access to `ghost-postgres`

### How to extend it later

- Add a new `run_case`, `run_recall_case`, `run_supersede_case`, or `run_no_memory_recall_case` invocation in `/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh`
- Set:
  - payload
  - expected memory count
  - expected memory type
  - expected normalized summary when relevant
- Keep new checks limited to durable invariants so the harness stays stable and fast
