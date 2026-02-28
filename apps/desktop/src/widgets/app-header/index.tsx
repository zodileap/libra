import { useEffect } from "react";
import { AriButton, AriContainer, AriFlex } from "aries_react";

// 描述:
//
//   - 定义桌面端全局标题栏组件入参。
interface DesktopAppHeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
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
  debugFloatVisible,
  onToggleDebugFloat,
  onHeaderSlotElementChange,
}: DesktopAppHeaderProps) {
  const sidebarToggleLabel = sidebarCollapsed ? "展开侧边栏" : "收起侧边栏";

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
          <AriButton
            type="text"
            icon={sidebarCollapsed ? "menu_open" : "menu"}
            aria-label={sidebarToggleLabel}
            onClick={onToggleSidebar}
          />
        </AriContainer>
        <AriContainer
          className="desk-app-header-slot"
          padding={{ left: "var(--z-inset-sm)", right: "var(--z-inset-sm)" }}
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
                  aria-label={debugFloatVisible ? "关闭 Dev 调试窗口" : "打开 Dev 调试窗口"}
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
