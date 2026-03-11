import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url);
const CURRENT_DIR_PATH = path.dirname(CURRENT_FILE_PATH);
const DESKTOP_ROOT_PATH = path.resolve(CURRENT_DIR_PATH, "../../..");
const TAURI_ROOT_PATH = path.resolve(DESKTOP_ROOT_PATH, "src-tauri");
const TAURI_MANIFEST_PATH = path.resolve(TAURI_ROOT_PATH, "Cargo.toml");
const TAURI_DRIVER_PORT = 4444;

// 描述：
//
//   - 判断当前平台是否支持官方 tauri-driver Desktop E2E；根据 Tauri 官方文档，macOS 当前不支持这条桌面 WebDriver 链路。
//
// Returns:
//
//   - true: 支持。
//   - false: 不支持。
export function isSupportedTauriDriverPlatform() {
  return process.platform === "win32" || process.platform === "linux";
}

// 描述：
//
//   - 返回当前平台不支持 tauri-driver Desktop E2E 的说明文本；支持平台返回空字符串。
//
// Returns:
//
//   - 平台限制说明。
export function resolveUnsupportedPlatformReason() {
  if (isSupportedTauriDriverPlatform()) {
    return "";
  }
  return "官方 Tauri 文档说明 tauri-driver 桌面 E2E 目前仅支持 Windows 和 Linux；当前 darwin 无法运行。";
}

// 描述：
//
//   - 解析当前桌面客户端构建产物路径，供 tauri-driver 通过 `tauri:options.application` 启动真实应用。
//
// Returns:
//
//   - 调试构建二进制绝对路径。
export function resolveDesktopBinaryPath() {
  const binaryName = process.platform === "win32" ? "libra_desktop.exe" : "libra_desktop";
  return path.resolve(TAURI_ROOT_PATH, "target", "debug", binaryName);
}

// 描述：
//
//   - 解析 tauri-driver 命令路径；优先使用环境变量覆盖，其次读取本机 cargo bin，最后回退到 PATH 中的 `tauri-driver`。
//
// Returns:
//
//   - tauri-driver 可执行命令或绝对路径。
export function resolveTauriDriverCommand() {
  const envCommand = String(process.env.TAURI_DRIVER_COMMAND || "").trim();
  if (envCommand) {
    return envCommand;
  }
  const binaryName = process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver";
  const cargoBinaryPath = path.resolve(os.homedir(), ".cargo", "bin", binaryName);
  if (fs.existsSync(cargoBinaryPath)) {
    return cargoBinaryPath;
  }
  return "tauri-driver";
}

// 描述：
//
//   - 同步执行构建命令，并在失败时抛出带命令文本的错误，便于定位 Desktop E2E 环境准备问题。
//
// Params:
//
//   - command: 可执行命令。
//   - args: 命令参数列表。
//   - cwd: 命令工作目录。
function runCheckedCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`命令执行失败：${[command, ...args].join(" ")}`);
  }
}

// 描述：
//
//   - 预先构建 UI 静态资源与 Tauri 调试二进制，保证 tauri-driver 启动时加载到最新前端与原生容器。
export function buildDesktopE2EArtifacts() {
  runCheckedCommand("pnpm", ["build:ui"], DESKTOP_ROOT_PATH);
  runCheckedCommand("cargo", ["build", "--manifest-path", TAURI_MANIFEST_PATH], DESKTOP_ROOT_PATH);
  const binaryPath = resolveDesktopBinaryPath();
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`未找到 Desktop 调试二进制：${binaryPath}`);
  }
}

// 描述：
//
//   - 等待 WebDriver 端口可连接，确保 tauri-driver 已经完成启动并可以接受 webdriverio 会话。
//
// Params:
//
//   - port: 目标端口。
//   - timeoutMs: 超时时间。
async function waitForPort(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待 tauri-driver 监听端口 ${port} 超时。`);
}

// 描述：
//
//   - 启动 tauri-driver 并等待 WebDriver 端口就绪；若命令缺失或进程提前退出，会返回明确错误。
//
// Returns:
//
//   - tauri-driver 子进程实例。
export async function startTauriDriver() {
  const command = resolveTauriDriverCommand();
  const child = spawn(command, [], {
    cwd: TAURI_ROOT_PATH,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  try {
    await waitForPort(TAURI_DRIVER_PORT, 15000);
  } catch (error) {
    if (exited) {
      throw new Error(`tauri-driver 启动失败，请确认已安装该命令：${command}`);
    }
    throw error;
  }
  return child;
}

// 描述：
//
//   - 优雅结束子进程，避免 Desktop E2E 在失败后残留 tauri-driver 僵尸进程。
//
// Params:
//
//   - child: 待结束的子进程。
export async function stopChildProcess(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      resolve(undefined);
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

// 描述：
//
//   - 暴露 Desktop E2E 目录级常量，供回归测试校验脚本路径与命令约定。
export const DESKTOP_E2E_PATHS = {
  desktopRootPath: DESKTOP_ROOT_PATH,
  tauriRootPath: TAURI_ROOT_PATH,
  tauriManifestPath: TAURI_MANIFEST_PATH,
  tauriDriverPort: TAURI_DRIVER_PORT,
};
