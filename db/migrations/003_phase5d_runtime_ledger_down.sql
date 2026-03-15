DROP FUNCTION IF EXISTS public.ghost_runtime_complete_task_ledger(
  UUID,
  UUID,
  INTEGER,
  JSONB,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  BOOLEAN,
  BOOLEAN,
  TEXT,
  TEXT,
  TEXT,
  TEXT
);

DROP FUNCTION IF EXISTS public.ghost_runtime_start_task_ledger(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB,
  JSONB
);

DROP FUNCTION IF EXISTS public.ghost_runtime_summarize_prompt(TEXT);
