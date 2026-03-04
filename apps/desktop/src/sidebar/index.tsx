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
} from "aries_react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  bindCodeSessionWorkspace,
  CODE_WORKSPACE_GROUPS_UPDATED_EVENT,
  getCodeWorkspaceIdBySessionId,
  getLastUsedCodeWorkspaceId,
  getAgentSessionMetaSnapshot,
  getSessionRunState,
  isSessionRunning,
  listCodeWorkspaceGroups,
  removeAgentSession,
  removeCodeWorkspaceGroup,
  renameAgentSession,
  resolveAgentSessionTitle,
  SESSION_RUN_STATE_UPDATED_EVENT,
  upsertSessionRunState,
  setLastUsedCodeWorkspaceId,
  togglePinnedAgentSession,
  type CodeWorkspaceGroup,
  type SessionRunMeta,
} from "@/shell/data";
import {
  createRuntimeSession,
  listRuntimeSessions,
  updateRuntimeSessionStatus,
} from "@/shell/services/backend-api";
import type { AgentKey, AgentSession, AuthAvailableAgentItem, LoginUser } from "@/shell/types";
import type { AgentTextStreamEvent } from "../shared/types";
import { EVENT_AGENT_TEXT_STREAM, IS_BROWSER, isCancelErrorCode, STREAM_KINDS } from "../shared/constants";
import {
  createCodeWorkflowFromTemplate,
  createModelWorkflowFromTemplate,
  deleteCodeWorkflow,
  deleteModelWorkflow,
  listCodeWorkflows,
  listModelWorkflows,
} from "@/widgets/workflow";
import {
  AI_KEY_SIDEBAR_CONTENT,
  resolveHomeSidebarAgentItems,
  resolveSettingsSidebarItems,
  SKILL_PAGE_PATH,
} from "../modules/common/routes";
import {
  CODE_AGENT_ROOT_PATH,
  CODE_PROJECT_SETTINGS_PATH,
  resolveCodeWorkflowPath,
} from "../modules/code/routes";
import {
  MODEL_AGENT_ROOT_PATH,
  resolveModelWorkflowPath,
} from "../modules/model/routes";
import type { RouteAccess } from "../router/types";
import { SidebarBackHeader } from "./widgets/sidebar-back-header";
import { UserHoverMenu } from "./widgets/user-hover-menu";

// 描述:
//
//   - 定义客户端侧边栏根组件入参。
interface ClientSidebarProps {
  user: LoginUser;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
  routeAccess: RouteAccess;
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
//   - 定义代码目录与会话分组结构。
interface CodeWorkspaceSessionGroup {
  workspace: CodeWorkspaceGroup;
  sessions: AgentSidebarSession[];
}

// 描述:
//
//   - 定义工具调用事件 data 字段的最小结构，用于安全提取工具名和参数摘要。
interface AgentToolCallEventData {
  name?: string;
  args?: {
    command?: string;
    path?: string;
  };
}

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
    args: {
      command: typeof args?.command === "string" ? args.command : undefined,
      path: typeof args?.path === "string" ? args.path : undefined,
    },
  };
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
  if (pathname.startsWith("/agents/code")) return "code";
  if (pathname.startsWith("/agents/model")) return "model";
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
function matchSidebarMode(pathname: string): "home" | "agent" | "settings" | "ai-key" | "workflow" {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/ai-keys")) return "ai-key";
  if (pathname.includes("/workflows")) return "workflow";
  if (pathname.startsWith("/agents/")) return "agent";
  return "home";
}

// 描述：将 runtime 会话实体转换为前端侧边栏会话项。
function toAgentSession(agentKey: AgentKey, entity: { id: string; last_at?: string }): AgentSession {
  const updatedAtText = toSessionUpdatedAtText(entity.last_at);
  return {
    id: entity.id,
    agentKey,
    title: "会话详情",
    updatedAt: updatedAtText,
  };
}

// 描述：将会话时间格式化为侧边栏可读文本。
function toSessionUpdatedAtText(lastAt?: string): string {
  if (!lastAt) {
    return "-";
  }
  return new Date(lastAt).toLocaleString("zh-CN", {
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
  onLogout,
  availableAgents,
  routeAccess,
}: {
  user: LoginUser;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
  routeAccess: RouteAccess;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = location.pathname.startsWith("/agents/")
    ? location.pathname.split("/")[2] || ""
    : "";
  const homeSidebarItems = useMemo(
    () => resolveHomeSidebarAgentItems(availableAgents, routeAccess),
    [availableAgents, routeAccess],
  );
  // 描述：解析首页顶部工具栏入口（工作流、技能）。
  const homeToolbarEntries = useMemo(() => {
    const workflowEnabled = routeAccess.isModuleEnabled("workflow");
    const workflowPath = routeAccess.isAgentEnabled("code")
      ? resolveCodeWorkflowPath("")
      : routeAccess.isAgentEnabled("model")
        ? resolveModelWorkflowPath("")
        : "";
    return [
      {
        key: "workflow",
        label: "工作流",
        icon: "account_tree",
        enabled: workflowEnabled && Boolean(workflowPath),
        path: workflowPath,
        deniedMessage: workflowEnabled
          ? "当前账号暂无可用工作流入口。"
          : "当前构建未启用工作流模块。",
      },
      {
        key: "skills",
        label: "技能",
        icon: "new_releases",
        enabled: routeAccess.isModuleEnabled("skill"),
        path: SKILL_PAGE_PATH,
        deniedMessage: "当前构建未启用技能模块。",
      },
    ];
  }, [routeAccess]);

  // 描述：根据当前路径同步首页工具栏选中态。
  const selectedToolbarKey = useMemo(() => {
    if (location.pathname.startsWith(SKILL_PAGE_PATH)) {
      return "skills";
    }
    if (location.pathname.includes("/workflows")) {
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
                content: target.deniedMessage,
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
                content: target.deniedMessage || "当前入口不可用。",
                duration: 2500,
              });
              return;
            }
            navigate(target.path);
          }}
        />
      </AriContainer>

      <AriContainer className="desk-sidebar-spacer" />
      <UserHoverMenu user={user} onLogout={onLogout} routeAccess={routeAccess} />
    </AriContainer>
  );
}

// 描述:
//
//   - 渲染智能体侧边栏，统一承载会话列表、目录树与右键菜单操作。
function AgentSidebar({
  user,
  onLogout,
  agentKey,
  routeAccess,
}: {
  user: LoginUser;
  onLogout: () => Promise<void>;
  agentKey: AgentKey;
  routeAccess: RouteAccess;
}) {
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
  const [workspaceGroups, setWorkspaceGroups] = useState<CodeWorkspaceGroup[]>([]);
  const [codeWorkspaceExpandedKeys, setCodeWorkspaceExpandedKeys] = useState<string[]>([]);
  const [openWorkspaceActionMenuId, setOpenWorkspaceActionMenuId] = useState("");
  const [creatingWorkspaceSessionId, setCreatingWorkspaceSessionId] = useState("");
  const [sessionMenuRenderVersion, setSessionMenuRenderVersion] = useState(0);
  const missingSessionSyncAttemptsRef = useRef<Record<string, number>>({});
  const suppressNextSessionSelectIdRef = useRef("");

  const isCodeAgent = agentKey === "code";
  const selectedSessionKey = location.pathname.includes("/session/")
    ? location.pathname.split("/").pop() || ""
    : "";
  const selectedWorkspaceFromQuery = useMemo(() => {
    if (!isCodeAgent) {
      return "";
    }
    return new URLSearchParams(location.search).get("workspaceId")?.trim() || "";
  }, [isCodeAgent, location.search]);
  const isCodeProjectSettingsPath = isCodeAgent && location.pathname.startsWith(CODE_PROJECT_SETTINGS_PATH);

  // 描述：构建代码目录父菜单 key，避免与会话 key 冲突。
  const buildWorkspaceMenuKey = (workspaceId: string) => `workspace:${workspaceId}`;

  // 描述：从代码目录父菜单 key 中提取目录 ID。
  const parseWorkspaceIdFromMenuKey = (key: string) => {
    if (!key.startsWith("workspace:")) {
      return "";
    }
    return key.slice("workspace:".length).trim();
  };

  // 描述：刷新代码目录分组缓存，并同步默认展开状态。
  const refreshWorkspaceGroups = () => {
    if (!isCodeAgent) {
      setWorkspaceGroups([]);
      return;
    }
    setWorkspaceGroups(listCodeWorkspaceGroups());
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

      if (isCodeAgent) {
        let latestGroups = listCodeWorkspaceGroups();
        const fallbackWorkspaceId = getLastUsedCodeWorkspaceId() || latestGroups[0]?.id || "";
        if (fallbackWorkspaceId) {
          let rebound = false;
          normalizedSessions.forEach((item) => {
            const workspaceId = getCodeWorkspaceIdBySessionId(item.id);
            if (!workspaceId) {
              bindCodeSessionWorkspace(item.id, fallbackWorkspaceId);
              rebound = true;
            }
          });
          if (rebound) {
            latestGroups = listCodeWorkspaceGroups();
          }
        }
        setWorkspaceGroups(latestGroups);
      }
    } catch (_err) {
      setSessions([]);
      if (isCodeAgent) {
        refreshWorkspaceGroups();
      }
    } finally {
      setLoading(false);
    }
  };

  // 描述：新增入口始终进入代码项目选择页，避免在侧边栏直接绑定旧目录上下文。
  const handleCreateSession = () => {
    setPendingDeleteSessionId("");
    if (isCodeAgent) {
      navigate(CODE_AGENT_ROOT_PATH);
      return;
    }
    navigate(MODEL_AGENT_ROOT_PATH);
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
    return [...sessions].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }, [sessionSortMode, sessions]);

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
      return { key, intro: "已接收需求，开始规划执行", step: text || "正在准备执行...", status: "running" as const };
    }
    if (payload.kind === STREAM_KINDS.LLM_STARTED) {
      return { key, intro: "正在处理当前步骤", step: text || "模型会话已开始，正在执行策略…", status: "running" as const };
    }
    if (payload.kind === STREAM_KINDS.LLM_FINISHED) {
      return { key, intro: "当前步骤已完成", step: text || "当前生成步骤已完成，正在整理输出…", status: "finished" as const };
    }
    if (payload.kind === STREAM_KINDS.FINISHED || payload.kind === STREAM_KINDS.FINAL) {
      return { key, intro: "当前步骤已完成", step: text || "执行结束，正在整理最终输出…", status: "finished" as const };
    }
    if (payload.kind === STREAM_KINDS.CANCELLED) {
      return { key, intro: "任务已取消", step: text || "任务已终止，不再继续执行。", status: "finished" as const };
    }
    if (payload.kind === STREAM_KINDS.PLANNING) {
      return { key, intro: "智能体正在思考", step: text || "正在规划执行策略…", status: "running" as const };
    }
    if (payload.kind === STREAM_KINDS.TOOL_CALL_STARTED) {
      const data = resolveToolCallEventData(payload);
      let detail = "";
      if (data.name) {
        if (data.name === "run_shell" && data.args?.command) {
          detail = data.args.command.substring(0, 30);
          if (data.args.command.length > 30) detail += "...";
        } else if (data.args?.path) {
          detail = data.args.path;
        }
      }
      const suffix = detail ? ` [${detail}]` : "";
      return { key, intro: "正在执行工具", step: text ? `${text}${suffix}` : `正在调用系统工具…`, status: "running" as const };
    }
    if (payload.kind === STREAM_KINDS.TOOL_CALL_FINISHED) {
      return { key, intro: "工具执行结果", step: text || "任务步骤执行完成", status: "finished" as const };
    }
    if (payload.kind === STREAM_KINDS.HEARTBEAT) {
      return { key, intro: "任务处理中", step: text || "操作较长，请耐心等待…", status: "running" as const };
    }
    if (payload.kind === STREAM_KINDS.ERROR) {
      const errorCode = resolveStreamErrorCode(payload);
      if (isCancelErrorCode(errorCode)) {
        return { key, intro: "任务已取消", step: text || "任务已终止，不再继续执行。", status: "finished" as const };
      }
      return { key, intro: "执行中断，正在处理", step: text || "执行失败，请查看详情后重试。", status: "failed" as const };
    }
    if (!text) {
      return null;
    }
    return { key, intro: "执行进度更新", step: text, status: "running" as const };
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
  }): SessionRunMeta => {
    const normalizedSegments = (current.segments || []).map((item) =>
      item.status === "running" ? { ...item, status: "finished" as const } : item,
    );
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

    const deletingWorkspaceId = isCodeAgent
      ? getCodeWorkspaceIdBySessionId(sessionId) || selectedWorkspaceFromQuery || getLastUsedCodeWorkspaceId()
      : "";

    // 描述：执行删除时先本地移除会话，避免后端状态更新延迟导致“已确认仍可见”。
    removeAgentSession(agentKey, sessionId);
    setSessions((prev) => prev.filter((item) => item.id !== sessionId));
    reloadSessionSidebarMenu();
    setPendingDeleteSessionId("");
    if (selectedSessionKey === sessionId) {
      if (isCodeAgent && deletingWorkspaceId) {
        navigate(`/agents/code?workspaceId=${encodeURIComponent(deletingWorkspaceId)}`);
      } else {
        navigate(`/agents/${agentKey}`);
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
    removeCodeWorkspaceGroup(workspaceId);
    reloadSessionSidebarMenu();
    const fallbackWorkspaceId = getLastUsedCodeWorkspaceId();
    refreshWorkspaceGroups();
    if (!location.pathname.includes("/session/")) {
      if (fallbackWorkspaceId) {
        navigate(`/agents/code?workspaceId=${encodeURIComponent(fallbackWorkspaceId)}`);
      } else {
        navigate("/agents/code");
      }
    }
    void refreshSessions();
  };

  // 描述：选中目录分组后进入统一“新建会话”页面，并记住最近使用目录。
  const openWorkspaceComposePage = (workspaceId: string) => {
    if (!workspaceId) {
      return;
    }
    setLastUsedCodeWorkspaceId(workspaceId);
    navigate(`/agents/code?workspaceId=${encodeURIComponent(workspaceId)}`);
  };

  // 描述：打开项目设置页面，保持目录上下文并仅切换主内容区域。
  const openWorkspaceSettingsPage = (workspaceId: string) => {
    if (!workspaceId) {
      return;
    }
    const workspaceMenuKey = buildWorkspaceMenuKey(workspaceId);
    setCodeWorkspaceExpandedKeys((current) => {
      const next = new Set([...current, workspaceMenuKey]);
      return [...next];
    });
    setLastUsedCodeWorkspaceId(workspaceId);
    navigate(`${CODE_PROJECT_SETTINGS_PATH}?workspaceId=${encodeURIComponent(workspaceId)}`);
  };

  // 描述：在指定项目下创建新话题并跳转到会话页，保持项目上下文绑定。
  //
  // Params:
  //
  //   - workspaceId: 目标项目 ID。
  const handleCreateSessionInWorkspace = async (workspaceId: string) => {
    if (!workspaceId || !isCodeAgent || creatingWorkspaceSessionId) {
      return;
    }
    setCreatingWorkspaceSessionId(workspaceId);
    try {
      const created = await createRuntimeSession(user.id, "code");
      if (!created.id) {
        AriMessage.warning({
          content: "创建话题失败，请稍后重试。",
          duration: 2500,
        });
        return;
      }
      bindCodeSessionWorkspace(created.id, workspaceId);
      setLastUsedCodeWorkspaceId(workspaceId);
      navigate(`/agents/code/session/${created.id}?workspaceId=${encodeURIComponent(workspaceId)}`);
    } catch (_err) {
      AriMessage.warning({
        content: "创建话题失败，请稍后重试。",
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
    const deletingWorkspaceId = isCodeAgent
      ? getCodeWorkspaceIdBySessionId(sessionId) || selectedWorkspaceFromQuery || getLastUsedCodeWorkspaceId()
      : "";

    // 描述：右键删除同样采用本地优先移除，确保交互结果即时可见。
    removeAgentSession(agentKey, sessionId);
    setSessions((prev) => prev.filter((item) => item.id !== sessionId));
    reloadSessionSidebarMenu();
    if (selectedSessionKey === sessionId) {
      if (isCodeAgent && deletingWorkspaceId) {
        navigate(`/agents/code?workspaceId=${encodeURIComponent(deletingWorkspaceId)}`);
      } else {
        navigate(`/agents/${agentKey}`);
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

  // 描述：点击会话项后导航到会话详情，代码智能体会携带目录分组上下文。
  const handleSelectSession = (sessionKey: string) => {
    if (!sessionKey) {
      return;
    }
    if (suppressNextSessionSelectIdRef.current && suppressNextSessionSelectIdRef.current === sessionKey) {
      // 描述：点击会话 action 按钮时，忽略组件内部可能冒泡触发的 onSelect，避免误导航与确认态被清空。
      suppressNextSessionSelectIdRef.current = "";
      return;
    }
    if (!isCodeAgent) {
      navigate(`${MODEL_AGENT_ROOT_PATH}/session/${sessionKey}`);
      return;
    }
    const workspaceId = getCodeWorkspaceIdBySessionId(sessionKey)
      || selectedWorkspaceFromQuery
      || getLastUsedCodeWorkspaceId()
      || workspaceGroups[0]?.id
      || "";
    if (workspaceId) {
      setLastUsedCodeWorkspaceId(workspaceId);
    }
    const search = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    navigate(`${CODE_AGENT_ROOT_PATH}/session/${sessionKey}${search}`);
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
  const codeWorkspaceSessionGroups = useMemo<CodeWorkspaceSessionGroup[]>(() => {
    if (!isCodeAgent) {
      return [];
    }
    const fallbackWorkspaceId = getLastUsedCodeWorkspaceId() || workspaceGroups[0]?.id || "";
    const byWorkspaceId = new Map<string, AgentSidebarSession[]>();
    workspaceGroups.forEach((group) => {
      byWorkspaceId.set(group.id, []);
    });

    displayedSessions.forEach((sessionItem) => {
      const workspaceId = getCodeWorkspaceIdBySessionId(sessionItem.id) || fallbackWorkspaceId;
      if (!workspaceId || !byWorkspaceId.has(workspaceId)) {
        return;
      }
      byWorkspaceId.get(workspaceId)?.push(sessionItem);
    });

    return workspaceGroups.map((workspace) => ({
      workspace,
      sessions: byWorkspaceId.get(workspace.id) || [],
    }));
  }, [displayedSessions, isCodeAgent, workspaceGroups]);

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
          label={deletingSessionId === item.id ? "删除中" : pendingDeleteSessionId === item.id ? "确定" : undefined}
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

  // 描述：构建代码目录树菜单项，使用 AriMenu children 统一承载“目录 -> 会话”层级结构。
  const codeWorkspaceMenuItems = useMemo(() => {
    if (!isCodeAgent) {
      return [];
    }
    return codeWorkspaceSessionGroups.map((group) => ({
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
                  { key: "edit", label: "编辑", icon: "edit" },
                  { key: "delete", label: "删除", icon: "delete", fillIcon: "delete_fill" },
                ]}
                onSelect={(key: string) => {
                  setOpenWorkspaceActionMenuId("");
                  if (key === "edit") {
                    openWorkspaceSettingsPage(group.workspace.id);
                    return;
                  }
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
              aria-label="项目更多操作"
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
            icon="edit"
            aria-label="在项目内新增话题"
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
    codeWorkspaceSessionGroups,
    creatingWorkspaceSessionId,
    deletingSessionId,
    hoveredDeleteSessionId,
    hoveredPinSessionId,
    isCodeAgent,
    openWorkspaceActionMenuId,
    pendingDeleteSessionId,
  ]);

  // 描述：处理代码目录树菜单点击，父节点用于切换目录，子节点用于进入会话。
  const handleSelectCodeWorkspaceMenuItem = (key: string) => {
    const workspaceId = parseWorkspaceIdFromMenuKey(key);
    if (workspaceId) {
      openWorkspaceComposePage(workspaceId);
      return;
    }
    handleSelectSession(key);
  };

  // 描述：根据当前路由计算代码目录树选中项，仅在具体会话页高亮会话，避免项目页出现整组激活态。
  const selectedCodeWorkspaceMenuKey = useMemo(() => {
    if (!isCodeAgent) {
      return "";
    }
    if (isCodeProjectSettingsPath) {
      return "";
    }
    if (selectedSessionKey) {
      return selectedSessionKey;
    }
    return "";
  }, [isCodeAgent, isCodeProjectSettingsPath, selectedSessionKey]);

  // 描述：计算代码目录树默认展开项，确保当前目录对应父节点默认展开。
  const defaultExpandedWorkspaceKeys = useMemo(() => {
    if (!isCodeAgent) {
      return [];
    }
    const fallbackWorkspaceId = selectedWorkspaceFromQuery || getLastUsedCodeWorkspaceId() || workspaceGroups[0]?.id || "";
    if (!fallbackWorkspaceId) {
      return [];
    }
    return [buildWorkspaceMenuKey(fallbackWorkspaceId)];
  }, [isCodeAgent, selectedWorkspaceFromQuery, workspaceGroups]);

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
          label: contextTargetSession?.pinned ? "取消固定会话" : "固定会话",
          icon: "pinboard",
          fillIcon: "pinboard_fill",
          forceFill: Boolean(contextTargetSession?.pinned),
        }),
      },
      {
        key: "rename",
        label: renderContextMenuItemLabel({
          key: "rename",
          label: "重命名会话",
          icon: "edit",
          fillIcon: "edit_fill",
        }),
      },
      {
        key: "delete",
        label: renderContextMenuItemLabel({
          key: "delete",
          label: "删除会话",
          icon: "delete",
          fillIcon: "delete_fill",
        }),
      },
    ];
  }, [contextTargetSession?.pinned, hoveredContextMenuActionKey]);

  useEffect(() => {
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey, user.id]);

  useEffect(() => {
    setPendingDeleteSessionId("");
    setContextSessionId("");
    setOpenWorkspaceActionMenuId("");
    setHoveredPinSessionId("");
    setHoveredDeleteSessionId("");
    setHoveredContextMenuActionKey("");
    setCodeWorkspaceExpandedKeys([]);
    setSessionSortMode("default");
    suppressNextSessionSelectIdRef.current = "";
  }, [location.pathname, agentKey]);

  useEffect(() => {
    if (!isCodeAgent) {
      return;
    }
    if (selectedWorkspaceFromQuery) {
      setLastUsedCodeWorkspaceId(selectedWorkspaceFromQuery);
    }
  }, [isCodeAgent, selectedWorkspaceFromQuery]);

  useEffect(() => {
    if (!isCodeAgent || !selectedSessionKey) {
      return;
    }
    const workspaceId = getCodeWorkspaceIdBySessionId(selectedSessionKey);
    if (workspaceId) {
      setLastUsedCodeWorkspaceId(workspaceId);
    }
  }, [isCodeAgent, selectedSessionKey]);

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
    if (!isCodeAgent) {
      return;
    }
    if (defaultExpandedWorkspaceKeys.length === 0) {
      return;
    }
    setCodeWorkspaceExpandedKeys((prev) => {
      const next = new Set([...prev, ...defaultExpandedWorkspaceKeys]);
      return [...next];
    });
  }, [defaultExpandedWorkspaceKeys, isCodeAgent]);

  useEffect(() => {
    if (!isCodeAgent || !IS_BROWSER) {
      return;
    }
    // 描述：监听代码目录分组变更事件，保证新增目录后侧边栏目录树即时刷新。
    const onCodeWorkspaceGroupsUpdated = () => {
      setWorkspaceGroups(listCodeWorkspaceGroups());
    };
    window.addEventListener(CODE_WORKSPACE_GROUPS_UPDATED_EVENT, onCodeWorkspaceGroupsUpdated as EventListener);
    return () => {
      window.removeEventListener(CODE_WORKSPACE_GROUPS_UPDATED_EVENT, onCodeWorkspaceGroupsUpdated as EventListener);
    };
  }, [isCodeAgent]);

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
    if (!isCodeAgent) {
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
      const now = Date.now();
      const snapshot = getSessionRunState("code", sessionId);
      const activeMessageId = String(snapshot?.activeMessageId || "").trim() || `assistant-stream-${now}`;
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
      if (payload.kind === STREAM_KINDS.FINISHED || payload.kind === STREAM_KINDS.FINAL) {
        nextMeta.status = "finished";
        nextMeta.finishedAt = now;
        if (!nextMeta.summary.trim()) {
          nextMeta.summary = String(payload.message || "").trim();
        }
        nextSending = false;
      } else if (payload.kind === STREAM_KINDS.CANCELLED) {
        nextMeta.status = "finished";
        nextMeta.finishedAt = now;
        nextMeta.summary = String(payload.message || "").trim() || nextMeta.summary || "任务已取消";
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
      upsertSessionRunState({
        agentKey: "code",
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
  }, [isCodeAgent]);

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
      <SidebarBackHeader onBack={() => navigate("/home")} label="Home" />
      <AriContainer className="desk-sidebar-toolbar" padding={0}>
        <AriMenu
          className="desk-sidebar-nav"
          items={[
            {
              key: "create-project",
              icon: "note_stack_add",
              label: "新项目",
            },
          ]}
          onSelect={() => {
            handleCreateSession();
          }}
        />
      </AriContainer>
      <AriFlex className="desk-agent-session-header" align="center" justify="space-between">
        <AriTypography variant="caption" value="项目" />
        <AriFlex className="desk-agent-session-header-actions" align="center" space={4}>
          <AriButton
            size="sm"
            type="text"
            ghost
            icon="note_stack_add"
            aria-label="新项目"
            onClick={handleCreateSession}
          />
          <AriButton
            size="sm"
            type="text"
            ghost
            icon="sort"
            color={sessionSortMode === "name" ? "primary" : "default"}
            aria-label="排序"
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
          {isCodeAgent ? (
            codeWorkspaceMenuItems.length > 0 ? (
              <AriMenu
                key={`code-workspace-menu-${sessionMenuRenderVersion}`}
                className="desk-sidebar-nav desk-code-workspace-tree"
                mode="vertical"
                expandIconPosition="none"
                items={codeWorkspaceMenuItems}
                selectedKey={selectedCodeWorkspaceMenuKey}
                defaultExpandedKeys={defaultExpandedWorkspaceKeys}
                expandedKeys={codeWorkspaceExpandedKeys}
                onExpand={setCodeWorkspaceExpandedKeys}
                onSelect={(key: string) => {
                  handleSelectCodeWorkspaceMenuItem(key);
                }}
              />
            ) : (
              <AriContainer className="desk-code-workspace-empty">
                <AriTypography variant="caption" value="请先在“新增”页面选择至少一个工作目录。" />
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
      <UserHoverMenu user={user} onLogout={onLogout} routeAccess={routeAccess} />

      <AriModal
        visible={renameModalVisible}
        title="重命名会话"
        onClose={() => {
          setRenameModalVisible(false);
          setRenamingSessionId("");
          setRenameValue("");
        }}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              label="取消"
              onClick={() => {
                setRenameModalVisible(false);
                setRenamingSessionId("");
                setRenameValue("");
              }}
            />
            <AriButton
              color="brand"
              label="确定"
              onClick={handleConfirmRename}
            />
          </AriFlex>
        )}
      >
        <AriInput
          variant="borderless"
          value={renameValue}
          onChange={setRenameValue}
          placeholder="输入新的会话标题"
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
  onLogout,
  agentKey,
  routeAccess,
}: {
  user: LoginUser;
  onLogout: () => Promise<void>;
  agentKey: AgentKey;
  routeAccess: RouteAccess;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [workflowVersion, setWorkflowVersion] = useState(0);
  const [pendingDeleteWorkflowId, setPendingDeleteWorkflowId] = useState("");
  const [hoveredDeleteWorkflowId, setHoveredDeleteWorkflowId] = useState("");
  const [createButtonHovered, setCreateButtonHovered] = useState(false);
  const isModelAgent = agentKey === "model";

  // 描述：解析当前路由中的 workflowId，用于高亮当前菜单项。
  const selectedWorkflowIdFromQuery = useMemo(
    () => new URLSearchParams(location.search).get("workflowId")?.trim() || "",
    [location.search],
  );

  // 描述：读取当前智能体可用工作流列表，供侧边栏菜单渲染。
  const workflows = useMemo(
    () => (isModelAgent ? listModelWorkflows() : listCodeWorkflows()),
    [isModelAgent, workflowVersion, selectedWorkflowIdFromQuery],
  );

  // 描述：归一化当前选中工作流 ID，查询参数为空或非法时回退到首项。
  const selectedWorkflowId = useMemo(() => {
    if (selectedWorkflowIdFromQuery && workflows.some((item) => item.id === selectedWorkflowIdFromQuery)) {
      return selectedWorkflowIdFromQuery;
    }
    return workflows[0]?.id || "";
  }, [selectedWorkflowIdFromQuery, workflows]);

  // 描述：导航到工作流编辑页并携带 workflowId 参数，保证画布页和侧边栏选中态一致。
  const navigateToWorkflowPage = (workflowId: string, replace = false) => {
    const targetPath = isModelAgent
      ? resolveModelWorkflowPath(workflowId)
      : resolveCodeWorkflowPath(workflowId);
    navigate(targetPath, replace ? { replace: true } : undefined);
  };

  // 描述：当 query 丢失或无效时自动修正 URL，避免画布页和侧边栏选中不一致。
  useEffect(() => {
    if (selectedWorkflowId === selectedWorkflowIdFromQuery) {
      return;
    }
    navigateToWorkflowPage(selectedWorkflowId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflowId, selectedWorkflowIdFromQuery]);

  // 描述：路由变化时清空删除确认态，避免跨工作流残留“确定删除”状态。
  useEffect(() => {
    setPendingDeleteWorkflowId("");
    setHoveredDeleteWorkflowId("");
  }, [location.pathname, location.search]);

  // 描述：基于当前选中工作流创建新工作流，并自动切换到新建项继续编辑。
  const handleCreateWorkflow = () => {
    const created = isModelAgent
      ? createModelWorkflowFromTemplate(selectedWorkflowId || undefined)
      : createCodeWorkflowFromTemplate(selectedWorkflowId || undefined);
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

    const targetWorkflow = workflows.find((item) => item.id === workflowId);
    const deleted = isModelAgent
      ? deleteModelWorkflow(workflowId)
      : deleteCodeWorkflow(workflowId);
    if (!deleted) {
      const warningContent = !targetWorkflow
        ? "工作流不存在或已删除，请刷新后重试。"
        : targetWorkflow.shared
          ? "默认工作流不可删除，请先复制后再管理。"
          : "工作流删除失败，请稍后重试。";
      AriMessage.warning({
        content: warningContent,
        duration: 3000,
        showClose: true,
      });
      setPendingDeleteWorkflowId("");
      return;
    }

    setWorkflowVersion((value) => value + 1);
    setPendingDeleteWorkflowId("");

    if (selectedWorkflowId === workflowId) {
      const nextWorkflows = isModelAgent ? listModelWorkflows() : listCodeWorkflows();
      navigateToWorkflowPage(nextWorkflows[0]?.id || "", true);
    }
  };

  // 描述：构建工作流菜单定义，支持图标删除与 hover 动作展示。
  const workflowMenuItems = useMemo(
    () =>
      workflows.map((item) => ({
        key: item.id,
        label: item.name,
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
            label={pendingDeleteWorkflowId === item.id ? "确定" : undefined}
            onMouseEnter={() => {
              setHoveredDeleteWorkflowId(item.id);
            }}
            onMouseLeave={() => {
              setHoveredDeleteWorkflowId((current) => (current === item.id ? "" : current));
              setPendingDeleteWorkflowId((current) => (current === item.id ? "" : current));
            }}
            onClick={(event: MouseEvent<HTMLElement>) => {
              handleDeleteWorkflow(event, item.id);
            }}
          />
        ),
        showActionsOnHover: true,
      })),
    [workflows, pendingDeleteWorkflowId, hoveredDeleteWorkflowId],
  );

  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader
        onBack={() => navigate(`/agents/${agentKey}/settings`)}
        label="返回"
        rightAction={(
          <AriButton
            icon={createButtonHovered ? "note_stack_add_fill" : "note_stack_add"}
            label="新增"
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
          selectedKey={selectedWorkflowId}
          onSelect={(key: string) => {
            setPendingDeleteWorkflowId("");
            navigateToWorkflowPage(key);
          }}
        />
      </AriContainer>

      <AriContainer className="desk-sidebar-spacer" />
      <UserHoverMenu user={user} onLogout={onLogout} routeAccess={routeAccess} />
    </AriContainer>
  );
}

// 描述:
//
//   - 渲染设置页侧边栏，承载通用与智能体设置入口。
function SettingsSidebar({
  user,
  onLogout,
  routeAccess,
}: {
  user: LoginUser;
  onLogout: () => Promise<void>;
  routeAccess: RouteAccess;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  // 描述：根据权限与模块开关解析可见设置菜单项。
  const settingItems = useMemo(() => resolveSettingsSidebarItems(routeAccess), [routeAccess]);
  // 描述：根据当前路径计算设置菜单选中态。
  const selectedSettingKey = useMemo(() => {
    if (location.pathname.includes("/agents/model/settings") && routeAccess.isAgentEnabled("model")) {
      return "model";
    }
    if (location.pathname.includes("/agents/code/settings") && routeAccess.isAgentEnabled("code")) {
      return "code";
    }
    return "general";
  }, [location.pathname, routeAccess]);

  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader onBack={() => navigate("/home")} label="Home" />
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
      <UserHoverMenu user={user} onLogout={onLogout} routeAccess={routeAccess} />
    </AriContainer>
  );
}

// 描述:
//
//   - 渲染 AI Key 页面侧边栏文案与返回入口。
function AiKeySidebar({
  user,
  onLogout,
  routeAccess,
}: {
  user: LoginUser;
  onLogout: () => Promise<void>;
  routeAccess: RouteAccess;
}) {
  const navigate = useNavigate();
  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader onBack={() => navigate("/home")} label="Home" />
      <AriContainer className="desk-sidebar-section">
        <AriTypography variant="h4" value={AI_KEY_SIDEBAR_CONTENT.title} />
        <AriTypography variant="caption" value={AI_KEY_SIDEBAR_CONTENT.description} />
      </AriContainer>
      <AriContainer className="desk-sidebar-spacer" />
      <UserHoverMenu user={user} onLogout={onLogout} routeAccess={routeAccess} />
    </AriContainer>
  );
}

// 描述:
//
//   - 侧边栏总入口，根据路由模式切换 home/agent/settings/workflow/ai-key 视图。
export function ClientSidebar({ user, onLogout, availableAgents, routeAccess }: ClientSidebarProps) {
  const location = useLocation();
  const mode = matchSidebarMode(location.pathname);
  const agentKey = matchAgentKey(location.pathname);

  if (mode === "settings") {
    return <SettingsSidebar user={user} onLogout={onLogout} routeAccess={routeAccess} />;
  }

  if (mode === "ai-key") {
    return <AiKeySidebar user={user} onLogout={onLogout} routeAccess={routeAccess} />;
  }

  if (mode === "workflow" && agentKey) {
    return (
      <WorkflowsSidebar
        user={user}
        onLogout={onLogout}
        agentKey={agentKey}
        routeAccess={routeAccess}
      />
    );
  }

  if (mode === "agent" && agentKey) {
    return <AgentSidebar user={user} onLogout={onLogout} agentKey={agentKey} routeAccess={routeAccess} />;
  }

  return (
    <HomeSidebar
      user={user}
      onLogout={onLogout}
      availableAgents={availableAgents}
      routeAccess={routeAccess}
    />
  );
}
