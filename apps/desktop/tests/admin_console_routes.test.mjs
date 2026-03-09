import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：读取 Desktop 源码文件，供管理页迁移回归测试复用。
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

test("TestDesktopShouldExposeAdminManagementRoutesInSettings", () => {
  const commonRoutesSource = readDesktopSource("src/modules/common/routes.tsx");
  const routerSource = readDesktopSource("src/router/index.tsx");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const authTypeSource = readDesktopSource("src/router/types.ts");

  // 描述:
  //
  //   - Web 管理功能迁入 Desktop 后，应在 settings 下暴露概览、身份和权限三条路由。
  assert.match(commonRoutesSource, /export const SETTINGS_OVERVIEW_PATH = "\/settings\/overview" as const;/);
  assert.match(commonRoutesSource, /export const SETTINGS_IDENTITIES_PATH = "\/settings\/identities" as const;/);
  assert.match(commonRoutesSource, /export const SETTINGS_PERMISSIONS_PATH = "\/settings\/permissions" as const;/);
  assert.match(commonRoutesSource, /export const SettingsAdminOverviewPageLazy = lazy/);
  assert.match(commonRoutesSource, /export const SettingsAdminIdentitiesPageLazy = lazy/);
  assert.match(commonRoutesSource, /export const SettingsAdminPermissionsPageLazy = lazy/);
  assert.match(commonRoutesSource, /label: translateDesktopText\("概览"\)/);
  assert.match(commonRoutesSource, /label: translateDesktopText\("身份"\)/);
  assert.match(commonRoutesSource, /label: translateDesktopText\("权限管理"\)/);

  assert.match(routerSource, /path=\{SETTINGS_OVERVIEW_PATH\.slice\(1\)\}/);
  assert.match(routerSource, /path=\{SETTINGS_IDENTITIES_PATH\.slice\(1\)\}/);
  assert.match(routerSource, /path=\{SETTINGS_PERMISSIONS_PATH\.slice\(1\)\}/);
  assert.match(routerSource, /<SettingsAdminOverviewPageLazy \/>/);
  assert.match(routerSource, /<SettingsAdminIdentitiesPageLazy/);
  assert.match(routerSource, /selectedIdentity=\{auth\.selectedIdentity\}/);
  assert.match(routerSource, /onSelectIdentity=\{auth\.setSelectedIdentity\}/);
  assert.match(routerSource, /<SettingsAdminPermissionsPageLazy \/>/);
  assert.match(authTypeSource, /selectedIdentity: ConsoleIdentityItem \| null;/);
  assert.match(authTypeSource, /setSelectedIdentity: \(value: ConsoleIdentityItem \| null\) => ConsoleIdentityItem \| null;/);

  assert.match(sidebarSource, /location\.pathname\.startsWith\("\/settings\/overview"\)/);
  assert.match(sidebarSource, /location\.pathname\.startsWith\("\/settings\/identities"\)/);
  assert.match(sidebarSource, /location\.pathname\.startsWith\("\/settings\/permissions"\)/);
  assert.match(sidebarSource, /selectedIdentityLabel=\{selectedIdentity\?\.scopeName \|\| ""\}/);
});

test("TestDesktopBackendApiShouldSupportAdminManagementData", () => {
  const apiSource = readDesktopSource("src/shared/services/backend-api.ts");
  const overviewSource = readDesktopSource("src/modules/common/pages/admin-overview-page.tsx");
  const identitiesSource = readDesktopSource("src/modules/common/pages/admin-identities-page.tsx");
  const permissionsSource = readDesktopSource("src/modules/common/pages/admin-permissions-page.tsx");
  const settingsGeneralSource = readDesktopSource("src/modules/common/pages/settings-general-page.tsx");
  const appSource = readDesktopSource("src/app.tsx");
  const constantsSource = readDesktopSource("src/shared/constants.ts");

  // 描述:
  //
  //   - Desktop 后端 API 层应补齐 identities / permission templates / grants，并提供本地模式兜底。
  assert.match(apiSource, /const localConsoleIdentities: ConsoleIdentityItem\[] = \[/);
  assert.match(apiSource, /export function getLocalConsoleIdentities\(\): ConsoleIdentityItem\[] \{/);
  assert.match(apiSource, /const localManageableUsers: ConsoleManageableUserItem\[] = \[/);
  assert.match(apiSource, /export function getLocalManageableUsers\(\): ConsoleManageableUserItem\[] \{/);
  assert.match(apiSource, /const localPermissionTemplates: ConsolePermissionTemplate\[] = \[/);
  assert.match(apiSource, /function readLocalPermissionGrants\(\): ConsolePermissionGrantItem\[] \{/);
  assert.match(apiSource, /export async function listAccountIdentities\(\): Promise<ConsoleIdentityItem\[]> \{/);
  assert.match(apiSource, /export async function listManageableUsers\(\): Promise<ConsoleManageableUserItem\[]> \{/);
  assert.match(apiSource, /export async function listPermissionTemplates\(\): Promise<ConsolePermissionTemplate\[]> \{/);
  assert.match(apiSource, /export async function listPermissionGrants\(\): Promise<ConsolePermissionGrantItem\[]> \{/);
  assert.match(apiSource, /createdAt: item\.createdAt,/);
  assert.match(apiSource, /lastAt: item\.lastAt,/);
  assert.match(apiSource, /export async function grantPermission\(req: ConsoleGrantPermissionReq\): Promise<void> \{/);
  assert.match(apiSource, /export async function revokePermission\(grantId: string\): Promise<void> \{/);
  assert.match(apiSource, /STORAGE_KEYS\.DESKTOP_ADMIN_PERMISSION_GRANTS/);

  // 描述:
  //
  //   - Desktop 页面层应直接使用这些能力渲染三类管理页。
  assert.match(overviewSource, /listAccountIdentities\(\)/);
  assert.match(overviewSource, /listManageableUsers\(\)/);
  assert.match(overviewSource, /listPermissionTemplates\(\)/);
  assert.match(overviewSource, /listPermissionGrants\(\)/);
  assert.match(overviewSource, /const recentPermissionGrants = useMemo/);
  assert.match(overviewSource, /const recentIdentities = useMemo/);
  assert.match(overviewSource, /const recentManageableUsers = useMemo/);
  assert.match(overviewSource, /function formatGrantTime/);
  assert.match(overviewSource, /value=\{loading \? "--" : String\(overview\.manageableUsers\.length\)\}/);
  assert.match(overviewSource, /value=\{t\("快速操作"\)\}/);
  assert.match(overviewSource, /value=\{t\("最近授权"\)\}/);
  assert.match(overviewSource, /value=\{t\("身份上下文"\)\}/);
  assert.match(overviewSource, /value=\{t\("协作者预览"\)\}/);
  assert.match(overviewSource, /label=\{t\("身份管理"\)\}/);
  assert.match(overviewSource, /label=\{t\("权限管理"\)\}/);
  assert.match(overviewSource, /label=\{t\("新增授权"\)\}/);
  assert.match(overviewSource, /label=\{t\("返回工作台"\)\}/);
  assert.match(overviewSource, /label=\{t\("查看记录"\)\}/);
  assert.match(overviewSource, /label=\{t\("授权给他"\)\}/);
  assert.match(overviewSource, /function buildPermissionSearch/);
  assert.match(overviewSource, /new URLSearchParams\(\)/);
  assert.match(overviewSource, /navigate\(`\/settings\/permissions\?\$\{search\}`\)/);
  assert.match(overviewSource, /formatGrantTime\(grant\.createdAt \|\| grant\.lastAt \|\| "", formatDateTime\)/);
  assert.match(identitiesSource, /listAccountIdentities\(\)/);
  assert.match(identitiesSource, /selectedIdentity: ConsoleIdentityItem \| null;/);
  assert.match(identitiesSource, /onSelectIdentity: \(value: ConsoleIdentityItem \| null\) => ConsoleIdentityItem \| null;/);
  assert.match(identitiesSource, /handleSelectIdentity/);
  assert.match(identitiesSource, /t\("当前身份：\{\{scopeName\}\}"/);
  assert.match(identitiesSource, /label=\{selectedIdentity\?\.id === item\.id \? t\("当前身份"\) : t\("设为当前"\)\}/);
  assert.match(settingsGeneralSource, /selectedIdentity: ConsoleIdentityItem \| null;/);
  assert.match(settingsGeneralSource, /title=\{t\("Current Identity"\)\}/);
  assert.match(settingsGeneralSource, /value=\{selectedIdentity\?\.scopeName \|\| t\("未选定身份"\)\}/);
  assert.match(permissionsSource, /listManageableUsers\(\)/);
  assert.match(permissionsSource, /const \[manageableUsers, setManageableUsers\] = useState<ConsoleManageableUserItem\[]>\(\[]\);/);
  assert.match(permissionsSource, /useSearchParams/);
  assert.match(permissionsSource, /const highlightedGrantId = useMemo/);
  assert.match(permissionsSource, /const preferredTargetUserId = useMemo/);
  assert.match(permissionsSource, /const preferredPermissionCode = useMemo/);
  assert.match(permissionsSource, /const searchHintText = useMemo/);
  assert.match(permissionsSource, /const selectedUser = useMemo/);
  assert.match(permissionsSource, /const handleChangeTargetUser =/);
  assert.match(permissionsSource, /<AriSelect/);
  assert.match(permissionsSource, /label=\{t\("目标用户名称"\)\}/);
  assert.match(permissionsSource, /label=\{t\("目标用户邮箱"\)\}/);
  assert.match(permissionsSource, /selectedUser\.identityScopes\.join\("、"\)/);
  assert.match(permissionsSource, /grantPermission\(/);
  assert.match(permissionsSource, /revokePermission\(/);
  assert.match(permissionsSource, /listPermissionTemplates\(\)/);
  assert.match(permissionsSource, /listPermissionGrants\(\)/);
  assert.match(permissionsSource, /desk-admin-list-card-active/);
  assert.match(permissionsSource, /searchHintText \? <DeskStatusText/);
  assert.match(constantsSource, /DESKTOP_SELECTED_IDENTITY_ID: "libra\.desktop\.selectedIdentityId"/);
  assert.match(appSource, /const \[selectedIdentity, setSelectedIdentityState\] = useState<ConsoleIdentityItem \| null>/);
  assert.match(appSource, /function resolveSelectedDesktopIdentity\(/);
  assert.match(appSource, /return identities\[0\];/);
  assert.match(appSource, /const \[agents, identities\] = await Promise\.all\(\[/);
  assert.match(appSource, /setUser\(result\.user\);/);
  assert.match(appSource, /登录成功，当前身份已切换为/);
  assert.match(appSource, /setSelectedIdentity: updateSelectedIdentity,/);
});
