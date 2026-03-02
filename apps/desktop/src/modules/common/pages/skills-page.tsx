import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AriButton, AriCard, AriContainer, AriFlex, AriIcon, AriMessage, AriSwitch, AriTypography } from "aries_react";
import type { SkillCatalogItem, SkillOverview } from "../services";
import { listSkillOverview, updateSkillInstalledState } from "../services";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskSectionTitle } from "../../../widgets/settings-primitives";

// 描述：
//
//   - 技能总览默认状态，避免首屏渲染期间出现未定义访问。
const DEFAULT_SKILL_OVERVIEW: SkillOverview = {
  installed: [],
  marketplace: [],
};

// 描述：
//
//   - 渲染技能页，展示“已安装/推荐”两类技能并支持安装状态切换。
export function SkillsPage() {
  const headerSlotElement = useDesktopHeaderSlot();
  const [overview, setOverview] = useState<SkillOverview>(DEFAULT_SKILL_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [updatingSkillId, setUpdatingSkillId] = useState("");

  // 描述：
  //
  //   - 初始化加载技能目录总览，后续切服务端时保持调用入口不变。
  useEffect(() => {
    const loadOverview = async () => {
      setLoading(true);
      try {
        const data = await listSkillOverview();
        setOverview(data);
      } finally {
        setLoading(false);
      }
    };
    void loadOverview();
  }, []);

  // 描述：
  //
  //   - 根据技能 ID 更新安装状态，并刷新页面展示。
  //
  // Params:
  //
  //   - skill: 目标技能。
  //   - installed: 是否安装。
  const handleUpdateSkillInstalledState = async (skill: SkillCatalogItem, installed: boolean) => {
    if (updatingSkillId) {
      return;
    }
    setUpdatingSkillId(skill.id);
    try {
      const nextOverview = await updateSkillInstalledState(skill.id, installed);
      setOverview(nextOverview);
      AriMessage.success({
        content: installed ? `已安装 ${skill.name}` : `已卸载 ${skill.name}`,
        duration: 1800,
      });
    } catch (_err) {
      AriMessage.error({
        content: installed ? "安装技能失败，请稍后重试。" : "卸载技能失败，请稍后重试。",
        duration: 2200,
      });
    } finally {
      setUpdatingSkillId("");
    }
  };

  // 描述：
  //
  //   - 生成标题栏内容并挂载到全局头部 slot，保持 Desktop 页面头部一致性。
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
      <AriContainer className="desk-settings-shell desk-skills-shell">
        <DeskSectionTitle title="已安装" />
        {overview.installed.length === 0 ? (
          <DeskEmptyState title="暂无已安装技能" description="可从推荐列表安装技能。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.installed.map((item) => (
              <AriCard key={item.id} className="desk-skill-card">
                <AriFlex className="desk-skill-card-main" align="center" justify="space-between" space={12}>
                  <AriFlex className="desk-skill-card-info" align="center" space={12}>
                    <AriContainer className="desk-skill-card-icon-wrap" padding={0}>
                      <AriIcon name={item.icon} />
                    </AriContainer>
                    <AriContainer padding={0}>
                      <AriTypography variant="h4" value={item.name} />
                      <AriTypography variant="caption" value={item.description} />
                    </AriContainer>
                  </AriFlex>
                  <AriSwitch
                    checked
                    disabled={updatingSkillId === item.id}
                    onChange={(checked: boolean) => {
                      if (checked) {
                        return;
                      }
                      void handleUpdateSkillInstalledState(item, false);
                    }}
                  />
                </AriFlex>
              </AriCard>
            ))}
          </AriContainer>
        )}

        <DeskSectionTitle title="推荐" />
        {overview.marketplace.length === 0 ? (
          <DeskEmptyState title="暂无可安装技能" description="当前目录中没有更多可用技能。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.marketplace.map((item) => (
              <AriCard key={item.id} className="desk-skill-card">
                <AriFlex className="desk-skill-card-main" align="center" justify="space-between" space={12}>
                  <AriFlex className="desk-skill-card-info" align="center" space={12}>
                    <AriContainer className="desk-skill-card-icon-wrap" padding={0}>
                      <AriIcon name={item.icon} />
                    </AriContainer>
                    <AriContainer padding={0}>
                      <AriTypography variant="h4" value={item.name} />
                      <AriTypography variant="caption" value={item.description} />
                    </AriContainer>
                  </AriFlex>
                  <AriButton
                    type="text"
                    ghost
                    icon="add"
                    aria-label={`安装${item.name}`}
                    disabled={updatingSkillId === item.id}
                    onClick={() => {
                      void handleUpdateSkillInstalledState(item, true);
                    }}
                  />
                </AriFlex>
              </AriCard>
            ))}
          </AriContainer>
        )}
      </AriContainer>
    </AriContainer>
  );
}
