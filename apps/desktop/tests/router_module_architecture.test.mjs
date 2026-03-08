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
  assert.match(userMenuSource, /key: "overview"/);
  assert.match(userMenuSource, /navigate\("\/settings\/overview"\)/);
  assert.match(userMenuSource, /key: "ai-key"/);
  assert.match(commonRoutesSource, /routeAccess\.isAgentEnabled\(agent\.key\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("workflow"\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("skill"\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("mcp"\)/);
});
