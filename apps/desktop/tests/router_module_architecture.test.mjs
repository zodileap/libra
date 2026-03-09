import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：读取 Desktop 客户端源码文件，用于路由结构回归测试。
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

test("TestDesktopRouterShouldUseModuleFoldersAndBuildTimeModuleFilter", () => {
  const routerSource = readDesktopSource("src/router/index.tsx");
  const moduleAccessSource = readDesktopSource("src/router/module-access.ts");
  const manifestSource = readDesktopSource("src/modules/manifest.ts");
  const viteSource = readDesktopSource("vite.config.ts");

  // 描述:
  //
  //   - 通用页面应从 common 模块暴露；单智能体页面统一从 agent 模块收口。
  assert.match(routerSource, /resolveBuildEnabledModules\(__DESKTOP_ENABLED_MODULES__\)/);
  assert.match(routerSource, /from "\.\.\/modules\/common\/routes"/);
  assert.match(routerSource, /from "\.\.\/modules\/agent\/routes"/);
  assert.doesNotMatch(routerSource, /from "\.\.\/modules\/model\/routes"/);
  assert.match(routerSource, /CommonWorkflowsPageLazy/);
  assert.match(routerSource, /CommonMcpPageLazy/);
  assert.doesNotMatch(routerSource, /LegacyWorkflowRedirect/);
  assert.match(routerSource, /path="home"/);
  assert.match(routerSource, /path="settings\/agent"/);
  assert.match(routerSource, /path="project-settings"/);
  assert.match(routerSource, /path=\{WORKFLOW_PAGE_PATH\.slice\(1\)\}/);
  assert.match(routerSource, /path=\{MCP_PAGE_PATH\.slice\(1\)\}/);
  assert.doesNotMatch(routerSource, /agents\/code/);
  assert.doesNotMatch(routerSource, /agents\/model/);
  assert.match(routerSource, /function shouldPreferAdminOverview\(auth: AuthState\): boolean/);
  assert.match(routerSource, /auth\.selectedIdentity\.roles\.some\(\(role\) => role === "permission_admin"\)/);
  assert.match(routerSource, /if \(routeAccess\.isModuleEnabled\(SETTINGS_MODULE_KEY\) && shouldPreferAdminOverview\(auth\)\) \{\s*return SETTINGS_OVERVIEW_PATH;\s*\}/s);
  assert.match(moduleAccessSource, /export function resolveBuildEnabledModules/);
  assert.match(moduleAccessSource, /from "\.\.\/modules\/manifest"/);
  assert.match(manifestSource, /DESKTOP_ROUTE_MODULE_MANIFEST/);
  assert.doesNotMatch(manifestSource, /"login"/);
  assert.doesNotMatch(manifestSource, /"home"/);
  assert.doesNotMatch(manifestSource, /"ai-key"/);
  assert.doesNotMatch(moduleAccessSource, /wanted\.add\("login"\);/);
  assert.match(viteSource, /__DESKTOP_ENABLED_MODULES__/);
});

test("TestDesktopSidebarShouldRespectRouteAccessVisibility", () => {
  const layoutSource = readDesktopSource("src/shell/layout.tsx");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const userMenuSource = readDesktopSource("src/sidebar/widgets/user-hover-menu.tsx");
  const commonRoutesSource = readDesktopSource("src/modules/common/routes.tsx");

  // 描述:
  //
  //   - 侧边栏应接收 routeAccess，并按模块开关与智能体授权控制菜单展示。
  assert.match(layoutSource, /routeAccess: RouteAccess;/);
  assert.match(layoutSource, /<ClientSidebar[\s\S]*routeAccess=\{routeAccess\}/);
  assert.match(sidebarSource, /resolveSettingsSidebarItems\(routeAccess\)/);
  assert.match(userMenuSource, /key: "general-settings"/);
  assert.match(userMenuSource, /navigate\("\/settings\/general"\)/);
  assert.match(userMenuSource, /key: "language"/);
  assert.match(userMenuSource, /key: "ai-key"/);
  assert.match(userMenuSource, /DESKTOP_LANGUAGE_PREFERENCES\.map\(\(item\) => \(\{/);
  assert.match(userMenuSource, /label: item === "auto" \? t\("自动检测"\) : getDesktopLanguageNativeLabel\(item\),/);
  assert.match(userMenuSource, /selectedKey=\{`language:\$\{languagePreference\}`\}/);
  assert.match(userMenuSource, /key: "language",[\s\S]*?icon: "translate"/);
  assert.doesNotMatch(userMenuSource, /icon: language === item \? "check" : "translate"/);
  assert.doesNotMatch(userMenuSource, /key: "overview"/);
  assert.doesNotMatch(userMenuSource, /key: "identities"/);
  assert.match(commonRoutesSource, /routeAccess\.isAgentEnabled\(agent\.key\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("workflow"\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("skill"\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("mcp"\)/);
  assert.doesNotMatch(sidebarSource, /if \(pathname\.startsWith\("\/ai-keys"\)\) return "ai-key";/);
  assert.doesNotMatch(sidebarSource, /function AiKeySidebar\(/);
  assert.doesNotMatch(sidebarSource, /if \(mode === "ai-key"\)/);
});

test("TestUserHoverMenuShouldUseSettingsTriggerAndProfilePopover", () => {
  const userMenuSource = readDesktopSource("src/sidebar/widgets/user-hover-menu.tsx");
  const styleSource = readDesktopSource("src/styles.css");
  const messagesSource = readDesktopSource("src/shared/i18n/messages.ts");

  // 描述:
  //
  //   - 用户栏触发入口应切换为“设置图标 + 设置文本”，悬浮窗顶部展示账户与类型信息。
  assert.match(userMenuSource, /AriDivider/);
  assert.match(userMenuSource, /const accountLabel = t\("账户"\);/);
  assert.match(userMenuSource, /const userTypeLabel = String\(selectedIdentityLabel \|\| ""\)\.trim\(\) \|\| t\("未配置身份"\);/);
  assert.match(userMenuSource, /<SidebarEntryContent[\s\S]*icon="settings"[\s\S]*label=\{t\("设置"\)\}/s);
  assert.match(userMenuSource, /<AriContainer className="desk-user-menu-popover" ghost>/);
  assert.match(userMenuSource, /<AriContainer className="desk-user-menu-profile" padding=\{0\} ghost>/);
  assert.match(userMenuSource, /<AriContainer padding=\{0\} ghost>[\s\S]*?<AriMenu[\s\S]*className="desk-user-menu-list"/);
  assert.match(userMenuSource, /className="desk-user-menu-profile-head"/);
  assert.match(userMenuSource, /<AriTypography className="desk-user-menu-profile-title" variant="body" value=\{accountLabel\} \/>/);
  assert.match(userMenuSource, /<AriTypography className="desk-user-menu-profile-meta" variant="caption" value=\{userTypeLabel\} \/>/);
  assert.match(userMenuSource, /label: t\("退出登录"\)/);
  assert.match(userMenuSource, /trigger="click"/);
  assert.match(userMenuSource, /matchTriggerWidth=\{false\}/);
  assert.match(messagesSource, /"自动检测": "自动检测"/);
  assert.match(messagesSource, /"自动检测": "Auto Detect"/);

  // 描述:
  //
  //   - 样式层与文案层应补齐悬浮窗容器、资料头、分割线以及“账户/退出登录”文案。
  assert.match(styleSource, /\.desk-user-menu-popover/);
  assert.doesNotMatch(styleSource, /\.desk-user-menu-popover\s*\{[^}]*background:/s);
  assert.match(styleSource, /\.desk-user-menu-profile-head/);
  assert.match(styleSource, /\.desk-user-menu-profile-meta/);
  assert.match(styleSource, /\.desk-user-menu-divider/);
  assert.match(messagesSource, /"账户": "账户"/);
  assert.match(messagesSource, /"退出登录": "退出登录"/);
  assert.match(messagesSource, /"账户": "Account"/);
  assert.match(messagesSource, /"退出登录": "Log out"/);
});
