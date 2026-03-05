import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，用于技能模块入口与页面结构回归校验。
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

test("TestSkillsModuleShouldExposeRouteAndSidebarEntry", () => {
  const commonRoutesSource = readDesktopSource("src/modules/common/routes.tsx");
  const routerSource = readDesktopSource("src/router/index.tsx");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const manifestSource = readDesktopSource("src/modules/manifest.ts");
  const routerTypesSource = readDesktopSource("src/router/types.ts");

  // 描述：
  //
  //   - common 路由模块应暴露技能/MCP 模块 key、路径与懒加载页面。
  assert.match(commonRoutesSource, /export const SKILL_MODULE_KEY = "skill" as const;/);
  assert.match(commonRoutesSource, /export const SKILL_PAGE_PATH = "\/skills" as const;/);
  assert.match(commonRoutesSource, /export const MCP_MODULE_KEY = "mcp" as const;/);
  assert.match(commonRoutesSource, /export const MCP_PAGE_PATH = "\/mcps" as const;/);
  assert.match(commonRoutesSource, /export const CommonSkillsPageLazy = lazy/);
  assert.match(commonRoutesSource, /export const CommonMcpPageLazy = lazy/);

  // 描述：
  //
  //   - 路由层应接入技能/MCP 页访问守卫与页面路由。
  assert.match(routerSource, /CommonSkillsPageLazy/);
  assert.match(routerSource, /CommonMcpPageLazy/);
  assert.match(routerSource, /SKILL_MODULE_KEY/);
  assert.match(routerSource, /MCP_MODULE_KEY/);
  assert.match(routerSource, /if \(pathname\.startsWith\("\/skills"\)\)/);
  assert.match(routerSource, /if \(pathname\.startsWith\(MCP_PAGE_PATH\)\)/);
  assert.match(routerSource, /routeAccess\.isModuleEnabled\(SKILL_MODULE_KEY\)/);
  assert.match(routerSource, /routeAccess\.isModuleEnabled\(MCP_MODULE_KEY\)/);
  assert.match(routerSource, /path=\{SKILL_PAGE_PATH\.slice\(1\)\}/);
  assert.match(routerSource, /path=\{MCP_PAGE_PATH\.slice\(1\)\}/);

  // 描述：
  //
  //   - Home 侧边栏工具栏应包含技能与 MCP 入口。
  assert.match(sidebarSource, /label: "技能"/);
  assert.match(sidebarSource, /label: "MCP"/);
  assert.match(sidebarSource, /path: SKILL_PAGE_PATH/);
  assert.match(sidebarSource, /path: MCP_PAGE_PATH/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("skill"\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("mcp"\)/);

  // 描述：
  //
  //   - 模块清单与类型定义应注册 skill/mcp 键，参与构建模块开关控制。
  assert.match(manifestSource, /\{ key: "skill", title: "技能" \}/);
  assert.match(manifestSource, /\{ key: "mcp", title: "MCP" \}/);
  assert.match(routerTypesSource, /\| "skill"/);
  assert.match(routerTypesSource, /\| "mcp"/);
});

test("TestSkillsPageShouldRenderInstalledAndMarketplaceSections", () => {
  const skillsPageSource = readDesktopSource("src/modules/common/pages/skills-page.tsx");
  const skillServiceSource = readDesktopSource("src/modules/common/services/skills.ts");
  const styleSource = readDesktopSource("src/styles.css");
  const envSource = readDesktopSource("src/vite-env.d.ts");

  // 描述：
  //
  //   - 技能页应包含“已安装/推荐”分区，并通过服务层读写安装状态。
  assert.match(skillsPageSource, /DeskSectionTitle title="已安装"/);
  assert.match(skillsPageSource, /DeskSectionTitle title="推荐"/);
  assert.match(skillsPageSource, /listSkillOverview/);
  assert.match(skillsPageSource, /updateSkillInstalledState/);
  assert.match(skillsPageSource, /createPortal\(headerNode, headerSlotElement\)/);

  // 描述：
  //
  //   - 技能服务层应提供目录与安装状态管理能力，并支持远端目录回退本地目录。
  assert.match(skillServiceSource, /const SKILL_CATALOG: SkillCatalogItem\[]/);
  assert.match(skillServiceSource, /versions: \["1\.0\.0"\]/);
  assert.match(skillServiceSource, /id: "apifox_model_designer"/);
  assert.match(skillServiceSource, /Apifox 官方 MCP Server/);
  assert.match(skillServiceSource, /id: "frontend_architect"/);
  assert.match(skillServiceSource, /id: "frontend_page_builder"/);
  assert.match(skillServiceSource, /VITE_SKILL_CATALOG_URL/);
  assert.match(skillServiceSource, /loadRemoteSkillCatalog/);
  assert.match(skillServiceSource, /listSkillOverview\(\): Promise<SkillOverview>/);
  assert.match(skillServiceSource, /listInstalledSkills\(catalog\?: SkillCatalogItem\[]\): Promise<SkillCatalogItem\[]>/);
  assert.match(skillServiceSource, /updateSkillInstalledState/);
  assert.match(envSource, /VITE_SKILL_CATALOG_URL/);

  // 描述：
  //
  //   - 样式层应定义技能页网格与卡片样式类。
  assert.match(styleSource, /\.desk-skills-shell/);
  assert.match(styleSource, /\.desk-skill-grid/);
  assert.match(styleSource, /\.desk-skill-card/);
});

test("TestMcpPageShouldRenderInstalledAndMarketplaceSections", () => {
  const mcpPageSource = readDesktopSource("src/modules/common/pages/mcp-page.tsx");
  const mcpServiceSource = readDesktopSource("src/modules/common/services/mcps.ts");
  const envSource = readDesktopSource("src/vite-env.d.ts");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const tauriMainSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - MCP 页应包含“已安装/推荐”分区，并通过服务层读写安装状态。
  assert.match(mcpPageSource, /DeskSectionTitle title="已安装"/);
  assert.match(mcpPageSource, /DeskSectionTitle title="推荐"/);
  assert.match(mcpPageSource, /listMcpOverview/);
  assert.match(mcpPageSource, /updateMcpInstalledState/);
  assert.match(mcpPageSource, /createPortal\(headerNode, headerSlotElement\)/);
  assert.match(mcpPageSource, /安装命令：/);
  assert.match(mcpPageSource, /文档：/);

  // 描述：
  //
  //   - MCP 服务层应提供目录与安装状态管理能力，并支持远端目录回退本地目录。
  assert.match(mcpServiceSource, /const MCP_CATALOG: McpCatalogItem\[]/);
  assert.match(mcpServiceSource, /id: "mcp_apifox"/);
  assert.match(mcpServiceSource, /name: "Apifox MCP（官方）"/);
  assert.match(mcpServiceSource, /apifox-mcp-server@latest/);
  assert.match(mcpServiceSource, /enforceOfficialApifoxMcpPolicy/);
  assert.match(mcpServiceSource, /VITE_MCP_CATALOG_URL/);
  assert.match(mcpServiceSource, /listMcpOverview\(\): Promise<McpOverview>/);
  assert.match(mcpServiceSource, /listInstalledMcps\(catalog\?: McpCatalogItem\[]\): Promise<McpCatalogItem\[]>/);
  assert.match(mcpServiceSource, /updateMcpInstalledState/);
  assert.match(mcpServiceSource, /invoke<ApifoxMcpRuntimeStatusResponse>\(COMMANDS\.CHECK_APIFOX_MCP_RUNTIME_STATUS\)/);
  assert.match(mcpServiceSource, /invoke<ApifoxMcpRuntimeStatusResponse>\(COMMANDS\.INSTALL_APIFOX_MCP_RUNTIME\)/);
  assert.match(mcpServiceSource, /invoke<ApifoxMcpRuntimeStatusResponse>\(COMMANDS\.UNINSTALL_APIFOX_MCP_RUNTIME\)/);
  assert.match(mcpServiceSource, /reconcileInstalledIdsWithApifoxRuntime/);
  assert.match(mcpServiceSource, /ensureApifoxMcpRuntimeAutoInstalled/);
  assert.match(mcpServiceSource, /const desiredInstalledIds = new Set\(readInstalledMcpIdsFromStorage\(\)\)/);
  assert.match(mcpServiceSource, /const installedIds = await ensureApifoxMcpRuntimeAutoInstalled\(reconciledInstalledIds, desiredInstalledIds\)/);

  // 描述：
  //
  //   - 常量与 Tauri 后端必须暴露 Apifox MCP Runtime 安装能力，确保“安装”是本应用内真实安装。
  assert.match(constantsSource, /CHECK_APIFOX_MCP_RUNTIME_STATUS: "check_apifox_mcp_runtime_status"/);
  assert.match(constantsSource, /INSTALL_APIFOX_MCP_RUNTIME: "install_apifox_mcp_runtime"/);
  assert.match(constantsSource, /UNINSTALL_APIFOX_MCP_RUNTIME: "uninstall_apifox_mcp_runtime"/);
  assert.match(tauriMainSource, /async fn check_apifox_mcp_runtime_status\(/);
  assert.match(tauriMainSource, /async fn install_apifox_mcp_runtime\(/);
  assert.match(tauriMainSource, /async fn uninstall_apifox_mcp_runtime\(/);
  assert.match(tauriMainSource, /check_apifox_mcp_runtime_status,/);
  assert.match(tauriMainSource, /install_apifox_mcp_runtime,/);
  assert.match(tauriMainSource, /uninstall_apifox_mcp_runtime,/);
  assert.match(tauriMainSource, /resolve_apifox_mcp_runtime_root/);
  assert.match(tauriMainSource, /app_data_dir\(\)/);
  assert.match(tauriMainSource, /npm install/);
  assert.match(envSource, /VITE_MCP_CATALOG_URL/);
});
