import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AriButton,
  AriContainer,
  AriFlex,
  AriIcon,
  AriMessage,
  AriModal,
  AriTag,
  AriTooltip,
  AriTypography,
} from "@aries-kit/react";
import type { AgentSkillItem, SkillOverview } from "../services";
import {
  listSkillOverview,
  openBuiltinAgentSkillFolder,
  resolveAgentSkillIconName,
  resolveAgentSkillStatusLabel,
  registerBuiltinAgentSkill,
  unregisterBuiltinAgentSkill,
} from "../services";
import { useDesktopI18n } from "../../../shared/i18n";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { ChatMarkdown } from "../../../widgets/chat-markdown";
import {
  DeskEmptyState,
  DeskOverviewCard,
  DeskPageHeader,
  DeskSectionTitle,
} from "../../../widgets/settings-primitives";

// 描述：
//
//   - 技能总览默认值，避免首次渲染阶段访问未定义字段。
const DEFAULT_SKILL_OVERVIEW: SkillOverview = {
  registered: [],
  unregistered: [],
  all: [],
};

// 描述：
//
//   - 定义技能页一级分组结构，用于按主分组组织技能列表。
interface SkillGroupSection {
  key: string;
  title: string;
  items: AgentSkillItem[];
}

// 描述：
//
//   - 规整技能页分组文案；若技能元数据缺失 group，则回退到稳定中文兜底值，避免页面标题为空。
//
// Params:
//
//   - value: 原始分组文案。
//   - fallbackLabel: 兜底文案。
//
// Returns:
//
//   - 可直接展示的分组标题。
function normalizeSkillCategoryLabel(value: string, fallbackLabel: string): string {
  const normalizedValue = String(value || "").trim();
  return normalizedValue || translateDesktopText(fallbackLabel);
}

// 描述：
//
//   - 将技能列表按一级组整理成稳定结构，供“已注册 / 未注册”两个分区复用同一套分类渲染。
//
// Params:
//
//   - skills: 待分组的技能列表。
//
// Returns:
//
//   - 按组和标题排序后的技能分组结构。
function buildSkillGroupSections(skills: AgentSkillItem[]): SkillGroupSection[] {
  const groupedSkillMap = new Map<string, AgentSkillItem[]>();
  skills.forEach((skill) => {
    const groupTitle = normalizeSkillCategoryLabel(skill.group, "未分组");
    const groupedSkills = groupedSkillMap.get(groupTitle) || [];
    groupedSkillMap.set(groupTitle, [...groupedSkills, skill]);
  });
  return [...groupedSkillMap.entries()]
    .sort(([leftTitle], [rightTitle]) => leftTitle.localeCompare(rightTitle, "zh-CN"))
    .map(([groupTitle, groupedSkills]) => ({
      key: groupTitle,
      title: groupTitle,
      items: [...groupedSkills].sort((left, right) =>
        left.title.localeCompare(right.title, "zh-CN") || left.id.localeCompare(right.id, "zh-CN")
      ),
    }));
}

// 描述：
//
//   - 渲染技能图标，统一走前端白名单映射后的内置图标名，默认与侧边栏“技能”入口保持同源。
//
// Params:
//
//   - skill: 当前技能。
//   - size: 图标展示尺寸；卡片使用默认尺寸，详情页使用放大尺寸。
function SkillIcon({
  skill,
  size = "card",
}: {
  skill: AgentSkillItem;
  size?: "card" | "hero";
}) {
  const iconName = resolveAgentSkillIconName(skill.icon);
  return (
    <AriContainer
      className={size === "hero" ? "desk-skill-details-hero" : "desk-skill-card-icon"}
      padding={0}
    >
      <AriIcon
        className={size === "hero" ? "desk-skill-icon-glyph is-hero" : "desk-skill-icon-glyph"}
        name={iconName}
        size={size === "hero" ? "xxl" : "lg"}
      />
    </AriContainer>
  );
}

// 描述：
//
//   - 渲染技能版本与状态标签，供卡片标题和详情弹窗统一展示技能稳定性与安装目标版本。
//
// Params:
//
//   - skill: 当前技能。
function SkillMetaTags({
  skill,
}: {
  skill: AgentSkillItem;
}) {
  const statusLabel = resolveAgentSkillStatusLabel(skill.status);
  const isTesting = String(skill.status || "").trim().toLowerCase() === "testing";
  return (
    <AriFlex align="center" justify="flex-start" space={8}>
      <AriTag bordered size="sm">{skill.version}</AriTag>
      <AriTag bordered size="sm" color={isTesting ? "var(--z-color-warning)" : undefined}>
        {statusLabel}
      </AriTag>
    </AriFlex>
  );
}

// 描述：
//
//   - 生成技能卡片 caption，将版本独立为辅助信息，避免直接拼进标题影响主信息层级。
//
// Params:
//
//   - skill: 当前技能。
//
// Returns:
//
//   - 卡片 caption 文本。
function buildSkillCardCaption(skill: AgentSkillItem): string {
  const statusLabel = resolveAgentSkillStatusLabel(skill.status);
  const isTesting = String(skill.status || "").trim().toLowerCase() === "testing";
  return isTesting ? `${skill.version} · ${statusLabel}` : skill.version;
}

// 描述：
//
//   - 仅在技能详情页渲染时剥离正文首个一级标题，避免与元数据标题重复出现。
//
// Params:
//
//   - markdownBody: 原始 `SKILL.md` 正文。
//
// Returns:
//
//   - 去掉首个一级标题后的 Markdown 内容。
function stripSkillDetailHeading(markdownBody: string): string {
  const normalizedBody = String(markdownBody || "").replace(/\r\n/g, "\n").trim();
  if (!normalizedBody) {
    return "";
  }
  const lines = normalizedBody.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) {
    return normalizedBody;
  }
  if (!/^#\s+/.test(lines[firstContentIndex] || "")) {
    return normalizedBody;
  }
  const remainingLines = lines.slice(firstContentIndex + 1);
  while (remainingLines.length > 0 && remainingLines[0]?.trim().length === 0) {
    remainingLines.shift();
  }
  return remainingLines.join("\n").trim();
}

// 描述：
//
//   - 渲染技能卡片，统一展示技能名称、摘要说明与管理动作。
//
// Params:
//
//   - skill: 当前技能。
//   - registered: 当前技能是否已注册生效。
//   - onManage: 点击管理后的回调。
//   - onToggleRegistration: 切换技能注册状态的回调。
function SkillCard({
  t,
  skill,
  registered,
  busy,
  onManage,
  onToggleRegistration,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  skill: AgentSkillItem;
  registered: boolean;
  busy: boolean;
  onManage: (skill: AgentSkillItem) => void;
  onToggleRegistration: (skill: AgentSkillItem) => void;
}) {
  return (
    <DeskOverviewCard
      icon={<SkillIcon skill={skill} />}
      title={skill.title}
      caption={buildSkillCardCaption(skill)}
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
          <AriButton
            type="text"
            icon={registered ? "delete" : "add"}
            aria-label={registered ? t("移除技能") : t("添加技能")}
            disabled={busy}
            onClick={() => onToggleRegistration(skill)}
          />
        </>
      )}
    />
  );
}

// 描述：
//
//   - 渲染技能分类列表；同一主分区下按一级组落卡片网格，避免技能数增加后完全平铺。
//
// Params:
//
//   - t: 当前语言翻译函数。
//   - sections: 已分组的技能结构。
//   - registered: 当前分区内技能是否已注册。
//   - busyActionId: 当前正在执行注册切换的技能 ID。
//   - onManage: 打开技能详情弹窗的回调。
//   - onToggleRegistration: 切换技能注册状态的回调。
function SkillGroupList({
  t,
  sections,
  registered,
  busyActionId,
  onManage,
  onToggleRegistration,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  sections: SkillGroupSection[];
  registered: boolean;
  busyActionId: string;
  onManage: (skill: AgentSkillItem) => void;
  onToggleRegistration: (skill: AgentSkillItem) => void;
}) {
  return (
    <AriContainer className="desk-skill-group-stack" padding={0}>
      {sections.map((groupSection) => (
        <AriContainer key={groupSection.key} className="desk-skill-group-section" padding={0}>
          <AriTypography
            className="desk-skill-group-title"
            variant="body"
            bold
            value={groupSection.title}
          />
          <AriContainer className="desk-skill-grid">
            {groupSection.items.map((item) => (
              <SkillCard
                key={item.id}
                t={t}
                skill={item}
                registered={registered}
                busy={busyActionId === item.id}
                onManage={onManage}
                onToggleRegistration={onToggleRegistration}
              />
            ))}
          </AriContainer>
        </AriContainer>
      ))}
    </AriContainer>
  );
}

// 描述：
//
//   - 渲染技能页，按“已注册 / 未注册”展示内置技能，并仅允许用户显式注册后再在会话中生效。
export function SkillsPage() {
  const headerSlotElement = useDesktopHeaderSlot();
  const { t } = useDesktopI18n();
  const [overview, setOverview] = useState<SkillOverview>(DEFAULT_SKILL_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [managingSkill, setManagingSkill] = useState<AgentSkillItem | null>(null);
  const [busyActionId, setBusyActionId] = useState("");
  const [openingFolderSkillId, setOpeningFolderSkillId] = useState("");

  // 描述：
  //
  //   - 重新拉取技能总览，供初始化和后续安全策略收口后统一复用。
  const reloadOverview = useCallback(async () => {
    return listSkillOverview();
  }, []);

  // 描述：
  //
  //   - 页面初始化时读取技能注册表。
  useEffect(() => {
    let disposed = false;
    const loadOverview = async () => {
      setLoading(true);
      try {
        const nextOverview = await reloadOverview();
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
  }, [reloadOverview, t]);

  // 描述：
  //
  //   - 缓存已注册技能 ID 集合，供卡片和详情弹窗快速判断当前技能的注册状态。
  const registeredSkillIds = useMemo(
    () => new Set(overview.registered.map((item) => item.id)),
    [overview.registered],
  );
  const registeredSkillSections = useMemo(
    () => buildSkillGroupSections(overview.registered),
    [overview.registered],
  );
  const unregisteredSkillSections = useMemo(
    () => buildSkillGroupSections(overview.unregistered),
    [overview.unregistered],
  );

  // 描述：
  //
  //   - 注册指定内置技能；成功后直接刷新分区状态，并关闭详情弹窗以避免展示旧状态。
  const handleRegisterSkill = useCallback(async (skill: AgentSkillItem) => {
    setBusyActionId(skill.id);
    try {
      const nextOverview = await registerBuiltinAgentSkill(skill.id);
      setOverview(nextOverview);
      setManagingSkill(null);
      AriMessage.success({
        content: t("已添加 {{name}}", { name: skill.title }),
        duration: 1800,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || t("添加技能失败，请稍后重试。"),
        duration: 2200,
      });
    } finally {
      setBusyActionId("");
    }
  }, [t]);

  // 描述：
  //
  //   - 取消注册指定内置技能；成功后刷新分区状态，并关闭详情弹窗避免残留已失效技能。
  const handleUnregisterSkill = useCallback(async (skill: AgentSkillItem) => {
    setBusyActionId(skill.id);
    try {
      const nextOverview = await unregisterBuiltinAgentSkill(skill.id);
      setOverview(nextOverview);
      setManagingSkill(null);
      AriMessage.success({
        content: t("已移除 {{name}}", { name: skill.title }),
        duration: 1800,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || t("移除技能失败，请稍后重试。"),
        duration: 2200,
      });
    } finally {
      setBusyActionId("");
    }
  }, [t]);

  // 描述：
  //
  //   - 根据当前技能状态执行注册或取消注册，统一复用卡片和详情弹窗中的动作入口。
  const handleToggleSkillRegistration = useCallback((skill: AgentSkillItem) => {
    if (registeredSkillIds.has(skill.id)) {
      void handleUnregisterSkill(skill);
      return;
    }
    void handleRegisterSkill(skill);
  }, [handleRegisterSkill, handleUnregisterSkill, registeredSkillIds]);

  // 描述：
  //
  //   - 打开技能目录，方便用户直接查看 `SKILL.md`、runtime 资源和其他随包文件。
  const handleOpenSkillFolder = useCallback(async (skill: AgentSkillItem) => {
    setOpeningFolderSkillId(skill.id);
    try {
      await openBuiltinAgentSkillFolder(skill.id);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || t("打开文件夹失败，请稍后重试。"),
        duration: 2200,
      });
    } finally {
      setOpeningFolderSkillId("");
    }
  }, [t]);

  // 描述：
  //
  //   - 复制技能示例提示到系统剪贴板，方便用户直接试用内置技能的推荐输入方式。
  const handleCopyExamplePrompt = useCallback(async (skill: AgentSkillItem) => {
    const prompt = String(skill.examplePrompt || "").trim();
    if (!prompt) {
      return;
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        AriMessage.error({
          content: t("复制失败，请检查系统剪贴板权限"),
          duration: 2200,
        });
        return;
      }
      await navigator.clipboard.writeText(prompt);
      AriMessage.success({
        content: t("已复制 {{name}}", { name: t("示例提示") }),
        duration: 1800,
      });
    } catch {
      AriMessage.error({
        content: t("复制失败，请检查系统剪贴板权限"),
        duration: 2200,
      });
    }
  }, [t]);

  // 描述：
  //
  //   - 生成标题栏内容并挂载到全局头部插槽。
  const headerNode = useMemo(() => (
    <DeskPageHeader
      mode="slot"
      title={t("技能")}
      description={t("已发现 {{count}} 个技能。", { count: overview.all.length })}
    />
  ), [overview.all.length, t]);

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
      <AriModal
        visible={Boolean(managingSkill)}
        title={managingSkill ? (
          <AriContainer className="desk-skill-details-modal-title" padding={0}>
            <SkillIcon skill={managingSkill} size="hero" />
          </AriContainer>
        ) : " "}
        className="desk-skill-details-modal"
        width="var(--desk-skill-details-modal-width)"
        footer={managingSkill ? (
          <AriFlex align="center" justify="flex-end" space={8}>
            <AriButton
              color={registeredSkillIds.has(managingSkill.id) ? "danger" : "brand"}
              icon={registeredSkillIds.has(managingSkill.id) ? "delete" : "add"}
              label={registeredSkillIds.has(managingSkill.id) ? t("移除技能") : t("添加技能")}
              disabled={busyActionId === managingSkill.id}
              onClick={() => handleToggleSkillRegistration(managingSkill)}
            />
            <AriButton icon="close" label={t("关闭")} onClick={() => setManagingSkill(null)} />
          </AriFlex>
        ) : undefined}
        onClose={() => setManagingSkill(null)}
      >
        {managingSkill ? (
          <AriFlex vertical align="stretch" justify="flex-start" space="var(--z-inset)">
            <AriFlex
              className="desk-skill-details-title-row"
              align="center"
              justify="space-between"
              flexItem={[{ index: 0, flex: 1, overflow: "hidden", minWidth: 0 }]}
            >
              <AriTypography
                className="desk-skill-details-title"
                variant="h1"
                value={managingSkill.title}
              />
              <AriButton
                type="text"
                icon="open_in_new"
                label={t("打开文件夹")}
                disabled={openingFolderSkillId === managingSkill.id}
                onClick={() => {
                  void handleOpenSkillFolder(managingSkill);
                }}
              />
            </AriFlex>
            <AriTypography
              className="desk-skill-details-description-text"
              variant="body"
              value={managingSkill.description || t("未填写技能描述")}
            />
            <SkillMetaTags skill={managingSkill} />
            <AriContainer className="desk-skill-details-prompt-card">
              <AriFlex className="desk-skill-details-prompt-head" align="center" justify="space-between">
                <AriTypography
                  className="desk-skill-details-section-label"
                  variant="body"
                  value={t("示例提示")}
                />
                <AriTooltip content={t("复制")} position="top" minWidth={0} matchTriggerWidth={false}>
                  <AriButton
                    type="text"
                    icon="content_copy"
                    aria-label={t("复制示例提示")}
                    onClick={() => {
                      void handleCopyExamplePrompt(managingSkill);
                    }}
                  />
                </AriTooltip>
              </AriFlex>
              <AriTypography
                className="desk-skill-details-prompt-text"
                variant="body"
                value={managingSkill.examplePrompt}
              />
            </AriContainer>
            <AriContainer className="desk-skill-details-markdown-panel">
              <AriContainer className="desk-skill-details-markdown-scroll" padding={0}>
                <ChatMarkdown
                  content={stripSkillDetailHeading(managingSkill.markdownBody)}
                  className="desk-skill-details-markdown"
                />
              </AriContainer>
            </AriContainer>
          </AriFlex>
        ) : null}
      </AriModal>
      <AriContainer className="desk-settings-shell desk-skills-shell">
        <DeskSectionTitle title={t("已注册")} />
        {overview.registered.length === 0 ? (
          <DeskEmptyState title={t("暂无已注册技能")} description={t("可从下方未注册技能中添加。")} />
        ) : (
          <SkillGroupList
            t={t}
            sections={registeredSkillSections}
            registered
            busyActionId={busyActionId}
            onManage={setManagingSkill}
            onToggleRegistration={handleToggleSkillRegistration}
          />
        )}
        <DeskSectionTitle title={t("未注册")} />
        {overview.unregistered.length === 0 ? (
          <DeskEmptyState title={t("暂无未注册技能")} description={t("当前应用未发现可添加的内置技能。")} />
        ) : (
          <SkillGroupList
            t={t}
            sections={unregisteredSkillSections}
            registered={false}
            busyActionId={busyActionId}
            onManage={setManagingSkill}
            onToggleRegistration={handleToggleSkillRegistration}
          />
        )}
      </AriContainer>
    </AriContainer>
  );
}
