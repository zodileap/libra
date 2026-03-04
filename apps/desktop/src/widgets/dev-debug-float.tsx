import { useEffect, useState } from "react";
import { AriButton, AriCard, AriContainer, AriTypography } from "aries_react";
import { listen } from "@tauri-apps/api/event";
import type { AgentLogEvent, ModelDebugTraceEvent } from "../shared/types";
import { EVENT_AGENT_LOG, EVENT_MODEL_DEBUG_TRACE } from "../shared/constants";

// 描述:
//
//   - 定义 Dev 调试浮窗组件入参。
interface DevDebugFloatProps {
  visible?: boolean;
}

// 描述:
//
//   - 定义会话调试快照结构，统一承载前端调试窗口展示数据。
interface SessionDebugSnapshot {
  sessionId?: string;
  agentKey?: string;
  title?: string;
  status?: string;
  traceRecords?: Array<{ traceId?: string; source?: string; code?: string; message?: string }>;
  workflowStepRecords?: Array<{ name?: string; status?: string; summary?: string }>;
  stepRecords?: Array<{ code?: string; status?: string; elapsed_ms?: number }>;
  eventRecords?: Array<{ event?: string; message?: string }>;
  assetRecords?: Array<{ kind?: string; path?: string; version?: number }>;
  debugFlowRecords?: Array<{
    id?: string;
    source?: "ui" | "backend";
    stage?: string;
    title?: string;
    detail?: string;
    timestamp?: number;
  }>;
  messageCount?: number;
  timestamp?: number;
}

// ModelDebugTraceEvent 已提取至 shared/types.ts 统一定义。

// 描述:
//
//   - 在开发环境渲染调试浮层并订阅会话与后端调试事件。
export function DevDebugFloat({ visible = true }: DevDebugFloatProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<SessionDebugSnapshot | null>(null);
  const [modelDebugTraces, setModelDebugTraces] = useState<ModelDebugTraceEvent[]>([]);

  useEffect(() => {
    if (!import.meta.env.DEV || !visible) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    // 描述：绑定 Tauri 事件监听并在卸载时释放句柄。
    const setup = async () => {
      const handler = await listen<AgentLogEvent>(EVENT_AGENT_LOG, (event) => {
        if (disposed) return;
        const payload = event.payload;
        const line = `[${payload.trace_id}] [${payload.level}] [${payload.stage}] ${payload.message}`;
        setLogs((prev) => [line, ...prev].slice(0, 300));
      });
      const modelDebugHandler = await listen<ModelDebugTraceEvent>(EVENT_MODEL_DEBUG_TRACE, (event) => {
        if (disposed) return;
        const payload = event.payload;
        setModelDebugTraces((prev) => [payload, ...prev].slice(0, 180));
      });
      if (!disposed) {
        unlisten = () => {
          handler();
          modelDebugHandler();
        };
      } else {
        handler();
        modelDebugHandler();
      }
    };

    // 描述：接收页面调试广播并更新当前会话调试快照。
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
  }, [visible]);

  if (!import.meta.env.DEV || !visible) {
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
              className="desk-dev-debug-line"
              variant="caption"
              value={`会话：${snapshot?.title || "-"} (${snapshot?.agentKey || "-"}) status=${snapshot?.status || "-"}`}
            />
            <AriTypography
              className="desk-dev-debug-line"
              variant="caption"
              value={`消息数=${snapshot?.messageCount ?? 0} trace=${snapshot?.traceRecords?.length || 0} workflow=${snapshot?.workflowStepRecords?.length || 0} steps=${snapshot?.stepRecords?.length || 0} events=${snapshot?.eventRecords?.length || 0} assets=${snapshot?.assetRecords?.length || 0}`}
            />
            <AriContainer className="desk-dev-debug-section">
              <AriTypography variant="caption" value="执行全链路（前端视角）" />
              <AriContainer className="desk-dev-debug-list">
                {(snapshot?.debugFlowRecords || []).map((record, index) => {
                  const prefix = record.timestamp
                    ? `[${new Date(record.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}]`
                    : "[--:--:--]";
                  return (
                    <AriTypography
                      key={`flow-${record.id || index}`}
                      className="desk-dev-debug-line"
                      variant="caption"
                      value={`${prefix} [${record.source || "ui"}] [${record.stage || "-"}] ${record.title || "-"}\n${record.detail || "-"}`}
                    />
                  );
                })}
                {(snapshot?.debugFlowRecords?.length || 0) === 0 ? (
                  <AriTypography className="desk-dev-debug-line" variant="caption" value="暂无全链路记录" />
                ) : null}
              </AriContainer>
            </AriContainer>
            <AriContainer className="desk-dev-debug-section">
              <AriTypography variant="caption" value="模型规划 LLM 明细（后端视角）" />
              <AriContainer className="desk-dev-debug-list">
                {modelDebugTraces.map((item, index) => {
                  const prefix = item.timestamp_ms
                    ? `[${new Date(item.timestamp_ms).toLocaleTimeString("zh-CN", { hour12: false })}]`
                    : "[--:--:--]";
                  return (
                    <AriTypography
                      key={`model-debug-${item.trace_id || "trace"}-${index}`}
                      className="desk-dev-debug-line"
                      variant="caption"
                      value={`${prefix} [${item.stage || "-"}] ${item.title || "-"}\n${item.detail || "-"}`}
                    />
                  );
                })}
                {modelDebugTraces.length === 0 ? (
                  <AriTypography className="desk-dev-debug-line" variant="caption" value="暂无模型规划 LLM 明细" />
                ) : null}
              </AriContainer>
            </AriContainer>
            <AriContainer className="desk-dev-debug-section">
              <AriTypography variant="caption" value="Agent 日志" />
              <AriContainer className="desk-dev-debug-list">
                {logs.length === 0 ? (
                  <AriTypography className="desk-dev-debug-line" variant="caption" value="暂无日志" />
                ) : (
                  logs.map((line, index) => (
                    <AriTypography className="desk-dev-debug-line" key={`${line}-${index}`} variant="caption" value={line} />
                  ))
                )}
              </AriContainer>
            </AriContainer>
            <AriContainer className="desk-dev-debug-section">
              <AriTypography variant="caption" value="Workflow 步骤" />
              <AriContainer className="desk-dev-debug-list">
                {(snapshot?.workflowStepRecords || []).slice(-10).reverse().map((item, index) => (
                  <AriTypography
                    className="desk-dev-debug-line"
                    key={`${item.name}-${index}`}
                    variant="caption"
                    value={`${item.name || "-"} · ${item.status || "-"} · ${item.summary || "-"}`}
                  />
                ))}
              </AriContainer>
            </AriContainer>
            <AriContainer className="desk-dev-debug-section">
              <AriTypography variant="caption" value="Trace / Session 事件 / 资产" />
              <AriContainer className="desk-dev-debug-list">
                {(snapshot?.traceRecords || []).slice(0, 10).map((item, index) => (
                  <AriTypography
                    className="desk-dev-debug-line"
                    key={`trace-${item.traceId}-${index}`}
                    variant="caption"
                    value={`[trace] ${item.traceId || "-"} · ${item.source || "-"}${item.code ? ` · ${item.code}` : ""} · ${item.message || "-"}`}
                  />
                ))}
                {(snapshot?.eventRecords || []).slice(-6).reverse().map((item, index) => (
                  <AriTypography
                    className="desk-dev-debug-line"
                    key={`event-${item.event}-${index}`}
                    variant="caption"
                    value={`[event] ${item.event || "-"}: ${item.message || "-"}`}
                  />
                ))}
                {(snapshot?.assetRecords || []).slice(-6).reverse().map((item, index) => (
                  <AriTypography
                    className="desk-dev-debug-line"
                    key={`asset-${item.path}-${index}`}
                    variant="caption"
                    value={`[asset] ${item.kind || "-"} v${item.version || 0}: ${item.path || "-"}`}
                  />
                ))}
                {(snapshot?.traceRecords?.length || 0) === 0
                && (snapshot?.eventRecords?.length || 0) === 0
                && (snapshot?.assetRecords?.length || 0) === 0 ? (
                  <AriTypography className="desk-dev-debug-line" variant="caption" value="暂无 session 轨迹记录" />
                ) : null}
              </AriContainer>
            </AriContainer>
          </AriContainer>
        ) : null}
      </AriCard>
    </AriContainer>
  );
}
