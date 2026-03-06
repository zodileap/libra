import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取 Desktop 源码文件，校验模型工作流日志文案与预检提示口径。
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

test("TestWorkflowCompletionMessageShouldSeparateWorkflowAndMcpCounts", () => {
  const source = readDesktopSource("src/shared/workflow/engine.ts");

  // 描述:
  //
  //   - 完成文案应分开展示“工作流节点成功数”和“MCP步骤成功数”，避免统计口径混淆。
  assert.match(source, /countModelSessionSuccessSteps/);
  assert.match(source, /工作流节点成功/);
  assert.match(source, /MCP 步骤成功/);
});

test("TestSessionPageShouldDowngradeBridgePrecheckFailureAfterRecovery", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - Bridge 预检失败但后续执行成功时，应输出恢复提示而非直接错误 trace。
  assert.match(source, /let bridgePrecheckWarning = ""/);
  assert.match(source, /Bridge 预检未通过，但执行阶段已自动恢复并完成/);
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
  //   - Bridge/Codex 健康检查应放入后台线程执行，避免阻塞 Tauri 主事件循环导致窗口卡顿。
  assert.match(source, /async fn check_blender_bridge/);
  assert.match(source, /spawn_blocking\(move \|\| check_blender_bridge_inner/);
  assert.match(source, /async fn check_codex_cli_health/);
  assert.match(source, /spawn_blocking\(move \|\| check_codex_cli_health_inner/);
});

test("TestSessionLayoutShouldAlignUserRightAndAssistantLeft", () => {
  const source = readDesktopSource("src/styles.css");

  // 描述:
  //
  //   - 会话布局应确保用户消息右对齐、智能体消息左对齐，贴近主流聊天交互。
  assert.match(source, /\.desk-msg\.user\s*\{[\s\S]*align-self:\s*flex-end/);
  assert.match(source, /\.desk-msg\.assistant\s*\{[\s\S]*align-self:\s*flex-start/);
});

test("TestSessionPageShouldRenderCollapsibleRunDividerAndSummary", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - 执行完成后应渲染可点击的用时分割线，并在其下展示总结内容。
  assert.match(source, /className=\"desk-run-divider\"/);
  assert.match(source, /formatElapsedDuration\(runMeta.startedAt, runMeta.finishedAt\)/);
  assert.match(source, /className=\{`desk-run-summary/);
});

test("TestSessionPageShouldBuildUserReadableModelSummary", () => {
  const source = [
    readDesktopSource("src/widgets/session/page.tsx"),
    readDesktopSource("src/widgets/session/prompt-utils.ts"),
  ].join("\n");

  // 描述:
  //
  //   - 模型完成总结应面向用户解释“做了什么”，不应仅暴露内部工作流术语。
  assert.match(source, /function buildUserReadableModelSummary/);
  assert.match(source, /已按你的需求完成本次模型操作。/);
  assert.match(source, /执行结果：成功/);
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
  assert.match(source, /variant="borderless"/);
  assert.match(source, /autoSize=\{\{ minRows: 3, maxRows: 10 \}\}/);
  assert.match(source, /onKeyDown=\{handlePromptInputKeyDown\}/);
});

test("TestSessionPageShouldUseAiSummaryWithFallback", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - 完成总结应优先调用 AI 生成，失败时回退规则总结，保证可读性与稳定性。
  assert.match(source, /COMMANDS\.SUMMARIZE_MODEL_SESSION_RESULT/);
  assert.match(source, /let completionSummary = buildUserReadableModelSummary/);
  assert.match(source, /summaryErr/);
});

test("TestSessionPageShouldExposeDebugFlowRecordsToDevPanel", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - Dev 调试快照应携带全链路 debugFlowRecords，便于定位“发送→规划→执行→总结”全流程。
  assert.match(source, /debugFlowRecords/);
  assert.match(source, /appendDebugFlowRecord/);
  assert.match(source, /const emitSessionDebugSnapshot = useCallback\(\(\) =>/);
  assert.match(source, /window\.addEventListener\("zodileap:session-debug-request"/);
  assert.match(source, /debugFlowRecords: debugFlowRecords.slice\(0, 120\)/);
});

test("TestSessionPageShouldPersistDebugArtifactsWithoutOpeningDevPanel", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述:
  //
  //   - 会话调试资产应独立持久化，不依赖 Dev 调试窗口是否打开，避免复制排查内容出现“暂无原始收发”。
  assert.match(source, /setSessionAiPromptRaw\(codePrompt\);/);
  assert.match(source, /setSessionAiResponseRaw\(""\);/);
  assert.match(source, /const promptRaw = String\(sessionAiPromptRaw \|\| codeAgentPromptRawRef\.current \|\| ""\)\.trim\(\);/);
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
    /useEffect\(\(\) => \(\) => \{[\s\S]*new CustomEvent\("zodileap:session-debug", \{\s*detail: null,/,
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

test("TestTauriShouldExposeModelSummaryCommandAndDebugTrace", () => {
  const source = readDesktopSource("src-tauri/src/main.rs");

  // 描述:
  //
  //   - Tauri 层应提供 AI 总结命令与模型调试追踪事件，便于前端展示完整执行链路。
  assert.match(source, /summarize_model_session_result/);
  assert.match(source, /emit_model_debug_trace_event/);
  assert.match(source, /\"model:debug_trace\"/);
});

test("TestTauriShouldExposeCodeWorkspaceGitCommands", () => {
  const source = readDesktopSource("src-tauri/src/main.rs");

  // 描述:
  //
  //   - Tauri 层应暴露代码目录选择与 Git 克隆命令，供代码智能体目录引导页使用。
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
  //   - Dev 调试窗口应采用精简模式，仅保留复制入口与基础提示，不再展示过程日志列表。
  assert.match(source, /label="复制会话内容"/);
  assert.match(source, /resolveCopyTargetSessionId/);
  assert.match(source, /zodileap:session-debug-request/);
  assert.match(source, /zodileap:session-copy-request/);
  assert.match(source, /zodileap:session-copy-result/);
  assert.match(source, /当前会话已连接，点击“复制会话内容”可导出完整排查信息。/);
  assert.doesNotMatch(source, /执行全链路（前端视角）/);
  assert.doesNotMatch(source, /模型规划 LLM 明细（后端视角）/);
  assert.doesNotMatch(source, /Agent 日志/);
  assert.doesNotMatch(source, /Workflow 步骤/);
  assert.doesNotMatch(source, /Trace \/ Session 事件 \/ 资产/);
  assert.doesNotMatch(source, /消息数=/);
  assert.doesNotMatch(source, /暂无全链路记录/);
  assert.doesNotMatch(source, /暂无模型规划 LLM 明细/);
  assert.doesNotMatch(source, /暂无 session 轨迹记录/);
  assert.match(styleSource, /\.desk-dev-debug-head-actions/);
  assert.match(styleSource, /\.desk-dev-debug-line/);
  assert.match(styleSource, /overflow-wrap:\s*anywhere/);
});
