import { useState } from "react";
import { AriContainer } from "aries_react";
import { SidebarEntryContent } from "./sidebar-entry-content";

// 描述:
//
//   - 定义侧边栏快捷入口组件入参。
interface SidebarQuickActionProps {
  label: string;
  icon: string;
  onClick: () => void;
}

// 描述：渲染侧边栏快捷入口，与用户入口保持同款样式。
export function SidebarQuickAction({ label, icon, onClick }: SidebarQuickActionProps) {
  const [entryHovered, setEntryHovered] = useState(false);

  return (
    <AriContainer
      className="desk-user-trigger-wrap"
      onMouseEnter={() => setEntryHovered(true)}
      onMouseLeave={() => setEntryHovered(false)}
    >
      <button
        type="button"
        className="desk-user-trigger desk-user-trigger-btn desk-sidebar-quick-action"
        onClick={onClick}
        onFocus={() => setEntryHovered(true)}
        onBlur={() => setEntryHovered(false)}
      >
        <SidebarEntryContent icon={icon} label={label} highlighted={entryHovered} />
      </button>
    </AriContainer>
  );
}
