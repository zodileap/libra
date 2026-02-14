import { Outlet } from "react-router-dom";
import { ClientSidebar } from "./widgets/sidebar";
import type { LoginUser } from "./types";

interface DesktopLayoutProps {
  user: LoginUser;
  onLogout: () => void;
}

// 描述:
//
//   - 组合 Desktop 主布局，提供侧边导航、可跳转主内容区与页面承载区域。
export function DesktopLayout({ user, onLogout }: DesktopLayoutProps) {
  return (
    <div className="desk-app">
      <a className="desk-skip-link" href="#desk-main-content">
        跳转到主内容
      </a>
      <ClientSidebar user={user} onLogout={onLogout} />
      <main className="desk-main" id="desk-main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
