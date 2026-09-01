#!/usr/bin/env bash
# Azure App Service (B1 Linux): run local Qdrant on persistent /home storage, then FastAPI.
#
# Portal → Configuration → Startup Command (use full path — Oryx cwd is not wwwroot):
#   bash /home/site/wwwroot/startup.sh
#
# Recommended app settings:
#   WEBSITES_ENABLE_APP_SERVICE_STORAGE=true
#   QDRANT_URL=http://127.0.0.1:6333
#   (leave QDRANT_API_KEY empty for localhost)

set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_ROOT"

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
      echo "Unsupported CPU architecture for Qdrant: $arch" >&2
      exit 1
      ;;
  esac

  tarball="qdrant-${qdrant_arch}-unknown-linux-gnu.tar.gz"
  url="https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/${tarball}"
  tmp_dir="$(mktemp -d)"

  echo "Downloading Qdrant v${QDRANT_VERSION} (${qdrant_arch})..."
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

echo "Starting Qdrant (storage: ${QDRANT_STORAGE})..."
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
for _ in $(seq 1 45); do
  if curl -sf "http://${QDRANT_HOST}:${QDRANT_PORT}/readiness" >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$QDRANT_PID" 2>/dev/null; then
    echo "Qdrant exited before becoming ready." >&2
    exit 1
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "Timed out waiting for Qdrant readiness." >&2
  exit 1
fi

echo "Qdrant is ready."

if [ -f "$APP_ROOT/antenv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source "$APP_ROOT/antenv/bin/activate"
fi

export QDRANT_URL="${QDRANT_URL:-http://${QDRANT_HOST}:${QDRANT_PORT}}"
PORT="${PORT:-8000}"

echo "Starting FastAPI on port ${PORT}..."
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --workers 1
