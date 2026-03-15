import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供会话用户提问卡片回归测试复用。
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

test("TestSessionUserInputDockShouldRenderQuestionCardAndResolveAnswers", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const typesSource = readDesktopSource("src/shared/types.ts");
  const messagesSource = readDesktopSource("src/shared/i18n/messages.ts");

  // 描述：
  //
  //   - 会话页应维护用户提问草稿与提交中状态，并把 request_user_input 事件映射成独立运行片段。
  assert.match(sessionSource, /interface AgentRequestUserInputEventData \{/);
  assert.match(sessionSource, /interface AgentUserInputDraftAnswer \{/);
  assert.match(sessionSource, /const \[userInputDraftMap, setUserInputDraftMap\] = useState</);
  assert.match(sessionSource, /const \[userInputSubmittingRequestId, setUserInputSubmittingRequestId\] = useState\(""\);/);
  assert.match(sessionSource, /function resolveUserInputEventData\(payload: AgentTextStreamEvent\): AgentRequestUserInputEventData \{/);
  assert.match(sessionSource, /function buildUserInputSegmentData\(payload: AgentTextStreamEvent\): Record<string, unknown> \{/);
  assert.match(sessionSource, /__step_type: "user_input_request"/);
  assert.match(sessionSource, /request_id: String\(resolved\.request_id \|\| ""\)\.trim\(\)/);
  assert.match(sessionSource, /question_count: Array\.isArray\(resolved\.questions\) \? resolved\.questions\.length : 0/);
  assert.match(sessionSource, /questions: resolved\.questions \|\| \[\]/);
  assert.match(sessionSource, /if \(payload\.kind === STREAM_KINDS\.REQUEST_USER_INPUT\) \{/);
  assert.match(sessionSource, /intro: translateDesktopText\("需要用户决定"\)/);
  assert.match(sessionSource, /step: translateDesktopText\("正在询问 \{\{count\}\} 个问题", \{ count: questionCount \}\)/);

  // 描述：
  //
  //   - 交互卡片应位于授权卡片之后、DCC 选择之前，并支持单题单选、自定义输入、ESC 忽略和提交校验。
  assert.match(sessionSource, /\) : activeUserInputSegment \? \(/);
  assert.match(sessionSource, /\) : pendingDccSelection \? \(/);
  assert.match(sessionSource, /className="desk-action-slot desk-action-slot-info desk-action-slot-user-input"/);
  assert.match(sessionSource, /value=\{t\("需要你做几个决定"\)\}/);
  assert.match(sessionSource, /value=\{t\("这些问题会直接影响当前实现方向；提交后智能体会继续执行。"\)\}/);
  assert.match(sessionSource, /className="desk-user-input-option-index"/);
  assert.match(sessionSource, /value=\{`\$\{questionIndex \+ 1\}\. \$\{question\.header\}`\}/);
  assert.match(sessionSource, /handleSelectUserInputOption\(/);
  assert.match(sessionSource, /selectedOptionIndex: optionIndex,/);
  assert.match(sessionSource, /customValue: "",/);
  assert.match(sessionSource, /handleChangeUserInputCustomValue\(/);
  assert.match(sessionSource, /selectedOptionIndex: undefined,/);
  assert.match(sessionSource, /placeholder=\{t\("其他，请告知 Codex 如何调整"\)\}/);
  assert.match(sessionSource, /if \(event\.key !== "Escape"\) \{\s*return;\s*\}/s);
  assert.match(sessionSource, /void handleIgnoreAgentUserInput\(activeUserInputRequestId\);/);
  assert.match(sessionSource, /const isUserInputSubmitDisabled = !hasActiveUserInput/);
  assert.match(sessionSource, /AriMessage\.warning\(\{\s*content: t\("请先回答全部问题。"\),\s*duration: 1800,\s*\}\);/s);

  // 描述：
  //
  //   - answered / ignored 都必须通过新的 Tauri 命令回传，不新增普通用户消息。
  assert.match(sessionSource, /await invoke\(COMMANDS\.RESOLVE_AGENT_USER_INPUT, \{\s*id: normalizedRequestId,\s*resolution: "answered",\s*answers: normalizedAnswers,\s*\}\);/s);
  assert.match(sessionSource, /await invoke\(COMMANDS\.RESOLVE_AGENT_USER_INPUT, \{\s*id: normalizedRequestId,\s*resolution: "ignored",\s*\}\);/s);
  assert.match(sessionSource, /markUserInputSegmentResolved\(\s*normalizedRequestId,\s*"answered",\s*normalizedAnswers,\s*\);/s);
  assert.match(sessionSource, /markUserInputSegmentResolved\(normalizedRequestId, "ignored", \[\]\);/);
  assert.match(sessionSource, /setStatus\(t\("提交问题回答失败，请重试"\)\);/);
  assert.match(sessionSource, /setStatus\(t\("忽略提问失败，请重试"\)\);/);
  assert.match(sessionSource, /提交当前用户提问卡片答案，成功后不新增 transcript 消息，只恢复原执行流。/);

  // 描述：
  //
  //   - 常量、共享类型与 i18n 词条都必须补齐，保证桥接协议和前端展示稳定。
  assert.match(constantsSource, /RESOLVE_AGENT_USER_INPUT: "resolve_agent_user_input"/);
  assert.match(constantsSource, /REQUEST_USER_INPUT: "request_user_input"/);
  assert.match(typesSource, /export interface AgentUserInputOption \{/);
  assert.match(typesSource, /export interface AgentUserInputQuestionPrompt \{/);
  assert.match(typesSource, /export interface AgentUserInputAnswer \{/);
  assert.match(messagesSource, /"需要你做几个决定": "A few decisions are needed"/);
  assert.match(messagesSource, /"这些问题会直接影响当前实现方向；提交后智能体会继续执行。"/);
  assert.match(messagesSource, /"其他，请告知 Codex 如何调整": "Other, tell Codex how to adjust it"/);
});
