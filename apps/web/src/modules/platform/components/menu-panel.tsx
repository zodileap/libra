import { AriContainer, AriFlex, AriTypography } from "aries_react";
import { useNavigate } from "react-router-dom";
import { usePlatformContext } from "../context";

interface MenuPanelProps {
  onNavigate?: () => void;
}

// 描述:
//
//   - 渲染平台左侧菜单，统一入口卡片状态与窄屏下的导航收起行为。
export function MenuPanel({ onNavigate }: MenuPanelProps) {
  const navigate = useNavigate();
  const { menuItems, currentPath } = usePlatformContext();
  const goto = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <AriContainer className="web-menu-panel web-scroll">
      <div className="web-menu-header">
        <AriTypography variant="h3" value="Libra" />
        <AriTypography variant="caption" value="平台入口 + 模块化智能体" />
      </div>

      <AriFlex direction="column" className="web-menu-list">
        <button
          type="button"
          className={`web-menu-button ${currentPath === "/" ? "is-active" : ""}`.trim()}
          onClick={() => goto("/")}
        >
          <AriTypography variant="h4" value="平台总览" />
          <AriTypography variant="caption" value="订阅、授权、模块入口" />
        </button>

        {menuItems.map((item) => {
          const active = currentPath.startsWith(item.path);
          return (
            <button
              type="button"
              key={item.key}
              className={`web-menu-button ${active ? "is-active" : ""}`.trim()}
              onClick={() => goto(item.path)}
            >
              <AriTypography variant="h4" value={item.label} />
              <AriTypography variant="caption" value={item.description} />
            </button>
          );
        })}
      </AriFlex>

      <AriTypography className="web-menu-footer" variant="caption" value="当前用户：demo@libra.com" />
    </AriContainer>
  );
}
