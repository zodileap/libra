import { Suspense, useMemo } from "react";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { useI18n } from "aries_react";
import type { I18nTranslates } from "aries_react";
import { platformRoutes } from "./modules/platform/routes";

export function AppRouter() {
  const { t } = useI18n(["router"]);

  const router = useMemo(() => {
    const routes = platformRoutes(t as I18nTranslates);
    return createBrowserRouter(routes);
  }, [t]);

  return (
    <Suspense fallback={<div className="web-route-loading">Loading...</div>}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Suspense>
  );
}
