# Ghost DB Migrations

`db/migrations/` contains SQL migration scripts for the Ghost application database.

This directory is gitignored. Migrations should be stored here for reference but
are not committed to the repository since they contain environment-specific state.

## Applied migrations (as of 2026-03-14)

| File | Phase | Description |
|---|---|---|
| `20260312_phase4a_ghost_memory.sql` | Phase 4A | Ghost memory table |
| `20260312_phase5d_runtime_ledger.sql` | Phase 5D | Runtime ledger tables |
| `20260313_phase5gc_orchestration_tasks.sql` | Phase 5GC | Orchestration task tables |
| `20260313_phase5gd_openclaw_alignment.sql` | Phase 5GD | Openclaw alignment schema |
| `20260313_phase5gf_orchestration_controls.sql` | Phase 5GF | Orchestration controls |
| `20260313_runtime_observability_hardening.sql` | Phase 5GF | Observability hardening |

Down migrations (`*_down.sql`) are included for rollback.

## Running a migration

```bash
docker exec -i ghost-postgres psql -U ghost -d ghost_app < db/migrations/<file>.sql
```
