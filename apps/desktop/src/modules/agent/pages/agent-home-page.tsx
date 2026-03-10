import { invoke } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import { useState } from "react";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriTypography,
} from "@aries-kit/react";
import { useNavigate } from "react-router-dom";
import {
  bindProjectSessionWorkspace,
  getProjectWorkspaceProfile,
  saveProjectWorkspaceProfile,
  setLastUsedProjectWorkspaceId,
  type ProjectWorkspaceGroup,
  upsertProjectWorkspaceGroup,
} from "../../../shared/data";
import { COMMANDS } from "../../../shared/constants";
import { createRuntimeSession } from "../../../shared/services/backend-api";
import { resolveAgentSessionPath } from "../routes";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskPageHeader, DeskStatusText } from "../../../widgets/settings-primitives";
import type { DccMcpCapabilities, LoginUser } from "../../../shared/types";
import { useDesktopI18n } from "../../../shared/i18n";

// 描述:
//
//   - 定义智能体新项目页入参。
interface AgentHomePageProps {
  dccMcpCapabilities: DccMcpCapabilities;
  currentUser: LoginUser | null;
}

// 描述:
//
//   - 定义“项目结构化信息初始化分析”命令返回结构。
interface ProjectWorkspaceProfileSeedResponse {
  project_path: string;
  api_data_models: string[];
  api_request_models: string[];
  api_response_models: string[];
  api_mock_cases: string[];
  frontend_pages: string[];
  frontend_navigation: string[];
  frontend_page_elements: string[];
  frontend_code_directories: string[];
  frontend_module_boundaries: string[];
  frontend_code_constraints: string[];
  directory_summary: string[];
  module_candidates: string[];
}

// 描述:
//
//   - 规范化字符串数组，去空去重并保持输入顺序。
//
// Params:
//
//   - value: 原始数组。
//
// Returns:
//
//   - 规范化后的数组。
function normalizeUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
  return normalized.filter((item, index) => normalized.indexOf(item) === index);
}

// 描述：统一智能体新项目页，只负责选择本地项目目录并在创建后直接进入新话题。
export function AgentHomePage(props: AgentHomePageProps) {
  const navigate = useNavigate();
  const headerSlotElement = useDesktopHeaderSlot();
  const { t } = useDesktopI18n();
  const { currentUser } = props;
  const [status, setStatus] = useState("");
  const [folderPickLoading, setFolderPickLoading] = useState(false);
  const [sessionCreating, setSessionCreating] = useState(false);
  void props.dccMcpCapabilities;

  // 描述：
  //
  //   - 在项目创建后补充结构化初始化分析结果（API 数据模型/页面布局/代码结构），仅对首版草稿执行避免覆盖已编辑内容。
  //
  // Params:
  //
  //   - workspace: 新建或命中的项目目录分组。
  const bootstrapWorkspaceProfileSeed = async (workspace: ProjectWorkspaceGroup) => {
    const profileBefore = getProjectWorkspaceProfile(workspace.id);
    if (profileBefore?.revision && profileBefore.revision > 1) {
      return;
    }
    try {
      const seed = await invoke<ProjectWorkspaceProfileSeedResponse>(
        COMMANDS.INSPECT_PROJECT_WORKSPACE_PROFILE_SEED,
        {
          projectPath: workspace.path,
        },
      );
      const profileCurrent = getProjectWorkspaceProfile(workspace.id);
      if (!profileCurrent) {
        return;
      }

      const apiDataModels = normalizeUniqueStrings(seed.api_data_models);
      const apiRequestModels = normalizeUniqueStrings(seed.api_request_models);
      const apiResponseModels = normalizeUniqueStrings(seed.api_response_models);
      const apiMockCases = normalizeUniqueStrings(seed.api_mock_cases);
      const frontendPages = normalizeUniqueStrings(seed.frontend_pages);
      const frontendNavigation = normalizeUniqueStrings(seed.frontend_navigation);
      const frontendPageElements = normalizeUniqueStrings(seed.frontend_page_elements);
      const frontendCodeDirectories = normalizeUniqueStrings(seed.frontend_code_directories);
      const frontendModuleBoundaries = normalizeUniqueStrings(seed.frontend_module_boundaries);
      const frontendCodeConstraints = normalizeUniqueStrings(seed.frontend_code_constraints);
      const moduleCandidates = normalizeUniqueStrings(seed.module_candidates);
      const directorySummary = normalizeUniqueStrings(seed.directory_summary);
      const pageSummary = frontendPages.length > 0
        ? t("页面：{{items}}", { items: frontendPages.join("、") })
        : "";
      const baseSummary = String(profileCurrent.summary || "").trim();
      const stableSummary = baseSummary.replace(/页面：[^；。]+/g, "").trim().replace(/[；。\s]+$/g, "");
      const mergedSummary = pageSummary
        ? [stableSummary || baseSummary, pageSummary].filter((item) => item.length > 0).join("；")
        : baseSummary;
      const stableConstraints = profileCurrent.frontendCodeStructure.implementationConstraints
        .filter((item) => !item.startsWith(t("目录摘要：")))
        .filter((item) => !item.startsWith(t("语言：")))
        .filter((item) => !item.startsWith(t("包管理器：")))
        .filter((item) => !item.startsWith(t("构建工具：")));
      const mergedConstraints = normalizeUniqueStrings([
        ...frontendCodeConstraints,
        ...stableConstraints,
        ...directorySummary.map((item) => t("目录摘要：{{item}}", { item })),
      ]);
      const mergedDirectories = normalizeUniqueStrings([
        ...frontendCodeDirectories,
        ...moduleCandidates,
      ]);

      const saveResult = saveProjectWorkspaceProfile(
        workspace.id,
        {
          summary: mergedSummary || profileCurrent.summary,
          apiDataModel: {
            entities: apiDataModels.length > 0 ? apiDataModels : profileCurrent.apiDataModel.entities,
            requestModels: apiRequestModels.length > 0 ? apiRequestModels : profileCurrent.apiDataModel.requestModels,
            responseModels: apiResponseModels.length > 0 ? apiResponseModels : profileCurrent.apiDataModel.responseModels,
            mockCases: apiMockCases.length > 0 ? apiMockCases : profileCurrent.apiDataModel.mockCases,
          },
          frontendPageLayout: {
            pages: frontendPages.length > 0 ? frontendPages : profileCurrent.frontendPageLayout.pages,
            navigation: frontendNavigation.length > 0 ? frontendNavigation : profileCurrent.frontendPageLayout.navigation,
            pageElements: frontendPageElements.length > 0 ? frontendPageElements : profileCurrent.frontendPageLayout.pageElements,
          },
          frontendCodeStructure: {
            directories: mergedDirectories.length > 0 ? mergedDirectories : profileCurrent.frontendCodeStructure.directories,
            moduleBoundaries: frontendModuleBoundaries.length > 0
              ? frontendModuleBoundaries
              : profileCurrent.frontendCodeStructure.moduleBoundaries,
            implementationConstraints: mergedConstraints,
          },
        },
        {
          expectedRevision: profileCurrent.revision,
          updatedBy: "workspace_seed_bootstrap",
          reason: "workspace_seed_bootstrap",
        },
      );
      if (!saveResult.ok && !saveResult.conflict) {
        console.warn(t("项目结构化初始化分析写入失败："), saveResult.message);
      }
    } catch (err) {
      console.warn(t("项目结构化初始化分析失败："), err);
    }
  };

  // 描述：创建项目目录分组并启动结构化初始化分析。
  //
  // Params:
  //
  //   - pathValue: 目录绝对路径。
  //
  // Returns:
  //
  //   - 命中的项目目录分组；失败时返回 null。
  const handleCreateWorkspaceGroup = (pathValue: string) => {
    const created = upsertProjectWorkspaceGroup(pathValue);
    if (!created) {
      setStatus(t("请输入有效的工作目录路径。"));
      return null;
    }
    setStatus("");
    setLastUsedProjectWorkspaceId(created.id);
    void bootstrapWorkspaceProfileSeed(created);
    return created;
  };

  // 描述：为新项目创建首个会话，并直接跳转到新话题页面。
  //
  // Params:
  //
  //   - workspace: 刚创建完成的项目目录分组。
  const handleOpenFreshSession = async (workspace: ProjectWorkspaceGroup) => {
    if (sessionCreating) {
      return;
    }
    if (!currentUser) {
      setStatus(t("用户未登录，无法创建会话。"));
      return;
    }
    setSessionCreating(true);
    setStatus(t("正在创建会话..."));
    try {
      const session = await createRuntimeSession(currentUser.id, "agent");
      if (!session.id) {
        setStatus(t("创建会话失败，请稍后重试。"));
        return;
      }
      bindProjectSessionWorkspace(session.id, workspace.id);
      setLastUsedProjectWorkspaceId(workspace.id);
      navigate(`${resolveAgentSessionPath(session.id)}?workspaceId=${encodeURIComponent(workspace.id)}`, {
        state: {
          workspaceId: workspace.id,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("创建会话失败");
      setStatus(message);
    } finally {
      setSessionCreating(false);
    }
  };

  // 描述：通过系统文件夹选择器选择本地目录，并在选择完成后立即创建项目与新会话。
  const handlePickLocalFolder = async () => {
    if (folderPickLoading) {
      return;
    }
    setFolderPickLoading(true);
    setStatus("");
    try {
      const selectedPath = await invoke<string | null>("pick_local_project_folder");
      if (!selectedPath) {
        return;
      }
      const created = handleCreateWorkspaceGroup(selectedPath);
      if (!created) {
        return;
      }
      await handleOpenFreshSession(created);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("选择目录失败");
      setStatus(message);
    } finally {
      setFolderPickLoading(false);
    }
  };

  const homeBusy = folderPickLoading || sessionCreating;

  // 描述：构建标题栏头部内容，确保主区域页面头部统一挂载到全局标题栏插槽。
  const headerNode = (
    <DeskPageHeader
      mode="slot"
      title={t("新项目")}
      description={t("选择一个本地文件夹，创建一个新的项目话题。")}
    />
  );

  return (
    <AriContainer className="desk-content desk-agent-home-content" height="100%" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}

      <AriContainer className="desk-agent-home-shell" padding={0}>
        <AriContainer className="desk-agent-home-source-list" padding={0}>
          <AriCard className="desk-agent-home-source-card">
            <AriContainer className="desk-agent-home-source-copy" padding={0}>
              <AriTypography variant="h4" value={t("本地文件夹")} />
              <AriTypography
                variant="caption"
                value={t("从本地目录开始，适合已经在当前机器上的仓库。")}
              />
            </AriContainer>

            <AriContainer className="desk-agent-home-source-action-row" padding={0}>
              <AriButton
                className="desk-agent-home-source-button"
                color="brand"
                icon="folder_open"
                label={folderPickLoading ? t("打开中...") : sessionCreating ? t("开启中...") : t("选择本地文件夹")}
                disabled={homeBusy}
                onClick={() => {
                  void handlePickLocalFolder();
                }}
              />
            </AriContainer>
          </AriCard>
        </AriContainer>

        {status ? <DeskStatusText value={status} /> : null}
      </AriContainer>
    </AriContainer>
  );
}
