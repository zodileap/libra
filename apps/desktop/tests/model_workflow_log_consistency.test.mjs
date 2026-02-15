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
