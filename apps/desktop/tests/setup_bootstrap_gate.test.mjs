import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：读取 Desktop 源码文件，供初始化阻断链路回归测试复用。
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

test("TestDesktopBackendApiShouldExposeSetupStatusRequest", () => {
  const source = readDesktopSource("src/shared/services/backend-api.ts");
  const endpointSource = readDesktopSource("src/shared/services/service-endpoints.ts");

  // 描述:
  //
  //   - Desktop 后端 API 层应通过统一后端入口解析 setup 服务地址，并在本地模式下允许跳过远端 setup。
  assert.match(source, /import \{\s*buildDesktopBackendBaseUrl,/s);
  assert.match(source, /function resolveConfiguredServiceBaseUrl\(/);
  assert.match(source, /return buildDesktopBackendBaseUrl\(\);/);
  assert.match(source, /export async function getSetupStatus\(\): Promise<SetupStatus> \{/);
  assert.match(source, /if \(!isDesktopBackendEnabled\(\)\) \{/);
  assert.match(source, /const setupBaseUrl = resolveConfiguredServiceBaseUrl\("setup"\);/);
  assert.match(source, /`\$\{setupBaseUrl\}\/setup\/v1\/status`/);
  assert.match(source, /auth: false,/);

  // 描述:
  //
  //   - 后端接入配置应持久化到本地，并支持根据统一入口拼接初始化地址。
  assert.match(endpointSource, /export function readDesktopBackendConfig\(\): DesktopBackendConfig \{/);
  assert.match(endpointSource, /export function saveDesktopBackendConfig\(nextConfig: DesktopBackendConfig\): DesktopBackendConfig \{/);
  assert.match(endpointSource, /export function resetDesktopBackendConfig\(\): DesktopBackendConfig \{/);
  assert.match(endpointSource, /export function hasEnabledDesktopBackend\(/);
  assert.match(endpointSource, /export function buildDesktopBackendBaseUrl\(/);
  assert.match(endpointSource, /export function buildDesktopWebSetupUrl\(\s*config: DesktopBackendConfig = readDesktopBackendConfig\(\),\s*\): string \{/s);
  assert.match(endpointSource, /STORAGE_KEYS\.DESKTOP_BACKEND_CONFIG/);
});

test("TestDesktopAppShouldSupportOptionalBackendMode", () => {
  const source = readDesktopSource("src/app.tsx");

  // 描述:
  //
  //   - Desktop 启动时仅在已启用后端时检查 setup；未接入后端时直接进入本地模式。
  assert.match(source, /interface DesktopSetupGateState/);
  assert.match(source, /buildDesktopWebSetupUrl/);
  assert.match(source, /readDesktopBackendConfig/);
  assert.match(source, /saveDesktopBackendConfig/);
  assert.match(source, /resetDesktopBackendConfig/);
  assert.match(source, /const \[backendConfig, setBackendConfig\] = useState<DesktopBackendConfig>\(\(\) => readDesktopBackendConfig\(\)\);/);
  assert.match(source, /const backendEnabled = hasEnabledDesktopBackend\(backendConfig\);/);
  assert.match(source, /const \[desktopSetupGate, setDesktopSetupGate\] = useState<DesktopSetupGateState>\(/);
  assert.match(source, /const refreshDesktopSetupGate = useCallback\(async \(\) => \{/);
  assert.match(source, /const status = await getSetupStatus\(\);/);
  assert.match(source, /const updateBackendConfig = useCallback\(\(nextConfig: DesktopBackendConfig\) => \{/);
  assert.match(source, /const restoreBackendConfig = useCallback\(\(\) => \{/);
  assert.match(source, /setUser\(getLocalDesktopUser\(\)\);/);
  assert.match(source, /setAvailableAgents\(getLocalAvailableAgents\(\)\);/);
  assert.match(source, /const saveSetupGateBackendConfig = useCallback\(/);
  assert.match(source, /const switchToLocalDesktopMode = useCallback\(async \(\) => \{/);
  assert.match(source, /const desktopRouterFuture = \{/);
  assert.match(source, /v7_startTransition: true,/);
  assert.match(source, /v7_relativeSplatPath: true,/);
  assert.match(source, /await invoke<boolean>\("open_external_url", \{ url: desktopSetupGate\.setupUrl \}\);/);
  assert.match(source, /const shouldShowSetupGate = backendEnabled && \(desktopSetupGate\.checking \|\| desktopSetupGate\.installed !== true\);/);
  assert.match(source, /<SetupRequiredPage/);
  assert.match(source, /<HashRouter future=\{desktopRouterFuture\}>/);
  assert.match(source, /backendConfig=\{backendConfig\}/);
  assert.match(source, /onOpenSetup=\{openDesktopSetupUrl\}/);
  assert.match(source, /onUseLocalMode=\{switchToLocalDesktopMode\}/);
  assert.match(source, /onSaveBackendConfig=\{saveSetupGateBackendConfig\}/);
});

test("TestDesktopShouldRenderSetupRequiredPageWithBackendEntry", () => {
  const pageSource = readDesktopSource("src/modules/common/pages/setup-required-page.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述:
  //
  //   - 未初始化阻断页应仅暴露统一后端地址输入，并允许切回本地模式。
  assert.match(pageSource, /export function SetupRequiredPage/);
  assert.match(pageSource, /const \[backendBaseUrl, setBackendBaseUrl\] = useState\(backendConfig\.baseUrl\);/);
  assert.match(pageSource, /label=\{t\("后端地址"\)\}/);
  assert.match(pageSource, /label=\{saving \? t\("检查中\.\.\."\) : t\("保存并检查"\)\}/);
  assert.match(pageSource, /value=\{checking \? t\("检查后端状态"\) : t\("后端尚未完成初始化"\)\}/);
  assert.match(pageSource, /label=\{t\("打开初始化"\)\}/);
  assert.match(pageSource, /label=\{t\("本地进入"\)\}/);
  assert.match(pageSource, /value=\{t\("初始化入口：\{\{url\}\}", \{ url: setupUrl \}\)\}/);
  assert.match(pageSource, /value=\{t\("当前步骤：\{\{step\}\}", \{ step: currentStep \}\)\}/);
  assert.match(styleSource, /--desk-setup-card-width:/);
  assert.match(styleSource, /\.desk-setup-required-card/);
  assert.match(styleSource, /\.desk-setup-required-status/);
  assert.match(styleSource, /\.desk-setup-required-form/);
  assert.match(styleSource, /\.desk-setup-required-actions/);
});
