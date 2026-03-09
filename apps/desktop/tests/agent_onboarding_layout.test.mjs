import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 客户端源码文件，用于项目接入页布局断言。
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

test("TestAgentOnboardingShouldRenderMethodCardsInVerticalOrder", () => {
  const source = readDesktopSource("src/modules/agent/pages/agent-home-page.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 项目接入区应展示“标题 + 两张方式卡片（本地文件夹在上，Git 仓库在下）”的结构。
  assert.match(source, /className=\"desk-project-workspace-onboarding-card\"/);
  assert.match(source, /<AriTypography variant=\"h4\" value=\{t\("选择项目"\)\} \/>/);
  assert.doesNotMatch(source, /value=\"选择接入方式\"/);
  assert.match(source, /className=\"desk-project-workspace-method-list\"/);
  assert.match(source, /className=\"desk-project-workspace-method-card\"/);
  assert.match(source, /className=\"desk-project-workspace-method-row\"/);
  assert.match(source, /className=\"desk-project-workspace-method-action\"/);
  assert.match(source, /flexItem=\{\[\{ index: 0, flex: 1, overflow: \"visible\" \}\]\}/);
  assert.match(source, /vertical\s+justify=\"center\"\s+align=\"flex-end\"\s+className=\"desk-project-workspace-method-action\"/s);
  assert.match(source, /<AriTypography variant=\"body\" value=\{t\("本地文件夹"\)\} \/>/);
  assert.match(source, /label=\{folderPickLoading \? t\("打开中\.\.\."\) : t\("选择"\)\}/);
  const infoColorMatches = source.match(/color=\"info\"/g) || [];
  assert.equal(infoColorMatches.length >= 2, true);
  assert.match(source, /<AriTypography variant=\"body\" value=\{t\("Git 仓库"\)\} \/>/);
  assert.match(source, /label=\{gitCloneLoading \? t\("开启中\.\.\."\) : t\("开启"\)\}/);
  assert.match(source, /className=\"desk-project-workspace-git-input\"/);
  assert.match(source, /className=\"desk-project-workspace-git-input\"[\s\S]*enableHoverFocusEffect=\{false\}/);
  assert.doesNotMatch(source, /desk-project-workspace-link-btn/);

  const localMethodIndex = source.indexOf("t(\"本地文件夹\")");
  const gitMethodIndex = source.indexOf("t(\"Git 仓库\")");
  assert.equal(localMethodIndex >= 0, true);
  assert.equal(gitMethodIndex >= 0, true);
  assert.equal(localMethodIndex < gitMethodIndex, true);

  const gitTitleIndex = source.indexOf("t(\"Git 仓库\")");
  const gitInputIndex = source.indexOf("className=\"desk-project-workspace-git-input\"");
  assert.equal(gitTitleIndex >= 0, true);
  assert.equal(gitInputIndex >= 0, true);
  assert.equal(gitTitleIndex < gitInputIndex, true);

  // 描述：
  //
  //   - 样式层应提供方法卡片列表和单卡的布局类，保障纵向排列可维护。
  assert.match(styleSource, /\.desk-project-workspace-method-list/);
  assert.match(styleSource, /\.desk-project-workspace-method-card/);
  assert.match(styleSource, /\.desk-project-workspace-method-row/);
  assert.match(styleSource, /\.desk-project-workspace-method-action/);
  assert.doesNotMatch(styleSource, /\.desk-project-workspace-link-btn/);
});
