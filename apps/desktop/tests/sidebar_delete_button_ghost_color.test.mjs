import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取侧边栏源码，用于校验删除按钮统一采用 ghost + color 文本着色方案。
//
// Returns:
//
//   - UTF-8 编码源码文本。
function readSidebarSource() {
  const sourcePath = path.resolve(process.cwd(), "src/sidebar/index.tsx");
  return fs.readFileSync(sourcePath, "utf8");
}

test("TestSidebarDeleteButtonsShouldUseGhostAndColor", () => {
  const source = readSidebarSource();

  // 描述:
  //
  //   - 会话删除按钮应使用 ghost，并在确认/删除态切换 danger 色文本。
  assert.match(
    source,
    /size="sm"[\s\S]*?type="text"[\s\S]*?ghost[\s\S]*?color=\{pendingDeleteSessionId === item\.id \|\| deletingSessionId === item\.id \? "danger" : "default"\}/,
  );

  // 描述:
  //
  //   - 工作流删除按钮默认应为 ghost；进入“确定”确认态后应切为非 ghost。
  assert.match(
    source,
    /type=\{pendingDeleteWorkflowId === item\.id \? "default" : "text"\}/,
  );
  assert.match(
    source,
    /ghost=\{pendingDeleteWorkflowId !== item\.id\}/,
  );

  // 描述:
  //
  //   - 工作流删除按钮在鼠标移出后应退出确认态，避免再次 hover 仍停留“确定”状态。
  assert.match(
    source,
    /onMouseLeave=\{\(\) => \{[\s\S]*setPendingDeleteWorkflowId\(\(current\) => \(current === item\.id \? "" : current\)\);[\s\S]*\}\}/,
  );

  // 描述:
  //
  //   - 删除失败提示需按场景区分，默认模板提示、目标缺失提示、通用失败提示不能混淆。
  assert.match(
    source,
    /const warningContent = !targetWorkflow\s*\?\s*"工作流不存在或已删除，请刷新后重试。"\s*:\s*targetWorkflow\.shared\s*\?\s*"默认工作流不可删除，请先复制后再管理。"\s*:\s*"工作流删除失败，请稍后重试。";/,
  );

  // 描述:
  //
  //   - 目录删除按钮应使用 ghost + danger，展示危险文本语义。
  assert.match(
    source,
    /size="sm"[\s\S]*?type="text"[\s\S]*?ghost[\s\S]*?color="danger"[\s\S]*?icon="delete"/,
  );
});
