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
  assert.match(source, /payload\.kind === STREAM_KINDS\.DELTA[\s\S]*patchLatestSessionAiRawExchange\(/);
  assert.doesNotMatch(source, /setStreamingAssistantTarget\(agentStreamTextBufferRef\.current\);/);
  assert.doesNotMatch(source, /payload\.kind === STREAM_KINDS\.ERROR[\s\S]*setStreamingAssistantTarget\(errorSummary\);/);
  assert.doesNotMatch(source, /payload\.kind === STREAM_KINDS\.CANCELLED[\s\S]*setStreamingAssistantTarget\(cancelledSummary\);/);
  assert.doesNotMatch(source, /const failedAssistantReply = t\("执行失败：\{\{reason\}\}", \{ reason \}\);\s*setStreamingAssistantTarget\(t\("执行失败：\{\{reason\}\}", \{ reason \}\)\);/s);

  // 描述：
  //
  //   - 带 runMeta 的助手消息必须走单一时间线渲染，不能再拆成顶部正文区和底部总结区。
  //   - 时间线构建依赖的标题规范化辅助函数必须保持模块级定义，避免被挪到组件内后运行时才触发 ReferenceError。
  assert.match(source, /function normalizeRunSegmentIntroForCopy\(intro: string, step: string\): string \{/);
  assert.doesNotMatch(source, /const normalizeRunSegmentIntroForCopy = \(intro: string, step: string\) => \{/);
  assert.match(source, /function buildAssistantRunTimelineState\(/);
  assert.match(source, /function syncAssistantRunMetaTimeline\(/);
  assert.match(source, /function resolveRenderableAssistantRunTimeline\(/);
  assert.match(source, /function resolveVisibleAssistantRunTimeline\(/);
  assert.match(source, /const renderableTimeline = runMeta\s*\?\s*resolveRenderableAssistantRunTimeline\(message\.text, runMeta\)\s*:\s*\[\];/);
  assert.match(source, /const visibleTimeline = runMeta\s*\?\s*resolveVisibleAssistantRunTimeline\(/s);
  assert.match(source, /visibleTimeline\.map\(\(item\) => renderRunTimelineItem\(item\)\)/);
  assert.match(source, /\{t\("执行轨迹"\)\}/);
  assert.doesNotMatch(source, /const visibleAssistantBodyText = runMeta\s*\?\s*resolveVisibleAssistantBodyText\(message\.text, runMeta\)\s*:\s*"";/);
  assert.doesNotMatch(source, /content=\{visibleAssistantBodyText\}/);

  // 描述：
  //
  //   - agent 上下文提炼应优先复用时间线尾部有效内容，而不是顶部正文/通用占位文本。
  assert.match(source, /function resolveAssistantRunContextText\(/);
  assert.match(source, /resolveAssistantRunContextText\(item\.text, runMeta\)/);
});
