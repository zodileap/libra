import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供侧边栏用户提问运行态持久化回归测试复用。
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

test("TestSidebarRunStateShouldPreserveUserInputAcrossNavigation", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const sharedDataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 侧边栏流式映射应识别 request_user_input，并把 requestId / questions 透传到可恢复片段数据。
  assert.match(sidebarSource, /interface AgentRequestUserInputEventData \{/);
  assert.match(sidebarSource, /function resolveUserInputEventData\(payload: AgentTextStreamEvent\): AgentRequestUserInputEventData \{/);
  assert.match(sidebarSource, /function buildUserInputSegmentData\(payload: AgentTextStreamEvent\): Record<string, unknown> \{/);
  assert.match(sidebarSource, /request_id: String\(resolved\.request_id \|\| ""\)\.trim\(\)/);
  assert.match(sidebarSource, /question_count: Array\.isArray\(resolved\.questions\) \? resolved\.questions\.length : 0/);
  assert.match(sidebarSource, /questions: resolved\.questions \|\| \[\]/);
  assert.match(sidebarSource, /if \(payload\.kind === STREAM_KINDS\.REQUEST_USER_INPUT\) \{/);
  assert.match(sidebarSource, /intro: t\("需要用户决定"\)/);
  assert.match(sidebarSource, /step: t\("正在询问 \{\{count\}\} 个问题", \{ count: questionCount \}\)/);
  assert.match(sidebarSource, /if \(toolName === "request_user_input"\) \{\s*return null;\s*\}/s);

  // 描述：
  //
  //   - 切页恢复时应把 pending user_input 当作交互阻塞片段，忽略 heartbeat 覆盖，并在完成后写入 answered\/ignored 结果。
  assert.match(sidebarSource, /const isUserInputPendingSegment = \(segment: SessionRunMeta\["segments"\]\[number\]\) => \{/);
  assert.match(sidebarSource, /stepType === "user_input_request"/);
  assert.match(sidebarSource, /const hasPendingInteractiveSegment = \(current\.segments \|\| \[\]\)\.some\(/);
  assert.match(sidebarSource, /isApprovalPendingSegment\(item\) \|\| isUserInputPendingSegment\(item\)/);
  assert.match(sidebarSource, /if \(hasPendingInteractiveSegment && incomingSegmentKind === STREAM_KINDS\.HEARTBEAT\) \{\s*return current;\s*\}/s);
  assert.match(sidebarSource, /const markUserInputSegmentResolvedInMeta = \(/);
  assert.match(sidebarSource, /const requestId = String\(resultData\.request_id \|\| ""\)\.trim\(\);/);
  assert.match(sidebarSource, /const resolution = String\(resultData\.resolution \|\| ""\)\.trim\(\) === "ignored"/);
  assert.match(sidebarSource, /markUserInputSegmentResolvedInMeta\(nextMeta, requestId, resolution, answers\)/);
  assert.match(sidebarSource, /resolution: "ignored"/);
  assert.match(sidebarSource, /answers: \[\]/);

  // 描述：
  //
  //   - 持久化白名单必须保留用户提问的 request / resolution / questions / answers，避免刷新后丢失展开详情。
  assert.match(sharedDataSource, /function sanitizeRunSegmentUserInputQuestions\(/);
  assert.match(sharedDataSource, /function sanitizeRunSegmentUserInputAnswers\(/);
  assert.match(sharedDataSource, /if \(typeof data\.request_id === "string"\) \{\s*next\.request_id = truncateRunStateText\(data\.request_id, 120\);\s*\}/s);
  assert.match(sharedDataSource, /if \(typeof data\.resolution === "string"\) \{\s*next\.resolution = truncateRunStateText\(data\.resolution, 32\);\s*\}/s);
  assert.match(sharedDataSource, /if \(Number\.isFinite\(Number\(data\.question_count\)\)\) \{\s*next\.question_count = Math\.max\(0, Math\.floor\(Number\(data\.question_count\)\)\);\s*\}/s);
  assert.match(sharedDataSource, /const questions = sanitizeRunSegmentUserInputQuestions\(data\.questions\);/);
  assert.match(sharedDataSource, /next\.questions = questions;/);
  assert.match(sharedDataSource, /const answers = sanitizeRunSegmentUserInputAnswers\(data\.answers\);/);
  assert.match(sharedDataSource, /next\.answers = answers;/);
});
