## Ghost Phase 4A Final Dev Review

Status:
- Live production workflow remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- Dev memory workflow remains `kvNzP8BQxXlrtKFG`
- Dev memory webhook remains `/webhook/ghost-chat-v3-memory-dev`

### Summary

This was a final broader quality review of the Phase 4A structured Postgres memory path on the dev workflow.

Result:
- no new blocking quality issue was found
- no additional workflow/schema fix was justified in this pass
- Phase 4A is ready for a controlled production cutover, assuming the documented backup and rollback plan is followed

Validation tier used:
- Tier 2
- reason: this batch focused on broader dev validation and production-readiness planning, without changing schema or live production

### Broader review matrix used

This review used 17 cases total:

Harness-backed cases:
1. trivial chat
2. explicit architectural decision
3. explicit environment fact
4. comma-heavy user message
5. comma-heavy + JSON-looking text
6. invalid_json mode
7. mixed noisy prompt
8. forced lightweight_local_task
9. forced technical_work
10. recall decision after filler turns
11. recall environment fact
12. supersede environment fact
13. no-memory no-hallucinated-recall

Additional targeted quality-review cases:
14. explicit durable user preference write
15. durable user preference recall
16. explicit operational note write
17. noisy prompt with one high-signal environment fact

### Review findings by category

1. Explicit architectural decisions
   - write quality: acceptable
   - normalization quality: acceptable
   - recall quality: acceptable after filler turns

2. Explicit environment/runtime facts
   - write quality: acceptable
   - lifecycle/supersede: acceptable for tested replacement facts
   - recall quality: acceptable

3. Explicit operational notes
   - write quality: acceptable
   - normalization quality: acceptable
   - no prompt pollution observed in tested case

4. Durable user preferences/instructions
   - behavior is now consistent
   - preferences are intentionally stored as `decision`
   - `details_json.memory_origin = 'durable_user_preference'`
   - recall quality in the tested case was acceptable

5. technical_work turns
   - route still behaves correctly
   - tested non-durable technical prompts correctly stayed conservative on memory writes
   - `task_summary` remains intentionally conservative in this phase

6. Trivial chat
   - no memory writes in the reviewed case
   - no hallucinated recall in the fresh-conversation case

7. Noisy prompts with one high-signal durable fact
   - conservative behavior remains
   - tested noisy environment-fact case wrote `0` rows rather than risking polluted memory
   - this is acceptable for Phase 4A and preferable to noisy false positives

8. Filler turns followed by recall
   - recall still worked after filler turns pushed the original write out of recent-message history
   - this is the strongest indicator that retrieval is doing useful work rather than only relying on short conversation history

9. Conflicting replacement facts
   - tested environment fact replacement now results in one `active` row and one `superseded` row
   - recall preferred the active fact

10. Ambiguous prompts
   - no obvious hallucinated memory in the tested fresh-conversation ambiguous recall prompt

### Problems found

No new blocking issue was found in this final review.

Remaining non-blocking observations:
- noisy prompts with one high-signal durable fact can still choose `0` writes instead of extracting the durable fact
  - current behavior is conservative, not unsafe
  - acceptable for Phase 4A
- `task_summary` generation remains intentionally narrow
  - this keeps Phase 4A cleaner, but broader task-summary capture may be desirable later
- execution-status checks in the local harness are workflow-global
  - sequential harness runs are fine
  - concurrent harness runs can race

### Fixes applied in this batch

None to workflow logic or schema.

This batch added only:
- final review documentation
- a production cutover plan
- an optional prod-ready workflow export artifact

### Schema changed?

No.

### Direct quality review examples

Durable user preference write:
- conversation: `5d763c74-2485-46d4-b438-86a4e3ee51e6`
- row: `decision | keep answers concise | durable_user_preference`

Durable user preference recall:
- conversation: `8a6d0e4d-16f0-456d-a132-d058d5e196f6`
- reply: `You set the preference to keep answers concise.`

Operational note write:
- conversation: `868be667-7e58-4aec-9ddc-f9810172b996`
- row: `operational_note | restart ghost-n8n-main and ghost-n8n-worker after publish:workflow`

Noisy high-signal fact:
- conversation: `0027766e-db5b-4f0a-a80a-f7c06bc2c69e`
- active memory rows: `0`
- acceptable conservative result

### Full harness result

Command:

```bash
/home/deicide/dev/ghost-stack/scripts/test-phase4a-memory-dev.sh
```

Result:
- `13 passed, 0 failed`

### Live untouched confirmation

Conversation:
- `e3b59cca-fb6c-4b42-a5bb-e52480d0d22b`

Result:
- webhook `200`
- reply `live retrieval batch untouched`

### Production readiness decision

Recommendation:
- ready for controlled production cutover

Reason:
- write path is stable
- retrieval and recall are stable enough for first production use
- supersede behavior exists for tested durable memory conflicts
- full dev harness passes
- no new blocking quality issue was found in the broader review

### Files created/changed in this batch

Created:
- `/home/deicide/dev/ghost-stack/docs/ghost-phase4a-final-review.md`
- `/home/deicide/dev/ghost-stack/docs/ghost-phase4a-production-cutover-plan.md`
- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-prod-ready.json`

No workflow code or schema file was changed in this batch.

### Rollback considerations

No live rollback was needed or executed in this batch.

If the prepared prod-ready artifact is later used for cutover, rollback should restore:
- the current live export for `Yh6h9OJyVCfREbp3`
- current published workflow state
- current webhook behavior

Exact cutover rollback steps are documented in:
- `/home/deicide/dev/ghost-stack/docs/ghost-phase4a-production-cutover-plan.md`

### Recommendation for the next major phase

After a controlled Phase 4A production cutover and short observation window, move to Phase 4B:
- retrieval enrichment and semantic lookup planning
- only then consider `pgvector`
- do not broaden memory scope further until Phase 4A has proven stable in live traffic
