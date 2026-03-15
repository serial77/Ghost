#!/usr/bin/env bash
# Ghost Migration Runner
# Applies numbered up-migrations to ghost_app tracking applied files in schema_migrations.
# Uses PG* environment variables for database connection.
set -euo pipefail

MIGRATIONS_DIR="${MIGRATIONS_DIR:-$(cd "$(dirname "$0")/../db/migrations" && pwd)}"

# ─── Preflight ───────────────────────────────────────────────────────────────

if [ -z "${PGHOST:-}" ] || [ -z "${PGDATABASE:-}" ] || [ -z "${PGUSER:-}" ]; then
  echo "ERROR: PGHOST, PGDATABASE, and PGUSER must be set." >&2
  exit 1
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: Migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

echo "=== Ghost Migration Runner ==="
echo "Database : ${PGDATABASE}"
echo "Host     : ${PGHOST}:${PGPORT:-5432}"
echo "Dir      : ${MIGRATIONS_DIR}"
echo ""

# ─── Tracking table ──────────────────────────────────────────────────────────

psql -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);"

echo "Tracking table ready."
echo ""

# ─── Collect up-migration files sorted ascending ─────────────────────────────

mapfile -t files < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' ! -name '*_down.sql' | sort)

if [ "${#files[@]}" -eq 0 ]; then
  echo "No migration files found."
  exit 0
fi

applied=0
skipped=0

# ─── Apply each migration ────────────────────────────────────────────────────

for filepath in "${files[@]}"; do
  filename="$(basename "$filepath")"

  count=$(psql -t -A -v ON_ERROR_STOP=1 \
    -c "SELECT COUNT(*) FROM schema_migrations WHERE filename = '${filename}'")

  if [ "${count}" -gt 0 ]; then
    echo "[skip]  ${filename}"
    skipped=$((skipped + 1))
    continue
  fi

  echo "[apply] ${filename}"
  psql -v ON_ERROR_STOP=1 -f "${filepath}"

  psql -v ON_ERROR_STOP=1 \
    -c "INSERT INTO schema_migrations (filename) VALUES ('${filename}') ON CONFLICT DO NOTHING;"

  echo "[done]  ${filename}"
  applied=$((applied + 1))
done

echo ""
echo "=== Migration complete. Applied: ${applied}  Skipped: ${skipped} ==="
