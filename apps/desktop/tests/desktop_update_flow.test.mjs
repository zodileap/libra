import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readDesktopSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

function readRepoSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), "..", "..", relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestDesktopUpdateFlowShouldUseOfficialTauriUpdater", () => {
  const appSource = readDesktopSource("src/app.tsx");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const endpointSource = readDesktopSource("src/shared/services/service-endpoints.ts");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const userMenuSource = readDesktopSource("src/sidebar/widgets/user-hover-menu.tsx");
  const appHeaderSource = readDesktopSource("src/widgets/app-header/index.tsx");
  const routerTypesSource = readDesktopSource("src/router/types.ts");
  const layoutSource = readDesktopSource("src/shell/layout.tsx");
  const tauriSource = readDesktopSource("src-tauri/src/main.rs");
  const tauriCargoSource = readDesktopSource("src-tauri/Cargo.toml");
  const tauriConfigSource = readDesktopSource("src-tauri/tauri.conf.json");
  const tauriConfig = JSON.parse(tauriConfigSource);
  const updaterPubkeyPath = path.resolve(process.cwd(), "src-tauri", "updater", "public.key");
  const rootPackageSource = readRepoSource("package.json");

  assert.match(constantsSource, /CHECK_DESKTOP_UPDATE/);
  assert.match(constantsSource, /GET_DESKTOP_UPDATE_STATE/);
  assert.match(appSource, /buildDesktopUpdateManifestUrl/);
  assert.match(appSource, /const desktopUpdateManifestUrl = buildDesktopUpdateManifestUrl\(backendConfig\);/);
  assert.match(appSource, /COMMANDS\.CHECK_DESKTOP_UPDATE/);
  assert.match(appSource, /if \(!desktopUpdateManifestUrl\) \{/);
  assert.match(appSource, /message: t\("未配置可用更新源"\),/);
  assert.match(appSource, /nextState\.status === "downloading" \|\| nextState\.status === "installing"/);
  assert.match(appSource, /发现新版本时将自动下载并安装，完成后自动重启应用。/);
  assert.match(appSource, /!desktopUpdateManifestUrl \|\| !user/);
  assert.match(endpointSource, /export function buildDesktopUpdateManifestUrl\(/);

  assert.match(routerTypesSource, /desktopUpdateState: DesktopUpdateState;/);
  assert.match(layoutSource, /desktopUpdateState: DesktopUpdateState;/);
  assert.match(layoutSource, /onCheckDesktopUpdate: \(\) => Promise<void>;/);
  assert.match(layoutSource, /onInstallDesktopUpdate: \(\) => Promise<void>;/);
  assert.match(layoutSource, /onCheckDesktopUpdate=\{onCheckDesktopUpdate\}/);
  assert.match(sidebarSource, /desktopUpdateState: DesktopUpdateState;/);
  assert.doesNotMatch(userMenuSource, /const showUpdateButton = desktopUpdateState\.status === "ready";/);
  assert.match(appHeaderSource, /className="desk-app-header-leading-actions"/);
  assert.match(appHeaderSource, /const shouldInstallDesktopUpdate = desktopUpdateState\.status === "ready";/);
  assert.match(appHeaderSource, /const showUpdateButton = shouldInstallDesktopUpdate;/);
  assert.match(appHeaderSource, /const updateButtonLabel = t\("更新"\);/);
  assert.match(appHeaderSource, /\{showUpdateButton \? \(/);
  assert.match(appHeaderSource, /await onInstallDesktopUpdate\(\);/);
  assert.match(appHeaderSource, /color="brand"/);
  assert.doesNotMatch(appHeaderSource, /icon="system_update_alt"/);

  assert.match(tauriSource, /use tauri_plugin_updater::UpdaterExt;/);
  assert.match(tauriSource, /const LOCAL_UPDATER_PUBKEY: Option<&str> = option_env!\("LIBRA_UPDATER_PUBKEY"\);/);
  assert.match(tauriSource, /fn normalize_updater_pubkey\(value: &str\) -> Option<String>/);
  assert.match(tauriSource, /fn resolve_local_updater_pubkey\(\) -> Option<String>/);
  assert.doesNotMatch(tauriSource, /include_str!\("\.\.\/updater\/public\.key"\)/);
  assert.match(tauriSource, /async fn check_desktop_update\(/);
  assert.match(tauriSource, /updater_builder\(\)/);
  assert.match(tauriSource, /\.download_and_install\(/);
  assert.match(tauriSource, /app_handle\.restart\(\);/);
  assert.match(tauriSource, /check_desktop_update,/);
  assert.match(tauriSource, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(tauriCargoSource, /tauri-plugin-updater/);
  assert.equal(tauriConfig.identifier, "com.libra.zodileap.desktop");
  assert.match(tauriConfigSource, /"createUpdaterArtifacts": true/);
  assert.match(tauriConfigSource, /"identifier": "com\.libra\.zodileap\.desktop"/);
  assert.match(tauriConfigSource, /"macOS": \{/);
  assert.match(tauriConfigSource, /"hardenedRuntime": true/);
  assert.match(tauriConfigSource, /"entitlements": "Entitlements\.plist"/);
  assert.match(tauriConfigSource, /"plugins": \{/);
  assert.match(tauriConfigSource, /"updater": \{/);
  assert.match(tauriConfigSource, /"endpoints": \[/);
  assert.doesNotMatch(tauriConfigSource, /Authority=Developer ID Application:\s+[A-Za-z0-9][^<\n]*\([A-Z0-9]{10}\)/);
  assert.doesNotMatch(tauriConfigSource, /Developer ID Application:\s+[A-Za-z0-9][^<\n]*\([A-Z0-9]{10}\)/);
  assert.doesNotMatch(tauriConfigSource, /TeamIdentifier=\s*[A-Z0-9]{10}/);
  assert.doesNotMatch(tauriConfigSource, /export APPLE_TEAM_ID='[A-Z0-9]{10}'/);
  assert.doesNotMatch(tauriConfigSource, /export APPLE_API_ISSUER='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i);
  assert.doesNotMatch(tauriConfigSource, /export APPLE_API_KEY='[A-Z0-9]{10}'/);
  assert.doesNotMatch(tauriConfigSource, /Notarization Ticket=/);
  assert.equal(tauriConfig.plugins?.updater?.pubkey, "");
  assert.equal(fs.existsSync(updaterPubkeyPath), false);
  assert.doesNotMatch(tauriConfigSource, /dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWdu/);

  assert.match(rootPackageSource, /"release:desktop": "node scripts\/package-desktop-release\.mjs"/);
});
