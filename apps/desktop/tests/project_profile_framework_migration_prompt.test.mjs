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

test("TestSessionPromptShouldInjectFrameworkReplacementGuards", () => {
  const source = [
    readDesktopSource("src/widgets/session/page.tsx"),
    readDesktopSource("src/widgets/session/prompt-utils.ts"),
  ].join("\n");

  // 描述：
  //
  //   - 会话提示词层应识别框架替换需求，并注入“结构保持优先”的执行约束。
  assert.match(source, /resolveDesktopTextVariants/);
  assert.match(source, /DESKTOP_TEXT_VARIANT_GROUPS/);
  assert.match(source, /const CODE_FRAMEWORK_REPLACEMENT_KEYWORDS = resolveDesktopTextVariants\(DESKTOP_TEXT_VARIANT_GROUPS\.codeFrameworkReplacement\);/);
  assert.match(source, /const CODE_FRAMEWORK_GENERIC_NOUN_KEYWORDS = resolveDesktopTextVariants\(DESKTOP_TEXT_VARIANT_GROUPS\.codeFrameworkGenericNouns\);/);
  assert.match(source, /const CODE_FRAMEWORK_GENERIC_VERB_KEYWORDS = resolveDesktopTextVariants\(DESKTOP_TEXT_VARIANT_GROUPS\.codeFrameworkGenericVerbs\);/);
  assert.match(source, /function isFrameworkReplacementPrompt\(prompt: string\): boolean \{/);
  assert.match(source, /function buildFrameworkReplacementContextLines\(/);
  assert.match(source, /【框架替换执行约束】/);
  assert.match(source, /保持页面结构语义、信息架构和交互目标不变，仅替换框架相关实现。/);
  assert.match(source, /const frameworkReplacementContextLines = buildFrameworkReplacementContextLines\(/);
  assert.match(source, /\.\.\.frameworkReplacementContextLines,/);
  assert.match(source, /if \(!hasUiBaseline && !hasArchitectureBaseline\) \{\s*return \[\];\s*\}/s);
  assert.match(source, /const hasFrameworkWord = CODE_FRAMEWORK_GENERIC_NOUN_KEYWORDS\.some\(\(keyword\) => normalized\.includes\(keyword\)\);/);
  assert.match(source, /const hasReplacementVerb = CODE_FRAMEWORK_GENERIC_VERB_KEYWORDS\.some\(\(keyword\) => normalized\.includes\(keyword\)\);/);
});
