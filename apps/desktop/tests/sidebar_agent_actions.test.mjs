import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取 Desktop 客户端源码文件，用于侧边栏交互回归测试。
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

test("TestAgentSidebarHeaderUsesCreateActionInsteadOfRefresh", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");

  // 描述:
  //
  //   - 侧边栏头部按钮应改为新项目入口，并跳转到统一项目选择页。
  assert.match(source, /icon=\{createButtonHovered \? "note_stack_add_fill" : "note_stack_add"\}/);
  assert.match(source, /onMouseEnter=\{\(\) => \{\s*setCreateButtonHovered\(true\);\s*\}\}/s);
  assert.match(source, /onMouseLeave=\{\(\) => \{\s*setCreateButtonHovered\(false\);\s*\}\}/s);
  assert.match(source, /label=\{t\("新增"\)\}/);
  assert.match(source, /const handleCreateSession = \(\) => \{/);
  assert.match(source, /navigate\(AGENT_HOME_PATH\);/);
  assert.doesNotMatch(source, /navigate\(`\/agents\/\$\{agentKey\}`\);/);
});

test("TestAgentSidebarShouldSeparateAgentAndWorkflowSettingsWithUnifiedStyle", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述:
  //
  //   - 当前实现将“智能体设置/工作流设置”收敛到设置菜单与工作流页，统一使用新路径与 AriMenu 风格体系。
  assert.match(source, /function SettingsSidebar/);
  assert.match(source, /resolveSettingsSidebarItems\(routeAccess\)/);
  assert.match(source, /selectedSettingKey/);
  assert.match(source, /if \(location\.pathname\.includes\(AGENT_SETTINGS_PATH\) && routeAccess\.isAgentEnabled\("agent"\)\)/);
  assert.doesNotMatch(source, /\/agents\/model\/settings/);
  assert.match(source, /<AriMenu/);
  assert.match(source, /items=\{settingItems\}/);
  assert.match(source, /className="desk-sidebar"/);
  assert.match(styleSource, /\.desk-user-trigger-wrap:hover \.desk-user-trigger/);
});

test("TestAgentSidebarDeleteActionRequiresSecondConfirm", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");

  // 描述:
  //
  //   - 删除动作应先进入确认态，再执行状态更新与本地会话清理，确认按钮需使用危险色并展示“确定”。
  assert.match(source, /const \[pendingDeleteSessionId, setPendingDeleteSessionId\] = useState\(""\);/);
  assert.match(source, /if \(pendingDeleteSessionId !== sessionId\) \{\s*setPendingDeleteSessionId\(sessionId\);\s*return;\s*\}/s);
  assert.match(source, /removeAgentSession\(agentKey, sessionId\);/);
  assert.match(source, /setSessions\(\(prev\) => prev\.filter\(\(item\) => item\.id !== sessionId\)\);/);
  assert.match(source, /await updateRuntimeSessionStatus\(user\.id, sessionId, 0\);/);
  assert.match(source, /color=\{pendingDeleteSessionId === item\.id \|\| deletingSessionId === item\.id \? "danger" : "default"\}/);
  assert.match(source, /label=\{deletingSessionId === item\.id \? t\("删除中"\) : pendingDeleteSessionId === item\.id \? t\("确定"\) : undefined\}/);
});

test("TestAgentSidebarHoverActionsContainPinAndDeleteOnRight", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述:
  //
  //   - 会话项 hover 动作区应同时包含图钉与删除操作，且图钉位于删除左侧。
  assert.match(source, /const \[hoveredPinSessionId, setHoveredPinSessionId\] = useState\(""\);/);
  assert.match(source, /const \[hoveredDeleteSessionId, setHoveredDeleteSessionId\] = useState\(""\);/);
  assert.match(source, /icon=\{item\.pinned \|\| hoveredPinSessionId === item\.id \? "pinboard_fill" : "pinboard"\}/);
  assert.match(source, /hoveredDeleteSessionId === item\.id\s*\?\s*"delete_fill"\s*:\s*"delete"/);
  assert.match(source, /showActionsOnHover: true/);
  assert.match(styleSource, /\.desk-sidebar-entry-text/);
});

test("TestAgentSidebarContextMenuOrderIsPinRenameDelete", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");

  // 描述:
  //
  //   - 右键菜单应使用 AriContextMenu，且菜单项顺序固定为：固定会话、重命名会话、删除会话。
  assert.match(source, /<AriContextMenu/);
  assert.match(source, /const handleOpenSessionContextMenu = \(event: MouseEvent<HTMLElement>, sessionId: string\) => \{/);
  assert.match(source, /const \[hoveredContextMenuActionKey, setHoveredContextMenuActionKey\] = useState\(""\);/);
  assert.match(source, /const contextMenuItems = useMemo\(\(\) => \{/);
  assert.match(source, /fillIcon: "pinboard_fill"/);
  assert.match(source, /fillIcon: "edit_fill"/);
  assert.match(source, /fillIcon: "delete_fill"/);
  assert.match(source, /name=\{\(?params\.forceFill \|\| hoveredContextMenuActionKey === params\.key\)? \? params\.fillIcon : params\.icon\}/);
  assert.match(source, /items=\{contextMenuItems\}/);
  assert.match(source, /onContextMenu: \(event(?:: [^)]+)?\) => \{\s*handleOpenSessionContextMenu\(event, item\.id\);\s*\}/s);
  assert.match(source, /key: "pin",[\s\S]*key: "rename",[\s\S]*key: "delete"/);
  assert.match(source, /label: contextTargetSession\?\.pinned \? t\("取消固定会话"\) : t\("固定会话"\)/);
  assert.match(source, /onOpenChange=\{\(open(?::\s*boolean)?\) => \{/);
});

test("TestAgentSidebarSessionListFiltersDeletedItems", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");
  const backendSource = readDesktopSource("src/shared/services/backend-api.ts");

  // 描述:
  //
  //   - 会话列表请求应默认带 status=1，前端再兜底过滤 status=0、软删除和本地 removedIds。
  assert.match(source, /listRuntimeSessions\(user\.id, agentKey, 1\)/);
  assert.match(source, /const visibleList = \(list \|\| \[\]\)\.filter\(\s*\(item\) => \(item\.status \?\? 1\) !== 0 && !item\.deleted_at && !meta\.removedIds\.includes\(item\.id\),\s*\);/s);
  assert.match(backendSource, /export async function listRuntimeSessions\(userId: string, agentCode\?: string, status\?: number\): Promise<RuntimeSessionEntity\[]>/);
  assert.match(backendSource, /const query = toQueryString\(\{ userId, agentCode, status \}\);/);
});

test("TestAgentSidebarShouldUseWorkspaceTreeAndWorkspaceActions", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");

  // 描述:
  //
  //   - 统一智能体侧边栏应基于 AriMenu children 渲染“目录分组 -> 会话列表”多级菜单，并提供“更多/设置/新增话题”三类目录动作。
  assert.match(source, /interface WorkspaceSessionGroup/);
  assert.match(source, /const workspaceSessionGroups = useMemo<WorkspaceSessionGroup\[]>/);
  assert.match(source, /const buildWorkspaceMenuKey = \(workspaceId: string\) => `workspace:\$\{workspaceId\}`;/);
  assert.match(source, /children: buildSessionMenuItems\(group\.sessions\)/);
  assert.match(source, /className="desk-sidebar-nav desk-project-workspace-tree"/);
  assert.match(source, /mode="vertical"/);
  assert.match(source, /items=\{projectWorkspaceMenuItems\}/);
  assert.match(source, /defaultExpandedKeys=\{defaultExpandedWorkspaceKeys\}/);
  assert.match(source, /expandedKeys=\{projectWorkspaceExpandedKeys\}/);
  assert.match(source, /onExpand=\{setProjectWorkspaceExpandedKeys\}/);
  assert.match(source, /icon="more_horiz"/);
  assert.match(source, /icon="settings"/);
  assert.match(source, /aria-label=\{t\("项目设置"\)\}/);
  assert.match(source, /aria-label=\{t\("在项目内新增话题"\)\}/);
  assert.match(source, /trigger="manual"/);
  assert.match(source, /\{ key: "delete", label: t\("删除"\), icon: "delete", fillIcon: "delete_fill" \}/);
  assert.doesNotMatch(source, /\{ key: "edit", label: "编辑", icon: "edit" \}/);
});

test("TestAgentSidebarShouldKeepWorkspaceExpandedWhenSelectingTopic", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");

  // 描述:
  //
  //   - 点击项目内话题时，路由切换只应清理临时交互态，不应把目录树展开状态清空。
  assert.match(source, /setPendingDeleteSessionId\(""\);[\s\S]*setHoveredContextMenuActionKey\(""\);[\s\S]*\}, \[location\.pathname\]\);/);
  assert.match(source, /setProjectWorkspaceExpandedKeys\(\[\]\);[\s\S]*setSessionSortMode\("default"\);[\s\S]*\}, \[agentKey\]\);/);
  assert.doesNotMatch(source, /setProjectWorkspaceExpandedKeys\(\[\]\);[\s\S]*\}, \[location\.pathname(?:,\s*agentKey)?\]\);/);
});

test("TestAgentSidebarTitleUsesUnifiedResolver", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述:
  //
  //   - 侧边栏标题应与会话内容区共用统一标题解析逻辑，不再使用“旧会话分支 #id”默认拼接文案。
  assert.match(sidebarSource, /resolveAgentSessionTitle\(agentKey, item\.id\)/);
  assert.match(dataSource, /export function resolveAgentSessionTitle\(agentKey: AgentKey, sessionId\?: string \| null\): string/);
  assert.match(dataSource, /return translateDesktopText\("会话详情"\);/);
});

test("TestAgentSidebarRenameModalsShouldUseBorderlessInput", () => {
  const source = readDesktopSource("src/sidebar/index.tsx");

  // 描述:
  //
  //   - 侧边栏会话重命名对话框输入框应使用无边框样式；目录重命名弹窗已迁移为项目设置页编辑。
  assert.match(source, /placeholder=\{t\("输入新的会话标题"\)\}/);
  assert.match(source, /<AriInput\s+variant="borderless"\s+value=\{renameValue\}/s);
  assert.doesNotMatch(source, /workspaceRenameModalVisible/);
  assert.doesNotMatch(source, /placeholder="输入目录展示名称"/);
});

test("TestSessionPageSyncsTitleAfterRenameEvent", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述:
  //
  //   - 会话页应监听标题变更事件，确保重命名后内容区标题立即同步更新。
  assert.match(source, /SESSION_TITLE_UPDATED_EVENT/);
  assert.match(source, /window\.addEventListener\(SESSION_TITLE_UPDATED_EVENT, onSessionTitleUpdated as EventListener\);/);
  assert.match(source, /setSessionTitle\(detail\.title \|\| resolveAgentSessionTitle\(normalizedAgentKey, sessionId\)\);/);
});
