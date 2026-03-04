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

test("TestCodeWorkspaceProfileSeedShouldBeInvokedAfterWorkspaceCreate", () => {
  const codeAgentSource = readDesktopSource("src/modules/code/pages/code-agent-page.tsx");
  const constantsSource = readDesktopSource("src/shared/constants.ts");

  // 描述：
  //
  //   - 前端应在项目创建后触发结构化初始化分析命令，并写回 ProjectProfile。
  assert.match(constantsSource, /INSPECT_CODE_WORKSPACE_PROFILE_SEED: "inspect_code_workspace_profile_seed"/);
  assert.match(codeAgentSource, /const bootstrapWorkspaceProfileSeed = async \(workspace: CodeWorkspaceGroup\) =>/);
  assert.match(codeAgentSource, /invoke<CodeWorkspaceProfileSeedResponse>\(\s*COMMANDS\.INSPECT_CODE_WORKSPACE_PROFILE_SEED,/s);
  assert.match(codeAgentSource, /saveCodeWorkspaceProjectProfile\(/);
  assert.match(codeAgentSource, /expectedRevision: profileCurrent\.revision/);
  assert.match(codeAgentSource, /updatedBy: "workspace_seed_bootstrap"/);
  assert.match(codeAgentSource, /reason: "workspace_seed_bootstrap"/);
  assert.match(codeAgentSource, /void bootstrapWorkspaceProfileSeed\(created\);/);
});

test("TestTauriShouldExposeProjectProfileSeedInspectCommand", () => {
  const tauriMainSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - Tauri 层应提供项目结构化初始化分析命令，并覆盖语言/技术栈/目录摘要识别。
  assert.match(tauriMainSource, /struct CodeWorkspaceProfileSeedResponse \{/);
  assert.match(tauriMainSource, /async fn inspect_code_workspace_profile_seed\(/);
  assert.match(tauriMainSource, /fn inspect_code_workspace_profile_seed_inner\(/);
  assert.match(tauriMainSource, /detect_node_build_tools\(/);
  assert.match(tauriMainSource, /collect_workspace_module_candidates\(/);
  assert.match(tauriMainSource, /directory_summary: Vec<String>/);
  assert.match(tauriMainSource, /module_candidates: Vec<String>/);
  assert.match(tauriMainSource, /inspect_code_workspace_profile_seed,/);
});
