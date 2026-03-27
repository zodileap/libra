import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthHeaders,
  buildBackendErrorMessage,
  buildNetworkFailureMessage,
  isUnauthorizedResponse,
  toQueryString,
} from "../../src/shared/services/backend-api-core.mjs";

// ── buildAuthHeaders ──────────────────────────────────────────────────

// 描述：校验鉴权开启且存在 token 时会附带 Authorization 头。
test("buildAuthHeaders should include auth header when enabled with token", () => {
  const headers = buildAuthHeaders("token-123", true);
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers.Authorization, "Bearer token-123");
});

// 描述：校验鉴权关闭时不附带 Authorization 头。
test("buildAuthHeaders should skip auth header when disabled", () => {
  const headers = buildAuthHeaders("token-123", false);
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers.Authorization, undefined);
});

// 描述：校验鉴权开启但 token 为空时不附带 Authorization 头。
test("buildAuthHeaders should skip auth header when token is empty", () => {
  assert.equal(buildAuthHeaders("", true).Authorization, undefined);
});

// 描述：校验鉴权开启但 token 为 falsy 时不附带 Authorization 头。
test("buildAuthHeaders should skip auth header when token is falsy", () => {
  assert.equal(buildAuthHeaders(null, true).Authorization, undefined);
  assert.equal(buildAuthHeaders(undefined, true).Authorization, undefined);
});

// ── isUnauthorizedResponse ────────────────────────────────────────────

// 描述：校验 HTTP 401 状态码命中未授权判定。
test("isUnauthorizedResponse should return true for HTTP 401", () => {
  assert.equal(isUnauthorizedResponse(401, 0), true);
  assert.equal(isUnauthorizedResponse(401, 200), true);
});

// 描述：校验业务码 100001001 命中未授权判定。
test("isUnauthorizedResponse should return true for business code 100001001", () => {
  assert.equal(isUnauthorizedResponse(200, 100001001), true);
});

// 描述：校验其它状态码不会命中未授权判定。
test("isUnauthorizedResponse should return false for normal responses", () => {
  assert.equal(isUnauthorizedResponse(200, 200), false);
  assert.equal(isUnauthorizedResponse(500, 0), false);
  assert.equal(isUnauthorizedResponse(403, 0), false);
});

// ── buildBackendErrorMessage ──────────────────────────────────────────

// 描述：校验已知业务码映射到特定用户友好提示。
test("buildBackendErrorMessage should map known error codes to friendly messages", () => {
  assert.equal(
    buildBackendErrorMessage(100001001, "token invalid", "fallback"),
    "登录状态已失效，请重新登录。",
  );
  assert.equal(
    buildBackendErrorMessage(100002001, "email invalid", "fallback"),
    "邮箱格式不正确，请检查后重试。",
  );
  assert.equal(
    buildBackendErrorMessage(100002002, "any message", "fallback"),
    "登录信息不完整或格式不正确，请检查后重试。",
  );
  assert.equal(
    buildBackendErrorMessage(1008001004, "any message", "fallback"),
    "登录信息不完整或格式不正确，请检查后重试。",
  );
});

// 描述：校验包含 password 关键词的 message 回退到参数错误提示。
test("buildBackendErrorMessage should detect password keyword in message", () => {
  assert.equal(
    buildBackendErrorMessage(5001, "invalid password", "fallback"),
    "请求参数不正确，请检查输入后重试。",
  );
  assert.equal(
    buildBackendErrorMessage(5001, "PASSWORD required", "fallback"),
    "请求参数不正确，请检查输入后重试。",
  );
});

// 描述：校验包含中文特殊关键词的 message 回退到参数错误提示。
test("buildBackendErrorMessage should detect Chinese parameter keywords", () => {
  assert.equal(
    buildBackendErrorMessage(5001, "请求数据不合法", "fallback"),
    "请求参数不正确，请检查输入后重试。",
  );
  assert.equal(
    buildBackendErrorMessage(5001, "参数: email is required", "fallback"),
    "请求参数不正确，请检查输入后重试。",
  );
});

// 描述：校验未命中规则时回退到 fallback。
test("buildBackendErrorMessage should fallback for unknown codes", () => {
  assert.equal(buildBackendErrorMessage(5001, "业务失败", "my-fallback"), "my-fallback");
  assert.equal(buildBackendErrorMessage(5001, "   ", "my-fallback"), "my-fallback");
  assert.equal(buildBackendErrorMessage(9999, "", "default-msg"), "default-msg");
});

// ── buildNetworkFailureMessage ────────────────────────────────────────

// 描述：校验网络错误文案为用户友好提示，不暴露 URL 和技术细节。
test("buildNetworkFailureMessage should return user-friendly text", () => {
  const message = buildNetworkFailureMessage("http://127.0.0.1:10001/auth/v1/login", "Load failed");
  assert.equal(message, "无法连接后端服务，请确认服务已启动后重试。");
});

// 描述：校验任意 URL 输入均返回统一提示。
test("buildNetworkFailureMessage should ignore URL and detail content", () => {
  const message = buildNetworkFailureMessage("https://example.com/api", "CORS error");
  assert.equal(message, "无法连接后端服务，请确认服务已启动后重试。");
});

// ── toQueryString ─────────────────────────────────────────────────────

// 描述：校验有效参数拼接为正确的查询字符串。
test("toQueryString should build query from valid params", () => {
  const query = toQueryString({ userId: "u-1", page: 1, pageSize: 20 });
  assert.equal(query, "?userId=u-1&page=1&pageSize=20");
});

// 描述：校验空值参数被过滤。
test("toQueryString should skip empty, null and undefined values", () => {
  const query = toQueryString({
    userId: "u-1",
    keyword: "",
    optional: null,
    unknown: undefined,
  });
  assert.equal(query, "?userId=u-1");
});

// 描述：校验空对象返回空字符串。
test("toQueryString should return empty string for empty params", () => {
  assert.equal(toQueryString({}), "");
  assert.equal(toQueryString(null), "");
  assert.equal(toQueryString(undefined), "");
});

// 描述：校验数字 0 和 false 作为有效值保留。
test("toQueryString should keep zero and false as valid values", () => {
  const query = toQueryString({ page: 0, active: false });
  assert.equal(query, "?page=0&active=false");
});
