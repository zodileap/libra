import { AriButton, AriContainer, AriFlex, AriInput, AriSwitch, AriTypography } from "aries_react";
import type { AiKeyItem } from "../types";
import {
  DeskEmptyState,
  DeskPageHeader,
  DeskSettingsRow,
} from "../../../widgets/settings-primitives";

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
function maskKey(raw: string): string {
  const value = raw.trim();
  if (!value) return "(未填写)";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

// 描述:
//
//   - 渲染 AI Key 设置页面，支持启停、设为默认与密钥更新。
export function AiKeyPage({ aiKeys, onAiKeysChange }: AiKeyPageProps) {
  // 描述:
  //
  //   - 生成统一格式的更新时间文本。
  const touch = () =>
    new Date().toLocaleString("zh-CN", {
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

  return (
    <AriContainer className="desk-content">
      <AriContainer className="desk-settings-shell">
        <DeskPageHeader
          title="AI Key"
          description="管理各个模型供应商的访问 Key，用于代码与建模智能体。"
          actions={<AriTypography variant="caption" value="默认使用第 1 项 Provider" />}
        />

        <AriContainer className="desk-settings-panel">
          {aiKeys.length === 0 ? (
            <DeskEmptyState
              title="暂无可用 Provider"
              description="请先添加至少一个模型供应商 Key。"
            />
          ) : (
            aiKeys.map((item, index) => (
              <DeskSettingsRow
                key={item.id}
                title={index === 0 ? `${item.providerLabel}（默认）` : item.providerLabel}
                description={`Key: ${item.provider === "codex" ? "local-cli（无需 API Key）" : maskKey(item.keyValue)} · 更新于 ${item.updatedAt}`}
                metaSlot={item.provider !== "codex" ? (
                  <AriInput
                    value={item.keyValue}
                    onChange={(next) => patchItem(item.id, { keyValue: next })}
                    placeholder={`输入 ${item.providerLabel} Key`}
                  />
                ) : null}
              >
                <AriFlex align="center" space={8}>
                  <AriSwitch
                    checked={item.enabled}
                    onChange={(checked) => patchItem(item.id, { enabled: checked })}
                  />
                  <AriButton
                    size="sm"
                    label="设为默认"
                    onClick={() => moveAsPrimary(item.id)}
                    disabled={index === 0}
                  />
                </AriFlex>
              </DeskSettingsRow>
            ))
          )}
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
