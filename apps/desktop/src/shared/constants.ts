// 描述:
//
//   - 集中管理桌面端全局常量，包括 Tauri 事件名、invoke 命令名、错误码、
//     流式事件 kind 和默认服务端口，避免硬编码字符串散布在各模块中。

// ── 运行环境 ──────────────────────────────────────────────────────────

// 描述:
//
//   - 判断当前是否处于浏览器环境（存在 window 对象），用于 localStorage 等 DOM API 防护。
export const IS_BROWSER = typeof window !== "undefined";

// ── Tauri 事件名 ──────────────────────────────────────────────────────

// 描述:
//
//   - 代码智能体文本流事件名，Tauri emit → 前端 listen 全局唯一绑定。
export const EVENT_AGENT_TEXT_STREAM = "agent:text_stream";

// 描述:
//
//   - 智能体后台日志事件名，供调试面板消费。
export const EVENT_AGENT_LOG = "agent:log";

// 描述:
//
//   - 模型会话流式事件名，用于模型工作流进度推送。
export const EVENT_MODEL_SESSION_STREAM = "model:session_stream";

// 描述:
//
//   - 模型调试轨迹事件名，供调试面板展示详细执行链路。
export const EVENT_MODEL_DEBUG_TRACE = "model:debug_trace";

// ── Tauri invoke 命令名 ──────────────────────────────────────────────

// 描述:
//
//   - invoke 命令名集合，与 src-tauri 侧 `#[tauri::command]` 函数名一一对应。
export const COMMANDS = {
  RUN_AGENT_COMMAND: "run_agent_command",
  CANCEL_AGENT_SESSION: "cancel_agent_session",
  RESET_AGENT_SANDBOX: "reset_agent_sandbox",
  APPROVE_AGENT_ACTION: "approve_agent_action",
  GET_AGENT_SANDBOX_METRICS: "get_agent_sandbox_metrics",
  GET_MODEL_SESSION_RECORDS: "get_model_session_records",
  SUMMARIZE_MODEL_SESSION_RESULT: "summarize_model_session_result",
  CHECK_PROJECT_DEPENDENCY_RULES: "check_project_dependency_rules",
  APPLY_PROJECT_DEPENDENCY_RULE_UPGRADES: "apply_project_dependency_rule_upgrades",
  INSPECT_CODE_WORKSPACE_PROFILE_SEED: "inspect_code_workspace_profile_seed",
  CHECK_APIFOX_MCP_RUNTIME_STATUS: "check_apifox_mcp_runtime_status",
  INSTALL_APIFOX_MCP_RUNTIME: "install_apifox_mcp_runtime",
  UNINSTALL_APIFOX_MCP_RUNTIME: "uninstall_apifox_mcp_runtime",
  RETRY_MODEL_SESSION_LAST_STEP: "retry_model_session_last_step",
  GET_DESKTOP_RUNTIME_INFO: "get_desktop_runtime_info",
  START_DESKTOP_UPDATE_DOWNLOAD: "start_desktop_update_download",
  GET_DESKTOP_UPDATE_STATE: "get_desktop_update_state",
  INSTALL_DOWNLOADED_DESKTOP_UPDATE: "install_downloaded_desktop_update",
} as const;

// ── 取消错误码 ────────────────────────────────────────────────────────

// 描述:
//
//   - 表示"用户/超时取消"语义的协议错误码集合，前端据此将 error 事件重映射为 cancelled 态。
export const CANCEL_ERROR_CODES = [
  "core.agent.request_cancelled",
  "core.agent.python.orchestration_timeout",
  "core.agent.human_approval_timeout",
] as const;

// 描述:
//
//   - 判断给定错误码是否属于取消语义。
//
// Params:
//
//   - code: 协议错误码字符串。
//
// Returns:
//
//   - 若属于取消类错误码返回 true。
export function isCancelErrorCode(code: string): boolean {
  return (CANCEL_ERROR_CODES as readonly string[]).includes(code);
}

// ── 流式事件 kind ─────────────────────────────────────────────────────

// 描述:
//
//   - 代码智能体文本流事件 kind 常量，与 Tauri 侧 `AgentStreamEvent` 映射一致。
export const STREAM_KINDS = {
  STARTED: "started",
  LLM_STARTED: "llm_started",
  LLM_FINISHED: "llm_finished",
  DELTA: "delta",
  PLANNING: "planning",
  TOOL_CALL_STARTED: "tool_call_started",
  TOOL_CALL_FINISHED: "tool_call_finished",
  REQUIRE_APPROVAL: "require_approval",
  HEARTBEAT: "heartbeat",
  FINAL: "final",
  FINISHED: "finished",
  CANCELLED: "cancelled",
  ERROR: "error",
} as const;

// ── 模型流式事件名 ────────────────────────────────────────────────────

// 描述:
//
//   - 模型工作流步骤事件名常量。
export const MODEL_EVENT_NAMES = {
  STEP_STARTED: "step_started",
  STEP_FINISHED: "step_finished",
  STEP_FAILED: "step_failed",
  BRANCH_SELECTED: "branch_selected",
  OPERATION_TRANSACTION_STARTED: "operation_transaction_started",
  OPERATION_TRANSACTION_COMMITTED: "operation_transaction_committed",
} as const;

// ── 默认服务端口 ──────────────────────────────────────────────────────

// 描述:
//
//   - 应用级 localStorage 存储键集合，统一管理避免散布硬编码。
export const STORAGE_KEYS = {
  COLOR_THEME_MODE: "libra.desktop.colorThemeMode",
  MODEL_MCP_CAPABILITIES: "libra.desktop.modelMcpCapabilities",
  AI_KEYS: "libra.desktop.aiKeys",
  SKILL_INSTALLED_IDS: "libra.desktop.skills.installed",
  MCP_INSTALLED_IDS: "libra.desktop.mcps.installed",
  MODEL_SKILL_SELECTED_IDS: "libra.desktop.model.selectedSkillIds",
  CODE_SKILL_SELECTED_IDS: "libra.desktop.code.selectedSkillIds",
  MODEL_WORKFLOWS: "libra.desktop.model.workflows",
  CODE_WORKFLOWS: "libra.desktop.code.workflows",
} as const;

// 描述:
//
//   - 各后端服务的默认本地端口映射，统一管理避免分散硬编码。
export const DEFAULT_SERVICE_PORTS = {
  account: 10001,
  runtime: 10002,
  agentCode: 10003,
  agent3d: 10004,
  app: 11001,
} as const;

// 描述:
//
//   - 根据服务名返回默认本地 URL，作为环境变量为空时的 fallback。
//
// Params:
//
//   - service: 服务标识。
//
// Returns:
//
//   - 对应的 `http://127.0.0.1:{port}` URL 字符串。
export function defaultServiceUrl(service: keyof typeof DEFAULT_SERVICE_PORTS): string {
  return `http://127.0.0.1:${DEFAULT_SERVICE_PORTS[service]}`;
}
