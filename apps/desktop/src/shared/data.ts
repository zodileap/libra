import type { AgentKey, AgentSession, AgentSummary, ShortcutItem } from "./types";
import { IS_BROWSER } from "./constants";
import { translateDesktopText } from "./i18n";

// 描述:
//
//   - 生成桌面端可用智能体摘要列表，供导航与页面入口渲染使用。
//
// Returns:
//
//   - 当前语言下的智能体摘要列表。
export function resolveAgentSummaries(): AgentSummary[] {
  return [
    {
      key: "agent",
      name: translateDesktopText("智能体"),
      description: translateDesktopText("项目开发、工作流编排与工具执行"),
      hint: translateDesktopText("Build with workflows"),
    },
  ];
}

// 描述:
//
//   - 生成首页快捷入口卡片数据，确保文案跟随当前语言切换。
//
// Returns:
//
//   - 当前语言下的快捷入口列表。
export function resolveShortcutItems(): ShortcutItem[] {
  return [
    {
      id: "shortcut-build",
      title: translateDesktopText("Build AI apps"),
      description: translateDesktopText("快速创建项目与页面框架"),
    },
    {
      id: "shortcut-chat",
      title: translateDesktopText("Chat with agents"),
      description: translateDesktopText("按约束资产进行多轮生成"),
    },
    {
      id: "shortcut-usage",
      title: translateDesktopText("Monitor usage"),
      description: translateDesktopText("查看智能体调用和订阅使用情况"),
    },
  ];
}

// 描述:
//
//   - 定义本地会话初始数据快照；当前不再预置示例话题，避免新项目自动混入历史演示会话。
export const AGENT_SESSIONS: AgentSession[] = [];

// 描述:
//
//   - 智能体项目本地存储键，统一记录会话级项目快照。
const AGENT_PROJECT_STORAGE_KEY = "libra.desktop.agent.projects";

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
//   - Agent 上下文本地存储键；独立于前端 transcript 持久化，避免 UI 展示消息与模型上下文相互污染。
const SESSION_AGENT_CONTEXT_MESSAGES_STORAGE_KEY = "libra.desktop.session.agent.context.messages";

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
//   - 项目目录分组本地存储键。
const PROJECT_WORKSPACE_GROUP_STORAGE_KEY = "libra.desktop.project.workspace.groups";

// 描述:
//
//   - 会话与目录映射本地存储键。
const PROJECT_SESSION_WORKSPACE_MAP_STORAGE_KEY = "libra.desktop.project.session.workspace.map";

// 描述:
//
//   - 最近使用项目目录 ID 本地存储键。
const PROJECT_LAST_WORKSPACE_ID_STORAGE_KEY = "libra.desktop.project.workspace.last";

// 描述:
//
//   - 项目结构化信息本地存储键（workspaceId -> profile）。
const PROJECT_WORKSPACE_PROFILE_STORAGE_KEY = "libra.desktop.project.workspace.profiles";

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
//   - 项目目录分组更新广播事件名。
export const PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT = "libra:project-workspace-groups-updated";

// 描述:
//
//   - 项目结构化信息更新广播事件名。
export const PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT = "libra:project-workspace-profile-updated";

// 描述:
//
//   - 定义本地智能体项目存储结构。
interface StoredAgentProject {
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
  selectedAiProviderBySessionId: Record<string, string>;
  selectedAiModelBySessionId: Record<string, string>;
  selectedAiModeBySessionId: Record<string, string>;
  selectedDccSoftwareBySessionId: Record<string, string>;
  cumulativeTokenUsageBySessionId: Record<string, number>;
}

// 描述:
//
//   - 定义会话元信息只读快照结构，供页面读取状态。
export interface AgentSessionMetaSnapshot {
  renamedTitles: Record<string, string>;
  pinnedIds: string[];
  removedIds: string[];
  selectedAiProviderBySessionId: Record<string, string>;
  selectedAiModelBySessionId: Record<string, string>;
  selectedAiModeBySessionId: Record<string, string>;
  selectedDccSoftwareBySessionId: Record<string, string>;
  cumulativeTokenUsageBySessionId: Record<string, number>;
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
  agentKey: AgentKey;
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
  summarySource?: "ai" | "system" | "failure";
  segments: SessionRunSegment[];
}

// 描述：
//
//   - 会话工作流阶段游标快照，供分阶段执行时恢复当前阶段与重试上下文。
export interface SessionWorkflowPhaseCursorSnapshot {
  workflowId: string;
  workflowName: string;
  rootPrompt: string;
  currentStageIndex: number;
  totalStageCount: number;
  currentNodeId: string;
  currentNodeTitle: string;
  currentMessageId: string;
  updatedAt: number;
}

// 描述:
//
//   - 会话运行态快照结构。
export interface SessionRunStateSnapshot {
  agentKey: AgentKey;
  sessionId: string;
  activeMessageId: string;
  sending: boolean;
  runMetaMap: Record<string, SessionRunMeta>;
  sessionApprovedToolNames?: string[];
  workflowPhaseCursor?: SessionWorkflowPhaseCursorSnapshot | null;
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
//   - 会话内单次 AI 原始收发结构；一条助手消息可能对应多轮请求/响应。
export interface SessionAiRawExchangeSnapshot {
  requestRaw: string;
  responseRaw: string;
  stepCode?: string;
  stepSummary?: string;
  turnIndex?: number;
  capturedAt?: number;
}

// 描述:
//
//   - 按助手消息聚合的 AI 原始收发结构；保留最新聚合值和完整 exchanges 历史。
export interface SessionAiRawByMessageSnapshot {
  promptRaw: string;
  responseRaw: string;
  exchanges?: SessionAiRawExchangeSnapshot[];
}

// 描述:
//
//   - 会话完整调用记录结构；用于复制排查时回放“从第一句开始”的函数调用与执行轨迹。
export interface SessionCallRecordSnapshot {
  id: string;
  kind: string;
  timestamp?: number;
  messageId?: string;
  traceId?: string;
  payload?: Record<string, unknown>;
}

// 描述:
//
//   - 会话调试资产快照结构。
export interface SessionDebugArtifactSnapshot {
  agentKey: AgentKey;
  sessionId: string;
  traceRecords: SessionTraceRecordSnapshot[];
  debugFlowRecords: SessionDebugFlowRecordSnapshot[];
  aiPromptRaw: string;
  aiResponseRaw: string;
  aiRawByMessage?: Record<string, SessionAiRawByMessageSnapshot>;
  callRecords?: SessionCallRecordSnapshot[];
  updatedAt: number;
}

// 描述:
//
//   - 会话调试资产存储结构。
interface StoredSessionDebugArtifact extends SessionDebugArtifactSnapshot {}

// 描述:
//
//   - 定义项目目录分组结构。
export interface ProjectWorkspaceGroup {
  id: string;
  path: string;
  name: string;
  enabledCapabilities: ProjectWorkspaceCapabilityId[];
  dependencyRules: string[];
  updatedAt: string;
}

// 描述：
//
//   - 定义项目能力类型，区分知识、策略与外部接入三类项目级扩展能力。
export type ProjectWorkspaceCapabilityKind = "knowledge" | "policy" | "integration";

// 描述：
//
//   - 定义项目能力 ID，统一作为项目设置、工作流声明与会话上下文注入的能力键。
export type ProjectWorkspaceCapabilityId =
  | "project-knowledge"
  | "dependency-policy"
  | "toolchain-integration";

// 描述：
//
//   - 定义项目能力清单项，描述能力类型、展示文案与项目内承担的职责。
export interface ProjectWorkspaceCapabilityManifest {
  id: ProjectWorkspaceCapabilityId;
  kind: ProjectWorkspaceCapabilityKind;
  title: string;
  description: string;
}

// 描述：
//
//   - 定义工作区能力绑定结构，表示某个项目是否启用了指定能力。
export interface WorkspaceCapabilityBinding {
  workspaceId: string;
  capabilityId: ProjectWorkspaceCapabilityId;
  enabled: boolean;
}

// 描述：
//
//   - 项目能力注册表；项目设置页、工作流能力声明与会话注入均基于这份内置清单工作。
const PROJECT_WORKSPACE_CAPABILITY_MANIFESTS: ProjectWorkspaceCapabilityManifest[] = [
  {
    id: "project-knowledge",
    kind: "knowledge",
    title: translateDesktopText("项目知识"),
    description: translateDesktopText("维护结构化项目信息，并在工作流需要时注入项目语义基线。"),
  },
  {
    id: "dependency-policy",
    kind: "policy",
    title: translateDesktopText("依赖策略"),
    description: translateDesktopText("维护依赖规范，并在发送前或生成后执行依赖合规检查。"),
  },
  {
    id: "toolchain-integration",
    kind: "integration",
    title: translateDesktopText("工具接入"),
    description: translateDesktopText("维护项目级 MCP 与 DCC Runtime 接入状态，供技能与工作流读取。"),
  },
];

// 描述:
//
//   - 定义项目 API 数据模型结构化信息。
export interface ProjectWorkspaceApiDataModel {
  entities: string[];
  requestModels: string[];
  responseModels: string[];
  mockCases: string[];
}

// 描述:
//
//   - 定义项目前端页面布局结构化信息。
export interface ProjectWorkspaceFrontendPageLayout {
  pages: string[];
  navigation: string[];
  pageElements: string[];
}

// 描述:
//
//   - 定义项目前端代码结构结构化信息。
export interface ProjectWorkspaceFrontendCodeStructure {
  directories: string[];
  moduleBoundaries: string[];
  implementationConstraints: string[];
}

// 描述:
//
//   - 定义结构化项目信息“分类-条目”中的细分维度，支持一个分类下维护多组语义条目。
export interface ProjectWorkspaceKnowledgeFacet {
  key: string;
  label: string;
  entries: string[];
}

// 描述:
//
//   - 定义结构化项目信息通用分类，后续可在不改动存储协议的前提下扩展更多分类。
export interface ProjectWorkspaceKnowledgeSection {
  key: string;
  title: string;
  description: string;
  facets: ProjectWorkspaceKnowledgeFacet[];
}

// 描述:
//
//   - 定义结构化项目信息分类更新入参。
export interface ProjectWorkspaceKnowledgeSectionInput {
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
//   - 定义项目结构化信息（项目级共享资产）。
export interface ProjectWorkspaceProfile {
  schemaVersion: number;
  workspaceId: string;
  workspacePathHash: string;
  workspaceSignature: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  summary: string;
  knowledgeSections: ProjectWorkspaceKnowledgeSection[];
  apiDataModel: ProjectWorkspaceApiDataModel;
  frontendPageLayout: ProjectWorkspaceFrontendPageLayout;
  frontendCodeStructure: ProjectWorkspaceFrontendCodeStructure;
  codingConventions: string[];
}

// 描述:
//
//   - 定义项目结构化信息更新入参。
export interface ProjectWorkspaceProfileInput {
  summary?: string;
  knowledgeSections?: ProjectWorkspaceKnowledgeSectionInput[];
  apiDataModel?: Partial<ProjectWorkspaceApiDataModel>;
  frontendPageLayout?: Partial<ProjectWorkspaceFrontendPageLayout>;
  frontendCodeStructure?: Partial<ProjectWorkspaceFrontendCodeStructure>;
  codingConventions?: string[];
}

// 描述:
//
//   - 定义项目结构化信息保存结果。
export interface ProjectWorkspaceProfileSaveResult {
  ok: boolean;
  conflict: boolean;
  profile: ProjectWorkspaceProfile | null;
  message: string;
}

// 描述:
//
//   - 定义会话与目录映射结构。
interface StoredProjectSessionWorkspace {
  sessionId: string;
  workspaceId: string;
}

// 描述:
//
//   - 读取本地智能体项目列表。
//
// Returns:
//
//   - 智能体项目数组。
function readAgentProjects(): StoredAgentProject[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(AGENT_PROJECT_STORAGE_KEY);
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
//   - 写入本地智能体项目列表。
//
// Params:
//
//   - list: 智能体项目数组。
function writeAgentProjects(list: StoredAgentProject[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(AGENT_PROJECT_STORAGE_KEY, JSON.stringify(list));
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
      selectedAiProviderBySessionId: {},
      selectedAiModelBySessionId: {},
      selectedAiModeBySessionId: {},
      selectedDccSoftwareBySessionId: {},
      cumulativeTokenUsageBySessionId: {},
    };
  }

  const raw = window.localStorage.getItem(SESSION_META_STORAGE_KEY);
  if (!raw) {
    return {
      renamedTitles: {},
      pinnedIds: [],
      removedIds: [],
      selectedAiProviderBySessionId: {},
      selectedAiModelBySessionId: {},
      selectedAiModeBySessionId: {},
      selectedDccSoftwareBySessionId: {},
      cumulativeTokenUsageBySessionId: {},
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      renamedTitles: parsed?.renamedTitles || {},
      pinnedIds: Array.isArray(parsed?.pinnedIds) ? parsed.pinnedIds : [],
      removedIds: Array.isArray(parsed?.removedIds) ? parsed.removedIds : [],
      selectedAiProviderBySessionId:
        parsed?.selectedAiProviderBySessionId
        && typeof parsed.selectedAiProviderBySessionId === "object"
        && !Array.isArray(parsed.selectedAiProviderBySessionId)
          ? parsed.selectedAiProviderBySessionId
          : {},
      selectedAiModelBySessionId:
        parsed?.selectedAiModelBySessionId
        && typeof parsed.selectedAiModelBySessionId === "object"
        && !Array.isArray(parsed.selectedAiModelBySessionId)
          ? parsed.selectedAiModelBySessionId
          : {},
      selectedAiModeBySessionId:
        parsed?.selectedAiModeBySessionId
        && typeof parsed.selectedAiModeBySessionId === "object"
        && !Array.isArray(parsed.selectedAiModeBySessionId)
          ? parsed.selectedAiModeBySessionId
          : {},
      selectedDccSoftwareBySessionId:
        parsed?.selectedDccSoftwareBySessionId
        && typeof parsed.selectedDccSoftwareBySessionId === "object"
        && !Array.isArray(parsed.selectedDccSoftwareBySessionId)
          ? parsed.selectedDccSoftwareBySessionId
          : {},
      cumulativeTokenUsageBySessionId:
        parsed?.cumulativeTokenUsageBySessionId
        && typeof parsed.cumulativeTokenUsageBySessionId === "object"
        && !Array.isArray(parsed.cumulativeTokenUsageBySessionId)
          ? parsed.cumulativeTokenUsageBySessionId
          : {},
    };
  } catch (_err) {
    return {
      renamedTitles: {},
      pinnedIds: [],
      removedIds: [],
      selectedAiProviderBySessionId: {},
      selectedAiModelBySessionId: {},
      selectedAiModeBySessionId: {},
      selectedDccSoftwareBySessionId: {},
      cumulativeTokenUsageBySessionId: {},
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

// 描述：向当前窗口广播项目目录分组变更事件，供侧边栏即时同步目录树数据。
//
// Params:
//
//   - reason: 触发更新的动作标识。
function emitProjectWorkspaceGroupsUpdated(reason: string) {
  if (!IS_BROWSER) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT, {
      detail: {
        reason,
      },
    }),
  );
}

// 描述：向当前窗口广播项目结构化信息变更事件，供会话页和设置页同步最新项目语义上下文。
//
// Params:
//
//   - workspaceId: 项目 ID。
//   - reason: 触发原因（bootstrap/settings/manual 等）。
//   - revision: 最新结构化信息版本号。
function emitProjectWorkspaceProfileUpdated(workspaceId: string, reason: string, revision: number) {
  if (!IS_BROWSER || !workspaceId) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT, {
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
        Boolean(item?.agentKey) &&
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

// 描述:
//
//   - 读取 agent 上下文消息分组列表。
//
// Returns:
//
//   - agent 上下文消息分组数组。
function readSessionAgentContextMessages(): StoredSessionMessageGroup[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(SESSION_AGENT_CONTEXT_MESSAGES_STORAGE_KEY);
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
        Boolean(item?.agentKey) &&
        Array.isArray(item?.messages),
    );
  } catch (_err) {
    return [];
  }
}

// 描述:
//
//   - 写入 agent 上下文消息分组列表。
//
// Params:
//
//   - groups: agent 上下文消息分组数组。
function writeSessionAgentContextMessages(groups: StoredSessionMessageGroup[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(SESSION_AGENT_CONTEXT_MESSAGES_STORAGE_KEY, JSON.stringify(groups));
}

// 描述：向当前窗口广播会话运行态更新事件，供侧边栏与会话页协同刷新。
//
// Params:
//
//   - input: 运行态快照（可选）。
function emitSessionRunStateUpdated(input?: {
  agentKey?: AgentKey;
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
      .filter((item) => item?.sessionId && Boolean(item?.agentKey))
      .map((item) => ({
        sessionId: String(item.sessionId),
        agentKey: "agent",
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
        workflowPhaseCursor: item.workflowPhaseCursor && typeof item.workflowPhaseCursor === "object"
          ? {
            workflowId: String(item.workflowPhaseCursor.workflowId || "").trim(),
            workflowName: String(item.workflowPhaseCursor.workflowName || "").trim(),
            rootPrompt: String(item.workflowPhaseCursor.rootPrompt || ""),
            currentStageIndex: Math.max(0, Number(item.workflowPhaseCursor.currentStageIndex || 0)),
            totalStageCount: Math.max(0, Number(item.workflowPhaseCursor.totalStageCount || 0)),
            currentNodeId: String(item.workflowPhaseCursor.currentNodeId || "").trim(),
            currentNodeTitle: String(item.workflowPhaseCursor.currentNodeTitle || "").trim(),
            currentMessageId: String(item.workflowPhaseCursor.currentMessageId || "").trim(),
            updatedAt: Number(item.workflowPhaseCursor.updatedAt || Date.now()),
          }
          : null,
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
      .filter((item) => item?.sessionId && Boolean(item?.agentKey))
      .map((item) => {
        const traceRecords = Array.isArray(item.traceRecords)
          ? item.traceRecords
            .filter((record: unknown) => record && typeof record === "object")
            .map((record: Record<string, unknown>) => ({
              traceId: String(record.traceId || "").trim(),
              source: String(record.source || "").trim(),
              code: String(record.code || "").trim() || undefined,
              message: String(record.message ?? ""),
            }))
            .filter((record: SessionTraceRecordSnapshot) => record.traceId || record.message)
          : [];
        const debugFlowRecords = Array.isArray(item.debugFlowRecords)
          ? item.debugFlowRecords
            .filter((record: unknown) => record && typeof record === "object")
            .map((record: Record<string, unknown>, index: number) => ({
              id: String(record.id || "").trim() || `debug-${index + 1}`,
              source: record.source === "backend" ? "backend" : "ui",
              stage: String(record.stage || "").trim(),
              title: String(record.title ?? ""),
              detail: String(record.detail ?? ""),
              timestamp: Number(record.timestamp || 0),
            }))
          : [];
        const aiRawByMessage = item.aiRawByMessage && typeof item.aiRawByMessage === "object"
          ? Object.entries(item.aiRawByMessage as Record<string, unknown>)
            .flatMap(([messageId, rawItem]) => {
              const normalizedMessageId = String(messageId || "").trim();
              if (!normalizedMessageId || !rawItem || typeof rawItem !== "object") {
                return [];
              }
              const rawRecord = rawItem as Record<string, unknown>;
              const exchanges: SessionAiRawExchangeSnapshot[] = Array.isArray(rawRecord.exchanges)
                ? rawRecord.exchanges
                  .filter((exchange) => exchange && typeof exchange === "object")
                  .map((exchange) => {
                    const exchangeRecord = exchange as Record<string, unknown>;
                    return {
                      requestRaw: String(exchangeRecord.requestRaw ?? ""),
                      responseRaw: String(exchangeRecord.responseRaw ?? ""),
                      stepCode: typeof exchangeRecord.stepCode === "string"
                        ? String(exchangeRecord.stepCode || "").trim() || undefined
                        : undefined,
                      stepSummary: typeof exchangeRecord.stepSummary === "string"
                        ? String(exchangeRecord.stepSummary ?? "")
                        : undefined,
                      turnIndex: Number.isFinite(Number(exchangeRecord.turnIndex))
                        ? Number(exchangeRecord.turnIndex)
                        : undefined,
                      capturedAt: Number.isFinite(Number(exchangeRecord.capturedAt))
                        ? Number(exchangeRecord.capturedAt)
                        : undefined,
                    };
                  })
                : [];
              const promptRaw = String(rawRecord.promptRaw ?? "");
              const responseRaw = String(rawRecord.responseRaw ?? "");
              const normalizedExchanges: SessionAiRawExchangeSnapshot[] = exchanges.length > 0
                ? exchanges
                : (promptRaw || responseRaw)
                  ? [{
                    requestRaw: promptRaw,
                    responseRaw,
                  }]
                  : [];
              return [[
                normalizedMessageId,
                {
                  promptRaw,
                  responseRaw,
                  exchanges: normalizedExchanges,
                },
              ] as const];
            })
          : [];
        const callRecords = Array.isArray(item.callRecords)
          ? item.callRecords
            .filter((record: unknown) => record && typeof record === "object")
            .map((record: Record<string, unknown>, index: number) => {
              const callRecord = record as Record<string, unknown>;
              const payload = callRecord.payload && typeof callRecord.payload === "object"
                ? callRecord.payload as Record<string, unknown>
                : undefined;
              return {
                id: String(callRecord.id || "").trim() || `call-${index + 1}`,
                kind: String(callRecord.kind || "").trim() || "unknown",
                timestamp: Number.isFinite(Number(callRecord.timestamp))
                  ? Number(callRecord.timestamp)
                  : undefined,
                messageId: typeof callRecord.messageId === "string"
                  ? String(callRecord.messageId || "").trim() || undefined
                  : undefined,
                traceId: typeof callRecord.traceId === "string"
                  ? String(callRecord.traceId || "").trim() || undefined
                  : undefined,
                payload,
              };
            })
          : [];
        return {
          sessionId: String(item.sessionId).trim(),
          agentKey: "agent",
          traceRecords,
          debugFlowRecords,
          aiPromptRaw: String(item.aiPromptRaw ?? ""),
          aiResponseRaw: String(item.aiResponseRaw ?? ""),
          aiRawByMessage: Object.fromEntries(aiRawByMessage),
          callRecords,
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

// 描述：规范化项目能力 ID 列表，统一去除空值、非法值与重复项，保持清单顺序稳定。
//
// Params:
//
//   - capabilityIds: 原始项目能力 ID 列表。
//
// Returns:
//
//   - 规范化后的项目能力 ID 列表。
function normalizeProjectWorkspaceCapabilityIds(capabilityIds: unknown): ProjectWorkspaceCapabilityId[] {
  if (!Array.isArray(capabilityIds)) {
    return [];
  }
  const supportedIds = new Set(PROJECT_WORKSPACE_CAPABILITY_MANIFESTS.map((item) => item.id));
  const normalized = capabilityIds
    .map((item) => String(item || "").trim())
    .filter((item): item is ProjectWorkspaceCapabilityId => supportedIds.has(item as ProjectWorkspaceCapabilityId));
  return normalized.filter((item, index) => normalized.indexOf(item) === index);
}

// 描述：为旧版项目目录分组推断默认项目能力，兼容未显式持久化 enabledCapabilities 的历史数据。
//
// Params:
//
//   - source: 目录分组原始对象。
//
// Returns:
//
//   - 推断后的项目能力 ID 列表。
function inferLegacyProjectWorkspaceCapabilityIds(source: Record<string, unknown>): ProjectWorkspaceCapabilityId[] {
  const next: ProjectWorkspaceCapabilityId[] = ["project-knowledge"];
  if (normalizeWorkspaceDependencyRules(source.dependencyRules).length > 0) {
    next.push("dependency-policy");
  }
  return next;
}

// 描述：
//
//   - 列出项目能力注册表，供项目设置页、工作流编辑器和会话执行链统一消费。
//
// Returns:
//
//   - 项目能力清单。
export function listProjectWorkspaceCapabilityManifests(): ProjectWorkspaceCapabilityManifest[] {
  return PROJECT_WORKSPACE_CAPABILITY_MANIFESTS.map((item) => ({ ...item }));
}

// 描述：
//
//   - 根据能力 ID 读取项目能力清单项；未命中时返回 null。
//
// Params:
//
//   - capabilityId: 项目能力 ID。
//
// Returns:
//
//   - 项目能力清单项。
export function getProjectWorkspaceCapabilityManifest(
  capabilityId: string,
): ProjectWorkspaceCapabilityManifest | null {
  const normalizedCapabilityId = String(capabilityId || "").trim();
  return PROJECT_WORKSPACE_CAPABILITY_MANIFESTS.find((item) => item.id === normalizedCapabilityId) || null;
}

// 描述：
//
//   - 判断指定项目是否启用了某个项目能力。
//
// Params:
//
//   - workspace: 项目目录分组。
//   - capabilityId: 项目能力 ID。
//
// Returns:
//
//   - true 表示已启用。
export function isProjectWorkspaceCapabilityEnabled(
  workspace: ProjectWorkspaceGroup | null | undefined,
  capabilityId: ProjectWorkspaceCapabilityId,
): boolean {
  if (!workspace) {
    return false;
  }
  return normalizeProjectWorkspaceCapabilityIds(workspace.enabledCapabilities).includes(capabilityId);
}

// 描述：
//
//   - 将工作区的能力启用状态转换为扁平绑定列表，便于项目设置页与工作流校验复用。
//
// Params:
//
//   - workspace: 项目目录分组。
//
// Returns:
//
//   - 工作区能力绑定列表。
export function resolveWorkspaceCapabilityBindings(
  workspace: ProjectWorkspaceGroup | null | undefined,
): WorkspaceCapabilityBinding[] {
  const workspaceId = String(workspace?.id || "").trim();
  const enabledSet = new Set(normalizeProjectWorkspaceCapabilityIds(workspace?.enabledCapabilities));
  return PROJECT_WORKSPACE_CAPABILITY_MANIFESTS.map((manifest) => ({
    workspaceId,
    capabilityId: manifest.id,
    enabled: enabledSet.has(manifest.id),
  }));
}

// 描述:
//
//   - 结构化项目信息 schema 版本，后续字段扩展时用于迁移判断。
const PROJECT_WORKSPACE_PROFILE_SCHEMA_VERSION = 3;

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
function getProjectProfileSectionTemplates(): Array<{
  key: string;
  title: string;
  description: string;
  facets: Array<{ key: string; label: string }>;
}> {
  return [
    {
      key: PROJECT_PROFILE_SECTION_KEYS.businessContext,
      title: translateDesktopText("业务语义"),
      description: translateDesktopText("描述项目要解决的问题、用户角色与关键业务流程。"),
      facets: [
        { key: "coreObjects", label: translateDesktopText("核心对象") },
        { key: "rolesAndScenarios", label: translateDesktopText("角色与场景") },
        { key: "acceptanceCriteria", label: translateDesktopText("验收标准") },
      ],
    },
    {
      key: PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
      title: translateDesktopText("交互契约"),
      description: translateDesktopText("描述前后端交互所依赖的数据模型、请求响应与 Mock 场景。"),
      facets: [
        { key: "entities", label: translateDesktopText("API 数据实体") },
        { key: "requestModels", label: translateDesktopText("API 请求模型") },
        { key: "responseModels", label: translateDesktopText("API 响应模型") },
        { key: "mockCases", label: translateDesktopText("API Mock 场景") },
      ],
    },
    {
      key: PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture,
      title: translateDesktopText("界面信息架构"),
      description: translateDesktopText("描述页面层级、导航菜单与页面元素区块。"),
      facets: [
        { key: "pages", label: translateDesktopText("页面清单") },
        { key: "navigation", label: translateDesktopText("导航与菜单项") },
        { key: "pageElements", label: translateDesktopText("页面元素结构") },
      ],
    },
    {
      key: PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
      title: translateDesktopText("前端实现架构"),
      description: translateDesktopText("描述项目目录、模块边界与实现约束。"),
      facets: [
        { key: "directories", label: translateDesktopText("前端目录结构") },
        { key: "moduleBoundaries", label: translateDesktopText("前端模块边界") },
        { key: "implementationConstraints", label: translateDesktopText("前端实现约束") },
      ],
    },
    {
      key: PROJECT_PROFILE_SECTION_KEYS.engineeringGuardrails,
      title: translateDesktopText("工程约束"),
      description: translateDesktopText("描述测试、编码规范与交付约束。"),
      facets: [
        { key: "codingConventions", label: translateDesktopText("编码约定") },
      ],
    },
  ];
}

const PROJECT_PROFILE_KNOWN_SECTION_KEY_SET = new Set(
  Object.values(PROJECT_PROFILE_SECTION_KEYS),
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
function buildWorkspaceProfileSignature(workspace: ProjectWorkspaceGroup, schemaVersion: number): string {
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
): ProjectWorkspaceKnowledgeFacet {
  const value = (source || {}) as Partial<ProjectWorkspaceKnowledgeFacet>;
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
function buildProjectProfileSectionTemplateDraft(): ProjectWorkspaceKnowledgeSection[] {
  return getProjectProfileSectionTemplates().map((section) => ({
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
  apiDataModel: ProjectWorkspaceApiDataModel,
  frontendPageLayout: ProjectWorkspaceFrontendPageLayout,
  frontendCodeStructure: ProjectWorkspaceFrontendCodeStructure,
  codingConventions: string[],
): ProjectWorkspaceKnowledgeSection[] {
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
  fallback: ProjectWorkspaceKnowledgeSection[],
): ProjectWorkspaceKnowledgeSection[] {
  const sourceList = Array.isArray(source) ? source : [];
  const normalizedKnown = fallback.map((fallbackSection) => {
    const hit = sourceList.find((item) => {
      const value = item as Partial<ProjectWorkspaceKnowledgeSection>;
      return String(value?.key || "").trim() === fallbackSection.key;
    }) as Partial<ProjectWorkspaceKnowledgeSection> | undefined;
    const sourceFacets = Array.isArray(hit?.facets) ? hit?.facets : [];
    return {
      key: fallbackSection.key,
      title: String(hit?.title || "").trim() || fallbackSection.title,
      description: String(hit?.description || "").trim() || fallbackSection.description,
      facets: fallbackSection.facets.map((fallbackFacet) => {
        const facetHit = sourceFacets.find((item) => {
          const value = item as Partial<ProjectWorkspaceKnowledgeFacet>;
          return String(value?.key || "").trim() === fallbackFacet.key;
        });
        return normalizeProjectKnowledgeFacet(facetHit, fallbackFacet);
      }),
    };
  });

  const normalizedCustom = sourceList
    .map((item) => {
      const value = (item || {}) as Partial<ProjectWorkspaceKnowledgeSection>;
      const key = String(value.key || "").trim();
      if (!key || PROJECT_PROFILE_KNOWN_SECTION_KEY_SET.has(key)) {
        return null;
      }
      const rawFacets = Array.isArray(value.facets) ? value.facets : [];
      const facets = rawFacets
        .map((facetItem, index) => {
          const facetValue = (facetItem || {}) as Partial<ProjectWorkspaceKnowledgeFacet>;
          const facetKey = String(facetValue.key || "").trim() || `facet_${index + 1}`;
          const facetLabel = String(facetValue.label || "").trim() || translateDesktopText("字段 {{index}}", { index: index + 1 });
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
      } as ProjectWorkspaceKnowledgeSection;
    })
    .filter((item): item is ProjectWorkspaceKnowledgeSection => Boolean(item));

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
  knownDefaults: ProjectWorkspaceKnowledgeSection[],
  currentSections: ProjectWorkspaceKnowledgeSection[],
): ProjectWorkspaceKnowledgeSection[] {
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
  sections: ProjectWorkspaceKnowledgeSection[],
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
  sections: ProjectWorkspaceKnowledgeSection[],
  fallback: {
    apiDataModel: ProjectWorkspaceApiDataModel;
    frontendPageLayout: ProjectWorkspaceFrontendPageLayout;
    frontendCodeStructure: ProjectWorkspaceFrontendCodeStructure;
    codingConventions: string[];
  },
): {
  apiDataModel: ProjectWorkspaceApiDataModel;
  frontendPageLayout: ProjectWorkspaceFrontendPageLayout;
  frontendCodeStructure: ProjectWorkspaceFrontendCodeStructure;
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
function buildDefaultProjectWorkspaceProfile(
  workspace: ProjectWorkspaceGroup,
  updatedBy = "system_bootstrap",
): ProjectWorkspaceProfile {
  const now = new Date().toISOString();
  const dependencyConstraintLines = normalizeWorkspaceDependencyRules(workspace.dependencyRules || [])
    .map((item) => translateDesktopText("依赖规范：{{item}}", { item }))
    .slice(0, 20);
  const moduleName = String(workspace.name || "").trim() || resolveWorkspaceNameFromPath(workspace.path || "");
  const summary = translateDesktopText("项目「{{name}}」结构化语义基线，供智能体跨话题复用。", {
    name: moduleName || translateDesktopText("未命名项目"),
  });
  const apiDataModel: ProjectWorkspaceApiDataModel = {
    entities: [
      translateDesktopText("核心业务实体（待补充字段）"),
    ],
    requestModels: [
      translateDesktopText("关键交互请求模型（待补充）"),
    ],
    responseModels: [
      translateDesktopText("关键交互响应模型（待补充）"),
    ],
    mockCases: [
      translateDesktopText("核心接口 mock 场景（成功/失败/边界）"),
    ],
  };
  const frontendPageLayout: ProjectWorkspaceFrontendPageLayout = {
    pages: [
      translateDesktopText("页面清单（首页/列表/详情等）"),
    ],
    navigation: [
      translateDesktopText("导航结构（顶部栏/侧边栏/菜单项）"),
    ],
    pageElements: [
      translateDesktopText("页面元素（筛选区/列表区/详情区/操作区）"),
    ],
  };
  const frontendCodeStructure: ProjectWorkspaceFrontendCodeStructure = {
    directories: [
      "src/pages",
      "src/components",
      "src/modules",
      "src/services",
    ],
    moduleBoundaries: [
      translateDesktopText("页面层负责布局编排，组件层负责复用 UI 单元"),
      translateDesktopText("服务层负责 API 调用与数据转换，避免页面直接拼装接口细节"),
    ],
    implementationConstraints: [
      ...dependencyConstraintLines,
      translateDesktopText("优先依据结构化项目信息生成与重构代码"),
      translateDesktopText("前端实现应保持页面结构语义稳定"),
    ],
  };
  const codingConventions = [
    translateDesktopText("新增功能需补充对应单元测试"),
    translateDesktopText("优先复用现有组件与工具函数，避免重复实现"),
  ];
  const knowledgeSections = buildProjectKnowledgeSectionsFromLegacyFields(
    summary,
    apiDataModel,
    frontendPageLayout,
    frontendCodeStructure,
    codingConventions,
  );

  return {
    schemaVersion: PROJECT_WORKSPACE_PROFILE_SCHEMA_VERSION,
    workspaceId: workspace.id,
    workspacePathHash: buildWorkspacePathHash(workspace.path),
    workspaceSignature: buildWorkspaceProfileSignature(workspace, PROJECT_WORKSPACE_PROFILE_SCHEMA_VERSION),
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
function normalizeProjectWorkspaceProfile(
  source: unknown,
  workspace: ProjectWorkspaceGroup,
): ProjectWorkspaceProfile {
  const fallback = buildDefaultProjectWorkspaceProfile(workspace);
  const value = (source || {}) as Partial<ProjectWorkspaceProfile> & Record<string, unknown>;
  const apiDataModel = (value.apiDataModel || {}) as Partial<ProjectWorkspaceApiDataModel>;
  const frontendPageLayout = (value.frontendPageLayout || {}) as Partial<ProjectWorkspaceFrontendPageLayout>;
  const frontendCodeStructure = (value.frontendCodeStructure || {}) as Partial<ProjectWorkspaceFrontendCodeStructure>;
  const legacyArchitecture = (value.architecture || {}) as Record<string, unknown>;
  const legacyUiSpec = (value.uiSpec || {}) as Record<string, unknown>;
  const legacyApiSpec = (value.apiSpec || {}) as Record<string, unknown>;
  const summary = String(value.summary || "").trim() || fallback.summary;
  const sourceSchemaVersion = Number(value.schemaVersion);
  const normalizedSchemaVersion = Number.isFinite(sourceSchemaVersion) && sourceSchemaVersion > 0
    ? Math.max(PROJECT_WORKSPACE_PROFILE_SCHEMA_VERSION, Math.trunc(sourceSchemaVersion))
    : PROJECT_WORKSPACE_PROFILE_SCHEMA_VERSION;
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
function readProjectWorkspaceProfileMap(): Record<string, ProjectWorkspaceProfile> {
  if (!IS_BROWSER) {
    return {};
  }
  const raw = window.localStorage.getItem(PROJECT_WORKSPACE_PROFILE_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const workspaceById = new Map(readProjectWorkspaceGroups().map((item) => [item.id, item]));
    const next: Record<string, ProjectWorkspaceProfile> = {};
    Object.entries(parsed).forEach(([workspaceId, profile]) => {
      const workspace = workspaceById.get(workspaceId);
      if (!workspace) {
        return;
      }
      next[workspaceId] = normalizeProjectWorkspaceProfile(profile, workspace);
    });
    return next;
  } catch (_err) {
    return {};
  }
}

// 描述:
//
//   - 写入全部项目结构化信息映射到本地存储。
function writeProjectWorkspaceProfileMap(profiles: Record<string, ProjectWorkspaceProfile>) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(PROJECT_WORKSPACE_PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

// 描述：读取项目目录分组列表。
//
// Returns:
//
//   - 项目目录分组数组。
function readProjectWorkspaceGroups(): ProjectWorkspaceGroup[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(PROJECT_WORKSPACE_GROUP_STORAGE_KEY);
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
      .map((item) => {
        const hasExplicitCapabilities = Object.prototype.hasOwnProperty.call(item, "enabledCapabilities");
        const normalizedCapabilities = normalizeProjectWorkspaceCapabilityIds(item.enabledCapabilities);
        return {
          id: String(item.id),
          path: normalizeWorkspacePath(String(item.path)),
          name: String(item.name || "").trim() || resolveWorkspaceNameFromPath(String(item.path)),
          enabledCapabilities: hasExplicitCapabilities
            ? normalizedCapabilities
            : normalizedCapabilities.length > 0
            ? normalizedCapabilities
            : inferLegacyProjectWorkspaceCapabilityIds(item as Record<string, unknown>),
          dependencyRules: normalizeWorkspaceDependencyRules(item.dependencyRules),
          updatedAt: String(item.updatedAt || ""),
        };
      })
      .filter((item) => Boolean(item.path));
  } catch (_err) {
    return [];
  }
}

// 描述：写入项目目录分组列表到本地存储。
//
// Params:
//
//   - groups: 目录分组数组。
function writeProjectWorkspaceGroups(groups: ProjectWorkspaceGroup[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(PROJECT_WORKSPACE_GROUP_STORAGE_KEY, JSON.stringify(groups));
}

// 描述：读取“会话 -> 项目目录分组”映射。
//
// Returns:
//
//   - 映射数组。
function readProjectSessionWorkspaceMap(): StoredProjectSessionWorkspace[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(PROJECT_SESSION_WORKSPACE_MAP_STORAGE_KEY);
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

// 描述：写入“会话 -> 项目目录分组”映射。
//
// Params:
//
//   - mapItems: 映射数组。
function writeProjectSessionWorkspaceMap(mapItems: StoredProjectSessionWorkspace[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(PROJECT_SESSION_WORKSPACE_MAP_STORAGE_KEY, JSON.stringify(mapItems));
}

// 描述：读取最近一次使用的项目目录分组 ID。
//
// Returns:
//
//   - 分组 ID；未命中时返回空字符串。
function readLastProjectWorkspaceId(): string {
  if (!IS_BROWSER) {
    return "";
  }
  return String(window.localStorage.getItem(PROJECT_LAST_WORKSPACE_ID_STORAGE_KEY) || "").trim();
}

// 描述：写入最近一次使用的项目目录分组 ID。
//
// Params:
//
//   - workspaceId: 分组 ID。
function writeLastProjectWorkspaceId(workspaceId: string) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(PROJECT_LAST_WORKSPACE_ID_STORAGE_KEY, workspaceId);
}

// 描述：按 ID 查询智能体项目详情。
export function getAgentProjectById(id: string): StoredAgentProject | null {
  return readAgentProjects().find((item) => item.id === id) || null;
}

// 描述：统一解析会话展示标题，确保侧边栏与会话内容区标题口径一致。
//
// Params:
//
//   - agentKey: 智能体标识。
//   - sessionId: 会话 ID。
//
// Returns:
//
//   会话展示标题。
export function resolveAgentSessionTitle(agentKey: AgentKey, sessionId?: string | null): string {
  void agentKey;
  if (!sessionId) {
    return translateDesktopText("会话详情");
  }

  const meta = readSessionMeta();
  const renamedTitle = meta.renamedTitles[sessionId];
  if (renamedTitle) {
    return renamedTitle;
  }

  const agentProject = getAgentProjectById(sessionId);
  if (agentProject?.title?.trim()) {
    return agentProject.title.trim();
  }

  const presetSession = AGENT_SESSIONS.find((item) => item.id === sessionId && item.agentKey === agentKey);
  if (presetSession?.title?.trim()) {
    return presetSession.title.trim();
  }

  return translateDesktopText("会话详情");
}

// 描述：新增或覆盖智能体项目记录，保持最近项目排在最前并限制数量。
export function upsertAgentProject(input: {
  id: string;
  title: string;
  prompt: string;
  updatedAt: string;
}) {
  const list = readAgentProjects();
  const next = [
    input,
    ...list.filter((item) => item.id !== input.id),
  ].slice(0, 50);
  writeAgentProjects(next);
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

  const projects = readAgentProjects();
  const target = projects.find((item) => item.id === sessionId);
  if (target && trimmed) {
    writeAgentProjects(
      projects.map((item) => (item.id === sessionId ? { ...item, title: trimmed } : item)),
    );
  }

  const nextTitle = resolveAgentSessionTitle("agent", sessionId);
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

// 描述：读取指定会话当前绑定的 AI Provider 标识，确保默认 Provider 调整不会反向污染已存在话题。
//
// Params:
//
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 已绑定的 Provider；未绑定时返回空字符串。
export function resolveAgentSessionSelectedAiProvider(sessionId: string): string {
  return String(readSessionMeta().selectedAiProviderBySessionId[sessionId] || "").trim();
}

// 描述：记录指定会话当前选择的 AI Provider；空值会清理旧绑定，便于在 Provider 失效后回退默认逻辑。
//
// Params:
//
//   - sessionId: 会话 ID。
//   - provider: Provider 标识。
export function rememberAgentSessionSelectedAiProvider(sessionId: string, provider: string) {
  const meta = readSessionMeta();
  const normalizedProvider = String(provider || "").trim();
  if (!normalizedProvider) {
    delete meta.selectedAiProviderBySessionId[sessionId];
  } else {
    meta.selectedAiProviderBySessionId[sessionId] = normalizedProvider;
  }
  writeSessionMeta(meta);
}

// 描述：清理指定会话绑定的 AI Provider，供移除会话或手动重置时复用。
//
// Params:
//
//   - sessionId: 会话 ID。
export function clearAgentSessionSelectedAiProvider(sessionId: string) {
  rememberAgentSessionSelectedAiProvider(sessionId, "");
}

// 描述：读取指定会话当前绑定的模型名，供会话级 AI 配置在 Provider 默认值之外进行覆盖。
//
// Params:
//
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 已绑定的模型名；未绑定时返回空字符串。
export function resolveAgentSessionSelectedAiModel(sessionId: string): string {
  return String(readSessionMeta().selectedAiModelBySessionId[sessionId] || "").trim();
}

// 描述：记录指定会话当前选择的模型名；空值会清理旧绑定，便于回退到 AI Key 默认模型。
//
// Params:
//
//   - sessionId: 会话 ID。
//   - modelName: 模型名。
export function rememberAgentSessionSelectedAiModel(sessionId: string, modelName: string) {
  const meta = readSessionMeta();
  const normalizedModelName = String(modelName || "").trim();
  if (!normalizedModelName) {
    delete meta.selectedAiModelBySessionId[sessionId];
  } else {
    meta.selectedAiModelBySessionId[sessionId] = normalizedModelName;
  }
  writeSessionMeta(meta);
}

// 描述：清理指定会话绑定的模型名，供移除会话或主动重置 AI 配置时复用。
//
// Params:
//
//   - sessionId: 会话 ID。
export function clearAgentSessionSelectedAiModel(sessionId: string) {
  rememberAgentSessionSelectedAiModel(sessionId, "");
}

// 描述：读取指定会话当前绑定的模式名，供会话级 AI 配置覆盖 Provider 默认模式。
//
// Params:
//
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 已绑定的模式名；未绑定时返回空字符串。
export function resolveAgentSessionSelectedAiMode(sessionId: string): string {
  return String(readSessionMeta().selectedAiModeBySessionId[sessionId] || "").trim();
}

// 描述：记录指定会话当前选择的模式名；空值会清理旧绑定，便于回退到 AI Key 默认模式。
//
// Params:
//
//   - sessionId: 会话 ID。
//   - modeName: 模式名。
export function rememberAgentSessionSelectedAiMode(sessionId: string, modeName: string) {
  const meta = readSessionMeta();
  const normalizedModeName = String(modeName || "").trim();
  if (!normalizedModeName) {
    delete meta.selectedAiModeBySessionId[sessionId];
  } else {
    meta.selectedAiModeBySessionId[sessionId] = normalizedModeName;
  }
  writeSessionMeta(meta);
}

// 描述：清理指定会话绑定的模式名，供移除会话或主动重置 AI 配置时复用。
//
// Params:
//
//   - sessionId: 会话 ID。
export function clearAgentSessionSelectedAiMode(sessionId: string) {
  rememberAgentSessionSelectedAiMode(sessionId, "");
}

// 描述：读取指定会话当前累计消耗的 token 数量，供会话输入区展示线程级用量。
//
// Params:
//
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 当前会话累计 token；不存在时返回 0。
export function resolveAgentSessionCumulativeTokenUsage(sessionId: string): number {
  const rawValue = Number(readSessionMeta().cumulativeTokenUsageBySessionId[sessionId] || 0);
  return Number.isFinite(rawValue) && rawValue > 0 ? Math.floor(rawValue) : 0;
}

// 描述：记录指定会话当前累计 token 数量；写入时会自动过滤负数与非法值。
//
// Params:
//
//   - sessionId: 会话 ID。
//   - totalTokens: 最新累计 token 数量。
export function rememberAgentSessionCumulativeTokenUsage(sessionId: string, totalTokens: number) {
  const meta = readSessionMeta();
  const normalizedTotalTokens = Number.isFinite(totalTokens) && totalTokens > 0
    ? Math.floor(totalTokens)
    : 0;
  if (normalizedTotalTokens <= 0) {
    delete meta.cumulativeTokenUsageBySessionId[sessionId];
  } else {
    meta.cumulativeTokenUsageBySessionId[sessionId] = normalizedTotalTokens;
  }
  writeSessionMeta(meta);
}

// 描述：在当前会话累计 token 上叠加本轮新增用量，供每次执行完成后持续累积。
//
// Params:
//
//   - sessionId: 会话 ID。
//   - tokenDelta: 本轮新增 token 数。
//
// Returns:
//
//   - 更新后的累计 token 数量。
export function increaseAgentSessionCumulativeTokenUsage(sessionId: string, tokenDelta: number): number {
  const normalizedTokenDelta = Number.isFinite(tokenDelta) && tokenDelta > 0
    ? Math.floor(tokenDelta)
    : 0;
  const nextTotalTokens = resolveAgentSessionCumulativeTokenUsage(sessionId) + normalizedTokenDelta;
  rememberAgentSessionCumulativeTokenUsage(sessionId, nextTotalTokens);
  return nextTotalTokens;
}

// 描述：读取指定会话当前绑定的 DCC 软件标识，供建模 Skill 在多软件场景下保持线程级一致性。
//
// Params:
//
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 已绑定的软件标识；未绑定时返回空字符串。
export function resolveAgentSessionSelectedDccSoftware(sessionId: string): string {
  return String(readSessionMeta().selectedDccSoftwareBySessionId[sessionId] || "").trim();
}

// 描述：记录指定会话当前绑定的 DCC 软件标识；空值会清理旧绑定，避免线程状态残留。
//
// Params:
//
//   - sessionId: 会话 ID。
//   - software: DCC 软件标识。
export function rememberAgentSessionSelectedDccSoftware(sessionId: string, software: string) {
  const meta = readSessionMeta();
  const normalizedSoftware = String(software || "").trim().toLowerCase();
  if (!normalizedSoftware) {
    delete meta.selectedDccSoftwareBySessionId[sessionId];
  } else {
    meta.selectedDccSoftwareBySessionId[sessionId] = normalizedSoftware;
  }
  writeSessionMeta(meta);
}

// 描述：清理指定会话绑定的 DCC 软件标识，供移除会话或用户主动重置绑定时复用。
//
// Params:
//
//   - sessionId: 会话 ID。
export function clearAgentSessionSelectedDccSoftware(sessionId: string) {
  rememberAgentSessionSelectedDccSoftware(sessionId, "");
}

// 描述：移除会话及其关联本地数据（标题、固定态、消息、目录绑定）。
export function removeAgentSession(agentKey: AgentKey, sessionId: string) {
  const projects = readAgentProjects();
  const hasDynamic = projects.some((item) => item.id === sessionId);
  if (hasDynamic) {
    writeAgentProjects(projects.filter((item) => item.id !== sessionId));
  }

  const meta = readSessionMeta();
  if (!meta.removedIds.includes(sessionId)) {
    meta.removedIds.push(sessionId);
  }
  meta.pinnedIds = meta.pinnedIds.filter((id) => id !== sessionId);
  delete meta.renamedTitles[sessionId];
  delete meta.selectedAiProviderBySessionId[sessionId];
  delete meta.selectedAiModelBySessionId[sessionId];
  delete meta.selectedAiModeBySessionId[sessionId];
  delete meta.selectedDccSoftwareBySessionId[sessionId];
  delete meta.cumulativeTokenUsageBySessionId[sessionId];
  writeSessionMeta(meta);

  const groups = readSessionMessages();
  writeSessionMessages(
    groups.filter((item) => !(item.agentKey === agentKey && item.sessionId === sessionId)),
  );
  const contextGroups = readSessionAgentContextMessages();
  writeSessionAgentContextMessages(
    contextGroups.filter((item) => !(item.agentKey === agentKey && item.sessionId === sessionId)),
  );
  removeSessionRunState(agentKey, sessionId);
  removeSessionDebugArtifact(agentKey, sessionId);

  const mapItems = readProjectSessionWorkspaceMap();
  writeProjectSessionWorkspaceMap(mapItems.filter((item) => item.sessionId !== sessionId));
}

// 描述：按智能体与会话 ID 读取本地会话消息列表。
export function getSessionMessages(
  agentKey: AgentKey,
  sessionId: string,
): Array<{ id?: string; role: "user" | "assistant"; text: string }> {
  const group = readSessionMessages().find(
    (item) => item.agentKey === agentKey && item.sessionId === sessionId,
  );
  return group?.messages || [];
}

// 描述：按智能体与会话 ID 读取本地 agent 上下文消息列表。
export function getSessionAgentContextMessages(
  agentKey: AgentKey,
  sessionId: string,
): Array<{ id?: string; role: "user" | "assistant"; text: string }> {
  const group = readSessionAgentContextMessages().find(
    (item) => item.agentKey === agentKey && item.sessionId === sessionId,
  );
  return group?.messages || [];
}

// 描述：写入会话消息并按会话维度覆盖。
//
//   - transcript 是前端完整历史记录，关闭软件后重开仍需保留从第一句到当前的全部可见消息，
//     因此这里不再按消息条数裁剪，只限制会话分组数量。
export function upsertSessionMessages(input: {
  agentKey: AgentKey;
  sessionId: string;
  messages: Array<{ id?: string; role: "user" | "assistant"; text: string }>;
}) {
  const groups = readSessionMessages();
  const nextGroup: StoredSessionMessageGroup = {
    agentKey: input.agentKey,
    sessionId: input.sessionId,
    messages: input.messages,
  };
  const next = [nextGroup, ...groups.filter((item) => !(item.agentKey === input.agentKey && item.sessionId === input.sessionId))]
    .slice(0, 200);
  writeSessionMessages(next);
}

// 描述：写入 agent 上下文消息并按会话维度覆盖，限制总存储分组数量。
//
//   - agent context 与前端 transcript 独立持久化，但这里仍保留条数收敛，
//     避免模型上下文在长期对话中无限膨胀。
export function upsertSessionAgentContextMessages(input: {
  agentKey: AgentKey;
  sessionId: string;
  messages: Array<{ id?: string; role: "user" | "assistant"; text: string }>;
}) {
  const groups = readSessionAgentContextMessages();
  const nextGroup: StoredSessionMessageGroup = {
    agentKey: input.agentKey,
    sessionId: input.sessionId,
    messages: input.messages.slice(-200),
  };
  const next = [nextGroup, ...groups.filter((item) => !(item.agentKey === input.agentKey && item.sessionId === input.sessionId))]
    .slice(0, 200);
  writeSessionAgentContextMessages(next);
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
//   - 规整用户提问问题列表，按白名单保留前端恢复所需字段并裁剪超长文本。
function sanitizeRunSegmentUserInputQuestions(
  value: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const questions = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const raw = item as Record<string, unknown>;
      const options = Array.isArray(raw.options)
        ? raw.options
          .map((option) => {
            if (!option || typeof option !== "object") {
              return null;
            }
            const rawOption = option as Record<string, unknown>;
            const label = truncateRunStateText(String(rawOption.label || ""), 120);
            const description = truncateRunStateText(String(rawOption.description || ""), 240);
            if (!label || !description) {
              return null;
            }
            return { label, description };
          })
          .filter((option): option is Record<string, unknown> => Boolean(option))
        : [];
      const id = truncateRunStateText(String(raw.id || ""), 120);
      const header = truncateRunStateText(String(raw.header || ""), 120);
      const question = truncateRunStateText(String(raw.question || ""), 400);
      if (!id || !header || !question || options.length === 0) {
        return null;
      }
      return {
        id,
        header,
        question,
        options,
      };
    })
    .filter((question): question is Record<string, unknown> => Boolean(question));
  return questions.length > 0 ? questions : undefined;
}

// 描述：
//
//   - 规整用户提问回答列表，保证切页恢复与导出时都保留稳定结构。
function sanitizeRunSegmentUserInputAnswers(
  value: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const answers = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const raw = item as Record<string, unknown>;
      const questionId = truncateRunStateText(String(raw.question_id || ""), 120);
      const answerType = truncateRunStateText(String(raw.answer_type || ""), 32);
      const optionLabel = typeof raw.option_label === "string"
        ? truncateRunStateText(raw.option_label, 120)
        : undefined;
      const valueText = truncateRunStateText(String(raw.value || ""), 400);
      if (!questionId || !answerType || !valueText) {
        return null;
      }
      const nextAnswer: Record<string, unknown> = {
        question_id: questionId,
        answer_type: answerType,
        value: valueText,
      };
      if (Number.isFinite(Number(raw.option_index))) {
        nextAnswer.option_index = Math.max(0, Math.floor(Number(raw.option_index)));
      }
      if (optionLabel) {
        nextAnswer.option_label = optionLabel;
      }
      return nextAnswer;
    })
    .filter((answer): answer is Record<string, unknown> => Boolean(answer));
  return answers.length > 0 ? answers : undefined;
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
  if (typeof data.__segment_role === "string") {
    next.__segment_role = truncateRunStateText(data.__segment_role, 80);
  }
  if (typeof data.__step_type === "string") {
    next.__step_type = truncateRunStateText(data.__step_type, 80);
  }
  if (typeof data.approval_id === "string") {
    next.approval_id = truncateRunStateText(data.approval_id, 120);
  }
  if (typeof data.request_id === "string") {
    next.request_id = truncateRunStateText(data.request_id, 120);
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
  if (typeof data.browse_detail === "string") {
    next.browse_detail = truncateRunStateText(data.browse_detail, RUN_STATE_DETAIL_MAX_CHARS);
  }
  if (typeof data.browse_prefix === "string") {
    next.browse_prefix = truncateRunStateText(data.browse_prefix, 80);
  }
  if (Number.isFinite(Number(data.browse_file_delta))) {
    next.browse_file_delta = Math.max(0, Math.floor(Number(data.browse_file_delta)));
  }
  if (Number.isFinite(Number(data.browse_search_delta))) {
    next.browse_search_delta = Math.max(0, Math.floor(Number(data.browse_search_delta)));
  }
  if (Number.isFinite(Number(data.browse_file_count))) {
    next.browse_file_count = Math.max(0, Math.floor(Number(data.browse_file_count)));
  }
  if (Number.isFinite(Number(data.browse_search_count))) {
    next.browse_search_count = Math.max(0, Math.floor(Number(data.browse_search_count)));
  }
  if (typeof data.resolution === "string") {
    next.resolution = truncateRunStateText(data.resolution, 32);
  }
  if (Number.isFinite(Number(data.question_count))) {
    next.question_count = Math.max(0, Math.floor(Number(data.question_count)));
  }
  const questions = sanitizeRunSegmentUserInputQuestions(data.questions);
  if (questions) {
    next.questions = questions;
  }
  const answers = sanitizeRunSegmentUserInputAnswers(data.answers);
  if (answers) {
    next.answers = answers;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

// 描述：
//
//   - 在写入本地会话运行态前做字段级收敛，避免无关 payload 过大。
//   - 这里不再裁掉旧片段，确保前端执行过程历史在软件重开后仍能完整恢复。
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
          .filter((segment) => segment.key || segment.intro || segment.step);
        return [
          normalizedMessageId,
          {
            status: meta.status === "failed" ? "failed" : meta.status === "finished" ? "finished" : "running",
            startedAt: Number(meta.startedAt || Date.now()),
            finishedAt: meta.finishedAt ? Number(meta.finishedAt) : undefined,
            collapsed: Boolean(meta.collapsed),
            summary: truncateRunStateText(String(meta.summary || ""), RUN_STATE_SUMMARY_MAX_CHARS),
            summarySource: meta.summarySource === "ai"
              ? "ai"
              : meta.summarySource === "failure"
                ? "failure"
                : meta.summarySource === "system"
                  ? "system"
                  : undefined,
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
    workflowPhaseCursor: input.workflowPhaseCursor && typeof input.workflowPhaseCursor === "object"
      ? {
        workflowId: String(input.workflowPhaseCursor.workflowId || "").trim(),
        workflowName: String(input.workflowPhaseCursor.workflowName || "").trim(),
        rootPrompt: String(input.workflowPhaseCursor.rootPrompt || ""),
        currentStageIndex: Math.max(0, Number(input.workflowPhaseCursor.currentStageIndex || 0)),
        totalStageCount: Math.max(0, Number(input.workflowPhaseCursor.totalStageCount || 0)),
        currentNodeId: String(input.workflowPhaseCursor.currentNodeId || "").trim(),
        currentNodeTitle: String(input.workflowPhaseCursor.currentNodeTitle || "").trim(),
        currentMessageId: String(input.workflowPhaseCursor.currentMessageId || "").trim(),
        updatedAt: Number(input.workflowPhaseCursor.updatedAt || Date.now()),
      }
      : null,
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
    agentKey: "agent",
    sessionId: String(input.sessionId || "").trim(),
    traceRecords: (input.traceRecords || [])
      .map((record) => ({
        traceId: String(record.traceId || "").trim(),
        source: String(record.source || "").trim(),
        code: String(record.code || "").trim() || undefined,
        message: String(record.message ?? ""),
      }))
      .filter((record) => record.traceId || record.message),
    debugFlowRecords: (input.debugFlowRecords || [])
      .map((record, index) => ({
        id: String(record.id || "").trim() || `debug-${index + 1}`,
        source: record.source === "backend" ? "backend" : "ui",
        stage: String(record.stage || "").trim(),
        title: String(record.title ?? ""),
        detail: String(record.detail ?? ""),
        timestamp: Number(record.timestamp || 0),
      })),
    aiPromptRaw: String(input.aiPromptRaw ?? ""),
    aiResponseRaw: String(input.aiResponseRaw ?? ""),
    aiRawByMessage: Object.fromEntries(
      Object.entries(input.aiRawByMessage || {})
        .flatMap(([messageId, rawItem]) => {
          const normalizedMessageId = String(messageId || "").trim();
          if (!normalizedMessageId || !rawItem || typeof rawItem !== "object") {
            return [];
          }
          const normalizedExchanges: SessionAiRawExchangeSnapshot[] = Array.isArray(rawItem.exchanges)
            ? rawItem.exchanges
              .filter((exchange) => exchange && typeof exchange === "object")
              .map((exchange) => ({
                requestRaw: String(exchange.requestRaw ?? ""),
                responseRaw: String(exchange.responseRaw ?? ""),
                stepCode: typeof exchange.stepCode === "string"
                  ? String(exchange.stepCode || "").trim() || undefined
                  : undefined,
                stepSummary: typeof exchange.stepSummary === "string"
                  ? String(exchange.stepSummary ?? "")
                  : undefined,
                turnIndex: Number.isFinite(Number(exchange.turnIndex))
                  ? Number(exchange.turnIndex)
                  : undefined,
                capturedAt: Number.isFinite(Number(exchange.capturedAt))
                  ? Number(exchange.capturedAt)
                  : undefined,
              }))
            : [];
          return [[
            normalizedMessageId,
            {
              promptRaw: String(rawItem.promptRaw ?? ""),
              responseRaw: String(rawItem.responseRaw ?? ""),
              exchanges: normalizedExchanges,
            },
          ] as const];
        })
    ),
    callRecords: (input.callRecords || [])
      .filter((record) => record && typeof record === "object")
      .map((record, index) => ({
        id: String(record.id || "").trim() || `call-${index + 1}`,
        kind: String(record.kind || "").trim() || "unknown",
        timestamp: Number.isFinite(Number(record.timestamp))
          ? Number(record.timestamp)
          : undefined,
        messageId: typeof record.messageId === "string"
          ? String(record.messageId || "").trim() || undefined
          : undefined,
        traceId: typeof record.traceId === "string"
          ? String(record.traceId || "").trim() || undefined
          : undefined,
        payload: record.payload && typeof record.payload === "object"
          ? record.payload
          : undefined,
      })),
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
  agentKey: AgentKey,
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
export function removeSessionDebugArtifact(agentKey: AgentKey, sessionId: string) {
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
  agentKey: AgentKey,
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
export function removeSessionRunState(agentKey: AgentKey, sessionId: string) {
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
export function isSessionRunning(agentKey: AgentKey, sessionId: string): boolean {
  const snapshot = getSessionRunState(agentKey, sessionId);
  if (!snapshot?.sending) {
    return false;
  }
  return Object.values(snapshot.runMetaMap || {}).some((item) => item.status === "running");
}

// 描述：收集本地会话动态记录，确保未接入后端时新建的话题也能出现在侧边栏。
//
// Returns:
//
//   - 动态会话列表。
function listDynamicAgentSessions(): AgentSession[] {
  const updatedAtMap = new Map<string, number>();
  const now = Date.now();

  readSessionRunStates()
    .filter((item) => item.agentKey === "agent" && item.sessionId)
    .forEach((item) => {
      updatedAtMap.set(item.sessionId, Number(item.updatedAt || now));
    });

  readSessionDebugArtifacts()
    .filter((item) => item.agentKey === "agent" && item.sessionId)
    .forEach((item) => {
      const current = updatedAtMap.get(item.sessionId) || 0;
      updatedAtMap.set(item.sessionId, Math.max(current, Number(item.updatedAt || now)));
    });

  readSessionMessages()
    .filter((item) => item.agentKey === "agent" && item.sessionId)
    .forEach((item) => {
      if (!updatedAtMap.has(item.sessionId)) {
        updatedAtMap.set(item.sessionId, now);
      }
    });

  readProjectSessionWorkspaceMap()
    .filter((item) => item.sessionId)
    .forEach((item) => {
      if (!updatedAtMap.has(item.sessionId)) {
        updatedAtMap.set(item.sessionId, now);
      }
    });

  return Array.from(updatedAtMap.entries()).map(([sessionId, updatedAt]) => ({
    id: sessionId,
    agentKey: "agent",
    title: resolveAgentSessionTitle("agent", sessionId),
    updatedAt: new Date(updatedAt).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
}

// 描述：返回指定智能体可见会话列表，仅融合真实动态会话与本地元数据，避免新项目被演示会话污染。
export function getAgentSessions(agentKey: AgentKey): AgentSession[] {
  void agentKey;
  const meta = readSessionMeta();
  const dynamicProjects = readAgentProjects().map<AgentSession>((item) => ({
    id: item.id,
    agentKey: "agent",
    title: item.title,
    updatedAt: item.updatedAt,
  }));
  const dynamic = [
    ...dynamicProjects,
    ...listDynamicAgentSessions().filter(
      (item) => !dynamicProjects.some((projectItem) => projectItem.id === item.id),
    ),
  ];

  const visible = dynamic.filter((item) => !meta.removedIds.includes(item.id));
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

// 描述：返回当前项目目录分组列表，按最近更新时间倒序排列。
//
// Returns:
//
//   - 目录分组数组。
export function listProjectWorkspaceGroups(): ProjectWorkspaceGroup[] {
  const groups = readProjectWorkspaceGroups();
  return [...groups].sort((a, b) => {
    const aTs = new Date(a.updatedAt || 0).getTime();
    const bTs = new Date(b.updatedAt || 0).getTime();
    return bTs - aTs;
  });
}

// 描述：创建或更新项目目录分组，路径相同则复用已有分组并刷新最近使用时间。
//
// Params:
//
//   - path: 目录路径。
//
// Returns:
//
//   - 新建或命中的目录分组。
export function upsertProjectWorkspaceGroup(path: string): ProjectWorkspaceGroup | null {
  const normalizedPath = normalizeWorkspacePath(path);
  if (!normalizedPath) {
    return null;
  }
  const now = new Date().toISOString();
  const groups = readProjectWorkspaceGroups();
  const hit = groups.find((item) => normalizeWorkspacePath(item.path) === normalizedPath);
  if (hit) {
    const next: ProjectWorkspaceGroup = {
      ...hit,
      path: normalizedPath,
      name: hit.name || resolveWorkspaceNameFromPath(normalizedPath),
      enabledCapabilities: normalizeProjectWorkspaceCapabilityIds(hit.enabledCapabilities),
      dependencyRules: normalizeWorkspaceDependencyRules(hit.dependencyRules),
      updatedAt: now,
    };
    writeProjectWorkspaceGroups([
      next,
      ...groups.filter((item) => item.id !== hit.id),
    ]);
    writeLastProjectWorkspaceId(next.id);
    bootstrapProjectWorkspaceProfile(next.id, {
      force: false,
      updatedBy: "workspace_upsert",
      reason: "workspace_upsert",
    });
    emitProjectWorkspaceGroupsUpdated("upsert");
    return next;
  }

  const created: ProjectWorkspaceGroup = {
    id: `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    path: normalizedPath,
    name: resolveWorkspaceNameFromPath(normalizedPath),
    enabledCapabilities: [],
    dependencyRules: [],
    updatedAt: now,
  };
  writeProjectWorkspaceGroups([created, ...groups]);
  writeLastProjectWorkspaceId(created.id);
  bootstrapProjectWorkspaceProfile(created.id, {
    force: false,
    updatedBy: "workspace_create",
    reason: "workspace_create",
  });
  emitProjectWorkspaceGroupsUpdated("upsert");
  return created;
}

// 描述：重命名项目目录分组。
//
// Params:
//
//   - workspaceId: 分组 ID。
//   - name: 新名称。
//
// Returns:
//
//   - 是否重命名成功。
export function renameProjectWorkspaceGroup(workspaceId: string, name: string): boolean {
  const trimmed = name.trim();
  if (!workspaceId || !trimmed) {
    return false;
  }
  const groups = readProjectWorkspaceGroups();
  const hit = groups.find((item) => item.id === workspaceId);
  if (!hit) {
    return false;
  }
  writeProjectWorkspaceGroups(
    groups.map((item) => (item.id === workspaceId
      ? {
        ...item,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      }
      : item)),
  );
  emitProjectWorkspaceGroupsUpdated("rename");
  return true;
}

// 描述：更新项目目录分组设置，统一维护项目名称与依赖限制列表。
//
// Params:
//
//   - workspaceId: 分组 ID。
//   - settings: 项目设置更新内容。
//
// Returns:
//
//   - 是否更新成功。
export function updateProjectWorkspaceGroupSettings(
  workspaceId: string,
  settings: {
    name: string;
    dependencyRules: string[];
    enabledCapabilities?: ProjectWorkspaceCapabilityId[];
  },
): boolean {
  if (!workspaceId) {
    return false;
  }

  const trimmedName = String(settings.name || "").trim();
  if (!trimmedName) {
    return false;
  }

  const groups = readProjectWorkspaceGroups();
  const hit = groups.find((item) => item.id === workspaceId);
  if (!hit) {
    return false;
  }
  const normalizedRules = normalizeWorkspaceDependencyRules(settings.dependencyRules);
  const nextEnabledCapabilities = settings.enabledCapabilities
    ? normalizeProjectWorkspaceCapabilityIds(settings.enabledCapabilities)
    : normalizeProjectWorkspaceCapabilityIds(hit.enabledCapabilities);

  writeProjectWorkspaceGroups(
    groups.map((item) => (item.id === workspaceId
      ? {
        ...item,
        name: trimmedName,
        enabledCapabilities: nextEnabledCapabilities,
        dependencyRules: normalizedRules,
        updatedAt: new Date().toISOString(),
      }
      : item)),
  );
  const currentProfile = getProjectWorkspaceProfile(workspaceId);
  if (currentProfile) {
    const stableConstraints = currentProfile.frontendCodeStructure.implementationConstraints
      .filter((item) => !item.startsWith(translateDesktopText("依赖规范：")));
    saveProjectWorkspaceProfile(
      workspaceId,
      {
        frontendCodeStructure: {
          implementationConstraints: nextEnabledCapabilities.includes("dependency-policy")
            ? [
              ...normalizedRules.map((item) => translateDesktopText("依赖规范：{{item}}", { item })),
              ...stableConstraints,
            ]
            : stableConstraints,
        },
      },
      {
        updatedBy: "workspace_settings",
        reason: "workspace_settings_sync",
      },
    );
  } else if (!currentProfile) {
    bootstrapProjectWorkspaceProfile(workspaceId, {
      force: false,
      updatedBy: "workspace_settings",
      reason: "workspace_settings_sync",
    });
  }
  emitProjectWorkspaceGroupsUpdated("settings");
  return true;
}

// 描述：删除项目目录分组，并清理关联会话映射与最近使用目录引用。
//
// Params:
//
//   - workspaceId: 分组 ID。
export function removeProjectWorkspaceGroup(workspaceId: string) {
  if (!workspaceId) {
    return;
  }
  const groups = readProjectWorkspaceGroups();
  const mapItems = readProjectSessionWorkspaceMap();
  const sessionIds = mapItems
    .filter((item) => item.workspaceId === workspaceId)
    .map((item) => item.sessionId);

  // 描述：删除项目时同步移除该项目下所有会话，避免会话在后续刷新时被自动重新绑定到新项目。
  sessionIds.forEach((sessionId) => {
    removeAgentSession("agent", sessionId);
  });

  writeProjectWorkspaceGroups(groups.filter((item) => item.id !== workspaceId));
  const profiles = readProjectWorkspaceProfileMap();
  if (profiles[workspaceId]) {
    delete profiles[workspaceId];
    writeProjectWorkspaceProfileMap(profiles);
  }
  const latestMapItems = readProjectSessionWorkspaceMap();
  writeProjectSessionWorkspaceMap(latestMapItems.filter((item) => item.workspaceId !== workspaceId));
  if (readLastProjectWorkspaceId() === workspaceId) {
    const next = listProjectWorkspaceGroups()[0];
    writeLastProjectWorkspaceId(next?.id || "");
  }
  emitProjectWorkspaceProfileUpdated(workspaceId, "workspace_remove", 0);
  emitProjectWorkspaceGroupsUpdated("remove");
}

// 描述：记录会话所属目录分组，并刷新该目录分组的最近使用时间。
//
// Params:
//
//   - sessionId: 会话 ID。
//   - workspaceId: 目录分组 ID。
export function bindProjectSessionWorkspace(sessionId: string, workspaceId: string) {
  if (!sessionId || !workspaceId) {
    return;
  }
  const mapItems = readProjectSessionWorkspaceMap();
  const nextItems: StoredProjectSessionWorkspace[] = [
    { sessionId, workspaceId },
    ...mapItems.filter((item) => item.sessionId !== sessionId),
  ];
  writeProjectSessionWorkspaceMap(nextItems);

  const groups = readProjectWorkspaceGroups();
  const hit = groups.find((item) => item.id === workspaceId);
  if (hit) {
    writeProjectWorkspaceGroups([
      {
        ...hit,
        enabledCapabilities: normalizeProjectWorkspaceCapabilityIds(hit.enabledCapabilities),
        dependencyRules: normalizeWorkspaceDependencyRules(hit.dependencyRules),
        updatedAt: new Date().toISOString(),
      },
      ...groups.filter((item) => item.id !== workspaceId),
    ]);
  }
  writeLastProjectWorkspaceId(workspaceId);
  emitProjectWorkspaceGroupsUpdated("bind-session");
}

// 描述：读取会话绑定的目录分组 ID。
//
// Params:
//
//   - sessionId: 会话 ID。
//
// Returns:
//
//   - 目录分组 ID；未命中返回空字符串。
export function getProjectWorkspaceIdBySessionId(sessionId: string): string {
  if (!sessionId) {
    return "";
  }
  const hit = readProjectSessionWorkspaceMap().find((item) => item.sessionId === sessionId);
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
export function getProjectWorkspaceGroupById(workspaceId: string): ProjectWorkspaceGroup | null {
  if (!workspaceId) {
    return null;
  }
  return readProjectWorkspaceGroups().find((item) => item.id === workspaceId) || null;
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
export function getProjectWorkspaceProfile(workspaceId: string): ProjectWorkspaceProfile | null {
  if (!workspaceId) {
    return null;
  }
  const workspace = getProjectWorkspaceGroupById(workspaceId);
  if (!workspace) {
    return null;
  }
  const profiles = readProjectWorkspaceProfileMap();
  const hit = profiles[workspaceId];
  if (!hit) {
    return null;
  }
  return normalizeProjectWorkspaceProfile(hit, workspace);
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
export function saveProjectWorkspaceProfile(
  workspaceId: string,
  input: ProjectWorkspaceProfileInput,
  options?: {
    expectedRevision?: number;
    updatedBy?: string;
    reason?: string;
  },
): ProjectWorkspaceProfileSaveResult {
  const workspace = getProjectWorkspaceGroupById(workspaceId);
  if (!workspace) {
    return {
      ok: false,
      conflict: false,
      profile: null,
      message: translateDesktopText("项目不存在，无法保存结构化信息。"),
    };
  }

  const profiles = readProjectWorkspaceProfileMap();
  const hasCurrent = Boolean(profiles[workspaceId]);
  const current = profiles[workspaceId] || buildDefaultProjectWorkspaceProfile(workspace);
  const expectedRevision = options?.expectedRevision;
  if (Number.isFinite(expectedRevision) && typeof expectedRevision === "number") {
    if (current.revision !== expectedRevision) {
      return {
        ok: false,
        conflict: true,
        profile: current,
        message: translateDesktopText("结构化信息已被其他会话更新，请刷新后重试。"),
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
  const next: ProjectWorkspaceProfile = {
    ...current,
    workspaceId,
    schemaVersion: PROJECT_WORKSPACE_PROFILE_SCHEMA_VERSION,
    workspacePathHash: buildWorkspacePathHash(workspace.path),
    workspaceSignature: buildWorkspaceProfileSignature(workspace, PROJECT_WORKSPACE_PROFILE_SCHEMA_VERSION),
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

  profiles[workspaceId] = normalizeProjectWorkspaceProfile(next, workspace);
  writeProjectWorkspaceProfileMap(profiles);
  emitProjectWorkspaceProfileUpdated(
    workspaceId,
    String(options?.reason || "").trim() || "manual_update",
    profiles[workspaceId].revision,
  );
  return {
    ok: true,
    conflict: false,
    profile: profiles[workspaceId],
    message: translateDesktopText("结构化信息已保存。"),
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
export function bootstrapProjectWorkspaceProfile(
  workspaceId: string,
  options?: {
    force?: boolean;
    updatedBy?: string;
    reason?: string;
  },
): ProjectWorkspaceProfile | null {
  const workspace = getProjectWorkspaceGroupById(workspaceId);
  if (!workspace) {
    return null;
  }
  const profiles = readProjectWorkspaceProfileMap();
  const current = profiles[workspaceId];
  if (current && !options?.force) {
    return current;
  }

  const bootstrap = buildDefaultProjectWorkspaceProfile(
    workspace,
    String(options?.updatedBy || "").trim() || "system_bootstrap",
  );
  const next: ProjectWorkspaceProfile = {
    ...bootstrap,
    revision: current?.revision ? current.revision + 1 : bootstrap.revision,
  };
  profiles[workspaceId] = normalizeProjectWorkspaceProfile(next, workspace);
  writeProjectWorkspaceProfileMap(profiles);
  emitProjectWorkspaceProfileUpdated(
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
export function upsertProjectWorkspaceProfile(
  workspaceId: string,
  input: ProjectWorkspaceProfileInput,
  options?: {
    expectedRevision?: number;
    updatedBy?: string;
    reason?: string;
  },
): ProjectWorkspaceProfileSaveResult {
  return saveProjectWorkspaceProfile(workspaceId, input, options);
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
export function patchProjectWorkspaceProfile(
  workspaceId: string,
  patch: ProjectWorkspaceProfileInput,
  options?: {
    expectedRevision?: number;
    updatedBy?: string;
    reason?: string;
  },
): ProjectWorkspaceProfileSaveResult {
  return saveProjectWorkspaceProfile(workspaceId, patch, options);
}

// 描述：读取最近一次编辑会话使用的项目目录分组 ID。
//
// Returns:
//
//   - 最近目录分组 ID；若不存在则回退首个目录分组。
export function getLastUsedProjectWorkspaceId(): string {
  const lastId = readLastProjectWorkspaceId();
  if (lastId && readProjectWorkspaceGroups().some((item) => item.id === lastId)) {
    return lastId;
  }
  return listProjectWorkspaceGroups()[0]?.id || "";
}

// 描述：显式设置最近使用项目目录分组。
//
// Params:
//
//   - workspaceId: 目录分组 ID。
export function setLastUsedProjectWorkspaceId(workspaceId: string) {
  if (!workspaceId) {
    return;
  }
  writeLastProjectWorkspaceId(workspaceId);
}
