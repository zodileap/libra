import { AriButton, AriContainer, AriFlex, AriMenu, AriTypography } from "aries_react";
import { useNavigate } from "react-router-dom";
import { useConsoleContext } from "../context";

interface MenuItemNode {
  key: string;
  label: string;
  children?: MenuItemNode[];
}

// 描述：将控制台菜单模型转换为 AriMenu 可消费结构。
function buildMenuTree(items: Array<{ key: string; label: string; children?: Array<{ key: string; label: string }> }>) {
  return items.map((item) => ({
    key: item.key,
    label: item.label,
    children: item.children
      ? item.children.map((child) => ({
          key: child.key,
          label: child.label
        }))
      : undefined
  })) as MenuItemNode[];
}

// 描述：控制台侧边菜单，提供导航与退出登录入口。
export function ConsoleMenuPanel() {
  const navigate = useNavigate();
  const { menuItems, currentPath, user, logout } = useConsoleContext();

  const keyPathMap = menuItems.reduce<Record<string, string>>((acc, item) => {
    acc[item.key] = item.path;
    if (item.children) {
      item.children.forEach((child) => {
        acc[child.key] = child.path;
      });
    }
    return acc;
  }, {});

  const selectedItem = menuItems
    .flatMap((item) => (item.children ? [item, ...item.children] : [item]))
    .find((item) => currentPath.startsWith(item.path));

  return (
    <AriContainer className="web-console-menu">
      <AriContainer className="web-console-menu-header">
        <AriTypography variant="h4" value="Agen 管理控制台" />
        <AriTypography variant="caption" value={user ? `当前用户：${user.name}` : "请先登录"} />
      </AriContainer>

      <AriContainer className="web-console-menu-main">
        <AriMenu
          value={selectedItem?.key}
          items={buildMenuTree(menuItems)}
          onSelect={(menuKey: string) => {
            const nextPath = keyPathMap[menuKey];
            if (nextPath) {
              navigate(nextPath);
            }
          }}
        />
      </AriContainer>

      <AriFlex justify="space-between" align="center">
        <AriTypography variant="caption" value={user?.email || ""} />
        <AriButton label="退出" onClick={logout} />
      </AriFlex>
    </AriContainer>
  );
}
