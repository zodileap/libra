import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AriButton,
  AriContainer,
  AriFlex,
  AriIcon,
  AriMessage,
  AriModal,
  AriTooltip,
  AriTypography,
} from "aries_react";
import type { AgentSkillItem, SkillOverview } from "../services";
import {
  importAgentSkillFromPath,
  listSkillOverview,
  pickLocalAgentSkillFolder,
  removeAgentSkill,
} from "../services";
import { useDesktopI18n } from "../../../shared/i18n";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import {
  DeskOverviewDetailRow,
  DeskOverviewDetailsModal,
  DeskEmptyState,
  DeskOverviewCard,
  DeskPageHeader,
  DeskSectionTitle,
} from "../../../widgets/settings-primitives";

// 描述：
//
//   - 技能总览默认值，避免首次渲染阶段访问未定义字段。
const DEFAULT_SKILL_OVERVIEW: SkillOverview = {
  builtin: [],
  external: [],
  all: [],
};

// 描述：
//
//   - 渲染技能卡片，统一展示技能名称、摘要说明与管理动作。
//
// Params:
//
//   - skill: 当前技能。
//   - busy: 当前卡片是否处于操作中。
//   - onManage: 点击管理后的回调。
//   - onAdd: 点击添加后的回调。
function SkillCard({
  t,
  skill,
  busy,
  onManage,
  onAdd,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  skill: AgentSkillItem;
  busy: boolean;
  onManage: (skill: AgentSkillItem) => void;
  onAdd?: (skill: AgentSkillItem) => void;
}) {
  const registered = skill.source !== "builtin";
  return (
    <DeskOverviewCard
      icon={<AriIcon name="new_releases" />}
      title={skill.name}
      description={skill.description || t("未填写技能描述")}
      actions={(
        <>
          <AriTooltip content={t("管理")} position="top" minWidth={0} matchTriggerWidth={false}>
            <AriButton
              type="text"
              icon="settings"
              aria-label={t("管理技能")}
              disabled={busy}
              onClick={() => onManage(skill)}
            />
          </AriTooltip>
          {!registered && onAdd ? (
            <AriButton
              type="text"
              icon="add"
              aria-label={t("添加技能")}
              disabled={busy}
              onClick={() => onAdd(skill)}
            />
          ) : null}
        </>
      )}
    />
  );
}

// 描述：
//
//   - 渲染技能页，展示真实 Agent Skills 注册表，并支持导入本地技能和移除外部技能。
export function SkillsPage() {
  const headerSlotElement = useDesktopHeaderSlot();
  const { t } = useDesktopI18n();
  const [overview, setOverview] = useState<SkillOverview>(DEFAULT_SKILL_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [busySkillId, setBusySkillId] = useState("");
  const [managingSkill, setManagingSkill] = useState<AgentSkillItem | null>(null);
  const [removingSkill, setRemovingSkill] = useState<AgentSkillItem | null>(null);

  // 描述：
  //
  //   - 重新拉取技能总览，供初始化、导入和移除后统一复用。
  const reloadOverview = useCallback(async () => {
    const nextOverview = await listSkillOverview();
    setOverview(nextOverview);
  }, []);

  // 描述：
  //
  //   - 页面初始化时读取技能注册表。
  useEffect(() => {
    let disposed = false;
    const loadOverview = async () => {
      setLoading(true);
      try {
        const nextOverview = await listSkillOverview();
        if (!disposed) {
          setOverview(nextOverview);
        }
      } catch (_err) {
        if (!disposed) {
          setOverview(DEFAULT_SKILL_OVERVIEW);
          AriMessage.error({
            content: t("加载技能目录失败，请稍后重试。"),
            duration: 2200,
          });
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };
    void loadOverview();
    return () => {
      disposed = true;
    };
  }, []);

  // 描述：
  //
  //   - 导入用户选择的本地技能目录；导入成功后刷新注册表。
  const handleImportLocalSkill = useCallback(async () => {
    if (busySkillId) {
      return;
    }
    setBusySkillId("__import__");
    try {
      const selectedPath = await pickLocalAgentSkillFolder();
      if (!selectedPath) {
        return;
      }
      const importedSkill = await importAgentSkillFromPath(selectedPath);
      await reloadOverview();
      AriMessage.success({
        content: t("已导入 {{name}}", { name: importedSkill.name }),
        duration: 1800,
      });
    } catch (_err) {
      AriMessage.error({
        content: t("导入技能失败，请确认目录中包含合法的 SKILL.md。"),
        duration: 2200,
      });
    } finally {
      setBusySkillId("");
    }
  }, [busySkillId, reloadOverview]);

  // 描述：
  //
  //   - 将内置技能复制到用户技能目录，完成“未注册 -> 已注册”的添加动作。
  const handleAddBuiltinSkill = useCallback(async (skill: AgentSkillItem) => {
    if (busySkillId) {
      return;
    }
    setBusySkillId(skill.id);
    try {
      const installedSkill = await importAgentSkillFromPath(skill.rootPath);
      await reloadOverview();
      AriMessage.success({
        content: t("已添加 {{name}}", { name: installedSkill.name }),
        duration: 1800,
      });
    } catch (_err) {
      AriMessage.error({
        content: t("添加技能失败，请稍后重试。"),
        duration: 2200,
      });
    } finally {
      setBusySkillId("");
    }
  }, [busySkillId, reloadOverview]);

  // 描述：
  //
  //   - 确认移除外部技能并刷新页面。
  const handleConfirmRemoveSkill = useCallback(async () => {
    if (!removingSkill) {
      return;
    }
    setBusySkillId(removingSkill.id);
    try {
      const nextOverview = await removeAgentSkill(removingSkill.id);
      setOverview(nextOverview);
      AriMessage.success({
        content: t("已移除 {{name}}", { name: removingSkill.name }),
        duration: 1800,
      });
      setRemovingSkill(null);
    } catch (_err) {
      AriMessage.error({
        content: t("移除技能失败，请稍后重试。"),
        duration: 2200,
      });
    } finally {
      setBusySkillId("");
    }
  }, [removingSkill]);

  // 描述：
  //
  //   - 生成标题栏内容并挂载到全局头部插槽。
  const headerNode = useMemo(() => (
    <DeskPageHeader
      mode="slot"
      title={t("技能")}
      description={t("已发现 {{count}} 个技能。", { count: overview.all.length })}
      actions={(
        <AriFlex align="center" space={8}>
          <AriButton
            color="brand"
            icon="add"
            label={t("导入本地技能")}
            size="sm"
            disabled={Boolean(busySkillId)}
            onClick={() => {
              void handleImportLocalSkill();
            }}
          />
        </AriFlex>
      )}
    />
  ), [busySkillId, handleImportLocalSkill, overview.all.length, t]);

  if (loading) {
    return (
      <AriContainer className="desk-content" showBorderRadius={false}>
        {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
        <AriContainer className="desk-settings-shell desk-skills-shell">
          <AriTypography variant="caption" value={t("技能列表加载中...")} />
        </AriContainer>
      </AriContainer>
    );
  }

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <DeskOverviewDetailsModal
        visible={Boolean(managingSkill)}
        title={managingSkill ? t("{{name}} · 详情", { name: managingSkill.name }) : t("技能详情")}
        description={managingSkill?.description || t("未填写技能描述")}
        footer={managingSkill ? (
          <AriFlex justify="flex-end" align="center" space={8}>
            {managingSkill.source === "builtin" ? (
              <AriButton
                color="brand"
                icon="add"
                label={t("添加")}
                disabled={Boolean(busySkillId)}
                onClick={() => {
                  void handleAddBuiltinSkill(managingSkill);
                }}
              />
            ) : managingSkill.removable ? (
              <AriButton
                color="danger"
                icon="delete"
                label={t("移除")}
                disabled={Boolean(busySkillId)}
                onClick={() => setRemovingSkill(managingSkill)}
              />
            ) : null}
            <AriButton icon="close" label={t("关闭")} onClick={() => setManagingSkill(null)} />
          </AriFlex>
        ) : undefined}
        onClose={() => setManagingSkill(null)}
      >
        {managingSkill ? (
          <>
            <DeskOverviewDetailRow label={t("来源")} value={managingSkill.source === "builtin" ? t("应用内置") : t("外部技能")} />
            <DeskOverviewDetailRow label={t("目录")} value={managingSkill.rootPath} />
          </>
        ) : null}
      </DeskOverviewDetailsModal>
      <AriModal
        visible={Boolean(removingSkill)}
        title={t("移除技能")}
        onClose={() => setRemovingSkill(null)}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton label={t("取消")} onClick={() => setRemovingSkill(null)} />
            <AriButton color="danger" label={t("移除")} onClick={handleConfirmRemoveSkill} />
          </AriFlex>
        )}
      >
        <AriTypography
          variant="body"
          value={removingSkill ? t("确认移除 {{name}} 吗？移除后将从外部技能目录删除该技能包。", { name: removingSkill.name }) : ""}
        />
      </AriModal>
      <AriContainer className="desk-settings-shell desk-skills-shell">
        <DeskSectionTitle title={t("已注册")} />
        {overview.external.length === 0 ? (
          <DeskEmptyState title={t("暂无已注册技能")} description={t("可导入本地技能，或从下方未注册技能中添加。")} />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.external.map((item) => (
              <SkillCard key={item.id} t={t} skill={item} busy={busySkillId === item.id} onManage={setManagingSkill} />
            ))}
          </AriContainer>
        )}

        <DeskSectionTitle title={t("未注册")} />
        {overview.builtin.length === 0 ? (
          <DeskEmptyState title={t("暂无未注册技能")} description={t("当前应用未发现可添加的内置技能。")} />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.builtin.map((item) => (
              <SkillCard
                key={item.id}
                t={t}
                skill={item}
                busy={busySkillId === item.id}
                onManage={setManagingSkill}
                onAdd={(target) => {
                  void handleAddBuiltinSkill(target);
                }}
              />
            ))}
          </AriContainer>
        )}
      </AriContainer>
    </AriContainer>
  );
}
