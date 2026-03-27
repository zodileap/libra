import test from "node:test";
import assert from "node:assert/strict";
import {
  mapProtocolUiHint,
  buildUiHintFromProtocolError,
} from "../../src/shared/services/protocol-ui-hint.ts";

// ── mapProtocolUiHint ─────────────────────────────────────────────────

// 描述：校验协议 UI Hint 映射后关键字段完整。
test("mapProtocolUiHint should preserve key, level, title, message", () => {
  const protocolHint = {
    key: "dangerous-operation-confirm",
    level: "warning",
    title: "检测到潜在危险操作",
    message: "本次指令可能修改场景",
    actions: [
      { key: "allow_once", label: "允许一次并执行", intent: "primary" },
      { key: "deny", label: "取消本次操作", intent: "danger" },
    ],
    context: { reason: "删除/清空类操作" },
  };

  const result = mapProtocolUiHint(protocolHint);
  assert.equal(result.key, protocolHint.key);
  assert.equal(result.level, protocolHint.level);
  assert.equal(result.title, protocolHint.title);
  assert.equal(result.message, protocolHint.message);
  assert.deepEqual(result.context, protocolHint.context);
});

// 描述：校验动作映射将 key 转换为 kind。
test("mapProtocolUiHint should map action key to kind", () => {
  const protocolHint = {
    key: "test-hint",
    level: "info",
    title: "title",
    message: "message",
    actions: [
      { key: "allow_once", label: "允许", intent: "primary" },
      { key: "deny", label: "取消", intent: "danger" },
    ],
    context: {},
  };

  const result = mapProtocolUiHint(protocolHint);
  assert.equal(result.actions.length, 2);
  assert.equal(result.actions[0].kind, "allow_once");
  assert.equal(result.actions[0].label, "允许");
  assert.equal(result.actions[1].kind, "deny");
});

// 描述：校验空动作列表映射正常。
test("mapProtocolUiHint should handle empty actions", () => {
  const protocolHint = {
    key: "empty-test",
    level: "info",
    title: "title",
    message: "message",
    actions: [],
    context: {},
  };
  const result = mapProtocolUiHint(protocolHint);
  assert.equal(result.actions.length, 0);
});

// ── buildUiHintFromProtocolError ──────────────────────────────────────

// 描述：校验 DCC bridge 连接错误映射为 check-dcc-runtime 提示。
test("buildUiHintFromProtocolError should map bridge_connect_failed to check-dcc-runtime", () => {
  const hint = buildUiHintFromProtocolError({
    code: "mcp.model.export.bridge_connect_failed",
    message: "bridge connect failed",
    retryable: true,
  });
  assert.ok(hint !== null);
  assert.equal(hint.key, "check-dcc-runtime");
  assert.equal(hint.level, "warning");
  assert.ok(hint.actions.length >= 2);
  assert.equal(hint.actions[0].kind, "retry_last_step");
});

// 描述：校验 invalid_bridge_addr 错误码命中 DCC Runtime 检查。
test("buildUiHintFromProtocolError should map invalid_bridge_addr to check-dcc-runtime", () => {
  const hint = buildUiHintFromProtocolError({
    code: "mcp.model.invalid_bridge_addr",
    message: "invalid bridge address",
    retryable: true,
  });
  assert.ok(hint !== null);
  assert.equal(hint.key, "check-dcc-runtime");
});

// 描述：校验能力已关闭错误映射为 export-capability-disabled 提示。
test("buildUiHintFromProtocolError should map capability_disabled to export-capability-disabled", () => {
  const hint = buildUiHintFromProtocolError({
    code: "mcp.model.export.capability_disabled",
    message: "导出能力已关闭",
    retryable: false,
  });
  assert.ok(hint !== null);
  assert.equal(hint.key, "export-capability-disabled");
  assert.equal(hint.level, "info");
  assert.ok(hint.actions.some((a) => a.kind === "open_agent_settings"));
});

// 描述：校验 step_failed 错误码映射为复杂操作恢复提示。
test("buildUiHintFromProtocolError should map step_failed to complex-operation-recovery", () => {
  const hint = buildUiHintFromProtocolError({
    code: "mcp.model.step_failed",
    message: "step failed",
    retryable: true,
  });
  assert.ok(hint !== null);
  assert.equal(hint.key, "complex-operation-recovery");
  assert.equal(hint.level, "warning");
  assert.ok(hint.actions.some((a) => a.kind === "retry_last_step"));
  assert.ok(hint.actions.some((a) => a.kind === "apply_recovery_plan"));
});

// 描述：校验 suggestion 字段被采用为 message。
test("buildUiHintFromProtocolError should use suggestion when provided", () => {
  const hint = buildUiHintFromProtocolError({
    code: "mcp.model.export.bridge_connect_failed",
    message: "bridge connect failed",
    suggestion: "请重启 Blender",
    retryable: true,
  });
  assert.ok(hint !== null);
  assert.equal(hint.message, "请重启 Blender");
});

// 描述：校验无匹配的错误返回 null。
test("buildUiHintFromProtocolError should return null for unmatched errors", () => {
  const hint = buildUiHintFromProtocolError({
    code: "unknown.error",
    message: "something went wrong",
    retryable: false,
  });
  assert.equal(hint, null);
});

// 描述：校验空 code 不影响 message 匹配。
test("buildUiHintFromProtocolError should match on message when code is empty", () => {
  const hint = buildUiHintFromProtocolError({
    message: "unsupported action",
    retryable: false,
  });
  assert.ok(hint !== null);
  assert.equal(hint.key, "check-dcc-runtime");
});
