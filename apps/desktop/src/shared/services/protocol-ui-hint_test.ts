import { buildUiHintFromProtocolError, mapProtocolUiHint } from "./protocol-ui-hint";
import type { ProtocolUiHint } from "../types";

// 描述：提供最小断言能力，避免测试依赖第三方框架。
//
// Params:
//
//   - condition: 断言条件。
//   - message: 断言失败消息。
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// 描述：验证协议 UI Hint 映射后关键字段完整且动作语义保持一致。
function TestMapProtocolUiHintShouldKeepFields(): void {
  const protocolUiHint: ProtocolUiHint = {
    key: "dangerous-operation-confirm",
    level: "warning",
    title: "检测到潜在危险操作",
    message: "本次指令可能修改场景",
    actions: [
      { key: "allow_once", label: "允许一次并执行", intent: "primary" },
      { key: "deny", label: "取消本次操作", intent: "danger" },
    ],
    context: {
      reason: "删除/清空类操作",
    },
  };

  const workflowUiHint = mapProtocolUiHint(protocolUiHint);
  assert(workflowUiHint.key === protocolUiHint.key, "映射后 key 不一致");
  assert(workflowUiHint.level === protocolUiHint.level, "映射后 level 不一致");
  assert(workflowUiHint.actions.length === 2, "映射后 actions 数量不正确");
  assert(workflowUiHint.actions[0]?.kind === "allow_once", "首个动作 kind 映射错误");
}

// 描述：验证 Bridge 连接错误会映射为“重启 Blender”修复提示。
function TestBuildUiHintShouldMapBridgeError(): void {
  const uiHint = buildUiHintFromProtocolError({
    code: "mcp.model.export.bridge_connect_failed",
    message: "bridge connect failed",
    retryable: true,
  });
  assert(uiHint?.key === "restart-blender-bridge", "Bridge 错误未映射到重启提示");
}

// 描述：验证能力关闭错误会映射为“打开智能体设置”提示。
function TestBuildUiHintShouldMapCapabilityDisabledError(): void {
  const uiHint = buildUiHintFromProtocolError({
    code: "mcp.model.export.capability_disabled",
    message: "导出能力已关闭",
    retryable: false,
  });
  assert(uiHint?.key === "export-capability-disabled", "能力关闭错误未映射到设置提示");
  assert(
    Boolean(uiHint?.actions.some((action) => action.kind === "open_agent_settings")),
    "能力关闭提示缺少打开智能体设置动作",
  );
}

// 描述：验证协议中的智能体设置动作会原样保留。
function TestMapProtocolUiHintShouldKeepAgentSettingsAction(): void {
  const protocolUiHint: ProtocolUiHint = {
    key: "open-agent-settings",
    level: "info",
    title: "打开设置",
    message: "使用当前动作键",
    actions: [{ key: "open_agent_settings", label: "打开智能体设置", intent: "primary" }],
  };

  const workflowUiHint = mapProtocolUiHint(protocolUiHint);
  assert(
    workflowUiHint.actions[0]?.kind === "open_agent_settings",
    "智能体设置动作未保持为 open_agent_settings",
  );
}

// 描述：验证未知错误不会返回误导性的 UI Hint。
function TestBuildUiHintShouldReturnNullForUnknownError(): void {
  const uiHint = buildUiHintFromProtocolError({
    code: "unknown.error",
    message: "unknown",
    retryable: false,
  });
  assert(uiHint === null, "未知错误不应映射 UI Hint");
}

// 描述：验证复杂操作失败可映射到恢复交互提示。
function TestBuildUiHintShouldMapComplexRecoveryError(): void {
  const uiHint = buildUiHintFromProtocolError({
    code: "core.desktop.scene.step_failed",
    message: "复杂操作执行失败，已自动回滚",
    retryable: true,
  });
  assert(uiHint?.key === "complex-operation-recovery", "复杂失败错误未映射恢复提示");
  assert(
    Boolean(uiHint?.actions.some((action) => action.kind === "apply_recovery_plan")),
    "恢复提示缺少 apply_recovery_plan 动作",
  );
}

// 描述：顺序执行测试函数并在失败时抛错，供脚本化执行。
function runAllProtocolUiHintTests(): void {
  const tests: Array<() => void> = [
    TestMapProtocolUiHintShouldKeepFields,
    TestBuildUiHintShouldMapBridgeError,
    TestBuildUiHintShouldMapCapabilityDisabledError,
    TestMapProtocolUiHintShouldKeepAgentSettingsAction,
    TestBuildUiHintShouldReturnNullForUnknownError,
    TestBuildUiHintShouldMapComplexRecoveryError,
  ];
  for (const test of tests) {
    test();
  }
}

runAllProtocolUiHintTests();
