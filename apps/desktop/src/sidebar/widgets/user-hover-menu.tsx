import { useMemo, useState } from "react";
import { AriButton, AriContainer, AriMenu, AriTooltip } from "aries_react";
import { useNavigate } from "react-router-dom";
import type { RouteAccess } from "../../router/types";
import type { DesktopUpdateState, LoginUser } from "../../shell/types";
import { SidebarEntryContent } from "./sidebar-entry-content";

// 描述:
//
//   - 定义用户悬浮菜单组件入参。
interface UserHoverMenuProps {
  user: LoginUser;
  onLogout: () => Promise<void>;
  routeAccess: RouteAccess;
  desktopUpdateState: DesktopUpdateState;
  onCheckDesktopUpdate: () => Promise<void>;
  onInstallDesktopUpdate: () => Promise<void>;
}

// 描述：渲染用户悬浮菜单入口，统一承载设置、AI Key 与登出操作。
export function UserHoverMenu({
  user,
  onLogout,
  routeAccess,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onInstallDesktopUpdate,
}: UserHoverMenuProps) {
  const navigate = useNavigate();
  const [entryHovered, setEntryHovered] = useState(false);
  const [updateButtonLoading, setUpdateButtonLoading] = useState(false);
  // 描述：根据模块开关生成用户菜单项列表。
  const menuItems = useMemo(() => {
    const next = [] as Array<{ key: string; label: string; icon: string }>;

    if (routeAccess.isModuleEnabled("settings")) {
      next.push({ key: "settings", label: "设置", icon: "settings" });
    }

    next.push({ key: "ai-key", label: "AI Key", icon: "vpn_key" });
    next.push({ key: "logout", label: "登出", icon: "logout" });
    return next;
  }, [routeAccess]);

  // 描述：用户悬浮菜单弹层内容。
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

  // 描述：仅在更新包下载完成后展示“更新”按钮。
  const showUpdateButton = desktopUpdateState.status === "ready";
  const updateButtonLabel = desktopUpdateState.targetVersion
    ? `更新 ${desktopUpdateState.targetVersion}`
    : "更新";

  return (
    <AriContainer className="desk-user-entry-row" padding={0}>
      {showUpdateButton ? (
        <AriButton
          icon="system_update_alt"
          label={updateButtonLabel}
          color="brand"
          ghost
          disabled={updateButtonLoading}
          onClick={async () => {
            setUpdateButtonLoading(true);
            try {
              await onInstallDesktopUpdate();
            } finally {
              setUpdateButtonLoading(false);
            }
          }}
        />
      ) : null}
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
            onMouseEnter={() => {
              void onCheckDesktopUpdate();
            }}
          >
            <SidebarEntryContent icon="person" label={user.name} highlighted={entryHovered} />
          </button>
        </AriContainer>
      </AriTooltip>
    </AriContainer>
  );
}
