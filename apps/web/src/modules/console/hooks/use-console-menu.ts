import { useMemo } from "react";
import type { I18nTranslates } from "aries_react";
import type { ConsoleMenuItem } from "../types";

// 描述：读取路由文案，缺省时返回 fallback。
function routerText(t: I18nTranslates, key: string, fallback: string): string {
  const table = (t as unknown as { router?: Record<string, string> }).router;
  return table?.[key] || fallback;
}

// 描述：生成控制台菜单定义，包含权限管理的层级菜单。
export function useConsoleMenu(t: I18nTranslates): ConsoleMenuItem[] {
  return useMemo(
    () => [
      {
        key: "overview",
        label: routerText(t, "consoleOverviewTitle", "控制台概览"),
        path: "/console"
      },
      {
        key: "identities",
        label: routerText(t, "consoleIdentityTitle", "身份管理"),
        path: "/console/identities"
      },
      {
        key: "permissions",
        label: routerText(t, "consolePermissionTitle", "权限管理"),
        path: "/console/permissions",
        children: [
          {
            key: "permissions-model",
            label: routerText(t, "consolePermissionModelTitle", "模型权限授权"),
            path: "/console/permissions"
          }
        ]
      }
    ],
    [t]
  );
}
