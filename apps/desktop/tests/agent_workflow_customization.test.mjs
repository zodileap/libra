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
  assert.match(source, /saveAgentWorkflow/);
  assert.match(source, /deleteAgentWorkflow/);
  assert.match(source, /isReadonlyAgentWorkflow/);
  assert.match(source, /getAgentWorkflowById/);
  assert.match(source, /buildAgentWorkflowPrompt/);
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
  //   - 单智能体模式下，会话页只保留统一工作流选择，并统一应用到执行请求。
  assert.match(source, /workflowMenuItems/);
  assert.match(source, /setSelectedWorkflowId/);
  assert.match(source, /const activeWorkflowId = selectedWorkflow\?\.id \|\| "";/);
  assert.match(source, /setSelectedSkillIds\(nextSkillIds\);/);
  assert.match(source, /const workflowPrompt = buildAgentWorkflowPrompt\(\s*selectedWorkflow,/s);
});

test("TestAgentPageShouldUseUnifiedComposeLayoutAndAutoPromptNavigation", () => {
  const source = readDesktopSource("src/widgets/agent/page.tsx");
  const agentHomeSource = readDesktopSource("src/modules/agent/pages/agent-home-page.tsx");

  // 描述：
  //
  //   - 智能体首页应使用统一输入布局；入口页负责创建会话并通过统一会话路径下发首条消息。
  assert.match(source, /desk-session-shell/);
  assert.match(source, /desk-prompt-card desk-session-prompt-card/);
  assert.match(source, /onStartConversation\(\)/);
  assert.match(agentHomeSource, /navigate\(`\$\{resolveAgentSessionPath\(session\.id\)\}\$\{search\}`,/);
  assert.match(agentHomeSource, /autoPrompt:\s*usingQuickStartPreset \? "" : normalizedPrompt,/);
  assert.match(agentHomeSource, /if \(!selectedWorkspace\) \{/);
  assert.match(agentHomeSource, /bindProjectSessionWorkspace\(session\.id, selectedWorkspace\.id\);/);
  assert.match(agentHomeSource, /preferredWorkflowId: normalizedWorkflowId \|\| undefined/);
  assert.match(agentHomeSource, /preferredSkillIds: normalizedSkillIds\.length > 0 \? normalizedSkillIds : undefined/);
  assert.match(source, /icon=\{item\.icon\}/);
  assert.match(source, /label=\{item\.actionLabel\}/);
});

test("TestAgentShouldShowStandaloneWorkspaceOnboardingWhenNoWorkspace", () => {
  const source = readDesktopSource("src/modules/agent/pages/agent-home-page.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 单智能体在未选择目录时应渲染独立引导页（中间卡片），不展示常规标题/快捷卡片/对话框布局。
  assert.match(source, /const onboardingContent = !selectedWorkspace \? \(/);
  assert.match(source, /className=\"desk-project-workspace-onboarding\"/);
  assert.match(source, /className=\"desk-project-workspace-onboarding-card\"/);
  assert.match(source, /value=\{t\("选择项目"\)\}/);
  assert.match(source, /label=\{gitCloneLoading \? t\("开启中\.\.\."\) : t\("开启"\)\}/);
  assert.match(source, /invoke<string \| null>\(\"pick_local_project_folder\"\)/);
  assert.match(source, /invoke<GitCliHealthResponse>\(\"check_git_cli_health\"\)/);
  assert.match(source, /invoke<GitCloneResponse>\(\"clone_git_repository\"/);
  assert.match(source, /invoke<ProjectWorkspaceProfileSeedResponse>\(\s*COMMANDS\.INSPECT_PROJECT_WORKSPACE_PROFILE_SEED,/s);
  assert.match(source, /saveProjectWorkspaceProfile\(/);
  assert.match(source, /updatedBy: "workspace_seed_bootstrap"/);
  assert.match(source, /reason: "workspace_seed_bootstrap"/);
  assert.match(source, /if \(profileBefore\?\.revision && profileBefore\.revision > 1\) \{/);
  assert.match(source, /invoke\(\"open_external_url\", \{ url: \"https:\/\/git-scm\.com\/downloads\" \}\)/);
  assert.match(source, /title=\{t\("未检测到 Git"\)\}/);
  assert.match(source, /label=\{t\("确认并前往下载"\)\}/);
  assert.match(source, /<AriInput\s+variant=\"borderless\"/s);
  assert.match(source, /const forceWorkspacePickerMode = useMemo/);
  assert.match(source, /getLastUsedProjectWorkspaceId\(\)/);
  assert.match(source, /setSearchParams\(new URLSearchParams\(\{ mode: "projects" \}\), \{ replace: true \}\);/);
  assert.match(styleSource, /\.desk-project-workspace-onboarding/);
  assert.match(styleSource, /\.desk-project-workspace-onboarding-card/);
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
  //   - 统一智能体设置页应仅保留执行偏好与工作流入口，不再承载工作流 CRUD。
  assert.match(source, /title=\{t\("智能体设置"\)\}/);
  assert.match(source, /label=\{t\("进入工作流设置"\)\}/);
  assert.match(source, /label=\{t\("打开工作流设置"\)\}/);
  assert.match(source, /navigate\("\/workflows"\)/);
  assert.match(source, /title=\{t\("执行偏好"\)\}/);
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
  //   - 工作流链路页面应优先使用 aries_react 布局组件，避免原生 div。
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
  assert.doesNotMatch(overviewSource, /aria-label=\{readonly \? t\("查看工作流"\) : t\("编辑工作流"\)\}/);
  assert.doesNotMatch(overviewSource, /aria-label=\{t\("删除工作流"\)\}/);
  assert.match(canvasSource, /desk-workflow-editor-main/);
  assert.doesNotMatch(canvasSource, /desk-workflow-editor-sidebar/);
  assert.match(canvasSource, /desk-workflow-editor-floating-panel/);
  assert.match(sidebarSource, /function WorkflowsSidebar/);
  assert.match(styleSource, /\.desk-workflow-grid \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*gap: var\(--z-inset\);\s*align-items: start;/s);
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
  assert.match(source, /fn cancel_agent_session\(app: tauri::AppHandle, session_id: String\)/);
  assert.match(source, /fn approve_agent_action\(/);
  assert.match(source, /fn reset_agent_sandbox\(/);
  assert.match(source, /fn get_agent_sandbox_metrics\(/);
});

test("TestWorkflowCanvasSidebarAndFloatingActionsShouldMatchUxRules", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const overviewSource = readDesktopSource("src/modules/common/pages/workflows-page.tsx");
  const canvasSource = readDesktopSource("src/widgets/workflow/page.tsx");

  // 描述：
  //
  //   - 工作流链路应拆成“总览页 + 编辑页”；总览页保留 Home 侧边栏，进入查看/编辑页后才切换到工作流侧边栏。
  assert.match(sidebarSource, /if \(pathname\.startsWith\(WORKFLOW_EDITOR_PAGE_PATH\)\) return "workflow";/);
  assert.doesNotMatch(sidebarSource, /if \(pathname\.includes\("\/workflows"\)\) return "workflow";/);
  assert.match(sidebarSource, /function WorkflowsSidebar/);
  assert.match(sidebarSource, /label=\{t\("返回"\)\}/);
  assert.match(sidebarSource, /label=\{t\("新增"\)\}/);
  assert.match(sidebarSource, /onBack=\{\(\) => navigate\("\/home"\)\}/);
  assert.match(sidebarSource, /const isWorkflowEditorPage = location\.pathname\.startsWith\(WORKFLOW_EDITOR_PAGE_PATH\);/);
  assert.match(sidebarSource, /listAgentWorkflowOverview\(\)/);
  assert.match(sidebarSource, /workflowOverview\.all/);
  assert.match(sidebarSource, /label: t\("已注册"\), isGroup: true/);
  assert.match(sidebarSource, /label: t\("未注册"\), isGroup: true/);
  assert.match(sidebarSource, /if \(pendingDeleteWorkflowId !== workflowId\) \{\s*setPendingDeleteWorkflowId\(workflowId\);\s*return;\s*\}/s);
  assert.match(sidebarSource, /label=\{pendingDeleteWorkflowId === item\.id \? t\("确定"\) : undefined\}/);
  assert.match(sidebarSource, /showActionsOnHover: pendingDeleteWorkflowId !== item\.id/);
  assert.doesNotMatch(sidebarSource, /setPendingDeleteWorkflowId\(\(current\) => \(current === item\.key \? "" : current\)\);/);
  assert.match(overviewSource, /aria-label=\{readonly \? t\("添加工作流"\) : t\("复制工作流"\)\}/);
  assert.match(canvasSource, /className="desk-workflow-editor-floating-panel"/);
  assert.doesNotMatch(canvasSource, /desk-workflow-editor-sidebar/);
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
  //   - 客户端 TSX 布局应优先使用 aries_react 布局组件，避免原生 div 回归。
  tsxFiles.forEach((relativePath) => {
    const source = readDesktopSource(relativePath);
    assert.doesNotMatch(source, /<div[\s>]/, `发现原生 div：${relativePath}`);
  });
});
