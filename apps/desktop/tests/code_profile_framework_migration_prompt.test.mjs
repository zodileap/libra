import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，用于框架替换提示策略回归测试。
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

test("TestCodeSessionPromptShouldInjectFrameworkReplacementGuards", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 会话提示词层应识别框架替换需求，并注入“结构保持优先”的执行约束。
  assert.match(source, /const CODE_FRAMEWORK_REPLACEMENT_KEYWORDS = \[/);
  assert.match(source, /function isFrameworkReplacementPrompt\(prompt: string\): boolean \{/);
  assert.match(source, /function buildFrameworkReplacementContextLines\(/);
  assert.match(source, /【框架替换执行约束】/);
  assert.match(source, /保持页面结构语义、信息架构和交互目标不变，仅替换框架相关实现。/);
  assert.match(source, /const frameworkReplacementContextLines = buildFrameworkReplacementContextLines\(/);
  assert.match(source, /\.\.\.frameworkReplacementContextLines,/);
  assert.match(source, /if \(!hasUiBaseline && !hasArchitectureBaseline\) \{\s*return \[\];\s*\}/s);
});
