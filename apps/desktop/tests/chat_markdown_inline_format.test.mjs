import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供 ChatMarkdown 行内语法回归测试复用。
//
// Params:
//
//   - relativePath: 基于 apps/desktop 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readDesktopSource(relativePath) {
  const currentDir = process.cwd();
  const desktopRoot = currentDir.endsWith(path.join("apps", "desktop"))
    ? currentDir
    : path.resolve(currentDir, "apps", "desktop");
  const absolutePath = path.resolve(desktopRoot, relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestChatMarkdownShouldSupportInlineMarkdownInsideSentence", () => {
  const markdownSource = readDesktopSource("src/widgets/chat-markdown.tsx");

  // 描述：
  //
  //   - 行内解析器应改为顺序扫描，不再依赖“整段完全匹配”的粗暴正则。
  assert.doesNotMatch(markdownSource, /const LINK_REGEX =/);
  assert.doesNotMatch(markdownSource, /const BOLD_REGEX =/);
  assert.doesNotMatch(markdownSource, /const ITALIC_REGEX =/);
  assert.match(markdownSource, /while \(cursor < text\.length\) \{/);
  assert.match(markdownSource, /const flushTextBuffer = \(\) => \{/);

  // 描述：
  //
  //   - 句中加粗、斜体、链接、行内代码都必须逐段识别，并允许在列表项中继续复用。
  assert.match(markdownSource, /text\.startsWith\("`", cursor\)/);
  assert.match(markdownSource, /text\.startsWith\("\*\*", cursor\)/);
  assert.match(markdownSource, /renderInlineMarkdown\(text\.slice\(cursor \+ 2, boldEnd\)\)/);
  assert.match(markdownSource, /text\.startsWith\("\*", cursor\)/);
  assert.match(markdownSource, /renderInlineMarkdown\(text\.slice\(cursor \+ 1, italicEnd\)\)/);
  assert.match(markdownSource, /text\.startsWith\("\[", cursor\)/);
  assert.match(markdownSource, /const label = text\.slice\(cursor \+ 1, labelEnd\);/);
  assert.match(markdownSource, /const href = text\.slice\(labelEnd \+ 2, hrefEnd\);/);
  assert.match(markdownSource, /renderInlineMarkdown\(label\)/);
  assert.match(markdownSource, /renderInlineMarkdown\(item\)/);
});
