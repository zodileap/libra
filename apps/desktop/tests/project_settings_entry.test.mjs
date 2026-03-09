import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，校验项目设置页入口与数据能力。
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

test("TestProjectSettingsShouldExposeRouteAndSidebarEntry", () => {
  const routesSource = readDesktopSource("src/modules/agent/routes.tsx");
  const routerSource = readDesktopSource("src/router/index.tsx");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");

  // 描述:
  //
  //   - 统一智能体应暴露项目设置路径和懒加载入口，并在桌面总路由中注册页面。
  assert.match(routesSource, /export const PROJECT_SETTINGS_PATH = "\/project-settings" as const;/);
  assert.match(routesSource, /export const ProjectSettingsPageLazy = lazy/);
  assert.match(routerSource, /path="project-settings"/);
  assert.match(routerSource, /<ProjectSettingsPageLazy \/>/);

  // 描述:
  //
  //   - 项目目录一级菜单 hover 操作应包含“更多/设置/新话题”入口，并将“编辑”从更多菜单迁移为独立设置按钮。
  assert.match(sidebarSource, /icon="more_horiz"/);
  assert.match(sidebarSource, /icon="settings"/);
  assert.match(sidebarSource, /aria-label=\{t\("项目设置"\)\}/);
  assert.match(sidebarSource, /icon="edit"/);
  assert.match(sidebarSource, /\{ key: "delete", label: t\("删除"\), icon: "delete", fillIcon: "delete_fill" \}/);
  assert.doesNotMatch(sidebarSource, /\{ key: "edit", label: "编辑", icon: "edit" \}/);
  assert.match(sidebarSource, /aria-label=\{t\("在项目内新增话题"\)\}/);
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
  assert.match(sidebarSource, /navigate\(`\$\{PROJECT_SETTINGS_PATH\}\?workspaceId=\$\{encodeURIComponent\(workspaceId\)\}`\)/);
  assert.match(sidebarSource, /const isProjectSettingsPath = isProjectAgent && location\.pathname\.startsWith\(PROJECT_SETTINGS_PATH\);/);
  assert.match(sidebarSource, /if \(isProjectSettingsPath\) \{\s*return "";\s*\}/);
  assert.doesNotMatch(sidebarSource, /return buildWorkspaceMenuKey\(selectedWorkspaceFromQuery\);/);
  assert.match(sidebarSource, /setProjectWorkspaceExpandedKeys\(\(current\) => \{\s*const next = new Set\(\[\.\.\.current, workspaceMenuKey\]\);/s);
  assert.match(sidebarSource, /label: item\.title,/);
  assert.doesNotMatch(sidebarSource, /label: <AriTypography className="desk-session-item-title"/);
  assert.doesNotMatch(sidebarSource, /handleOpenWorkspaceRenameModal/);
  assert.doesNotMatch(sidebarSource, /workspaceRenameModalVisible/);
  assert.match(sidebarSource, /const handleSelectProjectWorkspaceMenuItem = \(key: string\) => \{\s*const workspaceId = parseWorkspaceIdFromMenuKey\(key\);\s*if \(workspaceId\) \{\s*openWorkspaceSettingsPage\(workspaceId\);\s*return;\s*\}\s*handleSelectSession\(key\);\s*\};/s);
  assert.doesNotMatch(sidebarSource, /openWorkspaceComposePage\(workspaceId\)/);

  // 描述:
  //
  //   - Main 区应提供“项目信息”入口，允许不经侧边栏更多菜单直接进入项目设置。
  const agentHomeSource = readDesktopSource("src/modules/agent/pages/agent-home-page.tsx");
  assert.match(agentHomeSource, /label=\{t\("项目信息"\)\}/);
  assert.match(agentHomeSource, /icon="settings"/);
  assert.match(agentHomeSource, /handleOpenProjectSettingsPage/);
  assert.match(agentHomeSource, /navigate\(`\$\{PROJECT_SETTINGS_PATH\}\?workspaceId=\$\{encodeURIComponent\(selectedWorkspace\.id\)\}`\)/);
});

test("TestProjectSettingsPageShouldSupportProjectCapabilities", () => {
  const pageSource = readDesktopSource("src/modules/agent/pages/project-settings-page.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");
  const settingsPrimitivesSource = readDesktopSource("src/widgets/settings-primitives.tsx");

  // 描述:
  //
  //   - 项目设置页应通过“项目能力”动态启用依赖策略、工具接入与项目知识，不再固定展示三块配置。
  assert.match(pageSource, /<DeskSectionTitle title=\{t\("基础信息"\)\} \/>/);
  assert.match(pageSource, /<DeskSettingsRow title=\{t\("项目名称"\)\}>/);
  assert.match(pageSource, /const \[enabledCapabilities, setEnabledCapabilities\] = useState<ProjectWorkspaceCapabilityId\[\]>\(\[\]\);/);
  assert.match(pageSource, /const \[capabilityModalVisible, setCapabilityModalVisible\] = useState\(false\);/);
  assert.match(pageSource, /listProjectWorkspaceCapabilityManifests\(\)/);
  assert.match(pageSource, /enabledCapabilityManifests/);
  assert.match(pageSource, /disabledCapabilityManifests/);
  assert.match(pageSource, /projectKnowledgeEnabled/);
  assert.match(pageSource, /dependencyPolicyEnabled/);
  assert.match(pageSource, /toolchainIntegrationEnabled/);
  assert.match(pageSource, /handleEnableCapability/);
  assert.match(pageSource, /handleDisableCapability/);
  assert.match(pageSource, /handleOpenCapabilityModal/);
  assert.match(pageSource, /handleCloseCapabilityModal/);
  assert.match(pageSource, /<AriFlex align="center" justify="space-between" space=\{12\} padding=\{0\}>/);
  assert.match(pageSource, /<DeskSectionTitle title=\{t\("项目能力"\)\} \/>/);
  assert.match(pageSource, /label=\{t\("添加项目能力"\)\}/);
  assert.match(pageSource, /<AriModal\s+visible=\{capabilityModalVisible\}/s);
  assert.match(pageSource, /title=\{t\("添加项目能力"\)\}/);
  assert.match(pageSource, /label=\{t\("启用"\)\}/);
  assert.match(pageSource, /t\("当前项目尚未启用项目能力。"\)/);
  assert.match(pageSource, /t\("当前没有可添加的项目能力。"\)/);
  assert.match(pageSource, /<DeskSectionTitle title=\{t\("依赖策略"\)\} \/>/);
  assert.match(pageSource, /<DeskSectionTitle title=\{t\("工具接入"\)\} \/>/);
  assert.match(pageSource, /<DeskSectionTitle title=\{t\("项目知识"\)\} \/>/);
  assert.doesNotMatch(pageSource, /<DeskSectionTitle title="依赖规范" \/>/);
  assert.doesNotMatch(pageSource, /<DeskSectionTitle title="DCC \/ MCP" \/>/);
  assert.doesNotMatch(pageSource, /<DeskSectionTitle title="结构化项目信息" \/>/);
  assert.doesNotMatch(pageSource, /title=\{t\("已启用能力"\)\}/);
  assert.doesNotMatch(pageSource, /title=\{t\("添加能力"\)\}/);
  assert.match(pageSource, /const \[projectProfileEditMode, setProjectProfileEditMode\] = useState<"form" \| "json">\("form"\);/);
  assert.match(pageSource, /const \[projectMcpOverview, setProjectMcpOverview\] = useState<McpOverview>\(createEmptyMcpOverview\);/);
  assert.match(pageSource, /const \[projectDccRuntimeStatusMap, setProjectDccRuntimeStatusMap\] = useState<Record<string, DccRuntimeStatus>>\(\{\}\);/);
  assert.match(pageSource, /listMcpOverview\(\{ workspaceRoot: workspace\.path \}\)/);
  assert.match(pageSource, /checkDccRuntimeStatus\(software\)/);
  assert.match(pageSource, /buildDccRuntimeRequirementSummary/);
  assert.match(pageSource, /buildDccRuntimeFallbackStatus/);
  assert.match(pageSource, /collectProjectDccSoftware/);
  assert.match(pageSource, /label=\{t\("分区表单"\)\}/);
  assert.match(pageSource, /label=\{t\("JSON 高级"\)\}/);
  assert.match(pageSource, /title=\{t\("JSON（高级）"\)\}/);
  assert.match(pageSource, /handleApplyProjectProfileJson/);
  assert.match(pageSource, /parseProjectProfileDraftFromJson\(/);
  assert.match(pageSource, /setProjectProfileJsonStatus\(t\("JSON 已应用，结构化信息将自动保存。"\)\);/);
  assert.match(pageSource, /orderedKnowledgeSections\.map\(\(section\) =>/);
  assert.match(pageSource, /handleUpdateKnowledgeSectionFacet/);
  assert.match(pageSource, /buildFacetRowTitle\(section\.title, facet\.label\)/);
  assert.match(pageSource, /PROJECT_PROFILE_SECTION_KEYS/);
  assert.doesNotMatch(pageSource, /title="前端技术栈"/);
  assert.doesNotMatch(pageSource, /title="后端技术栈"/);
  assert.match(pageSource, /<AriInput\.TextList/);
  assert.match(pageSource, /<AriInput\.TextArea/);
  assert.match(pageSource, /updateProjectWorkspaceGroupSettings\(/);
  assert.match(pageSource, /saveProjectWorkspaceProfile\(/);
  assert.match(pageSource, /getProjectWorkspaceProfile\(/);
  assert.match(pageSource, /bootstrapProjectWorkspaceProfile\(/);
  assert.match(pageSource, /PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT/);
  assert.match(pageSource, /PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT/);
  assert.match(pageSource, /getProjectWorkspaceGroupById\(/);
  assert.match(pageSource, /window\.addEventListener\(PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT, onWorkspaceGroupsUpdated as EventListener\);/);
  assert.match(pageSource, /handleRegenerateProjectProfile/);
  assert.match(pageSource, /label=\{regeneratingProfile \? t\("重建中\.\.\."\) : t\("重新生成"\)\}/);
  assert.match(pageSource, /bootstrapProjectWorkspaceProfile\(workspaceId, \{\s*force: true,/s);
  assert.doesNotMatch(pageSource, /desk-settings-meta/);
  assert.doesNotMatch(pageSource, /<DeskSettingsRow title="依赖规范">/);
  assert.match(pageSource, /className="desk-project-settings-form"/);
  assert.match(pageSource, /useDesktopHeaderSlot\(/);
  assert.match(pageSource, /useNavigate\(/);
  assert.match(pageSource, /MCP_PAGE_PATH/);
  assert.match(pageSource, /createPortal\(projectHeaderNode, headerSlotElement\)/);
  assert.match(pageSource, /label=\{t\("项目 MCP"\)\}/);
  assert.match(pageSource, /icon="hub"/);
  assert.match(pageSource, /size="sm"/);
  assert.match(pageSource, /handleOpenWorkspaceMcpPage/);
  assert.match(pageSource, /navigate\(`\$\{MCP_PAGE_PATH\}\?workspaceId=\$\{encodeURIComponent\(workspaceId\)\}`\)/);
  assert.match(pageSource, /label=\{t\("打开项目 MCP"\)\}/);
  assert.match(pageSource, /title=\{t\("已启用建模软件"\)\}/);
  assert.match(pageSource, /title=\{t\("可接入软件"\)\}/);
  assert.match(pageSource, /title=\{t\("Runtime 要求"\)\}/);
  assert.match(pageSource, /title=\{t\("接入文档"\)\}/);
  assert.match(pageSource, /t\("workspace 级配置会覆盖同名 user 级 MCP。"\)/);
  assert.match(pageSource, /t\("当前项目尚未启用 DCC MCP。"\)/);
  assert.match(pageSource, /buildDccSoftwareLabel\(item\.software\)/);
  assert.match(pageSource, /<DeskStatusText value=\{projectMcpStatus\} \/>/);
  assert.match(pageSource, /className="desk-project-settings-header-title"/);
  assert.match(pageSource, /addText=\{t\("新增规范"\)\}/);
  assert.match(pageSource, /enabledCapabilities,/);
  assert.doesNotMatch(pageSource, /label="保存"/);
  assert.doesNotMatch(pageSource, /label="返回项目"/);
  assert.doesNotMatch(pageSource, /维护项目名称与依赖限制规则。/);
  assert.doesNotMatch(pageSource, /侧边栏一级目录中展示的项目名称。/);
  assert.doesNotMatch(pageSource, /每项建议使用“包名@版本”格式，例如 react@19\.1\.0。/);
  assert.match(
    settingsPrimitivesSource,
    /<AriTypography[\s\S]*className="desk-settings-title"[\s\S]*variant="h4"[\s\S]*bold[\s\S]*value=\{title\}[\s\S]*\/>/,
  );
  assert.match(
    settingsPrimitivesSource,
    /export function DeskSectionTitle\(\{ title \}: DeskSectionTitleProps\) \{[\s\S]*className="desk-settings-title"[\s\S]*variant="h4"[\s\S]*bold[\s\S]*value=\{title\}[\s\S]*\}/,
  );

  // 描述:
  //
  //   - 数据层应持久化项目能力、依赖策略与项目知识，并提供统一更新接口。
  assert.match(dataSource, /enabledCapabilities: ProjectWorkspaceCapabilityId\[];/);
  assert.match(dataSource, /export type ProjectWorkspaceCapabilityKind = "knowledge" \| "policy" \| "integration";/);
  assert.match(dataSource, /export type ProjectWorkspaceCapabilityId =/);
  assert.match(dataSource, /export interface ProjectWorkspaceCapabilityManifest/);
  assert.match(dataSource, /export interface WorkspaceCapabilityBinding/);
  assert.match(dataSource, /const PROJECT_WORKSPACE_CAPABILITY_MANIFESTS: ProjectWorkspaceCapabilityManifest\[] = \[/);
  assert.match(dataSource, /id: "project-knowledge"/);
  assert.match(dataSource, /id: "dependency-policy"/);
  assert.match(dataSource, /id: "toolchain-integration"/);
  assert.match(dataSource, /export function listProjectWorkspaceCapabilityManifests\(/);
  assert.match(dataSource, /export function getProjectWorkspaceCapabilityManifest\(/);
  assert.match(dataSource, /export function isProjectWorkspaceCapabilityEnabled\(/);
  assert.match(dataSource, /export function resolveWorkspaceCapabilityBindings\(/);
  assert.match(dataSource, /dependencyRules: string\[];/);
  assert.match(dataSource, /export interface ProjectWorkspaceProfile/);
  assert.match(dataSource, /workspacePathHash: string;/);
  assert.match(dataSource, /workspaceSignature: string;/);
  assert.match(dataSource, /knowledgeSections: ProjectWorkspaceKnowledgeSection\[];/);
  assert.match(dataSource, /apiDataModel: ProjectWorkspaceApiDataModel;/);
  assert.match(dataSource, /frontendPageLayout: ProjectWorkspaceFrontendPageLayout;/);
  assert.match(dataSource, /frontendCodeStructure: ProjectWorkspaceFrontendCodeStructure;/);
  assert.match(dataSource, /export const PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT = "libra:project-workspace-profile-updated";/);
  assert.match(dataSource, /export function saveProjectWorkspaceProfile\(/);
  assert.match(dataSource, /export function upsertProjectWorkspaceProfile\(/);
  assert.match(dataSource, /export function patchProjectWorkspaceProfile\(/);
  assert.match(dataSource, /export function bootstrapProjectWorkspaceProfile\(/);
  assert.match(dataSource, /function buildWorkspacePathHash\(workspacePath: string\): string/);
  assert.match(dataSource, /function buildWorkspaceProfileSignature\(workspace: ProjectWorkspaceGroup, schemaVersion: number\): string/);
  assert.match(dataSource, /emitProjectWorkspaceProfileUpdated\(/);
  assert.match(dataSource, /function normalizeWorkspaceDependencyRules\(rules: unknown\): string\[]/);
  assert.match(dataSource, /export function updateProjectWorkspaceGroupSettings\(/);
});
