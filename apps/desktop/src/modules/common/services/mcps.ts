import { invoke } from "@tauri-apps/api/core";
import { COMMANDS, IS_BROWSER, STORAGE_KEYS } from "../../../shared/constants";

// 描述：
//
//   - 定义 MCP 目录项结构，供 MCP 页面渲染“已安装/推荐”列表。
export interface McpCatalogItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  versions: string[];
  installedByDefault?: boolean;
  officialProvider?: string;
  installCommand?: string;
  docsUrl?: string;
}

// 描述：
//
//   - 定义 MCP 总览结构。
export interface McpOverview {
  installed: McpCatalogItem[];
  marketplace: McpCatalogItem[];
}

// 描述：
//
//   - 定义 Apifox 官方 MCP Runtime 状态结构，用于校验“是否真实安装在本应用数据目录”。
interface ApifoxMcpRuntimeStatusResponse {
  installed: boolean;
  version: string;
  npm_bin: string;
  runtime_dir: string;
  entry_path: string;
  message: string;
}

// 描述：
//
//   - 记录 Apifox 官方 MCP 自动安装任务，避免同一时刻重复触发多个安装进程。
let apifoxAutoInstallTask: Promise<void> | null = null;

// 描述：
//
//   - MCP 目录清单；MVP 阶段先由前端内置，后续替换为服务端目录接口。
const MCP_CATALOG: McpCatalogItem[] = [
  {
    id: "mcp_fs",
    name: "Filesystem MCP",
    description: "提供目录读取、文件检索与文本分析能力。",
    icon: "folder",
    versions: ["1.0.0"],
    installedByDefault: true,
  },
  {
    id: "mcp_git",
    name: "Git MCP",
    description: "提供分支、提交、差异分析等仓库操作能力。",
    icon: "source",
    versions: ["1.0.0"],
    installedByDefault: true,
  },
  {
    id: "mcp_apifox",
    name: "Apifox MCP（官方）",
    description: "使用 Apifox 官方 MCP Server 提供 API 模型、接口定义与 Mock 同步能力。",
    icon: "api",
    versions: ["1.0.0"],
    officialProvider: "Apifox",
    installCommand: "npx -y apifox-mcp-server@latest",
    docsUrl: "https://docs.apifox.com/apifox-mcp-server",
  },
  {
    id: "mcp_browser",
    name: "Browser MCP",
    description: "提供网页抓取、导航与页面信息提取能力。",
    icon: "language",
    versions: ["1.0.0"],
  },
];

// 描述：
//
//   - 解析并归一化 MCP 版本列表，确保版本值为非空字符串集合。
//
// Params:
//
//   - rawVersions: 原始版本数据。
//
// Returns:
//
//   - 归一化后的版本数组；无可用版本时返回默认版本。
function normalizeMcpVersions(rawVersions: unknown): string[] {
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
function normalizeMcpCatalogItem(rawItem: unknown): McpCatalogItem | null {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }
  const source = rawItem as Partial<McpCatalogItem>;
  const id = String(source.id || "").trim();
  const name = String(source.name || "").trim();
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    description: String(source.description || "").trim(),
    icon: String(source.icon || "hub").trim() || "hub",
    versions: normalizeMcpVersions(source.versions),
    installedByDefault: Boolean(source.installedByDefault),
    officialProvider: String(source.officialProvider || "").trim(),
    installCommand: String(source.installCommand || "").trim(),
    docsUrl: String(source.docsUrl || "").trim(),
  };
}

// 描述：
//
//   - 对目录执行“Apifox 官方 MCP”策略修正：无论来源为本地或远端，mcp_apifox 均强制对齐官方实现信息。
//
// Params:
//
//   - catalog: 原始目录列表。
//
// Returns:
//
//   - 修正后的目录列表。
function enforceOfficialApifoxMcpPolicy(catalog: McpCatalogItem[]): McpCatalogItem[] {
  return catalog.map((item) => {
    if (item.id !== "mcp_apifox") {
      return item;
    }
    return {
      ...item,
      name: "Apifox MCP（官方）",
      description: "使用 Apifox 官方 MCP Server 提供 API 模型、接口定义与 Mock 同步能力。",
      officialProvider: "Apifox",
      installCommand: "npx -y apifox-mcp-server@latest",
      docsUrl: "https://docs.apifox.com/apifox-mcp-server",
    };
  });
}

// 描述：
//
//   - 根据环境变量读取 MCP 目录远端地址，未配置时返回空字符串。
//
// Returns:
//
//   - 远端 MCP 目录地址。
function resolveRemoteMcpCatalogUrl(): string {
  return String(import.meta.env.VITE_MCP_CATALOG_URL || "").trim();
}

// 描述：
//
//   - 从远端目录服务加载 MCP 清单；网络异常或返回结构不合法时返回 null 以触发本地回退。
//
// Returns:
//
//   - 远端目录列表；若加载失败则返回 null。
async function loadRemoteMcpCatalog(): Promise<McpCatalogItem[] | null> {
  const remoteUrl = resolveRemoteMcpCatalogUrl();
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
      .map((item) => normalizeMcpCatalogItem(item))
      .filter((item): item is McpCatalogItem => Boolean(item));
    return normalized;
  } catch (_err) {
    return null;
  }
}

// 描述：
//
//   - 读取内置默认安装 MCP ID 集合。
//
// Returns:
//
//   - 默认安装 MCP ID 列表。
function resolveDefaultInstalledMcpIds(): string[] {
  return MCP_CATALOG.filter((item) => item.installedByDefault).map((item) => item.id);
}

// 描述：
//
//   - 从本地存储读取已安装 MCP ID；读取失败时回退到默认安装集合。
//
// Returns:
//
//   - 已安装 MCP ID 列表。
export function readInstalledMcpIdsFromStorage(): string[] {
  const defaults = resolveDefaultInstalledMcpIds();
  if (!IS_BROWSER) {
    return defaults;
  }
  const rawValue = window.localStorage.getItem(STORAGE_KEYS.MCP_INSTALLED_IDS);
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
//   - 将已安装 MCP ID 写入本地存储。
//
// Params:
//
//   - installedIds: 已安装 MCP ID 列表。
function writeInstalledMcpIdsToStorage(installedIds: string[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEYS.MCP_INSTALLED_IDS, JSON.stringify(installedIds));
}

// 描述：
//
//   - 读取 Apifox 官方 MCP Runtime 状态，返回值由 Tauri 后端基于应用数据目录检测。
//
// Returns:
//
//   - Runtime 状态；调用失败时返回 null。
async function readApifoxMcpRuntimeStatus(): Promise<ApifoxMcpRuntimeStatusResponse | null> {
  if (!IS_BROWSER) {
    return null;
  }
  try {
    return await invoke<ApifoxMcpRuntimeStatusResponse>(COMMANDS.CHECK_APIFOX_MCP_RUNTIME_STATUS);
  } catch (_err) {
    return null;
  }
}

// 描述：
//
//   - 确保已安装 Apifox 官方 MCP Runtime；安装失败时抛出业务友好错误。
async function installApifoxMcpRuntimeForDesktop() {
  try {
    await invoke<ApifoxMcpRuntimeStatusResponse>(COMMANDS.INSTALL_APIFOX_MCP_RUNTIME);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err || "").trim();
    throw new Error(reason || "安装 Apifox 官方 MCP 失败，请检查 Node.js/npm 环境后重试。");
  }
}

// 描述：
//
//   - 卸载 Apifox 官方 MCP Runtime，确保“卸载”不仅是 UI 状态切换。
async function uninstallApifoxMcpRuntimeForDesktop() {
  try {
    await invoke<ApifoxMcpRuntimeStatusResponse>(COMMANDS.UNINSTALL_APIFOX_MCP_RUNTIME);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err || "").trim();
    throw new Error(reason || "卸载 Apifox 官方 MCP 失败，请稍后重试。");
  }
}

// 描述：
//
//   - 在桌面端自动安装 Apifox 官方 MCP Runtime。
//
//   - 自动安装失败时不抛错，避免阻塞页面加载；失败后仍可通过手动安装重试。
//
// Params:
//
//   - actualInstalledIds: 当前运行时实际安装 ID 集合。
//   - desiredInstalledIds: 用户期望安装 ID 集合（来源于本地配置）。
//
// Returns:
//
//   - 自动安装后的安装 ID 集合。
async function ensureApifoxMcpRuntimeAutoInstalled(
  actualInstalledIds: Set<string>,
  desiredInstalledIds: Set<string>,
): Promise<Set<string>> {
  const next = new Set(actualInstalledIds);
  const apifoxMcpId = "mcp_apifox";
  if (!desiredInstalledIds.has(apifoxMcpId)) {
    next.delete(apifoxMcpId);
    return next;
  }

  if (next.has(apifoxMcpId) || !IS_BROWSER) {
    return next;
  }

  if (!apifoxAutoInstallTask) {
    apifoxAutoInstallTask = installApifoxMcpRuntimeForDesktop().finally(() => {
      apifoxAutoInstallTask = null;
    });
  }

  try {
    await apifoxAutoInstallTask;
    next.add(apifoxMcpId);
  } catch (_err) {
    next.delete(apifoxMcpId);
  }
  return next;
}

// 描述：
//
//   - 将 Apifox 安装状态与本应用 Runtime 实际状态对齐，避免仅本地标记导致“假安装”。
//
// Params:
//
//   - installedIds: 当前安装 ID 集合。
//
// Returns:
//
//   - 对齐后的安装 ID 集合。
async function reconcileInstalledIdsWithApifoxRuntime(installedIds: Set<string>): Promise<Set<string>> {
  const next = new Set(installedIds);
  const status = await readApifoxMcpRuntimeStatus();
  if (!status) {
    return next;
  }
  if (status.installed) {
    next.add("mcp_apifox");
  } else {
    next.delete("mcp_apifox");
  }
  return next;
}

// 描述：
//
//   - 获取 MCP 目录清单；当前先返回内置目录，后续可替换为服务端获取。
//
// Returns:
//
//   - MCP 目录列表。
export async function listMcpCatalog(): Promise<McpCatalogItem[]> {
  const remoteCatalog = await loadRemoteMcpCatalog();
  if (remoteCatalog) {
    return enforceOfficialApifoxMcpPolicy(remoteCatalog);
  }
  return enforceOfficialApifoxMcpPolicy(MCP_CATALOG);
}

// 描述：
//
//   - 获取当前已安装 MCP 目录项。
//
// Params:
//
//   - catalog: 可选 MCP 目录缓存；传入时可避免重复读取目录。
//
// Returns:
//
//   - 已安装 MCP 列表。
export async function listInstalledMcps(catalog?: McpCatalogItem[]): Promise<McpCatalogItem[]> {
  const nextCatalog = catalog || await listMcpCatalog();
  const desiredInstalledIds = new Set(readInstalledMcpIdsFromStorage());
  const reconciledInstalledIds = await reconcileInstalledIdsWithApifoxRuntime(
    new Set(desiredInstalledIds),
  );
  const installedIds = await ensureApifoxMcpRuntimeAutoInstalled(reconciledInstalledIds, desiredInstalledIds);
  writeInstalledMcpIdsToStorage(Array.from(installedIds));
  return nextCatalog.filter((item) => installedIds.has(item.id));
}

// 描述：
//
//   - 获取 MCP 总览（已安装/推荐）。
//
// Returns:
//
//   - MCP 总览数据。
export async function listMcpOverview(): Promise<McpOverview> {
  const catalog = await listMcpCatalog();
  const installed = await listInstalledMcps(catalog);
  const installedIds = new Set(installed.map((item) => item.id));
  const marketplace = catalog.filter((item) => !installedIds.has(item.id));
  return {
    installed,
    marketplace,
  };
}

// 描述：
//
//   - 更新 MCP 安装状态，并返回更新后的 MCP 总览。
//
// Params:
//
//   - mcpId: 目标 MCP ID。
//   - installed: true 表示安装，false 表示卸载。
//
// Returns:
//
//   - 更新后的 MCP 总览数据。
export async function updateMcpInstalledState(mcpId: string, installed: boolean): Promise<McpOverview> {
  const catalog = await listMcpCatalog();
  const allowedIds = new Set(catalog.map((item) => item.id));
  if (!allowedIds.has(mcpId)) {
    return listMcpOverview();
  }
  const current = new Set(readInstalledMcpIdsFromStorage());
  if (mcpId === "mcp_apifox") {
    if (installed) {
      await installApifoxMcpRuntimeForDesktop();
    } else {
      await uninstallApifoxMcpRuntimeForDesktop();
    }
  }
  if (installed) {
    current.add(mcpId);
  } else {
    current.delete(mcpId);
  }
  writeInstalledMcpIdsToStorage(Array.from(current));
  return listMcpOverview();
}
