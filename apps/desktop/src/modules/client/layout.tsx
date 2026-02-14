import { Outlet } from "react-router-dom";
import { ClientSidebar } from "./widgets/sidebar";
import type { AuthAvailableAgentItem, LoginUser } from "./types";

interface DesktopLayoutProps {
  user: LoginUser;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
}

export function DesktopLayout({ user, onLogout, availableAgents }: DesktopLayoutProps) {
  return (
    <div className="desk-app">
      <ClientSidebar user={user} onLogout={onLogout} availableAgents={availableAgents} />
      <main className="desk-main">
        <Outlet />
      </main>
    </div>
  );
}
