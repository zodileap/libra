import type { ReactNode } from "react";
import { AriButton, AriContainer, AriFlex } from "aries_react";

interface SidebarBackHeaderProps {
  onBack: () => void;
  label?: string;
  rightAction?: ReactNode;
}

// 描述：渲染侧边栏头部返回区域，统一左侧返回与右侧扩展动作布局。
export function SidebarBackHeader({ onBack, label = "Back", rightAction }: SidebarBackHeaderProps) {
  return (
    <AriFlex justify="space-between" align="center">
      <AriButton icon="arrow_back_ios" label={label} onClick={onBack} />
      {rightAction || <AriContainer />}
    </AriFlex>
  );
}
