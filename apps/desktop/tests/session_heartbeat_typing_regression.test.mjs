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
  const currentDir = process.cwd();
  const desktopRoot = currentDir.endsWith(path.join("apps", "desktop"))
    ? currentDir
    : path.resolve(currentDir, "apps", "desktop");
  const absolutePath = path.resolve(desktopRoot, relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestSessionHeartbeatWaitTextShouldUpdateImmediatelyAfterFirstAnimation", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 等待态文案应统一收口为“正在思考…”，后续仅追加等待时长，不再直接展示后端阶段细节长句。
  assert.match(sessionSource, /function buildAssistantHeartbeatWaitingText\(heartbeatCount: number\): string \{\s*if \(heartbeatCount <= 1\) \{\s*return translateDesktopText\("正在思考…"\);\s*\}\s*const waitedSeconds = Math\.max\(1, Math\.round\(heartbeatCount \* 1\.2\)\);\s*const waitSuffix = translateDesktopText\("（已等待约 \{\{seconds\}\} 秒）", \{ seconds: waitedSeconds \}\);\s*return translateDesktopText\("正在思考…\{\{suffix\}\}", \{ suffix: waitSuffix \}\);\s*\}/s);
  assert.match(sessionSource, /function buildAssistantHeartbeatDisplayText\(_message: string, heartbeatCount: number\): string \{\s*return buildAssistantHeartbeatWaitingText\(heartbeatCount\);\s*\}/s);
  assert.match(sessionSource, /normalizedValue\.startsWith\(translateDesktopText\("正在思考…"\)\)\s*&&\s*normalizedValue\.includes\(translateDesktopText\("（已等待约"\)\)\s*&&\s*normalizedValue\.endsWith\(translateDesktopText\(" 秒）"\)\)/s);

  // 描述：
  //
  //   - 会话页仍保留“立即更新”选项，供最终收尾等场景跳过整段重打字。
  assert.match(sessionSource, /interface StreamingAssistantTargetOptions \{\s*immediate\?: boolean;\s*\}/s);
  assert.match(sessionSource, /if \(options\?\.immediate\) \{\s*stopStreamTypingTimer\(\);\s*streamDisplayedTextRef\.current = targetText;\s*setMessages\(\(prev\) => upsertAssistantMessageById\(prev, messageId, targetText\)\);\s*return;\s*\}/s);

  // 描述：
  //
  //   - 运行中心跳应统一写入状态目标，不再把等待态塞进执行步骤正文。
  assert.match(sessionSource, /String\(heartbeatSegment\.intro \|\| ""\)\.trim\(\) \|\| t\("智能体正在思考…"\)/);
  assert.match(sessionSource, /setStreamingAssistantStatusTarget\(heartbeatText\);/);

  // 描述：
  //
  //   - 当正文区已经显示真实回复时，底部等待指示器应直接隐藏，避免重复出现两条“正在思考…”。
  assert.match(sessionSource, /if \(visibleBodyText\) \{\s*return "";\s*\}/);
  assert.match(sessionSource, /!hasPendingApprovalInRender && !hasPendingUserInputInRender && runningIndicatorText \?/);
});
