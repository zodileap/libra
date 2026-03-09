import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriIcon,
  AriInput,
  AriList,
  AriListItem,
  AriMessage,
  AriMenu,
  AriModal,
  AriSelect,
  AriTooltip,
  AriTypography,
} from "aries_react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getProjectWorkspaceCapabilityManifest,
  PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT,
  getProjectWorkspaceProfile,
  getProjectWorkspaceGroupById,
  getProjectWorkspaceIdBySessionId,
  getSessionDebugArtifact,
  getSessionRunState,
  getSessionMessages,
  removeSessionDebugArtifact,
  resolveAgentSessionSelectedAiProvider,
  resolveAgentSessionTitle,
  resolveAgentSessionSelectedDccSoftware,
  rememberAgentSessionSelectedAiProvider,
  rememberAgentSessionSelectedDccSoftware,
  removeSessionRunState,
  SESSION_TITLE_UPDATED_EVENT,
  upsertSessionRunState,
  upsertSessionDebugArtifact,
  upsertSessionMessages,
  getAgentSessionMetaSnapshot,
  removeAgentSession,
  renameAgentSession,
  togglePinnedAgentSession,
  isProjectWorkspaceCapabilityEnabled,
  type ProjectWorkspaceProfile,
  type ProjectWorkspaceCapabilityId,
  type SessionRunMeta as PersistedSessionRunMeta,
} from "../../shared/data";
import { updateRuntimeSessionStatus } from "../../shared/services/backend-api";
import {
  DEFAULT_DCC_PROVIDER_ADDR,
  normalizeInvokeError,
  normalizeInvokeErrorDetail,
  type NormalizedInvokeErrorDetail,
} from "../../shared/services/dcc-runtime";
import {
  buildUiHintFromProtocolError,
  mapProtocolUiHint,
} from "../../shared/services/protocol-ui-hint";
import type {
  AgentKey,
  AgentAssetRecord,
  AgentEventRecord,
  AgentStepRecord,
  AiKeyItem,
  LoginUser,
  DccMcpCapabilities,
  ProtocolUiHint,
} from "../../shared/types";
import { ChatMarkdown } from "../chat-markdown";
import {
  buildAgentWorkflowSkillExecutionPlan,
  buildAgentWorkflowPrompt,
  listAgentWorkflowOverview,
} from "../../shared/workflow";
import { normalizeAgentSkillId } from "../../shared/workflow/prompt-guidance";
import { listAgentSkills, listMcpOverview } from "../../modules/common/services";
import type { AgentSkillItem, McpRegistrationItem } from "../../modules/common/services";
import {
  AGENT_HOME_PATH,
  AGENT_SETTINGS_PATH,
} from "../../modules/agent/routes";
import { useDesktopHeaderSlot } from "../app-header/header-slot-context";
import { resolveDesktopTextVariants, translateDesktopText, useDesktopI18n } from "../../shared/i18n";
import { DESKTOP_TEXT_VARIANT_GROUPS } from "../../shared/i18n/messages";
import type {
  AgentWorkflowDefinition,
  WorkflowUiHint,
} from "../../shared/workflow";
import { resolveSessionUiConfig, type SessionAgentUiConfig } from "./config";
import {
  buildSessionContextPrompt,
  buildSessionSkillPrompt,
  AGENT_SKILL_SELECTED_KEY,
  AGENT_WORKFLOW_SELECTED_KEY,
  pruneAssistantRetryTail,
  readSelectedSkillIds,
  readSelectedWorkflowId,
  type MessageItem,
  type RetryTailPruneResult,
  type TraceRecord,
  upsertAssistantMessageById,
} from "./prompt-utils";
import { SessionRunSegmentItem } from "./run-segment";
import {
  IS_BROWSER,
  COMMANDS,
  EVENT_AGENT_TEXT_STREAM,
  isCancelErrorCode,
  STREAM_KINDS,
} from "../../shared/constants";
import type {
  AgentTextStreamEvent,
} from "../../shared/types";

// 描述:
//
//   - 定义会话页面组件入参，统一传入会话上下文、用户信息与能力依赖。
interface SessionPageProps {
  agentKey: AgentKey;
  sessionId: string;
  sessionUiConfig?: SessionAgentUiConfig;
  currentUser?: LoginUser | null;
  dccMcpCapabilities: DccMcpCapabilities;
  aiKeys: AiKeyItem[];
}

// 描述:
//
//   - 定义会话路由 state 结构，用于跨页透传自动提问与目录上下文。
interface SessionRouteState {
  autoPrompt?: string;
  workspaceId?: string;
  preferredWorkflowId?: string;
  preferredSkillIds?: string[];
}

// 描述：
//
//   - 定义会话发送可选参数，统一控制确认重试、危险动作与依赖检查跳过开关。
interface ExecutePromptOptions {
  allowDangerousAction?: boolean;
  appendUserMessage?: boolean;
  confirmationToken?: string;
  skipDependencyRuleCheck?: boolean;
  replaceAssistantMessageId?: string;
  contextMessages?: MessageItem[];
  resolvedDccSoftware?: string;
  resolvedCrossDccSoftwares?: string[];
  skipDccSelectionPrompt?: boolean;
}

// 描述:
//
//   - 定义通用智能体执行响应结构，兼容动作、步骤、事件与资产返回。
interface AgentRunResponse {
  trace_id: string;
  message: string;
  actions: string[];
  exported_file?: string;
  steps: AgentStepRecord[];
  events: AgentEventRecord[];
  assets: AgentAssetRecord[];
  ui_hint?: ProtocolUiHint;
}

// 描述:
//
//   - 定义沙盒运行指标结构，供轮询状态展示使用。
interface AgentSandboxMetrics {
  memory_bytes: number;
  uptime_secs: number;
}

// 描述:
//
//   - 定义文本流工具调用事件 data 的最小字段结构。
interface AgentToolCallEventData {
  name?: string;
  ok?: boolean;
  result?: string;
  args_preview?: string;
  args_data?: Record<string, unknown>;
  result_data?: Record<string, unknown>;
  args?: {
    command?: string;
    path?: string;
  };
}

// 描述:
//
//   - 定义文本流人工审批事件 data 的最小字段结构。
interface AgentRequireApprovalEventData {
  approval_id?: string;
  tool_name?: string;
}

const APPROVAL_TOOL_ARGS_PREVIEW_MAX_CHARS = 2000;
const PLANNING_META_PREFIX = "__libra_planning__:";
const INITIAL_THINKING_SEGMENT_ROLE = "initial_thinking";
const DCC_MODELING_SKILL_ID = "dcc-modeling";

// 描述：
//
//   - DCC 软件选项结构；统一承载软件标识、展示文案和可用 MCP 摘要，供会话级软件选择与提示词路由复用。
interface DccSoftwareOption {
  software: string;
  label: string;
  providerIds: string[];
  capabilities: string[];
  supportsImport: boolean;
  supportsExport: boolean;
  priority: number;
}

// 描述：
//
//   - DCC 选择中断态；当用户未指定软件且存在多个可用 DCC 软件时，先缓存当前请求并要求用户选择软件。
interface PendingDccSelectionState {
  selectionMode: "single" | "cross";
  prompt: string;
  options: ExecutePromptOptions;
  contextMessages: MessageItem[];
  softwareOptions: DccSoftwareOption[];
  selectedSoftware: string;
  selectedTargetSoftware: string;
}

// 描述：
//
//   - DCC 预检查结果；统一返回是否阻断、当前绑定软件与应注入提示词的上下文块。
interface DccPreflightResult {
  blocked: boolean;
  promptBlock: string;
}

// 描述：
//
//   - DCC 软件展示文案映射，保证会话页与 MCP 页面在常见软件名称上的展示口径一致。
const DCC_SOFTWARE_LABEL_MAP: Record<string, string> = {
  blender: "Blender",
  maya: "Maya",
  c4d: "Cinema 4D",
  houdini: "Houdini",
};

// 描述：
//
//   - DCC 软件别名映射，供会话层从用户文本中识别显式指定的软件。
const DCC_SOFTWARE_ALIAS_MAP: Record<string, string[]> = {
  blender: ["blender"],
  maya: ["maya"],
  c4d: ["c4d", "cinema 4d", "cinema4d"],
  houdini: ["houdini"],
};

// 描述：
//
//   - 跨软件操作意图关键词；当用户表达“导出到另一个建模软件/跨软件迁移”等语义时，必须先明确源软件和目标软件。
const DCC_CROSS_SOFTWARE_INTENT_KEYWORDS = resolveDesktopTextVariants(DESKTOP_TEXT_VARIANT_GROUPS.dccCrossSoftwareIntent);

// 描述：
//
//   - 执行环境/授权阶段的心跳判定关键词；统一按中英文变体匹配，避免依赖单一语言字面量。
const AGENT_BRIDGE_STAGE_HINT_KEYWORDS = resolveDesktopTextVariants(DESKTOP_TEXT_VARIANT_GROUPS.agentBridgeStageHints);

// 描述：
//
//   - 执行失败中“超时”语义的判定关键词；同时覆盖后端英文错误和本地中文摘要。
const AGENT_TIMEOUT_HINT_KEYWORDS = resolveDesktopTextVariants(DESKTOP_TEXT_VARIANT_GROUPS.agentTimeoutHints);

// 描述：
//
//   - 规范化审批工具名，统一转为小写并去除首尾空白，供“会话内批准”命中比较。
function normalizeApprovalToolName(toolName: string): string {
  return String(toolName || "").trim().toLowerCase();
}

// 描述：
//
//   - 判断技能是否属于 DCC 建模领域，优先读取标准技能运行时元数据，缺失时回退到技能编码。
//
// Params:
//
//   - skill: 当前技能记录。
//
// Returns:
//
//   - true 表示当前技能需要启用 DCC 软件路由。
function isDccModelingSkill(skill: AgentSkillItem): boolean {
  const runtimeDomain = String(skill.runtimeRequirements?.domain || "").trim().toLowerCase();
  return runtimeDomain === DCC_MODELING_SKILL_ID || normalizeAgentSkillId(skill.id) === DCC_MODELING_SKILL_ID;
}

// 描述：
//
//   - 将 MCP 注册项聚合为按软件分组的 DCC 可用列表，供会话前置路由与用户选择复用。
//
// Params:
//
//   - items: 当前工作区可见的 MCP 注册项。
//
// Returns:
//
//   - 去重聚合后的 DCC 软件列表，按优先级从高到低排序。
function resolveAvailableDccSoftwareOptions(items: McpRegistrationItem[]): DccSoftwareOption[] {
  const groupedOptions = new Map<string, DccSoftwareOption>();
  items.forEach((item) => {
    if (!item.enabled || item.domain !== "dcc") {
      return;
    }
    const normalizedSoftware = String(item.software || "").trim().toLowerCase();
    if (!normalizedSoftware) {
      return;
    }
    const currentOption = groupedOptions.get(normalizedSoftware);
    const nextProviderIds = currentOption
      ? Array.from(new Set([...currentOption.providerIds, item.id]))
      : [item.id];
    const nextCapabilities = currentOption
      ? Array.from(new Set([...currentOption.capabilities, ...item.capabilities]))
      : Array.from(new Set(item.capabilities));
    const nextPriority = currentOption ? Math.max(currentOption.priority, item.priority) : item.priority;
    groupedOptions.set(normalizedSoftware, {
      software: normalizedSoftware,
      label: DCC_SOFTWARE_LABEL_MAP[normalizedSoftware] || item.name || normalizedSoftware,
      providerIds: nextProviderIds,
      capabilities: nextCapabilities,
      supportsImport: currentOption ? currentOption.supportsImport || item.supportsImport : item.supportsImport,
      supportsExport: currentOption ? currentOption.supportsExport || item.supportsExport : item.supportsExport,
      priority: nextPriority,
    });
  });
  return Array.from(groupedOptions.values()).sort((left, right) => right.priority - left.priority);
}

// 描述：
//
//   - 从当前会话上下文中提取用户显式提到的软件名称；只有被实际启用的 DCC 软件才会参与命中。
//
// Params:
//
//   - sourceTexts: 当前话题中的用户文本集合。
//   - softwareOptions: 当前可用的 DCC 软件选项。
//
// Returns:
//
//   - 用户显式提到的软件标识列表，按发现顺序去重输出。
function resolveExplicitDccSoftwares(
  sourceTexts: string[],
  softwareOptions: DccSoftwareOption[],
): string[] {
  const normalizedText = sourceTexts
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item.length > 0)
    .join("\n");
  const resolvedSoftwares: string[] = [];
  softwareOptions.forEach((item) => {
    const aliases = Array.from(
      new Set([
        item.software,
        item.label.toLowerCase(),
        ...(DCC_SOFTWARE_ALIAS_MAP[item.software] || []),
      ]),
    );
    if (aliases.some((alias) => alias && normalizedText.includes(alias)) && !resolvedSoftwares.includes(item.software)) {
      resolvedSoftwares.push(item.software);
    }
  });
  return resolvedSoftwares;
}

// 描述：
//
//   - 判断当前用户文本是否表达了跨软件操作意图；一旦命中，后续必须拿到两个明确软件后才能继续执行。
//
// Params:
//
//   - sourceTexts: 当前话题中的用户文本集合。
//
// Returns:
//
//   - true 表示当前请求存在跨软件迁移或跨软件使用的明确意图。
function hasCrossDccIntent(sourceTexts: string[]): boolean {
  const normalizedText = sourceTexts
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item.length > 0)
    .join("\n");
  if (!normalizedText) {
    return false;
  }
  return DCC_CROSS_SOFTWARE_INTENT_KEYWORDS.some((keyword) => normalizedText.includes(keyword));
}

// 描述：
//
//   - 构造 DCC 路由提示词片段，向建模 Skill 明确当前可用软件、线程绑定与跨软件限制。
//
// Params:
//
//   - softwareOptions: 当前可用 DCC 软件。
//   - selectedSoftware: 当前话题绑定的软件标识。
//   - crossSoftwareSoftwares: 本轮允许跨软件的目标软件列表。
//
// Returns:
//
//   - 可直接拼接到主提示词中的 DCC 路由片段。
function buildDccRoutingPromptBlock(
  softwareOptions: DccSoftwareOption[],
  selectedSoftware: string,
  crossSoftwareSoftwares: string[],
): string {
  const availableLines = softwareOptions.map((item) => {
    const capabilities = item.capabilities.length > 0 ? item.capabilities.join(", ") : translateDesktopText("未声明");
    return translateDesktopText("- {{label}} ({{software}}): providers={{providers}}; priority={{priority}}; import={{supportsImport}}; export={{supportsExport}}; capabilities={{capabilities}}", {
      label: item.label,
      software: item.software,
      providers: item.providerIds.join(", "),
      priority: item.priority,
      supportsImport: item.supportsImport,
      supportsExport: item.supportsExport,
      capabilities,
    });
  });
  const lines = [translateDesktopText("【DCC 路由约束】")];
  if (crossSoftwareSoftwares.length >= 2) {
    lines.push(translateDesktopText("本轮允许跨软件流程，仅可使用用户明确提到的软件：{{softwares}}。", {
      softwares: crossSoftwareSoftwares.map((item) => DCC_SOFTWARE_LABEL_MAP[item] || item).join("、"),
    }));
    lines.push(translateDesktopText("如需跨软件迁移，必须先输出“源软件 -> 中间格式 -> 目标软件”的计划，且不得额外引入未被用户明确提到的软件。"));
  } else if (selectedSoftware) {
    lines.push(translateDesktopText("当前话题绑定的软件：{{software}}。", {
      software: DCC_SOFTWARE_LABEL_MAP[selectedSoftware] || selectedSoftware,
    }));
    lines.push(translateDesktopText("除非用户后续明确改用其他软件，否则本话题的后续建模操作默认继续使用该软件。"));
  }
  lines.push(translateDesktopText("用户未明确提到两个或以上软件时，不得擅自规划跨软件导入导出流程。"));
  lines.push(translateDesktopText("执行任何软件动作前，必须确认所需对象、路径、格式和风险边界。"));
  lines.push(translateDesktopText("当前可用 DCC 软件："));
  lines.push(...availableLines);
  return lines.join("\n");
}

// 描述：
//
//   - 定义依赖规则命中项结构，供“升级并继续”确认弹窗展示。
interface DependencyRuleStatusItem {
  rule: string;
  ecosystem: string;
  package_name: string;
  expected_version: string;
  current_version?: string | null;
  status: string;
  source_file?: string | null;
  detail?: string | null;
  upgradable: boolean;
}

// 描述：
//
//   - 定义依赖规则检查返回结构，包含命中详情与可升级差异列表。
interface DependencyRuleCheckResponse {
  project_path: string;
  detected_ecosystems: string[];
  items: DependencyRuleStatusItem[];
  mismatches: DependencyRuleStatusItem[];
}

// 描述：
//
//   - 定义依赖规则升级结果结构，表示单条规则升级状态。
interface DependencyRuleUpgradeResult {
  ecosystem: string;
  package_name: string;
  expected_version: string;
  status: string;
  detail?: string | null;
}

// 描述：
//
//   - 定义依赖规则升级接口返回结构。
interface DependencyRuleUpgradeResponse {
  project_path: string;
  updated: DependencyRuleUpgradeResult[];
  skipped: DependencyRuleUpgradeResult[];
}

// 描述：
//
//   - 定义依赖规则确认弹窗临时态，保存继续执行所需上下文。
interface DependencyRuleConfirmState {
  prompt: string;
  options: ExecutePromptOptions;
  projectPath: string;
  rules: string[];
  mismatches: DependencyRuleStatusItem[];
}

// 描述:
//
//   - 定义运行片段状态枚举。
type AssistantRunSegmentStatus = "running" | "finished" | "failed";

// 描述:
//
//   - 定义运行轨迹中的单个片段展示结构。
interface AssistantRunSegment {
  key: string;
  intro: string;
  step: string;
  status: AssistantRunSegmentStatus;
  data?: Record<string, unknown>;
  detail?: string;
}

// 描述：
//
//   - 定义执行流标题分组内的单步展示结构。
interface AssistantRunSegmentStep {
  key: string;
  status: AssistantRunSegmentStatus;
  text: string;
  detail: string;
  data?: Record<string, unknown>;
}

// 描述：
//
//   - 定义执行流标题分组结构（一个标题下多个步骤）。
interface AssistantRunSegmentGroup {
  key: string;
  title: string;
  steps: AssistantRunSegmentStep[];
}

// 描述:
//
//   - 定义单次助手运行过程的聚合元数据。
interface AssistantRunMeta {
  status: "running" | "finished" | "failed";
  startedAt: number;
  finishedAt?: number;
  collapsed: boolean;
  summary: string;
  segments: AssistantRunSegment[];
}

// 描述:
//
//   - 定义助手运行阶段枚举，用于心跳与状态文案映射。
type AssistantRunStage = "planning" | "bridge" | "executing" | "finalizing";

// AgentTextStreamEvent 和 AgentDebugTraceEvent 已提取至 shared/types.ts 统一定义。

// 描述:
//
//   - 定义会话调试流记录结构，统一 UI 与后端来源字段。
interface SessionDebugFlowRecord {
  id: string;
  source: "ui" | "backend";
  stage: string;
  title: string;
  detail: string;
  timestamp: number;
}

// 描述:
//
//   - 定义助手消息维度的 AI 原始收发记录结构。
interface SessionAiRawByMessageItem {
  promptRaw: string;
  responseRaw: string;
}

// 描述：格式化任务耗时文案，统一用于完成分割线展示。
//
// Params:
//
//   - startedAt: 执行开始时间戳（毫秒）。
//   - finishedAt: 执行结束时间戳（毫秒），可选。
//
// Returns:
//
//   - 中文耗时文案（如“2分13秒”）。
function formatElapsedDuration(startedAt: number, finishedAt?: number): string {
  const safeStartedAt = Number.isFinite(startedAt) ? startedAt : Date.now();
  const normalizedFinishedAt = finishedAt ?? Date.now();
  const safeFinishedAt = Number.isFinite(normalizedFinishedAt) ? normalizedFinishedAt : Date.now();
  const totalSeconds = Math.max(0, Math.floor((safeFinishedAt - safeStartedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return translateDesktopText("{{minutes}}分{{seconds}}秒", { minutes, seconds });
  }
  return translateDesktopText("{{seconds}}秒", { seconds });
}

// 描述:
//
//   - 解析文本流中的工具调用 data 结构，避免 any 带来的字段误用风险。
function resolveToolCallEventData(payload: AgentTextStreamEvent): AgentToolCallEventData {
  if (!payload.data || typeof payload.data !== "object") {
    return {};
  }
  const data = payload.data as Record<string, unknown>;
  const rawArgs = data.args_data ?? data.args;
  const argsPreview = typeof data.args === "string"
    ? data.args
    : (typeof rawArgs === "string" ? rawArgs : "");
  const argsData = rawArgs && typeof rawArgs === "object"
    ? (rawArgs as Record<string, unknown>)
    : undefined;
  const rawResult = data.result_data;
  const resultData = rawResult && typeof rawResult === "object"
    ? (rawResult as Record<string, unknown>)
    : undefined;
  return {
    name: typeof data.name === "string" ? data.name : undefined,
    ok: typeof data.ok === "boolean" ? data.ok : undefined,
    result: typeof data.result === "string" ? data.result : undefined,
    args_preview: truncateRunText(argsPreview, 1200),
    args_data: argsData,
    result_data: resultData,
    args: {
      command: typeof argsData?.command === "string" ? argsData.command : undefined,
      path: typeof argsData?.path === "string" ? argsData.path : undefined,
    },
  };
}

// 描述：
//
//   - 判断工具是否属于“后台终端”步骤类型。
//
// Params:
//
//   - toolName: 工具名。
//
// Returns:
//
//   - true: 终端类工具。
function isTerminalTool(toolName: string): boolean {
  return toolName === "run_shell" || toolName === "run_shell_command";
}

// 描述：
//
//   - 判断工具是否属于“文件编辑”步骤类型。
//
// Params:
//
//   - toolName: 工具名。
//
// Returns:
//
//   - true: 编辑类工具。
function isEditTool(toolName: string): boolean {
  return toolName === "write_text"
    || toolName === "write_json"
    || toolName === "apply_patch"
    || toolName === "apply_patch_file"
    || toolName === "todo_write";
}

// 描述：
//
//   - 判断工具是否属于“浏览/检索”步骤类型。
//
// Params:
//
//   - toolName: 工具名。
//
// Returns:
//
//   - true: 浏览类工具。
function isBrowseTool(toolName: string): boolean {
  return toolName === "read_text"
    || toolName === "read_json"
    || toolName === "todo_read"
    || toolName === "list_dir"
    || toolName === "list_directory"
    || toolName === "glob"
    || toolName === "search_files"
    || toolName === "web_search"
    || toolName === "stat"
    || toolName === "git_diff"
    || toolName === "git_status"
    || toolName === "git_log";
}

// 描述：
//
//   - 根据浏览类工具名称与参数，生成统一可读的浏览明细文案。
//
// Params:
//
//   - toolName: 工具名。
//   - input: 浏览类参数集合（query/glob/path/pattern）。
//
// Returns:
//
//   - 统一明细文案（如 Searched for ... / Read ...）。
function buildBrowseDetail(
  toolName: string,
  input: {
    query?: string;
    glob?: string;
    path?: string;
    pattern?: string;
    count?: number;
  },
): string {
  const query = String(input.query || "").trim();
  const glob = String(input.glob || "").trim();
  const path = String(input.path || "").trim();
  const pattern = String(input.pattern || "").trim();
  const count = Math.max(0, Math.floor(Number(input.count || 0)));

  if (toolName === "search_files" || toolName === "web_search") {
    if (query) {
      return `Searched for ${query}${glob ? ` in ${glob}` : ""}`;
    }
    return "Searched via tool";
  }
  if (toolName === "glob") {
    const token = pattern || glob;
    if (token) {
      return `Searched for ${token}${path ? ` in ${path}` : ""}`;
    }
    return "Searched via glob";
  }
  if (toolName === "list_dir" || toolName === "list_directory") {
    return `Listed files in ${path || "."}`;
  }
  if (toolName === "read_text" || toolName === "read_json" || toolName === "stat") {
    return `Read ${path || "(unknown)"}`;
  }
  if (toolName === "todo_read") {
    if (path) {
      return `Read TODO list (${count} items) from ${path}`;
    }
    return `Read TODO list (${count} items)`;
  }
  if (toolName === "git_diff") {
    return path ? `Read diff in ${path}` : "Read git diff";
  }
  if (toolName === "git_status") {
    return "Read git status";
  }
  if (toolName === "git_log") {
    return "Read git log";
  }
  if (path) {
    return `Read ${path}`;
  }
  return `Browsed via ${toolName}`;
}

// 描述：
//
//   - 解析浏览类工具对应的“文件/搜索”计数增量，统一执行流聚合口径。
//
// Params:
//
//   - toolName: 工具名。
//
// Returns:
//
//   - fileDelta/searchDelta：聚合增量。
function resolveBrowseCountDelta(toolName: string): {
  fileDelta: number;
  searchDelta: number;
} {
  const isSearchStep = toolName === "search_files" || toolName === "web_search" || toolName === "glob";
  if (isSearchStep) {
    return { fileDelta: 0, searchDelta: 1 };
  }
  return { fileDelta: 1, searchDelta: 0 };
}

// 描述：
//
//   - 解析 planning 事件中的结构化 payload；仅识别统一前缀协议。
function resolvePlanningMeta(payloadMessage: string): Record<string, unknown> | null {
  const raw = String(payloadMessage || "").trim();
  if (!raw.startsWith(PLANNING_META_PREFIX)) {
    return null;
  }
  const jsonPart = raw.slice(PLANNING_META_PREFIX.length).trim();
  if (!jsonPart) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch (_error) {
    return null;
  }
}

// 描述:
//
//   - 解析文本流中的人工授权 data 结构，用于稳定生成授权提示文案。
function resolveApprovalEventData(payload: AgentTextStreamEvent): AgentRequireApprovalEventData {
  if (!payload.data || typeof payload.data !== "object") {
    return {};
  }
  const data = payload.data as Record<string, unknown>;
  return {
    approval_id: typeof data.approval_id === "string" ? data.approval_id : undefined,
    tool_name: typeof data.tool_name === "string" ? data.tool_name : undefined,
  };
}

// 描述：
//
//   - 裁剪长文本，避免执行流/授权卡片渲染超长字符串导致主线程卡顿。
function truncateRunText(value: string, maxChars: number): string {
  const normalized = String(value || "").trim();
  if (!normalized || maxChars <= 0) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}…`;
}

// 描述：
//
//   - 尝试把 JSON 字符串解析为对象记录，用于兼容工具把结构化结果塞进 result/raw 文本字段。
//
// Params:
//
//   - value: 待解析值。
//
// Returns:
//
//   - 解析成功返回对象；失败返回 null。
function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch (_error) {
    return null;
  }
}

// 描述：
//
//   - 构建授权步骤透传数据，仅保留恢复授权所需关键字段，并对长参数做裁剪。
function buildApprovalSegmentData(payload: AgentTextStreamEvent): Record<string, unknown> {
  const rawData = payload.data && typeof payload.data === "object"
    ? (payload.data as Record<string, unknown>)
    : {};
  const data: Record<string, unknown> = {
    __segment_kind: payload.kind,
  };
  if (typeof rawData.approval_id === "string") {
    data.approval_id = truncateRunText(rawData.approval_id, 120);
  }
  if (typeof rawData.tool_name === "string") {
    data.tool_name = truncateRunText(rawData.tool_name, 120);
  }
  if (typeof rawData.tool_args === "string") {
    data.tool_args = truncateRunText(rawData.tool_args, APPROVAL_TOOL_ARGS_PREVIEW_MAX_CHARS);
  }
  return data;
}

// 描述:
//
//   - 读取文本流 error 事件附带的错误码，供取消语义分流判定使用。
function resolveStreamErrorCode(payload: AgentTextStreamEvent): string {
  if (!payload.data || typeof payload.data !== "object") {
    return "";
  }
  const data = payload.data as Record<string, unknown>;
  return typeof data.code === "string" ? data.code : "";
}

// 描述：把智能体文本流事件映射为“说明 + 步骤”结构，用于统一的进行中轨迹渲染。
//
// Params:
//
//   - payload: 智能体文本流事件。
//   - segmentKey: 段唯一键。
//
// Returns:
//
//   - 轨迹段；无可展示内容时返回 null。
function mapAgentTextStreamToRunSegment(
  payload: AgentTextStreamEvent,
  segmentKey: string,
): AssistantRunSegment | null {
  const eventMessage = String(payload.message || "").trim();
  if (
    payload.kind === STREAM_KINDS.DELTA
    || payload.kind === STREAM_KINDS.STARTED
    || payload.kind === STREAM_KINDS.LLM_STARTED
    || payload.kind === STREAM_KINDS.LLM_FINISHED
    || payload.kind === STREAM_KINDS.FINISHED
    || payload.kind === STREAM_KINDS.HEARTBEAT
  ) {
    return null;
  }

  if (payload.kind === STREAM_KINDS.PLANNING) {
    const meta = resolvePlanningMeta(eventMessage);
    const metaType = typeof meta?.type === "string" ? meta.type : "";
    if (metaType !== "round_description") {
      return null;
    }
    const description = truncateRunText(String(meta?.text || "").trim(), 300);
    if (!description) {
      return null;
    }
    return {
      key: segmentKey,
      intro: description,
      step: translateDesktopText("正在思考…"),
      status: "running",
      data: {
        __segment_kind: payload.kind,
        __segment_role: "round_description",
      },
    };
  }

  if (payload.kind === STREAM_KINDS.TOOL_CALL_STARTED) {
    const data = resolveToolCallEventData(payload);
    const toolName = String(data.name || "").trim();
    if (!isBrowseTool(toolName)) {
      return null;
    }
    const argsData = data.args_data || {};
    const browseDetail = buildBrowseDetail(toolName, {
      query: String(argsData.query || "").trim(),
      glob: String(argsData.glob || "").trim(),
      path: String(argsData.path || "").trim(),
      pattern: String(argsData.pattern || "").trim(),
    });
    return {
      key: segmentKey,
      intro: translateDesktopText("浏览代码上下文"),
      step: translateDesktopText("正在浏览 0 个文件,0 个搜索"),
      status: "running",
      detail: browseDetail,
      data: {
        __segment_kind: payload.kind,
        __step_type: "browse",
        browse_file_delta: 0,
        browse_search_delta: 0,
        browse_detail: browseDetail,
      },
    };
  }

  if (payload.kind === STREAM_KINDS.TOOL_CALL_FINISHED) {
    const data = resolveToolCallEventData(payload);
    const toolName = String(data.name || "").trim();
    const runOk = data.ok !== false;
    const argsData = data.args_data || {};
    const resultData = data.result_data || {};

    if (isBrowseTool(toolName)) {
      const parsedResultRecord = parseJsonRecord(data.result);
      const parsedRawRecord = parseJsonRecord(resultData.raw);
      const detailText = buildBrowseDetail(toolName, {
        query: String(resultData.query || argsData.query || "").trim(),
        glob: String(resultData.glob || argsData.glob || "").trim(),
        path: String(
          resultData.path
          || parsedResultRecord?.path
          || parsedRawRecord?.path
          || argsData.path
          || "",
        ).trim(),
        pattern: String(resultData.pattern || argsData.pattern || "").trim(),
        count: Number(
          resultData.count
          ?? parsedResultRecord?.count
          ?? parsedRawRecord?.count
          ?? 0,
        ),
      });
      const browseDelta = resolveBrowseCountDelta(toolName);
      return {
        key: segmentKey,
        intro: translateDesktopText("浏览代码上下文"),
        step: translateDesktopText("已浏览 0 个文件,0 个搜索"),
        status: runOk ? "finished" : "failed",
        detail: detailText,
        data: {
          __segment_kind: payload.kind,
          __step_type: "browse",
          browse_file_delta: browseDelta.fileDelta,
          browse_search_delta: browseDelta.searchDelta,
          browse_detail: detailText,
        },
      };
    }

    if (isTerminalTool(toolName)) {
      const command = String(resultData.command || argsData.command || "").trim()
        || String(data.args?.command || "").trim()
        || String(eventMessage || "").trim();
      const statusCode = String(resultData.status ?? "").trim();
      const stdout = String(resultData.stdout || "").trim();
      const stderr = String(resultData.stderr || "").trim();
      const detail = [
        `Command: ${command || "(unknown)"}`,
        statusCode ? `Status: ${statusCode}` : "",
        stdout ? `STDOUT:\n${stdout}` : "",
        stderr ? `STDERR:\n${stderr}` : "",
      ].filter(Boolean).join("\n\n");
      return {
        key: segmentKey,
        intro: translateDesktopText("后台终端"),
        step: translateDesktopText("后台终端已完成以及 {{command}}", {
          command: command || "(unknown)",
        }),
        status: runOk ? "finished" : "failed",
        detail,
        data: {
          __segment_kind: payload.kind,
          __step_type: "terminal",
        },
      };
    }

    if (isEditTool(toolName)) {
      const parsedResultRecord = parseJsonRecord(data.result);
      const parsedRawRecord = parseJsonRecord(resultData.raw);
      const path = String(
        resultData.path
        || parsedResultRecord?.path
        || parsedRawRecord?.path
        || "",
      ).trim();
      const files = Array.isArray(resultData.files) ? resultData.files : [];
      const firstFile = path || String(files[0] || "").trim();
      const fileLabel = firstFile || "unknown";
      const todoWriteCount = Math.max(
        0,
        Math.floor(Number(
          resultData.count
          ?? parsedResultRecord?.count
          ?? parsedRawRecord?.count
          ?? 0,
        )),
      );
      const added = Math.max(
        0,
        Math.floor(Number(resultData.added_lines ?? (toolName === "todo_write" ? todoWriteCount : 0))),
      );
      const removed = Math.max(0, Math.floor(Number(resultData.removed_lines || 0)));
      const contentPreview = truncateRunText(String(resultData.content_preview || "").trim(), 64000);
      const diffPreview = truncateRunText(String(resultData.diff_preview || "").trim(), 64000);
      const detail = diffPreview
        || contentPreview
        || truncateRunText(String(resultData.raw || data.result || eventMessage || "").trim(), 4000);
      return {
        key: segmentKey,
        intro: translateDesktopText("文件修改"),
        step: translateDesktopText("已编辑 {{file}} +{{added}} -{{removed}}", {
          file: fileLabel,
          added,
          removed,
        }),
        status: runOk ? "finished" : "failed",
        detail,
        data: {
          __segment_kind: payload.kind,
          __step_type: "edit",
          edit_file_path: fileLabel,
          edit_added_lines: added,
          edit_removed_lines: removed,
          edit_diff_preview: diffPreview,
          edit_content_preview: contentPreview,
        },
      };
    }

    const fallbackDetail = truncateRunText(
      JSON.stringify(
        {
          message: eventMessage,
          result: data.result || "",
          args: data.args_data || {},
          result_data: data.result_data || {},
        },
        null,
        2,
      ),
      64000,
    );
    return {
      key: segmentKey,
      intro: translateDesktopText("执行过程"),
      step: translateDesktopText("未定义步骤"),
      status: runOk ? "finished" : "failed",
      detail: fallbackDetail,
      data: {
        __segment_kind: payload.kind,
        __step_type: "undefined",
      },
    };
  }

  if (payload.kind === STREAM_KINDS.FINAL) {
    return null;
  }

  if (payload.kind === STREAM_KINDS.CANCELLED) {
    return {
      key: segmentKey,
      intro: translateDesktopText("任务已取消"),
      step: eventMessage || translateDesktopText("当前任务已终止，不再继续执行。"),
      status: "finished",
      data: {
        __segment_kind: payload.kind,
      },
    };
  }

  if (payload.kind === STREAM_KINDS.REQUIRE_APPROVAL) {
    const data = resolveApprovalEventData(payload);
    const approvalToolName = String(data?.tool_name || "").trim() || translateDesktopText("高危操作");
    return {
      key: segmentKey,
      intro: translateDesktopText("需要人工授权"),
      step: translateDesktopText("正在请求执行 {{tool}}", { tool: approvalToolName }),
      status: "running",
      data: buildApprovalSegmentData(payload),
    };
  }

  if (payload.kind === STREAM_KINDS.ERROR) {
    const errorCode = resolveStreamErrorCode(payload);
    return {
      key: segmentKey,
      intro: translateDesktopText("执行失败"),
      step: eventMessage || translateDesktopText("执行失败，请检查错误详情后重试。"),
      status: "failed",
      data: {
        __segment_kind: payload.kind,
        __error_code: errorCode || undefined,
      },
    };
  }

  if (!eventMessage) {
    return null;
  }

  return {
    key: segmentKey,
    intro: translateDesktopText("执行过程"),
    step: translateDesktopText("未定义步骤"),
    status: "running",
    detail: eventMessage,
    data: {
      __segment_kind: payload.kind,
      __step_type: "undefined",
    },
  };
}

// 描述：
//
//   - 判断步骤文本是否属于“占位/低价值”文案，用于执行流收敛与总结提炼。
//
// Params:
//
//   - text: 步骤文本。
//
// Returns:
//
//   - true: 占位或低价值步骤。
function isPlaceholderRunStep(text: string): boolean {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return true;
  }
  return normalized === translateDesktopText("执行结束，正在输出最终结果…")
    || normalized === translateDesktopText("智能体执行完成");
}

// 描述：
//
//   - 从运行步骤中提炼最终摘要，优先选择非占位、可读且非“自动补全 finish”文案。
//
// Params:
//
//   - segments: 运行片段列表。
//
// Returns:
//
//   - 命中的高价值摘要；无命中返回空字符串。
function resolveMeaningfulRunSummary(segments: AssistantRunSegment[]): string {
  const candidate = [...segments]
    .reverse()
    .map((segment) => String(segment.step || "").trim())
    .find((step) =>
      step
      && !isPlaceholderRunStep(step)
      && !step.includes(translateDesktopText("系统自动补全 finish"))
      && !step.startsWith(translateDesktopText("查看本轮 AI 原始返回与可执行脚本详情"))
      && !step.startsWith(translateDesktopText("查看本轮 AI 原始返回与失败脚本详情")));
  return candidate || "";
}

// 描述：
//
//   - 判断运行片段是否属于“待人工授权”片段。
//
// Params:
//
//   - segment: 运行片段。
//
// Returns:
//
//   - true: 授权片段。
function isApprovalPendingSegment(segment: AssistantRunSegment): boolean {
  const segmentKind = segment.data && typeof segment.data.__segment_kind === "string"
    ? segment.data.__segment_kind
    : "";
  return segment.intro === translateDesktopText("需要人工授权") || segmentKind === STREAM_KINDS.REQUIRE_APPROVAL;
}

// 描述：
//
//   - 判断运行片段是否属于“初始化思考占位”片段；该片段仅用于首屏反馈，会在真实进度到达后被替换。
//
// Params:
//
//   - segment: 运行片段。
//
// Returns:
//
//   - true: 初始化思考占位片段。
function isInitialThinkingSegment(segment: AssistantRunSegment): boolean {
  const segmentRole = segment.data && typeof segment.data.__segment_role === "string"
    ? segment.data.__segment_role
    : "";
  return segmentRole === INITIAL_THINKING_SEGMENT_ROLE;
}

// 描述：
//
//   - 判断运行片段是否属于“思考占位”片段；兼容旧版本恢复出来的空标题“正在思考”步骤，
//     确保离开会话后返回时不会把占位片段当成真实执行步骤重复渲染。
//
// Params:
//
//   - segment: 运行片段。
//
// Returns:
//
//   - true: 思考占位片段。
function isThinkingPlaceholderSegment(segment: AssistantRunSegment): boolean {
  if (isInitialThinkingSegment(segment)) {
    return true;
  }
  const normalizedStep = String(segment.step || "").trim();
  if (normalizedStep !== translateDesktopText("正在思考…")) {
    return false;
  }
  const normalizedIntro = String(segment.intro || "").trim();
  return !normalizedIntro
    || normalizedIntro === translateDesktopText("执行过程")
    || normalizedIntro === translateDesktopText("执行片段")
    || normalizedIntro === translateDesktopText("执行进行中");
}

// 描述：
//
//   - 规范化运行片段列表，去掉历史遗留的重复思考占位；若当前仍处于纯等待阶段，
//     则只保留一条统一的初始化思考占位，避免返回会话后出现双“正在思考”或空执行过程组。
//
// Params:
//
//   - segments: 原始运行片段列表。
//
// Returns:
//
//   - 可直接持久化与渲染的规范化片段列表。
function normalizeAssistantRunSegments(segments: AssistantRunSegment[]): AssistantRunSegment[] {
  const sanitizedSegments = segments
    .filter((item) => item && typeof item.key === "string")
    .map<AssistantRunSegment>((item) => ({
      ...item,
      intro: String(item.intro || "").trim(),
      step: String(item.step || "").trim(),
    }))
    .filter((item) => item.intro || item.step)
    .slice(-160);
  if (sanitizedSegments.length === 0) {
    return [];
  }
  const meaningfulSegments = sanitizedSegments.filter((item) => !isThinkingPlaceholderSegment(item));
  if (meaningfulSegments.length > 0) {
    return meaningfulSegments;
  }
  const latestThinkingSegment = [...sanitizedSegments].reverse().find((item) => isThinkingPlaceholderSegment(item));
  if (!latestThinkingSegment) {
    return [];
  }
  return [{
    ...latestThinkingSegment,
    intro: "",
    step: translateDesktopText("正在思考…"),
    status: "running",
    data: {
      ...(latestThinkingSegment.data && typeof latestThinkingSegment.data === "object"
        ? latestThinkingSegment.data
        : {}),
      __segment_role: INITIAL_THINKING_SEGMENT_ROLE,
    },
  }];
}

// 描述：
//
//   - 构建执行流步骤详情文本；仅在存在“额外内容”时返回，避免展开后重复展示同一句话。
//
// Params:
//
//   - segment: 运行片段。
//   - normalizedStep: 步骤文本（已标准化）。
//
// Returns:
//
//   - 可展开详情文本；无额外内容返回空字符串。
function resolveRunSegmentStepDetail(
  segment: AssistantRunSegment,
  normalizedStep: string,
): string {
  const detailText = String(segment.detail || "").trim();
  if (detailText && detailText !== normalizedStep) {
    return detailText;
  }
  return "";
}

// 描述：
//
//   - 将线性运行片段按标题聚合，输出“一标题多步骤”的展示结构。
//
// Params:
//
//   - segments: 线性运行片段列表。
//
// Returns:
//
//   - 标题分组后的步骤结构。
function buildRunSegmentGroups(segments: AssistantRunSegment[]): AssistantRunSegmentGroup[] {
  interface InternalGroup extends AssistantRunSegmentGroup {
    browseState?: {
      stepIndex: number;
      fileCount: number;
      searchCount: number;
      details: string[];
      detailSet: Set<string>;
      running: boolean;
    };
  }

  const groups: InternalGroup[] = [];
  let activeGroupIndex = -1;
  const ensureActiveGroup = (): number => {
    if (activeGroupIndex >= 0 && groups[activeGroupIndex]) {
      return activeGroupIndex;
    }
    groups.push({
      key: `run-group-${groups.length}-${translateDesktopText("执行过程")}`,
      title: translateDesktopText("执行过程"),
      steps: [],
    });
    activeGroupIndex = groups.length - 1;
    return activeGroupIndex;
  };
  const appendStepToGroup = (groupIndex: number, stepItem: AssistantRunSegmentStep) => {
    const targetGroup = groups[groupIndex];
    const lastStep = targetGroup.steps[targetGroup.steps.length - 1];
    if (
      lastStep
      && lastStep.text === stepItem.text
      && lastStep.status === stepItem.status
      && lastStep.detail === stepItem.detail
    ) {
      return;
    }
    targetGroup.steps.push(stepItem);
  };

  segments.forEach((segment, index) => {
    const segmentData = segment.data || {};
    const segmentRole = typeof segmentData.__segment_role === "string" ? segmentData.__segment_role : "";
    const stepType = typeof segmentData.__step_type === "string" ? segmentData.__step_type : "";

    if (segmentRole === INITIAL_THINKING_SEGMENT_ROLE || isThinkingPlaceholderSegment(segment)) {
      // 描述：
      //
      //   - 初始化思考占位由统一底部指示器承载，不在分组内重复渲染步骤。
      return;
    }

    if (segmentRole === "round_description") {
      const title = String(segment.intro || "").trim();
      if (!title) {
        return;
      }
      groups.push({
        key: `run-group-${groups.length}-${title}`,
        title,
        steps: [],
      });
      activeGroupIndex = groups.length - 1;
      return;
    }

    const groupIndex = ensureActiveGroup();
    const currentGroup = groups[groupIndex];
    const normalizedStep = String(segment.step || "").trim();
    const detail = resolveRunSegmentStepDetail(segment, normalizedStep);
    if (stepType === "browse") {
      const fileDelta = Math.max(
        0,
        Math.floor(Number(segmentData.browse_file_delta || 0)),
      );
      const searchDelta = Math.max(
        0,
        Math.floor(Number(segmentData.browse_search_delta || 0)),
      );
      const browseDetail = String(segmentData.browse_detail || segment.detail || "").trim();
      if (!currentGroup.browseState) {
        currentGroup.browseState = {
          stepIndex: currentGroup.steps.length,
          fileCount: 0,
          searchCount: 0,
          details: [],
          detailSet: new Set<string>(),
          running: segment.status === "running",
        };
        currentGroup.steps.push({
          key: `browse-${segment.key}-${index}`,
          status: "running",
          text: translateDesktopText("正在浏览 0 个文件,0 个搜索"),
          detail: "",
          data: {
            __step_type: "browse",
            browse_prefix: translateDesktopText("正在浏览"),
            browse_file_count: 0,
            browse_search_count: 0,
          },
        });
      }
      const browseState = currentGroup.browseState;
      browseState.fileCount += fileDelta;
      browseState.searchCount += searchDelta;
      browseState.running = segment.status === "running";
      if (browseDetail && !browseState.detailSet.has(browseDetail)) {
        browseState.detailSet.add(browseDetail);
        browseState.details.push(browseDetail);
      }
      const stepText = translateDesktopText("{{prefix}} {{fileCount}} 个文件,{{searchCount}} 个搜索", {
        prefix: browseState.running ? translateDesktopText("正在浏览") : translateDesktopText("已浏览"),
        fileCount: browseState.fileCount,
        searchCount: browseState.searchCount,
      });
      const browseStep = currentGroup.steps[browseState.stepIndex];
      if (browseStep) {
        browseStep.status = browseState.running ? "running" : "finished";
        browseStep.text = stepText;
        browseStep.detail = browseState.details.join("\n");
        browseStep.data = {
          __step_type: "browse",
          browse_prefix: browseState.running ? translateDesktopText("正在浏览") : translateDesktopText("已浏览"),
          browse_file_count: browseState.fileCount,
          browse_search_count: browseState.searchCount,
        };
      }
      return;
    }

    if (!normalizedStep) {
      return;
    }
    appendStepToGroup(groupIndex, {
      key: `${segment.key}-${index}`,
      status: segment.status,
      text: normalizedStep,
      detail,
      data: segmentData && typeof segmentData === "object"
        ? { ...segmentData }
        : undefined,
    });
  });

  return groups
    .map((group) => ({
      key: group.key,
      title: group.title,
      steps: group.steps.filter((step) => String(step.text || "").trim()),
    }))
    .filter((group) => group.steps.length > 0 || group.title !== translateDesktopText("执行过程"));
}

// 描述：根据智能体文本流事件判断当前执行阶段，用于无事件时的“心跳提示”文案。
//
// Params:
//
//   - payload: 智能体文本流事件。
//
// Returns:
//
//   - 归一化后的执行阶段。
function resolveAssistantRunStageByAgentTextStream(payload: AgentTextStreamEvent): AssistantRunStage {
  const kind = String(payload.kind || "").trim().toLowerCase();
  const lowerMessage = String(payload.message || "").toLowerCase();
  if (kind === "finished" || kind === "llm_finished") {
    return "finalizing";
  }
  if (kind === "error") {
    return "finalizing";
  }
  if (
    kind.includes("tool")
    || kind.includes("call")
    || kind.includes("execute")
    || kind === "llm_started"
  ) {
    return "executing";
  }
  if (AGENT_BRIDGE_STAGE_HINT_KEYWORDS.some((keyword) => lowerMessage.includes(keyword))) {
    return "bridge";
  }
  return "planning";
}

// 描述：生成等待阶段的“说明 + 步骤”心跳段落，避免长时间无反馈。
//
// Params:
//
//   - stage: 当前执行阶段。
//   - heartbeatCount: 当前心跳次数（从 1 开始）。
//   - segmentKey: 段唯一键。
//
// Returns:
//
//   - 用于进行中渲染的轨迹段。
function buildAssistantHeartbeatSegment(
  stage: AssistantRunStage,
  heartbeatCount: number,
  segmentKey: string,
): AssistantRunSegment {
  const waitedSeconds = Math.max(1, Math.round(heartbeatCount * 1.2));
  const waitSuffix = heartbeatCount > 1
    ? translateDesktopText("（已等待约 {{seconds}} 秒）", { seconds: waitedSeconds })
    : "";
  let intro = translateDesktopText("等待执行状态回传…");
  let step = translateDesktopText("执行仍在进行中，正在同步最新状态。");
  if (stage === "planning") {
    intro = heartbeatCount <= 1
      ? translateDesktopText("正在解析需求并规划执行步骤…")
      : translateDesktopText("正在确认本次操作所需的工具链与任务顺序…{{suffix}}", { suffix: waitSuffix });
    step = translateDesktopText("等待模型返回可执行编排脚本。");
  } else if (stage === "bridge") {
    intro = heartbeatCount <= 1
      ? translateDesktopText("正在检查执行环境与权限状态…")
      : translateDesktopText("等待工具返回环境检查结果…{{suffix}}", { suffix: waitSuffix });
    step = translateDesktopText("环境检查完成后将继续执行当前步骤。");
  } else if (stage === "executing") {
    intro = heartbeatCount <= 1
      ? translateDesktopText("等待工具返回本步结果…")
      : translateDesktopText("持续收集工具执行回传…{{suffix}}", { suffix: waitSuffix });
    step = translateDesktopText("当前步骤仍在执行，请稍候。");
  } else if (stage === "finalizing") {
    intro = translateDesktopText("正在整理执行结果并生成最终总结…{{suffix}}", { suffix: waitSuffix });
    step = translateDesktopText("即将输出最终结果。");
  }

  return {
    key: segmentKey,
    intro,
    step,
    status: "running",
  };
}

// 描述：
//
//   - 将真实 heartbeat 文案补齐等待时长，避免长时间等待时主文案停留在同一句而看起来像“卡住”。
//
// Params:
//
//   - message: 后端透传的 heartbeat 文案。
//   - heartbeatCount: 当前 heartbeat 次数。
//
// Returns:
//
//   - 追加等待时长后的展示文本。
function buildAssistantHeartbeatDisplayText(message: string, heartbeatCount: number): string {
  const normalizedMessage = String(message || "").trim() || translateDesktopText("等待执行结果回传…");
  if (normalizedMessage.includes(translateDesktopText("已等待约"))) {
    return normalizedMessage;
  }
  if (heartbeatCount <= 1) {
    return normalizedMessage;
  }
  const waitedSeconds = Math.max(1, Math.round(heartbeatCount * 1.2));
  return `${normalizedMessage}${translateDesktopText("（已等待约 {{seconds}} 秒）", { seconds: waitedSeconds })}`;
}

// 描述：
//
//   - 将 planning 事件转换为主消息可读文本；命中轮次描述时优先使用模型返回的任务说明。
//
// Params:
//
//   - payload: 智能体文本流事件。
//
// Returns:
//
//   - 可直接展示的 planning 文案；无可读内容时返回空字符串。
function resolvePlanningDisplayText(payload: AgentTextStreamEvent): string {
  const eventMessage = String(payload.message || "").trim();
  if (!eventMessage) {
    return "";
  }
  const meta = resolvePlanningMeta(eventMessage);
  const metaType = typeof meta?.type === "string" ? meta.type : "";
  if (metaType === "round_description") {
    return truncateRunText(String(meta?.text || "").trim(), 300);
  }
  return eventMessage.startsWith(PLANNING_META_PREFIX) ? "" : eventMessage;
}

// 描述：
//
//   - 规范化失败总结展示信息，输出“失败详情 + 建议”结构，避免纯文本提示可读性差。
//
// Params:
//
//   - rawSummary: 原始失败总结文本。
//
// Returns:
//
//   - 失败展示模型。
function buildAssistantFailureSummary(rawSummary: string): { detail: string; hint: string } {
  const raw = String(rawSummary || "").trim();
  const detail = raw.replace(/^执行失败[:：]\s*/u, "").trim() || translateDesktopText("执行过程中出现异常，请稍后重试。");
  const lower = detail.toLowerCase();
  if (lower.includes("provider") && lower.includes("not implemented")) {
    return {
      detail,
      hint: translateDesktopText("当前 Provider 暂未实现该能力，请切换为 Codex CLI 后重试。"),
    };
  }
  if (AGENT_TIMEOUT_HINT_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return {
      detail,
      hint: translateDesktopText("执行超时，建议稍后重试，或切换执行策略后再试。"),
    };
  }
  return {
    detail,
    hint: translateDesktopText("请重试，或切换执行策略后再试。"),
  };
}

// 描述：
//
//   - 解析运行中底部指示器文案；优先展示当前助手消息中已经拿到的真实进度文本，
//     避免离开会话后返回只能看到泛化的“正在思考…”。
//
// Params:
//
//   - messageText: 当前助手消息文本。
//   - runMeta: 当前助手消息绑定的运行态。
//
// Returns:
//
//   - 底部运行中指示器文案。
function resolveRunningIndicatorText(
  messageText: string,
  runMeta?: AssistantRunMeta,
): string {
  const normalizedMessageText = String(messageText || "").trim();
  if (normalizedMessageText && normalizedMessageText !== translateDesktopText("正在思考…")) {
    return normalizedMessageText;
  }
  const normalizedSummary = String(runMeta?.summary || "").trim();
  if (normalizedSummary && normalizedSummary !== translateDesktopText("正在思考…")) {
    return normalizedSummary;
  }
  return translateDesktopText("正在思考…");
}

// 描述：
//
//   - 判断运行中文案是否属于泛化占位；这些文本缺少具体进展语义，恢复会话时应优先让位给更具体的缓存消息或执行总结。
//
// Params:
//
//   - value: 待判断的运行中文案。
//
// Returns:
//
//   - true: 属于泛化占位文案。
function isGenericRunningIndicatorText(value: string): boolean {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return true;
  }
  return normalizedValue === translateDesktopText("正在思考…")
    || normalizedValue === translateDesktopText("正在准备执行...")
    || normalizedValue === translateDesktopText("正在生成执行结果…")
    || normalizedValue === translateDesktopText("正在整理输出...")
    || normalizedValue === translateDesktopText("智能体正在思考…");
}

// 描述：
//
//   - 在恢复执行中会话时，优先使用已持久化的真实助手文本；若缓存里只有泛化占位，再回退到运行总结或最后步骤。
//
// Params:
//
//   - messages: 当前会话的已持久化消息列表。
//   - messageId: 当前运行中的助手消息 ID。
//   - runMeta: 当前运行态。
//
// Returns:
//
//   - 恢复后应展示的助手消息文本。
function resolveRecoveredAssistantMessageText(
  messages: MessageItem[],
  messageId: string,
  runMeta: AssistantRunMeta | undefined,
): string {
  const normalizedMessageId = String(messageId || "").trim();
  const storedMessageText = normalizedMessageId
    ? String(
      messages.find((item) => item.role === "assistant" && String(item.id || "").trim() === normalizedMessageId)?.text || "",
    ).trim()
    : "";
  const summaryText = String(runMeta?.summary || "").trim();
  const lastStepText = String(runMeta?.segments.slice(-1)[0]?.step || "").trim();
  if (summaryText && (!storedMessageText || isGenericRunningIndicatorText(storedMessageText))) {
    return summaryText;
  }
  if (storedMessageText) {
    return storedMessageText;
  }
  if (summaryText) {
    return summaryText;
  }
  if (lastStepText) {
    return lastStepText;
  }
  return translateDesktopText("等待工具返回本步结果…");
}

// 描述：
//
//   - 判断失败文本是否属于“Gemini Provider 未实现”场景，用于重试时自动回退到 Codex。
//
// Params:
//
//   - raw: 助手失败文本。
//
// Returns:
//
//   - true 表示命中 Gemini 未实现错误。
function isGeminiProviderNotImplementedError(raw: string): boolean {
  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes("gemini provider is not implemented yet")
    || normalized.includes("core.agent.llm.provider_not_implemented");
}


// 描述：把持久化运行态转换为页面运行态结构，过滤非法片段并补齐默认值。
//
// Params:
//
//   - input: 持久化运行态。
//
// Returns:
//
//   - 页面可用的运行态。
function normalizePersistedRunMeta(input: PersistedSessionRunMeta): AssistantRunMeta {
  const segments = Array.isArray(input.segments)
    ? normalizeAssistantRunSegments(
      input.segments.map<AssistantRunSegment>((item) => ({
        key: String(item.key),
        intro: String(item.intro || "").trim(),
        step: String(item.step || "").trim(),
        status:
          item.status === "failed"
            ? "failed"
            : item.status === "finished"
              ? "finished"
              : "running",
        // 描述：
        //
        //   - 持久化恢复时保留 data 透传字段（如 approval_id、tool_args、segment kind），
        //     避免离开页面后返回会话无法继续人工授权。
        data: item.data && typeof item.data === "object"
          ? (item.data as Record<string, unknown>)
          : undefined,
        detail: typeof item.detail === "string" ? item.detail : undefined,
      })),
    )
    : [];
  return {
    status: input.status === "failed" ? "failed" : input.status === "finished" ? "finished" : "running",
    startedAt: Number(input.startedAt || Date.now()),
    finishedAt: input.finishedAt ? Number(input.finishedAt) : undefined,
    collapsed: Boolean(input.collapsed),
    summary: String(input.summary || ""),
    segments,
  };
}

export function SessionPage({
  agentKey,
  sessionId,
  sessionUiConfig,
  currentUser,
  dccMcpCapabilities,
  aiKeys,
}: SessionPageProps) {
  const { t, formatDateTime } = useDesktopI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state || {}) as SessionRouteState;
  const routeAutoPrompt = String(routeState.autoPrompt || "").trim();
  const routePreferredWorkflowId = String(routeState.preferredWorkflowId || "").trim();
  const routePreferredSkillIds = Array.isArray(routeState.preferredSkillIds)
    ? routeState.preferredSkillIds
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0)
    : [];
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [sandboxMetrics, setSandboxMetrics] = useState<AgentSandboxMetrics | null>(null);

  // 描述：格式化内存字节数为可读文本，兼容 B/KB/MB/GB/TB。
  const formatMemory = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const unitBase = 1024;
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(
      Math.floor(Math.log(bytes) / Math.log(unitBase)),
      units.length - 1,
    );
    const value = bytes / unitBase ** exponent;
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[exponent]}`;
  };

  // 描述：格式化时长。
  const formatUptime = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    return `${mins}m ${secs % 60}s`;
  };

  useEffect(() => {
    if (!sessionId) return;
    const fetchMetrics = async () => {
      try {
        const res = await invoke<AgentSandboxMetrics | null>(COMMANDS.GET_AGENT_SANDBOX_METRICS, { sessionId });
        if (res) setSandboxMetrics(res);
      } catch (err) {
        // 忽略后台轮询错误
      }
    };
    fetchMetrics();
    const timer = setInterval(fetchMetrics, 10000);
    return () => clearInterval(timer);
  }, [sessionId]);
  const [sending, setSending] = useState(false);
  const [stepRecords, setStepRecords] = useState<AgentStepRecord[]>([]);
  const [eventRecords, setEventRecords] = useState<AgentEventRecord[]>([]);
  const [uiHint, setUiHint] = useState<WorkflowUiHint | null>(null);
  const [traceRecords, setTraceRecords] = useState<TraceRecord[]>([]);
  const [debugFlowRecords, setDebugFlowRecords] = useState<SessionDebugFlowRecord[]>([]);
  const [pendingDangerousPrompt, setPendingDangerousPrompt] = useState("");
  const [pendingDangerousToken, setPendingDangerousToken] = useState("");
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [sessionMenuVersion, setSessionMenuVersion] = useState(0);
  const [messagesHydrated, setMessagesHydrated] = useState(false);
  const [hydratedSessionKey, setHydratedSessionKey] = useState("");
  const [hoveredRetryTooltipMessageId, setHoveredRetryTooltipMessageId] = useState("");
  const [dependencyRuleConfirmState, setDependencyRuleConfirmState] = useState<DependencyRuleConfirmState | null>(null);
  const [dependencyRuleUpgrading, setDependencyRuleUpgrading] = useState(false);
  const headerSlotElement = useDesktopHeaderSlot();
  // 描述：解析当前会话 UI 配置，未传入时回退统一智能体默认配置。
  const resolvedSessionUiConfig = sessionUiConfig || resolveSessionUiConfig(agentKey);
  const normalizedAgentKey: AgentKey = "agent";
  const [sessionTitle, setSessionTitle] = useState(() => resolveAgentSessionTitle(normalizedAgentKey, sessionId));
  const sessionStorageKey = `${normalizedAgentKey}:${sessionId || "__none__"}`;
  const title = sessionTitle || resolveAgentSessionTitle(normalizedAgentKey, sessionId);
  const workspaceIdFromRouteState = String(routeState.workspaceId || "").trim();
  // 描述：从 URL 查询参数中提取目录上下文，兼容侧边栏与页面跳转携带方式。
  const workspaceIdFromQuery = useMemo(
    () => new URLSearchParams(location.search).get("workspaceId")?.trim() || "",
    [location.search],
  );
  // 描述：从本地会话绑定关系中恢复当前会话所属项目目录。
  const workspaceIdFromBinding = useMemo(
    () => getProjectWorkspaceIdBySessionId(sessionId),
    [sessionId],
  );
  // 描述：解析当前会话所属目录详情（路径、名称、依赖规则），用于会话提示与规则校验。
  const activeWorkspace = useMemo(() => {
    const workspaceId = workspaceIdFromRouteState || workspaceIdFromQuery || workspaceIdFromBinding;
    if (!workspaceId) {
      return null;
    }
    return getProjectWorkspaceGroupById(workspaceId);
  }, [workspaceIdFromBinding, workspaceIdFromQuery, workspaceIdFromRouteState]);
  // 描述：提取当前会话一级目录名称，展示在标题后方。
  const workspaceGroupName = useMemo(() => {
    return String(activeWorkspace?.name || "").trim();
  }, [activeWorkspace?.name]);
  // 描述：解析当前项目已启用的项目能力，供工作流能力校验、结构化信息注入与依赖策略检查统一复用。
  const activeWorkspaceEnabledCapabilities = useMemo<ProjectWorkspaceCapabilityId[]>(
    () => (activeWorkspace?.enabledCapabilities || []) as ProjectWorkspaceCapabilityId[],
    [activeWorkspace?.enabledCapabilities],
  );
  // 描述：当会话处于二级目录（如 project workspace）时，在标题后展示一级菜单名（纯名字）。
  const sessionHeadParentHint = workspaceGroupName;

  const [activeProjectProfile, setActiveProjectProfile] = useState<ProjectWorkspaceProfile | null>(null);

  // 描述：
  //
  //   - 会话切换目录时加载当前项目结构化信息缓存，供后续发送请求直接复用。
  useEffect(() => {
    if (!activeWorkspace?.id) {
      setActiveProjectProfile(null);
      return;
    }
    setActiveProjectProfile(getProjectWorkspaceProfile(activeWorkspace.id));
  }, [activeWorkspace?.id]);

  // 描述：
  //
  //   - 监听结构化项目信息广播事件，保持同项目多话题会话上下文缓存实时一致。
  useEffect(() => {
    if (!IS_BROWSER || !activeWorkspace?.id) {
      return;
    }
    const onProjectWorkspaceProfileUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ workspaceId?: string; revision?: number }>;
      const workspaceId = String(customEvent.detail?.workspaceId || "").trim();
      if (!workspaceId || workspaceId !== activeWorkspace.id) {
        return;
      }
      setActiveProjectProfile(getProjectWorkspaceProfile(activeWorkspace.id));
    };
    window.addEventListener(
      PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT,
      onProjectWorkspaceProfileUpdated as EventListener,
    );
    return () => {
      window.removeEventListener(
        PROJECT_WORKSPACE_PROFILE_UPDATED_EVENT,
        onProjectWorkspaceProfileUpdated as EventListener,
      );
    };
  }, [activeWorkspace?.id]);

  const isSessionPinned = useMemo(
    () => getAgentSessionMetaSnapshot().pinnedIds.includes(sessionId),
    [sessionId, sessionMenuVersion],
  );
  const sessionHeadMenuItems = useMemo(
    () => [
      {
        key: "pin",
        label: isSessionPinned ? t("取消固定会话") : t("固定会话"),
      },
      {
        key: "rename",
        label: t("重命名会话"),
      },
      {
        key: "delete",
        label: t("删除会话"),
      },
    ],
    [isSessionPinned, t],
  );
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [assistantRunMetaMap, setAssistantRunMetaMap] = useState<Record<string, AssistantRunMeta>>({});
  const [sessionApprovedToolNames, setSessionApprovedToolNames] = useState<string[]>([]);
  const [expandedRunSegmentDetailMap, setExpandedRunSegmentDetailMap] = useState<Record<string, boolean>>({});
  const [sessionAiPromptRaw, setSessionAiPromptRaw] = useState("");
  const [sessionAiResponseRaw, setSessionAiResponseRaw] = useState("");
  const [sessionAiRawByMessage, setSessionAiRawByMessage] = useState<Record<string, SessionAiRawByMessageItem>>({});
  // 描述：过滤可用 AI Provider 列表，保留已启用项或已配置 key 的项。
  const availableAiKeys = useMemo(
    () =>
      aiKeys.filter(
        (item) => {
          const provider = String(item.provider || "").trim();
          const keyValue = String(item.keyValue || "").trim();
          // 描述：本地 CLI Provider 必须由“启用开关”控制，避免关闭后仍在下拉可选。
          if (provider === "codex" || provider === "gemini-cli") {
            return item.enabled;
          }
          return item.enabled || keyValue.length > 0;
        },
      ),
    [aiKeys],
  );
  const [selectedProvider, setSelectedProvider] = useState<string>(
    () => resolveAgentSessionSelectedAiProvider(sessionId),
  );
  // 描述：解析当前选中的 Provider，未命中时回退到列表首项。
  const selectedAi = useMemo(
    () => availableAiKeys.find((item) => item.provider === selectedProvider) || availableAiKeys[0] || null,
    [availableAiKeys, selectedProvider],
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    () => routePreferredWorkflowId || readSelectedWorkflowId(AGENT_WORKFLOW_SELECTED_KEY),
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    () => routePreferredSkillIds.length > 0 ? routePreferredSkillIds : readSelectedSkillIds(AGENT_SKILL_SELECTED_KEY),
  );
  const [selectedDccSoftware, setSelectedDccSoftware] = useState<string>(
    () => resolveAgentSessionSelectedDccSoftware(sessionId),
  );
  const [pendingDccSelection, setPendingDccSelection] = useState<PendingDccSelectionState | null>(null);
  const [workflowSkillModalVisible, setWorkflowSkillModalVisible] = useState(false);
  const [draftWorkflowId, setDraftWorkflowId] = useState("");
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);
  const [availableSkills, setAvailableSkills] = useState<AgentSkillItem[]>([]);
  // 描述：
  //
  //   - 会话中的工作流选择器只展示“已注册”工作流，避免未注册内置模板直接出现在执行策略列表中。
  const workflows = useMemo<AgentWorkflowDefinition[]>(
    () => listAgentWorkflowOverview().registered,
    [],
  );
  const selectedWorkflow = useMemo<AgentWorkflowDefinition | null>(() => {
    if (selectedSkillIds.length > 0) {
      return null;
    }
    return workflows.find((item) => item.id === selectedWorkflowId) || workflows[0] || null;
  }, [workflows, selectedSkillIds.length, selectedWorkflowId]);
  const workflowMenuItems = useMemo(
    () =>
      workflows.map((workflow) => ({
        key: workflow.id,
        label: workflow.name,
        description: String(workflow.description || "").trim(),
      })),
    [workflows],
  );
  const activeSelectedSkillIds = selectedSkillIds;
  const selectedSessionSkills = useMemo(
    () => availableSkills.filter((item) => activeSelectedSkillIds.includes(item.id)),
    [activeSelectedSkillIds, availableSkills],
  );
  const activeUsesDccModelingSkill = useMemo(() => {
    if (selectedSessionSkills.some((item) => isDccModelingSkill(item))) {
      return true;
    }
    return Boolean(
      (selectedWorkflow?.graph?.nodes || []).some(
        (node) => node.type === "skill" && normalizeAgentSkillId(String(node.skillId || "").trim()) === DCC_MODELING_SKILL_ID,
      ),
    );
  }, [selectedSessionSkills, selectedWorkflow]);
  const aiSelectOptions = useMemo(
    () =>
      availableAiKeys.map((item) => ({
        value: item.provider,
        label: item.providerLabel,
      })),
    [availableAiKeys],
  );
  const workflowSkillSelectorLabel = useMemo(() => {
    if (selectedSessionSkills.length > 0) {
      return selectedSessionSkills[0]?.name || t("技能");
    }
    return selectedWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel;
  }, [
    t,
    resolvedSessionUiConfig.workflowFallbackLabel,
    selectedWorkflow?.name,
    selectedSessionSkills,
  ]);
  const workflowSkillSelectOptions = useMemo(
    () => [
      {
        value: "workflow_skill",
        label: workflowSkillSelectorLabel,
      },
    ],
    [workflowSkillSelectorLabel],
  );
  const activeSelectedWorkflowId = selectedWorkflow?.id || "";
  // 描述：计算当前工作流缺失的必需项目能力；若缺失则发送前直接阻断，并提示用户到项目设置中启用。
  const selectedWorkflowMissingRequiredCapabilities = useMemo(() => {
    return (selectedWorkflow?.requiredCapabilities || []).filter(
      (capabilityId) => !activeWorkspaceEnabledCapabilities.includes(capabilityId),
    );
  }, [activeWorkspaceEnabledCapabilities, selectedWorkflow?.requiredCapabilities]);

  // 描述：以下 refs 用于维护流式渲染、去重、心跳与定时器状态，避免高频更新触发重复渲染。
  const streamMessageIdRef = useRef("");
  const stepRecordsRef = useRef<AgentStepRecord[]>([]);
  const eventRecordsRef = useRef<AgentEventRecord[]>([]);
  const streamDisplayedTextRef = useRef("");
  const streamLatestTextRef = useRef("");
  const streamRenderPendingRef = useRef(false);
  const streamRenderFrameRef = useRef<number | null>(null);
  const sessionMessagePersistTimerRef = useRef<number | null>(null);
  const sessionRunStatePersistTimerRef = useRef<number | null>(null);
  const debugSnapshotTimerRef = useRef<number | null>(null);
  const activeAgentStreamTraceRef = useRef("");
  const agentStreamTextBufferRef = useRef("");
  const agentStreamSeenKeysRef = useRef<Set<string>>(new Set());
  const assistantRunHeartbeatTimerRef = useRef<number | null>(null);
  const assistantRunLastActivityAtRef = useRef(0);
  const assistantRunHeartbeatCountRef = useRef(0);
  const assistantRunStageRef = useRef<AssistantRunStage>("planning");
  const assistantRunStatusRef = useRef<AssistantRunMeta["status"] | "idle">("idle");
  const agentPromptRawRef = useRef("");
  const agentLlmDeltaBufferRef = useRef("");
  const agentLlmResponseRawRef = useRef("");
  const autoPromptDispatchedRef = useRef(false);
  const assistantRunMetaMapRef = useRef<Record<string, AssistantRunMeta>>({});
  const messagesRef = useRef<MessageItem[]>([]);
  const sendingRef = useRef(false);
  const sessionApprovedToolNameSetRef = useRef<Set<string>>(new Set());

  // 描述：停止当前会话流式渲染调度，避免会话切换后残留异步刷新。
  const stopStreamTypingTimer = () => {
    if (streamRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(streamRenderFrameRef.current);
      streamRenderFrameRef.current = null;
    }
    streamRenderPendingRef.current = false;
  };

  // 描述：清理会话消息持久化定时器，避免频繁 localStorage 写入造成主线程阻塞。
  const clearSessionMessagePersistTimer = () => {
    if (sessionMessagePersistTimerRef.current !== null) {
      window.clearTimeout(sessionMessagePersistTimerRef.current);
      sessionMessagePersistTimerRef.current = null;
    }
  };

  // 描述：清理会话运行态持久化定时器，避免执行流高频事件触发同步写入卡顿。
  const clearSessionRunStatePersistTimer = () => {
    if (sessionRunStatePersistTimerRef.current !== null) {
      window.clearTimeout(sessionRunStatePersistTimerRef.current);
      sessionRunStatePersistTimerRef.current = null;
    }
  };

  // 描述：清理调试快照定时器，避免 Dev 调试面板在流式期间过高频刷新。
  const clearDebugSnapshotTimer = () => {
    if (debugSnapshotTimerRef.current !== null) {
      window.clearTimeout(debugSnapshotTimerRef.current);
      debugSnapshotTimerRef.current = null;
    }
  };

  // 描述：清理会话心跳提示定时器，避免会话结束后继续追加“进行中”段落。
  const clearAssistantRunHeartbeatTimer = () => {
    if (assistantRunHeartbeatTimerRef.current !== null) {
      window.clearTimeout(assistantRunHeartbeatTimerRef.current);
      assistantRunHeartbeatTimerRef.current = null;
    }
  };

  // 描述：根据目标文本与当前已展示文本计算下一帧可见内容，形成“逐步出现”效果。
  //
  // Params:
  //
  //   - currentText: 当前已展示内容。
  //   - targetText: 目标完整内容。
  //
  // Returns:
  //
  //   - 下一帧应展示的文本内容。
  const buildNextStreamingText = (currentText: string, targetText: string) => {
    if (currentText === targetText) {
      return targetText;
    }
    if (targetText.length < currentText.length) {
      return targetText;
    }
    if (!targetText.startsWith(currentText)) {
      const bootstrapChunkSize = Math.max(1, Math.min(8, targetText.length));
      return targetText.slice(0, bootstrapChunkSize);
    }
    const remainingLength = targetText.length - currentText.length;
    const adaptiveChunkSize = Math.max(1, Math.min(24, Math.ceil(Math.max(targetText.length, 1) / 80)));
    const chunkSize = Math.max(1, Math.min(remainingLength, adaptiveChunkSize));
    return targetText.slice(0, currentText.length + chunkSize);
  };

  // 描述：按帧执行流式文本渲染，支持在无后端 delta 时也能平滑展示最终结果。
  const renderStreamingAssistantFrame = () => {
    const messageId = streamMessageIdRef.current;
    if (!messageId) {
      streamRenderPendingRef.current = false;
      streamRenderFrameRef.current = null;
      return;
    }
    const targetText = streamLatestTextRef.current;
    const currentText = streamDisplayedTextRef.current;
    const nextText = buildNextStreamingText(currentText, targetText);
    if (nextText !== currentText) {
      streamDisplayedTextRef.current = nextText;
      setMessages((prev) => upsertAssistantMessageById(prev, messageId, nextText));
    }
    if (nextText === targetText) {
      streamRenderPendingRef.current = false;
      streamRenderFrameRef.current = null;
      return;
    }
    streamRenderFrameRef.current = window.requestAnimationFrame(renderStreamingAssistantFrame);
  };

  // 描述：设置当前流式消息目标文本，并触发逐帧渲染。
  const setStreamingAssistantTarget = (targetText: string) => {
    const messageId = streamMessageIdRef.current;
    if (!messageId) {
      return;
    }
    streamLatestTextRef.current = targetText;
    if (streamRenderPendingRef.current) {
      return;
    }
    streamRenderPendingRef.current = true;
    streamRenderFrameRef.current = window.requestAnimationFrame(renderStreamingAssistantFrame);
  };

  // 描述：向指定助手消息追加一段执行轨迹，保持“说明 + 步骤”循环结构。
  const appendAssistantRunSegment = (messageId: string, segment: AssistantRunSegment) => {
    if (!messageId) {
      return;
    }
    setAssistantRunMetaMap((prev) => {
      const current = prev[messageId];
      if (!current) {
        return prev;
      }
      // 描述：初始化阶段仅保留一条“正在思考”占位；一旦收到真实片段，立即替换，避免出现“用户原文闪烁”。
      const baseSegments = current.segments.length === 1
        && isInitialThinkingSegment(current.segments[0])
        && !isInitialThinkingSegment(segment)
        ? []
        : current.segments;
      const last = baseSegments[baseSegments.length - 1];
      const isDuplicate = Boolean(
        last
        && last.intro === segment.intro
        && last.step === segment.step
        && last.status === segment.status
        && String(last.detail || "") === String(segment.detail || ""),
      );
      if (isDuplicate) {
        return prev;
      }
      // 描述：保证同一时刻仅有一个 running 段，避免出现多个“同时闪烁”的进行中步骤。
      // 例外：人工授权片段在收到“工具完成/终态”前必须保持 running，防止授权卡片提前消失。
      const incomingSegmentKind = segment.data && typeof segment.data.__segment_kind === "string"
        ? segment.data.__segment_kind
        : "";
      const shouldResolveApprovalPending = incomingSegmentKind === STREAM_KINDS.TOOL_CALL_FINISHED
        || incomingSegmentKind === STREAM_KINDS.ERROR
        || incomingSegmentKind === STREAM_KINDS.CANCELLED
        || incomingSegmentKind === STREAM_KINDS.FINISHED
        || incomingSegmentKind === STREAM_KINDS.FINAL;
      const incomingStepText = String(segment.step || "").trim();
      const incomingErrorCode = segment.data && typeof segment.data.__error_code === "string"
        ? String(segment.data.__error_code || "").trim()
        : "";
      const isHumanRefusedError = incomingSegmentKind === STREAM_KINDS.ERROR
        && (
          incomingErrorCode === "core.agent.human_refused"
          || incomingStepText.includes(t("拒绝"))
          || incomingStepText.toLowerCase().includes("reject")
        );
      const normalizedSegments = baseSegments.map((item) => {
        if (item.status !== "running") {
          return item;
        }
        if (!isApprovalPendingSegment(item)) {
          return { ...item, status: "finished" as const };
        }
        if (!shouldResolveApprovalPending) {
          return item;
        }
        const toolName = String(
          item.data && typeof item.data.tool_name === "string" ? item.data.tool_name : "",
        ).trim();
        if (isHumanRefusedError) {
          return {
            ...item,
            status: "failed" as const,
            step: t("已拒绝 {{tool}} 的执行请求。", { tool: toolName || t("该工具") }),
            data: {
              ...(item.data && typeof item.data === "object" ? item.data : {}),
              __step_type: "approval_decision",
              approval_decision: "rejected",
              approval_tool_name: toolName || t("该工具"),
            },
          };
        }
        if (incomingSegmentKind === STREAM_KINDS.CANCELLED) {
          return {
            ...item,
            status: "finished" as const,
            step: t("授权流程已取消，未执行 {{tool}}。", { tool: toolName || t("该工具") }),
            data: {
              ...(item.data && typeof item.data === "object" ? item.data : {}),
              __step_type: "approval_decision",
              approval_decision: "cancelled",
              approval_tool_name: toolName || t("该工具"),
            },
          };
        }
        return {
          ...item,
          status: "finished" as const,
          step: t("已处理 {{tool}} 的授权请求。", { tool: toolName || t("该工具") }),
          data: {
            ...(item.data && typeof item.data === "object" ? item.data : {}),
            __step_type: "approval_decision",
            approval_decision: "handled",
            approval_tool_name: toolName || t("该工具"),
          },
        };
      });
      return {
        ...prev,
        [messageId]: {
          ...current,
          segments: normalizeAssistantRunSegments([...normalizedSegments, segment]),
        },
      };
    });
  };

  // 描述：
  //
  //   - 同步运行态 ref，供心跳等异步回调读取最新授权状态，避免闭包读取旧值。
  useEffect(() => {
    assistantRunMetaMapRef.current = assistantRunMetaMap;
  }, [assistantRunMetaMap]);

  // 描述：
  //
  //   - 同步消息 ref，供页面切走时立即刷盘，避免节流持久化尚未触发就丢失最新进度文案。
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 描述：
  //
  //   - 同步发送态 ref，供页面卸载或会话切换时持久化当前运行状态。
  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  // 描述：
  //
  //   - 同步“会话内已批准工具”集合到 ref，供流式事件回调快速判定是否自动放行授权。
  useEffect(() => {
    sessionApprovedToolNameSetRef.current = new Set(
      (sessionApprovedToolNames || [])
        .map((toolName) => normalizeApprovalToolName(toolName))
        .filter((toolName) => Boolean(toolName)),
    );
  }, [sessionApprovedToolNames]);

  // 描述：启动智能体执行心跳，在长时间无流式事件时持续补充用户可见进度。
  //
  // Params:
  //
  //   - messageId: 当前执行消息 ID。
  const startAssistantRunHeartbeat = (messageId: string) => {
    clearAssistantRunHeartbeatTimer();
    const tick = () => {
      const stillRunning = assistantRunStatusRef.current === "running";
      const isCurrentMessage = streamMessageIdRef.current === messageId;
      if (!stillRunning || !isCurrentMessage) {
        clearAssistantRunHeartbeatTimer();
        return;
      }

      const currentMeta = assistantRunMetaMapRef.current[messageId];
      const pendingApproval = Boolean(
        currentMeta
        && currentMeta.status === "running"
        && currentMeta.segments.some((item) => item.status === "running" && isApprovalPendingSegment(item)),
      );
      const idleMs = Date.now() - assistantRunLastActivityAtRef.current;
      if (!pendingApproval && idleMs >= 1400) {
        assistantRunHeartbeatCountRef.current += 1;
        const heartbeatSegment = buildAssistantHeartbeatSegment(
          assistantRunStageRef.current,
          assistantRunHeartbeatCountRef.current,
          `heartbeat-${Date.now()}`,
        );
        // 描述：
        //
        //   - 心跳仅用于“正在思考”提示，不再写入执行步骤，避免产生无信息价值的噪声步骤。
        setStreamingAssistantTarget(String(heartbeatSegment.intro || "").trim() || t("智能体正在思考…"));
        assistantRunLastActivityAtRef.current = Date.now();
      }
      assistantRunHeartbeatTimerRef.current = window.setTimeout(tick, 1200);
    };
    assistantRunHeartbeatTimerRef.current = window.setTimeout(tick, 1200);
  };

  // 描述：更新助手执行消息最终态（完成/失败），并写入总结文本与折叠状态。
  const finishAssistantRunMessage = (
    messageId: string,
    status: "finished" | "failed",
    summary: string,
  ) => {
    if (!messageId) {
      return;
    }
    const finishedAt = Date.now();
    assistantRunStatusRef.current = status;
    assistantRunLastActivityAtRef.current = finishedAt;
    clearAssistantRunHeartbeatTimer();
    setAssistantRunMetaMap((prev) => {
      const current = prev[messageId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [messageId]: {
          ...current,
          status,
          finishedAt,
          collapsed: status === "finished",
          summary: summary.trim(),
        },
      };
    });
  };

  // 描述：切换执行消息轨迹详情折叠状态，供“用时分割线”点击展开/收起。
  const toggleAssistantRunMetaCollapsed = (messageId: string) => {
    setAssistantRunMetaMap((prev) => {
      const current = prev[messageId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [messageId]: {
          ...current,
          collapsed: !current.collapsed,
        },
      };
    });
  };

  // 描述：切换运行片段详情展开态，供“脚本详情”查看按钮复用。
  //
  // Params:
  //
  //   - detailKey: 详情键（messageId + segmentKey）。
  const toggleRunSegmentDetailExpanded = (detailKey: string) => {
    if (!detailKey) {
      return;
    }
    setExpandedRunSegmentDetailMap((prev) => ({
      ...prev,
      [detailKey]: !prev[detailKey],
    }));
  };

  const appendTraceRecord = (input: TraceRecord) => {
    setTraceRecords((prev) => [input, ...prev].slice(0, 50));
  };

  // 描述：写入 Dev 调试全链路记录，覆盖“请求→执行→返回→解析”关键节点。
  //
  // Params:
  //
  //   - source: 记录来源（前端/后端）。
  //   - stage: 阶段编码。
  //   - title: 阶段标题。
  //   - detail: 详细内容。
  const appendDebugFlowRecord = (
    source: SessionDebugFlowRecord["source"],
    stage: string,
    title: string,
    detail: string,
  ) => {
    if (!import.meta.env.DEV) {
      return;
    }
    const normalizedDetail = detail.trim();
    if (!normalizedDetail) {
      return;
    }
    setDebugFlowRecords((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source,
        stage,
        title,
        detail: normalizedDetail,
        timestamp: Date.now(),
      },
      ...prev,
    ].slice(0, 400));
  };

  useEffect(() => {
    stepRecordsRef.current = stepRecords;
  }, [stepRecords]);

  useEffect(() => {
    eventRecordsRef.current = eventRecords;
  }, [eventRecords]);

  useEffect(() => {
    setSessionTitle(resolveAgentSessionTitle(normalizedAgentKey, sessionId));
  }, [normalizedAgentKey, sessionId]);

  useEffect(() => {
    const onSessionTitleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; title?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId !== sessionId) {
        return;
      }
      setSessionTitle(detail.title || resolveAgentSessionTitle(normalizedAgentKey, sessionId));
    };
    window.addEventListener(SESSION_TITLE_UPDATED_EVENT, onSessionTitleUpdated as EventListener);
    return () => {
      window.removeEventListener(SESSION_TITLE_UPDATED_EVENT, onSessionTitleUpdated as EventListener);
    };
  }, [normalizedAgentKey, sessionId]);

  useEffect(() => {
    stopStreamTypingTimer();
    clearSessionMessagePersistTimer();
    clearSessionRunStatePersistTimer();
    clearDebugSnapshotTimer();
    clearAssistantRunHeartbeatTimer();
    streamMessageIdRef.current = "";
    stepRecordsRef.current = [];
    eventRecordsRef.current = [];
    streamDisplayedTextRef.current = "";
    streamLatestTextRef.current = "";
    activeAgentStreamTraceRef.current = "";
    agentStreamTextBufferRef.current = "";
    agentStreamSeenKeysRef.current.clear();
    assistantRunHeartbeatCountRef.current = 0;
    assistantRunLastActivityAtRef.current = 0;
    assistantRunStageRef.current = "planning";
    assistantRunStatusRef.current = "idle";
    agentPromptRawRef.current = "";
    agentLlmDeltaBufferRef.current = "";
    agentLlmResponseRawRef.current = "";
    autoPromptDispatchedRef.current = false;
    setUiHint(null);
    setTraceRecords([]);
    setDebugFlowRecords([]);
    setAssistantRunMetaMap({});
    setSessionApprovedToolNames([]);
    setExpandedRunSegmentDetailMap({});
    setSessionAiPromptRaw("");
    setSessionAiResponseRaw("");
    setSessionAiRawByMessage({});
    setSending(false);
    setPendingDangerousPrompt("");
    setPendingDangerousToken("");
    if (!sessionId) {
      // 描述：新建会话时不注入默认欢迎语，仅保留空线程与输入框。
      setMessages([]);
      setMessagesHydrated(true);
      setHydratedSessionKey(sessionStorageKey);
      return;
    }
    const stored = getSessionMessages(normalizedAgentKey, sessionId);
    const debugArtifact = getSessionDebugArtifact(normalizedAgentKey, sessionId);
    const runSnapshot = getSessionRunState(normalizedAgentKey, sessionId);
    const restoredSessionApprovedToolNames = Array.isArray(runSnapshot?.sessionApprovedToolNames)
      ? runSnapshot?.sessionApprovedToolNames
        .map((toolName) => normalizeApprovalToolName(String(toolName || "")))
        .filter((toolName) => Boolean(toolName))
      : [];
    setSessionApprovedToolNames(Array.from(new Set(restoredSessionApprovedToolNames)));
    let nextMessages: MessageItem[] = stored.length > 0 ? stored : [];
    if (debugArtifact) {
      setTraceRecords((debugArtifact.traceRecords || []).map((item) => ({
        traceId: String(item.traceId || "").trim(),
        source: String(item.source || "").trim(),
        code: String(item.code || "").trim() || undefined,
        message: String(item.message || "").trim(),
      })));
      setDebugFlowRecords((debugArtifact.debugFlowRecords || []).map((item) => ({
        id: String(item.id || "").trim(),
        source: item.source === "backend" ? "backend" : "ui",
        stage: String(item.stage || "").trim(),
        title: String(item.title || "").trim(),
        detail: String(item.detail || "").trim(),
        timestamp: Number(item.timestamp || 0),
      })));
      const artifactPromptRaw = String(debugArtifact.aiPromptRaw || "");
      const artifactResponseRaw = String(debugArtifact.aiResponseRaw || "");
      setSessionAiPromptRaw(artifactPromptRaw);
      setSessionAiResponseRaw(artifactResponseRaw);
      const artifactAiRawByMessage = Object.fromEntries(
        Object.entries(debugArtifact.aiRawByMessage || {})
          .map(([messageId, rawItem]) => {
            const normalizedMessageId = String(messageId || "").trim();
            if (!normalizedMessageId || !rawItem || typeof rawItem !== "object") {
              return null;
            }
            return [
              normalizedMessageId,
              {
                promptRaw: String(rawItem.promptRaw || ""),
                responseRaw: String(rawItem.responseRaw || ""),
              },
            ] as const;
          })
          .filter((item): item is readonly [string, SessionAiRawByMessageItem] => Boolean(item)),
      );
      setSessionAiRawByMessage(artifactAiRawByMessage);
      agentPromptRawRef.current = artifactPromptRaw;
      agentLlmResponseRawRef.current = artifactResponseRaw;
    }
    if (runSnapshot && runSnapshot.runMetaMap && Object.keys(runSnapshot.runMetaMap).length > 0) {
      const normalizedRunMetaMap = Object.fromEntries(
        Object.entries(runSnapshot.runMetaMap).map(([messageId, meta]) => [messageId, normalizePersistedRunMeta(meta)]),
      );
      setAssistantRunMetaMap(normalizedRunMetaMap);
      const recoveredMessageId = String(runSnapshot.activeMessageId || "").trim()
        || Object.keys(normalizedRunMetaMap).slice(-1)[0]
        || "";
      if (recoveredMessageId) {
        const recoveredMeta = normalizedRunMetaMap[recoveredMessageId];
        const recoveredText = resolveRecoveredAssistantMessageText(nextMessages, recoveredMessageId, recoveredMeta);
        nextMessages = upsertAssistantMessageById(nextMessages, recoveredMessageId, recoveredText);
        streamMessageIdRef.current = recoveredMessageId;
        streamDisplayedTextRef.current = recoveredText;
        streamLatestTextRef.current = recoveredText;
        if (recoveredMeta?.status === "running") {
          assistantRunStatusRef.current = "running";
          assistantRunLastActivityAtRef.current = Date.now();
          setSending(true);
          startAssistantRunHeartbeat(recoveredMessageId);
        }
      }
    } else {
      setAssistantRunMetaMap({});
    }
    setMessages(nextMessages);
    setMessagesHydrated(true);
    setHydratedSessionKey(sessionStorageKey);
  }, [normalizedAgentKey, sessionId, sessionStorageKey]);

  useEffect(() => () => {
    stopStreamTypingTimer();
    clearSessionMessagePersistTimer();
    clearSessionRunStatePersistTimer();
    clearDebugSnapshotTimer();
    clearAssistantRunHeartbeatTimer();
  }, []);

  // 描述：
  //
  //   - 页面切走或会话切换时立即将最新消息和运行态刷入本地缓存，保证切到其他页面再回来时仍能看到离开前的真实进度文本。
  useEffect(() => {
    return () => {
      if (!sessionId || !messagesHydrated || hydratedSessionKey !== sessionStorageKey) {
        return;
      }
      upsertSessionMessages({
        agentKey: normalizedAgentKey,
        sessionId,
        messages: messagesRef.current,
      });
      const normalizedSessionApprovedToolNames = Array.from(new Set(
        Array.from(sessionApprovedToolNameSetRef.current.values())
          .map((toolName) => normalizeApprovalToolName(toolName))
          .filter((toolName) => Boolean(toolName)),
      ));
      if (
        Object.keys(assistantRunMetaMapRef.current).length === 0
        && normalizedSessionApprovedToolNames.length === 0
      ) {
        removeSessionRunState(normalizedAgentKey, sessionId);
        return;
      }
      upsertSessionRunState({
        agentKey: normalizedAgentKey,
        sessionId,
        activeMessageId: String(streamMessageIdRef.current || "").trim(),
        sending: sendingRef.current,
        runMetaMap: assistantRunMetaMapRef.current,
        sessionApprovedToolNames: normalizedSessionApprovedToolNames,
        updatedAt: Date.now(),
      });
    };
  }, [hydratedSessionKey, messagesHydrated, normalizedAgentKey, sessionId, sessionStorageKey]);

  useEffect(() => {
    if (!sessionId || !messagesHydrated || hydratedSessionKey !== sessionStorageKey) {
      clearSessionMessagePersistTimer();
      return;
    }
    clearSessionMessagePersistTimer();
    // 描述：发送中使用更长写入间隔，避免 token 流期间频繁 JSON 序列化阻塞主线程。
    const persistDelay = sending ? 1200 : 180;
    sessionMessagePersistTimerRef.current = window.setTimeout(() => {
      sessionMessagePersistTimerRef.current = null;
      upsertSessionMessages({
        agentKey: normalizedAgentKey,
        sessionId,
        messages,
      });
    }, persistDelay);
    return () => {
      clearSessionMessagePersistTimer();
    };
  }, [messages, messagesHydrated, hydratedSessionKey, normalizedAgentKey, sending, sessionId, sessionStorageKey]);

  // 描述：进入发送态时关闭“重试”按钮 tooltip，避免点击后 tooltip 残留悬浮。
  useEffect(() => {
    if (!sending) {
      return;
    }
    setHoveredRetryTooltipMessageId("");
  }, [sending]);

  useEffect(() => {
    if (!sessionId || !messagesHydrated || hydratedSessionKey !== sessionStorageKey) {
      clearSessionRunStatePersistTimer();
      return;
    }
    clearSessionRunStatePersistTimer();
    const normalizedSessionApprovedToolNames = Array.from(new Set(
      (sessionApprovedToolNames || [])
        .map((toolName) => normalizeApprovalToolName(toolName))
        .filter((toolName) => Boolean(toolName)),
    ));
    if (Object.keys(assistantRunMetaMap).length === 0 && normalizedSessionApprovedToolNames.length === 0) {
      removeSessionRunState(normalizedAgentKey, sessionId);
      return;
    }
    // 描述：
    //
    //   - 执行中使用节流持久化，降低 localStorage 同步写入频率，避免授权阶段主线程阻塞。
    const persistDelay = sending ? 900 : 180;
    sessionRunStatePersistTimerRef.current = window.setTimeout(() => {
      sessionRunStatePersistTimerRef.current = null;
      upsertSessionRunState({
        agentKey: normalizedAgentKey,
        sessionId,
        activeMessageId: String(streamMessageIdRef.current || "").trim(),
        sending,
        runMetaMap: assistantRunMetaMap,
        sessionApprovedToolNames: normalizedSessionApprovedToolNames,
        updatedAt: Date.now(),
      });
    }, persistDelay);
    return () => {
      clearSessionRunStatePersistTimer();
    };
  }, [
    assistantRunMetaMap,
    hydratedSessionKey,
    messagesHydrated,
    normalizedAgentKey,
    sending,
    sessionApprovedToolNames,
    sessionId,
    sessionStorageKey,
  ]);

  // 描述：持久化会话调试资产，保证未打开 Dev 调试窗口时也能恢复 AI 原始收发与排查轨迹。
  useEffect(() => {
    if (!sessionId || !messagesHydrated || hydratedSessionKey !== sessionStorageKey) {
      return;
    }
    const promptRaw = String(sessionAiPromptRaw || agentPromptRawRef.current || "").trim();
    const responseRaw = String(
      sessionAiResponseRaw
      || agentLlmResponseRawRef.current
      || agentLlmDeltaBufferRef.current
      || "",
    ).trim();
    if (
      traceRecords.length === 0
      && debugFlowRecords.length === 0
      && !promptRaw
      && !responseRaw
      && Object.keys(sessionAiRawByMessage).length === 0
    ) {
      removeSessionDebugArtifact(normalizedAgentKey, sessionId);
      return;
    }
    upsertSessionDebugArtifact({
      agentKey: normalizedAgentKey,
      sessionId,
      traceRecords,
      debugFlowRecords,
      aiPromptRaw: promptRaw,
      aiResponseRaw: responseRaw,
      aiRawByMessage: sessionAiRawByMessage,
      updatedAt: Date.now(),
    });
  }, [
    debugFlowRecords,
    hydratedSessionKey,
    messagesHydrated,
    normalizedAgentKey,
    sessionAiPromptRaw,
    sessionAiResponseRaw,
    sessionAiRawByMessage,
    sessionId,
    sessionStorageKey,
    traceRecords,
  ]);

  // 描述：向 Dev 调试窗口发送当前会话快照，供复制与排查入口复用。
  const emitSessionDebugSnapshot = useCallback(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("libra:session-debug", {
        detail: {
          sessionId,
          agentKey: normalizedAgentKey,
          title,
          status,
          traceRecords: traceRecords.slice(0, 20),
          debugFlowRecords: debugFlowRecords.slice(0, 120),
          messageCount: messages.length,
          timestamp: Date.now(),
        },
      }),
    );
  }, [
    debugFlowRecords,
    messages.length,
    normalizedAgentKey,
    sessionId,
    status,
    title,
    traceRecords,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    clearDebugSnapshotTimer();
    const dispatchDelay = sending ? 360 : 120;
    debugSnapshotTimerRef.current = window.setTimeout(() => {
      debugSnapshotTimerRef.current = null;
      emitSessionDebugSnapshot();
    }, dispatchDelay);
    return () => {
      clearDebugSnapshotTimer();
    };
  }, [
    emitSessionDebugSnapshot,
    sending,
  ]);

  // 描述：响应 Dev 调试窗口的快照请求，保证面板后开也能获取当前会话上下文。
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    const handleDebugSnapshotRequest = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string }>;
      const targetSessionId = String(customEvent.detail?.sessionId || "").trim();
      if (targetSessionId && targetSessionId !== sessionId) {
        return;
      }
      emitSessionDebugSnapshot();
    };
    window.addEventListener("libra:session-debug-request", handleDebugSnapshotRequest as EventListener);
    return () => {
      window.removeEventListener("libra:session-debug-request", handleDebugSnapshotRequest as EventListener);
    };
  }, [sessionId, emitSessionDebugSnapshot]);

  // 描述：仅在会话页真正卸载时清空 Dev 调试快照，避免状态刷新触发“先清空后重绘”闪烁。
  useEffect(() => () => {
    if (!import.meta.env.DEV) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("libra:session-debug", {
        detail: null,
      }),
    );
  }, []);

  // 描述：在切换会话时恢复线程级 AI Provider 绑定，避免 AI Key 页调整默认顺序后回写已存在话题。
  useEffect(() => {
    setSelectedProvider(resolveAgentSessionSelectedAiProvider(sessionId));
  }, [sessionId]);

  // 描述：仅在当前会话尚未绑定 Provider 或绑定项失效时回退到首个可用 Provider；一旦完成回退即写回会话元数据，冻结该话题后续默认值。
  useEffect(() => {
    if (availableAiKeys.length === 0) {
      setSelectedProvider("");
      if (sessionId) {
        rememberAgentSessionSelectedAiProvider(sessionId, "");
      }
      return;
    }
    const normalizedProvider = String(selectedProvider || "").trim();
    if (normalizedProvider && availableAiKeys.some((item) => item.provider === normalizedProvider)) {
      return;
    }
    const nextProvider = String(availableAiKeys[0]?.provider || "").trim();
    setSelectedProvider(nextProvider);
    if (sessionId && nextProvider) {
      rememberAgentSessionSelectedAiProvider(sessionId, nextProvider);
    }
  }, [availableAiKeys, selectedProvider, sessionId]);

  // 描述：加载“已发现技能”列表，供会话中的“工作流/技能”弹窗选择器使用。
  useEffect(() => {
    let disposed = false;
    const loadSkills = async () => {
      try {
        const skills = await listAgentSkills();
        if (disposed) {
          return;
        }
        setAvailableSkills(skills);
      } catch (_err) {
        if (disposed) {
          return;
        }
        setAvailableSkills([]);
      }
    };
    void loadSkills();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedWorkflow) {
      return;
    }
    if (selectedWorkflow.id !== selectedWorkflowId) {
      setSelectedWorkflowId(selectedWorkflow.id);
      return;
    }
    if (IS_BROWSER) {
      window.localStorage.setItem(AGENT_WORKFLOW_SELECTED_KEY, selectedWorkflow.id);
    }
  }, [selectedWorkflow, selectedWorkflowId]);

  // 描述：持久化当前会话选择的技能列表，保持跨会话复用。
  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }
    window.localStorage.setItem(AGENT_SKILL_SELECTED_KEY, JSON.stringify(selectedSkillIds));
  }, [selectedSkillIds]);

  // 描述：在切换会话时同步恢复线程级 DCC 软件绑定，保证同一话题后续默认继续使用已选软件。
  useEffect(() => {
    setSelectedDccSoftware(resolveAgentSessionSelectedDccSoftware(sessionId));
    setPendingDccSelection(null);
  }, [sessionId]);

  // 描述：当当前执行策略不再包含 DCC 建模 Skill 时，主动清理残留的软件选择拦截状态。
  useEffect(() => {
    if (activeUsesDccModelingSkill) {
      return;
    }
    setPendingDccSelection(null);
  }, [activeUsesDccModelingSkill]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<AgentTextStreamEvent>(EVENT_AGENT_TEXT_STREAM, (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      if (!payload) {
        return;
      }
      if (payload.session_id && payload.session_id !== sessionId) {
        return;
      }
      if (activeAgentStreamTraceRef.current && payload.trace_id !== activeAgentStreamTraceRef.current) {
        return;
      }
      if (!streamMessageIdRef.current) {
        return;
      }
      assistantRunLastActivityAtRef.current = Date.now();
      assistantRunStageRef.current = resolveAssistantRunStageByAgentTextStream(payload);
      const segmentDataText = payload.data && typeof payload.data === "object"
        ? truncateRunText(JSON.stringify(payload.data), 600)
        : "";
      const segmentKey = `agent:${payload.kind}:${payload.message}:${payload.delta || ""}:${segmentDataText}`;
      if (!agentStreamSeenKeysRef.current.has(segmentKey)) {
        agentStreamSeenKeysRef.current.add(segmentKey);
        // 描述：收到真实文本流事件后重置心跳计数，避免误判为“无进展超时”。
        assistantRunHeartbeatCountRef.current = 0;
        // 描述：
        //
        //   - 命中“会话内批准”策略时自动放行授权，不再重复弹出授权卡片。
        if (payload.kind === STREAM_KINDS.REQUIRE_APPROVAL) {
          const approvalData = resolveApprovalEventData(payload);
          const approvalId = String(approvalData.approval_id || "").trim();
          const toolName = normalizeApprovalToolName(String(approvalData.tool_name || ""));
          if (
            approvalId
            && toolName
            && sessionApprovedToolNameSetRef.current.has(toolName)
          ) {
            void handleApproveAgentAction(approvalId, true, {
              scope: "session",
              toolName,
              silent: true,
            });
            return;
          }
        }
        const runSegment = mapAgentTextStreamToRunSegment(payload, segmentKey);
        if (runSegment) {
          appendAssistantRunSegment(streamMessageIdRef.current, runSegment);
        }
      }
      if (payload.kind === STREAM_KINDS.STARTED) {
        agentLlmDeltaBufferRef.current = "";
        setSessionAiResponseRaw("");
        setStreamingAssistantTarget(t("正在准备执行..."));
        return;
      }
      if (payload.kind === STREAM_KINDS.LLM_STARTED) {
        agentLlmDeltaBufferRef.current = "";
        setSessionAiResponseRaw("");
        setStreamingAssistantTarget(t("正在生成执行结果…"));
        return;
      }
      if (payload.kind === STREAM_KINDS.LLM_FINISHED) {
        const normalizedRawResponse = String(agentLlmDeltaBufferRef.current || "").trim();
        if (normalizedRawResponse) {
          agentLlmResponseRawRef.current = normalizedRawResponse;
          setSessionAiResponseRaw(normalizedRawResponse);
          const currentMessageId = String(streamMessageIdRef.current || "").trim();
          if (currentMessageId) {
            setSessionAiRawByMessage((prev) => {
              const current = prev[currentMessageId] || { promptRaw: "", responseRaw: "" };
              return {
                ...prev,
                [currentMessageId]: {
                  promptRaw: current.promptRaw,
                  responseRaw: normalizedRawResponse,
                },
              };
            });
          }
        }
        if (!agentStreamTextBufferRef.current.trim()) {
          setStreamingAssistantTarget(t("正在整理输出..."));
        }
        return;
      }
      if (payload.kind === STREAM_KINDS.PLANNING) {
        const planningText = resolvePlanningDisplayText(payload);
        if (planningText) {
          setStreamingAssistantTarget(planningText);
        }
        return;
      }
      if (payload.kind === STREAM_KINDS.HEARTBEAT) {
        assistantRunHeartbeatCountRef.current += 1;
        const heartbeatText = buildAssistantHeartbeatDisplayText(
          String(payload.message || "").trim(),
          assistantRunHeartbeatCountRef.current,
        );
        setStreamingAssistantTarget(heartbeatText);
        return;
      }
      if (payload.kind === STREAM_KINDS.FINISHED) {
        return;
      }
      if (payload.kind === STREAM_KINDS.FINAL) {
        const currentMessageId = String(streamMessageIdRef.current || "").trim();
        const currentMeta = currentMessageId
          ? assistantRunMetaMapRef.current[currentMessageId]
          : undefined;
        const fallbackSummary = resolveMeaningfulRunSummary(currentMeta?.segments || []);
        const finalSummary = String(payload.message || "").trim()
          || fallbackSummary
          || t("执行完成");
        setStreamingAssistantTarget(finalSummary);
        finishAssistantRunMessage(streamMessageIdRef.current, "finished", finalSummary);
        setStatus(t("执行完成"));
        setSending(false);
        activeAgentStreamTraceRef.current = "";
        return;
      }
      if (payload.kind === STREAM_KINDS.CANCELLED) {
        const cancelledSummary = String(payload.message || "").trim() || t("任务已取消");
        appendDebugFlowRecord(
          "ui",
          "stream_cancelled",
          t("流取消事件"),
          JSON.stringify(
            {
              message: cancelledSummary,
              data: payload.data || null,
            },
            null,
            2,
          ),
        );
        setStreamingAssistantTarget(cancelledSummary);
        finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary);
        setStatus(cancelledSummary);
        setSending(false);
        activeAgentStreamTraceRef.current = "";
        return;
      }
      if (payload.kind === STREAM_KINDS.DELTA) {
        const delta = payload.delta || "";
        if (!delta) {
          return;
        }
        agentLlmDeltaBufferRef.current = `${agentLlmDeltaBufferRef.current}${delta}`;
        agentStreamTextBufferRef.current = `${agentStreamTextBufferRef.current}${delta}`;
        setStreamingAssistantTarget(agentStreamTextBufferRef.current);
        return;
      }
      if (payload.kind === STREAM_KINDS.ERROR) {
        // 兜底：如果 error 事件携带取消类错误码，按取消态处理，避免与 cancelled 事件竞态时文案闪烁。
        const errorCode = resolveStreamErrorCode(payload);
        if (isCancelErrorCode(errorCode)) {
          const cancelledSummary = t("任务已取消：{{reason}}", {
            reason: String(payload.message || "").trim() || t("未知原因"),
          });
          setStreamingAssistantTarget(cancelledSummary);
          finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary);
          setStatus(cancelledSummary);
          setSending(false);
          activeAgentStreamTraceRef.current = "";
          return;
        }
        const errorSummary = t("执行失败：{{reason}}", {
          reason: String(payload.message || "").trim() || t("未知错误"),
        });
        setStreamingAssistantTarget(errorSummary);
        finishAssistantRunMessage(streamMessageIdRef.current, "failed", errorSummary);
        setStatus(errorSummary);
        setSending(false);
        activeAgentStreamTraceRef.current = "";
      }
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // 文本流监听失败时保持最终响应兜底展示。
      });
    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [sessionId]);

  // 描述：
  //
  //   - 在正式执行前解析 DCC 软件路由；当存在多个可用软件且用户未明确指定时，阻断执行并要求用户先选软件。
  const resolveDccPreflight = useCallback(async (
    promptText: string,
    contextMessages: MessageItem[],
    options?: ExecutePromptOptions,
  ): Promise<DccPreflightResult> => {
    if (!activeUsesDccModelingSkill) {
      return {
        blocked: false,
        promptBlock: "",
      };
    }

    const overview = await listMcpOverview({
      workspaceRoot: String(activeWorkspace?.path || "").trim() || undefined,
    });
    const softwareOptions = resolveAvailableDccSoftwareOptions(overview.registered);
    if (softwareOptions.length === 0) {
      throw new Error(t("当前未启用任何 DCC MCP，请先在 MCP 页面注册并启用建模软件。"));
    }

    const userSourceTexts = [
      ...contextMessages
        .filter((item) => item.role === "user")
        .map((item) => item.text),
      promptText,
    ];
    const explicitSoftwares = resolveExplicitDccSoftwares(userSourceTexts, softwareOptions);
    const crossSoftwareIntent = hasCrossDccIntent(userSourceTexts);

    if (explicitSoftwares.length >= 2) {
      return {
        blocked: false,
        promptBlock: buildDccRoutingPromptBlock(softwareOptions, "", explicitSoftwares),
      };
    }

    if (crossSoftwareIntent) {
      const resolvedCrossSoftwares = Array.from(
        new Set(
          (options?.resolvedCrossDccSoftwares || [])
            .map((item) => String(item || "").trim().toLowerCase())
            .filter((item) => softwareOptions.some((option) => option.software === item)),
        ),
      );
      if (resolvedCrossSoftwares.length >= 2) {
        return {
          blocked: false,
          promptBlock: buildDccRoutingPromptBlock(softwareOptions, "", resolvedCrossSoftwares),
        };
      }
      if (softwareOptions.length < 2) {
        throw new Error(t("当前仅启用了一个 DCC 软件，无法执行跨软件操作，请先启用至少两个建模软件。"));
      }
      if (!options?.skipDccSelectionPrompt) {
        const defaultSourceSoftware = softwareOptions[0]?.software || "";
        const defaultTargetSoftware = softwareOptions.find((item) => item.software !== defaultSourceSoftware)?.software || "";
        setPendingDccSelection({
          selectionMode: "cross",
          prompt: promptText,
          options: {
            ...options,
          },
          contextMessages,
          softwareOptions,
          selectedSoftware: defaultSourceSoftware,
          selectedTargetSoftware: defaultTargetSoftware,
        });
        setStatus(t("检测到跨软件建模需求，请先选择源软件和目标软件。"));
        return {
          blocked: true,
          promptBlock: "",
        };
      }
      throw new Error(t("跨软件建模需要先明确源软件和目标软件。"));
    }

    if (explicitSoftwares.length === 1) {
      const explicitSoftware = explicitSoftwares[0];
      const matchedOption = softwareOptions.find((item) => item.software === explicitSoftware);
      if (!matchedOption) {
        throw new Error(t("未找到可用的 {{software}} DCC MCP，请先在 MCP 页面启用对应软件。", {
          software: explicitSoftware,
        }));
      }
      rememberAgentSessionSelectedDccSoftware(sessionId, explicitSoftware);
      setSelectedDccSoftware(explicitSoftware);
      return {
        blocked: false,
        promptBlock: buildDccRoutingPromptBlock(softwareOptions, explicitSoftware, []),
      };
    }

    const persistedSoftware = String(
      options?.resolvedDccSoftware || selectedDccSoftware || resolveAgentSessionSelectedDccSoftware(sessionId),
    )
      .trim()
      .toLowerCase();
    if (persistedSoftware) {
      const matchedOption = softwareOptions.find((item) => item.software === persistedSoftware);
      if (matchedOption) {
        rememberAgentSessionSelectedDccSoftware(sessionId, persistedSoftware);
        setSelectedDccSoftware(persistedSoftware);
        return {
          blocked: false,
          promptBlock: buildDccRoutingPromptBlock(softwareOptions, persistedSoftware, []),
        };
      }
      rememberAgentSessionSelectedDccSoftware(sessionId, "");
      setSelectedDccSoftware("");
    }

    if (softwareOptions.length === 1) {
      const onlySoftware = softwareOptions[0]?.software || "";
      rememberAgentSessionSelectedDccSoftware(sessionId, onlySoftware);
      setSelectedDccSoftware(onlySoftware);
      return {
        blocked: false,
        promptBlock: buildDccRoutingPromptBlock(softwareOptions, onlySoftware, []),
      };
    }

    if (!options?.skipDccSelectionPrompt) {
      setPendingDccSelection({
        selectionMode: "single",
        prompt: promptText,
        options: {
          ...options,
        },
        contextMessages,
        softwareOptions,
        selectedSoftware: softwareOptions[0]?.software || "",
        selectedTargetSoftware: "",
      });
      setStatus(t("检测到多个可用建模软件，请先选择一个软件。"));
      return {
        blocked: true,
        promptBlock: "",
      };
    }

    throw new Error(t("当前 DCC 会话缺少软件选择结果，请先选择一个建模软件后继续。"));
  }, [
    activeUsesDccModelingSkill,
    activeWorkspace?.path,
    selectedDccSoftware,
    sessionId,
  ]);

  const executePrompt = async (content: string, options?: ExecutePromptOptions) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || sending) return;

    const allowDangerousAction = Boolean(options?.allowDangerousAction);
    const confirmationToken = options?.confirmationToken;
    const appendUserMessage = options?.appendUserMessage !== false;
    const contextMessages = options?.contextMessages || messages;
    const dccPreflight = await resolveDccPreflight(normalizedContent, contextMessages, options);
    if (dccPreflight.blocked) {
      return;
    }
    // 描述：工作流声明了必需项目能力但当前项目未启用时，直接阻断发送并提示用户先到项目设置启用。
    if (selectedWorkflowMissingRequiredCapabilities.length > 0) {
      const missingCapabilityLabels = selectedWorkflowMissingRequiredCapabilities
        .map((item) => getProjectWorkspaceCapabilityManifest(item)?.title || item);
      AriMessage.error(t("当前工作流缺少必需的项目能力：{{capabilities}}", {
        capabilities: missingCapabilityLabels.join("、"),
      }));
      setStatus(t("当前工作流缺少必需的项目能力：{{capabilities}}。", {
        capabilities: missingCapabilityLabels.join("、"),
      }));
      return;
    }

    // 描述：智能体在正式执行前先检查项目依赖规则；发现版本不一致时先弹确认，不直接中断。
    if (!options?.skipDependencyRuleCheck) {
      const projectPath = String(activeWorkspace?.path || "").trim();
      const dependencyRules = activeWorkspace?.dependencyRules || [];
      const dependencyPolicyEnabled = isProjectWorkspaceCapabilityEnabled(activeWorkspace, "dependency-policy");
      if (dependencyPolicyEnabled && projectPath && dependencyRules.length > 0) {
        try {
          const checkResponse = await invoke<DependencyRuleCheckResponse>(COMMANDS.CHECK_PROJECT_DEPENDENCY_RULES, {
            projectPath,
            rules: dependencyRules,
          });
          const mismatches = (checkResponse.mismatches || []).filter((item) => item.status === "mismatch");
          if (mismatches.length > 0) {
            setDependencyRuleConfirmState({
              prompt: normalizedContent,
              options: {
                ...options,
                appendUserMessage,
              },
              projectPath,
              rules: dependencyRules,
              mismatches,
            });
            setStatus(t("检测到 {{count}} 项依赖版本与规范不一致，请先确认。", {
              count: mismatches.length,
            }));
            return;
          }
        } catch (checkErr) {
          // 描述：依赖规则检查异常时不阻断主执行链路，使用状态栏提示并允许继续。
          const reason = normalizeInvokeError(checkErr);
          setStatus(t("依赖规则检查失败，已跳过：{{reason}}", { reason }));
        }
      }
    }

    const provider = selectedAi?.provider || "codex";
    const activeWorkflowName = selectedWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel;
    const activeWorkflowId = selectedWorkflow?.id || "";
    const outputDir = undefined;
    const streamMessageId = String(options?.replaceAssistantMessageId || "").trim()
      || `assistant-stream-${Date.now()}`;
    const agentTraceId = `trace-${Date.now()}`;
    setInput("");
    setSending(true);
    setStatus(t("智能体执行中..."));
    setUiHint(null);
    appendDebugFlowRecord(
      "ui",
      "user_submit",
      t("用户发送消息"),
      JSON.stringify(
          {
            session_id: sessionId || "new-session",
            agent_key: normalizedAgentKey,
            provider,
            workflow_id: activeWorkflowId || null,
            workflow_name: activeWorkflowName,
            prompt: normalizedContent,
            output_dir: outputDir || null,
            allow_dangerous_action: allowDangerousAction,
        },
        null,
        2,
      ),
    );
    if (appendUserMessage) {
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: "user", text: normalizedContent },
      ]);
    }
    stopStreamTypingTimer();
    streamMessageIdRef.current = streamMessageId;
    streamDisplayedTextRef.current = "";
    streamLatestTextRef.current = "";
    activeAgentStreamTraceRef.current = agentTraceId;
    agentStreamTextBufferRef.current = "";
    agentStreamSeenKeysRef.current.clear();
    const initialStreamText = "";
    setMessages((prev) =>
      upsertAssistantMessageById(
        prev,
        streamMessageId,
        initialStreamText,
      ));
    streamDisplayedTextRef.current = initialStreamText;
    streamLatestTextRef.current = initialStreamText;
    assistantRunStatusRef.current = "running";
    assistantRunStageRef.current = "planning";
    assistantRunHeartbeatCountRef.current = 0;
    assistantRunLastActivityAtRef.current = Date.now();
    setAssistantRunMetaMap((prev) => ({
      ...prev,
      [streamMessageId]: {
        status: "running",
        startedAt: Date.now(),
        collapsed: false,
        summary: "",
        segments: [
          {
            key: `intro-${Date.now()}`,
            intro: "",
            step: t("正在思考…"),
            status: "running",
            data: {
              __segment_role: INITIAL_THINKING_SEGMENT_ROLE,
            },
          },
        ],
      },
    }));
    setStreamingAssistantTarget(t("正在准备执行..."));
    startAssistantRunHeartbeat(streamMessageId);

    try {
      const skillExecutionPlan = buildAgentWorkflowSkillExecutionPlan(selectedWorkflow, availableSkills);
      if (skillExecutionPlan.blockingIssues.length > 0) {
        throw new Error(t("技能执行前检查未通过：{{issues}}", {
          issues: skillExecutionPlan.blockingIssues.join("；"),
        }));
      }
      const latestProjectProfile = activeWorkspace?.id
        ? (activeProjectProfile || getProjectWorkspaceProfile(activeWorkspace.id))
        : null;
      const selectedSessionSkillPrompt = buildSessionSkillPrompt(selectedSessionSkills);
      const currentRequestPrompt = buildSessionContextPrompt(
        messages,
        normalizedContent,
        undefined,
        latestProjectProfile,
        activeWorkspaceEnabledCapabilities,
      );
      const contextualRequestPrompt = buildSessionContextPrompt(
        contextMessages,
        normalizedContent,
        String(activeWorkspace?.path || "").trim() || undefined,
        latestProjectProfile,
        activeWorkspaceEnabledCapabilities,
      );
      const workflowPrompt = buildAgentWorkflowPrompt(
        selectedWorkflow,
        contextualRequestPrompt || currentRequestPrompt,
      );
      const agentPrompt = skillExecutionPlan.planPrompt
        ? `${workflowPrompt}\n\n${skillExecutionPlan.planPrompt}${selectedSessionSkillPrompt ? `\n\n${selectedSessionSkillPrompt}` : ""}${dccPreflight.promptBlock ? `\n\n${dccPreflight.promptBlock}` : ""}`
        : `${workflowPrompt}${selectedSessionSkillPrompt ? `\n\n${selectedSessionSkillPrompt}` : ""}${dccPreflight.promptBlock ? `\n\n${dccPreflight.promptBlock}` : ""}`;
      agentPromptRawRef.current = agentPrompt;
      agentLlmDeltaBufferRef.current = "";
      agentLlmResponseRawRef.current = "";
      setSessionAiPromptRaw(agentPrompt);
      setSessionAiResponseRaw("");
      setSessionAiRawByMessage((prev) => ({
        ...prev,
        [streamMessageId]: {
          promptRaw: agentPrompt,
          responseRaw: "",
        },
      }));
      appendDebugFlowRecord(
        "ui",
        "skill_plan",
        t("技能执行计划"),
        JSON.stringify(
          {
            ready_count: skillExecutionPlan.readyItems.length,
            ready_items: skillExecutionPlan.readyItems.map((item) => ({
              node_id: item.nodeId,
              node_title: item.nodeTitle,
              skill_id: item.skillId,
              skill_version: item.skillVersion,
            })),
          },
          null,
          2,
        ),
      );
      if (skillExecutionPlan.readyItems.length > 0) {
        appendTraceRecord({
          traceId: agentTraceId,
          source: "workflow:skill_plan",
          message: t("已加载 {{count}} 个技能节点", { count: skillExecutionPlan.readyItems.length }),
        });
      }
      const response = await invoke<AgentRunResponse>(COMMANDS.RUN_AGENT_COMMAND, {
        agentKey: normalizedAgentKey,
        sessionId,
        provider,
        prompt: agentPrompt,
        traceId: agentTraceId,
        projectName: title,
        modelExportEnabled: dccMcpCapabilities.export,
        dccProviderAddr: DEFAULT_DCC_PROVIDER_ADDR,
        outputDir,
        workdir: String(activeWorkspace?.path || "").trim() || undefined,
      });
      const responseSteps = response.steps || [];
      setStepRecords(responseSteps);
      setEventRecords(response.events || []);
      const codegenRawStep = [...responseSteps]
        .reverse()
        .find((item) => item.code === "llm_python_codegen" && item.data && typeof item.data === "object");
      const codegenRawData = codegenRawStep?.data || {};
      const responsePromptRaw = String(codegenRawData.llm_prompt_raw || "").trim() || agentPrompt;
      const responseRawText = String(codegenRawData.llm_response_raw || "").trim()
        || String(agentLlmResponseRawRef.current || agentLlmDeltaBufferRef.current || "").trim();
      if (responsePromptRaw || responseRawText) {
        setSessionAiRawByMessage((prev) => ({
          ...prev,
          [streamMessageId]: {
            promptRaw: responsePromptRaw,
            responseRaw: responseRawText,
          },
        }));
      }
      appendTraceRecord({
        traceId: response.trace_id,
        source: "agent:run",
        message: response.message,
      });
      setUiHint(response.ui_hint ? mapProtocolUiHint(response.ui_hint) : null);
      setPendingDangerousToken("");
      setStreamingAssistantTarget(response.message);
      finishAssistantRunMessage(streamMessageId, "finished", response.message);
      const actionText = response.actions?.length > 0
        ? t("动作：{{actions}}", { actions: response.actions.join(", ") })
        : t("动作：无");
      setStatus(
        response.exported_file
          ? t("{{actionText}}；工作流：{{workflow}}；导出文件：{{file}}", {
            actionText,
            workflow: activeWorkflowName,
            file: response.exported_file,
          })
          : t("{{actionText}}；工作流：{{workflow}}", {
            actionText,
            workflow: activeWorkflowName,
          })
      );
    } catch (err) {
      const detail = normalizeInvokeErrorDetail(err);
      const reason = detail.message;
      if (isCancelErrorCode(String(detail.code || ""))) {
        const cancelledSummary = t("任务已取消：{{reason}}", { reason });
        appendDebugFlowRecord(
          "ui",
          "execute_cancelled",
          t("执行取消"),
          JSON.stringify(
            {
              code: detail.code || "",
              message: reason,
            },
            null,
            2,
          ),
        );
        if (streamMessageIdRef.current) {
          setStreamingAssistantTarget(cancelledSummary);
          finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary);
        }
        setStatus(cancelledSummary);
        setUiHint(null);
        return;
      }
      appendDebugFlowRecord(
        "ui",
        "execute_failed",
        t("执行失败"),
        JSON.stringify(
          {
            code: detail.code || "",
            message: reason,
            suggestion: detail.suggestion || null,
            retryable: detail.retryable,
          },
          null,
          2,
        ),
      );
      setPendingDangerousToken("");
      appendTraceRecord({
        traceId: `trace-local-${Date.now()}`,
        source: "agent:error",
        code: detail.code,
        message: reason,
      });
      if (streamMessageIdRef.current) {
        const failedMessageId = String(streamMessageIdRef.current || "").trim();
        const failedPromptRaw = String(agentPromptRawRef.current || "").trim();
        const rawCodeResponse = String(
          agentLlmResponseRawRef.current || agentLlmDeltaBufferRef.current || "",
        ).trim();
        if (failedMessageId && (failedPromptRaw || rawCodeResponse)) {
          setSessionAiRawByMessage((prev) => ({
            ...prev,
            [failedMessageId]: {
              promptRaw: failedPromptRaw,
              responseRaw: rawCodeResponse,
            },
          }));
        }
      }
      if (streamMessageIdRef.current) {
        setStreamingAssistantTarget(t("执行失败：{{reason}}", { reason }));
        finishAssistantRunMessage(streamMessageIdRef.current, "failed", t("执行失败：{{reason}}", { reason }));
      } else {
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: "assistant", text: t("执行失败：{{reason}}", { reason }) },
        ]);
      }
      setStatus(t("执行失败：{{reason}}", { reason }));
      setUiHint(buildUiHintFromProtocolError(detail));
    } finally {
      setSending(false);
      activeAgentStreamTraceRef.current = "";
    }
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || sending) {
      return;
    }
    await executePrompt(content, { allowDangerousAction: false, appendUserMessage: true });
  };

  // 描述：根据助手消息索引向上回溯最近一条用户消息，用于“重试本轮”功能。
  //
  // Params:
  //
  //   - assistantMessageIndex: 助手消息在当前列表中的索引。
  //
  // Returns:
  //
  //   - 命中时返回用户消息文本；未命中返回空字符串。
  const resolveRetryPromptByAssistantMessageIndex = (assistantMessageIndex: number): string => {
    for (let cursor = assistantMessageIndex - 1; cursor >= 0; cursor -= 1) {
      const candidate = messages[cursor];
      if (candidate?.role !== "user") {
        continue;
      }
      const normalized = String(candidate.text || "").trim();
      if (normalized) {
        return normalized;
      }
    }
    return "";
  };

  // 描述：触发助手消息“重试”动作，复用最近一条用户请求重新执行，不重复插入用户消息。
  //
  // Params:
  //
  //   - assistantMessageIndex: 当前助手消息索引。
  const handleRetryAssistantMessage = async (assistantMessageIndex: number) => {
    setHoveredRetryTooltipMessageId("");
    if (sending) {
      setStatus(t("当前仍在执行中，请稍后再试"));
      return;
    }
    const assistantMessage = messages[assistantMessageIndex];
    if (!assistantMessage || assistantMessage.role !== "assistant") {
      setStatus(t("无法重试：目标消息不存在"));
      return;
    }
    const retryPrompt = resolveRetryPromptByAssistantMessageIndex(assistantMessageIndex);
    if (!retryPrompt) {
      setStatus(t("无法重试：未找到对应的用户输入"));
      return;
    }
    const prunedRetryTail = pruneAssistantRetryTail(messages, assistantMessageIndex);
    if (prunedRetryTail.removedAssistantMessageIds.length > 0) {
      setMessages(prunedRetryTail.messages);
      setAssistantRunMetaMap((prev) => {
        const next = { ...prev };
        prunedRetryTail.removedAssistantMessageIds.forEach((messageId) => {
          delete next[messageId];
        });
        return next;
      });
    }
    // 描述：若当前失败为 Gemini 未实现，并且已启用 Codex，则自动切换到 Codex 再重试。
    if (
      isGeminiProviderNotImplementedError(assistantMessage.text)
      && availableAiKeys.some((item) => item.provider === "codex" && item.enabled)
    ) {
      setSelectedProvider("codex");
      if (sessionId) {
        rememberAgentSessionSelectedAiProvider(sessionId, "codex");
      }
      setStatus(t("检测到 Gemini 暂不可用，已切换到 Codex 重试"));
    } else {
      setStatus(t("正在重试本轮执行..."));
    }
    await executePrompt(retryPrompt, {
      allowDangerousAction: false,
      appendUserMessage: false,
      replaceAssistantMessageId: String(assistantMessage.id || "").trim() || undefined,
      contextMessages: prunedRetryTail.messages,
    });
  };

  // 描述：触发用户消息“编辑”动作，把原文本带回输入框，便于修改后重新发送。
  //
  // Params:
  //
  //   - content: 用户消息原始文本。
  const handleEditUserMessage = (content: string) => {
    const normalized = String(content || "").trim();
    if (!normalized) {
      setStatus(t("该条消息为空，无法编辑"));
      return;
    }
    setInput(normalized);
    setStatus(t("已加载到输入框，修改后可重新发送"));
  };

  // 描述：复制指定消息内容到系统剪贴板，供消息 hover 工具栏复用。
  //
  // Params:
  //
  //   - content: 目标消息内容。
  const handleCopyMessageContent = async (content: string) => {
    const normalizedContent = String(content || "").trim();
    // 描述：空消息不触发复制，避免误导用户复制成功。
    if (!normalizedContent) {
      setStatus(t("暂无可复制内容"));
      return;
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        setStatus(t("复制失败，请检查系统剪贴板权限"));
        return;
      }
      await navigator.clipboard.writeText(normalizedContent);
      setStatus(t("消息内容已复制"));
    } catch {
      setStatus(t("复制失败，请检查系统剪贴板权限"));
    }
  };
  // 描述：复制执行步骤中的文件路径，用于“已编辑”步骤文件名点击反馈。
  //
  // Params:
  //
  //   - filePath: 需要复制的绝对或相对路径。
  const handleCopyRunStepFilePath = async (filePath: string) => {
    const normalizedPath = String(filePath || "").trim();
    if (!normalizedPath) {
      return;
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        setStatus(t("复制失败，请检查系统剪贴板权限"));
        return;
      }
      await navigator.clipboard.writeText(normalizedPath);
      setStatus(t("文件路径已复制：{{path}}", { path: normalizedPath }));
    } catch {
      setStatus(t("复制失败，请检查系统剪贴板权限"));
    }
  };

  // 描述：
  //
  //   - 处理 AI 下拉选择，统一把选择值收敛为 provider 字符串。
  //
  // Params:
  //
  //   - value: AriSelect 回传值。
  const handleResetSandbox = async () => {
    if (!sessionId) return;
    try {
      await invoke(COMMANDS.RESET_AGENT_SANDBOX, { sessionId });
      setStatus(t("沙盒环境已重置（跨轮次上下文已清空）"));
    } catch (err) {
      setStatus(t("沙盒重置失败，请查看日志"));
    }
  };

  // 描述：主动取消当前执行任务，要求后端立即终止对应会话沙盒。
  const handleCancelCurrentRun = async () => {
    if (!sending || !sessionId) {
      return;
    }
    try {
      await invoke(COMMANDS.CANCEL_AGENT_SESSION, { sessionId });
      const cancelledSummary = t("任务已取消（用户主动终止）");
      if (streamMessageIdRef.current) {
        setStreamingAssistantTarget(cancelledSummary);
        finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary);
      }
      setStatus(cancelledSummary);
      setUiHint(null);
    } catch (_err) {
      setStatus(t("取消失败，请重试"));
    } finally {
      setSending(false);
      activeAgentStreamTraceRef.current = "";
    }
  };

  // 描述：统一处理输入区主按钮动作，空闲时发送消息，执行中时触发取消。
  const handlePromptPrimaryAction = () => {
    if (sending) {
      void handleCancelCurrentRun();
      return;
    }
    void sendMessage();
  };

  const handleChangeProvider = (value: string | number | (string | number)[] | undefined) => {
    if (Array.isArray(value)) {
      return;
    }
    const nextProvider = String(value || "").trim();
    if (!nextProvider) {
      return;
    }
    setSelectedProvider(nextProvider);
    if (sessionId) {
      rememberAgentSessionSelectedAiProvider(sessionId, nextProvider);
    }
  };

  // 描述：根据审批结果更新本地运行片段状态，确保授权卡片在用户操作后即时收敛。
  //
  // Params:
  //
  //   - approvalId: 授权请求 ID。
  //   - status: 目标片段状态。
  //   - stepText: 更新后的步骤文案。
  const markApprovalSegmentResolved = (
    approvalId: string,
    status: AssistantRunSegmentStatus,
    stepText: string,
    options?: {
      decision?: "approved" | "rejected" | "cancelled" | "handled";
      scope?: "once" | "session";
      toolName?: string;
    },
  ) => {
    const normalizedApprovalId = String(approvalId || "").trim();
    if (!normalizedApprovalId) {
      return;
    }
    setAssistantRunMetaMap((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([messageId, meta]) => {
          const nextSegments = (meta.segments || []).map((segment) => {
            const segmentApprovalId = segment.data && typeof segment.data.approval_id === "string"
              ? String(segment.data.approval_id || "").trim()
              : "";
            if (!segmentApprovalId || segmentApprovalId !== normalizedApprovalId || !isApprovalPendingSegment(segment)) {
              return segment;
            }
            const stepData = segment.data && typeof segment.data === "object" ? segment.data : {};
            const toolName = String(options?.toolName || stepData.tool_name || "").trim() || t("该工具");
            return {
              ...segment,
              status,
              step: stepText,
              data: {
                ...stepData,
                __step_type: "approval_decision",
                approval_decision: options?.decision || (status === "failed" ? "rejected" : "approved"),
                approval_scope: options?.scope || undefined,
                approval_tool_name: toolName,
              },
            };
          });
          return [
            messageId,
            {
              ...meta,
              segments: nextSegments,
            },
          ] as const;
        }),
      ),
    );
  };

  // 描述：提交人工授权决策，支持“本次批准 / 会话内批准 / 拒绝”三种交互语义。
  const handleApproveAgentAction = async (
    id: string,
    approved: boolean,
    options?: {
      scope?: "once" | "session";
      toolName?: string;
      silent?: boolean;
    },
  ) => {
    const normalizedToolName = normalizeApprovalToolName(options?.toolName || "");
    try {
      await invoke(COMMANDS.APPROVE_AGENT_ACTION, { id, approved });
      if (approved && options?.scope === "session" && normalizedToolName) {
        setSessionApprovedToolNames((current) => {
          if (current.includes(normalizedToolName)) {
            return current;
          }
          return [...current, normalizedToolName];
        });
        if (!options?.silent) {
          AriMessage.success(t("已批准 {{tool}}", { tool: normalizedToolName || t("该工具") }));
        }
      }
      if (approved) {
        markApprovalSegmentResolved(
          id,
          "finished",
          t("已批准 {{tool}}", { tool: normalizedToolName || t("该工具") }),
          {
            decision: "approved",
            scope: options?.scope === "session" ? "session" : "once",
            toolName: normalizedToolName || t("该工具"),
          },
        );
      } else {
        markApprovalSegmentResolved(
          id,
          "failed",
          t("已拒绝 {{tool}} 的执行请求。", { tool: normalizedToolName || t("该工具") }),
          {
            decision: "rejected",
            scope: "once",
            toolName: normalizedToolName || t("该工具"),
          },
        );
      }
    } catch (err) {
      setStatus(t("授权操作失败，请重试"));
    }
  };

  // 描述：确认当前 DCC 软件选择，并继续执行刚才被拦截的建模请求。
  const handleConfirmPendingDccSelection = async () => {
    if (!pendingDccSelection) {
      return;
    }
    const nextSoftware = String(pendingDccSelection.selectedSoftware || "").trim().toLowerCase();
    if (pendingDccSelection.selectionMode === "cross") {
      const nextTargetSoftware = String(pendingDccSelection.selectedTargetSoftware || "").trim().toLowerCase();
      if (!nextSoftware || !nextTargetSoftware) {
        AriMessage.warning({
          content: t("请先选择源软件和目标软件。"),
          duration: 1800,
        });
        return;
      }
      if (nextSoftware === nextTargetSoftware) {
        AriMessage.warning({
          content: t("跨软件操作需要两个不同的建模软件。"),
          duration: 1800,
        });
        return;
      }
      const pendingPrompt = pendingDccSelection.prompt;
      const pendingOptions = pendingDccSelection.options;
      const pendingContextMessages = pendingDccSelection.contextMessages;
      setPendingDccSelection(null);
      await executePrompt(pendingPrompt, {
        ...pendingOptions,
        resolvedCrossDccSoftwares: [nextSoftware, nextTargetSoftware],
        skipDccSelectionPrompt: true,
        contextMessages: pendingContextMessages,
      });
      return;
    }
    if (!nextSoftware) {
      AriMessage.warning({
        content: t("请先选择一个建模软件。"),
        duration: 1800,
      });
      return;
    }
    rememberAgentSessionSelectedDccSoftware(sessionId, nextSoftware);
    setSelectedDccSoftware(nextSoftware);
    const pendingPrompt = pendingDccSelection.prompt;
    const pendingOptions = pendingDccSelection.options;
    const pendingContextMessages = pendingDccSelection.contextMessages;
    setPendingDccSelection(null);
    await executePrompt(pendingPrompt, {
      ...pendingOptions,
      resolvedDccSoftware: nextSoftware,
      skipDccSelectionPrompt: true,
      contextMessages: pendingContextMessages,
    });
  };

  // 描述：取消当前 DCC 软件选择拦截，不继续执行本轮请求。
  const handleCancelPendingDccSelection = () => {
    setPendingDccSelection(null);
    setStatus(t("已取消本轮建模执行。"));
  };

  // 描述：获取当前最后一个待授权的任务。
  const activeApprovalSegment = (() => {
    const runningMessageIds = Object.entries(assistantRunMetaMap)
      .filter(([, meta]) => meta.status === "running")
      .map(([messageId]) => messageId);
    if (runningMessageIds.length === 0) {
      return null;
    }
    const preferredMessageId = String(streamMessageIdRef.current || "").trim();
    const orderedMessageIds = preferredMessageId && runningMessageIds.includes(preferredMessageId)
      ? [preferredMessageId, ...runningMessageIds.filter((id) => id !== preferredMessageId)]
      : runningMessageIds;
    for (const messageId of orderedMessageIds) {
      const meta = assistantRunMetaMap[messageId];
      if (!meta) {
        continue;
      }
      const hit = [...meta.segments].reverse().find(
        (segment) => segment.status === "running" && isApprovalPendingSegment(segment),
      );
      if (hit) {
        return hit;
      }
    }
    return null;
  })();
  const activeApprovalData = activeApprovalSegment?.data || {};
  const activeApprovalId =
    typeof activeApprovalData.approval_id === "string" ? activeApprovalData.approval_id : "";
  const activeApprovalToolName =
    typeof activeApprovalData.tool_name === "string" ? activeApprovalData.tool_name : t("工具");
  const activeApprovalToolArgs =
    typeof activeApprovalData.tool_args === "string"
      ? truncateRunText(activeApprovalData.tool_args, APPROVAL_TOOL_ARGS_PREVIEW_MAX_CHARS)
      : "";

  // 描述：
  //
  //   - 打开“工作流/技能”选择弹窗，并用当前生效配置初始化草稿状态。
  const handleOpenWorkflowSkillModal = () => {
    const normalizedSkillIds = activeSelectedSkillIds.slice(0, 1);
    if (normalizedSkillIds.length > 0) {
      setDraftWorkflowId("");
      setDraftSkillIds(normalizedSkillIds);
      setWorkflowSkillModalVisible(true);
      return;
    }
    setDraftWorkflowId(activeSelectedWorkflowId);
    setDraftSkillIds([]);
    setWorkflowSkillModalVisible(true);
  };

  // 描述：
  //
  //   - 关闭“工作流/技能”选择弹窗，不提交草稿变更。
  const handleCloseWorkflowSkillModal = () => {
    setWorkflowSkillModalVisible(false);
    setDraftWorkflowId("");
    setDraftSkillIds([]);
  };

  // 描述：
  //
//   - 切换弹窗草稿中的技能选中状态，技能仅允许单选。
//
// Params:
//
//   - skillId: 技能 ID。
const handleToggleDraftSkill = (skillId: string) => {
  if (!skillId) {
    return;
  }
  setDraftSkillIds((current) => {
    if (current.includes(skillId)) {
      return [];
    }
    return [skillId];
  });
  setDraftWorkflowId("");
};

  // 描述：
  //
//   - 提交弹窗中的工作流与技能草稿配置，并按智能体类型写回当前会话状态。
//   - 当前执行策略约束为“技能单选”，提交前统一裁剪草稿技能列表。
const handleConfirmWorkflowSkillModal = () => {
  const nextWorkflowId = String(draftWorkflowId || "").trim();
  const nextSkillIds = draftSkillIds.slice(0, 1);
  if (!nextWorkflowId && nextSkillIds.length === 0) {
    AriMessage.warning({
      content: t("请选择一个执行策略。"),
      duration: 2500,
    });
    return;
  }
  if (nextSkillIds.length > 0) {
    setSelectedSkillIds(nextSkillIds);
    setSelectedWorkflowId("");
  } else {
    setSelectedSkillIds([]);
    setSelectedWorkflowId(nextWorkflowId || workflows[0]?.id || "");
  }
  setWorkflowSkillModalVisible(false);
  setDraftWorkflowId("");
  setDraftSkillIds([]);
  };

  useEffect(() => {
    if (!routeAutoPrompt) {
      return;
    }
    if (!sessionId || sending || autoPromptDispatchedRef.current) {
      return;
    }
    if (!messagesHydrated || hydratedSessionKey !== sessionStorageKey) {
      return;
    }
    if (messages.length > 0) {
      autoPromptDispatchedRef.current = true;
      return;
    }
    autoPromptDispatchedRef.current = true;
    void executePrompt(routeAutoPrompt, { allowDangerousAction: false, appendUserMessage: true });
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
  }, [
    executePrompt,
    hydratedSessionKey,
    location.pathname,
    location.search,
    messages.length,
    messagesHydrated,
    navigate,
    routeAutoPrompt,
    sending,
    sessionId,
    sessionStorageKey,
  ]);

  // 描述：
  //
  //   - 处理会话输入框键盘热键：Enter 发送、Escape 失焦。
  //   - 对中文输入法组合输入进行保护，避免回车上屏阶段误触发送。
  //
  // Params:
  //
  //   - event: 输入框键盘事件。
  const handlePromptInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    if (event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  };

  // 描述：关闭依赖规则确认弹窗并清理临时状态。
  const handleCloseDependencyRuleConfirm = () => {
    if (dependencyRuleUpgrading) {
      return;
    }
    setDependencyRuleConfirmState(null);
  };

  // 描述：跳过本次依赖升级并继续执行，仅跳过当前轮依赖规则校验。
  const handleSkipDependencyRuleAndContinue = async () => {
    if (!dependencyRuleConfirmState || dependencyRuleUpgrading) {
      return;
    }
    const pending = dependencyRuleConfirmState;
    setDependencyRuleConfirmState(null);
    await executePrompt(pending.prompt, {
      ...pending.options,
      skipDependencyRuleCheck: true,
    });
  };

  // 描述：先执行依赖升级，再继续当前请求；若升级失败则保留弹窗供用户选择跳过或取消。
  const handleUpgradeDependencyRuleAndContinue = async () => {
    if (!dependencyRuleConfirmState || dependencyRuleUpgrading) {
      return;
    }
    const pending = dependencyRuleConfirmState;
    setDependencyRuleUpgrading(true);
    try {
      const upgradeResponse = await invoke<DependencyRuleUpgradeResponse>(COMMANDS.APPLY_PROJECT_DEPENDENCY_RULE_UPGRADES, {
        projectPath: pending.projectPath,
        rules: pending.rules,
      });
      const updatedCount = upgradeResponse.updated?.length || 0;
      const skippedCount = upgradeResponse.skipped?.length || 0;
      setStatus(
        skippedCount > 0
          ? t("依赖升级完成：已更新 {{updated}} 项，跳过 {{skipped}} 项。", {
            updated: updatedCount,
            skipped: skippedCount,
          })
          : t("依赖升级完成：已更新 {{updated}} 项。", { updated: updatedCount }),
      );
      setDependencyRuleConfirmState(null);
      await executePrompt(pending.prompt, {
        ...pending.options,
        skipDependencyRuleCheck: true,
      });
    } catch (upgradeErr) {
      const reason = normalizeInvokeError(upgradeErr);
      setStatus(t("依赖升级失败：{{reason}}", { reason }));
    } finally {
      setDependencyRuleUpgrading(false);
    }
  };

  const handleUiHintAction = async (action: WorkflowUiHint["actions"][number]) => {
    if (action.kind === "dismiss") {
      setUiHint(null);
      return;
    }

    if (
      action.kind === "open_agent_settings"
    ) {
      setUiHint(null);
      navigate(AGENT_SETTINGS_PATH);
      return;
    }

    if (action.kind === "retry_last_step") {
      setUiHint(null);
      await retryLastStep();
      return;
    }

    if (action.kind === "apply_recovery_plan") {
      setUiHint(null);
      await retryLastStep();
      return;
    }

    if (action.kind === "allow_once") {
      const prompt = pendingDangerousPrompt.trim();
      if (!prompt) {
        setStatus(t("无法继续：缺少待确认的指令内容"));
        return;
      }
      setUiHint(null);
      setPendingDangerousPrompt("");
      setPendingDangerousToken("");
      await executePrompt(prompt, {
        allowDangerousAction: true,
        appendUserMessage: false,
        confirmationToken: pendingDangerousToken,
      });
      return;
    }

    if (action.kind === "deny") {
      setUiHint(null);
      setPendingDangerousPrompt("");
      setPendingDangerousToken("");
      setStatus(t("已取消本次危险操作"));
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: "assistant", text: t("已取消本次危险操作。") },
      ]);
    }
  };

  const retryLastStep = async () => {
    if (sending) {
      return;
    }
    const latestUserPrompt = [...messages]
      .reverse()
      .find((item) => item.role === "user" && String(item.text || "").trim());
    const normalizedPrompt = String(latestUserPrompt?.text || "").trim();
    if (!normalizedPrompt) {
      setStatus(t("无法重试：未找到最近一条用户请求"));
      return;
    }
    setStatus(t("正在重试最近一轮..."));
    await executePrompt(normalizedPrompt, {
      allowDangerousAction: false,
      appendUserMessage: false,
    });
  };

  // 描述：打开会话重命名弹窗，默认文案使用当前标题。
  const handleOpenRenameSessionModal = () => {
    setRenameValue(title || "");
    setRenameModalVisible(true);
  };

  // 描述：确认会话重命名，仅更新本地会话元信息并刷新当前页标题。
  const handleConfirmRenameSession = () => {
    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      return;
    }
    renameAgentSession(sessionId, nextTitle);
    setSessionTitle(nextTitle);
    setRenameModalVisible(false);
    setRenameValue("");
  };

  // 描述：删除当前会话，行为与侧边栏右键菜单一致：先本地移除，再异步更新后端状态。
  const handleDeleteSessionByHeaderMenu = async () => {
    if (!sessionId) {
      return;
    }
    const deletingWorkspaceId = workspaceIdFromRouteState || workspaceIdFromQuery || workspaceIdFromBinding;
    removeAgentSession(normalizedAgentKey, sessionId);
    const search = deletingWorkspaceId ? `?workspaceId=${encodeURIComponent(deletingWorkspaceId)}` : "";
    navigate(`${AGENT_HOME_PATH}${search}`);
    if (!currentUser?.id) {
      return;
    }
    try {
      await updateRuntimeSessionStatus(currentUser.id, sessionId, 0);
    } catch {
      // 描述：后端删除失败时保留本地删除结果，避免会话在界面上反复出现。
    }
  };

  // 描述：把毫秒时间戳格式化为可读时间，供“复制会话内容（含过程）”输出复用。
  //
  // Params:
  //
  //   - value: 时间戳（毫秒）。
  //
  // Returns:
  //
  //   - 格式化后的时间文本；无效值返回占位符。
  const formatSessionCopyTime = (value?: number) => {
    if (!Number.isFinite(value)) {
      return "--";
    }
    return new Date(Number(value)).toLocaleString("zh-CN", {
      hour12: false,
    });
  };

  // 描述：构建会话消息文本，按消息顺序拼接“角色 + 内容”，并在每条助手消息下附加对应的原始收发与运行片段。
  //
  // Params:
  //
  //   - items: 当前会话消息列表。
  //
  // Returns:
  //
  //   - 会话消息文本。
  const buildSessionMessageText = (items: MessageItem[]) => {
    if (!items.length) {
      return t("（当前会话暂无消息）");
    }
    const assistantMessageCount = items.filter((item) => item.role === "assistant").length;
    let assistantMessageIndex = -1;
    return items
      .map((item, index) => {
        const roleLabel = item.role === "user" ? t("用户") : t("助手");
        const content = String(item.text || "").trim() || t("（空消息）");
        const blocks = [
          t("#### 消息 {{index}} · {{role}}", {
            index: index + 1,
            role: roleLabel,
          }),
          wrapMarkdownCodeFence(content, "text"),
        ];
        if (item.role === "assistant") {
          assistantMessageIndex += 1;
          const assistantMessageId = String(item.id || "").trim();
          const aiRawText = buildSessionAiRawExchangeText(
            assistantMessageId,
            assistantMessageIndex,
            assistantMessageCount,
          );
          const runSnippetText = buildSessionRunSnippetText(assistantMessageId);
          if (aiRawText) {
            blocks.push(aiRawText);
          }
          if (runSnippetText) {
            blocks.push(runSnippetText);
          }
        }
        return blocks.join("\n\n");
      })
      .join("\n\n");
  };

  // 描述：构建会话运行过程文本，覆盖全链路调试与 Trace 信息。
  //
  // Returns:
  //
  //   - 会话运行过程文本。
  const buildSessionProcessText = () => {
    const debugFlowLines = debugFlowRecords.length > 0
      ? debugFlowRecords.map((record, index) => {
        const prefix = record.timestamp
          ? `[${formatDateTime(record.timestamp, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })}]`
          : "[--:--:--]";
        const detail = String(record.detail || "").trim() || t("（空详情）");
        return `${index + 1}. ${prefix} [${record.source || "ui"}] [${record.stage || "-"}] ${record.title || "-"}\n${detail}`;
      })
      : [t("（暂无全链路调试记录）")];
    const traceLines = traceRecords.length > 0
      ? traceRecords.map((item, index) => `${index + 1}. ${item.traceId || "-"} · ${item.source || "-"}${item.code ? ` · ${item.code}` : ""} · ${item.message || "-"}`)
      : [t("（暂无 trace 记录）")];
    return [
      t("### 4.1 全链路调试"),
      wrapMarkdownCodeFence(debugFlowLines.join("\n"), "text"),
      "",
      t("### 4.2 Trace 记录"),
      wrapMarkdownCodeFence(traceLines.join("\n"), "text"),
    ].join("\n");
  };

  // 描述：格式化 Markdown 代码块文本，统一处理空值与围栏转义。
  //
  // Params:
  //
  //   - content: 代码块原始内容。
  //   - language: 代码块语言标记。
  //
  // Returns:
  //
  //   - Markdown fenced code block 文本。
  const wrapMarkdownCodeFence = (content: string, language = "text") => {
    const normalizedContent = String(content || "").trim() || t("（无）");
    const escapedContent = normalizedContent.replace(/```/g, "``\\`");
    return `\`\`\`${language}\n${escapedContent}\n\`\`\``;
  };

  // 描述：格式化复制内容中的字符串列表，统一输出“序号 + 文本”样式。
  //
  // Params:
  //
  //   - values: 原始字符串列表。
  //   - fallback: 空列表时的兜底文案。
  //   - limit: 最大输出条数，0 表示不限制。
  //
  // Returns:
  //
  //   - 格式化后的列表文本。
  const formatSessionCopyList = (values: string[], fallback: string, limit = 0) => {
    const cleaned = values
      .map((item) => String(item || "").trim())
      .filter((item) => Boolean(item));
    const limited = limit > 0 ? cleaned.slice(0, limit) : cleaned;
    if (limited.length === 0) {
      return `- ${fallback}`;
    }
    return limited.map((item) => `- ${item}`).join("\n");
  };

  // 描述：构建会话执行配置文本，补充 AI、工作流与技能选择，便于定位执行上下文差异。
  //
  // Returns:
  //
  //   - 会话执行配置文本。
  const buildSessionExecutionConfigText = () => {
    const configuredSkillItems = selectedSessionSkills.map((item) => {
      const name = String(item.name || "").trim() || item.id;
      return `${name} (${item.id})`;
    });
    const workflowSummary = selectedWorkflow
      ? `${selectedWorkflow.name} (${selectedWorkflow.id})`
      : t("（当前未选择工作流，可能已切换为技能执行）");
    const providerName = String(selectedAi?.providerLabel || selectedAi?.provider || selectedProvider || "").trim() || "-";
    const providerId = String(selectedAi?.provider || selectedProvider || "").trim() || "-";
    return [
      t("- 会话类型：智能体"),
      t("- AI：{{name}} ({{id}})", { name: providerName, id: providerId }),
      t("- 工作流：{{workflow}}", { workflow: workflowSummary }),
      "",
      t("#### 可使用技能列表"),
      formatSessionCopyList(configuredSkillItems, t("（未配置会话技能，使用工作流默认技能链）")),
    ].join("\n");
  };

  // 描述：构建项目设置文本，输出目录信息、依赖规范与结构化项目信息摘要，便于跨会话排查。
  //
  // Returns:
  //
  //   - 项目设置文本。
  const buildSessionProjectSettingsText = () => {
    if (!activeWorkspace) {
      return t("- 当前会话不关联项目设置。");
    }
    const workspaceName = String(activeWorkspace?.name || "").trim() || "-";
    const workspacePath = String(activeWorkspace?.path || "").trim() || "-";
    const dependencyRules = activeWorkspace?.dependencyRules || [];
    const enabledCapabilityLines = activeWorkspaceEnabledCapabilities.map((capabilityId) => {
      const manifest = getProjectWorkspaceCapabilityManifest(capabilityId);
      return manifest
        ? `${manifest.title}（${manifest.id}）`
        : capabilityId;
    });
    const projectKnowledgeEnabled = isProjectWorkspaceCapabilityEnabled(activeWorkspace, "project-knowledge");
    const dependencyPolicyEnabled = isProjectWorkspaceCapabilityEnabled(activeWorkspace, "dependency-policy");
    const toolchainIntegrationEnabled = isProjectWorkspaceCapabilityEnabled(activeWorkspace, "toolchain-integration");
    const profile = activeProjectProfile;
    const profileSummary = String(profile?.summary || "").trim() || t("（无）");
    const sectionLines = (profile?.knowledgeSections || []).map((section) => {
      const title = String(section.title || section.key || "").trim() || t("未命名分类");
      const entryCount = (section.facets || []).reduce(
        (count, facet) => count + (facet.entries?.length || 0),
        0,
      );
      return t("{{title}}：{{facetCount}} 个维度 / {{entryCount}} 条条目", {
        title,
        facetCount: section.facets?.length || 0,
        entryCount,
      });
    });
    const keyFactLines = [
      ...((profile?.apiDataModel?.entities || []).map((item) => t("API 实体：{{item}}", { item }))),
      ...((profile?.frontendPageLayout?.pages || []).map((item) => t("页面：{{item}}", { item }))),
      ...((profile?.frontendCodeStructure?.directories || []).map((item) => t("目录：{{item}}", { item }))),
    ];
    return [
      t("- 项目名称：{{name}}", { name: workspaceName }),
      t("- 项目路径：{{path}}", { path: workspacePath }),
      "",
      t("#### 项目能力"),
      formatSessionCopyList(enabledCapabilityLines, t("（未启用项目能力）"), 20),
      ...(dependencyPolicyEnabled
        ? [
          "",
          t("#### 依赖策略"),
          formatSessionCopyList(dependencyRules, t("（未配置依赖规范）"), 20),
        ]
        : []),
      ...(projectKnowledgeEnabled
        ? [
          "",
          t("#### 项目知识"),
          `- revision：${profile?.revision || 0}`,
          `- updatedAt：${profile?.updatedAt || "-"}`,
          `- updatedBy：${profile?.updatedBy || "-"}`,
          `- summary：${profileSummary}`,
          "",
          t("##### 分类摘要"),
          formatSessionCopyList(sectionLines, t("（暂无分类）"), 20),
          "",
          t("##### 关键条目（采样）"),
          formatSessionCopyList(keyFactLines, t("（暂无关键条目）"), 20),
        ]
        : []),
      ...(toolchainIntegrationEnabled
        ? [
          "",
          t("#### 工具接入"),
          t("- 项目级 MCP / DCC Runtime 通过“项目能力 -> 工具接入”维护。"),
        ]
        : []),
    ].join("\n");
  };

  // 描述：构建指定助手消息对应的“AI 原始收发”文本，优先读取 messageId 对应的原始数据。
  //
  // Returns:
  //
  //   - AI 原始收发文本。
  const buildSessionAiRawExchangeText = (
    messageId: string,
    assistantIndex: number,
    assistantCount: number,
  ) => {
    const rawByMessage = messageId ? sessionAiRawByMessage[messageId] : undefined;
    const mappedPromptRaw = String(rawByMessage?.promptRaw || "").trim();
    const mappedResponseRaw = String(rawByMessage?.responseRaw || "").trim();
    if (mappedPromptRaw || mappedResponseRaw) {
      return [
        t("##### AI 原始收发"),
        t("###### 请求（Prompt，原始）"),
        wrapMarkdownCodeFence(mappedPromptRaw || t("（无）"), "text"),
        "",
        t("###### 响应（Raw）"),
        wrapMarkdownCodeFence(mappedResponseRaw || t("（无）"), "text"),
      ].join("\n");
    }
    // 描述：兼容历史会话（仅存会话级原始收发）时，仅在“单助手消息”场景回退，避免多消息错配。
    if (assistantCount !== 1 || assistantIndex !== 0) {
      return "";
    }
    const latestCodegenStep = [...stepRecords]
      .reverse()
      .find((item) => item.code === "llm_python_codegen" && item.data && typeof item.data === "object");
    const latestCodegenData = latestCodegenStep?.data || {};
    const agentPromptRaw = String(latestCodegenData.llm_prompt_raw || "").trim();
    const codeResponseRaw = String(latestCodegenData.llm_response_raw || "").trim();
    const findDebugFlowDetail = (
      stageCandidates: string[],
      titleKeywords: string[],
    ) => {
      const record = debugFlowRecords.find((item) => {
        const stage = String(item.stage || "").trim().toLowerCase();
        const titleText = String(item.title || "").trim();
        return stageCandidates.includes(stage)
          || titleKeywords.some((keyword) => titleText.includes(keyword));
      });
      return String(record?.detail || "").trim();
    };
    const fallbackPromptRaw = findDebugFlowDetail(
      ["llm_plan_prompt", "ai_summary_prompt"],
      [t("Prompt"), t("提示词")],
    );
    const fallbackResponseRaw = findDebugFlowDetail(
      ["llm_plan_raw_response", "ai_summary_raw"],
      [t("原始返回"), "raw"],
    );
    const promptRaw = agentPromptRaw || fallbackPromptRaw;
    const fallbackPrompt = String(sessionAiPromptRaw || agentPromptRawRef.current || "").trim();
    const fallbackResponse = String(
      sessionAiResponseRaw || agentLlmResponseRawRef.current || agentLlmDeltaBufferRef.current || "",
    ).trim();
    const responseRaw = codeResponseRaw || fallbackResponseRaw || fallbackResponse;
    const rawPromptForCopy = promptRaw || fallbackPrompt;
    if (!rawPromptForCopy && !responseRaw) {
      return "";
    }
    return [
      t("##### AI 原始收发"),
      t("###### 请求（Prompt，原始）"),
      wrapMarkdownCodeFence(rawPromptForCopy || t("（无）"), "text"),
      "",
      t("###### 响应（Raw）"),
      wrapMarkdownCodeFence(responseRaw || t("（无）"), "text"),
    ].join("\n");
  };

  // 描述：规范化运行片段标题，兼容历史“泛化标题”并输出更具体的排查语义。
  //
  // Params:
  //
  //   - intro: 原始片段标题。
  //   - step: 原始片段步骤描述。
  //
  // Returns:
  //
  //   - 规范化后的片段标题。
  const normalizeRunSegmentIntroForCopy = (intro: string, step: string) => {
    const normalizedIntro = String(intro || "").trim();
    const normalizedStep = String(step || "").trim();
    if (!normalizedIntro) {
      return t("执行片段");
    }
    if (normalizedIntro === t("正在处理当前步骤")) {
      if (normalizedStep.includes("provider=") && normalizedStep.includes("started")) {
        return t("模型开始生成脚本");
      }
      if (normalizedStep.includes("provider=") && normalizedStep.includes("finished")) {
        return t("模型脚本生成完成");
      }
      return t("步骤处理中");
    }
    if (normalizedIntro === t("当前步骤已完成")) {
      if (normalizedStep.includes("provider=") && normalizedStep.includes("finished")) {
        return t("模型脚本生成完成");
      }
      return t("步骤执行完成");
    }
    if (normalizedIntro === t("智能体正在思考")) {
      return t("规划执行策略");
    }
    return normalizedIntro;
  };

  // 描述：判断运行片段是否属于排查价值较低的噪声信息，复制时自动过滤。
  //
  // Params:
  //
  //   - intro: 片段标题。
  //   - step: 片段详情。
  //   - status: 片段状态。
  //
  // Returns:
  //
  //   - true 表示该片段应在复制内容中隐藏。
  const shouldHideRunSegmentInCopy = (
    intro: string,
    step: string,
    status: AssistantRunSegmentStatus,
  ) => {
    if (status === "failed") {
      return false;
    }
    const normalizedIntro = String(intro || "").trim();
    const normalizedStep = String(step || "").trim();
    if (!normalizedIntro && !normalizedStep) {
      return true;
    }
    if (
      normalizedStep === t("当前步骤仍在执行，请稍候。")
      || normalizedStep === t("执行仍在进行中，正在同步最新状态。")
      || normalizedStep.includes(t("规划中：正在确认本次操作所需的工具链与任务顺序"))
      || normalizedStep.includes(t("规划中：正在确认本次操作所需的工具链"))
    ) {
      return true;
    }
    return false;
  };

  // 描述：构建指定助手消息对应的运行片段文本，仅按 messageId 命中，避免跨消息错配。
  //
  // Params:
  //
  //   - messageId: 助手消息 ID。
  //
  // Returns:
  //
  //   - 运行片段文本。
  const buildSessionRunSnippetText = (messageId: string) => {
    if (!messageId) {
      return "";
    }
    const runMetaEntries = Object.entries(assistantRunMetaMap)
      .map(([entryMessageId, runMeta]) => ({ messageId: entryMessageId, runMeta }))
      .sort((a, b) => a.runMeta.startedAt - b.runMeta.startedAt);
    if (runMetaEntries.length === 0) {
      return "";
    }
    const matchedEntry = runMetaEntries.find((entry) => entry.messageId === messageId);
    if (!matchedEntry) {
      return "";
    }
    const scopedEntries = [matchedEntry];
    const runMetaLines = scopedEntries.flatMap((entry, runIndex) => {
      const runHeader = `${runIndex + 1}. message=${entry.messageId || "-"} · status=${entry.runMeta.status || "-"} · started=${formatSessionCopyTime(entry.runMeta.startedAt)} · finished=${formatSessionCopyTime(entry.runMeta.finishedAt)}`;
      const summary = String(entry.runMeta.summary || "").trim();
      const filteredSegments = entry.runMeta.segments
        .map((segment) => {
          const intro = normalizeRunSegmentIntroForCopy(segment.intro, segment.step);
          const step = String(segment.step || "").trim() || t("（空步骤）");
          return {
            status: segment.status,
            intro,
            step,
          };
        })
        .filter((segment) => !shouldHideRunSegmentInCopy(segment.intro, segment.step, segment.status));
      const segmentLines = (filteredSegments.length > 0 ? filteredSegments : [{
        status: entry.runMeta.status === "failed" ? "failed" : "finished",
        intro: t("执行过程摘要"),
        step: summary || t("（本轮未记录可展示的执行片段）"),
      }]).map((segment, segmentIndex) => (
        `   ${segmentIndex + 1}. [${segment.status}] ${segment.intro}\n      ${segment.step}`
      ));
      return [
        runHeader,
        summary ? t("   总结：{{summary}}", { summary }) : "",
        ...segmentLines,
      ].filter(Boolean);
    });
    return [
      t("##### 运行片段"),
      wrapMarkdownCodeFence(runMetaLines.join("\n"), "text"),
    ].join("\n");
  };

  // 描述：构建可复制的完整会话文本，包含会话消息、执行配置、项目设置、AI 原始收发与运行过程。
  //
  // Returns:
  //
  //   - 可直接写入剪贴板的完整会话文本。
  const buildSessionFullCopyText = () => {
    return [
      t("# 会话排查记录"),
      "",
      t("## 一、会话概览"),
      t("- 标题：{{title}}", { title }),
      t("- 会话ID：{{id}}", { id: sessionId || "-" }),
      t("- 智能体：{{agent}}", { agent: normalizedAgentKey || "-" }),
      t("- 状态：{{status}}", { status: status || "-" }),
      "",
      t("## 二、环境与配置"),
      t("### 2.1 会话配置"),
      buildSessionExecutionConfigText(),
      "",
      t("### 2.2 项目信息（含项目能力）"),
      buildSessionProjectSettingsText(),
      "",
      t("## 三、会话内容"),
      t("### 3.1 会话消息"),
      buildSessionMessageText(messages),
      "",
      t("## 四、执行过程"),
      buildSessionProcessText(),
    ].join("\n");
  };

  // 描述：向 Dev 调试窗口广播复制结果，便于在调试面板反馈复制成功/失败状态。
  //
  // Params:
  //
  //   - ok: 复制是否成功。
  //   - message: 反馈文案。
  const emitSessionCopyResult = useCallback((ok: boolean, message: string) => {
    if (!IS_BROWSER) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("libra:session-copy-result", {
        detail: {
          sessionId,
          ok,
          message,
          timestamp: Date.now(),
        },
      }),
    );
  }, [sessionId]);

  // 描述：复制完整会话内容（含过程）到系统剪贴板，供 Dev 调试窗口触发。
  const handleCopySessionContent = useCallback(async () => {
    try {
      if (!navigator?.clipboard?.writeText) {
        const failedMessage = t("复制失败，请检查系统剪贴板权限");
        setStatus(failedMessage);
        emitSessionCopyResult(false, failedMessage);
        return;
      }
      const fullConversationText = buildSessionFullCopyText();
      await navigator.clipboard.writeText(fullConversationText);
      const successMessage = t("会话内容（含过程）已复制");
      setStatus(successMessage);
      emitSessionCopyResult(true, successMessage);
    } catch {
      const failedMessage = t("复制失败，请检查系统剪贴板权限");
      setStatus(failedMessage);
      emitSessionCopyResult(false, failedMessage);
    }
  }, [
    activeProjectProfile,
    activeWorkspace,
    activeSelectedSkillIds,
    assistantRunMetaMap,
    debugFlowRecords,
    emitSessionCopyResult,
    t,
    messages,
    normalizedAgentKey,
    selectedAi,
    selectedWorkflow,
    selectedProvider,
    selectedSessionSkills,
    sessionId,
    status,
    stepRecords,
    title,
    traceRecords,
  ]);

  // 描述：监听 Dev 调试窗口的“复制会话内容”请求，只在当前会话匹配时执行复制。
  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }
    const handleCopyRequest = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string }>;
      const targetSessionId = String(customEvent.detail?.sessionId || "").trim();
      if (targetSessionId && targetSessionId !== sessionId) {
        return;
      }
      void handleCopySessionContent();
    };
    window.addEventListener("libra:session-copy-request", handleCopyRequest as EventListener);
    return () => {
      window.removeEventListener("libra:session-copy-request", handleCopyRequest as EventListener);
    };
  }, [handleCopySessionContent, sessionId]);

  // 描述：处理 Header 更多菜单动作，复用侧边栏右键会话菜单同款能力。
  const handleSelectSessionHeadMenu = (key: string) => {
    if (key === "pin") {
      togglePinnedAgentSession(sessionId);
      setSessionMenuVersion((current) => current + 1);
      return;
    }
    if (key === "rename") {
      handleOpenRenameSessionModal();
      return;
    }
    if (key === "delete") {
      void handleDeleteSessionByHeaderMenu();
    }
  };

  const sessionHeaderNode = (
    <AriContainer className="desk-session-head-wrap" padding={0} data-tauri-drag-region>
      <AriFlex
        className="desk-session-head-bar"
        align="center"
        justify="space-between"
        data-tauri-drag-region
      >
        <AriFlex className="desk-session-head-main" align="center" space={8} data-tauri-drag-region>
          <AriTypography
            className="desk-session-head-title"
            variant="h4"
            value={title}
          />
          {sessionHeadParentHint ? (
            <AriTypography
              className="desk-session-head-parent-hint"
              variant="caption"
              value={sessionHeadParentHint}
            />
          ) : null}
          <AriTooltip
            position="bottom"
            content={(
              <AriMenu
                items={sessionHeadMenuItems}
                onSelect={handleSelectSessionHeadMenu}
              />
            )}
          >
            <AriButton
              type="text"
              className="desk-session-head-more-btn"
              icon="more_horiz"
              aria-label={t("更多操作")}
            />
          </AriTooltip>
        </AriFlex>
        <AriFlex className="desk-session-head-extra" align="center" />
      </AriFlex>
    </AriContainer>
  );

  return (
    <AriContainer className="desk-content desk-session-content" height="100%" showBorderRadius={false}>
      {headerSlotElement ? createPortal(sessionHeaderNode, headerSlotElement) : null}
      <AriModal
        visible={Boolean(dependencyRuleConfirmState)}
        title={t("依赖版本需确认")}
        onClose={handleCloseDependencyRuleConfirm}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              type="default"
              label={t("取消")}
              disabled={dependencyRuleUpgrading}
              onClick={handleCloseDependencyRuleConfirm}
            />
            <AriButton
              type="default"
              label={t("本次跳过继续")}
              disabled={dependencyRuleUpgrading}
              onClick={() => {
                void handleSkipDependencyRuleAndContinue();
              }}
            />
            <AriButton
              type="default"
              color="brand"
              label={dependencyRuleUpgrading ? t("升级中...") : t("升级并继续")}
              disabled={dependencyRuleUpgrading}
              onClick={() => {
                void handleUpgradeDependencyRuleAndContinue();
              }}
            />
          </AriFlex>
        )}
      >
        <AriContainer padding={0}>
          <AriTypography
            variant="caption"
            value={t("检测到 {{count}} 项依赖与项目规范不一致。", {
              count: dependencyRuleConfirmState?.mismatches?.length || 0,
            })}
          />
          <AriContainer padding={0}>
            {(dependencyRuleConfirmState?.mismatches || []).slice(0, 8).map((item, index) => (
              <AriTypography
                key={`${item.ecosystem}-${item.package_name}-${index}`}
                variant="caption"
                value={t("{{ecosystem}}: {{packageName}} {{currentVersion}} -> {{expectedVersion}}", {
                  ecosystem: item.ecosystem,
                  packageName: item.package_name,
                  currentVersion: item.current_version || t("(未读取)"),
                  expectedVersion: item.expected_version,
                })}
              />
            ))}
          </AriContainer>
        </AriContainer>
      </AriModal>
      <AriModal
        visible={renameModalVisible}
        title={t("重命名会话")}
        onClose={() => {
          setRenameModalVisible(false);
          setRenameValue("");
        }}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              type="default"
              label={t("取消")}
              onClick={() => {
                setRenameModalVisible(false);
                setRenameValue("");
              }}
            />
            <AriButton
              type="default"
              color="brand"
              label={t("确定")}
              onClick={handleConfirmRenameSession}
            />
          </AriFlex>
        )}
      >
        <AriInput
          value={renameValue}
          onChange={setRenameValue}
          placeholder={t("请输入会话名称")}
          maxLength={60}
        />
      </AriModal>
      <AriModal
        visible={workflowSkillModalVisible}
        title={t("选择执行策略")}
        onClose={handleCloseWorkflowSkillModal}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              type="default"
              label={t("取消")}
              onClick={handleCloseWorkflowSkillModal}
            />
            <AriButton
              type="default"
              color="brand"
              label={t("确定")}
              onClick={handleConfirmWorkflowSkillModal}
            />
          </AriFlex>
        )}
      >
        <AriContainer className="desk-session-strategy-modal-body" padding={0}>
          <AriTypography
            className="desk-session-strategy-section-title"
            variant="caption"
            value={t("工作流")}
          />
          <AriList
            bordered
            className="desk-session-strategy-list"
            emptyMessage={t("暂无可选工作流")}
          >
            {workflowMenuItems.map((item) => (
              <AriListItem
                key={`workflow-${item.key}`}
                split={false}
                className={`desk-session-strategy-item${draftWorkflowId === item.key ? " is-active" : ""}`}
                onClick={() => {
                  setDraftWorkflowId(item.key);
                  setDraftSkillIds([]);
                }}
                actions={[
                  <AriTypography key={`${item.key}-type`} variant="caption" value={t("工作流")} />,
                ]}
                extra={
                  draftWorkflowId === item.key ? (
                    <AriContainer className="desk-session-strategy-item-extra" padding={0}>
                      <AriIcon name="done" />
                    </AriContainer>
                  ) : null
                }
              >
                <AriFlex className="desk-session-strategy-item-main" align="center" space={8}>
                  <AriContainer className="desk-session-strategy-item-icon" padding={0}>
                    <AriIcon name="account_tree" />
                  </AriContainer>
                  <AriContainer className="desk-session-strategy-item-text" padding={0}>
                    <AriTypography variant="h4" value={item.label} />
                    <AriTypography
                      variant="caption"
                      value={item.description || t("按该工作流执行。")}
                    />
                  </AriContainer>
                </AriFlex>
              </AriListItem>
            ))}
          </AriList>

          <AriTypography
            className="desk-session-strategy-section-title"
            variant="caption"
            value={t("技能")}
          />
          <AriList
            bordered
            className="desk-session-strategy-list"
            emptyMessage={t("暂无可用技能")}
          >
            {availableSkills.map((item) => (
              <AriListItem
                key={`skill-${item.id}`}
                split={false}
                className={`desk-session-strategy-item${draftSkillIds.includes(item.id) ? " is-active" : ""}`}
                onClick={() => {
                  handleToggleDraftSkill(item.id);
                }}
                actions={[
                  <AriTypography key={`${item.id}-origin`} variant="caption" value={t("系统")} />,
                ]}
                extra={
                  draftSkillIds.includes(item.id) ? (
                    <AriContainer className="desk-session-strategy-item-extra" padding={0}>
                      <AriIcon name="done" />
                    </AriContainer>
                  ) : null
                }
              >
                <AriFlex className="desk-session-strategy-item-main" align="center" space={8}>
                  <AriContainer className="desk-session-strategy-item-icon" padding={0}>
                    <AriIcon name={item.icon} />
                  </AriContainer>
                  <AriContainer className="desk-session-strategy-item-text" padding={0}>
                    <AriTypography variant="h4" value={item.name} />
                    <AriTypography variant="caption" value={item.description} />
                  </AriContainer>
                </AriFlex>
              </AriListItem>
            ))}
          </AriList>
        </AriContainer>
      </AriModal>
      <AriContainer className="desk-session-shell">
        <AriContainer className="desk-session-thread-wrap">
          <AriContainer className="desk-thread">
            {messages.length === 0 ? (
              <AriContainer className="desk-session-empty-state">
                <AriCard className="desk-session-empty-card">
                  <AriTypography variant="h4" value={t("快速开始")} />
                  <AriTypography
                    variant="caption"
                    value={resolvedSessionUiConfig.emptyStatePrimary}
                  />
                </AriCard>
                <AriCard className="desk-session-empty-card">
                  <AriTypography variant="h4" value={t("提示")} />
                  <AriTypography
                    variant="caption"
                    value={resolvedSessionUiConfig.emptyStateSecondary}
                  />
                </AriCard>
              </AriContainer>
            ) : null}
            {messages.map((message, index) => {
              const roleClass = message.role === "user" ? "user" : "assistant";
              const runMeta = message.id
                ? assistantRunMetaMap[message.id]
                : undefined;
              const isUserMessage = message.role === "user";
              const useRunLayout =
                message.role === "assistant" && Boolean(runMeta);
              const messageKey = String(message.id || `message-${index}`);
              const dividerTitle = runMeta
                ? runMeta.status === "failed"
                    ? t("执行中断，用时 {{duration}}", { duration: formatElapsedDuration(runMeta.startedAt, runMeta.finishedAt) })
                  : t("已完成，用时 {{duration}}", { duration: formatElapsedDuration(runMeta.startedAt, runMeta.finishedAt) })
                : "";
              const failureSummary = runMeta?.status === "failed"
                ? buildAssistantFailureSummary(runMeta.summary || message.text)
                : null;
              const runSegmentsForRender: AssistantRunSegment[] = runMeta
                ? (() => {
                  const normalizedRenderSegments = normalizeAssistantRunSegments(runMeta.segments);
                  const normalizedSegments = normalizedRenderSegments
                    .map((segment) => {
                      const intro = isInitialThinkingSegment(segment)
                        ? ""
                        : normalizeRunSegmentIntroForCopy(segment.intro, segment.step);
                      const step = String(segment.step || "").trim() || t("（空步骤）");
                      return {
                        ...segment,
                        intro,
                        step,
                      };
                    })
                    .filter((segment) => !shouldHideRunSegmentInCopy(segment.intro, segment.step, segment.status));
                  if (normalizedSegments.length > 0) {
                    return normalizedSegments;
                  }
                  if (runMeta.status === "running") {
                    return [{
                      key: `fallback-running-${messageKey}`,
                      intro: t("执行进行中"),
                      step: t("等待执行状态回传…"),
                      status: "running",
                    }];
                  }
                  const fallbackStep = String(runMeta.summary || message.text || "").trim()
                    || t("（本轮未记录可展示的执行片段）");
                  return [{
                    key: `fallback-summary-${messageKey}`,
                    intro: t("执行过程摘要"),
                    step: fallbackStep,
                    status: runMeta.status === "failed" ? "failed" : "finished",
                  }];
                })()
                : [];
              const hasPendingApprovalInRender = runMeta?.status === "running"
                && runSegmentsForRender.some(
                  (segment) => segment.status === "running" && isApprovalPendingSegment(segment),
                );
              const runSegmentGroups = buildRunSegmentGroups(runSegmentsForRender);
              const runningIndicatorText = resolveRunningIndicatorText(message.text, runMeta);
              const renderRunSegment = (segment: AssistantRunSegmentStep, segmentKeyPrefix = "") => {
                const segmentDomKey = `${segmentKeyPrefix}${segment.key}`;
                const detailKey = `${messageKey}:${segmentDomKey}`;
                const detailExpanded = Boolean(expandedRunSegmentDetailMap[detailKey]);
                return (
                  <SessionRunSegmentItem
                    key={segmentDomKey}
                    segment={segment}
                    detailExpanded={detailExpanded}
                    onToggleDetail={() => {
                      toggleRunSegmentDetailExpanded(detailKey);
                    }}
                    onCopyFilePath={(filePath) => {
                      void handleCopyRunStepFilePath(filePath);
                    }}
                  />
                );
              };
              const messageContent = useRunLayout && runMeta ? (
                <AriContainer className="desk-run-flow" padding={0}>
                  {runMeta.status === "running" ? (
                    <AriContainer className="desk-run-segments" padding={0}>
                      {runSegmentGroups.map((group) => (
                        <AriContainer key={group.key} className="desk-run-group" padding={0}>
                          {String(group.title || "").trim() ? (
                            <AriTypography
                              className="desk-run-intro"
                              variant="body"
                              value={group.title}
                            />
                          ) : null}
                          <AriContainer className="desk-run-group-steps" padding={0}>
                            {group.steps.map((step) => renderRunSegment(step))}
                          </AriContainer>
                        </AriContainer>
                      ))}
                      {!hasPendingApprovalInRender ? (
                        <AriContainer className="desk-run-thinking-indicator" padding={0}>
                          <AriTypography
                            className="desk-run-step desk-run-step-running"
                            variant="caption"
                            value={runningIndicatorText}
                          />
                        </AriContainer>
                      ) : null}
                    </AriContainer>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="desk-run-divider"
                        onClick={() => {
                          if (message.id) {
                            toggleAssistantRunMetaCollapsed(message.id);
                          }
                        }}
                      >
                        <span className="desk-run-divider-line" />
                        <span className="desk-run-divider-text">
                          {dividerTitle}
                        </span>
                        <span
                          className={`desk-run-divider-arrow ${runMeta.collapsed ? "" : "open"}`}
                        >
                          ▾
                        </span>
                        <span className="desk-run-divider-line" />
                      </button>
                      {!runMeta.collapsed ? (
                        <AriContainer className="desk-run-segments desk-run-segments-collapsed" padding={0}>
                          {runSegmentGroups.map((group) => (
                            <AriContainer key={`collapsed-${group.key}`} className="desk-run-group" padding={0}>
                              {String(group.title || "").trim() ? (
                                <AriTypography
                                  className="desk-run-intro"
                                  variant="body"
                                  value={group.title}
                                />
                              ) : null}
                              <AriContainer className="desk-run-group-steps" padding={0}>
                                {group.steps.map((step) => renderRunSegment(step, "collapsed-"))}
                              </AriContainer>
                            </AriContainer>
                          ))}
                        </AriContainer>
                      ) : null}
                      <AriContainer className={`desk-run-summary ${runMeta.status === "failed" ? "desk-run-summary-failed" : ""}`} padding={0}>
                        {runMeta.status === "failed" && failureSummary ? (
                          <AriContainer className="desk-run-failure-card">
                            <AriFlex className="desk-run-failure-head" align="center" space={8}>
                              <AriIcon name="error" />
                              <AriTypography variant="h4" value={t("执行失败")} />
                            </AriFlex>
                            <AriTypography
                              className="desk-run-failure-detail"
                              variant="caption"
                              value={failureSummary.detail}
                            />
                            <AriTypography
                              className="desk-run-failure-hint"
                              variant="caption"
                              value={failureSummary.hint}
                            />
                            <AriFlex className="desk-run-failure-actions" justify="flex-end" space={8}>
                              <AriButton
                                size="sm"
                                icon="refresh"
                                label={t("重试本轮")}
                                disabled={sending}
                                onClick={() => {
                                  void handleRetryAssistantMessage(index);
                                }}
                              />
                            </AriFlex>
                          </AriContainer>
                        ) : (
                          <ChatMarkdown
                            content={runMeta.summary || message.text}
                          />
                        )}
                      </AriContainer>
                    </>
                  )}
                </AriContainer>
              ) : (
                <ChatMarkdown
                  content={message.text}
                  plainText={
                    sending &&
                    Boolean(message.id) &&
                    message.id === streamMessageIdRef.current
                  }
                />
              );
              return (
                <AriContainer
                  key={messageKey}
                  className={`desk-msg ${roleClass}`}
                  padding={0}
                >
                  {isUserMessage ? (
                    <AriCard className="desk-msg-user-surface">
                      {messageContent}
                    </AriCard>
                  ) : (
                    <AriContainer className="desk-msg-assistant-surface" padding={0}>
                      {messageContent}
                    </AriContainer>
                  )}
                  <AriFlex
                    className="desk-msg-hover-toolbar"
                    align="center"
                    justify={isUserMessage ? "flex-end" : "flex-start"}
                    space={8}
                  >
                    {isUserMessage ? (
                      <AriTooltip content={t("编辑")} position="top" minWidth={0} matchTriggerWidth={false}>
                        <AriButton
                          ghost
                          size="sm"
                          icon="edit"
                          aria-label={t("编辑消息")}
                          disabled={sending}
                          onClick={() => {
                            handleEditUserMessage(message.text);
                          }}
                        />
                      </AriTooltip>
                    ) : (
                      <AriTooltip
                        content={t("重试")}
                        position="top"
                        trigger="manual"
                        visible={!sending && hoveredRetryTooltipMessageId === messageKey}
                        minWidth={0}
                        matchTriggerWidth={false}
                      >
                        <AriButton
                          ghost
                          size="sm"
                          icon="refresh"
                          aria-label={t("重试消息")}
                          disabled={sending}
                          onMouseEnter={() => {
                            setHoveredRetryTooltipMessageId(messageKey);
                          }}
                          onMouseLeave={() => {
                            setHoveredRetryTooltipMessageId((current) => (current === messageKey ? "" : current));
                          }}
                          onClick={() => {
                            setHoveredRetryTooltipMessageId("");
                            void handleRetryAssistantMessage(index);
                          }}
                        />
                      </AriTooltip>
                    )}
                    <AriTooltip content={t("复制")} position="top" minWidth={0} matchTriggerWidth={false}>
                      <AriButton
                        ghost
                        size="sm"
                        icon="content_copy"
                        aria-label={t("复制消息")}
                        onClick={() => {
                          void handleCopyMessageContent(message.text);
                        }}
                      />
                    </AriTooltip>
                  </AriFlex>
                </AriContainer>
              );
            })}
          </AriContainer>
        </AriContainer>

        <AriContainer className="desk-prompt-dock">
          {activeApprovalSegment ? (
            <AriCard className="desk-action-slot desk-action-slot-warning">
                <AriFlex align="center" space={8}>
                  <AriIcon name="security" />
                  <AriTypography variant="h4" value={t("高危操作待授权")} />
                </AriFlex>
              <AriTypography
                variant="caption"
                value={t("智能体申请执行 {{tool}}：", { tool: activeApprovalToolName })}
              />
              <AriContainer className="desk-approval-tool-args">
                {activeApprovalToolArgs}
              </AriContainer>
              <AriFlex align="center" space={8} className="desk-action-slot-actions">
                <AriButton
                  color="primary"
                  label={t("本次批准")}
                  disabled={!activeApprovalId}
                  onClick={() =>
                    handleApproveAgentAction(
                      activeApprovalId,
                      true,
                      {
                        scope: "once",
                        toolName: activeApprovalToolName,
                      },
                    )
                  }
                />
                <AriButton
                  label={t("会话内批准")}
                  disabled={!activeApprovalId}
                  onClick={() =>
                    handleApproveAgentAction(
                      activeApprovalId,
                      true,
                      {
                        scope: "session",
                        toolName: activeApprovalToolName,
                      },
                    )
                  }
                />
                <AriButton
                  label={t("拒绝")}
                  disabled={!activeApprovalId}
                  onClick={() =>
                    handleApproveAgentAction(
                      activeApprovalId,
                      false,
                      {
                        scope: "once",
                        toolName: activeApprovalToolName,
                      },
                    )
                  }
                />
              </AriFlex>
            </AriCard>
          ) : pendingDccSelection ? (
            <AriCard className="desk-action-slot desk-action-slot-warning">
              <AriTypography
                variant="h4"
                value={pendingDccSelection.selectionMode === "cross" ? t("请选择源软件和目标软件") : t("请选择建模软件")}
              />
              <AriTypography
                variant="caption"
                value={pendingDccSelection.selectionMode === "cross"
                  ? t("当前请求涉及跨软件建模操作。请先明确源软件和目标软件；未明确两个软件前，不会自动规划跨软件迁移。")
                  : t("当前命中了建模 Skill，且存在多个可用建模软件。请先选择本话题要使用的软件，后续未明确改用其他软件前都会继续使用它。")}
              />
              <AriSelect
                value={pendingDccSelection.selectedSoftware}
                options={pendingDccSelection.softwareOptions.map((item) => ({
                  value: item.software,
                  label: `${item.label} (${item.providerIds.join(", ")})`,
                }))}
                onChange={(value: unknown) => {
                  const nextSoftware = String(value || "").trim().toLowerCase();
                  setPendingDccSelection((current) => {
                    if (!current) {
                      return current;
                    }
                    return {
                      ...current,
                      selectedSoftware: nextSoftware,
                    };
                  });
                }}
              />
              {pendingDccSelection.selectionMode === "cross" ? (
                <AriSelect
                  value={pendingDccSelection.selectedTargetSoftware}
                  options={pendingDccSelection.softwareOptions
                    .filter((item) => item.software !== pendingDccSelection.selectedSoftware)
                    .map((item) => ({
                      value: item.software,
                      label: `${item.label} (${item.providerIds.join(", ")})`,
                    }))}
                  onChange={(value: unknown) => {
                    const nextTargetSoftware = String(value || "").trim().toLowerCase();
                    setPendingDccSelection((current) => {
                      if (!current) {
                        return current;
                      }
                      return {
                        ...current,
                        selectedTargetSoftware: nextTargetSoftware,
                      };
                    });
                  }}
                />
              ) : null}
              <AriFlex
                align="center"
                space={8}
                className="desk-action-slot-actions"
              >
                <AriButton
                  color="primary"
                  icon="check"
                  label={pendingDccSelection.selectionMode === "cross" ? t("按该组合继续") : t("使用该软件继续")}
                  onClick={() => {
                    void handleConfirmPendingDccSelection();
                  }}
                />
                <AriButton
                  ghost
                  icon="close"
                  label={t("取消")}
                  onClick={handleCancelPendingDccSelection}
                />
              </AriFlex>
            </AriCard>
          ) : uiHint ? (
            <AriCard
              className={`desk-action-slot ${uiHint ? `desk-action-slot-${uiHint.level}` : ""}`}
            >
              {uiHint ? (
                <>
                  <AriTypography variant="h4" value={uiHint.title} />
                  <AriTypography variant="caption" value={uiHint.message} />
                  <AriFlex
                    align="center"
                    space={8}
                    className="desk-action-slot-actions"
                  >
                    {uiHint.actions.map((action, index) => (
                      <AriButton
                        key={`${uiHint.key}-${action.kind}-${index}`}
                        color={
                          action.intent === "primary" ? "primary" : undefined
                        }
                        label={action.label}
                        onClick={() => {
                          void handleUiHintAction(action);
                        }}
                      />
                    ))}
                  </AriFlex>
                </>
              ) : null}
            </AriCard>
          ) : null}
          <AriCard className="desk-prompt-card desk-session-prompt-card">
            <AriInput.TextArea
              className="desk-session-prompt-input"
              value={input}
              onChange={setInput}
              variant="borderless"
              onKeyDown={handlePromptInputKeyDown}
              rows={3}
              autoSize={{ minRows: 3, maxRows: 10 }}
              placeholder={resolvedSessionUiConfig.inputPlaceholder}
              enableHoverFocusEffect = {false}
            />
            <AriFlex
              justify="space-between"
              align="center"
              className="desk-prompt-toolbar"
            >
              <AriFlex
                align="center"
                space={8}
                className="desk-prompt-toolbar-left"
              >
                <AriButton
                  type="text"
                  icon="add"
                  className="desk-prompt-icon-btn"
                  disabled={sending}
                />
                <AriSelect
                  className="desk-prompt-toolbar-select desk-prompt-toolbar-select-provider"
                  value={selectedAi?.provider || undefined}
                  options={aiSelectOptions}
                  placeholder={t("选择 AI")}
                  bordered={false}
                  onChange={handleChangeProvider}
                  disabled={availableAiKeys.length === 0}
                />
                <AriSelect
                  className="desk-prompt-toolbar-select desk-prompt-toolbar-select-strategy"
                  value="workflow_skill"
                  options={workflowSkillSelectOptions}
                  bordered={false}
                  openOnTriggerClick={false}
                  onTriggerClick={() => {
                    handleOpenWorkflowSkillModal();
                  }}
                  disabled={workflowMenuItems.length === 0 && availableSkills.length === 0}
                />
                {sandboxMetrics && (
                  <AriFlex align="center" className="desk-sandbox-metrics">
                    <span>{t("RAM: {{value}}", { value: formatMemory(sandboxMetrics.memory_bytes) })}</span>
                    <span>{t("Uptime: {{value}}", { value: formatUptime(sandboxMetrics.uptime_secs) })}</span>
                  </AriFlex>
                )}
                <AriTooltip content={t("重置沙盒环境（清空变量）")} position="top" minWidth={0} matchTriggerWidth={false}>
                  <AriButton
                    ghost
                    size="sm"
                    icon="refresh"
                    className="desk-prompt-icon-btn"
                    disabled={sending}
                    onClick={handleResetSandbox}
                  />
                </AriTooltip>
              </AriFlex>
              <AriButton
                type="default"
                color="brand"
                shape="round"
                icon={sending ? "pause" : "arrow_upward"}
                className="desk-prompt-icon-btn"
                onClick={handlePromptPrimaryAction}
              />
            </AriFlex>
          </AriCard>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
