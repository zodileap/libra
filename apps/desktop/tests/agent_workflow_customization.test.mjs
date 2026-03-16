import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 客户端源码文件，用于工作流能力回归测试。
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

// 描述：
//
//   - 递归收集目标目录中的 TSX 文件路径，用于批量约束前端布局实现。
//
// Params:
//
//   - relativeDirPath: 基于 apps/desktop 的相对目录。
//
// Returns:
//
//   - TSX 文件路径列表（相对 apps/desktop）。
function listDesktopTsxFiles(relativeDirPath) {
  const absoluteDirPath = path.resolve(process.cwd(), relativeDirPath);
  const files = [];

  const walk = (currentDirPath) => {
    const entries = fs.readdirSync(currentDirPath, { withFileTypes: true });
    entries.forEach((entry) => {
      const absolutePath = path.join(currentDirPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        return;
      }
      if (entry.isFile() && absolutePath.endsWith(".tsx")) {
        files.push(path.relative(process.cwd(), absolutePath));
      }
    });
  };

  walk(absoluteDirPath);
  return files;
}

test("TestWorkflowStorageShouldSupportAgentWorkflowCrud", () => {
  const source = readDesktopSource("src/shared/workflow/storage.ts");

  // 描述：
  //
  //   - 工作流存储层应支持统一智能体工作流列表、创建、保存、删除和 Prompt 拼接。
  assert.match(source, /listAgentWorkflows/);
  assert.match(source, /listAgentWorkflowOverview/);
  assert.match(source, /createAgentWorkflow\(\)/);
  assert.match(source, /createAgentWorkflowFromTemplate/);
  assert.match(source, /resolveNextWorkflowCopyName/);
  assert.match(source, /mode\?: "copy" \| "register"/);
  assert.match(source, /creationMode === "register"/);
  assert.match(source, /translateDesktopText\("\{\{name\}\} \(\{\{index\}\}\)"/);
  assert.doesNotMatch(source, /translateDesktopText\("\{\{name\}\} - 副本"/);
  assert.match(source, /saveAgentWorkflow/);
  assert.match(source, /deleteAgentWorkflow/);
  assert.match(source, /isReadonlyAgentWorkflow/);
  assert.match(source, /getAgentWorkflowById/);
  assert.match(source, /buildAgentWorkflowPrompt/);
  assert.match(source, /window\.dispatchEvent\(new CustomEvent\(AGENT_WORKFLOWS_UPDATED_EVENT/);
});

test("TestWorkflowStorageShouldNormalizeDefaultAgentWorkflowGraph", () => {
  const source = readDesktopSource("src/shared/workflow/storage.ts");

  // 描述：
  //
  //   - 默认智能体工作流模板在列表构建阶段必须归一化图结构，并在模板已注册后从“未注册”区隐藏。
  assert.match(source, /const registered = readSavedAgentWorkflows\(\)\s*\.filter/);
  assert.match(source, /const registeredTemplateIdSet = new Set/);
  assert.match(source, /window\.localStorage\.getItem\(STORAGE_KEYS\.AGENT_WORKFLOWS\)/);
  assert.match(source, /function normalizeAgentWorkflowId\(/);
  assert.match(source, /const templates = resolveDefaultAgentWorkflows\(\)/);
  assert.match(source, /normalizeAgentWorkflow\(\{ \.\.\.item, source: "builtin" \}\)/);
  assert.match(source, /\.filter\(\(item\) => !registeredTemplateIdSet\.has\(item\.id\)\)/);
});

test("TestRouterShouldExposeAgentSettingsRoute", () => {
  const source = readDesktopSource("src/router/index.tsx");

  // 描述：
  //
  //   - 路由层应提供统一智能体设置页入口，不再保留历史双入口页面路由。
  assert.match(source, /AgentSettingsPageLazy/);
  assert.match(source, /path="settings\/agent"/);
  assert.match(source, /path="home"/);
  assert.match(source, /CommonWorkflowsPageLazy/);
  assert.match(source, /CommonWorkflowEditorPageLazy/);
  assert.match(source, /WORKFLOW_PAGE_PATH/);
  assert.match(source, /WORKFLOW_EDITOR_PAGE_PATH/);
  assert.match(source, /path=\{WORKFLOW_PAGE_PATH\.slice\(1\)\}/);
  assert.match(source, /path=\{WORKFLOW_EDITOR_PAGE_PATH\.slice\(1\)\}/);
  assert.doesNotMatch(source, /LegacyWorkflowRedirect/);
});

test("TestAgentSidebarShouldExposeUnifiedQuickActions", () => {
  const codeRoutesSource = readDesktopSource("src/modules/agent/routes.tsx");
  const routerSource = readDesktopSource("src/router/index.tsx");

  // 描述：
  //
  //   - 单智能体模式下，快捷入口仅由统一路由模块声明。
  assert.match(codeRoutesSource, /export const AGENT_SIDEBAR_QUICK_ACTIONS/);
  assert.match(codeRoutesSource, /label: translateDesktopText\("智能体设置"\)/);
  assert.match(codeRoutesSource, /label: translateDesktopText\("工作流设置"\)/);
  assert.match(codeRoutesSource, /path: AGENT_SETTINGS_PATH/);
  assert.match(codeRoutesSource, /path: AGENT_WORKFLOW_PATH/);
  assert.match(routerSource, /path="settings\/agent"/);
  assert.match(routerSource, /path=\{WORKFLOW_PAGE_PATH\.slice\(1\)\}/);
});

test("TestSessionPageShouldUseUnifiedWorkflowSelection", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 单智能体模式下，会话页统一维护执行选择，并在工作流/技能切换时单次写回请求状态。
  assert.match(source, /workflowMenuItems/);
  assert.match(source, /setSelectedWorkflowId/);
  assert.match(source, /const activeWorkflowId = activeWorkflow\?\.id \|\| "";/);
  assert.match(source, /setExecutionSelection\(buildSkillExecutionSelection\(nextSkillIds\)\);/);
  assert.match(source, /const workflowPrompt = buildAgentWorkflowPrompt\(\s*scopedWorkflow,/s);
});

test("TestAgentHomeShouldOnlyManageWorkspaceBindingAndSessionShouldProvideQuickStartCards", () => {
  const agentHomeSource = readDesktopSource("src/modules/agent/pages/agent-home-page.tsx");
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 智能体首页应收口为“新项目”来源选择页：主区不再展示已关联项目列表或首页输入框，创建完成后直接进入新会话。
  assert.match(agentHomeSource, /useDesktopHeaderSlot\(\)/);
  assert.match(agentHomeSource, /title=\{t\("新项目"\)\}/);
  assert.match(agentHomeSource, /description=\{t\("本地优先，支持现有仓库与任意本地工作目录。"\)\}/);
  assert.match(agentHomeSource, /className="desk-content desk-agent-home-content"/);
  assert.doesNotMatch(agentHomeSource, /className="desk-agent-home-heading"/);
  assert.match(agentHomeSource, /className="desk-agent-home-source-list"/);
  assert.match(agentHomeSource, /className="desk-agent-home-source-card"/);
  assert.doesNotMatch(agentHomeSource, /className="desk-agent-home-source-kicker"/);
  assert.doesNotMatch(agentHomeSource, /className="desk-agent-home-source-helper"/);
  assert.doesNotMatch(agentHomeSource, /补齐结构化信息/);
  assert.match(agentHomeSource, /createRuntimeSession\(currentUser\.id, "agent"\)/);
  assert.match(agentHomeSource, /bindProjectSessionWorkspace\(session\.id, workspace\.id\);/);
  assert.match(agentHomeSource, /navigate\(`\$\{resolveAgentSessionPath\(session\.id\)\}\?workspaceId=\$\{encodeURIComponent\(workspace\.id\)\}`/);
  assert.match(agentHomeSource, /state:\s*\{\s*workspaceId: workspace\.id,\s*\}/s);
  assert.doesNotMatch(agentHomeSource, /<DeskSectionTitle title=\{t\("已关联项目"\)\} \/>/);
  assert.doesNotMatch(agentHomeSource, /label=\{t\("项目信息"\)\}/);
  assert.doesNotMatch(agentHomeSource, /AriInput\.TextArea/);

  // 描述：
  //
  //   - 新会话页空状态应承载快速开始卡片，并在点击后只写入预设与默认策略。
  assert.match(sessionSource, /const sessionQuickStartPresets = useMemo<SessionQuickStartPreset/);
  assert.match(sessionSource, /handleApplyQuickStartPreset/);
  assert.match(sessionSource, /handleQuickStartPresetCardKeyDown/);
  assert.match(sessionSource, /title: t\("前端项目开发"\)/);
  assert.match(sessionSource, /className="desk-session-quick-start-heading"/);
  assert.match(sessionSource, /<AriTypography variant="h4" bold value=\{t\("快速开始"\)\} \/>/);
  assert.match(sessionSource, /className="desk-session-quick-start-grid"/);
  assert.match(sessionSource, /role="button"/);
  assert.match(sessionSource, /tabIndex=\{0\}/);
  assert.match(sessionSource, /onClick=\{\(\) => \{\s*handleApplyQuickStartPreset\(preset\);/s);
  assert.match(sessionSource, /const \[availableSkillsLoaded, setAvailableSkillsLoaded\] = useState\(false\);/);
  assert.match(sessionSource, /const registeredWorkflowIdSet = useMemo\(\s*\(\) => new Set\(workflows\.map\(\(item\) => item\.id\)\),\s*\[workflows\],\s*\)/s);
  assert.match(sessionSource, /const registeredSkillIdSet = useMemo\(\s*\(\) => new Set\(availableSkills\.map\(\(item\) => item\.id\)\),\s*\[availableSkills\],\s*\)/s);
  assert.match(sessionSource, /const message = t\("技能列表加载中\.\.\."\);[\s\S]*AriMessage\.warning\(\{\s*content: message,\s*duration: 1800,\s*\}\);[\s\S]*setStatus\(message\);[\s\S]*return;/s);
  assert.match(sessionSource, /const message = t\("当前未注册“\{\{title\}\}”所需技能，请先注册后再试。", \{ title: preset\.title \}\);[\s\S]*AriMessage\.warning\(\{\s*content: message,\s*duration: 2200,\s*\}\);[\s\S]*setStatus\(message\);[\s\S]*return;/s);
  assert.match(sessionSource, /const message = t\("当前未注册“\{\{title\}\}”所需工作流，请先注册后再试。", \{ title: preset\.title \}\);[\s\S]*AriMessage\.warning\(\{\s*content: message,\s*duration: 2200,\s*\}\);[\s\S]*setStatus\(message\);[\s\S]*return;/s);
  assert.match(sessionSource, /setInput\(preset\.prompt\);/);
  assert.match(sessionSource, /setExecutionSelection\(buildSkillExecutionSelection\(nextSkillIds\)\);/);
  assert.match(sessionSource, /setExecutionSelection\(buildWorkflowExecutionSelection\(nextWorkflowId\)\);/);
  assert.doesNotMatch(sessionSource, /className="desk-session-quick-start-icon"/);
  assert.doesNotMatch(sessionSource, /label=\{t\("使用预设"\)\}/);
  assert.doesNotMatch(sessionSource, /title: t\("写代码"\)/);
  assert.doesNotMatch(sessionSource, /快速开始会帮你切换默认工作流或技能，并填入一段可继续编辑的对话草稿。/);
});

test("TestAgentHomeShouldRenderProjectBindingCardsOnly", () => {
  const source = readDesktopSource("src/modules/agent/pages/agent-home-page.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 新项目页应渲染居中的本地目录卡片，不再保留单独的标题说明、Git 接入或旧的项目列表分区。
  assert.match(source, /className=\"desk-agent-home-shell\"/);
  assert.match(source, /className=\"desk-content desk-agent-home-content\"/);
  assert.doesNotMatch(source, /className=\"desk-agent-home-heading\"/);
  assert.doesNotMatch(source, /选择一个本地文件夹，创建完成后会直接进入新话题。/);
  assert.match(source, /className=\"desk-agent-home-source-list\"/);
  assert.match(source, /className=\"desk-agent-home-source-card\"/);
  assert.match(source, /className=\"desk-agent-home-feature-list\"/);
  assert.match(source, /className=\"desk-agent-home-feature-item\"/);
  assert.doesNotMatch(source, /补齐结构化信息/);
  assert.doesNotMatch(source, /className=\"desk-agent-home-source-kicker\"/);
  assert.doesNotMatch(source, /className=\"desk-agent-home-source-helper\"/);
  assert.match(source, /className=\"desk-agent-home-source-action-row\"/);
  assert.match(source, /className=\"desk-agent-home-source-button\"/);
  assert.match(source, /className=\"desk-agent-home-source-button\"[\s\S]*useColorText=\{false\}/);
  assert.match(source, /value=\{t\("选择当前机器上的目录后，会直接进入新的项目会话。"\)\}/);
  assert.match(source, /label=\{folderPickLoading \? t\("打开中\.\.\."\) : sessionCreating \? t\("开启中\.\.\."\) : t\("选择本地文件夹"\)\}/);
  assert.match(source, /invoke<string \| null>\(\"pick_local_project_folder\"\)/);
  assert.match(source, /invoke<ProjectWorkspaceProfileSeedResponse>\(\s*COMMANDS\.INSPECT_PROJECT_WORKSPACE_PROFILE_SEED,/s);
  assert.match(source, /saveProjectWorkspaceProfile\(/);
  assert.match(source, /updatedBy: "workspace_seed_bootstrap"/);
  assert.match(source, /reason: "workspace_seed_bootstrap"/);
  assert.match(source, /if \(profileBefore\?\.revision && profileBefore\.revision > 1\) \{/);
  assert.doesNotMatch(source, /setStatus\(t\("已取消目录选择。"\)\);/);
  assert.match(source, /const created = handleCreateWorkspaceGroup\(selectedPath\);/);
  assert.match(source, /await handleOpenFreshSession\(created\);/);
  assert.doesNotMatch(source, /handleSelectWorkspaceGroup/);
  assert.doesNotMatch(source, /setSearchParams/);
  assert.doesNotMatch(source, /AriInput/);
  assert.doesNotMatch(source, /setLocalFolderPath/);
  assert.doesNotMatch(source, /handleOpenLocalFolderProject/);
  assert.doesNotMatch(source, /Git 仓库/);
  assert.doesNotMatch(source, /check_git_cli_health/);
  assert.doesNotMatch(source, /clone_git_repository/);
  assert.match(styleSource, /\.desk-agent-home-content\s*\{[\s\S]*display: flex;[\s\S]*align-items: center;[\s\S]*justify-content: flex-start;[\s\S]*\}/);
  assert.match(styleSource, /\.desk-agent-home-shell/);
  assert.doesNotMatch(styleSource, /\.desk-agent-home-heading/);
  assert.match(styleSource, /\.desk-agent-home-source-list/);
  assert.match(styleSource, /\.desk-agent-home-source-card/);
  assert.doesNotMatch(styleSource, /\.desk-agent-home-source-card \{[^}]*background:/);
  assert.doesNotMatch(styleSource, /\.desk-agent-home-source-card \{[^}]*display: grid;/);
  assert.match(styleSource, /\.desk-agent-home-feature-list \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*gap: var\(--z-inset-sm\);/s);
  assert.match(styleSource, /\.desk-agent-home-source-button/);
});

test("TestSessionPageShouldDispatchRouteAutoPromptOnce", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 会话页应消费路由中的 autoPrompt，仅自动发送一次并清理 state，避免重复触发。
  assert.match(source, /const routeAutoPrompt = String\(routeState\.autoPrompt \|\| ""\)\.trim\(\);/);
  assert.match(source, /const autoPromptDispatchedRef = useRef\(false\);/);
  assert.match(source, /void executePrompt\(routeAutoPrompt, \{ allowDangerousAction: false, appendUserMessage: true \}\);/);
  assert.match(source, /navigate\(`\$\{location\.pathname\}\$\{location\.search\}`,\s*\{ replace: true, state: \{\} \}\);/);
});

test("TestAgentSettingsPageShouldSeparateWorkflowManagement", () => {
  const source = readDesktopSource("src/modules/agent/pages/agent-settings-page.tsx");

  // 描述：
  //
  //   - 统一智能体设置页应保留执行偏好、工作流入口与全局会话沙盒维护，不再承载工作流 CRUD。
  assert.match(source, /title=\{t\("智能体设置"\)\}/);
  assert.match(source, /label=\{t\("进入工作流设置"\)\}/);
  assert.match(source, /label=\{t\("打开工作流设置"\)\}/);
  assert.match(source, /navigate\("\/workflows"\)/);
  assert.match(source, /title=\{t\("执行偏好"\)\}/);
  assert.match(source, /title=\{t\("会话沙盒"\)\}/);
  assert.match(source, /title=\{t\("目标会话"\)\}/);
  assert.match(source, /placeholder=\{t\("请选择会话"\)\}/);
  assert.match(source, /await invoke\(COMMANDS\.RESET_AGENT_SANDBOX, \{ sessionId: normalizedSessionId \}\);/);
  assert.match(source, /title=\{t\("重置选中会话沙盒"\)\}/);
  assert.match(source, /label=\{t\("重置沙盒"\)\}/);
  assert.match(source, /getAgentSessions\("agent"\)/);
  assert.match(source, /AriSwitch/);
  assert.doesNotMatch(source, /createAgentWorkflowFromTemplate/);
  assert.doesNotMatch(source, /deleteAgentWorkflow/);
  assert.doesNotMatch(source, /label="新增工作流"/);
});

test("TestAgentPageIntegrationShouldBeRemovedAfterSingleAgentMerge", () => {
  const routerSource = readDesktopSource("src/router/index.tsx");
  const agentModuleDir = path.resolve(process.cwd(), "src/modules/agent");

  // 描述：
  //
  //   - 单智能体收口后，仅保留统一模块目录与统一设置入口。
  assert.equal(fs.existsSync(agentModuleDir), true);
  assert.match(routerSource, /AgentSettingsPageLazy/);
  assert.match(routerSource, /ProjectSettingsPageLazy/);
});

test("TestWorkflowCanvasPageShouldUseReactFlowAndSingleNodeEditing", () => {
  const source = readDesktopSource("src/widgets/workflow/page.tsx");

  // 描述：
  //
  //   - 画布页应基于 React Flow，采用单节点模型并支持“空白=工作流属性、节点=节点属性”切换。
  assert.match(source, /@xyflow\/react/);
  assert.match(source, /<ReactFlow/);
  assert.match(source, /onConnect=\{onConnect\}/);
  assert.match(source, /type: "node"/);
  assert.match(source, /deleteSelectedNode/);
  assert.match(source, /patchSelectedNode/);
  assert.match(source, /const workflowReadonly = isReadonlyAgentWorkflow\(selectedWorkflow\);/);
  assert.match(source, /const canEditWorkflow = Boolean\(selectedWorkflow\) && !workflowReadonly;/);
  assert.match(source, /\{selectedNodeData \? \(/);
  assert.match(source, /className="desk-workflow-editor-floating-panel"/);
  assert.match(source, /onPaneClick=\{\(\) => \{/);
});

test("TestWorkflowCanvasPageShouldFallbackToHashQueryWorkflowId", () => {
  const source = readDesktopSource("src/widgets/workflow/page.tsx");

  // 描述：
  //
  //   - 工作流编辑页在 HashRouter 下应优先读取 searchParams，并在 search 丢失时从原始 hash 查询串兜底提取 workflowId。
  assert.match(source, /function resolveWorkflowIdFromHashLocation\(\): string/);
  assert.match(source, /const rawHash = String\(window\.location\.hash \|\| ""\);/);
  assert.match(source, /new URLSearchParams\(rawHash\.slice\(queryIndex \+ 1\)\)\.get\("workflowId"\)\?\.trim\(\) \|\| ""/);
  assert.match(source, /const preferredWorkflowId = useMemo\(\(\) => \{/);
  assert.match(source, /const workflowIdFromSearch = searchParams\.get\("workflowId"\)\?\.trim\(\) \|\| "";/);
  assert.match(source, /return resolveWorkflowIdFromHashLocation\(\);/);
});

test("TestWorkflowPagesShouldUseListLayoutInSettings", () => {
  const codeSource = readDesktopSource("src/modules/agent/pages/agent-settings-page.tsx");
  const overviewSource = readDesktopSource("src/modules/common/pages/workflows-page.tsx");
  const canvasSource = readDesktopSource("src/widgets/workflow/page.tsx");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const primitivesSource = readDesktopSource("src/widgets/settings-primitives.tsx");
  const styleSource = readDesktopSource("src/styles.css");
  const workflowHeaderMatches = overviewSource.match(/<DeskPageHeader/g) || [];

  // 描述：
  //
  //   - 设置页应采用通用设置面板布局；工作流总览页承载“已注册 / 未注册”，画布页专注右侧画布与悬浮属性面板。
  //   - 工作流链路页面应优先使用 @aries-kit/react 布局组件，避免原生 div。
  assert.match(codeSource, /desk-settings-panel/);
  assert.doesNotMatch(codeSource, /desk-workflow-list-card/);
  assert.equal(workflowHeaderMatches.length, 1);
  assert.match(overviewSource, /DeskPageHeader/);
  assert.match(overviewSource, /DeskOverviewCard/);
  assert.match(overviewSource, /icon=\{<AriIcon name="account_tree" \/>\}/);
  assert.doesNotMatch(overviewSource, /DeskOverviewDetailsModal/);
  assert.doesNotMatch(overviewSource, /DeskOverviewDetailRow/);
  assert.match(overviewSource, /mode="slot"/);
  assert.match(overviewSource, /DeskSectionTitle title=\{t\("已注册"\)\}/);
  assert.match(overviewSource, /DeskSectionTitle title=\{t\("未注册"\)\}/);
  assert.match(overviewSource, /label=\{t\("新增工作流"\)\}/);
  assert.doesNotMatch(overviewSource, /label=\{t\("刷新"\)\}/);
  assert.match(overviewSource, /content=\{t\("管理"\)\}/);
  assert.match(overviewSource, /aria-label=\{t\("管理工作流"\)\}/);
  assert.match(overviewSource, /aria-label=\{readonly \? t\("添加工作流"\) : t\("复制工作流"\)\}/);
  assert.match(overviewSource, /<AriButton\s*type="text"\s*icon=\{readonly \? "add" : "content_copy"\}\s*aria-label=\{readonly \? t\("添加工作流"\) : t\("复制工作流"\)\}/s);
  assert.doesNotMatch(overviewSource, /<AriButton\s*type="text"\s*icon=\{readonly \? "add" : "content_copy"\}[\s\S]*color=\{readonly \? "brand" : "default"\}[\s\S]*aria-label=\{readonly \? t\("添加工作流"\) : t\("复制工作流"\)\}/s);
  assert.doesNotMatch(overviewSource, /aria-label=\{readonly \? t\("查看工作流"\) : t\("编辑工作流"\)\}/);
  assert.doesNotMatch(overviewSource, /aria-label=\{t\("删除工作流"\)\}/);
  assert.match(canvasSource, /desk-workflow-editor-main/);
  assert.doesNotMatch(canvasSource, /desk-workflow-editor-sidebar/);
  assert.match(canvasSource, /desk-workflow-editor-floating-panel/);
  assert.match(sidebarSource, /function WorkflowsSidebar/);
  assert.match(styleSource, /\.desk-workflow-grid \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*gap: calc\(var\(--z-inset\) \* 1\.125\);\s*align-items: start;/s);
  assert.match(styleSource, /\.desk-overview-card-title-bar/);
  assert.match(styleSource, /\.desk-overview-card-content \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*justify-content: flex-start;/);
  assert.match(styleSource, /\.desk-overview-card-description/);
  assert.match(styleSource, /\.desk-overview-card-actions/);
  assert.match(styleSource, /\.desk-overview-card-actions-inner/);
  assert.match(styleSource, /\.desk-overview-details-body/);
  assert.match(styleSource, /\.desk-overview-detail-row/);
  assert.match(styleSource, /\.desk-page-header-actions-inner/);
  assert.match(primitivesSource, /className="desk-overview-card-title-bar"[\s\S]*justify="space-between"/);
  assert.match(primitivesSource, /className="desk-overview-details-body"/);
  assert.match(primitivesSource, /className="desk-overview-detail-row"/);
  assert.match(primitivesSource, /description\?: string;/);
  assert.match(primitivesSource, /className="desk-overview-card-actions-inner"/);
  assert.match(primitivesSource, /className="desk-page-header-actions-inner"/);
  assert.match(primitivesSource, /function flattenFlexChildren\(content: ReactNode\): ReactNode\[]/);
  assert.match(primitivesSource, /Children\.toArray\(content\)\.flatMap/);
  assert.match(primitivesSource, /isValidElement\(child\) && child\.type === Fragment/);
  assert.match(primitivesSource, /Children\.toArray\(child\.props\.children\)/);
  assert.match(primitivesSource, /flattenFlexChildren\(actions\)/);
  assert.match(primitivesSource, /className="desk-overview-card-main"[\s\S]*align="center"/);
  assert.doesNotMatch(codeSource, /<div[\s>]/);
  assert.doesNotMatch(primitivesSource, /<div[\s>]/);
});

test("TestUnifiedAgentCommandsShouldBeCanonical", () => {
  const source = readDesktopSource("src-tauri/src/main.rs");
  const constantsSource = readDesktopSource("src/shared/constants.ts");

  // 描述：
  //
  //   - Tauri 与前端常量层应只暴露统一智能体执行命令，避免继续扩散历史双入口命名。
  assert.match(constantsSource, /RUN_AGENT_COMMAND: "run_agent_command"/);
  assert.match(constantsSource, /CANCEL_AGENT_SESSION: "cancel_agent_session"/);
  assert.match(constantsSource, /APPROVE_AGENT_ACTION: "approve_agent_action"/);
  assert.match(constantsSource, /RESET_AGENT_SANDBOX: "reset_agent_sandbox"/);
  assert.match(constantsSource, /GET_AGENT_SANDBOX_METRICS: "get_agent_sandbox_metrics"/);
  assert.match(source, /async fn run_agent_command\(/);
  assert.match(source, /fn run_agent_command_inner\(/);
  assert.match(source, /if let Some\(session\) = session_id\.as_deref\(\) \{\s*clear_agent_session_cancelled\(session\);\s*[\s\S]*?SANDBOX_REGISTRY\.reset\(session\);/s);
  assert.match(source, /if let Some\(session\) = session_id\.as_deref\(\) \{\s*\/\/ 描述：[\s\S]*?当前顶层请求结束后释放会话沙盒[\s\S]*?SANDBOX_REGISTRY\.reset\(session\);/s);
  assert.match(source, /fn cancel_agent_session\(app: tauri::AppHandle, session_id: String\)/);
  assert.match(source, /fn approve_agent_action\(/);
  assert.match(source, /fn reset_agent_sandbox\(/);
  assert.match(source, /fn get_agent_sandbox_metrics\(/);
});

test("TestWorkflowCanvasSidebarAndFloatingActionsShouldMatchUxRules", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const overviewSource = readDesktopSource("src/modules/common/pages/workflows-page.tsx");
  const canvasSource = readDesktopSource("src/widgets/workflow/page.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 工作流链路应拆成“总览页 + 编辑页”；总览页保留 Home 侧边栏，进入查看/编辑页后才切换到工作流侧边栏。
  assert.match(sidebarSource, /if \(pathname\.startsWith\(WORKFLOW_EDITOR_PAGE_PATH\)\) return "workflow";/);
  assert.doesNotMatch(sidebarSource, /if \(pathname\.includes\("\/workflows"\)\) return "workflow";/);
  assert.match(sidebarSource, /function WorkflowsSidebar/);
  assert.match(sidebarSource, /label=\{t\("返回"\)\}/);
  assert.match(sidebarSource, /label=\{t\("新增"\)\}/);
  assert.match(sidebarSource, /onBack=\{\(\) => navigate\(WORKFLOW_PAGE_PATH\)\}/);
  assert.match(sidebarSource, /const isWorkflowEditorPage = location\.pathname\.startsWith\(WORKFLOW_EDITOR_PAGE_PATH\);/);
  assert.match(sidebarSource, /listAgentWorkflowOverview\(\)/);
  assert.match(sidebarSource, /workflowOverview\.all/);
  assert.match(sidebarSource, /label: t\("已注册"\), isGroup: true/);
  assert.match(sidebarSource, /label: t\("未注册"\), isGroup: true/);
  assert.match(sidebarSource, /key: "workflow-group-registered-empty"/);
  assert.match(sidebarSource, /value=\{t\("暂无已注册工作流"\)\}/);
  assert.match(sidebarSource, /key: "workflow-group-templates-empty"/);
  assert.match(sidebarSource, /value=\{t\("暂无未注册工作流"\)\}/);
  assert.match(sidebarSource, /if \(pendingDeleteWorkflowId !== workflowId\) \{\s*setPendingDeleteWorkflowId\(workflowId\);\s*return;\s*\}/s);
  assert.match(sidebarSource, /label=\{pendingDeleteWorkflowId === item\.id \? t\("确定"\) : undefined\}/);
  assert.match(sidebarSource, /showActionsOnHover: pendingDeleteWorkflowId !== item\.id/);
  assert.match(sidebarSource, /window\.addEventListener\(AGENT_WORKFLOWS_UPDATED_EVENT, handleAgentWorkflowsUpdated as EventListener\)/);
  assert.match(sidebarSource, /key=\{`workflow-menu-\$\{workflowMenuRenderVersion\}`\}/);
  assert.doesNotMatch(sidebarSource, /setPendingDeleteWorkflowId\(\(current\) => \(current === item\.key \? "" : current\)\);/);
  assert.match(overviewSource, /aria-label=\{readonly \? t\("添加工作流"\) : t\("复制工作流"\)\}/);
  assert.match(overviewSource, /createAgentWorkflowFromTemplate\(workflow\.id, \{ mode: "register" \}\)/);
  assert.doesNotMatch(overviewSource, /const handleCopyWorkflow[\s\S]*navigate\(resolveWorkflowEditorPath\(copied\.id\)\)/s);
  assert.doesNotMatch(overviewSource, /const handleAddWorkflow[\s\S]*navigate\(resolveWorkflowEditorPath\(created\.id\)\)/s);
  assert.match(overviewSource, /window\.addEventListener\(AGENT_WORKFLOWS_UPDATED_EVENT, handleAgentWorkflowsUpdated as EventListener\)/);
  assert.match(canvasSource, /className="desk-workflow-editor-floating-panel"/);
  assert.doesNotMatch(canvasSource, /desk-workflow-editor-sidebar/);
  assert.match(styleSource, /--desk-workflow-node-surface:/);
  assert.match(styleSource, /--desk-workflow-node-head-surface:/);
  assert.match(styleSource, /--desk-workflow-node-content-surface:/);
  assert.match(styleSource, /--desk-workflow-node-accent:/);
  assert.match(styleSource, /\.desk-sidebar-group-empty-label \{/);
  assert.doesNotMatch(styleSource, /\.desk-workflow-reactflow[\s\S]*background:\s*var\(--z-ramp-white-1000\);/s);
});

test("TestClientTsxLayoutShouldAvoidNativeDivElements", () => {
  const tsxFiles = [
    "src/widgets/agent/page.tsx",
    "src/widgets/session/page.tsx",
    "src/sidebar/index.tsx",
    "src/widgets/settings-primitives.tsx",
  ];

  // 描述：
  //
  //   - 客户端 TSX 布局应优先使用 @aries-kit/react 布局组件，避免原生 div 回归。
  tsxFiles.forEach((relativePath) => {
    const source = readDesktopSource(relativePath);
    assert.doesNotMatch(source, /<div[\s>]/, `发现原生 div：${relativePath}`);
  });
});
