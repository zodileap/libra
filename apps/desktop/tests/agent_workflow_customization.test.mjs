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
  const source = readDesktopSource("src/modules/client/workflow/storage.ts");

  // 描述：
  //
  //   - 工作流存储层应同时支持代码工作流列表、创建、保存、删除和 Prompt 拼接。
  assert.match(source, /listCodeWorkflows/);
  assert.match(source, /createCodeWorkflowFromTemplate/);
  assert.match(source, /saveCodeWorkflow/);
  assert.match(source, /deleteCodeWorkflow/);
  assert.match(source, /buildCodeWorkflowPrompt/);
});

test("TestRouterShouldExposeCodeAgentSettingsRoute", () => {
  const source = readDesktopSource("src/modules/client/router.tsx");

  // 描述：
  //
  //   - 路由层应提供代码智能体设置页入口，用于管理代码工作流。
  assert.match(source, /CodeAgentSettingsPage/);
  assert.match(source, /path="agents\/code\/settings"/);
  assert.match(source, /WorkflowCanvasPage/);
  assert.match(source, /path="agents\/:agentKey\/workflows"/);
});

test("TestAgentSidebarShouldSeparateAgentAndWorkflowSettings", () => {
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");

  // 描述：
  //
  //   - 智能体侧边栏应将“智能体设置”“工作流设置”拆分为两个独立入口。
  assert.match(source, /className="desk-sidebar-quick-actions"/);
  assert.match(source, /label="智能体设置"/);
  assert.match(source, /label="工作流设置"/);
  assert.match(source, /navigate\(`\/agents\/\$\{agentKey\}\/settings`\)/);
  assert.match(source, /navigate\(`\/agents\/\$\{agentKey\}\/workflows`\)/);
});

test("TestSessionPageShouldAllowWorkflowSelectionForModelAndCode", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述：
  //
  //   - 会话页应允许在对话输入区切换工作流，并按智能体类型应用到执行请求。
  assert.match(source, /workflowMenuItems/);
  assert.match(source, /setSelectedModelWorkflowId/);
  assert.match(source, /setSelectedCodeWorkflowId/);
  assert.match(source, /workflowId: selectedModelWorkflow\?\.id \|\| "wf-model-full-v1"/);
  assert.match(source, /prompt: buildCodeWorkflowPrompt\(selectedCodeWorkflow, content\)/);
});

test("TestCodeAgentSettingsPageShouldSeparateWorkflowManagement", () => {
  const source = readDesktopSource("src/modules/client/pages/code-agent-settings-page.tsx");

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
  const source = readDesktopSource("src/modules/client/pages/model-agent-settings-page.tsx");

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
  const source = readDesktopSource("src/modules/client/pages/workflow-canvas-page.tsx");

  // 描述：
  //
  //   - 画布页应基于 React Flow，采用单节点模型并支持“空白=工作流属性、节点=节点属性”切换。
  assert.match(source, /@xyflow\/react/);
  assert.match(source, /<ReactFlow/);
  assert.match(source, /onConnect=\{onConnect\}/);
  assert.match(source, /type: "node"/);
  assert.match(source, /deleteSelectedNode/);
  assert.match(source, /deleteSelectedEdge/);
  assert.match(source, /patchSelectedNode/);
  assert.match(source, /value=\{selectedNodeData \? "节点属性" : "工作流属性"\}/);
  assert.match(source, /onPaneClick=\{\(\) => \{/);
});

test("TestWorkflowPagesShouldUseListLayoutInSettings", () => {
  const codeSource = readDesktopSource("src/modules/client/pages/code-agent-settings-page.tsx");
  const modelSource = readDesktopSource("src/modules/client/pages/model-agent-settings-page.tsx");
  const canvasSource = readDesktopSource("src/modules/client/pages/workflow-canvas-page.tsx");
  const primitivesSource = readDesktopSource("src/modules/client/widgets/settings-primitives.tsx");

  // 描述：
  //
  //   - 设置页应采用通用设置面板布局；画布页应采用左侧工作流栏 + 右侧画布与悬浮属性面板。
  //   - 工作流链路页面应优先使用 aries_react 布局组件，避免原生 div。
  assert.match(codeSource, /desk-settings-panel/);
  assert.match(modelSource, /desk-settings-panel/);
  assert.doesNotMatch(codeSource, /desk-workflow-list-card/);
  assert.doesNotMatch(modelSource, /desk-workflow-list-card/);
  assert.match(canvasSource, /desk-workflow-editor-layout/);
  assert.match(canvasSource, /desk-workflow-editor-sidebar/);
  assert.match(canvasSource, /desk-workflow-editor-floating-panel/);
  assert.doesNotMatch(codeSource, /<div[\s>]/);
  assert.doesNotMatch(modelSource, /<div[\s>]/);
  assert.doesNotMatch(canvasSource, /<div[\s>]/);
  assert.doesNotMatch(primitivesSource, /<div[\s>]/);
});

test("TestWorkflowCanvasSidebarAndFloatingActionsShouldMatchUxRules", () => {
  const canvasSource = readDesktopSource("src/modules/client/pages/workflow-canvas-page.tsx");

  // 描述：
  //
  //   - 工作流编辑器左侧栏应使用“返回设置”按钮，不显示“工作流列表”标题。
  //   - 工作流属性浮窗不再包含复制/分享(分析)/删除动作；编辑/删除动作应位于侧栏每个工作流条目。
  assert.match(canvasSource, /label="返回设置"/);
  assert.match(canvasSource, /navigate\(settingsPath\)/);
  assert.doesNotMatch(canvasSource, /value="工作流列表"/);
  assert.match(canvasSource, /desk-workflow-editor-sidebar-item-actions/);
  assert.match(canvasSource, /label="编辑"/);
  assert.match(canvasSource, /label="删除"/);
  assert.doesNotMatch(canvasSource, /label="复制"/);
  assert.doesNotMatch(canvasSource, /label="分享"/);
});

test("TestClientTsxLayoutShouldAvoidNativeDivElements", () => {
  const tsxFiles = listDesktopTsxFiles("src/modules/client");

  // 描述：
  //
  //   - 客户端 TSX 布局应优先使用 aries_react 布局组件，避免原生 div 回归。
  tsxFiles.forEach((relativePath) => {
    const source = readDesktopSource(relativePath);
    assert.doesNotMatch(source, /<div[\s>]/, `发现原生 div：${relativePath}`);
  });
});
