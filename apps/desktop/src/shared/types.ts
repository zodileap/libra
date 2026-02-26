export type AgentKey = "code" | "model";
export type ColorThemeMode = "light" | "dark" | "system";
export type ModelMcpCapabilityKey = "export";

export interface AgentSummary {
  key: AgentKey;
  name: string;
  description: string;
  hint: string;
}

export interface AgentSession {
  id: string;
  agentKey: AgentKey;
  title: string;
  updatedAt: string;
}

export interface ShortcutItem {
  id: string;
  title: string;
  description: string;
}

export interface LoginUser {
  id: string;
  name: string;
  email: string;
}

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

export interface ModelMcpCapabilities {
  export: boolean;
  scene: boolean;
  transform: boolean;
  geometry: boolean;
  mesh_opt: boolean;
  material: boolean;
  file: boolean;
}

export type AiProvider = "codex" | "gemini";

export interface AiKeyItem {
  id: string;
  provider: AiProvider;
  providerLabel: string;
  keyValue: string;
  enabled: boolean;
  updatedAt: string;
}

export interface BlenderBridgeRuntime {
  checking: boolean;
  ok: boolean | null;
  message: string;
}

export interface BlenderBridgeEnsureResult {
  ok: boolean;
  message: string;
}

export interface BlenderBridgeEnsureOptions {
  forceInstall?: boolean;
}

export interface AgentLogEvent {
  trace_id: string;
  level: string;
  stage: string;
  message: string;
}

export type ProtocolStepStatus = "success" | "failed" | "skipped" | "manual";

export interface ProtocolError {
  code: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
}

export type ProtocolUiHintActionIntent = "primary" | "default" | "danger";
export type ProtocolUiHintLevel = "info" | "warning" | "danger";

export interface ProtocolUiHintAction {
  key: string;
  label: string;
  intent: ProtocolUiHintActionIntent;
}

export interface ProtocolUiHint {
  key: string;
  level: ProtocolUiHintLevel;
  title: string;
  message: string;
  actions: ProtocolUiHintAction[];
  context?: Record<string, unknown>;
}

export interface ModelStepRecord {
  index: number;
  code: string;
  status: ProtocolStepStatus;
  elapsed_ms: number;
  summary: string;
  error?: ProtocolError;
  data?: Record<string, unknown>;
}

export interface ModelEventRecord {
  event: string;
  step_index?: number;
  timestamp_ms: number;
  message: string;
}

export interface ModelAssetRecord {
  kind: string;
  path: string;
  version: number;
  meta?: Record<string, unknown>;
}
