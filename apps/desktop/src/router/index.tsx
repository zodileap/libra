import { Suspense, useMemo } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AriContainer, AriTypography } from "aries_react";
import {
  CommonAiKeyPageLazy,
  CommonHomePageLazy,
  CommonLoginPageLazy,
  SETTINGS_MODULE_KEY,
  SettingsGeneralPageLazy,
} from "../modules/common/routes";
import {
  AGENT_MODULE_KEY,
  CodeAgentPageLazy,
  CodeAgentSettingsPageLazy,
  SESSION_MODULE_KEY,
  CodeSessionPageLazy,
  WORKFLOW_MODULE_KEY,
  CodeWorkflowPageLazy,
} from "../modules/code/routes";
import {
  ModelAgentPageLazy,
  ModelAgentSettingsPageLazy,
  ModelSessionPageLazy,
  ModelWorkflowPageLazy,
} from "../modules/model/routes";
import { DesktopLayout } from "../shell/layout";
import type { AgentKey } from "../shared/types";
import { isAgentAuthorized, isModuleEnabled, resolveBuildEnabledModules } from "./module-access";
import type { AuthState, DesktopRouteModuleKey, RouteAccess } from "./types";

const buildEnabledModuleSet = resolveBuildEnabledModules(__DESKTOP_ENABLED_MODULES__);

// 描述：提取路径中的智能体标识，供权限守卫统一复用。
//
// Params:
//
//   - pathname: 当前路径。
//
// Returns:
//
//   - 匹配到的智能体 key；若路径不含智能体则返回 null。
function resolveAgentKeyFromPathname(pathname: string): AgentKey | null {
  if (pathname.startsWith("/agents/model")) {
    return "model";
  }
  if (pathname.startsWith("/agents/code")) {
    return "code";
  }
  return null;
}

// 描述：计算已登录后的默认落地页，保证模块被禁用时仍可回退到可访问路径。
//
// Params:
//
//   - auth: 当前认证状态。
//   - routeAccess: 路由可见性能力。
//
// Returns:
//
//   - 已登录场景的可访问路径。
function resolveAuthedFallbackPath(auth: AuthState, routeAccess: RouteAccess): string {
  void routeAccess;
  return auth.user ? "/home" : "/login";
}

// 描述：判断当前路径是否允许访问，统一处理模块开关与智能体授权。
//
// Params:
//
//   - pathname: 当前路径。
//   - auth: 当前认证状态。
//   - routeAccess: 路由可见性能力。
//
// Returns:
//
//   - true: 可访问。
function canAccessPath(pathname: string, auth: AuthState, routeAccess: RouteAccess): boolean {
  if (pathname.startsWith("/login")) {
    return true;
  }

  if (pathname.startsWith("/home")) {
    return true;
  }

  if (pathname.startsWith("/settings")) {
    return routeAccess.isModuleEnabled(SETTINGS_MODULE_KEY);
  }

  if (pathname.startsWith("/ai-keys")) {
    return true;
  }

  if (pathname.startsWith("/agents/") && pathname.includes("/session/")) {
    return (
      routeAccess.isModuleEnabled(SESSION_MODULE_KEY) &&
      !!resolveAgentKeyFromPathname(pathname) &&
      routeAccess.isAgentEnabled(resolveAgentKeyFromPathname(pathname) as AgentKey)
    );
  }

  if (pathname.startsWith("/agents/") && pathname.includes("/workflows")) {
    return (
      routeAccess.isModuleEnabled(WORKFLOW_MODULE_KEY) &&
      !!resolveAgentKeyFromPathname(pathname) &&
      routeAccess.isAgentEnabled(resolveAgentKeyFromPathname(pathname) as AgentKey)
    );
  }

  if (pathname.startsWith("/agents/")) {
    const agentKey = resolveAgentKeyFromPathname(pathname);
    return !!agentKey && routeAccess.isModuleEnabled(AGENT_MODULE_KEY) && routeAccess.isAgentEnabled(agentKey);
  }

  return true;
}

// 描述：按当前用户状态与构建白名单生成路由访问能力。
//
// Params:
//
//   - auth: 当前认证状态。
//
// Returns:
//
//   - 路由访问能力对象。
function useRouteAccess(auth: AuthState): RouteAccess {
  return useMemo(() => {
    const enabledModules = new Set<DesktopRouteModuleKey>(buildEnabledModuleSet);
    const isAgentEnabled = (agentKey: AgentKey) => isAgentAuthorized(auth.availableAgents, agentKey);

    return {
      enabledModules,
      isModuleEnabled: (moduleKey: DesktopRouteModuleKey) => isModuleEnabled(enabledModules, moduleKey),
      isAgentEnabled,
    };
  }, [auth.availableAgents]);
}

// 描述：提供统一页面加载骨架，避免懒加载时出现空白闪烁。
function RouteLoadingFallback() {
  return (
    <AriContainer className="desk-main-loading">
      <AriTypography variant="caption" value="页面加载中..." />
    </AriContainer>
  );
}

// 描述：在路由渲染前进行模块与权限守卫，不改变页面业务逻辑。
function RouteGuard({ auth, routeAccess, children }: { auth: AuthState; routeAccess: RouteAccess; children: JSX.Element }) {
  const location = useLocation();

  if (!canAccessPath(location.pathname, auth, routeAccess)) {
    return <Navigate to={resolveAuthedFallbackPath(auth, routeAccess)} replace />;
  }

  return children;
}

// 描述：桌面端总路由入口，统一编排登录态、侧边栏布局与 modules 路由模块。
export function DesktopRouter({ auth }: { auth: AuthState }) {
  const routeAccess = useRouteAccess(auth);
  const fallbackPath = resolveAuthedFallbackPath(auth, routeAccess);

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route
          path="/login"
          element={
            auth.user ? <Navigate to={fallbackPath} replace /> : <CommonLoginPageLazy onLogin={auth.login} />
          }
        />

        <Route
          path="/"
          element={
            auth.user ? (
              <DesktopLayout
                user={auth.user}
                onLogout={auth.logout}
                availableAgents={auth.availableAgents}
                routeAccess={routeAccess}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route index element={<Navigate to={fallbackPath} replace />} />

          <Route path="home" element={<CommonHomePageLazy availableAgents={auth.availableAgents} />} />

          {routeAccess.isModuleEnabled(SETTINGS_MODULE_KEY) ? (
            <>
              <Route path="settings" element={<Navigate to="/settings/general" replace />} />
              <Route
                path="settings/general"
                element={
                  <SettingsGeneralPageLazy
                    colorThemeMode={auth.colorThemeMode}
                    onColorThemeModeChange={auth.setColorThemeMode}
                  />
                }
              />
            </>
          ) : null}

          {routeAccess.isModuleEnabled(AGENT_MODULE_KEY) ? (
            <>
              <Route
                path="agents/model/settings"
                element={
                  <RouteGuard auth={auth} routeAccess={routeAccess}>
                    <ModelAgentSettingsPageLazy
                      modelMcpCapabilities={auth.modelMcpCapabilities}
                      onModelMcpCapabilitiesChange={auth.setModelMcpCapabilities}
                      blenderBridgeRuntime={auth.blenderBridgeRuntime}
                      ensureBlenderBridge={auth.ensureBlenderBridge}
                    />
                  </RouteGuard>
                }
              />
              <Route
                path="agents/code/settings"
                element={
                  <RouteGuard auth={auth} routeAccess={routeAccess}>
                    <CodeAgentSettingsPageLazy />
                  </RouteGuard>
                }
              />
            </>
          ) : null}

          <Route
            path="ai-keys"
            element={<CommonAiKeyPageLazy aiKeys={auth.aiKeys} onAiKeysChange={auth.setAiKeys} />}
          />

          {routeAccess.isModuleEnabled(AGENT_MODULE_KEY) ? (
            <Route
              path="agents/code"
              element={
                <RouteGuard auth={auth} routeAccess={routeAccess}>
                  <CodeAgentPageLazy modelMcpCapabilities={auth.modelMcpCapabilities} currentUser={auth.user} />
                </RouteGuard>
              }
            />
          ) : null}

          {routeAccess.isModuleEnabled(AGENT_MODULE_KEY) ? (
            <Route
              path="agents/model"
              element={
                <RouteGuard auth={auth} routeAccess={routeAccess}>
                  <ModelAgentPageLazy modelMcpCapabilities={auth.modelMcpCapabilities} currentUser={auth.user} />
                </RouteGuard>
              }
            />
          ) : null}

          {routeAccess.isModuleEnabled(SESSION_MODULE_KEY) ? (
            <Route
              path="agents/code/session/:sessionId"
              element={
                <RouteGuard auth={auth} routeAccess={routeAccess}>
                  <CodeSessionPageLazy
                    currentUser={auth.user}
                    modelMcpCapabilities={auth.modelMcpCapabilities}
                    blenderBridgeRuntime={auth.blenderBridgeRuntime}
                    ensureBlenderBridge={auth.ensureBlenderBridge}
                    aiKeys={auth.aiKeys}
                  />
                </RouteGuard>
              }
            />
          ) : null}

          {routeAccess.isModuleEnabled(SESSION_MODULE_KEY) ? (
            <Route
              path="agents/model/session/:sessionId"
              element={
                <RouteGuard auth={auth} routeAccess={routeAccess}>
                  <ModelSessionPageLazy
                    currentUser={auth.user}
                    modelMcpCapabilities={auth.modelMcpCapabilities}
                    blenderBridgeRuntime={auth.blenderBridgeRuntime}
                    ensureBlenderBridge={auth.ensureBlenderBridge}
                    aiKeys={auth.aiKeys}
                  />
                </RouteGuard>
              }
            />
          ) : null}

          {routeAccess.isModuleEnabled(WORKFLOW_MODULE_KEY) ? (
            <Route
              path="agents/code/workflows"
              element={
                <RouteGuard auth={auth} routeAccess={routeAccess}>
                  <CodeWorkflowPageLazy />
                </RouteGuard>
              }
            />
          ) : null}

          {routeAccess.isModuleEnabled(WORKFLOW_MODULE_KEY) ? (
            <Route
              path="agents/model/workflows"
              element={
                <RouteGuard auth={auth} routeAccess={routeAccess}>
                  <ModelWorkflowPageLazy />
                </RouteGuard>
              }
            />
          ) : null}
        </Route>

        <Route
          path="*"
          element={<Navigate to={auth.user ? fallbackPath : "/login"} replace />}
        />
      </Routes>
    </Suspense>
  );
}
