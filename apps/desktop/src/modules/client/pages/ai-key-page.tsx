import { useMemo } from "react";
import { AriButton, AriContainer, AriFlex, AriTypography } from "aries_react";

interface KeyItem {
  id: string;
  provider: string;
  maskedKey: string;
  updatedAt: string;
}

export function AiKeyPage() {
  const keyList = useMemo<KeyItem[]>(
    () => [
      {
        id: "openai-main",
        provider: "OpenAI",
        maskedKey: "sk-...4x7k",
        updatedAt: "今天 10:38",
      },
      {
        id: "claude-main",
        provider: "Anthropic",
        maskedKey: "sk-ant-...9b2p",
        updatedAt: "昨天 21:10",
      },
      {
        id: "gemini-main",
        provider: "Google Gemini",
        maskedKey: "AIza...3QmN",
        updatedAt: "昨天 20:45",
      },
    ],
    [],
  );

  return (
    <AriContainer className="desk-content">
      <div className="desk-settings-shell">
        <AriFlex justify="space-between" align="center">
          <AriTypography variant="h1" value="AI Key" />
          <AriButton icon="add" label="新增 Key" />
        </AriFlex>

        <AriTypography
          variant="caption"
          value="管理各个模型供应商的访问 Key，用于代码与建模智能体。"
        />

        <div className="desk-settings-panel">
          {keyList.map((item) => (
            <div key={item.id} className="desk-settings-row">
              <div className="desk-settings-meta">
                <AriTypography variant="h4" value={item.provider} />
                <AriTypography
                  variant="caption"
                  value={`Key: ${item.maskedKey} · 更新于 ${item.updatedAt}`}
                />
              </div>
              <AriFlex align="center" space={8}>
                <AriButton size="sm" label="编辑" />
                <AriButton size="sm" label="删除" />
              </AriFlex>
            </div>
          ))}
        </div>
      </div>
    </AriContainer>
  );
}
