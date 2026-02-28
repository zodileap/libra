import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addEdge,
  Background,
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
  AriIcon,
  AriInput,
  AriMessage,
  AriTag,
  AriTypography,
} from "aries_react";
import { useSearchParams } from "react-router-dom";
import {
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
} from "../../shared/workflow";
import type { AgentKey } from "../../shared/types";
import { useDesktopHeaderSlot } from "../app-header/header-slot-context";

// 描述:
//
//   - 定义画布节点展示数据结构，统一管理节点标题与说明字段。
interface CanvasNodeData {
  label: string;
  title: string;
  description: string;
}

// 描述:
//
//   - 定义工作流画布页面入参，用于区分 code/model 两类工作流。
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
  if (typeof window === "undefined") {
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
//   - 标题与说明字段。
function parseCanvasNodeData(
  data: unknown,
): Pick<WorkflowGraphNode, "title" | "description"> {
  const source = (data || {}) as Partial<CanvasNodeData>;
  return {
    title:
      String(source.title || source.label || "未命名节点").trim() ||
      "未命名节点",
    description: String(source.description || "").trim(),
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
function resolveNodeRoleLabel(kind: string): string {
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
  const roleLabel = resolveNodeRoleLabel(nodeKind);
  const roleIcon = resolveNodeRoleIcon(roleLabel);
  const contentValue = parsed.description;
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
        type: "node",
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
//   - 渲染工作流编辑器页面，按智能体类型加载并保存对应工作流数据。
//
// Params:
//
//   - agentKey: 智能体标识（code/model）。
export function WorkflowCanvasPage({ agentKey }: WorkflowCanvasPageProps) {
  const [searchParams] = useSearchParams();
  const preferredWorkflowId = searchParams.get("workflowId") || "";
  const headerSlotElement = useDesktopHeaderSlot();

  const [workflowVersion, setWorkflowVersion] = useState(0);
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [workflowPromptPrefix, setWorkflowPromptPrefix] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [canvasMode, setCanvasMode] = useState<WorkflowCanvasMode>("select");
  const [contextTarget, setContextTarget] =
    useState<WorkflowContextTarget | null>(null);
  const reconnectRadius = useMemo(() => resolveThemeInset() * 0.375, []);
  // 描述：
  //
  //   - 绑定画布 DOM 引用，供 AriContextMenu 通过 targetRef 监听原生右键事件。
  const canvasRef = useRef<HTMLDivElement>(null);

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

  const refreshWorkflows = () => setWorkflowVersion((value) => value + 1);

  useEffect(() => {
    if (!selectedWorkflow) {
      setWorkflowName("");
      setWorkflowDescription("");
      setWorkflowPromptPrefix("");
      setNodes([]);
      setEdges([]);
      setSelectedNodeId("");
      setSelectedEdgeId("");
      return;
    }

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
  }, [selectedWorkflow, setEdges, setNodes]);

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
        reconnectEdge(
          oldEdge,
          {
            ...connection,
            markerEnd: buildWorkflowEdgeMarkerEnd(false),
            className: "desk-workflow-flow-edge",
          },
          currentEdges,
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
        },
      },
    ]);
    setSelectedNodeId(nodeId);
    setSelectedEdgeId("");
  };

  const patchSelectedNode = (
    patch: Partial<Pick<CanvasNodeData, "title" | "description">>,
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

        return {
          ...node,
          data: {
            label: title,
            title,
            description,
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

  const saveCurrentWorkflow = () => {
    if (!selectedWorkflow) {
      return;
    }

    const trimmedName = workflowName.trim();
    if (!trimmedName) {
      AriMessage.error({
        content: "工作流名称不能为空。",
        duration: 2600,
        showClose: true,
      });
      return;
    }

    const graph = toWorkflowGraph(nodes, edges);

    if (agentKey === "model") {
      saveModelWorkflow({
        ...(selectedWorkflow as WorkflowDefinition),
        name: trimmedName,
        description: workflowDescription.trim(),
        graph,
        version: selectedWorkflow.version + 1,
      });
    } else {
      saveCodeWorkflow({
        ...(selectedWorkflow as CodeWorkflowDefinition),
        name: trimmedName,
        description: workflowDescription.trim(),
        promptPrefix: workflowPromptPrefix.trim(),
        graph,
        version: selectedWorkflow.version + 1,
      });
    }

    refreshWorkflows();
    AriMessage.success({
      content: "工作流画布已保存。",
      duration: 2200,
      showClose: true,
    });
  };

  const selectedNodeData = selectedNode
    ? parseCanvasNodeData(selectedNode.data)
    : null;
  const selectedEdge = edges.find((item) => item.id === selectedEdgeId) || null;
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
    () => [
      {
        key: "delete",
        label: "删除",
        icon: "delete",
        disabled: !contextTarget?.id,
      },
    ],
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
        <AriTypography
          className="desk-workflow-head-title"
          variant="h4"
          value={agentKey === "model" ? "模型工作流编辑器" : "代码工作流编辑器"}
        />
        <AriFlex
          className="desk-workflow-head-actions"
          align="center"
          space={8}
        >
          <AriButton
            type="text"
            icon="save"
            aria-label="保存工作流"
            onClick={saveCurrentWorkflow}
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
            items={workflowContextMenuItems}
            onSelect={(key: string) => {
              if (key !== "delete" || !contextTarget?.id) {
                return;
              }
              if (contextTarget.type === "node") {
                deleteNodeById(contextTarget.id);
                return;
              }
              deleteEdgeById(contextTarget.id);
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
              }}
              onEdgeClick={(_event, edge) => {
                if (canvasMode !== "select") {
                  return;
                }
                setSelectedEdgeId(edge.id);
                setSelectedNodeId("");
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
              }}
              onPaneContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                patchContextTarget(null);
              }}
              onPaneClick={() => {
                setSelectedNodeId("");
                setSelectedEdgeId("");
                patchContextTarget(null);
              }}
              className="desk-workflow-reactflow"
              defaultEdgeOptions={{
                markerEnd: buildWorkflowEdgeMarkerEnd(false),
                className: "desk-workflow-flow-edge",
              }}
            >
              <Background
                variant="dots"
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
                    icon="arrow_selector_tool"
                    color={canvasMode === "select" ? "brand" : "default"}
                    ghost={canvasMode !== "select"}
                    onClick={() => {
                      setCanvasMode("select");
                    }}
                  />
                  <AriButton
                    icon="pan_tool_alt"
                    color={canvasMode === "pan" ? "brand" : "default"}
                    ghost={canvasMode !== "pan"}
                    onClick={() => {
                      setCanvasMode("pan");
                    }}
                  />
                  <AriDivider type="vertical" className="desk-workflow-editor-canvas-toolbar-divider" />
              <AriButton ghost icon="add" onClick={addNode} />
            </AriFlex>
          </AriContainer>

          <AriCard
            className="desk-workflow-editor-floating-panel"
            positionType="absolute"
          >
            <AriFlex
              className="desk-workflow-inspector-header"
              align="center"
              justify="space-between"
            >
              <AriTypography
                variant="h4"
                value={selectedNodeData ? "节点属性" : "工作流属性"}
              />
              <AriTypography
                variant="caption"
                value={
                  selectedNodeData
                    ? "点击空白返回工作流属性"
                    : "点击节点切换节点属性"
                }
              />
            </AriFlex>

            {selectedNodeData ? (
              <AriContainer className="desk-workflow-inspector-grid">
                <AriInput
                  value={selectedNodeData.title}
                  onChange={(value) => patchSelectedNode({ title: value })}
                  placeholder="节点标题"
                />
                <AriInput
                  value={selectedNodeData.description}
                  onChange={(value) =>
                    patchSelectedNode({ description: value })
                  }
                  placeholder="节点说明"
                />
                <AriButton
                  color="danger"
                  label="删除该节点"
                  onClick={deleteSelectedNode}
                />
              </AriContainer>
            ) : (
              <AriContainer className="desk-workflow-inspector-grid">
                <AriInput
                  value={workflowName}
                  onChange={setWorkflowName}
                  placeholder="工作流名称"
                />
                <AriInput
                  value={workflowDescription}
                  onChange={setWorkflowDescription}
                  placeholder="工作流说明"
                />
                {agentKey === "code" ? (
                  <AriInput
                    value={workflowPromptPrefix}
                    onChange={setWorkflowPromptPrefix}
                    placeholder="代码工作流执行前缀"
                  />
                ) : null}
                <AriContainer className="desk-workflow-editor-floating-meta">
                  <AriTypography
                    variant="caption"
                    value={`版本：v${selectedWorkflow?.version || 0}`}
                  />
                  <AriTypography
                    variant="caption"
                    value={`节点：${nodes.length} · 连线：${edges.length}`}
                  />
                  <AriTypography
                    variant="caption"
                    value={
                      selectedEdge
                        ? `已选连线：${selectedEdge.source} -> ${selectedEdge.target}`
                        : "当前：工作流属性"
                    }
                  />
                </AriContainer>
              </AriContainer>
            )}
          </AriCard>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
