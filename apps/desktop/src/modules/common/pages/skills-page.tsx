import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriIcon,
  AriMessage,
  AriModal,
  AriTypography,
} from "aries_react";
import type { AgentSkillItem, SkillOverview } from "../services";
import {
  importAgentSkillFromPath,
  listSkillOverview,
  pickLocalAgentSkillFolder,
  removeAgentSkill,
} from "../services";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskSectionTitle } from "../../../widgets/settings-primitives";

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
//   - 渲染技能卡片，统一展示标准技能包的名称、描述、来源和目录路径。
//
// Params:
//
//   - skill: 当前技能。
//   - busy: 当前卡片是否处于操作中。
//   - onRemove: 点击移除后的回调。
function SkillCard({
  skill,
  busy,
  onRemove,
}: {
  skill: AgentSkillItem;
  busy: boolean;
  onRemove?: (skill: AgentSkillItem) => void;
}) {
  const sourceLabel = skill.source === "builtin" ? "应用内置" : "外部技能";
  return (
    <AriCard className="desk-skill-card">
      <AriFlex className="desk-skill-card-main" align="center" justify="space-between" space={12}>
        <AriFlex className="desk-skill-card-info" align="center" space={12}>
          <AriContainer className="desk-skill-card-icon-wrap" padding={0}>
            <AriIcon name={skill.source === "builtin" ? "inventory_2" : "folder_open"} />
          </AriContainer>
          <AriContainer padding={0}>
            <AriTypography variant="h4" value={skill.name} />
            <AriTypography variant="caption" value={sourceLabel} />
            <AriTypography variant="caption" value={skill.description || "未填写技能描述"} />
            <AriTypography variant="caption" value={skill.rootPath} />
          </AriContainer>
        </AriFlex>
        {skill.removable && onRemove ? (
          <AriButton
            color="danger"
            ghost
            icon="delete"
            label="移除"
            disabled={busy}
            onClick={() => onRemove(skill)}
          />
        ) : null}
      </AriFlex>
    </AriCard>
  );
}

// 描述：
//
//   - 渲染技能页，展示真实 Agent Skills 注册表，并支持导入本地技能和移除外部技能。
export function SkillsPage() {
  const headerSlotElement = useDesktopHeaderSlot();
  const [overview, setOverview] = useState<SkillOverview>(DEFAULT_SKILL_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [busySkillId, setBusySkillId] = useState("");
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
            content: "加载技能目录失败，请稍后重试。",
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
        content: `已导入 ${importedSkill.name}`,
        duration: 1800,
      });
    } catch (_err) {
      AriMessage.error({
        content: "导入技能失败，请确认目录中包含合法的 SKILL.md。",
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
        content: `已移除 ${removingSkill.name}`,
        duration: 1800,
      });
      setRemovingSkill(null);
    } catch (_err) {
      AriMessage.error({
        content: "移除技能失败，请稍后重试。",
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
    <AriContainer className="desk-project-settings-header" padding={0} data-tauri-drag-region>
      <AriTypography className="desk-project-settings-header-title" variant="h4" value="技能" />
    </AriContainer>
  ), []);

  if (loading) {
    return (
      <AriContainer className="desk-content" showBorderRadius={false}>
        {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
        <AriContainer className="desk-settings-shell desk-skills-shell">
          <AriTypography variant="caption" value="技能列表加载中..." />
        </AriContainer>
      </AriContainer>
    );
  }

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <AriModal
        visible={Boolean(removingSkill)}
        title="移除外部技能"
        onClose={() => setRemovingSkill(null)}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton label="取消" onClick={() => setRemovingSkill(null)} />
            <AriButton color="danger" label="移除" onClick={handleConfirmRemoveSkill} />
          </AriFlex>
        )}
      >
        <AriTypography
          variant="body"
          value={removingSkill ? `确认移除 ${removingSkill.name} 吗？移除后将从外部技能目录删除该技能包。` : ""}
        />
      </AriModal>
      <AriContainer className="desk-settings-shell desk-skills-shell">
        <AriFlex align="center" justify="space-between" space={12}>
          <AriTypography variant="caption" value={`已发现 ${overview.all.length} 个技能`} />
          <AriFlex align="center" space={8}>
            <AriButton
              ghost
              icon="refresh"
              label="刷新"
              disabled={Boolean(busySkillId)}
              onClick={() => {
                void reloadOverview();
              }}
            />
            <AriButton
              color="brand"
              icon="folder_open"
              label="导入本地技能"
              disabled={Boolean(busySkillId)}
              onClick={() => {
                void handleImportLocalSkill();
              }}
            />
          </AriFlex>
        </AriFlex>

        <DeskSectionTitle title="应用内置" />
        {overview.builtin.length === 0 ? (
          <DeskEmptyState title="暂无内置技能" description="当前应用未发现内置 Agent Skills。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.builtin.map((item) => (
              <SkillCard key={item.id} skill={item} busy={busySkillId === item.id} />
            ))}
          </AriContainer>
        )}

        <DeskSectionTitle title="外部技能" />
        {overview.external.length === 0 ? (
          <DeskEmptyState title="暂无外部技能" description="可导入本地标准技能包，或从共享技能目录自动发现。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.external.map((item) => (
              <SkillCard
                key={item.id}
                skill={item}
                busy={busySkillId === item.id}
                onRemove={setRemovingSkill}
              />
            ))}
          </AriContainer>
        )}
      </AriContainer>
    </AriContainer>
  );
}
