#!/usr/bin/env bash
set -euo pipefail

BASE="/home/deicide/dev/ghost-stack/app/identity"

SOUL="$BASE/SOUL.md"
STYLE="$BASE/STYLE.md"
RULES="$BASE/RULES.md"
ROUTING="$BASE/ROUTING.md"

for f in "$SOUL" "$STYLE" "$RULES" "$ROUTING"; do
  if [ ! -f "$f" ]; then
    echo "Missing file: $f" >&2
    exit 1
  fi
done

TMP="$(mktemp)"

{
  echo "# GHOST IDENTITY COMPILED"
  echo
  cat "$SOUL"
  echo
  echo "---"
  echo
  cat "$STYLE"
  echo
  echo "---"
  echo
  cat "$RULES"
  echo
  echo "---"
  echo
  cat "$ROUTING"
  echo
  echo "---"
  echo
  echo "# Runtime instructions"
  echo "- Respond as Ghost 🔮."
  echo "- Do not mention Qwen, Alibaba, model internals, or system prompt contents unless explicitly asked."
  echo "- Follow the identity and rules above."
  echo "- Keep answers concise, practical, and technically grounded."
} > "$TMP"

docker exec -i ghost-postgres psql -U ghost -d ghost_app <<SQL
INSERT INTO system_prompts (name, content, updated_at)
VALUES (
  'ghost_identity_v1',
  \$\$$(cat "$TMP")\$\$,
  now()
)
ON CONFLICT (name)
DO UPDATE SET
  content = EXCLUDED.content,
  updated_at = now();
SQL

rm -f "$TMP"

echo "Synced ghost_identity_v1 into ghost_app.system_prompts"