#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! lsof -ti tcp:7233 >/dev/null 2>&1; then
  echo "Temporal dev server is not running on :7233."
  echo "Start it first (e.g. ./run.sh) or run: temporal server start-dev"
  exit 1
fi

echo "==> Starting worker (Ctrl-C to stop)"
exec npm run worker
