import { invoke } from "@tauri-apps/api/core";
import { COMMANDS } from "../../../shared/constants";
import { translateDesktopText } from "../../../shared/i18n";

export type AgentSkillStatus = "stable" | "testing" | string;

// 描述：
//
//   - 定义单个 Agent Skill 结构，统一承载标准技能包的元信息、正文与来源。
export interface AgentSkillItem {
  id: string;
  title: string;
  description: string;
  examplePrompt: string;
  version: string;
  status: AgentSkillStatus;
  group: string;
  icon: string;
  source: "builtin" | "external" | string;
  rootPath: string;
  skillFilePath: string;
  markdownBody: string;
  runtimeRequirements: Record<string, unknown>;
  removable: boolean;
}

// 描述：
//
//   - 定义技能页总览结构，按“已注册 / 未注册 / 全量内置”三组数据返回。
export interface SkillOverview {
  registered: AgentSkillItem[];
  unregistered: AgentSkillItem[];
  all: AgentSkillItem[];
}

interface RawAgentSkillItem {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  example_prompt?: unknown;
  version?: unknown;
  status?: unknown;
  group?: unknown;
  icon?: unknown;
  source?: unknown;
  root_path?: unknown;
  skill_file_path?: unknown;
  markdown_body?: unknown;
  runtime_requirements?: unknown;
  removable?: unknown;
}

interface RawSkillOverview {
  registered?: unknown;
  unregistered?: unknown;
  all?: unknown;
}

// 描述：
//
//   - 定义桌面端允许消费的技能图标白名单，仅允许映射到应用内置图标名，避免元数据注入任意资源路径。
const AGENT_SKILL_ICON_NAMES = {
  libra_skill: "new_releases",
} as const;

// 描述：
//
//   - 定义技能图标兜底键，确保旧数据或异常数据仍能渲染应用内置图标。
const DEFAULT_AGENT_SKILL_ICON_KEY = "libra_skill" as const;

// 描述：
//
//   - 规整技能分组名称；若后端缺失该字段则回退为稳定的中文兜底值，避免页面分组标题出现空白。
//
// Params:
//
//   - rawValue: Tauri 返回的原始分组值。
//   - fallbackLabel: 兜底分组文案。
//
// Returns:
//
//   - 归一化后的分组名称。
function normalizeSkillCategoryLabel(rawValue: unknown, fallbackLabel: string): string {
  const normalizedValue = String(rawValue || "").trim();
  return normalizedValue || translateDesktopText(fallbackLabel);
}

// 描述：
//
//   - 将未知值规整为对象，供技能运行时元数据统一消费；非法值统一回退为空对象。
//
// Params:
//
//   - rawValue: 原始运行时元数据。
//
// Returns:
//
//   - 归一化后的运行时元数据对象。
function normalizeRuntimeRequirements(rawValue: unknown): Record<string, unknown> {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }
  return rawValue as Record<string, unknown>;
}

// 描述：
//
//   - 规整技能版本号；后端已做严格校验，这里主要提供前端兜底，避免异常值污染展示文案。
//
// Params:
//
//   - rawValue: 原始版本号。
//
// Returns:
//
//   - 归一化后的版本号。
function normalizeSkillVersion(rawValue: unknown): string {
  const normalizedVersion = String(rawValue || "").trim();
  return /^\d+\.\d+\.\d+$/.test(normalizedVersion) ? normalizedVersion : "0.0.0";
}

// 描述：
//
//   - 规整技能状态；当前桌面端只识别 `stable` / `testing`，其他值统一按稳定版处理。
//
// Params:
//
//   - rawValue: 原始状态值。
//
// Returns:
//
//   - 归一化后的技能状态。
function normalizeSkillStatus(rawValue: unknown): AgentSkillStatus {
  const normalizedStatus = String(rawValue || "").trim().toLowerCase();
  return normalizedStatus === "testing" ? "testing" : "stable";
}

// 描述：
//
//   - 规整技能图标键，仅允许白名单中的内置图标名；未知值统一回退默认图标键。
//
// Params:
//
//   - rawIcon: Tauri 返回的原始图标键。
//
// Returns:
//
//   - 白名单内的技能图标键。
function normalizeSkillIconKey(rawIcon: string): keyof typeof AGENT_SKILL_ICON_NAMES {
  const normalizedIcon = rawIcon.trim() as keyof typeof AGENT_SKILL_ICON_NAMES;
  if (normalizedIcon && normalizedIcon in AGENT_SKILL_ICON_NAMES) {
    return normalizedIcon;
  }
  return DEFAULT_AGENT_SKILL_ICON_KEY;
}

// 描述：
//
//   - 将技能图标键解析为前端可直接渲染的图标名，默认复用侧边栏“技能”入口同款图标。
//
// Params:
//
//   - iconKey: 技能元数据中的图标键。
//
// Returns:
//
//   - 图标名。
export function resolveAgentSkillIconName(iconKey: string): string {
  const normalizedIconKey = normalizeSkillIconKey(iconKey);
  return AGENT_SKILL_ICON_NAMES[normalizedIconKey];
}

// 描述：
//
//   - 将技能状态解析为用户可读标签，供技能页直接展示版本稳定性。
//
// Params:
//
//   - status: 技能状态值。
//
// Returns:
//
//   - 状态标签文案。
export function resolveAgentSkillStatusLabel(status: AgentSkillStatus): string {
  return normalizeSkillStatus(status) === "testing"
    ? translateDesktopText("测试中")
    : translateDesktopText("正式");
}

// 描述：
//
//   - 将 Tauri 返回的原始技能记录归一化为前端统一结构，过滤缺失关键字段的数据。
//
// Params:
//
//   - rawItem: 原始技能记录。
//
// Returns:
//
//   - 合法技能记录；若缺失关键字段则返回 null。
function normalizeAgentSkillItem(rawItem: unknown): AgentSkillItem | null {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }
  const source = rawItem as RawAgentSkillItem;
  const id = String(source.id || "").trim();
  const title = String(source.title || "").trim();
  const skillFilePath = String(source.skill_file_path || "").trim();
  if (!id || !title || !skillFilePath) {
    return null;
  }
  return {
    id,
    title,
    description: String(source.description || "").trim(),
    examplePrompt: String(source.example_prompt || "").trim(),
    version: normalizeSkillVersion(source.version),
    status: normalizeSkillStatus(source.status),
    group: normalizeSkillCategoryLabel(source.group, "未分组"),
    icon: normalizeSkillIconKey(String(source.icon || "").trim()),
    source: String(source.source || "builtin").trim() || "builtin",
    rootPath: String(source.root_path || "").trim(),
    skillFilePath,
    markdownBody: String(source.markdown_body || "").trim(),
    runtimeRequirements: normalizeRuntimeRequirements(source.runtime_requirements),
    removable: Boolean(source.removable),
  };
}

// 描述：
//
//   - 将 Tauri 返回的原始技能总览归一化为前端稳定结构，避免后端字段缺失时页面渲染报错。
//
// Params:
//
//   - rawOverview: 原始技能总览对象。
//
// Returns:
//
//   - 归一化后的技能总览结构。
function normalizeSkillOverview(rawOverview: unknown): SkillOverview {
  if (!rawOverview || typeof rawOverview !== "object") {
    return {
      registered: [],
      unregistered: [],
      all: [],
    };
  }
  const source = rawOverview as RawSkillOverview;
  const normalizeItems = (rawItems: unknown): AgentSkillItem[] => (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => normalizeAgentSkillItem(item))
    .filter((item): item is AgentSkillItem => Boolean(item));
  return {
    registered: normalizeItems(source.registered),
    unregistered: normalizeItems(source.unregistered),
    all: normalizeItems(source.all),
  };
}

// 描述：
//
//   - 统一通过 Tauri 拉取“已注册技能”列表，供会话和工作流只消费真正已生效的技能集合。
//
// Returns:
//
//   - 按后端排序返回的已注册技能列表。
export async function listAgentSkills(): Promise<AgentSkillItem[]> {
  const payload = await invoke<unknown[]>(COMMANDS.LIST_AGENT_SKILLS);
  return (Array.isArray(payload) ? payload : [])
    .map((item) => normalizeAgentSkillItem(item))
    .filter((item): item is AgentSkillItem => Boolean(item));
}

// 描述：
//
//   - 拉取技能页总览，统一返回“已注册 / 未注册 / 全量内置”结构，供页面层直接渲染。
//
// Returns:
//
//   - 技能总览结构。
export async function listSkillOverview(): Promise<SkillOverview> {
  const payload = await invoke<unknown>(COMMANDS.LIST_AGENT_SKILL_OVERVIEW);
  return normalizeSkillOverview(payload);
}

// 描述：
//
//   - 注册指定内置技能，并返回最新技能总览，供页面层同步刷新已注册/未注册分区。
//
// Params:
//
//   - skillId: 待注册的技能 ID。
//
// Returns:
//
//   - 注册后的技能总览。
export async function registerBuiltinAgentSkill(skillId: string): Promise<SkillOverview> {
  const payload = await invoke<unknown>(COMMANDS.REGISTER_BUILTIN_AGENT_SKILL, {
    skillId,
  });
  return normalizeSkillOverview(payload);
}

// 描述：
//
//   - 取消注册指定内置技能，并返回最新技能总览，供页面层同步刷新已注册/未注册分区。
//
// Params:
//
//   - skillId: 待取消注册的技能 ID。
//
// Returns:
//
//   - 取消注册后的技能总览。
export async function unregisterBuiltinAgentSkill(skillId: string): Promise<SkillOverview> {
  const payload = await invoke<unknown>(COMMANDS.UNREGISTER_BUILTIN_AGENT_SKILL, {
    skillId,
  });
  return normalizeSkillOverview(payload);
}

// 描述：
//
//   - 打开指定内置技能所在目录，供用户直接查看 `SKILL.md` 所在文件夹与相关资源文件。
//
// Params:
//
//   - skillId: 待打开目录的技能 ID。
//
// Returns:
//
//   - true 表示系统打开命令已成功发起。
export async function openBuiltinAgentSkillFolder(skillId: string): Promise<boolean> {
  return invoke<boolean>(COMMANDS.OPEN_BUILTIN_AGENT_SKILL_FOLDER, {
    skillId,
  });
}

// 描述：
//
//   - 打开本地目录选择器，供用户选择待导入的标准技能包目录。
//
// Returns:
//
//   - 选中的目录路径；若取消则返回 null。
export async function pickLocalAgentSkillFolder(): Promise<string | null> {
  const selectedPath = await invoke<string | null>(COMMANDS.PICK_AGENT_SKILL_FOLDER);
  const normalizedPath = String(selectedPath || "").trim();
  return normalizedPath || null;
}

// 描述：
//
//   - 将指定本地目录导入到外部技能根目录，并返回最新技能记录。
//
// Params:
//
//   - path: 本地技能目录路径。
//
// Returns:
//
//   - 导入后的技能记录。
export async function importAgentSkillFromPath(path: string): Promise<AgentSkillItem> {
  const payload = await invoke<unknown>(COMMANDS.IMPORT_AGENT_SKILL_FROM_PATH, {
    path,
  });
  const normalized = normalizeAgentSkillItem(payload);
  if (!normalized) {
    throw new Error(translateDesktopText("导入技能后的返回结果无效。"));
  }
  return normalized;
}

// 描述：
//
//   - 移除外部技能目录，并返回最新总览，供页面层直接刷新展示。
//
// Params:
//
//   - skillId: 待移除的技能名称。
//
// Returns:
//
//   - 移除后的技能总览。
export async function removeAgentSkill(skillId: string): Promise<SkillOverview> {
  await invoke<boolean>(COMMANDS.REMOVE_USER_AGENT_SKILL, {
    skillId,
  });
  return listSkillOverview();
}
