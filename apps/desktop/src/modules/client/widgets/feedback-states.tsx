import { AriContainer, AriTypography } from "aries_react";

type DeskFeedbackKind = "loading" | "empty" | "error";

interface DeskFeedbackStateProps {
  kind: DeskFeedbackKind;
  title: string;
  message: string;
}

// 描述:
//
//   - 渲染 Desktop 统一反馈块，用于加载态、空态和错误态的视觉与文案结构统一。
//
// Params:
//
//   - kind: 反馈类型。
//   - title: 主标题。
//   - message: 辅助说明文案。
export function DeskFeedbackState({ kind, title, message }: DeskFeedbackStateProps) {
  return (
    <AriContainer className={`desk-feedback-state desk-feedback-state-${kind}`}>
      <AriTypography variant="h4" value={title} />
      <AriTypography variant="caption" value={message} />
    </AriContainer>
  );
}
