import { WorkflowCanvasPage } from "../../../widgets/workflow-canvas-page";

// 描述：代码智能体工作流页包装器，复用通用工作流画布并固定为 code。
export function CodeWorkflowPage() {
  return <WorkflowCanvasPage agentKey="code" />;
}
