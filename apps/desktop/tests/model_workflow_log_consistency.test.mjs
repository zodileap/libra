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
  const source = readDesktopSource("src/modules/client/workflow/engine.ts");

  // 描述:
  //
  //   - 完成文案应分开展示“工作流节点成功数”和“MCP步骤成功数”，避免统计口径混淆。
  assert.match(source, /countModelSessionSuccessSteps/);
  assert.match(source, /工作流节点成功/);
  assert.match(source, /MCP 步骤成功/);
});

test("TestSessionPageShouldDowngradeBridgePrecheckFailureAfterRecovery", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述:
  //
  //   - Bridge 预检失败但后续执行成功时，应输出恢复提示而非直接错误 trace。
  assert.match(source, /let bridgePrecheckWarning = ""/);
  assert.match(source, /Bridge 预检未通过，但执行阶段已自动恢复并完成/);
});

test("TestSessionPageShouldThrottlePersistenceAndUsePlainTextDuringStreaming", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述:
  //
  //   - 流式期间应降低 localStorage 持久化频率，并将进行中的消息降级为纯文本渲染，减少主线程压力。
  assert.match(source, /sessionMessagePersistTimerRef/);
  assert.match(source, /const persistDelay = sending \? 1200 : 180/);
  assert.match(source, /plainText=\{sending && Boolean\(message.id\) && message.id === streamMessageIdRef.current\}/);
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
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述:
  //
  //   - 执行完成后应渲染可点击的用时分割线，并在其下展示总结内容。
  assert.match(source, /className=\"desk-run-divider\"/);
  assert.match(source, /formatElapsedDuration\(runMeta.startedAt, runMeta.finishedAt\)/);
  assert.match(source, /className=\"desk-run-summary\"/);
});

test("TestSessionPageShouldBuildUserReadableModelSummary", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述:
  //
  //   - 模型完成总结应面向用户解释“做了什么”，不应仅暴露内部工作流术语。
  assert.match(source, /function buildUserReadableModelSummary/);
  assert.match(source, /已按你的需求完成本次模型操作。/);
  assert.match(source, /执行结果：成功/);
});

test("TestSessionPageShouldKeepHeartbeatDuringLongWait", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述:
  //
  //   - 在长时间无流式事件时，应存在心跳机制持续输出进行中提示，避免用户感知卡死。
  assert.match(source, /function buildAssistantHeartbeatSegment/);
  assert.match(source, /const startAssistantRunHeartbeat = \(messageId: string\) =>/);
  assert.match(source, /正在处理当前步骤/);
});

test("TestSessionPromptInputShouldSupportKeyboardHotkeys", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

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
  assert.match(source, /autoSize=\{\{ minRows: 3, maxRows: 10 \}\}/);
  assert.match(source, /onKeyDown=\{handlePromptInputKeyDown\}/);
});

test("TestSessionPageShouldUseAiSummaryWithFallback", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述:
  //
  //   - 完成总结应优先调用 AI 生成，失败时回退规则总结，保证可读性与稳定性。
  assert.match(source, /summarize_model_session_result/);
  assert.match(source, /let completionSummary = buildUserReadableModelSummary/);
  assert.match(source, /summaryErr/);
});

test("TestSessionPageShouldExposeDebugFlowRecordsToDevPanel", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述:
  //
  //   - Dev 调试快照应携带全链路 debugFlowRecords，便于定位“发送→规划→执行→总结”全流程。
  assert.match(source, /debugFlowRecords/);
  assert.match(source, /appendDebugFlowRecord/);
  assert.match(source, /debugFlowRecords: debugFlowRecords.slice\(0, 120\)/);
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

test("TestDevDebugFloatShouldShowFlowAndSupportLineWrap", () => {
  const source = readDesktopSource("src/modules/client/widgets/dev-debug-float.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述:
  //
  //   - Dev 调试窗口应展示执行全链路和模型规划明细，并对长文本进行换行防止溢出。
  assert.match(source, /执行全链路（前端视角）/);
  assert.match(source, /模型规划 LLM 明细（后端视角）/);
  assert.match(source, /model:debug_trace/);
  assert.match(styleSource, /\.desk-dev-debug-line/);
  assert.match(styleSource, /overflow-wrap:\s*anywhere/);
});
