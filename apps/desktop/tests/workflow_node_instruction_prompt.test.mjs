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
  const source = readDesktopSource("src/shared/workflow/storage.ts");

  // 描述：
  //
  //   - 统一智能体工作流应直接从 graph 节点提取 instruction，并拼接到最终 Prompt。
  assert.match(source, /const normalizedInstruction = String\(node\.instruction \|\| ""\)\.trim\(\);/);
  assert.match(source, /本节点要求：\$\{normalizedInstruction\}/);
  assert.match(source, /const skillChainLines = \(workflow\?\.graph\?\.nodes \|\| \[\]\)/);
  assert.match(source, /filter\(\(node\) => node\.type === "skill"\)/);
  assert.match(source, /return \[/);
});
