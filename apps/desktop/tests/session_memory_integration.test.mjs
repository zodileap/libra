import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供会话记忆集成回归测试复用。
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

// 描述：
//
//   - 读取 Desktop Tauri 源码文件，供命令注册回归测试复用。
//
// Params:
//
//   - relativePath: 基于 apps/desktop/src-tauri 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readDesktopTauriSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), "src-tauri", relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestSessionMemoryShouldWireStoragePromptAndTauriCommand", () => {
  const dataSource = readDesktopSource("src/shared/data.ts");
  const promptUtilsSource = readDesktopSource("src/widgets/session/prompt-utils.ts");
  const sessionPageSource = readDesktopSource("src/widgets/session/page.tsx");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const i18nSource = readDesktopSource("src/shared/i18n/messages.ts");
  const tauriSource = readDesktopTauriSource("src/main.rs");

  // 描述：
  //
  //   - 数据层应新增独立的会话记忆存储与读写 helper，并在删除会话时同步清理。
  assert.match(dataSource, /const SESSION_MEMORY_STORAGE_KEY = "libra\.desktop\.session\.memory";/);
  assert.match(dataSource, /export interface SessionMemorySnapshot \{/);
  assert.match(dataSource, /lastProcessedMessageId: string;/);
  assert.match(dataSource, /preferences: string\[\];/);
  assert.match(dataSource, /decisions: string\[\];/);
  assert.match(dataSource, /todos: string\[\];/);
  assert.match(dataSource, /function readSessionMemories\(\): StoredSessionMemory\[\] \{/);
  assert.match(dataSource, /export function getSessionMemory\(/);
  assert.match(dataSource, /export function upsertSessionMemory\(input: SessionMemorySnapshot\)/);
  assert.match(dataSource, /export function removeSessionMemory\(agentKey: AgentKey, sessionId: string\)/);
  assert.match(dataSource, /removeSessionMemory\(agentKey, sessionId\);/);

  // 描述：
  //
  //   - 提示词工具层应新增“会话记忆”片段，并保证它位于会话上下文之前。
  assert.match(promptUtilsSource, /export const AGENT_MEMORY_CONTEXT_ITEM_LIMIT = 6;/);
  assert.match(promptUtilsSource, /export function buildSessionMemoryContextLines\(/);
  assert.match(promptUtilsSource, /translateDesktopText\("【会话记忆】"\)/);
  assert.match(promptUtilsSource, /translateDesktopText\("用户偏好"\)/);
  assert.match(promptUtilsSource, /translateDesktopText\("已确认决策"\)/);
  assert.match(promptUtilsSource, /translateDesktopText\("未完成事项"\)/);
  assert.match(promptUtilsSource, /sessionMemory\?: SessionMemorySnapshot \| null,/);
  assert.match(promptUtilsSource, /const memoryContextLines = buildSessionMemoryContextLines\(sessionMemory\);/);
  assert.match(promptUtilsSource, /\.\.\.frameworkReplacementContextLines,\s*\.\.\.memoryContextLines,\s*translateDesktopText\("【会话上下文】"\),/s);

  // 描述：
  //
  //   - 会话页应 hydrate memory、把 memory 注入请求上下文，并在轮次完成后调用专用记忆命令。
  assert.match(sessionPageSource, /const \[sessionMemory, setSessionMemory\] = useState<SessionMemorySnapshot \| null>\(null\);/);
  assert.match(sessionPageSource, /const sessionMemoryRef = useRef<SessionMemorySnapshot \| null>\(null\);/);
  assert.match(sessionPageSource, /const storedSessionMemory = getSessionMemory\(normalizedAgentKey, sessionId\);/);
  assert.match(sessionPageSource, /setSessionMemory\(storedSessionMemory\);/);
  assert.match(sessionPageSource, /sessionMemoryRef\.current,/);
  assert.match(sessionPageSource, /const requestSessionMemoryExtraction = async \(/);
  assert.match(sessionPageSource, /COMMANDS\.CALL_AI_MEMORY_COMMAND/);
  assert.match(sessionPageSource, /upsertSessionMemory\(nextMemory\);/);
  assert.match(sessionPageSource, /lastProcessedMessageId: String\(messageId \|\| ""\)\.trim\(\),/);

  // 描述：
  //
  //   - 常量、国际化与 Tauri 命令层都应为会话记忆提供稳定入口。
  assert.match(constantsSource, /CALL_AI_MEMORY_COMMAND: "call_ai_memory_command",/);
  assert.match(i18nSource, /"【会话记忆】": "【会话记忆】"/);
  assert.match(i18nSource, /"【会话记忆】": "Session Memory"/);
  assert.match(i18nSource, /"会话记忆 Prompt": "会话记忆 Prompt"/);
  assert.match(i18nSource, /"会话记忆更新": "Session Memory Updated"/);
  assert.match(tauriSource, /async fn call_ai_memory_command\(/);
  assert.match(tauriSource, /fn call_ai_text_command_inner\(/);
  assert.match(tauriSource, /"core\.desktop\.agent\.memory_prompt_empty"/);
  assert.match(tauriSource, /call_ai_memory_command,/);
});
