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
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");

  // 描述:
  //
  //   - 侧边栏头部按钮应改为新增会话入口，并跳转到独立代码项目选择页。
  assert.match(source, /icon=\{createButtonHovered \? "note_stack_add_fill" : "note_stack_add"\}/);
  assert.match(source, /onMouseEnter=\{\(\) => \{\s*setCreateButtonHovered\(true\);\s*\}\}/s);
  assert.match(source, /onMouseLeave=\{\(\) => \{\s*setCreateButtonHovered\(false\);\s*\}\}/s);
  assert.match(source, /label="新增"/);
  assert.match(source, /const handleCreateSession = \(\) => \{/);
  assert.match(source, /navigate\("\/agents\/code"\);/);
  assert.match(source, /navigate\(`\/agents\/\$\{agentKey\}`\);/);
  assert.doesNotMatch(source, /createRuntimeSession\(/);
});

test("TestAgentSidebarShouldSeparateAgentAndWorkflowSettingsWithUnifiedStyle", () => {
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述:
  //
  //   - 智能体侧边栏底部应提供“智能体设置”“工作流设置”两个独立入口，并与用户入口保持同款样式。
  assert.match(source, /function SidebarQuickAction/);
  assert.match(source, /className="desk-user-trigger desk-user-trigger-btn desk-sidebar-quick-action"/);
  assert.match(source, /className="desk-sidebar-quick-actions"/);
  assert.match(source, /label="智能体设置"/);
  assert.match(source, /label="工作流设置"/);
  assert.match(source, /navigate\(`\/agents\/\$\{agentKey\}\/settings`\)/);
  assert.match(source, /navigate\(`\/agents\/\$\{agentKey\}\/workflows`\)/);
  assert.match(styleSource, /\.desk-sidebar-quick-actions/);
  assert.match(styleSource, /\.desk-sidebar-quick-action/);
  assert.match(source, /const SIDEBAR_ICON_FILL_MAP/);
  assert.match(source, /function resolveSidebarEntryIcon/);
  assert.match(source, /highlighted=\{entryHovered\}/);
  assert.match(styleSource, /\.desk-user-trigger-wrap:hover \.desk-user-trigger/);
});

test("TestAgentSidebarDeleteActionRequiresSecondConfirm", () => {
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");

  // 描述:
  //
  //   - 删除动作应先进入确认态，再执行状态更新与本地会话清理，确认按钮需使用危险色并展示“确定”。
  assert.match(source, /const \[pendingDeleteSessionId, setPendingDeleteSessionId\] = useState\(""\);/);
  assert.match(source, /if \(pendingDeleteSessionId !== sessionId\) \{\s*setPendingDeleteSessionId\(sessionId\);\s*return;\s*\}/s);
  assert.match(source, /removeAgentSession\(agentKey, sessionId\);/);
  assert.match(source, /setSessions\(\(prev\) => prev\.filter\(\(item\) => item\.id !== sessionId\)\);/);
  assert.match(source, /await updateRuntimeSessionStatus\(user\.id, sessionId, 0\);/);
  assert.match(source, /color=\{pendingDeleteSessionId === item\.id \|\| deletingSessionId === item\.id \? "danger" : "default"\}/);
  assert.match(source, /label=\{deletingSessionId === item\.id \? "删除中" : pendingDeleteSessionId === item\.id \? "确定" : undefined\}/);
});

test("TestAgentSidebarHoverActionsContainPinAndDeleteOnRight", () => {
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述:
  //
  //   - 会话项 hover 动作区应同时包含图钉与删除操作，且图钉位于删除左侧。
  assert.match(source, /const \[hoveredPinSessionId, setHoveredPinSessionId\] = useState\(""\);/);
  assert.match(source, /const \[hoveredDeleteSessionId, setHoveredDeleteSessionId\] = useState\(""\);/);
  assert.match(source, /icon=\{item\.pinned \|\| hoveredPinSessionId === item\.id \? "pinboard_fill" : "pinboard"\}/);
  assert.match(source, /hoveredDeleteSessionId === item\.id\s*\?\s*"delete_fill"\s*:\s*"delete"/);
  assert.match(source, /showActionsOnHover: true/);
  assert.match(styleSource, /\.desk-session-item-title/);
});

test("TestAgentSidebarContextMenuOrderIsPinRenameDelete", () => {
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");

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
  assert.match(source, /name=\{params\.forceFill \|\| hoveredContextMenuActionKey === params\.key \? params\.fillIcon : params\.icon\}/);
  assert.match(source, /items=\{contextMenuItems\}/);
  assert.match(source, /onContextMenu: \(event(?:: [^)]+)?\) => \{\s*handleOpenSessionContextMenu\(event, item\.id\);\s*\}/s);
  assert.match(source, /key: "pin",[\s\S]*key: "rename",[\s\S]*key: "delete"/);
  assert.match(source, /label: contextTargetSession\?\.pinned \? "取消固定会话" : "固定会话"/);
  assert.match(source, /onOpenChange=\{\(open\) => \{/);
});

test("TestAgentSidebarSessionListFiltersDeletedItems", () => {
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");
  const backendSource = readDesktopSource("src/modules/client/services/backend-api.ts");

  // 描述:
  //
  //   - 会话列表请求应默认带 status=1，前端再兜底过滤 status=0、软删除和本地 removedIds。
  assert.match(source, /listRuntimeSessions\(user\.id, agentKey, 1\)/);
  assert.match(source, /const visibleList = \(list \|\| \[\]\)\.filter\(\s*\(item\) => \(item\.status \?\? 1\) !== 0 && !item\.deleted_at && !meta\.removedIds\.includes\(item\.id\),\s*\);/s);
  assert.match(backendSource, /export async function listRuntimeSessions\(userId: string, agentCode\?: string, status\?: number\): Promise<RuntimeSessionEntity\[]>/);
  assert.match(backendSource, /const query = toQueryString\(\{ userId, agentCode, status \}\);/);
});

test("TestCodeAgentSidebarShouldUseWorkspaceTreeAndWorkspaceActions", () => {
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");

  // 描述:
  //
  //   - 代码智能体侧边栏应基于 AriMenu children 渲染“目录分组 -> 会话列表”多级菜单，并将目录操作收敛到“更多”菜单。
  assert.match(source, /interface CodeWorkspaceSessionGroup/);
  assert.match(source, /const codeWorkspaceSessionGroups = useMemo<CodeWorkspaceSessionGroup\[]>/);
  assert.match(source, /const buildWorkspaceMenuKey = \(workspaceId: string\) => `workspace:\$\{workspaceId\}`;/);
  assert.match(source, /children: buildSessionMenuItems\(group\.sessions\)/);
  assert.match(source, /className="desk-sidebar-nav desk-code-workspace-tree"/);
  assert.match(source, /mode="vertical"/);
  assert.match(source, /items=\{codeWorkspaceMenuItems\}/);
  assert.match(source, /defaultExpandedKeys=\{defaultExpandedWorkspaceKeys\}/);
  assert.match(source, /expandedKeys=\{codeWorkspaceExpandedKeys\}/);
  assert.match(source, /onExpand=\{setCodeWorkspaceExpandedKeys\}/);
  assert.match(source, /icon="more_horiz"/);
  assert.match(source, /trigger="click"/);
  assert.match(source, /\{ key: "edit", label: "编辑", icon: "edit" \}/);
  assert.match(source, /\{ key: "delete", label: "删除", icon: "delete", fillIcon: "delete_fill" \}/);
});

test("TestAgentSidebarTitleUsesUnifiedResolver", () => {
  const sidebarSource = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");
  const dataSource = readDesktopSource("src/modules/client/data.ts");

  // 描述:
  //
  //   - 侧边栏标题应与会话内容区共用统一标题解析逻辑，不再使用“模型会话 #id”默认拼接文案。
  assert.match(sidebarSource, /resolveAgentSessionTitle\(agentKey, item\.id\)/);
  assert.match(dataSource, /export function resolveAgentSessionTitle\(agentKey: "code" \| "model", sessionId\?: string \| null\): string/);
  assert.match(dataSource, /return "会话详情";/);
});

test("TestAgentSidebarRenameModalsShouldUseBorderlessInput", () => {
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");

  // 描述:
  //
  //   - 侧边栏会话重命名对话框输入框应使用无边框样式；目录重命名弹窗已迁移为项目设置页编辑。
  assert.match(source, /placeholder="输入新的会话标题"/);
  assert.match(source, /<AriInput\s+variant="borderless"\s+value=\{renameValue\}/s);
  assert.doesNotMatch(source, /workspaceRenameModalVisible/);
  assert.doesNotMatch(source, /placeholder="输入目录展示名称"/);
});

test("TestSessionPageSyncsTitleAfterRenameEvent", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述:
  //
  //   - 会话页应监听标题变更事件，确保重命名后内容区标题立即同步更新。
  assert.match(source, /SESSION_TITLE_UPDATED_EVENT/);
  assert.match(source, /window\.addEventListener\(SESSION_TITLE_UPDATED_EVENT, onSessionTitleUpdated as EventListener\);/);
  assert.match(source, /setSessionTitle\(detail\.title \|\| resolveAgentSessionTitle\(normalizedAgentKey, sessionId\)\);/);
});
