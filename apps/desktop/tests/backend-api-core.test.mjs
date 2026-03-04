import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthHeaders,
  buildBackendErrorMessage,
  buildNetworkFailureMessage,
  isUnauthorizedResponse,
  toQueryString,
} from "../src/shared/services/backend-api-core.mjs";

// 描述：校验鉴权开启且存在 token 时会附带 Authorization 头。
test("buildAuthHeaders should include auth header when enabled", () => {
  const headers = buildAuthHeaders("token-123", true);
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers.Authorization, "Bearer token-123");
});

// 描述：校验鉴权关闭或 token 为空时不附带 Authorization 头。
test("buildAuthHeaders should skip auth header when disabled or empty token", () => {
  const disabledHeaders = buildAuthHeaders("token-123", false);
  assert.equal(disabledHeaders.Authorization, undefined);

  const emptyTokenHeaders = buildAuthHeaders("", true);
  assert.equal(emptyTokenHeaders.Authorization, undefined);
});

// 描述：校验未授权判断逻辑。
test("isUnauthorizedResponse should match http status or business code", () => {
  assert.equal(isUnauthorizedResponse(401, 200), true);
  assert.equal(isUnauthorizedResponse(200, 100001001), true);
  assert.equal(isUnauthorizedResponse(200, 200), false);
});

// 描述：校验后端错误文案会映射为用户友好提示。
test("buildBackendErrorMessage should map backend code to user-friendly message", () => {
  assert.equal(buildBackendErrorMessage(100001001, "token invalid", "fallback"), "登录状态已失效，请重新登录。");
  assert.equal(buildBackendErrorMessage(100002001, "email invalid", "fallback"), "邮箱格式不正确，请检查后重试。");
  assert.equal(buildBackendErrorMessage(100002002, "请求数据不合法", "fallback"), "登录信息不完整或格式不正确，请检查后重试。");
  assert.equal(buildBackendErrorMessage(1008001004, "参数错误", "fallback"), "登录信息不完整或格式不正确，请检查后重试。");
});

// 描述：校验后端 message 未命中特殊规则时回退到通用文案。
test("buildBackendErrorMessage should fallback to generic message", () => {
  assert.equal(buildBackendErrorMessage(5001, "业务失败", "fallback"), "fallback");
  assert.equal(buildBackendErrorMessage(5001, "   ", "fallback"), "fallback");
});

// 描述：校验网络错误文案为用户友好提示，不暴露技术细节。
test("buildNetworkFailureMessage should return user-friendly text", () => {
  const message = buildNetworkFailureMessage("http://127.0.0.1:10001/auth/v1/login", "Load failed");
  assert.equal(message, "无法连接后端服务，请确认服务已启动后重试。");
});

// 描述：校验查询字符串构造会忽略空值并保留有效字段。
test("toQueryString should skip empty values", () => {
  const query = toQueryString({
    userId: "u-1",
    page: 1,
    pageSize: 20,
    keyword: "",
    optional: null,
    unknown: undefined,
  });
  assert.equal(query, "?userId=u-1&page=1&pageSize=20");
});
