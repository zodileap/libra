import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AGENTS, upsertModelProject } from "../../../shared/data";
import { createRuntimeSession } from "../../../shared/services/backend-api";
import { AgentPage } from "../../../widgets/agent/page";
import type { LoginUser, ModelMcpCapabilities } from "../../../shared/types";

// 描述:
//
//   - 定义模型智能体入口页入参。
interface ModelAgentPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  currentUser: LoginUser | null;
}

// 描述：根据用户首条消息生成默认会话标题，避免出现“会话详情”这类无语义标题。
//
// Params:
//
//   - prompt: 用户输入。
//   - fallbackTitle: 兜底标题。
//
// Returns:
//
//   - 截断后的标题。
function buildSessionTitleFromPrompt(prompt: string, fallbackTitle: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return fallbackTitle;
  }
  if (normalized.length <= 24) {
    return normalized;
  }
  return `${normalized.slice(0, 24)}...`;
}

// 描述：模型智能体入口页包装器，复用通用 agent 组件并固定为 model。
export function ModelAgentPage(props: ModelAgentPageProps) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const { currentUser } = props;
  const agent = useMemo(() => AGENTS.find((item) => item.key === "model") || AGENTS[0], []);

  // 描述：创建后端会话并自动发送首条消息，保持“发送后进入会话”的连续体验。
  const handleStartConversation = async () => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setStatus("请先输入需求再开始对话。");
      return;
    }
    if (!currentUser) {
      setStatus("用户未登录，无法创建会话。");
      return;
    }

    setStatus("正在创建会话...");
    setSending(true);
    try {
      const session = await createRuntimeSession(currentUser.id, "model");
      if (!session.id) {
        setStatus("创建会话失败，请稍后重试。");
        return;
      }

      const updatedAt = new Date().toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      upsertModelProject({
        id: session.id,
        title: buildSessionTitleFromPrompt(normalizedPrompt, "新建模型项目"),
        prompt: normalizedPrompt,
        updatedAt,
      });

      navigate(`/agents/model/session/${session.id}`, {
        state: {
          autoPrompt: normalizedPrompt,
          workspaceId: "",
        },
      });
      setPrompt("");
      setStatus("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "创建会话失败";
      setStatus(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <AgentPage
      title="模型智能体"
      description={agent.description}
      prompt={prompt}
      status={status}
      sending={sending}
      canSend
      promptPlaceholder="输入模型任务，例如：打开 Blender 后创建立方体并贴图"
      agentLayerLabel="Model Agent"
      starterItems={[
        {
          title: "快速开始",
          description: "打开 Blender，创建一个立方体并应用指定贴图。",
        },
        {
          title: "上下文约束",
          description: "描述对象、材质、导出要求，模型智能体会按步骤执行。",
        },
      ]}
      onPromptChange={setPrompt}
      onStartConversation={handleStartConversation}
    />
  );
}
