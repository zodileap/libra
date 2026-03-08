import {
  getAgentSessions,
  getSessionMessages,
  removeAgentSession,
  upsertSessionMessages,
} from "../data";
import type {
  ConsoleGrantPermissionReq,
  ConsoleIdentityItem,
  ConsoleManageableUserItem,
  ConsolePermissionGrantItem,
  ConsolePermissionTemplate,
  LoginUser,
  SetupStatus,
} from "../types";
import { IS_BROWSER, STORAGE_KEYS } from "../constants";
import {
  buildAuthHeaders,
  buildBackendErrorMessage,
  buildNetworkFailureMessage,
  isUnauthorizedResponse,
  toQueryString,
} from "./backend-api-core";
import {
  buildDesktopBackendBaseUrl,
  hasEnabledDesktopBackend,
} from "./service-endpoints";

// 描述:
//
//   - 定义后端统一响应包结构。
interface BackendEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

// 描述:
//
//   - 定义通用请求参数结构。
interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
}

// 描述:
//
//   - 定义可用智能体列表项结构。
export interface AuthAvailableAgentItem {
  agentId: string;
  code: string;
  name: string;
  version?: string;
  agentStatus?: number;
  remark?: string;
  accessId: string;
  accessType?: number;
  duration?: number;
  accessStatus?: number;
}

// 描述:
//
//   - 定义运行时会话实体结构。
export interface RuntimeSessionEntity {
  id: string;
  user_id: string;
  agent_code: string;
  status?: number;
  created_at?: string;
  last_at?: string;
  deleted_at?: string;
}

// 描述:
//
//   - 定义会话消息实体结构。
export interface RuntimeSessionMessageItem {
  messageId: string;
  sessionId: string;
  userId: string;
  role: string;
  content: string;
  createdAt?: string;
}

// 描述：
//
//   - 定义桌面端更新检查返回结构。
export interface DesktopUpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string;
  downloadUrl: string;
  checksumSha256?: string;
  releaseNotes: string;
  publishedAt: string;
  channel: string;
}

// 描述:
//
//   - 定义后端 API 错误对象，附带业务码与 HTTP 状态。
export class BackendApiError extends Error {
  code: number;
  httpStatus: number;

  constructor(message: string, code: number, httpStatus: number) {
    super(message);
    this.name = "BackendApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// 描述：
//
//   - 本地模式下的伪用户信息，保证 Desktop 在不接入后端时也能直接进入主界面。
const localDesktopUser: LoginUser = {
  id: "local-user",
  name: "本地模式",
  email: "",
};

// 描述：
//
//   - 本地模式下默认可用的智能体列表；当前开源桌面端默认开放统一智能体能力。
const localAvailableAgents: AuthAvailableAgentItem[] = [
  {
    agentId: "local-agent",
    code: "agent",
    name: "Agent",
    accessId: "local-agent-access",
    accessType: 1,
    duration: 0,
    accessStatus: 1,
  },
];

// 描述：
//
//   - 本地模式下默认身份列表，保证 Desktop 在不接入 account 服务时也能展示管理页基础信息。
const localConsoleIdentities: ConsoleIdentityItem[] = [
  {
    id: "local-identity-owner",
    type: "individual",
    scopeName: "本地工作站",
    roles: ["owner"],
    status: "active",
  },
];

// 描述：
//
//   - 本地模式下可直接授权的用户集合，保证 Desktop 管理台在无后端时也能完整演示授权流。
const localManageableUsers: ConsoleManageableUserItem[] = [
  {
    id: "local-user-2",
    name: "协作者",
    email: "collaborator@libra.local",
    status: "active",
    identityScopes: ["共享工作站"],
    self: false,
  },
  {
    id: "local-user",
    name: "本地模式",
    email: "",
    status: "active",
    identityScopes: ["本地工作站"],
    self: true,
  },
];

// 描述：
//
//   - 本地模式下默认权限模板集合，供 Desktop 权限管理页直接复用。
const localPermissionTemplates: ConsolePermissionTemplate[] = [
  {
    code: "workflow.manage",
    name: "工作流管理",
    description: "允许查看、编辑和共享工作流。",
    resourceType: "workflow",
  },
  {
    code: "session.manage",
    name: "会话管理",
    description: "允许访问并同步智能体会话。",
    resourceType: "session",
  },
  {
    code: "agent.access.grant",
    name: "智能体能力授权",
    description: "允许向其他账号分配智能体访问权限。",
    resourceType: "agent",
  },
];

// 描述：返回当前是否已启用远端后端接入。
//
// Returns:
//
//   - true: 当前请求应发往远端后端。
function isDesktopBackendEnabled(): boolean {
  return hasEnabledDesktopBackend();
}

// 描述：按当前桌面端本地配置解析后端服务地址；当前远端模式统一走单一后端入口。
//
// Params:
//
//   - service: 服务标识。
//
// Returns:
//
//   - 对应服务的基础地址。
function resolveConfiguredServiceBaseUrl(
  service: "account" | "runtime" | "setup",
): string {
  void service;
  return buildDesktopBackendBaseUrl();
}

// 描述：返回本地模式用户信息副本，避免调用方直接修改共享常量。
//
// Returns:
//
//   - 本地模式用户信息。
export function getLocalDesktopUser(): LoginUser {
  return { ...localDesktopUser };
}

// 描述：返回本地模式可用智能体列表副本，保证本地模式与后端模式使用一致的数据结构。
//
// Returns:
//
//   - 本地模式智能体授权列表。
export function getLocalAvailableAgents(): AuthAvailableAgentItem[] {
  return localAvailableAgents.map((item) => ({ ...item }));
}

// 描述：返回本地模式身份列表副本，供 Desktop 在未接入后端时仍能维持统一身份上下文。
//
// Returns:
//
//   - 本地模式身份列表。
export function getLocalConsoleIdentities(): ConsoleIdentityItem[] {
  return localConsoleIdentities.map((item) => ({ ...item, roles: [...item.roles] }));
}

// 描述：返回本地模式可管理用户列表副本，供权限页选择授权对象。
//
// Returns:
//
//   - 本地模式可管理用户列表。
export function getLocalManageableUsers(): ConsoleManageableUserItem[] {
  return localManageableUsers.map((item) => ({
    ...item,
    identityScopes: [...item.identityScopes],
  }));
}

// 描述：从本地缓存读取权限授权记录；本地模式下使用 localStorage 持久化 Desktop 内部授权数据。
//
// Returns:
//
//   - 本地权限授权记录列表。
function readLocalPermissionGrants(): ConsolePermissionGrantItem[] {
  if (!IS_BROWSER) {
    return [];
  }
  const rawValue = window.localStorage.getItem(STORAGE_KEYS.DESKTOP_ADMIN_PERMISSION_GRANTS);
  if (!rawValue) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue) as ConsolePermissionGrantItem[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => ({
        id: String(item?.id || "").trim(),
        targetUserId: String(item?.targetUserId || "").trim(),
        targetUserName: String(item?.targetUserName || "").trim(),
        permissionCode: String(item?.permissionCode || "").trim(),
        resourceType: String(item?.resourceType || "").trim(),
        resourceName: String(item?.resourceName || "").trim(),
        grantedBy: String(item?.grantedBy || "").trim(),
        status: String(item?.status || "").trim() || "active",
        createdAt: String(item?.createdAt || "").trim() || undefined,
        lastAt: String(item?.lastAt || "").trim() || undefined,
        expiresAt: String(item?.expiresAt || "").trim() || undefined,
      }))
      .filter((item) => item.id && item.targetUserId && item.permissionCode);
  } catch (_err) {
    return [];
  }
}

// 描述：写入本地模式权限授权记录。
//
// Params:
//
//   - grants: 待保存授权记录列表。
function writeLocalPermissionGrants(grants: ConsolePermissionGrantItem[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(
    STORAGE_KEYS.DESKTOP_ADMIN_PERMISSION_GRANTS,
    JSON.stringify(grants),
  );
}

// 描述：根据授权请求构建本地权限记录，保证本地模式也能完整演示权限管理流程。
//
// Params:
//
//   - req: 新增授权请求。
//
// Returns:
//
//   - 新生成的本地授权记录。
function buildLocalPermissionGrant(req: ConsoleGrantPermissionReq): ConsolePermissionGrantItem {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `grant-${Date.now()}`;
  const now = new Date().toISOString();
  return {
    id,
    targetUserId: req.targetUserId,
    targetUserName: req.targetUserName,
    permissionCode: req.permissionCode,
    resourceType: req.resourceType,
    resourceName: req.resourceName,
    grantedBy: localDesktopUser.name,
    status: "active",
    createdAt: now,
    lastAt: now,
    expiresAt: req.expiresAt,
  };
}

// 描述：生成本地模式运行时会话 ID；优先使用浏览器原生 UUID，保证多会话场景下不冲突。
//
// Params:
//
//   - agentCode: 智能体编码。
//
// Returns:
//
//   - 本地会话 ID。
function buildLocalRuntimeSessionId(agentCode: string): string {
  const normalizedAgentCode = String(agentCode || "").trim() || "agent";
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${normalizedAgentCode}-${crypto.randomUUID()}`;
  }
  return `${normalizedAgentCode}-${Date.now()}`;
}

// 描述：构建本地模式运行时会话实体，保持与远端接口一致的数据结构。
//
// Params:
//
//   - userId: 当前用户 ID。
//   - sessionId: 会话 ID。
//   - agentCode: 智能体编码。
//   - status: 会话状态。
//
// Returns:
//
//   - 本地会话实体。
function buildLocalRuntimeSessionEntity(
  userId: string,
  sessionId: string,
  agentCode: string,
  status = 1,
): RuntimeSessionEntity {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    user_id: userId,
    agent_code: agentCode,
    status,
    created_at: now,
    last_at: now,
    deleted_at: "",
  };
}

// 描述:
//
//   - 本地认证令牌存储键。
const authTokenStorageKey = "libra.desktop.authToken";

// 描述:
//
//   - 全局未授权回调处理器。
let unauthorizedHandler: (() => void) | null = null;

// 描述：设置全局未授权处理器。
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

// 描述：读取当前身份令牌。
export function getAuthToken(): string {
  if (!IS_BROWSER) {
    return "";
  }
  return window.localStorage.getItem(authTokenStorageKey) || "";
}

// 描述：写入当前身份令牌。
export function setAuthToken(token: string) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(authTokenStorageKey, token);
}

// 描述：清理当前身份令牌。
export function clearAuthToken() {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.removeItem(authTokenStorageKey);
}

// 描述：执行后端请求并解析统一响应体。
async function request<T>(url: string, options?: RequestOptions): Promise<T> {
  const method = options?.method || "GET";
  const authEnabled = options?.auth !== false;
  const token = getAuthToken();
  const headers = buildAuthHeaders(token, authEnabled);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new BackendApiError(buildNetworkFailureMessage(url, detail), -1, 0);
  }

  let envelope: BackendEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as BackendEnvelope<T>;
  } catch (_err) {
    envelope = null;
  }

  const code = envelope?.code ?? (response.ok ? 200 : -1);
  const message = envelope?.message || "";

  if (isUnauthorizedResponse(response.status, code)) {
    clearAuthToken();
    if (unauthorizedHandler) {
      unauthorizedHandler();
    }
  }

  if (!response.ok || code !== 200) {
    const fallbackMessage = response.status >= 500
      ? "服务暂时不可用，请稍后重试。"
      : "请求失败，请检查输入后重试。";
    throw new BackendApiError(
      buildBackendErrorMessage(code, message, fallbackMessage),
      code,
      response.status,
    );
  }

  if (!envelope) {
    throw new BackendApiError("响应体解析失败", code, response.status);
  }

  return envelope.data;
}

// 描述：账号登录并返回用户与令牌。
export async function loginByPassword(email: string, password: string): Promise<{ token: string; user: LoginUser; expiresAt: string }> {
  if (!isDesktopBackendEnabled()) {
    void email;
    void password;
    return {
      token: "local-mode-token",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      user: getLocalDesktopUser(),
    };
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  const data = await request<{ token: string; expiresAt: string; user: { id: string; name: string; email?: string } }>(
    `${accountBaseUrl}/auth/v1/login`,
    {
      method: "POST",
      auth: false,
      body: {
        email,
        password,
        // 描述：兼容后端字段绑定差异，同时传输首字母大写字段名。
        Email: email,
        Password: password,
      },
    },
  );

  return {
    token: data.token,
    expiresAt: data.expiresAt,
    user: {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email || "",
    },
  };
}

// 描述：读取当前登录用户信息。
export async function getCurrentUser(): Promise<LoginUser> {
  if (!isDesktopBackendEnabled()) {
    return getLocalDesktopUser();
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  const data = await request<{ user: { id: string; name: string; email?: string } }>(`${accountBaseUrl}/auth/v1/me`);
  return {
    id: data.user.id,
    name: data.user.name,
    email: data.user.email || "",
  };
}

// 描述：当前令牌登出并失效。
export async function logoutCurrentUser(): Promise<void> {
  if (!isDesktopBackendEnabled()) {
    return;
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  await request<{ success: boolean }>(`${accountBaseUrl}/auth/v1/logout`, {
    method: "POST",
    body: {},
  });
}

// 描述：获取当前用户可用智能体列表。
export async function listAvailableAgents(): Promise<AuthAvailableAgentItem[]> {
  if (!isDesktopBackendEnabled()) {
    return getLocalAvailableAgents();
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  const data = await request<{ list: AuthAvailableAgentItem[] }>(`${accountBaseUrl}/auth/v1/available-agents`);
  return data.list || [];
}

// 描述：获取当前账号可见身份列表；本地模式下返回 Desktop 默认身份。
export async function listAccountIdentities(): Promise<ConsoleIdentityItem[]> {
  if (!isDesktopBackendEnabled()) {
    return getLocalConsoleIdentities();
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  const data = await request<{
    list: Array<{
      identityId: string;
      identityType: string;
      scopeName: string;
      roleCodes: string[];
      status: string;
    }>;
  }>(`${accountBaseUrl}/auth/v1/identities`);
  return (data.list || []).map((item) => ({
    id: item.identityId,
    type: item.identityType,
    scopeName: item.scopeName,
    roles: item.roleCodes || [],
    status: item.status,
  }));
}

// 描述：获取当前管理员可直接授权的用户列表；本地模式下返回预设用户集合。
export async function listManageableUsers(): Promise<ConsoleManageableUserItem[]> {
  if (!isDesktopBackendEnabled()) {
    return getLocalManageableUsers();
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  const data = await request<{
    list: Array<{
      userId: string;
      name: string;
      email?: string;
      status: string;
      identityScopes: string[];
      self: boolean;
    }>;
  }>(`${accountBaseUrl}/auth/v1/manageable-users`);
  return (data.list || []).map((item) => ({
    id: item.userId,
    name: item.name,
    email: item.email,
    status: item.status,
    identityScopes: item.identityScopes || [],
    self: Boolean(item.self),
  }));
}

// 描述：获取可授权权限模板列表；本地模式下返回预设模板集合。
export async function listPermissionTemplates(): Promise<ConsolePermissionTemplate[]> {
  if (!isDesktopBackendEnabled()) {
    return localPermissionTemplates.map((item) => ({ ...item }));
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  const data = await request<{
    list: Array<{
      code: string;
      name: string;
      description: string;
      resourceType: string;
    }>;
  }>(`${accountBaseUrl}/auth/v1/permission-templates`);
  return data.list || [];
}

// 描述：获取当前权限授权记录；本地模式下从 localStorage 读取 Desktop 本地授权数据。
export async function listPermissionGrants(): Promise<ConsolePermissionGrantItem[]> {
  if (!isDesktopBackendEnabled()) {
    return readLocalPermissionGrants();
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  const data = await request<{
    list: Array<{
      grantId: string;
      targetUserId: string;
      targetUserName: string;
      permissionCode: string;
      resourceType: string;
      resourceName: string;
      grantedBy: string;
      status: string;
      createdAt?: string;
      lastAt?: string;
      expiresAt?: string;
    }>;
  }>(`${accountBaseUrl}/auth/v1/permission-grants`);
  return (data.list || []).map((item) => ({
    id: item.grantId,
    targetUserId: item.targetUserId,
    targetUserName: item.targetUserName,
    permissionCode: item.permissionCode,
    resourceType: item.resourceType,
    resourceName: item.resourceName,
    grantedBy: item.grantedBy,
    status: item.status,
    createdAt: item.createdAt,
    lastAt: item.lastAt,
    expiresAt: item.expiresAt,
  }));
}

// 描述：新增权限授权；本地模式下直接写入本地授权记录，后端模式下仅关心请求是否成功。
export async function grantPermission(req: ConsoleGrantPermissionReq): Promise<void> {
  if (!isDesktopBackendEnabled()) {
    const nextGrant = buildLocalPermissionGrant(req);
    const current = readLocalPermissionGrants();
    writeLocalPermissionGrants([nextGrant, ...current.filter((item) => item.id !== nextGrant.id)]);
    return;
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  await request<Record<string, never>>(`${accountBaseUrl}/auth/v1/permission-grant`, {
    method: "POST",
    body: req,
  });
}

// 描述：撤销权限授权；本地模式下直接删除 localStorage 中的授权记录。
export async function revokePermission(grantId: string): Promise<void> {
  if (!isDesktopBackendEnabled()) {
    const current = readLocalPermissionGrants();
    writeLocalPermissionGrants(current.filter((item) => item.id !== grantId));
    return;
  }
  const accountBaseUrl = resolveConfiguredServiceBaseUrl("account");
  await request<{ success: boolean }>(`${accountBaseUrl}/auth/v1/permission-grant`, {
    method: "DELETE",
    body: { grantId },
  });
}

// 描述：读取系统初始化状态，供 Desktop 启动阶段判断是否已完成开源首装流程。
export async function getSetupStatus(): Promise<SetupStatus> {
  if (!isDesktopBackendEnabled()) {
    return {
      setupStatus: "local",
      currentStep: "",
      installed: false,
      accountAvailable: false,
      accountInitialized: false,
      accountMessage: "当前未接入后端。",
    };
  }
  const setupBaseUrl = resolveConfiguredServiceBaseUrl("setup");
  return request<SetupStatus>(`${setupBaseUrl}/setup/v1/status`, {
    method: "GET",
    auth: false,
  });
}

// 描述：检查桌面端是否存在可更新版本。
export async function checkDesktopUpdate(params: {
  platform: string;
  arch: string;
  currentVersion: string;
  channel?: string;
}): Promise<DesktopUpdateCheckResult> {
  if (!isDesktopBackendEnabled()) {
    throw new BackendApiError("当前为本地模式，未接入后端更新服务。", -1, 0);
  }
  const runtimeBaseUrl = resolveConfiguredServiceBaseUrl("runtime");
  const query = toQueryString({
    platform: params.platform,
    arch: params.arch,
    currentVersion: params.currentVersion,
    channel: params.channel,
  });
  return request<DesktopUpdateCheckResult>(`${runtimeBaseUrl}/workflow/v1/desktop-update/check${query}`);
}

// 描述：创建会话。
export async function createRuntimeSession(userId: string, agentCode: string): Promise<RuntimeSessionEntity> {
  if (!isDesktopBackendEnabled()) {
    const normalizedAgentCode = String(agentCode || "").trim() || "agent";
    const sessionId = buildLocalRuntimeSessionId(normalizedAgentCode);
    upsertSessionMessages({
      agentKey: "agent",
      sessionId,
      messages: [],
    });
    return buildLocalRuntimeSessionEntity(userId, sessionId, normalizedAgentCode);
  }
  const runtimeBaseUrl = resolveConfiguredServiceBaseUrl("runtime");
  const data = await request<{ session: RuntimeSessionEntity }>(`${runtimeBaseUrl}/workflow/v1/session`, {
    method: "POST",
    body: {
      userId,
      agentCode,
    },
  });
  return data.session;
}

// 描述：查询会话列表。
export async function listRuntimeSessions(userId: string, agentCode?: string, status?: number): Promise<RuntimeSessionEntity[]> {
  if (!isDesktopBackendEnabled()) {
    void status;
    const normalizedAgentCode = String(agentCode || "").trim() || "agent";
    return getAgentSessions("agent").map((item) => buildLocalRuntimeSessionEntity(
      userId,
      item.id,
      normalizedAgentCode,
    ));
  }
  const runtimeBaseUrl = resolveConfiguredServiceBaseUrl("runtime");
  const query = toQueryString({ userId, agentCode, status });
  const data = await request<{ list: RuntimeSessionEntity[] }>(`${runtimeBaseUrl}/workflow/v1/sessions${query}`);
  return data.list || [];
}

// 描述：更新会话状态。
export async function updateRuntimeSessionStatus(userId: string, sessionId: string, status: number): Promise<RuntimeSessionEntity> {
  if (!isDesktopBackendEnabled()) {
    if (status === 0) {
      removeAgentSession("agent", sessionId);
    }
    return buildLocalRuntimeSessionEntity(
      userId,
      sessionId,
      "agent",
      status,
    );
  }
  const runtimeBaseUrl = resolveConfiguredServiceBaseUrl("runtime");
  const data = await request<{ session: RuntimeSessionEntity }>(`${runtimeBaseUrl}/workflow/v1/session/status`, {
    method: "PUT",
    body: {
      userId,
      sessionId,
      status,
    },
  });
  return data.session;
}

// 描述：写入会话消息。
export async function createRuntimeSessionMessage(userId: string, sessionId: string, role: string, content: string): Promise<RuntimeSessionMessageItem> {
  if (!isDesktopBackendEnabled()) {
    const nextMessage: RuntimeSessionMessageItem = {
      messageId: `${sessionId}-${Date.now()}`,
      sessionId,
      userId,
      role,
      content,
      createdAt: new Date().toISOString(),
    };
    const current = getSessionMessages("agent", sessionId);
    upsertSessionMessages({
      agentKey: "agent",
      sessionId,
      messages: [
        ...current,
        {
          id: nextMessage.messageId,
          role: role === "assistant" ? "assistant" : "user",
          text: content,
        },
      ],
    });
    return nextMessage;
  }
  const runtimeBaseUrl = resolveConfiguredServiceBaseUrl("runtime");
  const data = await request<{ message: RuntimeSessionMessageItem }>(`${runtimeBaseUrl}/workflow/v1/session/message`, {
    method: "POST",
    body: {
      userId,
      sessionId,
      role,
      content,
    },
  });
  return data.message;
}

// 描述：查询会话消息。
export async function listRuntimeSessionMessages(userId: string, sessionId: string, page = 1, pageSize = 200): Promise<RuntimeSessionMessageItem[]> {
  if (!isDesktopBackendEnabled()) {
    void page;
    return getSessionMessages("agent", sessionId)
      .slice(-pageSize)
      .map((item, index) => ({
        messageId: String(item.id || `${sessionId}-local-${index + 1}`),
        sessionId,
        userId,
        role: item.role,
        content: item.text,
        createdAt: "",
      }));
  }
  const runtimeBaseUrl = resolveConfiguredServiceBaseUrl("runtime");
  const query = toQueryString({ userId, sessionId, page, pageSize });
  const data = await request<{ list: RuntimeSessionMessageItem[] }>(`${runtimeBaseUrl}/workflow/v1/session/messages${query}`);
  return data.list || [];
}
