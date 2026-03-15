BEGIN;

DROP INDEX IF EXISTS idx_orchestration_task_events_task_created;
DROP TABLE IF EXISTS orchestration_task_events;

COMMIT;
