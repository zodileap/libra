import type { ReactNode } from "react";
import { AriButton, AriContainer, AriFlex } from "aries_react";

// 描述:
//
//   - 定义侧边栏返回头组件入参。
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
