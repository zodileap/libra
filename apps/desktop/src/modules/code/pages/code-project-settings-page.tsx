import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { AriContainer, AriInput, AriTypography } from "aries_react";
import { getCodeWorkspaceGroupById, updateCodeWorkspaceGroupSettings } from "../../../shared/data";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskSectionTitle, DeskSettingsRow } from "../../../widgets/settings-primitives";

// 描述：
//
//   - 渲染代码项目设置页面，承载项目名称与依赖限制维护。
export function CodeProjectSettingsPage() {
  const [searchParams] = useSearchParams();
  const headerSlotElement = useDesktopHeaderSlot();
  const [name, setName] = useState("");
  const [dependencyRules, setDependencyRules] = useState<string[]>([]);
  const skipAutoSaveRef = useRef(true);

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
  }, [workspaceId]);

  // 描述：
  //
  //   - 当目标项目切换时重置表单状态，保持 UI 与当前项目一致。
  useEffect(() => {
    skipAutoSaveRef.current = true;
    setName(workspace?.name || "");
    setDependencyRules(workspace?.dependencyRules || []);
  }, [workspace?.id, workspace?.name, workspace?.dependencyRules]);

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
                itemPlaceholder="包名@版本"
                addText="新增规范"
                allowDrag={false}
                allowEmpty={false}
                minWidth={360}
              />
            </AriContainer>
          </AriContainer>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
