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
BEGIN
  SELECT id
  INTO v_agent_id
  FROM agents
  WHERE agent_key = 'ghost-main'
  LIMIT 1;

  v_title := public.ghost_runtime_summarize_prompt(p_message);

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
    NULL,
    'ghost-runtime',
    COALESCE(p_input_payload, '{}'::jsonb),
    NOW()
  )
  RETURNING id INTO v_task_run_id;

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
      v_agent_id,
      'ghost-runtime',
      'task_created',
      'ok',
      jsonb_build_object(
        'summary', COALESCE(NULLIF(v_title, ''), 'Ghost runtime request'),
        'conversation_id', p_conversation_id,
        'entrypoint', COALESCE(NULLIF(p_entrypoint, ''), 'direct_webhook')
      )
    ),
    (
      v_task_id,
      v_task_run_id,
      v_agent_id,
      'ghost-runtime',
      'runtime_dispatch_started',
      'ok',
      jsonb_build_object(
        'target_webhook', COALESCE(NULLIF(p_execution_target, ''), 'webhook/ghost-chat-v3'),
        'detail', 'Entrypoint: ' || COALESCE(NULLIF(p_entrypoint, ''), 'direct_webhook')
      )
    );

  RETURN QUERY
  SELECT v_task_id, v_task_run_id;
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

  SELECT started_at
  INTO v_started_at
  FROM task_runs
  WHERE id = p_task_run_id;

  v_duration_ms := GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(v_started_at, NOW()))) * 1000)::BIGINT
  );

  v_result_summary := NULLIF(
    BTRIM(
      COALESCE(NULLIF(p_output_payload ->> 'reply', ''), NULLIF(COALESCE(p_task_summary, ''), ''))
    ),
    ''
  );

  v_error_summary := CASE
    WHEN v_status = 'failed' THEN COALESCE(
      NULLIF(p_error_type, ''),
      NULLIF(p_output_payload ->> 'stderr_summary', ''),
      CASE WHEN p_response_status >= 400 THEN 'HTTP ' || p_response_status::TEXT ELSE NULL END,
      'Ghost runtime reported a failed task.'
    )
    ELSE NULL
  END;

  UPDATE task_runs
  SET
    status = v_status,
    worker_name = COALESCE(NULLIF(p_provider_used, ''), 'ghost-runtime'),
    output_payload = COALESCE(p_output_payload, '{}'::jsonb),
    error_text = v_error_summary,
    finished_at = NOW(),
    duration_ms = v_duration_ms
  WHERE id = p_task_run_id
    AND task_id = p_task_id;

  UPDATE tasks
  SET
    conversation_id = COALESCE(p_conversation_id, conversation_id),
    status = v_status,
    current_phase = CASE
      WHEN v_status = 'blocked' THEN 'approval_required'
      WHEN v_status = 'failed' THEN 'failed'
      ELSE 'completed'
    END,
    context = context || jsonb_build_object(
      'task_class', NULLIF(p_task_class, ''),
      'provider_used', NULLIF(p_provider_used, ''),
      'model_used', NULLIF(p_model_used, ''),
      'approval_required', COALESCE(p_approval_required, FALSE),
      'artifact_path', NULLIF(p_artifact_path, ''),
      'entrypoint', COALESCE(NULLIF(p_entrypoint, ''), context ->> 'entrypoint'),
      'latest_run_id', p_task_run_id::TEXT
    ),
    result_summary = v_result_summary,
    error_summary = v_error_summary,
    updated_at = NOW(),
    completed_at = CASE
      WHEN v_status IN ('succeeded', 'failed', 'blocked') THEN NOW()
      ELSE completed_at
    END
  WHERE id = p_task_id;

  INSERT INTO tool_events (
    task_id,
    task_run_id,
    tool_name,
    event_type,
    status,
    payload
  )
  VALUES
    (
      p_task_id,
      p_task_run_id,
      'ghost-runtime',
      'runtime_dispatch_completed',
      v_event_status,
      jsonb_build_object(
        'response_status', p_response_status,
        'provider_used', NULLIF(p_provider_used, ''),
        'task_class', NULLIF(p_task_class, ''),
        'detail', 'Entrypoint: ' || COALESCE(NULLIF(p_entrypoint, ''), 'unknown')
      )
    ),
    (
      p_task_id,
      p_task_run_id,
      'ghost-ledger',
      'assistant_reply_recorded',
      v_event_status,
      jsonb_build_object(
        'conversation_id', p_conversation_id,
        'summary', COALESCE(v_result_summary, v_error_summary, 'No assistant summary recorded.')
      )
    );

  IF COALESCE(p_approval_required, FALSE) THEN
    INSERT INTO tool_events (
      task_id,
      task_run_id,
      tool_name,
      event_type,
      status,
      payload
    )
    VALUES (
      p_task_id,
      p_task_run_id,
      'ghost-ledger',
      'approval_required',
      'warn',
      jsonb_build_object(
        'detail', 'Ghost runtime reported approval_required=true'
      )
    );
  END IF;

  IF NULLIF(COALESCE(p_artifact_path, ''), '') IS NOT NULL THEN
    INSERT INTO tool_events (
      task_id,
      task_run_id,
      tool_name,
      event_type,
      status,
      payload
    )
    VALUES (
      p_task_id,
      p_task_run_id,
      'ghost-ledger',
      'artifact_recorded',
      'ok',
      jsonb_build_object(
        'artifact_path', p_artifact_path
      )
    );
  END IF;

  RETURN TRUE;
END;
$$;
