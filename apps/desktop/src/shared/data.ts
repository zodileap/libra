import type { AgentSession, AgentSummary, ShortcutItem } from "./types";
import { IS_BROWSER } from "./constants";

// 描述:
//
//   - 定义桌面端可用智能体摘要列表，供导航与页面入口渲染使用。
export const AGENTS: AgentSummary[] = [
  {
    key: "code",
    name: "代码智能体",
    description: "代码生成、重构与沙盒预览",
    hint: "Build AI apps"
  },
  {
    key: "model",
    name: "模型智能体",
    description: "三维模型生成与桌面软件联动",
    hint: "3D workflows"
  }
];

// 描述:
//
//   - 定义首页快捷入口卡片数据。
export const SHORTCUTS: ShortcutItem[] = [
  {
    id: "shortcut-build",
    title: "Build AI apps",
    description: "快速创建代码项目与页面框架"
  },
  {
    id: "shortcut-chat",
    title: "Chat with agents",
    description: "按约束资产进行多轮生成"
  },
  {
    id: "shortcut-usage",
    title: "Monitor usage",
    description: "查看智能体调用和订阅使用情况"
  }
];

// 描述:
//
//   - 定义本地会话初始数据快照，供未登录或离线场景兜底展示。
export const AGENT_SESSIONS: AgentSession[] = [
  { id: "code-001", agentKey: "code", title: "React + aries_react 脚手架", updatedAt: "今天 09:40" },
  { id: "code-002", agentKey: "code", title: "权限后台页面重构", updatedAt: "昨天 21:15" },
  { id: "model-001", agentKey: "model", title: "机械臂材质方案", updatedAt: "今天 10:12" },
  { id: "model-002", agentKey: "model", title: "低模角色风格探索", updatedAt: "昨天 18:22" }
];

// 描述:
//
//   - 模型项目本地存储键。
const MODEL_PROJECT_STORAGE_KEY = "libra.desktop.model.projects";

// 描述:
//
//   - 会话元数据本地存储键（重命名/固定/删除状态）。
const SESSION_META_STORAGE_KEY = "libra.desktop.session.meta";

// 描述:
//
//   - 会话消息本地存储键。
const SESSION_MESSAGES_STORAGE_KEY = "libra.desktop.session.messages";

// 描述:
//
//   - 会话运行态本地存储键，用于恢复“执行中步骤流”与侧边栏运行标识。
const SESSION_RUN_STATE_STORAGE_KEY = "libra.desktop.session.run.state";

// 描述:
//
//   - 会话调试资产本地存储键，用于恢复 AI 原始收发、全链路调试与 Trace 记录。
const SESSION_DEBUG_ARTIFACT_STORAGE_KEY = "libra.desktop.session.debug.artifacts";

// 描述:
//
//   - 代码目录分组本地存储键。
const CODE_WORKSPACE_GROUP_STORAGE_KEY = "libra.desktop.code.workspace.groups";

// 描述:
//
//   - 代码会话与目录映射本地存储键。
const CODE_SESSION_WORKSPACE_MAP_STORAGE_KEY = "libra.desktop.code.session.workspace.map";

// 描述:
//
//   - 最近使用代码目录 ID 本地存储键。
const CODE_LAST_WORKSPACE_ID_STORAGE_KEY = "libra.desktop.code.workspace.last";

// 描述:
//
//   - 代码项目结构化信息本地存储键（workspaceId -> profile）。
const CODE_WORKSPACE_PROFILE_STORAGE_KEY = "libra.desktop.code.workspace.profiles";

// 描述:
//
//   - 会话标题更新广播事件名。
export const SESSION_TITLE_UPDATED_EVENT = "libra:session-title-updated";

// 描述:
//
//   - 会话运行态更新广播事件名。
export const SESSION_RUN_STATE_UPDATED_EVENT = "libra:session-run-state-updated";

// 描述:
//
//   - 代码目录分组更新广播事件名。
export const CODE_WORKSPACE_GROUPS_UPDATED_EVENT = "libra:code-workspace-groups-updated";

// 描述:
//
//   - 代码项目结构化信息更新广播事件名。
export const CODE_WORKSPACE_PROFILE_UPDATED_EVENT = "libra:code-workspace-profile-updated";

// 描述:
//
//   - 定义本地模型项目存储结构。
interface StoredModelProject {
  id: string;
  title: string;
  prompt: string;
  updatedAt: string;
}

// 描述:
//
//   - 定义会话元信息存储结构。
interface SessionMeta {
  renamedTitles: Record<string, string>;
  pinnedIds: string[];
  removedIds: string[];
}

// 描述:
//
//   - 定义会话元信息只读快照结构，供页面读取状态。
export interface AgentSessionMetaSnapshot {
  renamedTitles: Record<string, string>;
  pinnedIds: string[];
  removedIds: string[];
}

// 描述:
//
//   - 定义单条会话消息存储结构。
interface StoredSessionMessage {
  id?: string;
  role: "user" | "assistant";
  text: string;
}

// 描述:
//
//   - 定义会话消息分组存储结构。
interface StoredSessionMessageGroup {
  sessionId: string;
  agentKey: "code" | "model";
  messages: StoredSessionMessage[];
}

// 描述:
//
//   - 会话运行片段结构，供会话页恢复“步骤流”展示。
export interface SessionRunSegment {
  key: string;
  intro: string;
  step: string;
  status: "running" | "finished" | "failed";
  // 描述：
  //
  //   - 透传运行片段附加数据（如人工授权 approval_id / tool_args / segment kind），
  //     用于跨页面恢复后继续执行交互，不丢失关键上下文。
  data?: Record<string, unknown>;
  detail?: string;
}

// 描述:
//
//   - 会话运行元数据结构，按消息维度记录执行状态。
export interface SessionRunMeta {
  status: "running" | "finished" | "failed";
  startedAt: number;
  finishedAt?: number;
  collapsed: boolean;
  summary: string;
  segments: SessionRunSegment[];
}

// 描述:
//
//   - 会话运行态快照结构。
export interface SessionRunStateSnapshot {
  agentKey: "code" | "model";
  sessionId: string;
  activeMessageId: string;
  sending: boolean;
  runMetaMap: Record<string, SessionRunMeta>;
  sessionApprovedToolNames?: string[];
  updatedAt: number;
}

// 描述:
//
//   - 会话运行态存储结构。
interface StoredSessionRunState extends SessionRunStateSnapshot {}

// 描述:
//
//   - 会话 Trace 记录结构，供复制排查内容与会话恢复复用。
export interface SessionTraceRecordSnapshot {
  traceId: string;
  source: string;
  code?: string;
  message: string;
}

// 描述:
//
//   - 会话调试流记录结构，供复制排查内容与会话恢复复用。
export interface SessionDebugFlowRecordSnapshot {
  id: string;
  source: "ui" | "backend";
  stage: string;
  title: string;
  detail: string;
  timestamp: number;
}

// 描述:
//
//   - 会话调试资产快照结构。
export interface SessionDebugArtifactSnapshot {
  agentKey: "code" | "model";
  sessionId: string;
  traceRecords: SessionTraceRecordSnapshot[];
  debugFlowRecords: SessionDebugFlowRecordSnapshot[];
  aiPromptRaw: string;
  aiResponseRaw: string;
  aiRawByMessage?: Record<string, { promptRaw: string; responseRaw: string }>;
  updatedAt: number;
}

// 描述:
//
//   - 会话调试资产存储结构。
interface StoredSessionDebugArtifact extends SessionDebugArtifactSnapshot {}

// 描述:
//
//   - 定义代码目录分组结构。
export interface CodeWorkspaceGroup {
  id: string;
  path: string;
  name: string;
  dependencyRules: string[];
  updatedAt: string;
}

// 描述:
//
//   - 定义项目 API 数据模型结构化信息。
export interface CodeWorkspaceProjectApiDataModel {
  entities: string[];
  requestModels: string[];
  responseModels: string[];
  mockCases: string[];
}

// 描述:
//
//   - 定义项目前端页面布局结构化信息。
export interface CodeWorkspaceProjectFrontendPageLayout {
  pages: string[];
  navigation: string[];
  pageElements: string[];
}

// 描述:
//
//   - 定义项目前端代码结构结构化信息。
export interface CodeWorkspaceProjectFrontendCodeStructure {
  directories: string[];
  moduleBoundaries: string[];
  implementationConstraints: string[];
}

// 描述:
//
//   - 定义结构化项目信息“分类-条目”中的细分维度，支持一个分类下维护多组语义条目。
export interface CodeWorkspaceProjectKnowledgeFacet {
  key: string;
  label: string;
  entries: string[];
}

// 描述:
//
//   - 定义结构化项目信息通用分类，后续可在不改动存储协议的前提下扩展更多分类。
export interface CodeWorkspaceProjectKnowledgeSection {
  key: string;
  title: string;
  description: string;
  facets: CodeWorkspaceProjectKnowledgeFacet[];
}

// 描述:
//
//   - 定义结构化项目信息分类更新入参。
export interface CodeWorkspaceProjectKnowledgeSectionInput {
  key?: string;
  title?: string;
  description?: string;
  facets?: Array<{
    key?: string;
    label?: string;
    entries?: string[];
  }>;
}

// 描述:
//
//   - 定义代码项目结构化信息（项目级共享资产）。
export interface CodeWorkspaceProjectProfile {
  schemaVersion: number;
  workspaceId: string;
  workspacePathHash: string;
  workspaceSignature: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  summary: string;
  knowledgeSections: CodeWorkspaceProjectKnowledgeSection[];
  apiDataModel: CodeWorkspaceProjectApiDataModel;
  frontendPageLayout: CodeWorkspaceProjectFrontendPageLayout;
  frontendCodeStructure: CodeWorkspaceProjectFrontendCodeStructure;
  codingConventions: string[];
}

// 描述:
//
//   - 定义代码项目结构化信息更新入参。
export interface CodeWorkspaceProjectProfileInput {
  summary?: string;
  knowledgeSections?: CodeWorkspaceProjectKnowledgeSectionInput[];
  apiDataModel?: Partial<CodeWorkspaceProjectApiDataModel>;
  frontendPageLayout?: Partial<CodeWorkspaceProjectFrontendPageLayout>;
  frontendCodeStructure?: Partial<CodeWorkspaceProjectFrontendCodeStructure>;
  codingConventions?: string[];
}

// 描述:
//
//   - 定义代码项目结构化信息保存结果。
export interface CodeWorkspaceProjectProfileSaveResult {
  ok: boolean;
  conflict: boolean;
  profile: CodeWorkspaceProjectProfile | null;
  message: string;
}

// 描述:
//
//   - 定义代码会话与目录映射结构。
interface StoredCodeSessionWorkspace {
  sessionId: string;
  workspaceId: string;
}

// 描述:
//
//   - 读取本地模型项目列表。
//
// Returns:
//
//   - 模型项目数组。
function readModelProjects(): StoredModelProject[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(MODEL_PROJECT_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item) => item?.id && item?.title);
  } catch (_err) {
    return [];
  }
}

// 描述:
//
//   - 写入本地模型项目列表。
//
// Params:
//
//   - list: 模型项目数组。
function writeModelProjects(list: StoredModelProject[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(MODEL_PROJECT_STORAGE_KEY, JSON.stringify(list));
}

// 描述:
//
//   - 读取会话元信息。
//
// Returns:
//
//   - 会话元信息对象。
function readSessionMeta(): SessionMeta {
  if (!IS_BROWSER) {
    return {
      renamedTitles: {},
      pinnedIds: [],
      removedIds: [],
    };
  }

  const raw = window.localStorage.getItem(SESSION_META_STORAGE_KEY);
  if (!raw) {
    return {
      renamedTitles: {},
      pinnedIds: [],
      removedIds: [],
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      renamedTitles: parsed?.renamedTitles || {},
      pinnedIds: Array.isArray(parsed?.pinnedIds) ? parsed.pinnedIds : [],
      removedIds: Array.isArray(parsed?.removedIds) ? parsed.removedIds : [],
    };
  } catch (_err) {
    return {
      renamedTitles: {},
      pinnedIds: [],
      removedIds: [],
    };
  }
}

// 描述:
//
//   - 写入会话元信息。
//
// Params:
//
//   - meta: 会话元信息。
function writeSessionMeta(meta: SessionMeta) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(SESSION_META_STORAGE_KEY, JSON.stringify(meta));
}

// 描述：读取会话元数据快照，供侧边栏展示固定/重命名状态。
export function getAgentSessionMetaSnapshot(): AgentSessionMetaSnapshot {
  return readSessionMeta();
}

// 描述：向当前窗口广播会话标题变更事件，供会话页与侧边栏同步标题显示。
//
// Params:
//
//   - sessionId: 会话 ID。
//   - title: 最新标题文本。
function emitSessionTitleUpdated(sessionId: string, title: string) {
  if (!IS_BROWSER) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(SESSION_TITLE_UPDATED_EVENT, {
      detail: {
        sessionId,
        title,
      },
    }),
  );
}

// 描述：向当前窗口广播代码目录分组变更事件，供侧边栏即时同步目录树数据。
//
// Params:
//
//   - reason: 触发更新的动作标识。
function emitCodeWorkspaceGroupsUpdated(reason: string) {
  if (!IS_BROWSER) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(CODE_WORKSPACE_GROUPS_UPDATED_EVENT, {
      detail: {
        reason,
      },
    }),
  );
}

// 描述：向当前窗口广播代码项目结构化信息变更事件，供会话页和设置页同步最新项目语义上下文。
//
// Params:
//
//   - workspaceId: 项目 ID。
//   - reason: 触发原因（bootstrap/settings/manual 等）。
//   - revision: 最新结构化信息版本号。
function emitCodeWorkspaceProfileUpdated(workspaceId: string, reason: string, revision: number) {
  if (!IS_BROWSER || !workspaceId) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(CODE_WORKSPACE_PROFILE_UPDATED_EVENT, {
      detail: {
        workspaceId,
        reason,
        revision,
      },
    }),
  );
}

// 描述:
//
//   - 读取会话消息分组列表。
//
// Returns:
//
//   - 会话消息分组数组。
function readSessionMessages(): StoredSessionMessageGroup[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(SESSION_MESSAGES_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item) =>
        item?.sessionId &&
        (item?.agentKey === "code" || item?.agentKey === "model") &&
        Array.isArray(item?.messages),
    );
  } catch (_err) {
    return [];
  }
}

// 描述:
//
//   - 写入会话消息分组列表。
//
// Params:
//
//   - groups: 会话消息分组数组。
function writeSessionMessages(groups: StoredSessionMessageGroup[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(SESSION_MESSAGES_STORAGE_KEY, JSON.stringify(groups));
}

// 描述：向当前窗口广播会话运行态更新事件，供侧边栏与会话页协同刷新。
//
// Params:
//
//   - input: 运行态快照（可选）。
function emitSessionRunStateUpdated(input?: {
  agentKey?: "code" | "model";
  sessionId?: string;
}) {
  if (!IS_BROWSER) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(SESSION_RUN_STATE_UPDATED_EVENT, {
      detail: {
        agentKey: input?.agentKey || "",
        sessionId: input?.sessionId || "",
      },
    }),
  );
}

// 描述：读取会话运行态列表。
//
// Returns:
//
//   - 会话运行态数组。
function readSessionRunStates(): StoredSessionRunState[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(SESSION_RUN_STATE_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item?.sessionId && (item?.agentKey === "code" || item?.agentKey === "model"))
      .map((item) => ({
        sessionId: String(item.sessionId),
        agentKey: item.agentKey === "model" ? "model" : "code",
        activeMessageId: String(item.activeMessageId || "").trim(),
        sending: Boolean(item.sending),
        runMetaMap: typeof item.runMetaMap === "object" && item.runMetaMap ? item.runMetaMap : {},
        sessionApprovedToolNames: Array.isArray(item.sessionApprovedToolNames)
          ? Array.from(new Set(
            item.sessionApprovedToolNames
              .map((toolName: unknown) => String(toolName || "").trim().toLowerCase())
              .filter((toolName: string) => Boolean(toolName)),
          ))
          : [],
        updatedAt: Number(item.updatedAt || Date.now()),
      }));
  } catch (_err) {
    return [];
  }
}

// 描述：写入会话运行态列表。
//
// Params:
//
//   - states: 会话运行态数组。
function writeSessionRunStates(states: StoredSessionRunState[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(SESSION_RUN_STATE_STORAGE_KEY, JSON.stringify(states));
}

// 描述：读取会话调试资产列表。
//
// Returns:
//
//   - 会话调试资产数组。
function readSessionDebugArtifacts(): StoredSessionDebugArtifact[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(SESSION_DEBUG_ARTIFACT_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item?.sessionId && (item?.agentKey === "code" || item?.agentKey === "model"))
      .map((item) => {
        const traceRecords = Array.isArray(item.traceRecords)
          ? item.traceRecords
            .filter((record) => record && typeof record === "object")
            .map((record) => ({
              traceId: String(record.traceId || "").trim(),
              source: String(record.source || "").trim(),
              code: String(record.code || "").trim() || undefined,
              message: String(record.message || "").trim(),
            }))
            .filter((record) => record.traceId || record.message)
            .slice(0, 100)
          : [];
        const debugFlowRecords = Array.isArray(item.debugFlowRecords)
          ? item.debugFlowRecords
            .filter((record) => record && typeof record === "object")
            .map((record, index) => ({
              id: String(record.id || "").trim() || `debug-${index + 1}`,
              source: record.source === "backend" ? "backend" : "ui",
              stage: String(record.stage || "").trim(),
              title: String(record.title || "").trim(),
              detail: String(record.detail || "").trim(),
              timestamp: Number(record.timestamp || 0),
            }))
            .slice(0, 200)
          : [];
        const aiRawByMessage = item.aiRawByMessage && typeof item.aiRawByMessage === "object"
          ? Object.entries(item.aiRawByMessage as Record<string, unknown>)
            .map(([messageId, rawItem]) => {
              const normalizedMessageId = String(messageId || "").trim();
              if (!normalizedMessageId || !rawItem || typeof rawItem !== "object") {
                return null;
              }
              const rawRecord = rawItem as Record<string, unknown>;
              return [
                normalizedMessageId,
                {
                  promptRaw: String(rawRecord.promptRaw || ""),
                  responseRaw: String(rawRecord.responseRaw || ""),
                },
              ] as const;
            })
            .filter((item): item is readonly [string, { promptRaw: string; responseRaw: string }] => Boolean(item))
            .slice(0, 200)
          : [];
        return {
          sessionId: String(item.sessionId).trim(),
          agentKey: item.agentKey === "model" ? "model" : "code",
          traceRecords,
          debugFlowRecords,
          aiPromptRaw: String(item.aiPromptRaw || ""),
          aiResponseRaw: String(item.aiResponseRaw || ""),
          aiRawByMessage: Object.fromEntries(aiRawByMessage),
          updatedAt: Number(item.updatedAt || Date.now()),
        } as StoredSessionDebugArtifact;
      });
  } catch (_err) {
    return [];
  }
}

// 描述：写入会话调试资产列表。
//
// Params:
//
//   - items: 会话调试资产数组。
function writeSessionDebugArtifacts(items: StoredSessionDebugArtifact[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(SESSION_DEBUG_ARTIFACT_STORAGE_KEY, JSON.stringify(items));
}

// 描述：提取路径最后一级目录名称，作为代码工作目录分组默认标题。
//
// Params:
//
//   - fullPath: 目录绝对路径。
//
// Returns:
//
//   - 路径尾部名称；若无法解析则回退原始路径。
function resolveWorkspaceNameFromPath(fullPath: string): string {
  const normalized = fullPath.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized) {
    return "";
  }
  const segments = normalized.split("/");
  const name = segments[segments.length - 1] || normalized;
  return name.trim() || normalized;
}

// 描述：规范化代码工作目录路径，统一去除首尾空白与尾部斜杠。
//
// Params:
//
//   - path: 原始目录路径。
//
// Returns:
//
//   - 规范化路径。
function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

// 描述：规范化项目依赖限制列表，去除空值、去重并保留原始顺序。
//
// Params:
//
//   - rules: 原始依赖限制列表。
//
// Returns:
//
//   - 规范化后的依赖限制列表。
function normalizeWorkspaceDependencyRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) {
    return [];
  }
  const normalized = rules
    .map((item) => String(item || "").trim())
    .filter((item) => Boolean(item));
  return normalized.filter((item, index) => normalized.indexOf(item) === index);
}

// 描述:
//
//   - 结构化项目信息 schema 版本，后续字段扩展时用于迁移判断。
const CODE_WORKSPACE_PROFILE_SCHEMA_VERSION = 3;

// 描述:
//
//   - 结构化项目信息的内置分类键，覆盖“业务语义 -> 接口契约 -> 页面信息架构 -> 前端实现架构 -> 工程约束”主链路。
const PROJECT_PROFILE_SECTION_KEYS = {
  businessContext: "business_context",
  interactionContracts: "interaction_contracts",
  uiInformationArchitecture: "ui_information_architecture",
  frontendImplementationArchitecture: "frontend_implementation_architecture",
  engineeringGuardrails: "engineering_guardrails",
} as const;

// 描述:
//
//   - 默认分类模板。若后续需要新增分类，可在此扩展而不破坏既有数据。
const PROJECT_PROFILE_SECTION_TEMPLATES: Array<{
  key: string;
  title: string;
  description: string;
  facets: Array<{ key: string; label: string }>;
}> = [
  {
    key: PROJECT_PROFILE_SECTION_KEYS.businessContext,
    title: "业务语义",
    description: "描述项目要解决的问题、用户角色与关键业务流程。",
    facets: [
      { key: "coreObjects", label: "核心对象" },
      { key: "rolesAndScenarios", label: "角色与场景" },
      { key: "acceptanceCriteria", label: "验收标准" },
    ],
  },
  {
    key: PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
    title: "交互契约",
    description: "描述前后端交互所依赖的数据模型、请求响应与 Mock 场景。",
    facets: [
      { key: "entities", label: "API 数据实体" },
      { key: "requestModels", label: "API 请求模型" },
      { key: "responseModels", label: "API 响应模型" },
      { key: "mockCases", label: "API Mock 场景" },
    ],
  },
  {
    key: PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture,
    title: "界面信息架构",
    description: "描述页面层级、导航菜单与页面元素区块。",
    facets: [
      { key: "pages", label: "页面清单" },
      { key: "navigation", label: "导航与菜单项" },
      { key: "pageElements", label: "页面元素结构" },
    ],
  },
  {
    key: PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
    title: "前端实现架构",
    description: "描述代码目录、模块边界与实现约束。",
    facets: [
      { key: "directories", label: "前端目录结构" },
      { key: "moduleBoundaries", label: "前端模块边界" },
      { key: "implementationConstraints", label: "前端实现约束" },
    ],
  },
  {
    key: PROJECT_PROFILE_SECTION_KEYS.engineeringGuardrails,
    title: "工程约束",
    description: "描述测试、编码规范与交付约束。",
    facets: [
      { key: "codingConventions", label: "编码约定" },
    ],
  },
];

const PROJECT_PROFILE_KNOWN_SECTION_KEY_SET = new Set(
  PROJECT_PROFILE_SECTION_TEMPLATES.map((item) => item.key),
);

// 描述:
//
//   - 使用稳定哈希算法生成目录路径指纹，用于构建项目结构化信息唯一签名。
//
// Params:
//
//   - workspacePath: 目录路径。
//
// Returns:
//
//   - 16 进制哈希字符串。
function buildWorkspacePathHash(workspacePath: string): string {
  const normalized = normalizeWorkspacePath(String(workspacePath || ""));
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// 描述:
//
//   - 生成结构化项目信息签名，组合 workspaceId、路径哈希和 schemaVersion 以便迁移与冲突排查。
//
// Params:
//
//   - workspace: 项目目录。
//   - schemaVersion: profile schema 版本。
//
// Returns:
//
//   - 项目结构化信息签名。
function buildWorkspaceProfileSignature(workspace: CodeWorkspaceGroup, schemaVersion: number): string {
  const pathHash = buildWorkspacePathHash(workspace.path);
  return `${workspace.id}:${pathHash}:v${schemaVersion}`;
}

// 描述:
//
//   - 规范化字符串数组，移除空值并去重，保持输入顺序。
//
// Params:
//
//   - value: 待规范化原始值。
//
// Returns:
//
//   - 规范化后的字符串数组。
function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
  return normalized.filter((item, index) => normalized.indexOf(item) === index);
}

// 描述:
//
//   - 规范化结构化分类中的单个细分维度，保证 key/label/entries 均可读。
//
// Params:
//
//   - source: 原始 facet 数据。
//   - fallback: 兜底模板。
//
// Returns:
//
//   - 规范化后的 facet。
function normalizeProjectKnowledgeFacet(
  source: unknown,
  fallback: { key: string; label: string; entries?: string[] },
): CodeWorkspaceProjectKnowledgeFacet {
  const value = (source || {}) as Partial<CodeWorkspaceProjectKnowledgeFacet>;
  const key = String(value.key || "").trim() || fallback.key;
  const label = String(value.label || "").trim() || fallback.label;
  return {
    key,
    label,
    entries: value.entries === undefined
      ? normalizeStringList(fallback.entries)
      : normalizeStringList(value.entries),
  };
}

// 描述:
//
//   - 根据默认模板创建可编辑分类骨架，便于后续按 key 回填数据。
//
// Returns:
//
//   - 分类模板数组。
function buildProjectProfileSectionTemplateDraft(): CodeWorkspaceProjectKnowledgeSection[] {
  return PROJECT_PROFILE_SECTION_TEMPLATES.map((section) => ({
    key: section.key,
    title: section.title,
    description: section.description,
    facets: section.facets.map((facet) => ({
      key: facet.key,
      label: facet.label,
      entries: [],
    })),
  }));
}

// 描述:
//
//   - 将旧字段结构映射为通用分类结构，作为迁移与默认值来源。
//
// Params:
//
//   - summary: 项目摘要。
//   - apiDataModel: API 数据模型。
//   - frontendPageLayout: 前端页面布局。
//   - frontendCodeStructure: 前端代码结构。
//   - codingConventions: 编码约定。
//
// Returns:
//
//   - 通用分类数组。
function buildProjectKnowledgeSectionsFromLegacyFields(
  summary: string,
  apiDataModel: CodeWorkspaceProjectApiDataModel,
  frontendPageLayout: CodeWorkspaceProjectFrontendPageLayout,
  frontendCodeStructure: CodeWorkspaceProjectFrontendCodeStructure,
  codingConventions: string[],
): CodeWorkspaceProjectKnowledgeSection[] {
  const sections = buildProjectProfileSectionTemplateDraft();
  const summaryLines = normalizeStringList(
    String(summary || "")
      .split(/[。；;\n]/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

  const assignFacetEntries = (sectionKey: string, facetKey: string, entries: string[]) => {
    const section = sections.find((item) => item.key === sectionKey);
    const facet = section?.facets.find((item) => item.key === facetKey);
    if (!facet) {
      return;
    }
    facet.entries = normalizeStringList(entries);
  };

  assignFacetEntries(PROJECT_PROFILE_SECTION_KEYS.businessContext, "coreObjects", summaryLines.slice(0, 4));
  assignFacetEntries(
    PROJECT_PROFILE_SECTION_KEYS.businessContext,
    "rolesAndScenarios",
    frontendPageLayout.pages.slice(0, 6),
  );
  assignFacetEntries(
    PROJECT_PROFILE_SECTION_KEYS.businessContext,
    "acceptanceCriteria",
    codingConventions.slice(0, 6),
  );

  assignFacetEntries(PROJECT_PROFILE_SECTION_KEYS.interactionContracts, "entities", apiDataModel.entities);
  assignFacetEntries(PROJECT_PROFILE_SECTION_KEYS.interactionContracts, "requestModels", apiDataModel.requestModels);
  assignFacetEntries(PROJECT_PROFILE_SECTION_KEYS.interactionContracts, "responseModels", apiDataModel.responseModels);
  assignFacetEntries(PROJECT_PROFILE_SECTION_KEYS.interactionContracts, "mockCases", apiDataModel.mockCases);

  assignFacetEntries(PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture, "pages", frontendPageLayout.pages);
  assignFacetEntries(PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture, "navigation", frontendPageLayout.navigation);
  assignFacetEntries(
    PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture,
    "pageElements",
    frontendPageLayout.pageElements,
  );

  assignFacetEntries(
    PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
    "directories",
    frontendCodeStructure.directories,
  );
  assignFacetEntries(
    PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
    "moduleBoundaries",
    frontendCodeStructure.moduleBoundaries,
  );
  assignFacetEntries(
    PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
    "implementationConstraints",
    frontendCodeStructure.implementationConstraints,
  );
  assignFacetEntries(
    PROJECT_PROFILE_SECTION_KEYS.engineeringGuardrails,
    "codingConventions",
    codingConventions,
  );
  return sections;
}

// 描述:
//
//   - 规范化结构化分类列表；优先使用输入值，缺失时回填模板与 fallback。
//
// Params:
//
//   - source: 原始分类列表。
//   - fallback: 兜底分类。
//
// Returns:
//
//   - 规范化后的分类列表。
function normalizeProjectKnowledgeSections(
  source: unknown,
  fallback: CodeWorkspaceProjectKnowledgeSection[],
): CodeWorkspaceProjectKnowledgeSection[] {
  const sourceList = Array.isArray(source) ? source : [];
  const normalizedKnown = fallback.map((fallbackSection) => {
    const hit = sourceList.find((item) => {
      const value = item as Partial<CodeWorkspaceProjectKnowledgeSection>;
      return String(value?.key || "").trim() === fallbackSection.key;
    }) as Partial<CodeWorkspaceProjectKnowledgeSection> | undefined;
    const sourceFacets = Array.isArray(hit?.facets) ? hit?.facets : [];
    return {
      key: fallbackSection.key,
      title: String(hit?.title || "").trim() || fallbackSection.title,
      description: String(hit?.description || "").trim() || fallbackSection.description,
      facets: fallbackSection.facets.map((fallbackFacet) => {
        const facetHit = sourceFacets.find((item) => {
          const value = item as Partial<CodeWorkspaceProjectKnowledgeFacet>;
          return String(value?.key || "").trim() === fallbackFacet.key;
        });
        return normalizeProjectKnowledgeFacet(facetHit, fallbackFacet);
      }),
    };
  });

  const normalizedCustom = sourceList
    .map((item) => {
      const value = (item || {}) as Partial<CodeWorkspaceProjectKnowledgeSection>;
      const key = String(value.key || "").trim();
      if (!key || PROJECT_PROFILE_KNOWN_SECTION_KEY_SET.has(key)) {
        return null;
      }
      const rawFacets = Array.isArray(value.facets) ? value.facets : [];
      const facets = rawFacets
        .map((facetItem, index) => {
          const facetValue = (facetItem || {}) as Partial<CodeWorkspaceProjectKnowledgeFacet>;
          const facetKey = String(facetValue.key || "").trim() || `facet_${index + 1}`;
          const facetLabel = String(facetValue.label || "").trim() || `字段 ${index + 1}`;
          return normalizeProjectKnowledgeFacet(facetValue, {
            key: facetKey,
            label: facetLabel,
          });
        })
        .filter((facet) => Boolean(facet.key));
      if (facets.length === 0) {
        return null;
      }
      return {
        key,
        title: String(value.title || "").trim() || key,
        description: String(value.description || "").trim(),
        facets,
      } as CodeWorkspaceProjectKnowledgeSection;
    })
    .filter((item): item is CodeWorkspaceProjectKnowledgeSection => Boolean(item));

  return [...normalizedKnown, ...normalizedCustom];
}

// 描述:
//
//   - 合并“已知分类默认值”与“当前自定义分类”，用于旧字段写入时保持扩展分类不丢失。
//
// Params:
//
//   - knownDefaults: 已知分类默认值。
//   - currentSections: 当前分类列表。
//
// Returns:
//
//   - 合并后的分类列表。
function mergeProjectKnowledgeSectionsWithCustom(
  knownDefaults: CodeWorkspaceProjectKnowledgeSection[],
  currentSections: CodeWorkspaceProjectKnowledgeSection[],
): CodeWorkspaceProjectKnowledgeSection[] {
  const normalizedCurrent = normalizeProjectKnowledgeSections(currentSections, knownDefaults);
  const customSections = normalizedCurrent.filter((item) => !PROJECT_PROFILE_KNOWN_SECTION_KEY_SET.has(item.key));
  const knownSections = knownDefaults.map((section) => {
    const hit = normalizedCurrent.find((item) => item.key === section.key);
    if (!hit) {
      return section;
    }
    return {
      ...section,
      title: hit.title,
      description: hit.description,
    };
  });
  return [...knownSections, ...customSections];
}

// 描述:
//
//   - 读取分类中的指定 facet 条目；若未命中则返回 fallback。
//
// Params:
//
//   - sections: 分类列表。
//   - sectionKey: 分类键。
//   - facetKey: 细分维度键。
//   - fallback: 兜底值。
//
// Returns:
//
//   - 条目数组。
function readProjectSectionFacetEntries(
  sections: CodeWorkspaceProjectKnowledgeSection[],
  sectionKey: string,
  facetKey: string,
  fallback: string[],
): string[] {
  const section = sections.find((item) => item.key === sectionKey);
  const facet = section?.facets.find((item) => item.key === facetKey);
  return facet ? normalizeStringList(facet.entries) : normalizeStringList(fallback);
}

// 描述:
//
//   - 基于通用分类反向生成旧字段结构，确保旧链路和新链路数据一致。
//
// Params:
//
//   - sections: 分类列表。
//   - fallback: 旧字段兜底值。
//
// Returns:
//
//   - 旧字段结构。
function buildLegacyFieldsFromProjectKnowledgeSections(
  sections: CodeWorkspaceProjectKnowledgeSection[],
  fallback: {
    apiDataModel: CodeWorkspaceProjectApiDataModel;
    frontendPageLayout: CodeWorkspaceProjectFrontendPageLayout;
    frontendCodeStructure: CodeWorkspaceProjectFrontendCodeStructure;
    codingConventions: string[];
  },
): {
  apiDataModel: CodeWorkspaceProjectApiDataModel;
  frontendPageLayout: CodeWorkspaceProjectFrontendPageLayout;
  frontendCodeStructure: CodeWorkspaceProjectFrontendCodeStructure;
  codingConventions: string[];
} {
  return {
    apiDataModel: {
      entities: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
        "entities",
        fallback.apiDataModel.entities,
      ),
      requestModels: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
        "requestModels",
        fallback.apiDataModel.requestModels,
      ),
      responseModels: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
        "responseModels",
        fallback.apiDataModel.responseModels,
      ),
      mockCases: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
        "mockCases",
        fallback.apiDataModel.mockCases,
      ),
    },
    frontendPageLayout: {
      pages: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture,
        "pages",
        fallback.frontendPageLayout.pages,
      ),
      navigation: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture,
        "navigation",
        fallback.frontendPageLayout.navigation,
      ),
      pageElements: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture,
        "pageElements",
        fallback.frontendPageLayout.pageElements,
      ),
    },
    frontendCodeStructure: {
      directories: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
        "directories",
        fallback.frontendCodeStructure.directories,
      ),
      moduleBoundaries: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
        "moduleBoundaries",
        fallback.frontendCodeStructure.moduleBoundaries,
      ),
      implementationConstraints: readProjectSectionFacetEntries(
        sections,
        PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
        "implementationConstraints",
        fallback.frontendCodeStructure.implementationConstraints,
      ),
    },
    codingConventions: readProjectSectionFacetEntries(
      sections,
      PROJECT_PROFILE_SECTION_KEYS.engineeringGuardrails,
      "codingConventions",
      fallback.codingConventions,
    ),
  };
}

// 描述:
//
//   - 基于项目基础信息生成结构化项目信息默认草稿。
function buildDefaultCodeWorkspaceProjectProfile(
  workspace: CodeWorkspaceGroup,
  updatedBy = "system_bootstrap",
): CodeWorkspaceProjectProfile {
  const now = new Date().toISOString();
  const dependencyConstraintLines = normalizeWorkspaceDependencyRules(workspace.dependencyRules || [])
    .map((item) => `依赖规范：${item}`)
    .slice(0, 20);
  const moduleName = String(workspace.name || "").trim() || resolveWorkspaceNameFromPath(workspace.path || "");
  const summary = `项目「${moduleName || "未命名项目"}」结构化语义基线，供代码智能体跨话题复用。`;
  const apiDataModel: CodeWorkspaceProjectApiDataModel = {
    entities: [
      "核心业务实体（待补充字段）",
    ],
    requestModels: [
      "关键交互请求模型（待补充）",
    ],
    responseModels: [
      "关键交互响应模型（待补充）",
    ],
    mockCases: [
      "核心接口 mock 场景（成功/失败/边界）",
    ],
  };
  const frontendPageLayout: CodeWorkspaceProjectFrontendPageLayout = {
    pages: [
      "页面清单（首页/列表/详情等）",
    ],
    navigation: [
      "导航结构（顶部栏/侧边栏/菜单项）",
    ],
    pageElements: [
      "页面元素（筛选区/列表区/详情区/操作区）",
    ],
  };
  const frontendCodeStructure: CodeWorkspaceProjectFrontendCodeStructure = {
    directories: [
      "src/pages",
      "src/components",
      "src/modules",
      "src/services",
    ],
    moduleBoundaries: [
      "页面层负责布局编排，组件层负责复用 UI 单元",
      "服务层负责 API 调用与数据转换，避免页面直接拼装接口细节",
    ],
    implementationConstraints: [
      ...dependencyConstraintLines,
      "优先依据结构化项目信息生成与重构代码",
      "前端实现应保持页面结构语义稳定",
    ],
  };
  const codingConventions = [
    "新增功能需补充对应单元测试",
    "优先复用现有组件与工具函数，避免重复实现",
  ];
  const knowledgeSections = buildProjectKnowledgeSectionsFromLegacyFields(
    summary,
    apiDataModel,
    frontendPageLayout,
    frontendCodeStructure,
    codingConventions,
  );

  return {
    schemaVersion: CODE_WORKSPACE_PROFILE_SCHEMA_VERSION,
    workspaceId: workspace.id,
    workspacePathHash: buildWorkspacePathHash(workspace.path),
    workspaceSignature: buildWorkspaceProfileSignature(workspace, CODE_WORKSPACE_PROFILE_SCHEMA_VERSION),
    revision: 1,
    updatedAt: now,
    updatedBy,
    summary,
    knowledgeSections,
    apiDataModel,
    frontendPageLayout,
    frontendCodeStructure,
    codingConventions,
  };
}

// 描述:
//
//   - 规范化单条结构化项目信息，兜底修复缺失字段并保证数据可读写。
function normalizeCodeWorkspaceProjectProfile(
  source: unknown,
  workspace: CodeWorkspaceGroup,
): CodeWorkspaceProjectProfile {
  const fallback = buildDefaultCodeWorkspaceProjectProfile(workspace);
  const value = (source || {}) as Partial<CodeWorkspaceProjectProfile> & Record<string, unknown>;
  const apiDataModel = (value.apiDataModel || {}) as Partial<CodeWorkspaceProjectApiDataModel>;
  const frontendPageLayout = (value.frontendPageLayout || {}) as Partial<CodeWorkspaceProjectFrontendPageLayout>;
  const frontendCodeStructure = (value.frontendCodeStructure || {}) as Partial<CodeWorkspaceProjectFrontendCodeStructure>;
  const legacyArchitecture = (value.architecture || {}) as Record<string, unknown>;
  const legacyUiSpec = (value.uiSpec || {}) as Record<string, unknown>;
  const legacyApiSpec = (value.apiSpec || {}) as Record<string, unknown>;
  const summary = String(value.summary || "").trim() || fallback.summary;
  const sourceSchemaVersion = Number(value.schemaVersion);
  const normalizedSchemaVersion = Number.isFinite(sourceSchemaVersion) && sourceSchemaVersion > 0
    ? Math.max(CODE_WORKSPACE_PROFILE_SCHEMA_VERSION, Math.trunc(sourceSchemaVersion))
    : CODE_WORKSPACE_PROFILE_SCHEMA_VERSION;
  const revision = Number.isFinite(Number(value.revision)) && Number(value.revision) > 0
    ? Math.trunc(Number(value.revision))
    : fallback.revision;
  const workspacePathHash = buildWorkspacePathHash(workspace.path);
  const workspaceSignature = buildWorkspaceProfileSignature(workspace, normalizedSchemaVersion);
  const normalizedApiDataModel = {
    entities: normalizeStringList(apiDataModel.entities ?? legacyApiSpec.services),
    requestModels: normalizeStringList(apiDataModel.requestModels),
    responseModels: normalizeStringList(apiDataModel.responseModels ?? legacyApiSpec.contracts),
    mockCases: normalizeStringList(apiDataModel.mockCases ?? legacyApiSpec.errorConventions ?? value.domainRules),
  };
  const normalizedFrontendPageLayout = {
    pages: normalizeStringList(frontendPageLayout.pages ?? legacyUiSpec.pages),
    navigation: normalizeStringList(frontendPageLayout.navigation ?? legacyUiSpec.layoutPrinciples),
    pageElements: normalizeStringList(frontendPageLayout.pageElements ?? legacyUiSpec.interactionPrinciples),
  };
  const normalizedFrontendCodeStructure = {
    directories: normalizeStringList(frontendCodeStructure.directories ?? legacyArchitecture.modules),
    moduleBoundaries: normalizeStringList(frontendCodeStructure.moduleBoundaries ?? legacyArchitecture.boundaries),
    implementationConstraints: normalizeStringList(
      frontendCodeStructure.implementationConstraints ?? legacyArchitecture.constraints,
    ),
  };
  const normalizedCodingConventions = normalizeStringList(value.codingConventions ?? value.domainRules);
  const fallbackSections = buildProjectKnowledgeSectionsFromLegacyFields(
    summary,
    normalizedApiDataModel,
    normalizedFrontendPageLayout,
    normalizedFrontendCodeStructure,
    normalizedCodingConventions,
  );
  const normalizedKnowledgeSections = normalizeProjectKnowledgeSections(value.knowledgeSections, fallbackSections);
  const normalizedLegacyFields = buildLegacyFieldsFromProjectKnowledgeSections(normalizedKnowledgeSections, {
    apiDataModel: normalizedApiDataModel,
    frontendPageLayout: normalizedFrontendPageLayout,
    frontendCodeStructure: normalizedFrontendCodeStructure,
    codingConventions: normalizedCodingConventions,
  });

  return {
    schemaVersion: normalizedSchemaVersion,
    workspaceId: workspace.id,
    workspacePathHash,
    workspaceSignature,
    revision,
    updatedAt: String(value.updatedAt || "").trim() || fallback.updatedAt,
    updatedBy: String(value.updatedBy || "").trim() || fallback.updatedBy,
    summary,
    knowledgeSections: normalizedKnowledgeSections,
    apiDataModel: normalizedLegacyFields.apiDataModel,
    frontendPageLayout: normalizedLegacyFields.frontendPageLayout,
    frontendCodeStructure: normalizedLegacyFields.frontendCodeStructure,
    codingConventions: normalizedLegacyFields.codingConventions,
  };
}

// 描述:
//
//   - 读取全部项目结构化信息映射，并按当前存在的 workspace 进行归一化。
function readCodeWorkspaceProjectProfileMap(): Record<string, CodeWorkspaceProjectProfile> {
  if (!IS_BROWSER) {
    return {};
  }
  const raw = window.localStorage.getItem(CODE_WORKSPACE_PROFILE_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const workspaceById = new Map(readCodeWorkspaceGroups().map((item) => [item.id, item]));
    const next: Record<string, CodeWorkspaceProjectProfile> = {};
    Object.entries(parsed).forEach(([workspaceId, profile]) => {
      const workspace = workspaceById.get(workspaceId);
      if (!workspace) {
        return;
      }
      next[workspaceId] = normalizeCodeWorkspaceProjectProfile(profile, workspace);
    });
    return next;
  } catch (_err) {
    return {};
  }
}

// 描述:
//
//   - 写入全部项目结构化信息映射到本地存储。
function writeCodeWorkspaceProjectProfileMap(profiles: Record<string, CodeWorkspaceProjectProfile>) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(CODE_WORKSPACE_PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

// 描述：读取代码目录分组列表。
//
// Returns:
//
//   - 代码目录分组数组。
function readCodeWorkspaceGroups(): CodeWorkspaceGroup[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(CODE_WORKSPACE_GROUP_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item?.id && item?.path)
      .map((item) => ({
        id: String(item.id),
        path: normalizeWorkspacePath(String(item.path)),
        name: String(item.name || "").trim() || resolveWorkspaceNameFromPath(String(item.path)),
        dependencyRules: normalizeWorkspaceDependencyRules(item.dependencyRules),
        updatedAt: String(item.updatedAt || ""),
      }))
      .filter((item) => Boolean(item.path));
  } catch (_err) {
    return [];
  }
}

// 描述：写入代码目录分组列表到本地存储。
//
// Params:
//
//   - groups: 目录分组数组。
function writeCodeWorkspaceGroups(groups: CodeWorkspaceGroup[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(CODE_WORKSPACE_GROUP_STORAGE_KEY, JSON.stringify(groups));
}

// 描述：读取“会话 -> 代码目录分组”映射。
//
// Returns:
//
//   - 映射数组。
function readCodeSessionWorkspaceMap(): StoredCodeSessionWorkspace[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(CODE_SESSION_WORKSPACE_MAP_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item?.sessionId && item?.workspaceId)
      .map((item) => ({
        sessionId: String(item.sessionId),
        workspaceId: String(item.workspaceId),
      }));
  } catch (_err) {
    return [];
  }
}

// 描述：写入“会话 -> 代码目录分组”映射。
//
// Params:
//
//   - mapItems: 映射数组。
function writeCodeSessionWorkspaceMap(mapItems: StoredCodeSessionWorkspace[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(CODE_SESSION_WORKSPACE_MAP_STORAGE_KEY, JSON.stringify(mapItems));
}

// 描述：读取最近一次使用的代码目录分组 ID。
//
// Returns:
//
//   - 分组 ID；未命中时返回空字符串。
function readLastCodeWorkspaceId(): string {
  if (!IS_BROWSER) {
    return "";
  }
  return String(window.localStorage.getItem(CODE_LAST_WORKSPACE_ID_STORAGE_KEY) || "").trim();
}

// 描述：写入最近一次使用的代码目录分组 ID。
//
// Params:
//
//   - workspaceId: 分组 ID。
function writeLastCodeWorkspaceId(workspaceId: string) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(CODE_LAST_WORKSPACE_ID_STORAGE_KEY, workspaceId);
}

// 描述：按 ID 查询模型项目详情。
export function getModelProjectById(id: string): StoredModelProject | null {
  return readModelProjects().find((item) => item.id === id) || null;
}

// 描述：统一解析会话展示标题，确保侧边栏与会话内容区标题口径一致。
//
// Params:
//
//   - agentKey: 智能体类型（code/model）。
//   - sessionId: 会话 ID。
//
// Returns:
//
//   会话展示标题。
export function resolveAgentSessionTitle(agentKey: "code" | "model", sessionId?: string | null): string {
  if (!sessionId) {
    return "会话详情";
  }

  const meta = readSessionMeta();
  const renamedTitle = meta.renamedTitles[sessionId];
  if (renamedTitle) {
    return renamedTitle;
  }

  if (agentKey === "model") {
    const modelProject = getModelProjectById(sessionId);
    if (modelProject?.title?.trim()) {
      return modelProject.title.trim();
    }
  }

  const presetSession = AGENT_SESSIONS.find((item) => item.id === sessionId && item.agentKey === agentKey);
  if (presetSession?.title?.trim()) {
    return presetSession.title.trim();
  }

  return "会话详情";
}

// 描述：新增或覆盖模型项目记录，保持最近项目排在最前并限制数量。
export function upsertModelProject(input: {
  id: string;
  title: string;
  prompt: string;
  updatedAt: string;
}) {
  const list = readModelProjects();
  const next = [
    input,
    ...list.filter((item) => item.id !== input.id),
  ].slice(0, 50);
  writeModelProjects(next);
}

// 描述：重命名会话标题并同步广播，确保侧边栏与会话页即时更新。
export function renameAgentSession(sessionId: string, title: string) {
  const trimmed = title.trim();
  const meta = readSessionMeta();
  if (!trimmed) {
    delete meta.renamedTitles[sessionId];
  } else {
    meta.renamedTitles[sessionId] = trimmed;
  }
  writeSessionMeta(meta);

  const projects = readModelProjects();
  const target = projects.find((item) => item.id === sessionId);
  if (target && trimmed) {
    writeModelProjects(
      projects.map((item) => (item.id === sessionId ? { ...item, title: trimmed } : item)),
    );
  }

  const inferredAgentKey = target
    ? "model"
    : (AGENT_SESSIONS.find((item) => item.id === sessionId)?.agentKey || "code");
  const nextTitle = resolveAgentSessionTitle(inferredAgentKey, sessionId);
  emitSessionTitleUpdated(sessionId, nextTitle);
}

// 描述：切换会话固定状态，返回切换后的固定结果。
export function togglePinnedAgentSession(sessionId: string): boolean {
  const meta = readSessionMeta();
  const exists = meta.pinnedIds.includes(sessionId);
  meta.pinnedIds = exists
    ? meta.pinnedIds.filter((id) => id !== sessionId)
    : [sessionId, ...meta.pinnedIds];
  writeSessionMeta(meta);
  return !exists;
}

// 描述：判断指定会话是否处于固定状态。
export function isAgentSessionPinned(sessionId: string): boolean {
  return readSessionMeta().pinnedIds.includes(sessionId);
}

// 描述：移除会话及其关联本地数据（标题、固定态、消息、目录绑定）。
export function removeAgentSession(agentKey: "code" | "model", sessionId: string) {
  if (agentKey === "model") {
    const projects = readModelProjects();
    const hasDynamic = projects.some((item) => item.id === sessionId);
    if (hasDynamic) {
      writeModelProjects(projects.filter((item) => item.id !== sessionId));
    }
  }

  const meta = readSessionMeta();
  if (!meta.removedIds.includes(sessionId)) {
    meta.removedIds.push(sessionId);
  }
  meta.pinnedIds = meta.pinnedIds.filter((id) => id !== sessionId);
  delete meta.renamedTitles[sessionId];
  writeSessionMeta(meta);

  const groups = readSessionMessages();
  writeSessionMessages(
    groups.filter((item) => !(item.agentKey === agentKey && item.sessionId === sessionId)),
  );
  removeSessionRunState(agentKey, sessionId);
  removeSessionDebugArtifact(agentKey, sessionId);

  if (agentKey === "code") {
// 描述：按会话维度读取本地消息列表。
    const mapItems = readCodeSessionWorkspaceMap();
    writeCodeSessionWorkspaceMap(mapItems.filter((item) => item.sessionId !== sessionId));
  }
}

// 描述：按智能体与会话 ID 读取本地会话消息列表。
export function getSessionMessages(
  agentKey: "code" | "model",
  sessionId: string,
): Array<{ id?: string; role: "user" | "assistant"; text: string }> {
  const group = readSessionMessages().find(
    (item) => item.agentKey === agentKey && item.sessionId === sessionId,
  );
  return group?.messages || [];
}

// 描述：写入会话消息并按会话维度覆盖，限制总存储分组数量。
export function upsertSessionMessages(input: {
  agentKey: "code" | "model";
  sessionId: string;
  messages: Array<{ id?: string; role: "user" | "assistant"; text: string }>;
}) {
  const groups = readSessionMessages();
  const nextGroup: StoredSessionMessageGroup = {
    agentKey: input.agentKey,
    sessionId: input.sessionId,
    messages: input.messages.slice(-200),
  };
  const next = [nextGroup, ...groups.filter((item) => !(item.agentKey === input.agentKey && item.sessionId === input.sessionId))]
    .slice(0, 200);
  writeSessionMessages(next);
}

const RUN_STATE_TEXT_MAX_CHARS = 800;
const RUN_STATE_DETAIL_MAX_CHARS = 8000;
const RUN_STATE_SUMMARY_MAX_CHARS = 20000;
const RUN_STATE_TOOL_ARGS_MAX_CHARS = 2000;

// 描述：
//
//   - 裁剪运行态持久化文本，避免同步 localStorage 写入大对象导致主线程阻塞。
function truncateRunStateText(value: string, maxChars: number): string {
  const normalized = String(value || "").trim();
  if (!normalized || maxChars <= 0) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}…`;
}

// 描述：
//
//   - 规范化运行片段 data，按白名单保留关键字段并裁剪超长文本。
function sanitizeRunSegmentDataForStorage(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const next: Record<string, unknown> = {};
  if (typeof data.__segment_kind === "string") {
    next.__segment_kind = truncateRunStateText(data.__segment_kind, 80);
  }
  if (typeof data.approval_id === "string") {
    next.approval_id = truncateRunStateText(data.approval_id, 120);
  }
  if (typeof data.tool_name === "string") {
    next.tool_name = truncateRunStateText(data.tool_name, 120);
  }
  if (typeof data.tool_args === "string") {
    next.tool_args = truncateRunStateText(data.tool_args, RUN_STATE_TOOL_ARGS_MAX_CHARS);
  }
  if (typeof data.code === "string") {
    next.code = truncateRunStateText(data.code, 160);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

// 描述：
//
//   - 在写入本地会话运行态前做体积收敛，降低授权阶段高频写入对前端交互的影响。
function sanitizeRunMetaMapForStorage(
  runMetaMap: Record<string, SessionRunMeta>,
): Record<string, SessionRunMeta> {
  return Object.fromEntries(
    Object.entries(runMetaMap || {})
      .map(([messageId, meta]) => {
        const normalizedMessageId = String(messageId || "").trim();
        if (!normalizedMessageId || !meta) {
          return null;
        }
        const segments = (Array.isArray(meta.segments) ? meta.segments : [])
          .map((segment) => ({
            key: truncateRunStateText(String(segment.key || ""), 120),
            intro: truncateRunStateText(String(segment.intro || ""), RUN_STATE_TEXT_MAX_CHARS),
            step: truncateRunStateText(String(segment.step || ""), RUN_STATE_TEXT_MAX_CHARS),
            status: segment.status === "failed"
              ? "failed"
              : segment.status === "finished"
                ? "finished"
                : "running",
            detail: segment.detail
              ? truncateRunStateText(String(segment.detail || ""), RUN_STATE_DETAIL_MAX_CHARS)
              : undefined,
            data: sanitizeRunSegmentDataForStorage(
              segment.data && typeof segment.data === "object"
                ? (segment.data as Record<string, unknown>)
                : undefined,
            ),
          }))
          .filter((segment) => segment.key || segment.intro || segment.step)
          .slice(-160);
        return [
          normalizedMessageId,
          {
            status: meta.status === "failed" ? "failed" : meta.status === "finished" ? "finished" : "running",
            startedAt: Number(meta.startedAt || Date.now()),
            finishedAt: meta.finishedAt ? Number(meta.finishedAt) : undefined,
            collapsed: Boolean(meta.collapsed),
            summary: truncateRunStateText(String(meta.summary || ""), RUN_STATE_SUMMARY_MAX_CHARS),
            segments,
          } as SessionRunMeta,
        ] as const;
      })
      .filter((item): item is readonly [string, SessionRunMeta] => Boolean(item)),
  );
}

// 描述：写入会话运行态快照，供会话页恢复执行中步骤与侧边栏运行标识。
//
// Params:
//
//   - input: 会话运行态快照。
export function upsertSessionRunState(input: SessionRunStateSnapshot) {
  const states = readSessionRunStates();
  const nextState: StoredSessionRunState = {
    ...input,
    activeMessageId: String(input.activeMessageId || "").trim(),
    runMetaMap: sanitizeRunMetaMapForStorage(input.runMetaMap || {}),
    sessionApprovedToolNames: Array.from(new Set(
      (input.sessionApprovedToolNames || [])
        .map((toolName) => String(toolName || "").trim().toLowerCase())
        .filter((toolName) => Boolean(toolName)),
    )),
    updatedAt: Number(input.updatedAt || Date.now()),
  };
  const next = [
    nextState,
    ...states.filter((item) => !(item.agentKey === input.agentKey && item.sessionId === input.sessionId)),
  ].slice(0, 200);
  writeSessionRunStates(next);
  emitSessionRunStateUpdated({
    agentKey: input.agentKey,
    sessionId: input.sessionId,
  });
}

// 描述：写入会话调试资产快照，供复制与会话恢复使用。
//
// Params:
//
//   - input: 会话调试资产快照。
export function upsertSessionDebugArtifact(input: SessionDebugArtifactSnapshot) {
  const items = readSessionDebugArtifacts();
  const nextArtifact: StoredSessionDebugArtifact = {
    agentKey: input.agentKey === "model" ? "model" : "code",
    sessionId: String(input.sessionId || "").trim(),
    traceRecords: (input.traceRecords || [])
      .map((record) => ({
        traceId: String(record.traceId || "").trim(),
        source: String(record.source || "").trim(),
        code: String(record.code || "").trim() || undefined,
        message: String(record.message || "").trim(),
      }))
      .filter((record) => record.traceId || record.message)
      .slice(0, 100),
    debugFlowRecords: (input.debugFlowRecords || [])
      .map((record, index) => ({
        id: String(record.id || "").trim() || `debug-${index + 1}`,
        source: record.source === "backend" ? "backend" : "ui",
        stage: String(record.stage || "").trim(),
        title: String(record.title || "").trim(),
        detail: String(record.detail || "").trim(),
        timestamp: Number(record.timestamp || 0),
      }))
      .slice(0, 200),
    aiPromptRaw: String(input.aiPromptRaw || ""),
    aiResponseRaw: String(input.aiResponseRaw || ""),
    aiRawByMessage: Object.fromEntries(
      Object.entries(input.aiRawByMessage || {})
        .map(([messageId, rawItem]) => {
          const normalizedMessageId = String(messageId || "").trim();
          if (!normalizedMessageId || !rawItem || typeof rawItem !== "object") {
            return null;
          }
          return [
            normalizedMessageId,
            {
              promptRaw: String(rawItem.promptRaw || ""),
              responseRaw: String(rawItem.responseRaw || ""),
            },
          ] as const;
        })
        .filter((item): item is readonly [string, { promptRaw: string; responseRaw: string }] => Boolean(item))
        .slice(0, 200),
    ),
    updatedAt: Number(input.updatedAt || Date.now()),
  };
  if (!nextArtifact.sessionId) {
    return;
  }
  const next = [
    nextArtifact,
    ...items.filter((item) => !(item.agentKey === nextArtifact.agentKey && item.sessionId === nextArtifact.sessionId)),
  ].slice(0, 200);
  writeSessionDebugArtifacts(next);
}

// 描述：读取指定会话调试资产快照。
//
// Params:
//
//   - agentKey: 智能体类型。
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 调试资产快照；未命中返回 null。
export function getSessionDebugArtifact(
  agentKey: "code" | "model",
  sessionId: string,
): SessionDebugArtifactSnapshot | null {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return null;
  }
  const hit = readSessionDebugArtifacts().find(
    (item) => item.agentKey === agentKey && item.sessionId === normalizedSessionId,
  );
  return hit || null;
}

// 描述：删除指定会话调试资产快照。
//
// Params:
//
//   - agentKey: 智能体类型。
//   - sessionId: 会话 ID。
export function removeSessionDebugArtifact(agentKey: "code" | "model", sessionId: string) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return;
  }
  const items = readSessionDebugArtifacts();
  const next = items.filter(
    (item) => !(item.agentKey === agentKey && item.sessionId === normalizedSessionId),
  );
  writeSessionDebugArtifacts(next);
}

// 描述：读取指定会话运行态快照。
//
// Params:
//
//   - agentKey: 智能体类型。
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 会话运行态快照；未命中返回 null。
export function getSessionRunState(
  agentKey: "code" | "model",
  sessionId: string,
): SessionRunStateSnapshot | null {
  const hit = readSessionRunStates().find(
    (item) => item.agentKey === agentKey && item.sessionId === sessionId,
  );
  return hit || null;
}

// 描述：删除指定会话运行态快照。
//
// Params:
//
//   - agentKey: 智能体类型。
//   - sessionId: 会话 ID。
export function removeSessionRunState(agentKey: "code" | "model", sessionId: string) {
  const states = readSessionRunStates();
  const next = states.filter((item) => !(item.agentKey === agentKey && item.sessionId === sessionId));
  writeSessionRunStates(next);
  emitSessionRunStateUpdated({
    agentKey,
    sessionId,
  });
}

// 描述：判断会话是否处于执行中，供侧边栏渲染运行态图标。
//
// Params:
//
//   - agentKey: 智能体类型。
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 是否执行中。
export function isSessionRunning(agentKey: "code" | "model", sessionId: string): boolean {
  const snapshot = getSessionRunState(agentKey, sessionId);
  if (!snapshot?.sending) {
    return false;
  }
  return Object.values(snapshot.runMetaMap || {}).some((item) => item.status === "running");
}

// 描述：返回指定智能体可见会话列表，融合默认会话、动态会话与本地元数据。
export function getAgentSessions(agentKey: "code" | "model"): AgentSession[] {
  const meta = readSessionMeta();
  const defaults = AGENT_SESSIONS.filter((item) => item.agentKey === agentKey);
  const dynamic =
    agentKey === "model"
      ? readModelProjects().map<AgentSession>((item) => ({
          id: item.id,
          agentKey: "model",
          title: item.title,
          updatedAt: item.updatedAt,
        }))
      : [];

  const merged = [
    ...dynamic,
    ...defaults.filter((item) => !dynamic.some((dynamicItem) => dynamicItem.id === item.id)),
  ];

  const visible = merged.filter((item) => !meta.removedIds.includes(item.id));
  const renamed = visible.map((item) => ({
    ...item,
    title: meta.renamedTitles[item.id] || item.title,
  }));

  return renamed.sort((a, b) => {
    const aPinned = meta.pinnedIds.includes(a.id);
    const bPinned = meta.pinnedIds.includes(b.id);
    if (aPinned === bPinned) return 0;
    return aPinned ? -1 : 1;
  });
}

// 描述：返回当前代码目录分组列表，按最近更新时间倒序排列。
//
// Returns:
//
//   - 目录分组数组。
export function listCodeWorkspaceGroups(): CodeWorkspaceGroup[] {
  const groups = readCodeWorkspaceGroups();
  return [...groups].sort((a, b) => {
    const aTs = new Date(a.updatedAt || 0).getTime();
    const bTs = new Date(b.updatedAt || 0).getTime();
    return bTs - aTs;
  });
}

// 描述：创建或更新代码目录分组，路径相同则复用已有分组并刷新最近使用时间。
//
// Params:
//
//   - path: 目录路径。
//
// Returns:
//
//   - 新建或命中的目录分组。
export function upsertCodeWorkspaceGroup(path: string): CodeWorkspaceGroup | null {
  const normalizedPath = normalizeWorkspacePath(path);
  if (!normalizedPath) {
    return null;
  }
  const now = new Date().toISOString();
  const groups = readCodeWorkspaceGroups();
  const hit = groups.find((item) => normalizeWorkspacePath(item.path) === normalizedPath);
  if (hit) {
    const next: CodeWorkspaceGroup = {
      ...hit,
      path: normalizedPath,
      name: hit.name || resolveWorkspaceNameFromPath(normalizedPath),
      dependencyRules: normalizeWorkspaceDependencyRules(hit.dependencyRules),
      updatedAt: now,
    };
    writeCodeWorkspaceGroups([
      next,
      ...groups.filter((item) => item.id !== hit.id),
    ]);
    writeLastCodeWorkspaceId(next.id);
    bootstrapCodeWorkspaceProjectProfile(next.id, {
      force: false,
      updatedBy: "workspace_upsert",
      reason: "workspace_upsert",
    });
    emitCodeWorkspaceGroupsUpdated("upsert");
    return next;
  }

  const created: CodeWorkspaceGroup = {
    id: `code-ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    path: normalizedPath,
    name: resolveWorkspaceNameFromPath(normalizedPath),
    dependencyRules: [],
    updatedAt: now,
  };
  writeCodeWorkspaceGroups([created, ...groups]);
  writeLastCodeWorkspaceId(created.id);
  bootstrapCodeWorkspaceProjectProfile(created.id, {
    force: false,
    updatedBy: "workspace_create",
    reason: "workspace_create",
  });
  emitCodeWorkspaceGroupsUpdated("upsert");
  return created;
}

// 描述：重命名代码目录分组。
//
// Params:
//
//   - workspaceId: 分组 ID。
//   - name: 新名称。
//
// Returns:
//
//   - 是否重命名成功。
export function renameCodeWorkspaceGroup(workspaceId: string, name: string): boolean {
  const trimmed = name.trim();
  if (!workspaceId || !trimmed) {
    return false;
  }
  const groups = readCodeWorkspaceGroups();
  const hit = groups.find((item) => item.id === workspaceId);
  if (!hit) {
    return false;
  }
  writeCodeWorkspaceGroups(
    groups.map((item) => (item.id === workspaceId
      ? {
        ...item,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      }
      : item)),
  );
  emitCodeWorkspaceGroupsUpdated("rename");
  return true;
}

// 描述：更新代码目录分组设置，统一维护项目名称与依赖限制列表。
//
// Params:
//
//   - workspaceId: 分组 ID。
//   - settings: 项目设置更新内容。
//
// Returns:
//
//   - 是否更新成功。
export function updateCodeWorkspaceGroupSettings(
  workspaceId: string,
  settings: {
    name: string;
    dependencyRules: string[];
  },
): boolean {
  if (!workspaceId) {
    return false;
  }

  const trimmedName = String(settings.name || "").trim();
  if (!trimmedName) {
    return false;
  }

  const normalizedRules = normalizeWorkspaceDependencyRules(settings.dependencyRules);
  const groups = readCodeWorkspaceGroups();
  const hit = groups.find((item) => item.id === workspaceId);
  if (!hit) {
    return false;
  }

  writeCodeWorkspaceGroups(
    groups.map((item) => (item.id === workspaceId
      ? {
        ...item,
        name: trimmedName,
        dependencyRules: normalizedRules,
        updatedAt: new Date().toISOString(),
      }
      : item)),
  );
  const currentProfile = getCodeWorkspaceProjectProfile(workspaceId);
  if (currentProfile) {
    const stableConstraints = currentProfile.frontendCodeStructure.implementationConstraints
      .filter((item) => !item.startsWith("依赖规范："));
    saveCodeWorkspaceProjectProfile(
      workspaceId,
      {
        frontendCodeStructure: {
          implementationConstraints: [
            ...normalizedRules.map((item) => `依赖规范：${item}`),
            ...stableConstraints,
          ],
        },
      },
      {
        updatedBy: "workspace_settings",
        reason: "workspace_settings_sync",
      },
    );
  } else {
    bootstrapCodeWorkspaceProjectProfile(workspaceId, {
      force: false,
      updatedBy: "workspace_settings",
      reason: "workspace_settings_sync",
    });
  }
  emitCodeWorkspaceGroupsUpdated("settings");
  return true;
}

// 描述：删除代码目录分组，并清理关联会话映射与最近使用目录引用。
//
// Params:
//
//   - workspaceId: 分组 ID。
export function removeCodeWorkspaceGroup(workspaceId: string) {
  if (!workspaceId) {
    return;
  }
  const groups = readCodeWorkspaceGroups();
  const mapItems = readCodeSessionWorkspaceMap();
  const sessionIds = mapItems
    .filter((item) => item.workspaceId === workspaceId)
    .map((item) => item.sessionId);

  // 描述：删除项目时同步移除该项目下所有会话，避免会话在后续刷新时被自动重新绑定到新项目。
  sessionIds.forEach((sessionId) => {
    removeAgentSession("code", sessionId);
  });

  writeCodeWorkspaceGroups(groups.filter((item) => item.id !== workspaceId));
  const profiles = readCodeWorkspaceProjectProfileMap();
  if (profiles[workspaceId]) {
    delete profiles[workspaceId];
    writeCodeWorkspaceProjectProfileMap(profiles);
  }
  const latestMapItems = readCodeSessionWorkspaceMap();
  writeCodeSessionWorkspaceMap(latestMapItems.filter((item) => item.workspaceId !== workspaceId));
  if (readLastCodeWorkspaceId() === workspaceId) {
    const next = listCodeWorkspaceGroups()[0];
    writeLastCodeWorkspaceId(next?.id || "");
  }
  emitCodeWorkspaceProfileUpdated(workspaceId, "workspace_remove", 0);
  emitCodeWorkspaceGroupsUpdated("remove");
}

// 描述：记录代码会话所属目录分组，并刷新该目录分组的最近使用时间。
//
// Params:
//
//   - sessionId: 会话 ID。
//   - workspaceId: 目录分组 ID。
export function bindCodeSessionWorkspace(sessionId: string, workspaceId: string) {
  if (!sessionId || !workspaceId) {
    return;
  }
  const mapItems = readCodeSessionWorkspaceMap();
  const nextItems: StoredCodeSessionWorkspace[] = [
    { sessionId, workspaceId },
    ...mapItems.filter((item) => item.sessionId !== sessionId),
  ];
  writeCodeSessionWorkspaceMap(nextItems);

  const groups = readCodeWorkspaceGroups();
  const hit = groups.find((item) => item.id === workspaceId);
  if (hit) {
    writeCodeWorkspaceGroups([
      {
        ...hit,
        dependencyRules: normalizeWorkspaceDependencyRules(hit.dependencyRules),
        updatedAt: new Date().toISOString(),
      },
      ...groups.filter((item) => item.id !== workspaceId),
    ]);
  }
  writeLastCodeWorkspaceId(workspaceId);
  emitCodeWorkspaceGroupsUpdated("bind-session");
}

// 描述：读取代码会话绑定的目录分组 ID。
//
// Params:
//
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 目录分组 ID；未命中返回空字符串。
export function getCodeWorkspaceIdBySessionId(sessionId: string): string {
  if (!sessionId) {
    return "";
  }
  const hit = readCodeSessionWorkspaceMap().find((item) => item.sessionId === sessionId);
  return hit?.workspaceId || "";
}

// 描述：根据目录分组 ID 返回目录详情。
//
// Params:
//
//   - workspaceId: 目录分组 ID。
//
// Returns:
//
//   - 目录分组详情；未命中返回 null。
export function getCodeWorkspaceGroupById(workspaceId: string): CodeWorkspaceGroup | null {
  if (!workspaceId) {
    return null;
  }
  return readCodeWorkspaceGroups().find((item) => item.id === workspaceId) || null;
}

// 描述：读取指定项目的结构化项目信息，未命中时返回 null。
//
// Params:
//
//   - workspaceId: 项目 ID。
//
// Returns:
//
//   - 项目结构化信息；未命中返回 null。
export function getCodeWorkspaceProjectProfile(workspaceId: string): CodeWorkspaceProjectProfile | null {
  if (!workspaceId) {
    return null;
  }
  const workspace = getCodeWorkspaceGroupById(workspaceId);
  if (!workspace) {
    return null;
  }
  const profiles = readCodeWorkspaceProjectProfileMap();
  const hit = profiles[workspaceId];
  if (!hit) {
    return null;
  }
  return normalizeCodeWorkspaceProjectProfile(hit, workspace);
}

// 描述：将结构化项目信息补丁合并到目标项目，并进行版本冲突检测。
//
// Params:
//
//   - workspaceId: 项目 ID。
//   - input: 结构化信息补丁。
//   - options: 保存选项（可选）。
//
// Returns:
//
//   - 保存结果（成功/冲突/失败）。
export function saveCodeWorkspaceProjectProfile(
  workspaceId: string,
  input: CodeWorkspaceProjectProfileInput,
  options?: {
    expectedRevision?: number;
    updatedBy?: string;
    reason?: string;
  },
): CodeWorkspaceProjectProfileSaveResult {
  const workspace = getCodeWorkspaceGroupById(workspaceId);
  if (!workspace) {
    return {
      ok: false,
      conflict: false,
      profile: null,
      message: "项目不存在，无法保存结构化信息。",
    };
  }

  const profiles = readCodeWorkspaceProjectProfileMap();
  const hasCurrent = Boolean(profiles[workspaceId]);
  const current = profiles[workspaceId] || buildDefaultCodeWorkspaceProjectProfile(workspace);
  const expectedRevision = options?.expectedRevision;
  if (Number.isFinite(expectedRevision) && typeof expectedRevision === "number") {
    if (current.revision !== expectedRevision) {
      return {
        ok: false,
        conflict: true,
        profile: current,
        message: "结构化信息已被其他会话更新，请刷新后重试。",
      };
    }
  }

  const nextSummary = input.summary === undefined
    ? current.summary
    : String(input.summary || "").trim() || current.summary;
  const nextLegacyFields = {
    apiDataModel: {
      entities: input.apiDataModel?.entities === undefined
        ? current.apiDataModel.entities
        : normalizeStringList(input.apiDataModel.entities),
      requestModels: input.apiDataModel?.requestModels === undefined
        ? current.apiDataModel.requestModels
        : normalizeStringList(input.apiDataModel.requestModels),
      responseModels: input.apiDataModel?.responseModels === undefined
        ? current.apiDataModel.responseModels
        : normalizeStringList(input.apiDataModel.responseModels),
      mockCases: input.apiDataModel?.mockCases === undefined
        ? current.apiDataModel.mockCases
        : normalizeStringList(input.apiDataModel.mockCases),
    },
    frontendPageLayout: {
      pages: input.frontendPageLayout?.pages === undefined
        ? current.frontendPageLayout.pages
        : normalizeStringList(input.frontendPageLayout.pages),
      navigation: input.frontendPageLayout?.navigation === undefined
        ? current.frontendPageLayout.navigation
        : normalizeStringList(input.frontendPageLayout.navigation),
      pageElements: input.frontendPageLayout?.pageElements === undefined
        ? current.frontendPageLayout.pageElements
        : normalizeStringList(input.frontendPageLayout.pageElements),
    },
    frontendCodeStructure: {
      directories: input.frontendCodeStructure?.directories === undefined
        ? current.frontendCodeStructure.directories
        : normalizeStringList(input.frontendCodeStructure.directories),
      moduleBoundaries: input.frontendCodeStructure?.moduleBoundaries === undefined
        ? current.frontendCodeStructure.moduleBoundaries
        : normalizeStringList(input.frontendCodeStructure.moduleBoundaries),
      implementationConstraints: input.frontendCodeStructure?.implementationConstraints === undefined
        ? current.frontendCodeStructure.implementationConstraints
        : normalizeStringList(input.frontendCodeStructure.implementationConstraints),
    },
    codingConventions: input.codingConventions === undefined
      ? current.codingConventions
      : normalizeStringList(input.codingConventions),
  };
  const knownDefaultSections = buildProjectKnowledgeSectionsFromLegacyFields(
    nextSummary,
    nextLegacyFields.apiDataModel,
    nextLegacyFields.frontendPageLayout,
    nextLegacyFields.frontendCodeStructure,
    nextLegacyFields.codingConventions,
  );
  const nextKnowledgeSections = input.knowledgeSections === undefined
    ? mergeProjectKnowledgeSectionsWithCustom(knownDefaultSections, current.knowledgeSections || [])
    : normalizeProjectKnowledgeSections(input.knowledgeSections, knownDefaultSections);
  const mergedLegacyFields = buildLegacyFieldsFromProjectKnowledgeSections(nextKnowledgeSections, nextLegacyFields);
  const next: CodeWorkspaceProjectProfile = {
    ...current,
    workspaceId,
    schemaVersion: CODE_WORKSPACE_PROFILE_SCHEMA_VERSION,
    workspacePathHash: buildWorkspacePathHash(workspace.path),
    workspaceSignature: buildWorkspaceProfileSignature(workspace, CODE_WORKSPACE_PROFILE_SCHEMA_VERSION),
    revision: hasCurrent ? current.revision + 1 : 1,
    updatedAt: new Date().toISOString(),
    updatedBy: String(options?.updatedBy || "").trim() || "manual_update",
    summary: nextSummary,
    knowledgeSections: nextKnowledgeSections,
    apiDataModel: mergedLegacyFields.apiDataModel,
    frontendPageLayout: mergedLegacyFields.frontendPageLayout,
    frontendCodeStructure: mergedLegacyFields.frontendCodeStructure,
    codingConventions: mergedLegacyFields.codingConventions,
  };

  profiles[workspaceId] = normalizeCodeWorkspaceProjectProfile(next, workspace);
  writeCodeWorkspaceProjectProfileMap(profiles);
  emitCodeWorkspaceProfileUpdated(
    workspaceId,
    String(options?.reason || "").trim() || "manual_update",
    profiles[workspaceId].revision,
  );
  return {
    ok: true,
    conflict: false,
    profile: profiles[workspaceId],
    message: "结构化信息已保存。",
  };
}

// 描述：按项目目录信息自动初始化结构化项目信息，支持首次接入和手动强制重建。
//
// Params:
//
//   - workspaceId: 项目 ID。
//   - options: 初始化选项（可选）。
//
// Returns:
//
//   - 初始化后的结构化信息；项目不存在时返回 null。
export function bootstrapCodeWorkspaceProjectProfile(
  workspaceId: string,
  options?: {
    force?: boolean;
    updatedBy?: string;
    reason?: string;
  },
): CodeWorkspaceProjectProfile | null {
  const workspace = getCodeWorkspaceGroupById(workspaceId);
  if (!workspace) {
    return null;
  }
  const profiles = readCodeWorkspaceProjectProfileMap();
  const current = profiles[workspaceId];
  if (current && !options?.force) {
    return current;
  }

  const bootstrap = buildDefaultCodeWorkspaceProjectProfile(
    workspace,
    String(options?.updatedBy || "").trim() || "system_bootstrap",
  );
  const next: CodeWorkspaceProjectProfile = {
    ...bootstrap,
    revision: current?.revision ? current.revision + 1 : bootstrap.revision,
  };
  profiles[workspaceId] = normalizeCodeWorkspaceProjectProfile(next, workspace);
  writeCodeWorkspaceProjectProfileMap(profiles);
  emitCodeWorkspaceProfileUpdated(
    workspaceId,
    String(options?.reason || "").trim() || "bootstrap",
    profiles[workspaceId].revision,
  );
  return profiles[workspaceId];
}

// 描述：向外暴露“upsert”语义的结构化项目信息保存接口，供工作流与设置页复用。
//
// Params:
//
//   - workspaceId: 项目 ID。
//   - input: 结构化信息补丁。
//   - options: 保存选项（可选）。
//
// Returns:
//
//   - 保存结果（成功/冲突/失败）。
export function upsertCodeWorkspaceProjectProfile(
  workspaceId: string,
  input: CodeWorkspaceProjectProfileInput,
  options?: {
    expectedRevision?: number;
    updatedBy?: string;
    reason?: string;
  },
): CodeWorkspaceProjectProfileSaveResult {
  return saveCodeWorkspaceProjectProfile(workspaceId, input, options);
}

// 描述：向外暴露“patch”语义的结构化项目信息保存接口，语义上强调局部字段更新。
//
// Params:
//
//   - workspaceId: 项目 ID。
//   - patch: 局部字段补丁。
//   - options: 保存选项（可选）。
//
// Returns:
//
//   - 保存结果（成功/冲突/失败）。
export function patchCodeWorkspaceProjectProfile(
  workspaceId: string,
  patch: CodeWorkspaceProjectProfileInput,
  options?: {
    expectedRevision?: number;
    updatedBy?: string;
    reason?: string;
  },
): CodeWorkspaceProjectProfileSaveResult {
  return saveCodeWorkspaceProjectProfile(workspaceId, patch, options);
}

// 描述：读取最近一次编辑会话使用的代码目录分组 ID。
//
// Returns:
//
//   - 最近目录分组 ID；若不存在则回退首个目录分组。
export function getLastUsedCodeWorkspaceId(): string {
  const lastId = readLastCodeWorkspaceId();
  if (lastId && readCodeWorkspaceGroups().some((item) => item.id === lastId)) {
    return lastId;
  }
  return listCodeWorkspaceGroups()[0]?.id || "";
}

// 描述：显式设置最近使用代码目录分组。
//
// Params:
//
//   - workspaceId: 目录分组 ID。
export function setLastUsedCodeWorkspaceId(workspaceId: string) {
  if (!workspaceId) {
    return;
  }
  writeLastCodeWorkspaceId(workspaceId);
}
