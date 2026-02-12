import { useMemo, useState } from "react";
import { AriButton, AriCard, AriContainer, AriInput, AriSwitch, AriTypography } from "aries_react";
import {
  copyModelWorkflow,
  createModelWorkflowFromTemplate,
  listModelWorkflows,
  saveModelWorkflow,
  toggleShareModelWorkflow,
  updateWorkflowNodeParams,
} from "../workflow";
import type { WorkflowDefinition } from "../workflow";
import type {
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  ModelMcpCapabilities,
} from "../types";

interface ModelAgentSettingsPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  onModelMcpCapabilitiesChange: (value: ModelMcpCapabilities) => void;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: () => Promise<BlenderBridgeEnsureResult>;
}

export function ModelAgentSettingsPage({
  modelMcpCapabilities,
  onModelMcpCapabilitiesChange,
  blenderBridgeRuntime,
  ensureBlenderBridge,
}: ModelAgentSettingsPageProps) {
  const [workflowVersion, setWorkflowVersion] = useState(0);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingParamsText, setEditingParamsText] = useState("{}");
  const workflows = useMemo(() => listModelWorkflows(), [workflowVersion]);
  const selectedWorkflow: WorkflowDefinition | null =
    workflows.find((item) => item.id === selectedWorkflowId) || workflows[0] || null;

  const refreshWorkflows = () => setWorkflowVersion((value) => value + 1);

  const startEditNodeParams = (workflowId: string, nodeId: string) => {
    const workflow = workflows.find((item) => item.id === workflowId);
    const node = workflow?.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setSelectedWorkflowId(workflowId);
    setEditingNodeId(nodeId);
    setEditingParamsText(JSON.stringify(node.params || {}, null, 2));
  };

  const saveNodeParams = () => {
    if (!selectedWorkflow || !editingNodeId) return;
    try {
      const params = JSON.parse(editingParamsText || "{}");
      updateWorkflowNodeParams(selectedWorkflow.id, editingNodeId, params);
      setEditingNodeId(null);
      setEditingParamsText("{}");
      refreshWorkflows();
    } catch (_err) {
      window.alert("参数 JSON 格式无效，请修正后再保存。");
    }
  };

  return (
    <AriContainer className="desk-content">
      <div className="desk-settings-shell">
        <AriTypography variant="h1" value="模型智能体设置" />
        <AriTypography variant="caption" value="功能" />

        <div className="desk-settings-panel">
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="导出模型（Blender）" />
              <AriTypography
                variant="caption"
                value="控制 AI 是否可调用 MCP 导出能力。关闭后会话中无法执行导出。"
              />
            </div>
            <AriSwitch
              checked={modelMcpCapabilities.export}
              onChange={(checked) =>
                onModelMcpCapabilitiesChange({
                  ...modelMcpCapabilities,
                  export: checked,
                })
              }
            />
          </div>
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="场景与对象能力" />
              <AriTypography variant="caption" value="列出对象、选择对象、重命名、层级整理。" />
            </div>
            <AriSwitch
              checked={modelMcpCapabilities.scene}
              onChange={(checked) =>
                onModelMcpCapabilitiesChange({
                  ...modelMcpCapabilities,
                  scene: checked,
                })
              }
            />
          </div>
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="变换能力" />
              <AriTypography variant="caption" value="对齐原点、统一尺度、旋转方向标准化。" />
            </div>
            <AriSwitch
              checked={modelMcpCapabilities.transform}
              onChange={(checked) =>
                onModelMcpCapabilitiesChange({
                  ...modelMcpCapabilities,
                  transform: checked,
                })
              }
            />
          </div>
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="几何编辑能力" />
              <AriTypography variant="caption" value="加厚、倒角、镜像、阵列、布尔。" />
            </div>
            <AriSwitch
              checked={modelMcpCapabilities.geometry}
              onChange={(checked) =>
                onModelMcpCapabilitiesChange({
                  ...modelMcpCapabilities,
                  geometry: checked,
                })
              }
            />
          </div>
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="网格优化能力" />
              <AriTypography variant="caption" value="自动平滑、Weighted Normal、Decimate。" />
            </div>
            <AriSwitch
              checked={modelMcpCapabilities.mesh_opt}
              onChange={(checked) =>
                onModelMcpCapabilitiesChange({
                  ...modelMcpCapabilities,
                  mesh_opt: checked,
                })
              }
            />
          </div>
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="材质与贴图能力" />
              <AriTypography variant="caption" value="材质槽整理、贴图检查、打包贴图。" />
            </div>
            <AriSwitch
              checked={modelMcpCapabilities.material}
              onChange={(checked) =>
                onModelMcpCapabilitiesChange({
                  ...modelMcpCapabilities,
                  material: checked,
                })
              }
            />
          </div>
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="文件能力" />
              <AriTypography variant="caption" value="新建、打开、保存、撤销与重试。" />
            </div>
            <AriSwitch
              checked={modelMcpCapabilities.file}
              onChange={(checked) =>
                onModelMcpCapabilitiesChange({
                  ...modelMcpCapabilities,
                  file: checked,
                })
              }
            />
          </div>
        </div>

        <AriTypography variant="caption" value="Blender" />
        <div className="desk-settings-panel">
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="Bridge 连接状态" />
              <AriTypography
                variant="caption"
                value={
                  blenderBridgeRuntime.checking
                    ? "正在检测并自动修复 Bridge..."
                    : blenderBridgeRuntime.message
                }
              />
            </div>
            <AriButton
              label={blenderBridgeRuntime.checking ? "检测中..." : "检测"}
              onClick={() => void ensureBlenderBridge()}
              disabled={blenderBridgeRuntime.checking}
            />
          </div>
        </div>

        <AriTypography variant="caption" value="模型工作流（P1/P2）" />
        <div className="desk-settings-panel">
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="工作流模板" />
              <AriTypography variant="caption" value="支持可插拔、可跳步、可重排、可复用。可创建自定义版本。" />
            </div>
            <AriButton
              label="新建工作流"
              onClick={() => {
                const created = createModelWorkflowFromTemplate(selectedWorkflow?.id);
                setSelectedWorkflowId(created.id);
                refreshWorkflows();
              }}
            />
          </div>
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="caption" value="当前工作流" />
              <select
                className="desk-native-select"
                value={selectedWorkflow?.id || ""}
                onChange={(event) => setSelectedWorkflowId(event.target.value)}
              >
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name} (v{workflow.version}){workflow.shared ? " · 已分享" : ""}
                  </option>
                ))}
              </select>
            </div>
            {selectedWorkflow ? (
              <AriContainer>
                <AriButton
                  type="text"
                  label="复制"
                  onClick={() => {
                    const copied = copyModelWorkflow(selectedWorkflow.id);
                    setSelectedWorkflowId(copied.id);
                    refreshWorkflows();
                  }}
                />
                <AriButton
                  type="text"
                  label={selectedWorkflow.shared ? "取消分享" : "分享"}
                  onClick={() => {
                    toggleShareModelWorkflow(selectedWorkflow.id);
                    refreshWorkflows();
                  }}
                />
              </AriContainer>
            ) : null}
          </div>
          {selectedWorkflow?.nodes.map((node) => (
            <div key={node.id} className="desk-settings-row">
              <div className="desk-settings-meta">
                <AriTypography variant="h4" value={node.name} />
                <AriTypography
                  variant="caption"
                  value={`kind=${node.kind} | retry=${node.retryCount} | fallback=${node.fallbackKind || "-"}`}
                />
              </div>
              <AriContainer>
                <AriSwitch
                  checked={node.enabled}
                  onChange={(checked) => {
                    if (!selectedWorkflow) return;
                    const next: WorkflowDefinition = {
                      ...selectedWorkflow,
                      version: selectedWorkflow.version + 1,
                      nodes: selectedWorkflow.nodes.map((item) =>
                        item.id === node.id ? { ...item, enabled: checked } : item
                      ),
                    };
                    saveModelWorkflow(next);
                    refreshWorkflows();
                  }}
                />
                <AriButton
                  type="text"
                  label="参数"
                  onClick={() => startEditNodeParams(selectedWorkflow.id, node.id)}
                />
              </AriContainer>
            </div>
          ))}
        </div>

        {editingNodeId && selectedWorkflow ? (
          <AriCard className="desk-prompt-card">
            <AriTypography variant="h4" value={`编辑节点参数：${editingNodeId}`} />
            <AriInput value={editingParamsText} onChange={setEditingParamsText} placeholder="{ }" />
            <AriContainer style={{ marginTop: 12 }}>
              <AriButton label="取消" onClick={() => setEditingNodeId(null)} />
              <AriButton color="primary" label="保存参数" onClick={saveNodeParams} />
            </AriContainer>
          </AriCard>
        ) : null}
      </div>
    </AriContainer>
  );
}
