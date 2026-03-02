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
  //   - common 路由模块应暴露技能模块 key、路径与懒加载页面。
  assert.match(commonRoutesSource, /export const SKILL_MODULE_KEY = "skill" as const;/);
  assert.match(commonRoutesSource, /export const SKILL_PAGE_PATH = "\/skills" as const;/);
  assert.match(commonRoutesSource, /export const CommonSkillsPageLazy = lazy/);

  // 描述：
  //
  //   - 路由层应接入技能页访问守卫与页面路由。
  assert.match(routerSource, /CommonSkillsPageLazy/);
  assert.match(routerSource, /SKILL_MODULE_KEY/);
  assert.match(routerSource, /if \(pathname\.startsWith\("\/skills"\)\)/);
  assert.match(routerSource, /routeAccess\.isModuleEnabled\(SKILL_MODULE_KEY\)/);
  assert.match(routerSource, /path=\{SKILL_PAGE_PATH\.slice\(1\)\}/);

  // 描述：
  //
  //   - Home 侧边栏工具栏应包含技能入口。
  assert.match(sidebarSource, /label: "技能"/);
  assert.match(sidebarSource, /path: SKILL_PAGE_PATH/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("skill"\)/);

  // 描述：
  //
  //   - 模块清单与类型定义应注册 skill 键，参与构建模块开关控制。
  assert.match(manifestSource, /\{ key: "skill", title: "技能" \}/);
  assert.match(routerTypesSource, /\| "skill"/);
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
