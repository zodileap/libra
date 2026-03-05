import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { WorkflowCanvasPage } from "../../../widgets/workflow";
import type { AgentKey } from "../../../shared/types";

// 描述：
//
//   - 解析 URL 查询参数中的 workflowType，未命中时默认回退 code。
//
// Params:
//
//   - rawType: URL 中的 workflowType 参数。
//
// Returns:
//
//   - 工作流类型。
function resolveWorkflowTypeFromQuery(rawType: string | null): AgentKey {
  return rawType === "model" ? "model" : "code";
}

// 描述：
//
//   - 渲染全局工作流页，通过 workflowType 查询参数兼容 model/code 工作流画布能力。
export function WorkflowsPage() {
  const [searchParams] = useSearchParams();
  const workflowType = useMemo(
    () => resolveWorkflowTypeFromQuery(searchParams.get("workflowType")),
    [searchParams],
  );
  return <WorkflowCanvasPage agentKey={workflowType} />;
}
