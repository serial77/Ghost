BEGIN;

-- ─── Extensions ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Utility function ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Core tables (no foreign-key deps) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'owner',
  status       TEXT NOT NULL DEFAULT 'active',
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key    TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  agent_type   TEXT NOT NULL,
  provider     TEXT,
  model_name   TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_health (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL,
  service_kind TEXT NOT NULL,
  status       TEXT NOT NULL,
  message      TEXT,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_prompts (
  name       TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ghost_action_history (
  action_id       TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  entity          TEXT NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  conversation_id TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  delegation_id   TEXT,
  runtime_task_id TEXT,
  approval_id     TEXT,
  artifact_id     TEXT,
  outcome_status  TEXT,
  summary         TEXT NOT NULL,
  source_surface  TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ghost_governed_followthrough (
  followthrough_id         TEXT PRIMARY KEY,
  approval_queue_id        TEXT NOT NULL,
  source_path              TEXT,
  conversation_id          TEXT,
  delegation_id            TEXT,
  orchestration_task_id    TEXT,
  runtime_task_id          TEXT,
  runtime_task_run_id      TEXT,
  n8n_execution_id         TEXT,
  governance_environment   TEXT,
  resolution_state         TEXT NOT NULL,
  outcome_status           TEXT NOT NULL,
  followthrough_type       TEXT NOT NULL,
  execution_state          TEXT NOT NULL,
  close_reason             TEXT,
  executor_label           TEXT NOT NULL,
  requested_capabilities   JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_step_payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at              TIMESTAMPTZ,
  worker_registry_id       TEXT,
  worker_label             TEXT,
  worker_operator_identity TEXT,
  retry_dispatched_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ghost_governed_followthrough_approval_queue_idx
  ON ghost_governed_followthrough (approval_queue_id);

-- ─── Conversations (refs users + agents) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_agent_id  UUID REFERENCES agents(id) ON DELETE SET NULL,
  owner_provider  TEXT,
  owner_model     TEXT,
  owner_locked_at TIMESTAMPTZ,
  title           TEXT,
  source          TEXT NOT NULL DEFAULT 'ghost',
  status          TEXT NOT NULL DEFAULT 'open',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_owner_agent
  ON conversations (owner_agent_id);

-- ─── Messages (refs conversations) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  content_format  TEXT NOT NULL DEFAULT 'text',
  model_name      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at);

-- ─── Tasks (refs tasks[self], conversations, users, agents) ──────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_task_id       UUID REFERENCES tasks(id) ON DELETE SET NULL,
  conversation_id      UUID REFERENCES conversations(id) ON DELETE SET NULL,
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_agent_id    UUID REFERENCES agents(id) ON DELETE SET NULL,
  title                TEXT NOT NULL,
  task_type            TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'ghost',
  status               TEXT NOT NULL DEFAULT 'inbox',
  priority             INTEGER NOT NULL DEFAULT 50,
  current_phase        TEXT,
  input                JSONB NOT NULL DEFAULT '{}'::jsonb,
  context              JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary       TEXT,
  error_summary        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_priority_created
  ON tasks (status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent
  ON tasks (assigned_agent_id);

-- ─── Task runs (refs tasks) ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_number        INTEGER NOT NULL DEFAULT 1,
  execution_target  TEXT,
  status            TEXT NOT NULL DEFAULT 'queued',
  n8n_workflow_name TEXT,
  n8n_execution_id  TEXT,
  worker_name       TEXT,
  input_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_text        TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  duration_ms       BIGINT
);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_started
  ON task_runs (task_id, started_at);

CREATE INDEX IF NOT EXISTS idx_task_runs_n8n_execution
  ON task_runs (n8n_execution_id);

-- ─── Artifacts (refs tasks, conversations, messages) ─────────────────────────

CREATE TABLE IF NOT EXISTS artifacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID REFERENCES tasks(id) ON DELETE SET NULL,
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id        UUID REFERENCES messages(id) ON DELETE SET NULL,
  artifact_type     TEXT NOT NULL,
  title             TEXT,
  storage_provider  TEXT NOT NULL DEFAULT 'local',
  storage_path      TEXT NOT NULL,
  mime_type         TEXT,
  size_bytes        BIGINT,
  checksum_sha256   TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_task
  ON artifacts (task_id);

CREATE INDEX IF NOT EXISTS idx_artifacts_conversation
  ON artifacts (conversation_id);

-- ─── Approvals (refs tasks, agents, users) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS approvals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requested_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  approval_type         TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  prompt_text           TEXT NOT NULL,
  response_text         TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at          TIMESTAMPTZ,
  responded_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_approvals_status_requested
  ON approvals (status, requested_at);

-- ─── Tool events (refs tasks, task_runs, agents) ──────────────────────────────

CREATE TABLE IF NOT EXISTS tool_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
  task_run_id UUID REFERENCES task_runs(id) ON DELETE SET NULL,
  agent_id    UUID REFERENCES agents(id) ON DELETE SET NULL,
  tool_name   TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ok',
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_health_name_checked
  ON service_health (service_name, checked_at);

CREATE INDEX IF NOT EXISTS idx_tool_events_task_created
  ON tool_events (task_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_events_run_created
  ON tool_events (task_run_id, created_at);

-- ─── Ghost memory (refs conversations, task_runs, messages) ──────────────────

CREATE TABLE IF NOT EXISTS ghost_memory (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope             TEXT NOT NULL,
  memory_type       TEXT NOT NULL,
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  task_run_id       UUID REFERENCES task_runs(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  title             TEXT,
  summary           TEXT NOT NULL,
  details_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  importance        SMALLINT NOT NULL DEFAULT 3,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ghost_memory_scope_check
    CHECK (scope IN ('global', 'conversation', 'task')),
  CONSTRAINT ghost_memory_type_check
    CHECK (memory_type IN ('task_summary', 'decision', 'environment_fact', 'operational_note', 'conversation_summary')),
  CONSTRAINT ghost_memory_status_check
    CHECK (status IN ('active', 'superseded', 'archived')),
  CONSTRAINT ghost_memory_importance_check
    CHECK (importance BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_ghost_memory_conversation_created
  ON ghost_memory (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ghost_memory_scope_status_created
  ON ghost_memory (scope, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ghost_memory_type_status_created
  ON ghost_memory (memory_type, status, created_at DESC);

-- ─── Orchestration tasks (refs agents, tasks) ────────────────────────────────

CREATE TABLE IF NOT EXISTS orchestration_tasks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  priority_label       TEXT NOT NULL DEFAULT 'normal',
  stage                TEXT NOT NULL DEFAULT 'assigned',
  status               TEXT NOT NULL DEFAULT 'awaiting_orchestration',
  orchestrator_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  runtime_task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
  suggested_route      TEXT,
  suggested_model      TEXT,
  planning_note        TEXT,
  deliverables_note    TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_stage_updated
  ON orchestration_tasks (stage, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_runtime_task
  ON orchestration_tasks (runtime_task_id);

-- ─── Conversation delegations (refs conversations, messages, agents,
--     orchestration_tasks, tasks) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_delegations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,
  delegating_agent_id    UUID REFERENCES agents(id) ON DELETE SET NULL,
  worker_agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
  worker_provider        TEXT NOT NULL,
  worker_model           TEXT,
  status                 TEXT NOT NULL DEFAULT 'queued',
  orchestration_task_id  UUID REFERENCES orchestration_tasks(id) ON DELETE SET NULL,
  runtime_task_id        UUID REFERENCES tasks(id) ON DELETE SET NULL,
  worker_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  request_summary        TEXT,
  result_summary         TEXT,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at             TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_conversation_delegations_parent_created
  ON conversation_delegations (parent_conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_delegations_orchestration
  ON conversation_delegations (orchestration_task_id);

-- ─── Orchestration task events (refs orchestration_tasks) ────────────────────

CREATE TABLE IF NOT EXISTS orchestration_task_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orchestration_task_id UUID NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
  event_type            TEXT NOT NULL,
  actor_type            TEXT NOT NULL DEFAULT 'operator',
  actor_id              TEXT NOT NULL,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_task_events_task_created
  ON orchestration_task_events (orchestration_task_id, created_at DESC);

-- ─── Triggers ─────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;
CREATE TRIGGER trg_agents_updated_at
BEFORE UPDATE ON agents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ghost_memory_updated_at ON ghost_memory;
CREATE TRIGGER trg_ghost_memory_updated_at
BEFORE UPDATE ON ghost_memory
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_orchestration_tasks_updated_at ON orchestration_tasks;
CREATE TRIGGER trg_orchestration_tasks_updated_at
BEFORE UPDATE ON orchestration_tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_conversation_delegations_updated_at ON conversation_delegations;
CREATE TRIGGER trg_conversation_delegations_updated_at
BEFORE UPDATE ON conversation_delegations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Functions (latest versions as of 007) ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ghost_runtime_summarize_prompt(message TEXT)
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT CASE
    WHEN length(trimmed) > 140 THEN left(trimmed, 137) || '...'
    ELSE trimmed
  END
  FROM (
    SELECT regexp_replace(trim(COALESCE(message, '')), '\s+', ' ', 'g') AS trimmed
  ) normalized;
$$;

CREATE OR REPLACE FUNCTION public.ghost_runtime_start_task_ledger(
  p_conversation_id UUID DEFAULT NULL,
  p_message TEXT DEFAULT '',
  p_entrypoint TEXT DEFAULT 'direct_webhook',
  p_execution_target TEXT DEFAULT 'webhook/ghost-chat-v3',
  p_workflow_name TEXT DEFAULT 'GHOST by Codex',
  p_input_payload JSONB DEFAULT '{}'::jsonb,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(task_id UUID, task_run_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
  v_agent_id UUID;
  v_title TEXT;
  v_task_id UUID;
  v_task_run_id UUID;
  v_n8n_execution_id TEXT;
BEGIN
  SELECT id
  INTO v_agent_id
  FROM agents
  WHERE agent_key = 'ghost-main'
  LIMIT 1;

  v_title := public.ghost_runtime_summarize_prompt(p_message);
  v_n8n_execution_id := NULLIF(COALESCE(p_context ->> 'n8n_execution_id', p_input_payload ->> 'n8n_execution_id', ''), '');

  INSERT INTO tasks (
    conversation_id,
    assigned_agent_id,
    title,
    task_type,
    source,
    status,
    current_phase,
    input,
    context,
    started_at
  )
  VALUES (
    p_conversation_id,
    v_agent_id,
    COALESCE(NULLIF(v_title, ''), 'Ghost runtime request'),
    'ghost_request',
    'ghost_runtime',
    'running',
    'awaiting_runtime_reply',
    COALESCE(p_input_payload, '{}'::jsonb),
    COALESCE(p_context, '{}'::jsonb) || jsonb_build_object(
      'entrypoint', COALESCE(NULLIF(p_entrypoint, ''), 'direct_webhook'),
      'execution_target', COALESCE(NULLIF(p_execution_target, ''), 'webhook/ghost-chat-v3'),
      'workflow_name', COALESCE(NULLIF(p_workflow_name, ''), 'GHOST by Codex'),
      'n8n_execution_id', v_n8n_execution_id
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
    n8n_execution_id,
    worker_name,
    input_payload,
    started_at
  )
  VALUES (
    v_task_id,
    1,
    COALESCE(NULLIF(p_execution_target, ''), 'webhook/ghost-chat-v3'),
    'running',
    COALESCE(NULLIF(p_workflow_name, ''), 'GHOST by Codex'),
    v_n8n_execution_id,
    'ghost-runtime',
    COALESCE(p_input_payload, '{}'::jsonb),
    NOW()
  )
  RETURNING id INTO v_task_run_id;

  INSERT INTO tool_events (
    task_id, task_run_id, agent_id, tool_name, event_type, status, payload
  )
  VALUES
    (
      v_task_id, v_task_run_id, v_agent_id,
      'ghost-runtime', 'task_created', 'ok',
      jsonb_build_object(
        'summary', COALESCE(NULLIF(v_title, ''), 'Ghost runtime request'),
        'conversation_id', p_conversation_id,
        'entrypoint', COALESCE(NULLIF(p_entrypoint, ''), 'direct_webhook'),
        'n8n_execution_id', v_n8n_execution_id
      )
    ),
    (
      v_task_id, v_task_run_id, v_agent_id,
      'ghost-runtime', 'runtime_dispatch_started', 'ok',
      jsonb_build_object(
        'target_webhook', COALESCE(NULLIF(p_execution_target, ''), 'webhook/ghost-chat-v3'),
        'detail', 'Entrypoint: ' || COALESCE(NULLIF(p_entrypoint, ''), 'direct_webhook'),
        'n8n_execution_id', v_n8n_execution_id
      )
    );

  RETURN QUERY SELECT v_task_id, v_task_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghost_runtime_complete_task_ledger(
  p_task_id UUID DEFAULT NULL,
  p_task_run_id UUID DEFAULT NULL,
  p_response_status INTEGER DEFAULT 200,
  p_output_payload JSONB DEFAULT '{}'::jsonb,
  p_conversation_id UUID DEFAULT NULL,
  p_task_class TEXT DEFAULT NULL,
  p_provider_used TEXT DEFAULT NULL,
  p_model_used TEXT DEFAULT NULL,
  p_approval_required BOOLEAN DEFAULT FALSE,
  p_command_success BOOLEAN DEFAULT NULL,
  p_error_type TEXT DEFAULT NULL,
  p_task_summary TEXT DEFAULT NULL,
  p_artifact_path TEXT DEFAULT NULL,
  p_entrypoint TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
  v_event_status TEXT;
  v_started_at TIMESTAMPTZ;
  v_duration_ms BIGINT;
  v_result_summary TEXT;
  v_error_summary TEXT;
  v_n8n_execution_id TEXT;
  v_command_exit_code TEXT;
BEGIN
  IF p_task_id IS NULL OR p_task_run_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF COALESCE(p_approval_required, FALSE) THEN
    v_status := 'blocked';
  ELSIF p_response_status >= 400 OR p_command_success IS FALSE OR NULLIF(COALESCE(p_error_type, ''), '') IS NOT NULL THEN
    v_status := 'failed';
  ELSE
    v_status := 'succeeded';
  END IF;

  v_event_status := CASE
    WHEN v_status = 'failed' THEN 'error'
    WHEN v_status = 'blocked' THEN 'warn'
    ELSE 'ok'
  END;

  SELECT started_at INTO v_started_at FROM task_runs WHERE id = p_task_run_id;

  v_duration_ms := GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(v_started_at, NOW()))) * 1000)::BIGINT
  );

  v_result_summary := NULLIF(
    BTRIM(COALESCE(NULLIF(p_output_payload ->> 'reply', ''), NULLIF(COALESCE(p_task_summary, ''), ''))),
    ''
  );
  v_n8n_execution_id := NULLIF(COALESCE(p_output_payload ->> 'n8n_execution_id', p_output_payload ->> 'parent_n8n_execution_id', ''), '');
  v_command_exit_code := NULLIF(COALESCE(p_output_payload ->> 'command_exit_code', ''), '');

  v_error_summary := CASE
    WHEN v_status = 'failed' THEN COALESCE(
      NULLIF(
        BTRIM(CONCAT_WS(
          ' · ',
          NULLIF(p_error_type, ''),
          NULLIF(p_output_payload ->> 'stderr_summary', ''),
          CASE WHEN v_command_exit_code IS NOT NULL THEN 'exit ' || v_command_exit_code ELSE NULL END,
          CASE WHEN p_response_status >= 400 THEN 'HTTP ' || p_response_status::TEXT ELSE NULL END
        )),
        ''
      ),
      'Ghost runtime reported a failed task.'
    )
    ELSE NULL
  END;

  UPDATE task_runs
  SET
    status           = v_status,
    worker_name      = COALESCE(NULLIF(p_provider_used, ''), 'ghost-runtime'),
    n8n_execution_id = COALESCE(task_runs.n8n_execution_id, v_n8n_execution_id),
    output_payload   = COALESCE(p_output_payload, '{}'::jsonb),
    error_text       = v_error_summary,
    finished_at      = NOW(),
    duration_ms      = v_duration_ms
  WHERE id = p_task_run_id AND task_id = p_task_id;

  UPDATE tasks
  SET
    conversation_id = COALESCE(p_conversation_id, conversation_id),
    status          = v_status,
    current_phase   = CASE
      WHEN v_status = 'blocked' THEN 'approval_required'
      WHEN v_status = 'failed'  THEN 'failed'
      ELSE 'completed'
    END,
    context = context || jsonb_build_object(
      'task_class',             NULLIF(p_task_class, ''),
      'provider_used',          NULLIF(p_provider_used, ''),
      'model_used',             NULLIF(p_model_used, ''),
      'approval_required',      COALESCE(p_approval_required, FALSE),
      'artifact_path',          NULLIF(p_artifact_path, ''),
      'entrypoint',             COALESCE(NULLIF(p_entrypoint, ''), context ->> 'entrypoint'),
      'latest_run_id',          p_task_run_id::TEXT,
      'n8n_execution_id',       v_n8n_execution_id,
      'delegation_id',          NULLIF(p_output_payload ->> 'delegation_id', ''),
      'orchestration_task_id',  NULLIF(p_output_payload ->> 'orchestration_task_id', ''),
      'runtime_task_id',        NULLIF(p_output_payload ->> 'runtime_task_id', ''),
      'worker_conversation_id', NULLIF(p_output_payload ->> 'worker_conversation_id', ''),
      'response_mode',          NULLIF(p_output_payload ->> 'response_mode', ''),
      'parent_owner_label',     NULLIF(p_output_payload ->> 'parent_owner_label', '')
    ),
    result_summary = v_result_summary,
    error_summary  = v_error_summary,
    updated_at     = NOW(),
    completed_at   = CASE
      WHEN v_status IN ('succeeded', 'failed', 'blocked') THEN NOW()
      ELSE completed_at
    END
  WHERE id = p_task_id;

  INSERT INTO tool_events (task_id, task_run_id, tool_name, event_type, status, payload)
  VALUES
    (
      p_task_id, p_task_run_id,
      'ghost-runtime', 'runtime_dispatch_completed', v_event_status,
      jsonb_build_object(
        'response_status',  p_response_status,
        'provider_used',    NULLIF(p_provider_used, ''),
        'task_class',       NULLIF(p_task_class, ''),
        'detail',           'Entrypoint: ' || COALESCE(NULLIF(p_entrypoint, ''), 'unknown'),
        'n8n_execution_id', v_n8n_execution_id,
        'response_mode',    NULLIF(p_output_payload ->> 'response_mode', ''),
        'delegation_id',    NULLIF(p_output_payload ->> 'delegation_id', '')
      )
    ),
    (
      p_task_id, p_task_run_id,
      'ghost-ledger', 'assistant_reply_recorded', v_event_status,
      jsonb_build_object(
        'conversation_id',  p_conversation_id,
        'summary',          COALESCE(v_result_summary, v_error_summary, 'No assistant summary recorded.'),
        'n8n_execution_id', v_n8n_execution_id
      )
    );

  IF COALESCE(p_approval_required, FALSE) THEN
    INSERT INTO tool_events (task_id, task_run_id, tool_name, event_type, status, payload)
    VALUES (
      p_task_id, p_task_run_id,
      'ghost-ledger', 'approval_required', 'warn',
      jsonb_build_object(
        'detail',           'Ghost runtime reported approval_required=true',
        'n8n_execution_id', v_n8n_execution_id
      )
    );
  END IF;

  IF NULLIF(COALESCE(p_artifact_path, ''), '') IS NOT NULL THEN
    INSERT INTO tool_events (task_id, task_run_id, tool_name, event_type, status, payload)
    VALUES (
      p_task_id, p_task_run_id,
      'ghost-ledger', 'artifact_recorded', 'ok',
      jsonb_build_object(
        'artifact_path',    p_artifact_path,
        'n8n_execution_id', v_n8n_execution_id
      )
    );
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghost_get_default_owner_policy()
RETURNS TABLE(
  owner_agent_key    TEXT,
  owner_provider     TEXT,
  owner_model        TEXT,
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
  conversation_id  UUID,
  owner_agent_id   UUID,
  owner_agent_key  TEXT,
  owner_label      TEXT,
  owner_provider   TEXT,
  owner_model      TEXT,
  owner_locked_at  TIMESTAMPTZ,
  owner_was_created BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_default_agent_id    UUID;
  v_default_agent_key   TEXT;
  v_default_label       TEXT;
  v_default_provider    TEXT;
  v_default_model       TEXT;
  v_owner_policy_source TEXT;
  v_existing_owner_id   UUID;
BEGIN
  SELECT
    a.id, policy.owner_agent_key, a.display_name,
    policy.owner_provider, policy.owner_model, policy.owner_policy_source
  INTO
    v_default_agent_id, v_default_agent_key, v_default_label,
    v_default_provider, v_default_model, v_owner_policy_source
  FROM public.ghost_get_default_owner_policy() AS policy
  JOIN agents a ON a.agent_key = policy.owner_agent_key
  LIMIT 1;

  IF v_default_agent_id IS NULL THEN
    RAISE EXCEPTION 'ghost-main agent is missing';
  END IF;

  SELECT c.owner_agent_id INTO v_existing_owner_id
  FROM conversations c WHERE c.id = p_conversation_id LIMIT 1;

  UPDATE conversations AS c
  SET
    owner_agent_id  = COALESCE(c.owner_agent_id, v_default_agent_id),
    owner_provider  = COALESCE(NULLIF(c.owner_provider, ''), v_default_provider),
    owner_model     = COALESCE(NULLIF(c.owner_model, ''), v_default_model),
    owner_locked_at = COALESCE(c.owner_locked_at, NOW()),
    metadata        = c.metadata || jsonb_build_object(
      'owner_pinned',       TRUE,
      'owner_kind',         'ghost_main',
      'owner_policy_source', COALESCE(v_owner_policy_source, 'explicit_default_owner_policy')
    )
  WHERE c.id = p_conversation_id;

  RETURN QUERY
  SELECT c.id, c.owner_agent_id, a.agent_key, a.display_name,
         c.owner_provider, c.owner_model, c.owner_locked_at,
         v_existing_owner_id IS NULL
  FROM conversations c
  LEFT JOIN agents a ON a.id = c.owner_agent_id
  WHERE c.id = p_conversation_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghost_resolve_worker_agent(
  p_worker_provider TEXT DEFAULT NULL,
  p_worker_model    TEXT DEFAULT NULL
)
RETURNS TABLE(
  worker_agent_id    UUID,
  worker_agent_key   TEXT,
  worker_agent_label TEXT,
  worker_provider    TEXT,
  worker_model       TEXT
)
LANGUAGE sql
AS $$
  WITH selection AS (
    SELECT
      CASE
        WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'codex_oauth_worker' THEN 'codex-worker'
        WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'openai_api'         THEN 'openai-api-worker'
        WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'ollama'              THEN 'ollama-worker'
        ELSE 'codex-worker'
      END AS agent_key,
      COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') AS resolved_provider,
      COALESCE(
        NULLIF(p_worker_model, ''),
        CASE
          WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'codex_oauth_worker' THEN 'gpt-5.4'
          WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'openai_api'         THEN 'gpt-4.1-mini'
          WHEN COALESCE(NULLIF(p_worker_provider, ''), 'codex_oauth_worker') = 'ollama'             THEN 'qwen3:14b'
          ELSE 'gpt-5.4'
        END
      ) AS resolved_model
  )
  SELECT a.id, a.agent_key, a.display_name,
         selection.resolved_provider, selection.resolved_model
  FROM selection
  JOIN agents a ON a.agent_key = selection.agent_key
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.ghost_create_conversation_delegation(
  p_parent_conversation_id UUID,
  p_parent_message_id      UUID DEFAULT NULL,
  p_worker_provider        TEXT DEFAULT 'codex_oauth_worker',
  p_worker_model           TEXT DEFAULT NULL,
  p_request_title          TEXT DEFAULT NULL,
  p_request_summary        TEXT DEFAULT '',
  p_metadata               JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  delegation_id          UUID,
  orchestration_task_id  UUID,
  worker_conversation_id UUID,
  worker_agent_id        UUID,
  worker_agent_label     TEXT,
  worker_provider        TEXT,
  worker_model           TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_ghost_agent_id         UUID;
  v_worker_agent_id        UUID;
  v_worker_agent_label     TEXT;
  v_resolved_provider      TEXT;
  v_resolved_model         TEXT;
  v_worker_conversation_id UUID;
  v_orchestration_task_id  UUID;
  v_delegation_id          UUID;
  v_title                  TEXT;
BEGIN
  SELECT id INTO v_ghost_agent_id FROM agents WHERE agent_key = 'ghost-main' LIMIT 1;

  SELECT resolved.worker_agent_id, resolved.worker_agent_label, resolved.worker_provider, resolved.worker_model
  INTO v_worker_agent_id, v_worker_agent_label, v_resolved_provider, v_resolved_model
  FROM public.ghost_resolve_worker_agent(p_worker_provider, p_worker_model) AS resolved LIMIT 1;

  IF v_ghost_agent_id IS NULL OR v_worker_agent_id IS NULL THEN
    RAISE EXCEPTION 'Delegation requires Ghost main and worker agents to exist';
  END IF;

  v_title := COALESCE(NULLIF(p_request_title, ''), public.ghost_runtime_summarize_prompt(p_request_summary), 'Ghost delegated worker task');

  INSERT INTO conversations (
    owner_user_id, owner_agent_id, owner_provider, owner_model, owner_locked_at,
    title, source, status, metadata, created_at, updated_at, last_message_at
  )
  VALUES (
    NULL, v_worker_agent_id, v_resolved_provider, v_resolved_model, NOW(),
    v_title, 'ghost-worker', 'open',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'parent_conversation_id', p_parent_conversation_id,
      'worker_provider',        v_resolved_provider,
      'worker_model',           v_resolved_model
    ),
    NOW(), NOW(), NOW()
  )
  RETURNING id INTO v_worker_conversation_id;

  INSERT INTO orchestration_tasks (
    title, description, priority_label, stage, status,
    orchestrator_agent_id, runtime_task_id, suggested_route, suggested_model, planning_note
  )
  VALUES (
    v_title, COALESCE(NULLIF(p_request_summary, ''), v_title),
    'high', 'assigned', 'awaiting_orchestration',
    v_ghost_agent_id, NULL, v_resolved_provider, v_resolved_model,
    'Delegated from conversation ' || p_parent_conversation_id::TEXT
  )
  RETURNING id INTO v_orchestration_task_id;

  INSERT INTO conversation_delegations (
    parent_conversation_id, parent_message_id, delegating_agent_id, worker_agent_id,
    worker_provider, worker_model, status, orchestration_task_id, runtime_task_id,
    worker_conversation_id, request_summary, metadata, created_at, updated_at
  )
  VALUES (
    p_parent_conversation_id, p_parent_message_id, v_ghost_agent_id, v_worker_agent_id,
    v_resolved_provider, v_resolved_model, 'queued', v_orchestration_task_id, NULL,
    v_worker_conversation_id, COALESCE(NULLIF(p_request_summary, ''), v_title),
    COALESCE(p_metadata, '{}'::jsonb), NOW(), NOW()
  )
  RETURNING id INTO v_delegation_id;

  RETURN QUERY SELECT v_delegation_id, v_orchestration_task_id, v_worker_conversation_id,
                      v_worker_agent_id, v_worker_agent_label, v_resolved_provider, v_resolved_model;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghost_start_delegation_runtime(
  p_delegation_id    UUID,
  p_execution_target TEXT DEFAULT 'delegated_worker_session',
  p_workflow_name    TEXT DEFAULT 'GHOST by Codex',
  p_input_payload    JSONB DEFAULT '{}'::jsonb,
  p_context          JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(task_id UUID, task_run_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
  v_delegation       conversation_delegations%ROWTYPE;
  v_task_id          UUID;
  v_task_run_id      UUID;
  v_n8n_execution_id TEXT;
BEGIN
  SELECT * INTO v_delegation FROM conversation_delegations WHERE id = p_delegation_id LIMIT 1;

  IF v_delegation.id IS NULL THEN
    RAISE EXCEPTION 'Delegation % not found', p_delegation_id;
  END IF;

  v_n8n_execution_id := NULLIF(COALESCE(p_context ->> 'n8n_execution_id', p_input_payload ->> 'n8n_execution_id', ''), '');

  INSERT INTO tasks (
    parent_task_id, conversation_id, requested_by_user_id, assigned_agent_id,
    title, task_type, source, status, priority, current_phase, input, context, started_at
  )
  VALUES (
    NULL, v_delegation.worker_conversation_id, NULL, v_delegation.worker_agent_id,
    COALESCE(NULLIF(public.ghost_runtime_summarize_prompt(v_delegation.request_summary), ''), 'Ghost delegated worker task'),
    'delegated_worker_task', 'ghost_worker_runtime', 'running', 70, 'delegated_worker_execution',
    COALESCE(p_input_payload, '{}'::jsonb),
    COALESCE(p_context, '{}'::jsonb) || jsonb_build_object(
      'delegation_id',          v_delegation.id::TEXT,
      'parent_conversation_id', v_delegation.parent_conversation_id::TEXT,
      'worker_provider',        v_delegation.worker_provider,
      'worker_model',           v_delegation.worker_model,
      'execution_target',       COALESCE(NULLIF(p_execution_target, ''), 'delegated_worker_session'),
      'workflow_name',          COALESCE(NULLIF(p_workflow_name, ''), 'GHOST by Codex'),
      'n8n_execution_id',       v_n8n_execution_id
    ),
    NOW()
  )
  RETURNING id INTO v_task_id;

  INSERT INTO task_runs (
    task_id, run_number, execution_target, status, n8n_workflow_name, n8n_execution_id,
    worker_name, input_payload, started_at
  )
  VALUES (
    v_task_id, 1,
    COALESCE(NULLIF(p_execution_target, ''), 'delegated_worker_session'),
    'running',
    COALESCE(NULLIF(p_workflow_name, ''), 'GHOST by Codex'),
    v_n8n_execution_id,
    v_delegation.worker_provider,
    COALESCE(p_input_payload, '{}'::jsonb),
    NOW()
  )
  RETURNING id INTO v_task_run_id;

  UPDATE orchestration_tasks
  SET runtime_task_id = v_task_id, stage = 'in_progress', status = 'delegated_running'
  WHERE id = v_delegation.orchestration_task_id;

  UPDATE conversation_delegations
  SET runtime_task_id = v_task_id, status = 'running', started_at = NOW()
  WHERE id = v_delegation.id;

  INSERT INTO tool_events (task_id, task_run_id, agent_id, tool_name, event_type, status, payload)
  VALUES
    (
      v_task_id, v_task_run_id, v_delegation.worker_agent_id,
      'ghost-delegation', 'task_created', 'ok',
      jsonb_build_object(
        'summary',                 COALESCE(NULLIF(public.ghost_runtime_summarize_prompt(v_delegation.request_summary), ''), 'Ghost delegated worker task'),
        'delegation_id',           v_delegation.id::TEXT,
        'worker_conversation_id',  v_delegation.worker_conversation_id::TEXT,
        'n8n_execution_id',        v_n8n_execution_id
      )
    ),
    (
      v_task_id, v_task_run_id, v_delegation.worker_agent_id,
      'ghost-delegation', 'delegation_started', 'ok',
      jsonb_build_object(
        'delegation_id',          v_delegation.id::TEXT,
        'orchestration_task_id',  v_delegation.orchestration_task_id::TEXT,
        'parent_conversation_id', v_delegation.parent_conversation_id::TEXT,
        'n8n_execution_id',       v_n8n_execution_id
      )
    );

  RETURN QUERY SELECT v_task_id, v_task_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ghost_finalize_delegation(
  p_delegation_id   UUID,
  p_runtime_task_id UUID DEFAULT NULL,
  p_runtime_status  TEXT DEFAULT 'running',
  p_result_summary  TEXT DEFAULT NULL,
  p_artifact_path   TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_delegation   conversation_delegations%ROWTYPE;
  v_stage        TEXT;
  v_status       TEXT;
  v_event_status TEXT;
BEGIN
  SELECT * INTO v_delegation FROM conversation_delegations WHERE id = p_delegation_id LIMIT 1;

  IF v_delegation.id IS NULL THEN RETURN FALSE; END IF;

  v_stage := CASE
    WHEN p_runtime_status = 'succeeded' THEN 'done'
    WHEN p_runtime_status IN ('blocked', 'failed') THEN 'review'
    ELSE 'in_progress'
  END;

  v_status := CASE
    WHEN p_runtime_status = 'succeeded' THEN 'delegated_succeeded'
    WHEN p_runtime_status = 'blocked'   THEN 'delegated_blocked'
    WHEN p_runtime_status = 'failed'    THEN 'delegated_failed'
    ELSE 'delegated_running'
  END;

  v_event_status := CASE
    WHEN p_runtime_status = 'failed'  THEN 'error'
    WHEN p_runtime_status = 'blocked' THEN 'warn'
    ELSE 'ok'
  END;

  UPDATE orchestration_tasks
  SET
    runtime_task_id  = COALESCE(p_runtime_task_id, runtime_task_id),
    stage            = v_stage,
    status           = v_status,
    deliverables_note = COALESCE(NULLIF(p_result_summary, ''), deliverables_note),
    updated_at       = NOW()
  WHERE id = v_delegation.orchestration_task_id;

  UPDATE conversation_delegations
  SET
    runtime_task_id  = COALESCE(p_runtime_task_id, runtime_task_id),
    status           = p_runtime_status,
    result_summary   = COALESCE(NULLIF(p_result_summary, ''), result_summary),
    completed_at     = CASE
      WHEN p_runtime_status IN ('succeeded', 'failed', 'blocked') THEN NOW()
      ELSE completed_at
    END,
    updated_at = NOW()
  WHERE id = v_delegation.id;

  IF p_runtime_task_id IS NOT NULL THEN
    INSERT INTO tool_events (task_id, agent_id, tool_name, event_type, status, payload)
    VALUES (
      p_runtime_task_id, v_delegation.worker_agent_id,
      'ghost-delegation', 'delegation_completed', v_event_status,
      jsonb_build_object(
        'delegation_id',         v_delegation.id::TEXT,
        'orchestration_task_id', v_delegation.orchestration_task_id::TEXT,
        'status',                p_runtime_status,
        'artifact_path',         NULLIF(p_artifact_path, ''),
        'result_summary',        NULLIF(p_result_summary, '')
      )
    );
  END IF;

  RETURN TRUE;
END;
$$;

-- ─── Agent seed data ──────────────────────────────────────────────────────────

INSERT INTO agents (agent_key, display_name, agent_type, provider, model_name, status, capabilities, config, metadata)
VALUES
  (
    'ghost-main', 'Ghost', 'orchestrator', 'hybrid', 'qwen3:14b', 'active',
    '{"chat": true, "planning": true, "routing": true}'::jsonb, '{}'::jsonb, '{}'::jsonb
  ),
  (
    'codex-worker', 'Codex Worker', 'worker', 'codex_oauth_worker', 'gpt-5.4', 'active',
    '{"technical_work": true, "delegated": true}'::jsonb, '{}'::jsonb,
    '{"source":"001_initial_schema"}'::jsonb
  ),
  (
    'openai-api-worker', 'OpenAI API', 'worker', 'openai_api', 'gpt-4.1-mini', 'active',
    '{"delegated": true}'::jsonb, '{}'::jsonb,
    '{"source":"001_initial_schema"}'::jsonb
  ),
  (
    'ollama-worker', 'Ollama', 'worker', 'ollama', 'qwen3:14b', 'active',
    '{"delegated": true}'::jsonb, '{}'::jsonb,
    '{"source":"001_initial_schema"}'::jsonb
  )
ON CONFLICT (agent_key) DO NOTHING;

COMMIT;
