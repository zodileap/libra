import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 客户端源码文件，用于代码智能体接入页布局断言。
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

test("TestCodeAgentOnboardingShouldRenderMethodCardsInVerticalOrder", () => {
  const source = readDesktopSource("src/modules/code/pages/code-agent-page.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 代码项目接入区应展示“标题 + 两张方式卡片（本地文件夹在上，Git 仓库在下）”的结构。
  assert.match(source, /className=\"desk-code-workspace-onboarding-card\"/);
  assert.match(source, /<AriTypography variant=\"h4\" value=\"选择代码项目\" \/>/);
  assert.doesNotMatch(source, /value=\"选择接入方式\"/);
  assert.match(source, /className=\"desk-code-workspace-method-list\"/);
  assert.match(source, /className=\"desk-code-workspace-method-card\"/);
  assert.match(source, /className=\"desk-code-workspace-method-row\"/);
  assert.match(source, /className=\"desk-code-workspace-method-action\"/);
  assert.match(source, /flexItem=\{\[\{ index: 0, flex: 1, overflow: \"visible\" \}\]\}/);
  assert.match(source, /vertical\s+justify=\"center\"\s+align=\"flex-end\"\s+className=\"desk-code-workspace-method-action\"/s);
  assert.match(source, /<AriTypography variant=\"body\" value=\"本地文件夹\" \/>/);
  assert.match(source, /label=\{folderPickLoading \? "打开中\.\.\." : "选择"\}/);
  const infoColorMatches = source.match(/color=\"info\"/g) || [];
  assert.equal(infoColorMatches.length >= 2, true);
  assert.match(source, /<AriTypography variant=\"body\" value=\"Git 仓库\" \/>/);
  assert.match(source, /label=\{gitCloneLoading \? "开启中\.\.\." : "开启"\}/);
  assert.match(source, /className=\"desk-code-workspace-git-input\"/);
  assert.doesNotMatch(source, /desk-code-workspace-link-btn/);

  const localMethodIndex = source.indexOf("value=\"本地文件夹\"");
  const gitMethodIndex = source.indexOf("value=\"Git 仓库\"");
  assert.equal(localMethodIndex >= 0, true);
  assert.equal(gitMethodIndex >= 0, true);
  assert.equal(localMethodIndex < gitMethodIndex, true);

  const gitTitleIndex = source.indexOf("value=\"Git 仓库\"");
  const gitInputIndex = source.indexOf("className=\"desk-code-workspace-git-input\"");
  assert.equal(gitTitleIndex >= 0, true);
  assert.equal(gitInputIndex >= 0, true);
  assert.equal(gitTitleIndex < gitInputIndex, true);

  // 描述：
  //
  //   - 样式层应提供方法卡片列表和单卡的布局类，保障纵向排列可维护。
  assert.match(styleSource, /\.desk-code-workspace-method-list/);
  assert.match(styleSource, /\.desk-code-workspace-method-card/);
  assert.match(styleSource, /\.desk-code-workspace-method-row/);
  assert.match(styleSource, /\.desk-code-workspace-method-action/);
  assert.doesNotMatch(styleSource, /\.desk-code-workspace-link-btn/);
});
