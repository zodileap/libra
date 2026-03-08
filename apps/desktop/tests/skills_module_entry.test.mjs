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

test("TestSkillsPageShouldUseAgentSkillRegistryAndImportFlow", () => {
  const skillsPageSource = readDesktopSource("src/modules/common/pages/skills-page.tsx");
  const skillServiceSource = readDesktopSource("src/modules/common/services/skills.ts");
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const tauriSkillRegistrySource = readDesktopSource("src-tauri/src/agent_skills.rs");
  const tauriMainSource = readDesktopSource("src-tauri/src/main.rs");
  const tauriConfigSource = readDesktopSource("src-tauri/tauri.conf.json");
  const buildSource = readDesktopSource("src-tauri/build.rs");
  const cargoSource = readDesktopSource("src-tauri/Cargo.toml");
  const styleSource = readDesktopSource("src/styles.css");
  const builtinSkillPath = path.resolve(process.cwd(), "src-tauri/resources/skills/requirements-analyst/SKILL.md");
  const builtinSkillSource = fs.readFileSync(builtinSkillPath, "utf8");
  const dccSkillPath = path.resolve(process.cwd(), "src-tauri/resources/skills/dcc-modeling/SKILL.md");
  const dccSkillSource = fs.readFileSync(dccSkillPath, "utf8");
  const dccSkillRuntimePath = path.resolve(process.cwd(), "src-tauri/resources/skills/dcc-modeling/runtime/requirements.json");
  const dccSkillRuntimeSource = fs.readFileSync(dccSkillRuntimePath, "utf8");

  // 描述：
  //
  //   - 技能页应展示“应用内置/外部技能”分区，并支持导入本地技能与移除外部技能。
  assert.match(skillsPageSource, /DeskSectionTitle title="应用内置"/);
  assert.match(skillsPageSource, /DeskSectionTitle title="外部技能"/);
  assert.match(skillsPageSource, /label="导入本地技能"/);
  assert.match(skillsPageSource, /title="移除外部技能"/);
  assert.match(skillsPageSource, /pickLocalAgentSkillFolder/);
  assert.match(skillsPageSource, /importAgentSkillFromPath/);
  assert.match(skillsPageSource, /removeAgentSkill/);
  assert.match(skillsPageSource, /createPortal\(headerNode, headerSlotElement\)/);

  // 描述：
  //
  //   - 技能服务层应改为调用 Tauri 注册表，不再依赖前端静态 catalog 或 localStorage 安装态。
  assert.match(skillServiceSource, /export interface AgentSkillItem/);
  assert.match(skillServiceSource, /markdownBody: string;/);
  assert.match(skillServiceSource, /runtimeRequirements: Record<string, unknown>;/);
  assert.match(skillServiceSource, /removable: boolean;/);
  assert.match(skillServiceSource, /invoke<unknown\[]>\(COMMANDS\.LIST_AGENT_SKILLS\)/);
  assert.match(skillServiceSource, /invoke<string \| null>\(COMMANDS\.PICK_AGENT_SKILL_FOLDER\)/);
  assert.match(skillServiceSource, /COMMANDS\.IMPORT_AGENT_SKILL_FROM_PATH/);
  assert.match(skillServiceSource, /COMMANDS\.REMOVE_USER_AGENT_SKILL/);
  assert.doesNotMatch(skillServiceSource, /SKILL_CATALOG/);
  assert.doesNotMatch(skillServiceSource, /localStorage/);

  // 描述：
  //
  //   - 常量层应暴露新的 Agent Skills 命令名。
  assert.match(constantsSource, /LIST_AGENT_SKILLS: "list_agent_skills"/);
  assert.match(constantsSource, /PICK_AGENT_SKILL_FOLDER: "pick_agent_skill_folder"/);
  assert.match(constantsSource, /IMPORT_AGENT_SKILL_FROM_PATH: "import_agent_skill_from_path"/);
  assert.match(constantsSource, /REMOVE_USER_AGENT_SKILL: "remove_user_agent_skill"/);

  // 描述：
  //
  //   - Tauri 侧应具备标准技能扫描、YAML frontmatter 解析和本地导入/删除命令。
  assert.match(tauriSkillRegistrySource, /pub async fn list_agent_skills/);
  assert.match(tauriSkillRegistrySource, /pub async fn pick_agent_skill_folder/);
  assert.match(tauriSkillRegistrySource, /pub async fn import_agent_skill_from_path/);
  assert.match(tauriSkillRegistrySource, /pub async fn remove_user_agent_skill/);
  assert.match(tauriSkillRegistrySource, /serde_yaml::from_str/);
  assert.match(tauriSkillRegistrySource, /read_optional_runtime_requirements/);
  assert.match(tauriSkillRegistrySource, /resolve_external_skill_root/);
  assert.match(tauriSkillRegistrySource, /CODEX_HOME/);
  assert.match(tauriSkillRegistrySource, /copy_directory_recursive/);
  assert.match(tauriMainSource, /mod agent_skills;/);
  assert.match(tauriMainSource, /list_agent_skills,/);
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
  //   - 至少应存在一个标准内置技能包，并包含合法 frontmatter 与正文。
  assert.match(builtinSkillSource, /^---\nname: requirements-analyst\ndescription:/);
  assert.match(builtinSkillSource, /# 需求分析/);
  assert.match(dccSkillSource, /^---\nname: dcc-modeling\ndescription:/);
  assert.match(dccSkillSource, /# 建模执行/);
  assert.match(dccSkillSource, /如果用户表达了“跨软件导出\/导入\/迁移”意图，但没有明确提到两个或以上建模软件，必须先让用户选择源软件和目标软件/);
  assert.match(dccSkillRuntimeSource, /"domain": "dcc-modeling"/);
  assert.match(dccSkillRuntimeSource, /"require_user_choice_when_multiple": true/);
  assert.match(dccSkillRuntimeSource, /"require_cross_dcc_source_and_target_choice_when_not_explicit": true/);

  // 描述：
  //
  //   - 样式层仍应复用现有技能卡片布局类，不额外引入静态 catalog 特有结构。
  assert.match(styleSource, /\.desk-skills-shell/);
  assert.match(styleSource, /\.desk-skill-grid/);
  assert.match(styleSource, /\.desk-skill-card/);
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
  //   - MCP 页应包含“已注册/推荐模板”分区，并提供新增、编辑、校验和 Runtime 管理入口。
  assert.match(mcpPageSource, /DeskSectionTitle title="已注册"/);
  assert.match(mcpPageSource, /DeskSectionTitle title="推荐模板"/);
  assert.match(mcpPageSource, /listMcpOverview/);
  assert.match(mcpPageSource, /saveMcpRegistration/);
  assert.match(mcpPageSource, /validateMcpRegistration/);
  assert.match(mcpPageSource, /removeMcpRegistration/);
  assert.match(mcpPageSource, /installApifoxMcpRuntime/);
  assert.match(mcpPageSource, /uninstallApifoxMcpRuntime/);
  assert.match(mcpPageSource, /prepareDccRuntime/);
  assert.match(mcpPageSource, /buildDccRuntimeStatusMap/);
  assert.match(mcpPageSource, /label=\{dccRuntimeStatus\?\.available \? "重新校验" : "准备 Runtime"\}/);
  assert.match(mcpPageSource, /renderDccRuntimeAutoPrepareLabel/);
  assert.match(mcpPageSource, /renderDccRuntimeEnvRequirementLabel/);
  assert.match(mcpPageSource, /环境变量：MAYA_BIN/);
  assert.match(mcpPageSource, /环境变量：C4D_BIN/);
  assert.match(mcpPageSource, /label=\"新增 MCP\"/);
  assert.match(mcpPageSource, /createPortal\(headerNode, headerSlotElement\)/);
  assert.match(mcpPageSource, /安装 Runtime/);
  assert.match(mcpPageSource, /文档：/);
  assert.match(mcpPageSource, /value=\{workspaceId\}/);
  assert.match(mcpPageSource, /label: "全局（User）"/);
  assert.match(mcpPageSource, /label="作用域"/);
  assert.match(mcpPageSource, /workspace 级配置会覆盖同名 user 级 MCP/);
  assert.match(mcpPageSource, /renderScopeLabel\(item\.scope\)/);

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
  assert.match(mcpServiceSource, /COMMANDS\.CHECK_APIFOX_MCP_RUNTIME_STATUS/);
  assert.match(mcpServiceSource, /checkDccRuntimeStatus/);
  assert.match(mcpServiceSource, /payload\.runtimeKind === "dcc_bridge"/);
  assert.doesNotMatch(mcpServiceSource, /MCP_CATALOG/);
  assert.doesNotMatch(mcpServiceSource, /localStorage/);
  assert.doesNotMatch(mcpServiceSource, /VITE_MCP_CATALOG_URL/);

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
  assert.match(mcpRegistrySource, /Apifox 官方 MCP/);
  assert.match(mcpRegistrySource, /Blender 本地 Bridge/);
  assert.match(mcpRegistrySource, /maya-local-bridge/);
  assert.match(mcpRegistrySource, /c4d-local-bridge/);
  assert.match(mcpRegistrySource, /docs_url: "https:\/\/www\.blender\.org\/download\/"/);
  assert.match(mcpRegistrySource, /docs_url: "https:\/\/www\.autodesk\.com\/products\/maya\/buy"/);
  assert.match(mcpRegistrySource, /docs_url: "https:\/\/www\.maxon\.net\/en\/cinema-4d"/);
  assert.match(mcpRegistrySource, /domain: "dcc"/);
  assert.match(mcpRegistrySource, /software: "blender"/);
  assert.match(mcpRegistrySource, /capabilities: vec!\[/);
  assert.match(tauriMainSource, /mod blender_runtime;/);
  assert.match(tauriMainSource, /mod maya_runtime;/);
  assert.match(tauriMainSource, /mod c4d_runtime;/);

  // 描述：
  //
  //   - 常量与 Tauri 后端必须同时暴露 MCP 注册表命令和 Apifox Runtime 安装能力。
  assert.match(constantsSource, /LIST_REGISTERED_MCPS: "list_registered_mcps"/);
  assert.match(constantsSource, /SAVE_MCP_REGISTRATION: "save_mcp_registration"/);
  assert.match(constantsSource, /REMOVE_MCP_REGISTRATION: "remove_mcp_registration"/);
  assert.match(constantsSource, /VALIDATE_MCP_REGISTRATION: "validate_mcp_registration"/);
  assert.match(constantsSource, /CHECK_APIFOX_MCP_RUNTIME_STATUS: "check_apifox_mcp_runtime_status"/);
  assert.match(constantsSource, /INSTALL_APIFOX_MCP_RUNTIME: "install_apifox_mcp_runtime"/);
  assert.match(constantsSource, /UNINSTALL_APIFOX_MCP_RUNTIME: "uninstall_apifox_mcp_runtime"/);
  assert.match(tauriMainSource, /mod mcp_registry;/);
  assert.match(tauriMainSource, /list_registered_mcps,/);
  assert.match(tauriMainSource, /save_mcp_registration,/);
  assert.match(tauriMainSource, /remove_mcp_registration,/);
  assert.match(tauriMainSource, /validate_mcp_registration,/);
  assert.match(tauriMainSource, /async fn check_apifox_mcp_runtime_status\(/);
  assert.match(tauriMainSource, /async fn install_apifox_mcp_runtime\(/);
  assert.match(tauriMainSource, /async fn uninstall_apifox_mcp_runtime\(/);
  assert.match(tauriMainSource, /check_apifox_mcp_runtime_status,/);
  assert.match(tauriMainSource, /install_apifox_mcp_runtime,/);
  assert.match(tauriMainSource, /uninstall_apifox_mcp_runtime,/);
  assert.match(constantsSource, /CHECK_DCC_RUNTIME_STATUS: "check_dcc_runtime_status"/);
  assert.match(constantsSource, /PREPARE_DCC_RUNTIME: "prepare_dcc_runtime"/);
  assert.match(tauriMainSource, /prepare_dcc_runtime,/);
  assert.match(tauriMainSource, /check_dcc_runtime_status,/);
  assert.match(tauriMainSource, /resolve_apifox_mcp_runtime_root/);
  assert.match(tauriMainSource, /app_data_dir\(\)/);
  assert.match(tauriMainSource, /npm install/);
  assert.doesNotMatch(constantsSource, /MCP_INSTALLED_IDS/);
  assert.doesNotMatch(envSource, /VITE_MCP_CATALOG_URL/);
});

test("TestMcpRegistryShouldInjectRuntimeIntoUnifiedAgentAndPromptGuidance", () => {
  const tauriMainSource = readDesktopSource("src-tauri/src/main.rs");
  const coreLibSource = readDesktopSource("../../crates/core/agent/src/lib.rs");
  const coreToolSource = readDesktopSource("../../crates/core/agent/src/tools/mcp.rs");
  const corePromptSource = readDesktopSource("../../crates/core/agent/src/python_orchestrator.rs");
  const promptGuidanceSource = readDesktopSource("src/shared/workflow/prompt-guidance.ts");

  // 描述：
  //
  //   - Tauri 侧应在执行统一智能体前注入启用中的 MCP 注册项，而不是只停留在管理页。
  assert.match(tauriMainSource, /build_runtime_registered_mcps/);
  assert.match(tauriMainSource, /list_enabled_mcp_registrations/);
  assert.match(tauriMainSource, /available_mcps,/);

  // 描述：
  //
  //   - core agent 请求结构应显式携带 MCP 快照，工具层需使用通用 mcp_tool 命名。
  assert.match(coreLibSource, /pub struct AgentRegisteredMcp/);
  assert.match(coreLibSource, /pub available_mcps: Vec<AgentRegisteredMcp>/);
  assert.match(coreToolSource, /pub struct McpTool/);
  assert.match(coreToolSource, /fn name\(&self\) -> &'static str \{\n        "mcp_tool"/);
  assert.match(coreToolSource, /tools\/call/);
  assert.match(coreToolSource, /tools\/list/);

  // 描述：
  //
  //   - 提示词指导层应切换到通用 mcp_tool，并提示先用 list_tools 探测能力。
  assert.match(corePromptSource, /mcp_tool/);
  assert.match(corePromptSource, /tool="list_tools"/);
  assert.match(promptGuidanceSource, /mcp_tool/);
  assert.doesNotMatch(promptGuidanceSource, /mcp_model_tool/);
});
