import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AriButton,
  AriContainer,
  AriFlex,
  AriIcon,
  AriMessage,
  AriModal,
  AriTypography,
  AriTooltip,
} from "@aries-kit/react";
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
import { AGENT_WORKFLOWS_UPDATED_EVENT, IS_BROWSER } from "../../../shared/constants";
import {
  DeskEmptyState,
  DeskOverviewCard,
  DeskPageHeader,
  DeskSectionTitle,
} from "../../../widgets/settings-primitives";
import { useDesktopI18n } from "../../../shared/i18n";
import {
  listSkillOverview,
  registerBuiltinAgentSkill,
  type SkillOverview,
} from "../services/skills";
import { normalizeAgentSkillId } from "../../../shared/workflow/prompt-guidance";

// 描述：
//
//   - 定义工作流依赖技能的最小结构，统一记录技能编码及其关联节点标题。
interface WorkflowRequiredSkillDescriptor {
  id: string;
  nodeTitles: string[];
}

// 描述：
//
//   - 定义待确认的缺失技能结构，补充标题与当前环境是否允许直接添加。
interface WorkflowMissingSkillDescriptor {
  id: string;
  title: string;
  nodeTitles: string[];
  installable: boolean;
}

// 描述：
//
//   - 定义“添加工作流前先处理依赖技能”的弹窗状态，统一承载目标工作流与缺失技能列表。
interface PendingWorkflowSkillInstallState {
  workflow: AgentWorkflowDefinition;
  missingSkills: WorkflowMissingSkillDescriptor[];
}

// 描述：
//
//   - 读取工作流图中的技能节点，并按技能 ID 聚合节点标题，供添加前依赖检查与弹窗文案复用。
//
// Params:
//
//   - workflow: 待检查的工作流定义。
//
// Returns:
//
//   - 当前工作流依赖的技能列表。
function collectWorkflowRequiredSkills(workflow: AgentWorkflowDefinition): WorkflowRequiredSkillDescriptor[] {
  const requiredSkills = new Map<string, Set<string>>();
  for (const node of workflow.graph?.nodes || []) {
    if (node.type !== "skill") {
      continue;
    }
    const skillId = normalizeAgentSkillId(String(node.skillId || "").trim());
    if (!skillId) {
      continue;
    }
    const nextNodeTitles = requiredSkills.get(skillId) || new Set<string>();
    nextNodeTitles.add(String(node.title || "").trim() || skillId);
    requiredSkills.set(skillId, nextNodeTitles);
  }
  return Array.from(requiredSkills.entries()).map(([id, nodeTitles]) => ({
    id,
    nodeTitles: Array.from(nodeTitles),
  }));
}

// 描述：
//
//   - 基于技能总览计算当前工作流仍缺失的依赖技能，并标记是否可在当前环境直接添加。
//
// Params:
//
//   - workflow: 待注册的工作流模板。
//   - overview: 当前环境可见的技能总览。
//
// Returns:
//
//   - 需要弹窗确认时返回缺失技能状态；若已满足依赖则返回 null。
function buildPendingWorkflowSkillInstallState(
  workflow: AgentWorkflowDefinition,
  overview: SkillOverview,
): PendingWorkflowSkillInstallState | null {
  const requiredSkills = collectWorkflowRequiredSkills(workflow);
  if (requiredSkills.length === 0) {
    return null;
  }
  const registeredSkillIdSet = new Set(
    overview.registered.map((item) => normalizeAgentSkillId(item.id)),
  );
  const unregisteredSkillMap = new Map<string, SkillOverview["unregistered"][number]>(
    overview.unregistered.map((item) => [normalizeAgentSkillId(item.id), item]),
  );
  const missingSkills = requiredSkills
    .filter((item) => !registeredSkillIdSet.has(item.id))
    .map((item) => {
      const matchedSkill = unregisteredSkillMap.get(item.id);
      return {
        id: item.id,
        title: matchedSkill?.title || item.id,
        nodeTitles: item.nodeTitles,
        installable: Boolean(matchedSkill),
      };
    });
  if (missingSkills.length === 0) {
    return null;
  }
  return {
    workflow,
    missingSkills,
  };
}

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
  onAdd?: (workflow: AgentWorkflowDefinition) => void | Promise<void>;
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
          <AriTooltip content={t("管理")} position="top">
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
                void onAdd?.(workflow);
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
  const [pendingWorkflowSkillInstall, setPendingWorkflowSkillInstall] = useState<PendingWorkflowSkillInstallState | null>(null);
  const [installingWorkflowSkills, setInstallingWorkflowSkills] = useState(false);
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
  //   - 监听工作流注册表更新事件；当编辑页或侧边栏修改了工作流后，总览页可原地刷新分区列表。
  useEffect(() => {
    if (!IS_BROWSER) {
      return undefined;
    }
    const handleAgentWorkflowsUpdated = () => {
      refreshWorkflowOverview();
    };
    window.addEventListener(AGENT_WORKFLOWS_UPDATED_EVENT, handleAgentWorkflowsUpdated as EventListener);
    return () => {
      window.removeEventListener(AGENT_WORKFLOWS_UPDATED_EVENT, handleAgentWorkflowsUpdated as EventListener);
    };
  }, [refreshWorkflowOverview]);

  // 描述：
  //
  //   - 打开工作流管理页；内置模板进入只读查看，用户工作流进入可编辑页。
  const handleManageWorkflow = useCallback((workflow: AgentWorkflowDefinition) => {
    navigate(resolveWorkflowEditorPath(workflow.id));
  }, [navigate]);

  // 描述：
  //
  //   - 基于当前工作流创建副本；复制完成后停留在总览页，避免列表操作打断当前浏览上下文。
  const handleCopyWorkflow = useCallback((workflow: AgentWorkflowDefinition) => {
    createAgentWorkflowFromTemplate(workflow.id);
    AriMessage.success({
      content: t("已复制 {{name}}", { name: workflow.name }),
      duration: 1800,
    });
  }, [t]);

  // 描述：
  //
  //   - 新增空白工作流并立即进入编辑页，避免用户创建后还需再次查找目标项。
  const handleCreateWorkflow = useCallback(() => {
    const created = createAgentWorkflow();
    navigate(resolveWorkflowEditorPath(created.id));
  }, [navigate]);

  // 描述：
  //
  //   - 统一执行工作流模板注册，并在用户决定跳过依赖技能时给出更明确的结果提示。
  //
  // Params:
  //
  //   - workflow: 待注册的工作流模板。
  //   - withMissingSkills: 是否仍存在未注册技能。
  const handleRegisterWorkflowTemplate = useCallback((
    workflow: AgentWorkflowDefinition,
    withMissingSkills = false,
  ) => {
    createAgentWorkflowFromTemplate(workflow.id, { mode: "register" });
    if (withMissingSkills) {
      AriMessage.warning({
        content: t("已添加 {{name}}，但部分依赖技能仍未注册。", { name: workflow.name }),
        duration: 2600,
      });
      return;
    }
    AriMessage.success({
      content: t("已添加 {{name}}", { name: workflow.name }),
      duration: 1800,
    });
  }, [t]);

  // 描述：
  //
  //   - 读取工作流依赖技能并生成确认态；若没有缺失技能则返回 null。
  //
  // Params:
  //
  //   - workflow: 待注册的工作流模板。
  //
  // Returns:
  //
  //   - 缺失技能确认态；无缺失时返回 null。
  const resolvePendingWorkflowSkills = useCallback(async (
    workflow: AgentWorkflowDefinition,
  ): Promise<PendingWorkflowSkillInstallState | null> => {
    const overview = await listSkillOverview();
    return buildPendingWorkflowSkillInstallState(workflow, overview);
  }, []);

  // 描述：
  //
  //   - 从内置模板新增工作流；若依赖技能尚未注册，则先弹窗让用户决定是否补装技能。
  const handleAddWorkflow = useCallback(async (workflow: AgentWorkflowDefinition) => {
    try {
      const pendingState = await resolvePendingWorkflowSkills(workflow);
      if (pendingState) {
        setPendingWorkflowSkillInstall(pendingState);
        return;
      }
      handleRegisterWorkflowTemplate(workflow);
    } catch {
      AriMessage.error({
        content: t("添加工作流失败，请稍后重试。"),
        duration: 2200,
      });
    }
  }, [handleRegisterWorkflowTemplate, resolvePendingWorkflowSkills, t]);

  // 描述：
  //
  //   - 关闭依赖技能确认弹窗，并重置安装态，避免上一次操作影响后续添加流程。
  const handleCloseWorkflowSkillInstall = useCallback(() => {
    if (installingWorkflowSkills) {
      return;
    }
    setPendingWorkflowSkillInstall(null);
  }, [installingWorkflowSkills]);

  // 描述：
  //
  //   - 在用户确认跳过依赖技能时，直接注册工作流模板，但保留风险提示。
  const handleRegisterWorkflowWithoutSkills = useCallback(() => {
    if (!pendingWorkflowSkillInstall) {
      return;
    }
    const targetWorkflow = pendingWorkflowSkillInstall.workflow;
    setPendingWorkflowSkillInstall(null);
    handleRegisterWorkflowTemplate(targetWorkflow, true);
  }, [handleRegisterWorkflowTemplate, pendingWorkflowSkillInstall]);

  // 描述：
  //
  //   - 先安装当前环境可见的缺失技能，再二次校验剩余依赖；若仍缺失则留在弹窗内继续确认。
  const handleInstallWorkflowSkillsAndContinue = useCallback(async () => {
    if (!pendingWorkflowSkillInstall) {
      return;
    }
    const installableSkillIds = pendingWorkflowSkillInstall.missingSkills
      .filter((item) => item.installable)
      .map((item) => item.id);
    if (installableSkillIds.length === 0) {
      return;
    }
    setInstallingWorkflowSkills(true);
    try {
      for (const skillId of installableSkillIds) {
        await registerBuiltinAgentSkill(skillId);
      }
      const refreshedPendingState = await resolvePendingWorkflowSkills(pendingWorkflowSkillInstall.workflow);
      if (refreshedPendingState) {
        setPendingWorkflowSkillInstall(refreshedPendingState);
        AriMessage.warning({
          content: t("仍有 {{count}} 个依赖技能未注册，请确认后再继续。", {
            count: refreshedPendingState.missingSkills.length,
          }),
          duration: 2600,
        });
        return;
      }
      const targetWorkflow = pendingWorkflowSkillInstall.workflow;
      setPendingWorkflowSkillInstall(null);
      handleRegisterWorkflowTemplate(targetWorkflow);
    } catch {
      AriMessage.error({
        content: t("依赖技能添加失败，请稍后重试。"),
        duration: 2200,
      });
    } finally {
      setInstallingWorkflowSkills(false);
    }
  }, [handleRegisterWorkflowTemplate, pendingWorkflowSkillInstall, resolvePendingWorkflowSkills, t]);

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
      <AriModal
        visible={Boolean(pendingWorkflowSkillInstall)}
        title={t("未注册依赖技能")}
        onClose={handleCloseWorkflowSkillInstall}
        footer={pendingWorkflowSkillInstall ? (
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              type="default"
              label={t("取消")}
              disabled={installingWorkflowSkills}
              onClick={handleCloseWorkflowSkillInstall}
            />
            <AriButton
              type="default"
              label={t("仅添加工作流")}
              disabled={installingWorkflowSkills}
              onClick={handleRegisterWorkflowWithoutSkills}
            />
            {pendingWorkflowSkillInstall.missingSkills.some((item) => item.installable) ? (
              <AriButton
                type="default"
                label={t("添加技能并继续")}
                disabled={installingWorkflowSkills}
                onClick={() => {
                  void handleInstallWorkflowSkillsAndContinue();
                }}
              />
            ) : null}
          </AriFlex>
        ) : undefined}
      >
        {pendingWorkflowSkillInstall ? (
          <AriFlex vertical align="stretch" justify="flex-start" space={12}>
            <AriTypography
              variant="caption"
              value={t("工作流“{{name}}”依赖以下未注册技能。", {
                name: pendingWorkflowSkillInstall.workflow.name,
              })}
            />
            <AriFlex vertical align="stretch" justify="flex-start" space={8}>
              {pendingWorkflowSkillInstall.missingSkills.map((item) => (
                <AriContainer key={item.id} padding={0}>
                  <AriFlex vertical align="stretch" justify="flex-start" space={4}>
                    <AriTypography variant="body" bold value={item.title} />
                    <AriTypography variant="caption" value={t("技能编码：{{id}}", { id: item.id })} />
                    <AriTypography
                      variant="caption"
                      value={t("工作流节点：{{nodes}}", {
                        nodes: item.nodeTitles.join("、"),
                      })}
                    />
                    <AriTypography
                      variant="caption"
                      value={item.installable ? t("当前环境可直接添加。") : t("当前环境不可添加。")}
                    />
                  </AriFlex>
                </AriContainer>
              ))}
            </AriFlex>
          </AriFlex>
        ) : null}
      </AriModal>
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
