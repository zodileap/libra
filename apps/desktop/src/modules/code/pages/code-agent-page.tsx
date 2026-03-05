import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriInput,
  AriModal,
  AriTypography,
} from "aries_react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AGENTS,
  bindCodeSessionWorkspace,
  getCodeWorkspaceProjectProfile,
  saveCodeWorkspaceProjectProfile,
  type CodeWorkspaceGroup,
  listCodeWorkspaceGroups,
  setLastUsedCodeWorkspaceId,
  upsertCodeWorkspaceGroup,
} from "../../../shared/data";
import { COMMANDS } from "../../../shared/constants";
import { CODE_PROJECT_SETTINGS_PATH } from "../routes";
import { createRuntimeSession } from "../../../shared/services/backend-api";
import { AgentPage } from "../../../widgets/agent/page";
import type { LoginUser, ModelMcpCapabilities } from "../../../shared/types";

// 描述:
//
//   - 定义代码智能体入口页入参。
interface CodeAgentPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  currentUser: LoginUser | null;
}

// 描述:
//
//   - 定义 Git CLI 检测接口响应结构。
interface GitCliHealthResponse {
  available: boolean;
  version: string;
  bin_path: string;
  message: string;
}

// 描述:
//
//   - 定义 Git 克隆命令响应结构。
interface GitCloneResponse {
  path: string;
  name: string;
  message: string;
}

// 描述:
//
//   - 定义“项目结构化信息初始化分析”命令返回结构。
interface CodeWorkspaceProfileSeedResponse {
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

// 描述：代码智能体入口页包装器，复用通用 agent 组件并固定为 code。
export function CodeAgentPage(props: CodeAgentPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [workspaceGroups, setWorkspaceGroups] = useState<CodeWorkspaceGroup[]>([]);
  const [gitCheckLoading, setGitCheckLoading] = useState(false);
  const [gitCloneLoading, setGitCloneLoading] = useState(false);
  const [folderPickLoading, setFolderPickLoading] = useState(false);
  const [gitInstallModalVisible, setGitInstallModalVisible] = useState(false);
  const [gitInstallMessage, setGitInstallMessage] = useState("");
  const { currentUser } = props;
  const agent = useMemo(() => AGENTS.find((item) => item.key === "code") || AGENTS[0], []);

  // 描述：刷新代码目录分组列表，供代码智能体选择会话目录。
  const refreshWorkspaceGroups = () => {
    setWorkspaceGroups(listCodeWorkspaceGroups());
  };

  // 描述：
  //
  //   - 在项目创建后补充结构化初始化分析结果（API 数据模型/页面布局/代码结构），仅对首版草稿执行避免覆盖已编辑内容。
  //
  // Params:
  //
  //   - workspace: 新建或命中的项目目录分组。
  const bootstrapWorkspaceProfileSeed = async (workspace: CodeWorkspaceGroup) => {
    const profileBefore = getCodeWorkspaceProjectProfile(workspace.id);
    if (profileBefore?.revision && profileBefore.revision > 1) {
      return;
    }
    try {
      const seed = await invoke<CodeWorkspaceProfileSeedResponse>(
        COMMANDS.INSPECT_CODE_WORKSPACE_PROFILE_SEED,
        {
          projectPath: workspace.path,
        },
      );
      const profileCurrent = getCodeWorkspaceProjectProfile(workspace.id);
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
        ? `页面：${frontendPages.join("、")}`
        : "";
      const baseSummary = String(profileCurrent.summary || "").trim();
      const stableSummary = baseSummary.replace(/页面：[^；。]+/g, "").trim().replace(/[；。\s]+$/g, "");
      const mergedSummary = pageSummary
        ? [stableSummary || baseSummary, pageSummary].filter((item) => item.length > 0).join("；")
        : baseSummary;
      const stableConstraints = profileCurrent.frontendCodeStructure.implementationConstraints
        .filter((item) => !item.startsWith("目录摘要："))
        .filter((item) => !item.startsWith("语言："))
        .filter((item) => !item.startsWith("包管理器："))
        .filter((item) => !item.startsWith("构建工具："));
      const mergedConstraints = normalizeUniqueStrings([
        ...frontendCodeConstraints,
        ...stableConstraints,
        ...directorySummary.map((item) => `目录摘要：${item}`),
      ]);
      const mergedDirectories = normalizeUniqueStrings([
        ...frontendCodeDirectories,
        ...moduleCandidates,
      ]);

      const saveResult = saveCodeWorkspaceProjectProfile(
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
        console.warn("项目结构化初始化分析写入失败：", saveResult.message);
      }
    } catch (err) {
      console.warn("项目结构化初始化分析失败：", err);
    }
  };

  useEffect(() => {
    refreshWorkspaceGroups();
  }, []);

  // 描述：从 URL 查询参数中读取当前选中的代码目录 ID。
  const selectedWorkspaceIdFromQuery = useMemo(
    () => searchParams.get("workspaceId")?.trim() || "",
    [searchParams],
  );

  // 描述：根据目录 ID 解析当前选中的目录分组实体。
  const selectedWorkspace = useMemo(() => {
    if (!selectedWorkspaceIdFromQuery) {
      return null;
    }
    return workspaceGroups.find((item) => item.id === selectedWorkspaceIdFromQuery) || null;
  }, [selectedWorkspaceIdFromQuery, workspaceGroups]);

  // 描述：当目录选择变化时，持久化最近使用目录，便于下次进入默认定位。
  useEffect(() => {
    if (!selectedWorkspace?.id) {
      return;
    }
    setLastUsedCodeWorkspaceId(selectedWorkspace.id);
  }, [selectedWorkspace?.id]);

  // 描述：新增代码目录分组，供代码智能体会话归属使用。
  const handleCreateWorkspaceGroup = (pathValue: string) => {
    const created = upsertCodeWorkspaceGroup(pathValue);
    if (!created) {
      setStatus("请输入有效的工作目录路径。");
      return null;
    }
    setStatus("");
    refreshWorkspaceGroups();
    setLastUsedCodeWorkspaceId(created.id);
    setSearchParams(new URLSearchParams({ workspaceId: created.id }), { replace: true });
    void bootstrapWorkspaceProfileSeed(created);
    return created;
  };

  // 描述：回到代码项目选择页，保持“选择项目”和“开始会话”两个页面职责分离。
  const handleOpenWorkspaceSelectionPage = () => {
    setStatus("");
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  // 描述：进入当前项目的设置页，支持在主内容区直接维护结构化项目信息。
  const handleOpenProjectSettingsPage = () => {
    if (!selectedWorkspace?.id) {
      return;
    }
    navigate(`${CODE_PROJECT_SETTINGS_PATH}?workspaceId=${encodeURIComponent(selectedWorkspace.id)}`);
  };

  // 描述：通过系统文件夹选择器选择本地目录，并立即创建目录分组。
  const handlePickLocalFolder = async () => {
    if (folderPickLoading) {
      return;
    }
    setFolderPickLoading(true);
    setStatus("");
    try {
      const selectedPath = await invoke<string | null>("pick_local_project_folder");
      if (!selectedPath) {
        setStatus("已取消目录选择。");
        return;
      }
      handleCreateWorkspaceGroup(selectedPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : "选择目录失败";
      setStatus(message);
    } finally {
      setFolderPickLoading(false);
    }
  };

  // 描述：检查 Git CLI 是否可用，失败时弹出安装引导。
  const ensureGitAvailable = async () => {
    if (gitCheckLoading) {
      return false;
    }
    setGitCheckLoading(true);
    try {
      const result = await invoke<GitCliHealthResponse>("check_git_cli_health");
      if (result.available) {
        return true;
      }
      setGitInstallMessage(result.message || "未检测到可用的 Git，请先安装。\n安装后再继续使用“Git 地址创建项目”。");
      setGitInstallModalVisible(true);
      return false;
    } catch (_err) {
      setGitInstallMessage("检测 Git 可用性失败。请先安装 Git 后再重试。\n安装完成后重启应用。");
      setGitInstallModalVisible(true);
      return false;
    } finally {
      setGitCheckLoading(false);
    }
  };

  // 描述：通过 Git 地址克隆项目到应用目录，并注册为代码目录分组。
  const handleCloneGitRepository = async () => {
    const normalizedRepoUrl = gitRepoUrl.trim();
    if (!normalizedRepoUrl) {
      setStatus("请输入 Git 仓库地址。");
      return;
    }
    if (gitCloneLoading) {
      return;
    }

    const available = await ensureGitAvailable();
    if (!available) {
      return;
    }

    setGitCloneLoading(true);
    setStatus("正在克隆仓库，请稍候...");
    try {
      const cloned = await invoke<GitCloneResponse>("clone_git_repository", {
        repoUrl: normalizedRepoUrl,
      });
      const created = handleCreateWorkspaceGroup(cloned.path);
      if (!created) {
        setStatus(`仓库已克隆，但目录创建失败：${cloned.path}`);
        return;
      }
      setGitRepoUrl("");
      setStatus(cloned.message || `已克隆项目：${cloned.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "克隆仓库失败";
      setStatus(message);
    } finally {
      setGitCloneLoading(false);
    }
  };

  // 描述：打开 Git 官网下载页，供用户快速安装 Git。
  const handleOpenGitDownload = async () => {
    try {
      await invoke("open_external_url", { url: "https://git-scm.com/downloads" });
    } catch (_err) {
      // 描述：忽略打开浏览器失败，保留弹窗由用户手动复制网址。
    } finally {
      setGitInstallModalVisible(false);
    }
  };

  // 描述：创建后端会话并自动发送首条消息，保持“发送后进入会话”的连续体验。
  const handleStartConversation = async () => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setStatus("请先输入需求再开始对话。");
      return;
    }
    if (!currentUser) {
      setStatus("用户未登录，无法创建会话。");
      return;
    }
    if (!selectedWorkspace) {
      setStatus("请先选择至少一个代码目录后再开始对话。");
      return;
    }

    setStatus("正在创建会话...");
    setSending(true);
    try {
      const session = await createRuntimeSession(currentUser.id, "code");
      if (!session.id) {
        setStatus("创建会话失败，请稍后重试。");
        return;
      }

      bindCodeSessionWorkspace(session.id, selectedWorkspace.id);
      setLastUsedCodeWorkspaceId(selectedWorkspace.id);

      const search = `?workspaceId=${encodeURIComponent(selectedWorkspace.id)}`;
      navigate(`/agents/code/session/${session.id}${search}`, {
        state: {
          autoPrompt: normalizedPrompt,
          workspaceId: selectedWorkspace.id,
        },
      });
      setPrompt("");
      setStatus("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "创建会话失败";
      setStatus(msg);
    } finally {
      setSending(false);
    }
  };

  // 描述：定义代码智能体入口页的默认引导卡片文案。
  const starterItems = [
    {
      title: "快速开始",
      description: "在当前目录中重构某个模块，并补上单元测试。",
    },
    {
      title: "上下文约束",
      description: "告诉智能体文件路径、框架约束和输出目标，结果会更稳定。",
    },
  ];

  // 描述：当未选中代码目录时展示项目接入引导内容。
  const onboardingContent = !selectedWorkspace ? (
    <AriContainer
      className="desk-content desk-code-workspace-onboarding"
      height="100%"
      showBorderRadius={false}
    >
      <AriCard className="desk-code-workspace-onboarding-card">
        <AriTypography variant="h4" value="选择代码项目" />

        {/* 描述：将“项目接入方式”拆分为独立卡片并纵向排列，降低首次接入认知负担。 */}
        <AriContainer className="desk-code-workspace-method-list">
          <AriCard className="desk-code-workspace-method-card">
            <AriFlex
              justify="flex-start"
              align="center"
              className="desk-code-workspace-method-row"
              flexItem={[{ index: 0, flex: 1, overflow: "visible" }]}
            >
              <AriContainer className="desk-code-workspace-method-main">
                <AriTypography variant="body" value="本地文件夹" />
              </AriContainer>
              <AriFlex
                vertical
                justify="center"
                align="flex-end"
                className="desk-code-workspace-method-action"
              >
                <AriButton
                  color="info"
                  label={folderPickLoading ? "打开中..." : "选择"}
                  disabled={folderPickLoading || gitCloneLoading}
                  onClick={() => {
                    void handlePickLocalFolder();
                  }}
                />
              </AriFlex>
            </AriFlex>
          </AriCard>

          <AriCard className="desk-code-workspace-method-card">
            <AriFlex
              justify="flex-start"
              align="center"
              className="desk-code-workspace-method-row"
              flexItem={[{ index: 0, flex: 1, overflow: "visible" }]}
            >
              <AriContainer className="desk-code-workspace-method-main">
                <AriTypography variant="body" value="Git 仓库" />
                <AriInput
                  variant="borderless"
                  value={gitRepoUrl}
                  onChange={setGitRepoUrl}
                  placeholder="输入 Git 地址"
                  className="desk-code-workspace-git-input"
                  enableHoverFocusEffect={false}
                />
              </AriContainer>
              <AriFlex
                vertical
                justify="center"
                align="flex-end"
                className="desk-code-workspace-method-action"
              >
                <AriButton
                  color="info"
                  label={gitCloneLoading ? "开启中..." : "开启"}
                  disabled={gitCloneLoading || folderPickLoading}
                  onClick={() => {
                    void handleCloneGitRepository();
                  }}
                />
              </AriFlex>
            </AriFlex>
          </AriCard>
        </AriContainer>

        <AriTypography
          className="desk-prompt-status"
          variant="caption"
          value={status || ""}
        />
      </AriCard>

      <AriModal
        visible={gitInstallModalVisible}
        title="未检测到 Git"
        onClose={() => {
          setGitInstallModalVisible(false);
        }}
        footer={
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              label="取消"
              onClick={() => {
                setGitInstallModalVisible(false);
              }}
            />
            <AriButton
              color="primary"
              label="确认并前往下载"
              onClick={() => {
                void handleOpenGitDownload();
              }}
            />
          </AriFlex>
        }
      >
        <AriTypography
          variant="body"
          value={gitInstallMessage || "未检测到 Git，请先安装后再继续。"}
        />
      </AriModal>
    </AriContainer>
  ) : undefined;

  // 描述：当已选中代码目录时展示当前项目信息与切换入口。
  const guideContent = selectedWorkspace ? (
    <AriCard className="desk-agent-guide-card">
      <AriTypography variant="h4" value="当前项目" />
      <AriTypography variant="caption" value={selectedWorkspace.path} />
      <AriContainer className="desk-inline-gap" />
      <AriFlex align="center" justify="space-between" space={8}>
        <AriTypography variant="caption" value={selectedWorkspace.name} />
        <AriFlex align="center" space={8}>
          <AriButton
            type="default"
            label="项目信息"
            icon="settings"
            onClick={handleOpenProjectSettingsPage}
          />
          <AriButton
            type="default"
            label="切换项目"
            icon="folder"
            onClick={handleOpenWorkspaceSelectionPage}
          />
        </AriFlex>
      </AriFlex>
    </AriCard>
  ) : undefined;

  return (
    <AgentPage
      title="代码智能体"
      description={agent.description}
      prompt={prompt}
      status={status}
      sending={sending}
      canSend={Boolean(selectedWorkspace)}
      promptPlaceholder="输入代码任务，例如：重构登录模块并补上测试"
      agentLayerLabel="Code Agent"
      starterItems={starterItems}
      onPromptChange={setPrompt}
      onStartConversation={handleStartConversation}
      onboardingContent={onboardingContent}
      guideContent={guideContent}
    />
  );
}
