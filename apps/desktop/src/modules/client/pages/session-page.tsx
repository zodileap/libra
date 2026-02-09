import { useMemo, useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriTypography } from "aries_react";
import { useParams } from "react-router-dom";
import { AGENT_SESSIONS } from "../data";

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [input, setInput] = useState("");

  const session = useMemo(
    () => AGENT_SESSIONS.find((item) => item.id === sessionId),
    [sessionId]
  );

  return (
    <AriContainer className="desk-content desk-session-content" height="100%">
      <div className="desk-session-shell">
        <div className="desk-session-head">
          <AriTypography variant="h1" value={session?.title || "会话详情"} />
          <AriTypography variant="caption" value={`最近更新：${session?.updatedAt || "-"}`} />
        </div>

        <div className="desk-session-thread-wrap">
          <div className="desk-thread">
            <AriCard className="desk-msg user">
              <AriTypography variant="caption" value="你" />
              <AriTypography variant="body" value="请给我一版可维护的模块化实现方案。" />
            </AriCard>
            <AriCard className="desk-msg">
              <AriTypography variant="caption" value="智能体" />
              <AriTypography
                variant="body"
                value="已生成方案：按平台入口、模块边界、core 通用能力三层拆分，并保留可单独售卖能力。"
              />
            </AriCard>
          </div>
        </div>

        <div className="desk-prompt-dock">
          <AriCard className="desk-prompt-card desk-session-prompt-card">
            <AriInput
              value={input}
              onChange={setInput}
              placeholder="继续提问，或要求智能体修改结果..."
            />
            <AriFlex justify="flex-end" style={{ marginTop: 12 }}>
              <AriButton color="primary" label="发送" />
            </AriFlex>
          </AriCard>
        </div>
      </div>
    </AriContainer>
  );
}
