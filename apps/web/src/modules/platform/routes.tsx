import { lazy } from "react";
import type { RouteObject } from "react-router-dom";
import type { I18nTranslates } from "aries_react";

const PlatformLayout = lazy(() => import("./layout").then((m) => ({ default: m.PlatformLayout })));
const PlatformHomePage = lazy(() => import("./widgets/home").then((m) => ({ default: m.PlatformHomePage })));
const CodeAgentPage = lazy(() => import("./widgets/code-agent").then((m) => ({ default: m.CodeAgentPage })));
const ModelAgentPage = lazy(() => import("./widgets/model-agent").then((m) => ({ default: m.ModelAgentPage })));

function routerText(t: I18nTranslates, key: string, fallback: string): string {
  const table = (t as unknown as { router?: Record<string, string> }).router;
  return table?.[key] || fallback;
}

export function platformRoutes(t: I18nTranslates): RouteObject[] {
  return [
    {
      path: "/",
      element: <PlatformLayout />,
      children: [
        {
          index: true,
          element: <PlatformHomePage />,
          handle: { title: routerText(t, "platformTitle", "智能体平台") }
        },
        {
          path: "agents/code",
          element: <CodeAgentPage />,
          handle: { title: routerText(t, "codeAgentTitle", "代码智能体") }
        },
        {
          path: "agents/model3d",
          element: <ModelAgentPage />,
          handle: { title: routerText(t, "modelAgentTitle", "三维模型智能体") }
        },
        {
          path: "*",
          element: <PlatformHomePage />,
          handle: { title: routerText(t, "platformTitle", "智能体平台") }
        }
      ]
    }
  ];
}
