import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
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
} from "../services/blender-bridge";
import type {
  ModelAssetRecord,
  ModelEventRecord,
  ModelStepRecord,
  AiKeyItem,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  ModelMcpCapabilities,
} from "../types";
import { ChatMarkdown } from "../widgets/chat-markdown";
import { DeskFeedbackState } from "../widgets/feedback-states";
import { runModelWorkflow } from "../workflow";
import type { WorkflowStepRecord, WorkflowUiHint } from "../workflow";
import {
  buildIntroMessage,
  extractOutputDirFromPrompt,
} from "./session-page.utils";
import type { MessageItem } from "./session-page.utils";

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

// 描述:
//
//   - 渲染会话页，承载消息流、工作流记录、提示动作与输入工具栏。
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
  const [pendingDangerousPrompt, setPendingDangerousPrompt] = useState("");
  const [copiedMessageKey, setCopiedMessageKey] = useState("");
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
  const hasModelRecords = useMemo(
    () => workflowStepRecords.length > 0 || stepRecords.length > 0 || eventRecords.length > 0 || assetRecords.length > 0,
    [assetRecords.length, eventRecords.length, stepRecords.length, workflowStepRecords.length]
  );
  const hasErrorStatus = useMemo(
    () => status.startsWith("执行失败") || status.startsWith("重试失败"),
    [status]
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
          traceId: `trace-${Date.now()}`,
          projectName: title,
          modelExportEnabled: modelMcpCapabilities.export,
          blenderBridgeAddr: DEFAULT_BLENDER_BRIDGE_ADDR,
          outputDir,
        });
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

  // 描述:
  //
  //   - 发送当前输入框消息，触发智能体执行。
  const sendMessage = async () => {
    const content = input.trim();
    if (!content || sending) {
      return;
    }
    await executePrompt(content, { allowDangerousAction: false, appendUserMessage: true });
  };

  // 描述:
  //
  //   - 键盘增强：在会话输入框按 Enter 发送，按 Escape 关闭提示浮层。
  //
  // Params:
  //
  //   - event: 键盘事件。
  const handlePromptInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
      return;
    }
    if (event.key === "Escape") {
      setUiHint(null);
    }
  };

  // 描述:
  //
  //   - 复制消息文本并给出可见反馈，便于长文本/代码说明快速复用。
  //
  // Params:
  //
  //   - messageText: 消息内容。
  //   - messageKey: 消息唯一键值。
  const copyMessageText = async (messageText: string, messageKey: string) => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopiedMessageKey(messageKey);
      setStatus("消息内容已复制");
      window.setTimeout(() => {
        setCopiedMessageKey((prev) => (prev === messageKey ? "" : prev));
      }, 1500);
    } catch (_error) {
      setStatus("复制失败，请检查系统剪贴板权限");
    }
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
          {isModelAgent && sending && !hasModelRecords ? (
            <DeskFeedbackState
              kind="loading"
              title="正在执行模型工作流"
              message="任务进行中，可在下方消息区查看实时反馈。"
            />
          ) : null}
          {isModelAgent && !sending && !hasModelRecords ? (
            <DeskFeedbackState
              kind="empty"
              title="暂无执行记录"
              message="输入需求后会自动写入工作流与执行记录。"
            />
          ) : null}
          {hasErrorStatus ? (
            <DeskFeedbackState
              kind="error"
              title="执行出现异常"
              message={status}
            />
          ) : null}

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
                <AriFlex justify="space-between" align="center" className="desk-msg-head">
                  <AriTypography variant="caption" value={message.role === "user" ? "你" : "智能体"} />
                  <AriButton
                    size="sm"
                    type="text"
                    icon={copiedMessageKey === `${message.role}-${index}` ? "check" : "content_copy"}
                    label={copiedMessageKey === `${message.role}-${index}` ? "已复制" : "复制"}
                    onClick={() => {
                      void copyMessageText(message.text, `${message.role}-${index}`);
                    }}
                  />
                </AriFlex>
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
              onKeyDown={handlePromptInputKeyDown}
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
