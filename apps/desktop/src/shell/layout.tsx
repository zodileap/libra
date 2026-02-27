import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AriButton, AriContainer, AriFlex } from "aries_react";
import { ClientSidebar } from "../sidebar";
import type { RouteAccess } from "../router/types";
import type { AuthAvailableAgentItem, LoginUser } from "./types";

// 描述:
//
//   - 定义桌面端布局组件入参。
interface DesktopLayoutProps {
  user: LoginUser;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
  routeAccess: RouteAccess;
}

// 描述:
//
//   - 渲染桌面端主布局，组合侧边栏与主路由内容区。
export function DesktopLayout({ user, onLogout, availableAgents, routeAccess }: DesktopLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarToggleLabel = sidebarCollapsed ? "展开侧边栏" : "收起侧边栏";

  return (
    <AriContainer
      className={`desk-app${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
      padding={0}
    >
      <AriContainer
        className="desk-app-header"
        positionType="fixed"
        ghost
        data-tauri-drag-region
      >
        <AriFlex
          className="desk-app-header-inner"
          align="flex-start"
          flexItem={[{ index: 1, flex: 1, overflow: "hidden" }]}
        >
          <AriContainer
            className={`desk-app-header-leading${sidebarCollapsed ? " is-collapsed" : " is-expanded"}`}
            padding={0}
          >
            <AriButton
              type="text"
              icon={sidebarCollapsed ? "menu_open" : "menu"}
              aria-label={sidebarToggleLabel}
              onClick={() => {
                setSidebarCollapsed((current) => !current);
              }}
            />
          </AriContainer>
          <AriContainer
            id="desk-app-header-slot"
            className="desk-app-header-slot"
            padding={{ left: "var(--z-inset-sm)", right: "var(--z-inset-sm)" }}
          />
        </AriFlex>
      </AriContainer>
      <AriContainer className="desk-app-sidebar-wrap">
        <ClientSidebar
          user={user}
          onLogout={onLogout}
          availableAgents={availableAgents}
          routeAccess={routeAccess}
        />
      </AriContainer>
      {/* 描述：主内容区容器固定启用阴影效果，确保视觉层级稳定。 */}
      <AriContainer className="desk-main" shadowMode="always">
        <Outlet />
      </AriContainer>
    </AriContainer>
  );
}
