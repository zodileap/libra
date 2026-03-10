import { useMemo } from "react";
import { createPortal } from "react-dom";
import { AriButton, AriContainer, AriFlex, AriInput, AriSwitch, AriTag, AriTypography } from "@aries-kit/react";
import type { AiKeyItem } from "../types";
import {
  DeskEmptyState,
  DeskPageHeader,
} from "../../../widgets/settings-primitives";
import { useDesktopI18n } from "../../../shared/i18n";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";

// 描述:
//
//   - 定义 AI Key 设置页入参。
interface AiKeyPageProps {
  aiKeys: AiKeyItem[];
  onAiKeysChange: (value: AiKeyItem[]) => void;
}

// 描述:
//
//   - 对 AI Key 进行脱敏展示，避免在设置页面直接暴露完整密钥。
//
// Params:
//
//   - raw: 原始密钥文本。
//
// Returns:
//
//   - 脱敏后的字符串。
function maskKey(raw: string, emptyLabel: string): string {
  const value = raw.trim();
  if (!value) return emptyLabel;
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

// 描述：
//
//   - 判断当前 Provider 是否属于本地 CLI 类型（无需 API Key 输入）。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - true: 本地 CLI Provider。
function isLocalCliProvider(provider: AiKeyItem["provider"]): boolean {
  return provider === "codex" || provider === "gemini-cli";
}

// 描述：
//
//   - 生成 AI Key 卡片摘要文案，将 Key 与更新时间拆成更适合卡片布局的两段文本。
//
// Params:
//
//   - item: 当前 Provider 配置。
//   - emptyLabel: 未填写时的占位文案。
//   - t: 国际化翻译函数。
//
// Returns:
//
//   - keyText: Key 摘要。
//   - updatedAtText: 更新时间摘要。
function buildAiKeyCardSummary(
  item: AiKeyItem,
  emptyLabel: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): {
  keyText: string;
  updatedAtText: string;
} {
  const localCliProvider = isLocalCliProvider(item.provider);
  return {
    keyText: t("Key: {{key}}", {
      key: localCliProvider
        ? t("local-cli（无需 API Key）")
        : maskKey(item.keyValue, emptyLabel),
    }),
    updatedAtText: t("更新于 {{updatedAt}}", {
      updatedAt: item.updatedAt,
    }),
  };
}

// 描述：
//
//   - 定义 AI Key Provider 卡片组件入参。
interface AiKeyProviderCardProps {
  item: AiKeyItem;
  isDefault: boolean;
  onToggleEnabled: (checked: boolean) => void;
  onMoveAsPrimary: () => void;
  onUpdateKeyValue: (value: string) => void;
}

// 描述：
//
//   - 渲染 AI Key Provider 专用卡片，统一承载标题标签、摘要信息、密钥输入与启停/默认操作。
function AiKeyProviderCard({
  item,
  isDefault,
  onToggleEnabled,
  onMoveAsPrimary,
  onUpdateKeyValue,
}: AiKeyProviderCardProps) {
  const { t } = useDesktopI18n();
  const localCliProvider = isLocalCliProvider(item.provider);
  const summary = buildAiKeyCardSummary(item, t("(未填写)"), t);
  return (
    <AriContainer className="desk-ai-key-card" padding={0}>
      <AriFlex
        className="desk-ai-key-card-body"
        align="flex-start"
        justify="space-between"
      >
        <AriContainer className="desk-ai-key-card-main" padding={0}>
          <AriFlex className="desk-ai-key-card-title-line" align="center" space={8}>
            <AriTypography
              className="desk-ai-key-card-title"
              variant="h4"
              value={item.providerLabel}
            />
            {isDefault ? (
              <AriTag
                color="brand"
                size="sm"
                label={t("默认")}
              />
            ) : null}
            {localCliProvider ? (
              <AriTag
                bordered
                size="sm"
                label={t("本地 CLI")}
              />
            ) : null}
          </AriFlex>
          <AriFlex className="desk-ai-key-card-meta" align="center" space={8}>
            <AriTypography
              className="desk-ai-key-card-meta-text"
              variant="caption"
              value={summary.keyText}
            />
            <AriTypography
              className="desk-ai-key-card-meta-text"
              variant="caption"
              value={summary.updatedAtText}
            />
          </AriFlex>
          {!localCliProvider ? (
            <AriContainer className="desk-ai-key-card-input-wrap" padding={0}>
              <AriInput
                className="desk-ai-key-card-input"
                value={item.keyValue}
                onChange={onUpdateKeyValue}
                placeholder={t("输入 {{providerLabel}} Key", { providerLabel: item.providerLabel })}
              />
            </AriContainer>
          ) : null}
        </AriContainer>
        <AriContainer className="desk-ai-key-card-actions" padding={0}>
          <AriFlex
            className="desk-ai-key-card-actions-stack"
            vertical
            align="flex-end"
            space={8}
          >
            <AriFlex className="desk-ai-key-card-toggle" align="center" justify="flex-end" space={8}>
              <AriTypography
                className="desk-ai-key-card-meta-text"
                variant="caption"
                value={t("启用")}
              />
              <AriSwitch
                checked={item.enabled}
                onChange={onToggleEnabled}
              />
            </AriFlex>
            {!isDefault ? (
              <AriButton
                type="default"
                icon="star"
                size="sm"
                label={t("设为默认")}
                onClick={onMoveAsPrimary}
              />
            ) : null}
          </AriFlex>
        </AriContainer>
      </AriFlex>
    </AriContainer>
  );
}

// 描述:
//
//   - 渲染 AI Key 设置页面，支持启停、设为默认与密钥更新。
export function AiKeyPage({ aiKeys, onAiKeysChange }: AiKeyPageProps) {
  const { formatDateTime, t } = useDesktopI18n();
  const headerSlotElement = useDesktopHeaderSlot();
  // 描述:
  //
  //   - 生成统一格式的更新时间文本。
  const touch = () =>
    formatDateTime(new Date(), {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  // 描述:
  //
  //   - 将指定供应商移动到列表首位，作为默认 Provider。
  //
  // Params:
  //
  //   - id: 目标供应商 ID。
  const moveAsPrimary = (id: string) => {
    const target = aiKeys.find((item) => item.id === id);
    if (!target) return;
    onAiKeysChange([target, ...aiKeys.filter((item) => item.id !== id)]);
  };

  // 描述:
  //
  //   - 按 ID 更新单个 Provider 数据，并同步刷新更新时间。
  //
  // Params:
  //
  //   - id: Provider ID。
  //   - patch: 需要覆盖的字段。
  const patchItem = (id: string, patch: Partial<AiKeyItem>) => {
    onAiKeysChange(
      aiKeys.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              updatedAt: touch(),
            }
          : item
      )
    );
  };

  // 描述：
  //
  //   - 生成 AI Key 页面标题栏内容，并挂载到全局标题栏 slot，避免在 main 区重复渲染独立 Header。
  const headerNode = useMemo(() => (
    <DeskPageHeader
      mode="slot"
      title={t("AI Key")}
      description={t("管理各个模型供应商的访问 Key，用于代码与建模智能体。")}
      actions={<AriTypography variant="caption" value={t("默认使用第 1 项 Provider")} />}
    />
  ), [t]);

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <AriContainer className="desk-settings-shell">
        <AriContainer className="desk-settings-panel">
          {aiKeys.length === 0 ? (
            <DeskEmptyState
              title={t("暂无可用 Provider")}
              description={t("请先添加至少一个模型供应商 Key。")}
            />
          ) : (
            <AriContainer className="desk-ai-key-list" padding={0}>
              {aiKeys.map((item, index) => (
                <AiKeyProviderCard
                key={item.id}
                  item={item}
                  isDefault={index === 0}
                  onToggleEnabled={(checked) => patchItem(item.id, { enabled: checked })}
                  onMoveAsPrimary={() => moveAsPrimary(item.id)}
                  onUpdateKeyValue={(next) => patchItem(item.id, { keyValue: next })}
                />
              ))}
            </AriContainer>
          )}
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
