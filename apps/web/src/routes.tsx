import { Suspense, useMemo } from "react";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { AriContainer, AriTypography, useI18n } from "aries_react";
import type { I18nTranslates } from "aries_react";
import { consoleRoutes } from "./modules/console/routes";

// 描述：挂载全局路由并在路由切换期间渲染加载状态。
export function AppRouter() {
  const { t } = useI18n(["router"]);

  const router = useMemo(() => {
    const routes = consoleRoutes(t as I18nTranslates);
    return createBrowserRouter(routes);
  }, [t]);

  return (
    <Suspense
      fallback={
        <AriContainer className="web-route-loading">
          <AriTypography variant="caption" value="页面加载中..." />
        </AriContainer>
      }
    >
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Suspense>
  );
}
