import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，用于共享视觉壳和表单容器回归断言。
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

test("TestDesktopUiSurfaceShouldUseWiderShellsAndStructuredComposerLayout", () => {
  const styleSource = readDesktopSource("src/styles.css");
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - Desktop 共享视觉壳应显式声明更宽的 shell、线程列和输入列宽度，避免页面内容全部缩成中间一条细柱。
  assert.match(styleSource, /--desk-shell-width:\s*calc\(var\(--z-inset\) \* 76\);/);
  assert.match(styleSource, /--desk-shell-wide-width:\s*calc\(var\(--z-inset\) \* 88\);/);
  assert.match(styleSource, /--desk-session-shell-width:\s*calc\(var\(--z-inset\) \* 86\);/);
  assert.match(styleSource, /--desk-session-content-width:\s*calc\(var\(--z-inset\) \* 60\);/);
  assert.match(styleSource, /--desk-session-thread-width:\s*var\(--desk-session-content-width\);/);
  assert.match(styleSource, /--desk-session-composer-width:\s*var\(--desk-session-content-width\);/);
  assert.match(styleSource, /\.desk-settings-shell\s*\{[\s\S]*width: min\(100%, var\(--desk-shell-width\)\);/);
  assert.match(styleSource, /\.desk-skills-shell\s*\{[\s\S]*width: min\(100%, var\(--desk-shell-wide-width\)\);/);
  assert.match(styleSource, /\.desk-session-shell\s*\{[\s\S]*width: min\(100%, var\(--desk-session-shell-width\)\);/);
  assert.match(styleSource, /\.desk-session-thread-wrap\s*\{[\s\S]*width: min\(100%, var\(--desk-session-content-width\)\);/);
  assert.match(styleSource, /\.desk-prompt-dock\s*\{[\s\S]*width: min\(100%, var\(--desk-session-content-width\)\);/);
  assert.match(styleSource, /\.desk-thread\s*\{[\s\S]*width: 100%;[\s\S]*margin-left: 0;[\s\S]*margin-right: 0;/);
  assert.match(styleSource, /\.desk-prompt-dock > \*\s*\{[\s\S]*width: 100%;[\s\S]*margin-left: 0;[\s\S]*margin-right: 0;/);
  assert.match(styleSource, /\.desk-session-empty-state\s*\{[\s\S]*width: 100%;/);

  // 描述：
  //
  //   - 会话页仍应保留 shell / thread / prompt dock 三层结构，由样式层负责收紧阅读列和输入列。
  assert.match(sessionSource, /className="desk-session-shell"/);
  assert.match(sessionSource, /className="desk-session-thread-wrap"/);
  assert.match(sessionSource, /className="desk-thread"/);
  assert.match(sessionSource, /className="desk-prompt-dock"/);
});

test("TestDesktopUiSurfaceShouldProvideStructuredProjectAndMcpForms", () => {
  const styleSource = readDesktopSource("src/styles.css");
  const projectSettingsSource = readDesktopSource("src/modules/agent/pages/project-settings-page.tsx");
  const mcpPageSource = readDesktopSource("src/modules/common/pages/mcp-page.tsx");
  const primitivesSource = readDesktopSource("src/widgets/settings-primitives.tsx");

  // 描述：
  //
  //   - 项目设置页应使用显式的控件宽度容器和知识分区块，避免输入控件直接把未知 props 透传到 DOM。
  assert.match(primitivesSource, /className="desk-settings-row-main"/);
  assert.match(primitivesSource, /className="desk-settings-row-title"/);
  assert.match(primitivesSource, /className="desk-settings-row-description"/);
  assert.match(styleSource, /\.desk-project-settings-control/);
  assert.match(styleSource, /\.desk-project-settings-control-wide/);
  assert.match(styleSource, /\.desk-project-settings-knowledge-section/);
  assert.match(styleSource, /\.desk-project-settings-knowledge-description/);
  assert.match(projectSettingsSource, /className="desk-project-settings-control desk-project-settings-control-compact"/);
  assert.match(projectSettingsSource, /className="desk-project-settings-control desk-project-settings-control-wide"/);
  assert.match(projectSettingsSource, /className="desk-project-settings-knowledge-section"/);
  assert.doesNotMatch(projectSettingsSource, /minWidth=\{280\}/);
  assert.doesNotMatch(projectSettingsSource, /minWidth=\{360\}/);

  // 描述：
  //
  //   - MCP 编辑器应使用更宽的弹窗和独立表单滚动容器，避免窄单列长表单的可读性问题。
  assert.match(styleSource, /--desk-mcp-editor-modal-width:\s*calc\(var\(--z-inset\) \* 56\);/);
  assert.match(styleSource, /\.desk-mcp-editor-modal/);
  assert.match(styleSource, /\.desk-mcp-editor-form-wrap/);
  assert.match(styleSource, /\.desk-mcp-editor-form/);
  assert.match(mcpPageSource, /className="desk-mcp-editor-modal"/);
  assert.match(mcpPageSource, /width="var\(--desk-mcp-editor-modal-width\)"/);
  assert.match(mcpPageSource, /className="desk-mcp-editor-form-wrap"/);
  assert.match(mcpPageSource, /className="desk-mcp-editor-form"/);
});
