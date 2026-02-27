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
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 布局层应渲染固定 header 与 data-tauri-drag-region，支持拖动头部移动窗口。
  assert.match(layoutSource, /className="desk-app-header"/);
  assert.match(layoutSource, /data-tauri-drag-region/);
  assert.match(layoutSource, /id="desk-app-header-slot"/);
  assert.match(layoutSource, /setSidebarCollapsed/);

  // 描述：
  //
  //   - 样式层应定义悬浮 header 高度，并支持侧边栏折叠布局。
  assert.match(styleSource, /\.desk-app-header \{/);
  assert.match(styleSource, /height:\s*var\(--desk-app-header-height\);/);
  assert.match(styleSource, /\.desk-app\.is-sidebar-collapsed \{/);
});
