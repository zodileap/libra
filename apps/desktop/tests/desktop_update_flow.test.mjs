import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 客户端源码文件，用于版本更新全流程回归测试。
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

// 描述：
//
//   - 读取仓库根目录源码文件，用于跨端（Desktop + 服务端）联动回归测试。
//
// Params:
//
//   - relativePath: 基于仓库根目录的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readRepoSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), "..", "..", relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestDesktopUpdateFlowShouldConnectApiDownloadAndInstall", () => {
  const appSource = readDesktopSource("src/app.tsx");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const backendApiSource = readDesktopSource("src/shared/services/backend-api.ts");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const userMenuSource = readDesktopSource("src/sidebar/widgets/user-hover-menu.tsx");
  const appHeaderSource = readDesktopSource("src/widgets/app-header/index.tsx");
  const routerTypesSource = readDesktopSource("src/router/types.ts");
  const layoutSource = readDesktopSource("src/shell/layout.tsx");
  const tauriSource = readDesktopSource("src-tauri/src/main.rs");
  const tauriCargoSource = readDesktopSource("src-tauri/Cargo.toml");
  const rootPackageSource = readRepoSource("package.json");
  const runtimeApiSource = readRepoSource("services/runtime/api/v1/workflow.go");
  const runtimeServiceSource = readRepoSource("services/runtime/service/v1/workflow_service.go");
  const runtimeSpecsSource = readRepoSource("services/runtime/specs/v1/workflow.go");

  // 描述：
  //
  //   - 前端应声明更新命令常量，并通过 App 层串联“检查->下载->安装”流程。
  assert.match(constantsSource, /GET_DESKTOP_RUNTIME_INFO/);
  assert.match(constantsSource, /START_DESKTOP_UPDATE_DOWNLOAD/);
  assert.match(constantsSource, /GET_DESKTOP_UPDATE_STATE/);
  assert.match(constantsSource, /INSTALL_DOWNLOADED_DESKTOP_UPDATE/);
  assert.match(appSource, /requestDesktopUpdateCheck/);
  assert.match(appSource, /const checkDesktopUpdate = useCallback/);
  assert.match(appSource, /COMMANDS\.START_DESKTOP_UPDATE_DOWNLOAD/);
  assert.match(appSource, /COMMANDS\.INSTALL_DOWNLOADED_DESKTOP_UPDATE/);
  assert.match(appSource, /desktopUpdateState/);
  assert.match(appSource, /checkDesktopUpdate,/);
  assert.match(appSource, /installDesktopUpdate,/);
  assert.match(appSource, /window\.setInterval\(\(\) => \{\s*void syncDesktopUpdateState\(\)\.then\(\(nextState\) => \{/s);

  // 描述：
  //
  //   - API 层应通过 runtime workflow 接口完成桌面更新检查请求。
  assert.match(backendApiSource, /export interface DesktopUpdateCheckResult/);
  assert.match(backendApiSource, /export async function checkDesktopUpdate\(/);
  assert.match(backendApiSource, /\/workflow\/v1\/desktop-update\/check/);

  // 描述：
  //
  //   - 路由与布局层应透传更新状态，标题栏左侧在下载完成后展示更新按钮。
  assert.match(routerTypesSource, /desktopUpdateState: DesktopUpdateState;/);
  assert.match(layoutSource, /desktopUpdateState: DesktopUpdateState;/);
  assert.match(layoutSource, /onCheckDesktopUpdate: \(\) => Promise<void>;/);
  assert.match(layoutSource, /onInstallDesktopUpdate: \(\) => Promise<void>;/);
  assert.match(sidebarSource, /desktopUpdateState: DesktopUpdateState;/);
  assert.doesNotMatch(userMenuSource, /const showUpdateButton = desktopUpdateState\.status === "ready";/);
  assert.match(appHeaderSource, /className="desk-app-header-leading-actions"/);
  assert.match(appHeaderSource, /const showUpdateButton = desktopUpdateState\.status === "ready";/);
  assert.match(appHeaderSource, /icon="system_update_alt"/);
  assert.match(appHeaderSource, /await onInstallDesktopUpdate\(\);/);

  // 描述：
  //
  //   - Tauri 后端应实现更新状态管理、后台下载和安装命令，并在 invoke_handler 注册。
  assert.match(tauriSource, /struct DesktopUpdateDownloadRequest/);
  assert.match(tauriSource, /fn start_desktop_update_download\(/);
  assert.match(tauriSource, /fn get_desktop_update_state\(/);
  assert.match(tauriSource, /fn install_downloaded_desktop_update\(/);
  assert.match(tauriSource, /fn get_desktop_runtime_info\(/);
  assert.match(tauriSource, /download_desktop_update_package/);
  assert.match(tauriSource, /open_downloaded_update_installer/);
  assert.match(tauriSource, /start_desktop_update_download,/);
  assert.match(tauriSource, /install_downloaded_desktop_update,/);
  assert.match(tauriCargoSource, /reqwest/);
  assert.match(tauriCargoSource, /sha2/);

  // 描述：
  //
  //   - Runtime 服务端应提供桌面更新检查接口，支持版本与平台参数。
  assert.match(runtimeSpecsSource, /type WorkflowDesktopUpdateCheckReq struct/);
  assert.match(runtimeSpecsSource, /type WorkflowDesktopUpdateCheckResp struct/);
  assert.match(runtimeApiSource, /group\.GET\("\/desktop-update\/check", base\.desktopUpdateCheck\)/);
  assert.match(runtimeApiSource, /func \(api \*BaseWorkflow\) desktopUpdateCheck/);
  assert.match(runtimeServiceSource, /func \(s \*WorkflowService\) CheckDesktopUpdate/);
  assert.match(runtimeServiceSource, /compareSemverVersion/);
  assert.match(runtimeServiceSource, /resolveDesktopUpdateDownloadURL/);

  // 描述：
  //
  //   - 根目录应提供一键打包命令入口，方便桌面端统一构建与打包。
  assert.match(rootPackageSource, /"package:desktop": "pnpm --dir apps\/desktop package"/);
});
