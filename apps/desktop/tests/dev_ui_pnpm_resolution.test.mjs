import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 描述：
//
//   - 加载 Desktop UI 开发脚本统一入口模块，验证它能把不同系统分发到独立脚本文件。
//
// Returns:
//
//   - 统一入口模块。
async function loadDevUiDispatcherModule() {
  const modulePath = path.resolve(process.cwd(), "scripts/dev-ui.mjs");
  return import(pathToFileURL(modulePath).href);
}

// 描述：
//
//   - 加载 Windows 平台脚本模块，验证其运行配置与命令入口。
//
// Returns:
//
//   - Windows 平台脚本模块。
async function loadWindowsDevUiModule() {
  const modulePath = path.resolve(process.cwd(), "scripts/dev-ui.windows.mjs");
  return import(pathToFileURL(modulePath).href);
}

// 描述：
//
//   - 加载 macOS 平台脚本模块，验证其运行配置与命令入口。
//
// Returns:
//
//   - macOS 平台脚本模块。
async function loadMacosDevUiModule() {
  const modulePath = path.resolve(process.cwd(), "scripts/dev-ui.macos.mjs");
  return import(pathToFileURL(modulePath).href);
}

// 描述：
//
//   - 加载 Linux 平台脚本模块，验证其运行配置与命令入口。
//
// Returns:
//
//   - Linux 平台脚本模块。
async function loadLinuxDevUiModule() {
  const modulePath = path.resolve(process.cwd(), "scripts/dev-ui.linux.mjs");
  return import(pathToFileURL(modulePath).href);
}

// 描述：
//
//   - 读取 Desktop 包配置，验证 `scripts` 已经按系统暴露明确入口。
//
// Returns:
//
//   - `apps/desktop/package.json` 的解析结果。
function readDesktopPackageJson() {
  const packagePath = path.resolve(process.cwd(), "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8"));
}

test("TestDesktopDevUiDispatcherShouldResolveSystemSpecificScriptPath", async () => {
  const { resolveDevUiScriptPath } = await loadDevUiDispatcherModule();

  // 描述：
  //
  //   - 统一入口应把 Windows、macOS、Linux 分发到各自独立的系统脚本。
  assert.equal(path.basename(resolveDevUiScriptPath("win32")), "dev-ui.windows.mjs");
  assert.equal(path.basename(resolveDevUiScriptPath("darwin")), "dev-ui.macos.mjs");
  assert.equal(path.basename(resolveDevUiScriptPath("linux")), "dev-ui.linux.mjs");
  assert.throws(() => resolveDevUiScriptPath("freebsd"), /unsupported platform: freebsd/);
});

test("TestDesktopDevUiWindowsScriptShouldUseWindowsRuntime", async () => {
  const { resolveWindowsDevUiRuntime } = await loadWindowsDevUiModule();
  const runtime = resolveWindowsDevUiRuntime();

  // 描述：
  //
  //   - Windows 专用脚本必须显式落到 `pnpm.cmd` 并开启 shell，以匹配本机命令解析行为。
  assert.deepEqual(runtime, {
    systemName: "windows",
    pnpmCommand: "pnpm.cmd",
    useShell: true,
    listPidsOnPort: runtime.listPidsOnPort,
    killPid: runtime.killPid,
  });
});

test("TestDesktopDevUiMacosScriptShouldUseMacosRuntime", async () => {
  const { resolveMacosDevUiRuntime } = await loadMacosDevUiModule();
  const runtime = resolveMacosDevUiRuntime();

  // 描述：
  //
  //   - macOS 专用脚本应继续使用原始 `pnpm` 入口，并保持非 shell 启动。
  assert.deepEqual(runtime, {
    systemName: "macos",
    pnpmCommand: "pnpm",
    useShell: false,
    listPidsOnPort: runtime.listPidsOnPort,
    killPid: runtime.killPid,
  });
});

test("TestDesktopDevUiLinuxScriptShouldUseLinuxRuntime", async () => {
  const { resolveLinuxDevUiRuntime } = await loadLinuxDevUiModule();
  const runtime = resolveLinuxDevUiRuntime();

  // 描述：
  //
  //   - Linux 专用脚本应继续使用原始 `pnpm` 入口，并保持非 shell 启动。
  assert.deepEqual(runtime, {
    systemName: "linux",
    pnpmCommand: "pnpm",
    useShell: false,
    listPidsOnPort: runtime.listPidsOnPort,
    killPid: runtime.killPid,
  });
});

test("TestDesktopPackageShouldExposeSystemSpecificDevUiScripts", () => {
  const packageJson = readDesktopPackageJson();

  // 描述：
  //
  //   - Desktop `package.json` 应同时保留统一入口和按系统拆分后的显式脚本入口。
  assert.equal(packageJson.scripts["dev:ui"], "node ./scripts/dev-ui.mjs");
  assert.equal(packageJson.scripts["dev:ui:windows"], "node ./scripts/dev-ui.windows.mjs");
  assert.equal(packageJson.scripts["dev:ui:macos"], "node ./scripts/dev-ui.macos.mjs");
  assert.equal(packageJson.scripts["dev:ui:linux"], "node ./scripts/dev-ui.linux.mjs");
});
