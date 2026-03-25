import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop/Tauri 源码文件，供长驻进程流式事件回归测试复用。
//
// Params:
//
//   - relativePath: 基于 apps/desktop 或 apps/desktop/src-tauri 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestSessionShouldHandleResidentProcessStreamEvents", () => {
  const constantsSource = readSource("src/shared/constants.ts");
  const sessionSource = readSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 前端流式 kind 常量必须显式包含 resident_process_state / resident_process_log。
  assert.match(constantsSource, /RESIDENT_PROCESS_STATE: "resident_process_state"/);
  assert.match(constantsSource, /RESIDENT_PROCESS_LOG: "resident_process_log"/);

  // 描述：
  //
  //   - 会话页必须识别长驻进程工具族，避免 tool_call_\* 与 resident_process_\* 双重渲染。
  assert.match(sessionSource, /function isResidentProcessTool\(toolName: string\): boolean \{/);
  assert.match(sessionSource, /toolName === "shell_start"/);
  assert.match(sessionSource, /toolName === "shell_logs"/);
  assert.match(sessionSource, /if \(isResidentProcessTool\(toolName\)\) \{\s*return null;\s*\}/s);

  // 描述：
  //
  //   - resident_process_state / resident_process_log 必须映射成独立运行片段，并透传 resident_process_id。
  assert.match(sessionSource, /if \(payload\.kind === STREAM_KINDS\.RESIDENT_PROCESS_STATE\) \{/);
  assert.match(sessionSource, /if \(payload\.kind === STREAM_KINDS\.RESIDENT_PROCESS_LOG\) \{/);
  assert.match(sessionSource, /__step_type: "resident_process"/);
  assert.match(sessionSource, /resident_process_id: residentProcessId/);
  assert.match(sessionSource, /function buildResidentProcessStateStepText\(/);
  assert.match(sessionSource, /function buildResidentProcessLogLine\(/);

  // 描述：
  //
  //   - appendAssistantRunSegment 必须按 resident_process_id 合并日志详情，而不是为每条日志新增独立步骤。
  assert.match(sessionSource, /const isResidentProcessSegment = segmentData\.__step_type === "resident_process" && residentProcessId;/);
  assert.match(sessionSource, /const residentIndex = baseSegments\.findLastIndex\(/);
  assert.match(sessionSource, /const incomingLogText = String\(segmentData\.resident_process_log_text \|\| ""\)\.trim\(\);/);
  assert.match(sessionSource, /detail: mergedDetail \|\| undefined/);

  // 描述：
  //
  //   - resident_process_\* 事件应进入 executing 阶段，避免被误判为 planning。
  assert.match(sessionSource, /kind\.includes\("resident_process"\)/);
});

test("TestTauriShouldBridgeResidentProcessStreamEvents", () => {
  const tauriSource = readSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - Tauri 侧必须把 resident_process_state / resident_process_log 透传为 AgentTextStreamEvent，并携带结构化 data。
  assert.match(tauriSource, /"resident_process_state" \| "resident_process_log" => \{/);
  assert.match(tauriSource, /let event_data = if stream_event\.tool_result_data_json\.trim\(\)\.is_empty\(\) \{/);
  assert.match(tauriSource, /kind: stream_event\.kind\.clone\(\),/);
  assert.match(tauriSource, /data: Some\(event_data\),/);

  // 描述：
  //
  //   - 应用退出时必须清理 resident process，避免后台残留孤儿进程。
  assert.match(tauriSource, /libra_agent_core::tools::shell::cleanup_all_resident_processes\(\);/);
  assert.match(tauriSource, /tauri::RunEvent::ExitRequested \{ \.\. \} \| tauri::RunEvent::Exit/);
});
