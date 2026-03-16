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
    /actionsVisibility: pendingDeleteSessionId !== item\.id && deletingSessionId !== item\.id \? "hover" : "always"/,
  );
  assert.doesNotMatch(source, /sessionMenuRenderVersion/);
  assert.doesNotMatch(source, /reloadSessionSidebarMenu/);
  assert.match(
    source,
    /setSessions\(\(prev\) => prev\.filter\(\(item\) => item\.id !== sessionId\)\);\s*setPendingDeleteSessionId\(""\);/s,
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
  assert.match(
    source,
    /type=\{pendingDeleteWorkflowId === item\.id \? "default" : "text"\}[\s\S]*?ghost=\{pendingDeleteWorkflowId !== item\.id\}[\s\S]*?color="default"/,
  );
  assert.doesNotMatch(
    source,
    /pendingDeleteWorkflowId === item\.id \? "danger" : "default"/,
  );

  // 描述:
  //
  //   - 工作流删除按钮进入确认态后不应在鼠标移出时清空确认状态，避免二次确认被意外打断。
  assert.doesNotMatch(
    source,
    /onMouseLeave=\{\(\) => \{[\s\S]*setPendingDeleteWorkflowId\(\(current\) => \(current === item\.key \? "" : current\)\);[\s\S]*\}\}/,
  );
  assert.match(
    source,
    /actionsVisibility: pendingDeleteWorkflowId !== item\.id \? "hover" : "always"/,
  );
  assert.doesNotMatch(source, /workflowMenuRenderVersion/);
  assert.match(source, /window\.addEventListener\(AGENT_WORKFLOWS_UPDATED_EVENT, handleAgentWorkflowsUpdated as EventListener\)/);

  // 描述:
  //
  //   - 删除失败提示需按场景区分，默认模板提示、目标缺失提示、通用失败提示不能混淆。
  assert.doesNotMatch(source, /默认工作流不可删除，请先复制后再管理。/);
  assert.match(source, /t\("工作流不存在或已删除，请刷新后重试。"\)/);
  assert.match(source, /t\("工作流删除失败，请稍后重试。"\)/);

  // 描述:
  //
  //   - 目录级操作应包含“更多/项目设置/项目内新增话题”按钮，菜单中仅保留删除动作。
  assert.match(source, /<AriPopover/);
  assert.match(source, /trigger="click"/);
  assert.match(source, /open=\{openWorkspaceActionMenuId === group\.workspace\.id\}/);
  assert.match(source, /onOpenChange=\{\(nextOpen\) => \{\s*setOpenWorkspaceActionMenuId\(nextOpen \? group\.workspace\.id : ""\);\s*\}\}/s);
  assert.match(source, /icon="more_horiz"/);
  assert.match(source, /icon="settings"/);
  assert.match(source, /aria-label=\{t\("项目设置"\)\}/);
  assert.match(source, /aria-label=\{t\("在项目内新增话题"\)\}/);
  assert.match(source, /icon="edit"/);
  assert.match(source, /\{ key: "delete", label: t\("删除"\), icon: "delete", fillIcon: "delete_fill" \}/);
  assert.doesNotMatch(source, /\{ key: "edit", label: "编辑", icon: "edit" \}/);
  assert.match(source, /expandIconPosition="none"/);
});
