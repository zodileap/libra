import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，验证项目结构化信息预初始化链路。
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

test("TestWorkspaceProfileSeedShouldBeInvokedAfterWorkspaceCreate", () => {
  const agentHomeSource = readDesktopSource("src/modules/agent/pages/agent-home-page.tsx");
  const constantsSource = readDesktopSource("src/shared/constants.ts");

  // 描述：
  //
  //   - 前端应在项目创建后触发结构化初始化分析命令，并写回 ProjectProfile。
  assert.match(constantsSource, /INSPECT_PROJECT_WORKSPACE_PROFILE_SEED: "inspect_project_workspace_profile_seed"/);
  assert.match(agentHomeSource, /const bootstrapWorkspaceProfileSeed = async \(workspace: ProjectWorkspaceGroup\) =>/);
  assert.match(agentHomeSource, /invoke<ProjectWorkspaceProfileSeedResponse>\(\s*COMMANDS\.INSPECT_PROJECT_WORKSPACE_PROFILE_SEED,/s);
  assert.match(agentHomeSource, /saveProjectWorkspaceProfile\(/);
  assert.match(agentHomeSource, /apiDataModel:/);
  assert.match(agentHomeSource, /frontendPageLayout:/);
  assert.match(agentHomeSource, /frontendCodeStructure:/);
  assert.doesNotMatch(agentHomeSource, /frontend_stacks/);
  assert.doesNotMatch(agentHomeSource, /backend_stacks/);
  assert.doesNotMatch(agentHomeSource, /database_stacks/);
  assert.match(agentHomeSource, /!item\.startsWith\(t\("语言："\)\)/);
  assert.match(agentHomeSource, /!item\.startsWith\(t\("包管理器："\)\)/);
  assert.match(agentHomeSource, /!item\.startsWith\(t\("构建工具："\)\)/);
  assert.match(agentHomeSource, /expectedRevision: profileCurrent\.revision/);
  assert.match(agentHomeSource, /updatedBy: "workspace_seed_bootstrap"/);
  assert.match(agentHomeSource, /reason: "workspace_seed_bootstrap"/);
  assert.match(agentHomeSource, /void bootstrapWorkspaceProfileSeed\(created\);/);
});

test("TestTauriShouldExposeProjectProfileSeedInspectCommand", () => {
  const tauriMainSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - Tauri 层应提供项目结构化初始化分析命令，并覆盖语言/技术栈/目录摘要识别。
  assert.match(tauriMainSource, /struct ProjectWorkspaceProfileSeedResponse \{/);
  assert.match(tauriMainSource, /async fn inspect_project_workspace_profile_seed\(/);
  assert.match(tauriMainSource, /fn inspect_project_workspace_profile_seed_inner\(/);
  assert.match(tauriMainSource, /detect_node_build_tools\(/);
  assert.match(tauriMainSource, /collect_workspace_module_candidates\(/);
  assert.match(tauriMainSource, /api_data_models: Vec<String>/);
  assert.match(tauriMainSource, /frontend_pages: Vec<String>/);
  assert.match(tauriMainSource, /frontend_code_directories: Vec<String>/);
  assert.doesNotMatch(tauriMainSource, /infrastructure_stacks: Vec<String>/);
  assert.doesNotMatch(tauriMainSource, /database_stacks\.iter\(\)\.chain\(backend_stacks\.iter\(\)/);
  assert.doesNotMatch(tauriMainSource, /for item in frontend_stacks\.iter\(\)\.take\(4\)/);
  assert.match(tauriMainSource, /inspect_project_workspace_profile_seed,/);
});
