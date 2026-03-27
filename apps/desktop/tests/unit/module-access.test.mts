import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveBuildEnabledModules,
  isAgentAuthorized,
  isModuleEnabled,
} from "../../src/router/module-access.ts";

// ── resolveBuildEnabledModules ────────────────────────────────────────

// 描述：校验 "*" 通配符返回全部模块。
test("resolveBuildEnabledModules should return all modules for wildcard", () => {
  const result = resolveBuildEnabledModules("*");
  assert.ok(result.size > 0, "should have at least one module");
});

// 描述：校验空值回退到全部模块。
test("resolveBuildEnabledModules should return all modules for empty input", () => {
  const allModules = resolveBuildEnabledModules("*");
  assert.deepEqual(resolveBuildEnabledModules(""), allModules);
  assert.deepEqual(resolveBuildEnabledModules(undefined), allModules);
  assert.deepEqual(resolveBuildEnabledModules("  "), allModules);
});

// 描述：校验逗号分隔格式正确解析模块白名单。
test("resolveBuildEnabledModules should parse comma-separated list", () => {
  const result = resolveBuildEnabledModules("agent");
  assert.ok(result.has("agent"), "should include 'agent'");
  assert.equal(result.size, 1);
});

// 描述：校验无效模块名被过滤，全部无效时回退到全部模块。
test("resolveBuildEnabledModules should fallback for all-invalid input", () => {
  const allModules = resolveBuildEnabledModules("*");
  const result = resolveBuildEnabledModules("invalid-module,another-fake");
  assert.deepEqual(result, allModules);
});

// ── isAgentAuthorized ─────────────────────────────────────────────────

// 描述：校验已授权智能体返回 true。
test("isAgentAuthorized should return true for matching agent", () => {
  const agents = [{ code: "agent-alpha" }, { code: "agent-beta" }];
  assert.equal(isAgentAuthorized(agents, "agent-alpha"), true);
  assert.equal(isAgentAuthorized(agents, "agent-beta"), true);
});

// 描述：校验大小写不敏感匹配。
test("isAgentAuthorized should be case-insensitive", () => {
  const agents = [{ code: "Agent-Alpha" }];
  assert.equal(isAgentAuthorized(agents, "agent-alpha"), true);
  assert.equal(isAgentAuthorized(agents, "AGENT-ALPHA"), true);
});

// 描述：校验未授权智能体返回 false。
test("isAgentAuthorized should return false for non-matching agent", () => {
  const agents = [{ code: "agent-alpha" }];
  assert.equal(isAgentAuthorized(agents, "agent-gamma"), false);
});

// 描述：校验空列表返回 false。
test("isAgentAuthorized should return false for empty agents list", () => {
  assert.equal(isAgentAuthorized([], "any-agent"), false);
});

// ── isModuleEnabled ───────────────────────────────────────────────────

// 描述：校验集合中存在的模块返回 true。
test("isModuleEnabled should return true for enabled module", () => {
  const enabled = new Set(["agent", "common"]);
  assert.equal(isModuleEnabled(enabled, "agent"), true);
  assert.equal(isModuleEnabled(enabled, "common"), true);
});

// 描述：校验集合中不存在的模块返回 false。
test("isModuleEnabled should return false for disabled module", () => {
  const enabled = new Set(["agent"]);
  assert.equal(isModuleEnabled(enabled, "common"), false);
});
