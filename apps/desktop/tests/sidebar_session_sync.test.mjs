import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 侧边栏源码，验证会话同步逻辑。
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

test("TestSidebarShouldRefreshWhenRouteSessionMissingInList", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");

  // 描述：
  //
  //   - 当路由已定位到会话详情，但侧边栏列表尚未包含该会话时，应自动触发刷新。
  assert.match(source, /missingSessionSyncAttemptsRef/);
  assert.match(source, /if \(!selectedSessionKey\) \{/);
  assert.match(source, /sessions\.some\(\(item\) => item\.id === selectedSessionKey\)/);
  assert.match(source, /if \(attempts >= 2\) \{/);
  assert.match(source, /void refreshSessions\(\);/);
});

test("TestSidebarShouldSyncWorkspaceTreeWhenWorkspaceGroupsUpdated", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 数据层写入代码目录分组后，需要广播统一事件给侧边栏监听。
  assert.match(dataSource, /export const CODE_WORKSPACE_GROUPS_UPDATED_EVENT = "zodileap:code-workspace-groups-updated";/);
  assert.match(dataSource, /new CustomEvent\(CODE_WORKSPACE_GROUPS_UPDATED_EVENT,/);
  assert.match(dataSource, /emitCodeWorkspaceGroupsUpdated\("upsert"\);/);
  assert.match(dataSource, /emitCodeWorkspaceGroupsUpdated\("settings"\);/);
  assert.match(dataSource, /emitCodeWorkspaceGroupsUpdated\("remove"\);/);

  // 描述：
  //
  //   - 侧边栏应监听该事件并即时刷新目录分组，避免新增项目后需重进才可见。
  assert.match(sidebarSource, /CODE_WORKSPACE_GROUPS_UPDATED_EVENT/);
  assert.match(sidebarSource, /window\.addEventListener\(CODE_WORKSPACE_GROUPS_UPDATED_EVENT, onCodeWorkspaceGroupsUpdated as EventListener\);/);
  assert.match(sidebarSource, /setWorkspaceGroups\(listCodeWorkspaceGroups\(\)\);/);
  assert.match(sidebarSource, /window\.removeEventListener\(CODE_WORKSPACE_GROUPS_UPDATED_EVENT, onCodeWorkspaceGroupsUpdated as EventListener\);/);
});

test("TestRemoveWorkspaceShouldAlsoRemoveBoundSessions", () => {
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 删除项目时应一并移除该项目下会话，防止无归属会话在刷新后自动绑定到新项目。
  assert.match(dataSource, /const sessionIds = mapItems[\s\S]*\.filter\(\(item\) => item\.workspaceId === workspaceId\)[\s\S]*\.map\(\(item\) => item\.sessionId\);/);
  assert.match(dataSource, /sessionIds\.forEach\(\(sessionId\) => \{\s*removeAgentSession\("code", sessionId\);\s*\}\);/s);
});
