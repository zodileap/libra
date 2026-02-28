import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 客户端源码文件，供工作流执行链路回归测试复用。
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

test("TestWorkflowEngineShouldInjectNodeInstructionIntoPrompt", () => {
  const source = readDesktopSource("src/shared/workflow/engine.ts");

  // 描述：
  //
  //   - 执行引擎应从画布 graph 节点提取 instruction，并在命中节点时拼接到 prompt。
  assert.match(source, /function parseWorkflowNodeKindFromGraphDescription\(/);
  assert.match(source, /function buildWorkflowNodeInstructionMap\(/);
  assert.match(source, /instructionMap\[kind\] = instruction;/);
  assert.match(source, /String\(graphNode\.instruction \|\| ""\)\.trim\(\)/);
  assert.match(source, /function mergePromptWithNodeInstruction\(/);
  assert.match(source, /【节点指令】/);
  assert.match(source, /async function runNode\([\s\S]*nodeInstruction = ""/);
  assert.match(source, /const promptWithNodeInstruction = mergePromptWithNodeInstruction\(/);
  assert.match(source, /prompt:\s*promptWithNodeInstruction,/);
  assert.match(source, /const structured = summarizePrompt\(promptWithNodeInstruction\);/);
  assert.match(source, /const nodeInstructionMap = buildWorkflowNodeInstructionMap\(workflow\);/);
  assert.match(source, /const nodeInstruction = String\(nodeInstructionMap\[node\.kind\] \|\| ""\)\.trim\(\);/);
  assert.match(source, /await runNode\(node, ctx, request, nodeInstruction\)/);
});
