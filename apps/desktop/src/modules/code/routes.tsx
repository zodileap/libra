import { lazy, type ComponentType } from "react";
import { useParams } from "react-router-dom";
import { SessionPage } from "../../widgets/session/page";
import { CODE_SESSION_UI_CONFIG } from "../../widgets/session/config";
import { CodeAgentPage } from "./pages/code-agent-page";
import { CodeAgentSettingsPage } from "./pages/code-agent-settings-page";
import { CodeWorkflowPage } from "./pages/code-workflow-page";

// 描述:
//
//   - 智能体模块开关键。
export const AGENT_MODULE_KEY = "agent" as const;

// 描述:
//
//   - 会话模块开关键。
export const SESSION_MODULE_KEY = "session" as const;

// 描述:
//
//   - 工作流模块开关键。
export const WORKFLOW_MODULE_KEY = "workflow" as const;

// 描述:
//
//   - 代码智能体根路径。
export const CODE_AGENT_ROOT_PATH = "/agents/code" as const;

// 描述:
//
//   - 代码智能体设置页路径。
export const CODE_AGENT_SETTINGS_PATH = "/agents/code/settings" as const;

// 描述:
//
//   - 代码智能体工作流页路径。
export const CODE_WORKFLOW_PATH = "/agents/code/workflows" as const;

// 描述：代码智能体会话页桥接组件，统一从路由参数读取 sessionId 并透传通用会话能力。
function CodeSessionRoutePage(props: any) {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionPage agentKey="code" sessionId={String(sessionId || "")} sessionUiConfig={CODE_SESSION_UI_CONFIG} {...props} />;
}

// 描述：代码智能体入口页懒加载。
export const CodeAgentPageLazy = lazy(async () => {
  return { default: CodeAgentPage as ComponentType<any> };
});

// 描述：代码智能体会话页懒加载。
export const CodeSessionPageLazy = lazy(async () => {
  return { default: CodeSessionRoutePage as ComponentType<any> };
});

// 描述：代码智能体设置页懒加载入口。
export const CodeAgentSettingsPageLazy = lazy(async () => {
  return { default: CodeAgentSettingsPage as ComponentType<any> };
});

// 描述：代码智能体工作流页懒加载入口。
export const CodeWorkflowPageLazy = lazy(async () => {
  return { default: CodeWorkflowPage as ComponentType<any> };
});

// 描述：代码智能体侧边栏快捷入口配置，由 code 路由模块定义。
export const CODE_SIDEBAR_QUICK_ACTIONS = [
  { key: "settings", label: "智能体设置", icon: "settings", path: CODE_AGENT_SETTINGS_PATH },
  { key: "workflow", label: "工作流设置", icon: "account_tree", path: CODE_WORKFLOW_PATH },
] as const;

// 描述：构建代码智能体工作流页跳转地址，保持 workflowId 查询参数一致。
export function resolveCodeWorkflowPath(workflowId: string): string {
  if (!workflowId) {
    return CODE_WORKFLOW_PATH;
  }
  return `${CODE_WORKFLOW_PATH}?workflowId=${encodeURIComponent(workflowId)}`;
}
