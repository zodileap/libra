import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取侧边栏源码，用于校验会话重命名弹窗确认按钮配色规范。
//
// Returns:
//
//   - UTF-8 编码源码文本。
function readSidebarSource() {
  const sourcePath = path.resolve(process.cwd(), "src/sidebar/index.tsx");
  return fs.readFileSync(sourcePath, "utf8");
}

test("TestSessionRenameModalConfirmButtonShouldUseBrandColor", () => {
  const source = readSidebarSource();

  // 描述:
  //
  //   - “重命名会话”弹窗的确认按钮应使用品牌色，不应使用 primary。
  assert.match(
    source,
    /title=\{t\("重命名会话"\)\}[\s\S]*?<AriButton[\s\S]*?color="brand"[\s\S]*?label=\{t\("确定"\)\}[\s\S]*?onClick=\{handleConfirmRename\}/,
  );
  assert.doesNotMatch(
    source,
    /title=\{t\("重命名会话"\)\}[\s\S]*?<AriButton[\s\S]*?color="primary"[\s\S]*?label=\{t\("确定"\)\}[\s\S]*?onClick=\{handleConfirmRename\}/,
  );
});
