import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AriContainer } from "aries_react";
import { ClientSidebar } from "../sidebar";
import type { RouteAccess } from "../router/types";
import type { AuthAvailableAgentItem, LoginUser } from "./types";
import { DevDebugFloat } from "../widgets/dev-debug-float";
import { DesktopAppHeader } from "../widgets/app-header";
import { DesktopHeaderSlotProvider } from "../widgets/app-header/header-slot-context";

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
  const [debugFloatVisible, setDebugFloatVisible] = useState(false);
  const [headerSlotElement, setHeaderSlotElement] = useState<HTMLElement | null>(null);

  return (
    <DesktopHeaderSlotProvider value={headerSlotElement}>
      <AriContainer
        className={`desk-app${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
        padding={0}
      >
        <DesktopAppHeader
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => {
            setSidebarCollapsed((current) => !current);
          }}
          debugFloatVisible={debugFloatVisible}
          onToggleDebugFloat={() => {
            setDebugFloatVisible((current) => !current);
          }}
          onHeaderSlotElementChange={setHeaderSlotElement}
        />
        <AriContainer className="desk-app-sidebar-wrap">
          <ClientSidebar
            user={user}
            onLogout={onLogout}
            availableAgents={availableAgents}
            routeAccess={routeAccess}
          />
        </AriContainer>
        {/* 描述：主内容区容器固定启用阴影效果，确保视觉层级稳定。 */}
        <AriContainer className="desk-main" shadowMode="always" padding={0}>
          <Outlet />
        </AriContainer>
      </AriContainer>
      <DevDebugFloat visible={debugFloatVisible} />
    </DesktopHeaderSlotProvider>
  );
}
