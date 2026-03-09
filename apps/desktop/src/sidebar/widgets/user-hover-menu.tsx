import { useMemo, useState } from "react";
import {
  AriContainer,
  AriDivider,
  AriFlex,
  AriIcon,
  AriMenu,
  AriTooltip,
  AriTypography,
} from "aries_react";
import { useNavigate } from "react-router-dom";
import type { RouteAccess } from "../../router/types";
import type { DesktopUpdateState, LoginUser } from "../../shell/types";
import { SidebarEntryContent } from "./sidebar-entry-content";
import {
  DESKTOP_LANGUAGE_PREFERENCES,
  getDesktopLanguageNativeLabel,
  useDesktopI18n,
} from "../../shared/i18n";

// 描述:
//
//   - 定义用户悬浮菜单组件入参。
interface UserHoverMenuProps {
  user: LoginUser;
  selectedIdentityLabel?: string;
  onLogout: () => Promise<void>;
  routeAccess: RouteAccess;
  desktopUpdateState?: DesktopUpdateState;
  onCheckDesktopUpdate?: () => Promise<void>;
  onInstallDesktopUpdate?: () => Promise<void>;
}

// 描述：渲染用户悬浮菜单入口，统一承载设置、AI Key 与登出操作。
export function UserHoverMenu({
  selectedIdentityLabel,
  onLogout,
  routeAccess,
}: UserHoverMenuProps) {
  const navigate = useNavigate();
  const { languagePreference, setLanguagePreference, t } = useDesktopI18n();
  const [entryHovered, setEntryHovered] = useState(false);
  // 描述：账户标题固定展示为“账户”，避免用户区在不同运行模式下出现不一致的主标题。
  const accountLabel = t("账户");
  // 描述：归一化账户类型文案，当前本地模式下通常展示“本地工作站”。
  const userTypeLabel = String(selectedIdentityLabel || "").trim() || t("未配置身份");
  // 描述：根据模块开关生成用户悬浮菜单的主操作项列表。
  const menuItems = useMemo(() => {
    const next = [] as Array<{
      key: string;
      label: string;
      icon?: string;
      children?: Array<{ key: string; label: string; icon?: string; children?: Array<{ key: string; label: string; icon?: string }> }>;
    }>;

    if (routeAccess.isModuleEnabled("settings")) {
      next.push({ key: "general-settings", label: t("设置"), icon: "settings" });
      next.push({
        key: "language",
        label: t("语言"),
        icon: "translate",
        children: DESKTOP_LANGUAGE_PREFERENCES.map((item) => ({
          key: `language:${item}`,
          label: item === "auto" ? t("自动检测") : getDesktopLanguageNativeLabel(item),
        })),
      });
    }

    next.push({ key: "ai-key", label: t("AI Key"), icon: "vpn_key" });
    return next;
  }, [routeAccess, t]);
  // 描述：退出登录操作独立成底部菜单区，便于与设置类入口分组显示。
  const logoutItems = useMemo(
    () => [{ key: "logout", label: t("退出登录"), icon: "logout" }],
    [t],
  );

  // 描述：统一处理用户悬浮菜单点击，集中维护设置、语言切换、AI Key 与退出登录逻辑。
  const handleSelectMenuItem = (key: string) => {
    if (key === "general-settings") navigate("/settings/general");
    if (key === "ai-key") navigate("/ai-keys");
    if (key.startsWith("language:")) {
      const nextLanguage = key.replace("language:", "").trim();
      if (nextLanguage === "auto" || nextLanguage === "zh-CN" || nextLanguage === "en-US") {
        setLanguagePreference(nextLanguage);
      }
    }
    if (key === "logout") {
      void onLogout();
    }
  };

  // 描述：用户悬浮菜单弹层内容。
  const content = (
    <AriContainer className="desk-user-menu-popover" ghost>
      <AriContainer className="desk-user-menu-profile" padding={0} ghost>
        <AriFlex className="desk-user-menu-profile-head" align="center">
          <AriIcon name="person" />
          <AriTypography className="desk-user-menu-profile-title" variant="body" value={accountLabel} />
        </AriFlex>
        <AriTypography className="desk-user-menu-profile-meta" variant="caption" value={userTypeLabel} />
      </AriContainer>
      <AriDivider className="desk-user-menu-divider" />
      <AriContainer padding={0} ghost>
        <AriMenu
          className="desk-user-menu-list"
          items={menuItems}
          selectedKey={`language:${languagePreference}`}
          onSelect={(key: string) => handleSelectMenuItem(key)}
        />
      </AriContainer>
      <AriDivider className="desk-user-menu-divider" />
      <AriContainer padding={0} ghost>
        <AriMenu
          className="desk-user-menu-list"
          items={logoutItems}
          onSelect={(key: string) => handleSelectMenuItem(key)}
        />
      </AriContainer>
    </AriContainer>
  );

  return (
    <AriTooltip content={content} position="top" trigger="click" matchTriggerWidth={false}>
      <AriContainer
        className="desk-user-trigger-wrap"
        onMouseEnter={() => setEntryHovered(true)}
        onMouseLeave={() => setEntryHovered(false)}
      >
        <button
          type="button"
          className="desk-user-trigger desk-user-trigger-btn"
          aria-label={t("用户菜单")}
          onFocus={() => setEntryHovered(true)}
          onBlur={() => setEntryHovered(false)}
        >
          <SidebarEntryContent
            icon="settings"
            label={t("设置")}
            highlighted={entryHovered}
          />
        </button>
      </AriContainer>
    </AriTooltip>
  );
}
