import type {
  AgentKey,
  AiKeyItem,
  ModelMcpCapabilities,
  ModelAssetRecord,
  ModelEventRecord,
  ModelStepRecord,
  ProtocolUiHint,
} from "../types";

// 描述:
//
//   - 定义工作流节点类型枚举。
export type WorkflowNodeKind =
  | "input"
  | "image_generate"
  | "structured_constraints"
  | "meshy_image_to_3d"
  | "meshy_refine"
  | "blender_refine_export";

// 描述:
//
//   - 定义工作流 UI 提示动作类型枚举。
export type WorkflowUiHintActionKind =
  | "retry_last_step"
  | "apply_recovery_plan"
  | "open_model_settings"
  | "dismiss"
  | "allow_once"
  | "deny";

// 描述:
//
//   - 定义工作流 UI 提示动作结构。
export interface WorkflowUiHintAction {
  kind: WorkflowUiHintActionKind;
  label: string;
  intent?: "primary" | "default" | "danger";
}

// 描述:
//
//   - 定义工作流 UI 提示结构。
export interface WorkflowUiHint {
  key: string;
  level: "info" | "warning" | "danger";
  title: string;
  message: string;
  actions: WorkflowUiHintAction[];
  context?: Record<string, unknown>;
}

// 描述:
//
//   - 定义工作流节点定义结构。
export interface WorkflowNodeDefinition {
  id: string;
  kind: WorkflowNodeKind;
  name: string;
  enabled: boolean;
  retryCount: number;
  fallbackKind?: WorkflowNodeKind;
  params: Record<string, unknown>;
}

// 描述:
//
//   - 定义工作流图节点类型枚举。
export type WorkflowGraphNodeType =
  | "node"
  | "start"
  | "action"
  | "branch"
  | "loop"
  | "end";

// 描述:
//
//   - 定义工作流图连线类型枚举。
export type WorkflowGraphEdgeType = "default" | "branch" | "loop";

// 描述:
//
//   - 定义工作流图节点结构。
export interface WorkflowGraphNode {
  id: string;
  title: string;
  description: string;
  instruction?: string;
  type: WorkflowGraphNodeType;
  x: number;
  y: number;
}

// 描述:
//
//   - 定义工作流图连线结构。
export interface WorkflowGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: WorkflowGraphEdgeType;
  label?: string;
}

// 描述:
//
//   - 定义工作流图结构。
export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

// 描述:
//
//   - 定义模型工作流定义结构。
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  shared: boolean;
  nodes: WorkflowNodeDefinition[];
  graph?: WorkflowGraph;
}

// 描述:
//
//   - 定义代码工作流定义结构。
export interface CodeWorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  shared: boolean;
  agentKey: AgentKey;
  promptPrefix: string;
  graph?: WorkflowGraph;
}

// 描述:
//
//   - 定义工作流步骤状态枚举。
export type WorkflowStepStatus = "success" | "failed" | "skipped" | "manual";

// 描述:
//
//   - 定义工作流步骤记录结构。
export interface WorkflowStepRecord {
  nodeId: string;
  kind: WorkflowNodeKind;
  name: string;
  status: WorkflowStepStatus;
  attempt: number;
  elapsedMs: number;
  summary: string;
  error?: string;
  output?: Record<string, unknown>;
}

// 描述:
//
//   - 定义工作流执行结果结构。
export interface WorkflowRunResult {
  runId: string;
  workflowId: string;
  entryNodeKind: WorkflowNodeKind;
  message: string;
  steps: WorkflowStepRecord[];
  exportedFile?: string;
  referenceImagesDetected: string[];
  uiHint?: WorkflowUiHint;
  modelSession?: {
    trace_id: string;
    steps: ModelStepRecord[];
    events: ModelEventRecord[];
    assets: ModelAssetRecord[];
    exported_file?: string;
    ui_hint?: ProtocolUiHint;
  };
}

// 描述:
//
//   - 定义工作流执行请求结构。
export interface WorkflowRunRequest {
  sessionId: string;
  projectName: string;
  prompt: string;
  provider: string;
  workflowId: string;
  referenceImages: string[];
  styleImages: string[];
  aiKeys: AiKeyItem[];
  modelMcpCapabilities: ModelMcpCapabilities;
  outputDir?: string;
  allowDangerousAction?: boolean;
  confirmationToken?: string;
}
