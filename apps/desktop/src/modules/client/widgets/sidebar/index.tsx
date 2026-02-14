import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AriAvatar,
  AriButton,
  AriContainer,
  AriFlex,
  AriMenu,
  AriTooltip,
  AriTypography,
} from "aries_react";
import { useLocation, useNavigate } from "react-router-dom";
import { AGENTS } from "../../data";
import { listRuntimeSessions, updateRuntimeSessionStatus } from "../../services/backend-api";
import type { AgentKey, AgentSession, AuthAvailableAgentItem, LoginUser } from "../../types";

interface ClientSidebarProps {
  user: LoginUser;
  onLogout: () => Promise<void>;
  availableAgents: AuthAvailableAgentItem[];
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
  const updatedAtText = entity.last_at
    ? new Date(entity.last_at).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";
  return {
    id: entity.id,
    agentKey,
    title: `${agentKey === "code" ? "代码" : "模型"}会话 #${entity.id}`,
    updatedAt: updatedAtText,
  };
}

function UserHoverMenu({
  user,
  onLogout,
}: {
  user: LoginUser;
  onLogout: () => Promise<void>;
}) {
  const navigate = useNavigate();
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
      <div className="desk-user-trigger-wrap">
        <AriContainer className="desk-user-trigger">
          <AriFlex align="center" space={8}>
            <AriAvatar text={user.name.slice(0, 1).toUpperCase()} />
            <AriTypography variant="h4" value={user.name} />
          </AriFlex>
        </AriContainer>
      </div>
    </AriTooltip>
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
      {rightAction || <div />}
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
      <div className="desk-agent-menu">
        <AriMenu
          items={AGENTS.map((agent) => ({
            key: agent.key,
            label: `${agent.name}${authorizedCodes.has(agent.key) ? "（已授权）" : "（未授权）"}`,
          }))}
          selectedKey={selectedKey}
          onSelect={(key) => navigate(`/agents/${key}`)}
        />
      </div>

      <div style={{ flex: 1 }} />
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
  const [sessions, setSessions] = useState<AgentSession[]>([]);

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
      const list = await listRuntimeSessions(user.id, agentKey);
      setSessions((list || []).map((item) => toAgentSession(agentKey, item)));
    } catch (_err) {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey, user.id]);

  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader
        onBack={() => navigate("/home")}
        label="Home"
        rightAction={
          <AriButton
            icon="refresh"
            label={loading ? "刷新中" : "刷新"}
            onClick={() => {
              void refreshSessions();
            }}
          />
        }
      />

      <div className="desk-history-menu">
        <AriMenu
          items={sessions.map((item) => ({
            key: item.id,
            label: item.title,
            meta: <AriTypography className="desk-session-item-time" variant="caption" value={item.updatedAt} />,
            actions: (
              <AriButton
                size="sm"
                type="text"
                icon="delete"
                onClick={() => {
                  void updateRuntimeSessionStatus(user.id, item.id, 0)
                    .then(() => refreshSessions())
                    .catch(() => refreshSessions());
                }}
              />
            ),
            showActionsOnHover: true,
          }))}
          selectedKey={selectedSessionKey}
          onSelect={(key) => navigate(`/agents/${agentKey}/session/${key}`)}
        />
      </div>

      <div style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} />
    </AriContainer>
  );
}

function SettingsSidebar({ user, onLogout }: { user: LoginUser; onLogout: () => Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader onBack={() => navigate("/home")} label="Home" />
      <div className="desk-sidebar-section">
        <AriMenu
          items={[
            { key: "general", label: "General" },
            { key: "model", label: "Model Agent" },
          ]}
          selectedKey={location.pathname.includes("/agents/model/settings") ? "model" : "general"}
          onSelect={(key) => navigate(key === "model" ? "/agents/model/settings" : "/settings/general")}
        />
      </div>
      <div style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} />
    </AriContainer>
  );
}

function AiKeySidebar({ user, onLogout }: { user: LoginUser; onLogout: () => Promise<void> }) {
  const navigate = useNavigate();
  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader onBack={() => navigate("/home")} label="Home" />
      <div className="desk-sidebar-section">
        <AriTypography variant="h4" value="AI Key 管理" />
        <AriTypography variant="caption" value="管理本地可用模型提供方密钥。" />
      </div>
      <div style={{ flex: 1 }} />
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
