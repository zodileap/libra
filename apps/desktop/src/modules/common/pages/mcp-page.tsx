import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AriButton,
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
  AriTooltip,
  AriTypography,
} from "aries_react";
import type {
  McpDomain,
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
import {
  checkDccRuntimeStatus,
  prepareDccRuntime,
  type DccRuntimeStatus,
} from "../../../shared/services/dcc-runtime";
import { getProjectWorkspaceGroupById, listProjectWorkspaceGroups } from "../../../shared/data";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import {
  DeskOverviewDetailRow,
  DeskOverviewDetailsModal,
  DeskEmptyState,
  DeskOverviewCard,
  DeskPageHeader,
  DeskSectionTitle,
} from "../../../widgets/settings-primitives";

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
  domain: "general",
  software: "",
  capabilities: [],
  priority: 0,
  supportsImport: false,
  supportsExport: false,
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
//   - 收集总览中声明了 DCC Runtime 的软件列表，供页面批量刷新运行时状态。
//
// Params:
//
//   - overview: MCP 总览。
//
// Returns:
//
//   - 去重后的软件标识列表。
function collectDccRuntimeSoftwares(overview: McpOverview): string[] {
  return Array.from(
    new Set(
      [...overview.registered, ...overview.templates]
        .filter((item) => item.runtimeKind === "dcc_bridge")
        .map((item) => String(item.software || "").trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  );
}

// 描述：
//
//   - 批量读取 DCC Runtime 状态，并输出按软件归档的映射，供模板和已注册卡片复用。
//
// Params:
//
//   - overview: MCP 总览。
//
// Returns:
//
//   - 软件标识到运行时状态的映射。
async function buildDccRuntimeStatusMap(
  overview: McpOverview,
): Promise<Record<string, DccRuntimeStatus>> {
  const softwares = collectDccRuntimeSoftwares(overview);
  const entries = await Promise.all(
    softwares.map(async (software) => {
      try {
        return [software, await checkDccRuntimeStatus(software)] as const;
      } catch (_err) {
        return [software, {
          available: false,
          software,
          message: "读取 DCC Runtime 状态失败，请稍后重试。",
          resolvedPath: "",
          runtimeKind: "dcc_bridge",
          requiredEnvKeys: [],
          supportsAutoPrepare: false,
        }] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

// 描述：
//
//   - 渲染 DCC Runtime 自动准备能力文案，帮助用户快速判断当前软件能否一键准备。
//
// Params:
//
//   - status: 当前软件的 DCC Runtime 状态。
//
// Returns:
//
//   - 自动准备能力文案。
function renderDccRuntimeAutoPrepareLabel(status?: DccRuntimeStatus): string {
  return status?.supportsAutoPrepare ? "自动准备：支持" : "自动准备：手动";
}

// 描述：
//
//   - 渲染 DCC Runtime 环境变量要求文案，避免用户不知道应配置哪些软件路径。
//
// Params:
//
//   - status: 当前软件的 DCC Runtime 状态。
//
// Returns:
//
//   - 环境变量要求文案；没有要求时返回空文本。
function renderDccRuntimeEnvRequirementLabel(status?: DccRuntimeStatus): string {
  if (!status?.requiredEnvKeys || status.requiredEnvKeys.length === 0) {
    return "";
  }
  return `环境变量：${status.requiredEnvKeys.join("、")}`;
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
//   - 将字符串数组格式化为多行文本，供“能力列表（每行一个）”编辑区复用。
//
// Params:
//
//   - source: 原始字符串列表。
//
// Returns:
//
//   - 多行文本。
function stringifyStringList(source: string[]): string {
  return source.join("\n");
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
    domain: item.domain,
    software: item.software,
    capabilities: item.capabilities,
    priority: item.priority,
    supportsImport: item.supportsImport,
    supportsExport: item.supportsExport,
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
    domain: item.domain,
    software: item.software,
    capabilities: item.capabilities,
    priority: item.priority,
    supportsImport: item.supportsImport,
    supportsExport: item.supportsExport,
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
//   - 渲染 MCP 领域标签，便于区分通用工具与建模软件接入。
//
// Params:
//
//   - domain: MCP 领域。
//
// Returns:
//
//   - 标签文案。
function renderDomainLabel(domain: McpDomain): string {
  return domain === "dcc" ? "DCC" : "General";
}

// 描述：
//
//   - 渲染 DCC 软件展示文案，尽量保持常见软件名称的统一展示口径。
//
// Params:
//
//   - software: DCC 软件标识。
//
// Returns:
//
//   - 规范化后的展示文案。
function renderSoftwareLabel(software: string): string {
  const normalizedSoftware = String(software || "").trim().toLowerCase();
  if (normalizedSoftware === "blender") {
    return "Blender";
  }
  if (normalizedSoftware === "maya") {
    return "Maya";
  }
  if (normalizedSoftware === "c4d") {
    return "Cinema 4D";
  }
  if (normalizedSoftware === "houdini") {
    return "Houdini";
  }
  return normalizedSoftware || "未指定";
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
//   - 渲染已注册 MCP 卡片，统一承载管理入口，详细动作进入管理弹窗处理。
function RegisteredMcpCard({
  item,
  busy,
  onManage,
}: {
  item: McpRegistrationItem;
  busy: boolean;
  onManage: (item: McpRegistrationItem) => void;
}) {
  return (
    <DeskOverviewCard
      icon={<AriIcon name="hub" />}
      title={item.name}
      description={item.description || "未填写 MCP 描述"}
      actions={(
        <AriTooltip content="管理" position="top" minWidth={0} matchTriggerWidth={false}>
          <AriButton type="text" icon="settings" aria-label="管理 MCP" disabled={busy} onClick={() => onManage(item)} />
        </AriTooltip>
      )}
    />
  );
}

// 描述：
//
//   - 渲染 MCP 模板卡片，统一承载“查看模板详情”和“从模板新增”动作。
function McpTemplateCard({
  item,
  busy,
  alreadyRegistered,
  onManage,
  onCreate,
}: {
  item: McpTemplateItem;
  busy: boolean;
  alreadyRegistered: boolean;
  onManage: (item: McpTemplateItem) => void;
  onCreate: (item: McpTemplateItem) => void;
}) {
  return (
    <DeskOverviewCard
      icon={<AriIcon name="hub" />}
      title={item.name}
      description={item.description || "未填写模板描述"}
      actions={(
        <>
          <AriTooltip content="管理" position="top" minWidth={0} matchTriggerWidth={false}>
            <AriButton type="text" icon="settings" aria-label="管理模板" disabled={busy} onClick={() => onManage(item)} />
          </AriTooltip>
          <AriButton
            type="text"
            color={alreadyRegistered ? "default" : "brand"}
            icon="add"
            aria-label={alreadyRegistered ? "模板已添加" : "添加 MCP"}
            disabled={busy || alreadyRegistered}
            onClick={() => onCreate(item)}
          />
        </>
      )}
    />
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
  const [dccRuntimeStatusMap, setDccRuntimeStatusMap] = useState<Record<string, DccRuntimeStatus>>({});
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingDraft, setEditingDraft] = useState<McpRegistrationDraft>(DEFAULT_MCP_DRAFT);
  const [argsText, setArgsText] = useState("");
  const [capabilitiesText, setCapabilitiesText] = useState("");
  const [envText, setEnvText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [managingTemplateItem, setManagingTemplateItem] = useState<McpTemplateItem | null>(null);
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
    const nextDccRuntimeStatusMap = await buildDccRuntimeStatusMap(nextOverview);
    setOverview(nextOverview);
    setApifoxRuntimeStatus(runtimeStatus
      ? {
        installed: runtimeStatus.installed,
        version: runtimeStatus.version,
        entryPath: runtimeStatus.entry_path,
        message: runtimeStatus.message,
      }
      : null);
    setDccRuntimeStatusMap(nextDccRuntimeStatusMap);
  }, [mcpRegistryContext]);

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
        const nextDccRuntimeStatusMap = await buildDccRuntimeStatusMap(nextOverview);
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
        setDccRuntimeStatusMap(nextDccRuntimeStatusMap);
      } catch (_err) {
        if (!disposed) {
          setOverview(DEFAULT_MCP_OVERVIEW);
          setApifoxRuntimeStatus(null);
          setDccRuntimeStatusMap({});
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
    setCapabilitiesText(stringifyStringList(draft.capabilities || []));
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
    capabilities: parseArgsText(capabilitiesText),
    env: parseRecordEntries(envText),
    headers: parseRecordEntries(headersText),
  }), [argsText, capabilitiesText, editingDraft, envText, headersText]);

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
      setCapabilitiesText("");
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
      if (editingDraft.id === removingItem.id) {
        setEditorVisible(false);
        setEditingDraft(DEFAULT_MCP_DRAFT);
      }
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
  //   - 准备或重新校验指定 DCC Runtime，并在完成后刷新总览与状态映射。
  const handlePrepareDccRuntime = useCallback(async (item: McpTemplateItem) => {
    const software = String(item.software || "").trim().toLowerCase();
    if (!software) {
      AriMessage.error({
        content: "当前 DCC 模板缺少软件标识，无法准备 Runtime。",
        duration: 2200,
      });
      return;
    }
    setRuntimeBusy(true);
    try {
      const status = await prepareDccRuntime(software);
      await reloadOverview();
      if (status.available) {
        AriMessage.success({
          content: status.message || `${renderSoftwareLabel(software)} Runtime 已就绪。`,
          duration: 2200,
        });
      } else {
        AriMessage.error({
          content: status.message || `${renderSoftwareLabel(software)} Runtime 尚未就绪。`,
          duration: 2600,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || "准备 DCC Runtime 失败，请稍后重试。",
        duration: 2200,
      });
    } finally {
      setRuntimeBusy(false);
    }
  }, [reloadOverview]);

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

  // 描述：
  //
  //   - 生成标题栏内容并挂载到全局头部 slot，保持 Desktop 页面头部一致性。
  const headerNode = useMemo(() => (
    <DeskPageHeader
      mode="slot"
      title="MCP"
      description={activeProjectWorkspace
        ? `已注册 ${overview.registered.length} 个；当前项目：${activeProjectWorkspace.name || activeProjectWorkspace.path}`
        : `已注册 ${overview.registered.length} 个；当前显示全局 user 级 MCP。`}
      actions={(
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
            size="sm"
            disabled={Boolean(busyActionId) || runtimeBusy}
            onClick={() => {
              void reloadOverview();
            }}
          />
          <AriButton
            color="brand"
            icon="add"
            label="新增 MCP"
            size="sm"
            disabled={Boolean(busyActionId) || runtimeBusy}
            onClick={() => openEditor({
              ...DEFAULT_MCP_DRAFT,
              scope: activeWorkspacePath ? "workspace" : "user",
            })}
          />
        </AriFlex>
      )}
    />
  ), [
    activeProjectWorkspace,
    activeWorkspacePath,
    busyActionId,
    handleWorkspaceSelectionChange,
    openEditor,
    overview.registered.length,
    reloadOverview,
    runtimeBusy,
    workspaceId,
    workspaceOptions,
  ]);

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
      <DeskOverviewDetailsModal
        visible={Boolean(managingTemplateItem)}
        title={managingTemplateItem ? `${managingTemplateItem.name} · 详情` : "模板详情"}
        description={managingTemplateItem?.description || "未填写模板描述"}
        footer={managingTemplateItem ? (
          <AriFlex justify="flex-end" align="center" space={8}>
            {managingTemplateItem.runtimeKind === "apifox_runtime" ? (
              apifoxRuntimeStatus?.installed ? (
                <AriButton
                  icon="delete"
                  label="卸载 Runtime"
                  disabled={runtimeBusy}
                  onClick={() => {
                    void handleUninstallApifoxRuntime();
                  }}
                />
              ) : (
                <AriButton
                  icon="download"
                  label="安装 Runtime"
                  disabled={runtimeBusy}
                  onClick={() => {
                    void handleInstallApifoxRuntime();
                  }}
                />
              )
            ) : null}
            {managingTemplateItem.runtimeKind === "dcc_bridge" ? (
              <AriButton
                icon={dccRuntimeStatusMap[managingTemplateItem.software]?.available ? "check_circle" : "build"}
                label={dccRuntimeStatusMap[managingTemplateItem.software]?.available ? "校验 Runtime" : "准备 Runtime"}
                disabled={runtimeBusy}
                onClick={() => {
                  void handlePrepareDccRuntime(managingTemplateItem);
                }}
              />
            ) : null}
            <AriButton
              color="brand"
              icon="add"
              label="添加"
              disabled={Boolean(busyActionId) || registeredTemplateIds.has(managingTemplateItem.id)}
              onClick={() => {
                openEditor({
                  ...buildDraftFromTemplate(managingTemplateItem),
                  scope: activeWorkspacePath ? "workspace" : "user",
                });
              }}
            />
            <AriButton icon="close" label="关闭" onClick={() => setManagingTemplateItem(null)} />
          </AriFlex>
        ) : undefined}
        onClose={() => setManagingTemplateItem(null)}
      >
        {managingTemplateItem ? (
          <>
            <DeskOverviewDetailRow label="传输" value={renderTransportLabel(managingTemplateItem.transport)} />
            <DeskOverviewDetailRow label="领域" value={renderDomainLabel(managingTemplateItem.domain)} />
            {managingTemplateItem.domain === "dcc" && managingTemplateItem.software ? (
              <DeskOverviewDetailRow label="软件" value={renderSoftwareLabel(managingTemplateItem.software)} />
            ) : null}
            {managingTemplateItem.officialProvider ? (
              <DeskOverviewDetailRow label="提供方" value={managingTemplateItem.officialProvider} />
            ) : null}
            {managingTemplateItem.domain === "dcc" ? (
              <DeskOverviewDetailRow
                label="能力"
                value={`${managingTemplateItem.capabilities.length > 0 ? managingTemplateItem.capabilities.join("、") : "未声明"}；优先级：${managingTemplateItem.priority}`}
              />
            ) : null}
            <DeskOverviewDetailRow
              label="接入"
              value={managingTemplateItem.runtimeKind === "apifox_runtime"
                ? `Runtime：${apifoxRuntimeStatus?.installed ? "已安装" : "未安装"}${apifoxRuntimeStatus?.version ? `（${apifoxRuntimeStatus.version}）` : ""}`
                : managingTemplateItem.runtimeKind === "dcc_bridge"
                  ? `Runtime：${dccRuntimeStatusMap[managingTemplateItem.software]?.available ? "已就绪" : "未就绪"}${dccRuntimeStatusMap[managingTemplateItem.software]?.resolvedPath ? `（${dccRuntimeStatusMap[managingTemplateItem.software]?.resolvedPath}）` : ""}`
                  : managingTemplateItem.transport === "http"
                    ? `示例地址：${managingTemplateItem.url || "无"}`
                    : "按需填写命令、参数和环境变量。"}
            />
            {managingTemplateItem.runtimeKind === "dcc_bridge" ? (
              <DeskOverviewDetailRow label="Runtime" value={renderDccRuntimeAutoPrepareLabel(dccRuntimeStatusMap[managingTemplateItem.software])} />
            ) : null}
            {managingTemplateItem.runtimeKind === "dcc_bridge" && renderDccRuntimeEnvRequirementLabel(dccRuntimeStatusMap[managingTemplateItem.software]) ? (
              <DeskOverviewDetailRow label="环境要求" value={renderDccRuntimeEnvRequirementLabel(dccRuntimeStatusMap[managingTemplateItem.software]) || ""} />
            ) : null}
            {managingTemplateItem.docsUrl ? <DeskOverviewDetailRow label="文档" value={managingTemplateItem.docsUrl} /> : null}
          </>
        ) : null}
      </DeskOverviewDetailsModal>
      <AriModal
        visible={editorVisible}
        title={editingDraft.id ? "编辑 MCP" : "新增 MCP"}
        onClose={() => setEditorVisible(false)}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton label="取消" onClick={() => setEditorVisible(false)} />
            {editingDraft.id ? (
              <AriButton
                icon="check_circle"
                label="校验"
                disabled={Boolean(busyActionId)}
                onClick={() => {
                  const target = overview.registered.find((item) => item.id === editingDraft.id);
                  if (!target) {
                    return;
                  }
                  void handleValidateMcp(target);
                }}
              />
            ) : null}
            {editingDraft.id && overview.registered.some((item) => item.id === editingDraft.id && item.removable) ? (
              <AriButton
                color="danger"
                icon="delete"
                label="移除"
                disabled={Boolean(busyActionId)}
                onClick={() => {
                  const target = overview.registered.find((item) => item.id === editingDraft.id);
                  if (!target) {
                    return;
                  }
                  setRemovingItem(target);
                }}
              />
            ) : null}
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
          <AriFormItem label="领域" name="mcp.editor.domain">
            <AriSelect
              value={editingDraft.domain || "general"}
              options={[
                { label: "General（通用）", value: "general" },
                { label: "DCC（建模软件）", value: "dcc" },
              ]}
              onChange={(value: unknown) => {
                const nextDomain = String(value || "general") === "dcc" ? "dcc" : "general";
                setEditingDraft((current) => ({
                  ...current,
                  domain: nextDomain,
                  software: nextDomain === "dcc" ? current.software || "" : "",
                  capabilities: nextDomain === "dcc" ? current.capabilities || [] : [],
                  supportsImport: nextDomain === "dcc" ? current.supportsImport === true : false,
                  supportsExport: nextDomain === "dcc" ? current.supportsExport === true : false,
                }));
              }}
            />
          </AriFormItem>
          {editingDraft.domain === "dcc" ? (
            <>
              <AriFormItem label="软件标识" name="mcp.editor.software">
                <AriInput
                  value={editingDraft.software || ""}
                  onChange={(value: string) => setEditingDraft((current) => ({ ...current, software: value }))}
                  placeholder="例如：blender、maya、c4d"
                />
              </AriFormItem>
              <AriFormItem label="能力列表（每行一个）" name="mcp.editor.capabilities">
                <AriInput.TextArea
                  value={capabilitiesText}
                  onChange={setCapabilitiesText}
                  placeholder="例如：scene.inspect\nmesh.edit\nfile.export"
                  rows={4}
                />
              </AriFormItem>
              <AriFormItem label="优先级" name="mcp.editor.priority">
                <AriInput
                  value={String(editingDraft.priority || 0)}
                  onChange={(value: string) => setEditingDraft((current) => ({
                    ...current,
                    priority: Number.parseInt(String(value || "0").trim() || "0", 10) || 0,
                  }))}
                  placeholder="数值越大优先级越高"
                />
              </AriFormItem>
              <AriFormItem label="支持导入" name="mcp.editor.supportsImport">
                <AriSwitch
                  checked={editingDraft.supportsImport === true}
                  onChange={(checked: boolean) => setEditingDraft((current) => ({ ...current, supportsImport: checked }))}
                />
              </AriFormItem>
              <AriFormItem label="支持导出" name="mcp.editor.supportsExport">
                <AriSwitch
                  checked={editingDraft.supportsExport === true}
                  onChange={(checked: boolean) => setEditingDraft((current) => ({ ...current, supportsExport: checked }))}
                />
              </AriFormItem>
            </>
          ) : null}
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
          <AriFormItem label="启用" name="mcp.editor.enabled">
            <AriSwitch
              checked={editingDraft.enabled !== false}
              onChange={(checked: boolean) => setEditingDraft((current) => ({ ...current, enabled: checked }))}
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
            ) : editingDraft.runtimeKind === "dcc_bridge" ? (
              <AriFormItem label="运行方式" name="mcp.editor.runtimeKind">
                <AriTypography
                  variant="caption"
                  value={editingDraft.software
                    ? `${renderSoftwareLabel(editingDraft.software)} Runtime 由 DCC Bridge 管理，请在模板卡片中准备或校验 Runtime。`
                    : "DCC Runtime 由 DCC Bridge 管理，请先填写软件标识后再回到模板卡片准备 Runtime。"}
                />
                {editingDraft.software ? (
                  <>
                    <AriTypography
                      variant="caption"
                      value={editingDraft.software.trim().toLowerCase() === "blender"
                        ? "自动准备：支持"
                        : "自动准备：手动"}
                    />
                    {editingDraft.software.trim().toLowerCase() === "maya" ? (
                      <AriTypography variant="caption" value="环境变量：MAYA_BIN" />
                    ) : null}
                    {editingDraft.software.trim().toLowerCase() === "c4d" ? (
                      <AriTypography variant="caption" value="环境变量：C4D_BIN" />
                    ) : null}
                  </>
                ) : null}
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
        <DeskSectionTitle title="已注册" />
        {overview.registered.length === 0 ? (
          <DeskEmptyState title="暂无已注册 MCP" description="可从下方未注册模板新增，或直接创建自定义 MCP。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.registered.map((item) => (
              <RegisteredMcpCard
                key={item.id}
                item={item}
                busy={busyActionId === item.id || runtimeBusy}
                onManage={(target) => openEditor(buildDraftFromRegistration(target))}
              />
            ))}
          </AriContainer>
        )}

        <DeskSectionTitle title="未注册" />
        {overview.templates.length === 0 ? (
          <DeskEmptyState title="暂无未注册 MCP" description="当前应用未提供可直接添加的内置模板。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.templates.map((item) => (
              <McpTemplateCard
                key={item.id}
                item={item}
                busy={Boolean(busyActionId) || runtimeBusy}
                alreadyRegistered={registeredTemplateIds.has(item.id)}
                onManage={setManagingTemplateItem}
                onCreate={(target) => openEditor({
                  ...buildDraftFromTemplate(target),
                  scope: activeWorkspacePath ? "workspace" : "user",
                })}
              />
            ))}
          </AriContainer>
        )}
      </AriContainer>
    </AriContainer>
  );
}
