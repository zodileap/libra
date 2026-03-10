import type { AgentKey } from "../../shared/types";
import { translateDesktopText } from "../../shared/i18n";

export interface SessionAgentUiConfig {
  sessionKind: "workflow" | "command";
  inputPlaceholder: string;
  workflowFallbackLabel: string;
}

// 描述:
//
//   - 统一智能体会话的 UI 文案配置。
export const AGENT_SESSION_UI_CONFIG: SessionAgentUiConfig = {
  sessionKind: "command",
  inputPlaceholder: translateDesktopText("继续提问，或要求智能体修改结果..."),
  workflowFallbackLabel: translateDesktopText("智能体工作流"),
};

// 描述：根据智能体标识返回统一会话 UI 配置，供通用会话组件使用。
export function resolveSessionUiConfig(agentKey: AgentKey): SessionAgentUiConfig {
  void agentKey;
  return AGENT_SESSION_UI_CONFIG;
}
