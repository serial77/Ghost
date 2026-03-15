BEGIN;

-- Phase 4F: approved store-side long-term memory table for the
-- Extract→Consolidate→Store structured pipeline.
-- Separate from ghost_memory (Phase 4A) which is preserved unchanged.
--
-- Columns (15 structural + embedding conditional = 16 total):
--   memory_id, user_id, conversation_id, memory_tier, content, category,
--   confidence, status, superseded_by, supersedes, source_type,
--   source_message, created_at, updated_at, last_accessed
--   + embedding (pgvector-prepared, conditional)

CREATE TABLE IF NOT EXISTS memories (
  memory_id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID          NULL,
  -- user_id is schema-prepared for multi-user; no FK enforced until p7i activation.
  -- Future: REFERENCES users(id) ON DELETE SET NULL

  conversation_id   UUID          NULL REFERENCES conversations(id) ON DELETE SET NULL,
  memory_tier       TEXT          NOT NULL DEFAULT 'working',
  content           TEXT          NOT NULL,
  category          TEXT          NOT NULL,
  confidence        NUMERIC(3,2)  NOT NULL DEFAULT 0.60,
  status            TEXT          NOT NULL DEFAULT 'active',
  superseded_by     UUID          NULL REFERENCES memories(memory_id) ON DELETE SET NULL,
  supersedes        UUID          NULL REFERENCES memories(memory_id) ON DELETE SET NULL,
  source_type       TEXT          NOT NULL DEFAULT 'llm_extraction',
  source_message    TEXT          NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_accessed     TIMESTAMPTZ   NULL,

  CONSTRAINT memories_tier_check
    CHECK (memory_tier IN ('working', 'long_term', 'semantic')),
  CONSTRAINT memories_category_check
    CHECK (category IN (
      'task_summary', 'decision', 'environment_fact',
      'operational_note', 'conversation_summary'
    )),
  CONSTRAINT memories_confidence_check
    CHECK (confidence BETWEEN 0.00 AND 1.00),
  CONSTRAINT memories_status_check
    CHECK (status IN ('active', 'superseded', 'archived')),
  CONSTRAINT memories_source_type_check
    CHECK (source_type IN (
      'llm_extraction', 'heuristic_fallback', 'operator_direct', 'system'
    ))
);

-- Conditional embedding column (16th column, pgvector-prepared).
-- Added as vector(1536) if pgvector is installed, otherwise TEXT NULL as a placeholder.
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
          'pgvector-prepared: install pgvector and ALTER TYPE to vector(1536) when ready'
      $comment$;
    END IF;
  END IF;
END $$;

-- Index 1: conversation timeline (primary recall path by recency)
CREATE INDEX IF NOT EXISTS idx_memories_conversation_created
  ON memories (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

-- Index 2: tier + status + category (retrieval by classification)
CREATE INDEX IF NOT EXISTS idx_memories_tier_status_category
  ON memories (memory_tier, status, category);

-- Index 3: supersession chain traversal
CREATE INDEX IF NOT EXISTS idx_memories_superseded_by
  ON memories (superseded_by)
  WHERE superseded_by IS NOT NULL;

-- Index 4: active high-confidence recall (operator/worker surfaces)
CREATE INDEX IF NOT EXISTS idx_memories_active_confidence
  ON memories (category, confidence DESC)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_memories_updated_at ON memories;
CREATE TRIGGER trg_memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;
