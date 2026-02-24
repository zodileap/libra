import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AriButton,
  AriContainer,
  AriFlex,
  AriSwitch,
} from "aries_react";
import type {
  BlenderBridgeEnsureOptions,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  ModelMcpCapabilities,
} from "../types";
import { DeskPageHeader, DeskSectionTitle, DeskSettingsRow, DeskStatusText } from "../widgets/settings-primitives";

interface ModelAgentSettingsPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  onModelMcpCapabilitiesChange: (value: ModelMcpCapabilities) => void;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: (
    options?: BlenderBridgeEnsureOptions,
  ) => Promise<BlenderBridgeEnsureResult>;
}

// 描述：
//
//   - 模型能力开关配置项，统一定义文案并映射到能力字段。
const CAPABILITY_ITEMS: Array<{
  key: keyof ModelMcpCapabilities;
  title: string;
  description: string;
}> = [
  { key: "export", title: "导出能力", description: "允许在执行链路中导出模型与产物。" },
  { key: "scene", title: "场景操作", description: "允许新建、打开、保存等场景级操作。" },
  { key: "transform", title: "变换操作", description: "允许平移、旋转、缩放等基础变换。" },
  { key: "geometry", title: "几何编辑", description: "允许基础建模与几何体编辑。" },
  { key: "mesh_opt", title: "网格优化", description: "允许简化、重建法线等网格优化操作。" },
  { key: "material", title: "材质贴图", description: "允许创建材质、贴图与通道调整。" },
  { key: "file", title: "文件管理", description: "允许导入/导出/另存以及文件级管理。" },
];
//
//   - 渲染模型智能体设置页，仅提供能力配置与 Bridge 状态管理。
//
// Params:
//
//   - props: 模型能力配置与 Bridge 运行态。
export function ModelAgentSettingsPage(props: ModelAgentSettingsPageProps) {
  const navigate = useNavigate();
  const [ensuringBridge, setEnsuringBridge] = useState(false);

  const capabilityItems = useMemo(() => CAPABILITY_ITEMS, []);

  // 描述：
  //
  //   - 更新单个能力开关状态，并写回全量能力配置。
  //
  // Params:
  //
  //   - key: 能力字段名。
  //   - checked: 能力开关状态。
  const patchCapability = (
    key: keyof ModelMcpCapabilities,
    checked: boolean,
  ) => {
    props.onModelMcpCapabilitiesChange({
      ...props.modelMcpCapabilities,
      [key]: checked,
    });
  };

  // 描述：
  //
  //   - 主动检测/修复 Blender Bridge，避免会话阶段首次调用才暴露故障。
  //
  // Params:
  //
  //   - forceInstall: 是否强制重装 Bridge 插件。
  const runBridgeEnsure = async (forceInstall = false) => {
    if (ensuringBridge || props.blenderBridgeRuntime.checking) {
      return;
    }

    setEnsuringBridge(true);
    try {
      await props.ensureBlenderBridge(forceInstall ? { forceInstall: true } : undefined);
    } finally {
      setEnsuringBridge(false);
    }
  };

  return (
    <AriContainer className="desk-content">
      <AriContainer className="desk-settings-shell">
        <DeskPageHeader
          title="模型智能体设置"
          description="管理模型智能体执行能力与 Blender Bridge 连接状态。"
          actions={(
            <AriButton
              color="primary"
              label="进入工作流设置"
              onClick={() => navigate("/agents/model/workflows")}
            />
          )}
        />

        <DeskSectionTitle title="MCP 能力开关" />
        <AriContainer className="desk-settings-panel">
          {capabilityItems.map((item) => (
            <DeskSettingsRow
              key={item.key}
              title={item.title}
              description={item.description}
            >
              <AriSwitch
                checked={Boolean(props.modelMcpCapabilities[item.key])}
                onChange={(checked) => patchCapability(item.key, checked)}
              />
            </DeskSettingsRow>
          ))}
        </AriContainer>

        <DeskSectionTitle title="Blender Bridge" />
        <AriContainer className="desk-settings-panel">
          <DeskSettingsRow
            title="连接状态"
            description={props.blenderBridgeRuntime.message || "Bridge 状态未知。"}
            metaSlot={(
              <DeskStatusText
                value={props.blenderBridgeRuntime.checking
                  ? "检测中"
                  : props.blenderBridgeRuntime.ok
                    ? "已连接"
                    : "未连接"}
              />
            )}
          >
            <AriFlex align="center" space={8}>
              <AriButton
                label={props.blenderBridgeRuntime.checking || ensuringBridge ? "检测中..." : "重新检测"}
                disabled={props.blenderBridgeRuntime.checking || ensuringBridge}
                onClick={() => {
                  void runBridgeEnsure(false);
                }}
              />
              <AriButton
                color="warning"
                label={props.blenderBridgeRuntime.checking || ensuringBridge ? "处理中..." : "修复安装"}
                disabled={props.blenderBridgeRuntime.checking || ensuringBridge}
                onClick={() => {
                  void runBridgeEnsure(true);
                }}
              />
            </AriFlex>
          </DeskSettingsRow>
          <DeskSettingsRow
            title="工作流配置"
            description="工作流设计器已独立，请在工作流设置页面新增和编辑节点。"
          >
            <AriButton
              color="primary"
              label="打开工作流设置"
              onClick={() => navigate("/agents/model/workflows")}
            />
          </DeskSettingsRow>
        </AriContainer>
        <AriContainer className="desk-agent-settings-note-card">
          <AriFlex align="center" justify="space-between" space={8}>
            <DeskStatusText value="说明：智能体设置仅管理能力与运行环境，工作流管理已拆分。"/>
          </AriFlex>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
