import { invoke } from "@tauri-apps/api/core";
import { COMMANDS } from "../../../shared/constants";
import { translateDesktopText } from "../../../shared/i18n";

// 描述：
//
//   - 定义单个 Agent Skill 结构，统一承载标准技能包的元信息、正文与来源。
export interface AgentSkillItem {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "external" | string;
  rootPath: string;
  skillFilePath: string;
  markdownBody: string;
  runtimeRequirements: Record<string, unknown>;
  removable: boolean;
}

// 描述：
//
//   - 定义技能页总览结构，按“应用内置 / 外部技能”分组返回。
export interface SkillOverview {
  builtin: AgentSkillItem[];
  external: AgentSkillItem[];
  all: AgentSkillItem[];
}

interface RawAgentSkillItem {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  source?: unknown;
  root_path?: unknown;
  skill_file_path?: unknown;
  markdown_body?: unknown;
  runtime_requirements?: unknown;
  removable?: unknown;
}

interface SkillDisplayPreset {
  name: string;
  description: string;
}

function resolveExternalSkillDisplayPreset(skillId: string): SkillDisplayPreset | null {
  if (skillId === "doc") {
    return {
      name: translateDesktopText("文档处理"),
      description: translateDesktopText("读取、创建或编辑 Word 文档，适合排版和格式要求较高的文档任务。"),
    };
  }
  if (skillId === "repo-readme") {
    return {
      name: translateDesktopText("仓库说明"),
      description: translateDesktopText("编写和维护仓库 README，适合整理项目简介、快速开始和使用说明。"),
    };
  }
  if (skillId === "skill-creator") {
    return {
      name: translateDesktopText("技能创建"),
      description: translateDesktopText("创建或更新 Codex 技能，适合沉淀专用流程、提示词和工具约束。"),
    };
  }
  if (skillId === "skill-installer") {
    return {
      name: translateDesktopText("技能安装"),
      description: translateDesktopText("安装或同步 Codex 技能，适合从列表或仓库导入技能包。"),
    };
  }
  return null;
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
//   - 解析技能展示名称。对于外部通用技能，统一输出中文友好名称，避免直接暴露英文目录名。
//
// Params:
//
//   - skillId: 技能唯一标识。
//   - rawName: Tauri 返回的原始技能名称。
//
// Returns:
//
//   - 前端用于展示的技能名称。
function resolveSkillDisplayName(skillId: string, rawName: string): string {
  const preset = resolveExternalSkillDisplayPreset(skillId);
  return preset?.name || rawName;
}

// 描述：
//
//   - 解析技能展示说明。对于外部通用技能，统一输出简短中文说明，避免直接展示英文长描述。
//
// Params:
//
//   - skillId: 技能唯一标识。
//   - rawDescription: Tauri 返回的原始技能说明。
//
// Returns:
//
//   - 前端用于展示的技能说明。
function resolveSkillDisplayDescription(skillId: string, rawDescription: string): string {
  const preset = resolveExternalSkillDisplayPreset(skillId);
  return preset?.description || rawDescription;
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
  const name = String(source.name || "").trim();
  const skillFilePath = String(source.skill_file_path || "").trim();
  if (!id || !name || !skillFilePath) {
    return null;
  }
  return {
    id,
    name: resolveSkillDisplayName(id, name),
    description: resolveSkillDisplayDescription(id, String(source.description || "").trim()),
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
//   - 统一通过 Tauri 拉取 Agent Skills 注册表，确保技能发现来源于真实 `SKILL.md` 包目录。
//
// Returns:
//
//   - 按后端排序返回的技能列表。
export async function listAgentSkills(): Promise<AgentSkillItem[]> {
  const payload = await invoke<unknown[]>(COMMANDS.LIST_AGENT_SKILLS);
  return (Array.isArray(payload) ? payload : [])
    .map((item) => normalizeAgentSkillItem(item))
    .filter((item): item is AgentSkillItem => Boolean(item));
}

// 描述：
//
//   - 生成技能页总览结构，统一按来源分组，供页面层直接渲染。
//
// Returns:
//
//   - 技能总览结构。
export async function listSkillOverview(): Promise<SkillOverview> {
  const all = await listAgentSkills();
  return {
    builtin: all.filter((item) => item.source === "builtin"),
    external: all.filter((item) => item.source !== "builtin"),
    all,
  };
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
