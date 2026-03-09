import { useEffect, useState } from "react";
import { AriButton, AriContainer, AriFlex } from "aries_react";
import type { DesktopUpdateState } from "../../shell/types";
import { useDesktopI18n } from "../../shared/i18n";

// 描述:
//
//   - 定义桌面端全局标题栏组件入参。
interface DesktopAppHeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  desktopUpdateState: DesktopUpdateState;
  onCheckDesktopUpdate: () => Promise<void>;
  onInstallDesktopUpdate: () => Promise<void>;
  debugFloatVisible: boolean;
  onToggleDebugFloat: () => void;
  onHeaderSlotElementChange: (element: HTMLElement | null) => void;
}

// 描述:
//
//   - 渲染桌面端全局标题栏，承载侧边栏折叠按钮、页面头部插槽与全局调试开关。
export function DesktopAppHeader({
  sidebarCollapsed,
  onToggleSidebar,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onInstallDesktopUpdate,
  debugFloatVisible,
  onToggleDebugFloat,
  onHeaderSlotElementChange,
}: DesktopAppHeaderProps) {
  const { t } = useDesktopI18n();
  const sidebarToggleLabel = sidebarCollapsed ? t("展开侧边栏") : t("收起侧边栏");
  const [updateButtonLoading, setUpdateButtonLoading] = useState(false);
  // 描述：根据更新状态切换标题栏按钮语义；未准备安装时统一回退为“检查更新”入口。
  const shouldInstallDesktopUpdate = desktopUpdateState.status === "ready";
  const updateButtonDisabled = updateButtonLoading
    || desktopUpdateState.status === "checking"
    || desktopUpdateState.status === "downloading"
    || desktopUpdateState.status === "installing";
  const updateButtonLabel = shouldInstallDesktopUpdate
    ? (
      desktopUpdateState.targetVersion
        ? t("更新 {{version}}", { version: desktopUpdateState.targetVersion })
        : t("更新")
    )
    : t("检查更新");

  // 描述：同步标题栏 slot DOM 节点到布局层上下文，供页面通过 hook 复用。
  useEffect(() => {
    if (typeof document === "undefined") {
      onHeaderSlotElementChange(null);
      return;
    }
    onHeaderSlotElementChange(document.getElementById("desk-app-header-slot"));
    return () => {
      onHeaderSlotElementChange(null);
    };
  }, [onHeaderSlotElementChange]);

  return (
    <AriContainer
      className="desk-app-header"
      positionType="fixed"
      ghost
      data-tauri-drag-region
    >
      <AriFlex
        className="desk-app-header-inner"
        align="flex-start"
        flexItem={[{ index: 1, flex: 1, overflow: "hidden" }]}
        data-tauri-drag-region
      >
        <AriContainer
          className={`desk-app-header-leading${sidebarCollapsed ? " is-collapsed" : " is-expanded"}`}
          padding={0}
        >
          <AriFlex className="desk-app-header-leading-actions" align="center" space={8}>
            <AriButton
              type="text"
              icon={sidebarCollapsed ? "menu_open" : "menu"}
              aria-label={sidebarToggleLabel}
              onClick={onToggleSidebar}
            />
            <AriButton
              type="text"
              icon="system_update_alt"
              color="brand"
              label={updateButtonLabel}
              disabled={updateButtonDisabled}
              onClick={async () => {
                setUpdateButtonLoading(true);
                try {
                  if (shouldInstallDesktopUpdate) {
                    await onInstallDesktopUpdate();
                    return;
                  }
                  await onCheckDesktopUpdate();
                } finally {
                  setUpdateButtonLoading(false);
                }
              }}
            />
          </AriFlex>
        </AriContainer>
        <AriContainer
          className="desk-app-header-slot"
          padding={{ left: "var(--z-inset-sm)", right: "var(--z-inset-sm)", top: 0, bottom: 0 }}
          data-tauri-drag-region
        >
          <AriFlex
            className="desk-app-header-slot-inner"
            align="center"
            space={8}
            flexItem={[{ index: 0, flex: 1, overflow: "hidden" }]}
            data-tauri-drag-region
          >
            <AriContainer
              id="desk-app-header-slot"
              className="desk-app-header-slot-content"
              padding={0}
              data-tauri-drag-region
            />
            <AriFlex className="desk-app-header-global-actions" align="center" space={8}>
              {import.meta.env.DEV ? (
                <AriButton
                  type="text"
                  icon="bug_report"
                  color={debugFloatVisible ? "primary" : "default"}
                  aria-label={debugFloatVisible ? t("关闭 Dev 调试窗口") : t("打开 Dev 调试窗口")}
                  onClick={onToggleDebugFloat}
                />
              ) : null}
            </AriFlex>
          </AriFlex>
        </AriContainer>
      </AriFlex>
    </AriContainer>
  );
}
