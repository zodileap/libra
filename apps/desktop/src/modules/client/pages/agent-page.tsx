import { useMemo, useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriTag, AriTypography } from "aries_react";
import { useParams } from "react-router-dom";
import { AGENTS } from "../data";
import type { AgentKey } from "../types";

function normalizeAgentKey(value: string | undefined): AgentKey {
  return value === "model" ? "model" : "code";
}

export function AgentPage() {
  const params = useParams<{ agentKey: string }>();
  const [prompt, setPrompt] = useState("");
  const agentKey = normalizeAgentKey(params.agentKey);

  const agent = useMemo(
    () => AGENTS.find((item) => item.key === agentKey) || AGENTS[0],
    [agentKey]
  );

  return (
    <AriContainer className="desk-content">
      <AriTypography
        variant="h1"
        value={agentKey === "code" ? "开始你的代码任务" : "开始你的建模任务"}
      />

      <AriCard className="desk-prompt-card">
        <AriInput
          value={prompt}
          onChange={setPrompt}
          placeholder={agentKey === "code" ? "描述你要生成的页面或功能..." : "描述你要生成的三维模型..."}
        />
        <AriFlex justify="space-between" align="center" style={{ marginTop: 12 }}>
          <AriTag color="brand">Model: {agentKey === "code" ? "Code Agent v1" : "Model Agent v1"}</AriTag>
          <AriButton color="primary" label={agentKey === "code" ? "开始生成" : "开始建模"} />
        </AriFlex>
      </AriCard>

      <section className="desk-block">
        <AriTypography variant="h3" value="你可以这样开始" />
        <div className="desk-two-cols">
          <AriCard>
            <AriTypography variant="h4" value={agent.hint} />
            <AriTypography
              variant="caption"
              value={agentKey === "code" ? "限定 aries_react 组件，输出页面与预览步骤。" : "输出 Blender / ZBrush 双流程建议与参数。"}
            />
          </AriCard>
          <AriCard>
            <AriTypography variant="h4" value="约束资产" />
            <AriTypography
              variant="caption"
              value={agentKey === "code" ? "框架、组件、代码模块会作为生成约束。 " : "风格、拓扑、贴图规范会作为建模约束。"}
            />
          </AriCard>
        </div>
      </section>
    </AriContainer>
  );
}
