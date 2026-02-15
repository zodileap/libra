import { useEffect, useMemo, useState } from "react";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriInput,
  AriMenu,
  AriTooltip,
  AriTypography,
} from "aries_react";
import { invoke } from "@tauri-apps/api/core";
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
  normalizeInvokeErrorDetail,
  type NormalizedInvokeErrorDetail,
} from "../services/blender-bridge";
import {
  buildUiHintFromProtocolError,
  mapProtocolUiHint,
} from "../services/protocol-ui-hint";
import type {
  ModelAssetRecord,
  ModelEventRecord,
  ModelStepRecord,
  AiKeyItem,
  BlenderBridgeEnsureOptions,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  ModelMcpCapabilities,
  ProtocolUiHint,
} from "../types";
import { ChatMarkdown } from "../widgets/chat-markdown";
import { runModelWorkflow } from "../workflow";
import type { WorkflowStepRecord, WorkflowUiHint } from "../workflow";

interface SessionPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: (options?: BlenderBridgeEnsureOptions) => Promise<BlenderBridgeEnsureResult>;
  aiKeys: AiKeyItem[];
}

interface AgentRunResponse {
  trace_id: string;
  message: string;
  actions: string[];
  exported_file?: string;
  steps: ModelStepRecord[];
  events: ModelEventRecord[];
  assets: ModelAssetRecord[];
  ui_hint?: ProtocolUiHint;
}

interface ModelSessionRunResponse {
  trace_id: string;
  message: string;
  steps: ModelStepRecord[];
  events: ModelEventRecord[];
  assets: ModelAssetRecord[];
  exported_file?: string;
  ui_hint?: ProtocolUiHint;
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

interface TraceRecord {
  traceId: string;
  source: string;
  code?: string;
  message: string;
}

// 描述：格式化复杂 MCP 步骤元数据，供会话记录面板展示分支、风险与回滚信息。
function formatComplexStepMeta(step: ModelStepRecord): string {
  const operationKind = typeof step.data?.operation_kind === "string" ? step.data.operation_kind : "";
  const branch = typeof step.data?.branch === "string" ? step.data.branch : "";
  const riskLevel = typeof step.data?.risk_level === "string" ? step.data.risk_level : "";
  const condition = typeof step.data?.condition === "string" ? step.data.condition : "";
  const rollbackOf = typeof step.data?.rollback_of === "string" ? step.data.rollback_of : "";
  const parts = [operationKind, branch, riskLevel].filter((item) => item.length > 0);
  if (condition) {
    parts.push(`condition=${condition}`);
  }
  if (rollbackOf) {
    parts.push(`rollback_of=${rollbackOf}`);
  }
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
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
  const [stepRecords, setStepRecords] = useState<ModelStepRecord[]>([]);
  const [eventRecords, setEventRecords] = useState<ModelEventRecord[]>([]);
  const [assetRecords, setAssetRecords] = useState<ModelAssetRecord[]>([]);
  const [workflowStepRecords, setWorkflowStepRecords] = useState<WorkflowStepRecord[]>([]);
  const [uiHint, setUiHint] = useState<WorkflowUiHint | null>(null);
  const [traceRecords, setTraceRecords] = useState<TraceRecord[]>([]);
  const [pendingDangerousPrompt, setPendingDangerousPrompt] = useState("");
  const [pendingDangerousToken, setPendingDangerousToken] = useState("");
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
  const availableAiKeys = useMemo(
    () =>
      aiKeys.filter(
        (item) =>
          item.enabled
          || item.keyValue.trim().length > 0,
      ),
    [aiKeys],
  );
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const selectedAi = useMemo(
    () => availableAiKeys.find((item) => item.provider === selectedProvider) || availableAiKeys[0] || null,
    [availableAiKeys, selectedProvider],
  );

  const appendTraceRecord = (input: TraceRecord) => {
    setTraceRecords((prev) => [input, ...prev].slice(0, 50));
  };

  useEffect(() => {
    const intro = buildIntroMessage(isModelAgent);
    setUiHint(null);
    setTraceRecords([]);
    setPendingDangerousPrompt("");
    setPendingDangerousToken("");
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
    if (!import.meta.env.DEV) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("zodileap:session-debug", {
        detail: {
          sessionId,
          agentKey: normalizedAgentKey,
          title,
          status,
          workflowStepRecords,
          stepRecords,
          eventRecords,
          assetRecords,
          traceRecords,
          messageCount: messages.length,
          timestamp: Date.now(),
        },
      }),
    );
  }, [
    assetRecords,
    eventRecords,
    messages.length,
    normalizedAgentKey,
    sessionId,
    status,
    stepRecords,
    traceRecords,
    title,
    workflowStepRecords,
  ]);

  useEffect(() => {
    if (availableAiKeys.length === 0) {
      setSelectedProvider("");
      return;
    }
    if (!availableAiKeys.some((item) => item.provider === selectedProvider)) {
      setSelectedProvider(availableAiKeys[0].provider);
    }
  }, [availableAiKeys, selectedProvider]);

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

  const executePrompt = async (
    content: string,
    options?: {
      allowDangerousAction?: boolean;
      appendUserMessage?: boolean;
      confirmationToken?: string;
    },
  ) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || sending) return;

    const allowDangerousAction = Boolean(options?.allowDangerousAction);
    const confirmationToken = options?.confirmationToken;
    const appendUserMessage = options?.appendUserMessage !== false;
    const provider = selectedAi?.provider || "codex";
    const outputDir = isModelAgent ? extractOutputDirFromPrompt(normalizedContent) : undefined;
    setInput("");
    setSending(true);
    setStatus("智能体执行中...");
    setUiHint(null);
    if (appendUserMessage) {
      setMessages((prev) => [...prev, { role: "user", text: normalizedContent }]);
    }

    try {
      if (isModelAgent) {
        let bridgePrecheckWarning = "";
        const bridgeEnsureResult = await ensureBlenderBridge();
        if (!bridgeEnsureResult.ok) {
          // 描述：Bridge 预检失败不立即作为错误 trace 写入，避免后续自动恢复成功时形成误导。
          bridgePrecheckWarning = bridgeEnsureResult.message;
          setStatus("Bridge 未就绪，正在尝试自动拉起 Blender 并重试...");
        }
        const response = await runModelWorkflow({
          sessionId: sessionId || "model-session",
          projectName: title,
          prompt: normalizedContent,
          provider,
          workflowId: "wf-model-full-v1",
          referenceImages: [],
          styleImages: [],
          aiKeys,
          modelMcpCapabilities,
          outputDir,
          allowDangerousAction,
          confirmationToken,
        });
        setWorkflowStepRecords(response.steps || []);
        setStepRecords(response.modelSession?.steps || []);
        setEventRecords(response.modelSession?.events || []);
        setAssetRecords(response.modelSession?.assets || []);
        if (response.modelSession?.trace_id) {
          appendTraceRecord({
            traceId: response.modelSession.trace_id,
            source: "workflow:model_session",
            message: response.message,
          });
        }
        if (bridgePrecheckWarning) {
          appendTraceRecord({
            traceId: `trace-local-${Date.now()}`,
            source: "bridge:ensure",
            message: `Bridge 预检未通过，但执行阶段已自动恢复并完成。预检详情：${bridgePrecheckWarning}`,
          });
        }
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
          const hintToken = response.uiHint.context?.confirmation_token;
          setPendingDangerousPrompt(typeof hintPrompt === "string" ? hintPrompt : normalizedContent);
          setPendingDangerousToken(typeof hintToken === "string" ? hintToken : "");
        } else {
          setPendingDangerousPrompt("");
          setPendingDangerousToken("");
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
          traceId: `trace-${Date.now()}`,
          projectName: title,
          modelExportEnabled: modelMcpCapabilities.export,
          blenderBridgeAddr: DEFAULT_BLENDER_BRIDGE_ADDR,
          outputDir,
        });
        setStepRecords(response.steps || []);
        setEventRecords(response.events || []);
        setAssetRecords(response.assets || []);
        appendTraceRecord({
          traceId: response.trace_id,
          source: "agent:run",
          message: response.message,
        });
        setUiHint(response.ui_hint ? mapProtocolUiHint(response.ui_hint) : null);
        setPendingDangerousToken("");
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
      const detail = normalizeInvokeErrorDetail(err);
      const reason = detail.message;
      setPendingDangerousToken("");
      appendTraceRecord({
        traceId: `trace-local-${Date.now()}`,
        source: "agent:error",
        code: detail.code,
        message: reason,
      });
      setMessages((prev) => [...prev, { role: "assistant", text: `执行失败：${reason}` }]);
      setStatus(`执行失败：${reason}`);
      setUiHint(buildUiHintFromProtocolError(detail));
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

    if (action.kind === "apply_recovery_plan") {
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
      setPendingDangerousToken("");
      await executePrompt(prompt, {
        allowDangerousAction: true,
        appendUserMessage: false,
        confirmationToken: pendingDangerousToken,
      });
      return;
    }

    if (action.kind === "deny") {
      setUiHint(null);
      setPendingDangerousPrompt("");
      setPendingDangerousToken("");
      setStatus("已取消本次危险操作");
      setMessages((prev) => [...prev, { role: "assistant", text: "已取消本次危险操作。" }]);
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
      if (response.trace_id) {
        appendTraceRecord({
          traceId: response.trace_id,
          source: "session:retry",
          message: response.message,
        });
      }
      setUiHint(response.ui_hint ? mapProtocolUiHint(response.ui_hint) : null);
      setMessages((prev) => [...prev, { role: "assistant", text: response.message }]);
      setStatus("重试完成");
    } catch (err) {
      const detail = normalizeInvokeErrorDetail(err);
      const reason = normalizeInvokeError(err);
      appendTraceRecord({
        traceId: `trace-local-${Date.now()}`,
        source: "session:retry_error",
        code: detail.code,
        message: reason,
      });
      setStatus(`重试失败：${reason}`);
      setMessages((prev) => [...prev, { role: "assistant", text: `重试失败：${reason}` }]);
      setUiHint(buildUiHintFromProtocolError(detail));
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
        </div>

        <div className="desk-session-thread-wrap">
          {isModelAgent && stepRecords.length > 0 ? (
            <AriCard className="desk-msg">
              <AriTypography variant="caption" value="执行记录" />
              <div className="desk-model-step-list">
                {stepRecords.slice().reverse().map((step) => (
                  <AriTypography
                    key={`${step.index}-${step.code}-${step.elapsed_ms}`}
                    variant="caption"
                    value={`#${step.index + 1} ${step.code} · ${step.status} · ${step.elapsed_ms}ms${formatComplexStepMeta(step)}${step.error?.message ? ` · ${step.error.message}` : ""}`}
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
            <AriTypography className="desk-prompt-status" variant="caption" value={status || ""} />
            <AriFlex justify="space-between" align="center" className="desk-prompt-toolbar">
              <AriFlex align="center" space={8} className="desk-prompt-toolbar-left">
                <AriButton
                  type="text"
                  icon="add"
                  className="desk-prompt-icon-btn"
                  disabled={sending}
                />
                <AriTooltip
                  content={(
                    <AriMenu
                      items={availableAiKeys.map((item) => ({
                        key: item.provider,
                        label: item.providerLabel,
                      }))}
                      selectedKey={selectedAi?.provider || ""}
                      onSelect={(key) => setSelectedProvider(key)}
                    />
                  )}
                >
                  <AriButton
                    type="text"
                    label={selectedAi?.providerLabel || "选择 AI"}
                    icon="arrow_drop_down"
                    disabled={availableAiKeys.length === 0}
                  />
                </AriTooltip>
              </AriFlex>
              <AriButton
                type="default"
                color="brand"
                shape="round"
                icon={sending ? "hourglass_top" : "arrow_upward"}
                className="desk-prompt-icon-btn"
                onClick={sendMessage}
                disabled={sending || (isModelAgent && blenderBridgeRuntime.checking)}
              />
            </AriFlex>
          </AriCard>
        </div>
      </div>
    </AriContainer>
  );
}
