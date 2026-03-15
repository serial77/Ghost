BEGIN;

DROP TRIGGER IF EXISTS trg_ghost_memory_updated_at ON ghost_memory;
DROP TABLE IF EXISTS ghost_memory;

COMMIT;
