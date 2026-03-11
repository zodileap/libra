import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 仓库文件文本，供 tauri-driver E2E 基础设施回归断言复用。
//
// Params:
//
//   - relativePath: 基于 apps/desktop 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readDesktopSource(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("TestDesktopE2ESetupShouldExposeTauriDriverScriptsAndPlatformGuard", () => {
  const packageJson = JSON.parse(readDesktopSource("package.json"));
  const helperSource = readDesktopSource("tests/e2e/tauri-driver/helpers.mjs");
  const smokeSource = readDesktopSource("tests/e2e/tauri-driver/desktop-smoke.e2e.mjs");

  // 描述：
  //
  //   - Desktop 包脚本应显式暴露 tauri-driver E2E 入口，避免继续把桌面端到端测试混入 unit/UI 命令。
  assert.equal(
    packageJson.scripts["test:e2e"],
    "node --test ./tests/e2e/tauri-driver/desktop-smoke.e2e.mjs",
  );

  // 描述：
  //
  //   - helpers 应负责平台守卫、tauri-driver 命令解析、Tauri 二进制路径解析与端口等待，避免每个 E2E case 自行复制环境准备逻辑。
  assert.match(helperSource, /export function isSupportedTauriDriverPlatform\(\)/);
  assert.match(helperSource, /process\.platform === "win32" \|\| process\.platform === "linux"/);
  assert.match(helperSource, /官方 Tauri 文档说明 tauri-driver 桌面 E2E 目前仅支持 Windows 和 Linux；当前 darwin 无法运行。/);
  assert.match(helperSource, /export function resolveDesktopBinaryPath\(\)/);
  assert.match(helperSource, /libra_desktop/);
  assert.match(helperSource, /export function resolveTauriDriverCommand\(\)/);
  assert.match(helperSource, /return "tauri-driver";/);
  assert.match(helperSource, /await waitForPort\(TAURI_DRIVER_PORT, 15000\);/);

  // 描述：
  //
  //   - smoke case 应使用 webdriverio remote 直连 tauri-driver，并覆盖真实登录页空密码校验这一条最小桌面链路。
  assert.match(smokeSource, /import \{ remote \} from "webdriverio";/);
  assert.match(smokeSource, /browserName: "wry"/);
  assert.match(smokeSource, /"tauri:options": \{\s*application: resolveDesktopBinaryPath\(\),\s*\}/s);
  assert.match(smokeSource, /window\.location\.hash = "#\/login";/);
  assert.match(smokeSource, /请输入密码后再登录。/);
});
