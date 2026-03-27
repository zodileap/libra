import test from "node:test";
import assert from "node:assert/strict";
import {
  isAiProvider,
  resolveAiProviderLabel,
  isLocalCliAiProvider,
  resolveAiProviderModelOptions,
  resolveAiProviderModeOptions,
  supportsAiProviderFastModeToggle,
  resolveAiProviderModeSelectValue,
  resolveAiProviderFastModeEnabled,
  composeAiProviderModeValue,
  resolveAiProviderDefaultModel,
  resolveAiProviderDefaultMode,
} from "../../src/shared/ai-provider-catalog.ts";

// ── isAiProvider ──────────────────────────────────────────────────────

// 描述：校验有效 Provider 标识返回 true。
test("isAiProvider should return true for supported providers", () => {
  assert.equal(isAiProvider("codex"), true);
  assert.equal(isAiProvider("gemini"), true);
  assert.equal(isAiProvider("gemini-cli"), true);
  assert.equal(isAiProvider("iflow"), true);
});

// 描述：校验无效 Provider 标识返回 false。
test("isAiProvider should return false for unknown providers", () => {
  assert.equal(isAiProvider("openai"), false);
  assert.equal(isAiProvider(""), false);
  assert.equal(isAiProvider("CODEX"), false);
});

// ── resolveAiProviderLabel ────────────────────────────────────────────

// 描述：校验各 Provider 的展示名称。
test("resolveAiProviderLabel should return display names", () => {
  assert.equal(resolveAiProviderLabel("codex"), "Codex CLI");
  assert.equal(resolveAiProviderLabel("gemini"), "Google Gemini");
  assert.equal(resolveAiProviderLabel("gemini-cli"), "Gemini CLI");
  assert.equal(resolveAiProviderLabel("iflow"), "iFlow API");
});

// ── isLocalCliAiProvider ──────────────────────────────────────────────

// 描述：校验本地 CLI 类型判断。
test("isLocalCliAiProvider should return true for CLI providers", () => {
  assert.equal(isLocalCliAiProvider("codex"), true);
  assert.equal(isLocalCliAiProvider("gemini-cli"), true);
});

// 描述：校验非 CLI Provider 返回 false。
test("isLocalCliAiProvider should return false for non-CLI providers", () => {
  assert.equal(isLocalCliAiProvider("gemini"), false);
  assert.equal(isLocalCliAiProvider("iflow"), false);
});

// ── resolveAiProviderModelOptions ─────────────────────────────────────

// 描述：校验各 Provider 返回非空模型列表。
test("resolveAiProviderModelOptions should return model options", () => {
  assert.ok(resolveAiProviderModelOptions("codex").length > 0, "codex should have models");
  assert.ok(resolveAiProviderModelOptions("gemini").length > 0, "gemini should have models");
  assert.ok(resolveAiProviderModelOptions("iflow").length > 0, "iflow should have models");
});

// 描述：校验模型选项结构正确。
test("resolveAiProviderModelOptions should return proper structure", () => {
  const options = resolveAiProviderModelOptions("codex");
  for (const opt of options) {
    assert.ok(typeof opt.value === "string" && opt.value.length > 0, "value should be non-empty string");
    assert.ok(typeof opt.label === "string" && opt.label.length > 0, "label should be non-empty string");
  }
});

// ── resolveAiProviderModeOptions ──────────────────────────────────────

// 描述：校验 Codex 暴露 reasoning effort 模式选项。
test("resolveAiProviderModeOptions should return modes for codex", () => {
  const modes = resolveAiProviderModeOptions("codex");
  assert.ok(modes.length > 0, "codex should have mode options");
  const values = modes.map((m) => m.value);
  assert.ok(values.includes("low"), "should include 'low'");
  assert.ok(values.includes("high"), "should include 'high'");
});

// 描述：校验非 Codex Provider 返回空模式列表。
test("resolveAiProviderModeOptions should return empty for non-codex", () => {
  assert.equal(resolveAiProviderModeOptions("gemini").length, 0);
  assert.equal(resolveAiProviderModeOptions("iflow").length, 0);
});

// ── supportsAiProviderFastModeToggle ──────────────────────────────────

// 描述：校验仅 Codex 支持 Fast 模式开关。
test("supportsAiProviderFastModeToggle should be true only for codex", () => {
  assert.equal(supportsAiProviderFastModeToggle("codex"), true);
  assert.equal(supportsAiProviderFastModeToggle("gemini"), false);
  assert.equal(supportsAiProviderFastModeToggle("gemini-cli"), false);
  assert.equal(supportsAiProviderFastModeToggle("iflow"), false);
});

// ── resolveAiProviderModeSelectValue ──────────────────────────────────

// 描述：校验 Codex 组合模式解码为 reasoning effort 值。
test("resolveAiProviderModeSelectValue should strip fast prefix for codex", () => {
  assert.equal(resolveAiProviderModeSelectValue("codex", "fast:high"), "high");
  assert.equal(resolveAiProviderModeSelectValue("codex", "fast:medium"), "medium");
  assert.equal(resolveAiProviderModeSelectValue("codex", "fast"), "");
});

// 描述：校验普通模式直接返回。
test("resolveAiProviderModeSelectValue should pass through plain values for codex", () => {
  assert.equal(resolveAiProviderModeSelectValue("codex", "high"), "high");
  assert.equal(resolveAiProviderModeSelectValue("codex", "low"), "low");
});

// 描述：校验非 Codex Provider 直接返回值。
test("resolveAiProviderModeSelectValue should pass through for non-codex", () => {
  assert.equal(resolveAiProviderModeSelectValue("gemini", "fast:high"), "fast:high");
  assert.equal(resolveAiProviderModeSelectValue("iflow", "any-mode"), "any-mode");
});

// 描述：校验空值返回空字符串。
test("resolveAiProviderModeSelectValue should handle empty values", () => {
  assert.equal(resolveAiProviderModeSelectValue("codex", ""), "");
  assert.equal(resolveAiProviderModeSelectValue("codex", null), "");
});

// ── resolveAiProviderFastModeEnabled ──────────────────────────────────

// 描述：校验 Codex 检测 fast 前缀作为 Fast 模式启用标志。
test("resolveAiProviderFastModeEnabled should detect fast prefix for codex", () => {
  assert.equal(resolveAiProviderFastModeEnabled("codex", "fast"), true);
  assert.equal(resolveAiProviderFastModeEnabled("codex", "fast:high"), true);
  assert.equal(resolveAiProviderFastModeEnabled("codex", "fast:medium"), true);
});

// 描述：校验非 fast 前缀返回 false。
test("resolveAiProviderFastModeEnabled should return false for plain modes", () => {
  assert.equal(resolveAiProviderFastModeEnabled("codex", "high"), false);
  assert.equal(resolveAiProviderFastModeEnabled("codex", ""), false);
});

// 描述：校验非 Codex Provider 始终返回 false。
test("resolveAiProviderFastModeEnabled should always return false for non-codex", () => {
  assert.equal(resolveAiProviderFastModeEnabled("gemini", "fast"), false);
  assert.equal(resolveAiProviderFastModeEnabled("iflow", "fast:high"), false);
});

// ── composeAiProviderModeValue ────────────────────────────────────────

// 描述：校验 Codex Fast 模式编码为组合值。
test("composeAiProviderModeValue should compose fast mode value for codex", () => {
  assert.equal(composeAiProviderModeValue("codex", "high", true), "fast:high");
  assert.equal(composeAiProviderModeValue("codex", "medium", true), "fast:medium");
  assert.equal(composeAiProviderModeValue("codex", "", true), "fast");
});

// 描述：校验 Codex 未启用 Fast 时直接返回模式值。
test("composeAiProviderModeValue should return plain value when fast disabled", () => {
  assert.equal(composeAiProviderModeValue("codex", "high", false), "high");
  assert.equal(composeAiProviderModeValue("codex", "", false), "");
});

// 描述：校验非 Codex Provider 忽略 fast 参数。
test("composeAiProviderModeValue should ignore fast flag for non-codex", () => {
  assert.equal(composeAiProviderModeValue("gemini", "any-mode", true), "any-mode");
  assert.equal(composeAiProviderModeValue("iflow", "value", false), "value");
});

// ── resolveAiProviderDefaultModel / resolveAiProviderDefaultMode ──────

// 描述：校验 iflow 有默认模型。
test("resolveAiProviderDefaultModel should return default for iflow", () => {
  assert.ok(resolveAiProviderDefaultModel("iflow").length > 0);
});

// 描述：校验未指定默认模型的 Provider 返回空字符串。
test("resolveAiProviderDefaultModel should return empty for providers without default", () => {
  assert.equal(resolveAiProviderDefaultModel("codex"), "");
  assert.equal(resolveAiProviderDefaultModel("gemini"), "");
});

// 描述：校验默认模式返回值类型正确。
test("resolveAiProviderDefaultMode should return string", () => {
  assert.equal(typeof resolveAiProviderDefaultMode("codex"), "string");
  assert.equal(typeof resolveAiProviderDefaultMode("gemini"), "string");
});
