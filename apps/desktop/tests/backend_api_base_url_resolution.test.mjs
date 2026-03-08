import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 后端请求服务源码，校验默认基地址解析策略。
//
// Returns:
//
//   - 源码文本。
function readBackendApiSource() {
  const sourcePath = path.resolve(process.cwd(), "src/shared/services/backend-api.ts");
  return fs.readFileSync(sourcePath, "utf8");
}

test("TestDesktopBackendApiBaseUrlShouldFallbackToDirectLocalhost", () => {
  const source = readBackendApiSource();

  // 描述：
  //
  //   - Desktop 远端模式应统一通过单一后端入口解析 account、runtime 与 setup 请求；未接入后端时走本地模式兜底。
  assert.match(source, /function resolveConfiguredServiceBaseUrl\(/);
  assert.match(source, /service: "account" \| "runtime" \| "setup",/);
  assert.match(source, /return buildDesktopBackendBaseUrl\(\);/);
  assert.match(source, /function isDesktopBackendEnabled\(\): boolean \{/);
  assert.match(source, /if \(!isDesktopBackendEnabled\(\)\) \{/);
  assert.match(source, /return getLocalDesktopUser\(\);/);
  assert.match(source, /return getLocalAvailableAgents\(\);/);
  assert.match(source, /upsertSessionMessages\(\{/);
  assert.match(source, /return getAgentSessions\("agent"\)\.map/);
  assert.doesNotMatch(source, /agentCodeBaseUrl/);
  assert.doesNotMatch(source, /agent3dBaseUrl/);
});
