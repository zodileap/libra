import { Outlet } from "react-router-dom";
import { AriContainer } from "aries_react";
import { ClientSidebar } from "./widgets/sidebar";
import type { AuthAvailableAgentItem, LoginUser } from "./types";

interface DesktopLayoutProps {
  user: LoginUser;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
}

export function DesktopLayout({ user, onLogout, availableAgents }: DesktopLayoutProps) {
  return (
    <AriContainer className="desk-app">
      <ClientSidebar user={user} onLogout={onLogout} availableAgents={availableAgents} />
      {/* 描述：主内容区容器固定启用阴影效果，确保视觉层级稳定。 */}
      <AriContainer className="desk-main" shadowMode="always">
        <Outlet />
      </AriContainer>
    </AriContainer>
  );
}
