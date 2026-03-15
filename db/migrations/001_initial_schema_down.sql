BEGIN;

-- ─── Drop functions ───────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.ghost_finalize_delegation(UUID, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ghost_start_delegation_runtime(UUID, TEXT, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.ghost_create_conversation_delegation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.ghost_resolve_worker_agent(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ghost_ensure_conversation_owner(UUID);
DROP FUNCTION IF EXISTS public.ghost_get_default_owner_policy();
DROP FUNCTION IF EXISTS public.ghost_runtime_complete_task_ledger(UUID, UUID, INTEGER, JSONB, UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.ghost_runtime_start_task_ledger(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.ghost_runtime_summarize_prompt(TEXT);
DROP FUNCTION IF EXISTS public.set_updated_at();

-- ─── Drop tables (reverse FK order) ─────────────────────────────────────────

DROP TABLE IF EXISTS orchestration_task_events;
DROP TABLE IF EXISTS conversation_delegations;
DROP TABLE IF EXISTS orchestration_tasks;
DROP TABLE IF EXISTS ghost_memory;
DROP TABLE IF EXISTS tool_events;
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS task_runs;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS service_health;
DROP TABLE IF EXISTS system_prompts;
DROP TABLE IF EXISTS ghost_action_history;
DROP TABLE IF EXISTS ghost_governed_followthrough;

COMMIT;
