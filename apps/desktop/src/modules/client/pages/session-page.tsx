import { useEffect, useMemo, useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriTypography } from "aries_react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useParams } from "react-router-dom";
import { AGENT_SESSIONS, getModelProjectById, upsertModelProject } from "../data";
import {
  DEFAULT_BLENDER_BRIDGE_ADDR,
  normalizeInvokeError,
} from "../services/blender-bridge";
import type {
  AgentLogEvent,
  AiKeyItem,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  ModelMcpCapabilities,
} from "../types";
import { ChatMarkdown } from "../widgets/chat-markdown";

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

interface MessageItem {
  role: "user" | "assistant";
  text: string;
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
  const { sessionId, agentKey } = useParams<{ sessionId: string; agentKey: string }>();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTraceId, setActiveTraceId] = useState<string>("");
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const isModelAgent = agentKey === "model";

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
  const [messages, setMessages] = useState<MessageItem[]>([
    {
      role: "assistant",
      text: isModelAgent
        ? "已进入模型智能体会话。直接输入需求即可执行，若需求包含“导出”会自动调用 Blender 导出能力。"
        : "已进入代码智能体会话。请直接输入任务目标。"
    }
  ]);

  const primaryKey = aiKeys[0];
  const visibleDebugLogs = useMemo(
    () =>
      activeTraceId
        ? debugLogs.filter((line) => line.includes(`[${activeTraceId}]`))
        : debugLogs,
    [debugLogs, activeTraceId]
  );

  useEffect(() => {
    if (!isModelAgent) {
      return;
    }
    void ensureBlenderBridge();
  }, [isModelAgent, sessionId, ensureBlenderBridge]);

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

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || sending) {
      return;
    }
    const traceId = `trace-${Date.now()}`;
    const provider = primaryKey?.provider || "codex";
    const outputDir = isModelAgent ? extractOutputDirFromPrompt(content) : undefined;
    setInput("");
    setSending(true);
    setActiveTraceId(traceId);
    setDebugLogs((prev) => [
      `[${traceId}] [info] [frontend] send message, provider=${provider}`,
      ...prev,
    ].slice(0, 120));
    setStatus("智能体执行中...");
    setMessages((prev) => [...prev, { role: "user", text: content }]);

    try {
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

      if (sessionId && isModelAgent) {
        const nextUpdatedAt = new Date().toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        upsertModelProject({
          id: sessionId,
          title,
          prompt: content,
          updatedAt: nextUpdatedAt,
        });
      }

      setMessages((prev) => [...prev, { role: "assistant", text: response.message }]);
      const actionText =
        response.actions?.length > 0 ? `动作：${response.actions.join(", ")}` : "动作：无";
      setStatus(
        response.exported_file
          ? `${actionText}；导出文件：${response.exported_file}`
          : actionText
      );
    } catch (err) {
      const reason = normalizeInvokeError(err);
      setDebugLogs((prev) => [
        `[${traceId}] [error] [frontend] invoke failed: ${reason}`,
        ...prev,
      ].slice(0, 120));
      setMessages((prev) => [...prev, { role: "assistant", text: `执行失败：${reason}` }]);
      setStatus(`执行失败：${reason}`);
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
          <AriCard className="desk-prompt-card desk-session-prompt-card">
            <AriInput
              value={input}
              onChange={setInput}
              placeholder={isModelAgent ? "输入需求，例如：把当前模型导出为 GLB 到 exports" : "继续提问，或要求智能体修改结果..."}
            />
            <AriFlex justify="space-between" align="center" style={{ marginTop: 12 }}>
              <AriTypography variant="caption" value={status || ""} />
              <AriFlex align="center" space={8}>
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
          </AriCard>
        </div>
      </div>
    </AriContainer>
  );
}
