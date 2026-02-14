import { useEffect, useMemo, useState } from "react";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriInput,
  AriTypography,
} from "aries_react";
import { useParams } from "react-router-dom";
import {
  createRuntimeSessionMessage,
  executeCodeAgent,
  executeModelAgent,
  listRuntimeSessionMessages,
} from "../services/backend-api";
import type {
  AiKeyItem,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  LoginUser,
  ModelMcpCapabilities,
} from "../types";
import { ChatMarkdown } from "../widgets/chat-markdown";

interface SessionPageProps {
  currentUser: LoginUser | null;
  modelMcpCapabilities: ModelMcpCapabilities;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: () => Promise<BlenderBridgeEnsureResult>;
  aiKeys: AiKeyItem[];
}

interface MessageItem {
  role: "user" | "assistant";
  text: string;
}

function buildIntroMessage(isModelAgent: boolean): MessageItem {
  return {
    role: "assistant",
    text: isModelAgent
      ? "已进入模型智能体会话。后端执行入口已接通，可直接输入模型任务。"
      : "已进入代码智能体会话。后端执行入口已接通，可直接输入代码任务。",
  };
}

// 描述：将代码智能体执行结果整理为展示文本。
function formatCodeExecuteResult(result: Awaited<ReturnType<typeof executeCodeAgent>>): string {
  const actions = (result.actions || [])
    .map((item, index) => `${index + 1}. ${item.step} - ${item.description}`)
    .join("\n");
  const artifacts = (result.artifacts || [])
    .map((item) => `- ${item.type}: ${item.path} (${item.summary})`)
    .join("\n");
  return [
    "代码任务执行完成。",
    actions ? `\n执行步骤：\n${actions}` : "",
    artifacts ? `\n产物：\n${artifacts}` : "",
  ].join("");
}

// 描述：将模型智能体执行结果整理为展示文本。
function formatModelExecuteResult(result: Awaited<ReturnType<typeof executeModelAgent>>): string {
  const steps = (result.steps || [])
    .map((item, index) => `${index + 1}. ${item.step} - ${item.description}`)
    .join("\n");
  const artifacts = (result.artifacts || [])
    .map((item) => `- ${item.type}: ${item.path} (${item.summary})`)
    .join("\n");
  return [
    "模型任务执行完成。",
    steps ? `\n执行步骤：\n${steps}` : "",
    artifacts ? `\n产物：\n${artifacts}` : "",
    result.resultPath ? `\n结果路径：${result.resultPath}` : "",
    `\n重试策略：${result.retryPolicy?.reason || "-"}`,
  ].join("");
}

export function SessionPage({
  currentUser,
  modelMcpCapabilities,
  blenderBridgeRuntime,
  ensureBlenderBridge,
  aiKeys,
}: SessionPageProps) {
  const { sessionId, agentKey } = useParams<{ sessionId: string; agentKey: string }>();
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const isModelAgent = agentKey === "model";
  const title = `${isModelAgent ? "模型" : "代码"}会话`;

  const aiSummary = useMemo(() => {
    if (!aiKeys || aiKeys.length === 0) {
      return "未配置 AI Key";
    }
    const enabledCount = aiKeys.filter((item) => item.enabled || item.keyValue.trim().length > 0).length;
    return `可用 AI Key：${enabledCount}`;
  }, [aiKeys]);

  // 描述：加载当前会话消息列表。
  const loadMessages = async () => {
    if (!currentUser || !sessionId) {
      return;
    }
    setLoadingMessages(true);
    try {
      const list = await listRuntimeSessionMessages(currentUser.id, sessionId, 1, 200);
      if (!list || list.length === 0) {
        setMessages([buildIntroMessage(isModelAgent)]);
        return;
      }
      setMessages(
        list.map((item) => ({
          role: item.role === "assistant" ? "assistant" : "user",
          text: item.content,
        })),
      );
    } catch (err) {
      setMessages([
        buildIntroMessage(isModelAgent),
        {
          role: "assistant",
          text: `消息加载失败：${err instanceof Error ? err.message : "unknown error"}`,
        },
      ]);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    void loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, sessionId, isModelAgent]);

  useEffect(() => {
    if (!isModelAgent) {
      return;
    }
    void ensureBlenderBridge();
  }, [ensureBlenderBridge, isModelAgent]);

  // 描述：发送消息并触发后端执行。
  const sendMessage = async () => {
    const content = input.trim();
    if (!content || sending) {
      return;
    }
    if (!currentUser || !sessionId) {
      setStatus("当前用户或会话无效，无法发送消息。");
      return;
    }

    setSending(true);
    setStatus("智能体执行中...");
    setInput("");

    const nextUserMessage: MessageItem = {
      role: "user",
      text: content,
    };
    setMessages((prev) => [...prev, nextUserMessage]);

    try {
      await createRuntimeSessionMessage(currentUser.id, sessionId, "user", content);

      let assistantText = "";
      if (isModelAgent) {
        const result = await executeModelAgent({
          userId: currentUser.id,
          sessionId,
          prompt: content,
          dccSoftware: "blender",
          dccExecutablePath: "",
          retryCount: 0,
          maxRetry: modelMcpCapabilities.export ? 2 : 1,
        });
        assistantText = formatModelExecuteResult(result);
      } else {
        const result = await executeCodeAgent({
          userId: currentUser.id,
          sessionId,
          prompt: content,
          enableWrite: 0,
        });
        assistantText = formatCodeExecuteResult(result);
      }

      await createRuntimeSessionMessage(currentUser.id, sessionId, "assistant", assistantText);
      setMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);
      setStatus("执行完成");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      const failedText = `执行失败：${reason}`;
      setMessages((prev) => [...prev, { role: "assistant", text: failedText }]);
      setStatus(failedText);
    } finally {
      setSending(false);
    }
  };

  return (
    <AriContainer className="desk-content desk-session-content" height="100%">
      <div className="desk-session-shell">
        <div className="desk-session-head">
          <AriTypography variant="h1" value={title} />
          <AriTypography variant="caption" value={`会话ID：${sessionId || "-"}`} />
          <AriTypography variant="caption" value={aiSummary} />
          {isModelAgent ? (
            <AriTypography
              variant="caption"
              value={blenderBridgeRuntime.checking ? "Bridge 检测中..." : blenderBridgeRuntime.message}
            />
          ) : null}
        </div>

        <div className="desk-session-thread-wrap">
          <div className="desk-thread">
            {messages.map((message, index) => (
              <AriCard
                key={`${message.role}-${index}`}
                className={`desk-msg ${message.role === "user" ? "user" : ""}`}
              >
                <AriTypography variant="caption" value={message.role === "user" ? "你" : "智能体"} />
                <ChatMarkdown content={message.text} />
              </AriCard>
            ))}
            {loadingMessages ? (
              <AriCard className="desk-msg">
                <AriTypography variant="caption" value="消息加载中..." />
              </AriCard>
            ) : null}
          </div>
        </div>

        <div className="desk-prompt-dock">
          <AriCard className="desk-prompt-card desk-session-prompt-card">
            <AriInput
              value={input}
              onChange={setInput}
              placeholder={isModelAgent ? "输入模型任务，例如：生成低模机甲并导出 glb" : "输入代码任务，例如：新增登录页面并接入 API"}
            />
            <AriFlex align="center" space={8} style={{ marginTop: 12 }}>
              <AriButton
                color="primary"
                label={sending ? "执行中..." : "发送"}
                onClick={() => {
                  void sendMessage();
                }}
              />
              <AriTypography variant="caption" value={status || "输入后回车或点击发送执行"} />
            </AriFlex>
          </AriCard>
        </div>
      </div>
    </AriContainer>
  );
}
