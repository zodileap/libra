import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop Tauri capability 配置，验证自定义标题栏依赖的窗口命令权限已开启。
//
// Returns:
//
//   - capability JSON 对象。
function readDefaultCapability() {
  const configPath = path.resolve(process.cwd(), "src-tauri/capabilities/default.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

test("TestDesktopCapabilityShouldAllowWindowStartDraggingAndWindowControls", () => {
  const capability = readDefaultCapability();
  const permissions = capability?.permissions ?? [];

  // 描述：
  //
  //   - 自定义标题栏既依赖拖拽命令，也依赖最小化、最大化/还原与关闭命令。
  //   - 主题设置还需要原生窗口主题切换权限，保证 macOS 毛玻璃跟随设置页同步变化。
  //   - 缺失任一权限时，前端点击按钮会触发 not allowed 异常。
  assert.equal(Array.isArray(permissions), true, "default capability permissions 必须是数组");
  assert.equal(
    permissions.includes("core:window:allow-start-dragging"),
    true,
    "default capability 必须包含 core:window:allow-start-dragging"
  );
  assert.equal(
    permissions.includes("core:window:allow-set-theme"),
    true,
    "default capability 必须包含 core:window:allow-set-theme"
  );
  assert.equal(
    permissions.includes("core:window:allow-minimize"),
    true,
    "default capability 必须包含 core:window:allow-minimize"
  );
  assert.equal(
    permissions.includes("core:window:allow-toggle-maximize"),
    true,
    "default capability 必须包含 core:window:allow-toggle-maximize"
  );
  assert.equal(
    permissions.includes("core:window:allow-close"),
    true,
    "default capability 必须包含 core:window:allow-close"
  );
});
