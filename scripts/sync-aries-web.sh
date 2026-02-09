#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARIES_DIR="/Users/yoho/code/client/aries_react"
WEB_DIR="${ROOT_DIR}/apps/web"

RUN_DEV=0

if [[ "${1:-}" == "--dev" ]]; then
  RUN_DEV=1
fi

echo "[sync] build aries_react dist..."
pnpm -C "${ARIES_DIR}" build

echo "[sync] refresh web deps..."
pnpm -C "${WEB_DIR}" install --ignore-workspace --no-frozen-lockfile

echo "[sync] clear vite cache..."
rm -rf "${WEB_DIR}/node_modules/.vite"

echo "[sync] verify web build..."
pnpm -C "${WEB_DIR}" build

if [[ "${RUN_DEV}" == "1" ]]; then
  echo "[sync] start web dev..."
  exec pnpm -C "${WEB_DIR}" dev --force
fi

echo "[sync] done."
