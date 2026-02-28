import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop Tauri capability 配置，验证窗口拖拽命令权限已开启。
//
// Returns：
//
//   - capability JSON 对象。
function readDefaultCapability() {
  const configPath = path.resolve(process.cwd(), "src-tauri/capabilities/default.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

test("TestDesktopCapabilityShouldAllowWindowStartDragging", () => {
  const capability = readDefaultCapability();
  const permissions = capability?.permissions ?? [];

  // 描述：
  //
  //   - 自定义标题栏拖拽依赖 start_dragging 命令权限，缺失时会触发 not allowed 异常。
  assert.equal(Array.isArray(permissions), true, "default capability permissions 必须是数组");
  assert.equal(
    permissions.includes("core:window:allow-start-dragging"),
    true,
    "default capability 必须包含 core:window:allow-start-dragging"
  );
});
