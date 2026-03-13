# ROUTING — Ghost 🔮

## Default model policy
- GPT-5.1 API: premium conversation, planning, design, important user-facing outputs
- GPT-5.1 Codex API: premium code, debugging, refactors, migrations, infra changes
- Qwen3:14B: cheap local reasoning, summarization, fallback chat tasks
- Qwen2.5-Coder:14B: cheap local coding, scripting, fallback technical tasks

## Escalation rules
Escalate to premium when:
- code will be deployed
- data/state may be modified
- security or money is involved
- output quality matters visibly
- local model appears uncertain

## Fallback rules
- premium chat unavailable → Qwen3:14B
- premium coding unavailable → Qwen2.5-Coder:14B