import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAgentRuntimeCapabilities,
  isPlaywrightInteractiveSkillId,
  buildAgentToolsetLines,
  buildPlaywrightInteractiveRuntimePrompt,
  normalizeAgentSkillId,
  LEGACY_AGENT_SKILL_ID_ALIASES,
  DEFAULT_AGENT_RUNTIME_CAPABILITIES,
} from "../../src/shared/workflow/prompt-guidance.ts";

// ── normalizeAgentSkillId ─────────────────────────────────────────────

// 描述：校验标准技能编码直接返回。
test("normalizeAgentSkillId should pass through standard skill IDs", () => {
  assert.equal(normalizeAgentSkillId("requirements-analyst"), "requirements-analyst");
  assert.equal(normalizeAgentSkillId("frontend-architect"), "frontend-architect");
  assert.equal(normalizeAgentSkillId("test-runner"), "test-runner");
});

// 描述：校验旧版下划线格式映射为标准连字符格式。
test("normalizeAgentSkillId should map legacy underscore IDs to standard format", () => {
  assert.equal(normalizeAgentSkillId("requirements_analyst"), "requirements-analyst");
  assert.equal(normalizeAgentSkillId("frontend_architect"), "frontend-architect");
  assert.equal(normalizeAgentSkillId("frontend_page_builder"), "frontend-page-builder");
  assert.equal(normalizeAgentSkillId("db_designer"), "db-designer");
  assert.equal(normalizeAgentSkillId("api_codegen"), "api-codegen");
  assert.equal(normalizeAgentSkillId("test_runner"), "test-runner");
  assert.equal(normalizeAgentSkillId("report_builder"), "report-builder");
  assert.equal(normalizeAgentSkillId("openapi_model_designer"), "openapi-model-designer");
});

// 描述：校验空值和无效输入返回空字符串。
test("normalizeAgentSkillId should handle empty and falsy inputs", () => {
  assert.equal(normalizeAgentSkillId(""), "");
  assert.equal(normalizeAgentSkillId("  "), "");
  assert.equal(normalizeAgentSkillId(null), "");
  assert.equal(normalizeAgentSkillId(undefined), "");
});

// 描述：校验未知编码原样返回。
test("normalizeAgentSkillId should return unknown ID as-is", () => {
  assert.equal(normalizeAgentSkillId("custom-skill"), "custom-skill");
  assert.equal(normalizeAgentSkillId("my_unknown_skill"), "my_unknown_skill");
});

// ── isPlaywrightInteractiveSkillId ────────────────────────────────────

// 描述：校验 playwright-interactive 命中判定。
test("isPlaywrightInteractiveSkillId should match playwright-interactive", () => {
  assert.equal(isPlaywrightInteractiveSkillId("playwright-interactive"), true);
});

// 描述：校验其他技能编码不命中。
test("isPlaywrightInteractiveSkillId should not match other skills", () => {
  assert.equal(isPlaywrightInteractiveSkillId("requirements-analyst"), false);
  assert.equal(isPlaywrightInteractiveSkillId("playwright"), false);
  assert.equal(isPlaywrightInteractiveSkillId(""), false);
});

// ── normalizeAgentRuntimeCapabilities ─────────────────────────────────

// 描述：校验 null/undefined 输入返回默认值。
test("normalizeAgentRuntimeCapabilities should return defaults for null", () => {
  const result = normalizeAgentRuntimeCapabilities(null);
  assert.deepEqual(result, DEFAULT_AGENT_RUNTIME_CAPABILITIES);
});

// 描述：校验非对象输入返回默认值。
test("normalizeAgentRuntimeCapabilities should return defaults for non-objects", () => {
  assert.deepEqual(normalizeAgentRuntimeCapabilities("string"), DEFAULT_AGENT_RUNTIME_CAPABILITIES);
  assert.deepEqual(normalizeAgentRuntimeCapabilities(42), DEFAULT_AGENT_RUNTIME_CAPABILITIES);
  assert.deepEqual(normalizeAgentRuntimeCapabilities([]), DEFAULT_AGENT_RUNTIME_CAPABILITIES);
});

// 描述：校验有效对象被正确归一化。
test("normalizeAgentRuntimeCapabilities should normalize valid object", () => {
  const result = normalizeAgentRuntimeCapabilities({
    nativeJsRepl: false,
    nativeBrowserTools: false,
    playwrightMcpServerId: "  pw-mcp-1  ",
    playwrightMcpReady: true,
    playwrightMcpName: "Playwright MCP",
    interactiveMode: "mcp",
    skipReason: "",
  });
  assert.equal(result.nativeJsRepl, false);
  assert.equal(result.nativeBrowserTools, false);
  assert.equal(result.playwrightMcpServerId, "pw-mcp-1");
  assert.equal(result.playwrightMcpReady, true);
  assert.equal(result.interactiveMode, "mcp");
  assert.equal(result.skipReason, "");
});

// 描述：校验无效 interactiveMode 回退到 "native"。
test("normalizeAgentRuntimeCapabilities should default invalid interactiveMode to native", () => {
  const result = normalizeAgentRuntimeCapabilities({ interactiveMode: "invalid" });
  assert.equal(result.interactiveMode, "native");
});

// 描述：校验缺失字段使用默认值。
test("normalizeAgentRuntimeCapabilities should fill missing fields with defaults", () => {
  const result = normalizeAgentRuntimeCapabilities({});
  assert.equal(result.nativeJsRepl, true);
  assert.equal(result.nativeBrowserTools, true);
  assert.equal(result.playwrightMcpServerId, "");
  assert.equal(result.playwrightMcpReady, false);
  assert.equal(result.interactiveMode, "native");
});

// ── buildAgentToolsetLines ────────────────────────────────────────────

// 描述：校验工具清单返回非空数组。
test("buildAgentToolsetLines should return non-empty array", () => {
  const lines = buildAgentToolsetLines();
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 10, "should have many tool documentation lines");
});

// 描述：校验工具清单包含关键工具名称。
test("buildAgentToolsetLines should include core tools", () => {
  const text = buildAgentToolsetLines().join("\n");
  assert.ok(text.includes("read_text"), "should mention read_text tool");
  assert.ok(text.includes("run_shell"), "should mention run_shell tool");
  assert.ok(text.includes("apply_patch"), "should mention apply_patch tool");
  assert.ok(text.includes("browser_navigate"), "should mention browser_navigate tool");
});

// 描述：校验传入自定义能力快照不会报错。
test("buildAgentToolsetLines should accept custom capabilities", () => {
  const lines = buildAgentToolsetLines({ interactiveMode: "mcp", playwrightMcpServerId: "pw-1" });
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
});

// ── buildPlaywrightInteractiveRuntimePrompt ───────────────────────────

// 描述：校验 MCP 模式生成的 prompt 包含 MCP 关键内容。
test("buildPlaywrightInteractiveRuntimePrompt should include MCP content for mcp mode", () => {
  const prompt = buildPlaywrightInteractiveRuntimePrompt({
    interactiveMode: "mcp",
    playwrightMcpServerId: "pw-mcp-1",
    playwrightMcpReady: true,
  });
  assert.ok(prompt.includes("MCP"), "should mention MCP");
  assert.ok(prompt.includes("mcp_tool"), "should reference mcp_tool");
});

// 描述：校验 native 模式生成的 prompt 包含原生工具内容。
test("buildPlaywrightInteractiveRuntimePrompt should include native content for native mode", () => {
  const prompt = buildPlaywrightInteractiveRuntimePrompt({ interactiveMode: "native" });
  assert.ok(prompt.includes("js_repl"), "should mention js_repl");
  assert.ok(prompt.includes("browser_"), "should mention browser tools");
});

// 描述：校验默认（无参数）模式不报错。
test("buildPlaywrightInteractiveRuntimePrompt should handle undefined input", () => {
  const prompt = buildPlaywrightInteractiveRuntimePrompt(undefined);
  assert.ok(typeof prompt === "string");
  assert.ok(prompt.length > 0);
});

// ── LEGACY_AGENT_SKILL_ID_ALIASES ─────────────────────────────────────

// 描述：校验别名映射表覆盖所有已知旧版技能编码。
test("LEGACY_AGENT_SKILL_ID_ALIASES should cover all known legacy IDs", () => {
  const expectedAliases = [
    "requirements_analyst",
    "openapi_model_designer",
    "frontend_architect",
    "frontend_page_builder",
    "db_designer",
    "api_codegen",
    "test_runner",
    "report_builder",
  ];
  for (const alias of expectedAliases) {
    assert.ok(alias in LEGACY_AGENT_SKILL_ID_ALIASES, `missing legacy alias: ${alias}`);
  }
});
