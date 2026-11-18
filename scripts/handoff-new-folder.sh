#!/usr/bin/env bash
# Copy this project into a fresh folder, without the live data or the secrets.
#
#   bash scripts/handoff-new-folder.sh ~/Desktop/SaaS_projects/sunfall-city-v3
#   bash scripts/handoff-new-folder.sh --with-env ~/Desktop/SaaS_projects/sunfall-city-v3
#
# --with-env copies the real .env, keys and all, instead of a blank stub. Use it
# when the new folder is yours and you want it running immediately. The copy is
# gitignored by .gitignore in the new folder too, but it is a second file on disk
# holding live keys: if you ever share or publish that folder, delete it first.
#
# What is left behind either way, and why, is documented in docs/HANDOFF.md
# section 1. In short: jobs.db and videos/ hold real buyer data, and
# node_modules/ dist/ .taste-skill/ are all rebuildable.
set -euo pipefail

WITH_ENV=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --with-env) WITH_ENV=1 ;;
    *) ARGS+=("$a") ;;
  esac
done

DEST="${ARGS[0]:-}"
if [ -z "$DEST" ]; then
  echo "usage: bash scripts/handoff-new-folder.sh [--with-env] <destination folder>" >&2
  exit 1
fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  echo "refusing to write into a folder that already has files: $DEST" >&2
  exit 1
fi
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

if [ "$DEST" = "$SRC" ]; then
  echo "destination is the source folder" >&2
  exit 1
fi

echo "copying $SRC -> $DEST"
rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'build/' \
  --exclude 'videos/' \
  --exclude '.taste-skill/' \
  --exclude '.env' \
  --exclude 'jobs.db' \
  --exclude 'jobs.db-shm' \
  --exclude 'jobs.db-wal' \
  --exclude 'neon.db' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  --exclude 'card-preview.png' \
  "$SRC"/ "$DEST"/

if [ "$WITH_ENV" = "1" ] && [ -f "$SRC/.env" ]; then
  cp "$SRC/.env" "$DEST/.env"
  chmod 600 "$DEST/.env"
  ENV_NOTE="your real .env was copied, keys and all, mode 600"
  ENV_STEP="# .env is already filled in"
else
  cp "$SRC/.env.example" "$DEST/.env"
  ENV_NOTE="a blank .env stub was copied from .env.example, no keys"
  ENV_STEP="\$EDITOR .env                   # fill in the stub"
fi

cat <<MSG

Done. No buyer data was copied ($ENV_NOTE).

Next, in order (docs/HANDOFF.md has the detail):

  cd "$DEST"
  git init                       # it is not a repository yet
  npm ci                         # native builds: better-sqlite3, sharp
  $ENV_STEP
  npm run dev                    # creates a fresh empty jobs.db on first run

Set PUBLIC_URL, not BASE_URL: server.ts reads the former and falls back to the
old v1 domain.
MSG
if [ "$WITH_ENV" = "1" ]; then
  cat <<'MSG'

Two live keys now exist in two folders. FAL_KEY spends money per call and
ADMIN_SECRET unlocks free generation, /analytics and the admin panel. If the new
folder is for experiments, consider minting separate ones so a runaway loop or a
leak is contained to one of them.
MSG
fi
