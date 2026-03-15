import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { AriButton, AriContainer, AriFlex, AriSelect, AriSwitch } from "@aries-kit/react";
import { DeskPageHeader, DeskSectionTitle, DeskSettingsRow, DeskStatusText } from "../../../widgets/settings-primitives";
import { useDesktopI18n } from "../../../shared/i18n";
import { getAgentSessions, resolveAgentSessionTitle } from "../../../shared/data";
import { COMMANDS } from "../../../shared/constants";

// 描述：
//
//   - 渲染统一智能体设置页，仅提供智能体行为配置，不再承载工作流列表管理。
export function AgentSettingsPage() {
  const navigate = useNavigate();
  const { t } = useDesktopI18n();
  const [autoReview, setAutoReview] = useState(false);
  const [allowLongRun, setAllowLongRun] = useState(true);
  const [sandboxTargetSessionId, setSandboxTargetSessionId] = useState("");
  const [sandboxStatus, setSandboxStatus] = useState("");

  // 描述：读取当前可见会话列表，供全局设置页选择需要维护的沙盒目标。
  const sessionOptions = useMemo(
    () => getAgentSessions("agent").map((item) => ({
      value: item.id,
      label: `${resolveAgentSessionTitle("agent", item.id)} · ${item.updatedAt}`,
    })),
    [],
  );

  useEffect(() => {
    if (!sandboxTargetSessionId && sessionOptions.length > 0) {
      setSandboxTargetSessionId(String(sessionOptions[0]?.value || ""));
    }
  }, [sandboxTargetSessionId, sessionOptions]);

  // 描述：在全局智能体设置页重置指定会话沙盒，避免会话输入区继续承载维护动作。
  const handleResetSandbox = async () => {
    const normalizedSessionId = String(sandboxTargetSessionId || "").trim();
    if (!normalizedSessionId) {
      setSandboxStatus(t("请选择一个会话后再重置沙盒。"));
      return;
    }
    try {
      await invoke(COMMANDS.RESET_AGENT_SANDBOX, { sessionId: normalizedSessionId });
      setSandboxStatus(t("已重置“{{title}}”的沙盒环境。", {
        title: resolveAgentSessionTitle("agent", normalizedSessionId),
      }));
    } catch (_err) {
      setSandboxStatus(t("沙盒重置失败，请查看日志"));
    }
  };

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

        <DeskSectionTitle title={t("会话沙盒")} />
        <AriContainer className="desk-settings-panel">
          <DeskSettingsRow
            title={t("目标会话")}
            description={t("从现有会话中选择一个目标，并在全局设置里执行沙盒重置。")}
          >
            <AriSelect
              value={sandboxTargetSessionId || undefined}
              options={sessionOptions}
              placeholder={t("请选择会话")}
              onChange={(value) => {
                if (Array.isArray(value)) {
                  return;
                }
                setSandboxTargetSessionId(String(value || "").trim());
                if (sandboxStatus) {
                  setSandboxStatus("");
                }
              }}
              disabled={sessionOptions.length === 0}
            />
          </DeskSettingsRow>
          <DeskSettingsRow
            title={t("重置选中会话沙盒")}
            description={t("清空当前会话的沙盒变量和跨轮次上下文。")}
          >
            <AriButton
              icon="refresh"
              label={t("重置沙盒")}
              onClick={handleResetSandbox}
              disabled={sessionOptions.length === 0}
            />
          </DeskSettingsRow>
          {sessionOptions.length === 0 ? (
            <DeskStatusText value={t("当前没有可重置的会话。")} />
          ) : null}
        </AriContainer>
        <AriContainer className="desk-agent-settings-note-card">
          <AriFlex align="center" justify="space-between" space={8}>
            <DeskStatusText value={sandboxStatus || t("说明：智能体设置与工作流设置已拆分为两个独立入口。")} />
          </AriFlex>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
