import { WorkflowCanvasPage } from "../../../widgets/workflow";

// 描述：
//
//   - 渲染单个工作流编辑页；页面仅负责承接路由，具体编辑/查看逻辑由画布组件内部处理。
export function WorkflowEditorPage() {
  return <WorkflowCanvasPage />;
}
