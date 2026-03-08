#!/usr/bin/env bash
set -euo pipefail

# 描述：
#
#   - 启动 Libra 开源版本统一后端服务。
#   - 创建各领域数据目录与统一日志目录，避免首次运行因为目录缺失直接失败。
#   - 在前台保持单个后端进程运行，并在退出脚本时统一清理。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKEND_PORT="${LIBRA_BACKEND_PORT:-10001}"

ACCOUNT_DATA_DIR="${LIBRA_ACCOUNT_DATA_DIR:-${ROOT_DIR}/services/data/account}"
RUNTIME_DATA_DIR="${LIBRA_RUNTIME_DATA_DIR:-${ROOT_DIR}/services/data/runtime}"
SETUP_DATA_DIR="${LIBRA_SETUP_DATA_DIR:-${ROOT_DIR}/services/data/setup}"

LOG_DIR="${LIBRA_STACK_LOG_DIR:-${ROOT_DIR}/tmp/open-source-stack/logs}"

BACKEND_BASE_URL="http://127.0.0.1:${BACKEND_PORT}"
SETUP_URL="${BACKEND_BASE_URL}/setup"

BACKEND_HEALTH_URL="${BACKEND_BASE_URL}/setup/v1/status"

BOOTSTRAP_TOKEN="${LIBRA_SETUP_TOKEN:-${LIBRA_ACCOUNT_BOOTSTRAP_TOKEN:-}}"

PIDS=()

# 描述：
#
#   - 为首次运行创建数据目录和日志目录。
prepare_dirs() {
  mkdir -p "${ACCOUNT_DATA_DIR}" "${RUNTIME_DATA_DIR}" "${SETUP_DATA_DIR}" "${LOG_DIR}"
}

# 描述：
#
#   - 在脚本退出时停止本次启动的全部子进程，避免后台残留。
cleanup() {
  local exit_code=$?

  if [ "${#PIDS[@]}" -gt 0 ]; then
    echo
    echo "stopping Libra services..."
    for pid in "${PIDS[@]}"; do
      if kill -0 "${pid}" >/dev/null 2>&1; then
        kill "${pid}" >/dev/null 2>&1 || true
      fi
    done
    wait || true
  fi

  exit "${exit_code}"
}

# 描述：
#
#   - 以指定环境变量启动统一后端服务，并将输出写入日志文件。
#
# Params:
#
#   - service_name: 进程名。
#   - service_entry: `go run` 入口目录。
#   - log_file: 日志文件。
start_service() {
  local service_name="$1"
  local service_entry="$2"
  local log_file="$3"
  shift 3

  echo "[start] ${service_name} -> ${log_file}"

  (
    cd "${ROOT_DIR}/services"
    env "$@" go run "${service_entry}"
  ) >"${log_file}" 2>&1 &

  local pid=$!
  PIDS+=("${pid}")
  echo "[pid] ${service_name}: ${pid}"
}

# 描述：
#
#   - 轮询指定 HTTP 地址，确认服务已完成监听。
#
# Params:
#
#   - service_name: 服务名。
#   - url: 健康检查地址。
wait_for_http() {
  local service_name="$1"
  local url="$2"
  local attempts=0

  if ! command -v curl >/dev/null 2>&1; then
    echo "[warn] curl 不存在，跳过 ${service_name} 健康检查。"
    return 0
  fi

  until curl -fsS "${url}" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "${attempts}" -ge 30 ]; then
      echo "[error] ${service_name} 启动失败，请检查 ${LOG_DIR}/${service_name}.log"
      return 1
    fi
    sleep 1
  done

  echo "[ready] ${service_name}"
}

trap cleanup EXIT INT TERM

prepare_dirs

start_service \
  "backend" \
  "./cmd/server" \
  "${LOG_DIR}/backend.log" \
  LIBRA_BACKEND_PORT="${BACKEND_PORT}" \
  LIBRA_ACCOUNT_DATA_DIR="${ACCOUNT_DATA_DIR}" \
  LIBRA_RUNTIME_DATA_DIR="${RUNTIME_DATA_DIR}" \
  LIBRA_SETUP_DATA_DIR="${SETUP_DATA_DIR}" \
  LIBRA_SETUP_TOKEN="${BOOTSTRAP_TOKEN}" \
  LIBRA_ACCOUNT_BOOTSTRAP_TOKEN="${BOOTSTRAP_TOKEN}"

wait_for_http "backend" "${BACKEND_HEALTH_URL}"

echo
echo "Libra 开源后端已启动。"
echo "- backend: ${BACKEND_BASE_URL}"
echo "- setup 页面: ${SETUP_URL}"
echo "- logs: ${LOG_DIR}"
echo
echo "按 Ctrl+C 停止全部服务。"

wait
