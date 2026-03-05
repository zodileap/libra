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
  //   - 通用页面应从 common 模块暴露；业务模块继续走白名单构建期过滤。
  assert.match(routerSource, /resolveBuildEnabledModules\(__DESKTOP_ENABLED_MODULES__\)/);
  assert.match(routerSource, /from "\.\.\/modules\/common\/routes"/);
  assert.match(routerSource, /from "\.\.\/modules\/code\/routes"/);
  assert.match(routerSource, /from "\.\.\/modules\/model\/routes"/);
  assert.match(routerSource, /CommonWorkflowsPageLazy/);
  assert.match(routerSource, /CommonMcpPageLazy/);
  assert.match(routerSource, /LegacyWorkflowRedirect/);
  assert.match(routerSource, /path=\{WORKFLOW_PAGE_PATH\.slice\(1\)\}/);
  assert.match(routerSource, /path=\{MCP_PAGE_PATH\.slice\(1\)\}/);
  assert.match(routerSource, /path="agents\/code\/workflows"/);
  assert.match(routerSource, /path="agents\/model\/workflows"/);
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
  assert.match(userMenuSource, /key: "ai-key"/);
  assert.match(commonRoutesSource, /routeAccess\.isAgentEnabled\(agent\.key\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("workflow"\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("skill"\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("mcp"\)/);
});
