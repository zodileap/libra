import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AriButton, AriContainer, AriFlex, AriInput, AriModal, AriTag, AriTypography } from "aries_react";
import {
  bootstrapProjectWorkspaceProfile,
  PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT,
  PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT,
  getProjectWorkspaceGroupById,
  getProjectWorkspaceProfile,
  listProjectWorkspaceCapabilityManifests,
  saveProjectWorkspaceProfile,
  updateProjectWorkspaceGroupSettings,
  type ProjectWorkspaceCapabilityId,
  type ProjectWorkspaceKnowledgeSection,
  type ProjectWorkspaceProfile,
} from "../../../shared/data";
import { MCP_PAGE_PATH } from "../../common/routes";
import { type McpOverview, listMcpOverview } from "../../common/services/mcps";
import { type DccRuntimeStatus, checkDccRuntimeStatus, normalizeInvokeError } from "../../../shared/services/dcc-runtime";
import { translateDesktopText, useDesktopI18n } from "../../../shared/i18n";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskSectionTitle, DeskSettingsRow, DeskStatusText } from "../../../widgets/settings-primitives";

// 描述：
//
//   - 定义项目结构化信息编辑草稿，保证设置页可在不丢字段的前提下自动保存。
interface ProjectProfileDraft {
  summary: string;
  knowledgeSections: ProjectWorkspaceKnowledgeSection[];
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
  sections: ProjectWorkspaceKnowledgeSection[],
): ProjectWorkspaceKnowledgeSection[] {
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
function toProjectProfileDraft(profile: ProjectWorkspaceProfile | null): ProjectProfileDraft {
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

// 描述：
//
//   - 创建空的 MCP 总览对象，避免页面首屏阶段反复判空。
//
// Returns:
//
//   - 空的 MCP 总览。
function createEmptyMcpOverview(): McpOverview {
  return {
    registered: [],
    templates: [],
  };
}

// 描述：
//
//   - 将 DCC 软件标识转换为用户可读标签，统一项目设置页与 MCP 页的软件展示口径。
//
// Params:
//
//   - software: DCC 软件标识。
//
// Returns:
//
//   - 软件标签。
function buildDccSoftwareLabel(software: string): string {
  const normalized = String(software || "").trim().toLowerCase();
  if (normalized === "blender") {
    return "Blender";
  }
  if (normalized === "maya") {
    return "Maya";
  }
  if (normalized === "c4d") {
    return "C4D";
  }
  return normalized || translateDesktopText("未命名软件");
}

// 描述：
//
//   - 归并 MCP 总览中的 DCC 软件列表，优先保留启用的软件，再补齐模板中的候选软件。
//
// Params:
//
//   - overview: MCP 总览。
//
// Returns:
//
//   - 去重且保持顺序的软件列表。
function collectProjectDccSoftware(overview: McpOverview): string[] {
  const softwareList = [
    ...overview.registered
      .filter((item) => item.domain === "dcc" && item.runtimeKind === "dcc_bridge" && item.enabled)
      .map((item) => item.software),
    ...overview.templates
      .filter((item) => item.domain === "dcc" && item.runtimeKind === "dcc_bridge")
      .map((item) => item.software),
  ]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item.length > 0);
  return softwareList.filter((item, index) => softwareList.indexOf(item) === index);
}

// 描述：
//
//   - 根据 DCC Runtime 状态生成项目设置页中的摘要文案，帮助快速判断当前项目缺失的环境。
//
// Params:
//
//   - status: DCC Runtime 状态。
//
// Returns:
//
//   - 面向项目设置页的摘要文案。
function buildDccRuntimeRequirementSummary(status: DccRuntimeStatus): string {
  const modeLabel = status.supportsAutoPrepare
    ? translateDesktopText("支持自动准备")
    : translateDesktopText("需手动准备");
  const envLabel = status.requiredEnvKeys.length > 0
    ? translateDesktopText("环境变量 {{keys}}", { keys: status.requiredEnvKeys.join(" / ") })
    : translateDesktopText("无需额外环境变量");
  const stateLabel = status.available
    ? translateDesktopText("已连通")
    : translateDesktopText("未就绪");
  return translateDesktopText("{{state}}，{{mode}}，{{env}}", {
    state: stateLabel,
    mode: modeLabel,
    env: envLabel,
  });
}

// 描述：
//
//   - 在运行时状态读取失败时构造兜底对象，保证项目设置页仍可展示可理解的失败信息。
//
// Params:
//
//   - software: DCC 软件标识。
//   - error: 读取运行时状态时抛出的异常。
//
// Returns:
//
//   - 兜底的 DCC Runtime 状态。
function buildDccRuntimeFallbackStatus(software: string, error: unknown): DccRuntimeStatus {
  return {
    available: false,
    software,
    message: normalizeInvokeError(error),
    resolvedPath: "",
    runtimeKind: "dcc_bridge",
    requiredEnvKeys: [],
    supportsAutoPrepare: software === "blender",
  };
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
  sections: ProjectWorkspaceKnowledgeSection[],
  sectionKey: string,
  facetKey: string,
  entries: string[],
): ProjectWorkspaceKnowledgeSection[] {
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
  sections: ProjectWorkspaceKnowledgeSection[],
  payload: ProjectProfileDraftLegacyPayload,
): ProjectWorkspaceKnowledgeSection[] {
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
  fallback: ProjectWorkspaceKnowledgeSection[],
): ProjectWorkspaceKnowledgeSection[] {
  if (!Array.isArray(value)) {
    return cloneProjectKnowledgeSections(fallback);
  }
  const normalized = value
    .map((item) => {
      const section = (item || {}) as Partial<ProjectWorkspaceKnowledgeSection>;
      const key = String(section.key || "").trim();
      if (!key) {
        return null;
      }
      const facetsRaw = Array.isArray(section.facets) ? section.facets : [];
      const facets = facetsRaw
        .map((facetItem, index) => {
          const facet = (facetItem || {}) as { key?: string; label?: string; entries?: string[] };
          const facetKey = String(facet.key || "").trim() || `facet_${index + 1}`;
          const facetLabel = String(facet.label || "").trim() || translateDesktopText("字段 {{index}}", { index: index + 1 });
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
      } as ProjectWorkspaceKnowledgeSection;
    })
    .filter((item): item is ProjectWorkspaceKnowledgeSection => Boolean(item));
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
      message: translateDesktopText("JSON 内容为空，请输入有效的结构化信息。"),
    };
  }
  try {
    const parsed = JSON.parse(normalizedRawJson) as
      (Partial<ProjectProfileDraft> & ProjectProfileDraftLegacyPayload) | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        draft: baseDraft,
        message: translateDesktopText("JSON 顶层必须是对象结构。"),
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
    const reason = err instanceof Error ? err.message : translateDesktopText("JSON 解析失败");
    return {
      ok: false,
      draft: baseDraft,
      message: translateDesktopText("JSON 解析失败：{{reason}}", { reason }),
    };
  }
}

// 描述：
//
//   - 渲染项目设置页面，承载基础信息与项目能力的动态配置面板。
export function ProjectSettingsPage() {
  const navigate = useNavigate();
  const { t } = useDesktopI18n();
  const [searchParams] = useSearchParams();
  const headerSlotElement = useDesktopHeaderSlot();
  const [name, setName] = useState("");
  const [enabledCapabilities, setEnabledCapabilities] = useState<ProjectWorkspaceCapabilityId[]>([]);
  const [dependencyRules, setDependencyRules] = useState<string[]>([]);
  const [capabilityModalVisible, setCapabilityModalVisible] = useState(false);
  const [workspaceReloadVersion, setWorkspaceReloadVersion] = useState(0);
  const [projectProfileDraft, setProjectProfileDraft] = useState<ProjectProfileDraft>(createEmptyProjectProfileDraft);
  const [projectProfileEditMode, setProjectProfileEditMode] = useState<"form" | "json">("form");
  const [projectProfileJsonDraft, setProjectProfileJsonDraft] = useState("");
  const [projectProfileJsonDirty, setProjectProfileJsonDirty] = useState(false);
  const [projectProfileJsonStatus, setProjectProfileJsonStatus] = useState("");
  const [profileSyncStatus, setProfileSyncStatus] = useState("");
  const [regeneratingProfile, setRegeneratingProfile] = useState(false);
  const [projectMcpOverview, setProjectMcpOverview] = useState<McpOverview>(createEmptyMcpOverview);
  const [projectMcpStatus, setProjectMcpStatus] = useState("");
  const [projectDccRuntimeStatusMap, setProjectDccRuntimeStatusMap] = useState<Record<string, DccRuntimeStatus>>({});
  const skipAutoSaveRef = useRef(true);
  const skipProfileAutoSaveRef = useRef(true);
  const profileRevisionRef = useRef(0);

  // 描述：
  //
  //   - 从路由查询参数中解析当前项目 ID。
  const workspaceId = useMemo(() => searchParams.get("workspaceId")?.trim() || "", [searchParams]);

  // 描述：
  //
  //   - 根据项目 ID 读取当前项目详情，未命中时返回 null。
  const workspace = useMemo(() => {
    if (!workspaceId) {
      return null;
    }
    return getProjectWorkspaceGroupById(workspaceId);
  }, [workspaceId, workspaceReloadVersion]);
  // 描述：
  //
  //   - 基于当前项目启用状态拆分项目能力清单，便于设置页只渲染已启用能力与弹窗候选项。
  const capabilityManifests = useMemo(() => listProjectWorkspaceCapabilityManifests(), []);
  const enabledCapabilityManifests = useMemo(
    () => capabilityManifests.filter((item) => enabledCapabilities.includes(item.id)),
    [capabilityManifests, enabledCapabilities],
  );
  const disabledCapabilityManifests = useMemo(
    () => capabilityManifests.filter((item) => !enabledCapabilities.includes(item.id)),
    [capabilityManifests, enabledCapabilities],
  );
  const projectKnowledgeEnabled = enabledCapabilities.includes("project-knowledge");
  const dependencyPolicyEnabled = enabledCapabilities.includes("dependency-policy");
  const toolchainIntegrationEnabled = enabledCapabilities.includes("toolchain-integration");

  // 描述：
  //
  //   - 监听目录分组更新事件，确保多话题并行修改项目名称、能力绑定或依赖策略时设置页可见最新值。
  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    const onWorkspaceGroupsUpdated = () => {
      setWorkspaceReloadVersion((current) => current + 1);
    };
    window.addEventListener(PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT, onWorkspaceGroupsUpdated as EventListener);
    return () => {
      window.removeEventListener(PROJECT_WORKSPACE_GROUPS_UPDATED_EVENT, onWorkspaceGroupsUpdated as EventListener);
    };
  }, [workspaceId]);

  // 描述：
  //
  //   - 当目标项目切换时重置项目名称与依赖规范草稿，保持 UI 与当前项目一致。
  useEffect(() => {
    skipAutoSaveRef.current = true;
    setName(workspace?.name || "");
    setEnabledCapabilities((workspace?.enabledCapabilities || []) as ProjectWorkspaceCapabilityId[]);
    setDependencyRules(workspace?.dependencyRules || []);
    setCapabilityModalVisible(false);
  }, [workspace?.dependencyRules, workspace?.enabledCapabilities, workspace?.id, workspace?.name]);

  // 描述：
  //
  //   - 当目标项目切换时加载（或初始化）结构化项目信息草稿。
  useEffect(() => {
    skipProfileAutoSaveRef.current = true;
    if (!workspaceId || !workspace || !projectKnowledgeEnabled) {
      profileRevisionRef.current = 0;
      setProjectProfileDraft(createEmptyProjectProfileDraft());
      setProjectProfileEditMode("form");
      setProjectProfileJsonDraft("");
      setProjectProfileJsonDirty(false);
      setProjectProfileJsonStatus("");
      setProfileSyncStatus("");
      return;
    }
    const profile = getProjectWorkspaceProfile(workspaceId)
      || bootstrapProjectWorkspaceProfile(workspaceId, {
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
    setProfileSyncStatus(
      profile
        ? t("结构化信息已加载（v{{revision}}）", { revision: profile.revision })
        : t("结构化信息初始化失败"),
    );
  }, [projectKnowledgeEnabled, workspaceId, workspace]);

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
      updateProjectWorkspaceGroupSettings(workspaceId, {
        name,
        enabledCapabilities,
        dependencyRules,
      });
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dependencyRules, enabledCapabilities, name, workspace, workspaceId]);

  // 描述：
  //
  //   - 监听结构化信息草稿变更并自动保存，支持 revision 冲突检测与回放同步。
  useEffect(() => {
    if (!workspaceId || !workspace || !projectKnowledgeEnabled) {
      return;
    }
    if (skipProfileAutoSaveRef.current) {
      skipProfileAutoSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      const saveResult = saveProjectWorkspaceProfile(
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
        setProfileSyncStatus(t("结构化信息已保存（v{{revision}}）", { revision: saveResult.profile.revision }));
        return;
      }
      if (saveResult.conflict && saveResult.profile) {
        skipProfileAutoSaveRef.current = true;
        profileRevisionRef.current = saveResult.profile.revision;
        setProjectProfileDraft(toProjectProfileDraft(saveResult.profile));
        setProjectProfileJsonDirty(false);
        setProjectProfileJsonStatus(t("检测到其他会话更新，JSON 已刷新为最新版本。"));
      }
      setProfileSyncStatus(saveResult.message);
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [projectKnowledgeEnabled, projectProfileDraft, workspace, workspaceId]);

  // 描述：
  //
  //   - 读取当前项目的 workspace 级 MCP 配置，并补充 DCC Runtime 摘要，避免用户必须跳转到 MCP 页面才能判断当前项目缺失的运行时环境。
  useEffect(() => {
    if (!workspaceId || !workspace?.path || !toolchainIntegrationEnabled) {
      setProjectMcpOverview(createEmptyMcpOverview());
      setProjectMcpStatus("");
      setProjectDccRuntimeStatusMap({});
      return;
    }
    let disposed = false;
    const loadProjectMcpState = async () => {
      setProjectMcpStatus(t("正在检查当前项目的 MCP 与 DCC Runtime..."));
      try {
        const overview = await listMcpOverview({ workspaceRoot: workspace.path });
        if (disposed) {
          return;
        }
        setProjectMcpOverview(overview);
        const dccSoftwareList = collectProjectDccSoftware(overview);
        const runtimeEntries = await Promise.all(
          dccSoftwareList.map(async (software) => {
            try {
              const status = await checkDccRuntimeStatus(software);
              return [software, status] as const;
            } catch (err) {
              return [software, buildDccRuntimeFallbackStatus(software, err)] as const;
            }
          }),
        );
        if (disposed) {
          return;
        }
        setProjectDccRuntimeStatusMap(Object.fromEntries(runtimeEntries));
        const enabledDccCount = overview.registered.filter((item) => item.domain === "dcc" && item.enabled).length;
        setProjectMcpStatus(
          enabledDccCount > 0
            ? t("当前项目已启用 {{count}} 个 DCC MCP。", { count: enabledDccCount })
            : t("当前项目尚未启用 DCC MCP，可先在项目 MCP 中选择软件。"),
        );
      } catch (err) {
        if (disposed) {
          return;
        }
        setProjectMcpOverview(createEmptyMcpOverview());
        setProjectDccRuntimeStatusMap({});
        setProjectMcpStatus(t("项目 MCP 读取失败：{{reason}}", { reason: normalizeInvokeError(err) }));
      }
    };
    void loadProjectMcpState();
    return () => {
      disposed = true;
    };
  }, [toolchainIntegrationEnabled, workspaceId, workspace?.path]);

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
      const latest = getProjectWorkspaceProfile(workspaceId);
      if (!latest || latest.revision === profileRevisionRef.current) {
        return;
      }
      skipProfileAutoSaveRef.current = true;
      profileRevisionRef.current = latest.revision;
      setProjectProfileDraft(toProjectProfileDraft(latest));
      setProjectProfileJsonDirty(false);
      setProjectProfileJsonStatus("");
      setProfileSyncStatus(t("结构化信息已同步（v{{revision}}）", { revision: latest.revision }));
    };

    window.addEventListener(PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT, onProfileUpdated as EventListener);
    return () => {
      window.removeEventListener(PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT, onProfileUpdated as EventListener);
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
      return t("/users/list 成功/空数据/鉴权失败");
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture && facetKey === "pages") {
      return t("用户管理页 / 用户详情页");
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture && facetKey === "navigation") {
      return t("侧边栏：仪表盘 / 用户管理 / 系统设置");
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.uiInformationArchitecture && facetKey === "pageElements") {
      return t("用户管理页：筛选栏 / 数据表格 / 分页器");
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture && facetKey === "directories") {
      return "src/modules/user / src/components/common";
    }
    if (
      sectionKey === PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture
      && facetKey === "moduleBoundaries"
    ) {
      return t("页面层只编排，不直接写请求细节");
    }
    if (
      sectionKey === PROJECT_PROFILE_SECTION_KEYS.frontendImplementationArchitecture
      && facetKey === "implementationConstraints"
    ) {
      return t("路由定义统一维护在 src/routes.ts");
    }
    if (sectionKey === PROJECT_PROFILE_SECTION_KEYS.engineeringGuardrails && facetKey === "codingConventions") {
      return t("新增功能必须补充单测");
    }
    return t("请输入结构化条目");
  };

  // 描述：
  //
  //   - 基于 section+facet key 生成行标题，确保新分类口径保持统一且可读。
  const buildFacetRowTitle = (sectionTitle: string, facetLabel: string): string => {
    if (!sectionTitle) {
      return facetLabel || t("分类条目");
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
    const nextProfile = bootstrapProjectWorkspaceProfile(workspaceId, {
      force: true,
      updatedBy: "project_settings_regenerate",
      reason: "project_settings_regenerate",
    });
    if (!nextProfile) {
      setProfileSyncStatus(t("结构化信息重建失败，请稍后重试。"));
      setRegeneratingProfile(false);
      return;
    }
    skipProfileAutoSaveRef.current = true;
    profileRevisionRef.current = nextProfile.revision;
    setProjectProfileDraft(toProjectProfileDraft(nextProfile));
    setProjectProfileJsonDirty(false);
    setProjectProfileJsonStatus("");
    setProfileSyncStatus(t("结构化信息已重建（v{{revision}}）", { revision: nextProfile.revision }));
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
    setProjectProfileJsonStatus(t("JSON 已应用，结构化信息将自动保存。"));
  };

  // 描述：
  //
  //   - 放弃 JSON 模式中的临时编辑，恢复到当前内存草稿对应的格式化文本。
  const handleResetProjectProfileJson = () => {
    setProjectProfileJsonDraft(toProjectProfileDraftJson(projectProfileDraft));
    setProjectProfileJsonDirty(false);
    setProjectProfileJsonStatus(t("已恢复为当前结构化草稿。"));
  };

  const projectTitle = String(name || workspace?.name || "").trim() || t("未命名项目");

  // 描述：
  //
  //   - 计算当前项目已启用的 DCC MCP 列表，后续用于软件标签与运行时摘要展示。
  const enabledDccRegistrations = useMemo(
    () => projectMcpOverview.registered.filter((item) => item.domain === "dcc" && item.runtimeKind === "dcc_bridge" && item.enabled),
    [projectMcpOverview],
  );

  // 描述：
  //
  //   - 计算当前项目可直接接入的 DCC 模板列表，帮助项目设置页展示候选软件与文档入口。
  const dccTemplateItems = useMemo(
    () => projectMcpOverview.templates.filter((item) => item.domain === "dcc" && item.runtimeKind === "dcc_bridge"),
    [projectMcpOverview],
  );

  // 描述：
  //
  //   - 汇总需要展示 Runtime 要求的软件列表；优先展示当前项目已启用的软件，未启用时回退到模板列表。
  const projectDccRuntimeSoftware = useMemo(() => {
    const preferred = enabledDccRegistrations.map((item) => item.software);
    const fallback = dccTemplateItems.map((item) => item.software);
    const combined = (preferred.length > 0 ? preferred : fallback)
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item) => item.length > 0);
    return combined.filter((item, index) => combined.indexOf(item) === index);
  }, [dccTemplateItems, enabledDccRegistrations]);

  // 描述：
  //
  //   - 打开当前项目的 MCP 配置页，并将项目 ID 透传给 MCP 页面用于 workspace 级注册表编辑。
  const handleOpenWorkspaceMcpPage = () => {
    if (!workspaceId) {
      return;
    }
    navigate(`${MCP_PAGE_PATH}?workspaceId=${encodeURIComponent(workspaceId)}`);
  };

  // 描述：
  //
  //   - 启用指定项目能力；能力启用后对应配置面板会立即显示，并通过既有自动保存链路落盘。
  //
  // Params:
  //
  //   - capabilityId: 目标项目能力 ID。
  const handleEnableCapability = (capabilityId: ProjectWorkspaceCapabilityId) => {
    setEnabledCapabilities((current) => {
      if (current.includes(capabilityId)) {
        return current;
      }
      return [...current, capabilityId];
    });
    setCapabilityModalVisible(false);
  };

  // 描述：
  //
  //   - 打开项目能力选择弹窗，仅在仍有可添加能力时展示候选清单。
  const handleOpenCapabilityModal = () => {
    setCapabilityModalVisible(true);
  };

  // 描述：
  //
  //   - 关闭项目能力选择弹窗。
  const handleCloseCapabilityModal = () => {
    setCapabilityModalVisible(false);
  };

  // 描述：
  //
  //   - 移除指定项目能力；移除后仅隐藏该能力配置面板，不主动删除已持久化的历史数据。
  //
  // Params:
  //
  //   - capabilityId: 目标项目能力 ID。
  const handleDisableCapability = (capabilityId: ProjectWorkspaceCapabilityId) => {
    setEnabledCapabilities((current) => current.filter((item) => item !== capabilityId));
  };

  const projectHeaderNode = (
    <AriFlex
      className="desk-project-settings-header"
      align="center"
      justify="space-between"
      space={12}
      padding={0}
      data-tauri-drag-region
    >
      <AriTypography
        className="desk-project-settings-header-title"
        variant="h4"
        value={projectTitle}
      />
      {workspaceId ? (
        <AriButton
          type="default"
          icon="hub"
          label={t("项目 MCP")}
          size="sm"
          onClick={handleOpenWorkspaceMcpPage}
        />
      ) : null}
    </AriFlex>
  );

  if (!workspaceId || !workspace) {
    return (
      <AriContainer className="desk-content" showBorderRadius={false}>
        {headerSlotElement ? createPortal(projectHeaderNode, headerSlotElement) : null}
        <AriContainer className="desk-settings-shell">
          <DeskEmptyState
            title={t("未选择项目")}
            description={t("请先在侧边栏中选择一个项目，再进入项目设置。")}
          />
        </AriContainer>
      </AriContainer>
    );
  }

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(projectHeaderNode, headerSlotElement) : null}
      <AriContainer className="desk-settings-shell">
        <DeskSectionTitle title={t("基础信息")} />
        <AriContainer className="desk-settings-panel">
          <AriContainer className="desk-project-settings-form" padding={0}>
            <DeskSettingsRow title={t("项目名称")}>
              <AriInput
                value={name}
                onChange={setName}
                placeholder={t("请输入项目名称")}
                maxLength={80}
                minWidth={280}
              />
            </DeskSettingsRow>
          </AriContainer>
        </AriContainer>

        <AriFlex align="center" justify="space-between" space={12} padding={0}>
          <DeskSectionTitle title={t("项目能力")} />
          <AriButton
            type="default"
            icon="add"
            label={t("添加项目能力")}
            size="sm"
            onClick={handleOpenCapabilityModal}
          />
        </AriFlex>
        <AriContainer className="desk-settings-panel">
          <AriContainer className="desk-project-settings-form" padding={0}>
            {enabledCapabilityManifests.length > 0 ? enabledCapabilityManifests.map((item) => (
              <DeskSettingsRow
                key={`${item.id}:enabled`}
                title={item.title}
                description={item.description}
              >
                <AriFlex align="center" justify="flex-end" space={8} padding={0}>
                  <AriTag
                    bordered
                    size="sm"
                    color="var(--z-color-text-brand)"
                  >
                    {item.kind}
                  </AriTag>
                  <AriButton
                    type="default"
                    icon="delete"
                    label={t("移除")}
                    size="sm"
                    onClick={() => {
                      handleDisableCapability(item.id);
                    }}
                  />
                </AriFlex>
              </DeskSettingsRow>
            )) : (
              <AriTypography variant="caption" value={t("当前项目尚未启用项目能力。")} />
            )}
          </AriContainer>
        </AriContainer>
        <AriModal
          visible={capabilityModalVisible}
          title={t("添加项目能力")}
          onClose={handleCloseCapabilityModal}
          footer={
            <AriFlex align="center" justify="flex-end" space={8}>
              <AriButton
                type="default"
                icon="close"
                label={t("关闭")}
                size="sm"
                onClick={handleCloseCapabilityModal}
              />
            </AriFlex>
          }
        >
          <AriContainer padding={0}>
            <AriFlex direction="column" space={12}>
              {disabledCapabilityManifests.length > 0 ? disabledCapabilityManifests.map((item) => (
                <AriFlex
                  key={`capability-modal:${item.id}`}
                  align="center"
                  justify="space-between"
                  space={12}
                  padding={0}
                >
                  <AriContainer padding={0}>
                    <AriTypography variant="body" value={item.title} />
                    <AriTypography variant="caption" value={item.description} />
                  </AriContainer>
                  <AriButton
                    type="default"
                    icon="add"
                    label={t("启用")}
                    size="sm"
                    onClick={() => {
                      handleEnableCapability(item.id);
                    }}
                  />
                </AriFlex>
              )) : (
                <AriTypography variant="caption" value={t("当前没有可添加的项目能力。")} />
              )}
            </AriFlex>
          </AriContainer>
        </AriModal>

        {dependencyPolicyEnabled ? (
          <>
            <DeskSectionTitle title={t("依赖策略")} />
            <AriContainer className="desk-settings-panel">
              <AriContainer className="desk-project-settings-form" padding={0}>
                <AriContainer padding={0}>
                  <AriInput.TextList
                    value={dependencyRules}
                    onChange={setDependencyRules}
                    itemPlaceholder="node:react@19.1.0"
                    addText={t("新增规范")}
                    allowDrag={false}
                    allowEmpty={false}
                    minWidth={360}
                  />
                </AriContainer>
              </AriContainer>
            </AriContainer>
          </>
        ) : null}

        {toolchainIntegrationEnabled ? (
          <>
            <DeskSectionTitle title={t("工具接入")} />
            <AriContainer className="desk-settings-panel">
              <AriContainer className="desk-project-settings-form" padding={0}>
                <DeskSettingsRow
                  title={t("项目级配置")}
                  description={t("workspace 级配置会覆盖同名 user 级 MCP。")}
                >
                  <AriButton
                    type="default"
                    icon="hub"
                    label={t("打开项目 MCP")}
                    size="sm"
                    onClick={handleOpenWorkspaceMcpPage}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title={t("已启用建模软件")}>
                  <AriFlex align="center" justify="flex-start" space={8}>
                    {enabledDccRegistrations.length > 0 ? enabledDccRegistrations.map((item) => (
                      <AriTag
                        key={`${item.scope}:${item.id}`}
                        bordered
                        size="sm"
                        color="var(--z-color-text-brand)"
                      >
                        {buildDccSoftwareLabel(item.software)}
                      </AriTag>
                    )) : (
                      <AriTypography variant="caption" value={t("当前项目尚未启用 DCC MCP。")} />
                    )}
                  </AriFlex>
                </DeskSettingsRow>

                <DeskSettingsRow title={t("可接入软件")}>
                  <AriFlex align="center" justify="flex-start" space={8}>
                    {dccTemplateItems.length > 0 ? dccTemplateItems.map((item) => (
                      <AriTag key={item.id} bordered size="sm">
                        {buildDccSoftwareLabel(item.software)}
                      </AriTag>
                    )) : (
                      <AriTypography variant="caption" value={t("当前没有可用的 DCC 模板。")} />
                    )}
                  </AriFlex>
                </DeskSettingsRow>

                <DeskSettingsRow title={t("Runtime 要求")}>
                  <AriContainer padding={0}>
                    {projectDccRuntimeSoftware.length > 0 ? projectDccRuntimeSoftware.map((software) => {
                      const runtimeStatus = projectDccRuntimeStatusMap[software];
                      const value = runtimeStatus
                        ? t("{{software}}：{{summary}}", {
                          software: buildDccSoftwareLabel(software),
                          summary: buildDccRuntimeRequirementSummary(runtimeStatus),
                        })
                        : t("{{software}}：正在读取 Runtime 状态...", { software: buildDccSoftwareLabel(software) });
                      return (
                        <AriTypography
                          key={software}
                          variant="caption"
                          value={value}
                        />
                      );
                    }) : (
                      <AriTypography variant="caption" value={t("当前没有需要检查的 DCC Runtime。")} />
                    )}
                  </AriContainer>
                </DeskSettingsRow>

                <DeskSettingsRow title={t("接入文档")}>
                  <AriContainer padding={0}>
                    {dccTemplateItems.length > 0 ? dccTemplateItems.map((item) => (
                      <AriTypography
                        key={`${item.id}:docs`}
                        variant="caption"
                        value={t("{{software}}：{{docs}}", {
                          software: buildDccSoftwareLabel(item.software),
                          docs: item.docsUrl || t("未提供接入文档。"),
                        })}
                      />
                    )) : (
                      <AriTypography variant="caption" value={t("当前没有可显示的接入文档。")} />
                    )}
                  </AriContainer>
                </DeskSettingsRow>

                {projectMcpStatus ? <DeskStatusText value={projectMcpStatus} /> : null}
              </AriContainer>
            </AriContainer>
          </>
        ) : null}

        {projectKnowledgeEnabled ? (
          <>
            <DeskSectionTitle title={t("项目知识")} />
        <AriContainer className="desk-settings-panel">
          <AriContainer className="desk-project-settings-form" padding={0}>
            <DeskSettingsRow title={t("编辑模式")}>
              <AriFlex align="center" justify="flex-start" space={8}>
                <AriButton
                  type={projectProfileEditMode === "form" ? "primary" : "default"}
                  icon="list"
                  label={t("分区表单")}
                  onClick={() => {
                    handleSwitchProjectProfileEditMode("form");
                  }}
                />
                <AriButton
                  type={projectProfileEditMode === "json" ? "primary" : "default"}
                  icon="code"
                  label={t("JSON 高级")}
                  onClick={() => {
                    handleSwitchProjectProfileEditMode("json");
                  }}
                />
              </AriFlex>
            </DeskSettingsRow>

            {projectProfileEditMode === "form" ? (
              <>
                <DeskSettingsRow title={t("项目摘要")}>
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
                    placeholder={t("描述项目目标、核心能力与边界。")}
                    minWidth={360}
                  />
                </DeskSettingsRow>
                {orderedKnowledgeSections.map((section) => (
                  <AriContainer key={section.key} padding={0}>
                    <AriTypography
                      variant="caption"
                      value={section.description || t("{{title}}：请补充该分类的关键语义。", { title: section.title })}
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
                          addText={t("新增")}
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
                <DeskSettingsRow title={t("JSON（高级）")}>
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
                    placeholder={t("输入 ProjectProfile JSON，支持局部字段覆盖。")}
                    minWidth={360}
                  />
                </DeskSettingsRow>
                <DeskSettingsRow title={t("JSON 操作")}>
                  <AriFlex align="center" justify="flex-start" space={8}>
                    <AriButton
                      color="info"
                      icon="check"
                      label={t("应用 JSON")}
                      onClick={handleApplyProjectProfileJson}
                    />
                    <AriButton
                      type="default"
                      icon="undo"
                      label={t("恢复草稿")}
                      onClick={handleResetProjectProfileJson}
                    />
                  </AriFlex>
                </DeskSettingsRow>
                <AriTypography
                  variant="caption"
                  value={projectProfileJsonStatus || t("提示：JSON 模式会写回同一份项目结构化信息，并自动保存。")}
                />
              </>
            )}

            <DeskSettingsRow title={t("维护操作")}>
              <AriButton
                color="info"
                icon="refresh"
                label={regeneratingProfile ? t("重建中...") : t("重新生成")}
                disabled={regeneratingProfile}
                onClick={handleRegenerateProjectProfile}
              />
            </DeskSettingsRow>

            <AriTypography
              variant="caption"
              value={profileSyncStatus || t("结构化版本：v{{revision}}", { revision: profileRevisionRef.current || 0 })}
            />
          </AriContainer>
        </AriContainer>
          </>
        ) : null}
      </AriContainer>
    </AriContainer>
  );
}
