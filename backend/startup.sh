#!/usr/bin/env bash
# Azure App Service (B1 Linux): run local Qdrant on persistent /home storage, then FastAPI.
#
# Portal / workflow startup command:
#   bash $APP_PATH/startup.sh
#
# Required app settings (workflow sets these):
#   SCM_DO_BUILD_DURING_DEPLOYMENT=true
#   WEBSITES_ENABLE_APP_SERVICE_STORAGE=true
#   QDRANT_URL=http://127.0.0.1:6333

set -euo pipefail

log() { echo "[startup] $*"; }

resolve_app_root() {
  if [ -n "${APP_PATH:-}" ] && [ -f "${APP_PATH}/app/main.py" ]; then
    echo "$APP_PATH"
    return
  fi
  if [ -f "./app/main.py" ]; then
    pwd
    return
  fi
  if [ -f "/home/site/wwwroot/app/main.py" ]; then
    echo "/home/site/wwwroot"
    return
  fi
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "${script_dir}/app/main.py" ]; then
    echo "$script_dir"
    return
  fi
  log "ERROR: could not locate app/main.py (APP_PATH=${APP_PATH:-unset}, pwd=$(pwd))" >&2
  exit 1
}

APP_ROOT="$(resolve_app_root)"
cd "$APP_ROOT"
log "APP_ROOT=$APP_ROOT"

QDRANT_VERSION="${QDRANT_VERSION:-1.13.2}"
QDRANT_BIN_DIR="${QDRANT_BIN_DIR:-/home/qdrant/bin}"
QDRANT_STORAGE="${QDRANT_STORAGE_PATH:-/home/qdrant/storage}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
QDRANT_HOST="${QDRANT_HOST:-127.0.0.1}"

mkdir -p "$QDRANT_BIN_DIR" "$QDRANT_STORAGE"

install_qdrant() {
  arch="$(uname -m)"
  case "$arch" in
    x86_64) qdrant_arch="x86_64" ;;
    aarch64|arm64) qdrant_arch="aarch64" ;;
    *)
      log "ERROR: unsupported CPU architecture for Qdrant: $arch" >&2
      exit 1
      ;;
  esac

  tarball="qdrant-${qdrant_arch}-unknown-linux-gnu.tar.gz"
  url="https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/${tarball}"
  tmp_dir="$(mktemp -d)"

  log "Downloading Qdrant v${QDRANT_VERSION} (${qdrant_arch})..."
  curl -fsSL "$url" -o "${tmp_dir}/${tarball}"
  tar -xzf "${tmp_dir}/${tarball}" -C "$QDRANT_BIN_DIR"
  chmod +x "${QDRANT_BIN_DIR}/qdrant"
  rm -rf "$tmp_dir"
}

if [ ! -x "${QDRANT_BIN_DIR}/qdrant" ]; then
  install_qdrant
fi

export QDRANT__SERVICE__HOST="$QDRANT_HOST"
export QDRANT__SERVICE__HTTP_PORT="$QDRANT_PORT"
export QDRANT__STORAGE__STORAGE_PATH="$QDRANT_STORAGE"
export QDRANT__STORAGE__LOW_MEMORY_MODE="${QDRANT__STORAGE__LOW_MEMORY_MODE:-no_populate}"

if [ -n "${QDRANT_API_KEY:-}" ]; then
  export QDRANT__SERVICE__API_KEY="$QDRANT_API_KEY"
fi

log "Starting Qdrant (storage: ${QDRANT_STORAGE})..."
"${QDRANT_BIN_DIR}/qdrant" &
QDRANT_PID=$!

cleanup() {
  if kill -0 "$QDRANT_PID" 2>/dev/null; then
    kill "$QDRANT_PID" 2>/dev/null || true
    wait "$QDRANT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

ready=0
for i in $(seq 1 60); do
  if curl -sf "http://${QDRANT_HOST}:${QDRANT_PORT}/readiness" >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$QDRANT_PID" 2>/dev/null; then
    log "ERROR: Qdrant exited before becoming ready." >&2
    exit 1
  fi
  if [ "$i" -eq 1 ] || [ $((i % 10)) -eq 0 ]; then
    log "Waiting for Qdrant readiness (${i}/60)..."
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  log "ERROR: timed out waiting for Qdrant readiness." >&2
  exit 1
fi

log "Qdrant is ready."

PYTHON=""
for candidate in \
  "$APP_ROOT/antenv/bin/python" \
  "$APP_ROOT/venv/bin/python" \
  "$(command -v python3 || true)" \
  "$(command -v python || true)"
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    PYTHON="$candidate"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  log "ERROR: no Python interpreter found." >&2
  ls -la "$APP_ROOT" >&2 || true
  exit 1
fi

log "Using Python: $PYTHON ($("$PYTHON" --version 2>&1))"

export QDRANT_URL="${QDRANT_URL:-http://${QDRANT_HOST}:${QDRANT_PORT}}"
PORT="${PORT:-8000}"

log "Starting FastAPI on port ${PORT}..."
exec "$PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --workers 1
