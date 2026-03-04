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
  type CodeWorkspaceProjectApiDataModel,
  type CodeWorkspaceProjectFrontendCodeStructure,
  type CodeWorkspaceProjectFrontendPageLayout,
  type CodeWorkspaceProjectProfile,
} from "../../../shared/data";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskSectionTitle, DeskSettingsRow } from "../../../widgets/settings-primitives";

// 描述：
//
//   - 定义项目结构化信息编辑草稿，保证设置页可在不丢字段的前提下自动保存。
interface ProjectProfileDraft {
  summary: string;
  apiDataModel: CodeWorkspaceProjectApiDataModel;
  frontendPageLayout: CodeWorkspaceProjectFrontendPageLayout;
  frontendCodeStructure: CodeWorkspaceProjectFrontendCodeStructure;
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
    apiDataModel: {
      entities: [],
      requestModels: [],
      responseModels: [],
      mockCases: [],
    },
    frontendPageLayout: {
      pages: [],
      navigation: [],
      pageElements: [],
    },
    frontendCodeStructure: {
      directories: [],
      moduleBoundaries: [],
      implementationConstraints: [],
    },
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
    apiDataModel: {
      entities: [...(profile.apiDataModel.entities || [])],
      requestModels: [...(profile.apiDataModel.requestModels || [])],
      responseModels: [...(profile.apiDataModel.responseModels || [])],
      mockCases: [...(profile.apiDataModel.mockCases || [])],
    },
    frontendPageLayout: {
      pages: [...(profile.frontendPageLayout.pages || [])],
      navigation: [...(profile.frontendPageLayout.navigation || [])],
      pageElements: [...(profile.frontendPageLayout.pageElements || [])],
    },
    frontendCodeStructure: {
      directories: [...(profile.frontendCodeStructure.directories || [])],
      moduleBoundaries: [...(profile.frontendCodeStructure.moduleBoundaries || [])],
      implementationConstraints: [...(profile.frontendCodeStructure.implementationConstraints || [])],
    },
    codingConventions: [...(profile.codingConventions || [])],
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
    const parsed = JSON.parse(normalizedRawJson) as Partial<ProjectProfileDraft> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        draft: baseDraft,
        message: "JSON 顶层必须是对象结构。",
      };
    }
    const nextDraft: ProjectProfileDraft = {
      summary: parsed.summary === undefined
        ? String(baseDraft.summary || "").trim()
        : String(parsed.summary || "").trim(),
      apiDataModel: {
        entities: parsed.apiDataModel?.entities === undefined
          ? normalizeProfileDraftTextList(baseDraft.apiDataModel.entities)
          : normalizeProfileDraftTextList(parsed.apiDataModel.entities),
        requestModels: parsed.apiDataModel?.requestModels === undefined
          ? normalizeProfileDraftTextList(baseDraft.apiDataModel.requestModels)
          : normalizeProfileDraftTextList(parsed.apiDataModel.requestModels),
        responseModels: parsed.apiDataModel?.responseModels === undefined
          ? normalizeProfileDraftTextList(baseDraft.apiDataModel.responseModels)
          : normalizeProfileDraftTextList(parsed.apiDataModel.responseModels),
        mockCases: parsed.apiDataModel?.mockCases === undefined
          ? normalizeProfileDraftTextList(baseDraft.apiDataModel.mockCases)
          : normalizeProfileDraftTextList(parsed.apiDataModel.mockCases),
      },
      frontendPageLayout: {
        pages: parsed.frontendPageLayout?.pages === undefined
          ? normalizeProfileDraftTextList(baseDraft.frontendPageLayout.pages)
          : normalizeProfileDraftTextList(parsed.frontendPageLayout.pages),
        navigation: parsed.frontendPageLayout?.navigation === undefined
          ? normalizeProfileDraftTextList(baseDraft.frontendPageLayout.navigation)
          : normalizeProfileDraftTextList(parsed.frontendPageLayout.navigation),
        pageElements: parsed.frontendPageLayout?.pageElements === undefined
          ? normalizeProfileDraftTextList(baseDraft.frontendPageLayout.pageElements)
          : normalizeProfileDraftTextList(parsed.frontendPageLayout.pageElements),
      },
      frontendCodeStructure: {
        directories: parsed.frontendCodeStructure?.directories === undefined
          ? normalizeProfileDraftTextList(baseDraft.frontendCodeStructure.directories)
          : normalizeProfileDraftTextList(parsed.frontendCodeStructure.directories),
        moduleBoundaries: parsed.frontendCodeStructure?.moduleBoundaries === undefined
          ? normalizeProfileDraftTextList(baseDraft.frontendCodeStructure.moduleBoundaries)
          : normalizeProfileDraftTextList(parsed.frontendCodeStructure.moduleBoundaries),
        implementationConstraints: parsed.frontendCodeStructure?.implementationConstraints === undefined
          ? normalizeProfileDraftTextList(baseDraft.frontendCodeStructure.implementationConstraints)
          : normalizeProfileDraftTextList(parsed.frontendCodeStructure.implementationConstraints),
      },
      codingConventions: parsed.codingConventions === undefined
        ? normalizeProfileDraftTextList(baseDraft.codingConventions)
        : normalizeProfileDraftTextList(parsed.codingConventions),
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
  //   - 更新结构化信息中的 API 数据模型字段。
  const handleUpdateApiDataModel = (
    key: keyof CodeWorkspaceProjectApiDataModel,
    value: string[],
  ) => {
    setProjectProfileDraft((current) => ({
      ...current,
      apiDataModel: {
        ...current.apiDataModel,
        [key]: value,
      },
    }));
  };

  // 描述：
  //
  //   - 更新结构化信息中的前端页面布局字段。
  const handleUpdateFrontendPageLayout = (
    key: keyof CodeWorkspaceProjectFrontendPageLayout,
    value: string[],
  ) => {
    setProjectProfileDraft((current) => ({
      ...current,
      frontendPageLayout: {
        ...current.frontendPageLayout,
        [key]: value,
      },
    }));
  };

  // 描述：
  //
  //   - 更新结构化信息中的前端代码结构字段。
  const handleUpdateFrontendCodeStructure = (
    key: keyof CodeWorkspaceProjectFrontendCodeStructure,
    value: string[],
  ) => {
    setProjectProfileDraft((current) => ({
      ...current,
      frontendCodeStructure: {
        ...current.frontendCodeStructure,
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

                <DeskSettingsRow title="API 数据实体">
                  <AriInput.TextList
                    value={projectProfileDraft.apiDataModel.entities}
                    onChange={(value: string[]) => {
                      handleUpdateApiDataModel("entities", value);
                    }}
                    itemPlaceholder="User: id, name, role"
                    addText="新增"
                    allowDrag={false}
                    minWidth={360}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title="API 请求模型">
                  <AriInput.TextList
                    value={projectProfileDraft.apiDataModel.requestModels}
                    onChange={(value: string[]) => {
                      handleUpdateApiDataModel("requestModels", value);
                    }}
                    itemPlaceholder="CreateUserRequest: name, role"
                    addText="新增"
                    allowDrag={false}
                    minWidth={360}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title="API 响应模型">
                  <AriInput.TextList
                    value={projectProfileDraft.apiDataModel.responseModels}
                    onChange={(value: string[]) => {
                      handleUpdateApiDataModel("responseModels", value);
                    }}
                    itemPlaceholder="UserResponse: id, name, role"
                    addText="新增"
                    allowDrag={false}
                    minWidth={360}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title="API Mock 场景">
                  <AriInput.TextList
                    value={projectProfileDraft.apiDataModel.mockCases}
                    onChange={(value: string[]) => {
                      handleUpdateApiDataModel("mockCases", value);
                    }}
                    itemPlaceholder="/users/list 成功/空数据/鉴权失败"
                    addText="新增"
                    allowDrag={false}
                    minWidth={360}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title="前端页面清单">
                  <AriInput.TextList
                    value={projectProfileDraft.frontendPageLayout.pages}
                    onChange={(value: string[]) => {
                      handleUpdateFrontendPageLayout("pages", value);
                    }}
                    itemPlaceholder="用户管理页 / 用户详情页"
                    addText="新增"
                    allowDrag={false}
                    minWidth={360}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title="导航与菜单项">
                  <AriInput.TextList
                    value={projectProfileDraft.frontendPageLayout.navigation}
                    onChange={(value: string[]) => {
                      handleUpdateFrontendPageLayout("navigation", value);
                    }}
                    itemPlaceholder="侧边栏：仪表盘 / 用户管理 / 系统设置"
                    addText="新增"
                    allowDrag={false}
                    minWidth={360}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title="页面元素结构">
                  <AriInput.TextList
                    value={projectProfileDraft.frontendPageLayout.pageElements}
                    onChange={(value: string[]) => {
                      handleUpdateFrontendPageLayout("pageElements", value);
                    }}
                    itemPlaceholder="用户管理页：筛选栏 / 数据表格 / 分页器"
                    addText="新增"
                    allowDrag={false}
                    minWidth={360}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title="前端目录结构">
                  <AriInput.TextList
                    value={projectProfileDraft.frontendCodeStructure.directories}
                    onChange={(value: string[]) => {
                      handleUpdateFrontendCodeStructure("directories", value);
                    }}
                    itemPlaceholder="src/modules/user / src/components/common"
                    addText="新增"
                    allowDrag={false}
                    minWidth={360}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title="前端模块边界">
                  <AriInput.TextList
                    value={projectProfileDraft.frontendCodeStructure.moduleBoundaries}
                    onChange={(value: string[]) => {
                      handleUpdateFrontendCodeStructure("moduleBoundaries", value);
                    }}
                    itemPlaceholder="页面层只编排，不直接写请求细节"
                    addText="新增"
                    allowDrag={false}
                    minWidth={360}
                  />
                </DeskSettingsRow>

                <DeskSettingsRow title="前端实现约束">
                  <AriInput.TextList
                    value={projectProfileDraft.frontendCodeStructure.implementationConstraints}
                    onChange={(value: string[]) => {
                      handleUpdateFrontendCodeStructure("implementationConstraints", value);
                    }}
                    itemPlaceholder="路由定义统一维护在 src/routes.ts"
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
