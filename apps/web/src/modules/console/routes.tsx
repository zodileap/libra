import { lazy } from "react";
import type { RouteObject } from "react-router-dom";
import type { I18nTranslates } from "aries_react";

const ConsoleLayout = lazy(() => import("./layout").then((m) => ({ default: m.ConsoleLayout })));
const ConsoleLoginPage = lazy(() => import("./widgets/login").then((m) => ({ default: m.ConsoleLoginPage })));
const ConsoleIdentitySelectPage = lazy(() =>
  import("./widgets/identity-select").then((m) => ({ default: m.ConsoleIdentitySelectPage }))
);
const ConsoleOverviewPage = lazy(() => import("./widgets/overview").then((m) => ({ default: m.ConsoleOverviewPage })));
const ConsoleIdentityManagementPage = lazy(() =>
  import("./widgets/identity-management").then((m) => ({ default: m.ConsoleIdentityManagementPage }))
);
const ConsolePermissionManagementPage = lazy(() =>
  import("./widgets/permission-management").then((m) => ({ default: m.ConsolePermissionManagementPage }))
);

// 描述：读取路由文案，缺省时返回 fallback。
function routerText(t: I18nTranslates, key: string, fallback: string): string {
  const table = (t as unknown as { router?: Record<string, string> }).router;
  return table?.[key] || fallback;
}

// 描述：管理控制台路由，包含登录、身份管理与权限管理页面。
export function consoleRoutes(t: I18nTranslates): RouteObject[] {
  return [
    {
      path: "/",
      element: <ConsoleLayout />,
      children: [
        {
          path: "login",
          element: <ConsoleLoginPage />,
          handle: { title: routerText(t, "consoleLoginTitle", "控制台登录") }
        },
        {
          path: "identity-select",
          element: <ConsoleIdentitySelectPage />,
          handle: { title: routerText(t, "consoleIdentitySelectTitle", "身份选择") }
        },
        {
          path: "console",
          element: <ConsoleOverviewPage />,
          handle: { title: routerText(t, "consoleOverviewTitle", "控制台概览") }
        },
        {
          path: "console/identities",
          element: <ConsoleIdentityManagementPage />,
          handle: { title: routerText(t, "consoleIdentityTitle", "身份管理") }
        },
        {
          path: "console/permissions",
          element: <ConsolePermissionManagementPage />,
          handle: { title: routerText(t, "consolePermissionTitle", "权限管理") }
        },
        {
          path: "*",
          element: <ConsoleLoginPage />,
          handle: { title: routerText(t, "consoleLoginTitle", "控制台登录") }
        }
      ]
    }
  ];
}
