import { useMemo, useState } from "react";
import { AriContainer, AriMenu, AriTooltip } from "aries_react";
import { useNavigate } from "react-router-dom";
import type { RouteAccess } from "../../router/types";
import type { LoginUser } from "../../shell/types";
import { SidebarEntryContent } from "./sidebar-entry-content";

interface UserHoverMenuProps {
  user: LoginUser;
  onLogout: () => Promise<void>;
  routeAccess: RouteAccess;
}

// 描述：渲染用户悬浮菜单入口，统一承载设置、AI Key 与登出操作。
export function UserHoverMenu({ user, onLogout, routeAccess }: UserHoverMenuProps) {
  const navigate = useNavigate();
  const [entryHovered, setEntryHovered] = useState(false);
  const menuItems = useMemo(() => {
    const next = [] as Array<{ key: string; label: string; icon: string }>;

    if (routeAccess.isModuleEnabled("settings")) {
      next.push({ key: "settings", label: "设置", icon: "settings" });
    }

    next.push({ key: "ai-key", label: "AI Key", icon: "vpn_key" });
    next.push({ key: "logout", label: "登出", icon: "logout" });
    return next;
  }, [routeAccess]);

  const content = (
    <AriMenu
      items={menuItems}
      onSelect={(key: string) => {
        if (key === "settings") navigate("/settings/general");
        if (key === "ai-key") navigate("/ai-keys");
        if (key === "logout") {
          void onLogout();
        }
      }}
    />
  );

  return (
    <AriTooltip content={content} position="top" matchTriggerWidth>
      <AriContainer
        className="desk-user-trigger-wrap"
        onMouseEnter={() => setEntryHovered(true)}
        onMouseLeave={() => setEntryHovered(false)}
      >
        <button
          type="button"
          className="desk-user-trigger desk-user-trigger-btn"
          aria-label="用户菜单"
          onFocus={() => setEntryHovered(true)}
          onBlur={() => setEntryHovered(false)}
        >
          <SidebarEntryContent icon="person" label={user.name} highlighted={entryHovered} />
        </button>
      </AriContainer>
    </AriTooltip>
  );
}
