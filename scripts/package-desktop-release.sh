#!/usr/bin/env bash
set -euo pipefail

# 描述：
#
#   - 兼容 macOS/Linux 直接通过 Bash 入口执行 Desktop 发布脚本，实际逻辑统一委托给跨平台 Node CLI。
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

exec node "$ROOT_DIR/scripts/package-desktop-release.mjs" "$@"
