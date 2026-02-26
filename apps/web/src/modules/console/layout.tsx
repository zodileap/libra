import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { AriContainer, AriFlex, AriTypography } from "aries_react";
import { ConsoleProvider } from "./provider";
import { useConsoleContext } from "./context";
import { ConsoleMenuPanel } from "./components/menu-panel";

// 描述：控制台布局内容，负责登录态路由保护与主框架渲染。
function ConsoleLayoutContent() {
  const { isAuthenticated, currentPath, identities, selectedIdentity, refreshAccessData } = useConsoleContext();
  const identitySelectPath = "/identity-select";
  const isConsoleRoute = currentPath === "/console" || currentPath.startsWith("/console/");

  useEffect(() => {
    if (isAuthenticated) {
      void refreshAccessData();
    }
  }, [isAuthenticated, refreshAccessData]);

  if (!isAuthenticated && currentPath !== "/login") {
    return <Navigate to="/login" replace />;
  }

  if (isAuthenticated && currentPath === "/login") {
    if (!selectedIdentity && identities.length > 1) {
      return <Navigate to={identitySelectPath} replace />;
    }
    return <Navigate to="/console" replace />;
  }

  if (isAuthenticated && !selectedIdentity && identities.length > 1 && isConsoleRoute) {
    return <Navigate to={identitySelectPath} replace />;
  }

  if (isAuthenticated && currentPath === identitySelectPath && (Boolean(selectedIdentity) || identities.length <= 1)) {
    return <Navigate to="/console" replace />;
  }

  if (!isAuthenticated) {
    return (
      <AriContainer className="web-console-login-shell">
        <Outlet />
      </AriContainer>
    );
  }

  if (currentPath === identitySelectPath) {
    return (
      <AriContainer className="web-console-identity-select-shell">
        <Outlet />
      </AriContainer>
    );
  }

  return (
    <AriContainer className="web-console-layout">
      <AriFlex className="web-console-layout-main" align="stretch" justify="flex-start">
        <AriContainer className="web-console-layout-side">
          <ConsoleMenuPanel />
        </AriContainer>
        <AriContainer className="web-console-layout-content">
          <AriContainer className="web-console-layout-title-row">
            <AriTypography variant="h2" value="权限与身份管理" />
            <AriTypography
              variant="caption"
              value={selectedIdentity ? `当前身份：${selectedIdentity.scopeName}` : "支持多身份、多角色与模型权限授权"}
            />
          </AriContainer>
          <AriContainer className="web-console-layout-body">
            <Outlet />
          </AriContainer>
        </AriContainer>
      </AriFlex>
    </AriContainer>
  );
}

// 描述：控制台布局入口，统一挂载 Provider。
export function ConsoleLayout() {
  return (
    <ConsoleProvider>
      <ConsoleLayoutContent />
    </ConsoleProvider>
  );
}
