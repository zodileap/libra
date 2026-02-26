import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import type { Connection, Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriInput,
  AriMessage,
  AriTypography,
} from "aries_react";
import { useSearchParams } from "react-router-dom";
import {
  listCodeWorkflows,
  listModelWorkflows,
  saveCodeWorkflow,
  saveModelWorkflow,
} from "../shared/workflow";
import type {
  CodeWorkflowDefinition,
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowGraphNode,
} from "../shared/workflow";
import { DeskPageHeader } from "./settings-primitives";
import type { AgentKey } from "../shared/types";

interface CanvasNodeData {
  label: string;
  title: string;
  description: string;
}

interface WorkflowCanvasPageProps {
  agentKey: AgentKey;
}

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
function parseCanvasNodeData(data: unknown): Pick<WorkflowGraphNode, "title" | "description"> {
  const source = (data || {}) as Partial<CanvasNodeData>;
  return {
    title: String(source.title || source.label || "未命名节点").trim() || "未命名节点",
    description: String(source.description || "").trim(),
  };
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
function toFlowNodes(graph: WorkflowGraph): Node<CanvasNodeData>[] {
  return (graph.nodes || []).map((node) => ({
    id: node.id,
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
    markerEnd: { type: MarkerType.ArrowClosed },
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
function toWorkflowGraph(nodes: Node<CanvasNodeData>[], edges: Edge[]): WorkflowGraph {
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

  const [workflowVersion, setWorkflowVersion] = useState(0);
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [workflowPromptPrefix, setWorkflowPromptPrefix] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CanvasNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const modelWorkflows = useMemo(() => listModelWorkflows(), [workflowVersion, preferredWorkflowId]);
  const codeWorkflows = useMemo(() => listCodeWorkflows(), [workflowVersion, preferredWorkflowId]);
  const workflows = agentKey === "model" ? modelWorkflows : codeWorkflows;

  const selectedWorkflow = useMemo(
    () => workflows.find((item) => item.id === preferredWorkflowId) || workflows[0] || null,
    [preferredWorkflowId, workflows],
  );

  const selectedNode = useMemo(
    () => nodes.find((item) => item.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
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
          (edge) => edge.source === connection.source && edge.target === connection.target,
        );
        if (exists) {
          return currentEdges;
        }

        return addEdge(
          {
            ...connection,
            id: `edge-${Date.now()}`,
            markerEnd: { type: MarkerType.ArrowClosed },
            className: "desk-workflow-flow-edge",
          },
          currentEdges,
        );
      });
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

  const patchSelectedNode = (patch: Partial<Pick<CanvasNodeData, "title" | "description">>) => {
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

  const deleteSelectedNode = () => {
    if (!selectedNodeId) {
      return;
    }

    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId));
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      ),
    );
    setSelectedNodeId("");
  };

  const deleteSelectedEdge = () => {
    if (!selectedEdgeId) {
      return;
    }

    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdgeId));
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

  const selectedNodeData = selectedNode ? parseCanvasNodeData(selectedNode.data) : null;
  const selectedEdge = edges.find((item) => item.id === selectedEdgeId) || null;

  return (
    <AriContainer className="desk-content" height="100%">
      <AriContainer className="desk-workflow-editor-shell" height="100%">
        <DeskPageHeader
          title={agentKey === "model" ? "模型工作流编辑器" : "代码工作流编辑器"}
          description="在全局侧边栏切换工作流；右侧画布排版节点，点击空白编辑工作流属性，点击节点编辑节点属性。"
          actions={(
            <AriFlex align="center" space={8}>
              <AriButton color="primary" label="保存工作流" onClick={saveCurrentWorkflow} />
            </AriFlex>
          )}
        />

        <AriContainer className="desk-workflow-editor-main" height="100%">
          <AriContainer className="desk-workflow-editor-stage" positionType="relative" height="100%">
            <AriContainer
              className="desk-workflow-reactflow-wrap desk-workflow-editor-reactflow-wrap"
              positionType="relative"
              height="100%"
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                fitView
                proOptions={{ hideAttribution: true }}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_event, node) => {
                  setSelectedNodeId(node.id);
                  setSelectedEdgeId("");
                }}
                onEdgeClick={(_event, edge) => {
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeId("");
                }}
                onPaneClick={() => {
                  setSelectedNodeId("");
                  setSelectedEdgeId("");
                }}
                className="desk-workflow-reactflow"
                defaultEdgeOptions={{
                  markerEnd: { type: MarkerType.ArrowClosed },
                  className: "desk-workflow-flow-edge",
                }}
              >
                <Background
                  variant="dots"
                  className="desk-workflow-reactflow-bg"
                />
                <MiniMap className="desk-workflow-reactflow-minimap" pannable zoomable />
                <Controls className="desk-workflow-reactflow-controls" />
              </ReactFlow>

              <AriFlex
                className="desk-workflow-editor-canvas-toolbar desk-workflow-editor-canvas-toolbar-float"
                align="center"
                justify="center"
                space={8}
                positionType="absolute"
              >
                <AriButton label="新增节点" onClick={addNode} />
                <AriButton
                  color="danger"
                  label="删除选中节点"
                  disabled={!selectedNodeId}
                  onClick={deleteSelectedNode}
                />
                <AriButton
                  color="danger"
                  label="删除选中连线"
                  disabled={!selectedEdgeId}
                  onClick={deleteSelectedEdge}
                />
              </AriFlex>

              <AriCard
                className="desk-workflow-editor-floating-panel"
                positionType="absolute"
              >
                <AriFlex className="desk-workflow-inspector-header" align="center" justify="space-between">
                  <AriTypography
                    variant="h4"
                    value={selectedNodeData ? "节点属性" : "工作流属性"}
                  />
                  <AriTypography
                    variant="caption"
                    value={selectedNodeData ? "点击空白返回工作流属性" : "点击节点切换节点属性"}
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
                      onChange={(value) => patchSelectedNode({ description: value })}
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
                        value={selectedEdge ? `已选连线：${selectedEdge.source} -> ${selectedEdge.target}` : "当前：工作流属性"}
                      />
                    </AriContainer>
                  </AriContainer>
                )}
              </AriCard>
            </AriContainer>
          </AriContainer>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
