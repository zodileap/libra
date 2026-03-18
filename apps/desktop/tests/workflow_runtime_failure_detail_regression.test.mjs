import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供运行失败详情回归测试复用。
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

test("TestWorkflowRuntimeFailureShouldPreserveStructuredErrorDetail", () => {
  const pageSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - execute_failed 路径必须优先使用 runtime 返回的结构化 message/detail，
  //   - 这样阶段 2 若返回 run_conflict 或 prepare_failed，前端会展示真实失败原因，而不是继续落回 transport timeout 文案。
  assert.match(pageSource, /const detail = normalizeInvokeErrorDetail\(err\);/);
  assert.match(pageSource, /const reason = detail\.message;/);
  assert.match(pageSource, /"execute_failed",/);
  assert.match(pageSource, /message: reason,/);
  assert.match(pageSource, /suggestion: detail\.suggestion \|\| null,/);
  assert.match(pageSource, /retryable: detail\.retryable,/);
  assert.match(pageSource, /source: "agent:error",[\s\S]*message: reason,/);
  assert.match(pageSource, /detail: failureSummary\.detail,/);
  assert.doesNotMatch(pageSource, /detail:\s*"等待 runtime 打开运行流超时"/);
});
