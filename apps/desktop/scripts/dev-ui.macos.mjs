import path from "node:path";
import { fileURLToPath } from "node:url";
import { killUnixPid, listUnixPidsOnPort, runDevUi } from "./dev-ui.shared.mjs";

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url);

// 描述：
//
//   - 组装 macOS 平台专用的 Desktop UI 开发脚本运行配置，保留单独脚本入口，便于后续追加系统差异。
//
// Returns:
//
//   - systemName: 系统标识。
//   - pnpmCommand: 当前系统使用的 pnpm 命令。
//   - useShell: 当前系统是否需要通过 shell 启动。
//   - listPidsOnPort: 端口占用检测函数。
//   - killPid: 进程结束函数。
export function resolveMacosDevUiRuntime() {
  return {
    systemName: "macos",
    pnpmCommand: "pnpm",
    useShell: false,
    listPidsOnPort: listUnixPidsOnPort,
    killPid: killUnixPid,
  };
}

// 描述：
//
//   - 运行 macOS 平台专用的 Desktop UI 开发脚本。
export async function main() {
  await runDevUi(resolveMacosDevUiRuntime());
}

if (process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILE_PATH) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dev:ui:macos] ${message}`);
    process.exit(1);
  });
}
