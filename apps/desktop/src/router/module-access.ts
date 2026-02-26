import type { AgentKey, AuthAvailableAgentItem } from "../shared/types";
import { ALL_DESKTOP_ROUTE_MODULES } from "../modules/manifest";
import type { DesktopRouteModuleKey } from "./types";

// 描述：基于构建变量解析启用模块集合；支持 "*" 和逗号分隔格式。
//
// Params:
//
//   - raw: 构建时模块白名单字符串。
//
// Returns:
//
//   - 启用模块集合。
export function resolveBuildEnabledModules(raw: string | undefined): Set<DesktopRouteModuleKey> {
  if (!raw || raw.trim() === "" || raw.trim() === "*") {
    return new Set(ALL_DESKTOP_ROUTE_MODULES);
  }

  const wanted = new Set(
    raw
      .split(",")
      .map((item) => item.trim() as DesktopRouteModuleKey)
      .filter((item) => ALL_DESKTOP_ROUTE_MODULES.includes(item)),
  );

  if (wanted.size === 0) {
    return new Set(ALL_DESKTOP_ROUTE_MODULES);
  }
  return wanted;
}

// 描述：判断当前用户是否可访问指定智能体。
//
// Params:
//
//   - availableAgents: 当前账号可用智能体列表。
//   - agentKey: 智能体标识。
//
// Returns:
//
//   - true: 已授权。
//   - false: 未授权。
export function isAgentAuthorized(availableAgents: AuthAvailableAgentItem[], agentKey: AgentKey): boolean {
  const target = agentKey.toLowerCase();
  return availableAgents.some((item) => (item.code || "").toLowerCase() === target);
}

// 描述：为路由层提供统一的模块启用判断。
//
// Params:
//
//   - enabledModules: 当前启用模块集合。
//   - moduleKey: 目标模块。
//
// Returns:
//
//   - true: 模块可用。
export function isModuleEnabled(
  enabledModules: Set<DesktopRouteModuleKey>,
  moduleKey: DesktopRouteModuleKey,
): boolean {
  return enabledModules.has(moduleKey);
}
