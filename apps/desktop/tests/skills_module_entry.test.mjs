import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：统一规范源码与资源文本换行符，避免 Windows checkout 的 `CRLF` 影响结构断言。
//
// Params:
//
//   - source: 原始文本内容。
//
// Returns:
//
//   - 统一替换为 `LF` 的文本内容。
function normalizeLineEndings(source) {
  return String(source).replace(/\r\n/g, "\n");
}

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
  return normalizeLineEndings(fs.readFileSync(absolutePath, "utf8"));
}

// 描述：
//
//   - 返回 Desktop 内置技能包的稳定断言配置，用于校验资源结构、标题与引用文件。
//
// Returns:
//
//   - 内置技能断言配置列表。
function builtinSkillPackageAssertions() {
  return [
    {
      id: "openapi-model-designer",
      title: "接口建模",
      group: "代码",
      heading: "# OpenAPI Model Design",
      references: ["references/openapi-model-checklist.md"],
    },
    {
      id: "dcc-modeling",
      title: "建模执行",
      group: "建模",
      heading: "# DCC Modeling",
      references: ["references/dcc-routing-rules.md", "runtime/requirements.json"],
    },
    {
      id: "playwright-interactive",
      title: "Playwright Interactive",
      group: "代码",
      heading: "# Playwright Interactive",
      references: ["references/playwright-session-checklist.md"],
    },
  ];
}

// 描述：
//
//   - 读取指定内置技能包下的资源文件，用于内容和结构断言。
//
// Params:
//
//   - skillId: 技能编码。
//   - relativePath: 技能目录下的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readBuiltinSkillResource(skillId, relativePath) {
  const absolutePath = path.resolve(
    process.cwd(),
    "src-tauri/resources/skills",
    skillId,
    relativePath,
  );
  return normalizeLineEndings(fs.readFileSync(absolutePath, "utf8"));
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
  assert.match(sidebarSource, /label: t\("技能"\)/);
  assert.match(sidebarSource, /label: "MCP"/);
  assert.match(sidebarSource, /path: SKILL_PAGE_PATH/);
  assert.match(sidebarSource, /path: MCP_PAGE_PATH/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("skill"\)/);
  assert.match(sidebarSource, /routeAccess\.isModuleEnabled\("mcp"\)/);

  // 描述：
  //
  //   - 模块清单与类型定义应注册 skill/mcp 键，参与构建模块开关控制。
  assert.match(manifestSource, /\{ key: "skill", title: translateDesktopText\("技能"\) \}/);
  assert.match(manifestSource, /\{ key: "mcp", title: "MCP" \}/);
  assert.match(routerTypesSource, /\| "skill"/);
  assert.match(routerTypesSource, /\| "mcp"/);
});

test("TestSkillsPageShouldUseAgentSkillRegistryAndImportFlow", () => {
  const skillsPageSource = readDesktopSource("src/modules/common/pages/skills-page.tsx");
  const skillServiceSource = readDesktopSource("src/modules/common/services/skills.ts");
  const promptUtilsSource = readDesktopSource("src/widgets/session/prompt-utils.ts");
  const workflowPageSource = readDesktopSource("src/widgets/workflow/page.tsx");
  const skillPlanSource = readDesktopSource("src/shared/workflow/skill-plan.ts");
  const sessionPageSource = readDesktopSource("src/widgets/session/page.tsx");
  const settingsPrimitivesSource = readDesktopSource("src/widgets/settings-primitives.tsx");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const tauriSkillRegistrySource = readDesktopSource("src-tauri/src/agent_skills.rs");
  const tauriMainSource = readDesktopSource("src-tauri/src/main.rs");
  const tauriConfigSource = readDesktopSource("src-tauri/tauri.conf.json");
  const buildSource = readDesktopSource("src-tauri/build.rs");
  const cargoSource = readDesktopSource("src-tauri/Cargo.toml");
  const styleSource = readDesktopSource("src/styles.css");
  const builtinSkillPackages = builtinSkillPackageAssertions();
  const skillResourceRoot = path.resolve(process.cwd(), "src-tauri/resources/skills");
  const dccSkillRuntimePath = path.resolve(process.cwd(), "src-tauri/resources/skills/dcc-modeling/runtime/requirements.json");
  const dccSkillRuntimeSource = fs.readFileSync(dccSkillRuntimePath, "utf8");

  // 描述：
  //
  //   - 技能页应恢复“已注册 / 未注册”分区，并在每个分区下继续按 group 分类展示技能卡片。
  assert.match(skillsPageSource, /DeskSectionTitle title=\{t\("已注册"\)\}/);
  assert.match(skillsPageSource, /DeskSectionTitle title=\{t\("未注册"\)\}/);
  assert.match(skillsPageSource, /DeskPageHeader/);
  assert.match(skillsPageSource, /DeskOverviewCard/);
  assert.match(skillsPageSource, /function SkillIcon/);
  assert.match(skillsPageSource, /function buildSkillGroupSections\(skills: AgentSkillItem\[\]\): SkillGroupSection\[\]/);
  assert.match(skillsPageSource, /function SkillGroupList\(/);
  assert.match(skillsPageSource, /const registeredSkillSections = useMemo/);
  assert.match(skillsPageSource, /const unregisteredSkillSections = useMemo/);
  assert.match(skillsPageSource, /className="desk-skill-group-stack"/);
  assert.match(skillsPageSource, /className="desk-skill-group-title"/);
  assert.doesNotMatch(skillsPageSource, /DeskSectionLabel/);
  assert.doesNotMatch(skillsPageSource, /className="desk-skill-subgroup-section"/);
  assert.match(skillsPageSource, /resolveAgentSkillIconName/);
  assert.match(skillsPageSource, /resolveAgentSkillStatusLabel/);
  assert.match(skillsPageSource, /<AriIcon/);
  assert.match(skillsPageSource, /name=\{iconName\}/);
  assert.match(skillsPageSource, /size=\{size === "hero" \? "xxl" : "lg"\}/);
  assert.match(skillsPageSource, /function SkillMetaTags/);
  assert.match(skillsPageSource, /function buildSkillCardCaption\(skill: AgentSkillItem\): string/);
  assert.match(skillsPageSource, /title=\{skill\.title\}/);
  assert.match(skillsPageSource, /caption=\{buildSkillCardCaption\(skill\)\}/);
  assert.match(settingsPrimitivesSource, /className="desk-overview-card-title-main"/);
  assert.match(settingsPrimitivesSource, /className="desk-overview-card-title-main"[\s\S]*className="desk-overview-card-caption"/s);
  assert.match(skillsPageSource, /<AriModal/);
  assert.match(skillsPageSource, /title=\{managingSkill \? \(/);
  assert.match(skillsPageSource, /className="desk-skill-details-modal-title"/);
  assert.match(skillsPageSource, /mode="slot"/);
  assert.match(skillsPageSource, /type="text"/);
  assert.match(skillsPageSource, /content=\{t\("管理"\)\}/);
  assert.match(skillsPageSource, /aria-label=\{t\("管理技能"\)\}/);
  assert.match(skillsPageSource, /registerBuiltinAgentSkill/);
  assert.match(skillsPageSource, /unregisterBuiltinAgentSkill/);
  assert.match(skillsPageSource, /openBuiltinAgentSkillFolder/);
  assert.match(skillsPageSource, /ChatMarkdown/);
  assert.match(skillsPageSource, /label=\{t\("打开文件夹"\)\}/);
  assert.match(skillsPageSource, /stripSkillDetailHeading/);
  assert.match(skillsPageSource, /<SkillMetaTags skill=\{managingSkill\} \/>/);
  assert.match(skillsPageSource, /className="desk-skill-details-section-label"[\s\S]*variant="body"[\s\S]*value=\{t\("示例提示"\)\}/);
  assert.match(skillsPageSource, /value=\{t\("示例提示"\)\}/);
  assert.match(skillsPageSource, /aria-label=\{t\("复制示例提示"\)\}/);
  assert.match(skillsPageSource, /width="var\(--desk-skill-details-modal-width\)"/);
  assert.match(skillsPageSource, /className="desk-skill-details-markdown-panel"/);
  assert.match(skillsPageSource, /className="desk-skill-details-markdown-scroll"/);
  assert.match(skillsPageSource, /className="desk-skill-details-prompt-card"/);
  assert.doesNotMatch(skillsPageSource, /className="desk-skill-details-prompt-card" padding=\{0\}/);
  assert.doesNotMatch(skillsPageSource, /className="desk-skill-details-markdown-panel" padding=\{0\}/);
  assert.doesNotMatch(skillsPageSource, /className="desk-skill-details-card"/);
  assert.doesNotMatch(skillsPageSource, /className="desk-skill-details-shell"/);
  assert.match(skillsPageSource, /const registeredSkillIds = useMemo/);
  assert.match(skillsPageSource, /icon=\{registered \? "delete" : "add"\}/);
  assert.match(skillsPageSource, /aria-label=\{registered \? t\("移除技能"\) : t\("添加技能"\)\}/);
  assert.match(skillsPageSource, /DeskEmptyState title=\{t\("暂无已注册技能"\)\} description=\{t\("可从下方未注册技能中添加。"\)\}/);
  assert.match(skillsPageSource, /DeskEmptyState title=\{t\("暂无未注册技能"\)\} description=\{t\("当前应用未发现可添加的内置技能。"\)\}/);
  assert.match(skillsPageSource, /content: t\("已添加 \{\{name\}\}"\, \{ name: skill\.title \}\)/);
  assert.match(skillsPageSource, /content: t\("已移除 \{\{name\}\}"\, \{ name: skill\.title \}\)/);
  assert.doesNotMatch(skillsPageSource, /DeskSectionTitle title=\{t\("已提供"\)\}/);
  assert.doesNotMatch(skillsPageSource, /DeskOverviewDetailsModal/);
  assert.doesNotMatch(skillsPageSource, /DeskOverviewDetailRow/);
  assert.doesNotMatch(skillsPageSource, /title=\{`\$\{skill\.title\} · v\$\{skill\.version\}`\}/);
  assert.doesNotMatch(skillsPageSource, /v\$\{skill\.version\}/);
  assert.doesNotMatch(skillsPageSource, /导入本地技能/);
  assert.doesNotMatch(skillsPageSource, /label="刷新"/);
  assert.doesNotMatch(skillsPageSource, /pickLocalAgentSkillFolder/);
  assert.doesNotMatch(skillsPageSource, /importAgentSkillFromPath/);
  assert.doesNotMatch(skillsPageSource, /removeAgentSkill/);
  assert.match(skillsPageSource, /createPortal\(headerNode, headerSlotElement\)/);

  // 描述：
  //
  //   - 技能服务层应输出技能标题、描述、示例提示与图标键，并统一映射到桌面端内置图标资源。
  assert.match(skillServiceSource, /export interface AgentSkillItem/);
  assert.match(skillServiceSource, /title: string;/);
  assert.match(skillServiceSource, /description: string;/);
  assert.match(skillServiceSource, /examplePrompt: string;/);
  assert.match(skillServiceSource, /version: string;/);
  assert.match(skillServiceSource, /status: AgentSkillStatus;/);
  assert.match(skillServiceSource, /group: string;/);
  assert.match(skillServiceSource, /icon: string;/);
  assert.match(skillServiceSource, /markdownBody: string;/);
  assert.match(skillServiceSource, /runtimeRequirements: Record<string, unknown>;/);
  assert.match(skillServiceSource, /removable: boolean;/);
  assert.match(skillServiceSource, /registered: AgentSkillItem\[];/);
  assert.match(skillServiceSource, /unregistered: AgentSkillItem\[];/);
  assert.match(skillServiceSource, /const AGENT_SKILL_ICON_NAMES = \{/);
  assert.match(skillServiceSource, /libra_skill: "new_releases"/);
  assert.match(skillServiceSource, /const DEFAULT_AGENT_SKILL_ICON_KEY = "libra_skill" as const;/);
  assert.match(skillServiceSource, /function normalizeSkillVersion\(rawValue: unknown\): string/);
  assert.match(skillServiceSource, /function normalizeSkillStatus\(rawValue: unknown\): AgentSkillStatus/);
  assert.match(skillServiceSource, /function normalizeSkillCategoryLabel\(rawValue: unknown, fallbackLabel: string\): string/);
  assert.match(skillServiceSource, /function normalizeSkillIconKey\(rawIcon: string\): keyof typeof AGENT_SKILL_ICON_NAMES/);
  assert.match(skillServiceSource, /export function resolveAgentSkillIconName\(iconKey: string\): string/);
  assert.match(skillServiceSource, /export function resolveAgentSkillStatusLabel\(status: AgentSkillStatus\): string/);
  assert.match(skillServiceSource, /invoke<unknown\[]>\(COMMANDS\.LIST_AGENT_SKILLS\)/);
  assert.match(skillServiceSource, /invoke<unknown>\(COMMANDS\.LIST_AGENT_SKILL_OVERVIEW\)/);
  assert.match(skillServiceSource, /invoke<unknown>\(COMMANDS\.REGISTER_BUILTIN_AGENT_SKILL,\s*\{\s*skillId,\s*\}\)/s);
  assert.match(skillServiceSource, /invoke<unknown>\(COMMANDS\.UNREGISTER_BUILTIN_AGENT_SKILL,\s*\{\s*skillId,\s*\}\)/s);
  assert.match(skillServiceSource, /export async function openBuiltinAgentSkillFolder\(skillId: string\): Promise<boolean>/);
  assert.match(skillServiceSource, /COMMANDS\.OPEN_BUILTIN_AGENT_SKILL_FOLDER/);
  assert.match(skillServiceSource, /invoke<string \| null>\(COMMANDS\.PICK_AGENT_SKILL_FOLDER\)/);
  assert.match(skillServiceSource, /COMMANDS\.IMPORT_AGENT_SKILL_FROM_PATH/);
  assert.match(skillServiceSource, /COMMANDS\.REMOVE_USER_AGENT_SKILL/);
  assert.match(skillServiceSource, /function normalizeSkillOverview\(rawOverview: unknown\): SkillOverview/);
  assert.match(skillServiceSource, /const title = String\(source\.title \|\| ""\)\.trim\(\);/);
  assert.match(skillServiceSource, /title,/);
  assert.match(skillServiceSource, /examplePrompt: String\(source\.example_prompt \|\| ""\)\.trim\(\),/);
  assert.match(skillServiceSource, /version: normalizeSkillVersion\(source\.version\),/);
  assert.match(skillServiceSource, /status: normalizeSkillStatus\(source\.status\),/);
  assert.match(skillServiceSource, /group: normalizeSkillCategoryLabel\(source\.group, "未分组"\),/);
  assert.match(skillServiceSource, /icon: normalizeSkillIconKey\(String\(source\.icon \|\| ""\)\.trim\(\)\),/);
  assert.doesNotMatch(skillServiceSource, /SKILL_CATALOG/);
  assert.doesNotMatch(skillServiceSource, /localStorage/);

  // 描述：
  //
  //   - 会话提示词与工作流技能选择器应统一使用技能标题，不再复用旧的 `name` 展示字段。
  assert.match(promptUtilsSource, /const lines = \[`### \$\{item\.title\} \(\$\{item\.id\}\)`\];/);
  assert.match(workflowPageSource, /label: translateDesktopText\("\{\{name\}\}（\{\{id\}\}）", \{ name: item\.title, id: item\.id \}\)/);
  assert.match(skillPlanSource, /skillTitle: string;/);
  assert.match(skillPlanSource, /skillTitle: resolvedSkill\.title,/);
  assert.match(skillPlanSource, /return `\$\{displayIndex \+ 1\}\. \$\{item\.nodeTitle\}：\$\{item\.skillTitle\} \(\$\{item\.skillId\}\)\$\{descriptionText\}\$\{instructionText\}`;/);
  assert.match(sessionPageSource, /return selectedSessionSkills\[0\]\?\.title \|\| t\("技能"\);/);
  assert.match(sessionPageSource, /const name = String\(item\.title \|\| ""\)\.trim\(\) \|\| item\.id;/);

  // 描述：
  //
  //   - 常量层应暴露新的 Agent Skills 命令名。
  assert.match(constantsSource, /LIST_AGENT_SKILLS: "list_agent_skills"/);
  assert.match(constantsSource, /LIST_AGENT_SKILL_OVERVIEW: "list_agent_skill_overview"/);
  assert.match(constantsSource, /REGISTER_BUILTIN_AGENT_SKILL: "register_builtin_agent_skill"/);
  assert.match(constantsSource, /UNREGISTER_BUILTIN_AGENT_SKILL: "unregister_builtin_agent_skill"/);
  assert.match(constantsSource, /OPEN_BUILTIN_AGENT_SKILL_FOLDER: "open_builtin_agent_skill_folder"/);
  assert.match(constantsSource, /PICK_AGENT_SKILL_FOLDER: "pick_agent_skill_folder"/);
  assert.match(constantsSource, /IMPORT_AGENT_SKILL_FROM_PATH: "import_agent_skill_from_path"/);
  assert.match(constantsSource, /REMOVE_USER_AGENT_SKILL: "remove_user_agent_skill"/);

  // 描述：
  //
  //   - Tauri 侧应保留内置技能扫描与注册表能力，并明确封禁外部导入/删除入口。
  assert.match(tauriSkillRegistrySource, /pub async fn list_agent_skills/);
  assert.match(tauriSkillRegistrySource, /pub async fn list_agent_skill_overview/);
  assert.match(tauriSkillRegistrySource, /pub async fn register_builtin_agent_skill/);
  assert.match(tauriSkillRegistrySource, /pub async fn unregister_builtin_agent_skill/);
  assert.match(tauriSkillRegistrySource, /pub async fn open_builtin_agent_skill_folder/);
  assert.match(tauriSkillRegistrySource, /pub async fn pick_agent_skill_folder/);
  assert.match(tauriSkillRegistrySource, /pub async fn import_agent_skill_from_path/);
  assert.match(tauriSkillRegistrySource, /pub async fn remove_user_agent_skill/);
  assert.match(tauriSkillRegistrySource, /serde_yaml::from_str/);
  assert.match(tauriSkillRegistrySource, /pub title: String,/);
  assert.match(tauriSkillRegistrySource, /pub description: String,/);
  assert.match(tauriSkillRegistrySource, /pub example_prompt: String,/);
  assert.match(tauriSkillRegistrySource, /pub version: String,/);
  assert.match(tauriSkillRegistrySource, /pub status: String,/);
  assert.match(tauriSkillRegistrySource, /pub group: String,/);
  assert.match(tauriSkillRegistrySource, /pub icon: String,/);
  assert.match(tauriSkillRegistrySource, /const AGENT_SKILL_STATUS_STABLE: &str = "stable";/);
  assert.match(tauriSkillRegistrySource, /const AGENT_SKILL_STATUS_TESTING: &str = "testing";/);
  assert.match(tauriSkillRegistrySource, /cfg!\(debug_assertions\) \|\| status\.trim\(\) != AGENT_SKILL_STATUS_TESTING/);
  assert.match(tauriSkillRegistrySource, /struct AgentSkillRegistryEntry/);
  assert.match(tauriSkillRegistrySource, /registered: Vec<AgentSkillRegistryEntry>/);
  assert.match(tauriSkillRegistrySource, /struct AgentSkillLibraMetadata/);
  assert.match(tauriSkillRegistrySource, /struct AgentSkillLibraMetadataDocument/);
  assert.match(tauriSkillRegistrySource, /fn parse_skill_libra_metadata\(metadata: &str\) -> Result<AgentSkillLibraMetadata, String>/);
  assert.match(tauriSkillRegistrySource, /fn read_skill_libra_metadata\(skill_root: &Path\) -> Result<AgentSkillLibraMetadata, String>/);
  assert.match(tauriSkillRegistrySource, /let parsed: AgentSkillLibraMetadataDocument = serde_yaml::from_str\(metadata\)/);
  assert.match(tauriSkillRegistrySource, /let mut parsed = parsed\.libra;/);
  assert.match(tauriSkillRegistrySource, /version: String,/);
  assert.match(tauriSkillRegistrySource, /status: Option<String>,/);
  assert.match(tauriSkillRegistrySource, /if parsed\.group\.trim\(\)\.is_empty\(\) \{/);
  assert.match(tauriSkillRegistrySource, /validate_agent_skill_version/);
  assert.match(tauriSkillRegistrySource, /normalize_agent_skill_status/);
  assert.match(tauriSkillRegistrySource, /normalize_registered_skill_entries/);
  assert.match(tauriSkillRegistrySource, /fn resolve_skill_description\(/);
  assert.match(tauriSkillRegistrySource, /read_optional_runtime_requirements/);
  assert.match(tauriSkillRegistrySource, /resolve_agent_skill_registry_path/);
  assert.match(tauriSkillRegistrySource, /should_expose_skill_in_current_build/);
  assert.match(tauriSkillRegistrySource, /resolve_registry_state_with_available_skills/);
  assert.match(tauriSkillRegistrySource, /write_agent_skill_registry_state/);
  assert.match(tauriSkillRegistrySource, /build_agent_skill_overview/);
  assert.match(tauriSkillRegistrySource, /register_builtin_agent_skill_inner/);
  assert.match(tauriSkillRegistrySource, /unregister_builtin_agent_skill_inner/);
  assert.match(tauriSkillRegistrySource, /open_builtin_agent_skill_folder_inner/);
  assert.match(tauriSkillRegistrySource, /open_directory_path/);
  assert.match(tauriSkillRegistrySource, /app_data_dir\(\)/);
  assert.match(tauriSkillRegistrySource, /external_skill_operations_disabled_error/);
  assert.match(tauriSkillRegistrySource, /当前版本仅允许使用应用内置技能/);
  assert.doesNotMatch(tauriSkillRegistrySource, /copy_directory_recursive/);
  assert.doesNotMatch(tauriSkillRegistrySource, /title: Option<String>/);
  assert.doesNotMatch(tauriSkillRegistrySource, /unwrap_or\(frontmatter\.name\)/);
  assert.match(tauriMainSource, /mod agent_skills;/);
  assert.match(tauriMainSource, /list_agent_skills,/);
  assert.match(tauriMainSource, /list_agent_skill_overview,/);
  assert.match(tauriMainSource, /register_builtin_agent_skill,/);
  assert.match(tauriMainSource, /unregister_builtin_agent_skill,/);
  assert.match(tauriMainSource, /open_builtin_agent_skill_folder,/);
  assert.match(tauriMainSource, /pick_agent_skill_folder,/);
  assert.match(tauriMainSource, /import_agent_skill_from_path,/);
  assert.match(tauriMainSource, /remove_user_agent_skill,/);

  // 描述：
  //
  //   - Tauri 构建链应打包内置技能目录，并在资源变更时重新触发构建。
  assert.match(tauriConfigSource, /"resources": \[/);
  assert.match(tauriConfigSource, /resources\/skills/);
  assert.match(buildSource, /cargo:rerun-if-changed=resources/);
  assert.match(cargoSource, /serde_yaml = "0\.9"/);

  // 描述：
  //
  //   - 内置技能包应统一为 Codex 风格资源结构：英文 H1、中文正文、`libra.yaml` 元数据和按需 references。
  const visibleSkillDirectories = fs
    .readdirSync(skillResourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  const expectedSkillDirectories = builtinSkillPackages.map((item) => item.id).sort();
  assert.deepEqual(visibleSkillDirectories, expectedSkillDirectories);
  for (const skillPackage of builtinSkillPackages) {
    const skillSource = readBuiltinSkillResource(skillPackage.id, "SKILL.md");
    const metadataSource = readBuiltinSkillResource(skillPackage.id, "agents/libra.yaml");

    assert.match(skillSource, new RegExp(`^---\\nname: ${skillPackage.id}\\ndescription:`));
    assert.doesNotMatch(skillSource, /^title:/m);
    assert.match(skillSource, new RegExp(skillPackage.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(skillSource, /^## Overview$/m);
    assert.match(skillSource, /^## When to use$/m);
    assert.match(skillSource, /^## Preconditions$/m);
    assert.match(skillSource, /^## Core Workflow$/m);
    assert.match(skillSource, /^## Guardrails$/m);
    assert.match(skillSource, /^## Validation$/m);
    assert.match(skillSource, /^## References$/m);
    assert.doesNotMatch(skillSource, /^## 何时使用$/m);
    assert.doesNotMatch(skillSource, /^## 执行要求$/m);
    assert.doesNotMatch(skillSource, /^## 输出格式$/m);

    for (const referencePath of skillPackage.references) {
      assert.ok(
        fs.existsSync(path.resolve(skillResourceRoot, skillPackage.id, referencePath)),
        `expected skill reference to exist: ${skillPackage.id}/${referencePath}`,
      );
      assert.match(
        skillSource,
        new RegExp(referencePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }

    assert.match(metadataSource, /^libra:$/m);
    assert.match(metadataSource, new RegExp(`^  title: ${skillPackage.title}$`, "m"));
    assert.match(metadataSource, /^  description: .+$/m);
    assert.match(metadataSource, /^  example_prompt: .+$/m);
    assert.match(metadataSource, /^  version: 1\.0\.0$/m);
    assert.match(metadataSource, /^  status: testing$/m);
    assert.match(metadataSource, new RegExp(`^  group: ${skillPackage.group}$`, "m"));
    assert.doesNotMatch(metadataSource, /^  subgroup: .+$/m);
    assert.match(metadataSource, /^  icon: libra_skill$/m);
  }
  assert.match(dccSkillRuntimeSource, /"domain": "dcc-modeling"/);
  assert.match(dccSkillRuntimeSource, /"require_user_choice_when_multiple": true/);
  assert.match(dccSkillRuntimeSource, /"require_cross_dcc_source_and_target_choice_when_not_explicit": true/);

  // 描述：
  //
  //   - 样式层应补齐技能图标、示例提示卡片与详情页编排所需的变量和结构类。
  assert.match(styleSource, /\.desk-skills-shell/);
  assert.match(styleSource, /\.desk-skill-group-stack \{/);
  assert.match(styleSource, /\.desk-skill-group-section \{/);
  assert.match(styleSource, /\.desk-skill-group-title \{/);
  assert.doesNotMatch(styleSource, /\.desk-skill-subgroup-stack \{/);
  assert.doesNotMatch(styleSource, /\.desk-skill-subgroup-section \{/);
  assert.match(styleSource, /\.desk-skill-grid \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*gap: calc\(var\(--z-inset\) \* 1\.125\);\s*align-items: start;/s);
  assert.match(styleSource, /--desk-skill-details-modal-width: calc\(var\(--z-inset\) \* 56\);/);
  assert.match(styleSource, /--desk-skill-details-hero-size: calc\(var\(--z-inset\) \* 4\.75\);/);
  assert.match(styleSource, /\.desk-skill-icon-glyph \{/);
  assert.match(styleSource, /\.desk-skill-icon-glyph\.is-hero \{/);
  assert.match(styleSource, /\.desk-skill-icon-glyph svg \{/);
  assert.match(styleSource, /\.desk-skill-icon-glyph\.is-hero svg \{/);
  assert.match(styleSource, /\.desk-skill-details-section-label \{/);
  assert.match(styleSource, /color: var\(--z-color-text-secondary\);/);
  assert.doesNotMatch(styleSource, /\.desk-skill-details-shell \{/);
  assert.match(styleSource, /\.desk-skill-details-modal-title \{/);
  assert.match(styleSource, /\.desk-skill-details-hero \{/);
  assert.match(styleSource, /\.desk-skill-details-prompt-card \{/);
  assert.match(styleSource, /background: var\(--z-color-info-tertiary\);/);
  assert.match(styleSource, /\.desk-skill-details-prompt-text \{/);
  assert.match(styleSource, /\.desk-skill-details-markdown-panel \{/);
  assert.match(styleSource, /\.desk-skill-details-markdown-scroll \{/);
  assert.match(styleSource, /padding: var\(--desk-skill-details-card-padding\);/);
  assert.match(styleSource, /\.desk-skill-details-markdown \{/);
  assert.doesNotMatch(styleSource, /\.desk-skill-details-card \{/);
  assert.match(styleSource, /\.desk-overview-card/);
  assert.match(styleSource, /\.desk-overview-card-caption/);
  assert.match(styleSource, /\.desk-overview-card-content/);
  assert.match(styleSource, /\.desk-overview-card-title/);
  assert.match(styleSource, /\.desk-overview-card-description/);
});

test("TestMcpPageShouldRenderInstalledAndMarketplaceSections", () => {
  const mcpPageSource = readDesktopSource("src/modules/common/pages/mcp-page.tsx");
  const mcpServiceSource = readDesktopSource("src/modules/common/services/mcps.ts");
  const dccRuntimeServiceSource = readDesktopSource("src/shared/services/dcc-runtime.ts");
  const mcpRegistrySource = readDesktopSource("src-tauri/src/mcp_registry.rs");
  const envSource = readDesktopSource("src/vite-env.d.ts");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const tauriMainSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - MCP 页应包含“已注册/未注册”分区，并将标题、说明和操作统一挂到标题栏 slot。
  assert.match(mcpPageSource, /DeskSectionTitle title=\{t\("已注册"\)\}/);
  assert.match(mcpPageSource, /DeskSectionTitle title=\{t\("未注册"\)\}/);
  assert.match(mcpPageSource, /DeskPageHeader/);
  assert.match(mcpPageSource, /DeskOverviewCard/);
  assert.match(mcpPageSource, /icon=\{<AriIcon name="hub" \/>\}/);
  assert.match(mcpPageSource, /DeskOverviewDetailsModal/);
  assert.match(mcpPageSource, /DeskOverviewDetailRow/);
  assert.match(mcpPageSource, /mode="slot"/);
  assert.match(mcpPageSource, /listMcpOverview/);
  assert.match(mcpPageSource, /saveMcpRegistration/);
  assert.match(mcpPageSource, /validateMcpRegistration/);
  assert.match(mcpPageSource, /removeMcpRegistration/);
  assert.match(mcpPageSource, /prepareDccRuntime/);
  assert.match(mcpPageSource, /buildDccRuntimeStatusMap/);
  assert.match(mcpPageSource, /renderDccRuntimeAutoPrepareLabel/);
  assert.match(mcpPageSource, /renderDccRuntimeEnvRequirementLabel/);
  assert.match(mcpPageSource, /环境变量：MAYA_BIN/);
  assert.match(mcpPageSource, /环境变量：C4D_BIN/);
  assert.doesNotMatch(mcpPageSource, /label=\{t\("新增 MCP"\)\}/);
  assert.match(mcpPageSource, /createPortal\(headerNode, headerSlotElement\)/);
  assert.match(mcpPageSource, /label=\{t\("文档"\)\}/);
  assert.match(mcpPageSource, /type="text"/);
  assert.match(mcpPageSource, /content=\{t\("管理"\)\}/);
  assert.match(mcpPageSource, /aria-label=\{t\("管理 MCP"\)\}/);
  assert.doesNotMatch(mcpPageSource, /label="刷新"/);
  assert.match(mcpPageSource, /aria-label=\{t\("管理模板"\)\}/);
  assert.match(mcpPageSource, /label=\{dccRuntimeStatusMap\[managingTemplateItem\.software\]\?\.available \? t\("校验 Runtime"\) : t\("准备 Runtime"\)\}/);
  assert.match(mcpPageSource, /aria-label=\{t\("添加 MCP"\)\}/);
  assert.match(mcpPageSource, /<AriButton\s*type="text"\s*icon="add"\s*aria-label=\{t\("添加 MCP"\)\}/s);
  assert.doesNotMatch(mcpPageSource, /模板已添加/);
  assert.match(mcpPageSource, /const unregisteredTemplates = useMemo/);
  assert.match(mcpPageSource, /overview\.templates\.filter\(\(item\) => !registeredTemplateIds\.has\(item\.id\)\)/);
  assert.match(mcpPageSource, /const handleCreateTemplate = useCallback/);
  assert.match(mcpPageSource, /void handleCreateTemplate\(managingTemplateItem\)/);
  assert.match(mcpPageSource, /void handleCreateTemplate\(target\)/);
  assert.match(mcpPageSource, /const validation = saved\.runtimeKind === "dcc_bridge"/);
  assert.match(mcpPageSource, /await validateMcpRegistration\(buildDraftFromRegistration\(saved\), mcpRegistryContext\)/);
  assert.match(mcpPageSource, /已注册 \{\{name\}\}，并完成可用性预检。/);
  assert.match(mcpPageSource, /已注册 \{\{name\}\}，但预检失败：\{\{message\}\}/);
  assert.match(mcpPageSource, /value=\{workspaceId\}/);
  assert.match(mcpPageSource, /label: t\("全局（User）"\)/);
  assert.match(mcpPageSource, /label=\{t\("作用域"\)\}/);
  assert.match(mcpPageSource, /t\("已注册 \{\{count\}\} 个；当前项目：\{\{name\}\}"/);
  assert.match(mcpPageSource, /t\("已注册 \{\{count\}\} 个；当前显示全局 user 级 MCP。"/);
  assert.match(mcpPageSource, /buildDraftFromRegistration/);
  assert.match(mcpPageSource, /可从下方未注册模板新增。/);
  assert.doesNotMatch(mcpPageSource, /Apifox/);
  assert.doesNotMatch(mcpPageSource, /apifox_runtime/);
  assert.doesNotMatch(mcpPageSource, /apifoxOasPath/);
  assert.doesNotMatch(mcpPageSource, /buildDefaultApifoxOasPath/);

  // 描述：
  //
  //   - MCP 服务层应改为调用 Tauri 注册表，不再依赖静态 catalog、远端目录或 localStorage 安装态。
  assert.match(mcpServiceSource, /export interface McpRegistrationItem/);
  assert.match(mcpServiceSource, /export type McpDomain = "general" \| "dcc";/);
  assert.match(mcpServiceSource, /domain: McpDomain;/);
  assert.match(mcpServiceSource, /software: string;/);
  assert.match(mcpServiceSource, /capabilities: string\[];/);
  assert.match(mcpServiceSource, /priority: number;/);
  assert.match(mcpServiceSource, /supportsImport: boolean;/);
  assert.match(mcpServiceSource, /supportsExport: boolean;/);
  assert.match(mcpServiceSource, /export type McpScope = "user" \| "workspace";/);
  assert.match(mcpServiceSource, /export interface McpRegistryContext/);
  assert.match(mcpServiceSource, /export interface McpTemplateItem/);
  assert.match(mcpServiceSource, /listMcpOverview\(context\?: McpRegistryContext\): Promise<McpOverview>/);
  assert.match(mcpServiceSource, /saveMcpRegistration\(\s*draft: McpRegistrationDraft,\s*context\?: McpRegistryContext,/s);
  assert.match(mcpServiceSource, /removeMcpRegistration\(\s*id: string,\s*scope: McpScope,\s*context\?: McpRegistryContext,/s);
  assert.match(mcpServiceSource, /validateMcpRegistration\(/);
  assert.match(mcpServiceSource, /workspaceRoot: workspaceRoot \|\| undefined/);
  assert.match(mcpServiceSource, /COMMANDS\.LIST_REGISTERED_MCPS/);
  assert.match(dccRuntimeServiceSource, /requiredEnvKeys: string\[];/);
  assert.match(dccRuntimeServiceSource, /supportsAutoPrepare: boolean;/);
  assert.match(dccRuntimeServiceSource, /required_env_keys\?: string\[];/);
  assert.match(dccRuntimeServiceSource, /supports_auto_prepare\?: boolean;/);
  assert.match(mcpServiceSource, /COMMANDS\.SAVE_MCP_REGISTRATION/);
  assert.match(mcpServiceSource, /COMMANDS\.REMOVE_MCP_REGISTRATION/);
  assert.match(mcpServiceSource, /COMMANDS\.VALIDATE_MCP_REGISTRATION/);
  assert.match(mcpServiceSource, /checkDccRuntimeStatus/);
  assert.match(mcpServiceSource, /payload\.runtimeKind === "dcc_bridge"/);
  assert.doesNotMatch(mcpServiceSource, /MCP_CATALOG/);
  assert.doesNotMatch(mcpServiceSource, /localStorage/);
  assert.doesNotMatch(mcpServiceSource, /VITE_MCP_CATALOG_URL/);
  assert.doesNotMatch(mcpServiceSource, /Apifox/);
  assert.doesNotMatch(mcpServiceSource, /apifoxOasPath/);
  assert.doesNotMatch(mcpServiceSource, /apifoxSourceMode/);

  // 描述：
  //   - Tauri 注册表模块应持久化 MCP 配置，并提供列出、保存、删除和校验命令。
  assert.match(mcpRegistrySource, /pub async fn list_registered_mcps/);
  assert.match(mcpRegistrySource, /pub async fn save_mcp_registration/);
  assert.match(mcpRegistrySource, /pub async fn remove_mcp_registration/);
  assert.match(mcpRegistrySource, /pub async fn validate_mcp_registration/);
  assert.match(mcpRegistrySource, /resolve_user_mcp_registry_path/);
  assert.match(mcpRegistrySource, /resolve_workspace_mcp_registry_path/);
  assert.match(mcpRegistrySource, /merge_registry_records/);
  assert.match(mcpRegistrySource, /builtin_mcp_templates/);
  assert.match(mcpRegistrySource, /slugify_identifier/);
  assert.match(mcpRegistrySource, /normalize_registration_payload/);
  assert.doesNotMatch(mcpRegistrySource, /本地命令 MCP/);
  assert.doesNotMatch(mcpRegistrySource, /HTTP 地址 MCP/);
  assert.match(mcpRegistrySource, /Playwright 浏览器自动化/);
  assert.match(mcpRegistrySource, /Blender 建模桥接/);
  assert.match(mcpRegistrySource, /Maya 建模桥接/);
  assert.match(mcpRegistrySource, /C4D 建模桥接/);
  assert.match(mcpRegistrySource, /playwright-mcp/);
  assert.match(mcpRegistrySource, /maya-local-bridge/);
  assert.match(mcpRegistrySource, /c4d-local-bridge/);
  assert.match(mcpRegistrySource, /command: "npx"/);
  assert.match(mcpRegistrySource, /"@playwright\/mcp@latest"/);
  assert.match(mcpRegistrySource, /official_provider: "Microsoft"/);
  assert.match(mcpRegistrySource, /docs_url: "https:\/\/github\.com\/microsoft\/playwright-mcp"/);
  assert.match(mcpRegistrySource, /domain: "general"/);
  assert.match(mcpRegistrySource, /resolve_stdio_probe_args/);
  assert.match(mcpRegistrySource, /probe_stdio_registration_command/);
  assert.match(mcpRegistrySource, /已通过运行预检，可自动拉起/);
  assert.match(mcpRegistrySource, /docs_url: "https:\/\/www\.blender\.org\/download\/"/);
  assert.match(mcpRegistrySource, /docs_url: "https:\/\/www\.autodesk\.com\/products\/maya\/buy"/);
  assert.match(mcpRegistrySource, /docs_url: "https:\/\/www\.maxon\.net\/en\/cinema-4d"/);
  assert.match(mcpRegistrySource, /domain: "dcc"/);
  assert.match(mcpRegistrySource, /software: "blender"/);
  assert.match(mcpRegistrySource, /capabilities: vec!\[/);
  assert.match(mcpRegistrySource, /当前版本仅允许添加应用内置 MCP/);
  assert.match(mcpRegistrySource, /find_builtin_mcp_template/);
  assert.match(mcpRegistrySource, /filter_supported_registration_records/);
  assert.doesNotMatch(mcpRegistrySource, /Apifox/);
  assert.doesNotMatch(mcpRegistrySource, /apifox_oas_path/);
  assert.doesNotMatch(mcpRegistrySource, /derive_apifox_runtime_args/);
  assert.doesNotMatch(mcpRegistrySource, /validate_apifox_oas_file/);
  assert.match(tauriMainSource, /mod blender_runtime;/);
  assert.match(tauriMainSource, /mod maya_runtime;/);
  assert.match(tauriMainSource, /mod c4d_runtime;/);

  // 描述：
  //
  //   - 常量与 Tauri 后端必须同时暴露 MCP 注册表命令和 DCC Runtime 能力，且不再保留已移除的 Apifox Runtime 命令。
  assert.match(constantsSource, /LIST_REGISTERED_MCPS: "list_registered_mcps"/);
  assert.match(constantsSource, /SAVE_MCP_REGISTRATION: "save_mcp_registration"/);
  assert.match(constantsSource, /REMOVE_MCP_REGISTRATION: "remove_mcp_registration"/);
  assert.match(constantsSource, /VALIDATE_MCP_REGISTRATION: "validate_mcp_registration"/);
  assert.match(tauriMainSource, /mod mcp_registry;/);
  assert.match(tauriMainSource, /list_registered_mcps,/);
  assert.match(tauriMainSource, /save_mcp_registration,/);
  assert.match(tauriMainSource, /remove_mcp_registration,/);
  assert.match(tauriMainSource, /validate_mcp_registration,/);
  assert.match(constantsSource, /CHECK_DCC_RUNTIME_STATUS: "check_dcc_runtime_status"/);
  assert.match(constantsSource, /PREPARE_DCC_RUNTIME: "prepare_dcc_runtime"/);
  assert.match(tauriMainSource, /prepare_dcc_runtime,/);
  assert.match(tauriMainSource, /check_dcc_runtime_status,/);
  assert.match(tauriMainSource, /app_data_dir\(\)/);
  assert.doesNotMatch(constantsSource, /MCP_INSTALLED_IDS/);
  assert.doesNotMatch(envSource, /VITE_MCP_CATALOG_URL/);
  assert.doesNotMatch(constantsSource, /APIFOX/);
  assert.doesNotMatch(tauriMainSource, /Apifox/);
  assert.doesNotMatch(tauriMainSource, /apifox_runtime/);
  assert.doesNotMatch(tauriMainSource, /validate_apifox_oas_file/);
});

test("TestMcpRegistryShouldInjectRuntimeIntoUnifiedAgentAndPromptGuidance", () => {
  const agentRuntimeServiceSource = readDesktopSource("src/modules/common/services/agent-runtime.ts");
  const serviceIndexSource = readDesktopSource("src/modules/common/services/index.ts");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const tauriMainSource = readDesktopSource("src-tauri/src/main.rs");
  const runtimeServerSource = readDesktopSource("../../crates/runtime/server/src/lib.rs");
  const coreLibSource = readDesktopSource("../../crates/core/agent/src/lib.rs");
  const coreToolSource = readDesktopSource("../../crates/core/agent/src/tools/mcp.rs");
  const corePromptSource = readDesktopSource("../../crates/core/agent/src/python_orchestrator.rs");
  const runtimeCapabilitiesSource = readDesktopSource("../../crates/core/agent/src/runtime_capabilities.rs");
  const promptGuidanceSource = readDesktopSource("src/shared/workflow/prompt-guidance.ts");

  // 描述：
  //
  //   - Tauri 侧应先暴露统一运行时能力查询命令；Desktop 通过 runtime 探测能力，runtime 服务再调用 core 统一能力解析器。
  assert.match(constantsSource, /GET_AGENT_RUNTIME_CAPABILITIES: "get_agent_runtime_capabilities"/);
  assert.match(tauriMainSource, /async fn get_agent_runtime_capabilities/);
  assert.match(tauriMainSource, /get_agent_runtime_capabilities_inner/);
  assert.match(tauriMainSource, /detect_capabilities\(DetectCapabilitiesRequest \{/);
  assert.match(runtimeServerSource, /detect_agent_runtime_capabilities\(mcps\.as_slice\(\)\)/);
  assert.match(tauriMainSource, /runtime_capabilities: Option<AgentRuntimeCapabilities>/);
  assert.match(tauriMainSource, /get_agent_runtime_capabilities,/);
  assert.match(tauriMainSource, /build_runtime_registered_mcps/);
  assert.match(tauriMainSource, /list_enabled_mcp_registrations/);
  assert.match(tauriMainSource, /available_mcps:\s*available_mcps/);
  assert.match(tauriMainSource, /runtime_capabilities: Some\(core_runtime_capabilities_to_runtime_payload\(/);
  assert.match(tauriMainSource, /interactive_mode=/);

  // 描述：
  //   - 运行时能力服务与导出入口应统一透传 Tauri 能力查询结果。
  assert.match(agentRuntimeServiceSource, /export interface AgentRuntimeCapabilityContext/);
  assert.match(agentRuntimeServiceSource, /export async function getAgentRuntimeCapabilities/);
  assert.match(agentRuntimeServiceSource, /COMMANDS\.GET_AGENT_RUNTIME_CAPABILITIES/);
  assert.match(agentRuntimeServiceSource, /normalizeAgentRuntimeCapabilities/);
  assert.match(serviceIndexSource, /export \* from "\.\/agent-runtime";/);

  // 描述：
  //
  //   - core agent 请求结构应显式携带 MCP 快照与运行时能力快照，且 Playwright fallback 识别逻辑必须收敛到统一解析器。
  assert.match(coreLibSource, /pub struct AgentRegisteredMcp/);
  assert.match(coreLibSource, /pub template_id: String,/);
  assert.match(coreLibSource, /pub available_mcps: Vec<AgentRegisteredMcp>/);
  assert.match(coreLibSource, /pub runtime_capabilities: AgentRuntimeCapabilities,/);
  assert.match(runtimeCapabilitiesSource, /pub enum AgentInteractiveMode/);
  assert.match(runtimeCapabilitiesSource, /pub struct AgentRuntimeCapabilities/);
  assert.match(runtimeCapabilitiesSource, /template_id/);
  assert.match(runtimeCapabilitiesSource, /eq_ignore_ascii_case\("playwright-mcp"\)/);
  assert.match(runtimeCapabilitiesSource, /detect_native_browser_tool_capabilities/);
  assert.match(runtimeCapabilitiesSource, /build_native_skip_reason/);
  assert.match(coreToolSource, /pub struct McpTool/);
  assert.match(coreToolSource, /fn name\(&self\) -> &'static str \{\n        "mcp_tool"/);
  assert.match(coreToolSource, /tools\/call/);
  assert.match(coreToolSource, /tools\/list/);

  // 描述：
  //
  //   - 提示词指导层应基于统一运行时能力动态注入 native / mcp / none 三种 Playwright 契约。
  assert.match(corePromptSource, /mcp_tool/);
  assert.match(corePromptSource, /tool="list_tools"/);
  assert.match(corePromptSource, /build_python_playwright_runtime_prompt_block/);
  assert.match(corePromptSource, /build_skipped_playwright_interactive_result/);
  assert.match(corePromptSource, /js_repl\/js_repl_reset\/browser_navigate/);
  assert.match(promptGuidanceSource, /mcp_tool/);
  assert.match(promptGuidanceSource, /export interface AgentRuntimeCapabilities/);
  assert.match(promptGuidanceSource, /export const DEFAULT_AGENT_RUNTIME_CAPABILITIES/);
  assert.match(promptGuidanceSource, /buildAgentToolsetLines/);
  assert.match(promptGuidanceSource, /buildPlaywrightInteractiveRuntimePrompt/);
  assert.match(promptGuidanceSource, /当前阶段必须显式标记为“已跳过”/);
  assert.doesNotMatch(promptGuidanceSource, /mcp_model_tool/);
});
