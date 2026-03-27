import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInvokeErrorDetail,
  normalizeInvokeError,
  DEFAULT_DCC_PROVIDER_ADDR,
} from "../../src/shared/services/dcc-runtime.ts";

// ── normalizeInvokeErrorDetail ────────────────────────────────────────

// 描述：校验字符串错误被包装为 message 字段。
test("normalizeInvokeErrorDetail should wrap string error", () => {
  const result = normalizeInvokeErrorDetail("connection failed");
  assert.equal(result.message, "connection failed");
  assert.equal(result.retryable, false);
  assert.equal(result.code, undefined);
});

// 描述：校验 Error 实例提取 message 字段。
test("normalizeInvokeErrorDetail should extract message from Error", () => {
  const result = normalizeInvokeErrorDetail(new Error("timeout"));
  assert.equal(result.message, "timeout");
  assert.equal(result.retryable, false);
});

// 描述：校验对象错误保留 code、suggestion 和 retryable。
test("normalizeInvokeErrorDetail should preserve structured error fields", () => {
  const result = normalizeInvokeErrorDetail({
    code: "bridge.timeout",
    message: "bridge timed out",
    suggestion: "restart the bridge",
    retryable: true,
  });
  assert.equal(result.code, "bridge.timeout");
  assert.equal(result.message, "bridge timed out");
  assert.equal(result.suggestion, "restart the bridge");
  assert.equal(result.retryable, true);
});

// 描述：校验对象 message 为空时回退到 JSON.stringify。
test("normalizeInvokeErrorDetail should fallback to JSON stringify for objects without message", () => {
  const result = normalizeInvokeErrorDetail({ code: "err-001", data: "some-data" });
  assert.ok(result.message.includes("err-001"));
  assert.ok(result.message.includes("some-data"));
});

// 描述：校验 null/undefined 输入返回"未知错误"。
test("normalizeInvokeErrorDetail should return unknown error for null/undefined", () => {
  const nullResult = normalizeInvokeErrorDetail(null);
  assert.ok(nullResult.message.length > 0);
  assert.equal(nullResult.retryable, false);

  const undefinedResult = normalizeInvokeErrorDetail(undefined);
  assert.ok(undefinedResult.message.length > 0);
});

// 描述：校验数字输入返回"未知错误"。
test("normalizeInvokeErrorDetail should handle numeric error", () => {
  const result = normalizeInvokeErrorDetail(42);
  assert.ok(result.message.length > 0);
});

// 描述：校验 non-string code/suggestion 被丢弃。
test("normalizeInvokeErrorDetail should drop non-string code and suggestion", () => {
  const result = normalizeInvokeErrorDetail({
    code: 123,
    message: "err",
    suggestion: 456,
    retryable: false,
  });
  assert.equal(result.code, undefined);
  assert.equal(result.suggestion, undefined);
});

// ── normalizeInvokeError ──────────────────────────────────────────────

// 描述：校验字符串错误直接返回。
test("normalizeInvokeError should return string for string error", () => {
  assert.equal(normalizeInvokeError("network error"), "network error");
});

// 描述：校验 Error 实例返回 message。
test("normalizeInvokeError should return message from Error instance", () => {
  assert.equal(normalizeInvokeError(new Error("fail")), "fail");
});

// 描述：校验对象错误返回 message 字段。
test("normalizeInvokeError should return message from object error", () => {
  assert.equal(normalizeInvokeError({ message: "something broke" }), "something broke");
});

// ── DEFAULT_DCC_PROVIDER_ADDR ─────────────────────────────────────────

// 描述：校验默认 DCC Provider 地址格式。
test("DEFAULT_DCC_PROVIDER_ADDR should be a valid address", () => {
  assert.ok(DEFAULT_DCC_PROVIDER_ADDR.includes(":"), "should contain port separator");
  assert.ok(DEFAULT_DCC_PROVIDER_ADDR.includes("127.0.0.1"), "should be localhost");
});
