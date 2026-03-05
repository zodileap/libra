import { DEFAULT_CODE_WORKFLOWS, DEFAULT_MODEL_WORKFLOWS } from "./templates";
import { CODE_AGENT_TOOLSET_LINES, resolveCodeSkillPromptGuide } from "./prompt-guidance";
import { IS_BROWSER, STORAGE_KEYS } from "../constants";
import type {
  CodeWorkflowDefinition,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphEdgeType,
  WorkflowGraphNode,
  WorkflowGraphNodeType,
  WorkflowDefinition,
  WorkflowNodeDefinition,
} from "./types";



// 描述：
//
//   - 记录默认模型工作流 ID，用于限制默认模板被误删。
const DEFAULT_MODEL_WORKFLOW_ID_SET = new Set(
  DEFAULT_MODEL_WORKFLOWS.map((item) => item.id),
);

// 描述：
//
//   - 记录默认代码工作流 ID，用于限制默认模板被误删。
const DEFAULT_CODE_WORKFLOW_ID_SET = new Set(
  DEFAULT_CODE_WORKFLOWS.map((item) => item.id),
);

// 描述:
//
//   - 画布节点横向间距基准值。
const GRAPH_NODE_HORIZONTAL_GAP = 240;

// 描述:
//
//   - 画布节点默认起始 X 坐标。
const GRAPH_CANVAS_BASE_X = 80;

// 描述:
//
//   - 画布节点默认起始 Y 坐标。
const GRAPH_CANVAS_BASE_Y = 160;

// 描述:
//
//   - 规范化节点类型，确保类型落在支持集合中。
//
// Params:
//
//   - value: 原始节点类型值。
//
// Returns:
//
//   - 合法节点类型。
function normalizeNodeType(value: unknown): WorkflowGraphNodeType {
  const raw = String(value || "").trim();
  if (
    raw === "node" ||
    raw === "start" ||
    raw === "action" ||
    raw === "skill" ||
    raw === "branch" ||
    raw === "loop" ||
    raw === "end"
  ) {
    return raw;
  }
  return "node";
}

// 描述:
//
//   - 规范化连线类型，确保类型落在支持集合中。
//
// Params:
//
//   - value: 原始连线类型值。
//
// Returns:
//
//   - 合法连线类型。
function normalizeEdgeType(value: unknown): WorkflowGraphEdgeType {
  const raw = String(value || "").trim();
  if (raw === "default" || raw === "branch" || raw === "loop") {
    return raw;
  }
  return "default";
}

// 描述:
//
//   - 规范化单个画布节点，过滤无效节点并填充默认值。
//
// Params:
//
//   - node: 原始节点。
//
// Returns:
//
//   - 规范化节点；无效时返回 null。
function normalizeGraphNode(node: WorkflowGraphNode): WorkflowGraphNode | null {
  if (!node?.id) {
    return null;
  }
  const x = Number.isFinite(node.x) ? Number(node.x) : GRAPH_CANVAS_BASE_X;
  const y = Number.isFinite(node.y) ? Number(node.y) : GRAPH_CANVAS_BASE_Y;
  const normalizedType = normalizeNodeType(node.type);
  const normalizedSkillId = String(node.skillId || "").trim();
  const normalizedSkillVersion = String(node.skillVersion || "").trim();
  return {
    id: String(node.id),
    title: String(node.title || "").trim() || "未命名节点",
    description: String(node.description || "").trim(),
    instruction: String(node.instruction || "").trim(),
    type: normalizedType,
    skillId: normalizedType === "skill" ? normalizedSkillId || undefined : undefined,
    skillVersion: normalizedType === "skill" ? normalizedSkillVersion || undefined : undefined,
    x,
    y,
  };
}

// 描述:
//
//   - 规范化单条连线，过滤缺失关键字段的无效数据。
//
// Params:
//
//   - edge: 原始连线。
//
// Returns:
//
//   - 规范化连线；无效时返回 null。
function normalizeGraphEdge(edge: WorkflowGraphEdge): WorkflowGraphEdge | null {
  if (!edge?.id || !edge?.sourceId || !edge?.targetId) {
    return null;
  }
  return {
    id: String(edge.id),
    sourceId: String(edge.sourceId),
    targetId: String(edge.targetId),
    type: normalizeEdgeType(edge.type),
    label: String(edge.label || "").trim() || undefined,
  };
}

// 描述:
//
//   - 规范化工作流图结构，自动剔除孤立或非法边。
//
// Params:
//
//   - graph: 原始工作流图。
//
// Returns:
//
//   - 规范化图结构；空图返回 undefined。
function normalizeWorkflowGraph(graph?: WorkflowGraph): WorkflowGraph | undefined {
  if (!graph) {
    return undefined;
  }
  const nodes = (graph.nodes || [])
    .map((node) => normalizeGraphNode(node))
    .filter(Boolean) as WorkflowGraphNode[];
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const edges = (graph.edges || [])
    .map((edge) => normalizeGraphEdge(edge))
    .filter((edge): edge is WorkflowGraphEdge => Boolean(edge))
    .filter(
      (edge): edge is WorkflowGraphEdge =>
        nodeIdSet.has(edge.sourceId) &&
        nodeIdSet.has(edge.targetId),
    );
  if (nodes.length === 0) {
    return undefined;
  }
  return { nodes, edges };
}

// 描述:
//
//   - 基于模型工作流节点生成兜底图结构。
function buildModelFallbackGraph(workflow: WorkflowDefinition): WorkflowGraph {
  const nodes = (workflow.nodes || []).map((node, index) => {
    return {
      id: `graph-${node.id}`,
      title: node.name || node.kind,
      description: `kind=${node.kind}`,
      type: "node",
      x: GRAPH_CANVAS_BASE_X + index * GRAPH_NODE_HORIZONTAL_GAP,
      y: GRAPH_CANVAS_BASE_Y,
    } as WorkflowGraphNode;
  });
  const edges: WorkflowGraphEdge[] = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${node.id}-${nodes[index + 1].id}`,
    sourceId: node.id,
    targetId: nodes[index + 1].id,
    type: "default",
  }));
  return { nodes, edges };
}

// 描述:
//
//   - 基于代码工作流生成默认四段式兜底图结构。
function buildCodeFallbackGraph(workflow: CodeWorkflowDefinition): WorkflowGraph {
  const nodes: WorkflowGraphNode[] = [
    {
      id: `${workflow.id}-start`,
      title: "开始",
      description: "接收用户任务",
      type: "node",
      x: GRAPH_CANVAS_BASE_X,
      y: GRAPH_CANVAS_BASE_Y,
    },
    {
      id: `${workflow.id}-analysis`,
      title: "需求分析",
      description: "拆解目标、限制与边界",
      type: "node",
      x: GRAPH_CANVAS_BASE_X + GRAPH_NODE_HORIZONTAL_GAP,
      y: GRAPH_CANVAS_BASE_Y,
    },
    {
      id: `${workflow.id}-execute`,
      title: "实现与验证",
      description: "生成代码并执行测试",
      type: "node",
      x: GRAPH_CANVAS_BASE_X + GRAPH_NODE_HORIZONTAL_GAP * 2,
      y: GRAPH_CANVAS_BASE_Y,
    },
    {
      id: `${workflow.id}-finish`,
      title: "完成",
      description: "输出结果与后续建议",
      type: "node",
      x: GRAPH_CANVAS_BASE_X + GRAPH_NODE_HORIZONTAL_GAP * 3,
      y: GRAPH_CANVAS_BASE_Y,
    },
  ];
  const edges: WorkflowGraphEdge[] = [
    {
      id: `${workflow.id}-edge-start-analysis`,
      sourceId: nodes[0].id,
      targetId: nodes[1].id,
      type: "default",
    },
    {
      id: `${workflow.id}-edge-analysis-execute`,
      sourceId: nodes[1].id,
      targetId: nodes[2].id,
      type: "default",
    },
    {
      id: `${workflow.id}-edge-execute-finish`,
      sourceId: nodes[2].id,
      targetId: nodes[3].id,
      type: "default",
    },
  ];
  return { nodes, edges };
}

// 描述:
//
//   - 规范化模型工作流节点定义，兼容历史字段与文案。
function normalizeWorkflowNode(node: WorkflowNodeDefinition): WorkflowNodeDefinition {
  const nextNode: WorkflowNodeDefinition = {
    ...node,
    params: { ...(node.params || {}) },
  };

  if (nextNode.kind === "blender_refine_export") {
    if (typeof nextNode.name === "string") {
      nextNode.name = nextNode.name
        .replace("优化 + 导出", "DCC MCP 操作（按需导出）")
        .replace("自然语言优化（按需导出）", "DCC MCP 操作（导入/新建/编辑/按需导出）")
        .replace("直接优化（按需导出）", "DCC 直接操作（导入/新建/编辑/按需导出）");
    }
    if ("appendExportKeyword" in nextNode.params) {
      delete (nextNode.params as Record<string, unknown>).appendExportKeyword;
    }
  }

  return nextNode;
}

// 描述:
//
//   - 规范化模型工作流定义并补齐兜底图结构。
function normalizeWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const normalizedWorkflow: WorkflowDefinition = {
    ...workflow,
    nodes: (workflow.nodes || []).map(normalizeWorkflowNode),
    graph: normalizeWorkflowGraph(workflow.graph),
  };
  if (!normalizedWorkflow.graph) {
    normalizedWorkflow.graph = buildModelFallbackGraph(normalizedWorkflow);
  }
  return {
    ...normalizedWorkflow,
  };
}

// 描述:
//
//   - 规范化代码工作流定义并补齐兜底图结构。
function normalizeCodeWorkflow(
  workflow: CodeWorkflowDefinition,
): CodeWorkflowDefinition {
  const normalizedWorkflow: CodeWorkflowDefinition = {
    ...workflow,
    agentKey: "code",
    promptPrefix: String(workflow.promptPrefix || "").trim(),
    graph: normalizeWorkflowGraph(workflow.graph),
  };
  if (!normalizedWorkflow.graph) {
    normalizedWorkflow.graph = buildCodeFallbackGraph(normalizedWorkflow);
  }
  return {
    ...normalizedWorkflow,
  };
}

// 描述:
//
//   - 读取本地保存的模型工作流列表。
function readSavedWorkflows(): WorkflowDefinition[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(STORAGE_KEYS.MODEL_WORKFLOWS);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item?.id && Array.isArray(item?.nodes))
      .map((item) => normalizeWorkflow(item as WorkflowDefinition));
  } catch (_err) {
    return [];
  }
}

// 描述:
//
//   - 读取本地保存的代码工作流列表。
function readSavedCodeWorkflows(): CodeWorkflowDefinition[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(STORAGE_KEYS.CODE_WORKFLOWS);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item?.id && typeof item?.name === "string")
      .map((item) => normalizeCodeWorkflow(item as CodeWorkflowDefinition));
  } catch (_err) {
    return [];
  }
}

function writeSavedWorkflows(workflows: WorkflowDefinition[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEYS.MODEL_WORKFLOWS, JSON.stringify(workflows));
}

function writeSavedCodeWorkflows(workflows: CodeWorkflowDefinition[]) {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEYS.CODE_WORKFLOWS, JSON.stringify(workflows));
}

function cloneNodes(nodes: WorkflowNodeDefinition[]): WorkflowNodeDefinition[] {
  return nodes.map((node) => normalizeWorkflowNode(node));
}

// 描述：
//
//   - 返回当前可用模型工作流列表，包含默认模板与本地自定义覆盖项。
export function listModelWorkflows(): WorkflowDefinition[] {
  const saved = readSavedWorkflows();
  const merged: WorkflowDefinition[] = DEFAULT_MODEL_WORKFLOWS.map((item) =>
    normalizeWorkflow({
      ...item,
      nodes: cloneNodes(item.nodes),
    }),
  );

  for (const workflow of saved) {
    const index = merged.findIndex((item) => item.id === workflow.id);
    if (index >= 0) {
      merged[index] = normalizeWorkflow({
        ...workflow,
        nodes: cloneNodes(workflow.nodes || []),
      });
    } else {
      merged.push(normalizeWorkflow({
        ...workflow,
        nodes: cloneNodes(workflow.nodes || []),
      }));
    }
  }

  return merged;
}

// 描述：
//
//   - 保存模型工作流定义，若同 ID 存在则覆盖。
//
// Params:
//
//   - workflow: 待保存工作流。
//
// Returns:
//
//   - 保存后的工作流。
export function saveModelWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const normalizedWorkflow = normalizeWorkflow(workflow);
  const all = listModelWorkflows();
  const next = all.map((item) =>
    item.id === normalizedWorkflow.id
      ? {
          ...normalizedWorkflow,
          nodes: cloneNodes(normalizedWorkflow.nodes),
        }
      : item
  );
  if (!next.some((item) => item.id === normalizedWorkflow.id)) {
    next.push({
      ...normalizedWorkflow,
      nodes: cloneNodes(normalizedWorkflow.nodes),
    });
  }
  writeSavedWorkflows(next);
  return normalizedWorkflow;
}

// 描述：
//
//   - 基于现有模型工作流模板创建一个自定义副本。
//
// Params:
//
//   - baseId: 作为复制来源的工作流 ID。
//
// Returns:
//
//   - 新建的工作流。
export function createModelWorkflowFromTemplate(baseId?: string): WorkflowDefinition {
  const source = listModelWorkflows().find((item) => item.id === baseId) || listModelWorkflows()[0];
  const id = `wf-custom-${Date.now()}`;
  const workflow: WorkflowDefinition = {
    ...source,
    id,
    name: `${source.name}-副本`,
    version: source.version + 1,
    shared: false,
    nodes: cloneNodes(source.nodes),
  };
  saveModelWorkflow(workflow);
  return workflow;
}

// 描述：
//
//   - 复制指定模型工作流，来源不存在时回退到默认模板。
//
// Params:
//
//   - workflowId: 被复制工作流 ID。
//
// Returns:
//
//   - 新建副本。
export function copyModelWorkflow(workflowId: string): WorkflowDefinition {
  const source = listModelWorkflows().find((item) => item.id === workflowId);
  if (!source) {
    return createModelWorkflowFromTemplate();
  }
  return createModelWorkflowFromTemplate(source.id);
}

// 描述：
//
//   - 切换模型工作流分享状态，返回更新结果。
//
// Params:
//
//   - workflowId: 目标工作流 ID。
//
// Returns:
//
//   - 更新后的工作流；未命中则返回 null。
export function toggleShareModelWorkflow(workflowId: string): WorkflowDefinition | null {
  const all = listModelWorkflows();
  const target = all.find((item) => item.id === workflowId);
  if (!target) {
    return null;
  }
  const nextTarget: WorkflowDefinition = {
    ...target,
    shared: !target.shared,
  };
  saveModelWorkflow(nextTarget);
  return nextTarget;
}

// 描述：
//
//   - 删除模型工作流（仅支持删除自定义工作流，默认模板不可删除）。
//
// Params:
//
//   - workflowId: 待删除工作流 ID。
//
// Returns:
//
//   - true: 删除成功。
//   - false: 删除失败（如默认模板/不存在）。
export function deleteModelWorkflow(workflowId: string): boolean {
  if (!workflowId || DEFAULT_MODEL_WORKFLOW_ID_SET.has(workflowId)) {
    return false;
  }
  const all = listModelWorkflows();
  if (!all.some((item) => item.id === workflowId)) {
    return false;
  }
  const next = all.filter((item) => item.id !== workflowId);
  writeSavedWorkflows(next);
  return true;
}

// 描述：
//
//   - 更新模型工作流画布数据（节点与连线）。
//
// Params:
//
//   - workflowId: 工作流 ID。
//   - graph: 最新图结构。
//
// Returns:
//
//   - 更新后的工作流；未命中则返回 null。
export function updateModelWorkflowGraph(
  workflowId: string,
  graph: WorkflowGraph,
): WorkflowDefinition | null {
  const target = listModelWorkflows().find((item) => item.id === workflowId);
  if (!target) {
    return null;
  }
  const next: WorkflowDefinition = {
    ...target,
    graph: normalizeWorkflowGraph(graph) || buildModelFallbackGraph(target),
    version: target.version + 1,
  };
  return saveModelWorkflow(next);
}

// 描述：
//
//   - 更新模型工作流中指定节点参数，更新后自动提升版本号。
//
// Params:
//
//   - workflowId: 工作流 ID。
//   - nodeId: 节点 ID。
//   - params: 节点参数对象。
//
// Returns:
//
//   - 更新后的工作流；未命中则返回 null。
export function updateWorkflowNodeParams(
  workflowId: string,
  nodeId: string,
  params: Record<string, unknown>,
): WorkflowDefinition | null {
  const target = listModelWorkflows().find((item) => item.id === workflowId);
  if (!target) {
    return null;
  }

  const next: WorkflowDefinition = {
    ...target,
    version: target.version + 1,
    nodes: target.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            params: { ...params },
          }
        : node
    ),
  };

  saveModelWorkflow(next);
  return next;
}

// 描述：
//
//   - 返回当前可用代码工作流列表，包含默认模板与本地自定义覆盖项。
export function listCodeWorkflows(): CodeWorkflowDefinition[] {
  const saved = readSavedCodeWorkflows();
  const merged: CodeWorkflowDefinition[] = DEFAULT_CODE_WORKFLOWS.map((item) =>
    normalizeCodeWorkflow({ ...item }),
  );
  for (const workflow of saved) {
    const index = merged.findIndex((item) => item.id === workflow.id);
    if (index >= 0) {
      merged[index] = normalizeCodeWorkflow({ ...workflow });
    } else {
      merged.push(normalizeCodeWorkflow({ ...workflow }));
    }
  }
  return merged;
}

// 描述：
//
//   - 保存代码工作流定义，若同 ID 存在则覆盖。
//
// Params:
//
//   - workflow: 待保存代码工作流。
//
// Returns:
//
//   - 保存后的代码工作流。
export function saveCodeWorkflow(
  workflow: CodeWorkflowDefinition,
): CodeWorkflowDefinition {
  const normalized = normalizeCodeWorkflow(workflow);
  const all = listCodeWorkflows();
  const next = all.map((item) => (item.id === normalized.id ? normalized : item));
  if (!next.some((item) => item.id === normalized.id)) {
    next.push(normalized);
  }
  writeSavedCodeWorkflows(next);
  return normalized;
}

// 描述：
//
//   - 基于现有代码工作流模板创建一个自定义副本。
//
// Params:
//
//   - baseId: 作为复制来源的工作流 ID。
//
// Returns:
//
//   - 新建的代码工作流。
export function createCodeWorkflowFromTemplate(
  baseId?: string,
): CodeWorkflowDefinition {
  const source = listCodeWorkflows().find((item) => item.id === baseId) || listCodeWorkflows()[0];
  const nextWorkflow: CodeWorkflowDefinition = {
    ...source,
    id: `wf-code-custom-${Date.now()}`,
    name: `${source.name}-副本`,
    version: source.version + 1,
    shared: false,
    agentKey: "code",
  };
  saveCodeWorkflow(nextWorkflow);
  return nextWorkflow;
}

// 描述：
//
//   - 复制指定代码工作流，来源不存在时回退到默认模板。
//
// Params:
//
//   - workflowId: 被复制工作流 ID。
//
// Returns:
//
//   - 新建副本。
export function copyCodeWorkflow(workflowId: string): CodeWorkflowDefinition {
  const source = listCodeWorkflows().find((item) => item.id === workflowId);
  if (!source) {
    return createCodeWorkflowFromTemplate();
  }
  return createCodeWorkflowFromTemplate(source.id);
}

// 描述：
//
//   - 切换代码工作流分享状态，返回更新结果。
//
// Params:
//
//   - workflowId: 目标工作流 ID。
//
// Returns:
//
//   - 更新后的工作流；未命中则返回 null。
export function toggleShareCodeWorkflow(
  workflowId: string,
): CodeWorkflowDefinition | null {
  const all = listCodeWorkflows();
  const target = all.find((item) => item.id === workflowId);
  if (!target) {
    return null;
  }
  const nextTarget = {
    ...target,
    shared: !target.shared,
  };
  saveCodeWorkflow(nextTarget);
  return nextTarget;
}

// 描述：
//
//   - 删除代码工作流（仅支持删除自定义工作流，默认模板不可删除）。
//
// Params:
//
//   - workflowId: 待删除工作流 ID。
//
// Returns:
//
//   - true: 删除成功。
//   - false: 删除失败（如默认模板/不存在）。
export function deleteCodeWorkflow(workflowId: string): boolean {
  if (!workflowId || DEFAULT_CODE_WORKFLOW_ID_SET.has(workflowId)) {
    return false;
  }
  const all = listCodeWorkflows();
  if (!all.some((item) => item.id === workflowId)) {
    return false;
  }
  const next = all.filter((item) => item.id !== workflowId);
  writeSavedCodeWorkflows(next);
  return true;
}

// 描述：
//
//   - 更新代码工作流画布数据（节点与连线）。
//
// Params:
//
//   - workflowId: 工作流 ID。
//   - graph: 最新图结构。
//
// Returns:
//
//   - 更新后的工作流；未命中则返回 null。
export function updateCodeWorkflowGraph(
  workflowId: string,
  graph: WorkflowGraph,
): CodeWorkflowDefinition | null {
  const target = listCodeWorkflows().find((item) => item.id === workflowId);
  if (!target) {
    return null;
  }
  const next: CodeWorkflowDefinition = {
    ...target,
    graph: normalizeWorkflowGraph(graph) || buildCodeFallbackGraph(target),
    version: target.version + 1,
  };
  return saveCodeWorkflow(next);
}

// 描述：
//
//   - 根据代码工作流拼接本次执行 Prompt，未配置前缀时回退原始用户输入。
//
// Params:
//
//   - workflow: 当前选中代码工作流。
//   - userPrompt: 用户原始输入。
//
// Returns:
//
//   - 拼接后的执行 Prompt。
export function buildCodeWorkflowPrompt(
  workflow: CodeWorkflowDefinition | null | undefined,
  userPrompt: string,
): string {
  const normalizedPrompt = String(userPrompt || "").trim();
  const prefix = String(workflow?.promptPrefix || "").trim();
  // 描述：
  //
  //   - 从代码工作流图中提取技能节点链路，拼接到提示词中辅助代码智能体按技能顺序执行。
  const skillChainLines = (workflow?.graph?.nodes || [])
    .filter((node) => node.type === "skill")
    .map((node) => {
      const skillId = String(node.skillId || "").trim();
      const normalizedSkill = skillId
        ? resolveCodeSkillPromptGuide(skillId)
        : "";
      const normalizedInstruction = String(node.instruction || "").trim();
      const label = String(node.title || "技能节点").trim() || "技能节点";
      if (normalizedSkill && normalizedInstruction) {
        return `- ${label}：${normalizedSkill.name}；能力：${normalizedSkill.objective}；产出：${normalizedSkill.deliverable}；本节点要求：${normalizedInstruction}`;
      }
      if (normalizedSkill) {
        return `- ${label}：${normalizedSkill.name}；能力：${normalizedSkill.objective}；产出：${normalizedSkill.deliverable}`;
      }
      if (normalizedInstruction) {
        return skillId
          ? `- ${label}：技能编码 ${skillId}；本节点要求：${normalizedInstruction}`
          : `- ${label}：${normalizedInstruction}`;
      }
      return "";
    })
    .filter((line) => line.length > 0);
  const toolsetBlock = ["", ...CODE_AGENT_TOOLSET_LINES];
  if (!prefix) {
    if (skillChainLines.length === 0) {
      return [
        ...CODE_AGENT_TOOLSET_LINES,
        "",
        "【用户需求】",
        normalizedPrompt,
      ].join("\n");
    }
    return [
      "【技能链路】",
      ...skillChainLines,
      ...toolsetBlock,
      "",
      "【用户需求】",
      normalizedPrompt,
    ].join("\n");
  }
  const skillChainBlock = skillChainLines.length > 0
    ? ["", "【技能链路】", ...skillChainLines]
    : [];
  return [
    `【工作流：${workflow?.name || "代码工作流"}】`,
    prefix,
    ...skillChainBlock,
    ...toolsetBlock,
    "",
    "【用户需求】",
    normalizedPrompt,
  ].join("\n");
}
