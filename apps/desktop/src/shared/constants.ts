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
//   - 智能体文本流事件名，Tauri emit → 前端 listen 全局唯一绑定。
export const EVENT_AGENT_TEXT_STREAM = "agent:text_stream";

// 描述:
//
//   - 智能体后台日志事件名，供调试面板消费。
export const EVENT_AGENT_LOG = "agent:log";

// 描述：
//
//   - 工作流注册表更新事件名；本地工作流创建、删除或保存后统一广播，供总览页、侧边栏等订阅刷新。
export const AGENT_WORKFLOWS_UPDATED_EVENT = "libra:agent-workflows-updated";

// 描述：
//
//   - 定义工作流注册表更新原因，区分仅内容保存与会影响列表结构的增删操作。
export type AgentWorkflowsUpdatedReason = "save" | "create" | "delete";

// 描述：
//
//   - 定义工作流注册表更新事件负载，供订阅方按原因选择普通刷新或强制重建菜单。
export interface AgentWorkflowsUpdatedEventDetail {
  reason: AgentWorkflowsUpdatedReason;
  workflowId?: string;
}

// ── Tauri invoke 命令名 ──────────────────────────────────────────────

// 描述:
//
//   - invoke 命令名集合，与 src-tauri 侧 `#[tauri::command]` 函数名一一对应。
export const COMMANDS = {
  LIST_AGENT_SKILLS: "list_agent_skills",
  LIST_AGENT_SKILL_OVERVIEW: "list_agent_skill_overview",
  REGISTER_BUILTIN_AGENT_SKILL: "register_builtin_agent_skill",
  UNREGISTER_BUILTIN_AGENT_SKILL: "unregister_builtin_agent_skill",
  OPEN_BUILTIN_AGENT_SKILL_FOLDER: "open_builtin_agent_skill_folder",
  PICK_AGENT_SKILL_FOLDER: "pick_agent_skill_folder",
  IMPORT_AGENT_SKILL_FROM_PATH: "import_agent_skill_from_path",
  REMOVE_USER_AGENT_SKILL: "remove_user_agent_skill",
  LIST_REGISTERED_MCPS: "list_registered_mcps",
  SAVE_MCP_REGISTRATION: "save_mcp_registration",
  REMOVE_MCP_REGISTRATION: "remove_mcp_registration",
  VALIDATE_MCP_REGISTRATION: "validate_mcp_registration",
  CHECK_DCC_RUNTIME_STATUS: "check_dcc_runtime_status",
  PREPARE_DCC_RUNTIME: "prepare_dcc_runtime",
  RUN_AGENT_COMMAND: "run_agent_command",
  GET_AGENT_RUNTIME_CAPABILITIES: "get_agent_runtime_capabilities",
  CALL_AI_SUMMARY_COMMAND: "call_ai_summary_command",
  CALL_AI_MEMORY_COMMAND: "call_ai_memory_command",
  CANCEL_AGENT_SESSION: "cancel_agent_session",
  RESET_AGENT_SANDBOX: "reset_agent_sandbox",
  APPROVE_AGENT_ACTION: "approve_agent_action",
  RESOLVE_AGENT_USER_INPUT: "resolve_agent_user_input",
  GET_AGENT_SANDBOX_METRICS: "get_agent_sandbox_metrics",
  CHECK_PROJECT_DEPENDENCY_RULES: "check_project_dependency_rules",
  APPLY_PROJECT_DEPENDENCY_RULE_UPGRADES: "apply_project_dependency_rule_upgrades",
  INSPECT_PROJECT_WORKSPACE_PROFILE_SEED: "inspect_project_workspace_profile_seed",
  GET_DESKTOP_RUNTIME_INFO: "get_desktop_runtime_info",
  CHECK_DESKTOP_UPDATE: "check_desktop_update",
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
//   - 智能体文本流事件 kind 常量，与 Tauri 侧 `AgentStreamEvent` 映射一致。
export const STREAM_KINDS = {
  STARTED: "started",
  LLM_STARTED: "llm_started",
  LLM_FINISHED: "llm_finished",
  DELTA: "delta",
  PLANNING: "planning",
  TOOL_CALL_STARTED: "tool_call_started",
  TOOL_CALL_FINISHED: "tool_call_finished",
  REQUIRE_APPROVAL: "require_approval",
  REQUEST_USER_INPUT: "request_user_input",
  HEARTBEAT: "heartbeat",
  FINAL: "final",
  FINISHED: "finished",
  CANCELLED: "cancelled",
  ERROR: "error",
} as const;

// ── 默认服务端口 ──────────────────────────────────────────────────────

// 描述:
//
//   - 应用级 localStorage 存储键集合，统一管理避免散布硬编码。
export const STORAGE_KEYS = {
  COLOR_THEME_MODE: "libra.desktop.colorThemeMode",
  DESKTOP_LANGUAGE: "libra.desktop.language",
  DCC_MCP_CAPABILITIES: "libra.desktop.agent.dccMcpCapabilities",
  AI_KEYS: "libra.desktop.aiKeys",
  AGENT_EXECUTION_SELECTION: "libra.desktop.agent.executionSelection",
  AGENT_SKILL_SELECTED_IDS: "libra.desktop.agent.selectedSkillIds",
  AGENT_WORKFLOWS: "libra.desktop.agent.workflows",
  DESKTOP_ADMIN_PERMISSION_GRANTS: "libra.desktop.admin.permissionGrants",
  DESKTOP_BACKEND_CONFIG: "libra.desktop.backendConfig",
  DESKTOP_SELECTED_IDENTITY_ID: "libra.desktop.selectedIdentityId",
} as const;

// 描述:
//
//   - Desktop 依赖的本地默认服务端口映射。
export const DEFAULT_SERVICE_PORTS = {
  backend: 10001,
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
