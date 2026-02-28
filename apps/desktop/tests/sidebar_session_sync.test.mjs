import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 侧边栏源码，验证会话同步逻辑。
//
// Params:
//
//   - relativePath: 基于 apps/desktop 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readDesktopSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestSidebarShouldRefreshWhenRouteSessionMissingInList", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");

  // 描述：
  //
  //   - 当路由已定位到会话详情，但侧边栏列表尚未包含该会话时，应自动触发刷新。
  assert.match(source, /missingSessionSyncAttemptsRef/);
  assert.match(source, /if \(!selectedSessionKey\) \{/);
  assert.match(source, /sessions\.some\(\(item\) => item\.id === selectedSessionKey\)/);
  assert.match(source, /if \(attempts >= 2\) \{/);
  assert.match(source, /void refreshSessions\(\);/);
});
