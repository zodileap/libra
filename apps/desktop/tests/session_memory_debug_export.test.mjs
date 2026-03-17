import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 会话页源码，供会话记忆调试导出回归测试复用。
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

test("TestSessionMemoryShouldOnlyAppearInDebugExportAndInternalRecords", () => {
  const sessionPageSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 会话记忆应以调试导出文本形式存在，不应额外引入普通会话面板。
  assert.match(sessionPageSource, /const buildSessionMemoryText = \(\) => \{/);
  assert.match(sessionPageSource, /updated_at: sessionMemory\.updatedAt,/);
  assert.match(sessionPageSource, /last_processed_message_id: sessionMemory\.lastProcessedMessageId,/);
  assert.match(sessionPageSource, /preferences: sessionMemory\.preferences,/);
  assert.match(sessionPageSource, /decisions: sessionMemory\.decisions,/);
  assert.match(sessionPageSource, /todos: sessionMemory\.todos,/);
  assert.match(sessionPageSource, /t\("### 3\.2 会话记忆"\),/);
  assert.match(sessionPageSource, /buildSessionMemoryText\(\),/);
  assert.doesNotMatch(sessionPageSource, /title="会话记忆"/);

  // 描述：
  //
  //   - 内部调试记录应覆盖会话记忆请求、原始返回、失败和最终快照四类关键节点。
  assert.match(sessionPageSource, /appendDebugFlowRecord\("ui", "ai_memory_prompt", t\("会话记忆 Prompt"\), memoryPrompt\);/);
  assert.match(sessionPageSource, /"ai_memory_raw",\s*t\("会话记忆原始返回"\)/s);
  assert.match(sessionPageSource, /"ai_memory_error",\s*t\("会话记忆提炼失败"\)/s);
  assert.match(sessionPageSource, /"ai_memory_snapshot",\s*t\("会话记忆更新"\)/s);
});
