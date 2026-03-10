import type { ReactNode } from "react";
import { AriButton, AriContainer, AriFlex } from "@aries-kit/react";
import { useDesktopI18n } from "../../shared/i18n";

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
  const { t } = useDesktopI18n();
  return (
    <AriFlex justify="space-between" align="center">
      <AriButton icon="arrow_left_alt" label={t(label)} onClick={onBack} />
      {rightAction || <AriContainer />}
    </AriFlex>
  );
}
