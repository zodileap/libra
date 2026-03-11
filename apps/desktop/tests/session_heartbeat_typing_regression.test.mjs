import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件并返回 UTF-8 文本，用于等待态逐字动画回归测试。
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

test("TestSessionHeartbeatWaitTextShouldUpdateImmediatelyAfterFirstAnimation", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 等待态文案应统一收口为“正在思考…”，后续仅追加等待时长，不再直接展示后端阶段细节长句。
  assert.match(sessionSource, /function buildAssistantHeartbeatWaitingText\(heartbeatCount: number\): string \{\s*if \(heartbeatCount <= 1\) \{\s*return translateDesktopText\("正在思考…"\);\s*\}\s*const waitedSeconds = Math\.max\(1, Math\.round\(heartbeatCount \* 1\.2\)\);\s*const waitSuffix = translateDesktopText\("（已等待约 \{\{seconds\}\} 秒）", \{ seconds: waitedSeconds \}\);\s*return translateDesktopText\("正在思考…\{\{suffix\}\}", \{ suffix: waitSuffix \}\);\s*\}/s);
  assert.match(sessionSource, /function buildAssistantHeartbeatDisplayText\(_message: string, heartbeatCount: number\): string \{\s*return buildAssistantHeartbeatWaitingText\(heartbeatCount\);\s*\}/s);

  // 描述：
  //
  //   - 会话页应为流式目标文本提供“立即更新”选项，供等待时长刷新跳过整段重打字。
  assert.match(sessionSource, /interface StreamingAssistantTargetOptions \{\s*immediate\?: boolean;\s*\}/s);
  assert.match(sessionSource, /if \(options\?\.immediate\) \{\s*stopStreamTypingTimer\(\);\s*streamDisplayedTextRef\.current = targetText;\s*setMessages\(\(prev\) => upsertAssistantMessageById\(prev, messageId, targetText\)\);\s*return;\s*\}/s);

  // 描述：
  //
  //   - 首次等待态仍允许逐字动画，后续 heartbeat 仅更新“已等待约 N 秒”文案，不应再次从头逐字渲染。
  assert.match(sessionSource, /String\(heartbeatSegment\.intro \|\| ""\)\.trim\(\) \|\| t\("智能体正在思考…"\)/);
  assert.match(sessionSource, /\{\s*immediate: assistantRunHeartbeatCountRef\.current > 1,\s*\}/);
  assert.match(sessionSource, /setStreamingAssistantTarget\(heartbeatText,\s*\{\s*immediate: assistantRunHeartbeatCountRef\.current > 1,\s*\}\);/s);
});
