import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AriButton,
  AriContainer,
  AriContextMenu,
  AriFlex,
  AriIcon,
  AriInput,
  AriMessage,
  AriMenu,
  AriModal,
  AriTooltip,
  AriTypography,
} from "@aries-kit/react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  bindProjectSessionWorkspace,
  PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT,
  getProjectWorkspaceIdBySessionId,
  getLastUsedProjectWorkspaceId,
  getAgentSessionMetaSnapshot,
  getSessionMessages,
  getSessionRunState,
  isSessionRunning,
  listProjectWorkspaceGroups,
  removeAgentSession,
  removeProjectWorkspaceGroup,
  renameAgentSession,
  resolveAgentSessionTitle,
  SESSION_RUN_STATE_UPDATED_EVENT,
  upsertSessionMessages,
  upsertSessionRunState,
  setLastUsedProjectWorkspaceId,
  togglePinnedAgentSession,
  type ProjectWorkspaceGroup,
  type SessionRunMeta,
} from "@/shell/data";
import {
  createRuntimeSession,
  listRuntimeSessions,
  updateRuntimeSessionStatus,
} from "@/shell/services/backend-api";
import type {
  AgentKey,
  AgentSession,
  AuthAvailableAgentItem,
  ConsoleIdentityItem,
  DesktopUpdateState,
  LoginUser,
} from "@/shell/types";
import type { AgentTextStreamEvent } from "../shared/types";
import { EVENT_AGENT_TEXT_STREAM, IS_BROWSER, isCancelErrorCode, STREAM_KINDS } from "../shared/constants";
import {
  createAgentWorkflow,
  deleteAgentWorkflow,
  listAgentWorkflowOverview,
} from "@/widgets/workflow";
import {
  MCP_PAGE_PATH,
  resolveHomeSidebarAgentItems,
  resolveWorkflowEditorPath,
  resolveSettingsSidebarItems,
  SKILL_PAGE_PATH,
  WORKFLOW_EDITOR_PAGE_PATH,
  WORKFLOW_PAGE_PATH,
} from "../modules/common/routes";
import {
  AGENT_HOME_PATH,
  AGENT_SETTINGS_PATH,
  PROJECT_SETTINGS_PATH,
  resolveAgentSessionPath,
} from "../modules/agent/routes";
import type { RouteAccess } from "../router/types";
import {
  compareDesktopText,
  formatDesktopDateTime,
  translateDesktopText,
  useDesktopI18n,
} from "../shared/i18n";
import { SidebarBackHeader } from "./widgets/sidebar-back-header";
import { UserHoverMenu } from "./widgets/user-hover-menu";

// 描述:
//
//   - 定义客户端侧边栏根组件入参。
interface ClientSidebarProps {
  user: LoginUser;
  selectedIdentity: ConsoleIdentityItem | null;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
  routeAccess: RouteAccess;
  desktopUpdateState: DesktopUpdateState;
  onCheckDesktopUpdate: () => Promise<void>;
  onInstallDesktopUpdate: () => Promise<void>;
}

// 描述:
//
//   - 定义侧边栏会话项结构，扩展固定状态字段。
interface AgentSidebarSession extends AgentSession {
  pinned: boolean;
  running: boolean;
}

// 描述:
//
//   - 定义项目目录与会话分组结构。
interface WorkspaceSessionGroup {
  workspace: ProjectWorkspaceGroup;
  sessions: AgentSidebarSession[];
}

// 描述:
//
//   - 定义工具调用事件 data 字段的最小结构，用于安全提取工具名和参数摘要。
interface AgentToolCallEventData {
  name?: string;
  ok?: boolean;
  result?: string;
  args?: {
    command?: string;
    path?: string;
  };
}

// 描述：
//
//   - 定义人工授权事件 data 字段的最小结构，用于跨页面恢复后继续授权。
interface AgentRequireApprovalEventData {
  tool_name?: string;
}

const APPROVAL_TOOL_ARGS_PREVIEW_MAX_CHARS = 2000;

// AgentTextStreamEvent 已提取至 shared/types.ts 统一定义。

// 描述:
//
//   - 从文本流事件中提取工具调用 data 结构，避免直接使用 any 访问字段。
function resolveToolCallEventData(payload: AgentTextStreamEvent): AgentToolCallEventData {
  if (!payload.data || typeof payload.data !== "object") {
    return {};
  }
  const data = payload.data as Record<string, unknown>;
  const rawArgs = data.args;
  const args = rawArgs && typeof rawArgs === "object"
    ? (rawArgs as Record<string, unknown>)
    : undefined;
  return {
    name: typeof data.name === "string" ? data.name : undefined,
    ok: typeof data.ok === "boolean" ? data.ok : undefined,
    result: typeof data.result === "string" ? data.result : undefined,
    args: {
      command: typeof args?.command === "string" ? args.command : undefined,
      path: typeof args?.path === "string" ? args.path : undefined,
    },
  };
}

// 描述：
//
//   - 解析文本流中的人工授权 data 结构，提取工具名用于展示。
function resolveApprovalEventData(payload: AgentTextStreamEvent): AgentRequireApprovalEventData {
  if (!payload.data || typeof payload.data !== "object") {
    return {};
  }
  const data = payload.data as Record<string, unknown>;
  return {
    tool_name: typeof data.tool_name === "string" ? data.tool_name : undefined,
  };
}

// 描述：
//
//   - 裁剪长文本，避免侧边栏运行态持久化超大字符串导致主线程阻塞。
function truncateRunText(value: string, maxChars: number): string {
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
//   - 判断运行中文案是否属于泛化占位；后台恢复时若已拿到更具体的进度文本，应避免再次回退到这类占位。
//
// Params:
//
//   - value: 待判断的运行中文案。
//
// Returns:
//
//   - true: 属于泛化占位。
function isGenericSidebarProgressText(value: string): boolean {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return true;
  }
  return normalized === translateDesktopText("正在思考…")
    || normalized === translateDesktopText("正在准备执行...")
    || normalized === translateDesktopText("正在生成执行结果…")
    || normalized === translateDesktopText("正在整理输出...")
    || normalized === translateDesktopText("智能体正在思考…");
}

// 描述：
//
//   - 在侧边栏后台监听中，为指定助手消息覆盖/新增最新文本，保证切到其他页面后返回仍能恢复离开前的真实进度文案。
//
// Params:
//
//   - messages: 当前会话的已持久化消息列表。
//   - messageId: 助手消息 ID。
//   - text: 最新助手文案。
//
// Returns:
//
//   - 更新后的消息列表。
function upsertSidebarAssistantMessageById(
  messages: Array<{ id?: string; role: "user" | "assistant"; text: string }>,
  messageId: string,
  text: string,
): Array<{ id?: string; role: "user" | "assistant"; text: string }> {
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedMessageId) {
    return messages;
  }
  const normalizedText = String(text || "");
  let matched = false;
  const nextMessages = messages.map((item) => {
    if (String(item.id || "").trim() !== normalizedMessageId) {
      return item;
    }
    matched = true;
    return {
      ...item,
      role: "assistant" as const,
      text: normalizedText,
    };
  });
  if (matched) {
    return nextMessages;
  }
  return [...nextMessages, { id: normalizedMessageId, role: "assistant", text: normalizedText }];
}

// 描述：
//
//   - 根据后台收到的文本流事件推导“当前助手消息文本”；该文本会在离开会话页期间落盘，保证重新进入时与停留在会话页的视觉结果一致。
//
// Params:
//
//   - payload: 当前文本流事件。
//   - currentText: 当前已持久化的助手消息文本。
//   - currentSummary: 当前运行态 summary。
//
// Returns:
//
//   - 应持久化的助手消息文本。
function resolveSidebarAssistantMessageText(
  payload: AgentTextStreamEvent,
  currentText: string,
  currentSummary: string,
  heartbeatCount: number,
): string {
  const text = String(payload.message || "").trim();
  const currentMessageText = String(currentText || "").trim();
  const summaryText = String(currentSummary || "").trim();
  if (payload.kind === STREAM_KINDS.STARTED) {
    return translateDesktopText("正在准备执行...");
  }
  if (payload.kind === STREAM_KINDS.LLM_STARTED) {
    return translateDesktopText("正在生成执行结果…");
  }
  if (payload.kind === STREAM_KINDS.LLM_FINISHED) {
    return text || translateDesktopText("正在整理输出...");
  }
  if (payload.kind === STREAM_KINDS.DELTA) {
    const delta = String(payload.delta || "");
    if (!delta) {
      return currentMessageText || summaryText;
    }
    const baseText = isGenericSidebarProgressText(currentMessageText) ? "" : currentMessageText;
    return `${baseText}${delta}`;
  }
  if (payload.kind === STREAM_KINDS.FINAL) {
    return text || currentMessageText || summaryText || translateDesktopText("执行完成");
  }
  if (payload.kind === STREAM_KINDS.CANCELLED) {
    return text || currentMessageText || summaryText || translateDesktopText("任务已取消");
  }
  if (payload.kind === STREAM_KINDS.ERROR) {
    const errorCode = resolveStreamErrorCode(payload);
    if (isCancelErrorCode(errorCode)) {
      return text
        ? translateDesktopText("任务已取消：{{message}}", { message: text })
        : (currentMessageText || summaryText || translateDesktopText("任务已取消"));
    }
    if (text) {
      return text.startsWith(translateDesktopText("执行失败："))
        ? text
        : translateDesktopText("执行失败：{{message}}", { message: text });
    }
    return currentMessageText || summaryText || translateDesktopText("执行失败：未知错误");
  }
  if (payload.kind === STREAM_KINDS.PLANNING && text.startsWith("__libra_planning__:")) {
    try {
      const meta = JSON.parse(text.slice("__libra_planning__:".length).trim()) as Record<string, unknown>;
      if (meta && typeof meta.text === "string" && String(meta.text || "").trim()) {
        return truncateRunText(String(meta.text || "").trim(), 300);
      }
    } catch (_error) {
      // 描述：后台同步恢复时忽略规划元数据解析失败，继续走兜底文案。
    }
    return currentMessageText || summaryText || translateDesktopText("正在思考…");
  }
  if (payload.kind === STREAM_KINDS.HEARTBEAT) {
    if (text.includes(translateDesktopText("已等待约")) || heartbeatCount <= 1) {
      return text || currentMessageText || summaryText || translateDesktopText("正在思考…");
    }
    const waitedSeconds = Math.max(1, Math.round(heartbeatCount * 1.2));
    const baseText = text || currentMessageText || summaryText || translateDesktopText("正在思考…");
    return translateDesktopText("{{message}}（已等待约 {{seconds}} 秒）", {
      message: baseText,
      seconds: waitedSeconds,
    });
  }
  return text || currentMessageText || summaryText || translateDesktopText("正在思考…");
}

// 描述：
//
//   - 构建授权运行片段 data，只保留跨页恢复所需关键字段并裁剪超长参数。
function buildApprovalSegmentData(payload: AgentTextStreamEvent): Record<string, unknown> {
  const rawData = payload.data && typeof payload.data === "object"
    ? (payload.data as Record<string, unknown>)
    : {};
  const data: Record<string, unknown> = {
    __segment_kind: payload.kind,
  };
  if (typeof rawData.approval_id === "string") {
    data.approval_id = truncateRunText(rawData.approval_id, 120);
  }
  if (typeof rawData.tool_name === "string") {
    data.tool_name = truncateRunText(rawData.tool_name, 120);
  }
  if (typeof rawData.tool_args === "string") {
    data.tool_args = truncateRunText(rawData.tool_args, APPROVAL_TOOL_ARGS_PREVIEW_MAX_CHARS);
  }
  return data;
}

// 描述:
//
//   - 读取文本流 error 事件携带的错误码，用于识别“取消语义”错误并映射为终态。
function resolveStreamErrorCode(payload: AgentTextStreamEvent): string {
  if (!payload.data || typeof payload.data !== "object") {
    return "";
  }
  const data = payload.data as Record<string, unknown>;
  return typeof data.code === "string" ? data.code : "";
}

// 描述:
//
//   - 根据路由路径解析智能体标识。
//
// Params:
//
//   - pathname: 当前路径。
//
// Returns:
//
//   - 智能体标识；未命中返回 null。
function matchAgentKey(pathname: string): AgentKey | null {
  if (pathname.startsWith(AGENT_HOME_PATH)) return "agent";
  if (pathname.startsWith("/session/")) return "agent";
  if (pathname.startsWith(PROJECT_SETTINGS_PATH)) return "agent";
  return null;
}

// 描述:
//
//   - 根据路径解析侧边栏模式。
//
// Params:
//
//   - pathname: 当前路径。
//
// Returns:
//
//   - 侧边栏模式标识。
function matchSidebarMode(pathname: string): "home" | "agent" | "settings" | "workflow" {
  if (pathname.startsWith("/session/")) return "agent";
  if (pathname.startsWith(PROJECT_SETTINGS_PATH)) return "agent";
  if (pathname.startsWith(AGENT_HOME_PATH)) return "agent";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith(WORKFLOW_EDITOR_PAGE_PATH)) return "workflow";
  return "home";
}

// 描述:
//
//   - 判断统一智能体侧边栏是否需要显示返回 Home 头部；当前仅项目设置页属于真正的子页，会话页和 Home 不显示返回。
//
// Params:
//
//   - pathname: 当前路由路径。
//
// Returns:
//
//   - true: 显示返回头部。
//   - false: 隐藏返回头部。
function shouldShowAgentSidebarBackHeader(pathname: string): boolean {
  return pathname.startsWith(PROJECT_SETTINGS_PATH);
}

// 描述：将 runtime 会话实体转换为前端侧边栏会话项。
function toAgentSession(agentKey: AgentKey, entity: { id: string; last_at?: string }): AgentSession {
  const updatedAtText = toSessionUpdatedAtText(entity.last_at);
  return {
    id: entity.id,
    agentKey,
    title: translateDesktopText("会话详情"),
    updatedAt: updatedAtText,
  };
}

// 描述：将会话时间格式化为侧边栏可读文本。
function toSessionUpdatedAtText(lastAt?: string): string {
  if (!lastAt) {
    return "-";
  }
  return formatDesktopDateTime(lastAt, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}


// 描述:
//
//   - 渲染首页侧边栏，展示可访问智能体入口与用户菜单。
function HomeSidebar({
  user,
  selectedIdentity,
  onLogout,
  availableAgents,
  routeAccess,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onInstallDesktopUpdate,
}: {
  user: LoginUser;
  selectedIdentity: ConsoleIdentityItem | null;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
  routeAccess: RouteAccess;
  desktopUpdateState: DesktopUpdateState;
  onCheckDesktopUpdate: () => Promise<void>;
  onInstallDesktopUpdate: () => Promise<void>;
}) {
  const { t } = useDesktopI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = location.pathname.startsWith(AGENT_HOME_PATH) ? "agent" : "";
  const homeSidebarItems = useMemo(
    () => resolveHomeSidebarAgentItems(availableAgents, routeAccess),
    [availableAgents, routeAccess],
  );
  // 描述：解析首页顶部工具栏入口（工作流、技能）。
  const homeToolbarEntries = useMemo(() => {
    return [
      {
        key: "workflow",
        label: t("工作流"),
        icon: "account_tree",
        enabled: routeAccess.isModuleEnabled("workflow"),
        path: WORKFLOW_PAGE_PATH,
        deniedMessage: t("当前构建未启用工作流模块。"),
      },
      {
        key: "skills",
        label: t("技能"),
        icon: "new_releases",
        enabled: routeAccess.isModuleEnabled("skill"),
        path: SKILL_PAGE_PATH,
        deniedMessage: t("当前构建未启用技能模块。"),
      },
      {
        key: "mcp",
        label: "MCP",
        icon: "hub",
        enabled: routeAccess.isModuleEnabled("mcp"),
        path: MCP_PAGE_PATH,
        deniedMessage: t("当前构建未启用 MCP 模块。"),
      },
    ];
  }, [routeAccess, t]);

  // 描述：根据当前路径同步首页工具栏选中态。
  const selectedToolbarKey = useMemo(() => {
    if (location.pathname.startsWith(SKILL_PAGE_PATH)) {
      return "skills";
    }
    if (location.pathname.startsWith(MCP_PAGE_PATH)) {
      return "mcp";
    }
    if (location.pathname.startsWith(WORKFLOW_PAGE_PATH) || location.pathname.includes("/workflows")) {
      return "workflow";
    }
    return "";
  }, [location.pathname]);

  return (
    <AriContainer className="desk-sidebar">
      <AriContainer className="desk-sidebar-toolbar" padding={0}>
        <AriMenu
          className="desk-sidebar-nav"
          items={homeToolbarEntries.map((item) => ({
            key: item.key,
            label: item.label,
            icon: item.icon,
          }))}
          selectedKey={selectedToolbarKey}
          onSelect={(key: string) => {
            const target = homeToolbarEntries.find((item) => item.key === key);
            if (!target) {
              return;
            }
            if (!target.enabled || !target.path) {
              AriMessage.warning({
                content: target.deniedMessage || t("当前入口不可用。"),
                duration: 2500,
              });
              return;
            }
            navigate(target.path);
          }}
        />
      </AriContainer>
      <AriContainer className="desk-agent-menu" padding={0}>
        <AriMenu
          className="desk-sidebar-nav"
          items={homeSidebarItems.map((item) => ({
            key: item.key,
            label: item.label,
          }))}
          selectedKey={selectedKey}
          onSelect={(key: string) => {
            const target = homeSidebarItems.find((item) => item.key === key);
            if (!target) {
              return;
            }
            if (!target.enabled) {
              AriMessage.warning({
                content: target.deniedMessage || t("当前入口不可用。"),
                duration: 2500,
              });
              return;
            }
            navigate(target.path);
          }}
        />
      </AriContainer>

      <AriContainer className="desk-sidebar-spacer" />
      <UserHoverMenu
        user={user}
        selectedIdentityLabel={selectedIdentity?.scopeName || ""}
        onLogout={onLogout}
        routeAccess={routeAccess}
        desktopUpdateState={desktopUpdateState}
        onCheckDesktopUpdate={onCheckDesktopUpdate}
        onInstallDesktopUpdate={onInstallDesktopUpdate}
      />
    </AriContainer>
  );
}

// 描述:
//
//   - 渲染智能体侧边栏，统一承载会话列表、目录树与右键菜单操作。
function AgentSidebar({
  user,
  selectedIdentity,
  onLogout,
  agentKey,
  showBackHeader = true,
  routeAccess,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onInstallDesktopUpdate,
}: {
  user: LoginUser;
  selectedIdentity: ConsoleIdentityItem | null;
  onLogout: () => Promise<void>;
  agentKey: AgentKey;
  showBackHeader?: boolean;
  routeAccess: RouteAccess;
  desktopUpdateState: DesktopUpdateState;
  onCheckDesktopUpdate: () => Promise<void>;
  onInstallDesktopUpdate: () => Promise<void>;
}) {
  const { compareText, t } = useDesktopI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<AgentSidebarSession[]>([]);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState("");
  const [deletingSessionId, setDeletingSessionId] = useState("");
  const [contextSessionId, setContextSessionId] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [sessionSortMode, setSessionSortMode] = useState<"default" | "name">("default");
  const [hoveredPinSessionId, setHoveredPinSessionId] = useState("");
  const [hoveredDeleteSessionId, setHoveredDeleteSessionId] = useState("");
  const [hoveredContextMenuActionKey, setHoveredContextMenuActionKey] = useState("");
  const [workspaceGroups, setWorkspaceGroups] = useState<ProjectWorkspaceGroup[]>([]);
  const [projectWorkspaceExpandedKeys, setProjectWorkspaceExpandedKeys] = useState<string[]>([]);
  const [openWorkspaceActionMenuId, setOpenWorkspaceActionMenuId] = useState("");
  const [creatingWorkspaceSessionId, setCreatingWorkspaceSessionId] = useState("");
  const [sessionMenuRenderVersion, setSessionMenuRenderVersion] = useState(0);
  const missingSessionSyncAttemptsRef = useRef<Record<string, number>>({});
  const suppressNextSessionSelectIdRef = useRef("");

  const isProjectAgent = agentKey === "agent";
  const selectedSessionKey = location.pathname.includes("/session/")
    ? location.pathname.split("/").pop() || ""
    : "";
  const activePathnameRef = useRef(location.pathname);
  const activeSelectedSessionKeyRef = useRef(selectedSessionKey);
  const selectedWorkspaceFromQuery = useMemo(() => {
    if (!isProjectAgent) {
      return "";
    }
    return new URLSearchParams(location.search).get("workspaceId")?.trim() || "";
  }, [isProjectAgent, location.search]);
  const isProjectSettingsPath = isProjectAgent && location.pathname.startsWith(PROJECT_SETTINGS_PATH);
  const projectToolbarEntries = useMemo(
    () => [
      {
        key: "workflow",
        label: t("工作流"),
        icon: "account_tree",
        enabled: routeAccess.isModuleEnabled("workflow"),
        path: WORKFLOW_PAGE_PATH,
        deniedMessage: t("当前构建未启用工作流模块。"),
      },
      {
        key: "skills",
        label: t("技能"),
        icon: "new_releases",
        enabled: routeAccess.isModuleEnabled("skill"),
        path: SKILL_PAGE_PATH,
        deniedMessage: t("当前构建未启用技能模块。"),
      },
      {
        key: "mcp",
        label: "MCP",
        icon: "hub",
        enabled: routeAccess.isModuleEnabled("mcp"),
        path: MCP_PAGE_PATH,
        deniedMessage: t("当前构建未启用 MCP 模块。"),
      },
      {
        key: "create-project",
        label: t("新项目"),
        icon: "note_stack_add",
        enabled: true,
      },
    ],
    [routeAccess, t],
  );
  const selectedToolbarKey = useMemo(() => {
    if (location.pathname.startsWith(SKILL_PAGE_PATH)) {
      return "skills";
    }
    if (location.pathname.startsWith(MCP_PAGE_PATH)) {
      return "mcp";
    }
    if (location.pathname.startsWith(WORKFLOW_PAGE_PATH)) {
      return "workflow";
    }
    return "";
  }, [location.pathname]);

  // 描述：构建项目目录父菜单 key，避免与会话 key 冲突。
  const buildWorkspaceMenuKey = (workspaceId: string) => `workspace:${workspaceId}`;

  // 描述：从项目目录父菜单 key 中提取目录 ID。
  const parseWorkspaceIdFromMenuKey = (key: string) => {
    if (!key.startsWith("workspace:")) {
      return "";
    }
    return key.slice("workspace:".length).trim();
  };

  // 描述：刷新项目目录分组缓存，并同步默认展开状态。
  const refreshWorkspaceGroups = () => {
    if (!isProjectAgent) {
      setWorkspaceGroups([]);
      return;
    }
    setWorkspaceGroups(listProjectWorkspaceGroups());
  };

  // 描述：拉取当前智能体的会话列表。
  const refreshSessions = async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    try {
      const list = await listRuntimeSessions(user.id, agentKey, 1);
      const meta = getAgentSessionMetaSnapshot();
      const visibleList = (list || []).filter(
        (item) => (item.status ?? 1) !== 0 && !item.deleted_at && !meta.removedIds.includes(item.id),
      );
      const pinnedIndexMap = new Map(meta.pinnedIds.map((id, index) => [id, index]));
      const mapped = visibleList.map((item, index) => {
        const session = toAgentSession(agentKey, item);
        return {
          ...session,
          title: resolveAgentSessionTitle(agentKey, item.id),
          pinned: pinnedIndexMap.has(item.id),
          running: isSessionRunning(agentKey, item.id),
          _originIndex: index,
          _pinnedIndex: pinnedIndexMap.get(item.id) ?? Number.MAX_SAFE_INTEGER,
        };
      });

      mapped.sort((a, b) => {
        if (a.pinned && b.pinned) {
          return a._pinnedIndex - b._pinnedIndex;
        }
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1;
        }
        return a._originIndex - b._originIndex;
      });

      const normalizedSessions = mapped.map(({ _originIndex, _pinnedIndex, ...session }) => session);
      setSessions(normalizedSessions);

      if (isProjectAgent) {
        let latestGroups = listProjectWorkspaceGroups();
        const fallbackWorkspaceId = getLastUsedProjectWorkspaceId() || latestGroups[0]?.id || "";
        if (fallbackWorkspaceId) {
          let rebound = false;
          normalizedSessions.forEach((item) => {
            const workspaceId = getProjectWorkspaceIdBySessionId(item.id);
            if (!workspaceId) {
              bindProjectSessionWorkspace(item.id, fallbackWorkspaceId);
              rebound = true;
            }
          });
          if (rebound) {
            latestGroups = listProjectWorkspaceGroups();
          }
        }
        setWorkspaceGroups(latestGroups);
      }
    } catch (_err) {
      setSessions([]);
      if (isProjectAgent) {
        refreshWorkspaceGroups();
      }
    } finally {
      setLoading(false);
    }
  };

  // 描述：新增入口始终进入项目选择页，避免在侧边栏直接绑定旧目录上下文。
  const handleCreateSession = () => {
    setPendingDeleteSessionId("");
    navigate(AGENT_HOME_PATH);
  };

  // 描述：切换会话排序方式，支持“默认顺序”和“按名称排序”两种模式。
  const handleToggleSessionSortMode = () => {
    setSessionSortMode((current) => (current === "default" ? "name" : "default"));
  };

  // 描述：按当前排序模式生成会话展示顺序；默认保留后端顺序，按名称模式按标题升序排列。
  const displayedSessions = useMemo(() => {
    if (sessionSortMode === "default") {
      return sessions;
    }
    return [...sessions].sort((a, b) => compareText(a.title, b.title));
  }, [compareText, sessionSortMode, sessions]);

  // 描述：强制重建会话菜单组件实例，解决删除后子菜单高度缓存未更新的问题。
  const reloadSessionSidebarMenu = () => {
    setSessionMenuRenderVersion((current) => current + 1);
  };

  // 描述：将代码文本流事件映射为运行片段，供跨页面恢复步骤流。
  //
  // Params:
  //
  //   - payload: 文本流事件。
  //   - key: 片段唯一标识。
  //
  // Returns:
  //
  //   - 运行片段；若当前事件不需要渲染则返回 null。
  const mapCodeStreamToRunSegment = (payload: AgentTextStreamEvent, key: string) => {
    const text = String(payload.message || "").trim();
    if (payload.kind === STREAM_KINDS.DELTA) {
      return null;
    }
    if (payload.kind === STREAM_KINDS.STARTED) {
      return null;
    }
    if (payload.kind === STREAM_KINDS.LLM_STARTED) {
      return null;
    }
    if (payload.kind === STREAM_KINDS.LLM_FINISHED) {
      return null;
    }
    if (payload.kind === STREAM_KINDS.FINISHED) {
      return null;
    }
    if (payload.kind === STREAM_KINDS.FINAL) {
      return {
        key,
        intro: t("执行完成"),
        step: text || t("执行结束，正在输出最终结果…"),
        status: "finished" as const,
        data: {
          __segment_kind: payload.kind,
        },
      };
    }
    if (payload.kind === STREAM_KINDS.CANCELLED) {
      return {
        key,
        intro: t("任务已取消"),
        step: text || t("当前任务已终止，不再继续执行。"),
        status: "finished" as const,
        data: {
          __segment_kind: payload.kind,
        },
      };
    }
    if (payload.kind === STREAM_KINDS.PLANNING) {
      const turnSummaryMatch = text.match(/^第\s*(\d+)\s*轮已完成(?:[：:，,]\s*(.+))?$/u);
      if (!turnSummaryMatch) {
        return null;
      }
      return {
        key,
        intro: t("第 {{turn}} 轮执行结果", { turn: turnSummaryMatch[1] }),
        step: String(turnSummaryMatch[2] || "").trim() || text,
        status: "finished" as const,
      };
    }
    if (payload.kind === STREAM_KINDS.TOOL_CALL_STARTED) {
      const data = resolveToolCallEventData(payload);
      const toolName = String(data.name || "").trim();
      let detail = "";
      if (toolName === "run_shell" && data.args?.command) {
        detail = data.args.command.substring(0, 30);
        if (data.args.command.length > 30) {
          detail += "...";
        }
      } else if (data.args?.path) {
        detail = data.args.path;
      }
      return {
        key,
        intro: t("执行工具：{{tool}}", { tool: toolName || "unknown" }),
        step: text ? t("执行中：{{message}}", { message: text }) : t("执行中：正在调用系统工具…"),
        status: "running" as const,
        data: {
          __segment_kind: payload.kind,
        },
      };
    }
    if (payload.kind === STREAM_KINDS.TOOL_CALL_FINISHED) {
      const data = resolveToolCallEventData(payload);
      const toolName = String(data.name || "").trim();
      const runOk = data.ok !== false;
      const stepText = String(data.result || "").trim() || text || t("任务步骤执行完成");
      return {
        key,
        intro: t("工具完成：{{tool}}", { tool: toolName || "unknown" }),
        step: t("{{status}}：{{step}}", { status: runOk ? t("已完成") : t("失败"), step: stepText }),
        status: runOk ? "finished" as const : "failed" as const,
        data: {
          __segment_kind: payload.kind,
        },
      };
    }
    if (payload.kind === STREAM_KINDS.HEARTBEAT) {
      const heartbeatText = text || t("等待执行结果回传…");
      const intro = heartbeatText.includes("（")
        ? heartbeatText.split("（")[0]
        : heartbeatText;
      return {
        key,
        intro: intro || t("等待执行结果回传…"),
        step: heartbeatText,
        status: "running" as const,
        data: {
          __segment_kind: payload.kind,
        },
      };
    }
    if (payload.kind === STREAM_KINDS.REQUIRE_APPROVAL) {
      const data = resolveApprovalEventData(payload);
      const approvalToolName = String(data.tool_name || "").trim() || t("高危操作");
      return {
        key,
        intro: t("需要人工授权"),
        step: t("正在请求执行 {{tool}}", { tool: approvalToolName }),
        status: "running" as const,
        data: buildApprovalSegmentData(payload),
      };
    }
    if (payload.kind === STREAM_KINDS.ERROR) {
      const errorCode = resolveStreamErrorCode(payload);
      if (isCancelErrorCode(errorCode)) {
        return {
          key,
          intro: t("任务已取消"),
          step: text || t("任务已终止，不再继续执行。"),
          status: "finished" as const,
          data: {
            __segment_kind: payload.kind,
            __error_code: errorCode || undefined,
          },
        };
      }
      return {
        key,
        intro: t("执行失败"),
        step: text || t("执行失败，请查看详情后重试。"),
        status: "failed" as const,
        data: {
          __segment_kind: payload.kind,
          __error_code: errorCode || undefined,
        },
      };
    }
    if (!text) {
      return null;
    }
    return {
      key,
      intro: t("执行进度更新"),
      step: text,
      status: "running" as const,
    };
  };

  // 描述：
  //
  //   - 判断运行片段是否属于“待人工授权”片段，供侧边栏跨页面恢复时保持授权状态。
  const isApprovalPendingSegment = (segment: SessionRunMeta["segments"][number]) => {
    const segmentKind = segment.data && typeof segment.data.__segment_kind === "string"
      ? segment.data.__segment_kind
      : "";
    return segment.intro === t("需要人工授权") || segmentKind === STREAM_KINDS.REQUIRE_APPROVAL;
  };

  // 描述：将片段追加到运行元数据，并保证同一时刻仅有一个 running 片段。
  //
  // Params:
  //
  //   - current: 当前运行元数据。
  //   - segment: 新片段。
  //
  // Returns:
  //
  //   - 追加后的运行元数据。
  const appendRunSegmentToMeta = (current: SessionRunMeta, segment: {
    key: string;
    intro: string;
    step: string;
    status: "running" | "finished" | "failed";
    data?: Record<string, unknown>;
  }): SessionRunMeta => {
    const incomingSegmentKind = segment.data && typeof segment.data.__segment_kind === "string"
      ? segment.data.__segment_kind
      : "";
    const hasPendingApproval = (current.segments || []).some(
      (item) => item.status === "running" && isApprovalPendingSegment(item),
    );
    // 描述：
    //
    //   - 授权等待期间忽略心跳片段，避免“需要人工授权”被覆盖后页面返回看不到授权卡片。
    if (hasPendingApproval && incomingSegmentKind === STREAM_KINDS.HEARTBEAT) {
      return current;
    }
    const shouldResolveApprovalPending = incomingSegmentKind === STREAM_KINDS.TOOL_CALL_FINISHED
      || incomingSegmentKind === STREAM_KINDS.ERROR
      || incomingSegmentKind === STREAM_KINDS.CANCELLED
      || incomingSegmentKind === STREAM_KINDS.FINISHED
      || incomingSegmentKind === STREAM_KINDS.FINAL;
    const incomingStepText = String(segment.step || "").trim();
    const incomingErrorCode = segment.data && typeof segment.data.__error_code === "string"
      ? String(segment.data.__error_code || "").trim()
      : "";
      const isHumanRefusedError = incomingSegmentKind === STREAM_KINDS.ERROR
        && (
          incomingErrorCode === "core.agent.human_refused"
          || incomingStepText.includes(t("拒绝"))
          || incomingStepText.toLowerCase().includes("reject")
        );
    const normalizedSegments = (current.segments || []).map((item) => {
      if (item.status !== "running") {
        return item;
      }
      if (!isApprovalPendingSegment(item)) {
        return { ...item, status: "finished" as const };
      }
      if (!shouldResolveApprovalPending) {
        return item;
      }
      const toolName = String(
        item.data && typeof item.data.tool_name === "string" ? item.data.tool_name : "",
      ).trim();
      const stepData = item.data && typeof item.data === "object" ? item.data : {};
      if (isHumanRefusedError) {
        return {
          ...item,
          status: "failed" as const,
          step: t("已拒绝 {{tool}} 的执行请求。", { tool: toolName || t("该工具") }),
          data: {
            ...stepData,
            __step_type: "approval_decision",
            approval_decision: "rejected",
            approval_tool_name: toolName || t("该工具"),
          },
        };
      }
      if (incomingSegmentKind === STREAM_KINDS.CANCELLED) {
        return {
          ...item,
          status: "finished" as const,
          step: t("授权流程已取消，未执行 {{tool}}。", { tool: toolName || t("该工具") }),
          data: {
            ...stepData,
            __step_type: "approval_decision",
            approval_decision: "cancelled",
            approval_tool_name: toolName || t("该工具"),
          },
        };
      }
      return {
        ...item,
        status: "finished" as const,
        step: t("已处理 {{tool}} 的授权请求。", { tool: toolName || t("该工具") }),
        data: {
          ...stepData,
          __step_type: "approval_decision",
          approval_decision: "handled",
          approval_tool_name: toolName || t("该工具"),
        },
      };
    });
    return {
      ...current,
      segments: [...normalizedSegments, segment].slice(-160),
    };
  };

  // 描述：删除会话按钮采用二次确认，首次点击进入确认态，二次点击后执行删除。
  const handleDeleteSession = async (event: MouseEvent<HTMLButtonElement>, sessionId: string) => {
    event.preventDefault();
    event.stopPropagation();

    if (deletingSessionId) {
      return;
    }

    if (pendingDeleteSessionId !== sessionId) {
      setPendingDeleteSessionId(sessionId);
      return;
    }

    const deletingWorkspaceId = isProjectAgent
      ? getProjectWorkspaceIdBySessionId(sessionId) || selectedWorkspaceFromQuery || getLastUsedProjectWorkspaceId()
      : "";

    // 描述：执行删除时先本地移除会话，避免后端状态更新延迟导致“已确认仍可见”。
    removeAgentSession(agentKey, sessionId);
    setSessions((prev) => prev.filter((item) => item.id !== sessionId));
    reloadSessionSidebarMenu();
    setPendingDeleteSessionId("");
    if (selectedSessionKey === sessionId) {
      if (isProjectAgent && deletingWorkspaceId) {
        navigate(`${AGENT_HOME_PATH}?workspaceId=${encodeURIComponent(deletingWorkspaceId)}`);
      } else {
        navigate(AGENT_HOME_PATH);
      }
    }

    setDeletingSessionId(sessionId);
    try {
      await updateRuntimeSessionStatus(user.id, sessionId, 0);
    } catch (_err) {
      // 描述：即使后端删除失败，也保留本地删除状态，避免用户重复看到已删除会话。
    } finally {
      setDeletingSessionId("");
      setPendingDeleteSessionId("");
      setContextSessionId("");
      void refreshSessions();
    }
  };

  // 描述：切换会话置顶状态，并立即刷新当前会话排序。
  const handleTogglePinnedSession = (event: MouseEvent<HTMLButtonElement>, sessionId: string) => {
    event.preventDefault();
    event.stopPropagation();
    togglePinnedAgentSession(sessionId);
    setPendingDeleteSessionId("");
    void refreshSessions();
  };

  // 描述：打开会话重命名弹窗，默认值采用当前标题。
  const handleOpenRenameModal = (sessionId: string) => {
    const current = sessions.find((item) => item.id === sessionId);
    setRenamingSessionId(sessionId);
    setRenameValue(current?.title || "");
    setRenameModalVisible(true);
  };

  // 描述：确认重命名会话，仅更新本地显示标题元数据。
  const handleConfirmRename = () => {
    if (!renamingSessionId) {
      return;
    }
    renameAgentSession(renamingSessionId, renameValue);
    setRenameModalVisible(false);
    setRenamingSessionId("");
    setRenameValue("");
    void refreshSessions();
  };

  // 描述：删除目录分组，并在必要时回退到最近可用目录。
  const handleDeleteWorkspace = (workspaceId: string) => {
    if (!workspaceId) {
      return;
    }
    removeProjectWorkspaceGroup(workspaceId);
    reloadSessionSidebarMenu();
    const fallbackWorkspaceId = getLastUsedProjectWorkspaceId();
    refreshWorkspaceGroups();
    if (!location.pathname.includes("/session/")) {
      if (fallbackWorkspaceId) {
        navigate(`${AGENT_HOME_PATH}?workspaceId=${encodeURIComponent(fallbackWorkspaceId)}`);
      } else {
        navigate(AGENT_HOME_PATH);
      }
    }
    void refreshSessions();
  };

  // 描述：打开项目设置页面，保持目录上下文并仅切换主内容区域。
  const openWorkspaceSettingsPage = (workspaceId: string) => {
    if (!workspaceId) {
      return;
    }
    const workspaceMenuKey = buildWorkspaceMenuKey(workspaceId);
    setProjectWorkspaceExpandedKeys((current) => {
      const next = new Set([...current, workspaceMenuKey]);
      return [...next];
    });
    setLastUsedProjectWorkspaceId(workspaceId);
    navigate(`${PROJECT_SETTINGS_PATH}?workspaceId=${encodeURIComponent(workspaceId)}`);
  };

  // 描述：在指定项目下创建新话题并跳转到会话页，保持项目上下文绑定。
  //
  // Params:
  //
  //   - workspaceId: 目标项目 ID。
  const handleCreateSessionInWorkspace = async (workspaceId: string) => {
    if (!workspaceId || !isProjectAgent || creatingWorkspaceSessionId) {
      return;
    }
    setCreatingWorkspaceSessionId(workspaceId);
    try {
      const created = await createRuntimeSession(user.id, "agent");
      if (!created.id) {
        AriMessage.warning({
          content: t("创建话题失败，请稍后重试。"),
          duration: 2500,
        });
        return;
      }
      bindProjectSessionWorkspace(created.id, workspaceId);
      setLastUsedProjectWorkspaceId(workspaceId);
      navigate(`${resolveAgentSessionPath(created.id)}?workspaceId=${encodeURIComponent(workspaceId)}`);
    } catch (_err) {
      AriMessage.warning({
        content: t("创建话题失败，请稍后重试。"),
        duration: 2500,
      });
    } finally {
      setCreatingWorkspaceSessionId("");
      void refreshSessions();
    }
  };

  // 描述：在菜单项右键事件中直接绑定会话 ID，保持触发逻辑与组件 preview 示例一致。
  const handleOpenSessionContextMenu = (event: MouseEvent<HTMLElement>, sessionId: string) => {
    event.preventDefault();
    setContextSessionId(sessionId);
    setPendingDeleteSessionId("");
  };

  // 描述：右键菜单删除会话走直接删除，避免二次确认按钮状态与菜单冲突。
  const handleDeleteSessionByContextMenu = async (sessionId: string) => {
    if (!sessionId || deletingSessionId) {
      return;
    }
    const deletingWorkspaceId = isProjectAgent
      ? getProjectWorkspaceIdBySessionId(sessionId) || selectedWorkspaceFromQuery || getLastUsedProjectWorkspaceId()
      : "";

    // 描述：右键删除同样采用本地优先移除，确保交互结果即时可见。
    removeAgentSession(agentKey, sessionId);
    setSessions((prev) => prev.filter((item) => item.id !== sessionId));
    reloadSessionSidebarMenu();
    if (selectedSessionKey === sessionId) {
      if (isProjectAgent && deletingWorkspaceId) {
        navigate(`${AGENT_HOME_PATH}?workspaceId=${encodeURIComponent(deletingWorkspaceId)}`);
      } else {
        navigate(AGENT_HOME_PATH);
      }
    }

    setDeletingSessionId(sessionId);
    try {
      await updateRuntimeSessionStatus(user.id, sessionId, 0);
    } catch (_err) {
      // 描述：后端失败时保留本地删除结果，防止会话在列表中“反复出现”。
    } finally {
      setDeletingSessionId("");
      setContextSessionId("");
      void refreshSessions();
    }
  };

  // 描述：点击会话项后导航到会话详情，智能体会携带目录分组上下文。
  const handleSelectSession = (sessionKey: string) => {
    if (!sessionKey) {
      return;
    }
    if (suppressNextSessionSelectIdRef.current && suppressNextSessionSelectIdRef.current === sessionKey) {
      // 描述：点击会话 action 按钮时，忽略组件内部可能冒泡触发的 onSelect，避免误导航与确认态被清空。
      suppressNextSessionSelectIdRef.current = "";
      return;
    }
    const workspaceId = getProjectWorkspaceIdBySessionId(sessionKey)
      || selectedWorkspaceFromQuery
      || getLastUsedProjectWorkspaceId()
      || workspaceGroups[0]?.id
      || "";
    if (workspaceId) {
      setLastUsedProjectWorkspaceId(workspaceId);
    }
    const search = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    navigate(`${resolveAgentSessionPath(sessionKey)}${search}`);
  };

  // 描述：标记并短暂抑制下一次同会话 onSelect，用于规避 action 点击触发的误选中副作用。
  //
  // Params:
  //
  //   - sessionId: 需要抑制的目标会话 ID。
  const markSuppressNextSessionSelect = (sessionId: string) => {
    if (!sessionId) {
      return;
    }
    suppressNextSessionSelectIdRef.current = sessionId;
    window.setTimeout(() => {
      if (suppressNextSessionSelectIdRef.current === sessionId) {
        suppressNextSessionSelectIdRef.current = "";
      }
    }, 0);
  };

  // 描述：将当前会话列表按目录分组映射成二级结构。
  const workspaceSessionGroups = useMemo<WorkspaceSessionGroup[]>(() => {
    if (!isProjectAgent) {
      return [];
    }
    const fallbackWorkspaceId = getLastUsedProjectWorkspaceId() || workspaceGroups[0]?.id || "";
    const byWorkspaceId = new Map<string, AgentSidebarSession[]>();
    workspaceGroups.forEach((group) => {
      byWorkspaceId.set(group.id, []);
    });

    displayedSessions.forEach((sessionItem) => {
      const workspaceId = getProjectWorkspaceIdBySessionId(sessionItem.id) || fallbackWorkspaceId;
      if (!workspaceId || !byWorkspaceId.has(workspaceId)) {
        return;
      }
      byWorkspaceId.get(workspaceId)?.push(sessionItem);
    });

    return workspaceGroups.map((workspace) => ({
      workspace,
      sessions: byWorkspaceId.get(workspace.id) || [],
    }));
  }, [displayedSessions, isProjectAgent, workspaceGroups]);

  // 描述：构建会话菜单项定义，复用会话 hover 动作与右键菜单触发。
  const buildSessionMenuItems = (items: AgentSidebarSession[]) => items.map((item) => ({
    key: item.id,
    label: item.title,
    icon: item.running ? "loading" : undefined,
    fillIcon: item.running ? "loading" : undefined,
    iconAnimation: item.running ? "spinning" : undefined,
    iconState: item.running ? "loading" : undefined,
    actions: (
      <AriFlex align="center" space={4}>
        <AriButton
          size="sm"
          type="text"
          icon={item.pinned || hoveredPinSessionId === item.id ? "pinboard_fill" : "pinboard"}
          color={item.pinned ? "primary" : "default"}
          onMouseEnter={() => {
            setHoveredPinSessionId(item.id);
          }}
          onMouseLeave={() => {
            setHoveredPinSessionId((current) => (current === item.id ? "" : current));
          }}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            markSuppressNextSessionSelect(item.id);
            handleTogglePinnedSession(event, item.id);
          }}
        />
        <AriButton
          size="sm"
          type="text"
          ghost
          color={pendingDeleteSessionId === item.id || deletingSessionId === item.id ? "danger" : "default"}
          icon={
            pendingDeleteSessionId === item.id || deletingSessionId === item.id
              ? undefined
              : hoveredDeleteSessionId === item.id
                ? "delete_fill"
                : "delete"
          }
          label={deletingSessionId === item.id ? t("删除中") : pendingDeleteSessionId === item.id ? t("确定") : undefined}
          disabled={deletingSessionId === item.id}
          onMouseEnter={() => {
            setHoveredDeleteSessionId(item.id);
          }}
          onMouseLeave={() => {
            setHoveredDeleteSessionId((current) => (current === item.id ? "" : current));
          }}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            markSuppressNextSessionSelect(item.id);
            void handleDeleteSession(event, item.id);
          }}
        />
      </AriFlex>
    ),
    // 描述：进入删除确认/删除中状态后固定显示动作区，避免 code 二级菜单在失焦时把“确定”按钮收起。
    showActionsOnHover: pendingDeleteSessionId !== item.id && deletingSessionId !== item.id,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      handleOpenSessionContextMenu(event, item.id);
    },
  }));

  // 描述：构建项目目录树菜单项，使用 AriMenu children 统一承载“目录 -> 会话”层级结构。
  const projectWorkspaceMenuItems = useMemo(() => {
    if (!isProjectAgent) {
      return [];
    }
    return workspaceSessionGroups.map((group) => ({
      key: buildWorkspaceMenuKey(group.workspace.id),
      label: group.workspace.name,
      icon: "folder",
      actions: (
        <AriFlex align="center" space={4}>
          <AriTooltip
            trigger="manual"
            visible={openWorkspaceActionMenuId === group.workspace.id}
            position="bottom"
            content={(
              <AriMenu
                items={[
                  { key: "delete", label: t("删除"), icon: "delete", fillIcon: "delete_fill" },
                ]}
                onSelect={(key: string) => {
                  setOpenWorkspaceActionMenuId("");
                  if (key === "delete") {
                    handleDeleteWorkspace(group.workspace.id);
                  }
                }}
              />
            )}
          >
            <AriButton
              size="sm"
              type="text"
              ghost
              icon="more_horiz"
              aria-label={t("项目更多操作")}
              data-workspace-action-trigger="true"
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                setOpenWorkspaceActionMenuId((current) => (current === group.workspace.id ? "" : group.workspace.id));
              }}
            />
          </AriTooltip>
          <AriButton
            size="sm"
            type="text"
            ghost
            icon="settings"
            aria-label={t("项目设置")}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              event.stopPropagation();
              setOpenWorkspaceActionMenuId("");
              openWorkspaceSettingsPage(group.workspace.id);
            }}
          />
          <AriButton
            size="sm"
            type="text"
            ghost
            icon="edit"
            aria-label={t("在项目内新增话题")}
            disabled={creatingWorkspaceSessionId === group.workspace.id}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              event.stopPropagation();
              setOpenWorkspaceActionMenuId("");
              void handleCreateSessionInWorkspace(group.workspace.id);
            }}
          />
        </AriFlex>
      ),
      showActionsOnHover: true,
      children: buildSessionMenuItems(group.sessions),
    }));
  }, [
    workspaceSessionGroups,
    creatingWorkspaceSessionId,
    deletingSessionId,
    hoveredDeleteSessionId,
    hoveredPinSessionId,
    isProjectAgent,
    openWorkspaceActionMenuId,
    pendingDeleteSessionId,
    t,
  ]);

  // 描述：处理项目目录树菜单点击，父节点进入项目设置页，子节点进入会话详情。
  const handleSelectProjectWorkspaceMenuItem = (key: string) => {
    const workspaceId = parseWorkspaceIdFromMenuKey(key);
    if (workspaceId) {
      openWorkspaceSettingsPage(workspaceId);
      return;
    }
    handleSelectSession(key);
  };

  // 描述：根据当前路由计算项目目录树选中项，仅在具体会话页高亮会话，避免项目页出现整组激活态。
  const selectedWorkspaceMenuKey = useMemo(() => {
    if (!isProjectAgent) {
      return "";
    }
    if (isProjectSettingsPath) {
      return "";
    }
    if (selectedSessionKey) {
      return selectedSessionKey;
    }
    return "";
  }, [isProjectAgent, isProjectSettingsPath, selectedSessionKey]);

  // 描述：计算项目目录树默认展开项，确保当前目录对应父节点默认展开。
  const defaultExpandedWorkspaceKeys = useMemo(() => {
    if (!isProjectAgent) {
      return [];
    }
    const fallbackWorkspaceId = selectedWorkspaceFromQuery || getLastUsedProjectWorkspaceId() || workspaceGroups[0]?.id || "";
    if (!fallbackWorkspaceId) {
      return [];
    }
    return [buildWorkspaceMenuKey(fallbackWorkspaceId)];
  }, [isProjectAgent, selectedWorkspaceFromQuery, workspaceGroups]);

  // 描述：解析当前右键目标会话，供右键菜单文案与动作状态联动。
  const contextTargetSession = sessions.find((item) => item.id === contextSessionId) || null;
  // 描述：构建会话右键菜单项，统一管理固定/重命名/删除行为入口。
  const contextMenuItems = useMemo(() => {
    // 描述：生成右键菜单项标签，并在 hover 时切换 fill 图标。
    const renderContextMenuItemLabel = (params: {
      key: string;
      label: string;
      icon: string;
      fillIcon: string;
      forceFill?: boolean;
    }) => (
      <AriFlex
        className="desk-context-menu-item-label"
        align="center"
        space={8}
        onMouseEnter={() => {
          setHoveredContextMenuActionKey(params.key);
        }}
        onMouseLeave={() => {
          setHoveredContextMenuActionKey((current) => (current === params.key ? "" : current));
        }}
      >
        <AriIcon
          className="desk-context-menu-item-icon"
          name={(params.forceFill || hoveredContextMenuActionKey === params.key) ? params.fillIcon : params.icon}
        />
        <AriTypography variant="body" value={params.label} />
      </AriFlex>
    );

    return [
      {
        key: "pin",
        label: renderContextMenuItemLabel({
          key: "pin",
          label: contextTargetSession?.pinned ? t("取消固定会话") : t("固定会话"),
          icon: "pinboard",
          fillIcon: "pinboard_fill",
          forceFill: Boolean(contextTargetSession?.pinned),
        }),
      },
      {
        key: "rename",
        label: renderContextMenuItemLabel({
          key: "rename",
          label: t("重命名会话"),
          icon: "edit",
          fillIcon: "edit_fill",
        }),
      },
      {
        key: "delete",
        label: renderContextMenuItemLabel({
          key: "delete",
          label: t("删除会话"),
          icon: "delete",
          fillIcon: "delete_fill",
        }),
      },
    ];
  }, [contextTargetSession?.pinned, hoveredContextMenuActionKey, t]);

  useEffect(() => {
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey, user.id]);

  useEffect(() => {
    // 描述：
    //
    //   - 路由切换时只清理临时交互态，不重置项目树展开状态，避免点击话题后整组项目被自动收起。
    setPendingDeleteSessionId("");
    setContextSessionId("");
    setOpenWorkspaceActionMenuId("");
    setHoveredPinSessionId("");
    setHoveredDeleteSessionId("");
    setHoveredContextMenuActionKey("");
    suppressNextSessionSelectIdRef.current = "";
  }, [location.pathname]);

  useEffect(() => {
    // 描述：
    //
    //   - 仅在智能体上下文切换时重置目录树展开态和排序方式，避免不同侧边栏模式沿用旧状态。
    setProjectWorkspaceExpandedKeys([]);
    setSessionSortMode("default");
  }, [agentKey]);

  useEffect(() => {
    if (!isProjectAgent) {
      return;
    }
    if (selectedWorkspaceFromQuery) {
      setLastUsedProjectWorkspaceId(selectedWorkspaceFromQuery);
    }
  }, [isProjectAgent, selectedWorkspaceFromQuery]);

  useEffect(() => {
    if (!isProjectAgent || !selectedSessionKey) {
      return;
    }
    const workspaceId = getProjectWorkspaceIdBySessionId(selectedSessionKey);
    if (workspaceId) {
      setLastUsedProjectWorkspaceId(workspaceId);
    }
  }, [isProjectAgent, selectedSessionKey]);

  useEffect(() => {
    activePathnameRef.current = location.pathname;
    activeSelectedSessionKeyRef.current = selectedSessionKey;
  }, [location.pathname, selectedSessionKey]);

  useEffect(() => {
    if (!selectedSessionKey) {
      return;
    }
    if (sessions.some((item) => item.id === selectedSessionKey)) {
      delete missingSessionSyncAttemptsRef.current[selectedSessionKey];
      return;
    }
    const attempts = missingSessionSyncAttemptsRef.current[selectedSessionKey] || 0;
    if (attempts >= 2) {
      return;
    }
    // 描述：会话页已打开但侧边栏尚未出现该会话时，主动刷新列表，确保“新建后跳转”场景及时同步。
    missingSessionSyncAttemptsRef.current[selectedSessionKey] = attempts + 1;
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionKey, sessions, agentKey, user.id]);

  useEffect(() => {
    if (!isProjectAgent) {
      return;
    }
    if (defaultExpandedWorkspaceKeys.length === 0) {
      return;
    }
    setProjectWorkspaceExpandedKeys((prev) => {
      const next = new Set([...prev, ...defaultExpandedWorkspaceKeys]);
      return [...next];
    });
  }, [defaultExpandedWorkspaceKeys, isProjectAgent]);

  useEffect(() => {
    if (!isProjectAgent || !IS_BROWSER) {
      return;
    }
    // 描述：监听项目目录分组变更事件，保证新增目录后侧边栏目录树即时刷新。
    const onProjectWorkspaceGroupsUpdated = () => {
      setWorkspaceGroups(listProjectWorkspaceGroups());
    };
    window.addEventListener(PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT, onProjectWorkspaceGroupsUpdated as EventListener);
    return () => {
      window.removeEventListener(PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT, onProjectWorkspaceGroupsUpdated as EventListener);
    };
  }, [isProjectAgent, location.pathname, selectedSessionKey]);

  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }
    // 描述：监听会话运行态更新事件，实时同步侧边栏话题左侧运行图标。
    const syncSessionRunningState = () => {
      setSessions((prev) => prev.map((item) => ({
        ...item,
        running: isSessionRunning(agentKey, item.id),
      })));
    };
    window.addEventListener(SESSION_RUN_STATE_UPDATED_EVENT, syncSessionRunningState as EventListener);
    return () => {
      window.removeEventListener(SESSION_RUN_STATE_UPDATED_EVENT, syncSessionRunningState as EventListener);
    };
  }, [agentKey]);

  useEffect(() => {
    if (!isProjectAgent) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    // 描述：侧边栏常驻监听代码文本流事件，保证离开会话页后运行态仍能持续更新并恢复步骤流。
    void listen<AgentTextStreamEvent>(EVENT_AGENT_TEXT_STREAM, (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      if (!payload) {
        return;
      }
      const sessionId = String(payload.session_id || "").trim();
      if (!sessionId) {
        return;
      }
      // 描述：
      //
      //   - 当前正处于该会话详情页时，由会话页负责写入运行态，侧边栏跳过以避免双写造成主线程抖动。
      const isActiveSessionPage = activePathnameRef.current.includes("/session/")
        && activeSelectedSessionKeyRef.current === sessionId;
      if (isActiveSessionPage) {
        return;
      }
      const now = Date.now();
      const snapshot = getSessionRunState("agent", sessionId);
      const activeMessageId = String(snapshot?.activeMessageId || "").trim() || `assistant-stream-${now}`;
      const storedMessages = getSessionMessages("agent", sessionId);
      const currentMessageText = String(
        storedMessages.find((item) => item.role === "assistant" && String(item.id || "").trim() === activeMessageId)?.text || "",
      ).trim();
      const runMetaMap = { ...(snapshot?.runMetaMap || {}) };
      const baseMeta = runMetaMap[activeMessageId] || {
        status: "running" as const,
        startedAt: now,
        collapsed: false,
        summary: "",
        segments: [],
      };
      let nextMeta: SessionRunMeta = {
        status: baseMeta.status === "failed" ? "failed" : baseMeta.status === "finished" ? "finished" : "running",
        startedAt: Number(baseMeta.startedAt || now),
        finishedAt: baseMeta.finishedAt ? Number(baseMeta.finishedAt) : undefined,
        collapsed: Boolean(baseMeta.collapsed),
        summary: String(baseMeta.summary || ""),
        segments: Array.isArray(baseMeta.segments) ? baseMeta.segments : [],
      };
      let nextSending = snapshot?.sending ?? true;
      const segment = mapCodeStreamToRunSegment(payload, `stream:${payload.kind}:${payload.message}:${now}`);
      if (segment) {
        nextMeta = appendRunSegmentToMeta(nextMeta, segment);
      }
      if (payload.kind === STREAM_KINDS.DELTA) {
        const delta = String(payload.delta || "");
        if (delta) {
          nextMeta.summary = `${nextMeta.summary}${delta}`;
        }
      }
      if (payload.kind === STREAM_KINDS.FINAL) {
        nextMeta.status = "finished";
        nextMeta.finishedAt = now;
        nextMeta.summary = String(payload.message || "").trim() || nextMeta.summary;
        nextSending = false;
      } else if (payload.kind === STREAM_KINDS.FINISHED) {
        nextMeta.status = "finished";
        nextMeta.finishedAt = now;
        nextSending = false;
      } else if (payload.kind === STREAM_KINDS.CANCELLED) {
        nextMeta.status = "finished";
        nextMeta.finishedAt = now;
        nextMeta.summary = String(payload.message || "").trim() || nextMeta.summary || t("任务已取消");
        nextSending = false;
      } else if (payload.kind === STREAM_KINDS.ERROR) {
        const errorCode = resolveStreamErrorCode(payload);
        const cancelledByError = isCancelErrorCode(errorCode);
        nextMeta.status = cancelledByError ? "finished" : "failed";
        nextMeta.finishedAt = now;
        nextMeta.summary = String(payload.message || "").trim() || nextMeta.summary;
        nextSending = false;
      } else {
        nextMeta.status = "running";
        nextSending = true;
      }
      runMetaMap[activeMessageId] = nextMeta;
      const heartbeatCount = nextMeta.segments.filter((item) => {
        const segmentKind = item.data && typeof item.data.__segment_kind === "string"
          ? item.data.__segment_kind
          : "";
        return segmentKind === STREAM_KINDS.HEARTBEAT;
      }).length;
      const nextMessageText = resolveSidebarAssistantMessageText(
        payload,
        currentMessageText,
        nextMeta.summary,
        heartbeatCount,
      );
      if (payload.kind !== STREAM_KINDS.DELTA && nextMessageText && nextMessageText !== currentMessageText) {
        upsertSessionMessages({
          agentKey: "agent",
          sessionId,
          messages: upsertSidebarAssistantMessageById(storedMessages, activeMessageId, nextMessageText),
        });
      }
      upsertSessionRunState({
        agentKey: "agent",
        sessionId,
        activeMessageId,
        sending: nextSending,
        runMetaMap,
        updatedAt: now,
      });
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // 描述：侧边栏流式监听失败不阻断主流程，保留会话页内监听作为兜底。
      });
    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [isProjectAgent, t]);

  useEffect(() => {
    if (!openWorkspaceActionMenuId || !IS_BROWSER) {
      return;
    }
    // 描述：监听全局点击与 ESC，保证“更多”菜单在点击页面空白区域后即时关闭。
    const handleCloseWorkspaceActionMenu = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        setOpenWorkspaceActionMenuId("");
        return;
      }
      if (target.closest("[data-workspace-action-trigger]")) {
        return;
      }
      if (target.closest(".z-tooltip")) {
        return;
      }
      setOpenWorkspaceActionMenuId("");
    };
    const handleWorkspaceActionMenuEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setOpenWorkspaceActionMenuId("");
    };
    window.addEventListener("mousedown", handleCloseWorkspaceActionMenu, true);
    window.addEventListener("keydown", handleWorkspaceActionMenuEsc);
    return () => {
      window.removeEventListener("mousedown", handleCloseWorkspaceActionMenu, true);
      window.removeEventListener("keydown", handleWorkspaceActionMenuEsc);
    };
  }, [openWorkspaceActionMenuId]);

  return (
    <AriContainer className="desk-sidebar">
      {showBackHeader ? <SidebarBackHeader onBack={() => navigate("/home")} label="Home" /> : null}
      <AriContainer className="desk-sidebar-toolbar" padding={0}>
        <AriMenu
          className="desk-sidebar-nav"
          items={projectToolbarEntries.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: item.label,
          }))}
          selectedKey={selectedToolbarKey}
          onSelect={(key: string) => {
            const target = projectToolbarEntries.find((item) => item.key === key);
            if (!target) {
              return;
            }
            if (target.key === "create-project") {
              handleCreateSession();
              return;
            }
            if (!target.enabled || !target.path) {
              AriMessage.warning({
                content: target.deniedMessage || t("当前入口不可用。"),
                duration: 2500,
              });
              return;
            }
            navigate(target.path);
          }}
        />
      </AriContainer>
      <AriFlex className="desk-agent-session-header" align="center" justify="space-between">
        <AriTypography variant="caption" value={t("项目")} />
        <AriFlex className="desk-agent-session-header-actions" align="center" space={4}>
          <AriButton
            size="sm"
            type="text"
            ghost
            icon="note_stack_add"
            aria-label={t("新项目")}
            onClick={handleCreateSession}
          />
          <AriButton
            size="sm"
            type="text"
            ghost
            icon="sort"
            color={sessionSortMode === "name" ? "primary" : "default"}
            aria-label={t("排序")}
            onClick={handleToggleSessionSortMode}
          />
        </AriFlex>
      </AriFlex>

      <AriContextMenu
        className="desk-history-context-menu"
        items={contextMenuItems}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setContextSessionId("");
            setHoveredContextMenuActionKey("");
          }
        }}
        onSelect={(key: string) => {
          const targetId = contextSessionId;
          if (!targetId) {
            return;
          }
          if (key === "pin") {
            togglePinnedAgentSession(targetId);
            void refreshSessions();
            return;
          }
          if (key === "rename") {
            handleOpenRenameModal(targetId);
            return;
          }
          if (key === "delete") {
            void handleDeleteSessionByContextMenu(targetId);
          }
        }}
      >
        <AriContainer className="desk-history-menu" padding={0}>
          {isProjectAgent ? (
            projectWorkspaceMenuItems.length > 0 ? (
              <AriMenu
                key={`project-workspace-menu-${sessionMenuRenderVersion}`}
                className="desk-sidebar-nav desk-project-workspace-tree"
                mode="vertical"
                expandIconPosition="none"
                items={projectWorkspaceMenuItems}
                selectedKey={selectedWorkspaceMenuKey}
                defaultExpandedKeys={defaultExpandedWorkspaceKeys}
                expandedKeys={projectWorkspaceExpandedKeys}
                onExpand={setProjectWorkspaceExpandedKeys}
                onSelect={(key: string) => {
                  handleSelectProjectWorkspaceMenuItem(key);
                }}
              />
            ) : (
              <AriContainer className="desk-project-workspace-empty">
                <AriTypography variant="caption" value={t("请先在“新增”页面选择至少一个工作目录。")} />
              </AriContainer>
            )
          ) : (
            <AriMenu
              className="desk-sidebar-nav"
              items={buildSessionMenuItems(displayedSessions)}
              selectedKey={selectedSessionKey}
              onSelect={handleSelectSession}
            />
          )}
        </AriContainer>
      </AriContextMenu>

      <AriContainer className="desk-sidebar-spacer" />
      <UserHoverMenu
        user={user}
        selectedIdentityLabel={selectedIdentity?.scopeName || ""}
        onLogout={onLogout}
        routeAccess={routeAccess}
        desktopUpdateState={desktopUpdateState}
        onCheckDesktopUpdate={onCheckDesktopUpdate}
        onInstallDesktopUpdate={onInstallDesktopUpdate}
      />

      <AriModal
        visible={renameModalVisible}
        title={t("重命名会话")}
        onClose={() => {
          setRenameModalVisible(false);
          setRenamingSessionId("");
          setRenameValue("");
        }}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              label={t("取消")}
              onClick={() => {
                setRenameModalVisible(false);
                setRenamingSessionId("");
                setRenameValue("");
              }}
            />
            <AriButton
              color="brand"
              label={t("确定")}
              onClick={handleConfirmRename}
            />
          </AriFlex>
        )}
      >
        <AriInput
          variant="borderless"
          value={renameValue}
          onChange={setRenameValue}
          placeholder={t("输入新的会话标题")}
        />
      </AriModal>
    </AriContainer>
  );
}

// 描述:
//
//   - 渲染工作流侧边栏，统一提供工作流切换、新建与删除能力。
function WorkflowsSidebar({
  user,
  selectedIdentity,
  onLogout,
  routeAccess,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onInstallDesktopUpdate,
}: {
  user: LoginUser;
  selectedIdentity: ConsoleIdentityItem | null;
  onLogout: () => Promise<void>;
  routeAccess: RouteAccess;
  desktopUpdateState: DesktopUpdateState;
  onCheckDesktopUpdate: () => Promise<void>;
  onInstallDesktopUpdate: () => Promise<void>;
}) {
  const { t } = useDesktopI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [workflowVersion, setWorkflowVersion] = useState(0);
  const [pendingDeleteWorkflowId, setPendingDeleteWorkflowId] = useState("");
  const [hoveredDeleteWorkflowId, setHoveredDeleteWorkflowId] = useState("");
  const [createButtonHovered, setCreateButtonHovered] = useState(false);
  const isWorkflowEditorPage = location.pathname.startsWith(WORKFLOW_EDITOR_PAGE_PATH);

  // 描述：解析当前路由中的 workflowId，用于高亮当前菜单项。
  const selectedWorkflowIdFromQuery = useMemo(() => {
    return new URLSearchParams(location.search).get("workflowId")?.trim() || "";
  }, [location.search]);
  // 描述：读取工作流总览；编辑页侧边栏需要同时展示“已注册 / 未注册”两组数据。
  const workflowOverview = useMemo(
    () => listAgentWorkflowOverview(),
    [workflowVersion],
  );
  const workflows = useMemo(
    () =>
      workflowOverview.all.map((item) => ({
        key: item.id,
        id: item.id,
        name: item.name,
        readonly: item.source !== "user",
      })),
    [workflowOverview.all],
  );

  // 描述：仅在编辑页计算当前选中工作流，工作流总览页不高亮任何侧边栏项。
  const selectedWorkflow = useMemo(() => {
    if (!isWorkflowEditorPage) {
      return null;
    }
    const matched = workflows.find((item) => item.id === selectedWorkflowIdFromQuery);
    if (matched) {
      return matched;
    }
    return null;
  }, [isWorkflowEditorPage, selectedWorkflowIdFromQuery, workflows]);
  const selectedWorkflowMenuKey = selectedWorkflow?.key || "";

  // 描述：导航到工作流编辑页并携带 workflowId 参数，保证画布页和侧边栏选中态一致。
  const navigateToWorkflowPage = (workflowId: string, replace = false) => {
    const targetPath = resolveWorkflowEditorPath(workflowId);
    navigate(targetPath, replace ? { replace: true } : undefined);
  };

  // 描述：路由变化时清空删除确认态，避免跨工作流残留“确定删除”状态。
  useEffect(() => {
    setPendingDeleteWorkflowId("");
    setHoveredDeleteWorkflowId("");
  }, [location.pathname, location.search]);

  // 描述：新增空白工作流，并自动切换到新建项继续编辑。
  const handleCreateWorkflow = () => {
    const created = createAgentWorkflow();
    setWorkflowVersion((value) => value + 1);
    setPendingDeleteWorkflowId("");
    navigateToWorkflowPage(created.id);
  };

  // 描述：删除按钮采用二次确认交互：首次点击进入确认态，二次点击执行删除。
  const handleDeleteWorkflow = (event: MouseEvent<HTMLElement>, workflowId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (pendingDeleteWorkflowId !== workflowId) {
      setPendingDeleteWorkflowId(workflowId);
      return;
    }

    const targetWorkflow = workflows.find((item) => item.key === workflowId && !item.readonly);
    if (!targetWorkflow) {
      AriMessage.warning({
        content: t("工作流不存在或已删除，请刷新后重试。"),
        duration: 3000,
        showClose: true,
      });
      setPendingDeleteWorkflowId("");
      return;
    }
    const deleted = deleteAgentWorkflow(targetWorkflow.id);
    if (!deleted) {
      AriMessage.warning({
        content: t("工作流删除失败，请稍后重试。"),
        duration: 3000,
        showClose: true,
      });
      setPendingDeleteWorkflowId("");
      return;
    }

    setWorkflowVersion((value) => value + 1);
    setPendingDeleteWorkflowId("");

    if (selectedWorkflow?.key === workflowId) {
      const nextWorkflows = listAgentWorkflowOverview().all.map((item) => ({ id: item.id }));
      const nextTarget = nextWorkflows[0];
      if (nextTarget?.id) {
        navigateToWorkflowPage(nextTarget.id, true);
        return;
      }
      navigate(WORKFLOW_PAGE_PATH, { replace: true });
    }
  };

  // 描述：构建工作流菜单定义，使用 AriMenu 分组语义同时展示“已注册 / 未注册”，并仅为已注册工作流显示删除动作。
  const workflowMenuItems = useMemo(
    () => {
      const registeredItems = workflowOverview.registered.map((item) => ({
        key: item.id,
        label: item.name,
        icon: "account_tree",
        actions: (
          <AriButton
            size="sm"
            type={pendingDeleteWorkflowId === item.id ? "default" : "text"}
            ghost={pendingDeleteWorkflowId !== item.id}
            color={pendingDeleteWorkflowId === item.id ? "danger" : "default"}
            icon={
              pendingDeleteWorkflowId === item.id
                ? undefined
                : hoveredDeleteWorkflowId === item.id
                  ? "delete_fill"
                  : "delete"
            }
            label={pendingDeleteWorkflowId === item.id ? t("确定") : undefined}
            onMouseEnter={() => {
              setHoveredDeleteWorkflowId(item.id);
            }}
            onMouseLeave={() => {
              setHoveredDeleteWorkflowId((current) => (current === item.id ? "" : current));
            }}
            onClick={(event: MouseEvent<HTMLElement>) => {
              handleDeleteWorkflow(event, item.id);
            }}
          />
        ),
        // 描述：
        //
        //   - 进入“确定删除”态后固定显示动作区，避免鼠标轻微移出或菜单重绘导致确认态被意外打断。
        showActionsOnHover: pendingDeleteWorkflowId !== item.id,
      }));
      const templateItems = workflowOverview.templates.map((item) => ({
        key: item.id,
        label: item.name,
        icon: "inventory_2",
      }));
      const registeredSectionItems = registeredItems.length > 0
        ? registeredItems
        : [
            {
              key: "workflow-group-registered-empty",
              disabled: true,
              label: (
                <AriTypography
                  className="desk-sidebar-group-empty-label"
                  variant="caption"
                  value={t("暂无已注册工作流")}
                />
              ),
            },
          ];
      const templateSectionItems = templateItems.length > 0
        ? templateItems
        : [
            {
              key: "workflow-group-templates-empty",
              disabled: true,
              label: (
                <AriTypography
                  className="desk-sidebar-group-empty-label"
                  variant="caption"
                  value={t("暂无未注册工作流")}
                />
              ),
            },
          ];
      return [
        { key: "workflow-group-registered", label: t("已注册"), isGroup: true },
        ...registeredSectionItems,
        { key: "workflow-group-templates", label: t("未注册"), isGroup: true },
        ...templateSectionItems,
      ];
    },
    [handleDeleteWorkflow, hoveredDeleteWorkflowId, pendingDeleteWorkflowId, t, workflowOverview.registered, workflowOverview.templates],
  );

  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader
        onBack={() => navigate(WORKFLOW_PAGE_PATH)}
        label={t("返回")}
        rightAction={(
          <AriButton
            icon={createButtonHovered ? "note_stack_add_fill" : "note_stack_add"}
            label={t("新增")}
            onMouseEnter={() => {
              setCreateButtonHovered(true);
            }}
            onMouseLeave={() => {
              setCreateButtonHovered(false);
            }}
            onClick={handleCreateWorkflow}
          />
        )}
      />

      <AriContainer className="desk-history-menu">
        <AriMenu
          className="desk-sidebar-nav"
          items={workflowMenuItems}
          selectedKey={selectedWorkflowMenuKey}
          onSelect={(key: string) => {
            setPendingDeleteWorkflowId("");
            const target = workflows.find((item) => item.key === key);
            if (!target) {
              return;
            }
            navigateToWorkflowPage(target.id);
          }}
        />
      </AriContainer>

      <AriContainer className="desk-sidebar-spacer" />
      <UserHoverMenu
        user={user}
        selectedIdentityLabel={selectedIdentity?.scopeName || ""}
        onLogout={onLogout}
        routeAccess={routeAccess}
        desktopUpdateState={desktopUpdateState}
        onCheckDesktopUpdate={onCheckDesktopUpdate}
        onInstallDesktopUpdate={onInstallDesktopUpdate}
      />
    </AriContainer>
  );
}

// 描述:
//
//   - 渲染设置页侧边栏，承载通用与智能体设置入口。
function SettingsSidebar({
  user,
  selectedIdentity,
  onLogout,
  routeAccess,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onInstallDesktopUpdate,
}: {
  user: LoginUser;
  selectedIdentity: ConsoleIdentityItem | null;
  onLogout: () => Promise<void>;
  routeAccess: RouteAccess;
  desktopUpdateState: DesktopUpdateState;
  onCheckDesktopUpdate: () => Promise<void>;
  onInstallDesktopUpdate: () => Promise<void>;
}) {
  const { t } = useDesktopI18n();
  const navigate = useNavigate();
  const location = useLocation();
  // 描述：根据权限与模块开关解析可见设置菜单项。
  const settingItems = useMemo(() => resolveSettingsSidebarItems(routeAccess), [routeAccess]);
  // 描述：根据当前路径计算设置菜单选中态。
  const selectedSettingKey = useMemo(() => {
    if (location.pathname.includes(AGENT_SETTINGS_PATH) && routeAccess.isAgentEnabled("agent")) {
      return "agent";
    }
    if (location.pathname.startsWith("/settings/overview")) {
      return "overview";
    }
    if (location.pathname.startsWith("/settings/identities")) {
      return "identities";
    }
    if (location.pathname.startsWith("/settings/permissions")) {
      return "permissions";
    }
    return "general";
  }, [location.pathname, routeAccess]);

  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader onBack={() => navigate("/home")} label={t("Home")} />
      <AriContainer className="desk-sidebar-section">
        <AriMenu
          items={settingItems}
          selectedKey={selectedSettingKey}
          onSelect={(key: string) => {
            const target = settingItems.find((item) => item.key === key);
            if (!target) {
              return;
            }
            navigate(target.path);
          }}
        />
      </AriContainer>
      <AriContainer className="desk-sidebar-spacer" />
      <UserHoverMenu
        user={user}
        selectedIdentityLabel={selectedIdentity?.scopeName || ""}
        onLogout={onLogout}
        routeAccess={routeAccess}
        desktopUpdateState={desktopUpdateState}
        onCheckDesktopUpdate={onCheckDesktopUpdate}
        onInstallDesktopUpdate={onInstallDesktopUpdate}
      />
    </AriContainer>
  );
}

// 描述:
//
//   - 侧边栏总入口，根据路由模式切换 home/agent/settings/workflow 视图。
export function ClientSidebar({
  user,
  selectedIdentity,
  onLogout,
  availableAgents,
  routeAccess,
  desktopUpdateState,
  onCheckDesktopUpdate,
  onInstallDesktopUpdate,
}: ClientSidebarProps) {
  void availableAgents;
  const location = useLocation();
  const mode = matchSidebarMode(location.pathname);
  const agentKey = matchAgentKey(location.pathname);

  if (mode === "settings") {
    return (
      <SettingsSidebar
        user={user}
        selectedIdentity={selectedIdentity}
        onLogout={onLogout}
        routeAccess={routeAccess}
        desktopUpdateState={desktopUpdateState}
        onCheckDesktopUpdate={onCheckDesktopUpdate}
        onInstallDesktopUpdate={onInstallDesktopUpdate}
      />
    );
  }

  if (mode === "workflow") {
    return (
      <WorkflowsSidebar
        user={user}
        selectedIdentity={selectedIdentity}
        onLogout={onLogout}
        routeAccess={routeAccess}
        desktopUpdateState={desktopUpdateState}
        onCheckDesktopUpdate={onCheckDesktopUpdate}
        onInstallDesktopUpdate={onInstallDesktopUpdate}
      />
    );
  }

  if (mode === "agent" && agentKey) {
    return (
      <AgentSidebar
        user={user}
        selectedIdentity={selectedIdentity}
        onLogout={onLogout}
        agentKey={agentKey}
        showBackHeader={shouldShowAgentSidebarBackHeader(location.pathname)}
        routeAccess={routeAccess}
        desktopUpdateState={desktopUpdateState}
        onCheckDesktopUpdate={onCheckDesktopUpdate}
        onInstallDesktopUpdate={onInstallDesktopUpdate}
      />
    );
  }

  return (
    <AgentSidebar
      user={user}
      selectedIdentity={selectedIdentity}
      onLogout={onLogout}
      agentKey="agent"
      showBackHeader={false}
      routeAccess={routeAccess}
      desktopUpdateState={desktopUpdateState}
      onCheckDesktopUpdate={onCheckDesktopUpdate}
      onInstallDesktopUpdate={onInstallDesktopUpdate}
    />
  );
}
