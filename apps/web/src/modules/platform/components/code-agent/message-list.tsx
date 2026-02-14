import { AriContainer, AriTypography } from "aries_react";
import type { CodeMessage } from "../../types";

interface MessageListProps {
  messages: CodeMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <AriContainer className="web-message-list">
      {messages.map((msg) => {
        const user = msg.role === "user";
        return (
          <div
            key={msg.id}
            className={`web-message-card ${user ? "user" : ""}`.trim()}
          >
            <AriTypography
              variant="caption"
              value={`${user ? "你" : "代码智能体"} · ${msg.createdAt}`}
            />
            <div className="web-message-content">{msg.content}</div>
          </div>
        );
      })}
    </AriContainer>
  );
}
