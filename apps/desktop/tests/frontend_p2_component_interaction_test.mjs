import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取 Desktop 工程内指定源码文件，供前端交互与组件回归测试复用。
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

test("TestFeedbackStateComponentDefinesUnifiedKindsAndStructure", () => {
  const source = readDesktopSource("src/modules/client/widgets/feedback-states.tsx");

  // 描述:
  //
  //   - 统一反馈组件必须覆盖 loading/empty/error 三种状态，并保持统一的外层 class 结构。
  assert.match(source, /type DeskFeedbackKind = "loading" \| "empty" \| "error";/);
  assert.match(source, /className=\{`desk-feedback-state desk-feedback-state-\$\{kind\}`\}/);
  assert.match(source, /AriTypography variant="h4"/);
  assert.match(source, /AriTypography variant="caption"/);
});

test("TestSessionPageContainsKeyboardAndCopyInteractions", () => {
  const source = readDesktopSource("src/modules/client/pages/session-page.tsx");

  // 描述:
  //
  //   - 会话页应具备键盘发送/关闭能力、复制反馈能力，以及统一反馈态组件接入。
  assert.match(source, /const handlePromptInputKeyDown =/);
  assert.match(source, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /setStatus\("消息内容已复制"\)/);
  assert.match(source, /setStatus\("复制失败，请检查系统剪贴板权限"\)/);
  assert.match(source, /<DeskFeedbackState/);
  assert.match(source, /kind="loading"/);
  assert.match(source, /kind="empty"/);
  assert.match(source, /kind="error"/);
});

test("TestSidebarContainsContextMenuClampingAndEscClose", () => {
  const source = readDesktopSource("src/modules/client/widgets/sidebar/index.tsx");

  // 描述:
  //
  //   - 侧栏右键菜单应具备视口边界约束与 Escape 关闭逻辑，同时保留统一侧栏菜单容器 class。
  assert.match(source, /function clampContextMenuPosition/);
  assert.match(source, /const next = clampContextMenuPosition\(x, y, estimatedWidth, estimatedHeight\);/);
  assert.match(source, /if \(event\.key === "Escape"\)/);
  assert.match(source, /window\.addEventListener\("keydown", onKeydown\);/);
  assert.match(source, /className="desk-sidebar-nav desk-agent-menu"/);
  assert.match(source, /className="desk-sidebar-nav desk-history-menu"/);
});

test("TestDesktopResponsiveAndWindowConstraintsExist", () => {
  const styleSource = readDesktopSource("src/styles.css");
  const tauriConfig = readDesktopSource("src-tauri/tauri.conf.json");

  // 描述:
  //
  //   - Desktop 必须具备最小窗口尺寸、分级断点与统一滚动/焦点可视化规则。
  assert.match(tauriConfig, /"minWidth":\s*1024/);
  assert.match(tauriConfig, /"minHeight":\s*680/);
  assert.match(styleSource, /@media \(max-width: var\(--desk-breakpoint-lg\)\)/);
  assert.match(styleSource, /@media \(max-width: var\(--desk-breakpoint-md\)\)/);
  assert.match(styleSource, /@media \(max-width: var\(--desk-breakpoint-sm\)\)/);
  assert.match(styleSource, /scrollbar-gutter: stable/);
  assert.match(styleSource, /:where\(button, \[role="button"\], a, input, textarea, select, \[tabindex\]\):focus-visible/);
});

test("TestWebResponsiveStructureMaintainsDesktopFirstPolicy", () => {
  const layoutSource = readDesktopSource("../web/src/modules/platform/layout.tsx");
  const webStyleSource = readDesktopSource("../web/src/styles.css");

  // 描述:
  //
  //   - Web 本轮只做样式与结构维护，应保留窄屏菜单显隐和断点规则，不引入额外业务功能。
  assert.match(layoutSource, /const \[isCompact, setIsCompact\] = useState\(false\);/);
  assert.match(layoutSource, /const \[menuVisible, setMenuVisible\] = useState\(true\);/);
  assert.match(layoutSource, /label=\{menuVisible \? "隐藏菜单" : "显示菜单"\}/);
  assert.match(webStyleSource, /--web-breakpoint-md:/);
  assert.match(webStyleSource, /--web-breakpoint-sm:/);
  assert.match(webStyleSource, /@media \(max-width: var\(--web-breakpoint-md\)\)/);
  assert.match(webStyleSource, /@media \(max-width: var\(--web-breakpoint-sm\)\)/);
});
