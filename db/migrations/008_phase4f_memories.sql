BEGIN;

-- Phase 4F: structured memories table for the Extract→Consolidate→Store pipeline.
-- Separate from ghost_memory (Phase 4A) which is preserved unchanged.
-- 15 columns: 14 structural + embedding added conditionally for pgvector readiness.

CREATE TABLE IF NOT EXISTS memories (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  scope             TEXT         NOT NULL,
  memory_type       TEXT         NOT NULL,
  topic_key         TEXT         NULL,
  title             TEXT         NULL,
  summary           TEXT         NOT NULL,
  details_json      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  importance        SMALLINT     NOT NULL DEFAULT 3,
  status            TEXT         NOT NULL DEFAULT 'active',
  conversation_id   UUID         NULL REFERENCES conversations(id) ON DELETE SET NULL,
  source_message_id UUID         NULL REFERENCES messages(id) ON DELETE SET NULL,
  task_run_id       UUID         NULL REFERENCES task_runs(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT memories_scope_check
    CHECK (scope IN ('global', 'conversation', 'task')),
  CONSTRAINT memories_type_check
    CHECK (memory_type IN (
      'task_summary', 'decision', 'environment_fact',
      'operational_note', 'conversation_summary'
    )),
  CONSTRAINT memories_status_check
    CHECK (status IN ('active', 'superseded', 'archived')),
  CONSTRAINT memories_importance_check
    CHECK (importance BETWEEN 1 AND 5)
);

-- 15th column: embedding — pgvector-prepared, nullable.
-- Added as vector(1536) when pgvector extension is present, otherwise as TEXT NULL.
-- To activate after installing pgvector:
--   ALTER TABLE memories ALTER COLUMN embedding TYPE vector(1536) USING NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'embedding'
  ) THEN
    IF EXISTS (SELECT FROM pg_extension WHERE extname = 'vector') THEN
      EXECUTE 'ALTER TABLE memories ADD COLUMN embedding vector(1536) NULL';
    ELSE
      EXECUTE 'ALTER TABLE memories ADD COLUMN embedding TEXT NULL';
      EXECUTE $comment$
        COMMENT ON COLUMN memories.embedding IS
          'pgvector-prepared: install pgvector extension and ALTER TYPE to vector(1536) when ready'
      $comment$;
    END IF;
  END IF;
END $$;

-- Index 1: conversation timeline (primary recall path)
CREATE INDEX IF NOT EXISTS idx_memories_conversation_created
  ON memories (conversation_id, created_at DESC);

-- Index 2: scope/status/type filtering (retrieval by category)
CREATE INDEX IF NOT EXISTS idx_memories_scope_status_type
  ON memories (scope, status, memory_type);

-- Index 3: topic deduplication lookups
CREATE INDEX IF NOT EXISTS idx_memories_topic_key
  ON memories (topic_key)
  WHERE topic_key IS NOT NULL;

-- Index 4: active high-importance recall (operator/worker surfaces)
CREATE INDEX IF NOT EXISTS idx_memories_active_importance
  ON memories (memory_type, importance DESC)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_memories_updated_at ON memories;
CREATE TRIGGER trg_memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;
