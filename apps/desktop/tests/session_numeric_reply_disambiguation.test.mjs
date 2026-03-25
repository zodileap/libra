import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供数字短回复消歧回归测试复用。
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

test("TestSessionNumericReplyShouldAskAiToDisambiguateBeforeExecuting", () => {
  const promptUtilsSource = readDesktopSource("src/widgets/session/prompt-utils.ts");
  const routingSource = readDesktopSource("src/widgets/session/execution-routing.ts");

  // 描述：
  //
  //   - Prompt 工具层应显式识别纯数字短回复，并在最近助手消息中提取可映射的编号候选。
  assert.match(promptUtilsSource, /const INDEXED_SHORT_REPLY_REGEX =/);
  assert.match(promptUtilsSource, /export function isIndexedShortReplyPrompt\(/);
  assert.match(promptUtilsSource, /function extractNumberedOptionCandidates\(/);
  assert.match(promptUtilsSource, /function findIndexedReplyOptionMatch\(/);
  assert.match(promptUtilsSource, /function buildIndexedShortReplyGuidanceLines\(/);
  assert.match(promptUtilsSource, /最近命中的候选项：\{\{option\}\}/);
  assert.match(promptUtilsSource, /我没有在最近的助手消息里提取到可稳定映射的编号选项。/);
  assert.match(promptUtilsSource, /不要把“\{\{index\}\}”当成新的任务，也不要直接开始项目检查或执行。/);
  assert.match(promptUtilsSource, /当前没有对应的 \{\{index\}\} 选项。直接说你要我继续改的具体点。/);
  assert.match(promptUtilsSource, /const indexedShortReplyGuidanceLines = buildIndexedShortReplyGuidanceLines\(/);
  assert.match(promptUtilsSource, /\.\.\.indexedShortReplyGuidanceLines,/);

  // 描述：
  //
  //   - 消息级路由应把纯数字短回复标记为“待消歧的普通对话”，避免直接落到“缺少执行意图”的泛化分支。
  assert.match(routingSource, /isIndexedShortReplyPrompt/);
  assert.match(routingSource, /if \(isIndexedShortReplyPrompt\(normalizedMessageText\)\) \{/);
  assert.match(routingSource, /检测到数字短回复，将先结合上文候选项做消歧判断。/);
  assert.match(routingSource, /routeKind: "chat"/);
});
