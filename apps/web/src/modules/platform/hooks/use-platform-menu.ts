import { useMemo } from "react";
import type { I18nTranslates } from "aries_react";
import type { PlatformMenuItem } from "../types";

function routerText(t: I18nTranslates, key: string, fallback: string): string {
  const table = (t as unknown as { router?: Record<string, string> }).router;
  return table?.[key] || fallback;
}

export function usePlatformMenu(t: I18nTranslates): PlatformMenuItem[] {
  return useMemo(
    () => [
      {
        key: "code",
        label: routerText(t, "codeAgentTitle", "代码智能体"),
        path: "/agents/code",
        description: routerText(t, "codeAgentDescription", "代码生成、编辑与预览")
      },
      {
        key: "model3d",
        label: routerText(t, "modelAgentTitle", "三维模型智能体"),
        path: "/agents/model3d",
        description: routerText(t, "modelAgentDescription", "三维模型生成与展示")
      }
    ],
    [t]
  );
}
