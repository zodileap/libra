import { AgentPage } from "../../../widgets/agent-page";
import type { LoginUser, ModelMcpCapabilities } from "../../../shared/types";

interface CodeAgentPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  currentUser: LoginUser | null;
}

// 描述：代码智能体入口页包装器，复用通用 agent 组件并固定为 code。
export function CodeAgentPage(props: CodeAgentPageProps) {
  return <AgentPage agentKey="code" {...props} />;
}
