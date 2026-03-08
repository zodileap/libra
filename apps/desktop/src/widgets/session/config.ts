import type { AgentKey } from "../../shared/types";

export interface SessionAgentUiConfig {
  sessionKind: "workflow" | "command";
  emptyStatePrimary: string;
  emptyStateSecondary: string;
  inputPlaceholder: string;
  workflowFallbackLabel: string;
}

// 描述:
//
//   - 统一智能体会话的 UI 文案配置。
export const AGENT_SESSION_UI_CONFIG: SessionAgentUiConfig = {
  sessionKind: "command",
  emptyStatePrimary: "描述你要修改的代码模块与目标目录，智能体会在当前会话中持续执行。",
  emptyStateSecondary: "建议明确路径、技术栈和输出要求，结果更稳定。",
  inputPlaceholder: "继续提问，或要求智能体修改结果...",
  workflowFallbackLabel: "智能体工作流",
};

// 描述：根据智能体标识返回统一会话 UI 配置，供通用会话组件使用。
export function resolveSessionUiConfig(agentKey: AgentKey): SessionAgentUiConfig {
  void agentKey;
  return AGENT_SESSION_UI_CONFIG;
}
