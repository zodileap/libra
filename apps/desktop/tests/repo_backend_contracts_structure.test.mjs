import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：解析仓库根目录下的文件绝对路径，供结构回归测试复用。
//
// Params:
//
//   - relativePath: 相对仓库根目录的路径。
//
// Returns:
//
//   - 目标文件的绝对路径。
function resolveRepoPath(relativePath) {
  const currentDir = process.cwd();
  const repoRoot = currentDir.endsWith(path.join("apps", "desktop"))
    ? path.resolve(currentDir, "..", "..")
    : currentDir;
  return path.resolve(repoRoot, relativePath);
}

// 描述：读取仓库文本文件，供断言仓库结构与规范文档内容。
//
// Params:
//
//   - relativePath: 相对仓库根目录的路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readRepoFile(relativePath) {
  return fs.readFileSync(resolveRepoPath(relativePath), "utf8");
}

test("TestRepositoryShouldNotContainStandaloneWebApp", () => {
  const webPath = resolveRepoPath("apps/web");
  const readmeSource = readRepoFile("README.md");
  const planSource = readRepoFile("docs/open-source-setup-plan.md");

  // 描述:
  //
  //   - 开源仓库已经移除 apps/web，初始化页面必须由统一后端托管，README 与方案文档也不应再把 Web 作为独立入口。
  assert.equal(fs.existsSync(webPath), false);
  assert.doesNotMatch(readmeSource, /apps\/web/);
  assert.match(readmeSource, /go run \.\/cmd\/server/);
  assert.match(readmeSource, /http:\/\/127\.0\.0\.1:10001\/setup/);
  assert.doesNotMatch(planSource, /apps\/web 当前只保留说明页/);
  assert.match(planSource, /`apps\/web` 已删除/);
});

test("TestRepositoryShouldExposeUnifiedBackendContracts", () => {
  const servicesReadmeSource = readRepoFile("services/README.md");
  const agentsSource = readRepoFile("AGENTS.md");
  const contractFiles = [
    "services/contracts/backend.yaml",
    "services/contracts/account.yaml",
    "services/contracts/runtime.yaml",
    "services/contracts/setup.yaml",
  ];

  // 描述:
  //
  //   - 后端必须保留结构化契约目录，并在规范中强制要求代码变更同步维护 contracts 文档。
  for (const relativePath of contractFiles) {
    assert.equal(fs.existsSync(resolveRepoPath(relativePath)), true, `${relativePath} should exist`);
  }
  assert.match(servicesReadmeSource, /go run \.\/cmd\/server/);
  assert.match(servicesReadmeSource, /contracts\/\*\.yaml/);
  assert.match(agentsSource, /services\/contracts\/\*\.yaml/);
  assert.match(agentsSource, /必须在同一轮改动中同步更新对应契约文档/);
  assert.match(agentsSource, /仓库已删除 `apps\/web`/);
});
