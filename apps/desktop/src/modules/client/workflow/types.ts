import type {
  AiKeyItem,
  ModelMcpCapabilities,
  ModelAssetRecord,
  ModelEventRecord,
  ModelStepRecord,
  ProtocolUiHint,
} from "../types";

export type WorkflowNodeKind =
  | "input"
  | "image_generate"
  | "structured_constraints"
  | "meshy_image_to_3d"
  | "meshy_refine"
  | "blender_refine_export";

export type WorkflowUiHintActionKind =
  | "retry_last_step"
  | "apply_recovery_plan"
  | "open_model_settings"
  | "dismiss"
  | "allow_once"
  | "deny";

export interface WorkflowUiHintAction {
  kind: WorkflowUiHintActionKind;
  label: string;
  intent?: "primary" | "default" | "danger";
}

export interface WorkflowUiHint {
  key: string;
  level: "info" | "warning" | "danger";
  title: string;
  message: string;
  actions: WorkflowUiHintAction[];
  context?: Record<string, unknown>;
}

export interface WorkflowNodeDefinition {
  id: string;
  kind: WorkflowNodeKind;
  name: string;
  enabled: boolean;
  retryCount: number;
  fallbackKind?: WorkflowNodeKind;
  params: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  shared: boolean;
  nodes: WorkflowNodeDefinition[];
}

export type WorkflowStepStatus = "success" | "failed" | "skipped" | "manual";

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
