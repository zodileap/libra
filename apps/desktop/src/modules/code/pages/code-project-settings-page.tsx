import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { AriButton, AriContainer, AriInput, AriTypography } from "aries_react";
import {
  bootstrapCodeWorkspaceProjectProfile,
  CODE_WORKSPACE_GROUPS_UPDATED_EVENT,
  CODE_WORKSPACE_PROFILE_UPDATED_EVENT,
  getCodeWorkspaceGroupById,
  getCodeWorkspaceProjectProfile,
  saveCodeWorkspaceProjectProfile,
  updateCodeWorkspaceGroupSettings,
  type CodeWorkspaceProjectApiSpec,
  type CodeWorkspaceProjectArchitecture,
  type CodeWorkspaceProjectProfile,
  type CodeWorkspaceProjectTechStacks,
  type CodeWorkspaceProjectUiSpec,
} from "../../../shared/data";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskSectionTitle, DeskSettingsRow } from "../../../widgets/settings-primitives";

// 描述：
//
//   - 定义项目结构化信息编辑草稿，保证设置页可在不丢字段的前提下自动保存。
interface ProjectProfileDraft {
  summary: string;
  techStacks: CodeWorkspaceProjectTechStacks;
  architecture: CodeWorkspaceProjectArchitecture;
  uiSpec: CodeWorkspaceProjectUiSpec;
  apiSpec: CodeWorkspaceProjectApiSpec;
  domainRules: string[];
  codingConventions: string[];
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
    techStacks: {
      frontend: [],
      backend: [],
      database: [],
      infrastructure: [],
    },
    architecture: {
      modules: [],
      boundaries: [],
      constraints: [],
    },
    uiSpec: {
      pages: [],
      layoutPrinciples: [],
      interactionPrinciples: [],
    },
    apiSpec: {
      services: [],
      contracts: [],
      errorConventions: [],
    },
    domainRules: [],
    codingConventions: [],
  };
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
    techStacks: {
      frontend: [...(profile.techStacks.frontend || [])],
      backend: [...(profile.techStacks.backend || [])],
      database: [...(profile.techStacks.database || [])],
      infrastructure: [...(profile.techStacks.infrastructure || [])],
    },
    architecture: {
      modules: [...(profile.architecture.modules || [])],
      boundaries: [...(profile.architecture.boundaries || [])],
      constraints: [...(profile.architecture.constraints || [])],
    },
    uiSpec: {
      pages: [...(profile.uiSpec.pages || [])],
      layoutPrinciples: [...(profile.uiSpec.layoutPrinciples || [])],
      interactionPrinciples: [...(profile.uiSpec.interactionPrinciples || [])],
    },
    apiSpec: {
      services: [...(profile.apiSpec.services || [])],
      contracts: [...(profile.apiSpec.contracts || [])],
      errorConventions: [...(profile.apiSpec.errorConventions || [])],
    },
    domainRules: [...(profile.domainRules || [])],
    codingConventions: [...(profile.codingConventions || [])],
  };
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
    setProjectProfileDraft(toProjectProfileDraft(profile));
    setProfileSyncStatus(profile ? `结构化信息已加载（v${profile.revision}）` : "结构化信息初始化失败");
  }, [workspaceId, workspace]);

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
        projectProfileDraft,
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
      setProfileSyncStatus(`结构化信息已同步（v${latest.revision}）`);
    };

    window.addEventListener(CODE_WORKSPACE_PROFILE_UPDATED_EVENT, onProfileUpdated as EventListener);
    return () => {
      window.removeEventListener(CODE_WORKSPACE_PROFILE_UPDATED_EVENT, onProfileUpdated as EventListener);
    };
  }, [workspaceId]);

  // 描述：
  //
  //   - 更新结构化信息中的技术栈列表字段。
  const handleUpdateTechStack = (
    key: keyof CodeWorkspaceProjectTechStacks,
    value: string[],
  ) => {
    setProjectProfileDraft((current) => ({
      ...current,
      techStacks: {
        ...current.techStacks,
        [key]: value,
      },
    }));
  };

  // 描述：
  //
  //   - 更新结构化信息中的架构字段。
  const handleUpdateArchitecture = (
    key: keyof CodeWorkspaceProjectArchitecture,
    value: string[],
  ) => {
    setProjectProfileDraft((current) => ({
      ...current,
      architecture: {
        ...current.architecture,
        [key]: value,
      },
    }));
  };

  // 描述：
  //
  //   - 更新结构化信息中的 UI 语义字段。
  const handleUpdateUiSpec = (
    key: keyof CodeWorkspaceProjectUiSpec,
    value: string[],
  ) => {
    setProjectProfileDraft((current) => ({
      ...current,
      uiSpec: {
        ...current.uiSpec,
        [key]: value,
      },
    }));
  };

  // 描述：
  //
  //   - 更新结构化信息中的 API 语义字段。
  const handleUpdateApiSpec = (
    key: keyof CodeWorkspaceProjectApiSpec,
    value: string[],
  ) => {
    setProjectProfileDraft((current) => ({
      ...current,
      apiSpec: {
        ...current.apiSpec,
        [key]: value,
      },
    }));
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
    setProfileSyncStatus(`结构化信息已重建（v${nextProfile.revision}）`);
    setRegeneratingProfile(false);
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

            <DeskSettingsRow title="前端技术栈">
              <AriInput.TextList
                value={projectProfileDraft.techStacks.frontend}
                onChange={(value: string[]) => {
                  handleUpdateTechStack("frontend", value);
                }}
                itemPlaceholder="react"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

            <DeskSettingsRow title="后端技术栈">
              <AriInput.TextList
                value={projectProfileDraft.techStacks.backend}
                onChange={(value: string[]) => {
                  handleUpdateTechStack("backend", value);
                }}
                itemPlaceholder="go"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

            <DeskSettingsRow title="数据库技术栈">
              <AriInput.TextList
                value={projectProfileDraft.techStacks.database}
                onChange={(value: string[]) => {
                  handleUpdateTechStack("database", value);
                }}
                itemPlaceholder="postgres"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

            <DeskSettingsRow title="基础设施技术栈">
              <AriInput.TextList
                value={projectProfileDraft.techStacks.infrastructure}
                onChange={(value: string[]) => {
                  handleUpdateTechStack("infrastructure", value);
                }}
                itemPlaceholder="docker"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

            <DeskSettingsRow title="模块边界">
              <AriInput.TextList
                value={projectProfileDraft.architecture.modules}
                onChange={(value: string[]) => {
                  handleUpdateArchitecture("modules", value);
                }}
                itemPlaceholder="用户模块"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

            <DeskSettingsRow title="架构约束">
              <AriInput.TextList
                value={projectProfileDraft.architecture.constraints}
                onChange={(value: string[]) => {
                  handleUpdateArchitecture("constraints", value);
                }}
                itemPlaceholder="UI 与业务逻辑分层"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

            <DeskSettingsRow title="页面结构语义">
              <AriInput.TextList
                value={projectProfileDraft.uiSpec.pages}
                onChange={(value: string[]) => {
                  handleUpdateUiSpec("pages", value);
                }}
                itemPlaceholder="首页 / 列表页 / 详情页"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

            <DeskSettingsRow title="接口与契约">
              <AriInput.TextList
                value={projectProfileDraft.apiSpec.contracts}
                onChange={(value: string[]) => {
                  handleUpdateApiSpec("contracts", value);
                }}
                itemPlaceholder="UserDTO 字段保持兼容"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

            <DeskSettingsRow title="业务规则">
              <AriInput.TextList
                value={projectProfileDraft.domainRules}
                onChange={(value: string[]) => {
                  setProjectProfileDraft((current) => ({
                    ...current,
                    domainRules: value,
                  }));
                }}
                itemPlaceholder="登录失败超过 5 次触发风控"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

            <DeskSettingsRow title="编码约定">
              <AriInput.TextList
                value={projectProfileDraft.codingConventions}
                onChange={(value: string[]) => {
                  setProjectProfileDraft((current) => ({
                    ...current,
                    codingConventions: value,
                  }));
                }}
                itemPlaceholder="新增功能必须补充单测"
                addText="新增"
                allowDrag={false}
                minWidth={360}
              />
            </DeskSettingsRow>

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
