import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供执行总结来源口径回归测试复用。
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

test("TestWorkflowExecutionSummaryShouldOnlyUseRealAiSummary", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const sharedDataSource = readDesktopSource("src/shared/data.ts");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const tauriSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - 运行态与持久化层都必须记录 summarySource，避免恢复后再次把系统拼接文本误当成 AI 总结。
  assert.match(sharedDataSource, /summarySource\?: "ai" \| "system" \| "failure";/);
  assert.match(sessionSource, /summarySource\?: "ai" \| "system" \| "failure";/);
  assert.match(sessionSource, /summarySource: input\.summarySource === "ai"/);

  // 描述：
  //
  //   - 工作流最终总结必须经由独立的纯模型命令产生，而不是直接复用前端 buildWorkflowCompletionSummary 文本。
  assert.match(constantsSource, /CALL_AI_SUMMARY_COMMAND: "call_ai_summary_command"/);
  assert.match(tauriSource, /async fn call_ai_summary_command\(/);
  assert.match(tauriSource, /fn call_ai_summary_command_inner\(/);
  assert.match(tauriSource, /call_ai_summary_command,/);
  assert.match(sessionSource, /const requestWorkflowExecutionSummary = async \(/);
  assert.match(sessionSource, /invoke<AgentSummaryResponse>\(COMMANDS\.CALL_AI_SUMMARY_COMMAND,/);
  assert.match(sessionSource, /const workflowSummaryResult = workflowCompletionDigest\s*\?\s*await requestWorkflowExecutionSummary\(/s);
  assert.match(sessionSource, /finishAssistantRunMessage\(\s*streamMessageId,\s*"finished",\s*workflowSummaryResult\.summary,\s*workflowSummaryResult\.summarySource,\s*\)/s);
  assert.doesNotMatch(sessionSource, /finishAssistantRunMessage\(\s*streamMessageId,\s*"finished",\s*buildWorkflowCompletionSummary\(/s);

  // 描述：
  //
  //   - 真实 AI 总结的请求/响应也必须记入消息级原始收发与调用链，保证复制排查可完整回放。
  assert.match(sessionSource, /kind: "summary_request"/);
  assert.match(sessionSource, /kind: "summary_response"/);
  assert.match(sessionSource, /kind: "summary_error"/);
  assert.match(sessionSource, /stepCode: "ai_execution_summary"/);
  assert.match(sessionSource, /stepSummary: t\("执行总结"\)/);
  assert.match(sessionSource, /setSessionAiRawByMessage\(\(prev\) => \{/);

  // 描述：
  //
  //   - visible_summary 只允许来自真实 AI summary；没有 AI summary 时必须省略。
  assert.match(sessionSource, /const visibleSummary = runMeta\.status === "failed" && failureSummary/);
  assert.match(sessionSource, /runMeta\.summarySource === "ai"\s*&& String\(runMeta\.summary \|\| ""\)\.trim\(\)/);
  assert.match(sessionSource, /String\(runMeta\.summary \|\| ""\)\.trim\(\) !== visibleBodyText/);
  assert.match(sessionSource, /visible_summary: visibleSummary,/);
  assert.doesNotMatch(sessionSource, /visible_summary:\s*\{\s*type:\s*"markdown",\s*content:\s*runMeta\.summary \|\| message\.text/s);
});
