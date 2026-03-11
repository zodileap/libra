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
  //   - 新项目页应展示“标题栏 + 居中的本地来源卡片 + 满宽选择按钮”的结构。
  assert.match(source, /title=\{t\("新项目"\)\}/);
  assert.match(source, /className=\"desk-content desk-agent-home-content\"/);
  assert.doesNotMatch(source, /className=\"desk-agent-home-heading\"/);
  assert.doesNotMatch(source, /value=\{t\("选择本地文件夹"\)\}/);
  assert.doesNotMatch(source, /选择一个本地文件夹，创建完成后会直接进入新话题。/);
  assert.match(source, /className=\"desk-agent-home-source-list\"/);
  assert.match(source, /className=\"desk-agent-home-source-card\"/);
  assert.match(source, /className=\"desk-agent-home-source-copy\"/);
  assert.match(source, /className=\"desk-agent-home-source-hero\"/);
  assert.match(source, /className=\"desk-agent-home-feature-list\"/);
  assert.match(source, /className=\"desk-agent-home-feature-item\"/);
  assert.match(source, /className=\"desk-agent-home-source-action-row\"/);
  assert.match(source, /className=\"desk-agent-home-source-title\"[\s\S]*value=\{t\("本地文件夹"\)\}/);
  assert.match(source, /description=\{t\("本地优先，支持现有仓库与任意本地工作目录。"\)\}/);
  assert.match(source, /value=\{t\("选择当前机器上的目录后，会直接进入新的项目会话。"\)\}/);
  assert.match(source, /className=\"desk-agent-home-source-button\"/);
  assert.doesNotMatch(source, /className=\"desk-agent-home-source-kicker\"/);
  assert.doesNotMatch(source, /className=\"desk-agent-home-source-helper\"/);
  assert.match(source, /label=\{folderPickLoading \? t\("打开中\.\.\."\) : sessionCreating \? t\("开启中\.\.\."\) : t\("选择本地文件夹"\)\}/);
  assert.match(source, /void handlePickLocalFolder\(\);/);
  assert.doesNotMatch(source, /setStatus\(t\("已取消目录选择。"\)\);/);
  assert.doesNotMatch(source, /desk-project-workspace-link-btn/);
  assert.doesNotMatch(source, /已关联项目/);
  assert.doesNotMatch(source, /Git 仓库/);
  assert.doesNotMatch(source, /输入 Git 地址/);
  assert.doesNotMatch(source, /补齐结构化信息/);
  assert.doesNotMatch(source, /AriModal/);
  assert.doesNotMatch(source, /setLocalFolderPath/);
  assert.doesNotMatch(source, /handleOpenLocalFolderProject/);

  const localTitleIndex = source.indexOf("t(\"本地文件夹\")");
  const localButtonIndex = source.indexOf("className=\"desk-agent-home-source-button\"");
  assert.equal(localTitleIndex >= 0, true);
  assert.equal(localButtonIndex >= 0, true);
  assert.equal(localTitleIndex < localButtonIndex, true);

  // 描述：
  //
  //   - 样式层应提供更宽的接入壳、顶部锚定的首页布局、特性列表和满宽操作按钮样式，避免 CTA 漂浮在大面积留白中。
  assert.match(styleSource, /--desk-shell-compact-width:\s*calc\(var\(--z-inset\) \* 52\);/);
  assert.match(styleSource, /--desk-agent-home-shell-width:\s*var\(--desk-shell-compact-width\);/);
  assert.match(styleSource, /\.desk-agent-home-content\s*\{[\s\S]*display: flex;[\s\S]*align-items: center;[\s\S]*justify-content: flex-start;[\s\S]*\}/);
  assert.match(styleSource, /\.desk-agent-home-shell/);
  assert.doesNotMatch(styleSource, /\.desk-agent-home-heading/);
  assert.match(styleSource, /\.desk-agent-home-source-list/);
  assert.match(styleSource, /\.desk-agent-home-source-card/);
  assert.match(styleSource, /\.desk-agent-home-feature-list \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*gap: var\(--z-inset-sm\);/s);
  assert.match(styleSource, /\.desk-agent-home-feature-item/);
  assert.match(styleSource, /\.desk-agent-home-source-action-row/);
  assert.match(styleSource, /\.desk-agent-home-source-button/);
  assert.match(styleSource, /\.desk-agent-home-source-card \{[\s\S]*border: var\(--desk-border-width\) solid color-mix\(in srgb, var\(--z-color-primary\) 28%, var\(--z-color-border-glass\)\);/);
  assert.doesNotMatch(styleSource, /\.desk-agent-home-source-card \{[^}]*background:/);
  assert.doesNotMatch(styleSource, /\.desk-agent-home-source-card \{[^}]*display: grid;/);
  assert.doesNotMatch(styleSource, /\.desk-project-workspace-link-btn/);
});
