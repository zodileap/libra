import test from "node:test";
import assert from "node:assert/strict";
import {
  isCancelErrorCode,
  defaultServiceUrl,
  IS_BROWSER,
  COMMANDS,
  STREAM_KINDS,
  STORAGE_KEYS,
  DEFAULT_SERVICE_PORTS,
} from "../../src/shared/constants.ts";

// ── isCancelErrorCode ─────────────────────────────────────────────────

// 描述：校验取消类错误码返回 true。
test("isCancelErrorCode should return true for cancel error codes", () => {
  assert.equal(isCancelErrorCode("core.agent.request_cancelled"), true);
  assert.equal(isCancelErrorCode("core.agent.python.orchestration_timeout"), true);
  assert.equal(isCancelErrorCode("core.agent.human_approval_timeout"), true);
});

// 描述：校验非取消类错误码返回 false。
test("isCancelErrorCode should return false for non-cancel codes", () => {
  assert.equal(isCancelErrorCode("error"), false);
  assert.equal(isCancelErrorCode("cancelled"), false);
  assert.equal(isCancelErrorCode("timeout"), false);
  assert.equal(isCancelErrorCode(""), false);
  assert.equal(isCancelErrorCode("unknown"), false);
});

// ── defaultServiceUrl ─────────────────────────────────────────────────

// 描述：校验返回正确的 localhost URL 格式。
test("defaultServiceUrl should return correct localhost URL", () => {
  assert.equal(defaultServiceUrl("backend"), `http://127.0.0.1:${DEFAULT_SERVICE_PORTS.backend}`);
  assert.equal(defaultServiceUrl("app"), `http://127.0.0.1:${DEFAULT_SERVICE_PORTS.app}`);
});

// 描述：校验 backend 端口为 10001。
test("defaultServiceUrl should use port 10001 for backend", () => {
  assert.equal(defaultServiceUrl("backend"), "http://127.0.0.1:10001");
});

// 描述：校验 app 端口为 11001。
test("defaultServiceUrl should use port 11001 for app", () => {
  assert.equal(defaultServiceUrl("app"), "http://127.0.0.1:11001");
});

// ── IS_BROWSER ────────────────────────────────────────────────────────

// 描述：校验在 Node.js 环境下 IS_BROWSER 为 false。
test("IS_BROWSER should be false in Node.js environment", () => {
  assert.equal(IS_BROWSER, false);
});

// ── 常量结构完整性 ────────────────────────────────────────────────────

// 描述：校验 COMMANDS 对象包含关键命令名称。
test("COMMANDS should define essential command names", () => {
  assert.ok(typeof COMMANDS.LIST_AGENT_SKILLS === "string");
  assert.ok(typeof COMMANDS.LIST_REGISTERED_MCPS === "string");
});

// 描述：校验 STREAM_KINDS 包含关键流式事件类型。
test("STREAM_KINDS should define essential stream event kinds", () => {
  assert.equal(STREAM_KINDS.STARTED, "started");
  assert.equal(STREAM_KINDS.DELTA, "delta");
  assert.equal(STREAM_KINDS.FINISHED, "finished");
  assert.equal(STREAM_KINDS.ERROR, "error");
  assert.equal(STREAM_KINDS.CANCELLED, "cancelled");
});

// 描述：校验 STORAGE_KEYS 包含关键存储键。
test("STORAGE_KEYS should define essential storage keys", () => {
  assert.ok(typeof STORAGE_KEYS.COLOR_THEME_MODE === "string");
  assert.ok(typeof STORAGE_KEYS.AI_KEYS === "string");
  assert.ok(typeof STORAGE_KEYS.DESKTOP_BACKEND_CONFIG === "string");
});
