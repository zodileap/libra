import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AriButton, AriContainer, AriFlex, AriSwitch } from "aries_react";
import { DeskPageHeader, DeskSectionTitle, DeskSettingsRow, DeskStatusText } from "../../../widgets/settings-primitives";

// 描述：
//
//   - 渲染代码智能体设置页，仅提供智能体行为配置，不再承载工作流列表管理。
export function CodeAgentSettingsPage() {
  const navigate = useNavigate();
  const [autoReview, setAutoReview] = useState(false);
  const [allowLongRun, setAllowLongRun] = useState(true);

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      <AriContainer className="desk-settings-shell">
        <DeskPageHeader
          title="代码智能体设置"
          description="管理代码智能体执行策略，工作流编辑已迁移到独立页面。"
          actions={(
            <AriButton
              color="primary"
              label="进入工作流设置"
              onClick={() => navigate("/agents/code/workflows")}
            />
          )}
        />

        <DeskSectionTitle title="执行偏好" />
        <AriContainer className="desk-settings-panel">
          <DeskSettingsRow
            title="自动生成改动说明"
            description="执行完成后自动补充简明变更摘要，便于复查。"
          >
            <AriSwitch checked={autoReview} onChange={setAutoReview} />
          </DeskSettingsRow>
          <DeskSettingsRow
            title="允许长任务运行"
            description="允许智能体在单次会话内执行耗时较长的编译与测试。"
          >
            <AriSwitch checked={allowLongRun} onChange={setAllowLongRun} />
          </DeskSettingsRow>
          <DeskSettingsRow
            title="工作流配置"
            description="工作流设计器已独立，请在工作流设置页面维护流程节点。"
          >
            <AriButton
              color="primary"
              label="打开工作流设置"
              onClick={() => navigate("/agents/code/workflows")}
            />
          </DeskSettingsRow>
        </AriContainer>
        <AriContainer className="desk-agent-settings-note-card">
          <AriFlex align="center" justify="space-between" space={8}>
            <DeskStatusText value="说明：代码智能体设置与工作流设置已拆分为两个独立入口。"/>
          </AriFlex>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
