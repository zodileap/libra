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
  assert.match(
    source,
    /showActionsOnHover: pendingDeleteSessionId !== item\.id && deletingSessionId !== item\.id/,
  );
  assert.match(
    source,
    /const \[sessionMenuRenderVersion, setSessionMenuRenderVersion\] = useState\(0\);/,
  );
  assert.match(
    source,
    /const reloadSessionSidebarMenu = \(\) => \{/,
  );
  assert.match(
    source,
    /key=\{`code-workspace-menu-\$\{sessionMenuRenderVersion\}`\}/,
  );
  assert.match(
    source,
    /setSessions\(\(prev\) => prev\.filter\(\(item\) => item\.id !== sessionId\)\);\s*reloadSessionSidebarMenu\(\);/s,
  );
  assert.match(
    source,
    /const markSuppressNextSessionSelect = \(sessionId: string\) => \{/,
  );
  assert.match(source, /isSessionRunning/);
  assert.match(source, /SESSION_RUN_STATE_UPDATED_EVENT/);
  assert.match(source, /icon: item\.running \? "loading" : undefined/);
  assert.match(source, /fillIcon: item\.running \? "loading" : undefined/);
  assert.match(source, /iconAnimation: item\.running \? "spinning" : undefined/);
  assert.match(source, /iconState: item\.running \? "loading" : undefined/);

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
  //   - 目录级操作应包含“更多/项目设置/项目内新增话题”按钮，菜单中仅保留删除动作。
  assert.match(source, /trigger="manual"/);
  assert.match(source, /visible=\{openWorkspaceActionMenuId === group\.workspace\.id\}/);
  assert.match(source, /icon="more_horiz"/);
  assert.match(source, /icon="settings"/);
  assert.match(source, /aria-label="项目设置"/);
  assert.match(source, /aria-label="在项目内新增话题"/);
  assert.match(source, /icon="edit"/);
  assert.match(source, /\{ key: "delete", label: "删除", icon: "delete", fillIcon: "delete_fill" \}/);
  assert.doesNotMatch(source, /\{ key: "edit", label: "编辑", icon: "edit" \}/);
  assert.match(source, /expandIconPosition="none"/);
});
