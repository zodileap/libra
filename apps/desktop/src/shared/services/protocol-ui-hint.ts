import type { ProtocolUiHint } from "../types";
import type { WorkflowUiHint } from "../workflow/types";

export interface ProtocolUiHintError {
  code?: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
}

// 描述：归一化协议动作类型，统一输出当前支持的工作流动作键。
function normalizeUiHintActionKind(actionKey: string): WorkflowUiHint["actions"][number]["kind"] {
  return actionKey as WorkflowUiHint["actions"][number]["kind"];
}

// 描述：将 Core 协议 UI Hint 转换为前端工作流可消费结构。
export function mapProtocolUiHint(hint: ProtocolUiHint): WorkflowUiHint {
  return {
    key: hint.key,
    level: hint.level,
    title: hint.title,
    message: hint.message,
    actions: hint.actions.map((action) => ({
      kind: normalizeUiHintActionKind(action.key),
      label: action.label,
      intent: action.intent,
    })),
    context: hint.context,
  };
}

// 描述：按错误码优先、错误消息兜底的策略构建统一 UI Hint。
export function buildUiHintFromProtocolError(
  error: ProtocolUiHintError,
): WorkflowUiHint | null {
  const lowerMessage = error.message.toLowerCase();
  const lowerCode = error.code?.toLowerCase() || "";

  if (
    lowerCode.includes("invalid_bridge_addr")
    || lowerCode.includes("bridge_connect_failed")
    || lowerMessage.includes("当前 blender 会话仍是旧版本")
    || lowerMessage.includes("unsupported action")
    || lowerMessage.includes("unsupported_action")
  ) {
    return {
      key: "restart-blender-bridge",
      level: "warning",
      title: "需要重启 Blender",
      message:
        error.suggestion
        || "Bridge 已自动更新，但当前会话仍是旧版本。请重启 Blender 后点击“我已重启并重试”。",
      actions: [
        { kind: "retry_last_step", label: "我已重启并重试", intent: "primary" },
        { kind: "dismiss", label: "暂不处理", intent: "default" },
      ],
    };
  }

  if (lowerMessage.includes("导出能力已关闭") || lowerCode.includes("capability_disabled")) {
    return {
      key: "export-capability-disabled",
      level: "info",
      title: "导出能力已关闭",
      message:
        error.suggestion
        || "当前会话仍可执行编辑操作；如需导出，请在智能体设置里开启导出能力。",
      actions: [
        { kind: "open_agent_settings", label: "打开智能体设置", intent: "primary" },
        { kind: "dismiss", label: "知道了", intent: "default" },
      ],
    };
  }

  if (
    lowerCode.includes("step_failed")
    || lowerMessage.includes("复杂操作执行失败")
    || lowerMessage.includes("自动回滚")
  ) {
    return {
      key: "complex-operation-recovery",
      level: "warning",
      title: "复杂操作执行失败",
      message:
        error.suggestion
        || "可先重试最近一步；若仍失败，建议应用恢复策略并检查对象状态与参数边界。",
      actions: [
        { kind: "retry_last_step", label: "重试最近一步", intent: "primary" },
        { kind: "apply_recovery_plan", label: "应用恢复策略", intent: "default" },
        { kind: "dismiss", label: "暂不处理", intent: "default" },
      ],
    };
  }

  return null;
}
