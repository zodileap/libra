import { useEffect, useMemo, useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriTypography } from "aries_react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNavigate, useParams } from "react-router-dom";
import {
  AGENT_SESSIONS,
  getModelProjectById,
  getSessionMessages,
  upsertModelProject,
  upsertSessionMessages,
} from "../data";
import {
  DEFAULT_BLENDER_BRIDGE_ADDR,
  normalizeInvokeError,
} from "../services/blender-bridge";
import type {
  AgentLogEvent,
  ModelAssetRecord,
  ModelEventRecord,
  ModelStepRecord,
  AiKeyItem,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  ModelMcpCapabilities,
} from "../types";
import { ChatMarkdown } from "../widgets/chat-markdown";
import { runModelWorkflow } from "../workflow";
import type { WorkflowStepRecord, WorkflowUiHint } from "../workflow";

interface SessionPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: () => Promise<BlenderBridgeEnsureResult>;
  aiKeys: AiKeyItem[];
}

interface AgentRunResponse {
  trace_id: string;
  message: string;
  actions: string[];
  exported_file?: string;
}

interface ModelSessionRunResponse {
  trace_id: string;
  message: string;
  steps: ModelStepRecord[];
  events: ModelEventRecord[];
  assets: ModelAssetRecord[];
  exported_file?: string;
}

interface MessageItem {
  role: "user" | "assistant";
  text: string;
}

function buildIntroMessage(isModelAgent: boolean): MessageItem {
  return {
    role: "assistant",
    text: isModelAgent
      ? "已进入模型智能体会话。可直接通过自然语言调用 MCP 执行新建、打开、编辑、导出等操作（当前默认 Blender，ZBrush 预留）。"
      : "已进入代码智能体会话。请直接输入任务目标。",
  };
}

const OUTPUT_DIR_QUOTED_REGEX =
  /(?:导出到|导出至|输出到|保存到|export\s+to|save\s+to)\s*[“"']([^"”']+)[”"']/i;
const OUTPUT_DIR_PLAIN_REGEX =
  /(?:导出到|导出至|输出到|保存到|export\s+to|save\s+to)\s*(\/[^\s`"'，。；！？]+|[a-zA-Z]:\\[^\s`"'，。；！？]+)/i;

function trimOutputSuffix(path: string): string {
  let result = path.trim().replace(/[，。；！？、]+$/u, "");
  result = result.replace(/[)"'`”]+$/u, "");
  if ((result.startsWith("/") || /^[a-zA-Z]:\\/.test(result)) && /[中里]$/.test(result)) {
    result = result.slice(0, -1);
  }
  return result;
}

function extractOutputDirFromPrompt(prompt: string): string | undefined {
  const quotedMatch = prompt.match(OUTPUT_DIR_QUOTED_REGEX);
  if (quotedMatch?.[1]) {
    const normalized = trimOutputSuffix(quotedMatch[1]);
    return normalized || undefined;
  }

  const plainMatch = prompt.match(OUTPUT_DIR_PLAIN_REGEX);
  if (plainMatch?.[1]) {
    const normalized = trimOutputSuffix(plainMatch[1]);
    return normalized || undefined;
  }

  return undefined;
}

export function SessionPage({
  modelMcpCapabilities,
  blenderBridgeRuntime,
  ensureBlenderBridge,
  aiKeys,
}: SessionPageProps) {
  const navigate = useNavigate();
  const { sessionId, agentKey } = useParams<{ sessionId: string; agentKey: string }>();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTraceId, setActiveTraceId] = useState<string>("");
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [stepRecords, setStepRecords] = useState<ModelStepRecord[]>([]);
  const [eventRecords, setEventRecords] = useState<ModelEventRecord[]>([]);
  const [assetRecords, setAssetRecords] = useState<ModelAssetRecord[]>([]);
  const [workflowStepRecords, setWorkflowStepRecords] = useState<WorkflowStepRecord[]>([]);
  const [uiHint, setUiHint] = useState<WorkflowUiHint | null>(null);
  const [pendingDangerousPrompt, setPendingDangerousPrompt] = useState("");
  const [messagesHydrated, setMessagesHydrated] = useState(false);
  const [hydratedSessionKey, setHydratedSessionKey] = useState("");
  const isModelAgent = agentKey === "model";
  const normalizedAgentKey = isModelAgent ? "model" : "code";
  const sessionStorageKey = `${normalizedAgentKey}:${sessionId || "__none__"}`;

  const session = useMemo(
    () => AGENT_SESSIONS.find((item) => item.id === sessionId),
    [sessionId]
  );
  const modelProject = useMemo(
    () => (sessionId ? getModelProjectById(sessionId) : null),
    [sessionId]
  );

  const title = modelProject?.title || session?.title || "会话详情";
  const updatedAt = modelProject?.updatedAt || session?.updatedAt || "-";
  const [messages, setMessages] = useState<MessageItem[]>([]);

  const primaryKey = aiKeys[0];
  const visibleDebugLogs = useMemo(
    () =>
      activeTraceId
        ? debugLogs.filter((line) => line.includes(`[${activeTraceId}]`))
        : debugLogs,
    [debugLogs, activeTraceId]
  );

  useEffect(() => {
    const intro = buildIntroMessage(isModelAgent);
    setUiHint(null);
    setPendingDangerousPrompt("");
    if (!sessionId) {
      setMessages([intro]);
      setMessagesHydrated(true);
      setHydratedSessionKey(sessionStorageKey);
      return;
    }
    const stored = getSessionMessages(normalizedAgentKey, sessionId);
    setMessages(stored.length > 0 ? stored : [intro]);
    setMessagesHydrated(true);
    setHydratedSessionKey(sessionStorageKey);
  }, [isModelAgent, normalizedAgentKey, sessionId, sessionStorageKey]);

  useEffect(() => {
    if (!sessionId || !messagesHydrated || hydratedSessionKey !== sessionStorageKey) {
      return;
    }
    upsertSessionMessages({
      agentKey: normalizedAgentKey,
      sessionId,
      messages,
    });
  }, [messages, messagesHydrated, hydratedSessionKey, normalizedAgentKey, sessionId, sessionStorageKey]);

  useEffect(() => {
    if (!isModelAgent) {
      return;
    }
    void ensureBlenderBridge();
  }, [isModelAgent, sessionId, ensureBlenderBridge]);

  useEffect(() => {
    if (!isModelAgent || !sessionId) {
      return;
    }
    void invoke<ModelSessionRunResponse>("get_model_session_records", { sessionId })
      .then((records) => {
        setStepRecords(records.steps || []);
        setEventRecords(records.events || []);
        setAssetRecords(records.assets || []);
      })
      .catch(() => {
        // 会话首次打开或后端无记录时忽略
      });
  }, [isModelAgent, sessionId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      const handler = await listen<AgentLogEvent>("agent:log", (event) => {
        if (disposed) return;
        const payload = event.payload;
        const line = `[${payload.trace_id}] [${payload.level}] [${payload.stage}] ${payload.message}`;
        setDebugLogs((prev) => [line, ...prev].slice(0, 120));
      });
      if (!disposed) {
        unlisten = handler;
      } else {
        handler();
      }
    };

    void setup();

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const executePrompt = async (
    content: string,
    options?: {
      allowDangerousAction?: boolean;
      appendUserMessage?: boolean;
    },
  ) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || sending) return;

    const allowDangerousAction = Boolean(options?.allowDangerousAction);
    const appendUserMessage = options?.appendUserMessage !== false;
    const traceId = `trace-${Date.now()}`;
    const provider = primaryKey?.provider || "codex";
    const outputDir = isModelAgent ? extractOutputDirFromPrompt(normalizedContent) : undefined;
    setInput("");
    setSending(true);
    setActiveTraceId(traceId);
    setDebugLogs((prev) => [
      `[${traceId}] [info] [frontend] send message, provider=${provider}`,
      ...prev,
    ].slice(0, 120));
    setStatus("智能体执行中...");
    setUiHint(null);
    if (appendUserMessage) {
      setMessages((prev) => [...prev, { role: "user", text: normalizedContent }]);
    }

    try {
      if (isModelAgent) {
        const response = await runModelWorkflow({
          sessionId: sessionId || "model-session",
          projectName: title,
          prompt: normalizedContent,
          workflowId: "wf-model-full-v1",
          referenceImages: [],
          styleImages: [],
          aiKeys,
          modelMcpCapabilities,
          outputDir,
          allowDangerousAction,
        });
        setDebugLogs((prev) => [
          `[${traceId}] [info] [frontend] workflow invoke success runId=${response.runId}`,
          ...prev,
        ].slice(0, 120));
        setWorkflowStepRecords(response.steps || []);
        setStepRecords(response.modelSession?.steps || []);
        setEventRecords(response.modelSession?.events || []);
        setAssetRecords(response.modelSession?.assets || []);
        const nextUpdatedAt = new Date().toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        upsertModelProject({
          id: sessionId,
          title,
          prompt: normalizedContent,
          updatedAt: nextUpdatedAt,
        });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `${response.message}\n\n工作流步骤：\n${response.steps
              .map((item, index) => `${index + 1}. ${item.name} - ${item.status} - ${item.summary}`)
              .join("\n")}`,
          },
        ]);
        setUiHint(response.uiHint || null);
        if (response.uiHint?.key === "dangerous-operation-confirm") {
          const hintPrompt = response.uiHint.context?.prompt;
          setPendingDangerousPrompt(typeof hintPrompt === "string" ? hintPrompt : normalizedContent);
        } else {
          setPendingDangerousPrompt("");
        }
        setStatus(
          response.exportedFile
            ? `已完成 ${response.steps?.length || 0} 个步骤；导出文件：${response.exportedFile}`
            : `已完成 ${response.steps?.length || 0} 个步骤`
        );
      } else {
        const response = await invoke<AgentRunResponse>("run_agent_command", {
          agentKey: agentKey || "code",
          provider,
          prompt: content,
          traceId,
          projectName: title,
          modelExportEnabled: modelMcpCapabilities.export,
          blenderBridgeAddr: DEFAULT_BLENDER_BRIDGE_ADDR,
          outputDir,
        });
        setDebugLogs((prev) => [
          `[${response.trace_id}] [info] [frontend] invoke success`,
          ...prev,
        ].slice(0, 120));

        setMessages((prev) => [...prev, { role: "assistant", text: response.message }]);
        const actionText =
          response.actions?.length > 0 ? `动作：${response.actions.join(", ")}` : "动作：无";
        setStatus(
          response.exported_file
            ? `${actionText}；导出文件：${response.exported_file}`
            : actionText
        );
      }
    } catch (err) {
      const reason = normalizeInvokeError(err);
      setDebugLogs((prev) => [
        `[${traceId}] [error] [frontend] invoke failed: ${reason}`,
        ...prev,
      ].slice(0, 120));
      setMessages((prev) => [...prev, { role: "assistant", text: `执行失败：${reason}` }]);
      setStatus(`执行失败：${reason}`);
      if (
        reason.includes("当前 Blender 会话仍是旧版本")
        || reason.toLowerCase().includes("unsupported action")
      ) {
        setUiHint({
          key: "restart-blender-bridge",
          level: "warning",
          title: "需要重启 Blender",
          message: "Bridge 已自动更新，但当前会话仍是旧版本。请重启 Blender 后点击“我已重启并重试”。",
          actions: [
            { kind: "retry_last_step", label: "我已重启并重试", intent: "primary" },
            { kind: "dismiss", label: "暂不处理", intent: "default" },
          ],
        });
      }
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || sending) {
      return;
    }
    await executePrompt(content, { allowDangerousAction: false, appendUserMessage: true });
  };

  const handleUiHintAction = async (action: WorkflowUiHint["actions"][number]) => {
    if (action.kind === "dismiss") {
      setUiHint(null);
      return;
    }

    if (action.kind === "open_model_settings") {
      setUiHint(null);
      navigate("/agents/model/settings");
      return;
    }

    if (action.kind === "retry_last_step") {
      setUiHint(null);
      await retryLastStep();
      return;
    }

    if (action.kind === "allow_once") {
      const prompt = pendingDangerousPrompt.trim();
      if (!prompt) {
        setStatus("无法继续：缺少待确认的指令内容");
        return;
      }
      setUiHint(null);
      setPendingDangerousPrompt("");
      await executePrompt(prompt, { allowDangerousAction: true, appendUserMessage: false });
      return;
    }

    if (action.kind === "deny") {
      setUiHint(null);
      setPendingDangerousPrompt("");
      setStatus("已取消本次危险操作");
      setMessages((prev) => [...prev, { role: "assistant", text: "已取消本次危险操作。" }]);
    }
  };

  const undoLastStep = async () => {
    if (!sessionId || sending || !isModelAgent) {
      return;
    }
    const traceId = `trace-${Date.now()}`;
    setSending(true);
    setStatus("撤销中...");
    try {
      const response = await invoke<ModelSessionRunResponse>("undo_model_session_step", {
        sessionId,
        traceId,
        blenderBridgeAddr: DEFAULT_BLENDER_BRIDGE_ADDR,
      });
      setStepRecords(response.steps || []);
      setEventRecords(response.events || []);
      setAssetRecords(response.assets || []);
      setMessages((prev) => [...prev, { role: "assistant", text: "已撤销最近一步操作。" }]);
      setStatus("撤销成功");
    } catch (err) {
      const reason = normalizeInvokeError(err);
      setStatus(`撤销失败：${reason}`);
      setMessages((prev) => [...prev, { role: "assistant", text: `撤销失败：${reason}` }]);
    } finally {
      setSending(false);
    }
  };

  const retryLastStep = async () => {
    if (!sessionId || sending || !isModelAgent) {
      return;
    }
    const traceId = `trace-${Date.now()}`;
    setSending(true);
    setStatus("重试中...");
    try {
      const response = await invoke<ModelSessionRunResponse>("retry_model_session_last_step", {
        sessionId,
        traceId,
        projectName: title,
        capabilities: modelMcpCapabilities,
        blenderBridgeAddr: DEFAULT_BLENDER_BRIDGE_ADDR,
      });
      setStepRecords(response.steps || []);
      setEventRecords(response.events || []);
      setAssetRecords(response.assets || []);
      setMessages((prev) => [...prev, { role: "assistant", text: response.message }]);
      setStatus("重试完成");
    } catch (err) {
      const reason = normalizeInvokeError(err);
      setStatus(`重试失败：${reason}`);
      setMessages((prev) => [...prev, { role: "assistant", text: `重试失败：${reason}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <AriContainer className="desk-content desk-session-content" height="100%">
      <div className="desk-session-shell">
        <div className="desk-session-head">
          <AriTypography variant="h1" value={title} />
          <AriTypography variant="caption" value={`最近更新：${updatedAt}`} />
          {isModelAgent ? (
            <AriTypography
              variant="caption"
              value={
                blenderBridgeRuntime.checking
                  ? "Bridge 检测中..."
                  : blenderBridgeRuntime.message
              }
            />
          ) : null}
        </div>

        <div className="desk-session-thread-wrap">
          {isModelAgent && workflowStepRecords.length > 0 ? (
            <AriCard className="desk-msg">
              <AriTypography variant="caption" value="工作流执行记录（自动识别起点）" />
              <div className="desk-model-step-list">
                {workflowStepRecords.map((step, index) => (
                  <AriTypography
                    key={`${step.nodeId}-${index}`}
                    variant="caption"
                    value={`#${index + 1} ${step.name} · ${step.status} · ${step.summary}`}
                  />
                ))}
              </div>
            </AriCard>
          ) : null}

          {isModelAgent && stepRecords.length > 0 ? (
            <AriCard className="desk-msg">
              <AriTypography variant="caption" value="执行记录" />
              <div className="desk-model-step-list">
                {stepRecords.slice().reverse().map((step) => (
                  <AriTypography
                    key={`${step.index}-${step.action}-${step.elapsed_ms}`}
                    variant="caption"
                    value={`#${step.index + 1} ${step.action} · ${step.status} · ${step.elapsed_ms}ms`}
                  />
                ))}
              </div>
            </AriCard>
          ) : null}
          <div className="desk-thread">
            {messages.map((message, index) => (
              <AriCard key={`${message.role}-${index}`} className={`desk-msg ${message.role === "user" ? "user" : ""}`}>
                <AriTypography variant="caption" value={message.role === "user" ? "你" : "智能体"} />
                <ChatMarkdown content={message.text} />
              </AriCard>
            ))}
          </div>
        </div>

        <div className="desk-prompt-dock">
          {uiHint ? (
            <AriCard className={`desk-action-slot desk-action-slot-${uiHint.level}`}>
              <AriTypography variant="h4" value={uiHint.title} />
              <AriTypography variant="caption" value={uiHint.message} />
              <AriFlex align="center" space={8} className="desk-action-slot-actions">
                {uiHint.actions.map((action, index) => (
                  <AriButton
                    key={`${uiHint.key}-${action.kind}-${index}`}
                    color={action.intent === "primary" ? "primary" : undefined}
                    label={action.label}
                    onClick={() => {
                      void handleUiHintAction(action);
                    }}
                  />
                ))}
              </AriFlex>
            </AriCard>
          ) : null}
          <AriCard className="desk-prompt-card desk-session-prompt-card">
            <AriInput
              value={input}
              onChange={setInput}
              placeholder={isModelAgent ? "输入需求，例如：打开模型并加厚；或导出当前模型到 exports" : "继续提问，或要求智能体修改结果..."}
            />
            <AriFlex justify="space-between" align="center" style={{ marginTop: 12 }}>
              <AriTypography variant="caption" value={status || ""} />
              <AriFlex align="center" space={8}>
                {isModelAgent ? (
                  <>
                    <AriButton
                      type="text"
                      label="撤销一步"
                      onClick={undoLastStep}
                      disabled={sending || blenderBridgeRuntime.checking}
                    />
                    <AriButton
                      type="text"
                      label="重试上一步"
                      onClick={retryLastStep}
                      disabled={sending || blenderBridgeRuntime.checking}
                    />
                  </>
                ) : null}
                <AriButton
                  color="primary"
                  label={sending ? "发送中..." : "发送"}
                  onClick={sendMessage}
                  disabled={sending || (isModelAgent && blenderBridgeRuntime.checking)}
                />
              </AriFlex>
            </AriFlex>
            <AriContainer className="desk-debug-panel">
              <AriTypography
                variant="caption"
                value={`调试日志（当前 traceId: ${activeTraceId || "-"})`}
              />
              <div className="desk-debug-list">
                {visibleDebugLogs.length === 0 ? (
                  <AriTypography variant="caption" value="暂无日志" />
                ) : (
                  visibleDebugLogs.map((line, index) => (
                    <AriTypography key={`${line}-${index}`} variant="caption" value={line} />
                  ))
                )}
              </div>
            </AriContainer>
            {isModelAgent && assetRecords.length > 0 ? (
              <AriContainer className="desk-debug-panel">
                <AriTypography variant="caption" value="会话资产" />
                <div className="desk-debug-list">
                  {assetRecords.slice().reverse().map((asset) => (
                    <AriTypography
                      key={`${asset.kind}-${asset.path}-${asset.version}`}
                      variant="caption"
                      value={`${asset.kind} v${asset.version}: ${asset.path}`}
                    />
                  ))}
                </div>
              </AriContainer>
            ) : null}
            {isModelAgent && eventRecords.length > 0 ? (
              <AriContainer className="desk-debug-panel">
                <AriTypography variant="caption" value="事件流（step started/finished/failed）" />
                <div className="desk-debug-list">
                  {eventRecords.slice().reverse().map((event, index) => (
                    <AriTypography
                      key={`${event.event}-${event.timestamp_ms}-${index}`}
                      variant="caption"
                      value={`${event.event}${typeof event.step_index === "number" ? `#${event.step_index + 1}` : ""}: ${event.message}`}
                    />
                  ))}
                </div>
              </AriContainer>
            ) : null}
          </AriCard>
        </div>
      </div>
    </AriContainer>
  );
}
