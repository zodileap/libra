import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，用于项目结构化信息端到端链路回归测试。
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

test("TestE2ELocalWorkspaceCreateShouldBootstrapProfileAndInjectSessionContext", () => {
  const codeAgentSource = readDesktopSource("src/modules/code/pages/code-agent-page.tsx");
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 本地目录接入后应创建/命中项目并触发 profile seed 初始化。
  assert.match(codeAgentSource, /invoke<string \| null>\("pick_local_project_folder"\)/);
  assert.match(codeAgentSource, /const created = upsertCodeWorkspaceGroup\(pathValue\);/);
  assert.match(codeAgentSource, /setSearchParams\(new URLSearchParams\(\{ workspaceId: created\.id \}\), \{ replace: true \}\);/);
  assert.match(codeAgentSource, /void bootstrapWorkspaceProfileSeed\(created\);/);

  // 描述：
  //
  //   - 会话执行前应读取并注入项目结构化上下文，保证新建项目可直接生效。
  assert.match(sessionSource, /const latestCodeProjectProfile = activeCodeWorkspace\?\.id/);
  assert.match(sessionSource, /getCodeWorkspaceProjectProfile\(activeCodeWorkspace\.id\)/);
  assert.match(sessionSource, /const contextualCodeRequestPrompt = buildCodeSessionContextPrompt\(/);
  assert.match(sessionSource, /latestCodeProjectProfile,\s*\)/);

  // 描述：
  //
  //   - profile 数据层应支持缺失时 bootstrap，确保创建后“可读可写”。
  assert.match(dataSource, /export function bootstrapCodeWorkspaceProjectProfile\(/);
  assert.match(dataSource, /if \(current && !options\?\.force\) \{\s*return current;\s*\}/s);
});

test("TestE2EGitWorkspaceCreateShouldBootstrapProfileAndExposeSeedInspectCommand", () => {
  const codeAgentSource = readDesktopSource("src/modules/code/pages/code-agent-page.tsx");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const tauriSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - Git 仓库接入后应克隆并复用统一创建链路，以便自动初始化 profile。
  assert.match(codeAgentSource, /invoke<GitCloneResponse>\("clone_git_repository",/);
  assert.match(codeAgentSource, /const created = handleCreateWorkspaceGroup\(cloned\.path\);/);
  assert.match(codeAgentSource, /void bootstrapWorkspaceProfileSeed\(created\);/);

  // 描述：
  //
  //   - 前后端应保持一致的 seed 命令声明，确保 Git 场景同样触发分析。
  assert.match(constantsSource, /INSPECT_CODE_WORKSPACE_PROFILE_SEED: "inspect_code_workspace_profile_seed"/);
  assert.match(tauriSource, /async fn inspect_code_workspace_profile_seed\(/);
  assert.match(tauriSource, /fn inspect_code_workspace_profile_seed_inner\(/);
  assert.match(tauriSource, /inspect_code_workspace_profile_seed,/);
});

test("TestE2EProfileUpdateShouldSyncAcrossSessions", () => {
  const settingsSource = readDesktopSource("src/modules/code/pages/code-project-settings-page.tsx");
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 数据层写入结构化信息后应广播项目级更新事件。
  assert.match(dataSource, /export const CODE_WORKSPACE_PROFILE_UPDATED_EVENT = "zodileap:code-workspace-profile-updated";/);
  assert.match(dataSource, /new CustomEvent\(CODE_WORKSPACE_PROFILE_UPDATED_EVENT,/);
  assert.match(dataSource, /detail: \{\s*workspaceId,\s*reason,\s*revision,\s*\},/s);

  // 描述：
  //
  //   - 项目设置页应监听并回放最新 profile，避免多话题编辑冲突。
  assert.match(settingsSource, /window\.addEventListener\(CODE_WORKSPACE_PROFILE_UPDATED_EVENT, onProfileUpdated as EventListener\);/);
  assert.match(settingsSource, /setProfileSyncStatus\(`结构化信息已同步（v\$\{latest\.revision\}）`\);/);
  assert.match(dataSource, /结构化信息已被其他会话更新，请刷新后重试。/);

  // 描述：
  //
  //   - 会话页应监听同一事件并刷新缓存，确保 A/B 会话上下文一致。
  assert.match(sessionSource, /window\.addEventListener\(\s*CODE_WORKSPACE_PROFILE_UPDATED_EVENT,\s*onCodeWorkspaceProfileUpdated as EventListener,\s*\);/s);
  assert.match(sessionSource, /setActiveCodeProjectProfile\(getCodeWorkspaceProjectProfile\(activeCodeWorkspace\.id\)\);/);
  assert.match(sessionSource, /window\.removeEventListener\(\s*CODE_WORKSPACE_PROFILE_UPDATED_EVENT,\s*onCodeWorkspaceProfileUpdated as EventListener,\s*\);/s);
});
