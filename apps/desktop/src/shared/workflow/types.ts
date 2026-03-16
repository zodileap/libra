import type { AgentKey } from "../types";

// 描述:
//
//   - 定义工作流 UI 提示动作类型枚举。
export type WorkflowUiHintActionKind =
  | "retry_last_step"
  | "apply_recovery_plan"
  | "open_agent_settings"
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
//   - 定义工作流图节点类型枚举。
export type WorkflowGraphNodeType =
  | "node"
  | "start"
  | "action"
  | "skill"
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
  content?: string;
  type: WorkflowGraphNodeType;
  skillId?: string;
  skillVersion?: string;
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
//   - 定义统一智能体工作流结构。
export interface AgentWorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  shared: boolean;
  agentKey: AgentKey;
  promptPrefix: string;
  source?: "builtin" | "user";
  templateId?: string;
  graph?: WorkflowGraph;
}

// 描述:
//
//   - 定义工作流总览结构，按“已注册工作流 / 内置模板”分组输出，供工作流面板和侧边栏复用。
export interface AgentWorkflowOverview {
  registered: AgentWorkflowDefinition[];
  templates: AgentWorkflowDefinition[];
  all: AgentWorkflowDefinition[];
}
