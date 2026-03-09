import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readDesktopSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestSettingsGeneralPageShouldExposeDesktopBackendConfig", () => {
  const pageSource = readDesktopSource("src/modules/common/pages/settings-general-page.tsx");
  const routerSource = readDesktopSource("src/router/index.tsx");
  const authTypeSource = readDesktopSource("src/router/types.ts");
  const i18nSource = readDesktopSource("src/shared/i18n/index.tsx");
  const messagesSource = readDesktopSource("src/shared/i18n/messages.ts");
  const endpointSource = readDesktopSource("src/shared/services/service-endpoints.ts");
  const sharedTypeSource = readDesktopSource("src/shared/types.ts");

  assert.match(pageSource, /interface SettingsGeneralPageProps/);
  assert.match(pageSource, /backendConfig: DesktopBackendConfig;/);
  assert.match(pageSource, /onBackendConfigChange: \(value: DesktopBackendConfig\) => DesktopBackendConfig;/);
  assert.match(pageSource, /onBackendConfigReset: \(\) => DesktopBackendConfig;/);
  assert.match(pageSource, /DeskSectionTitle title=\{t\("Backend"\)\}/);
  assert.match(pageSource, /title=\{t\("Use Backend"\)\}/);
  assert.match(pageSource, /title=\{t\("Backend URL"\)\}/);
  assert.match(pageSource, /title=\{t\("Update Manifest URL"\)\}/);
  assert.match(pageSource, /value=\{backendDraft\.updateManifestUrl\}/);
  assert.match(pageSource, /placeholder="https:\/\/open\.zodileap\.com\/libra\/updates\/latest\.json"/);
  assert.match(pageSource, /默认使用官方静态 latest\.json；你也可以改成自己私有部署的 HTTPS 地址。留空时将不检查桌面端更新。/);
  assert.match(pageSource, /label=\{t\("保存设置"\)\}/);
  assert.match(pageSource, /label=\{t\("恢复默认"\)\}/);
  assert.match(pageSource, /backendStatus/);
  assert.match(pageSource, /isValidUpdateManifestUrl/);
  assert.match(pageSource, /setBackendStatus\(t\("后端与更新源配置已保存。"\)\);/);
  assert.match(pageSource, /setBackendStatus\(t\("更新源配置已保存；当前为本地模式。"\)\);/);
  assert.match(pageSource, /setBackendStatus\(t\("已切换为本地模式，且未启用自动更新。"\)\);/);
  assert.match(pageSource, /setBackendStatus\(t\("后端与更新源配置已恢复为默认值。"\)\);/);
  assert.match(pageSource, /const \{ languagePreference, setLanguagePreference, t \} = useDesktopI18n\(\);/);
  assert.match(pageSource, /value=\{languagePreference\}/);
  assert.match(pageSource, /DESKTOP_LANGUAGE_PREFERENCES\.map\(\(item\) => \(\{/);
  assert.match(pageSource, /label: item === "auto" \? t\("自动检测"\) : getDesktopLanguageNativeLabel\(item\),/);
  assert.match(pageSource, /if \(value === "auto" \|\| value === "zh-CN" \|\| value === "en-US"\) \{\s*setLanguagePreference\(value\);/s);

  assert.match(i18nSource, /languagePreference: DesktopLanguagePreference;/);
  assert.match(i18nSource, /setLanguagePreference: \(value: DesktopLanguagePreference\) => void;/);
  assert.match(i18nSource, /export function clearStoredDesktopLanguage\(\): void \{/);
  assert.match(i18nSource, /const setLanguagePreference = \(value: DesktopLanguagePreference\) => \{/);
  assert.match(i18nSource, /if \(value === "auto"\) \{\s*clearStoredDesktopLanguage\(\);/s);
  assert.match(i18nSource, /languagePreference: followSystemLanguage \? "auto" : language,/);
  assert.match(messagesSource, /export const DESKTOP_LANGUAGE_PREFERENCES: DesktopLanguagePreference\[] = \["auto", \.\.\.DESKTOP_LANGUAGES\];/);
  assert.match(messagesSource, /"自动检测": "自动检测"/);
  assert.match(messagesSource, /"自动检测": "Auto Detect"/);
  assert.match(messagesSource, /"Update Manifest URL": "Update Manifest URL"/);
  assert.match(messagesSource, /"默认使用官方静态 latest\.json；你也可以改成自己私有部署的 HTTPS 地址。留空时将不检查桌面端更新。"/);
  assert.match(messagesSource, /"后端与更新源配置已保存。": "Backend and update source settings were saved\."/);
  assert.match(messagesSource, /"更新源配置已保存；当前为本地模式。": "Update source saved\. Desktop remains in local mode\."/);
  assert.match(messagesSource, /"已切换为本地模式，且未启用自动更新。": "Switched to local mode and automatic updates are disabled\."/);

  assert.match(endpointSource, /const defaultDesktopUpdateManifestUrl = "https:\/\/open\.zodileap\.com\/libra\/updates\/latest\.json";/);
  assert.match(sharedTypeSource, /updateManifestUrl: string;/);
  assert.match(endpointSource, /normalizeDesktopUpdateManifestUrl/);
  assert.match(endpointSource, /import\.meta\.env\.VITE_DESKTOP_UPDATE_MANIFEST_URL/);
  assert.match(endpointSource, /updateManifestUrl: envUpdateManifestUrl,/);
  assert.match(endpointSource, /updateManifestUrl: normalizeDesktopUpdateManifestUrl\(parsed\.updateManifestUrl, defaults\.updateManifestUrl\),/);
  assert.match(endpointSource, /updateManifestUrl: normalizeDesktopUpdateManifestUrl\(nextConfig\.updateManifestUrl, ""\),/);
  assert.match(endpointSource, /export function buildDesktopUpdateManifestUrl\(/);

  assert.match(routerSource, /backendConfig=\{auth\.backendConfig\}/);
  assert.match(routerSource, /onBackendConfigChange=\{auth\.setBackendConfig\}/);
  assert.match(routerSource, /onBackendConfigReset=\{auth\.resetBackendConfig\}/);
  assert.match(authTypeSource, /backendConfig: DesktopBackendConfig;/);
  assert.match(authTypeSource, /setBackendConfig: \(value: DesktopBackendConfig\) => DesktopBackendConfig;/);
  assert.match(authTypeSource, /resetBackendConfig: \(\) => DesktopBackendConfig;/);
});
