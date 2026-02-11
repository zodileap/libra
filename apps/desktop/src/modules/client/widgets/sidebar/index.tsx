import { useMemo } from "react";
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
import { AGENTS, getAgentSessions } from "../../data";
import type { AgentKey, LoginUser } from "../../types";

interface ClientSidebarProps {
  user: LoginUser;
  onLogout: () => void;
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

function UserHoverMenu({
  user,
  onLogout,
}: {
  user: LoginUser;
  onLogout: () => void;
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
          if (key === "logout") onLogout();
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
  rightAction
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
}: {
  user: LoginUser;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = location.pathname.startsWith("/agents/")
    ? location.pathname.split("/")[2] || ""
    : "";

  return (
    <AriContainer className="desk-sidebar">
      <div className="desk-agent-menu">
        <AriMenu
          items={AGENTS.map((agent) => ({
            key: agent.key,
            label: agent.name,
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
  onLogout: () => void;
  agentKey: AgentKey;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const sessions = useMemo(() => getAgentSessions(agentKey), [agentKey]);
  const selectedSessionKey = location.pathname.includes("/session/")
    ? location.pathname.split("/").pop() || ""
    : "";

  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader
        onBack={() => navigate("/home")}
        label="Home"
        rightAction={<AriButton icon="edit" label="编辑" />}
      />

      <div className="desk-history-menu">
        <AriMenu
          items={sessions.map((item) => ({
            key: item.id,
            label: `${item.title} · ${item.updatedAt}`,
          }))}
          selectedKey={selectedSessionKey}
          onSelect={(key) => navigate(`/agents/${agentKey}/session/${key}`)}
        />
      </div>

      <div style={{ flex: 1 }} />
      {agentKey === "model" ? (
        <AriContainer className="desk-model-settings-trigger">
          <AriButton
            icon="tune"
            label="模型设置"
            onClick={() => navigate("/agents/model/settings")}
          />
        </AriContainer>
      ) : null}
      <UserHoverMenu user={user} onLogout={onLogout} />
    </AriContainer>
  );
}

function SettingsSidebar({
  user,
  onLogout
}: {
  user: LoginUser;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = location.pathname.includes("/general") ? "general" : "general";

  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader onBack={() => navigate("/home")} label="Home" />

      <div className="desk-history-menu">
        <AriMenu
          items={[
            {
              key: "general",
              label: "General",
              icon: "settings"
            }
          ]}
          selectedKey={selectedKey}
          onSelect={() => navigate("/settings/general")}
        />
      </div>

      <div style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} />
    </AriContainer>
  );
}

function AiKeySidebar({
  user,
  onLogout
}: {
  user: LoginUser;
  onLogout: () => void;
}) {
  const navigate = useNavigate();

  return (
    <AriContainer className="desk-sidebar">
      <SidebarBackHeader onBack={() => navigate("/home")} label="Home" />

      <div className="desk-history-menu">
        <AriMenu
          items={[
            {
              key: "ai-key-home",
              label: "AI Key",
              icon: "vpn_key"
            }
          ]}
          selectedKey="ai-key-home"
          onSelect={() => navigate("/ai-keys")}
        />
      </div>

      <div style={{ flex: 1 }} />
      <UserHoverMenu user={user} onLogout={onLogout} />
    </AriContainer>
  );
}

export function ClientSidebar({ user, onLogout }: ClientSidebarProps) {
  const location = useLocation();
  const mode = matchSidebarMode(location.pathname);
  const agentKey = matchAgentKey(location.pathname);

  if (mode === "agent" && agentKey) {
    return <AgentSidebar user={user} onLogout={onLogout} agentKey={agentKey} />;
  }
  if (mode === "settings") {
    return <SettingsSidebar user={user} onLogout={onLogout} />;
  }
  if (mode === "ai-key") {
    return <AiKeySidebar user={user} onLogout={onLogout} />;
  }
  return <HomeSidebar user={user} onLogout={onLogout} />;
}
