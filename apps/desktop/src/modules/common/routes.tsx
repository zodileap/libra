import { lazy } from "react";
import { AGENTS } from "../../shared/data";
import type { AuthAvailableAgentItem } from "../../shared/types";
import type { RouteAccess } from "../../router/types";

// 描述:
//
//   - 设置模块开关键。
export const SETTINGS_MODULE_KEY = "settings" as const;
// 描述:
//
//   - 技能模块开关键。
export const SKILL_MODULE_KEY = "skill" as const;
// 描述:
//
//   - MCP 模块开关键。
export const MCP_MODULE_KEY = "mcp" as const;
// 描述:
//
//   - 技能页路由路径。
export const SKILL_PAGE_PATH = "/skills" as const;
// 描述:
//
//   - MCP 页路由路径。
export const MCP_PAGE_PATH = "/mcps" as const;
// 描述:
//
//   - 全局工作流页路由路径。
export const WORKFLOW_PAGE_PATH = "/workflows" as const;
// 描述:
//
//   - 设置概览页路由路径。
export const SETTINGS_OVERVIEW_PATH = "/settings/overview" as const;
// 描述:
//
//   - 身份管理页路由路径。
export const SETTINGS_IDENTITIES_PATH = "/settings/identities" as const;
// 描述:
//
//   - 权限管理页路由路径。
export const SETTINGS_PERMISSIONS_PATH = "/settings/permissions" as const;

// 描述：通用模块中的登录页懒加载入口，属于所有构建和所有用户可见基础页面。
export const CommonLoginPageLazy = lazy(async () => {
  const module = await import("./pages/login-page");
  return { default: module.LoginPage };
});

// 描述：通用模块中的首页懒加载入口，属于所有构建和所有用户可见基础页面。
export const CommonHomePageLazy = lazy(async () => {
  const module = await import("./pages/home-page");
  return { default: module.HomePage };
});

// 描述：通用模块中的设置通用页懒加载入口。
export const SettingsGeneralPageLazy = lazy(async () => {
  const module = await import("./pages/settings-general-page");
  return { default: module.SettingsGeneralPage };
});

// 描述：通用模块中的管理概览页懒加载入口。
export const SettingsAdminOverviewPageLazy = lazy(async () => {
  const module = await import("./pages/admin-overview-page");
  return { default: module.AdminOverviewPage };
});

// 描述：通用模块中的身份管理页懒加载入口。
export const SettingsAdminIdentitiesPageLazy = lazy(async () => {
  const module = await import("./pages/admin-identities-page");
  return { default: module.AdminIdentitiesPage };
});

// 描述：通用模块中的权限管理页懒加载入口。
export const SettingsAdminPermissionsPageLazy = lazy(async () => {
  const module = await import("./pages/admin-permissions-page");
  return { default: module.AdminPermissionsPage };
});

// 描述：通用模块中的 AI Key 页面懒加载入口。
export const CommonAiKeyPageLazy = lazy(async () => {
  const module = await import("./pages/ai-key-page");
  return { default: module.AiKeyPage };
});

// 描述：通用模块中的技能页懒加载入口，承载技能安装与推荐列表。
export const CommonSkillsPageLazy = lazy(async () => {
  const module = await import("./pages/skills-page");
  return { default: module.SkillsPage };
});

// 描述：通用模块中的 MCP 页懒加载入口，承载 MCP 安装与推荐列表。
export const CommonMcpPageLazy = lazy(async () => {
  const module = await import("./pages/mcp-page");
  return { default: module.McpPage };
});

// 描述：通用模块中的全局工作流页懒加载入口，统一承载工作流编辑能力。
export const CommonWorkflowsPageLazy = lazy(async () => {
  const module = await import("./pages/workflows-page");
  return { default: module.WorkflowsPage };
});

// 描述：构建统一工作流编辑页地址，仅保留 workflowId，旧 workflowType 查询参数由调用方兼容透传。
//
// Params:
//
//   - workflowId: 工作流 ID。
//
// Returns:
//
//   - 全局工作流编辑页地址。
export function resolveWorkflowEditorPath(workflowId: string): string {
  const params = new URLSearchParams();
  if (workflowId) {
    params.set("workflowId", workflowId);
  }
  const query = params.toString();
  return query ? `${WORKFLOW_PAGE_PATH}?${query}` : WORKFLOW_PAGE_PATH;
}

// 描述:
//
//   - 定义首页侧边栏智能体入口项结构。
interface HomeSidebarAgentItem {
  key: string;
  label: string;
  path: string;
  enabled: boolean;
  deniedMessage?: string;
}

// 描述：根据模块开关与账号授权生成首页侧边栏智能体入口，供侧边栏入口层直接消费。
export function resolveHomeSidebarAgentItems(
  availableAgents: AuthAvailableAgentItem[],
  routeAccess: RouteAccess,
): HomeSidebarAgentItem[] {
  const authorizedCodes = new Set(availableAgents.map((item) => (item.code || "").toLowerCase()));
  const agent = AGENTS[0];
  const authed = authorizedCodes.size > 0 && routeAccess.isAgentEnabled(agent.key);
  const moduleEnabled = routeAccess.isModuleEnabled("agent");
  const enabled = moduleEnabled && authed;
  return [
    {
      key: agent.key,
      label: `项目${authed ? "（已授权）" : "（未授权）"}`,
      path: "/home",
      enabled,
      deniedMessage: moduleEnabled
        ? "当前账号尚未开通智能体，请先完成授权。"
        : "当前构建未启用智能体模块。",
    },
  ];
}

// 描述:
//
//   - 定义设置侧边栏菜单项结构。
interface SettingsSidebarItem {
  key: string;
  label: string;
  path: string;
}

// 描述：生成设置页侧边栏菜单，由 common 路由模块集中定义。
export function resolveSettingsSidebarItems(routeAccess: RouteAccess): SettingsSidebarItem[] {
  const items: SettingsSidebarItem[] = [
    { key: "general", label: "General", path: "/settings/general" },
    { key: "overview", label: "Overview", path: SETTINGS_OVERVIEW_PATH },
    { key: "identities", label: "Identities", path: SETTINGS_IDENTITIES_PATH },
    { key: "permissions", label: "Permissions", path: SETTINGS_PERMISSIONS_PATH },
  ];

  if (routeAccess.isAgentEnabled("agent")) {
    items.push({ key: "agent", label: "Agent", path: "/settings/agent" });
  }

  return items;
}

// 描述：AI Key 页面侧边栏文案，由 common 路由模块统一定义。
//
// Extends:
//
//   - AI Key 页面基础展示文案。
export const AI_KEY_SIDEBAR_CONTENT = {
  title: "AI Key 管理",
  description: "管理本地可用模型提供方密钥。",
};
