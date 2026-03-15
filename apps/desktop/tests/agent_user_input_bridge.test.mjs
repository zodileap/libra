import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop / Tauri 源码文件，供 Agent 用户提问桥接回归测试复用。
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

test("TestAgentUserInputBridgeShouldMapCoreEventAndResolveInTauri", () => {
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const typesSource = readDesktopSource("src/shared/types.ts");
  const tauriSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - 共享常量与类型必须声明 request_user_input 协议，供前端和运行时共用。
  assert.match(constantsSource, /RESOLVE_AGENT_USER_INPUT: "resolve_agent_user_input"/);
  assert.match(constantsSource, /REQUEST_USER_INPUT: "request_user_input"/);
  assert.match(typesSource, /export interface AgentUserInputOption \{/);
  assert.match(typesSource, /export interface AgentUserInputQuestionPrompt \{/);
  assert.match(typesSource, /export interface AgentUserInputAnswer \{/);
  assert.match(typesSource, /question_id: string;/);
  assert.match(typesSource, /answer_type: "option" \| "custom";/);

  // 描述：
  //
  //   - Tauri 事件桥接必须把 core 的 RequestUserInput 透传成文本流事件，并附带 request_id 与 questions。
  assert.match(tauriSource, /AgentStreamEvent::RequestUserInput \{/);
  assert.match(tauriSource, /message: format!\("正在询问 \{\} 个问题", question_count\)/);
  assert.match(tauriSource, /"request_id": request_id,/);
  assert.match(tauriSource, /"questions": questions,/);

  // 描述：
  //
  //   - resolve_agent_user_input 命令必须校验 resolution 与 answers，并注册到 generate_handler。
  assert.match(tauriSource, /fn resolve_agent_user_input\(/);
  assert.match(tauriSource, /if normalized_resolution != "answered" && normalized_resolution != "ignored" \{/);
  assert.match(tauriSource, /if normalized_resolution == "answered" && normalized_answers\.is_empty\(\) \{/);
  assert.match(tauriSource, /if answer\.question_id\.trim\(\)\.is_empty\(\) \{/);
  assert.match(tauriSource, /if answer\.value\.trim\(\)\.is_empty\(\) \{/);
  assert.match(tauriSource, /if normalized_answer_type != "option" && normalized_answer_type != "custom" \{/);
  assert.match(tauriSource, /if normalized_answer_type == "option"/);
  assert.match(tauriSource, /USER_INPUT_REGISTRY\.submit_resolution\(/);
  assert.match(tauriSource, /resolve_agent_user_input,/);
});
