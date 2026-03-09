import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AriButton,
  AriContainer,
  AriFlex,
  AriIcon,
  AriMessage,
  AriTooltip,
} from "aries_react";
import { useNavigate } from "react-router-dom";
import {
  createAgentWorkflow,
  createAgentWorkflowFromTemplate,
  isReadonlyAgentWorkflow,
  listAgentWorkflowOverview,
  type AgentWorkflowDefinition,
} from "../../../shared/workflow";
import { resolveWorkflowEditorPath } from "../routes";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import {
  DeskEmptyState,
  DeskOverviewCard,
  DeskPageHeader,
  DeskSectionTitle,
} from "../../../widgets/settings-primitives";
import { useDesktopI18n } from "../../../shared/i18n";

// 描述：
//
//   - 渲染单张工作流卡片，统一承载管理、复制或添加动作，避免总览页重复拼装操作区。
//
// Params:
//
//   - workflow: 当前工作流。
//   - onManage: 打开工作流管理页。
//   - onCopy: 复制当前工作流。
//   - onAdd: 从未注册模板创建工作流。
function WorkflowCard({
  workflow,
  onManage,
  onCopy,
  onAdd,
}: {
  workflow: AgentWorkflowDefinition;
  onManage: (workflow: AgentWorkflowDefinition) => void;
  onCopy?: (workflow: AgentWorkflowDefinition) => void;
  onAdd?: (workflow: AgentWorkflowDefinition) => void;
}) {
  const { t } = useDesktopI18n();
  const readonly = isReadonlyAgentWorkflow(workflow);
  return (
    <DeskOverviewCard
      icon={<AriIcon name="account_tree" />}
      title={workflow.name}
      description={workflow.description || (readonly ? t("当前模板尚未填写说明。") : t("当前工作流尚未填写说明。"))}
      actions={(
        <>
          <AriTooltip content={t("管理")} position="top" minWidth={0} matchTriggerWidth={false}>
            <AriButton
              type="text"
              icon="settings"
              aria-label={t("管理工作流")}
              onClick={() => onManage(workflow)}
            />
          </AriTooltip>
          <AriButton
            type="text"
            icon={readonly ? "add" : "content_copy"}
            aria-label={readonly ? t("添加工作流") : t("复制工作流")}
            onClick={() => {
              if (readonly) {
                onAdd?.(workflow);
                return;
              }
              onCopy?.(workflow);
            }}
          />
        </>
      )}
    />
  );
}

// 描述：
//
//   - 渲染工作流总览页，按“已注册 / 未注册模板”拆分展示，并统一提供新增、复制和添加入口。
export function WorkflowsPage() {
  const { t } = useDesktopI18n();
  const navigate = useNavigate();
  const headerSlotElement = useDesktopHeaderSlot();
  const [workflowVersion, setWorkflowVersion] = useState(0);
  const workflowOverview = useMemo(
    () => listAgentWorkflowOverview(),
    [workflowVersion],
  );

  // 描述：
  //
  //   - 刷新工作流总览，用于新增、复制或添加后重建页面列表。
  const refreshWorkflowOverview = useCallback(() => {
    setWorkflowVersion((value) => value + 1);
  }, []);

  // 描述：
  //
  //   - 打开工作流管理页；内置模板进入只读查看，用户工作流进入可编辑页。
  const handleManageWorkflow = useCallback((workflow: AgentWorkflowDefinition) => {
    navigate(resolveWorkflowEditorPath(workflow.id));
  }, [navigate]);

  // 描述：
  //
  //   - 基于当前工作流创建副本，复制后的工作流始终进入可编辑状态。
  const handleCopyWorkflow = useCallback((workflow: AgentWorkflowDefinition) => {
    const copied = createAgentWorkflowFromTemplate(workflow.id);
    refreshWorkflowOverview();
    AriMessage.success({
      content: t("已复制 {{name}}", { name: workflow.name }),
      duration: 1800,
    });
    navigate(resolveWorkflowEditorPath(copied.id));
  }, [navigate, refreshWorkflowOverview, t]);

  // 描述：
  //
  //   - 新增空白工作流并立即进入编辑页，避免用户创建后还需再次查找目标项。
  const handleCreateWorkflow = useCallback(() => {
    const created = createAgentWorkflow();
    refreshWorkflowOverview();
    navigate(resolveWorkflowEditorPath(created.id));
  }, [navigate, refreshWorkflowOverview]);

  // 描述：
  //
  //   - 从内置模板新增工作流，新增后直接进入编辑页。
  const handleAddWorkflow = useCallback((workflow: AgentWorkflowDefinition) => {
    const created = createAgentWorkflowFromTemplate(workflow.id);
    refreshWorkflowOverview();
    AriMessage.success({
      content: t("已添加 {{name}}", { name: workflow.name }),
      duration: 1800,
    });
    navigate(resolveWorkflowEditorPath(created.id));
  }, [navigate, refreshWorkflowOverview, t]);

  // 描述：
  //
  //   - 生成标题栏内容并挂载到全局头部插槽，保持与技能/MCP 页面一致的页面结构。
  const headerNode = useMemo(() => (
    <DeskPageHeader
      mode="slot"
      title={t("工作流")}
      description={t("已注册工作流可继续管理，未注册模板可直接添加。")}
      actions={(
        <AriFlex align="center" space={8}>
          <AriButton
            color="brand"
            icon="add"
            label={t("新增工作流")}
            size="sm"
            onClick={handleCreateWorkflow}
          />
        </AriFlex>
      )}
    />
  ), [handleCreateWorkflow, t]);

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <AriContainer className="desk-settings-shell desk-skills-shell">
        <DeskSectionTitle title={t("已注册")} />
        {workflowOverview.registered.length === 0 ? (
          <DeskEmptyState title={t("暂无已注册工作流")} description={t("点击右上角新增，或从下方内置模板复制一份开始编辑。")} />
        ) : (
          <AriContainer className="desk-workflow-grid">
            {workflowOverview.registered.map((item) => (
              <WorkflowCard
                key={item.id}
                workflow={item}
                onManage={handleManageWorkflow}
                onCopy={handleCopyWorkflow}
              />
            ))}
          </AriContainer>
        )}

        <DeskSectionTitle title={t("未注册")} />
        {workflowOverview.templates.length === 0 ? (
          <DeskEmptyState title={t("暂无内置模板")} description={t("当前应用未提供可直接复制的内置工作流模板。")} />
        ) : (
          <AriContainer className="desk-workflow-grid">
            {workflowOverview.templates.map((item) => (
              <WorkflowCard
                key={item.id}
                workflow={item}
                onManage={handleManageWorkflow}
                onAdd={handleAddWorkflow}
              />
            ))}
          </AriContainer>
        )}
      </AriContainer>
    </AriContainer>
  );
}
