import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取 Desktop 源码文件，校验统一智能体会话与日志口径。
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

test("TestWorkflowEngineFileShouldBeRemovedAfterUnification", () => {
  const enginePath = path.resolve(process.cwd(), "src/shared/workflow/engine.ts");

  // 描述:
  //
  //   - 旧工作流引擎文件应被移除，统一复用当前会话执行链路。
  assert.equal(fs.existsSync(enginePath), false);
});

test("TestSessionPageShouldRemoveLegacyBridgeBranch", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - 单智能体会话页不应再保留历史 Bridge 预检分支，并应保留统一重试入口。
  assert.doesNotMatch(source, /Bridge 预检/);
  assert.match(source, /handleRetryAssistantMessage/);
});

test("TestSessionConfigShouldUseUnifiedAgentNaming", () => {
  const dataSource = readDesktopSource("src/shared/data.ts");
  const configSource = readDesktopSource("src/widgets/session/config.ts");

  // 描述:
  //
  //   - 项目缓存应只使用统一智能体项目存储键，不再保留旧双入口兼容键。
  assert.match(dataSource, /const AGENT_PROJECT_STORAGE_KEY = "libra\.desktop\.agent\.projects"/);
  assert.match(dataSource, /window\.localStorage\.setItem\(AGENT_PROJECT_STORAGE_KEY,/);
  assert.doesNotMatch(dataSource, /LEGACY_AGENT_PROJECT_STORAGE_KEY/);

  // 描述:
  //
  //   - 会话 UI 配置应只保留统一智能体命名。
  assert.match(configSource, /export const AGENT_SESSION_UI_CONFIG: SessionAgentUiConfig = \{/);
  assert.match(configSource, /workflowFallbackLabel: translateDesktopText\("智能体工作流"\)/);
  assert.match(configSource, /return AGENT_SESSION_UI_CONFIG;/);
  assert.doesNotMatch(configSource, /SCENE_SESSION_UI_CONFIG/);
  assert.doesNotMatch(configSource, /MODEL_SESSION_UI_CONFIG/);
});

test("TestSessionPageShouldThrottlePersistenceAndUsePlainTextDuringStreaming", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - 流式期间应降低 localStorage 持久化频率，并将进行中的消息降级为纯文本渲染，减少主线程压力。
  assert.match(source, /sessionMessagePersistTimerRef/);
  assert.match(source, /const persistDelay = sending \? 1200 : 180/);
  assert.match(source, /plainText=\{[\s\S]*message\.id === streamMessageIdRef\.current[\s\S]*\}/);
});

test("TestTauriHealthChecksShouldRunInSpawnBlocking", () => {
  const source = readDesktopSource("src-tauri/src/main.rs");

  // 描述:
  //
  //   - DCC Runtime / Codex 健康检查应放入后台线程执行，避免阻塞 Tauri 主事件循环导致窗口卡顿。
  assert.match(source, /async fn check_dcc_runtime_status/);
  assert.match(source, /spawn_blocking\(move \|\| \{/);
  assert.match(source, /async fn check_codex_cli_health/);
  assert.match(source, /spawn_blocking\(move \|\| check_codex_cli_health_inner/);
});

test("TestSessionLayoutShouldAlignUserRightAndAssistantLeft", () => {
  const source = readDesktopSource("src/styles.css");
  const markdownSource = readDesktopSource("src/widgets/chat-markdown.tsx");
  const runSegmentSource = readDesktopSource("src/widgets/session/run-segment.tsx");

  // 描述:
  //
  //   - 会话布局应确保用户消息右对齐、智能体消息左对齐，贴近主流聊天交互。
  assert.match(source, /\.desk-msg\.user\s*\{[\s\S]*align-self:\s*flex-end/);
  assert.match(source, /\.desk-msg\.assistant\s*\{[\s\S]*align-self:\s*flex-start/);
  assert.match(source, /--desk-run-text-primary:\s*var\(--z-color-text\);/);
  assert.match(source, /--desk-run-text-secondary:\s*color-mix/);
  assert.match(source, /--desk-run-text-tertiary:\s*color-mix/);
  assert.match(source, /\.desk-run-intro\s*\{[\s\S]*color:\s*var\(--desk-run-text-primary\)/);
  assert.match(source, /\.desk-run-step-body\s*\{[\s\S]*font-size:\s*var\(--desk-run-step-font-size\);[\s\S]*line-height:\s*var\(--desk-run-step-line-height\);[\s\S]*color:\s*var\(--desk-run-text-primary\);/);
  assert.match(source, /\.desk-run-step-body \.desk-md-list\s*\{[\s\S]*list-style-position:\s*inside;[\s\S]*padding-inline-start:\s*0;/);
  assert.match(source, /\.desk-run-step-body \.desk-md-quote\s*\{[\s\S]*border-radius:\s*0;/);
  assert.match(markdownSource, /{index > 0 \? <br \/> : null}/);
  assert.match(markdownSource, /const orderedStart = ordered \? Number\.parseInt\(listMatch\[1\], 10\) \|\| 1 : undefined;/);
  assert.match(markdownSource, /<ListTag[\s\S]*start=\{orderedStart\}/s);
  assert.match(source, /\.desk-run-step-rich\s*\{[\s\S]*color:\s*var\(--desk-run-text-tertiary\)/);
  assert.match(source, /\.desk-run-step-file-link\s*\{[\s\S]*max-inline-size:\s*min\(100%,\s*calc\(var\(--z-inset\)\s*\*\s*24\)\);/);
  assert.match(source, /\.desk-run-step-file-link\s*\{[\s\S]*text-overflow:\s*ellipsis;/);
  assert.match(source, /\.desk-run-step-file-link\s*\{[\s\S]*white-space:\s*nowrap;/);
  assert.match(source, /\.desk-run-segment-detail-title\s*\{[\s\S]*min-inline-size:/);
  assert.match(source, /\.desk-run-segment-detail-title\s*\{[\s\S]*color:\s*var\(--desk-run-text-secondary\)/);
  assert.match(source, /\.desk-run-segment-detail-summary\s*\{[\s\S]*color:\s*var\(--desk-run-text-tertiary\)/);
  assert.match(source, /\.desk-run-step-rich\s*\{[\s\S]*padding:\s*var\(--z-inset-sm\);/);
  assert.match(source, /\.desk-run-segment-detail-shell\s*\{[\s\S]*padding-left:\s*var\(--z-inset\)\s*!important;/);
  assert.match(source, /\.desk-run-segment-detail-row\s*\{[\s\S]*display:\s*grid;/);
});

test("TestRepositoryAgentsShouldDefineDesktopMessageTaxonomy", () => {
  const source = readDesktopSource("../../Agents.md");
  const runSegmentSource = readDesktopSource("src/widgets/session/run-segment.tsx");

  // 描述:
  //
  //   - 仓库规范应明确 Desktop 会话消息只允许四种类型，避免后续继续把正文按来源拆散。
  //   - 运行日志中的非结构化步骤正文也应复用正文渲染，而不是退回到独立纯文本 step。
  assert.match(source, /Desktop 会话消息类型约束/);
  assert.match(source, /1\.\s*正文/);
  assert.match(source, /2\.\s*结构化状态/);
  assert.match(source, /3\.\s*分割线/);
  assert.match(source, /4\.\s*状态卡片/);
  assert.match(source, /禁止额外发明第五种消息形态/);
  assert.match(runSegmentSource, /function renderRunSegmentBodyContent\(/);
  assert.match(runSegmentSource, /className="desk-run-segment-static-step"/);
  assert.match(runSegmentSource, /\{renderRunSegmentBodyContent\(segment\.text, segment\.status === "running" \? "desk-run-step-running" : ""\)\}/);
  assert.doesNotMatch(runSegmentSource, /AriTypography[\s\S]*value=\{segment\.text\}/);
});

test("TestSessionPageShouldRenderCollapsibleRunDividerAndSummary", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");
  const promptUtilsSource = readDesktopSource("src/widgets/session/prompt-utils.ts");
  const styleSource = readDesktopSource("src/styles.css");
  const messagesSource = readDesktopSource("src/shared/i18n/messages.ts");

  // 描述:
  //
  //   - 执行完成后应渲染可点击的用时分割线，并在其下展示总结内容。
  //   - 工作流阶段正文应保留在运行日志与 agent context 中，但不应被当成独立 transcript 消息置顶渲染。
  assert.match(source, /className=\"desk-run-divider\"/);
  assert.match(source, /className=\"desk-run-divider desk-run-divider-static desk-run-stage-divider\"/);
  assert.match(source, /formatElapsedDuration\(runMeta.startedAt, runMeta.finishedAt\)/);
  assert.match(source, /className=\{`desk-run-summary/);
  assert.match(source, /control\?: "continue" \| "done";/);
  assert.match(source, /display_message\?: string;/);
  assert.match(source, /const responseDisplayMessage = sanitizeWorkflowStageDisplayMessage\(/);
  assert.match(source, /const responseControl = String\(response\.control \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "done"/);
  assert.match(source, /const completionDecision = hasWorkflowStages\s*\?\s*resolveWorkflowStageCompletionDecision\(/s);
  assert.match(source, /const effectiveResponseDisplayMessage = completionDecision\.displayMessage;/);
  assert.match(source, /if \(hasWorkflowStages && effectiveResponseControl !== "done"\) \{/);
  assert.match(promptUtilsSource, /export function upsertAssistantMessageBeforeAnchorById\(/);
  assert.match(promptUtilsSource, /export function filterWorkflowStageContextMessages\(/);
  assert.match(source, /const stored = filterWorkflowStageContextMessages\(/);
  assert.match(source, /messages: filterWorkflowStageContextMessages\(messages\)/);
  assert.doesNotMatch(source, /setMessages\(\(prev\) => upsertAssistantMessageBeforeAnchorById\(\s*prev,\s*stageContextMessageId,\s*responseDisplayMessage,\s*streamMessageId,\s*\)\)/s);
  assert.match(source, /function buildWorkflowCompletionSummary\(/);
  assert.match(source, /function collectWorkflowStageSummaryItems\(/);
  assert.match(source, /function buildWorkflowExecutionSummaryPrompt\(/);
  assert.match(source, /const requestWorkflowExecutionSummary = async \(/);
  assert.match(source, /function sanitizeWorkflowStageDisplayMessage\(/);
  assert.match(source, /const WORKFLOW_STAGE_AUTO_COMPLETION_LEAD_LINE_PATTERNS = \[/);
  assert.match(source, /function stripWorkflowStageAutoCompletionPlaceholder\(/);
  assert.match(source, /stripWorkflowStageAutoCompletionPlaceholder\(String\(value \|\| ""\)\)/);
  assert.match(source, /normalizedValue\.startsWith\("脚本执行完成（自动补全结果）："\)/);
  assert.match(source, /const WORKFLOW_STAGE_DIAGNOSTIC_LINE_PATTERNS = \[/);
  assert.match(styleSource, /\.desk-run-divider-line \{[^}]*background:\s*color-mix\(in srgb,\s*var\(--z-color-border-brand\)\s*72%,\s*var\(--z-color-border-glass\)\);[^}]*\}/);
  assert.doesNotMatch(styleSource, /\.desk-run-divider-line \{[^}]*var\(--z-color-primary\)[^}]*\}/);
  assert.match(source, /const explicitCommand = String\(\s*typeof segmentData\.terminal_command === "string" \? segmentData\.terminal_command : "",\s*\)\.trim\(\);/s);
  assert.match(source, /return translateDesktopText\("已记录当前阶段结果。"\);/);
  assert.match(source, /groups\.push\(\{\s*key: `run-group-\$\{groups\.length\}-default`,\s*title: "",\s*kind: "default",/s);
  assert.doesNotMatch(source, /key: `run-group-\$\{groups\.length\}-\$\{translateDesktopText\("执行过程"\)\}`[\s\S]*title: translateDesktopText\("执行过程"\),/s);
  assert.match(source, /function resolveFinalAssistantRunSummary\(/);
  assert.match(source, /const finalSummary = resolveFinalAssistantRunSummary\(/);
  assert.match(messagesSource, /"已记录当前阶段结果。": "已记录当前阶段结果。"/);
  assert.match(source, /const workflowSummaryResult = workflowCompletionDigest\s*\?\s*await requestWorkflowExecutionSummary\(/s);
  assert.match(source, /finishAssistantRunMessage\(\s*streamMessageId,\s*"finished",\s*workflowSummaryResult\.summary,\s*workflowSummaryResult\.summarySource,\s*\)/s);
  assert.match(source, /const visibleRunSummaryText = runMeta\?\.summarySource === "ai"\s*\?\s*String\(runMeta\.summary \|\| ""\)\.trim\(\)\s*:\s*"";/s);
  assert.match(source, /content=\{visibleRunSummaryText\}/);
  assert.doesNotMatch(source, /visible_summary:\s*\{\s*type:\s*"markdown",\s*content:\s*runMeta\.summary \|\| message\.text/s);
  assert.doesNotMatch(source, /finishAssistantRunMessage\(streamMessageId, "finished", t\("执行过程已完成。"\)\);/);
  assert.match(styleSource, /\.desk-run-stage-divider/);
  assert.match(styleSource, /\.desk-run-divider-static/);
});

test("TestSessionPageShouldKeepHeartbeatDuringLongWait", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - 在长时间无流式事件时，应存在心跳机制持续输出进行中提示，避免用户感知卡死。
  assert.match(source, /function buildAssistantHeartbeatSegment/);
  assert.match(source, /const startAssistantRunHeartbeat = \(messageId: string\) =>/);
  assert.match(source, /等待工具返回本步结果…/);
});

test("TestSessionDataShouldPersistTranscriptAndAgentContextSeparately", () => {
  const source = readDesktopSource("src/shared/data.ts");

  // 描述:
  //
  //   - UI transcript 与 agent context 必须使用两套本地存储键和独立读写函数，避免关闭软件后只恢复一侧状态。
  assert.match(source, /const SESSION_MESSAGES_STORAGE_KEY = "libra\.desktop\.session\.messages";/);
  assert.match(source, /const SESSION_AGENT_CONTEXT_MESSAGES_STORAGE_KEY = "libra\.desktop\.session\.agent\.context\.messages";/);
  assert.match(source, /function readSessionAgentContextMessages\(\): StoredSessionMessageGroup\[\] \{/);
  assert.match(source, /function writeSessionAgentContextMessages\(groups: StoredSessionMessageGroup\[\]\) \{/);
  assert.match(source, /export function upsertSessionMessages\(input: \{[\s\S]*messages: input\.messages,[\s\S]*writeSessionMessages\(next\);/);
  assert.match(source, /export function getSessionAgentContextMessages\(/);
  assert.match(source, /export function upsertSessionAgentContextMessages\(input: \{/);
  assert.match(source, /messages: input\.messages\.slice\(-200\),/);
});

test("TestSessionRunStateShouldKeepHistoricalSegmentsAcrossRestart", () => {
  const source = readDesktopSource("src/shared/data.ts");

  // 描述:
  //
  //   - 前端执行过程历史在软件关闭后重开仍需恢复，因此运行片段持久化不能再只保留最近一段。
  assert.match(source, /function sanitizeRunMetaMapForStorage\(/);
  assert.doesNotMatch(source, /\.slice\(-160\)/);
});

test("TestSessionPromptInputShouldSupportKeyboardHotkeys", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - 会话输入框聚焦时应支持键盘热键，Enter 触发发送，Escape 触发失焦。
  //   - 需跳过输入法组合态，避免中文上屏时误发送。
  assert.match(source, /const handlePromptInputKeyDown = \(event: ReactKeyboardEvent<HTMLTextAreaElement>\) =>/);
  assert.match(source, /if \(event\.key === "Escape"\)/);
  assert.match(source, /event\.currentTarget\.blur\(\)/);
  assert.match(source, /if \(event\.key !== "Enter" \|\| event\.shiftKey\)/);
  assert.match(source, /if \(event\.nativeEvent\.isComposing\)/);
  assert.match(source, /<AriInput\.TextArea/);
  assert.match(source, /className="desk-session-prompt-input"/);
  assert.match(source, /variant="embedded"/);
  assert.match(source, /autoSize=\{\{ minRows: 3, maxRows: 10 \}\}/);
  assert.match(source, /onKeyDown=\{handlePromptInputKeyDown\}/);
});

test("TestSessionPageShouldExposeDebugFlowRecordsToDevPanel", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - Dev 调试快照应携带全链路 debugFlowRecords，便于定位“发送→规划→执行→总结”全流程。
  assert.match(source, /debugFlowRecords/);
  assert.match(source, /appendDebugFlowRecord/);
  assert.match(source, /const emitSessionDebugSnapshot = useCallback\(\(\) =>/);
  assert.match(source, /window\.addEventListener\("libra:session-debug-request"/);
  assert.match(source, /debugFlowRecords: debugFlowRecords.slice\(0, 120\)/);
});

test("TestSessionPageShouldPersistDebugArtifactsWithoutOpeningDevPanel", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述:
  //
  //   - 会话调试资产应独立持久化，不依赖 Dev 调试窗口是否打开，避免复制排查内容出现“暂无原始收发”。
  assert.match(source, /setSessionAiPromptRaw\(agentPrompt\);/);
  assert.match(source, /setSessionAiResponseRaw\(""\);/);
  assert.match(source, /const promptRaw = String\(sessionAiPromptRaw \|\| agentPromptRawRef\.current \|\| ""\)\.trim\(\);/);
  assert.match(source, /upsertSessionDebugArtifact\(\{/);
  assert.match(source, /getSessionDebugArtifact\(normalizedAgentKey, sessionId\)/);
  assert.match(dataSource, /SESSION_DEBUG_ARTIFACT_STORAGE_KEY/);
  assert.match(dataSource, /export function upsertSessionDebugArtifact/);
  assert.match(dataSource, /export function getSessionDebugArtifact/);
  assert.match(dataSource, /export function removeSessionDebugArtifact/);
});

test("TestSessionPageShouldNotClearDevSnapshotOnEachStateRefresh", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - 会话调试快照刷新 effect 的 cleanup 只能清理定时器，避免每次状态更新都把 Dev 面板置空。
  assert.match(
    source,
    /const dispatchDelay = sending \? 360 : 120[\s\S]*return \(\) => \{\s*clearDebugSnapshotTimer\(\);\s*\};\s*\n  \}, \[/,
  );

  // 描述:
  //
  //   - 快照清空事件应只在页面真正卸载时触发，防止调试内容闪烁丢失。
  assert.match(
    source,
    /useEffect\(\(\) => \(\) => \{[\s\S]*new CustomEvent\("libra:session-debug", \{\s*detail: null,/,
  );
});

test("TestSessionPageShouldSupportActiveCancelAndCancelledStream", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - 会话页在发送中应支持主动停止，并处理 cancelled 终态事件，避免误标记为失败。
  //   - 输入区主按钮需复用“发送/取消”动作，发送中显示暂停图标，不再显示 loading 或独立停止按钮。
  assert.match(source, /const handleCancelCurrentRun = async \(\) =>/);
  assert.match(source, /const handlePromptPrimaryAction = \(\) => \{/);
  assert.match(source, /if \(sending\) \{\s*void handleCancelCurrentRun\(\);\s*return;\s*\}\s*void sendMessage\(\);/s);
  assert.match(source, /await invoke\(COMMANDS\.CANCEL_AGENT_SESSION, \{ sessionId \}\)/);
  assert.match(source, /STREAM_KINDS\.CANCELLED/);
  assert.match(source, /isCancelErrorCode/);
  assert.match(source, /icon=\{sending \? "pause" : "arrow_upward"\}/);
  assert.doesNotMatch(source, /icon=\{sending \? "hourglass_top" : "arrow_upward"\}/);
  assert.doesNotMatch(source, /icon="stop"/);
});

test("TestTauriShouldExposeProjectWorkspaceGitCommands", () => {
  const source = readDesktopSource("src-tauri/src/main.rs");

  // 描述:
  //
  //   - Tauri 层应暴露项目目录选择与 Git 克隆命令，供项目接入引导页使用。
  assert.match(source, /async fn check_git_cli_health\(\)/);
  assert.match(source, /async fn pick_local_project_folder\(\)/);
  assert.match(source, /async fn open_external_url\(url: String\)/);
  assert.match(source, /async fn clone_git_repository\(/);
  assert.match(source, /infer_repo_name_from_url/);
  assert.match(source, /check_git_cli_health,/);
  assert.match(source, /pick_local_project_folder,/);
  assert.match(source, /open_external_url,/);
  assert.match(source, /clone_git_repository,/);
});

test("TestTauriShouldExposeCancelAgentSessionCommand", () => {
  const source = readDesktopSource("src-tauri/src/main.rs");

  // 描述:
  //
  //   - Tauri 层应暴露主动取消会话命令，并向前端派发 cancelled 事件与统一取消错误码。
  assert.match(source, /fn cancel_agent_session\(app: tauri::AppHandle, session_id: String\)/);
  assert.match(source, /fn mark_agent_session_cancelled\(session_id: &str\)/);
  assert.match(source, /fn take_agent_session_cancelled\(session_id: &str\) -> bool/);
  assert.match(source, /mark_agent_session_cancelled\(&session_id\);/);
  assert.match(source, /cancelled_by_user && !is_cancelled_protocol_error\(err\.code\.as_str\(\)\)/);
  assert.match(source, /kind: "cancelled"\.to_string\(\)/);
  assert.match(source, /"core\.agent\.request_cancelled"/);
  assert.match(source, /cancel_agent_session,/);
});

test("TestTauriShouldRejectEmptyAgentRunResultPayload", () => {
  const source = readDesktopSource("src-tauri/src/main.rs");

  // 描述:
  //
  //   - 当核心返回空消息且无动作时，桌面层应判定为失败，避免前端出现“执行完成但无任何产物”的假成功状态。
  assert.match(source, /core\.desktop\.agent\.empty_result/);
  assert.match(source, /执行结束但未返回任何结果，请重试。/);
  assert.match(source, /value\.message = format!\("执行完成（工具调用 \{\} 次）", value\.actions\.len\(\)\);/);
});

test("TestDevDebugFloatShouldUseCompactCopyFirstPanel", () => {
  const source = readDesktopSource("src/widgets/dev-debug-float.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述:
  //
  //   - Dev 调试窗口应采用极简模式，仅保留拖动手柄与复制入口，不再展示说明文案和过程日志列表。
  assert.match(source, /label=\{t\("复制会话内容"\)\}/);
  assert.match(source, /resolveCopyTargetSessionId/);
  assert.match(source, /libra:session-debug-request/);
  assert.match(source, /libra:session-copy-request/);
  assert.match(source, /libra:session-copy-result/);
  assert.match(source, /aria-label=\{t\("拖动调试窗口"\)\}/);
  assert.match(source, /className="desk-dev-debug-drag-handle"/);
  assert.match(source, /<AriIcon name="drag_indicator" \/>/);
  assert.match(source, /className=\{`desk-dev-debug-float\$\{dragging \? " is-dragging" : ""\}`\}/);
  assert.doesNotMatch(source, /执行全链路（前端视角）/);
  assert.doesNotMatch(source, /Agent 日志/);
  assert.doesNotMatch(source, /Workflow 步骤/);
  assert.doesNotMatch(source, /Trace \/ Session 事件 \/ 资产/);
  assert.doesNotMatch(source, /消息数=/);
  assert.doesNotMatch(source, /暂无全链路记录/);
  assert.doesNotMatch(source, /暂无 session 轨迹记录/);
  assert.doesNotMatch(source, /t\("Dev 调试窗口"\)/);
  assert.doesNotMatch(source, /t\("展开"\)/);
  assert.doesNotMatch(source, /t\("请先打开一个会话，再复制会话内容。"\)/);
  assert.doesNotMatch(source, /t\("当前会话已连接，点击“复制会话内容”可导出完整排查信息。"\)/);
  assert.doesNotMatch(source, /desk-dev-debug-body/);
  assert.doesNotMatch(source, /AriTypography/);
  assert.doesNotMatch(source, /unfold_more/);
  assert.doesNotMatch(source, /unfold_less/);
  assert.match(styleSource, /\.desk-dev-debug-head-actions/);
  assert.match(styleSource, /\.desk-dev-debug-head-leading/);
  assert.match(styleSource, /\.desk-dev-debug-drag-handle \{/);
  assert.match(styleSource, /\.desk-dev-debug-float\.is-dragging \.desk-dev-debug-drag-handle \{/);
  assert.match(styleSource, /\.desk-dev-debug-float,\s*\.desk-dev-debug-float \*,\s*\.desk-dev-debug-float \*::before,\s*\.desk-dev-debug-float \*::after \{[\s\S]*transition:\s*none !important;[\s\S]*animation:\s*none !important;/);
  assert.doesNotMatch(styleSource, /\.desk-dev-debug-body/);
  assert.doesNotMatch(styleSource, /\.desk-dev-debug-line/);
  assert.doesNotMatch(styleSource, /\.desk-dev-debug-list/);
  assert.doesNotMatch(styleSource, /\.desk-dev-debug-float\.collapsed/);
});
