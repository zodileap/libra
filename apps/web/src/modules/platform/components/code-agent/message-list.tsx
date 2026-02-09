import { AriContainer } from "aries_react";
import type { CodeMessage } from "../../types";

interface MessageListProps {
  messages: CodeMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <AriContainer style={{ display: "grid", gap: 12 }}>
      {messages.map((msg) => {
        const user = msg.role === "user";
        return (
          <div
            key={msg.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              background: user ? "#f8fbff" : "#ffffff",
              padding: 12
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 6 }}>
              {user ? "你" : "代码智能体"} · {msg.createdAt}
            </div>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{msg.content}</div>
          </div>
        );
      })}
    </AriContainer>
  );
}
