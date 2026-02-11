import { AriButton, AriContainer, AriFlex, AriInput, AriSwitch, AriTypography } from "aries_react";
import type { AiKeyItem } from "../types";

interface AiKeyPageProps {
  aiKeys: AiKeyItem[];
  onAiKeysChange: (value: AiKeyItem[]) => void;
}

function maskKey(raw: string): string {
  const value = raw.trim();
  if (!value) return "(未填写)";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function AiKeyPage({ aiKeys, onAiKeysChange }: AiKeyPageProps) {
  const touch = () =>
    new Date().toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const moveAsPrimary = (id: string) => {
    const target = aiKeys.find((item) => item.id === id);
    if (!target) return;
    onAiKeysChange([target, ...aiKeys.filter((item) => item.id !== id)]);
  };

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
      <div className="desk-settings-shell">
        <AriFlex justify="space-between" align="center">
          <AriTypography variant="h1" value="AI Key" />
          <AriTypography variant="caption" value="默认使用第 1 项 Provider" />
        </AriFlex>

        <AriTypography
          variant="caption"
          value="管理各个模型供应商的访问 Key，用于代码与建模智能体。"
        />

        <div className="desk-settings-panel">
          {aiKeys.map((item, index) => (
            <div key={item.id} className="desk-settings-row">
              <div className="desk-settings-meta">
                <AriTypography
                  variant="h4"
                  value={index === 0 ? `${item.providerLabel}（默认）` : item.providerLabel}
                />
                <AriTypography
                  variant="caption"
                  value={`Key: ${item.provider === "codex" ? "local-cli（无需 API Key）" : maskKey(item.keyValue)} · 更新于 ${item.updatedAt}`}
                />
                {item.provider !== "codex" ? (
                  <AriInput
                    value={item.keyValue}
                    onChange={(next) => patchItem(item.id, { keyValue: next })}
                    placeholder={`输入 ${item.providerLabel} Key`}
                  />
                ) : null}
              </div>
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
            </div>
          ))}
        </div>
      </div>
    </AriContainer>
  );
}
