import type { LoginUser } from "../types";
import {
  buildAuthHeaders,
  buildBackendErrorMessage,
  buildNetworkFailureMessage,
  isUnauthorizedResponse,
  toQueryString,
} from "./backend-api-core.mjs";

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

// 描述:
//
//   - 定义代码执行步骤结构。
export interface CodeExecuteAction {
  step: string;
  description: string;
  status: number;
}

// 描述:
//
//   - 定义代码执行日志结构。
export interface CodeExecuteLog {
  level: string;
  message: string;
  at?: string;
}

// 描述:
//
//   - 定义代码执行产物结构。
export interface CodeExecuteArtifact {
  type: string;
  path: string;
  summary: string;
}

// 描述:
//
//   - 定义代码执行结果结构。
export interface CodeExecuteResult {
  executionId: string;
  status: number;
  actions: CodeExecuteAction[];
  logs: CodeExecuteLog[];
  errors: Array<{ code: string; message: string; recoverable: boolean }>;
  artifacts: CodeExecuteArtifact[];
}

// 描述:
//
//   - 定义模型任务执行结果结构。
export interface ModelTaskExecuteResult {
  taskId: string;
  status: number;
  steps: Array<{ step: string; description: string; status: number }>;
  logs: Array<{ level: string; message: string; at?: string }>;
  errors: Array<{ code: string; message: string; retryable: boolean; nextRetryInMs: number }>;
  artifacts: Array<{ type: string; path: string; summary: string }>;
  resultPath: string;
  retryPolicy: {
    retryCount: number;
    maxRetry: number;
    retryable: boolean;
    reason: string;
  };
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

// 描述：按运行环境解析后端服务地址，优先使用环境变量，未配置时回退到本地直连地址。
function resolveServiceBaseUrl(envValue: string | undefined, fallback: string): string {
  if (envValue && envValue.trim().length > 0) {
    return envValue.replace(/\/$/, "");
  }
  return fallback.replace(/\/$/, "");
}

const accountBaseUrl = resolveServiceBaseUrl(import.meta.env.VITE_ACCOUNT_BASE_URL, "http://127.0.0.1:18080");
const runtimeBaseUrl = resolveServiceBaseUrl(import.meta.env.VITE_RUNTIME_BASE_URL, "http://127.0.0.1:18081");
const agentCodeBaseUrl = resolveServiceBaseUrl(import.meta.env.VITE_AGENT_CODE_BASE_URL, "http://127.0.0.1:18082");
const agent3dBaseUrl = resolveServiceBaseUrl(import.meta.env.VITE_AGENT_3D_BASE_URL, "http://127.0.0.1:18083");

// 描述:
//
//   - 本地认证令牌存储键。
const authTokenStorageKey = "zodileap.desktop.authToken";

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
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(authTokenStorageKey) || "";
}

// 描述：写入当前身份令牌。
export function setAuthToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(authTokenStorageKey, token);
}

// 描述：清理当前身份令牌。
export function clearAuthToken() {
  if (typeof window === "undefined") {
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
  const data = await request<{ user: { id: string; name: string; email?: string } }>(`${accountBaseUrl}/auth/v1/me`);
  return {
    id: data.user.id,
    name: data.user.name,
    email: data.user.email || "",
  };
}

// 描述：当前令牌登出并失效。
export async function logoutCurrentUser(): Promise<void> {
  await request<{ success: boolean }>(`${accountBaseUrl}/auth/v1/logout`, {
    method: "POST",
    body: {},
  });
}

// 描述：获取当前用户可用智能体列表。
export async function listAvailableAgents(): Promise<AuthAvailableAgentItem[]> {
  const data = await request<{ list: AuthAvailableAgentItem[] }>(`${accountBaseUrl}/auth/v1/available-agents`);
  return data.list || [];
}

// 描述：创建会话。
export async function createRuntimeSession(userId: string, agentCode: string): Promise<RuntimeSessionEntity> {
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
  const query = toQueryString({ userId, agentCode, status });
  const data = await request<{ list: RuntimeSessionEntity[] }>(`${runtimeBaseUrl}/workflow/v1/sessions${query}`);
  return data.list || [];
}

// 描述：更新会话状态。
export async function updateRuntimeSessionStatus(userId: string, sessionId: string, status: number): Promise<RuntimeSessionEntity> {
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
  const query = toQueryString({ userId, sessionId, page, pageSize });
  const data = await request<{ list: RuntimeSessionMessageItem[] }>(`${runtimeBaseUrl}/workflow/v1/session/messages${query}`);
  return data.list || [];
}

// 描述：执行代码智能体任务。
export async function executeCodeAgent(params: { userId: string; sessionId: string; prompt: string; workspace?: string; enableWrite?: number }): Promise<CodeExecuteResult> {
  const data = await request<{ result: CodeExecuteResult }>(`${agentCodeBaseUrl}/execute/v1/execute`, {
    method: "POST",
    body: {
      userId: params.userId,
      sessionId: params.sessionId,
      prompt: params.prompt,
      workspace: params.workspace || "",
      enableWrite: params.enableWrite,
    },
  });
  return data.result;
}

// 描述：执行模型智能体任务。
export async function executeModelAgent(params: {
  userId: string;
  sessionId: string;
  prompt: string;
  dccSoftware?: string;
  dccVersion?: string;
  dccExecutablePath?: string;
  callbackUrl?: string;
  retryCount?: number;
  maxRetry?: number;
}): Promise<ModelTaskExecuteResult> {
  const data = await request<{ result: ModelTaskExecuteResult }>(`${agent3dBaseUrl}/execute/v1/execute`, {
    method: "POST",
    body: {
      userId: params.userId,
      sessionId: params.sessionId,
      prompt: params.prompt,
      dccSoftware: params.dccSoftware,
      dccVersion: params.dccVersion,
      dccExecutablePath: params.dccExecutablePath || "",
      callbackUrl: params.callbackUrl,
      retryCount: params.retryCount || 0,
      maxRetry: params.maxRetry || 2,
    },
  });
  return data.result;
}
