import type { DesktopRouteModuleKey } from "../router/types";

// 描述：声明桌面端可装配模块清单，供运行时与构建时模块过滤共用。
export const DESKTOP_ROUTE_MODULE_MANIFEST: Array<{
  key: DesktopRouteModuleKey;
  title: string;
}> = [
  { key: "settings", title: "设置" },
  { key: "skill", title: "技能" },
  { key: "mcp", title: "MCP" },
  { key: "agent", title: "智能体" },
  { key: "session", title: "会话" },
  { key: "workflow", title: "工作流" },
];

// 描述：导出模块键集合，供模块访问控制逻辑复用。
export const ALL_DESKTOP_ROUTE_MODULES = DESKTOP_ROUTE_MODULE_MANIFEST.map((item) => item.key);
