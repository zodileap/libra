import { lazy, type ComponentType } from "react";
import { useParams } from "react-router-dom";
import { SessionPage } from "../../widgets/session/page";
import { AGENT_SESSION_UI_CONFIG } from "../../widgets/session/config";
import { resolveWorkflowEditorPath, WORKFLOW_PAGE_PATH } from "../common/routes";
import { translateDesktopText } from "../../shared/i18n";
import { AgentHomePage } from "./pages/agent-home-page";
import { AgentSettingsPage } from "./pages/agent-settings-page";
import { ProjectSettingsPage } from "./pages/project-settings-page";
import { AgentWorkflowPage } from "./pages/agent-workflow-page";

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
//   - 统一智能体根路径，当前 Home 直接承载项目入口。
export const AGENT_HOME_PATH = "/home" as const;

// 描述:
//
//   - 统一智能体设置页路径。
export const AGENT_SETTINGS_PATH = "/settings/agent" as const;

// 描述:
//
//   - 智能体工作流页路径。
export const AGENT_WORKFLOW_PATH = WORKFLOW_PAGE_PATH;

// 描述:
//
//   - 项目设置页路径。
export const PROJECT_SETTINGS_PATH = "/project-settings" as const;

// 描述:
//
//   - 统一智能体会话页路径前缀。
export const AGENT_SESSION_PATH_PREFIX = "/session" as const;

// 描述：构建统一智能体会话页路径。
//
// Params:
//
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 会话页路径。
export function resolveAgentSessionPath(sessionId: string): string {
  return `${AGENT_SESSION_PATH_PREFIX}/${encodeURIComponent(sessionId)}`;
}

// 描述：统一智能体会话页桥接组件，统一从路由参数读取 sessionId 并透传通用会话能力。
function AgentSessionRoutePage(props: any) {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionPage agentKey="agent" sessionId={String(sessionId || "")} sessionUiConfig={AGENT_SESSION_UI_CONFIG} {...props} />;
}

// 描述：智能体入口页懒加载。
export const AgentHomePageLazy = lazy(async () => {
  return { default: AgentHomePage as ComponentType<any> };
});

// 描述：统一智能体会话页懒加载。
export const AgentSessionPageLazy = lazy(async () => {
  return { default: AgentSessionRoutePage as ComponentType<any> };
});

// 描述：智能体设置页懒加载入口。
export const AgentSettingsPageLazy = lazy(async () => {
  return { default: AgentSettingsPage as ComponentType<any> };
});

// 描述：智能体工作流页懒加载入口。
export const AgentWorkflowPageLazy = lazy(async () => {
  return { default: AgentWorkflowPage as ComponentType<any> };
});

// 描述：项目设置页懒加载入口。
export const ProjectSettingsPageLazy = lazy(async () => {
  return { default: ProjectSettingsPage as ComponentType<any> };
});

// 描述：统一智能体侧边栏快捷入口配置，由路由模块定义。
export const AGENT_SIDEBAR_QUICK_ACTIONS = [
  { key: "settings", label: translateDesktopText("智能体设置"), icon: "settings", path: AGENT_SETTINGS_PATH },
  { key: "workflow", label: translateDesktopText("工作流设置"), icon: "account_tree", path: AGENT_WORKFLOW_PATH },
] as const;

// 描述：构建统一智能体工作流页跳转地址，保持 workflowId 查询参数一致。
export function resolveAgentWorkflowPath(workflowId: string): string {
  return resolveWorkflowEditorPath(workflowId);
}
