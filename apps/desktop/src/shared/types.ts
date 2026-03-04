// 描述:
//
//   - 定义智能体标识枚举。
export type AgentKey = "code" | "model";

// 描述:
//
//   - 定义主题模式枚举。
export type ColorThemeMode = "light" | "dark" | "system";

// 描述:
//
//   - 定义模型 MCP 能力键。
export type ModelMcpCapabilityKey = "export";

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
export interface ModelMcpCapabilities {
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
export type AiProvider = "codex" | "gemini" | "gemini-cli";

// 描述:
//
//   - 定义 AI Key 配置项结构。
export interface AiKeyItem {
  id: string;
  provider: AiProvider;
  providerLabel: string;
  keyValue: string;
  enabled: boolean;
  updatedAt: string;
}

// 描述:
//
//   - 定义 Blender Bridge 运行时状态结构。
export interface BlenderBridgeRuntime {
  checking: boolean;
  ok: boolean | null;
  message: string;
}

// 描述:
//
//   - 定义 Blender Bridge 检测结果结构。
export interface BlenderBridgeEnsureResult {
  ok: boolean;
  message: string;
}

// 描述:
//
//   - 定义 Blender Bridge 检测选项结构。
export interface BlenderBridgeEnsureOptions {
  forceInstall?: boolean;
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
export interface ModelStepRecord {
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
export interface ModelEventRecord {
  event: string;
  step_index?: number;
  timestamp_ms: number;
  message: string;
}

// 描述:
//
//   - 定义模型资产记录结构。
export interface ModelAssetRecord {
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
export interface ModelDebugTraceEvent {
  session_id: string;
  trace_id: string;
  stage: string;
  title: string;
  detail: string;
  timestamp_ms: number;
}
