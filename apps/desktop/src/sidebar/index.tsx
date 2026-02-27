import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
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
  AriTypography,
} from "aries_react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  bindCodeSessionWorkspace,
  getCodeWorkspaceIdBySessionId,
  getLastUsedCodeWorkspaceId,
  getAgentSessionMetaSnapshot,
  listCodeWorkspaceGroups,
  removeAgentSession,
  removeCodeWorkspaceGroup,
  renameCodeWorkspaceGroup,
  renameAgentSession,
  resolveAgentSessionTitle,
  setLastUsedCodeWorkspaceId,
  togglePinnedAgentSession,
  type CodeWorkspaceGroup,
} from "@/shell/data";
import { listRuntimeSessions, updateRuntimeSessionStatus } from "@/shell/services/backend-api";
import type { AgentKey, AgentSession, AuthAvailableAgentItem, LoginUser } from "@/shell/types";
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
} from "../modules/common/routes";
import {
  CODE_AGENT_ROOT_PATH,
  CODE_SIDEBAR_QUICK_ACTIONS,
  resolveCodeWorkflowPath,
} from "../modules/code/routes";
import {
  MODEL_AGENT_ROOT_PATH,
  MODEL_SIDEBAR_QUICK_ACTIONS,
  resolveModelWorkflowPath,
} from "../modules/model/routes";
import type { RouteAccess } from "../router/types";
import { SidebarBackHeader } from "./widgets/sidebar-back-header";
import { SidebarQuickAction } from "./widgets/sidebar-quick-action";
import { UserHoverMenu } from "./widgets/user-hover-menu";

interface ClientSidebarProps {
  user: LoginUser;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
  routeAccess: RouteAccess;
}

interface AgentSidebarSession extends AgentSession {
  pinned: boolean;
}

interface CodeWorkspaceSessionGroup {
  workspace: CodeWorkspaceGroup;
  sessions: AgentSidebarSession[];
}

function matchAgentKey(pathname: string): AgentKey | null {
  if (pathname.startsWith("/agents/code")) return "code";
  if (pathname.startsWith("/agents/model")) return "model";
  return null;
}

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

  return (
    <AriContainer className="desk-sidebar">
      <AriContainer className="desk-agent-menu">
        <AriMenu
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

      <AriContainer style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} routeAccess={routeAccess} />
    </AriContainer>
  );
}

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
  const [createButtonHovered, setCreateButtonHovered] = useState(false);
  const [hoveredPinSessionId, setHoveredPinSessionId] = useState("");
  const [hoveredDeleteSessionId, setHoveredDeleteSessionId] = useState("");
  const [hoveredContextMenuActionKey, setHoveredContextMenuActionKey] = useState("");
  const [workspaceGroups, setWorkspaceGroups] = useState<CodeWorkspaceGroup[]>([]);
  const [codeWorkspaceExpandedKeys, setCodeWorkspaceExpandedKeys] = useState<string[]>([]);
  const [workspaceRenamingId, setWorkspaceRenamingId] = useState("");
  const [workspaceRenameValue, setWorkspaceRenameValue] = useState("");
  const [workspaceRenameModalVisible, setWorkspaceRenameModalVisible] = useState(false);

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

  // 描述：打开目录重命名弹窗。
  const handleOpenWorkspaceRenameModal = (workspaceId: string) => {
    const target = workspaceGroups.find((item) => item.id === workspaceId);
    setWorkspaceRenamingId(workspaceId);
    setWorkspaceRenameValue(target?.name || "");
    setWorkspaceRenameModalVisible(true);
  };

  // 描述：确认目录重命名并刷新目录分组。
  const handleConfirmWorkspaceRename = () => {
    if (!workspaceRenamingId) {
      return;
    }
    renameCodeWorkspaceGroup(workspaceRenamingId, workspaceRenameValue);
    setWorkspaceRenameModalVisible(false);
    setWorkspaceRenamingId("");
    setWorkspaceRenameValue("");
    refreshWorkspaceGroups();
  };

  // 描述：删除目录分组，并在必要时回退到最近可用目录。
  const handleDeleteWorkspace = (workspaceId: string) => {
    if (!workspaceId) {
      return;
    }
    removeCodeWorkspaceGroup(workspaceId);
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

    sessions.forEach((sessionItem) => {
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
  }, [isCodeAgent, sessions, workspaceGroups]);

  // 描述：构建会话菜单项定义，复用会话 hover 动作与右键菜单触发。
  const buildSessionMenuItems = (items: AgentSidebarSession[]) => items.map((item) => ({
    key: item.id,
    label: <AriTypography className="desk-session-item-title" variant="body" value={item.title} />,
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
            handleTogglePinnedSession(event, item.id);
          }}
        />
        <AriButton
          size="sm"
          type="text"
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
            void handleDeleteSession(event, item.id);
          }}
        />
      </AriFlex>
    ),
    showActionsOnHover: true,
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
          <AriButton
            size="sm"
            type="text"
            icon="open_in_new"
            onClick={(event: MouseEvent<HTMLElement>) => {
              event.preventDefault();
              event.stopPropagation();
              openWorkspaceComposePage(group.workspace.id);
            }}
          />
          <AriButton
            size="sm"
            type="text"
            icon="edit"
            onClick={(event: MouseEvent<HTMLElement>) => {
              event.preventDefault();
              event.stopPropagation();
              handleOpenWorkspaceRenameModal(group.workspace.id);
            }}
          />
          <AriButton
            size="sm"
            type="text"
            color="danger"
            icon="delete"
            onClick={(event: MouseEvent<HTMLElement>) => {
              event.preventDefault();
              event.stopPropagation();
              handleDeleteWorkspace(group.workspace.id);
            }}
          />
        </AriFlex>
      ),
      showActionsOnHover: true,
      children: buildSessionMenuItems(group.sessions),
    }));
  }, [codeWorkspaceSessionGroups, isCodeAgent]);

  // 描述：处理代码目录树菜单点击，父节点用于切换目录，子节点用于进入会话。
  const handleSelectCodeWorkspaceMenuItem = (key: string) => {
    const workspaceId = parseWorkspaceIdFromMenuKey(key);
    if (workspaceId) {
      openWorkspaceComposePage(workspaceId);
      return;
    }
    handleSelectSession(key);
  };

  // 描述：根据当前路由计算代码目录树选中项，优先选中会话，其次选中目录。
  const selectedCodeWorkspaceMenuKey = useMemo(() => {
    if (!isCodeAgent) {
      return "";
    }
    if (selectedSessionKey) {
      return selectedSessionKey;
    }
    if (selectedWorkspaceFromQuery) {
      return buildWorkspaceMenuKey(selectedWorkspaceFromQuery);
    }
    return "";
  }, [isCodeAgent, selectedSessionKey, selectedWorkspaceFromQuery]);

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

  const contextTargetSession = sessions.find((item) => item.id === contextSessionId) || null;
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
    setHoveredPinSessionId("");
    setHoveredDeleteSessionId("");
    setHoveredContextMenuActionKey("");
    setCodeWorkspaceExpandedKeys([]);
    setCreateButtonHovered(false);
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

  return (
    <AriContainer className="desk-sidebar desk-agent-sidebar">
      <SidebarBackHeader
        onBack={() => navigate("/home")}
        label="Home"
        rightAction={
          <AriButton
            icon={createButtonHovered ? "note_stack_add_fill" : "note_stack_add"}
            label="新增"
            onMouseEnter={() => {
              setCreateButtonHovered(true);
            }}
            onMouseLeave={() => {
              setCreateButtonHovered(false);
            }}
            onClick={handleCreateSession}
          />
        }
      />

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
                className="desk-sidebar-nav desk-code-workspace-tree"
                mode="vertical"
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
              items={buildSessionMenuItems(sessions)}
              selectedKey={selectedSessionKey}
              onSelect={handleSelectSession}
            />
          )}
        </AriContainer>
      </AriContextMenu>

      <AriContainer style={{ flex: 1 }} />
      {routeAccess.isModuleEnabled("settings") || routeAccess.isModuleEnabled("workflow") ? (
        <AriContainer className="desk-sidebar-quick-actions">
          {(isCodeAgent ? CODE_SIDEBAR_QUICK_ACTIONS : MODEL_SIDEBAR_QUICK_ACTIONS)
            .filter((item) => routeAccess.isModuleEnabled(item.key === "workflow" ? "workflow" : "settings"))
            .map((item) => (
              <SidebarQuickAction
                key={item.key}
                label={item.label}
                icon={item.icon}
                onClick={() => navigate(item.path)}
              />
            ))}
        </AriContainer>
      ) : null}
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
              color="primary"
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

      <AriModal
        visible={workspaceRenameModalVisible}
        title="编辑目录名字"
        onClose={() => {
          setWorkspaceRenameModalVisible(false);
          setWorkspaceRenamingId("");
          setWorkspaceRenameValue("");
        }}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              label="取消"
              onClick={() => {
                setWorkspaceRenameModalVisible(false);
                setWorkspaceRenamingId("");
                setWorkspaceRenameValue("");
              }}
            />
            <AriButton
              color="primary"
              label="确定"
              onClick={handleConfirmWorkspaceRename}
            />
          </AriFlex>
        )}
      >
        <AriInput
          variant="borderless"
          value={workspaceRenameValue}
          onChange={setWorkspaceRenameValue}
          placeholder="输入目录展示名称"
        />
      </AriModal>
    </AriContainer>
  );
}

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

    const deleted = isModelAgent
      ? deleteModelWorkflow(workflowId)
      : deleteCodeWorkflow(workflowId);
    if (!deleted) {
      AriMessage.warning({
        content: "默认工作流不可删除，请先复制后再管理。",
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
            type="text"
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
    <AriContainer className="desk-sidebar desk-agent-sidebar">
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

      <AriContainer style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} routeAccess={routeAccess} />
    </AriContainer>
  );
}

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
  const settingItems = useMemo(() => resolveSettingsSidebarItems(routeAccess), [routeAccess]);
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
      <AriContainer style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} routeAccess={routeAccess} />
    </AriContainer>
  );
}

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
      <AriContainer style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} routeAccess={routeAccess} />
    </AriContainer>
  );
}

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
