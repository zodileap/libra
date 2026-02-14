import { useMemo, useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriTag, AriTypography } from "aries_react";
import { useNavigate, useParams } from "react-router-dom";
import { AGENTS, upsertModelProject } from "../data";
import type { AgentKey, ModelMcpCapabilities } from "../types";
import { DeskStatusText } from "../widgets/settings-primitives";

// 描述:
//
//   - 规范路由参数中的智能体键值，避免非法值导致页面分支异常。
//
// Params:
//
//   - value: 路由参数中的 agentKey。
//
// Returns:
//
//   - 标准化后的智能体键值，仅返回 code 或 model。
function normalizeAgentKey(value: string | undefined): AgentKey {
  return value === "model" ? "model" : "code";
}

interface AgentPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
}

export function AgentPage({ modelMcpCapabilities: _modelMcpCapabilities }: AgentPageProps) {
  const params = useParams<{ agentKey: string }>();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [projectName, setProjectName] = useState("新建模型项目");
  const [status, setStatus] = useState("");
  const agentKey = normalizeAgentKey(params.agentKey);

  const agent = useMemo(
    () => AGENTS.find((item) => item.key === agentKey) || AGENTS[0],
    [agentKey]
  );

  const handleCreateModelProject = () => {
    const normalizedProjectName = projectName.trim() || "新建模型项目";
    const normalizedPrompt = prompt.trim();
    const sessionId = `model-local-${Date.now()}`;
    const updatedAt = new Date().toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    upsertModelProject({
      id: sessionId,
      title: normalizedProjectName,
      prompt: normalizedPrompt,
      updatedAt,
    });
    setStatus("项目已创建，已进入会话。");
    navigate(`/agents/model/session/${sessionId}`);
  };

  const handleStartAgentFlow = () => {
    handleCreateModelProject();
  };

  return (
    <AriContainer className="desk-content">
      <AriTypography variant="h1" value={agentKey === "code" ? "开始你的代码任务" : "模型项目"} />

      {agentKey === "model" ? (
        <AriCard className="desk-prompt-card">
          <AriInput
            value={projectName}
            onChange={setProjectName}
            placeholder="输入项目名称，例如：机甲角色_v1"
          />
          <div className="desk-inline-gap" />
          <AriInput
            value={prompt}
            onChange={setPrompt}
            placeholder="输入模型需求，例如：打开模型后加厚并倒角；需要时再导出"
          />
          <AriFlex justify="space-between" align="center" className="desk-prompt-actions">
            <AriTag color="brand">Model Agent v1 · MCP（Blender）</AriTag>
            <AriFlex align="center" space={8}>
              <AriButton label="新建项目" onClick={handleCreateModelProject} />
              <AriButton color="primary" label="开始对话" onClick={handleStartAgentFlow} />
            </AriFlex>
          </AriFlex>
          {status ? <DeskStatusText value={status} /> : null}
        </AriCard>
      ) : (
        <AriCard className="desk-prompt-card">
          <AriInput
            value={prompt}
            onChange={setPrompt}
            placeholder="描述你要生成的页面或功能..."
          />
          <AriFlex justify="space-between" align="center" className="desk-prompt-actions">
            <AriTag color="brand">Model: Code Agent v1</AriTag>
            <AriButton color="primary" label="开始生成" />
          </AriFlex>
        </AriCard>
      )}

      <section className="desk-block">
        <AriTypography variant="h3" value="你可以这样开始" />
        <div className="desk-two-cols">
          <AriCard>
            <AriTypography variant="h4" value={agent.hint} />
            <AriTypography
              variant="caption"
              value={agentKey === "code" ? "限定 aries_react 组件，输出页面与预览步骤。" : "新建项目后输入需求，在会话中通过 MCP 执行新建/打开/编辑/导出。"}
            />
          </AriCard>
          <AriCard>
            <AriTypography variant="h4" value="约束资产" />
            <AriTypography
              variant="caption"
              value={agentKey === "code" ? "框架、组件、代码模块会作为生成约束。 " : "导出能力可在“模型设置”中开关。"}
            />
          </AriCard>
        </div>
      </section>
    </AriContainer>
  );
}
