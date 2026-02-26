import { lazy } from "react";
import { AGENTS } from "../../shared/data";
import type { AuthAvailableAgentItem } from "../../shared/types";
import type { RouteAccess } from "../../router/types";

export const SETTINGS_MODULE_KEY = "settings" as const;

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

// 描述：通用模块中的 AI Key 页面懒加载入口。
export const CommonAiKeyPageLazy = lazy(async () => {
  const module = await import("./pages/ai-key-page");
  return { default: module.AiKeyPage };
});

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

  return AGENTS.map((agent) => {
    const authed = authorizedCodes.has(agent.key) && routeAccess.isAgentEnabled(agent.key);
    const moduleEnabled = routeAccess.isModuleEnabled("agent");
    const enabled = moduleEnabled && authed;
    return {
      key: agent.key,
      label: `${agent.name}${authed ? "（已授权）" : "（未授权）"}`,
      path: `/agents/${agent.key}`,
      enabled,
      deniedMessage: moduleEnabled
        ? "当前账号尚未开通该智能体，请先完成授权。"
        : "当前构建未启用智能体模块。",
    };
  });
}

interface SettingsSidebarItem {
  key: string;
  label: string;
  path: string;
}

// 描述：生成设置页侧边栏菜单，由 common 路由模块集中定义。
export function resolveSettingsSidebarItems(routeAccess: RouteAccess): SettingsSidebarItem[] {
  const items: SettingsSidebarItem[] = [{ key: "general", label: "General", path: "/settings/general" }];

  if (routeAccess.isAgentEnabled("code")) {
    items.push({ key: "code", label: "Code Agent", path: "/agents/code/settings" });
  }

  if (routeAccess.isAgentEnabled("model")) {
    items.push({ key: "model", label: "Model Agent", path: "/agents/model/settings" });
  }

  return items;
}

// 描述：AI Key 页面侧边栏文案，由 common 路由模块统一定义。
export const AI_KEY_SIDEBAR_CONTENT = {
  title: "AI Key 管理",
  description: "管理本地可用模型提供方密钥。",
};
