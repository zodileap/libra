import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AriButton, AriContainer, AriFlex, AriSwitch } from "@aries-kit/react";
import { DeskPageHeader, DeskSectionTitle, DeskSettingsRow, DeskStatusText } from "../../../widgets/settings-primitives";
import { useDesktopI18n } from "../../../shared/i18n";

// 描述：
//
//   - 渲染统一智能体设置页，仅提供智能体行为配置，不再承载工作流列表管理。
export function AgentSettingsPage() {
  const navigate = useNavigate();
  const { t } = useDesktopI18n();
  const [autoReview, setAutoReview] = useState(false);
  const [allowLongRun, setAllowLongRun] = useState(true);

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      <AriContainer className="desk-settings-shell">
        <DeskPageHeader
          title={t("智能体设置")}
          description={t("管理统一智能体执行策略，工作流编辑已迁移到独立页面。")}
          actions={(
            <AriButton
              color="primary"
              label={t("进入工作流设置")}
              onClick={() => navigate("/workflows")}
            />
          )}
        />

        <DeskSectionTitle title={t("执行偏好")} />
        <AriContainer className="desk-settings-panel">
          <DeskSettingsRow
            title={t("自动生成改动说明")}
            description={t("执行完成后自动补充简明变更摘要，便于复查。")}
          >
            <AriSwitch checked={autoReview} onChange={setAutoReview} />
          </DeskSettingsRow>
          <DeskSettingsRow
            title={t("允许长任务运行")}
            description={t("允许智能体在单次会话内执行耗时较长的编译与测试。")}
          >
            <AriSwitch checked={allowLongRun} onChange={setAllowLongRun} />
          </DeskSettingsRow>
          <DeskSettingsRow
            title={t("工作流配置")}
            description={t("工作流设计器已独立，请在工作流设置页面维护流程节点。")}
          >
            <AriButton
              color="primary"
              label={t("打开工作流设置")}
              onClick={() => navigate("/workflows")}
            />
          </DeskSettingsRow>
        </AriContainer>
        <AriContainer className="desk-agent-settings-note-card">
          <AriFlex align="center" justify="space-between" space={8}>
            <DeskStatusText value={t("说明：智能体设置与工作流设置已拆分为两个独立入口。")} />
          </AriFlex>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
