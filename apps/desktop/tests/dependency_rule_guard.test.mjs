import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，用于依赖规范执行链路回归测试。
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

test("TestSessionPageShouldCheckAndUpgradeProjectDependencyRules", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - 统一智能体发送前仅在“依赖策略”项目能力启用时检查依赖规则，并提供“升级并继续 / 跳过继续”的确认路径。
  assert.match(sessionSource, /const dependencyPolicyEnabled = isProjectWorkspaceCapabilityEnabled\(activeWorkspace, "dependency-policy"\);/);
  assert.match(sessionSource, /if \(dependencyPolicyEnabled && projectPath && dependencyRules.length > 0\)/);
  assert.match(sessionSource, /invoke<DependencyRuleCheckResponse>\(COMMANDS\.CHECK_PROJECT_DEPENDENCY_RULES/);
  assert.match(sessionSource, /invoke<DependencyRuleUpgradeResponse>\(COMMANDS\.APPLY_PROJECT_DEPENDENCY_RULE_UPGRADES/);
  assert.match(sessionSource, /skipDependencyRuleCheck/);
  assert.match(sessionSource, /title=\{t\("依赖版本需确认"\)\}/);
  assert.match(sessionSource, /t\("升级并继续"\)/);
  assert.match(sessionSource, /label=\{t\("本次跳过继续"\)\}/);
});

test("TestTauriMainShouldExposeDependencyRuleCommands", () => {
  const tauriMainSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - Tauri 后端应暴露依赖规则检查/升级与项目结构化初始化分析命令，并注册到 invoke handler。
  assert.match(tauriMainSource, /async fn check_project_dependency_rules\(/);
  assert.match(tauriMainSource, /async fn apply_project_dependency_rule_upgrades\(/);
  assert.match(tauriMainSource, /async fn inspect_project_workspace_profile_seed\(/);
  assert.match(tauriMainSource, /check_project_dependency_rules,/);
  assert.match(tauriMainSource, /apply_project_dependency_rule_upgrades,/);
  assert.match(tauriMainSource, /inspect_project_workspace_profile_seed,/);
  assert.match(tauriMainSource, /DependencyEcosystem::Node/);
  assert.match(tauriMainSource, /DependencyEcosystem::Go/);
  assert.match(tauriMainSource, /DependencyEcosystem::Java/);
});
