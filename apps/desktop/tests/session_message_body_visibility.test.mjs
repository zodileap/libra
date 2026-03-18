import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 会话页源码，供正文可见性与流式状态覆盖回归测试复用。
//
// Returns:
//
//   - 会话页源码文本。
function readSessionSource() {
  const currentDir = process.cwd();
  const desktopRoot = currentDir.endsWith(path.join("apps", "desktop"))
    ? currentDir
    : path.resolve(currentDir, "apps", "desktop");
  return fs.readFileSync(
    path.resolve(desktopRoot, "src/widgets/session/page.tsx"),
    "utf8",
  );
}

test("TestSessionShouldPreserveAssistantBodyWhenRunSegmentsUpdate", () => {
  const source = readSessionSource();

  // 描述：
  //
  //   - 会话页应把“正文显示”和“状态提示”拆开，避免 planning / heartbeat 覆盖已经流出的正文。
  assert.match(source, /function resolveVisibleAssistantBodyText\(/);
  assert.match(source, /const setStreamingAssistantStatusTarget = \(targetText: string\) => \{/);
  assert.match(source, /payload\.kind === STREAM_KINDS\.PLANNING[\s\S]*setStreamingAssistantStatusTarget\(planningText\);/);
  assert.match(source, /payload\.kind === STREAM_KINDS\.HEARTBEAT[\s\S]*setStreamingAssistantStatusTarget\(heartbeatText\);/);
  assert.match(source, /setStreamingAssistantStatusTarget\(t\("正在准备执行\.\.\."\)\);/);
  assert.match(source, /setStreamingAssistantStatusTarget\(t\("正在生成执行结果…"\)\);/);

  // 描述：
  //
  //   - 带 runMeta 的助手消息仍应渲染可见正文，而不是只剩结构化轨迹和分割线。
  assert.match(source, /const visibleAssistantBodyText = runMeta\s*\?\s*resolveVisibleAssistantBodyText\(message\.text, runMeta\)\s*:\s*"";/);
  assert.match(source, /visibleAssistantBodyText \? \(\s*<AriContainer className="desk-run-body" padding=\{0\}>\s*<ChatMarkdown content=\{visibleAssistantBodyText\} \/>/s);

  // 描述：
  //
  //   - agent 上下文提炼也应优先复用可见正文，避免 generic summary 把真实正文挤掉。
  assert.match(source, /resolveVisibleAssistantBodyText\(item\.text, runMeta\)/);
});
