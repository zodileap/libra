// 描述：
//
//   - 定义技能目录项结构，供技能页渲染“已安装/推荐”列表。
export interface SkillCatalogItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  versions: string[];
  installedByDefault?: boolean;
}

// 描述：
//
//   - 定义技能页总览结构。
export interface SkillOverview {
  installed: SkillCatalogItem[];
  marketplace: SkillCatalogItem[];
}

// 描述：
//
//   - 本地持久化技能安装状态的存储键。
const SKILL_INSTALL_STATE_STORAGE_KEY = "zodileap.desktop.skills.installed";

// 描述：
//
//   - 技能目录清单；MVP 阶段先由前端内置，后续替换为服务端目录接口。
const SKILL_CATALOG: SkillCatalogItem[] = [
  {
    id: "skill_creator",
    name: "Skill Creator",
    description: "创建或维护技能定义模板。",
    icon: "note_stack_add",
    versions: ["1.0.0"],
    installedByDefault: true,
  },
  {
    id: "skill_installer",
    name: "Skill Installer",
    description: "安装官方技能并管理版本。",
    icon: "download",
    versions: ["1.0.0"],
    installedByDefault: true,
  },
  {
    id: "requirements_analyst",
    name: "需求分析",
    description: "将自然语言需求拆解为可执行任务与验收项。",
    icon: "description",
    versions: ["1.0.0"],
  },
  {
    id: "db_designer",
    name: "数据库设计",
    description: "根据需求输出数据库设计与迁移草案。",
    icon: "database",
    versions: ["1.0.0"],
  },
  {
    id: "api_codegen",
    name: "接口代码生成",
    description: "基于设计结果生成接口代码与测试骨架。",
    icon: "code",
    versions: ["1.0.0"],
  },
  {
    id: "test_runner",
    name: "测试执行",
    description: "统一触发测试并归档执行结果。",
    icon: "play_arrow",
    versions: ["1.0.0"],
  },
  {
    id: "report_builder",
    name: "报告生成",
    description: "汇总执行结果并输出交付报告。",
    icon: "article",
    versions: ["1.0.0"],
  },
];

// 描述：
//
//   - 解析并归一化技能版本列表，确保版本值为非空字符串集合。
//
// Params:
//
//   - rawVersions: 原始版本数据。
//
// Returns:
//
//   - 归一化后的版本数组；无可用版本时返回默认版本。
function normalizeSkillVersions(rawVersions: unknown): string[] {
  if (!Array.isArray(rawVersions)) {
    return ["1.0.0"];
  }
  const normalized = rawVersions
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["1.0.0"];
}

// 描述：
//
//   - 将单条目录项转换为统一结构，忽略缺失关键字段的数据。
//
// Params:
//
//   - rawItem: 原始目录项对象。
//
// Returns:
//
//   - 归一化后的目录项；若不合法则返回 null。
function normalizeSkillCatalogItem(rawItem: unknown): SkillCatalogItem | null {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }
  const source = rawItem as Partial<SkillCatalogItem>;
  const id = String(source.id || "").trim();
  const name = String(source.name || "").trim();
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    description: String(source.description || "").trim(),
    icon: String(source.icon || "new_releases").trim() || "new_releases",
    versions: normalizeSkillVersions(source.versions),
    installedByDefault: Boolean(source.installedByDefault),
  };
}

// 描述：
//
//   - 根据环境变量读取技能目录远端地址，未配置时返回空字符串。
//
// Returns:
//
//   - 远端技能目录地址。
function resolveRemoteSkillCatalogUrl(): string {
  return String(import.meta.env.VITE_SKILL_CATALOG_URL || "").trim();
}

// 描述：
//
//   - 从远端目录服务加载技能清单；网络异常或返回结构不合法时返回 null 以触发本地回退。
//
// Returns:
//
//   - 远端目录列表；若加载失败则返回 null。
async function loadRemoteSkillCatalog(): Promise<SkillCatalogItem[] | null> {
  const remoteUrl = resolveRemoteSkillCatalogUrl();
  if (!remoteUrl) {
    return null;
  }
  try {
    const response = await fetch(remoteUrl, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as unknown;
    const rawList = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown[] }).items)
        ? (payload as { items: unknown[] }).items
        : null;
    if (!rawList) {
      return null;
    }
    const normalized = rawList
      .map((item) => normalizeSkillCatalogItem(item))
      .filter((item): item is SkillCatalogItem => Boolean(item));
    return normalized;
  } catch (_err) {
    return null;
  }
}

// 描述：
//
//   - 读取内置默认安装技能 ID 集合。
//
// Returns:
//
//   - 默认安装技能 ID 列表。
function resolveDefaultInstalledSkillIds(): string[] {
  return SKILL_CATALOG.filter((item) => item.installedByDefault).map((item) => item.id);
}

// 描述：
//
//   - 从本地存储读取已安装技能 ID；读取失败时回退到默认安装集合。
//
// Returns:
//
//   - 已安装技能 ID 列表。
function readInstalledSkillIdsFromStorage(): string[] {
  const defaults = resolveDefaultInstalledSkillIds();
  if (typeof window === "undefined") {
    return defaults;
  }
  const rawValue = window.localStorage.getItem(SKILL_INSTALL_STATE_STORAGE_KEY);
  if (!rawValue) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return defaults;
    }
    const normalized = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : defaults;
  } catch (_err) {
    return defaults;
  }
}

// 描述：
//
//   - 将已安装技能 ID 写入本地存储。
//
// Params:
//
//   - installedIds: 已安装技能 ID 列表。
function writeInstalledSkillIdsToStorage(installedIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SKILL_INSTALL_STATE_STORAGE_KEY, JSON.stringify(installedIds));
}

// 描述：
//
//   - 获取技能目录清单；当前先返回内置目录，后续可替换为服务端获取。
//
// Returns:
//
//   - 技能目录列表。
export async function listSkillCatalog(): Promise<SkillCatalogItem[]> {
  const remoteCatalog = await loadRemoteSkillCatalog();
  if (remoteCatalog) {
    return remoteCatalog;
  }
  return SKILL_CATALOG;
}

// 描述：
//
//   - 获取当前已安装技能目录项，供工作流节点选择器复用。
//
// Params:
//
//   - catalog: 可选技能目录缓存；传入时可避免重复读取目录。
//
// Returns:
//
//   - 已安装技能列表。
export async function listInstalledSkills(catalog?: SkillCatalogItem[]): Promise<SkillCatalogItem[]> {
  const nextCatalog = catalog || await listSkillCatalog();
  const installedIds = new Set(readInstalledSkillIdsFromStorage());
  return nextCatalog.filter((item) => installedIds.has(item.id));
}

// 描述：
//
//   - 获取技能总览（已安装/推荐）。
//
// Returns:
//
//   - 技能总览数据。
export async function listSkillOverview(): Promise<SkillOverview> {
  const catalog = await listSkillCatalog();
  const installed = await listInstalledSkills(catalog);
  const installedIds = new Set(installed.map((item) => item.id));
  const marketplace = catalog.filter((item) => !installedIds.has(item.id));
  return {
    installed,
    marketplace,
  };
}

// 描述：
//
//   - 更新技能安装状态，并返回更新后的技能总览。
//
// Params:
//
//   - skillId: 目标技能 ID。
//   - installed: true 表示安装，false 表示卸载。
//
// Returns:
//
//   - 更新后的技能总览数据。
export async function updateSkillInstalledState(skillId: string, installed: boolean): Promise<SkillOverview> {
  const catalog = await listSkillCatalog();
  const allowedIds = new Set(catalog.map((item) => item.id));
  if (!allowedIds.has(skillId)) {
    return listSkillOverview();
  }
  const current = new Set(readInstalledSkillIdsFromStorage());
  if (installed) {
    current.add(skillId);
  } else {
    current.delete(skillId);
  }
  writeInstalledSkillIdsToStorage(Array.from(current));
  return listSkillOverview();
}
