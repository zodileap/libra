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
  //   - Desktop 默认应直连本地服务端口，避免依赖 dev 代理前缀导致登录路由 404。
  assert.match(source, /const accountBaseUrl = resolveServiceBaseUrl\(import\.meta\.env\.VITE_ACCOUNT_BASE_URL, "http:\/\/127\.0\.0\.1:18080"\);/);
  assert.match(source, /const runtimeBaseUrl = resolveServiceBaseUrl\(import\.meta\.env\.VITE_RUNTIME_BASE_URL, "http:\/\/127\.0\.0\.1:18081"\);/);
  assert.match(source, /const agentCodeBaseUrl = resolveServiceBaseUrl\(import\.meta\.env\.VITE_AGENT_CODE_BASE_URL, "http:\/\/127\.0\.0\.1:18082"\);/);
  assert.match(source, /const agent3dBaseUrl = resolveServiceBaseUrl\(import\.meta\.env\.VITE_AGENT_3D_BASE_URL, "http:\/\/127\.0\.0\.1:18083"\);/);
});
