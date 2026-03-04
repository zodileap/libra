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

test("TestWorkflowStorageShouldSupportCodeWorkflowCrud", () => {
  const source = readDesktopSource("src/shared/workflow/storage.ts");

  // 描述：
  //
  //   - 工作流存储层应同时支持代码工作流列表、创建、保存、删除和 Prompt 拼接。
  assert.match(source, /listCodeWorkflows/);
  assert.match(source, /createCodeWorkflowFromTemplate/);
  assert.match(source, /saveCodeWorkflow/);
  assert.match(source, /deleteCodeWorkflow/);
  assert.match(source, /buildCodeWorkflowPrompt/);
});

test("TestWorkflowStorageShouldNormalizeDefaultModelWorkflowGraph", () => {
  const source = readDesktopSource("src/shared/workflow/storage.ts");

  // 描述：
  //
  //   - 默认模型工作流模板在列表构建阶段必须归一化图结构，避免画布页出现“有流程定义但看不到节点”。
  assert.match(source, /const merged: WorkflowDefinition\[\] = DEFAULT_MODEL_WORKFLOWS\.map/);
  assert.match(source, /normalizeWorkflow\(\{/);
});

test("TestRouterShouldExposeCodeAgentSettingsRoute", () => {
  const source = readDesktopSource("src/router/index.tsx");

  // 描述：
  //
  //   - 路由层应提供代码智能体设置页入口，用于管理代码工作流。
  assert.match(source, /CodeAgentSettingsPageLazy/);
  assert.match(source, /path="agents\/code\/settings"/);
  assert.match(source, /CodeWorkflowPageLazy/);
  assert.match(source, /ModelWorkflowPageLazy/);
  assert.match(source, /path="agents\/code\/workflows"/);
  assert.match(source, /path="agents\/model\/workflows"/);
});

test("TestAgentSidebarShouldSeparateAgentAndWorkflowSettings", () => {
  const codeRoutesSource = readDesktopSource("src/modules/code/routes.tsx");
  const modelRoutesSource = readDesktopSource("src/modules/model/routes.tsx");

  // 描述：
  //
  //   - 智能体侧边栏快捷入口应由路由层声明“智能体设置”“工作流设置”两个独立项。
  assert.match(codeRoutesSource, /export const CODE_SIDEBAR_QUICK_ACTIONS/);
  assert.match(codeRoutesSource, /label: "智能体设置"/);
  assert.match(codeRoutesSource, /label: "工作流设置"/);
  assert.match(codeRoutesSource, /path: CODE_AGENT_SETTINGS_PATH/);
  assert.match(codeRoutesSource, /path: CODE_WORKFLOW_PATH/);
  assert.match(modelRoutesSource, /export const MODEL_SIDEBAR_QUICK_ACTIONS/);
  assert.match(modelRoutesSource, /label: "智能体设置"/);
  assert.match(modelRoutesSource, /label: "工作流设置"/);
  assert.match(modelRoutesSource, /path: MODEL_AGENT_SETTINGS_PATH/);
  assert.match(modelRoutesSource, /path: MODEL_WORKFLOW_PATH/);
});

test("TestSessionPageShouldAllowWorkflowSelectionForModelAndCode", () => {
  const source = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 会话页应允许在对话输入区切换工作流，并按智能体类型应用到执行请求。
  assert.match(source, /workflowMenuItems/);
  assert.match(source, /setSelectedModelWorkflowId/);
  assert.match(source, /setSelectedCodeWorkflowId/);
  assert.match(source, /workflowId: selectedModelWorkflow\?\.id \|\| "wf-model-full-v1"/);
  assert.match(source, /const codeWorkflowPrompt = buildCodeWorkflowPrompt\(\s*selectedCodeWorkflow,/s);
});

test("TestAgentPageShouldUseUnifiedComposeLayoutAndAutoPromptNavigation", () => {
  const source = readDesktopSource("src/widgets/agent/page.tsx");
  const codeAgentSource = readDesktopSource("src/modules/code/pages/code-agent-page.tsx");

  // 描述：
  //
  //   - 智能体首页应使用统一输入布局；Code 页面负责创建会话并通过路由状态下发首条消息。
  assert.match(source, /desk-session-shell/);
  assert.match(source, /desk-prompt-card desk-session-prompt-card/);
  assert.match(source, /if \(onboardingContent\) \{/);
  assert.match(source, /onStartConversation\(\)/);
  assert.match(codeAgentSource, /navigate\(`\/agents\/code\/session\/\$\{session\.id\}\$\{search\}`,/);
  assert.match(codeAgentSource, /state:\s*\{\s*autoPrompt:\s*normalizedPrompt,/);
  assert.match(codeAgentSource, /if \(!selectedWorkspace\) \{/);
  assert.match(codeAgentSource, /bindCodeSessionWorkspace\(session\.id, selectedWorkspace\.id\);/);
});

test("TestCodeAgentShouldShowStandaloneWorkspaceOnboardingWhenNoWorkspace", () => {
  const source = readDesktopSource("src/modules/code/pages/code-agent-page.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 代码智能体在未选择目录时应渲染独立引导页（中间卡片），不展示常规标题/快捷卡片/对话框布局。
  assert.match(source, /const onboardingContent = !selectedWorkspace \? \(/);
  assert.match(source, /className=\"desk-content desk-code-workspace-onboarding\"/);
  assert.match(source, /className=\"desk-code-workspace-onboarding-card\"/);
  assert.match(source, /value=\"选择代码项目\"/);
  assert.match(source, /label=\{gitCloneLoading \? "开启中\.\.\." : "开启"\}/);
  assert.match(source, /invoke<string \| null>\(\"pick_local_project_folder\"\)/);
  assert.match(source, /invoke<GitCliHealthResponse>\(\"check_git_cli_health\"\)/);
  assert.match(source, /invoke<GitCloneResponse>\(\"clone_git_repository\"/);
  assert.match(source, /invoke<CodeWorkspaceProfileSeedResponse>\(\s*COMMANDS\.INSPECT_CODE_WORKSPACE_PROFILE_SEED,/s);
  assert.match(source, /saveCodeWorkspaceProjectProfile\(/);
  assert.match(source, /updatedBy: "workspace_seed_bootstrap"/);
  assert.match(source, /reason: "workspace_seed_bootstrap"/);
  assert.match(source, /if \(profileBefore\?\.revision && profileBefore\.revision > 1\) \{/);
  assert.match(source, /invoke\(\"open_external_url\", \{ url: \"https:\/\/git-scm\.com\/downloads\" \}\)/);
  assert.match(source, /title=\"未检测到 Git\"/);
  assert.match(source, /label=\"确认并前往下载\"/);
  assert.match(source, /<AriInput\s+variant=\"borderless\"/s);
  assert.match(styleSource, /\.desk-code-workspace-onboarding/);
  assert.match(styleSource, /\.desk-code-workspace-onboarding-card/);
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

test("TestCodeAgentSettingsPageShouldSeparateWorkflowManagement", () => {
  const source = readDesktopSource("src/modules/code/pages/code-agent-settings-page.tsx");

  // 描述：
  //
  //   - 代码智能体设置页应仅保留执行偏好与工作流入口，不再承载工作流 CRUD。
  assert.match(source, /title="代码智能体设置"/);
  assert.match(source, /label="进入工作流设置"/);
  assert.match(source, /label="打开工作流设置"/);
  assert.match(source, /navigate\("\/agents\/code\/workflows"\)/);
  assert.match(source, /title="执行偏好"/);
  assert.match(source, /AriSwitch/);
  assert.doesNotMatch(source, /createCodeWorkflowFromTemplate/);
  assert.doesNotMatch(source, /deleteCodeWorkflow/);
  assert.doesNotMatch(source, /label="新增工作流"/);
  assert.doesNotMatch(source, /title="删除代码工作流"/);
});

test("TestModelAgentSettingsPageShouldSeparateCapabilityAndWorkflowManagement", () => {
  const source = readDesktopSource("src/modules/model/pages/model-agent-settings-page.tsx");

  // 描述：
  //   - 模型智能体设置页应聚焦能力配置与 Bridge 状态，并提供独立工作流入口。
  assert.match(source, /title="模型智能体设置"/);
  assert.match(source, /title="MCP 能力开关"/);
  assert.match(source, /title="Blender Bridge"/);
  assert.match(source, /onModelMcpCapabilitiesChange/);
  assert.match(source, /ensureBlenderBridge/);
  assert.match(source, /label="进入工作流设置"/);
  assert.match(source, /label="打开工作流设置"/);
  assert.match(source, /navigate\("\/agents\/model\/workflows"\)/);
  assert.doesNotMatch(source, /createModelWorkflowFromTemplate/);
  assert.doesNotMatch(source, /deleteModelWorkflow/);
  assert.doesNotMatch(source, /title="删除模型工作流"/);
});

test("TestWorkflowCanvasPageShouldUseReactFlowAndSingleNodeModel", () => {
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
  assert.match(source, /\{selectedNodeData \? \(/);
  assert.match(source, /className="desk-workflow-editor-floating-panel"/);
  assert.match(source, /onPaneClick=\{\(\) => \{/);
});

test("TestWorkflowPagesShouldUseListLayoutInSettings", () => {
  const codeSource = readDesktopSource("src/modules/code/pages/code-agent-settings-page.tsx");
  const modelSource = readDesktopSource("src/modules/model/pages/model-agent-settings-page.tsx");
  const canvasSource = readDesktopSource("src/widgets/workflow/page.tsx");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const primitivesSource = readDesktopSource("src/widgets/settings-primitives.tsx");

  // 描述：
  //
  //   - 设置页应采用通用设置面板布局；画布页应专注右侧画布与悬浮属性面板，工作流列表放到全局侧边栏。
  //   - 工作流链路页面应优先使用 aries_react 布局组件，避免原生 div。
  assert.match(codeSource, /desk-settings-panel/);
  assert.match(modelSource, /desk-settings-panel/);
  assert.doesNotMatch(codeSource, /desk-workflow-list-card/);
  assert.doesNotMatch(modelSource, /desk-workflow-list-card/);
  assert.match(canvasSource, /desk-workflow-editor-main/);
  assert.doesNotMatch(canvasSource, /desk-workflow-editor-sidebar/);
  assert.match(canvasSource, /desk-workflow-editor-floating-panel/);
  assert.match(sidebarSource, /function WorkflowsSidebar/);
  assert.doesNotMatch(codeSource, /<div[\s>]/);
  assert.doesNotMatch(modelSource, /<div[\s>]/);
  assert.doesNotMatch(primitivesSource, /<div[\s>]/);
});

test("TestWorkflowCanvasSidebarAndFloatingActionsShouldMatchUxRules", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const canvasSource = readDesktopSource("src/widgets/workflow/page.tsx");

  // 描述：
  //
  //   - 工作流页应通过全局侧边栏承载“返回 + 新增 + 菜单删除确认”交互，画布页不再内嵌工作流列表。
  assert.match(sidebarSource, /if \(pathname\.includes\("\/workflows"\)\) return "workflow";/);
  assert.match(sidebarSource, /function WorkflowsSidebar/);
  assert.match(sidebarSource, /label="返回"/);
  assert.match(sidebarSource, /label="新增"/);
  assert.match(sidebarSource, /onBack=\{\(\) => navigate\(`\/agents\/\$\{agentKey\}\/settings`\)\}/);
  assert.match(sidebarSource, /if \(pendingDeleteWorkflowId !== workflowId\) \{\s*setPendingDeleteWorkflowId\(workflowId\);\s*return;\s*\}/s);
  assert.match(sidebarSource, /label=\{pendingDeleteWorkflowId === item\.id \? "确定" : undefined\}/);
  assert.match(sidebarSource, /showActionsOnHover: true/);
  assert.match(canvasSource, /className="desk-workflow-editor-floating-panel"/);
  assert.doesNotMatch(canvasSource, /label="新增工作流"/);
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
