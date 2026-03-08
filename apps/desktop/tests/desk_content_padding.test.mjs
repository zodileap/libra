import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，验证 desk-content 容器的统一 padding 约束。
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
//   - 提取源码中所有 className 含 desk-content 的 AriContainer 起始标签。
//
// Params:
//
//   - source: 文件源码文本。
//
// Returns:
//
//   - 符合条件的 JSX 起始标签文本列表。
function collectDeskContentContainerTags(source) {
  const matcher = /<AriContainer[^>]*className=\"desk-content[^\"]*\"[^>]*>/g;
  return source.match(matcher) ?? [];
}

test("TestDeskContentContainersShouldUseUnifiedProps", () => {
  const agentSource = readDesktopSource("src/widgets/agent/page.tsx");
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const workflowSource = readDesktopSource("src/widgets/workflow/page.tsx");
  const homeSource = readDesktopSource("src/modules/common/pages/home-page.tsx");
  const settingsSource = readDesktopSource("src/modules/common/pages/settings-general-page.tsx");
  const aiKeySource = readDesktopSource("src/modules/common/pages/ai-key-page.tsx");
  const codeSettingsSource = readDesktopSource("src/modules/agent/pages/agent-settings-page.tsx");
  const agentHomeSource = readDesktopSource("src/modules/agent/pages/agent-home-page.tsx");

  const filesToCheck = [
    agentSource,
    sessionSource,
    workflowSource,
    homeSource,
    settingsSource,
    aiKeySource,
    codeSettingsSource,
    agentHomeSource,
  ];

  // 描述：
  //
  //   - 所有 desk-content 容器禁止继续传入 padding prop，需统一由 CSS 控制。
  //   - 所有 desk-content 容器需显式关闭圆角，避免与页面边缘融合时出现额外圆角。
  for (const source of filesToCheck) {
    const tags = collectDeskContentContainerTags(source);
    assert.equal(tags.length > 0, true, "源码中应至少存在一个 desk-content 容器");
    for (const tag of tags) {
      assert.equal(/padding=/.test(tag), false, `desk-content 容器不应传入 padding prop: ${tag}`);
      assert.equal(
        /showBorderRadius=\{false\}/.test(tag),
        true,
        `desk-content 容器必须显式设置 showBorderRadius={false}: ${tag}`
      );
    }
  }
});

test("TestDeskMainShouldPassPaddingZero", () => {
  const layoutSource = readDesktopSource("src/shell/layout.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - desk-main 容器应通过组件 props 显式传入 padding={0}。
  assert.match(layoutSource, /className=\"desk-main\"[\s\S]*padding=\{0\}/);

  // 描述：
  //
  //   - desk-main 在基础样式与断点样式中都应保持 padding 为 0。
  assert.match(styleSource, /\.desk-main\s*\{[\s\S]*padding:\s*0;/);
  assert.match(styleSource, /@media\s*\(max-width:\s*var\(--desk-breakpoint-lg\)\)\s*\{[\s\S]*\.desk-main\s*\{[\s\S]*padding:\s*0;/);
  assert.match(styleSource, /@media\s*\(max-width:\s*var\(--desk-breakpoint-sm\)\)\s*\{[\s\S]*\.desk-main\s*\{[\s\S]*padding:\s*0;/);
});

test("TestDeskContentShouldAlignTopPaddingWithAgentSidebar", () => {
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - desk-content 与 desk-agent-sidebar 应复用同一顶部留白变量，确保垂直对齐。
  assert.match(styleSource, /--desk-agent-surface-padding-top:\s*calc\(var\(--desk-app-header-height\)\);/);
  assert.match(styleSource, /\.desk-sidebar\s*\{[\s\S]*padding:\s*calc\(var\(--z-inset\) \+ var\(--desk-app-header-height\)\) 0 var\(--z-inset\);/);
  assert.match(styleSource, /\.desk-content\s*\{[\s\S]*padding:\s*0;/);
  assert.match(styleSource, /\.desk-content\s*\{[\s\S]*padding-top:\s*var\(--desk-agent-surface-padding-top\);/);
});
