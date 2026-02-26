import { useParams } from "react-router-dom";
import { SessionPage } from "../../../widgets/session/page";
import { MODEL_SESSION_UI_CONFIG } from "../../../widgets/session/config";
import type {
  AiKeyItem,
  BlenderBridgeEnsureOptions,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  LoginUser,
  ModelMcpCapabilities,
} from "../../../shared/types";

interface ModelSessionPageProps {
  currentUser?: LoginUser | null;
  modelMcpCapabilities: ModelMcpCapabilities;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: (options?: BlenderBridgeEnsureOptions) => Promise<BlenderBridgeEnsureResult>;
  aiKeys: AiKeyItem[];
}

// 描述：模型智能体会话页包装器，复用通用 session 组件并固定为 model。
export function ModelSessionPage(props: ModelSessionPageProps) {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionPage agentKey="model" sessionId={String(sessionId || "")} sessionUiConfig={MODEL_SESSION_UI_CONFIG} {...props} />;
}
