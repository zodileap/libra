import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthHeaders,
  buildBackendErrorMessage,
  isUnauthorizedResponse,
  toQueryString,
} from "../src/modules/client/services/backend-api-core.mjs";

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

// 描述：校验后端错误文案优先使用业务 message。
test("buildBackendErrorMessage should prefer backend message", () => {
  assert.equal(buildBackendErrorMessage(5001, "业务失败", "fallback"), "[5001] 业务失败");
  assert.equal(buildBackendErrorMessage(5001, "   ", "fallback"), "fallback");
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
