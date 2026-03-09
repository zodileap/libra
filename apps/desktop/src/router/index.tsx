import { Suspense, useMemo, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AriContainer, AriTypography } from "aries_react";
import {
  CommonAiKeyPageLazy,
  CommonWorkflowEditorPageLazy,
  CommonLoginPageLazy,
  CommonMcpPageLazy,
  CommonSkillsPageLazy,
  CommonWorkflowsPageLazy,
  MCP_MODULE_KEY,
  MCP_PAGE_PATH,
  SETTINGS_IDENTITIES_PATH,
  SETTINGS_OVERVIEW_PATH,
  SETTINGS_PERMISSIONS_PATH,
  SettingsAdminIdentitiesPageLazy,
  SettingsAdminOverviewPageLazy,
  SettingsAdminPermissionsPageLazy,
  SKILL_MODULE_KEY,
  SKILL_PAGE_PATH,
  SETTINGS_MODULE_KEY,
  SettingsGeneralPageLazy,
  WORKFLOW_PAGE_PATH,
  WORKFLOW_EDITOR_PAGE_PATH,
} from "../modules/common/routes";
import {
  AGENT_MODULE_KEY,
  AgentHomePageLazy,
  ProjectSettingsPageLazy,
  AgentSettingsPageLazy,
  AGENT_HOME_PATH,
  AGENT_SETTINGS_PATH,
  PROJECT_SETTINGS_PATH,
  AGENT_SESSION_PATH_PREFIX,
  SESSION_MODULE_KEY,
  AgentSessionPageLazy,
  WORKFLOW_MODULE_KEY,
} from "../modules/agent/routes";
import { DesktopLayout } from "../shell/layout";
import type { AgentKey } from "../shared/types";
import { isAgentAuthorized, isModuleEnabled, resolveBuildEnabledModules } from "./module-access";
import type { AuthState, DesktopRouteModuleKey, RouteAccess } from "./types";
import { useDesktopI18n } from "../shared/i18n";

// 描述:
//
//   - 构建阶段可用模块集合，供路由守卫与导航控制复用。
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
  if (pathname.startsWith(AGENT_HOME_PATH)) {
    return "agent";
  }
  if (pathname.startsWith(AGENT_SETTINGS_PATH)) {
    return "agent";
  }
  if (pathname.startsWith(PROJECT_SETTINGS_PATH)) {
    return "agent";
  }
  if (pathname.startsWith(AGENT_SESSION_PATH_PREFIX)) {
    return "agent";
  }
  return null;
}

// 描述：判断当前身份是否具备管理台默认落点资格；当前仅对权限管理员身份启用 Overview 优先级。
//
// Params:
//
//   - auth: 当前认证状态。
//
// Returns:
//
//   - true: 登录后应优先进入管理概览。
function shouldPreferAdminOverview(auth: AuthState): boolean {
  if (!auth.selectedIdentity) {
    return false;
  }
  return auth.selectedIdentity.roles.some((role) => role === "permission_admin");
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
  if (!auth.user) {
    return "/login";
  }
  if (routeAccess.isModuleEnabled(SETTINGS_MODULE_KEY) && shouldPreferAdminOverview(auth)) {
    return SETTINGS_OVERVIEW_PATH;
  }
  if (routeAccess.isModuleEnabled(AGENT_MODULE_KEY) && routeAccess.isAgentEnabled("agent")) {
    return AGENT_HOME_PATH;
  }
  if (routeAccess.isModuleEnabled(WORKFLOW_MODULE_KEY)) {
    return WORKFLOW_PAGE_PATH;
  }
  if (routeAccess.isModuleEnabled(SKILL_MODULE_KEY)) {
    return SKILL_PAGE_PATH;
  }
  if (routeAccess.isModuleEnabled(MCP_MODULE_KEY)) {
    return MCP_PAGE_PATH;
  }
  return "/ai-keys";
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
    return routeAccess.isModuleEnabled(AGENT_MODULE_KEY) && routeAccess.isAgentEnabled("agent");
  }

  if (pathname.startsWith("/settings")) {
    return routeAccess.isModuleEnabled(SETTINGS_MODULE_KEY);
  }

  if (pathname.startsWith("/skills")) {
    return routeAccess.isModuleEnabled(SKILL_MODULE_KEY);
  }

  if (pathname.startsWith(MCP_PAGE_PATH)) {
    return routeAccess.isModuleEnabled(MCP_MODULE_KEY);
  }

  if (pathname.startsWith(WORKFLOW_PAGE_PATH)) {
    return routeAccess.isModuleEnabled(WORKFLOW_MODULE_KEY);
  }

  if (pathname.startsWith("/ai-keys")) {
    return true;
  }

  if (pathname.startsWith(AGENT_SESSION_PATH_PREFIX)) {
    return (
      routeAccess.isModuleEnabled(SESSION_MODULE_KEY) &&
      routeAccess.isAgentEnabled("agent")
    );
  }

  if (pathname.startsWith(PROJECT_SETTINGS_PATH)) {
    return routeAccess.isModuleEnabled(AGENT_MODULE_KEY) && routeAccess.isAgentEnabled("agent");
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
  const { t } = useDesktopI18n();
  return (
    <AriContainer className="desk-main-loading">
      <AriTypography variant="caption" value={t("页面加载中...")} />
    </AriContainer>
  );
}

// 描述：为单个路由页面提供局部懒加载兜底，避免全局 Suspense 造成整页（含侧边栏）闪烁。
function withRouteLoading(children: ReactNode) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>;
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
    <Routes>
      <Route
        path="/login"
        element={
          auth.user
            ? <Navigate to={fallbackPath} replace />
            : withRouteLoading(<CommonLoginPageLazy onLogin={auth.login} />)
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
                desktopUpdateState={auth.desktopUpdateState}
                onCheckDesktopUpdate={auth.checkDesktopUpdate}
                onInstallDesktopUpdate={auth.installDesktopUpdate}
                selectedIdentity={auth.selectedIdentity}
              />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to={fallbackPath} replace />} />

        <Route
          path="home"
          element={withRouteLoading(
            <RouteGuard auth={auth} routeAccess={routeAccess}>
              <AgentHomePageLazy dccMcpCapabilities={auth.dccMcpCapabilities} currentUser={auth.user} />
            </RouteGuard>,
          )}
        />

          {routeAccess.isModuleEnabled(SKILL_MODULE_KEY) ? (
            <Route
              path={SKILL_PAGE_PATH.slice(1)}
              element={withRouteLoading(<CommonSkillsPageLazy />)}
            />
          ) : null}

          {routeAccess.isModuleEnabled(MCP_MODULE_KEY) ? (
            <Route
              path={MCP_PAGE_PATH.slice(1)}
              element={withRouteLoading(<CommonMcpPageLazy />)}
            />
          ) : null}

          {routeAccess.isModuleEnabled(WORKFLOW_MODULE_KEY) ? (
            <>
              <Route
                path={WORKFLOW_PAGE_PATH.slice(1)}
                element={withRouteLoading(<CommonWorkflowsPageLazy />)}
              />
              <Route
                path={WORKFLOW_EDITOR_PAGE_PATH.slice(1)}
                element={withRouteLoading(<CommonWorkflowEditorPageLazy />)}
              />
            </>
          ) : null}

          {routeAccess.isModuleEnabled(SETTINGS_MODULE_KEY) ? (
            <>
              <Route path="settings" element={<Navigate to="/settings/general" replace />} />
              <Route
                path="settings/general"
                element={withRouteLoading(
                  <SettingsGeneralPageLazy
                    colorThemeMode={auth.colorThemeMode}
                    onColorThemeModeChange={auth.setColorThemeMode}
                    backendConfig={auth.backendConfig}
                    selectedIdentity={auth.selectedIdentity}
                    onBackendConfigChange={auth.setBackendConfig}
                    onBackendConfigReset={auth.resetBackendConfig}
                  />,
                )}
              />
              <Route
                path={SETTINGS_OVERVIEW_PATH.slice(1)}
                element={withRouteLoading(<SettingsAdminOverviewPageLazy />)}
              />
              <Route
                path={SETTINGS_IDENTITIES_PATH.slice(1)}
                element={withRouteLoading(
                  <SettingsAdminIdentitiesPageLazy
                    selectedIdentity={auth.selectedIdentity}
                    onSelectIdentity={auth.setSelectedIdentity}
                  />,
                )}
              />
              <Route
                path={SETTINGS_PERMISSIONS_PATH.slice(1)}
                element={withRouteLoading(<SettingsAdminPermissionsPageLazy />)}
              />
              <Route
                path="settings/agent"
                element={withRouteLoading(
                  <RouteGuard auth={auth} routeAccess={routeAccess}>
                    <AgentSettingsPageLazy />
                  </RouteGuard>,
                )}
              />
            </>
          ) : null}

          {routeAccess.isModuleEnabled(AGENT_MODULE_KEY) ? (
            <>
              <Route
                path="project-settings"
                element={
                  withRouteLoading(
                    <RouteGuard auth={auth} routeAccess={routeAccess}>
                      <ProjectSettingsPageLazy />
                    </RouteGuard>,
                  )
                }
              />
            </>
          ) : null}

        <Route
          path="ai-keys"
          element={withRouteLoading(<CommonAiKeyPageLazy aiKeys={auth.aiKeys} onAiKeysChange={auth.setAiKeys} />)}
        />

          {routeAccess.isModuleEnabled(SESSION_MODULE_KEY) ? (
            <Route
              path="session/:sessionId"
              element={
                withRouteLoading(
                  <RouteGuard auth={auth} routeAccess={routeAccess}>
                    <AgentSessionPageLazy
                      currentUser={auth.user}
                      dccMcpCapabilities={auth.dccMcpCapabilities}
                      aiKeys={auth.aiKeys}
                    />
                  </RouteGuard>,
                )
              }
            />
          ) : null}

      </Route>

      <Route
        path="*"
        element={<Navigate to={auth.user ? fallbackPath : "/login"} replace />}
      />
    </Routes>
  );
}
