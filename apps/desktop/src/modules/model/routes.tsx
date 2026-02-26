import { lazy, type ComponentType } from "react";
import { ModelAgentPage } from "./pages/model-agent-page";
import { ModelSessionPage } from "./pages/model-session-page";
import { ModelAgentSettingsPage } from "./pages/model-agent-settings-page";
import { ModelWorkflowPage } from "./pages/model-workflow-page";

export const MODEL_AGENT_ROOT_PATH = "/agents/model" as const;
export const MODEL_AGENT_SETTINGS_PATH = "/agents/model/settings" as const;
export const MODEL_WORKFLOW_PATH = "/agents/model/workflows" as const;

// 描述：模型智能体入口页懒加载。
export const ModelAgentPageLazy = lazy(async () => {
  return { default: ModelAgentPage as ComponentType<any> };
});

// 描述：模型智能体会话页懒加载。
export const ModelSessionPageLazy = lazy(async () => {
  return { default: ModelSessionPage as ComponentType<any> };
});

// 描述：模型智能体设置页懒加载入口。
export const ModelAgentSettingsPageLazy = lazy(async () => {
  return { default: ModelAgentSettingsPage as ComponentType<any> };
});

// 描述：模型智能体工作流页懒加载入口。
export const ModelWorkflowPageLazy = lazy(async () => {
  return { default: ModelWorkflowPage as ComponentType<any> };
});

// 描述：模型智能体侧边栏快捷入口配置，由 model 路由模块定义。
export const MODEL_SIDEBAR_QUICK_ACTIONS = [
  { key: "settings", label: "智能体设置", icon: "settings", path: MODEL_AGENT_SETTINGS_PATH },
  { key: "workflow", label: "工作流设置", icon: "account_tree", path: MODEL_WORKFLOW_PATH },
] as const;

// 描述：构建模型智能体工作流页跳转地址，保持 workflowId 查询参数一致。
export function resolveModelWorkflowPath(workflowId: string): string {
  if (!workflowId) {
    return MODEL_WORKFLOW_PATH;
  }
  return `${MODEL_WORKFLOW_PATH}?workflowId=${encodeURIComponent(workflowId)}`;
}
