import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 客户端源码文件，供会话 Header 菜单复制能力回归测试复用。
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

test("TestSessionHeaderMenuShouldSupportCopyWholeConversation", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 会话 Header 的“更多”菜单应包含“复制会话内容”动作，并支持构建完整会话文本后复制到剪贴板。
  assert.match(source, /key: "copy_session"/);
  assert.match(source, /label: "复制会话内容"/);
  assert.match(source, /const buildSessionConversationText = \(items: MessageItem\[\]\) =>/);
  assert.match(source, /await navigator\.clipboard\.writeText\(fullConversationText\);/);
  assert.match(source, /setStatus\("会话内容已复制"\)/);
  assert.match(source, /setStatus\("复制失败，请检查系统剪贴板权限"\)/);
  assert.match(source, /if \(key === "copy_session"\) \{\s*void handleCopySessionContentByHeaderMenu\(\);\s*return;\s*\}/s);
});

