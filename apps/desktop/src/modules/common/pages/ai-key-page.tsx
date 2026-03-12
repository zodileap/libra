import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AriButton, AriContainer, AriFlex, AriInput, AriMessage, AriModal, AriSelect, AriSwitch, AriTooltip, AriTypography } from "@aries-kit/react";
import { invoke } from "@tauri-apps/api/core";
import type { AiKeyItem } from "../types";
import {
  DeskEmptyState,
  DeskPageHeader,
  DeskSectionTitle,
} from "../../../widgets/settings-primitives";
import { useDesktopI18n } from "../../../shared/i18n";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import {
  composeAiProviderModeValue,
  isLocalCliAiProvider,
  mergeAiProviderSelectOptions,
  resolveAiProviderFastModeEnabled,
  resolveAiProviderModeOptions,
  resolveAiProviderModeSelectValue,
  resolveAiProviderModelOptions,
  supportsAiProviderFastModeToggle,
  supportsAiProviderModeSelection,
  supportsAiProviderModelSelection,
} from "../../../shared/ai-provider-catalog";

// 描述:
//
//   - 定义 AI Key 设置页入参。
interface AiKeyPageProps {
  aiKeys: AiKeyItem[];
  onAiKeysChange: (value: AiKeyItem[]) => void;
}

// 描述:
//
//   - 定义本地 CLI 健康检查返回结构，供 AI Key 页面主动检测按钮复用。
//
interface LocalCliHealthResponse {
  available: boolean;
  outdated: boolean;
  version: string;
  minimum_version: string;
  bin_path: string;
  message: string;
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
  return isLocalCliAiProvider(provider);
}

// 描述：
//
//   - 判断当前 Provider 是否需要额外填写模型名称；当前 Codex CLI 与 iFlow API 都支持单独指定模型。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - true: 需要展示模型名称输入框。
function shouldRenderModelInput(provider: AiKeyItem["provider"]): boolean {
  return supportsAiProviderModelSelection(provider);
}

// 描述：
//
//   - 判断当前 Provider 是否需要额外填写模式；当前仅 Codex CLI 暴露推理强度类模式配置。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - true: 需要展示模式输入框。
function shouldRenderModeInput(provider: AiKeyItem["provider"]): boolean {
  return supportsAiProviderModeSelection(provider);
}

// 描述：
//
//   - 根据 Provider 解析对应的本地 CLI 检测命令，便于页面侧统一触发主动校验。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - 本地 CLI 检测命令；非 CLI Provider 返回 null。
function resolveCliCheckCommand(provider: AiKeyItem["provider"]): string | null {
  if (provider === "codex") {
    return "check_codex_cli_health";
  }
  if (provider === "gemini-cli") {
    return "check_gemini_cli_health";
  }
  return null;
}

// 描述：
//
//   - 将本地 CLI 健康检查结果转换成页面消息提示，避免把底层返回结构直接耦合到视图层。
//
// Params:
//
//   - providerLabel: Provider 展示名称。
//   - response: 健康检查结果。
//   - t: 国际化翻译函数。
//
// Returns:
//
//   - level: 消息级别。
//   - content: 面向用户的提示文案。
function buildCliHealthFeedback(
  providerLabel: string,
  response: LocalCliHealthResponse,
  t: (key: string, vars?: Record<string, string | number>) => string,
): {
  level: "success" | "warning";
  content: string;
} {
  const detail = response.bin_path.trim()
    ? `\n${t("当前路径：{{path}}", { path: response.bin_path })}`
    : "";
  if (response.available && !response.outdated) {
    return {
      level: "success",
      content: `${t("{{providerLabel}} 可用，版本 {{version}}。", {
        providerLabel,
        version: response.version || "-",
      })}${detail}`,
    };
  }
  if (response.available && response.version.trim()) {
    return {
      level: "warning",
      content: `${t("{{providerLabel}} 版本过低，当前 {{version}}，最低要求 {{minimumVersion}}。", {
        providerLabel,
        version: response.version,
        minimumVersion: response.minimum_version || "-",
      })}${detail}`,
    };
  }
  return {
    level: "warning",
    content: t("未检测到可用的 {{providerLabel}}，请先安装后再重试。", {
      providerLabel,
    }),
  };
}

// 描述：
//
//   - 定义 AI Key Provider 卡片组件入参。
interface AiKeyProviderCardProps {
  item: AiKeyItem;
  isDefault: boolean;
  checking: boolean;
  modelOptions: Array<{ value: string; label: string }>;
  modeOptions: Array<{ value: string; label: string }>;
  onToggleEnabled: (checked: boolean) => void;
  onMoveAsPrimary: () => void;
  onEditKey: (() => void) | null;
  onUpdateModelName: (value: string) => void;
  onUpdateModeName: (value: string) => void;
  onUpdateFastModeEnabled: (enabled: boolean) => void;
  onCheckCli: (() => void) | null;
}

// 描述：
//
//   - 渲染 AI Key Provider 专用卡片。
//   - 本地 CLI Provider 采用“名称 + 模型/模式选择 + 启停/默认/检测”单行布局。
//   - API Provider 采用“名称 + 模型选择 + 启停/Key/默认”单行布局；Key 编辑收敛到弹窗中。
function AiKeyProviderCard({
  item,
  isDefault,
  checking,
  modelOptions,
  modeOptions,
  onToggleEnabled,
  onMoveAsPrimary,
  onEditKey,
  onUpdateModelName,
  onUpdateModeName,
  onUpdateFastModeEnabled,
  onCheckCli,
}: AiKeyProviderCardProps) {
  const { t } = useDesktopI18n();
  const localCliProvider = isLocalCliProvider(item.provider);
  const showModelInput = shouldRenderModelInput(item.provider);
  const showModeInput = shouldRenderModeInput(item.provider);
  const showFastModeToggle = supportsAiProviderFastModeToggle(item.provider);
  const hasConfiguredKey = Boolean(String(item.keyValue || "").trim()) && !localCliProvider;
  return (
    <AriContainer className="desk-ai-key-card" padding={0}>
      <AriFlex
        className={`desk-ai-key-card-body${localCliProvider ? " is-cli" : " is-api"}`}
        align="center"
        justify="flex-start"
        space={12}
      >
        <AriContainer className="desk-ai-key-card-primary" padding={0}>
          <AriContainer className="desk-ai-key-card-title-slot" padding={0}>
            <AriTypography
              className="desk-ai-key-card-title"
              variant="body"
              value={item.providerLabel}
            />
          </AriContainer>
          <AriContainer className="desk-ai-key-card-model-slot" padding={0}>
            {showModelInput ? (
              <AriContainer className="desk-ai-key-card-model-wrap" padding={0}>
                <AriSelect
                  value={String(item.modelName || "").trim() || undefined}
                  options={modelOptions}
                  placeholder={t("选择 {{providerLabel}} 模型", { providerLabel: item.providerLabel })}
                  onChange={(value) => {
                    if (Array.isArray(value)) {
                      return;
                    }
                    onUpdateModelName(String(value || "").trim());
                  }}
                />
              </AriContainer>
            ) : null}
          </AriContainer>
          <AriContainer className="desk-ai-key-card-mode-slot" padding={0}>
            {(showModeInput || showFastModeToggle) ? (
              <AriFlex className="desk-ai-key-card-mode-group" align="center" justify="flex-start" space={8}>
                {showModeInput ? (
                  <AriContainer className="desk-ai-key-card-mode-wrap" padding={0}>
                    <AriSelect
                      value={resolveAiProviderModeSelectValue(
                        item.provider,
                        String(item.modeName || ""),
                      ) || undefined}
                      options={modeOptions}
                      placeholder={t("选择 {{providerLabel}} 模式", { providerLabel: item.providerLabel })}
                      onChange={(value) => {
                        if (Array.isArray(value)) {
                          return;
                        }
                        onUpdateModeName(String(value || "").trim());
                      }}
                    />
                  </AriContainer>
                ) : null}
                {showFastModeToggle ? (
                  <AriFlex
                    className="desk-ai-key-card-fast-toggle"
                    align="center"
                    justify="flex-start"
                    space={6}
                  >
                    <AriTypography variant="caption" value={t("Fast 模式")} />
                    <AriSwitch
                      checked={resolveAiProviderFastModeEnabled(item.provider, String(item.modeName || ""))}
                      onChange={onUpdateFastModeEnabled}
                    />
                  </AriFlex>
                ) : null}
              </AriFlex>
            ) : null}
          </AriContainer>
        </AriContainer>
        <AriFlex className="desk-ai-key-card-actions" align="center" justify="flex-start" space={8}>
          <AriFlex className="desk-ai-key-card-toggle" align="center" justify="flex-start" space={8}>
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
          {!localCliProvider && onEditKey ? (
            <AriTooltip
              content={hasConfiguredKey
                ? t("编辑 {{providerLabel}} Key", { providerLabel: item.providerLabel })
                : t("设置 {{providerLabel}} Key", { providerLabel: item.providerLabel })}
              position="top"
              minWidth={0}
              matchTriggerWidth={false}
            >
              <AriButton
                type="text"
                icon="vpn_key"
                color={hasConfiguredKey ? "brand" : "default"}
                aria-label={hasConfiguredKey
                  ? t("编辑 {{providerLabel}} Key", { providerLabel: item.providerLabel })
                  : t("设置 {{providerLabel}} Key", { providerLabel: item.providerLabel })}
                onClick={onEditKey}
              />
            </AriTooltip>
          ) : null}
          <AriButton
            type="default"
            icon="star"
            size="sm"
            label={t("设为默认")}
            disabled={isDefault}
            onClick={onMoveAsPrimary}
          />
          {localCliProvider && onCheckCli ? (
            <AriButton
              type="default"
              icon="fact_check"
              size="sm"
              label={checking ? t("检测中...") : t("检测")}
              disabled={checking}
              onClick={onCheckCli}
            />
          ) : null}
        </AriFlex>
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
  const [checkingProviderIds, setCheckingProviderIds] = useState<Record<string, boolean>>({});
  const [editingKeyProviderId, setEditingKeyProviderId] = useState("");
  const [draftKeyValue, setDraftKeyValue] = useState("");
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
  //   - 当前正在编辑 Key 的 Provider 项；关闭弹窗时会回到 null。
  const editingKeyItem = useMemo(
    () => aiKeys.find((item) => item.id === editingKeyProviderId) || null,
    [aiKeys, editingKeyProviderId],
  );

  // 描述：
  //
  //   - 打开指定 Provider 的 Key 编辑弹窗，并回填当前已保存值。
  //
  // Params:
  //
  //   - item: 目标 Provider 配置。
  const handleOpenKeyEditor = (item: AiKeyItem) => {
    if (isLocalCliProvider(item.provider)) {
      return;
    }
    setEditingKeyProviderId(item.id);
    setDraftKeyValue(String(item.keyValue || ""));
  };

  // 描述：
  //
  //   - 关闭 Key 编辑弹窗并清空草稿。
  const handleCloseKeyEditor = () => {
    setEditingKeyProviderId("");
    setDraftKeyValue("");
  };

  // 描述：
  //
  //   - 确认保存当前 Key 草稿，并给出统一成功反馈。
  const handleConfirmKeyEditor = () => {
    if (!editingKeyItem) {
      return;
    }
    patchItem(editingKeyItem.id, {
      keyValue: draftKeyValue,
    });
    AriMessage.success({
      content: t("{{providerLabel}} Key 已保存。", {
        providerLabel: editingKeyItem.providerLabel,
      }),
      duration: 2200,
      showClose: true,
    });
    handleCloseKeyEditor();
  };

  // 描述：
  //
  //   - 主动检测本地 CLI Provider 可用性，并通过统一消息反馈给用户。
  //
  // Params:
  //
  //   - item: 待检测的 Provider 配置。
  const checkCliProvider = async (item: AiKeyItem) => {
    const command = resolveCliCheckCommand(item.provider);
    if (!command) {
      return;
    }

    setCheckingProviderIds((current) => ({
      ...current,
      [item.id]: true,
    }));

    try {
      const response = await invoke<LocalCliHealthResponse>(command, {});
      const feedback = buildCliHealthFeedback(item.providerLabel, response, t);
      const messageConfig = {
        content: feedback.content,
        duration: feedback.level === "success" ? 2200 : 5000,
        showClose: true,
      };
      if (feedback.level === "success") {
        AriMessage.success(messageConfig);
      } else {
        AriMessage.warning(messageConfig);
      }
    } catch {
      AriMessage.error({
        content: t("{{providerLabel}} 检测失败，请稍后重试。", {
          providerLabel: item.providerLabel,
        }),
        duration: 5000,
        showClose: true,
      });
    } finally {
      setCheckingProviderIds((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
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
      <AriModal
        visible={Boolean(editingKeyItem)}
        title={t("设置 {{providerLabel}} Key", {
          providerLabel: editingKeyItem?.providerLabel || "",
        })}
        onClose={handleCloseKeyEditor}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              type="default"
              label={t("取消")}
              onClick={handleCloseKeyEditor}
            />
            <AriButton
              type="default"
              color="brand"
              label={t("保存 Key")}
              onClick={handleConfirmKeyEditor}
            />
          </AriFlex>
        )}
      >
        <AriInput
          value={draftKeyValue}
          onChange={setDraftKeyValue}
          placeholder={t("输入 {{providerLabel}} Key", {
            providerLabel: editingKeyItem?.providerLabel || "",
          })}
        />
      </AriModal>
      <AriContainer className="desk-settings-shell">
        <DeskSectionTitle title={t("Providers")} />
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
                  checking={checkingProviderIds[item.id] === true}
                  modelOptions={mergeAiProviderSelectOptions(
                    resolveAiProviderModelOptions(item.provider),
                    String(item.modelName || ""),
                  )}
                  modeOptions={mergeAiProviderSelectOptions(
                    resolveAiProviderModeOptions(item.provider),
                    resolveAiProviderModeSelectValue(item.provider, String(item.modeName || "")),
                  )}
                  onToggleEnabled={(checked) => patchItem(item.id, { enabled: checked })}
                  onMoveAsPrimary={() => moveAsPrimary(item.id)}
                  onEditKey={!isLocalCliProvider(item.provider) ? () => handleOpenKeyEditor(item) : null}
                  onUpdateModelName={(next) => patchItem(item.id, { modelName: next })}
                  onUpdateModeName={(next) => patchItem(item.id, {
                    modeName: composeAiProviderModeValue(
                      item.provider,
                      next,
                      resolveAiProviderFastModeEnabled(item.provider, String(item.modeName || "")),
                    ),
                  })}
                  onUpdateFastModeEnabled={(enabled) => patchItem(item.id, {
                    modeName: composeAiProviderModeValue(
                      item.provider,
                      resolveAiProviderModeSelectValue(item.provider, String(item.modeName || "")),
                      enabled,
                    ),
                  })}
                  onCheckCli={isLocalCliProvider(item.provider) ? () => {
                    void checkCliProvider(item);
                  } : null}
                />
              ))}
            </AriContainer>
          )}
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
