import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AriContainer } from "@aries-kit/react";
import { ClientSidebar } from "../sidebar";
import type { RouteAccess } from "../router/types";
import type { AuthAvailableAgentItem, ConsoleIdentityItem, DesktopUpdateState, LoginUser } from "./types";
import { DevDebugFloat } from "../widgets/dev-debug-float";
import { DesktopAppHeader } from "../widgets/app-header";
import { DesktopHeaderSlotProvider } from "../widgets/app-header/header-slot-context";

// 描述:
//
//   - 定义桌面端布局组件入参。
interface DesktopLayoutProps {
  user: LoginUser;
  selectedIdentity: ConsoleIdentityItem | null;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
  routeAccess: RouteAccess;
  desktopUpdateState: DesktopUpdateState;
  onCheckDesktopUpdate: () => Promise<void>;
  onInstallDesktopUpdate: () => Promise<void>;
}

// 描述:
//
//   - 渲染桌面端主布局，组合侧边栏与主路由内容区。
export function DesktopLayout({
  user,
  selectedIdentity,
  onLogout,
  availableAgents,
  routeAccess,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onInstallDesktopUpdate,
}: DesktopLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [debugFloatVisible, setDebugFloatVisible] = useState(false);
  const [headerSlotElement, setHeaderSlotElement] = useState<HTMLElement | null>(null);

  return (
    <DesktopHeaderSlotProvider value={headerSlotElement}>
      <AriContainer
        className={`desk-app${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
        variant="plain"
        showBorderRadius={false}
      >
        <DesktopAppHeader
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => {
            setSidebarCollapsed((current) => !current);
          }}
          desktopUpdateState={desktopUpdateState}
          onCheckDesktopUpdate={onCheckDesktopUpdate}
          onInstallDesktopUpdate={onInstallDesktopUpdate}
          debugFloatVisible={debugFloatVisible}
          onToggleDebugFloat={() => {
            setDebugFloatVisible((current) => !current);
          }}
          onHeaderSlotElementChange={setHeaderSlotElement}
        />
        <AriContainer className="desk-app-sidebar-wrap" variant="plain" padding={0} showBorderRadius={false}>
          <ClientSidebar
            user={user}
            selectedIdentity={selectedIdentity}
            onLogout={onLogout}
            availableAgents={availableAgents}
            routeAccess={routeAccess}
            desktopUpdateState={desktopUpdateState}
            onCheckDesktopUpdate={onCheckDesktopUpdate}
            onInstallDesktopUpdate={onInstallDesktopUpdate}
          />
        </AriContainer>
        {/* 描述：透明窗口下主面板不再叠加组件阴影与圆角，避免与系统窗口阴影重叠。 */}
        <AriContainer
          className="desk-main"
          variant="plain"
          padding={0}
          shadowMode="never"
          showBorderRadius={false}
        >
          <Outlet />
        </AriContainer>
      </AriContainer>
      <DevDebugFloat visible={debugFloatVisible} />
    </DesktopHeaderSlotProvider>
  );
}
