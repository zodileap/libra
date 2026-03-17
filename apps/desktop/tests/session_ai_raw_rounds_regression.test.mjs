import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供 AI 原始收发轮次口径回归测试复用。
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

test("TestSessionAiRawShouldAccumulateAllRoundsByMessage", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - AI 原始收发必须改成“追加/回填”模式，按同一条用户消息累计所有真实模型往返，而不是按阶段覆盖。
  assert.match(sessionSource, /type SessionAiRawExchangeStatus = "running" \| "finished" \| "failed";/);
  assert.match(sessionSource, /traceId\?: string;/);
  assert.match(sessionSource, /stageTitle\?: string;/);
  assert.match(sessionSource, /function buildSessionAiRawExchangeDedupKey\(input: Partial<SessionAiRawExchangeItem>\): string \{/);
  assert.match(sessionSource, /function mergeSessionAiRawExchangeItem\(\s*current: SessionAiRawExchangeItem,\s*incoming: SessionAiRawExchangeItem,\s*\): SessionAiRawExchangeItem \{/s);
  assert.match(sessionSource, /function appendSessionAiRawExchangeItem\(\s*exchanges: SessionAiRawExchangeItem\[],\s*exchange: Partial<SessionAiRawExchangeItem>,\s*\): SessionAiRawExchangeItem\[] \{/s);
  assert.match(sessionSource, /function mergeSessionAiRawExchangeItemsByTrace\(\s*exchanges: SessionAiRawExchangeItem\[],\s*incoming: SessionAiRawExchangeItem\[],\s*traceId: string,\s*\): SessionAiRawExchangeItem\[] \{/s);
  assert.match(sessionSource, /const appendSessionAiRawExchange = \(\s*messageId: string,\s*exchange: Partial<SessionAiRawExchangeItem>,\s*\) => \{/s);
  assert.match(sessionSource, /const patchLatestSessionAiRawExchange = \(\s*messageId: string,\s*exchange: Partial<SessionAiRawExchangeItem>,/s);
  assert.match(sessionSource, /const mergeSessionAiRawExchangesForTrace = \(\s*messageId: string,\s*traceId: string,\s*exchanges: SessionAiRawExchangeItem\[],/s);
  assert.match(sessionSource, /appendSessionAiRawExchange\(streamMessageId, \{\s*requestRaw: agentPrompt,[\s\S]*stepCode: "llm_python_codegen",[\s\S]*status: "running",[\s\S]*traceId: stageTraceId,/s);
  assert.match(sessionSource, /mergeSessionAiRawExchangesForTrace\(\s*streamMessageId,\s*responseTraceId,\s*completedExchanges,\s*responsePromptRaw,\s*responseRawText,\s*\)/s);
  assert.match(sessionSource, /patchLatestSessionAiRawExchange\(\s*currentMessageId,\s*\{\s*responseRaw: agentLlmDeltaBufferRef\.current,[\s\S]*status: "running",/s);
  assert.match(sessionSource, /exchange\.status === "running"\s*\?\s*t\("##### 响应 \{\{index\}\}（进行中）"/s);
  assert.doesNotMatch(sessionSource, /\[streamMessageId\]: buildSessionAiRawByMessageItem\(\{\s*promptRaw: agentPrompt,\s*responseRaw: "",\s*exchanges: \[\{\s*requestRaw: agentPrompt,/s);
  assert.doesNotMatch(sessionSource, /\[streamMessageId\]: buildSessionAiRawByMessageItem\(\{\s*promptRaw: responsePromptRaw,\s*responseRaw: responseRawText,\s*exchanges: extractedRawExchanges/s);
  assert.doesNotMatch(sessionSource, /\[failedMessageId\]: buildSessionAiRawByMessageItem\(\{\s*promptRaw: failedPromptRaw,\s*responseRaw: rawCodeResponse,\s*exchanges: \[\{/s);
});
