import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：读取 Desktop 源码文件，供服务端口设置回归测试复用。
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

test("TestSettingsGeneralPageShouldExposeDesktopBackendConfig", () => {
  const pageSource = readDesktopSource("src/modules/common/pages/settings-general-page.tsx");
  const routerSource = readDesktopSource("src/router/index.tsx");
  const authTypeSource = readDesktopSource("src/router/types.ts");
  const i18nSource = readDesktopSource("src/shared/i18n/index.tsx");
  const messagesSource = readDesktopSource("src/shared/i18n/messages.ts");

  // 描述:
  //
  //   - Desktop 设置页应允许维护“是否启用后端 + 后端入口地址”，而不是分别维护多个服务端口。
  assert.match(pageSource, /interface SettingsGeneralPageProps/);
  assert.match(pageSource, /backendConfig: DesktopBackendConfig;/);
  assert.match(pageSource, /onBackendConfigChange: \(value: DesktopBackendConfig\) => DesktopBackendConfig;/);
  assert.match(pageSource, /onBackendConfigReset: \(\) => DesktopBackendConfig;/);
  assert.match(pageSource, /DeskSectionTitle title=\{t\("Backend"\)\}/);
  assert.match(pageSource, /title=\{t\("Use Backend"\)\}/);
  assert.match(pageSource, /title=\{t\("Backend URL"\)\}/);
  assert.match(pageSource, /label=\{t\("保存设置"\)\}/);
  assert.match(pageSource, /label=\{t\("恢复默认"\)\}/);
  assert.match(pageSource, /backendStatus/);
  assert.match(pageSource, /setBackendStatus\(saved.enabled \? t\("后端接入配置已保存。"\) : t\("已切换为本地模式。"\)\);/);
  assert.match(pageSource, /setBackendStatus\(t\("后端接入配置已恢复为默认值。"\)\);/);
  assert.match(pageSource, /const \{ languagePreference, setLanguagePreference, t \} = useDesktopI18n\(\);/);
  assert.match(pageSource, /value=\{languagePreference\}/);
  assert.match(pageSource, /DESKTOP_LANGUAGE_PREFERENCES\.map\(\(item\) => \(\{/);
  assert.match(pageSource, /label: item === "auto" \? t\("自动检测"\) : getDesktopLanguageNativeLabel\(item\),/);
  assert.match(pageSource, /if \(value === "auto" \|\| value === "zh-CN" \|\| value === "en-US"\) \{\s*setLanguagePreference\(value\);/s);

  // 描述:
  //
  //   - 国际化控制器应暴露“自动检测”偏好，并在切换回自动检测时清理显式缓存。
  assert.match(i18nSource, /languagePreference: DesktopLanguagePreference;/);
  assert.match(i18nSource, /setLanguagePreference: \(value: DesktopLanguagePreference\) => void;/);
  assert.match(i18nSource, /export function clearStoredDesktopLanguage\(\): void \{/);
  assert.match(i18nSource, /const setLanguagePreference = \(value: DesktopLanguagePreference\) => \{/);
  assert.match(i18nSource, /if \(value === "auto"\) \{\s*clearStoredDesktopLanguage\(\);/s);
  assert.match(i18nSource, /languagePreference: followSystemLanguage \? "auto" : language,/);
  assert.match(messagesSource, /export const DESKTOP_LANGUAGE_PREFERENCES: DesktopLanguagePreference\[] = \["auto", \.\.\.DESKTOP_LANGUAGES\];/);
  assert.match(messagesSource, /"自动检测": "自动检测"/);
  assert.match(messagesSource, /"自动检测": "Auto Detect"/);

  // 描述:
  //
  //   - 路由层与 AuthState 需要把后端接入配置透传给设置页。
  assert.match(routerSource, /backendConfig=\{auth\.backendConfig\}/);
  assert.match(routerSource, /onBackendConfigChange=\{auth\.setBackendConfig\}/);
  assert.match(routerSource, /onBackendConfigReset=\{auth\.resetBackendConfig\}/);
  assert.match(authTypeSource, /backendConfig: DesktopBackendConfig;/);
  assert.match(authTypeSource, /setBackendConfig: \(value: DesktopBackendConfig\) => DesktopBackendConfig;/);
  assert.match(authTypeSource, /resetBackendConfig: \(\) => DesktopBackendConfig;/);
});
