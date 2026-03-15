BEGIN;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS owner_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_provider TEXT,
  ADD COLUMN IF NOT EXISTS owner_model TEXT,
  ADD COLUMN IF NOT EXISTS owner_locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_owner_agent
  ON conversations (owner_agent_id);

INSERT INTO agents (
  agent_key,
  display_name,
  agent_type,
  provider,
  model_name,
  status,
  capabilities,
  config,
  metadata
)
VALUES
  (
    'codex-worker',
    'Codex Worker',
    'worker',
    'codex_oauth_worker',
    'gpt-5.4',
    'active',
    '{"technical_work": true, "delegated": true}'::jsonb,
    '{}'::jsonb,
    '{"source":"phase5gd_openclaw_alignment"}'::jsonb
  ),
  (
    'openai-api-worker',
    'OpenAI API',
    'worker',
    'openai_api',
    'gpt-4.1-mini',
    'active',
    '{"delegated": true}'::jsonb,
    '{}'::jsonb,
    '{"source":"phase5gd_openclaw_alignment"}'::jsonb
  ),
  (
    'ollama-worker',
    'Ollama',
    'worker',
    'ollama',
    'qwen3:14b',
    'active',
    '{"delegated": true}'::jsonb,
    '{}'::jsonb,
    '{"source":"phase5gd_openclaw_alignment"}'::jsonb
  )
ON CONFLICT (agent_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS conversation_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  delegating_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  worker_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  worker_provider TEXT NOT NULL,
  worker_model TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  orchestration_task_id UUID REFERENCES orchestration_tasks(id) ON DELETE SET NULL,
  runtime_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  worker_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  request_summary TEXT,
  result_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_conversation_delegations_parent_created
  ON conversation_delegations (parent_conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_delegations_orchestration
  ON conversation_delegations (orchestration_task_id);

DROP TRIGGER IF EXISTS trg_conversation_delegations_updated_at ON conversation_delegations;
CREATE TRIGGER trg_conversation_delegations_updated_at
BEFORE UPDATE ON conversation_delegations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION public.ghost_get_default_owner_policy()
RETURNS TABLE(
  owner_agent_key TEXT,
  owner_provider TEXT,
  owner_model TEXT,
  owner_policy_source TEXT
)
LANGUAGE sql
AS $$
  SELECT
    'ghost-main'::text,
    'openai_api'::text,
    'gpt-4.1-mini'::text,
    'explicit_default_owner_policy'::text;
$$;

CREATE OR REPLACE FUNCTION public.ghost_ensure_conversation_owner(
  p_conversation_id UUID
)
RETURNS TABLE(
  conversation_id UUID,
  owner_agent_id UUID,
  owner_agent_key TEXT,
  owner_label TEXT,
  owner_provider TEXT,
  owner_model TEXT,
  owner_locked_at TIMESTAMPTZ,
  owner_was_created BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_default_agent_id UUID;
  v_default_agent_key TEXT;
  v_default_label TEXT;
  v_default_provider TEXT;
  v_default_model TEXT;
  v_owner_policy_source TEXT;
  v_existing_owner_id UUID;
BEGIN
  SELECT
    a.id,
    policy.owner_agent_key,
    a.display_name,
    policy.owner_provider,
    policy.owner_model,
    policy.owner_policy_source
  INTO
    v_default_agent_id,
    v_default_agent_key,
    v_default_label,
    v_default_provider,
    v_default_model,
    v_owner_policy_source
  FROM public.ghost_get_default_owner_policy() AS policy
  JOIN agents a ON a.agent_key = policy.owner_agent_key
  LIMIT 1;

  IF v_default_agent_id IS NULL THEN
    RAISE EXCEPTION 'ghost-main agent is missing';
  END IF;

  SELECT c.owner_agent_id
  INTO v_existing_owner_id
  FROM conversations c
  WHERE c.id = p_conversation_id
  LIMIT 1;

  UPDATE conversations AS c
  SET
    owner_agent_id = COALESCE(c.owner_agent_id, v_default_agent_id),
    owner_provider = COALESCE(NULLIF(c.owner_provider, ''), v_default_provider),
    owner_model = COALESCE(NULLIF(c.owner_model, ''), v_default_model),
    owner_locked_at = COALESCE(c.owner_locked_at, NOW()),
    metadata = c.metadata || jsonb_build_object(
      'owner_pinned', TRUE,
      'owner_kind', 'ghost_main',
      'owner_policy_source', COALESCE(v_owner_policy_source, 'explicit_default_owner_policy')
    )
  WHERE c.id = p_conversation_id;

  RETURN QUERY
  SELECT
    c.id,
    c.owner_agent_id,
    a.agent_key,
    a.display_name,
    c.owner_provider,
    c.owner_model,
    c.owner_locked_at,
    v_existing_owner_id IS NULL
  FROM conversations c
  LEFT JOIN agents a ON a.id = c.owner_agent_id
  WHERE c.id = p_conversation_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghost_resolve_worker_agent(
  p_worker_provider TEXT DEFAULT NULL,
  p_worker_model TEXT DEFAULT NULL
)
RETURNS TABLE(
  worker_agent_id UUID,
  worker_agent_key TEXT,
  worker_agent_label TEXT,
  worker_provider TEXT,
  worker_model TEXT
)
LANGUAGE sql
AS $$
  WITH selection AS (
    SELECT
      CASE
        WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'codex_oauth_worker' THEN 'codex-worker'
        WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'openai_api' THEN 'openai-api-worker'
        WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'ollama' THEN 'ollama-worker'
        ELSE 'codex-worker'
      END AS agent_key,
      COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') AS resolved_provider,
      COALESCE(
        NULLIF(p_worker_model, ''),
        CASE
          WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'codex_oauth_worker' THEN 'gpt-5.4'
          WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'openai_api' THEN 'gpt-4.1-mini'
          WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'ollama' THEN 'qwen3:14b'
          ELSE 'gpt-5.4'
        END
      ) AS resolved_model
  )
  SELECT
    a.id,
    a.agent_key,
    a.display_name,
    selection.resolved_provider,
    selection.resolved_model
  FROM selection
  JOIN agents a ON a.agent_key = selection.agent_key
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.ghost_create_conversation_delegation(
  p_parent_conversation_id UUID,
  p_parent_message_id UUID DEFAULT NULL,
  p_worker_provider TEXT DEFAULT 'codex_oauth_worker',
  p_worker_model TEXT DEFAULT NULL,
  p_request_title TEXT DEFAULT NULL,
  p_request_summary TEXT DEFAULT '',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  delegation_id UUID,
  orchestration_task_id UUID,
  worker_conversation_id UUID,
  worker_agent_id UUID,
  worker_agent_label TEXT,
  worker_provider TEXT,
  worker_model TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_ghost_agent_id UUID;
  v_worker_agent_id UUID;
  v_worker_agent_label TEXT;
  v_resolved_provider TEXT;
  v_resolved_model TEXT;
  v_worker_conversation_id UUID;
  v_orchestration_task_id UUID;
  v_delegation_id UUID;
  v_title TEXT;
BEGIN
  SELECT id
  INTO v_ghost_agent_id
  FROM agents
  WHERE agent_key = 'ghost-main'
  LIMIT 1;

  SELECT
    resolved.worker_agent_id,
    resolved.worker_agent_label,
    resolved.worker_provider,
    resolved.worker_model
  INTO
    v_worker_agent_id,
    v_worker_agent_label,
    v_resolved_provider,
    v_resolved_model
  FROM public.ghost_resolve_worker_agent(p_worker_provider, p_worker_model) AS resolved
  LIMIT 1;

  IF v_ghost_agent_id IS NULL OR v_worker_agent_id IS NULL THEN
    RAISE EXCEPTION 'Delegation requires Ghost main and worker agents to exist';
  END IF;

  v_title := COALESCE(NULLIF(p_request_title, ''), public.ghost_runtime_summarize_prompt(p_request_summary), 'Ghost delegated worker task');

  INSERT INTO conversations (
    owner_user_id,
    owner_agent_id,
    owner_provider,
    owner_model,
    owner_locked_at,
    title,
    source,
    status,
    metadata,
    created_at,
    updated_at,
    last_message_at
  )
  VALUES (
    NULL,
    v_worker_agent_id,
    v_resolved_provider,
    v_resolved_model,
    NOW(),
    v_title,
    'ghost-worker',
    'open',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'parent_conversation_id', p_parent_conversation_id,
      'worker_provider', v_resolved_provider,
      'worker_model', v_resolved_model
    ),
    NOW(),
    NOW(),
    NOW()
  )
  RETURNING id INTO v_worker_conversation_id;

  INSERT INTO orchestration_tasks (
    title,
    description,
    priority_label,
    stage,
    status,
    orchestrator_agent_id,
    runtime_task_id,
    suggested_route,
    suggested_model,
    planning_note
  )
  VALUES (
    v_title,
    COALESCE(NULLIF(p_request_summary, ''), v_title),
    'high',
    'assigned',
    'awaiting_orchestration',
    v_ghost_agent_id,
    NULL,
    v_resolved_provider,
    v_resolved_model,
    'Delegated from conversation ' || p_parent_conversation_id::TEXT
  )
  RETURNING id INTO v_orchestration_task_id;

  INSERT INTO conversation_delegations (
    parent_conversation_id,
    parent_message_id,
    delegating_agent_id,
    worker_agent_id,
    worker_provider,
    worker_model,
    status,
    orchestration_task_id,
    runtime_task_id,
    worker_conversation_id,
    request_summary,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    p_parent_conversation_id,
    p_parent_message_id,
    v_ghost_agent_id,
    v_worker_agent_id,
    v_resolved_provider,
    v_resolved_model,
    'queued',
    v_orchestration_task_id,
    NULL,
    v_worker_conversation_id,
    COALESCE(NULLIF(p_request_summary, ''), v_title),
    COALESCE(p_metadata, '{}'::jsonb),
    NOW(),
    NOW()
  )
  RETURNING id INTO v_delegation_id;

  RETURN QUERY
  SELECT
    v_delegation_id,
    v_orchestration_task_id,
    v_worker_conversation_id,
    v_worker_agent_id,
    v_worker_agent_label,
    v_resolved_provider,
    v_resolved_model;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghost_start_delegation_runtime(
  p_delegation_id UUID,
  p_execution_target TEXT DEFAULT 'delegated_worker_session',
  p_workflow_name TEXT DEFAULT 'GHOST by Codex',
  p_input_payload JSONB DEFAULT '{}'::jsonb,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  task_id UUID,
  task_run_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_delegation conversation_delegations%ROWTYPE;
  v_task_id UUID;
  v_task_run_id UUID;
BEGIN
  SELECT *
  INTO v_delegation
  FROM conversation_delegations
  WHERE id = p_delegation_id
  LIMIT 1;

  IF v_delegation.id IS NULL THEN
    RAISE EXCEPTION 'Delegation % not found', p_delegation_id;
  END IF;

  INSERT INTO tasks (
    parent_task_id,
    conversation_id,
    requested_by_user_id,
    assigned_agent_id,
    title,
    task_type,
    source,
    status,
    priority,
    current_phase,
    input,
    context,
    started_at
  )
  VALUES (
    NULL,
    v_delegation.worker_conversation_id,
    NULL,
    v_delegation.worker_agent_id,
    COALESCE(NULLIF(public.ghost_runtime_summarize_prompt(v_delegation.request_summary), ''), 'Ghost delegated worker task'),
    'delegated_worker_task',
    'ghost_worker_runtime',
    'running',
    70,
    'delegated_worker_execution',
    COALESCE(p_input_payload, '{}'::jsonb),
    COALESCE(p_context, '{}'::jsonb) || jsonb_build_object(
      'delegation_id', v_delegation.id::TEXT,
      'parent_conversation_id', v_delegation.parent_conversation_id::TEXT,
      'worker_provider', v_delegation.worker_provider,
      'worker_model', v_delegation.worker_model,
      'execution_target', COALESCE(NULLIF(p_execution_target, ''), 'delegated_worker_session'),
      'workflow_name', COALESCE(NULLIF(p_workflow_name, ''), 'GHOST by Codex')
    ),
    NOW()
  )
  RETURNING id INTO v_task_id;

  INSERT INTO task_runs (
    task_id,
    run_number,
    execution_target,
    status,
    n8n_workflow_name,
    worker_name,
    input_payload,
    started_at
  )
  VALUES (
    v_task_id,
    1,
    COALESCE(NULLIF(p_execution_target, ''), 'delegated_worker_session'),
    'running',
    COALESCE(NULLIF(p_workflow_name, ''), 'GHOST by Codex'),
    v_delegation.worker_provider,
    COALESCE(p_input_payload, '{}'::jsonb),
    NOW()
  )
  RETURNING id INTO v_task_run_id;

  UPDATE orchestration_tasks
  SET
    runtime_task_id = v_task_id,
    stage = 'in_progress',
    status = 'delegated_running'
  WHERE id = v_delegation.orchestration_task_id;

  UPDATE conversation_delegations
  SET
    runtime_task_id = v_task_id,
    status = 'running',
    started_at = NOW()
  WHERE id = v_delegation.id;

  INSERT INTO tool_events (
    task_id,
    task_run_id,
    agent_id,
    tool_name,
    event_type,
    status,
    payload
  )
  VALUES
    (
      v_task_id,
      v_task_run_id,
      v_delegation.worker_agent_id,
      'ghost-delegation',
      'task_created',
      'ok',
      jsonb_build_object(
        'summary', COALESCE(NULLIF(public.ghost_runtime_summarize_prompt(v_delegation.request_summary), ''), 'Ghost delegated worker task'),
        'delegation_id', v_delegation.id::TEXT,
        'worker_conversation_id', v_delegation.worker_conversation_id::TEXT
      )
    ),
    (
      v_task_id,
      v_task_run_id,
      v_delegation.worker_agent_id,
      'ghost-delegation',
      'delegation_started',
      'ok',
      jsonb_build_object(
        'delegation_id', v_delegation.id::TEXT,
        'orchestration_task_id', v_delegation.orchestration_task_id::TEXT,
        'parent_conversation_id', v_delegation.parent_conversation_id::TEXT
      )
    );

  RETURN QUERY
  SELECT v_task_id, v_task_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghost_finalize_delegation(
  p_delegation_id UUID,
  p_runtime_task_id UUID DEFAULT NULL,
  p_runtime_status TEXT DEFAULT 'running',
  p_result_summary TEXT DEFAULT NULL,
  p_artifact_path TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_delegation conversation_delegations%ROWTYPE;
  v_stage TEXT;
  v_status TEXT;
  v_event_status TEXT;
BEGIN
  SELECT *
  INTO v_delegation
  FROM conversation_delegations
  WHERE id = p_delegation_id
  LIMIT 1;

  IF v_delegation.id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_stage := CASE
    WHEN p_runtime_status = 'succeeded' THEN 'done'
    WHEN p_runtime_status = 'blocked' THEN 'review'
    WHEN p_runtime_status = 'failed' THEN 'review'
    ELSE 'in_progress'
  END;

  v_status := CASE
    WHEN p_runtime_status = 'succeeded' THEN 'delegated_succeeded'
    WHEN p_runtime_status = 'blocked' THEN 'delegated_blocked'
    WHEN p_runtime_status = 'failed' THEN 'delegated_failed'
    ELSE 'delegated_running'
  END;

  v_event_status := CASE
    WHEN p_runtime_status = 'failed' THEN 'error'
    WHEN p_runtime_status = 'blocked' THEN 'warn'
    ELSE 'ok'
  END;

  UPDATE orchestration_tasks
  SET
    runtime_task_id = COALESCE(p_runtime_task_id, runtime_task_id),
    stage = v_stage::text,
    status = v_status::text,
    deliverables_note = COALESCE(NULLIF(p_result_summary, ''), deliverables_note),
    updated_at = NOW()
  WHERE id = v_delegation.orchestration_task_id;

  UPDATE conversation_delegations
  SET
    runtime_task_id = COALESCE(p_runtime_task_id, runtime_task_id),
    status = p_runtime_status,
    result_summary = COALESCE(NULLIF(p_result_summary, ''), result_summary),
    completed_at = CASE
      WHEN p_runtime_status IN ('succeeded', 'failed', 'blocked') THEN NOW()
      ELSE completed_at
    END,
    updated_at = NOW()
  WHERE id = v_delegation.id;

  IF p_runtime_task_id IS NOT NULL THEN
    INSERT INTO tool_events (
      task_id,
      agent_id,
      tool_name,
      event_type,
      status,
      payload
    )
    VALUES (
      p_runtime_task_id,
      v_delegation.worker_agent_id,
      'ghost-delegation',
      'delegation_completed',
      v_event_status,
      jsonb_build_object(
        'delegation_id', v_delegation.id::TEXT,
        'orchestration_task_id', v_delegation.orchestration_task_id::TEXT,
        'status', p_runtime_status,
        'artifact_path', NULLIF(p_artifact_path, ''),
        'result_summary', NULLIF(p_result_summary, '')
      )
    );
  END IF;

  RETURN TRUE;
END;
$$;

COMMIT;
