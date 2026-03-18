import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供 ChatMarkdown 分级大纲列表回归测试复用。
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

test("TestChatMarkdownShouldKeepOutlineBulletsUnderOrderedSectionHeading", () => {
  const markdownSource = readDesktopSource("src/widgets/chat-markdown.tsx");

  // 描述：
  //
  //   - “2. 范围与依赖：”后面紧跟“ - 包含：”这类 AI 大纲输出，应先做层级修正，避免被误续成 3. 4.。
  assert.match(markdownSource, /function shouldPromoteOutlineChildren\(line: string\): boolean \{/);
  assert.match(markdownSource, /function normalizeOutlineListIndentation\(text: string\): string \{/);
  assert.match(markdownSource, /if \(!shouldPromoteOutlineChildren\(currentLine\)\) \{\s*continue;\s*\}/s);
  assert.match(markdownSource, /normalizedLines\[nextIndex\] = `  \$\{nextLine\}`;/);

  // 描述：
  //
  //   - 列表解析必须感知缩进和列表类型；同级类型变化时应断开，子级缩进时应递归挂到上一项下面。
  assert.match(markdownSource, /interface MarkdownListLineMatch \{/);
  assert.match(markdownSource, /function parseMarkdownListLine\(rawLine: string\): MarkdownListLineMatch \| null \{/);
  assert.match(markdownSource, /if \(listMatch\.indent > expectedIndent\) \{/);
  assert.match(markdownSource, /items\[items\.length - 1\]\.children\.push\(nested\.list\);/);
  assert.match(markdownSource, /if \(listMatch\.ordered !== ordered\) \{\s*break;\s*\}/s);

  // 描述：
  //
  //   - 渲染阶段应支持把子列表继续挂在 li 下面，而不是把所有短横线强行并到同一个有序列表。
  assert.match(markdownSource, /function renderMarkdownListNode\(list: MarkdownListNode, keyPrefix: string\): ReactNode \{/);
  assert.match(markdownSource, /item\.children\.map\(\(child, childIndex\) =>/);
  assert.match(markdownSource, /const lines = normalizeOutlineListIndentation\(text\)\.split\("\\n"\);/);
});
