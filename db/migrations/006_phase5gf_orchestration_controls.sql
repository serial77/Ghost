BEGIN;

CREATE TABLE IF NOT EXISTS orchestration_task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orchestration_task_id UUID NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'operator',
  actor_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_task_events_task_created
  ON orchestration_task_events (orchestration_task_id, created_at DESC);

COMMIT;
