import { Outlet } from "react-router-dom";
import { ClientSidebar } from "./widgets/sidebar";
import type { LoginUser } from "./types";

interface DesktopLayoutProps {
  user: LoginUser;
  onLogout: () => void;
}

export function DesktopLayout({ user, onLogout }: DesktopLayoutProps) {
  return (
    <div className="desk-app">
      <ClientSidebar user={user} onLogout={onLogout} />
      <main className="desk-main">
        <Outlet />
      </main>
    </div>
  );
}
