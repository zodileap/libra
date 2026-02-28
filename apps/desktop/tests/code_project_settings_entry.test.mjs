import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，校验代码项目设置页入口与数据能力。
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

test("TestCodeProjectSettingsShouldExposeRouteAndSidebarEntry", () => {
  const routesSource = readDesktopSource("src/modules/code/routes.tsx");
  const routerSource = readDesktopSource("src/router/index.tsx");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");

  // 描述:
  //
  //   - code 模块应暴露项目设置路径和懒加载入口，并在桌面总路由中注册页面。
  assert.match(routesSource, /export const CODE_PROJECT_SETTINGS_PATH = "\/agents\/code\/project-settings" as const;/);
  assert.match(routesSource, /export const CodeProjectSettingsPageLazy = lazy/);
  assert.match(routerSource, /path="agents\/code\/project-settings"/);
  assert.match(routerSource, /<CodeProjectSettingsPageLazy \/>/);

  // 描述:
  //
  //   - 代码目录一级菜单 hover 操作应仅保留“更多”，并通过菜单承载“编辑/删除”。
  assert.match(sidebarSource, /icon="more_horiz"/);
  assert.match(sidebarSource, /\{ key: "edit", label: "编辑", icon: "edit" \}/);
  assert.match(sidebarSource, /\{ key: "delete", label: "删除", icon: "delete", fillIcon: "delete_fill" \}/);
  assert.match(sidebarSource, /const \[workspaceActionMenuVersion, setWorkspaceActionMenuVersion\] = useState\(0\);/);
  assert.match(sidebarSource, /key=\{`\$\{group\.workspace\.id\}-\$\{workspaceActionMenuVersion\}`\}/);
  assert.match(sidebarSource, /setWorkspaceActionMenuVersion\(\(current\) => current \+ 1\);/);
  assert.match(sidebarSource, /\[codeWorkspaceSessionGroups, isCodeAgent, workspaceActionMenuVersion\]/);
  assert.match(sidebarSource, /navigate\(`\$\{CODE_PROJECT_SETTINGS_PATH\}\?workspaceId=\$\{encodeURIComponent\(workspaceId\)\}`\)/);
  assert.match(sidebarSource, /const isCodeProjectSettingsPath = isCodeAgent && location\.pathname\.startsWith\(CODE_PROJECT_SETTINGS_PATH\);/);
  assert.match(sidebarSource, /if \(isCodeProjectSettingsPath\) \{\s*return "";\s*\}/);
  assert.match(sidebarSource, /setCodeWorkspaceExpandedKeys\(\(current\) => \{\s*const next = new Set\(\[\.\.\.current, workspaceMenuKey\]\);/s);
  assert.match(sidebarSource, /label: item\.title,/);
  assert.doesNotMatch(sidebarSource, /label: <AriTypography className="desk-session-item-title"/);
  assert.doesNotMatch(sidebarSource, /handleOpenWorkspaceRenameModal/);
  assert.doesNotMatch(sidebarSource, /workspaceRenameModalVisible/);
});

test("TestCodeProjectSettingsPageShouldSupportNameAndDependencyRules", () => {
  const pageSource = readDesktopSource("src/modules/code/pages/code-project-settings-page.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");
  const settingsPrimitivesSource = readDesktopSource("src/widgets/settings-primitives.tsx");

  // 描述:
  //
  //   - 项目设置页应提供项目名称输入和依赖限制列表维护能力。
  assert.match(pageSource, /<DeskSectionTitle title="基础信息" \/>/);
  assert.match(pageSource, /<DeskSettingsRow title="项目名称">/);
  assert.match(pageSource, /<DeskSectionTitle title="依赖规范" \/>/);
  assert.match(pageSource, /<AriInput\.TextList/);
  assert.match(pageSource, /updateCodeWorkspaceGroupSettings\(/);
  assert.match(pageSource, /getCodeWorkspaceGroupById\(/);
  assert.doesNotMatch(pageSource, /desk-settings-meta/);
  assert.doesNotMatch(pageSource, /<DeskSettingsRow title="依赖规范">/);
  assert.match(pageSource, /className="desk-project-settings-form"/);
  assert.match(pageSource, /useDesktopHeaderSlot\(/);
  assert.match(pageSource, /createPortal\(projectHeaderNode, headerSlotElement\)/);
  assert.match(pageSource, /className="desk-project-settings-header-title"/);
  assert.match(pageSource, /addText="新增规范"/);
  assert.doesNotMatch(pageSource, /label="保存"/);
  assert.doesNotMatch(pageSource, /label="返回项目"/);
  assert.doesNotMatch(pageSource, /维护项目名称与依赖限制规则。/);
  assert.doesNotMatch(pageSource, /侧边栏一级目录中展示的项目名称。/);
  assert.doesNotMatch(pageSource, /每项建议使用“包名@版本”格式，例如 react@19\.1\.0。/);
  assert.match(settingsPrimitivesSource, /<AriTypography variant="h4" bold value=\{title\} \/>\s*\{description \?/s);
  assert.match(settingsPrimitivesSource, /export function DeskSectionTitle\(\{ title \}: DeskSectionTitleProps\) \{\s*return <AriTypography className="desk-settings-title" variant="h4" bold value=\{title\} \/>;\s*\}/s);

  // 描述:
  //
  //   - 数据层应持久化 dependencyRules，并提供统一更新接口。
  assert.match(dataSource, /dependencyRules: string\[];/);
  assert.match(dataSource, /function normalizeWorkspaceDependencyRules\(rules: unknown\): string\[]/);
  assert.match(dataSource, /export function updateCodeWorkspaceGroupSettings\(/);
});
