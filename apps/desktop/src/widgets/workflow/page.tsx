import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IS_BROWSER } from "../../shared/constants";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  NodeResizer,
  Position,
  ReactFlow,
  reconnectEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import type { Connection, Edge, Node, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriContextMenu,
  AriDivider,
  AriFlex,
  AriForm,
  AriFormItem,
  AriIcon,
  AriInput,
  AriMessage,
  AriModal,
  AriSelect,
  AriTag,
  AriTypography,
} from "aries_react";
import { useSearchParams } from "react-router-dom";
import { listInstalledSkills } from "../../modules/common/services";
import type { SkillCatalogItem } from "../../modules/common/services";
import {
  deleteCodeWorkflow,
  deleteModelWorkflow,
  listCodeWorkflows,
  listModelWorkflows,
  saveCodeWorkflow,
  saveModelWorkflow,
} from "../../shared/workflow";
import type {
  CodeWorkflowDefinition,
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowGraphNodeType,
} from "../../shared/workflow";
import type { AgentKey } from "../../shared/types";
import { useDesktopHeaderSlot } from "../app-header/header-slot-context";

// 描述:
//
//   - 定义画布节点展示数据结构，统一管理节点标题、说明与指令字段。
interface CanvasNodeData {
  label: string;
  title: string;
  description: string;
  instruction: string;
  nodeType: WorkflowGraphNodeType;
  skillId: string;
  skillVersion: string;
  [key: string]: unknown;
}

interface ParsedCanvasNodeData {
  title: string;
  description: string;
  instruction: string;
  type: WorkflowGraphNodeType;
  skillId?: string;
  skillVersion?: string;
}

// 描述:
//
//   - 定义工作流画布页面入参，用于加载目标工作流集合。
interface WorkflowCanvasPageProps {
  agentKey: AgentKey;
}

// 描述：
//
//   - 定义画布交互模式，区分“选择元素”与“拖动画布”两种行为。
type WorkflowCanvasMode = "select" | "pan";

// 描述：
//
//   - 定义右键菜单当前作用目标。
interface WorkflowContextTarget {
  type: "node" | "edge";
  id: string;
}

const WORKFLOW_NODE_TYPE = "workflowNode";

type WorkflowCanvasNode = Node<CanvasNodeData, typeof WORKFLOW_NODE_TYPE>;

// 描述：
//
//   - 读取主题中的基础间距变量，用于计算新节点的默认落点，避免硬编码像素常量。
//
// Returns:
//
//   - 当前主题下的基础间距值。
function resolveThemeInset(): number {
  if (!IS_BROWSER) {
    return 16;
  }
  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--z-inset")
    .trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 16;
}

// 描述：
//
//   - 从 React Flow 节点数据中读取业务字段，避免空值影响保存与展示。
//
// Params:
//
//   - data: 节点 data 对象。
//
// Returns:
//
//   - 标题、说明与指令字段。
function parseCanvasNodeData(
  data: unknown,
): ParsedCanvasNodeData {
  const source = (data || {}) as Partial<CanvasNodeData>;
  const rawType = String(source.nodeType || "").trim();
  const nodeType: WorkflowGraphNodeType = (
    rawType === "node"
    || rawType === "start"
    || rawType === "action"
    || rawType === "skill"
    || rawType === "branch"
    || rawType === "loop"
    || rawType === "end"
  ) ? rawType : "action";
  const normalizedSkillId = String(source.skillId || "").trim();
  const normalizedSkillVersion = String(source.skillVersion || "").trim();
  return {
    title:
      String(source.title || source.label || "未命名节点").trim() ||
      "未命名节点",
    description: String(source.description || "").trim(),
    instruction: String(source.instruction || "").trim(),
    type: nodeType,
    skillId: nodeType === "skill" ? normalizedSkillId || undefined : undefined,
    skillVersion: nodeType === "skill" ? normalizedSkillVersion || undefined : undefined,
  };
}

// 描述：
//
//   - 从节点说明中提取 kind 语义，统一复用在节点角色与正文展示，避免在渲染层重复解析字符串。
//
// Params:
//
//   - description: 节点说明文本。
//
// Returns:
//
//   - 解析后的 kind；若无 kind 前缀则返回空字符串。
function parseNodeKind(description: string): string {
  const trimmed = String(description || "").trim();
  if (!trimmed.startsWith("kind=")) {
    return "";
  }
  return trimmed.slice("kind=".length).trim();
}

// 描述：
//
//   - 根据节点 kind 计算顶部标签文案，输入节点使用 Trigger，其余节点统一归类为 Action。
//
// Params:
//
//   - kind: 解析后的节点 kind。
//
// Returns:
//
//   - 节点角色标签文本。
function resolveNodeRoleLabel(
  nodeType: WorkflowGraphNodeType,
  kind: string,
): string {
  if (nodeType === "skill") {
    return "Skill";
  }
  return kind === "input" ? "Trigger" : "Action";
}

// 描述：
//
//   - 根据节点角色返回稳定图标名，避免节点头部图标与角色语义不一致。
//
// Params:
//
//   - roleLabel: 节点角色标签。
//
// Returns:
//
//   - AriIcon 可用图标名称。
function resolveNodeRoleIcon(roleLabel: string): string {
  if (roleLabel === "Skill") {
    return "new_releases";
  }
  return roleLabel === "Trigger" ? "edit" : "folder";
}

// 描述：
//
//   - 根据连线是否选中，返回统一的连线语义色，确保线段与箭头颜色一致。
//
// Params:
//
//   - isActive: 当前连线是否处于选中态。
//
// Returns:
//
//   - CSS 变量表达的颜色值。
function resolveWorkflowEdgeColor(isActive: boolean): string {
  return isActive
    ? "var(--z-color-border-active)"
    : "var(--z-color-border-brand)";
}

// 描述：
//
//   - 生成 React Flow 连线箭头配置，统一箭头颜色与连线语义色。
//
// Params:
//
//   - isActive: 连线是否选中。
//
// Returns:
//
//   - React Flow 可识别的 markerEnd 配置。
function buildWorkflowEdgeMarkerEnd(isActive = false) {
  return {
    type: MarkerType.ArrowClosed,
    color: resolveWorkflowEdgeColor(isActive),
  };
}

// 描述：
//
//   - 渲染工作流节点，支持选中后显示缩放控制点，并保留连线锚点。
//
// Params:
//
//   - data: 节点业务数据。
//   - selected: 当前节点是否被选中。
function WorkflowCanvasFlowNode({
  data,
  selected,
}: NodeProps<WorkflowCanvasNode>) {
  const parsed = parseCanvasNodeData(data);
  const nodeKind = parseNodeKind(parsed.description);
  const roleLabel = resolveNodeRoleLabel(parsed.type, nodeKind);
  const roleIcon = resolveNodeRoleIcon(roleLabel);
  const skillDescriptor = parsed.skillId
    ? `${parsed.skillId}${parsed.skillVersion ? `@${parsed.skillVersion}` : ""}`
    : "";
  const contentValue = parsed.type === "skill"
    ? (skillDescriptor || parsed.description)
    : parsed.description;
  const inset = resolveThemeInset();

  return (
    <>
      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={inset * 9}
        minHeight={inset * 4.25}
        color="var(--z-color-border-active)"
        lineClassName="desk-workflow-node-resize-line"
        handleClassName="desk-workflow-node-resize-handle"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="desk-workflow-node-handle"
      />
      <AriContainer
        className="desk-workflow-node-body"
        padding={0}
        ghost={true}
        showBorderRadius={false}
      >
        <AriFlex
          className="desk-workflow-node-head"
          align="center"
          justify="space-between"
          space={8}
          ghost={false}
          showBorderRadius={false}
        >
          <AriFlex
            className="desk-workflow-node-head-main"
            align="center"
            space={8}
          >
            <AriIcon
              className="desk-workflow-node-head-icon"
              name={roleIcon}
              size="sm"
              color="var(--z-color-text-brand)"
            />
            <AriTypography
              className="desk-workflow-node-title"
              variant="body"
              value={parsed.title}
            />
          </AriFlex>
          <AriTag bordered size="sm" color="var(--z-color-text-brand)">
            {roleLabel}
          </AriTag>
        </AriFlex>
        <AriContainer
          className="desk-workflow-node-content"
          padding={0}
          bgVariant="ghost"
          showBorderRadius={false}
          showBorder={false}
        >
          {contentValue ? (
            <AriTypography
              className="desk-workflow-node-description"
              variant="caption"
              value={contentValue}
            />
          ) : null}
        </AriContainer>
      </AriContainer>
      <Handle
        type="source"
        position={Position.Right}
        className="desk-workflow-node-handle"
      />
    </>
  );
}

// 描述：
//
//   - 将存储层图结构转换为 React Flow 节点。
//
// Params:
//
//   - graph: 工作流图结构。
//
// Returns:
//
//   - 适用于 React Flow 的节点集合。
function toFlowNodes(graph: WorkflowGraph): WorkflowCanvasNode[] {
  return (graph.nodes || []).map((node) => ({
    id: node.id,
    type: WORKFLOW_NODE_TYPE,
    position: { x: Number(node.x) || 0, y: Number(node.y) || 0 },
    data: {
      label: node.title,
      title: node.title,
      description: node.description,
      instruction: String(node.instruction || "").trim(),
      nodeType: node.type,
      skillId: String(node.skillId || "").trim(),
      skillVersion: String(node.skillVersion || "").trim(),
    },
    className: "desk-workflow-flow-node",
  }));
}

// 描述：
//
//   - 将存储层图结构转换为 React Flow 连线。
//
// Params:
//
//   - graph: 工作流图结构。
//
// Returns:
//
//   - 适用于 React Flow 的连线集合。
function toFlowEdges(graph: WorkflowGraph): Edge[] {
  return (graph.edges || []).map((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    markerEnd: buildWorkflowEdgeMarkerEnd(false),
    className: "desk-workflow-flow-edge",
  }));
}

// 描述：
//
//   - 将 React Flow 当前画布状态回写为工作流图结构。
//
// Params:
//
//   - nodes: React Flow 节点列表。
//   - edges: React Flow 连线列表。
//
// Returns:
//
//   - 可直接持久化的工作流图结构。
function toWorkflowGraph(
  nodes: WorkflowCanvasNode[],
  edges: Edge[],
): WorkflowGraph {
  return {
    nodes: nodes.map((node) => {
      const parsed = parseCanvasNodeData(node.data);
      return {
        id: node.id,
        title: parsed.title,
        description: parsed.description,
        instruction: parsed.instruction,
        type: parsed.type,
        skillId: parsed.skillId,
        skillVersion: parsed.skillVersion,
        x: Number(node.position?.x) || 0,
        y: Number(node.position?.y) || 0,
      };
    }),
    edges: edges
      .filter((edge) => Boolean(edge.source) && Boolean(edge.target))
      .map((edge) => ({
        id: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        type: "default",
      })),
  };
}

// 描述：
//
//   - 生成用于新增节点的默认位置，避免节点重叠。
//
// Params:
//
//   - count: 当前节点数量。
//
// Returns:
//
//   - 新节点位置坐标。
function resolveNewNodePosition(count: number): { x: number; y: number } {
  const inset = resolveThemeInset();
  return {
    x: inset * 7.5 + (count % 5) * inset * 7.5,
    y: inset * 5.25 + Math.floor(count / 5) * inset * 5.25,
  };
}

// 描述：
//
//   - 将技能目录映射为 AriSelect 选项，确保节点编辑器中展示“名称（编码）”格式，便于识别。
//
// Params:
//
//   - installedSkills: 已安装技能列表。
//   - selectedSkillId: 当前节点已绑定技能编码。
//
// Returns:
//
//   - 技能下拉选项数组。
function buildSkillSelectOptions(installedSkills: SkillCatalogItem[], selectedSkillId: string) {
  const options = installedSkills.map((item) => ({
    value: item.id,
    label: `${item.name}（${item.id}）`,
  }));
  const normalizedSkillId = String(selectedSkillId || "").trim();
  if (!normalizedSkillId) {
    return options;
  }
  const exists = installedSkills.some((item) => item.id === normalizedSkillId);
  if (exists) {
    return options;
  }
  return [
    {
      value: normalizedSkillId,
      label: normalizedSkillId,
    },
    ...options,
  ];
}

// 描述：
//
//   - 将技能版本列表映射为 AriSelect 选项；当当前值不在候选中时补充为临时选项，避免编辑态值丢失。
//
// Params:
//
//   - versions: 技能可选版本。
//   - selectedVersion: 当前节点已绑定版本。
//
// Returns:
//
//   - 版本下拉选项数组。
function buildSkillVersionOptions(versions: string[], selectedVersion: string) {
  const normalizedVersions = versions
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const uniqueVersions = Array.from(new Set(normalizedVersions));
  const options = uniqueVersions.map((item) => ({
    value: item,
    label: item,
  }));
  const normalizedSelectedVersion = String(selectedVersion || "").trim();
  if (!normalizedSelectedVersion) {
    return options;
  }
  const exists = uniqueVersions.includes(normalizedSelectedVersion);
  if (exists) {
    return options;
  }
  return [
    {
      value: normalizedSelectedVersion,
      label: normalizedSelectedVersion,
    },
    ...options,
  ];
}

// 描述：
//
//   - 渲染工作流编辑器页面，按工作流类型加载并保存对应工作流数据。
//
// Params:
//
//   - agentKey: 工作流类型标识（code/model）。
export function WorkflowCanvasPage({ agentKey }: WorkflowCanvasPageProps) {
  const [searchParams] = useSearchParams();
  const preferredWorkflowId = searchParams.get("workflowId") || "";
  const headerSlotElement = useDesktopHeaderSlot();

  const [workflowVersion, setWorkflowVersion] = useState(0);
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [workflowPromptPrefix, setWorkflowPromptPrefix] = useState("");
  const [workflowEditModalVisible, setWorkflowEditModalVisible] =
    useState(false);
  const [workflowEditName, setWorkflowEditName] = useState("");
  const [workflowEditDescription, setWorkflowEditDescription] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [canvasMode, setCanvasMode] = useState<WorkflowCanvasMode>("select");
  const [contextTarget, setContextTarget] =
    useState<WorkflowContextTarget | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [installedSkills, setInstalledSkills] = useState<SkillCatalogItem[]>([]);
  const reconnectRadius = useMemo(() => resolveThemeInset() * 0.375, []);
  // 描述：
  //
  //   - 绑定画布 DOM 引用，供 AriContextMenu 通过 targetRef 监听原生右键事件。
  const canvasRef = useRef<HTMLDivElement>(null);
  // 描述：
  //
  //   - 记录已加载到画布的工作流身份（agentKey + workflowId），用于区分“自动保存回流”和“真实切换工作流”。
  const workflowLoadIdentityRef = useRef("");

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowCanvasNode>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const modelWorkflows = useMemo(
    () => listModelWorkflows(),
    [workflowVersion, preferredWorkflowId],
  );
  const codeWorkflows = useMemo(
    () => listCodeWorkflows(),
    [workflowVersion, preferredWorkflowId],
  );
  const workflows = agentKey === "model" ? modelWorkflows : codeWorkflows;

  const selectedWorkflow = useMemo(
    () =>
      workflows.find((item) => item.id === preferredWorkflowId) ||
      workflows[0] ||
      null,
    [preferredWorkflowId, workflows],
  );

  // 描述：
  //
  //   - 注册工作流自定义节点，提供可缩放能力与统一节点内容渲染。
  const workflowNodeTypes = useMemo(
    () => ({
      [WORKFLOW_NODE_TYPE]: WorkflowCanvasFlowNode,
    }),
    [],
  );

  const selectedNode = useMemo(
    () => nodes.find((item) => item.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );
  const workflowGraph = useMemo(
    () => toWorkflowGraph(nodes, edges),
    [nodes, edges],
  );

  // 描述：
  //
  //   - 将“当前选中节点”同步映射到 React Flow 节点 selected 状态，保证点击后有明显高亮反馈。
  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        className: `${node.className || "desk-workflow-flow-node"}${node.id === selectedNodeId ? " is-active" : ""}`,
      })),
    [nodes, selectedNodeId],
  );

  // 描述：
  //
  //   - 将“当前选中连线”同步映射到 React Flow 连线 selected 状态，保证点击后有明显高亮反馈。
  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        className: `${edge.className || "desk-workflow-flow-edge"}${edge.id === selectedEdgeId ? " is-active" : ""}`,
        markerEnd: buildWorkflowEdgeMarkerEnd(edge.id === selectedEdgeId),
      })),
    [edges, selectedEdgeId],
  );

  // 描述：
  //
  //   - 加载已安装技能目录，供 Skill 节点属性面板下拉选择使用；读取失败时提示用户稍后重试。
  useEffect(() => {
    const loadInstalledSkills = async () => {
      try {
        const skills = await listInstalledSkills();
        setInstalledSkills(skills);
      } catch (_err) {
        setInstalledSkills([]);
        AriMessage.warning({
          content: "加载技能目录失败，稍后重试。",
          duration: 2200,
          showClose: true,
        });
      }
    };
    void loadInstalledSkills();
  }, []);

  const refreshWorkflows = () => setWorkflowVersion((value) => value + 1);

  useEffect(() => {
    if (!selectedWorkflow) {
      workflowLoadIdentityRef.current = "";
      setWorkflowName("");
      setWorkflowDescription("");
      setWorkflowPromptPrefix("");
      setNodes([]);
      setEdges([]);
      setSelectedNodeId("");
      setSelectedEdgeId("");
      return;
    }
    const nextWorkflowIdentity = `${agentKey}:${selectedWorkflow.id}`;
    if (workflowLoadIdentityRef.current === nextWorkflowIdentity) {
      return;
    }
    workflowLoadIdentityRef.current = nextWorkflowIdentity;

    setWorkflowName(selectedWorkflow.name || "");
    setWorkflowDescription(selectedWorkflow.description || "");
    setWorkflowPromptPrefix(
      "promptPrefix" in selectedWorkflow
        ? String(selectedWorkflow.promptPrefix || "")
        : "",
    );

    const graph = selectedWorkflow.graph || { nodes: [], edges: [] };
    setNodes(toFlowNodes(graph));
    setEdges(toFlowEdges(graph));
    setSelectedNodeId("");
    setSelectedEdgeId("");
  }, [agentKey, selectedWorkflow, setEdges, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      setEdges((currentEdges) => {
        const exists = currentEdges.some(
          (edge) =>
            edge.source === connection.source &&
            edge.target === connection.target,
        );
        if (exists) {
          return currentEdges;
        }

        return addEdge(
          {
            ...connection,
            id: `edge-${Date.now()}`,
            markerEnd: buildWorkflowEdgeMarkerEnd(false),
            className: "desk-workflow-flow-edge",
          },
          currentEdges,
        );
      });
    },
    [setEdges],
  );

  // 描述：
  //
  //   - 处理连线端点拖拽重连，将用户新的 source/target 回写到边状态。
  //
  // Params:
  //
  //   - oldEdge: 重连前的原始连线。
  //   - connection: 用户拖拽后的目标连接信息。
  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }
      setEdges((currentEdges) =>
        reconnectEdge(oldEdge, connection, currentEdges).map((edge) =>
          edge.id === oldEdge.id
            ? {
              ...edge,
              markerEnd: buildWorkflowEdgeMarkerEnd(false),
              className: "desk-workflow-flow-edge",
            }
            : edge,
        ),
      );
      setSelectedEdgeId(oldEdge.id);
      setSelectedNodeId("");
    },
    [setEdges],
  );

  const addNode = () => {
    const nextIndex = nodes.length + 1;
    const position = resolveNewNodePosition(nodes.length);
    const nodeId = `node-${Date.now()}`;

    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id: nodeId,
        type: WORKFLOW_NODE_TYPE,
        position,
        className: "desk-workflow-flow-node",
        data: {
          label: `节点 ${nextIndex}`,
          title: `节点 ${nextIndex}`,
          description: "",
          instruction: "",
          nodeType: "action",
          skillId: "",
          skillVersion: "",
        },
      },
    ]);
    setSelectedNodeId(nodeId);
    setSelectedEdgeId("");
  };

  // 描述：
  //
  //   - 新增技能节点，默认保留空技能位，便于后续从已安装目录中选择 skill@version。
  const addSkillNode = () => {
    const nextIndex = nodes.length + 1;
    const position = resolveNewNodePosition(nodes.length);
    const nodeId = `skill-node-${Date.now()}`;

    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id: nodeId,
        type: WORKFLOW_NODE_TYPE,
        position,
        className: "desk-workflow-flow-node",
        data: {
          label: `技能节点 ${nextIndex}`,
          title: `技能节点 ${nextIndex}`,
          description: "绑定并执行指定技能。",
          instruction: "",
          nodeType: "skill",
          skillId: "",
          skillVersion: "",
        },
      },
    ]);
    setSelectedNodeId(nodeId);
    setSelectedEdgeId("");
  };

  const patchSelectedNode = (
    patch: Partial<
      Pick<CanvasNodeData, "title" | "description" | "instruction" | "nodeType" | "skillId" | "skillVersion">
    >,
  ) => {
    if (!selectedNodeId) {
      return;
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== selectedNodeId) {
          return node;
        }

        const parsed = parseCanvasNodeData(node.data);
        const title = patch.title ?? parsed.title;
        const description = patch.description ?? parsed.description;
        const instruction = patch.instruction ?? parsed.instruction;
        const nodeType = patch.nodeType ?? parsed.type;
        const skillId = patch.skillId ?? (parsed.skillId || "");
        const skillVersion = patch.skillVersion ?? (parsed.skillVersion || "");

        return {
          ...node,
          data: {
            label: title,
            title,
            description,
            instruction,
            nodeType,
            skillId: nodeType === "skill" ? skillId : "",
            skillVersion: nodeType === "skill" ? skillVersion : "",
          },
        };
      }),
    );
  };

  // 描述：
  //
  //   - 根据节点 ID 删除节点，并同步清理关联连线与选中状态。
  //
  // Params:
  //
  //   - nodeId: 待删除节点 ID。
  const deleteNodeById = (nodeId: string) => {
    if (!nodeId) {
      return;
    }
    setNodes((currentNodes) =>
      currentNodes.filter((node) => node.id !== nodeId),
    );
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      ),
    );
    setSelectedNodeId("");
    setSelectedEdgeId("");
  };

  const deleteSelectedNode = () => {
    deleteNodeById(selectedNodeId);
  };

  // 描述：
  //
  //   - 根据连线 ID 删除连线，并同步清理选中状态。
  //
  // Params:
  //
  //   - edgeId: 待删除连线 ID。
  const deleteEdgeById = (edgeId: string) => {
    if (!edgeId) {
      return;
    }
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.id !== edgeId),
    );
    setSelectedEdgeId("");
  };

  // 描述：
  //
  //   - 打开工作流编辑弹窗，并以当前画布中的名称/说明作为初始值。
  const openWorkflowEditModal = () => {
    if (!selectedWorkflow) {
      return;
    }
    setWorkflowEditName(workflowName);
    setWorkflowEditDescription(workflowDescription);
    setWorkflowEditModalVisible(true);
  };

  // 描述：
  //
  //   - 关闭工作流编辑弹窗并清理临时输入状态。
  const closeWorkflowEditModal = () => {
    setWorkflowEditModalVisible(false);
    setWorkflowEditName("");
    setWorkflowEditDescription("");
  };

  // 描述：
  //
  //   - 应用弹窗中的工作流名称与说明到当前编辑态，持久化由自动保存机制处理。
  const confirmWorkflowEdit = () => {
    const trimmedName = workflowEditName.trim();
    if (!trimmedName) {
      AriMessage.warning({
        content: "工作流名称不能为空。",
        duration: 2200,
        showClose: true,
      });
      return;
    }
    setWorkflowName(trimmedName);
    setWorkflowDescription(workflowEditDescription.trim());
    closeWorkflowEditModal();
  };

  // 描述：
  //
  //   - 删除当前工作流；默认模板不可删除，删除后刷新列表并清理当前节点/连线选中态。
  const deleteCurrentWorkflow = () => {
    if (!selectedWorkflow?.id) {
      return;
    }
    const deleted =
      agentKey === "model"
        ? deleteModelWorkflow(selectedWorkflow.id)
        : deleteCodeWorkflow(selectedWorkflow.id);
    if (!deleted) {
      AriMessage.warning({
        content: "当前工作流不支持删除。",
        duration: 2200,
        showClose: true,
      });
      return;
    }
    setSelectedNodeId("");
    setSelectedEdgeId("");
    refreshWorkflows();
    AriMessage.success({
      content: "工作流已删除。",
      duration: 2200,
      showClose: true,
    });
  };

  const selectedNodeData = selectedNode
    ? parseCanvasNodeData(selectedNode.data)
    : null;
  const selectedNodeType = selectedNodeData?.type === "skill" ? "skill" : "action";
  const selectedSkillItem = useMemo(
    () => installedSkills.find((item) => item.id === (selectedNodeData?.skillId || "")) || null,
    [installedSkills, selectedNodeData?.skillId],
  );
  const skillSelectOptions = useMemo(
    () => buildSkillSelectOptions(installedSkills, selectedNodeData?.skillId || ""),
    [installedSkills, selectedNodeData?.skillId],
  );
  const selectedSkillVersion = String(selectedNodeData?.skillVersion || "").trim();
  const skillVersionSelectOptions = useMemo(
    () => buildSkillVersionOptions(selectedSkillItem?.versions || [], selectedSkillVersion),
    [selectedSkillItem?.versions, selectedSkillVersion],
  );
  const workflowInfoName =
    workflowName.trim() || selectedWorkflow?.name || "未命名工作流";
  const workflowInfoDescription =
    workflowDescription.trim() || selectedWorkflow?.description || "未填写说明";
  const workflowInfoVersion = selectedWorkflow?.version || 0;
  const hasPendingWorkflowChanges = useMemo(() => {
    if (!selectedWorkflow) {
      return false;
    }

    const nextName = workflowName.trim();
    if (!nextName) {
      return false;
    }

    const currentName = String(selectedWorkflow.name || "").trim();
    if (nextName !== currentName) {
      return true;
    }

    const nextDescription = workflowDescription.trim();
    const currentDescription = String(
      selectedWorkflow.description || "",
    ).trim();
    if (nextDescription !== currentDescription) {
      return true;
    }

    if (agentKey === "code") {
      const nextPromptPrefix = workflowPromptPrefix.trim();
      const currentPromptPrefix =
        "promptPrefix" in selectedWorkflow
          ? String(selectedWorkflow.promptPrefix || "").trim()
          : "";
      if (nextPromptPrefix !== currentPromptPrefix) {
        return true;
      }
    }

    const currentGraph = selectedWorkflow.graph || { nodes: [], edges: [] };
    return JSON.stringify(workflowGraph) !== JSON.stringify(currentGraph);
  }, [
    agentKey,
    selectedWorkflow,
    workflowDescription,
    workflowGraph,
    workflowName,
    workflowPromptPrefix,
  ]);

  // 描述：
  //
  //   - 监听画布与工作流元数据变更，按防抖策略自动保存当前工作流。
  useEffect(() => {
    if (!selectedWorkflow || !hasPendingWorkflowChanges) {
      return;
    }

    const timer = window.setTimeout(() => {
      const trimmedName = workflowName.trim();
      if (!trimmedName) {
        return;
      }

      if (agentKey === "model") {
        saveModelWorkflow({
          ...(selectedWorkflow as WorkflowDefinition),
          name: trimmedName,
          description: workflowDescription.trim(),
          graph: workflowGraph,
          version: selectedWorkflow.version + 1,
        });
      } else {
        saveCodeWorkflow({
          ...(selectedWorkflow as CodeWorkflowDefinition),
          name: trimmedName,
          description: workflowDescription.trim(),
          promptPrefix: workflowPromptPrefix.trim(),
          graph: workflowGraph,
          version: selectedWorkflow.version + 1,
        });
      }

      setWorkflowVersion((value) => value + 1);
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    agentKey,
    hasPendingWorkflowChanges,
    selectedWorkflow,
    workflowDescription,
    workflowGraph,
    workflowName,
    workflowPromptPrefix,
  ]);

  // 描述：
  //
  //   - 仅在右键目标发生变化时更新状态，避免重复 setState 导致渲染链路抖动。
  const patchContextTarget = useCallback(
    (nextTarget: WorkflowContextTarget | null) => {
      setContextTarget((currentTarget) => {
        if (!currentTarget && !nextTarget) {
          return currentTarget;
        }
        if (
          currentTarget?.type === nextTarget?.type &&
          currentTarget?.id === nextTarget?.id
        ) {
          return currentTarget;
        }
        return nextTarget;
      });
    },
    [],
  );
  const workflowContextMenuItems = useMemo(
    () =>
      contextTarget?.id
        ? [
            {
              key: "delete",
              label: "删除",
              icon: "delete",
            },
          ]
        : [],
    [contextTarget?.id],
  );

  const workflowHeaderNode = (
    <AriContainer
      className="desk-workflow-head-wrap"
      padding={0}
      data-tauri-drag-region
    >
      <AriFlex
        className="desk-workflow-head-bar"
        align="center"
        justify="space-between"
        data-tauri-drag-region
      >
        <AriFlex className="desk-workflow-head-main" align="center" space={8}>
          <AriTypography
            className="desk-workflow-head-title"
            variant="h4"
            value={workflowInfoName}
          />
          <AriTypography
            className="desk-workflow-head-subtitle"
            variant="caption"
            value={`工作流 · ${workflowInfoDescription} · v${workflowInfoVersion}`}
          />
        </AriFlex>
        <AriFlex
          className="desk-workflow-head-actions"
          align="center"
          space={8}
        >
          <AriButton
            type="text"
            icon="edit"
            aria-label="编辑工作流"
            onClick={openWorkflowEditModal}
          />
          <AriButton
            type="text"
            color="danger"
            ghost
            icon="delete"
            aria-label="删除工作流"
            onClick={deleteCurrentWorkflow}
          />
        </AriFlex>
      </AriFlex>
    </AriContainer>
  );

  return (
    <AriContainer
      className="desk-content"
      height="100%"
      showBorderRadius={false}
    >
      {headerSlotElement
        ? createPortal(workflowHeaderNode, headerSlotElement)
        : null}
      <AriModal
        visible={workflowEditModalVisible}
        title="编辑工作流"
        onClose={closeWorkflowEditModal}
        footer={
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton label="取消" onClick={closeWorkflowEditModal} />
            <AriButton
              color="brand"
              label="确定"
              onClick={confirmWorkflowEdit}
            />
          </AriFlex>
        }
      >
        <AriForm layout="vertical" labelAlign="left" density="compact">
          <AriFormItem label="工作流名称" name="workflow.edit.name">
            <AriInput
              value={workflowEditName}
              onChange={setWorkflowEditName}
              placeholder="请输入工作流名称"
            />
          </AriFormItem>
          <AriFormItem label="工作流说明" name="workflow.edit.description">
            <AriInput
              value={workflowEditDescription}
              onChange={setWorkflowEditDescription}
              placeholder="请输入工作流说明"
            />
          </AriFormItem>
        </AriForm>
      </AriModal>
      <AriContainer
        className="desk-workflow-editor-main"
        height="100%"
        padding={0}
        bgColor="bg-tertiary"
      >
        <AriContainer
          className="desk-workflow-editor-stage"
          positionType="relative"
          height="100%"
        >
          <AriContextMenu
            targetRef={canvasRef}
            open={contextMenuOpen}
            onOpenChange={(nextOpen: boolean) => {
              if (!nextOpen) {
                setContextMenuOpen(false);
              }
            }}
            items={workflowContextMenuItems}
            onSelect={(key: string) => {
              if (key !== "delete" || !contextTarget?.id) {
                return;
              }
              if (contextTarget.type === "node") {
                deleteNodeById(contextTarget.id);
                setContextMenuOpen(false);
                return;
              }
              deleteEdgeById(contextTarget.id);
              setContextMenuOpen(false);
            }}
          />
          <div
            ref={canvasRef}
            className="desk-workflow-reactflow-wrap desk-workflow-editor-reactflow-wrap"
          >
            <ReactFlow
              nodes={renderedNodes}
              edges={renderedEdges}
              nodeTypes={workflowNodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              reconnectRadius={reconnectRadius}
              elementsSelectable={canvasMode === "select"}
              nodesDraggable={canvasMode === "select"}
              nodesConnectable={canvasMode === "select"}
              edgesReconnectable={canvasMode === "select"}
              selectNodesOnDrag={canvasMode === "select"}
              selectionOnDrag={canvasMode === "select"}
              panOnDrag={canvasMode === "pan" ? [0] : false}
              onNodeClick={(_event, node) => {
                if (canvasMode !== "select") {
                  return;
                }
                setSelectedNodeId(node.id);
                setSelectedEdgeId("");
                setContextMenuOpen(false);
              }}
              onEdgeClick={(_event, edge) => {
                if (canvasMode !== "select") {
                  return;
                }
                setSelectedEdgeId(edge.id);
                setSelectedNodeId("");
                setContextMenuOpen(false);
              }}
              onNodeContextMenu={(event, node) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedNodeId(node.id);
                setSelectedEdgeId("");
                patchContextTarget({
                  type: "node",
                  id: node.id,
                });
                setContextMenuOpen(true);
              }}
              onEdgeContextMenu={(event, edge) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedEdgeId(edge.id);
                setSelectedNodeId("");
                patchContextTarget({
                  type: "edge",
                  id: edge.id,
                });
                setContextMenuOpen(true);
              }}
              onPaneContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                patchContextTarget(null);
                setContextMenuOpen(false);
              }}
              onPaneClick={() => {
                setSelectedNodeId("");
                setSelectedEdgeId("");
                patchContextTarget(null);
                setContextMenuOpen(false);
              }}
              className="desk-workflow-reactflow"
              defaultEdgeOptions={{
                markerEnd: buildWorkflowEdgeMarkerEnd(false),
                className: "desk-workflow-flow-edge",
              }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                className="desk-workflow-reactflow-bg"
              />
            </ReactFlow>
          </div>

          <AriContainer
            className="desk-workflow-editor-canvas-toolbar-float"
            positionType="absolute"
            hoverTransform={false}
            showBorder
            bgVariant="solid"
          >
            <AriFlex
              className="desk-workflow-editor-canvas-toolbar"
              align="center"
              justify="center"
              space={8}
            >
              <AriButton
                icon="select_tool"
                color={canvasMode === "select" ? "brand" : "default"}
                ghost={canvasMode !== "select"}
                shape="round"
                onClick={() => {
                  setCanvasMode("select");
                }}
              />
              <AriButton
                icon="hand_tool"
                color={canvasMode === "pan" ? "brand" : "default"}
                ghost={canvasMode !== "pan"}
                shape="round"
                onClick={() => {
                  setCanvasMode("pan");
                }}
              />
              <AriDivider
                type="vertical"
                className="desk-workflow-editor-canvas-toolbar-divider"
              />
              <AriButton ghost icon="add" onClick={addNode} />
              <AriButton ghost icon="new_releases" onClick={addSkillNode} />
            </AriFlex>
          </AriContainer>

          {/* 描述：
           *
           *   - 右侧属性面板仅在选中节点时显示；空白画布状态下隐藏面板，避免重复展示工作流信息。
           */}
          {selectedNodeData ? (
            <AriCard
              className="desk-workflow-editor-floating-panel"
              positionType="absolute"
            >
              <AriFlex
                className="desk-workflow-inspector-header"
                align="center"
                justify="space-between"
              >
                <AriContainer
                  className="desk-workflow-inspector-header-main"
                  padding={0}
                >
                  <AriTypography
                    className="desk-workflow-inspector-title"
                    variant="h4"
                    value={selectedNodeData.title}
                  />
                </AriContainer>
                <AriFlex
                  className="desk-workflow-inspector-tools"
                  align="center"
                  space={8}
                >
                  <AriButton
                    type="text"
                    color="danger"
                    icon="delete"
                    ghost
                    aria-label="删除该节点"
                    onClick={deleteSelectedNode}
                  />
                </AriFlex>
              </AriFlex>

              <AriForm
                className="desk-workflow-inspector-form"
                layout="vertical"
                labelAlign="left"
                density="compact"
                maxWidth="100%"
              >
                <AriFormItem label="节点名称" name="selectedNode.title">
                  <AriInput
                    value={selectedNodeData.title}
                    onChange={(value: string) => patchSelectedNode({ title: value })}
                    placeholder="请输入节点名称"
                  />
                </AriFormItem>
                <AriFormItem label="节点说明" name="selectedNode.description">
                  <AriInput
                    value={selectedNodeData.description}
                    onChange={(value: string) =>
                      patchSelectedNode({ description: value })
                    }
                    placeholder="请输入节点说明"
                  />
                </AriFormItem>
                <AriFormItem label="节点类型" name="selectedNode.type">
                  <AriFlex className="desk-workflow-node-type-switch" align="center" space={8}>
                    <AriButton
                      size="sm"
                      icon="folder"
                      label="动作"
                      color={selectedNodeType === "action" ? "brand" : "default"}
                      ghost={selectedNodeType !== "action"}
                      onClick={() => {
                        patchSelectedNode({
                          nodeType: "action",
                        });
                      }}
                    />
                    <AriButton
                      size="sm"
                      icon="new_releases"
                      label="技能"
                      color={selectedNodeType === "skill" ? "brand" : "default"}
                      ghost={selectedNodeType !== "skill"}
                      onClick={() => {
                        patchSelectedNode({
                          nodeType: "skill",
                        });
                      }}
                    />
                  </AriFlex>
                </AriFormItem>
                {selectedNodeType === "skill" ? (
                  <>
                    <AriFormItem label="技能编码" name="selectedNode.skillId">
                      <AriSelect
                        value={selectedNodeData.skillId || undefined}
                        options={skillSelectOptions}
                        searchable
                        allowClear
                        placeholder="请选择技能"
                        onChange={(value: unknown) => {
                          const selectedSkillId = typeof value === "string"
                            ? value
                            : String(value || "").trim();
                          if (!selectedSkillId) {
                            patchSelectedNode({ skillId: "", skillVersion: "" });
                            return;
                          }
                          const selectedSkill = installedSkills.find((item) => item.id === selectedSkillId);
                          const defaultVersion = selectedSkill?.versions?.[0] || "";
                          patchSelectedNode({
                            skillId: selectedSkillId,
                            skillVersion: defaultVersion,
                          });
                        }}
                      />
                    </AriFormItem>
                    <AriFormItem label="技能版本" name="selectedNode.skillVersion">
                      <AriSelect
                        value={selectedNodeData.skillVersion || undefined}
                        options={skillVersionSelectOptions}
                        searchable
                        allowClear
                        placeholder="请选择版本"
                        disabled={!selectedNodeData.skillId || skillVersionSelectOptions.length === 0}
                        onChange={(value: unknown) => {
                          const nextVersion = typeof value === "string"
                            ? value
                            : String(value || "").trim();
                          patchSelectedNode({ skillVersion: nextVersion });
                        }}
                      />
                    </AriFormItem>
                  </>
                ) : null}
                <AriFormItem label="指令" name="selectedNode.instruction">
                  <AriInput.TextArea
                    value={selectedNodeData.instruction || ""}
                    onChange={(value: string) =>
                      patchSelectedNode({ instruction: value })
                    }
                    placeholder="请输入该节点命中后的 AI 提示词"
                    rows={3}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                  />
                </AriFormItem>
              </AriForm>
            </AriCard>
          ) : null}
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
