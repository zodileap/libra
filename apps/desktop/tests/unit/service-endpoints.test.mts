import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDesktopBackendBaseUrl,
  normalizeDesktopUpdateManifestUrl,
} from "../../src/shared/services/service-endpoints.ts";

// ── normalizeDesktopBackendBaseUrl ────────────────────────────────────

// 描述：校验纯 ip:port 输入自动补全为 http:// 前缀。
test("normalizeDesktopBackendBaseUrl should prepend http for ip:port", () => {
  assert.equal(normalizeDesktopBackendBaseUrl("127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(normalizeDesktopBackendBaseUrl("192.168.1.1:3000"), "http://192.168.1.1:3000");
});

// 描述：校验已有 http/https 协议的输入保持不变。
test("normalizeDesktopBackendBaseUrl should keep existing http/https protocol", () => {
  assert.equal(normalizeDesktopBackendBaseUrl("http://example.com:8080"), "http://example.com:8080");
  assert.equal(normalizeDesktopBackendBaseUrl("https://example.com"), "https://example.com");
});

// 描述：校验输入中的路径、查询参数和 hash 被清除。
test("normalizeDesktopBackendBaseUrl should strip path and query", () => {
  assert.equal(normalizeDesktopBackendBaseUrl("http://example.com/api?foo=bar#hash"), "http://example.com");
  assert.equal(normalizeDesktopBackendBaseUrl("http://example.com/"), "http://example.com");
});

// 描述：校验尾部斜杠被去除。
test("normalizeDesktopBackendBaseUrl should remove trailing slash", () => {
  const result = normalizeDesktopBackendBaseUrl("http://example.com/");
  assert.ok(!result.endsWith("/"), "trailing slash should be removed");
});

// 描述：校验非 http/https 协议回退到 fallback。
test("normalizeDesktopBackendBaseUrl should reject non-http protocols", () => {
  assert.equal(normalizeDesktopBackendBaseUrl("ftp://example.com", "fb"), "fb");
  assert.equal(normalizeDesktopBackendBaseUrl("ws://example.com", "fb"), "fb");
});

// 描述：校验空值和无效输入回退到 fallback。
test("normalizeDesktopBackendBaseUrl should fallback for empty input", () => {
  assert.equal(normalizeDesktopBackendBaseUrl("", "default"), "default");
  assert.equal(normalizeDesktopBackendBaseUrl(null, "default"), "default");
  assert.equal(normalizeDesktopBackendBaseUrl(undefined, "default"), "default");
  assert.equal(normalizeDesktopBackendBaseUrl("   ", "default"), "default");
});

// 描述：校验 fallback 默认值为空字符串。
test("normalizeDesktopBackendBaseUrl should default fallback to empty string", () => {
  assert.equal(normalizeDesktopBackendBaseUrl(""), "");
});

// ── normalizeDesktopUpdateManifestUrl ─────────────────────────────────

// 描述：校验完整 HTTPS URL 保持不变并保留路径。
test("normalizeDesktopUpdateManifestUrl should keep full https URL with path", () => {
  const url = "https://open.zodileap.com/libra/updates/latest.json";
  assert.equal(normalizeDesktopUpdateManifestUrl(url), url);
});

// 描述：校验纯域名自动补全 https:// 前缀。
test("normalizeDesktopUpdateManifestUrl should prepend https for bare domain", () => {
  assert.equal(
    normalizeDesktopUpdateManifestUrl("open.zodileap.com/libra/updates/latest.json"),
    "https://open.zodileap.com/libra/updates/latest.json",
  );
});

// 描述：校验 http 协议同样接受。
test("normalizeDesktopUpdateManifestUrl should accept http protocol", () => {
  const url = "http://localhost:8080/updates/latest.json";
  assert.equal(normalizeDesktopUpdateManifestUrl(url), url);
});

// 描述：校验 hash 被清除但路径和查询参数保留。
test("normalizeDesktopUpdateManifestUrl should strip hash but keep path and query", () => {
  const result = normalizeDesktopUpdateManifestUrl("https://example.com/path?v=1#section");
  assert.ok(result.includes("/path"), "path should be preserved");
  assert.ok(result.includes("?v=1"), "query should be preserved");
  assert.ok(!result.includes("#section"), "hash should be removed");
});

// 描述：校验非 http/https 协议回退到 fallback。
test("normalizeDesktopUpdateManifestUrl should reject non-http protocols", () => {
  assert.equal(normalizeDesktopUpdateManifestUrl("ftp://example.com/file", "fb"), "fb");
});

// 描述：校验空值回退到 fallback。
test("normalizeDesktopUpdateManifestUrl should fallback for empty input", () => {
  assert.equal(normalizeDesktopUpdateManifestUrl("", "default"), "default");
  assert.equal(normalizeDesktopUpdateManifestUrl(null, "default"), "default");
  assert.equal(normalizeDesktopUpdateManifestUrl(undefined, "default"), "default");
});
