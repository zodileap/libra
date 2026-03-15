import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url);
const CURRENT_DIR_PATH = path.dirname(CURRENT_FILE_PATH);

// 描述：
//
//   - 按当前运行平台解析 Desktop UI 开发脚本入口，确保系统差异落到独立脚本文件中维护。
//
// Params:
//
//   - platform: 目标平台标识。
//     default: process.platform
//
// Returns:
//
//   - Windows 返回 `dev-ui.windows.mjs`。
//   - macOS 返回 `dev-ui.macos.mjs`。
//   - Linux 返回 `dev-ui.linux.mjs`。
export function resolveDevUiScriptPath(platform = process.platform) {
  if (platform === "win32") {
    return path.resolve(CURRENT_DIR_PATH, "dev-ui.windows.mjs");
  }
  if (platform === "darwin") {
    return path.resolve(CURRENT_DIR_PATH, "dev-ui.macos.mjs");
  }
  if (platform === "linux") {
    return path.resolve(CURRENT_DIR_PATH, "dev-ui.linux.mjs");
  }

  throw new Error(`unsupported platform: ${platform}`);
}

// 描述：
//
//   - 加载当前平台对应的 Desktop UI 开发脚本模块，供统一入口复用。
//
// Params:
//
//   - platform: 目标平台标识。
//     default: process.platform
//
// Returns:
//
//   - 当前平台脚本模块。
export async function loadDevUiScriptModule(platform = process.platform) {
  return import(pathToFileURL(resolveDevUiScriptPath(platform)).href);
}

// 描述：
//
//   - 执行当前平台对应的 Desktop UI 开发脚本主流程。
//
// Params:
//
//   - platform: 目标平台标识。
//     default: process.platform
export async function main(platform = process.platform) {
  const scriptModule = await loadDevUiScriptModule(platform);
  await scriptModule.main();
}

if (process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILE_PATH) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dev:ui] ${message}`);
    process.exit(1);
  });
}
