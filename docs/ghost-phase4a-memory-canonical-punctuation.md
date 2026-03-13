## Ghost Phase 4A.1d Canonical Punctuation

Status:
- Live production workflow remains `Yh6h9OJyVCfREbp3`
- Live production webhook remains `/webhook/ghost-chat-v3`
- Dev memory workflow remains `kvNzP8BQxXlrtKFG`
- Dev memory webhook remains `/webhook/ghost-chat-v3-memory-dev`

### Summary

Phase 4A.1d adds one narrow normalization rule in the dev-only structured memory write path:
- short fallback-written summaries now drop trivial trailing `.` or `!`
- dedupe in the same extraction pass uses that canonical form
- wrapper stripping, duplicate-clause cleanup, conservative filtering, and soft-fail behavior remain unchanged

No schema change was made.

### Backup created before edits

- `/home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T130124Z.json`

### Exact node changes

Changed:
- `Filter Structured Memory Candidates`
  - added `canonicalPunctuationTypes` for `decision`, `environment_fact`, and `operational_note`
  - added `canonicalizeShortFallbackSummary(summary, memoryType, detailsJson)`
  - canonicalization only applies when:
    - `details_json.source === 'heuristic_fallback'`
    - summary length is `<= 120`
    - memory type is one of the conservative durable types above
    - trailing punctuation is only `.` or `!`
  - canonicalization runs after wrapper stripping and duplicate-clause cleanup
  - dedupe benefits automatically because it keys on the normalized summary

Unchanged:
- `Parse Structured Memory`
- `Save Structured Memory`
- `Summarize Memory Write Outcome`

No new node was added.

### Before / after examples

- `keep answers concise.` -> `keep answers concise`
- `keep answers concise!` -> `keep answers concise`
- `restart ghost-n8n-main and ghost-n8n-worker after publish:workflow.` -> `restart ghost-n8n-main and ghost-n8n-worker after publish:workflow`
- `use Postgres only.` -> `use Postgres only`

### Test cases run

1. Preference phrased twice, one with punctuation variant -> one canonical stored row
   - request: `User preference for this conversation: keep answers concise. Preference: keep answers concise`
   - conversation: `bace75e4-bbff-46e6-b20b-1e8dc6d4aa14`
   - row: `decision|conversation|keep answers concise`

2. Operational note with and without trailing period -> one canonical stored row
   - request: `Operational note: restart ghost-n8n-main and ghost-n8n-worker after publish:workflow. Runtime note: restart ghost-n8n-main and ghost-n8n-worker after publish:workflow`
   - conversation: `85174b28-9066-4b6a-bc2e-b47b1d91c0b0`
   - row: `operational_note|conversation|restart ghost-n8n-main and ghost-n8n-worker after publish:workflow`

3. Explicit architectural decision with trailing period variant -> one canonical stored row
   - request: `Architectural decision: use Postgres only. Decision for this conversation: use Postgres only`
   - conversation: `395916f5-a1bc-4a8a-a540-f0ee86960b1a`
   - row: `decision|conversation|use Postgres only`

4. Trivial chat -> 0 writes
   - request: `Say hello in five words.`
   - conversation: `cfd7585a-137d-4dd1-8292-0ac85066c756`
   - active memory rows: `0`

5. Mixed noisy prompt -> 0 writes
   - request: `Hello. This prompt contains the words stderr and stdout but is just noise. What is two plus two?`
   - conversation: `90c73221-bbf6-4a55-87e8-d74c4023a8b7`
   - webhook status: `200`
   - active memory rows: `0`

6. `invalid_json` mode -> 200 response, 0 writes
   - request body included `"memory_test_mode":"invalid_json"`
   - conversation: `93b6f84f-b4c0-41aa-ba6b-ad0d840ec898`
   - webhook status: `200`
   - active memory rows: `0`

### Notes

- Two noisier mixed-prompt variants returned `500` immediately after the dev workflow republish while `ghost_memory` still recorded `0` rows for those conversations. A simpler mixed-noise chat prompt succeeded with `200` and validated the no-write behavior.
- This change did not alter live production behavior.

### Rollback instructions

Restore the previous dev export:

```bash
docker cp /home/deicide/dev/ghost-stack/workflows/ghost-chat-v3-phase4a-memory-dev.backup-20260312T130124Z.json \
  ghost-n8n-main:/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json

docker exec ghost-n8n-main n8n import:workflow \
  --input=/tmp/ghost-chat-v3-phase4a-memory-dev-rollback.json \
  --projectId=Dy430kHXAiPu4Qrc

docker exec ghost-n8n-main n8n publish:workflow --id=kvNzP8BQxXlrtKFG

docker exec ghost-n8n-main n8n update:workflow --id=kvNzP8BQxXlrtKFG --active=true

docker compose -f /home/deicide/dev/ghost-stack/base/docker-compose.yml restart ghost-n8n-main ghost-n8n-worker
```

No database rollback is required for Phase 4A.1d because the schema did not change.

### Recommendation for the next short task

Investigate the remaining mixed-noisy prompt `500` cases in the dev workflow so soft-fail behavior is preserved even when runtime-noise keywords appear alongside a high-signal fallback candidate.
