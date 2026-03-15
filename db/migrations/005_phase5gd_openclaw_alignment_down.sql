BEGIN;

DROP FUNCTION IF EXISTS public.ghost_finalize_delegation(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT
);

DROP FUNCTION IF EXISTS public.ghost_start_delegation_runtime(
  UUID,
  TEXT,
  TEXT,
  JSONB,
  JSONB
);

DROP FUNCTION IF EXISTS public.ghost_create_conversation_delegation(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
);

DROP FUNCTION IF EXISTS public.ghost_resolve_worker_agent(
  TEXT,
  TEXT
);

DROP FUNCTION IF EXISTS public.ghost_ensure_conversation_owner(
  UUID
);

DROP FUNCTION IF EXISTS public.ghost_get_default_owner_policy();

DROP TRIGGER IF EXISTS trg_conversation_delegations_updated_at ON conversation_delegations;
DROP TABLE IF EXISTS conversation_delegations;

DROP INDEX IF EXISTS idx_conversations_owner_agent;

ALTER TABLE conversations
  DROP COLUMN IF EXISTS owner_locked_at,
  DROP COLUMN IF EXISTS owner_model,
  DROP COLUMN IF EXISTS owner_provider,
  DROP COLUMN IF EXISTS owner_agent_id;

DELETE FROM agents WHERE agent_key IN ('codex-worker', 'openai-api-worker', 'ollama-worker');

COMMIT;
