BEGIN;

CREATE TABLE IF NOT EXISTS ghost_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  task_run_id UUID REFERENCES task_runs(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  title TEXT,
  summary TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  importance SMALLINT NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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

DROP TRIGGER IF EXISTS trg_ghost_memory_updated_at ON ghost_memory;
CREATE TRIGGER trg_ghost_memory_updated_at
BEFORE UPDATE ON ghost_memory
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
