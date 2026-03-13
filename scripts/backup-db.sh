#!/bin/bash

set -euo pipefail

DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_DIR="$HOME/dev/ghost-stack/backups/$DATE"
POSTGRES_CONTAINER="ghost-postgres"
POSTGRES_USER="ghost"

DBS=(
  "ghost_core"
  "ghost_app"
)

mkdir -p "$BACKUP_DIR"

echo "Creating backups in: $BACKUP_DIR"
echo

for DB in "${DBS[@]}"; do
  EXISTS=$(docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}';" | tr -d '[:space:]')

  if [ "$EXISTS" = "1" ]; then
    OUTFILE="$BACKUP_DIR/${DB}.sql.gz"
    echo "Backing up database: $DB"
    docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$DB" | gzip > "$OUTFILE"
    echo "  -> $OUTFILE"
  else
    echo "Skipping missing database: $DB"
  fi
done

echo
echo "Backup completed."