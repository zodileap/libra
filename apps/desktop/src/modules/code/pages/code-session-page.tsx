import { useParams } from "react-router-dom";
import { SessionPage } from "../../../widgets/session/page";
import { CODE_SESSION_UI_CONFIG } from "../../../widgets/session/config";
import type {
  AiKeyItem,
  BlenderBridgeEnsureOptions,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  LoginUser,
  ModelMcpCapabilities,
} from "../../../shared/types";

interface CodeSessionPageProps {
  currentUser?: LoginUser | null;
  modelMcpCapabilities: ModelMcpCapabilities;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: (options?: BlenderBridgeEnsureOptions) => Promise<BlenderBridgeEnsureResult>;
  aiKeys: AiKeyItem[];
}

// 描述：代码智能体会话页包装器，复用通用 session 组件并固定为 code。
export function CodeSessionPage(props: CodeSessionPageProps) {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionPage agentKey="code" sessionId={String(sessionId || "")} sessionUiConfig={CODE_SESSION_UI_CONFIG} {...props} />;
}
