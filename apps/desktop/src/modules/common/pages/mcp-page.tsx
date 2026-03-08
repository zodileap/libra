import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriForm,
  AriFormItem,
  AriIcon,
  AriInput,
  AriMessage,
  AriModal,
  AriSelect,
  AriSwitch,
  AriTag,
  AriTypography,
} from "aries_react";
import type {
  McpOverview,
  McpRegistrationDraft,
  McpRegistrationItem,
  McpTemplateItem,
} from "../services";
import {
  type McpScope,
  installApifoxMcpRuntime,
  listMcpOverview,
  readApifoxMcpRuntimeStatus,
  removeMcpRegistration,
  saveMcpRegistration,
  uninstallApifoxMcpRuntime,
  validateMcpRegistration,
} from "../services";
import { getProjectWorkspaceGroupById, listProjectWorkspaceGroups } from "../../../shared/data";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskSectionTitle } from "../../../widgets/settings-primitives";

// 描述：
//
//   - MCP 总览默认状态，避免首屏渲染时出现未定义访问。
const DEFAULT_MCP_OVERVIEW: McpOverview = {
  registered: [],
  templates: [],
};

// 描述：
//
//   - 编辑器默认草稿；新建时以该对象为基线，避免缺少字段导致表单受控状态异常。
const DEFAULT_MCP_DRAFT: McpRegistrationDraft = {
  id: "",
  templateId: "",
  name: "",
  description: "",
  transport: "stdio",
  scope: "user",
  enabled: true,
  command: "",
  args: [],
  env: {},
  cwd: "",
  url: "",
  headers: {},
  docsUrl: "",
  officialProvider: "",
  runtimeKind: "",
};

// 描述：
//
//   - Apifox Runtime 状态结构；页面只消费最小字段，不直接暴露后端协议细节。
interface ApifoxRuntimeStatus {
  installed: boolean;
  version: string;
  entryPath: string;
  message: string;
}

// 描述：
//
//   - 将键值映射格式化为多行文本，供表单中的 TextArea 编辑。
//
// Params:
//
//   - source: 键值映射。
//
// Returns:
//
//   - `KEY=value` 多行文本。
function stringifyRecordEntries(source: Record<string, string>): string {
  return Object.entries(source)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

// 描述：
//
//   - 将多行 `KEY=value` 文本解析为键值映射，自动忽略非法和空行。
//
// Params:
//
//   - source: 原始文本。
//
// Returns:
//
//   - 解析后的键值映射。
function parseRecordEntries(source: string): Record<string, string> {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes("="))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key.trim(), rest.join("=").trim()] as const;
      })
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}

// 描述：
//
//   - 将多行参数文本解析为字符串数组，适合命令行参数输入场景。
//
// Params:
//
//   - source: 原始多行文本。
//
// Returns:
//
//   - 参数数组。
function parseArgsText(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// 描述：
//
//   - 将注册项转换为编辑草稿，便于“编辑 / 启用切换”统一复用保存接口。
//
// Params:
//
//   - item: 已注册的 MCP 项。
//
// Returns:
//
//   - 编辑草稿。
function buildDraftFromRegistration(item: McpRegistrationItem): McpRegistrationDraft {
  return {
    id: item.id,
    templateId: item.templateId,
    name: item.name,
    description: item.description,
    transport: item.transport,
    scope: item.scope,
    enabled: item.enabled,
    command: item.command,
    args: item.args,
    env: item.env,
    cwd: item.cwd,
    url: item.url,
    headers: item.headers,
    docsUrl: item.docsUrl,
    officialProvider: item.officialProvider,
    runtimeKind: item.runtimeKind,
  };
}

// 描述：
//
//   - 将模板转换为新增草稿；模板用于预填，不直接代表已注册项。
//
// Params:
//
//   - item: MCP 模板。
//
// Returns:
//
//   - 新增草稿。
function buildDraftFromTemplate(item: McpTemplateItem): McpRegistrationDraft {
  return {
    ...DEFAULT_MCP_DRAFT,
    templateId: item.id,
    name: item.name,
    description: item.description,
    transport: item.transport,
    command: item.command,
    args: item.args,
    env: item.env,
    cwd: item.cwd,
    url: item.url,
    headers: item.headers,
    docsUrl: item.docsUrl,
    officialProvider: item.officialProvider,
    runtimeKind: item.runtimeKind,
  };
}

// 描述：
//
//   - 渲染 MCP 传输类型标签，帮助用户快速识别当前注册项的连接方式。
//
// Params:
//
//   - transport: MCP 传输类型。
//
// Returns:
//
//   - 标签文案。
function renderTransportLabel(transport: string): string {
  return transport === "http" ? "HTTP" : "STDIO";
}

// 描述：
//
//   - 渲染 MCP 作用域标签，帮助用户快速识别配置是全局生效还是仅覆盖当前项目。
//
// Params:
//
//   - scope: MCP 作用域。
//
// Returns:
//
//   - 标签文案。
function renderScopeLabel(scope: McpScope): string {
  return scope === "workspace" ? "Workspace" : "User";
}

// 描述：
//
//   - 渲染已注册 MCP 卡片，统一承载启用、编辑、校验和删除交互。
function RegisteredMcpCard({
  item,
  busy,
  apifoxRuntimeStatus,
  onToggleEnabled,
  onEdit,
  onValidate,
  onRemove,
}: {
  item: McpRegistrationItem;
  busy: boolean;
  apifoxRuntimeStatus: ApifoxRuntimeStatus | null;
  onToggleEnabled: (item: McpRegistrationItem, enabled: boolean) => void;
  onEdit: (item: McpRegistrationItem) => void;
  onValidate: (item: McpRegistrationItem) => void;
  onRemove: (item: McpRegistrationItem) => void;
}) {
  return (
    <AriCard className="desk-skill-card">
      <AriFlex className="desk-skill-card-main" align="center" justify="space-between" space={12}>
        <AriFlex className="desk-skill-card-info" align="center" space={12}>
          <AriContainer className="desk-skill-card-icon-wrap" padding={0}>
            <AriIcon name={item.transport === "http" ? "language" : "terminal"} />
          </AriContainer>
          <AriContainer padding={0}>
            <AriFlex align="center" space={8}>
              <AriTypography variant="h4" value={item.name} />
              <AriTag bordered size="sm" color="var(--z-color-text-brand)">
                {renderTransportLabel(item.transport)}
              </AriTag>
              <AriTag bordered size="sm">
                {renderScopeLabel(item.scope)}
              </AriTag>
              {!item.enabled ? <AriTag bordered size="sm">已停用</AriTag> : null}
            </AriFlex>
            <AriTypography variant="caption" value={item.description || "未填写 MCP 描述"} />
            {item.officialProvider ? (
              <AriTypography variant="caption" value={`提供方：${item.officialProvider}`} />
            ) : null}
            {item.transport === "stdio" ? (
              <AriTypography
                variant="caption"
                value={item.runtimeKind === "apifox_runtime"
                  ? `Runtime：${apifoxRuntimeStatus?.installed ? "已安装" : "未安装"}`
                  : `命令：${item.command || "未填写"}`}
              />
            ) : (
              <AriTypography variant="caption" value={`地址：${item.url || "未填写"}`} />
            )}
            {item.docsUrl ? <AriTypography variant="caption" value={`文档：${item.docsUrl}`} /> : null}
          </AriContainer>
        </AriFlex>
        <AriFlex align="center" space={8}>
          <AriSwitch
            checked={item.enabled}
            disabled={busy}
            onChange={(checked: boolean) => onToggleEnabled(item, checked)}
          />
          <AriButton ghost icon="check_circle" label="校验" disabled={busy} onClick={() => onValidate(item)} />
          <AriButton ghost icon="edit" label="编辑" disabled={busy} onClick={() => onEdit(item)} />
          {item.removable ? (
            <AriButton color="danger" ghost icon="delete" label="移除" disabled={busy} onClick={() => onRemove(item)} />
          ) : null}
        </AriFlex>
      </AriFlex>
    </AriCard>
  );
}

// 描述：
//
//   - 渲染 MCP 模板卡片，统一承载“从模板新增”和 Apifox Runtime 安装操作。
function McpTemplateCard({
  item,
  busy,
  alreadyRegistered,
  apifoxRuntimeStatus,
  runtimeBusy,
  onCreate,
  onInstallApifoxRuntime,
  onUninstallApifoxRuntime,
}: {
  item: McpTemplateItem;
  busy: boolean;
  alreadyRegistered: boolean;
  apifoxRuntimeStatus: ApifoxRuntimeStatus | null;
  runtimeBusy: boolean;
  onCreate: (item: McpTemplateItem) => void;
  onInstallApifoxRuntime: () => void;
  onUninstallApifoxRuntime: () => void;
}) {
  const isApifoxTemplate = item.runtimeKind === "apifox_runtime";
  const runtimeInstalled = Boolean(apifoxRuntimeStatus?.installed);
  return (
    <AriCard className="desk-skill-card">
      <AriFlex className="desk-skill-card-main" align="center" justify="space-between" space={12}>
        <AriFlex className="desk-skill-card-info" align="center" space={12}>
          <AriContainer className="desk-skill-card-icon-wrap" padding={0}>
            <AriIcon name={item.transport === "http" ? "language" : "inventory_2"} />
          </AriContainer>
          <AriContainer padding={0}>
            <AriFlex align="center" space={8}>
              <AriTypography variant="h4" value={item.name} />
              <AriTag bordered size="sm" color="var(--z-color-text-brand)">
                {renderTransportLabel(item.transport)}
              </AriTag>
            </AriFlex>
            <AriTypography variant="caption" value={item.description || "未填写模板描述"} />
            {item.officialProvider ? (
              <AriTypography variant="caption" value={`提供方：${item.officialProvider}`} />
            ) : null}
            {isApifoxTemplate ? (
              <AriTypography
                variant="caption"
                value={`Runtime：${runtimeInstalled ? "已安装" : "未安装"}${apifoxRuntimeStatus?.version ? `（${apifoxRuntimeStatus.version}）` : ""}`}
              />
            ) : item.transport === "http" ? (
              <AriTypography variant="caption" value={`示例地址：${item.url || "无"}`} />
            ) : (
              <AriTypography variant="caption" value="按需填写命令、参数和环境变量。" />
            )}
            {item.docsUrl ? <AriTypography variant="caption" value={`文档：${item.docsUrl}`} /> : null}
          </AriContainer>
        </AriFlex>
        <AriFlex align="center" space={8}>
          {isApifoxTemplate ? (
            runtimeInstalled ? (
              <AriButton
                ghost
                icon="delete"
                label="卸载 Runtime"
                disabled={runtimeBusy}
                onClick={onUninstallApifoxRuntime}
              />
            ) : (
              <AriButton
                ghost
                icon="download"
                label="安装 Runtime"
                disabled={runtimeBusy}
                onClick={onInstallApifoxRuntime}
              />
            )
          ) : null}
          <AriButton
            color="brand"
            icon="add"
            label={alreadyRegistered ? "已注册" : "新增"}
            disabled={busy || alreadyRegistered}
            onClick={() => onCreate(item)}
          />
        </AriFlex>
      </AriFlex>
    </AriCard>
  );
}

// 描述：
//
//   - 渲染 MCP 管理页，展示真实注册表、推荐模板与 Apifox Runtime 管理入口。
export function McpPage() {
  const headerSlotElement = useDesktopHeaderSlot();
  const location = useLocation();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<McpOverview>(DEFAULT_MCP_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [busyActionId, setBusyActionId] = useState("");
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [apifoxRuntimeStatus, setApifoxRuntimeStatus] = useState<ApifoxRuntimeStatus | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingDraft, setEditingDraft] = useState<McpRegistrationDraft>(DEFAULT_MCP_DRAFT);
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [removingItem, setRemovingItem] = useState<McpRegistrationItem | null>(null);
  const workspaceGroups = useMemo(() => listProjectWorkspaceGroups(), []);
  const workspaceId = useMemo(
    () => new URLSearchParams(location.search).get("workspaceId")?.trim() || "",
    [location.search],
  );
  const activeProjectWorkspace = useMemo(
    () => getProjectWorkspaceGroupById(workspaceId),
    [workspaceId],
  );
  const activeWorkspacePath = String(activeProjectWorkspace?.path || "").trim();
  const mcpRegistryContext = useMemo(
    () => ({ workspaceRoot: activeWorkspacePath || undefined }),
    [activeWorkspacePath],
  );
  const workspaceOptions = useMemo(
    () => [
      { label: "全局（User）", value: "" },
      ...workspaceGroups.map((item) => ({
        label: item.name || item.path,
        value: item.id,
      })),
    ],
    [workspaceGroups],
  );

  // 描述：
  //
  //   - 重新拉取 MCP 总览与 Apifox Runtime 状态，供初始化和所有写操作后复用。
  const reloadOverview = useCallback(async () => {
    const [nextOverview, runtimeStatus] = await Promise.all([
      listMcpOverview(mcpRegistryContext),
      readApifoxMcpRuntimeStatus(),
    ]);
    setOverview(nextOverview);
    setApifoxRuntimeStatus(runtimeStatus
      ? {
        installed: runtimeStatus.installed,
        version: runtimeStatus.version,
        entryPath: runtimeStatus.entry_path,
        message: runtimeStatus.message,
      }
      : null);
  }, []);

  // 描述：
  //
  //   - 页面初始化时读取 MCP 注册表与 Runtime 状态。
  useEffect(() => {
    let disposed = false;
    const loadOverview = async () => {
      setLoading(true);
      try {
        const [nextOverview, runtimeStatus] = await Promise.all([
          listMcpOverview(mcpRegistryContext),
          readApifoxMcpRuntimeStatus(),
        ]);
        if (disposed) {
          return;
        }
        setOverview(nextOverview);
        setApifoxRuntimeStatus(runtimeStatus
          ? {
            installed: runtimeStatus.installed,
            version: runtimeStatus.version,
            entryPath: runtimeStatus.entry_path,
            message: runtimeStatus.message,
          }
          : null);
      } catch (_err) {
        if (!disposed) {
          setOverview(DEFAULT_MCP_OVERVIEW);
          setApifoxRuntimeStatus(null);
          AriMessage.error({
            content: "加载 MCP 注册表失败，请稍后重试。",
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
  }, [mcpRegistryContext]);

  // 描述：
  //
  //   - 记录哪些模板已经生成过注册项，用于模板区禁用“新增”按钮，避免重复创建同类默认项。
  const registeredTemplateIds = useMemo(
    () => new Set(overview.registered.map((item) => item.templateId).filter((item) => item.length > 0)),
    [overview.registered],
  );

  // 描述：
  //
  //   - 打开新增编辑器，并将草稿文本字段同步到表单状态。
  const openEditor = useCallback((draft: McpRegistrationDraft) => {
    setEditingDraft(draft);
    setArgsText((draft.args || []).join("\n"));
    setEnvText(stringifyRecordEntries(draft.env || {}));
    setHeadersText(stringifyRecordEntries(draft.headers || {}));
    setEditorVisible(true);
  }, []);

  // 描述：
  //
  //   - 构造当前表单的最终保存草稿。
  const buildEditorDraft = useCallback((): McpRegistrationDraft => ({
    ...editingDraft,
    args: parseArgsText(argsText),
    env: parseRecordEntries(envText),
    headers: parseRecordEntries(headersText),
  }), [argsText, editingDraft, envText, headersText]);

  // 描述：
  //
  //   - 保存编辑器中的 MCP 草稿，并在保存成功后刷新总览。
  const handleSaveDraft = useCallback(async () => {
    const draft = buildEditorDraft();
    if (!draft.name?.trim()) {
      AriMessage.error({ content: "请填写 MCP 名称。", duration: 1800 });
      return;
    }
    setBusyActionId(draft.id || draft.templateId || "__save__");
    try {
      const saved = await saveMcpRegistration(draft, mcpRegistryContext);
      await reloadOverview();
      AriMessage.success({
        content: draft.id ? `已更新 ${saved.name}` : `已注册 ${saved.name}`,
        duration: 1800,
      });
      setEditorVisible(false);
      setEditingDraft(DEFAULT_MCP_DRAFT);
      setArgsText("");
      setEnvText("");
      setHeadersText("");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || "保存 MCP 失败，请稍后重试。",
        duration: 2200,
      });
    } finally {
      setBusyActionId("");
    }
  }, [buildEditorDraft, reloadOverview]);

  // 描述：
  //
  //   - 更新已注册 MCP 的启用状态，保持启停动作与编辑动作共用同一保存链路。
  const handleToggleEnabled = useCallback(async (item: McpRegistrationItem, enabled: boolean) => {
    setBusyActionId(item.id);
    try {
      await saveMcpRegistration({
        ...buildDraftFromRegistration(item),
        enabled,
      }, mcpRegistryContext);
      await reloadOverview();
      AriMessage.success({
        content: enabled ? `已启用 ${item.name}` : `已停用 ${item.name}`,
        duration: 1800,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || "更新 MCP 状态失败，请稍后重试。",
        duration: 2200,
      });
    } finally {
      setBusyActionId("");
    }
  }, [reloadOverview]);

  // 描述：
  //
  //   - 执行 MCP 基础环境校验，并将结果映射为用户友好消息。
  const handleValidateMcp = useCallback(async (item: McpRegistrationItem) => {
    setBusyActionId(item.id);
    try {
      const validation = await validateMcpRegistration(
        buildDraftFromRegistration(item),
        mcpRegistryContext,
      );
      if (validation.ok) {
        AriMessage.success({
          content: validation.message || `已通过 ${item.name} 校验。`,
          duration: 2200,
        });
      } else {
        AriMessage.error({
          content: validation.message || `${item.name} 校验失败，请检查配置。`,
          duration: 2600,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || "校验 MCP 失败，请稍后重试。",
        duration: 2200,
      });
    } finally {
      setBusyActionId("");
    }
  }, []);

  // 描述：
  //
  //   - 确认删除已注册 MCP，并在删除后刷新总览。
  const handleConfirmRemove = useCallback(async () => {
    if (!removingItem) {
      return;
    }
    setBusyActionId(removingItem.id);
    try {
      await removeMcpRegistration(removingItem.id, removingItem.scope, mcpRegistryContext);
      await reloadOverview();
      AriMessage.success({
        content: `已移除 ${removingItem.name}`,
        duration: 1800,
      });
      setRemovingItem(null);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || "移除 MCP 失败，请稍后重试。",
        duration: 2200,
      });
    } finally {
      setBusyActionId("");
    }
  }, [reloadOverview, removingItem]);

  // 描述：
  //
  //   - 安装 Apifox Runtime，并在完成后刷新 Runtime 状态与总览。
  const handleInstallApifoxRuntime = useCallback(async () => {
    setRuntimeBusy(true);
    try {
      await installApifoxMcpRuntime();
      await reloadOverview();
      AriMessage.success({
        content: "已安装 Apifox Runtime。",
        duration: 1800,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || "安装 Apifox Runtime 失败，请稍后重试。",
        duration: 2200,
      });
    } finally {
      setRuntimeBusy(false);
    }
  }, [reloadOverview]);

  // 描述：
  //
  //   - 卸载 Apifox Runtime，并在完成后刷新 Runtime 状态与总览。
  const handleUninstallApifoxRuntime = useCallback(async () => {
    setRuntimeBusy(true);
    try {
      await uninstallApifoxMcpRuntime();
      await reloadOverview();
      AriMessage.success({
        content: "已卸载 Apifox Runtime。",
        duration: 1800,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || "卸载 Apifox Runtime 失败，请稍后重试。",
        duration: 2200,
      });
    } finally {
      setRuntimeBusy(false);
    }
  }, [reloadOverview]);

  // 描述：
  //
  //   - 生成标题栏内容并挂载到全局头部 slot，保持 Desktop 页面头部一致性。
  const headerNode = useMemo(() => (
    <AriContainer className="desk-project-settings-header" padding={0} data-tauri-drag-region>
      <AriTypography className="desk-project-settings-header-title" variant="h4" value="MCP" />
    </AriContainer>
  ), []);

  // 描述：
  //
  //   - 切换 MCP 页面绑定的项目上下文；当选中具体项目时，页面会展示该项目覆盖 user 级后的最终注册结果。
  const handleWorkspaceSelectionChange = useCallback((value: unknown) => {
    const nextWorkspaceId = String(value || "").trim();
    const nextSearch = new URLSearchParams(location.search);
    if (nextWorkspaceId) {
      nextSearch.set("workspaceId", nextWorkspaceId);
    } else {
      nextSearch.delete("workspaceId");
    }
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch.toString() ? `?${nextSearch.toString()}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  if (loading) {
    return (
      <AriContainer className="desk-content" showBorderRadius={false}>
        {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
        <AriContainer className="desk-settings-shell desk-skills-shell">
          <AriTypography variant="caption" value="MCP 注册表加载中..." />
        </AriContainer>
      </AriContainer>
    );
  }

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <AriModal
        visible={editorVisible}
        title={editingDraft.id ? "编辑 MCP" : "新增 MCP"}
        onClose={() => setEditorVisible(false)}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton label="取消" onClick={() => setEditorVisible(false)} />
            <AriButton color="brand" icon="save" label="保存" onClick={handleSaveDraft} />
          </AriFlex>
        )}
      >
        <AriForm layout="vertical" labelAlign="left" density="compact">
          <AriFormItem label="名称" name="mcp.editor.name">
            <AriInput
              value={editingDraft.name || ""}
              onChange={(value: string) => setEditingDraft((current) => ({ ...current, name: value }))}
              placeholder="请输入 MCP 名称"
            />
          </AriFormItem>
          <AriFormItem label="说明" name="mcp.editor.description">
            <AriInput.TextArea
              value={editingDraft.description || ""}
              onChange={(value: string) => setEditingDraft((current) => ({ ...current, description: value }))}
              placeholder="请输入 MCP 说明"
              rows={3}
            />
          </AriFormItem>
          <AriFormItem label="传输方式" name="mcp.editor.transport">
            <AriSelect
              value={editingDraft.transport}
              options={[
                { label: "Stdio", value: "stdio" },
                { label: "HTTP", value: "http" },
              ]}
              onChange={(value: unknown) => {
                const nextTransport = String(value || "stdio") === "http" ? "http" : "stdio";
                setEditingDraft((current) => ({ ...current, transport: nextTransport }));
              }}
            />
          </AriFormItem>
          <AriFormItem label="作用域" name="mcp.editor.scope">
            <AriSelect
              value={editingDraft.scope || "user"}
              options={[
                { label: "User（全局）", value: "user" },
                ...(activeWorkspacePath
                  ? [{
                    label: `Workspace（${activeProjectWorkspace?.name || "当前项目"}）`,
                    value: "workspace",
                  }]
                  : []),
              ]}
              onChange={(value: unknown) => {
                const nextScope = String(value || "user") === "workspace" ? "workspace" : "user";
                setEditingDraft((current) => ({ ...current, scope: nextScope }));
              }}
            />
          </AriFormItem>
          {editingDraft.transport === "stdio" ? (
            editingDraft.runtimeKind === "apifox_runtime" ? (
              <AriFormItem label="运行方式" name="mcp.editor.runtimeKind">
                <AriTypography
                  variant="caption"
                  value={apifoxRuntimeStatus?.installed
                    ? `Apifox Runtime 已安装：${apifoxRuntimeStatus.entryPath || "应用私有目录"}`
                    : "Apifox Runtime 未安装，请先在模板卡片中安装 Runtime。"}
                />
              </AriFormItem>
            ) : (
              <>
                <AriFormItem label="命令" name="mcp.editor.command">
                  <AriInput
                    value={editingDraft.command || ""}
                    onChange={(value: string) => setEditingDraft((current) => ({ ...current, command: value }))}
                    placeholder="例如：npx、uvx 或可执行文件绝对路径"
                  />
                </AriFormItem>
                <AriFormItem label="参数（每行一个）" name="mcp.editor.args">
                  <AriInput.TextArea
                    value={argsText}
                    onChange={setArgsText}
                    placeholder="例如：-y\napifox-mcp-server@latest"
                    rows={4}
                  />
                </AriFormItem>
                <AriFormItem label="环境变量（KEY=value）" name="mcp.editor.env">
                  <AriInput.TextArea
                    value={envText}
                    onChange={setEnvText}
                    placeholder="例如：API_KEY=xxx"
                    rows={4}
                  />
                </AriFormItem>
                <AriFormItem label="工作目录" name="mcp.editor.cwd">
                  <AriInput
                    value={editingDraft.cwd || ""}
                    onChange={(value: string) => setEditingDraft((current) => ({ ...current, cwd: value }))}
                    placeholder="可选，留空则使用默认目录"
                  />
                </AriFormItem>
              </>
            )
          ) : (
            <>
              <AriFormItem label="地址" name="mcp.editor.url">
                <AriInput
                  value={editingDraft.url || ""}
                  onChange={(value: string) => setEditingDraft((current) => ({ ...current, url: value }))}
                  placeholder="请输入 http:// 或 https:// 地址"
                />
              </AriFormItem>
              <AriFormItem label="请求头（KEY=value）" name="mcp.editor.headers">
                <AriInput.TextArea
                  value={headersText}
                  onChange={setHeadersText}
                  placeholder="例如：Authorization=Bearer xxx"
                  rows={4}
                />
              </AriFormItem>
            </>
          )}
          <AriFormItem label="文档地址" name="mcp.editor.docsUrl">
            <AriInput
              value={editingDraft.docsUrl || ""}
              onChange={(value: string) => setEditingDraft((current) => ({ ...current, docsUrl: value }))}
              placeholder="可选，便于团队查看接入文档"
            />
          </AriFormItem>
          <AriFormItem label="提供方" name="mcp.editor.officialProvider">
            <AriInput
              value={editingDraft.officialProvider || ""}
              onChange={(value: string) => setEditingDraft((current) => ({ ...current, officialProvider: value }))}
              placeholder="可选，例如 Apifox"
            />
          </AriFormItem>
        </AriForm>
      </AriModal>
      <AriModal
        visible={Boolean(removingItem)}
        title="移除 MCP"
        onClose={() => setRemovingItem(null)}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton label="取消" onClick={() => setRemovingItem(null)} />
            <AriButton color="danger" icon="delete" label="移除" onClick={handleConfirmRemove} />
          </AriFlex>
        )}
      >
        <AriTypography
          variant="body"
          value={removingItem ? `确认移除 ${removingItem.name} 吗？该操作会删除本地注册项。` : ""}
        />
      </AriModal>
      <AriContainer className="desk-settings-shell desk-skills-shell">
        <AriFlex align="center" justify="space-between" space={12}>
          <AriContainer padding={0}>
            <AriTypography variant="caption" value={`已注册 ${overview.registered.length} 个 MCP`} />
            <AriTypography
              variant="caption"
              value={activeProjectWorkspace
                ? `当前项目：${activeProjectWorkspace.name || activeProjectWorkspace.path}；workspace 级配置会覆盖同名 user 级 MCP。`
                : "当前显示全局 user 级 MCP；选择项目后可查看和维护 workspace 级覆盖配置。"}
            />
          </AriContainer>
          <AriFlex align="center" space={8}>
            <AriSelect
              value={workspaceId}
              options={workspaceOptions}
              onChange={handleWorkspaceSelectionChange}
            />
            <AriButton
              ghost
              icon="refresh"
              label="刷新"
              disabled={Boolean(busyActionId) || runtimeBusy}
              onClick={() => {
                void reloadOverview();
              }}
            />
            <AriButton
              color="brand"
              icon="add"
              label="新增 MCP"
              disabled={Boolean(busyActionId) || runtimeBusy}
              onClick={() => openEditor({
                ...DEFAULT_MCP_DRAFT,
                scope: activeWorkspacePath ? "workspace" : "user",
              })}
            />
          </AriFlex>
        </AriFlex>

        <DeskSectionTitle title="已注册" />
        {overview.registered.length === 0 ? (
          <DeskEmptyState title="暂无 MCP" description="可从推荐模板新增，或直接创建自定义 MCP。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.registered.map((item) => (
              <RegisteredMcpCard
                key={item.id}
                item={item}
                busy={busyActionId === item.id || runtimeBusy}
                apifoxRuntimeStatus={apifoxRuntimeStatus}
                onToggleEnabled={(target, enabled) => {
                  void handleToggleEnabled(target, enabled);
                }}
                onEdit={(target) => openEditor(buildDraftFromRegistration(target))}
                onValidate={(target) => {
                  void handleValidateMcp(target);
                }}
                onRemove={(target) => setRemovingItem(target)}
              />
            ))}
          </AriContainer>
        )}

        <DeskSectionTitle title="推荐模板" />
        {overview.templates.length === 0 ? (
          <DeskEmptyState title="暂无模板" description="当前应用未提供内置 MCP 模板。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.templates.map((item) => (
              <McpTemplateCard
                key={item.id}
                item={item}
                busy={Boolean(busyActionId)}
                alreadyRegistered={registeredTemplateIds.has(item.id)}
                apifoxRuntimeStatus={apifoxRuntimeStatus}
                runtimeBusy={runtimeBusy}
                onCreate={(target) => openEditor({
                  ...buildDraftFromTemplate(target),
                  scope: activeWorkspacePath ? "workspace" : "user",
                })}
                onInstallApifoxRuntime={() => {
                  void handleInstallApifoxRuntime();
                }}
                onUninstallApifoxRuntime={() => {
                  void handleUninstallApifoxRuntime();
                }}
              />
            ))}
          </AriContainer>
        )}
      </AriContainer>
    </AriContainer>
  );
}
