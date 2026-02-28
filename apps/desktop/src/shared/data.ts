import type { AgentSession, AgentSummary, ShortcutItem } from "./types";

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
const MODEL_PROJECT_STORAGE_KEY = "zodileap.desktop.model.projects";

// 描述:
//
//   - 会话元数据本地存储键（重命名/固定/删除状态）。
const SESSION_META_STORAGE_KEY = "zodileap.desktop.session.meta";

// 描述:
//
//   - 会话消息本地存储键。
const SESSION_MESSAGES_STORAGE_KEY = "zodileap.desktop.session.messages";

// 描述:
//
//   - 代码目录分组本地存储键。
const CODE_WORKSPACE_GROUP_STORAGE_KEY = "zodileap.desktop.code.workspace.groups";

// 描述:
//
//   - 代码会话与目录映射本地存储键。
const CODE_SESSION_WORKSPACE_MAP_STORAGE_KEY = "zodileap.desktop.code.session.workspace.map";

// 描述:
//
//   - 最近使用代码目录 ID 本地存储键。
const CODE_LAST_WORKSPACE_ID_STORAGE_KEY = "zodileap.desktop.code.workspace.last";

// 描述:
//
//   - 会话标题更新广播事件名。
export const SESSION_TITLE_UPDATED_EVENT = "zodileap:session-title-updated";

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
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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

// 描述:
//
//   - 读取会话消息分组列表。
//
// Returns:
//
//   - 会话消息分组数组。
function readSessionMessages(): StoredSessionMessageGroup[] {
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_MESSAGES_STORAGE_KEY, JSON.stringify(groups));
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

// 描述：读取代码目录分组列表。
//
// Returns:
//
//   - 代码目录分组数组。
function readCodeWorkspaceGroups(): CodeWorkspaceGroup[] {
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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
): Array<{ role: "user" | "assistant"; text: string }> {
  const group = readSessionMessages().find(
    (item) => item.agentKey === agentKey && item.sessionId === sessionId,
  );
  return group?.messages || [];
}

// 描述：写入会话消息并按会话维度覆盖，限制总存储分组数量。
export function upsertSessionMessages(input: {
  agentKey: "code" | "model";
  sessionId: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
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
  writeCodeWorkspaceGroups(groups.filter((item) => item.id !== workspaceId));
  const mapItems = readCodeSessionWorkspaceMap();
  writeCodeSessionWorkspaceMap(mapItems.filter((item) => item.workspaceId !== workspaceId));
  if (readLastCodeWorkspaceId() === workspaceId) {
    const next = listCodeWorkspaceGroups()[0];
    writeLastCodeWorkspaceId(next?.id || "");
  }
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
