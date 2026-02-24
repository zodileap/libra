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
      <AriContainer className="desk-main">
        <Outlet />
      </AriContainer>
    </AriContainer>
  );
}
