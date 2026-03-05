import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { AriButton, AriContainer, AriFlex, AriInput, AriTypography } from "aries_react";
import {
  bootstrapCodeWorkspaceProjectProfile,
  CODE_WORKSPACE_GROUPS_UPDATED_EVENT,
  CODE_WORKSPACE_PROFILE_UPDATED_EVENT,
  getCodeWorkspaceGroupById,
  getCodeWorkspaceProjectProfile,
  saveCodeWorkspaceProjectProfile,
  updateCodeWorkspaceGroupSettings,
  type CodeWorkspaceProjectKnowledgeSection,
  type CodeWorkspaceProjectProfile,
} from "../../../shared/data";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskSectionTitle, DeskSettingsRow } from "../../../widgets/settings-primitives";

// 描述：
//
//   - 定义项目结构化信息编辑草稿，保证设置页可在不丢字段的前提下自动保存。
interface ProjectProfileDraft {
  summary: string;
  knowledgeSections: CodeWorkspaceProjectKnowledgeSection[];
}

// 描述：
//
//   - 创建空白结构化信息草稿。
//
// Returns:
//
//   - 空白草稿对象。
function createEmptyProjectProfileDraft(): ProjectProfileDraft {
  return {
    summary: "",
    knowledgeSections: [],
  };
}

// 描述：
//
//   - 深拷贝结构化分类列表，避免表单态与持久化对象共享引用。
//
// Params:
//
//   - sections: 分类列表。
//
// Returns:
//
//   - 深拷贝后的分类列表。
function cloneProjectKnowledgeSections(
  sections: CodeWorkspaceProjectKnowledgeSection[],
): CodeWorkspaceProjectKnowledgeSection[] {
  return sections.map((section) => ({
    key: String(section.key || "").trim(),
    title: String(section.title || "").trim(),
    description: String(section.description || "").trim(),
    facets: (section.facets || []).map((facet) => ({
      key: String(facet.key || "").trim(),
      label: String(facet.label || "").trim(),
      entries: normalizeProfileDraftTextList(facet.entries),
    })),
  }));
}

// 描述：
//
//   - 将数据层 profile 转换为可编辑草稿，避免表单直接持有持久化对象引用。
//
// Params:
//
//   - profile: 数据层结构化信息。
//
// Returns:
//
//   - 可编辑草稿。
function toProjectProfileDraft(profile: CodeWorkspaceProjectProfile | null): ProjectProfileDraft {
  if (!profile) {
    return createEmptyProjectProfileDraft();
  }
  return {
    summary: String(profile.summary || "").trim(),
    knowledgeSections: cloneProjectKnowledgeSections(profile.knowledgeSections || []),
  };
}

// 描述：
//
//   - 规范化 JSON 输入中的字符串数组字段，统一去空、去重并保留顺序。
//
// Params:
//
//   - value: 任意输入值。
//
// Returns:
//
//   - 规范化后的字符串数组。
function normalizeProfileDraftTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
  return normalized.filter((item, index) => normalized.indexOf(item) === index);
}

const PROJECT_PROFILE_SECTION_KEYS = {
  interactionContracts: "interaction_contracts",
  uiInformationArchitecture: "ui_information_architecture",
  frontendImplementationArchitecture: "frontend_implementation_architecture",
  engineeringGuardrails: "engineering_guardrails",
} as const;

// 描述：
//
//   - 按 section/facet key 写入条目，未命中时保持原值。
//
// Params:
//
//   - sections: 当前分类列表。
//   - sectionKey: 分类键。
//   - facetKey: 细分键。
//   - entries: 待写入条目。
//
// Returns:
//
//   - 写入后的分类列表。
function writeSectionFacetEntries(
  sections: CodeWorkspaceProjectKnowledgeSection[],
  sectionKey: string,
  facetKey: string,
  entries: string[],
): CodeWorkspaceProjectKnowledgeSection[] {
  return sections.map((section) => {
    if (section.key !== sectionKey) {
      return section;
    }
    return {
      ...section,
      facets: (section.facets || []).map((facet) => (facet.key === facetKey
        ? { ...facet, entries: normalizeProfileDraftTextList(entries) }
        : facet)),
    };
  });
}

interface ProjectProfileDraftLegacyPayload {
  apiDataModel?: {
    entities?: string[];
    requestModels?: string[];
    responseModels?: string[];
    mockCases?: string[];
  };
  frontendPageLayout?: {
    pages?: string[];
    navigation?: string[];
    pageElements?: string[];
  };
  frontendCodeStructure?: {
    directories?: string[];
    moduleBoundaries?: string[];
    implementationConstraints?: string[];
  };
  codingConventions?: string[];
}

// 描述：
//
//   - 兼容旧版 JSON 字段（apiDataModel/frontendPageLayout/frontendCodeStructure/codingConventions），并投影到新分类结构。
//
// Params:
//
//   - sections: 当前分类列表。
//   - payload: 旧版字段载荷。
//
// Returns:
//
//   - 融合后的分类列表。
function applyLegacyPayloadToKnowledgeSections(
  sections: CodeWorkspaceProjectKnowledgeSection[],
  payload: ProjectProfileDraftLegacyPayload,
): CodeWorkspaceProjectKnowledgeSection[] {
  let nextSections = sections;
  if (payload.apiDataModel?.entities !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
      "entities",
      payload.apiDataModel.entities,
    );
  }
  if (payload.apiDataModel?.requestModels !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
      "requestModels",
      payload.apiDataModel.requestModels,
    );
  }
  if (payload.apiDataModel?.responseModels !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
      "responseModels",
      payload.apiDataModel.responseModels,
    );
  }
  if (payload.apiDataModel?.mockCases !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.interactionContracts,
      "mockCases",
      payload.apiDataModel.mockCases,
    );
  }
  if (payload.frontendPageLayout?.pages !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture,
      "pages",
      payload.frontendPageLayout.pages,
    );
  }
  if (payload.frontendPageLayout?.navigation !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture,
      "navigation",
      payload.frontendPageLayout.navigation,
    );
  }
  if (payload.frontendPageLayout?.pageElements !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture,
      "pageElements",
      payload.frontendPageLayout.pageElements,
    );
  }
  if (payload.frontendCodeStructure?.directories !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
      "directories",
      payload.frontendCodeStructure.directories,
    );
  }
  if (payload.frontendCodeStructure?.moduleBoundaries !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
      "moduleBoundaries",
      payload.frontendCodeStructure.moduleBoundaries,
    );
  }
  if (payload.frontendCodeStructure?.implementationConstraints !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture,
      "implementationConstraints",
      payload.frontendCodeStructure.implementationConstraints,
    );
  }
  if (payload.codingConventions !== undefined) {
    nextSections = writeSectionFacetEntries(
      nextSections,
      PROJECT_PROFILE_SECTION_KEYS.engineeringGuardrails,
      "codingConventions",
      payload.codingConventions,
    );
  }
  return nextSections;
}

// 描述：
//
//   - 规范化 JSON 草稿中的分类结构。
//
// Params:
//
//   - value: 原始分类输入。
//   - fallback: 兜底分类。
//
// Returns:
//
//   - 规范化分类。
function normalizeDraftKnowledgeSections(
  value: unknown,
  fallback: CodeWorkspaceProjectKnowledgeSection[],
): CodeWorkspaceProjectKnowledgeSection[] {
  if (!Array.isArray(value)) {
    return cloneProjectKnowledgeSections(fallback);
  }
  const normalized = value
    .map((item) => {
      const section = (item || {}) as Partial<CodeWorkspaceProjectKnowledgeSection>;
      const key = String(section.key || "").trim();
      if (!key) {
        return null;
      }
      const facetsRaw = Array.isArray(section.facets) ? section.facets : [];
      const facets = facetsRaw
        .map((facetItem, index) => {
          const facet = (facetItem || {}) as { key?: string; label?: string; entries?: string[] };
          const facetKey = String(facet.key || "").trim() || `facet_${index + 1}`;
          const facetLabel = String(facet.label || "").trim() || `字段 ${index + 1}`;
          return {
            key: facetKey,
            label: facetLabel,
            entries: normalizeProfileDraftTextList(facet.entries),
          };
        })
        .filter((facet) => facet.key.length > 0);
      if (facets.length === 0) {
        return null;
      }
      return {
        key,
        title: String(section.title || "").trim() || key,
        description: String(section.description || "").trim(),
        facets,
      } as CodeWorkspaceProjectKnowledgeSection;
    })
    .filter((item): item is CodeWorkspaceProjectKnowledgeSection => Boolean(item));
  return normalized.length > 0 ? normalized : cloneProjectKnowledgeSections(fallback);
}

// 描述：
//
//   - 将结构化信息草稿序列化为格式化 JSON 文本，便于高级模式编辑与回放。
//
// Params:
//
//   - draft: 当前草稿。
//
// Returns:
//
//   - 双空格缩进的 JSON 字符串。
function toProjectProfileDraftJson(draft: ProjectProfileDraft): string {
  return JSON.stringify(draft, null, 2);
}

// 描述：
//
//   - 解析 JSON 高级模式输入并转成结构化信息草稿，支持基于当前草稿做增量覆盖。
//
// Params:
//
//   - rawJson: 用户输入的 JSON 文本。
//   - baseDraft: 当前草稿（用于缺失字段回填）。
//
// Returns:
//
//   - 解析结果（包含成功状态、草稿与提示信息）。
function parseProjectProfileDraftFromJson(
  rawJson: string,
  baseDraft: ProjectProfileDraft,
): {
  ok: boolean;
  draft: ProjectProfileDraft;
  message: string;
} {
  const normalizedRawJson = String(rawJson || "").trim();
  if (!normalizedRawJson) {
    return {
      ok: false,
      draft: baseDraft,
      message: "JSON 内容为空，请输入有效的结构化信息。",
    };
  }
  try {
    const parsed = JSON.parse(normalizedRawJson) as
      (Partial<ProjectProfileDraft> & ProjectProfileDraftLegacyPayload) | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        draft: baseDraft,
        message: "JSON 顶层必须是对象结构。",
      };
    }
    const baseSections = cloneProjectKnowledgeSections(baseDraft.knowledgeSections);
    const parsedSections = parsed.knowledgeSections === undefined
      ? baseSections
      : normalizeDraftKnowledgeSections(parsed.knowledgeSections, baseSections);
    const mergedSections = applyLegacyPayloadToKnowledgeSections(parsedSections, parsed);
    const nextDraft: ProjectProfileDraft = {
      summary: parsed.summary === undefined
        ? String(baseDraft.summary || "").trim()
        : String(parsed.summary || "").trim(),
      knowledgeSections: mergedSections,
    };
    return {
      ok: true,
      draft: nextDraft,
      message: "",
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "JSON 解析失败";
    return {
      ok: false,
      draft: baseDraft,
      message: `JSON 解析失败：${reason}`,
    };
  }
}

// 描述：
//
//   - 渲染代码项目设置页面，承载项目名称、依赖规范与结构化项目信息维护。
export function CodeProjectSettingsPage() {
  const [searchParams] = useSearchParams();
  const headerSlotElement = useDesktopHeaderSlot();
  const [name, setName] = useState("");
  const [dependencyRules, setDependencyRules] = useState<string[]>([]);
  const [workspaceReloadVersion, setWorkspaceReloadVersion] = useState(0);
  const [projectProfileDraft, setProjectProfileDraft] = useState<ProjectProfileDraft>(createEmptyProjectProfileDraft);
  const [projectProfileEditMode, setProjectProfileEditMode] = useState<"form" | "json">("form");
  const [projectProfileJsonDraft, setProjectProfileJsonDraft] = useState("");
  const [projectProfileJsonDirty, setProjectProfileJsonDirty] = useState(false);
  const [projectProfileJsonStatus, setProjectProfileJsonStatus] = useState("");
  const [profileSyncStatus, setProfileSyncStatus] = useState("");
  const [regeneratingProfile, setRegeneratingProfile] = useState(false);
  const skipAutoSaveRef = useRef(true);
  const skipProfileAutoSaveRef = useRef(true);
  const profileRevisionRef = useRef(0);

  // 描述：
  //
  //   - 从路由查询参数中解析当前代码项目 ID。
  const workspaceId = useMemo(() => searchParams.get("workspaceId")?.trim() || "", [searchParams]);

  // 描述：
  //
  //   - 根据项目 ID 读取当前项目详情，未命中时返回 null。
  const workspace = useMemo(() => {
    if (!workspaceId) {
      return null;
    }
    return getCodeWorkspaceGroupById(workspaceId);
  }, [workspaceId, workspaceReloadVersion]);

  // 描述：
  //
  //   - 监听目录分组更新事件，确保多话题并行修改项目名称/依赖规范时设置页可见最新值。
  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    const onWorkspaceGroupsUpdated = () => {
      setWorkspaceReloadVersion((current) => current + 1);
    };
    window.addEventListener(CODE_WORKSPACE_GROUPS_UPDATED_EVENT, onWorkspaceGroupsUpdated as EventListener);
    return () => {
      window.removeEventListener(CODE_WORKSPACE_GROUPS_UPDATED_EVENT, onWorkspaceGroupsUpdated as EventListener);
    };
  }, [workspaceId]);

  // 描述：
  //
  //   - 当目标项目切换时重置项目名称与依赖规范草稿，保持 UI 与当前项目一致。
  useEffect(() => {
    skipAutoSaveRef.current = true;
    setName(workspace?.name || "");
    setDependencyRules(workspace?.dependencyRules || []);
  }, [workspace?.id, workspace?.name, workspace?.dependencyRules]);

  // 描述：
  //
  //   - 当目标项目切换时加载（或初始化）结构化项目信息草稿。
  useEffect(() => {
    skipProfileAutoSaveRef.current = true;
    if (!workspaceId || !workspace) {
      profileRevisionRef.current = 0;
      setProjectProfileDraft(createEmptyProjectProfileDraft());
      setProjectProfileEditMode("form");
      setProjectProfileJsonDraft("");
      setProjectProfileJsonDirty(false);
      setProjectProfileJsonStatus("");
      setProfileSyncStatus("");
      return;
    }
    const profile = getCodeWorkspaceProjectProfile(workspaceId)
      || bootstrapCodeWorkspaceProjectProfile(workspaceId, {
        force: false,
        updatedBy: "project_settings_init",
        reason: "project_settings_init",
    });
    profileRevisionRef.current = Number(profile?.revision || 0);
    const nextDraft = toProjectProfileDraft(profile);
    setProjectProfileDraft(nextDraft);
    setProjectProfileJsonDraft(toProjectProfileDraftJson(nextDraft));
    setProjectProfileJsonDirty(false);
    setProjectProfileJsonStatus("");
    setProfileSyncStatus(profile ? `结构化信息已加载（v${profile.revision}）` : "结构化信息初始化失败");
  }, [workspaceId, workspace]);

  // 描述：
  //
  //   - 当草稿更新且 JSON 高级模式未处于脏编辑状态时，同步回放 JSON 文本，保证两种编辑模式一致。
  useEffect(() => {
    if (projectProfileJsonDirty) {
      return;
    }
    setProjectProfileJsonDraft(toProjectProfileDraftJson(projectProfileDraft));
  }, [projectProfileDraft, projectProfileJsonDirty]);

  // 描述：
  //
  //   - 监听项目设置变更并自动保存，避免页面再额外放置“保存”按钮。
  useEffect(() => {
    if (!workspaceId || !workspace) {
      return;
    }
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      updateCodeWorkspaceGroupSettings(workspaceId, {
        name,
        dependencyRules,
      });
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [workspaceId, workspace, name, dependencyRules]);

  // 描述：
  //
  //   - 监听结构化信息草稿变更并自动保存，支持 revision 冲突检测与回放同步。
  useEffect(() => {
    if (!workspaceId || !workspace) {
      return;
    }
    if (skipProfileAutoSaveRef.current) {
      skipProfileAutoSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      const saveResult = saveCodeWorkspaceProjectProfile(
        workspaceId,
        {
          summary: projectProfileDraft.summary,
          knowledgeSections: projectProfileDraft.knowledgeSections,
        },
        {
          expectedRevision: profileRevisionRef.current,
          updatedBy: "project_settings",
          reason: "project_settings",
        },
      );
      if (saveResult.ok && saveResult.profile) {
        profileRevisionRef.current = saveResult.profile.revision;
        setProfileSyncStatus(`结构化信息已保存（v${saveResult.profile.revision}）`);
        return;
      }
      if (saveResult.conflict && saveResult.profile) {
        skipProfileAutoSaveRef.current = true;
        profileRevisionRef.current = saveResult.profile.revision;
        setProjectProfileDraft(toProjectProfileDraft(saveResult.profile));
        setProjectProfileJsonDirty(false);
        setProjectProfileJsonStatus("检测到其他会话更新，JSON 已刷新为最新版本。");
      }
      setProfileSyncStatus(saveResult.message);
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [workspaceId, workspace, projectProfileDraft]);

  // 描述：
  //
  //   - 监听其他会话触发的 profile 更新事件，确保设置页与多话题保持一致。
  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    const onProfileUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ workspaceId?: string; revision?: number }>;
      const updatedWorkspaceId = String(customEvent.detail?.workspaceId || "").trim();
      if (!updatedWorkspaceId || updatedWorkspaceId !== workspaceId) {
        return;
      }
      const latest = getCodeWorkspaceProjectProfile(workspaceId);
      if (!latest || latest.revision === profileRevisionRef.current) {
        return;
      }
      skipProfileAutoSaveRef.current = true;
      profileRevisionRef.current = latest.revision;
      setProjectProfileDraft(toProjectProfileDraft(latest));
      setProjectProfileJsonDirty(false);
      setProjectProfileJsonStatus("");
      setProfileSyncStatus(`结构化信息已同步（v${latest.revision}）`);
    };

    window.addEventListener(CODE_WORKSPACE_PROFILE_UPDATED_EVENT, onProfileUpdated as EventListener);
    return () => {
      window.removeEventListener(CODE_WORKSPACE_PROFILE_UPDATED_EVENT, onProfileUpdated as EventListener);
    };
  }, [workspaceId]);

  // 描述：
  //
  //   - 更新结构化信息分类下的指定 facet 条目。
  const handleUpdateKnowledgeSectionFacet = (
    sectionKey: string,
    facetKey: string,
    value: string[],
  ) => {
    const normalizedValue = normalizeProfileDraftTextList(value);
    setProjectProfileDraft((current) => {
      const nextSections = current.knowledgeSections.map((section) => (section.key !== sectionKey
        ? section
        : {
          ...section,
          facets: (section.facets || []).map((facet) => (facet.key !== facetKey
            ? facet
            : {
              ...facet,
              entries: normalizedValue,
            })),
        }));
      return {
        ...current,
        knowledgeSections: nextSections,
      };
    });
  };

  const orderedKnowledgeSections = useMemo(
    () => cloneProjectKnowledgeSections(projectProfileDraft.knowledgeSections),
    [projectProfileDraft.knowledgeSections],
  );

  // 描述：
  //
  //   - 基于 section+facet key 生成输入占位文案，帮助快速填写高质量结构化条目。
  const buildFacetPlaceholder = (sectionKey: string, facetKey: string): string => {
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.interactionContracts && facetKey === "entities") {
      return "User: id, name, role";
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.interactionContracts && facetKey === "requestModels") {
      return "CreateUserRequest: name, role";
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.interactionContracts && facetKey === "responseModels") {
      return "UserResponse: id, name, role";
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.interactionContracts && facetKey === "mockCases") {
      return "/users/list 成功/空数据/鉴权失败";
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture && facetKey === "pages") {
      return "用户管理页 / 用户详情页";
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture && facetKey === "navigation") {
      return "侧边栏：仪表盘 / 用户管理 / 系统设置";
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture && facetKey === "pageElements") {
      return "用户管理页：筛选栏 / 数据表格 / 分页器";
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture && facetKey === "directories") {
      return "src/modules/user / src/components/common";
    }
    if (
      sectionKey === PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture
      && facetKey === "moduleBoundaries"
    ) {
      return "页面层只编排，不直接写请求细节";
    }
    if (
      sectionKey === PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture
      && facetKey === "implementationConstraints"
    ) {
      return "路由定义统一维护在 src/routes.ts";
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.engineeringGuardrails && facetKey === "codingConventions") {
      return "新增功能必须补充单测";
    }
    return "请输入结构化条目";
  };

  // 描述：
  //
  //   - 基于 section+facet key 生成行标题，确保新分类口径保持统一且可读。
  const buildFacetRowTitle = (sectionTitle: string, facetLabel: string): string => {
    if (!sectionTitle) {
      return facetLabel || "分类条目";
    }
    if (!facetLabel) {
      return sectionTitle;
    }
    return `${sectionTitle} · ${facetLabel}`;
  };

  // 描述：
  //
  //   - 手动触发结构化项目信息重建，便于在目录结构或依赖策略变化后快速刷新基线。
  const handleRegenerateProjectProfile = () => {
    if (!workspaceId || !workspace || regeneratingProfile) {
      return;
    }
    setRegeneratingProfile(true);
    const nextProfile = bootstrapCodeWorkspaceProjectProfile(workspaceId, {
      force: true,
      updatedBy: "project_settings_regenerate",
      reason: "project_settings_regenerate",
    });
    if (!nextProfile) {
      setProfileSyncStatus("结构化信息重建失败，请稍后重试。");
      setRegeneratingProfile(false);
      return;
    }
    skipProfileAutoSaveRef.current = true;
    profileRevisionRef.current = nextProfile.revision;
    setProjectProfileDraft(toProjectProfileDraft(nextProfile));
    setProjectProfileJsonDirty(false);
    setProjectProfileJsonStatus("");
    setProfileSyncStatus(`结构化信息已重建（v${nextProfile.revision}）`);
    setRegeneratingProfile(false);
  };

  // 描述：
  //
  //   - 切换结构化信息编辑模式；进入 JSON 模式时重置为当前草稿快照，避免携带历史脏数据。
  //
  // Params:
  //
  //   - mode: 目标编辑模式。
  const handleSwitchProjectProfileEditMode = (mode: "form" | "json") => {
    if (mode === projectProfileEditMode) {
      return;
    }
    if (mode === "json") {
      setProjectProfileJsonDraft(toProjectProfileDraftJson(projectProfileDraft));
      setProjectProfileJsonDirty(false);
      setProjectProfileJsonStatus("");
    }
    setProjectProfileEditMode(mode);
  };

  // 描述：
  //
  //   - 应用 JSON 高级模式输入；解析成功后写回分区草稿并触发既有自动保存链路。
  const handleApplyProjectProfileJson = () => {
    const parseResult = parseProjectProfileDraftFromJson(projectProfileJsonDraft, projectProfileDraft);
    if (!parseResult.ok) {
      setProjectProfileJsonStatus(parseResult.message);
      return;
    }
    setProjectProfileDraft(parseResult.draft);
    setProjectProfileJsonDraft(toProjectProfileDraftJson(parseResult.draft));
    setProjectProfileJsonDirty(false);
    setProjectProfileJsonStatus("JSON 已应用，结构化信息将自动保存。");
  };

  // 描述：
  //
  //   - 放弃 JSON 模式中的临时编辑，恢复到当前内存草稿对应的格式化文本。
  const handleResetProjectProfileJson = () => {
    setProjectProfileJsonDraft(toProjectProfileDraftJson(projectProfileDraft));
    setProjectProfileJsonDirty(false);
    setProjectProfileJsonStatus("已恢复为当前结构化草稿。");
  };

  const projectTitle = String(name || workspace?.name || "").trim() || "未命名项目";
  const projectHeaderNode = (
    <AriContainer className="desk-project-settings-header" padding={0} data-tauri-drag-region>
      <AriTypography
        className="desk-project-settings-header-title"
        variant="h4"
        value={projectTitle}
      />
    </AriContainer>
  );

  if (!workspaceId || !workspace) {
    return (
      <AriContainer className="desk-content" showBorderRadius={false}>
        {headerSlotElement ? createPortal(projectHeaderNode, headerSlotElement) : null}
        <AriContainer className="desk-settings-shell">
          <DeskEmptyState
            title="未选择项目"
            description="请先在侧边栏中选择一个项目，再进入项目设置。"
          />
        </AriContainer>
      </AriContainer>
    );
  }

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(projectHeaderNode, headerSlotElement) : null}
      <AriContainer className="desk-settings-shell">
        <DeskSectionTitle title="基础信息" />
        <AriContainer className="desk-settings-panel">
          <AriContainer className="desk-project-settings-form" padding={0}>
            <DeskSettingsRow title="项目名称">
              <AriInput
                value={name}
                onChange={setName}
                placeholder="请输入项目名称"
                maxLength={80}
                minWidth={280}
              />
            </DeskSettingsRow>
          </AriContainer>
        </AriContainer>

        <DeskSectionTitle title="依赖规范" />
        <AriContainer className="desk-settings-panel">
          <AriContainer className="desk-project-settings-form" padding={0}>
            <AriContainer padding={0}>
              <AriInput.TextList
                value={dependencyRules}
                onChange={setDependencyRules}
                itemPlaceholder="node:react@19.1.0"
                addText="新增规范"
                allowDrag={false}
                allowEmpty={false}
                minWidth={360}
              />
            </AriContainer>
          </AriContainer>
        </AriContainer>

        <DeskSectionTitle title="结构化项目信息" />
        <AriContainer className="desk-settings-panel">
          <AriContainer className="desk-project-settings-form" padding={0}>
            <DeskSettingsRow title="编辑模式">
              <AriFlex align="center" justify="flex-start" space={8}>
                <AriButton
                  type={projectProfileEditMode === "form" ? "primary" : "default"}
                  icon="list"
                  label="分区表单"
                  onClick={() => {
                    handleSwitchProjectProfileEditMode("form");
                  }}
                />
                <AriButton
                  type={projectProfileEditMode === "json" ? "primary" : "default"}
                  icon="code"
                  label="JSON 高级"
                  onClick={() => {
                    handleSwitchProjectProfileEditMode("json");
                  }}
                />
              </AriFlex>
            </DeskSettingsRow>

            {projectProfileEditMode === "form" ? (
              <>
                <DeskSettingsRow title="项目摘要">
                  <AriInput.TextArea
                    value={projectProfileDraft.summary}
                    onChange={(value: string) => {
                      setProjectProfileDraft((current) => ({
                        ...current,
                        summary: value,
                      }));
                    }}
                    variant="borderless"
                    rows={3}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    placeholder="描述项目目标、核心能力与边界。"
                    minWidth={360}
                  />
                </DeskSettingsRow>
                {orderedKnowledgeSections.map((section) => (
                  <AriContainer key={section.key} padding={0}>
                    <AriTypography
                      variant="caption"
                      value={section.description || `${section.title}：请补充该分类的关键语义。`}
                    />
                    {(section.facets || []).map((facet) => (
                      <DeskSettingsRow
                        key={`${section.key}:${facet.key}`}
                        title={buildFacetRowTitle(section.title, facet.label)}
                      >
                        <AriInput.TextList
                          value={facet.entries || []}
                          onChange={(value: string[]) => {
                            handleUpdateKnowledgeSectionFacet(section.key, facet.key, value);
                          }}
                          itemPlaceholder={buildFacetPlaceholder(section.key, facet.key)}
                          addText="新增"
                          allowDrag={false}
                          minWidth={360}
                        />
                      </DeskSettingsRow>
                    ))}
                  </AriContainer>
                ))}
              </>
            ) : (
              <>
                <DeskSettingsRow title="JSON（高级）">
                  <AriInput.TextArea
                    value={projectProfileJsonDraft}
                    onChange={(value: string) => {
                      setProjectProfileJsonDraft(value);
                      setProjectProfileJsonDirty(true);
                      setProjectProfileJsonStatus("");
                    }}
                    variant="borderless"
                    rows={14}
                    autoSize={{ minRows: 12, maxRows: 24 }}
                    placeholder="输入 ProjectProfile JSON，支持局部字段覆盖。"
                    minWidth={360}
                  />
                </DeskSettingsRow>
                <DeskSettingsRow title="JSON 操作">
                  <AriFlex align="center" justify="flex-start" space={8}>
                    <AriButton
                      color="info"
                      icon="check"
                      label="应用 JSON"
                      onClick={handleApplyProjectProfileJson}
                    />
                    <AriButton
                      type="default"
                      icon="undo"
                      label="恢复草稿"
                      onClick={handleResetProjectProfileJson}
                    />
                  </AriFlex>
                </DeskSettingsRow>
                <AriTypography
                  variant="caption"
                  value={projectProfileJsonStatus || "提示：JSON 模式会写回同一份项目结构化信息，并自动保存。"}
                />
              </>
            )}

            <DeskSettingsRow title="维护操作">
              <AriButton
                color="info"
                icon="refresh"
                label={regeneratingProfile ? "重建中..." : "重新生成"}
                disabled={regeneratingProfile}
                onClick={handleRegenerateProjectProfile}
              />
            </DeskSettingsRow>

            <AriTypography variant="caption" value={profileSyncStatus || `结构化版本：v${profileRevisionRef.current || 0}`} />
          </AriContainer>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
