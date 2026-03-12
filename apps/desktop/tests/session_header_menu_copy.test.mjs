import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 客户端源码文件，供会话 Header 菜单复制能力回归测试复用。
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

test("TestSessionCopyShouldBeMovedToDevDebugPanel", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const devDebugSource = readDesktopSource("src/widgets/dev-debug-float.tsx");
  const sharedDataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 会话 Header 菜单不应再提供“复制会话内容”，该能力应迁移到 Dev 调试窗口。
  assert.doesNotMatch(sessionSource, /key: "copy_session"/);
  assert.doesNotMatch(sessionSource, /label: "复制会话内容"/);
  assert.match(sessionSource, /const buildSessionFullCopyText = \(\) =>/);
  assert.match(sessionSource, /const buildSessionProcessText = \(\) =>/);
  assert.match(sessionSource, /const buildSessionRunSnippetSnapshot = \(\) =>/);
  assert.match(sessionSource, /const buildSessionExecutionConfigText = \(\) =>/);
  assert.match(sessionSource, /const buildSessionProjectSettingsText = \(\) =>/);
  assert.match(sessionSource, /const buildSessionAiRawExchangeText = \(\s*messageId: string,/);
  assert.match(sessionSource, /const buildSessionAiRawExchangeList = \(\s*messageId: string,/);
  assert.match(sessionSource, /const buildSessionRunSnippetText = \(\) =>/);
  assert.match(sessionSource, /const \[sessionCallRecords, setSessionCallRecords\] = useState<SessionCallRecordSnapshot\[]>\(\[\]\);/);
  assert.match(sessionSource, /const appendSessionCallRecord = \(record: SessionCallRecordSnapshot\) =>/);
  assert.doesNotMatch(sessionSource, /const stripPromptSectionsForCopy = \(rawPrompt: string, sectionTitles: string\[\]\) =>/);
  assert.match(sessionSource, /# 会话排查记录/);
  assert.match(sessionSource, /## 一、会话概览/);
  assert.match(sessionSource, /## 二、环境与配置/);
  assert.match(sessionSource, /### 2\.1 会话配置/);
  assert.match(sessionSource, /### 2\.2 项目信息（含项目能力）/);
  assert.match(sessionSource, /## 三、会话内容/);
  assert.match(sessionSource, /### 3\.1 会话消息/);
  assert.doesNotMatch(sessionSource, /### 3\.2 AI 原始收发/);
  assert.match(sessionSource, /## 四、运行片段/);
  assert.match(sessionSource, /## 五、执行过程/);
  assert.match(sessionSource, /### 消息 \{\{index\}\} · \{\{role\}\}/);
  assert.match(sessionSource, /#### 原始消息/);
  assert.match(sessionSource, /#### AI 原始收发/);
  assert.match(sessionSource, /##### 请求 \{\{index\}\}/);
  assert.match(sessionSource, /##### 响应 \{\{index\}\}/);
  assert.doesNotMatch(sessionSource, /### 4\.1 全链路调试/);
  assert.doesNotMatch(sessionSource, /### 4\.2 Trace 记录/);
  assert.doesNotMatch(sessionSource, /###### 请求（Prompt，原始）/);
  assert.doesNotMatch(sessionSource, /###### 响应（Raw）/);
  assert.doesNotMatch(sessionSource, /##### 运行片段/);
  assert.match(sessionSource, /const normalizeRunSegmentIntroForCopy = \(intro: string, step: string\) =>/);
  assert.match(sessionSource, /const shouldHideRunSegmentInCopy = \(\s*intro: string,\s*step: string,\s*status: AssistantRunSegmentStatus,/s);
  assert.match(sessionSource, /normalizeRunSegmentIntroForCopy\(segment\.intro, segment\.step\)/);
  assert.match(sessionSource, /shouldHideRunSegmentInCopy\(segment\.intro, segment\.step, segment\.status\)/);
  assert.match(sessionSource, /isWorkflowStageDividerSegment\(segment\)/);
  assert.match(sessionSource, /t\("工作流阶段"\)/);
  assert.match(sessionSource, /const runSegmentsForRender: AssistantRunSegment\[] = runMeta/);
  assert.match(sessionSource, /const runSegmentGroups = buildRunSegmentGroups\(runSegmentsForRender\);/);
  assert.match(sessionSource, /const renderRunSegmentGroup = \(group: AssistantRunSegmentGroup, segmentKeyPrefix = ""\) => \{/);
  assert.match(sessionSource, /runSegmentGroups\.map\(\(group\) => renderRunSegmentGroup\(group\)\)/);
  assert.match(sessionSource, /runSegmentGroups\.map\(\(group\) => renderRunSegmentGroup\(group, "collapsed-"\)\)/);
  assert.match(sessionSource, /const wrapMarkdownCodeFence = \(content: string, language = "text"\) =>/);
  assert.match(sessionSource, /const wrapMarkdownCodeFencePreserveContent = \(content: string, language = "text"\) =>/);
  assert.match(sessionSource, /wrapMarkdownCodeFencePreserveContent\(exchange\.requestRaw, "text"\)/);
  assert.match(sessionSource, /wrapMarkdownCodeFencePreserveContent\(exchange\.responseRaw, "text"\)/);
  assert.match(sessionSource, /JSON\.stringify\(buildSessionRunSnippetSnapshot\(\), null, 2\)/);
  assert.match(sessionSource, /sessionCallRecords\.length > 0 \? sessionCallRecords : legacyRecords/);
  assert.match(sessionSource, /kind: "step"/);
  assert.match(sessionSource, /kind: "event"/);
  assert.match(sessionSource, /kind: "debug_flow"/);
  assert.match(sessionSource, /kind: "trace"/);
  assert.match(sessionSource, /sessionAiPromptRaw/);
  assert.match(sessionSource, /sessionAiResponseRaw/);
  assert.match(sessionSource, /sessionAiRawByMessage/);
  assert.match(sessionSource, /const assistantMessageId = String\(item\.id \|\| ""\)\.trim\(\);/);
  assert.match(sessionSource, /buildSessionAiRawExchangeText\(\s*assistantMessageId,/);
  assert.match(sessionSource, /setSessionAiRawByMessage\(\(prev\) => \(\{/);
  assert.match(sessionSource, /buildSessionAiRawByMessageItem\(/);
  assert.match(sessionSource, /upsertSessionDebugArtifact\(\{/);
  assert.match(sessionSource, /getSessionDebugArtifact\(normalizedAgentKey, sessionId\)/);
  assert.match(sessionSource, /setSessionCallRecords\(Array\.isArray\(debugArtifact\.callRecords\) \? debugArtifact\.callRecords : \[\]\);/);
  assert.match(sessionSource, /callRecords: sessionCallRecords/);
  assert.match(sessionSource, /agentPromptRawRef/);
  assert.match(sessionSource, /agentLlmDeltaBufferRef/);
  assert.match(sessionSource, /agentLlmResponseRawRef/);
  assert.doesNotMatch(sessionSource, /【全链路调试】/);
  assert.doesNotMatch(sessionSource, /【Trace 记录】/);
  assert.doesNotMatch(sessionSource, /【Workflow 步骤】/);
  assert.doesNotMatch(sessionSource, /【Step 记录】/);
  assert.doesNotMatch(sessionSource, /【事件记录】/);
  assert.doesNotMatch(sessionSource, /【资产记录】/);
  assert.match(sessionSource, /可使用技能列表/);
  assert.doesNotMatch(sessionSource, /技能（已安装并匹配）/);
  assert.doesNotMatch(sessionSource, /技能（仅 ID，未在已安装列表命中）/);
  assert.match(sessionSource, /#### 项目能力/);
  assert.match(sessionSource, /#### 项目知识/);
  assert.match(sessionSource, /#### 依赖策略/);
  assert.match(sessionSource, /#### 工具接入/);
  assert.doesNotMatch(sessionSource, /#### 结构化项目信息/);
  assert.match(sessionSource, /window\.addEventListener\("libra:session-copy-request"/);
  assert.match(sessionSource, /new CustomEvent\("libra:session-copy-result"/);
  assert.match(sessionSource, /会话内容（含过程）已复制/);

  // 描述：
  //
  //   - 调试资产持久化必须同步支持多轮 AI 原始收发与完整调用链，避免复制时只能拿到最后一轮数据。
  assert.match(sharedDataSource, /export interface SessionAiRawExchangeSnapshot/);
  assert.match(sharedDataSource, /export interface SessionAiRawByMessageSnapshot/);
  assert.match(sharedDataSource, /export interface SessionCallRecordSnapshot/);
  assert.match(sharedDataSource, /aiRawByMessage\?: Record<string, SessionAiRawByMessageSnapshot>;/);
  assert.match(sharedDataSource, /callRecords\?: SessionCallRecordSnapshot\[];/);
  assert.match(sharedDataSource, /const normalizedExchanges: SessionAiRawExchangeSnapshot\[] = exchanges\.length > 0/);
  assert.match(sharedDataSource, /callRecords = Array\.isArray\(item\.callRecords\)/);
  assert.match(sharedDataSource, /callRecords: \(input\.callRecords \|\| \[\]\)/);

  // 描述：
  //
  //   - Dev 调试窗口应承载“复制会话内容”按钮，并仅在打开会话时允许点击。
  assert.match(devDebugSource, /label=\{t\("复制会话内容"\)\}/);
  assert.match(devDebugSource, /const resolveSessionIdFromLocation = \(\) =>/);
  assert.match(devDebugSource, /const resolveCopyTargetSessionId = \(\) =>/);
  assert.match(devDebugSource, /const handleStartDrag = \(event: MouseEvent<HTMLButtonElement>\) =>/);
  assert.match(devDebugSource, /const copyTargetSessionId = resolveCopyTargetSessionId\(\);/);
  assert.match(devDebugSource, /const floatStyle = position/);
  assert.match(devDebugSource, /disabled=\{!copyTargetSessionId \|\| Boolean\(copyingSessionId\)\}/);
  assert.match(devDebugSource, /aria-label=\{t\("拖动调试窗口"\)\}/);
  assert.match(devDebugSource, /<AriIcon name="drag_indicator" \/>/);
  assert.match(devDebugSource, /window\.addEventListener\("mousemove", handleDragMove\);/);
  assert.match(devDebugSource, /window\.addEventListener\("mouseup", handleDragEnd\);/);
  assert.match(devDebugSource, /new CustomEvent\("libra:session-debug-request"/);
  assert.match(devDebugSource, /new CustomEvent\("libra:session-copy-request"/);
  assert.match(devDebugSource, /window\.addEventListener\("libra:session-copy-result"/);
  assert.doesNotMatch(devDebugSource, /t\("Dev 调试窗口"\)/);
  assert.doesNotMatch(devDebugSource, /t\("展开"\)/);
  assert.doesNotMatch(devDebugSource, /t\("请先打开一个会话，再复制会话内容。"\)/);
  assert.doesNotMatch(devDebugSource, /t\("当前会话已连接，点击“复制会话内容”可导出完整排查信息。"\)/);
  assert.doesNotMatch(devDebugSource, /desk-dev-debug-body/);
  assert.doesNotMatch(devDebugSource, /AriTypography/);
});
