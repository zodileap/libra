import { translateDesktopText } from "../i18n";
import { resolveDefaultAgentWorkflows } from "./templates";
import { AGENT_TOOLSET_LINES, normalizeAgentSkillId } from "./prompt-guidance";
import { IS_BROWSER, STORAGE_KEYS } from "../constants";
import {
  getProjectWorkspaceCapabilityManifest,
  type ProjectWorkspaceCapabilityId,
} from "../data";
import type {
  AgentWorkflowDefinition,
  AgentWorkflowOverview,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphEdgeType,
  WorkflowGraphNode,
  WorkflowGraphNodeType,
} from "./types";

// 描述：
//
//   - 记录默认智能体工作流 ID，用于限制内置模板被误删。
const DEFAULT_AGENT_WORKFLOW_ID_SET = new Set(
  resolveDefaultAgentWorkflows().map((item) => item.id),
);

// 描述：
//
//   - 画布节点横向间距基准值。
const GRAPH_NODE_HORIZONTAL_GAP = 240;

// 描述：
//
//   - 画布节点默认起始 X 坐标。
const GRAPH_CANVAS_BASE_X = 80;

// 描述：
//
//   - 画布节点默认起始 Y 坐标。
const GRAPH_CANVAS_BASE_Y = 160;

// 描述：
//
//   - 将工作流 ID 规范化为可存储的统一智能体命名。
//
// Params:
//
//   - workflowId: 原始工作流 ID。
//
// Returns:
//
//   - 归一后的工作流 ID。
function normalizeAgentWorkflowId(workflowId: string): string {
  const normalizedWorkflowId = String(workflowId || "").trim();
  if (!normalizedWorkflowId) {
    return "";
  }
  return normalizedWorkflowId;
}

// 描述：
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
    raw === "node"
    || raw === "start"
    || raw === "action"
    || raw === "skill"
    || raw === "branch"
    || raw === "loop"
    || raw === "end"
  ) {
    return raw;
  }
  return "node";
}

// 描述：
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

// 描述：
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
  const normalizedSkillId = normalizeAgentSkillId(String(node.skillId || "").trim());
  const normalizedSkillVersion = String(node.skillVersion || "").trim();
  return {
    id: String(node.id),
    title: String(node.title || "").trim() || translateDesktopText("未命名节点"),
    description: String(node.description || "").trim(),
    instruction: String(node.instruction || "").trim(),
    type: normalizedType,
    skillId: normalizedType === "skill" ? normalizedSkillId || undefined : undefined,
    skillVersion: normalizedType === "skill" ? normalizedSkillVersion || undefined : undefined,
    x,
    y,
  };
}

// 描述：
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

// 描述：
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
    .filter((edge) => nodeIdSet.has(edge.sourceId) && nodeIdSet.has(edge.targetId));
  if (nodes.length === 0) {
    return undefined;
  }
  return { nodes, edges };
}

// 描述：
//
//   - 基于统一智能体工作流生成默认四段式兜底图结构。
function buildAgentFallbackGraph(workflow: AgentWorkflowDefinition): WorkflowGraph {
  const nodes: WorkflowGraphNode[] = [
    {
      id: `${workflow.id}-start`,
      title: translateDesktopText("开始"),
      description: translateDesktopText("接收用户任务"),
      type: "node",
      x: GRAPH_CANVAS_BASE_X,
      y: GRAPH_CANVAS_BASE_Y,
    },
    {
      id: `${workflow.id}-analysis`,
      title: translateDesktopText("需求分析"),
      description: translateDesktopText("拆解目标、限制与边界"),
      type: "node",
      x: GRAPH_CANVAS_BASE_X + GRAPH_NODE_HORIZONTAL_GAP,
      y: GRAPH_CANVAS_BASE_Y,
    },
    {
      id: `${workflow.id}-execute`,
      title: translateDesktopText("实现与验证"),
      description: translateDesktopText("生成代码并执行测试"),
      type: "node",
      x: GRAPH_CANVAS_BASE_X + GRAPH_NODE_HORIZONTAL_GAP * 2,
      y: GRAPH_CANVAS_BASE_Y,
    },
    {
      id: `${workflow.id}-finish`,
      title: translateDesktopText("完成"),
      description: translateDesktopText("输出结果与后续建议"),
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

// 描述：
//
//   - 规范化智能体工作流定义并补齐兜底图结构。
//
// Params:
//
//   - workflow: 原始工作流定义。
//
// Returns:
//
//   - 规范化后的统一智能体工作流。
function normalizeAgentWorkflow(workflow: AgentWorkflowDefinition): AgentWorkflowDefinition {
  const normalizeCapabilityIds = (capabilityIds: ProjectWorkspaceCapabilityId[] | undefined) => {
    const normalized = (capabilityIds || [])
      .map((item) => String(item || "").trim())
      .filter((item): item is ProjectWorkspaceCapabilityId => Boolean(getProjectWorkspaceCapabilityManifest(item)));
    return normalized.filter((item, index) => normalized.indexOf(item) === index);
  };
  const normalizedSource = DEFAULT_AGENT_WORKFLOW_ID_SET.has(String(workflow.id || "").trim())
    ? "builtin"
    : workflow.source === "builtin"
      ? "builtin"
      : "user";
  const normalizedWorkflow: AgentWorkflowDefinition = {
    ...workflow,
    id: normalizeAgentWorkflowId(String(workflow.id || "").trim()),
    agentKey: "agent",
    promptPrefix: String(workflow.promptPrefix || "").trim(),
    requiredCapabilities: normalizeCapabilityIds(workflow.requiredCapabilities),
    optionalCapabilities: normalizeCapabilityIds(workflow.optionalCapabilities),
    source: normalizedSource,
    templateId: String(workflow.templateId || "").trim() || undefined,
    graph: normalizeWorkflowGraph(workflow.graph),
  };
  if (!normalizedWorkflow.graph) {
    normalizedWorkflow.graph = buildAgentFallbackGraph(normalizedWorkflow);
  }
  return normalizedWorkflow;
}

// 描述：
//
//   - 读取本地保存的统一智能体工作流列表。
function readSavedAgentWorkflows(): AgentWorkflowDefinition[] {
  if (!IS_BROWSER) {
    return [];
  }
  const raw = window.localStorage.getItem(STORAGE_KEYS.AGENT_WORKFLOWS);
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
      .map((item) => normalizeAgentWorkflow(item as AgentWorkflowDefinition));
  } catch (_err) {
    return [];
  }
}

// 描述：
//
//   - 将统一智能体工作流写入本地存储。
//
// Params:
//
//   - workflows: 最新工作流列表。
function writeSavedAgentWorkflows(workflows: AgentWorkflowDefinition[]) {
  if (!IS_BROWSER) {
    return;
  }
  const serialized = JSON.stringify(workflows);
  window.localStorage.setItem(STORAGE_KEYS.AGENT_WORKFLOWS, serialized);
}

// 描述：
//
//   - 返回当前工作流总览，按“用户已注册 / 应用内置模板”拆分，避免编辑页与总览页混用同一数据语义。
//
// Returns:
//
//   - 0: 工作流总览结构。
export function listAgentWorkflowOverview(): AgentWorkflowOverview {
  const registered = readSavedAgentWorkflows()
    .filter((item) => item.source === "user");
  const registeredTemplateIdSet = new Set(
    registered
      .map((item) => String(item.templateId || "").trim())
      .filter((item) => item.length > 0),
  );
  const templates = resolveDefaultAgentWorkflows()
    .map((item) => normalizeAgentWorkflow({ ...item, source: "builtin" }))
    .filter((item) => !registeredTemplateIdSet.has(item.id));
  return {
    registered,
    templates,
    all: [...registered, ...templates],
  };
}

// 描述：
//
//   - 返回当前可用智能体工作流列表，统一合并“用户已注册 + 内置模板”，供会话执行策略选择使用。
//
// Returns:
//
//   - 已归一化的工作流列表。
export function listAgentWorkflows(): AgentWorkflowDefinition[] {
  return listAgentWorkflowOverview().all;
}

// 描述：
//
//   - 按工作流 ID 读取单个工作流定义，统一支持用户工作流和内置模板。
//
// Params:
//
//   - workflowId: 工作流 ID。
//
// Returns:
//
//   - 0: 命中时返回工作流；未命中返回 null。
export function getAgentWorkflowById(workflowId: string): AgentWorkflowDefinition | null {
  const normalizedWorkflowId = normalizeAgentWorkflowId(String(workflowId || "").trim());
  if (!normalizedWorkflowId) {
    return null;
  }
  return listAgentWorkflows().find((item) => item.id === normalizedWorkflowId) || null;
}

// 描述：
//
//   - 判断工作流是否为只读模板；当前仅用户自建工作流允许保存与删除。
//
// Params:
//
//   - workflow: 当前工作流。
//
// Returns:
//
//   - true: 只读。
export function isReadonlyAgentWorkflow(workflow: AgentWorkflowDefinition | null | undefined): boolean {
  return String(workflow?.source || "").trim() !== "user";
}

// 描述：
//
//   - 保存智能体工作流定义，若同 ID 存在则覆盖。
//
// Params:
//
//   - workflow: 待保存智能体工作流。
//
// Returns:
//
//   - 保存后的智能体工作流。
export function saveAgentWorkflow(
  workflow: AgentWorkflowDefinition,
): AgentWorkflowDefinition {
  const normalizedWorkflow = normalizeAgentWorkflow({
    ...workflow,
    source: "user",
  });
  const all = readSavedAgentWorkflows();
  const next = all.map((item) => (
    item.id === normalizedWorkflow.id
      ? normalizedWorkflow
      : item
  ));
  if (!next.some((item) => item.id === normalizedWorkflow.id)) {
    next.push(normalizedWorkflow);
  }
  writeSavedAgentWorkflows(next);
  return normalizedWorkflow;
}

// 描述：
//
//   - 基于现有智能体工作流模板创建一个自定义副本。
//
// Params:
//
//   - baseId: 作为复制来源的工作流 ID。
//
// Returns:
//
//   - 新建的智能体工作流。
export function createAgentWorkflowFromTemplate(
  baseId?: string,
): AgentWorkflowDefinition {
  const normalizedBaseId = normalizeAgentWorkflowId(String(baseId || "").trim());
  const workflows = listAgentWorkflows();
  const source = workflows.find((item) => item.id === normalizedBaseId) || workflows[0];
  const nextWorkflow: AgentWorkflowDefinition = {
    ...source,
    id: `wf-agent-custom-${Date.now()}`,
    name: translateDesktopText("{{name}} - 副本", { name: source.name }),
    version: source.version + 1,
    shared: false,
    agentKey: "agent",
    source: "user",
    templateId: source.source === "builtin"
      ? source.id
      : String(source.templateId || source.id).trim() || undefined,
  };
  saveAgentWorkflow(nextWorkflow);
  return nextWorkflow;
}

// 描述：
//
//   - 创建空白用户工作流，并自动注入兜底图结构，供工作流总览和侧边栏“新增”动作复用。
//
// Returns:
//
//   - 0: 新建后的用户工作流。
export function createAgentWorkflow(): AgentWorkflowDefinition {
  const nextWorkflow = saveAgentWorkflow({
    id: `wf-agent-custom-${Date.now()}`,
    name: translateDesktopText("未命名工作流"),
    description: translateDesktopText("请输入工作流说明"),
    version: 1,
    shared: false,
    agentKey: "agent",
    promptPrefix: "",
    source: "user",
    graph: undefined,
  });
  return nextWorkflow;
}

// 描述：
//
//   - 删除智能体工作流（仅支持删除自定义工作流，默认模板不可删除）。
//
// Params:
//
//   - workflowId: 待删除工作流 ID。
//
// Returns:
//
//   - true: 删除成功。
//   - false: 删除失败（如默认模板/不存在）。
export function deleteAgentWorkflow(workflowId: string): boolean {
  const normalizedWorkflowId = normalizeAgentWorkflowId(String(workflowId || "").trim());
  if (!normalizedWorkflowId || DEFAULT_AGENT_WORKFLOW_ID_SET.has(normalizedWorkflowId)) {
    return false;
  }
  const all = readSavedAgentWorkflows();
  if (!all.some((item) => item.id === normalizedWorkflowId)) {
    return false;
  }
  const next = all.filter((item) => item.id !== normalizedWorkflowId);
  writeSavedAgentWorkflows(next);
  return true;
}

// 描述：
//
//   - 根据智能体工作流拼接本次执行 Prompt，未配置前缀时回退原始用户输入。
//
// Params:
//
//   - workflow: 当前选中智能体工作流。
//   - userPrompt: 用户原始输入。
//
// Returns:
//
//   - 拼接后的执行 Prompt。
export function buildAgentWorkflowPrompt(
  workflow: AgentWorkflowDefinition | null | undefined,
  userPrompt: string,
): string {
  const normalizedPrompt = String(userPrompt || "").trim();
  const prefix = String(workflow?.promptPrefix || "").trim();
  const skillChainLines = (workflow?.graph?.nodes || [])
    .filter((node) => node.type === "skill")
    .map((node) => {
      const skillId = normalizeAgentSkillId(String(node.skillId || "").trim());
      const normalizedInstruction = String(node.instruction || "").trim();
      const label = String(node.title || translateDesktopText("技能节点")).trim() || translateDesktopText("技能节点");
      if (normalizedInstruction) {
        return skillId
          ? translateDesktopText("- {{label}}：技能编码 {{skillId}}；本节点要求：{{instruction}}", {
            label,
            skillId,
            instruction: normalizedInstruction,
          })
          : translateDesktopText("- {{label}}：{{instruction}}", {
            label,
            instruction: normalizedInstruction,
          });
      }
      if (skillId) {
        return translateDesktopText("- {{label}}：技能编码 {{skillId}}", {
          label,
          skillId,
        });
      }
      return "";
    })
    .filter((line) => line.length > 0);
  const capabilityLines = [
    ...((workflow?.requiredCapabilities || []).map((item) => {
      const manifest = getProjectWorkspaceCapabilityManifest(item);
      return manifest ? translateDesktopText("- 必需能力：{{title}}（{{id}}）", {
        title: manifest.title,
        id: manifest.id,
      }) : "";
    })),
    ...((workflow?.optionalCapabilities || []).map((item) => {
      const manifest = getProjectWorkspaceCapabilityManifest(item);
      return manifest ? translateDesktopText("- 可选能力：{{title}}（{{id}}）", {
        title: manifest.title,
        id: manifest.id,
      }) : "";
    })),
  ].filter((line) => line.length > 0);
  const toolsetBlock = ["", ...AGENT_TOOLSET_LINES];
  if (!prefix) {
    if (skillChainLines.length === 0) {
      return [
        ...AGENT_TOOLSET_LINES,
        "",
        translateDesktopText("【用户需求】"),
        normalizedPrompt,
      ].join("\n");
    }
    return [
      translateDesktopText("【技能链路】"),
      ...skillChainLines,
      ...(capabilityLines.length > 0 ? ["", translateDesktopText("【项目能力声明】"), ...capabilityLines] : []),
      ...toolsetBlock,
      "",
      translateDesktopText("【用户需求】"),
      normalizedPrompt,
    ].join("\n");
  }
  const skillChainBlock = skillChainLines.length > 0
    ? ["", translateDesktopText("【技能链路】"), ...skillChainLines]
    : [];
  const capabilityBlock = capabilityLines.length > 0
    ? ["", translateDesktopText("【项目能力声明】"), ...capabilityLines]
    : [];
  return [
    translateDesktopText("【工作流：{{name}}】", {
      name: workflow?.name || translateDesktopText("智能体工作流"),
    }),
    prefix,
    ...skillChainBlock,
    ...capabilityBlock,
    ...toolsetBlock,
    "",
    translateDesktopText("【用户需求】"),
    normalizedPrompt,
  ].join("\n");
}
