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
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 数据层写入项目目录分组后，需要广播统一事件给侧边栏监听。
  assert.match(dataSource, /export const PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT = "libra:project-workspace-groups-updated";/);
  assert.match(dataSource, /new CustomEvent\(PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT,/);
  assert.match(dataSource, /emitProjectWorkspaceGroupsUpdated\("upsert"\);/);
  assert.match(dataSource, /emitProjectWorkspaceGroupsUpdated\("settings"\);/);
  assert.match(dataSource, /emitProjectWorkspaceGroupsUpdated\("remove"\);/);

  // 描述：
  //
  //   - 侧边栏应监听该事件并即时刷新目录分组，避免新增项目后需重进才可见。
  assert.match(sidebarSource, /PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT/);
  assert.match(sidebarSource, /window\.addEventListener\(PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT, onProjectWorkspaceGroupsUpdated as EventListener\);/);
  assert.match(sidebarSource, /setWorkspaceGroups\(listProjectWorkspaceGroups\(\)\);/);
  assert.match(sidebarSource, /window\.removeEventListener\(PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT, onProjectWorkspaceGroupsUpdated as EventListener\);/);

  // 描述：
  //
  //   - 数据层应提供项目结构化信息更新广播能力，用于同项目多话题共享同步。
  assert.match(dataSource, /export const PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT = "libra:project-workspace-profile-updated";/);
  assert.match(dataSource, /new CustomEvent\(PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT,/);
  assert.match(dataSource, /emitProjectWorkspaceProfileUpdated\(/);

  // 描述：
  //
  //   - 会话页应监听 profile 更新事件并刷新当前项目上下文缓存，保证同项目跨话题实时一致。
  assert.match(sessionSource, /PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT/);
  assert.match(sessionSource, /window\.addEventListener\(\s*PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT,\s*onProjectWorkspaceProfileUpdated as EventListener,\s*\);/s);
  assert.match(sessionSource, /setActiveProjectProfile\(getProjectWorkspaceProfile\(activeWorkspace\.id\)\);/);
  assert.match(sessionSource, /window\.removeEventListener\(\s*PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT,\s*onProjectWorkspaceProfileUpdated as EventListener,\s*\);/s);
});

test("TestSidebarShouldPersistBackgroundSessionProgressText", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");

  // 描述：
  //
  //   - 侧边栏后台监听应使用最新路由 ref 判断当前是否仍处于该会话，避免切页后继续命中旧闭包而跳过持久化。
  assert.match(sidebarSource, /const activePathnameRef = useRef\(location\.pathname\);/);
  assert.match(sidebarSource, /const activeSelectedSessionKeyRef = useRef\(selectedSessionKey\);/);
  assert.match(sidebarSource, /activePathnameRef\.current = location\.pathname;/);
  assert.match(sidebarSource, /activeSelectedSessionKeyRef\.current = selectedSessionKey;/);
  assert.match(sidebarSource, /const isActiveSessionPage = activePathnameRef\.current\.includes\("\/session\/"\)\s*&&\s*activeSelectedSessionKeyRef\.current === sessionId;/);

  // 描述：
  //
  //   - 离开会话页后，后台流事件应同步写入助手消息文本，而不是只写 run state。
  assert.match(sidebarSource, /getSessionMessages/);
  assert.match(sidebarSource, /upsertSessionMessages/);
  assert.match(sidebarSource, /function upsertSidebarAssistantMessageById\(/);
  assert.match(sidebarSource, /function resolveSidebarAssistantMessageText\(/);
  assert.match(sidebarSource, /heartbeatCount: number/);
  assert.match(sidebarSource, /if \(payload\.kind === STREAM_KINDS\.PLANNING && text\.startsWith\("__libra_planning__:"\)\)/);
  assert.match(sidebarSource, /const meta = JSON\.parse\(text\.slice\("__libra_planning__:"\.length\)\.trim\(\)\)/);
  assert.match(sidebarSource, /if \(payload\.kind === STREAM_KINDS\.HEARTBEAT\) \{/);
  assert.match(sidebarSource, /const waitedSeconds = Math\.max\(1, Math\.round\(heartbeatCount \* 1\.2\)\);/);
  assert.match(sidebarSource, /const heartbeatCount = nextMeta\.segments\.filter\(\(item\) => \{/);
  assert.match(sidebarSource, /const storedMessages = getSessionMessages\("agent", sessionId\);/);
  assert.match(sidebarSource, /const nextMessageText = resolveSidebarAssistantMessageText\(\s*payload,\s*currentMessageText,\s*nextMeta\.summary,\s*heartbeatCount,\s*\);/s);
  assert.match(sidebarSource, /upsertSessionMessages\(\{\s*agentKey: "agent",\s*sessionId,\s*messages: upsertSidebarAssistantMessageById\(storedMessages, activeMessageId, nextMessageText\),\s*\}\);/s);
});

test("TestRemoveWorkspaceShouldAlsoRemoveBoundSessions", () => {
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 删除项目时应一并移除该项目下会话，防止无归属会话在刷新后自动绑定到新项目。
  assert.match(dataSource, /const sessionIds = mapItems[\s\S]*\.filter\(\(item\) => item\.workspaceId === workspaceId\)[\s\S]*\.map\(\(item\) => item\.sessionId\);/);
  assert.match(dataSource, /sessionIds\.forEach\(\(sessionId\) => \{\s*removeAgentSession\("agent", sessionId\);\s*\}\);/s);
});

test("TestLocalSidebarSessionsShouldNotSeedDemoTopicsForNewProject", () => {
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 本地模式新项目不应自动带出示例话题，列表只应来自真实创建过的话题和本地消息记录。
  assert.match(dataSource, /export const AGENT_SESSIONS: AgentSession\[] = \[\];/);
  assert.doesNotMatch(dataSource, /MCP 接入验证/);
  assert.match(dataSource, /const dynamicProjects = readAgentProjects\(\)\.map<AgentSession>/);
  assert.doesNotMatch(dataSource, /const defaults = AGENT_SESSIONS/);
});
