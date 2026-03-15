import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 布局与样式源码，校验窗口拖动头部区域配置。
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

test("TestDesktopShouldRenderFloatingHeaderWithDragRegion", () => {
  const layoutSource = readDesktopSource("src/shell/layout.tsx");
  const headerWidgetSource = readDesktopSource("src/widgets/app-header/index.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 布局层应接入全局标题栏组件，并保留侧边栏折叠与调试浮窗可见性状态。
  assert.match(layoutSource, /<DesktopAppHeader/);
  assert.match(layoutSource, /<DevDebugFloat visible=\{debugFloatVisible\} \/>/);
  assert.match(layoutSource, /setSidebarCollapsed/);

  // 描述：
  //
  //   - 标题栏组件应提供 drag-region 与页面 slot。
  assert.match(headerWidgetSource, /className="desk-app-header"/);
  assert.doesNotMatch(headerWidgetSource, /<AriContainer[^>]*className="desk-app-header"[^>]*data-tauri-drag-region/);
  assert.doesNotMatch(headerWidgetSource, /<AriFlex[^>]*className="desk-app-header-inner"[^>]*data-tauri-drag-region/);
  assert.doesNotMatch(headerWidgetSource, /<AriContainer[^>]*className="desk-app-header-slot"[^>]*data-tauri-drag-region/);
  assert.doesNotMatch(headerWidgetSource, /<AriFlex[^>]*className="desk-app-header-slot-inner"[^>]*data-tauri-drag-region/);
  assert.match(headerWidgetSource, /className="desk-app-header-leading-drag-region"[\s\S]*data-tauri-drag-region/);
  assert.match(headerWidgetSource, /id="desk-app-header-slot"[\s\S]*data-tauri-drag-region/);

  // 描述：
  //
  //   - 样式层应定义悬浮 header 高度，并支持侧边栏折叠布局。
  assert.match(styleSource, /\.desk-app-header \{/);
  assert.match(styleSource, /height:\s*var\(--desk-app-header-height\);/);
  assert.match(styleSource, /\.desk-app-header-leading-drag-region,\s*\.desk-app-header-slot-content,[\s\S]*-webkit-app-region:\s*drag;/);
  assert.match(styleSource, /\.desk-app-header-leading-drag-region\s*\{[\s\S]*flex:\s*1 1 auto;/);
  assert.doesNotMatch(styleSource, /\.desk-app-header-slot\s*\{[\s\S]*-webkit-app-region:\s*drag;/);
  assert.match(styleSource, /\.desk-app-header-leading-actions,[\s\S]*\.desk-app-header-window-controls \*,[\s\S]*-webkit-app-region:\s*no-drag;/);
  assert.match(styleSource, /\.desk-app-header button,[\s\S]*\.desk-app-header button \*,[\s\S]*-webkit-app-region:\s*no-drag;/);
  assert.doesNotMatch(styleSource, /\.desk-app-header \[role="button"\]/);
  assert.match(styleSource, /\.desk-app\.is-sidebar-collapsed \{/);
});
