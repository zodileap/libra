import { AgentPage } from "../../../widgets/agent-page";
import type { LoginUser, ModelMcpCapabilities } from "../../../shared/types";

interface ModelAgentPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  currentUser: LoginUser | null;
}

// 描述：模型智能体入口页包装器，复用通用 agent 组件并固定为 model。
export function ModelAgentPage(props: ModelAgentPageProps) {
  return <AgentPage agentKey="model" {...props} />;
}
