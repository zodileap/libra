import { useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import {
  AriButton,
  AriContainer,
  AriContextMenu,
  AriFlex,
  AriIcon,
  AriInput,
  AriMenu,
  AriModal,
  AriTooltip,
  AriTypography,
} from "aries_react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AGENTS,
  getAgentSessionMetaSnapshot,
  removeAgentSession,
  renameAgentSession,
  resolveAgentSessionTitle,
  togglePinnedAgentSession,
  upsertModelProject,
} from "../../data";
import { createRuntimeSession, listRuntimeSessions, updateRuntimeSessionStatus } from "../../services/backend-api";
import type { AgentKey, AgentSession, AuthAvailableAgentItem, LoginUser } from "../../types";

interface ClientSidebarProps {
  user: LoginUser;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
}

interface AgentSidebarSession extends AgentSession {
  pinned: boolean;
}

function matchAgentKey(pathname: string): AgentKey | null {
  if (pathname.startsWith("/agents/code")) return "code";
  if (pathname.startsWith("/agents/model")) return "model";
  return null;
}

function matchSidebarMode(pathname: string): "home" | "agent" | "settings" | "ai-key" {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/ai-keys")) return "ai-key";
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

// 描述：统一管理侧边栏入口图标的 fill 变体，避免在 JSX 中散落硬编码。
const SIDEBAR_ICON_FILL_MAP: Record<string, string> = {
  person: "person_fill",
  settings: "settings_fill",
  account_tree: "account_tree_fill",
};

// 描述：根据 hover/focus 状态返回入口图标名，优先使用 fill 图标，不存在则回退原图标。
//
// Params:
//
//   - icon: 基础图标名。
//   - highlighted: 是否高亮（hover/focus）。
//
// Returns:
//
//   - 当前应展示的图标名。
function resolveSidebarEntryIcon(icon: string, highlighted: boolean): string {
  if (!highlighted) {
    return icon;
  }
  return SIDEBAR_ICON_FILL_MAP[icon] || icon;
}

// 描述：渲染侧边栏统一入口内容，保证“左图标 + 右文本”在用户入口和快捷入口间一致。
//
// Params:
//
//   - icon: 左侧图标名称。
//   - label: 入口文本。
//   - highlighted: 是否进入 hover/focus 高亮态。
function SidebarEntryContent({
  icon,
  label,
  highlighted,
}: {
  icon: string;
  label: string;
  highlighted: boolean;
}) {
  return (
    <AriFlex className="desk-sidebar-entry-content" align="center" space={8}>
      <AriIcon name={resolveSidebarEntryIcon(icon, highlighted)} />
      <AriTypography className="desk-sidebar-entry-text" variant="body" value={label} />
    </AriFlex>
  );
}

function UserHoverMenu({
  user,
  onLogout,
}: {
  user: LoginUser;
  onLogout: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [entryHovered, setEntryHovered] = useState(false);
  const menuItems = useMemo(
    () => [
      {
        key: "settings",
        label: "设置",
        icon: "settings",
      },
      {
        key: "ai-key",
        label: "AI Key",
        icon: "vpn_key",
      },
      {
        key: "logout",
        label: "登出",
        icon: "logout",
      },
    ],
    [],
  );

  const content = (
    <AriMenu
      items={menuItems}
      onSelect={(key) => {
        if (key === "settings") navigate("/settings/general");
        if (key === "ai-key") navigate("/ai-keys");
        if (key === "logout") {
          void onLogout();
        }
      }}
    />
  );

  return (
    <AriTooltip content={content} position="top" matchTriggerWidth>
      <AriContainer
        className="desk-user-trigger-wrap"
        onMouseEnter={() => setEntryHovered(true)}
        onMouseLeave={() => setEntryHovered(false)}
      >
        <button
          type="button"
          className="desk-user-trigger desk-user-trigger-btn"
          aria-label="用户菜单"
          onFocus={() => setEntryHovered(true)}
          onBlur={() => setEntryHovered(false)}
        >
          <SidebarEntryContent
            icon="person"
            label={user.name}
            highlighted={entryHovered}
          />
        </button>
      </AriContainer>
    </AriTooltip>
  );
}

// 描述：渲染侧边栏快捷入口，与用户入口保持同款样式，避免底部视觉割裂。
//
// Params:
//
//   - label: 入口文案。
//   - icon: 入口图标名称。
//   - onClick: 点击回调。
function SidebarQuickAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  const [entryHovered, setEntryHovered] = useState(false);

  return (
    <AriContainer
      className="desk-user-trigger-wrap"
      onMouseEnter={() => setEntryHovered(true)}
      onMouseLeave={() => setEntryHovered(false)}
    >
      <button
        type="button"
        className="desk-user-trigger desk-user-trigger-btn desk-sidebar-quick-action"
        onClick={onClick}
        onFocus={() => setEntryHovered(true)}
        onBlur={() => setEntryHovered(false)}
      >
        <SidebarEntryContent icon={icon} label={label} highlighted={entryHovered} />
      </button>
    </AriContainer>
  );
}

function SidebarBackHeader({
  onBack,
  label = "Back",
  rightAction,
}: {
  onBack: () => void;
  label?: string;
  rightAction?: ReactNode;
}) {
  return (
    <AriFlex justify="space-between" align="center">
      <AriButton icon="arrow_back_ios" label={label} onClick={onBack} />
      {rightAction || <AriContainer />}
    </AriFlex>
  );
}

function HomeSidebar({
  user,
  onLogout,
  availableAgents,
}: {
  user: LoginUser;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = location.pathname.startsWith("/agents/")
    ? location.pathname.split("/")[2] || ""
    : "";

  const authorizedCodes = useMemo(
    () => new Set(availableAgents.map((item) => item.code.toLowerCase())),
    [availableAgents],
  );

  return (
    <AriContainer className="desk-sidebar">
      <AriContainer className="desk-agent-menu">
        <AriMenu
          items={AGENTS.map((agent) => ({
            key: agent.key,
            label: `${agent.name}${authorizedCodes.has(agent.key) ? "（已授权）" : "（未授权）"}`,
          }))}
          selectedKey={selectedKey}
          onSelect={(key) => navigate(`/agents/${key}`)}
        />
      </AriContainer>

      <AriContainer style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} />
    </AriContainer>
  );
}

function AgentSidebar({
  user,
  onLogout,
  agentKey,
}: {
  user: LoginUser;
  onLogout: () => Promise<void>;
  agentKey: AgentKey;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<AgentSidebarSession[]>([]);
  const [creating, setCreating] = useState(false);
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

  const selectedSessionKey = location.pathname.includes("/session/")
    ? location.pathname.split("/").pop() || ""
    : "";

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

      setSessions(mapped.map(({ _originIndex, _pinnedIndex, ...session }) => session));
    } catch (_err) {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  // 描述：创建新会话并跳转到会话详情页。
  const handleCreateSession = async () => {
    if (creating) {
      return;
    }
    setCreating(true);
    try {
      const session = await createRuntimeSession(user.id, agentKey);
      if (!session.id) {
        return;
      }
      if (agentKey === "model") {
        upsertModelProject({
          id: session.id,
          title: "新建模型项目",
          prompt: "",
          updatedAt: toSessionUpdatedAtText(session.last_at),
        });
      }
      setPendingDeleteSessionId("");
      navigate(`/agents/${agentKey}/session/${session.id}`);
    } catch (_err) {
      // 描述：创建失败时保持当前页面，避免误跳转到无效会话。
    } finally {
      setCreating(false);
      void refreshSessions();
    }
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

    // 描述：执行删除时先本地移除会话，避免后端状态更新延迟导致“已确认仍可见”。
    removeAgentSession(agentKey, sessionId);
    setSessions((prev) => prev.filter((item) => item.id !== sessionId));
    setPendingDeleteSessionId("");
    if (selectedSessionKey === sessionId) {
      navigate(`/agents/${agentKey}`);
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
    // 描述：右键删除同样采用本地优先移除，确保交互结果即时可见。
    removeAgentSession(agentKey, sessionId);
    setSessions((prev) => prev.filter((item) => item.id !== sessionId));
    if (selectedSessionKey === sessionId) {
      navigate(`/agents/${agentKey}`);
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
          name={params.forceFill || hoveredContextMenuActionKey === params.key ? params.fillIcon : params.icon}
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
    setCreateButtonHovered(false);
  }, [location.pathname, agentKey]);

  return (
    <AriContainer className="desk-sidebar desk-agent-sidebar">
      <SidebarBackHeader
        onBack={() => navigate("/home")}
        label="Home"
        rightAction={
          <AriButton
            icon={createButtonHovered ? "note_stack_add_fill" : "note_stack_add"}
            label={creating ? "新增中" : "新增"}
            disabled={creating}
            onMouseEnter={() => {
              setCreateButtonHovered(true);
            }}
            onMouseLeave={() => {
              setCreateButtonHovered(false);
            }}
            onClick={() => {
              void handleCreateSession();
            }}
          />
        }
      />

      <AriContextMenu
        className="desk-history-context-menu"
        items={contextMenuItems}
        onOpenChange={(open) => {
          if (!open) {
            setContextSessionId("");
            setHoveredContextMenuActionKey("");
          }
        }}
        onSelect={(key) => {
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
        <AriContainer className="desk-history-menu">
          <AriMenu
            className="desk-sidebar-nav"
            items={sessions.map((item) => ({
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
                    onClick={(event) => {
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
                    onClick={(event) => {
                      void handleDeleteSession(event, item.id);
                    }}
                  />
                </AriFlex>
              ),
              showActionsOnHover: true,
              onContextMenu: (event) => {
                handleOpenSessionContextMenu(event, item.id);
              },
            }))}
            selectedKey={selectedSessionKey}
            onSelect={(key) => navigate(`/agents/${agentKey}/session/${key}`)}
          />
        </AriContainer>
      </AriContextMenu>

      <AriContainer style={{ flex: 1 }} />
      <AriContainer className="desk-sidebar-quick-actions">
        <SidebarQuickAction
          label="智能体设置"
          icon="settings"
          onClick={() => navigate(`/agents/${agentKey}/settings`)}
        />
        <SidebarQuickAction
          label="工作流设置"
          icon="account_tree"
          onClick={() => navigate(`/agents/${agentKey}/workflows`)}
        />
      </AriContainer>
      <UserHoverMenu user={user} onLogout={onLogout} />
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
          value={renameValue}
          onChange={setRenameValue}
          placeholder="输入新的会话标题"
        />
      </AriModal>
    </AriContainer>
  );
}

function SettingsSidebar({ user, onLogout }: { user: LoginUser; onLogout: () => Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader onBack={() => navigate("/home")} label="Home" />
      <AriContainer className="desk-sidebar-section">
        <AriMenu
          items={[
            { key: "general", label: "General" },
            { key: "code", label: "Code Agent" },
            { key: "model", label: "Model Agent" },
          ]}
          selectedKey={
            location.pathname.includes("/agents/model/settings")
              ? "model"
              : location.pathname.includes("/agents/code/settings")
                ? "code"
                : "general"
          }
          onSelect={(key) => {
            if (key === "model") {
              navigate("/agents/model/settings");
              return;
            }
            if (key === "code") {
              navigate("/agents/code/settings");
              return;
            }
            navigate("/settings/general");
          }}
        />
      </AriContainer>
      <AriContainer style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} />
    </AriContainer>
  );
}

function AiKeySidebar({ user, onLogout }: { user: LoginUser; onLogout: () => Promise<void> }) {
  const navigate = useNavigate();
  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader onBack={() => navigate("/home")} label="Home" />
      <AriContainer className="desk-sidebar-section">
        <AriTypography variant="h4" value="AI Key 管理" />
        <AriTypography variant="caption" value="管理本地可用模型提供方密钥。" />
      </AriContainer>
      <AriContainer style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} />
    </AriContainer>
  );
}

export function ClientSidebar({ user, onLogout, availableAgents }: ClientSidebarProps) {
  const location = useLocation();
  const mode = matchSidebarMode(location.pathname);
  const agentKey = matchAgentKey(location.pathname);

  if (mode === "settings") {
    return <SettingsSidebar user={user} onLogout={onLogout} />;
  }

  if (mode === "ai-key") {
    return <AiKeySidebar user={user} onLogout={onLogout} />;
  }

  if (mode === "agent" && agentKey) {
    return <AgentSidebar user={user} onLogout={onLogout} agentKey={agentKey} />;
  }

  return <HomeSidebar user={user} onLogout={onLogout} availableAgents={availableAgents} />;
}
