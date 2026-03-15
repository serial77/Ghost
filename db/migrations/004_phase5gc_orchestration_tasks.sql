CREATE TABLE IF NOT EXISTS orchestration_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority_label TEXT NOT NULL DEFAULT 'normal',
  stage TEXT NOT NULL DEFAULT 'assigned',
  status TEXT NOT NULL DEFAULT 'awaiting_orchestration',
  orchestrator_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  runtime_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  suggested_route TEXT,
  suggested_model TEXT,
  planning_note TEXT,
  deliverables_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_stage_updated
  ON orchestration_tasks (stage, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_runtime_task
  ON orchestration_tasks (runtime_task_id);

DROP TRIGGER IF EXISTS trg_orchestration_tasks_updated_at ON orchestration_tasks;
CREATE TRIGGER trg_orchestration_tasks_updated_at
BEFORE UPDATE ON orchestration_tasks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
