import type { AgentSession, AgentSummary, ShortcutItem } from "./types";

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

export const AGENT_SESSIONS: AgentSession[] = [
  { id: "code-001", agentKey: "code", title: "React + aries_react 脚手架", updatedAt: "今天 09:40" },
  { id: "code-002", agentKey: "code", title: "权限后台页面重构", updatedAt: "昨天 21:15" },
  { id: "model-001", agentKey: "model", title: "机械臂材质方案", updatedAt: "今天 10:12" },
  { id: "model-002", agentKey: "model", title: "低模角色风格探索", updatedAt: "昨天 18:22" }
];

const MODEL_PROJECT_STORAGE_KEY = "zodileap.desktop.model.projects";
const SESSION_META_STORAGE_KEY = "zodileap.desktop.session.meta";
const SESSION_MESSAGES_STORAGE_KEY = "zodileap.desktop.session.messages";

interface StoredModelProject {
  id: string;
  title: string;
  prompt: string;
  updatedAt: string;
}

interface SessionMeta {
  renamedTitles: Record<string, string>;
  pinnedIds: string[];
  removedIds: string[];
}

interface StoredSessionMessage {
  role: "user" | "assistant";
  text: string;
}

interface StoredSessionMessageGroup {
  sessionId: string;
  agentKey: "code" | "model";
  messages: StoredSessionMessage[];
}

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

function writeModelProjects(list: StoredModelProject[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(MODEL_PROJECT_STORAGE_KEY, JSON.stringify(list));
}

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

function writeSessionMeta(meta: SessionMeta) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_META_STORAGE_KEY, JSON.stringify(meta));
}

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

function writeSessionMessages(groups: StoredSessionMessageGroup[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_MESSAGES_STORAGE_KEY, JSON.stringify(groups));
}

export function getModelProjectById(id: string): StoredModelProject | null {
  return readModelProjects().find((item) => item.id === id) || null;
}

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

export function renameAgentSession(sessionId: string, title: string) {
  const trimmed = title.trim();
  const meta = readSessionMeta();
  if (!trimmed) {
    delete meta.renamedTitles[sessionId];
  } else {
    meta.renamedTitles[sessionId] = trimmed;
  }
  writeSessionMeta(meta);
}

export function togglePinnedAgentSession(sessionId: string): boolean {
  const meta = readSessionMeta();
  const exists = meta.pinnedIds.includes(sessionId);
  meta.pinnedIds = exists
    ? meta.pinnedIds.filter((id) => id !== sessionId)
    : [sessionId, ...meta.pinnedIds];
  writeSessionMeta(meta);
  return !exists;
}

export function isAgentSessionPinned(sessionId: string): boolean {
  return readSessionMeta().pinnedIds.includes(sessionId);
}

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
}

export function getSessionMessages(
  agentKey: "code" | "model",
  sessionId: string,
): Array<{ role: "user" | "assistant"; text: string }> {
  const group = readSessionMessages().find(
    (item) => item.agentKey === agentKey && item.sessionId === sessionId,
  );
  return group?.messages || [];
}

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
