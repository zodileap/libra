import { invoke } from "@tauri-apps/api/core";
import { COMMANDS, IS_BROWSER } from "../../../shared/constants";
import { checkDccRuntimeStatus } from "../../../shared/services/dcc-runtime";

// 描述：
//
//   - MCP 传输类型；当前桌面端管理页支持 stdio 与 http 两种接入模式。
export type McpTransport = "stdio" | "http";

// 描述：
//
//   - MCP 能力领域；当前主要区分通用工具与 DCC 建模软件接入。
export type McpDomain = "general" | "dcc";

// 描述：
//
//   - MCP 注册作用域；workspace 级配置会覆盖同名 user 级配置。
export type McpScope = "user" | "workspace";

// 描述：
//
//   - 前端统一消费的 MCP 注册项结构，覆盖注册、编辑、启用和校验所需字段。
export interface McpRegistrationItem {
  id: string;
  templateId: string;
  name: string;
  description: string;
  domain: McpDomain;
  software: string;
  capabilities: string[];
  priority: number;
  supportsImport: boolean;
  supportsExport: boolean;
  transport: McpTransport;
  scope: McpScope;
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  url: string;
  headers: Record<string, string>;
  docsUrl: string;
  officialProvider: string;
  runtimeKind: string;
  removable: boolean;
}

// 描述：
//
//   - 前端统一消费的 MCP 模板结构，用于“推荐模板”列表展示和新增预填。
export interface McpTemplateItem {
  id: string;
  name: string;
  description: string;
  domain: McpDomain;
  software: string;
  capabilities: string[];
  priority: number;
  supportsImport: boolean;
  supportsExport: boolean;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  url: string;
  headers: Record<string, string>;
  docsUrl: string;
  officialProvider: string;
  runtimeKind: string;
}

// 描述：
//
//   - MCP 总览结构，按“已注册 / 推荐模板”两类输出。
export interface McpOverview {
  registered: McpRegistrationItem[];
  templates: McpTemplateItem[];
}

// 描述：
//
//   - MCP 保存草稿结构；页面新增、编辑和启用切换统一复用该入参。
export interface McpRegistrationDraft {
  id?: string;
  templateId?: string;
  name: string;
  description?: string;
  domain?: McpDomain;
  software?: string;
  capabilities?: string[];
  priority?: number;
  supportsImport?: boolean;
  supportsExport?: boolean;
  transport: McpTransport;
  scope?: McpScope;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  docsUrl?: string;
  officialProvider?: string;
  runtimeKind?: string;
}

// 描述：
//
//   - MCP 预校验结果；ok 表示满足最小环境要求，resolvedPath 用于反馈命中的本地命令或 URL。
export interface McpValidationResult {
  ok: boolean;
  message: string;
  resolvedPath: string;
}

// 描述：
//
//   - Apifox 官方 MCP Runtime 状态结构，用于页面展示“是否已安装到应用私有目录”。
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
//   - MCP 注册表上下文；workspaceRoot 存在时，后端将自动读取 workspace 级覆盖配置。
export interface McpRegistryContext {
  workspaceRoot?: string;
}

// 描述：
//
//   - 将未知值规整为字符串数组，移除空项与重复值。
//
// Params:
//
//   - value: 原始列表值。
//
// Returns:
//
//   - 归一化后的字符串数组。
function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

// 描述：
//
//   - 将未知对象规整为字符串映射，移除空键和空值，避免表单脏数据进入业务层。
//
// Params:
//
//   - value: 原始映射值。
//
// Returns:
//
//   - 归一化后的字符串映射。
function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, rawValue]) => [key.trim(), String(rawValue || "").trim()] as const)
    .filter(([key, rawValue]) => key.length > 0 && rawValue.length > 0);
  return Object.fromEntries(entries);
}

// 描述：
//
//   - 将未知值规整为合法的 MCP 传输类型；非法值统一回退为 stdio。
//
// Params:
//
//   - value: 原始传输类型。
//
// Returns:
//
//   - 归一化后的传输类型。
function normalizeTransport(value: unknown): McpTransport {
  return String(value || "").trim().toLowerCase() === "http" ? "http" : "stdio";
}

// 描述：
//
//   - 将未知值规整为合法的 MCP 能力领域；非法值统一回退为 general。
//
// Params:
//
//   - value: 原始领域值。
//
// Returns:
//
//   - 归一化后的 MCP 能力领域。
function normalizeDomain(value: unknown): McpDomain {
  return String(value || "").trim().toLowerCase() === "dcc" ? "dcc" : "general";
}

// 描述：
//
//   - 将未知值规整为整数优先级，非法值统一回退为 0。
//
// Params:
//
//   - value: 原始优先级值。
//
// Returns:
//
//   - 归一化后的优先级数值。
function normalizePriority(value: unknown): number {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? Math.trunc(parsedValue) : 0;
}

// 描述：
//
//   - 将未知值规整为合法的 MCP 作用域；非法值统一回退为 user，避免页面层出现脏状态。
//
// Params:
//
//   - value: 原始作用域。
//
// Returns:
//
//   - 归一化后的 MCP 作用域。
function normalizeScope(value: unknown): McpScope {
  return String(value || "").trim().toLowerCase() === "workspace" ? "workspace" : "user";
}

// 描述：
//
//   - 将后端返回的注册项对象转换为前端统一结构。
//
// Params:
//
//   - rawValue: 原始注册项对象。
//
// Returns:
//
//   - 归一化后的注册项。
function normalizeMcpRegistrationItem(rawValue: unknown): McpRegistrationItem | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }
  const source = rawValue as Partial<McpRegistrationItem>;
  const id = String(source.id || "").trim();
  const name = String(source.name || "").trim();
  if (!id || !name) {
    return null;
  }
  return {
    id,
    templateId: String(source.templateId || "").trim(),
    name,
    description: String(source.description || "").trim(),
    domain: normalizeDomain(source.domain),
    software: String(source.software || "").trim().toLowerCase(),
    capabilities: normalizeStringList(source.capabilities),
    priority: normalizePriority(source.priority),
    supportsImport: Boolean(source.supportsImport),
    supportsExport: Boolean(source.supportsExport),
    transport: normalizeTransport(source.transport),
    scope: normalizeScope(source.scope),
    enabled: Boolean(source.enabled),
    command: String(source.command || "").trim(),
    args: normalizeStringList(source.args),
    env: normalizeStringRecord(source.env),
    cwd: String(source.cwd || "").trim(),
    url: String(source.url || "").trim(),
    headers: normalizeStringRecord(source.headers),
    docsUrl: String(source.docsUrl || "").trim(),
    officialProvider: String(source.officialProvider || "").trim(),
    runtimeKind: String(source.runtimeKind || "").trim(),
    removable: Boolean(source.removable),
  };
}

// 描述：
//
//   - 将后端返回的模板对象转换为前端统一结构。
//
// Params:
//
//   - rawValue: 原始模板对象。
//
// Returns:
//
//   - 归一化后的模板项。
function normalizeMcpTemplateItem(rawValue: unknown): McpTemplateItem | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }
  const source = rawValue as Partial<McpTemplateItem>;
  const id = String(source.id || "").trim();
  const name = String(source.name || "").trim();
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    description: String(source.description || "").trim(),
    domain: normalizeDomain(source.domain),
    software: String(source.software || "").trim().toLowerCase(),
    capabilities: normalizeStringList(source.capabilities),
    priority: normalizePriority(source.priority),
    supportsImport: Boolean(source.supportsImport),
    supportsExport: Boolean(source.supportsExport),
    transport: normalizeTransport(source.transport),
    command: String(source.command || "").trim(),
    args: normalizeStringList(source.args),
    env: normalizeStringRecord(source.env),
    cwd: String(source.cwd || "").trim(),
    url: String(source.url || "").trim(),
    headers: normalizeStringRecord(source.headers),
    docsUrl: String(source.docsUrl || "").trim(),
    officialProvider: String(source.officialProvider || "").trim(),
    runtimeKind: String(source.runtimeKind || "").trim(),
  };
}

// 描述：
//
//   - 将后端总览结构规整为前端统一数据，避免页面层直接依赖后端字段细节。
//
// Params:
//
//   - rawValue: 原始总览结构。
//
// Returns:
//
//   - 归一化后的 MCP 总览。
function normalizeMcpOverview(rawValue: unknown): McpOverview {
  if (!rawValue || typeof rawValue !== "object") {
    return { registered: [], templates: [] };
  }
  const source = rawValue as { registered?: unknown[]; templates?: unknown[] };
  return {
    registered: Array.isArray(source.registered)
      ? source.registered
        .map((item) => normalizeMcpRegistrationItem(item))
        .filter((item): item is McpRegistrationItem => Boolean(item))
      : [],
    templates: Array.isArray(source.templates)
      ? source.templates
        .map((item) => normalizeMcpTemplateItem(item))
        .filter((item): item is McpTemplateItem => Boolean(item))
      : [],
  };
}

// 描述：
//
//   - 将草稿映射为 Tauri 命令入参，统一补齐默认值，避免页面层反复写样板逻辑。
//
// Params:
//
//   - draft: 前端 MCP 草稿。
//
// Returns:
//
//   - 命令入参对象。
function buildMcpRegistrationPayload(draft: McpRegistrationDraft) {
  return {
    id: String(draft.id || "").trim(),
    templateId: String(draft.templateId || "").trim(),
    name: String(draft.name || "").trim(),
    description: String(draft.description || "").trim(),
    domain: normalizeDomain(draft.domain),
    software: String(draft.software || "").trim().toLowerCase(),
    capabilities: normalizeStringList(draft.capabilities),
    priority: normalizePriority(draft.priority),
    supportsImport: draft.supportsImport === true,
    supportsExport: draft.supportsExport === true,
    transport: normalizeTransport(draft.transport),
    scope: normalizeScope(draft.scope),
    enabled: draft.enabled !== false,
    command: String(draft.command || "").trim(),
    args: normalizeStringList(draft.args),
    env: normalizeStringRecord(draft.env),
    cwd: String(draft.cwd || "").trim(),
    url: String(draft.url || "").trim(),
    headers: normalizeStringRecord(draft.headers),
    docsUrl: String(draft.docsUrl || "").trim(),
    officialProvider: String(draft.officialProvider || "").trim(),
    runtimeKind: String(draft.runtimeKind || "").trim(),
  };
}

// 描述：
//
//   - 将页面上下文映射为 Tauri 命令入参，统一清理空字符串，避免向后端传递无意义目录。
//
// Params:
//
//   - context: MCP 上下文。
//
// Returns:
//
//   - Tauri 命令参数片段。
function buildMcpContextPayload(context?: McpRegistryContext) {
  const workspaceRoot = String(context?.workspaceRoot || "").trim();
  return {
    workspaceRoot: workspaceRoot || undefined,
  };
}

// 描述：
//
//   - 读取 Apifox Runtime 状态；调用失败时返回 null，避免阻塞 MCP 页面主流程。
//
// Returns:
//
//   - Runtime 状态；失败时返回 null。
export async function readApifoxMcpRuntimeStatus(): Promise<ApifoxMcpRuntimeStatusResponse | null> {
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
//   - 安装 Apifox 官方 MCP Runtime；失败时抛出用户友好错误。
export async function installApifoxMcpRuntime() {
  try {
    await invoke<ApifoxMcpRuntimeStatusResponse>(COMMANDS.INSTALL_APIFOX_MCP_RUNTIME);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err || "").trim();
    throw new Error(reason || "安装 Apifox Runtime 失败，请检查 Node.js/npm 环境后重试。");
  }
}

// 描述：
//
//   - 卸载 Apifox 官方 MCP Runtime；失败时抛出用户友好错误。
export async function uninstallApifoxMcpRuntime() {
  try {
    await invoke<ApifoxMcpRuntimeStatusResponse>(COMMANDS.UNINSTALL_APIFOX_MCP_RUNTIME);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err || "").trim();
    throw new Error(reason || "卸载 Apifox Runtime 失败，请稍后重试。");
  }
}

// 描述：
//
//   - 获取 MCP 注册表总览。
//
// Returns:
//
//   - MCP 总览数据。
export async function listMcpOverview(context?: McpRegistryContext): Promise<McpOverview> {
  const rawOverview = await invoke<unknown>(COMMANDS.LIST_REGISTERED_MCPS, buildMcpContextPayload(context));
  return normalizeMcpOverview(rawOverview);
}

// 描述：
//
//   - 保存 MCP 注册项；既支持新增，也支持编辑和启用状态切换。
//
// Params:
//
//   - draft: 待保存的 MCP 草稿。
//
// Returns:
//
//   - 已持久化的注册项。
export async function saveMcpRegistration(
  draft: McpRegistrationDraft,
  context?: McpRegistryContext,
): Promise<McpRegistrationItem> {
  const payload = buildMcpRegistrationPayload(draft);
  const rawRecord = await invoke<unknown>(COMMANDS.SAVE_MCP_REGISTRATION, {
    payload,
    ...buildMcpContextPayload(context),
  });
  const normalizedRecord = normalizeMcpRegistrationItem(rawRecord);
  if (!normalizedRecord) {
    throw new Error("保存 MCP 后返回数据不完整，请重试。");
  }
  return normalizedRecord;
}

// 描述：
//
//   - 删除指定 MCP 注册项。
//
// Params:
//
//   - id: 待删除的 MCP 注册 ID。
//
// Returns:
//
//   - true 表示删除成功。
export async function removeMcpRegistration(
  id: string,
  scope: McpScope,
  context?: McpRegistryContext,
): Promise<boolean> {
  return invoke<boolean>(COMMANDS.REMOVE_MCP_REGISTRATION, {
    id: String(id || "").trim(),
    scope,
    ...buildMcpContextPayload(context),
  });
}

// 描述：
//
//   - 执行 MCP 基础校验；Apifox Runtime 走独立状态检测，其余 MCP 走通用校验命令。
//
// Params:
//
//   - draft: 待校验的 MCP 草稿。
//
// Returns:
//
//   - 校验结果。
export async function validateMcpRegistration(
  draft: McpRegistrationDraft,
  context?: McpRegistryContext,
): Promise<McpValidationResult> {
  const payload = buildMcpRegistrationPayload(draft);
  if (payload.runtimeKind === "apifox_runtime") {
    const runtimeStatus = await readApifoxMcpRuntimeStatus();
    if (runtimeStatus?.installed) {
      return {
        ok: true,
        message: runtimeStatus.message,
        resolvedPath: runtimeStatus.entry_path,
      };
    }
    return {
      ok: false,
      message: runtimeStatus?.message || "Apifox Runtime 未安装，请先安装 Runtime。",
      resolvedPath: runtimeStatus?.entry_path || "",
    };
  }
  if (payload.runtimeKind === "dcc_bridge") {
    if (!payload.software) {
      return {
        ok: false,
        message: "DCC Runtime 缺少软件标识，请先填写软件名称。",
        resolvedPath: "",
      };
    }
    const runtimeStatus = await checkDccRuntimeStatus(payload.software);
    return {
      ok: runtimeStatus.available,
      message: runtimeStatus.message || "DCC Runtime 校验完成。",
      resolvedPath: runtimeStatus.resolvedPath,
    };
  }
  return invoke<McpValidationResult>(COMMANDS.VALIDATE_MCP_REGISTRATION, {
    payload,
    ...buildMcpContextPayload(context),
  });
}
