import { AriFlex, AriIcon, AriTypography } from "@aries-kit/react";

// 描述：统一管理侧边栏入口图标的 fill 变体，避免在 JSX 中散落硬编码。
const SIDEBAR_ICON_FILL_MAP: Record<string, string> = {
  person: "person_fill",
  settings: "settings_fill",
  account_tree: "account_tree_fill",
};

// 描述：根据 hover/focus 状态返回入口图标名，优先使用 fill 图标，不存在则回退原图标。
function resolveSidebarEntryIcon(icon: string, highlighted: boolean): string {
  if (!highlighted) {
    return icon;
  }
  return SIDEBAR_ICON_FILL_MAP[icon] || icon;
}

// 描述:
//
//   - 定义侧边栏入口内容组件入参。
interface SidebarEntryContentProps {
  icon: string;
  label: string;
  highlighted: boolean;
}

// 描述：渲染侧边栏统一入口内容，保证“左图标 + 右文本”视觉一致。
export function SidebarEntryContent({ icon, label, highlighted }: SidebarEntryContentProps) {
  return (
    <AriFlex className="desk-sidebar-entry-content" align="center" space={8}>
      <AriIcon name={resolveSidebarEntryIcon(icon, highlighted)} />
      <AriTypography className="desk-sidebar-entry-text" variant="body" value={label} />
    </AriFlex>
  );
}
