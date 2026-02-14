import { useMemo, useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriSelect, AriSwitch, AriTypography } from "aries_react";
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
import { DeskPageHeader, DeskSectionLabel, DeskSettingsRow } from "../widgets/settings-primitives";

interface ModelAgentSettingsPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  onModelMcpCapabilitiesChange: (value: ModelMcpCapabilities) => void;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: () => Promise<BlenderBridgeEnsureResult>;
}

interface CapabilitySettingItem {
  key: keyof ModelMcpCapabilities;
  title: string;
  description: string;
}

// 描述:
//
//   - 集中维护模型智能体能力开关的展示文案，避免页面结构重复和文案分散。
const CAPABILITY_SETTING_ITEMS: CapabilitySettingItem[] = [
  {
    key: "export",
    title: "导出模型（Blender）",
    description: "控制 AI 是否可调用 MCP 导出能力。关闭后会话中无法执行导出。",
  },
  {
    key: "scene",
    title: "场景与对象能力",
    description: "列出对象、选择对象、重命名、层级整理。",
  },
  {
    key: "transform",
    title: "变换能力",
    description: "对齐原点、统一尺度、旋转方向标准化。",
  },
  {
    key: "geometry",
    title: "几何编辑能力",
    description: "加厚、倒角、镜像、阵列、布尔。",
  },
  {
    key: "mesh_opt",
    title: "网格优化能力",
    description: "自动平滑、Weighted Normal、Decimate。",
  },
  {
    key: "material",
    title: "材质与贴图能力",
    description: "材质槽整理、贴图检查、打包贴图。",
  },
  {
    key: "file",
    title: "文件能力",
    description: "新建、打开、保存、撤销与重试。",
  },
];

// 描述:
//
//   - 生成工作流下拉项显示文案，统一版本号和分享状态表达。
//
// Params:
//
//   - workflow: 工作流定义。
//
// Returns:
//
//   - 可读工作流标题。
function getWorkflowOptionLabel(workflow: WorkflowDefinition): string {
  return `${workflow.name} (v${workflow.version})${workflow.shared ? " · 已分享" : ""}`;
}

// 描述:
//
//   - 渲染模型智能体设置页面，统一能力开关、Bridge 状态与工作流编辑入口。
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
  const workflowOptions = useMemo(
    () => workflows.map((workflow) => ({ label: getWorkflowOptionLabel(workflow), value: workflow.id })),
    [workflows]
  );
  const selectedWorkflow: WorkflowDefinition | null =
    workflows.find((item) => item.id === selectedWorkflowId) || workflows[0] || null;

  // 描述:
  //
  //   - 刷新工作流版本号，触发 useMemo 重新读取本地工作流列表。
  const refreshWorkflows = () => setWorkflowVersion((value) => value + 1);

  // 描述:
  //
  //   - 统一更新某个能力开关并回写到页面状态。
  //
  // Params:
  //
  //   - key: 能力键值。
  //   - checked: 开关状态。
  const patchCapability = (key: keyof ModelMcpCapabilities, checked: boolean) => {
    const next: ModelMcpCapabilities = {
      ...modelMcpCapabilities,
      [key]: checked,
    };
    onModelMcpCapabilitiesChange(next);
  };

  // 描述:
  //
  //   - 将 AriSelect 的返回值规范化为工作流 ID，避免数组值或 undefined 进入状态。
  //
  // Params:
  //
  //   - value: AriSelect onChange 返回值。
  const onWorkflowSelectChange = (value: string | number | (string | number)[] | undefined) => {
    if (typeof value === "string" || typeof value === "number") {
      setSelectedWorkflowId(String(value));
      return;
    }
    setSelectedWorkflowId("");
  };

  // 描述:
  //
  //   - 读取并进入节点参数编辑状态，使用格式化 JSON 便于手工修改。
  //
  // Params:
  //
  //   - workflowId: 工作流 ID。
  //   - nodeId: 节点 ID。
  const startEditNodeParams = (workflowId: string, nodeId: string) => {
    const workflow = workflows.find((item) => item.id === workflowId);
    const node = workflow?.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setSelectedWorkflowId(workflowId);
    setEditingNodeId(nodeId);
    setEditingParamsText(JSON.stringify(node.params || {}, null, 2));
  };

  // 描述:
  //
  //   - 持久化节点参数编辑结果，并在成功后退出编辑态。
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
        <DeskPageHeader
          title="模型智能体设置"
          description="统一管理模型能力、Blender Bridge 连接状态和可复用工作流。"
        />
        <DeskSectionLabel label="功能" />

        <div className="desk-settings-panel">
          {CAPABILITY_SETTING_ITEMS.map((capability) => (
            <DeskSettingsRow
              key={capability.key}
              title={capability.title}
              description={capability.description}
            >
              <AriSwitch
                checked={modelMcpCapabilities[capability.key]}
                onChange={(checked) => patchCapability(capability.key, checked)}
              />
            </DeskSettingsRow>
          ))}
        </div>

        <DeskSectionLabel label="Blender" />
        <div className="desk-settings-panel">
          <DeskSettingsRow
            title="Bridge 连接状态"
            description={
              blenderBridgeRuntime.checking
                ? "正在检测并自动修复 Bridge..."
                : blenderBridgeRuntime.message
            }
          >
            <AriButton
              label={blenderBridgeRuntime.checking ? "检测中..." : "检测"}
              onClick={() => void ensureBlenderBridge()}
              disabled={blenderBridgeRuntime.checking}
            />
          </DeskSettingsRow>
        </div>

        <DeskSectionLabel label="模型工作流（P1/P2）" />
        <div className="desk-settings-panel">
          <DeskSettingsRow
            title="工作流模板"
            description="支持可插拔、可跳步、可重排、可复用。可创建自定义版本。"
          >
            <AriButton
              label="新建工作流"
              onClick={() => {
                const created = createModelWorkflowFromTemplate(selectedWorkflow?.id);
                setSelectedWorkflowId(created.id);
                refreshWorkflows();
              }}
            />
          </DeskSettingsRow>
          <DeskSettingsRow
            description="当前工作流"
            metaSlot={(
              <AriSelect
                className="desk-settings-select"
                placeholder="请选择工作流"
                value={selectedWorkflow?.id}
                options={workflowOptions}
                onChange={onWorkflowSelectChange}
                disabled={workflowOptions.length === 0}
              />
            )}
          >
            {selectedWorkflow ? (
              <AriFlex align="center" space={8}>
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
              </AriFlex>
            ) : null}
          </DeskSettingsRow>
          {selectedWorkflow?.nodes.map((node) => (
            <DeskSettingsRow
              key={node.id}
              title={node.name}
              description={`kind=${node.kind} | retry=${node.retryCount} | fallback=${node.fallbackKind || "-"}`}
            >
              <AriFlex align="center" space={8}>
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
              </AriFlex>
            </DeskSettingsRow>
          ))}
        </div>

        {editingNodeId && selectedWorkflow ? (
          <AriCard className="desk-prompt-card">
            <AriTypography variant="h4" value={`编辑节点参数：${editingNodeId}`} />
            <AriInput value={editingParamsText} onChange={setEditingParamsText} placeholder="{ }" />
            <AriContainer className="desk-settings-node-editor-actions">
              <AriButton label="取消" onClick={() => setEditingNodeId(null)} />
              <AriButton color="primary" label="保存参数" onClick={saveNodeParams} />
            </AriContainer>
          </AriCard>
        ) : null}
      </div>
    </AriContainer>
  );
}
