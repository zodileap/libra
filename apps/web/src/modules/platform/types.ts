import type { I18nTranslates } from "aries_react";

export type AgentKind = "code" | "model3d";

export interface PlatformMenuItem {
  key: AgentKind;
  label: string;
  path: string;
  description: string;
}

export interface PlatformContextType {
  t: I18nTranslates;
  menuItems: PlatformMenuItem[];
  currentPath: string;
}

export type CodeRole = "user" | "assistant";

export interface CodeMessage {
  id: string;
  role: CodeRole;
  content: string;
  createdAt: string;
}

export type AssetKind = "framework" | "component" | "module";

export interface ConstraintAsset {
  id: string;
  kind: AssetKind;
  name: string;
  source: string;
  description: string;
}

export interface CodeAgentState {
  messages: CodeMessage[];
  assets: ConstraintAsset[];
  previewUrl: string;
}

export interface ModelTask {
  id: string;
  prompt: string;
  status: "queued" | "running" | "success" | "failed";
  createdAt: string;
}
