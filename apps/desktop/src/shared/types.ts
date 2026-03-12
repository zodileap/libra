// 描述:
//
//   - 定义智能体标识枚举。
export type AgentKey = "agent";

// 描述:
//
//   - 定义主题模式枚举。
export type ColorThemeMode = "light" | "dark" | "system";

// 描述:
//
//   - 定义模型 MCP 能力键。
export type DccMcpCapabilityKey = "export";

// 描述:
//
//   - 定义智能体摘要信息结构。
export interface AgentSummary {
  key: AgentKey;
  name: string;
  description: string;
  hint: string;
}

// 描述:
//
//   - 定义智能体会话结构。
export interface AgentSession {
  id: string;
  agentKey: AgentKey;
  title: string;
  updatedAt: string;
}

// 描述:
//
//   - 定义首页快捷项结构。
export interface ShortcutItem {
  id: string;
  title: string;
  description: string;
}

// 描述:
//
//   - 定义登录用户信息结构。
export interface LoginUser {
  id: string;
  name: string;
  email: string;
}

// 描述:
//
//   - 定义可用智能体授权项结构。
export interface AuthAvailableAgentItem {
  agentId: string;
  code: string;
  name: string;
  version?: string;
  agentStatus?: number;
  remark?: string;
  accessId: string;
  accessType?: number;
  duration?: number;
  accessStatus?: number;
}

// 描述:
//
//   - 定义模型 MCP 能力开关集合。
export interface DccMcpCapabilities {
  export: boolean;
  scene: boolean;
  transform: boolean;
  geometry: boolean;
  mesh_opt: boolean;
  material: boolean;
  file: boolean;
}

// 描述:
//
//   - 定义 AI 服务提供商枚举。
export type AiProvider = "codex" | "gemini" | "gemini-cli" | "iflow";

// 描述:
//
//   - 定义 AI Key 配置项结构。
export interface AiKeyItem {
  id: string;
  provider: AiProvider;
  providerLabel: string;
  keyValue: string;
  modelName?: string;
  modeName?: string;
  enabled: boolean;
  updatedAt: string;
}

// 描述：
//
//   - 定义桌面端更新状态枚举。
export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "installing"
  | "failed";

// 描述：
//
//   - 定义桌面端更新运行态结构，供 App 与侧边栏共享。
export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  targetVersion: string;
  progress: number;
  message: string;
  downloadPath?: string;
}

// 描述：
//
//   - 定义桌面端后端接入配置；未启用时 Desktop 以本地模式独立运行。
export interface DesktopBackendConfig {
  enabled: boolean;
  baseUrl: string;
  updateManifestUrl: string;
}

// 描述：
//
//   - 定义 setup 服务系统配置结构，供桌面端初始化检查消费。
export interface SetupSystemConfig {
  systemName: string;
  baseUrl: string;
  defaultLanguage: string;
  timezone: string;
  allowPublicSignup: boolean;
}

// 描述：
//
//   - 定义 setup 服务状态结构，供桌面端启动时判断是否已完成安装。
export interface SetupStatus {
  setupStatus: string;
  currentStep: string;
  installed: boolean;
  installedAt?: string;
  installedVersion?: string;
  lastError?: string;
  systemConfig?: SetupSystemConfig;
  accountAvailable: boolean;
  accountInitialized: boolean;
  accountMessage?: string;
}

// 描述：
//
//   - 定义桌面端管理台身份项结构，支持在 Desktop 中查看账号所属身份与角色。
export interface ConsoleIdentityItem {
  id: string;
  type: string;
  scopeName: string;
  roles: string[];
  status: string;
}

// 描述：
//
//   - 定义桌面端管理台可授权用户结构，供权限页直接选择目标用户。
export interface ConsoleManageableUserItem {
  id: string;
  name: string;
  email?: string;
  status: string;
  identityScopes: string[];
  self: boolean;
}

// 描述：
//
//   - 定义桌面端管理台权限模板结构，用于快速新增授权。
export interface ConsolePermissionTemplate {
  code: string;
  name: string;
  description: string;
  resourceType: string;
}

// 描述：
//
//   - 定义桌面端管理台权限授权记录结构。
export interface ConsolePermissionGrantItem {
  id: string;
  targetUserId: string;
  targetUserName: string;
  permissionCode: string;
  resourceType: string;
  resourceName: string;
  grantedBy: string;
  status: string;
  createdAt?: string;
  lastAt?: string;
  expiresAt?: string;
}

// 描述：
//
//   - 定义桌面端管理台新增授权请求结构。
export interface ConsoleGrantPermissionReq {
  targetUserId: string;
  targetUserName: string;
  permissionCode: string;
  resourceType: string;
  resourceName: string;
  expiresAt?: string;
}

// 描述:
//
//   - 定义智能体日志事件结构。
export interface AgentLogEvent {
  trace_id: string;
  level: string;
  stage: string;
  message: string;
}

// 描述:
//
//   - 定义协议步骤状态枚举。
export type ProtocolStepStatus = "success" | "failed" | "skipped" | "manual";

// 描述:
//
//   - 定义协议错误结构。
export interface ProtocolError {
  code: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
}

// 描述:
//
//   - 定义 UI 提示动作意图枚举。
export type ProtocolUiHintActionIntent = "primary" | "default" | "danger";

// 描述:
//
//   - 定义 UI 提示等级枚举。
export type ProtocolUiHintLevel = "info" | "warning" | "danger";

// 描述:
//
//   - 定义 UI 提示动作结构。
export interface ProtocolUiHintAction {
  key: string;
  label: string;
  intent: ProtocolUiHintActionIntent;
}

// 描述:
//
//   - 定义 UI 提示结构。
export interface ProtocolUiHint {
  key: string;
  level: ProtocolUiHintLevel;
  title: string;
  message: string;
  actions: ProtocolUiHintAction[];
  context?: Record<string, unknown>;
}

// 描述:
//
//   - 定义模型步骤记录结构。
export interface AgentStepRecord {
  index: number;
  code: string;
  status: ProtocolStepStatus;
  elapsed_ms: number;
  summary: string;
  error?: ProtocolError;
  data?: Record<string, unknown>;
}

// 描述:
//
//   - 定义模型事件记录结构。
export interface AgentEventRecord {
  event: string;
  step_index?: number;
  timestamp_ms: number;
  message: string;
}

// 描述:
//
//   - 定义模型资产记录结构。
export interface AgentAssetRecord {
  kind: string;
  path: string;
  version: number;
  meta?: Record<string, unknown>;
}

// 描述:
//
//   - 定义通用文本流事件结构，Tauri 侧 emit、前端 listen 共用。
export interface AgentTextStreamEvent {
  trace_id: string;
  session_id?: string;
  kind: string;
  message: string;
  delta?: string;
  data?: Record<string, unknown>;
}

// 描述:
//
//   - 定义模型调试轨迹事件结构，供调试面板展示。
export interface AgentDebugTraceEvent {
  session_id: string;
  trace_id: string;
  stage: string;
  title: string;
  detail: string;
  timestamp_ms: number;
}
