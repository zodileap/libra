import type { AgentKey } from "../../shared/types";

export interface SessionAgentUiConfig {
  sessionKind: "workflow" | "command";
  emptyStatePrimary: string;
  emptyStateSecondary: string;
  inputPlaceholder: string;
  workflowFallbackLabel: string;
}

export const MODEL_SESSION_UI_CONFIG: SessionAgentUiConfig = {
  sessionKind: "workflow",
  emptyStatePrimary: "描述你要在 Blender 中完成的目标，智能体会按步骤执行并流式反馈。",
  emptyStateSecondary: "可直接输入“打开 blender 并创建立方体后贴图”这类完整任务。",
  inputPlaceholder: "输入需求，例如：打开模型并加厚；或导出当前模型到 exports",
  workflowFallbackLabel: "模型工作流",
};

export const CODE_SESSION_UI_CONFIG: SessionAgentUiConfig = {
  sessionKind: "command",
  emptyStatePrimary: "描述你要修改的代码模块与目标目录，智能体会在当前会话中持续执行。",
  emptyStateSecondary: "建议明确路径、技术栈和输出要求，结果更稳定。",
  inputPlaceholder: "继续提问，或要求智能体修改结果...",
  workflowFallbackLabel: "代码工作流",
};

// 描述：根据智能体标识返回会话 UI 配置，供通用会话组件使用，避免组件内部写死业务文案。
export function resolveSessionUiConfig(agentKey: AgentKey): SessionAgentUiConfig {
  return agentKey === "model" ? MODEL_SESSION_UI_CONFIG : CODE_SESSION_UI_CONFIG;
}
