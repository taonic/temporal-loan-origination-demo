#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

LOG_DIR="./logs"
mkdir -p "$LOG_DIR"

PIDS=()
STOP_OLLAMA_CONTAINER=0

cleanup() {
  echo ""
  echo "Shutting down (Temporal dev server left running)..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  if [ "$STOP_OLLAMA_CONTAINER" -eq 1 ]; then
    docker compose down >/dev/null 2>&1 || true
  fi
  exit 0
}
trap cleanup INT TERM

free_port() {
  local port=$1
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  Port $port busy (pids: $pids) — killing"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

wait_for_port() {
  local port=$1
  local name=$2
  local max=${3:-60}
  local i=0
  while ! lsof -ti tcp:"$port" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$max" ]; then
      echo "  $name did not open port $port within ${max}s"
      return 1
    fi
    sleep 1
  done
}

KEEP_TEMPORAL=0
if lsof -ti tcp:7233 >/dev/null 2>&1; then
  read -r -p "Temporal dev server is already running. Keep using it? [Y/n] " reply </dev/tty || reply=""
  case "$reply" in
    [nN]|[nN][oO]) KEEP_TEMPORAL=0 ;;
    *) KEEP_TEMPORAL=1 ;;
  esac
fi

KEEP_OLLAMA=0
if lsof -ti tcp:11434 >/dev/null 2>&1; then
  read -r -p "Ollama is already running on :11434. Keep using it? [Y/n] " reply </dev/tty || reply=""
  case "$reply" in
    [nN]|[nN][oO]) KEEP_OLLAMA=0 ;;
    *) KEEP_OLLAMA=1 ;;
  esac
fi

echo "==> Freeing ports"
free_port 3000   # web UI
free_port 3001   # temporal UI proxy (iframe-friendly)
if [ "$KEEP_TEMPORAL" -eq 0 ]; then
  free_port 7233   # temporal gRPC
  free_port 8233   # temporal UI
fi
if [ "$KEEP_OLLAMA" -eq 0 ]; then
  free_port 11434  # ollama
fi

if [ "$KEEP_OLLAMA" -eq 1 ]; then
  existing_pid=$(lsof -ti tcp:11434 2>/dev/null | head -n1)
  echo "==> Keeping existing Ollama on :11434 (pid: ${existing_pid:-unknown})"
else
  echo "==> Starting Ollama (docker compose)"
  if ! docker compose up -d >"$LOG_DIR/ollama.log" 2>&1; then
    echo "    docker compose up failed — last lines of $LOG_DIR/ollama.log:"
    tail -n 20 "$LOG_DIR/ollama.log" | sed 's/^/      /'
    echo "    (is Docker Desktop running? if you have a native Ollama, start it and re-run — the prompt will offer to reuse it)"
    exit 1
  fi
  STOP_OLLAMA_CONTAINER=1
  wait_for_port 11434 "Ollama" 60
  ollama_cid=$(docker compose ps -q ollama 2>/dev/null | head -n1)
  echo "    container: ${ollama_cid:0:12}"
fi

if [ "$KEEP_TEMPORAL" -eq 1 ]; then
  existing_pid=$(lsof -ti tcp:7233 2>/dev/null | head -n1)
  echo "==> Keeping existing Temporal dev server on :7233 (pid: ${existing_pid:-unknown})"
else
  echo "==> Starting Temporal dev server (detached — survives Ctrl-C)"
  nohup temporal server start-dev \
    --search-attribute LoanStatus=Keyword \
    --search-attribute FailedActivity=Keyword \
    >"$LOG_DIR/temporal.log" 2>&1 &
  temporal_pid=$!
  disown "$temporal_pid" 2>/dev/null || true
  echo "    pid: $temporal_pid"
  wait_for_port 7233 "Temporal" 30
fi

echo "==> Starting worker"
npm run worker >"$LOG_DIR/worker.log" 2>&1 &
worker_pid=$!
PIDS+=("$worker_pid")
echo "    pid: $worker_pid"

echo "==> Starting web service"
npm run web >"$LOG_DIR/web.log" 2>&1 &
web_pid=$!
PIDS+=("$web_pid")
echo "    pid: $web_pid"
wait_for_port 3000 "Web service" 30

echo ""
echo "All services up:"
echo "  Dashboard:    http://localhost:3000"
echo "  Temporal UI:  http://localhost:8233"
echo "  Ollama:       http://localhost:11434"
echo "  Logs:         $LOG_DIR/"
echo ""
echo "To seed 10 demo workflows: npx ts-node src/client.ts"
echo "Press Ctrl-C to stop everything."

wait
