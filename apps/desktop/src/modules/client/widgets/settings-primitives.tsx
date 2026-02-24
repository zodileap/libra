import type { ReactNode } from "react";
import { AriContainer, AriFlex, AriTypography } from "aries_react";

interface DeskPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

// 描述:
//
//   - 渲染设置页统一头部，约束标题、说明、右侧操作位的层级和间距。
//
// Params:
//
//   - title: 页面主标题。
//   - description: 页面辅助说明文案。
//   - actions: 右侧操作区内容。
export function DeskPageHeader({ title, description, actions }: DeskPageHeaderProps) {
  return (
    <AriFlex className="desk-page-header" align="flex-start" justify="space-between">
      <AriContainer className="desk-page-header-main">
        <AriTypography variant="h1" value={title} />
        {description ? <AriTypography variant="caption" value={description} /> : null}
      </AriContainer>
      {actions ? <AriContainer className="desk-page-header-actions">{actions}</AriContainer> : null}
    </AriFlex>
  );
}

interface DeskSectionTitleProps {
  title: string;
}

// 描述:
//
//   - 渲染设置页分组标题，统一 H2 层级和顶部间距。
//
// Params:
//
//   - title: 分组标题文案。
export function DeskSectionTitle({ title }: DeskSectionTitleProps) {
  return <AriTypography className="desk-settings-title" variant="h2" value={title} />;
}

interface DeskSectionLabelProps {
  label: string;
}

// 描述:
//
//   - 渲染分组标签（caption），用于设置页面板前的轻量分段标题。
//
// Params:
//
//   - label: 分段标签文案。
export function DeskSectionLabel({ label }: DeskSectionLabelProps) {
  return <AriTypography className="desk-section-label" variant="caption" value={label} />;
}

interface DeskSettingsRowProps {
  title?: string;
  description?: string;
  metaSlot?: ReactNode;
  children: ReactNode;
}

// 描述:
//
//   - 渲染设置页标准表单行，统一“左侧说明 + 右侧控件”的结构。
//
// Params:
//
//   - title: 行标题。
//   - description: 行说明。
//   - metaSlot: 左侧补充内容（例如下拉控件）。
//   - children: 右侧交互控件区域。
export function DeskSettingsRow({ title, description, metaSlot, children }: DeskSettingsRowProps) {
  return (
    <AriFlex className="desk-settings-row" align="center" justify="space-between">
      <AriContainer className="desk-settings-meta">
        {title ? <AriTypography variant="h4" value={title} /> : null}
        {description ? <AriTypography variant="caption" value={description} /> : null}
        {metaSlot}
      </AriContainer>
      <AriContainer className="desk-settings-row-actions">{children}</AriContainer>
    </AriFlex>
  );
}

interface DeskEmptyStateProps {
  title: string;
  description: string;
}

// 描述:
//
//   - 渲染统一空状态块，避免各页面重复实现标题和说明样式。
//
// Params:
//
//   - title: 空状态标题。
//   - description: 空状态说明。
export function DeskEmptyState({ title, description }: DeskEmptyStateProps) {
  return (
    <AriContainer className="desk-empty-state">
      <AriTypography variant="h4" value={title} />
      <AriTypography variant="caption" value={description} />
    </AriContainer>
  );
}

interface DeskStatusTextProps {
  value: string;
}

// 描述:
//
//   - 渲染统一状态条文案，确保各页反馈文本层级和间距一致。
//
// Params:
//
//   - value: 状态文本。
export function DeskStatusText({ value }: DeskStatusTextProps) {
  return <AriTypography className="desk-inline-status desk-status-text" variant="caption" value={value} />;
}
