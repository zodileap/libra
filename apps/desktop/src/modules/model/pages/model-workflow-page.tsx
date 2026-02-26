import { WorkflowCanvasPage } from "../../../widgets/workflow-canvas-page";

// 描述：模型智能体工作流页包装器，复用通用工作流画布并固定为 model。
export function ModelWorkflowPage() {
  return <WorkflowCanvasPage agentKey="model" />;
}
