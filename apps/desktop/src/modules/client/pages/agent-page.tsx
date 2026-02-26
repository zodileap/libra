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
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AGENTS,
  bindCodeSessionWorkspace,
  type CodeWorkspaceGroup,
  listCodeWorkspaceGroups,
  setLastUsedCodeWorkspaceId,
  upsertCodeWorkspaceGroup,
  upsertModelProject,
} from "../data";
import { createRuntimeSession } from "../services/backend-api";
import type { AgentKey, LoginUser, ModelMcpCapabilities } from "../types";

interface GitCliHealthResponse {
  available: boolean;
  version: string;
  bin_path: string;
  message: string;
}

interface GitCloneResponse {
  path: string;
  name: string;
  message: string;
}

function normalizeAgentKey(value: string | undefined): AgentKey {
  return value === "model" ? "model" : "code";
}

// 描述：根据用户首条消息生成默认会话标题，避免出现“会话详情”这类无语义标题。
//
// Params:
//
//   - prompt: 用户输入。
//   - fallbackTitle: 兜底标题。
//
// Returns:
//
//   - 截断后的标题。
function buildSessionTitleFromPrompt(prompt: string, fallbackTitle: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return fallbackTitle;
  }
  if (normalized.length <= 24) {
    return normalized;
  }
  return `${normalized.slice(0, 24)}...`;
}

interface AgentPageProps {
  modelMcpCapabilities: ModelMcpCapabilities;
  currentUser: LoginUser | null;
}

export function AgentPage({ modelMcpCapabilities: _modelMcpCapabilities, currentUser }: AgentPageProps) {
  const params = useParams<{ agentKey: string }>();
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
  const agentKey = normalizeAgentKey(params.agentKey);
  const isCodeAgent = agentKey === "code";

  const agent = useMemo(
    () => AGENTS.find((item) => item.key === agentKey) || AGENTS[0],
    [agentKey],
  );

  // 描述：刷新代码目录分组列表，供代码智能体选择会话目录。
  const refreshWorkspaceGroups = () => {
    if (!isCodeAgent) {
      setWorkspaceGroups([]);
      return;
    }
    setWorkspaceGroups(listCodeWorkspaceGroups());
  };

  useEffect(() => {
    refreshWorkspaceGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);

  const selectedWorkspaceIdFromQuery = useMemo(
    () => searchParams.get("workspaceId")?.trim() || "",
    [searchParams],
  );

  const selectedWorkspace = useMemo(() => {
    if (!isCodeAgent) {
      return null;
    }
    if (!selectedWorkspaceIdFromQuery) {
      return null;
    }
    return workspaceGroups.find((item) => item.id === selectedWorkspaceIdFromQuery) || null;
  }, [isCodeAgent, selectedWorkspaceIdFromQuery, workspaceGroups]);

  useEffect(() => {
    if (!isCodeAgent) {
      return;
    }
    if (!selectedWorkspace?.id) {
      return;
    }
    setLastUsedCodeWorkspaceId(selectedWorkspace.id);
  }, [isCodeAgent, selectedWorkspace?.id]);

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
    return created;
  };

  // 描述：回到代码项目选择页，保持“选择项目”和“开始会话”两个页面职责分离。
  const handleOpenWorkspaceSelectionPage = () => {
    setStatus("");
    setSearchParams(new URLSearchParams(), { replace: true });
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
    if (isCodeAgent && !selectedWorkspace) {
      setStatus("请先选择至少一个代码目录后再开始对话。");
      return;
    }

    setStatus("正在创建会话...");
    setSending(true);

    try {
      const session = await createRuntimeSession(currentUser.id, agentKey);
      if (!session.id) {
        setStatus("创建会话失败，请稍后重试。");
        return;
      }

      if (isCodeAgent && selectedWorkspace) {
        bindCodeSessionWorkspace(session.id, selectedWorkspace.id);
        setLastUsedCodeWorkspaceId(selectedWorkspace.id);
      }

      if (!isCodeAgent) {
        const updatedAt = new Date().toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        upsertModelProject({
          id: session.id,
          title: buildSessionTitleFromPrompt(normalizedPrompt, "新建模型项目"),
          prompt: normalizedPrompt,
          updatedAt,
        });
      }

      const search = isCodeAgent && selectedWorkspace
        ? `?workspaceId=${encodeURIComponent(selectedWorkspace.id)}`
        : "";
      navigate(`/agents/${agentKey}/session/${session.id}${search}`, {
        state: {
          autoPrompt: normalizedPrompt,
          workspaceId: selectedWorkspace?.id || "",
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

  const starterItems = isCodeAgent
    ? [
      {
        title: "快速开始",
        description: "在当前目录中重构某个模块，并补上单元测试。",
      },
      {
        title: "上下文约束",
        description: "告诉智能体文件路径、框架约束和输出目标，结果会更稳定。",
      },
    ]
    : [
      {
        title: "快速开始",
        description: "打开 Blender，创建一个立方体并应用指定贴图。",
      },
      {
        title: "上下文约束",
        description: "描述对象、材质、导出要求，模型智能体会按步骤执行。",
      },
    ];

  if (isCodeAgent && !selectedWorkspace) {
    return (
      <AriContainer className="desk-content desk-code-workspace-onboarding" height="100%">
        <AriCard className="desk-code-workspace-onboarding-card">
          <AriTypography variant="h3" value="选择代码项目" />
          <AriTypography
            variant="caption"
            value="请选择本地文件夹，或输入 Git 仓库地址创建项目。"
          />

          <AriContainer className="desk-inline-gap" />

          <AriButton
            color="primary"
            icon="folder"
            label={folderPickLoading ? "打开中..." : "选择本地文件夹"}
            disabled={folderPickLoading || gitCloneLoading}
            onClick={() => {
              void handlePickLocalFolder();
            }}
          />

          <AriContainer className="desk-inline-gap" />

          <AriInput
            variant="borderless"
            value={gitRepoUrl}
            onChange={setGitRepoUrl}
            placeholder="输入 Git 仓库地址，例如：https://github.com/user/repo.git"
          />
          <AriFlex justify="flex-end" align="center" className="desk-prompt-toolbar">
            <AriButton
              label={gitCloneLoading ? "开启中..." : "开启这个项目"}
              disabled={gitCloneLoading || folderPickLoading}
              onClick={() => {
                void handleCloneGitRepository();
              }}
            />
          </AriFlex>

          <AriTypography className="desk-prompt-status" variant="caption" value={status || ""} />
        </AriCard>

        <AriModal
          visible={gitInstallModalVisible}
          title="未检测到 Git"
          onClose={() => {
            setGitInstallModalVisible(false);
          }}
          footer={(
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
          )}
        >
          <AriTypography variant="body" value={gitInstallMessage || "未检测到 Git，请先安装后再继续。"} />
        </AriModal>
      </AriContainer>
    );
  }

  return (
    <AriContainer className="desk-content desk-session-content" height="100%">
      <AriContainer className="desk-session-shell">
        <AriContainer className="desk-session-head">
          <AriTypography variant="h1" value={isCodeAgent ? "代码智能体" : "模型智能体"} />
          <AriTypography variant="caption" value={agent.description} />
        </AriContainer>

        <AriContainer className="desk-session-thread-wrap">
          <AriContainer className="desk-thread desk-agent-starter-thread">
            {isCodeAgent ? (
              <AriCard className="desk-agent-guide-card">
                <AriTypography variant="h4" value="当前项目" />
                <AriTypography variant="caption" value={selectedWorkspace.path} />
                <AriContainer className="desk-inline-gap" />
                <AriFlex align="center" justify="space-between" space={8}>
                  <AriTypography variant="caption" value={selectedWorkspace.name} />
                  <AriButton
                    type="default"
                    label="切换项目"
                    icon="folder"
                    onClick={handleOpenWorkspaceSelectionPage}
                  />
                </AriFlex>
              </AriCard>
            ) : null}

            <AriContainer className="desk-two-cols">
              {starterItems.map((item) => (
                <AriCard key={item.title}>
                  <AriTypography variant="h4" value={item.title} />
                  <AriTypography variant="caption" value={item.description} />
                </AriCard>
              ))}
            </AriContainer>
          </AriContainer>
        </AriContainer>

        <AriContainer className="desk-prompt-dock">
          {/* 描述：将智能体标签拆分为独立叠层卡片，视觉上置于输入卡片下层。 */}
          <AriContainer className="desk-prompt-stack">
            <AriCard className="desk-prompt-agent-layer-card">
              <AriTypography variant="caption" value={isCodeAgent ? "Code Agent" : "Model Agent"} />
            </AriCard>
            <AriCard className="desk-prompt-card desk-session-prompt-card">
              <AriInput.TextArea
                className="desk-session-prompt-input"
                value={prompt}
                onChange={setPrompt}
                variant="borderless"
                rows={3}
                autoSize={{ minRows: 3, maxRows: 10 }}
                placeholder={isCodeAgent
                  ? "输入代码任务，例如：重构登录模块并补上测试"
                  : "输入模型任务，例如：打开 Blender 后创建立方体并贴图"}
              />
              <AriTypography className="desk-prompt-status" variant="caption" value={status || ""} />
              <AriFlex justify="flex-end" align="center" className="desk-prompt-toolbar">
                <AriButton
                  type="default"
                  color="brand"
                  shape="round"
                  icon={sending ? "hourglass_top" : "arrow_upward"}
                  className="desk-prompt-icon-btn"
                  onClick={() => {
                    void handleStartConversation();
                  }}
                  disabled={sending || (isCodeAgent && !selectedWorkspace)}
                />
              </AriFlex>
            </AriCard>
          </AriContainer>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
