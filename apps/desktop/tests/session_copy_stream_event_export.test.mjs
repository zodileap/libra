import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供会话复制导出中的流式事件回归测试复用。
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

test("TestSessionCopyShouldIncludeRunningStreamEventsInProcessExport", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 会话复制导出应把运行中的文本流事件写入 sessionCallRecords，避免排查时只能看到最终 invoke 结果。
  assert.match(
    sessionSource,
    /const buildAgentTextStreamCallRecord = \(\s*payload: AgentTextStreamEvent,\s*messageId: string,\s*\): SessionCallRecordSnapshot \| null => \{/s,
  );
  assert.match(
    sessionSource,
    /if \(!kind \|\| kind === STREAM_KINDS\.DELTA \|\| kind === STREAM_KINDS\.FINISHED\) \{\s*return null;\s*\}/s,
  );
  assert.match(sessionSource, /kind: "stream_event"/);
  assert.match(sessionSource, /event: kind,/);
  assert.match(sessionSource, /stream_stage: resolveAssistantRunStageByAgentTextStream\(payload\),/);
  assert.match(
    sessionSource,
    /const planningText = kind === STREAM_KINDS\.PLANNING\s*\?\s*resolvePlanningDisplayText\(payload\)\s*:\s*"";/s,
  );
  assert.match(sessionSource, /nextPayload\.display_message = planningText;/);
  assert.match(sessionSource, /nextPayload\.message = eventMessage;/);
  assert.match(sessionSource, /nextPayload\.data = payload\.data as Record<string, unknown>;/);
  assert.match(
    sessionSource,
    /const streamCallRecord = buildAgentTextStreamCallRecord\(payload, streamMessageIdRef\.current\);\s*if \(streamCallRecord\) \{\s*appendSessionCallRecord\(streamCallRecord\);\s*\}/s,
  );
});
