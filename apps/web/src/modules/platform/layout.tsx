import { useEffect, useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { AriButton, AriLayout } from "aries_react";
import { PlatformProvider } from "./provider";
import { MenuPanel } from "./components/menu-panel";

// 描述:
//
//   - 读取 Web 样式变量中的中等断点值，供 JS 媒体查询复用。
//
// Returns:
//
//   - 可用于 matchMedia 的查询字符串。
function webCompactMediaQuery(): string {
  const breakpoint = getComputedStyle(document.documentElement).getPropertyValue("--web-breakpoint-md").trim();
  if (!breakpoint) {
    return "(max-width: 100vw)";
  }
  return `(max-width: ${breakpoint})`;
}

// 描述:
//
//   - 渲染平台主布局，并在窄屏下提供菜单显隐切换能力。
export function PlatformLayout() {
  const [isCompact, setIsCompact] = useState(false);
  const [menuVisible, setMenuVisible] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia(webCompactMediaQuery());
    const sync = () => {
      const compact = mediaQuery.matches;
      setIsCompact(compact);
      setMenuVisible(!compact);
    };
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);

  const defaultVisibleAreas = useMemo(
    () => (isCompact ? (menuVisible ? ["left", "center"] : ["center"]) : ["left", "center"]),
    [isCompact, menuVisible]
  );

  return (
    <PlatformProvider>
      <div className="web-page-shell">
        <AriButton
          className="web-layout-toggle"
          label={menuVisible ? "隐藏菜单" : "显示菜单"}
          icon={menuVisible ? "chevron_left" : "menu"}
          onClick={() => setMenuVisible((value) => !value)}
        />
      </div>
      <AriLayout
        key={`platform-layout-${isCompact ? "compact" : "wide"}-${isCompact && menuVisible ? "menu-on" : "menu-off"}`}
        className={`web-layout ${isCompact ? "web-layout-compact" : ""}`}
        defaultVisibleAreas={defaultVisibleAreas}
        leftWidth="var(--web-left-width)"
        left={<MenuPanel onNavigate={isCompact ? () => setMenuVisible(false) : undefined} />}
        center={<Outlet />}
      />
    </PlatformProvider>
  );
}
