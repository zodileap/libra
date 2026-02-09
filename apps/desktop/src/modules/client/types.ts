export type AgentKey = "code" | "model";
export type ColorThemeMode = "light" | "dark" | "system";

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
