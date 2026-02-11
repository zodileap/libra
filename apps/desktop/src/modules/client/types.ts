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

export interface ModelMcpCapabilities {
  export: boolean;
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

export interface AgentLogEvent {
  trace_id: string;
  level: string;
  stage: string;
  message: string;
}
