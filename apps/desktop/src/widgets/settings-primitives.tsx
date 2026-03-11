import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  type ReactNode,
} from "react";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriModal,
  AriTypography,
} from "@aries-kit/react";
import { useDesktopI18n } from "../shared/i18n";

// 描述：
//
//   - 将传入的 ReactNode 拆成适合 AriFlex 子项消费的扁平节点列表。
//   - `Children.toArray` 只能打平数组，无法继续拆开 Fragment；这里显式展开 Fragment 子节点，避免工具栏和标签栏被当成单个 flex item。
//
// Params:
//
//   - content: 原始节点内容。
//
// Returns:
//
//   - 扁平化后的节点列表。
function flattenFlexChildren(content: ReactNode): ReactNode[] {
  return Children.toArray(content).flatMap((child) =>
    isValidElement(child) && child.type === Fragment
      ? Children.toArray(child.props.children)
      : [child],
  );
}

// 描述:
//
//   - 定义页面头部组件入参。
interface DeskPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  mode?: "default" | "slot";
}

// 描述:
//
//   - 渲染设置页统一头部，约束标题、说明、右侧操作位的层级和间距。
//   - 标题统一使用 h4 并通过组件 bold 属性加粗，避免设置页标题层级过大。
//
// Params:
//
//   - title: 页面主标题。
//   - description: 页面辅助说明文案。
//   - actions: 右侧操作区内容。
//   - mode: 头部渲染模式；`slot` 用于标题栏插槽，`default` 用于主区标准头部。
export function DeskPageHeader({
  title,
  description,
  actions,
  mode = "default",
}: DeskPageHeaderProps) {
  const slotMode = mode === "slot";
  const actionItems = useMemo(() => flattenFlexChildren(actions), [actions]);
  return (
    <AriFlex
      className={`desk-page-header${slotMode ? " is-slot" : ""}`}
      align={slotMode ? "center" : "flex-start"}
      justify="space-between"
      data-tauri-drag-region={slotMode ? true : undefined}
    >
      <AriContainer className="desk-page-header-main" padding={0}>
        {slotMode ? (
          <AriFlex
            className="desk-page-header-title-line"
            align="center"
            space={8}
            data-tauri-drag-region
          >
            <AriTypography
              className="desk-page-header-title"
              variant="h4"
              bold
              value={title}
            />
            {description ? (
              <AriTypography
                className="desk-page-header-description"
                variant="caption"
                value={description}
              />
            ) : null}
          </AriFlex>
        ) : (
          <>
            <AriTypography
              className="desk-page-header-title"
              variant="h4"
              bold
              value={title}
            />
            {description ? (
              <AriTypography
                className="desk-page-header-description"
                variant="caption"
                value={description}
              />
            ) : null}
          </>
        )}
      </AriContainer>
      {actionItems.length > 0 ? (
        <AriFlex
          className="desk-page-header-actions"
          align="center"
          justify="flex-end"
          data-tauri-drag-region={slotMode ? true : undefined}
        >
          <AriFlex
            className="desk-page-header-actions-inner"
            align="center"
            space={8}
            data-tauri-drag-region={slotMode ? true : undefined}
          >
            {actionItems}
          </AriFlex>
        </AriFlex>
      ) : null}
    </AriFlex>
  );
}

// 描述:
//
//   - 定义资源总览卡片组件入参。
interface DeskOverviewCardProps {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  description?: string;
}

// 描述:
//
//   - 渲染统一的资源总览卡片布局。
//   - 卡片结构固定为“左侧图标 + 右侧内容”；内容区内部固定为“标题栏 + 摘要”。
//   - 标题栏左侧只承载标题，右侧承载工具组。
//   - 详细信息不直接渲染在卡片内，而是交由业务页通过统一详情弹窗承载。
//
// Params:
//
//   - icon: 左侧图标区域内容。
//   - title: 卡片标题。
//   - actions: 标题栏右侧工具组。
//   - description: 卡片摘要说明。
export function DeskOverviewCard({
  icon,
  title,
  actions,
  description,
}: DeskOverviewCardProps) {
  const actionItems = useMemo(() => flattenFlexChildren(actions), [actions]);
  return (
    <AriCard className="desk-overview-card">
      <AriFlex
        className="desk-overview-card-main"
        align="center"
        space={12}
        flexItem={[{ index: 1, flex: 1, overflow: "hidden", minWidth: 0 }]}
      >
        <AriContainer className="desk-overview-card-icon-wrap">
          {icon}
        </AriContainer>
        <AriContainer className="desk-overview-card-content" padding={0}>
          <AriFlex
            className="desk-overview-card-title-bar"
            align="center"
            justify="space-between"
            space={8}
            flexItem={[
              { index: 1, flex: 1, overflow: "visible" },
            ]}
          >
            <AriTypography
              className="desk-overview-card-title"
              variant="h4"
              bold
              value={title}
            />
            {actionItems.length > 0 ? (
              <AriFlex
                className="desk-overview-card-actions"
                align="center"
                justify="flex-end"
              >
                <AriFlex
                  className="desk-overview-card-actions-inner"
                  align="center"
                  space={4}
                >
                  {actionItems}
                </AriFlex>
              </AriFlex>
            ) : null}
          </AriFlex>
          {description ? (
            <AriTypography
              className="desk-overview-card-description"
              variant="caption"
              value={description}
            />
          ) : null}
        </AriContainer>
      </AriFlex>
    </AriCard>
  );
}

// 描述:
//
//   - 定义资源详情弹窗入参。
interface DeskOverviewDetailsModalProps {
  visible: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

// 描述:
//
//   - 渲染资源详情弹窗，统一三类资源（工作流 / MCP / 技能）的详细信息承载方式。
//
// Params:
//
//   - visible: 当前弹窗是否可见。
//   - title: 详情弹窗标题。
//   - description: 详情摘要说明。
//   - children: 详情主体。
//   - footer: 详情弹窗底部动作。
//   - onClose: 关闭回调。
export function DeskOverviewDetailsModal({
  visible,
  title,
  description,
  children,
  footer,
  onClose,
}: DeskOverviewDetailsModalProps) {
  const { t } = useDesktopI18n();
  return (
    <AriModal
      visible={visible}
      title={title}
      width="calc(var(--z-inset) * 36)"
      onClose={onClose}
      footer={
        footer ?? (
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton icon="close" label={t("关闭")} onClick={onClose} />
          </AriFlex>
        )
      }
    >
      <AriContainer className="desk-overview-details-body" padding={0}>
        {description ? (
          <AriTypography
            className="desk-overview-details-description"
            variant="caption"
            value={description}
          />
        ) : null}
        {children}
      </AriContainer>
    </AriModal>
  );
}

// 描述:
//
//   - 定义资源详情行组件入参。
interface DeskOverviewDetailRowProps {
  label: string;
  value: ReactNode;
}

// 描述:
//
//   - 渲染资源详情弹窗中的“标签 + 内容”行。
//   - 字符串值使用统一排版；节点值由调用方自行控制具体展示。
//
// Params:
//
//   - label: 当前详情字段标签。
//   - value: 当前详情字段内容。
export function DeskOverviewDetailRow({
  label,
  value,
}: DeskOverviewDetailRowProps) {
  return (
    <AriContainer className="desk-overview-detail-row" padding={0}>
      <AriTypography
        className="desk-overview-detail-label"
        variant="caption"
        value={label}
      />
      {typeof value === "string" ? (
        <AriTypography
          className="desk-overview-detail-value"
          variant="body"
          value={value}
        />
      ) : (
        <AriContainer className="desk-overview-detail-value-wrap" padding={0}>
          {value}
        </AriContainer>
      )}
    </AriContainer>
  );
}

// 描述:
//
//   - 定义分组标题组件入参。
interface DeskSectionTitleProps {
  title: string;
}

// 描述:
//
//   - 渲染设置页分组标题，统一 H4 层级和顶部间距。
//
// Params:
//
//   - title: 分组标题文案。
export function DeskSectionTitle({ title }: DeskSectionTitleProps) {
  return (
    <AriTypography
      className="desk-settings-title"
      variant="h4"
      bold
      value={title}
    />
  );
}

// 描述:
//
//   - 定义分组标签组件入参。
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
  return (
    <AriTypography
      className="desk-section-label"
      variant="caption"
      value={label}
    />
  );
}

// 描述:
//
//   - 定义设置行组件入参。
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
export function DeskSettingsRow({
  title,
  description,
  metaSlot,
  children,
}: DeskSettingsRowProps) {
  return (
    <AriFlex
      className="desk-settings-row"
      align="center"
      justify="space-between"
    >
      <AriContainer className="desk-settings-row-main" padding={0}>
        {title ? <AriTypography className="desk-settings-row-title" variant="h4" value={title} /> : null}
        {description ? (
          <AriTypography className="desk-settings-row-description" variant="caption" value={description} />
        ) : null}
        {metaSlot ? (
          <AriContainer className="desk-settings-row-meta" padding={0}>
            {metaSlot}
          </AriContainer>
        ) : null}
      </AriContainer>
      <AriContainer className="desk-settings-row-actions">
        {children}
      </AriContainer>
    </AriFlex>
  );
}

// 描述:
//
//   - 定义空状态组件入参。
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

// 描述:
//
//   - 定义状态文本组件入参。
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
  return (
    <AriTypography
      className="desk-status-text"
      variant="caption"
      value={value}
    />
  );
}
