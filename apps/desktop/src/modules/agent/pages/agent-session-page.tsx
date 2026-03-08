import { useParams } from "react-router-dom";
import { SessionPage } from "../../../widgets/session/page";
import { AGENT_SESSION_UI_CONFIG } from "../../../widgets/session/config";
import type {
  AiKeyItem,
  LoginUser,
  DccMcpCapabilities,
} from "../../../shared/types";

// 描述:
//
//   - 定义智能体会话页面包装组件入参。
interface AgentSessionPageProps {
  currentUser?: LoginUser | null;
  dccMcpCapabilities: DccMcpCapabilities;
  aiKeys: AiKeyItem[];
}

// 描述：统一智能体会话页包装器，复用通用 session 组件并固定为单一 agent。
export function AgentSessionPage(props: AgentSessionPageProps) {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionPage agentKey="agent" sessionId={String(sessionId || "")} sessionUiConfig={AGENT_SESSION_UI_CONFIG} {...props} />;
}
