import type { ReactNode } from "react";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriInput,
  AriTypography,
} from "aries_react";

interface AgentStarterItem {
  title: string;
  description: string;
}

interface AgentPageProps {
  title: string;
  description: string;
  prompt: string;
  status: string;
  sending: boolean;
  canSend: boolean;
  promptPlaceholder: string;
  agentLayerLabel: string;
  starterItems: AgentStarterItem[];
  onPromptChange: (value: string) => void;
  onStartConversation: () => void | Promise<void>;
  onboardingContent?: ReactNode;
  guideContent?: ReactNode;
}

// 描述：渲染智能体入口通用页面骨架，具体业务状态与行为由各智能体模块注入。
export function AgentPage({
  title,
  description,
  prompt,
  status,
  sending,
  canSend,
  promptPlaceholder,
  agentLayerLabel,
  starterItems,
  onPromptChange,
  onStartConversation,
  onboardingContent,
  guideContent,
}: AgentPageProps) {
  if (onboardingContent) {
    return <>{onboardingContent}</>;
  }

  return (
    <AriContainer className="desk-content desk-session-content" height="100%">
      <AriContainer className="desk-session-shell">
        <AriContainer className="desk-session-head">
          <AriTypography variant="h1" value={title} />
          <AriTypography variant="caption" value={description} />
        </AriContainer>

        <AriContainer className="desk-session-thread-wrap">
          <AriContainer className="desk-thread desk-agent-starter-thread">
            {guideContent || null}

            <AriContainer className="desk-two-cols">
              {starterItems.map((item) => (
                <AriCard key={item.title}>
                  <AriTypography variant="h4" value={item.title} />
                  <AriTypography variant="caption" value={item.description} />
                </AriCard>
              ))}
            </AriContainer>
          </AriContainer>
        </AriContainer>

        <AriContainer className="desk-prompt-dock">
          <AriContainer className="desk-prompt-stack">
            <AriCard className="desk-prompt-agent-layer-card">
              <AriTypography variant="caption" value={agentLayerLabel} />
            </AriCard>
            <AriCard className="desk-prompt-card desk-session-prompt-card">
              <AriInput.TextArea
                className="desk-session-prompt-input"
                value={prompt}
                onChange={onPromptChange}
                variant="borderless"
                rows={3}
                autoSize={{ minRows: 3, maxRows: 10 }}
                placeholder={promptPlaceholder}
              />
              <AriTypography className="desk-prompt-status" variant="caption" value={status || ""} />
              <AriFlex justify="flex-end" align="center" className="desk-prompt-toolbar">
                <AriButton
                  type="default"
                  color="brand"
                  shape="round"
                  icon={sending ? "hourglass_top" : "arrow_upward"}
                  className="desk-prompt-icon-btn"
                  onClick={() => {
                    void onStartConversation();
                  }}
                  disabled={sending || !canSend}
                />
              </AriFlex>
            </AriCard>
          </AriContainer>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
