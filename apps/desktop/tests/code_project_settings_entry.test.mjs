import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，校验代码项目设置页入口与数据能力。
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

test("TestCodeProjectSettingsShouldExposeRouteAndSidebarEntry", () => {
  const routesSource = readDesktopSource("src/modules/code/routes.tsx");
  const routerSource = readDesktopSource("src/router/index.tsx");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");

  // 描述:
  //
  //   - code 模块应暴露项目设置路径和懒加载入口，并在桌面总路由中注册页面。
  assert.match(routesSource, /export const CODE_PROJECT_SETTINGS_PATH = "\/agents\/code\/project-settings" as const;/);
  assert.match(routesSource, /export const CodeProjectSettingsPageLazy = lazy/);
  assert.match(routerSource, /path="agents\/code\/project-settings"/);
  assert.match(routerSource, /<CodeProjectSettingsPageLazy \/>/);

  // 描述:
  //
  //   - 代码目录一级菜单 hover 操作应包含“更多/设置/新话题”入口，并将“编辑”从更多菜单迁移为独立设置按钮。
  assert.match(sidebarSource, /icon="more_horiz"/);
  assert.match(sidebarSource, /icon="settings"/);
  assert.match(sidebarSource, /aria-label="项目设置"/);
  assert.match(sidebarSource, /icon="edit"/);
  assert.match(sidebarSource, /\{ key: "delete", label: "删除", icon: "delete", fillIcon: "delete_fill" \}/);
  assert.doesNotMatch(sidebarSource, /\{ key: "edit", label: "编辑", icon: "edit" \}/);
  assert.match(sidebarSource, /aria-label="在项目内新增话题"/);
  assert.match(sidebarSource, /void handleCreateSessionInWorkspace\(group\.workspace\.id\);/);
  assert.match(sidebarSource, /setOpenWorkspaceActionMenuId\(""\);/);
  assert.match(sidebarSource, /expandIconPosition="none"/);
  assert.match(sidebarSource, /const \[openWorkspaceActionMenuId, setOpenWorkspaceActionMenuId\] = useState\(""\);/);
  assert.match(sidebarSource, /trigger="manual"/);
  assert.match(sidebarSource, /visible=\{openWorkspaceActionMenuId === group\.workspace\.id\}/);
  assert.match(sidebarSource, /setOpenWorkspaceActionMenuId\(\(current\) => \(current === group\.workspace\.id \? "" : group\.workspace\.id\)\);/);
  assert.match(sidebarSource, /data-workspace-action-trigger="true"/);
  assert.match(sidebarSource, /window\.addEventListener\("mousedown", handleCloseWorkspaceActionMenu, true\);/);
  assert.match(sidebarSource, /if \(target\.closest\("\.z-tooltip"\)\) \{/);
  assert.match(sidebarSource, /pendingDeleteSessionId,/);
  assert.match(sidebarSource, /deletingSessionId,/);
  assert.match(sidebarSource, /hoveredPinSessionId,/);
  assert.match(sidebarSource, /hoveredDeleteSessionId,/);
  assert.match(sidebarSource, /setOpenWorkspaceActionMenuId\(""\);/);
  assert.doesNotMatch(sidebarSource, /workspaceActionMenuVersion/);
  assert.match(sidebarSource, /navigate\(`\$\{CODE_PROJECT_SETTINGS_PATH\}\?workspaceId=\$\{encodeURIComponent\(workspaceId\)\}`\)/);
  assert.match(sidebarSource, /const isCodeProjectSettingsPath = isCodeAgent && location\.pathname\.startsWith\(CODE_PROJECT_SETTINGS_PATH\);/);
  assert.match(sidebarSource, /if \(isCodeProjectSettingsPath\) \{\s*return "";\s*\}/);
  assert.doesNotMatch(sidebarSource, /return buildWorkspaceMenuKey\(selectedWorkspaceFromQuery\);/);
  assert.match(sidebarSource, /setCodeWorkspaceExpandedKeys\(\(current\) => \{\s*const next = new Set\(\[\.\.\.current, workspaceMenuKey\]\);/s);
  assert.match(sidebarSource, /label: item\.title,/);
  assert.doesNotMatch(sidebarSource, /label: <AriTypography className="desk-session-item-title"/);
  assert.doesNotMatch(sidebarSource, /handleOpenWorkspaceRenameModal/);
  assert.doesNotMatch(sidebarSource, /workspaceRenameModalVisible/);

  // 描述:
  //
  //   - Main 区应提供“项目信息”入口，允许不经侧边栏更多菜单直接进入项目设置。
  const codeAgentSource = readDesktopSource("src/modules/code/pages/code-agent-page.tsx");
  assert.match(codeAgentSource, /label="项目信息"/);
  assert.match(codeAgentSource, /icon="settings"/);
  assert.match(codeAgentSource, /handleOpenProjectSettingsPage/);
  assert.match(codeAgentSource, /navigate\(`\$\{CODE_PROJECT_SETTINGS_PATH\}\?workspaceId=\$\{encodeURIComponent\(selectedWorkspace\.id\)\}`\)/);
});

test("TestCodeProjectSettingsPageShouldSupportNameAndDependencyRules", () => {
  const pageSource = readDesktopSource("src/modules/code/pages/code-project-settings-page.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");
  const settingsPrimitivesSource = readDesktopSource("src/widgets/settings-primitives.tsx");

  // 描述:
  //
  //   - 项目设置页应提供项目名称、依赖限制和结构化项目信息维护能力。
  assert.match(pageSource, /<DeskSectionTitle title="基础信息" \/>/);
  assert.match(pageSource, /<DeskSettingsRow title="项目名称">/);
  assert.match(pageSource, /<DeskSectionTitle title="依赖规范" \/>/);
  assert.match(pageSource, /<DeskSectionTitle title="结构化项目信息" \/>/);
  assert.match(pageSource, /const \[projectProfileEditMode, setProjectProfileEditMode\] = useState<"form" \| "json">\("form"\);/);
  assert.match(pageSource, /label="分区表单"/);
  assert.match(pageSource, /label="JSON 高级"/);
  assert.match(pageSource, /title="JSON（高级）"/);
  assert.match(pageSource, /handleApplyProjectProfileJson/);
  assert.match(pageSource, /parseProjectProfileDraftFromJson\(/);
  assert.match(pageSource, /setProjectProfileJsonStatus\("JSON 已应用，结构化信息将自动保存。"\);/);
  assert.match(pageSource, /orderedKnowledgeSections\.map\(\(section\) =>/);
  assert.match(pageSource, /handleUpdateKnowledgeSectionFacet/);
  assert.match(pageSource, /buildFacetRowTitle\(section\.title, facet\.label\)/);
  assert.match(pageSource, /PROJECT_PROFILE_SECTION_KEYS/);
  assert.doesNotMatch(pageSource, /title="前端技术栈"/);
  assert.doesNotMatch(pageSource, /title="后端技术栈"/);
  assert.match(pageSource, /<AriInput\.TextList/);
  assert.match(pageSource, /<AriInput\.TextArea/);
  assert.match(pageSource, /updateCodeWorkspaceGroupSettings\(/);
  assert.match(pageSource, /saveCodeWorkspaceProjectProfile\(/);
  assert.match(pageSource, /getCodeWorkspaceProjectProfile\(/);
  assert.match(pageSource, /bootstrapCodeWorkspaceProjectProfile\(/);
  assert.match(pageSource, /CODE_WORKSPACE_GROUPS_UPDATED_EVENT/);
  assert.match(pageSource, /CODE_WORKSPACE_PROFILE_UPDATED_EVENT/);
  assert.match(pageSource, /getCodeWorkspaceGroupById\(/);
  assert.match(pageSource, /window\.addEventListener\(CODE_WORKSPACE_GROUPS_UPDATED_EVENT, onWorkspaceGroupsUpdated as EventListener\);/);
  assert.match(pageSource, /handleRegenerateProjectProfile/);
  assert.match(pageSource, /label=\{regeneratingProfile \? "重建中\.\.\." : "重新生成"\}/);
  assert.match(pageSource, /bootstrapCodeWorkspaceProjectProfile\(workspaceId, \{\s*force: true,/s);
  assert.doesNotMatch(pageSource, /desk-settings-meta/);
  assert.doesNotMatch(pageSource, /<DeskSettingsRow title="依赖规范">/);
  assert.match(pageSource, /className="desk-project-settings-form"/);
  assert.match(pageSource, /useDesktopHeaderSlot\(/);
  assert.match(pageSource, /createPortal\(projectHeaderNode, headerSlotElement\)/);
  assert.match(pageSource, /className="desk-project-settings-header-title"/);
  assert.match(pageSource, /addText="新增规范"/);
  assert.doesNotMatch(pageSource, /label="保存"/);
  assert.doesNotMatch(pageSource, /label="返回项目"/);
  assert.doesNotMatch(pageSource, /维护项目名称与依赖限制规则。/);
  assert.doesNotMatch(pageSource, /侧边栏一级目录中展示的项目名称。/);
  assert.doesNotMatch(pageSource, /每项建议使用“包名@版本”格式，例如 react@19\.1\.0。/);
  assert.match(settingsPrimitivesSource, /<AriTypography variant="h4" bold value=\{title\} \/>\s*\{description \?/s);
  assert.match(settingsPrimitivesSource, /export function DeskSectionTitle\(\{ title \}: DeskSectionTitleProps\) \{\s*return <AriTypography className="desk-settings-title" variant="h4" bold value=\{title\} \/>;\s*\}/s);

  // 描述:
  //
  //   - 数据层应持久化 dependencyRules 与项目结构化信息，并提供统一更新接口。
  assert.match(dataSource, /dependencyRules: string\[];/);
  assert.match(dataSource, /export interface CodeWorkspaceProjectProfile/);
  assert.match(dataSource, /workspacePathHash: string;/);
  assert.match(dataSource, /workspaceSignature: string;/);
  assert.match(dataSource, /knowledgeSections: CodeWorkspaceProjectKnowledgeSection\[];/);
  assert.match(dataSource, /apiDataModel: CodeWorkspaceProjectApiDataModel;/);
  assert.match(dataSource, /frontendPageLayout: CodeWorkspaceProjectFrontendPageLayout;/);
  assert.match(dataSource, /frontendCodeStructure: CodeWorkspaceProjectFrontendCodeStructure;/);
  assert.match(dataSource, /export const CODE_WORKSPACE_PROFILE_UPDATED_EVENT = "libra:code-workspace-profile-updated";/);
  assert.match(dataSource, /export function saveCodeWorkspaceProjectProfile\(/);
  assert.match(dataSource, /export function upsertCodeWorkspaceProjectProfile\(/);
  assert.match(dataSource, /export function patchCodeWorkspaceProjectProfile\(/);
  assert.match(dataSource, /export function bootstrapCodeWorkspaceProjectProfile\(/);
  assert.match(dataSource, /function buildWorkspacePathHash\(workspacePath: string\): string/);
  assert.match(dataSource, /function buildWorkspaceProfileSignature\(workspace: CodeWorkspaceGroup, schemaVersion: number\): string/);
  assert.match(dataSource, /emitCodeWorkspaceProfileUpdated\(/);
  assert.match(dataSource, /function normalizeWorkspaceDependencyRules\(rules: unknown\): string\[]/);
  assert.match(dataSource, /export function updateCodeWorkspaceGroupSettings\(/);
});
