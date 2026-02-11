import { AriButton, AriContainer, AriSwitch, AriTypography } from "aries_react";
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
      </div>
    </AriContainer>
  );
}
