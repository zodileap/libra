import { useEffect, useState } from "react";
import { AriButton, AriCard, AriContainer, AriTypography } from "aries_react";
import { listen } from "@tauri-apps/api/event";
import type { AgentLogEvent } from "../types";

interface SessionDebugSnapshot {
  sessionId?: string;
  agentKey?: string;
  title?: string;
  status?: string;
  workflowStepRecords?: Array<{ name?: string; status?: string; summary?: string }>;
  stepRecords?: Array<{ action?: string; status?: string; elapsed_ms?: number }>;
  eventRecords?: Array<{ event?: string; message?: string }>;
  assetRecords?: Array<{ kind?: string; path?: string; version?: number }>;
  messageCount?: number;
  timestamp?: number;
}

export function DevDebugFloat() {
  const [collapsed, setCollapsed] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<SessionDebugSnapshot | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      const handler = await listen<AgentLogEvent>("agent:log", (event) => {
        if (disposed) return;
        const payload = event.payload;
        const line = `[${payload.trace_id}] [${payload.level}] [${payload.stage}] ${payload.message}`;
        setLogs((prev) => [line, ...prev].slice(0, 300));
      });
      if (!disposed) {
        unlisten = handler;
      } else {
        handler();
      }
    };

    const handleSessionDebug = (event: Event) => {
      const customEvent = event as CustomEvent<SessionDebugSnapshot>;
      setSnapshot(customEvent.detail || null);
    };

    void setup();
    window.addEventListener("zodileap:session-debug", handleSessionDebug as EventListener);

    return () => {
      disposed = true;
      if (unlisten) unlisten();
      window.removeEventListener("zodileap:session-debug", handleSessionDebug as EventListener);
    };
  }, []);

  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <AriContainer
      className={`desk-dev-debug-float ${collapsed ? "collapsed" : ""}`}
      positionType="fixed"
    >
      <AriCard className="desk-dev-debug-card">
        <AriContainer className="desk-dev-debug-head">
          <AriTypography variant="h4" value="Dev 调试窗口" />
          <AriButton
            type="text"
            icon={collapsed ? "unfold_more" : "unfold_less"}
            label={collapsed ? "展开" : "收起"}
            onClick={() => setCollapsed((value) => !value)}
          />
        </AriContainer>
        {!collapsed ? (
          <AriContainer className="desk-dev-debug-body">
            <AriTypography
              variant="caption"
              value={`会话：${snapshot?.title || "-"} (${snapshot?.agentKey || "-"}) status=${snapshot?.status || "-"}`}
            />
            <AriTypography
              variant="caption"
              value={`消息数=${snapshot?.messageCount ?? 0} workflow=${snapshot?.workflowStepRecords?.length || 0} steps=${snapshot?.stepRecords?.length || 0} events=${snapshot?.eventRecords?.length || 0} assets=${snapshot?.assetRecords?.length || 0}`}
            />
            <AriContainer className="desk-dev-debug-section">
              <AriTypography variant="caption" value="Agent 日志" />
              <div className="desk-dev-debug-list">
                {logs.length === 0 ? (
                  <AriTypography variant="caption" value="暂无日志" />
                ) : (
                  logs.map((line, index) => (
                    <AriTypography key={`${line}-${index}`} variant="caption" value={line} />
                  ))
                )}
              </div>
            </AriContainer>
            <AriContainer className="desk-dev-debug-section">
              <AriTypography variant="caption" value="Workflow 步骤" />
              <div className="desk-dev-debug-list">
                {(snapshot?.workflowStepRecords || []).slice(-10).reverse().map((item, index) => (
                  <AriTypography
                    key={`${item.name}-${index}`}
                    variant="caption"
                    value={`${item.name || "-"} · ${item.status || "-"} · ${item.summary || "-"}`}
                  />
                ))}
              </div>
            </AriContainer>
            <AriContainer className="desk-dev-debug-section">
              <AriTypography variant="caption" value="Session 事件/资产" />
              <div className="desk-dev-debug-list">
                {(snapshot?.eventRecords || []).slice(-6).reverse().map((item, index) => (
                  <AriTypography
                    key={`event-${item.event}-${index}`}
                    variant="caption"
                    value={`[event] ${item.event || "-"}: ${item.message || "-"}`}
                  />
                ))}
                {(snapshot?.assetRecords || []).slice(-6).reverse().map((item, index) => (
                  <AriTypography
                    key={`asset-${item.path}-${index}`}
                    variant="caption"
                    value={`[asset] ${item.kind || "-"} v${item.version || 0}: ${item.path || "-"}`}
                  />
                ))}
              </div>
            </AriContainer>
          </AriContainer>
        ) : null}
      </AriCard>
    </AriContainer>
  );
}
