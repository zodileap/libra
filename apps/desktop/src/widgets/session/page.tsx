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
} from "@aries-kit/react";
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
  getSessionAgentContextMessages,
  getSessionMemory,
  getSessionRunState,
  getSessionMessages,
  removeSessionDebugArtifact,
  resolveAgentSessionSelectedAiModel,
  resolveAgentSessionSelectedAiMode,
  resolveAgentSessionSelectedAiProvider,
  resolveAgentSessionCumulativeTokenUsage,
  resolveAgentSessionTitle,
  resolveAgentSessionSelectedDccSoftware,
  increaseAgentSessionCumulativeTokenUsage,
  rememberAgentSessionSelectedAiModel,
  rememberAgentSessionSelectedAiMode,
  rememberAgentSessionSelectedAiProvider,
  rememberAgentSessionSelectedDccSoftware,
  removeSessionRunState,
  SESSION_TITLE_UPDATED_EVENT,
  upsertSessionAgentContextMessages,
  upsertSessionMemory,
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
  type SessionCallRecordSnapshot,
  type SessionMemorySnapshot,
  type SessionRunMeta as PersistedSessionRunMeta,
  type SessionWorkflowPhaseCursorSnapshot,
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
import { getProjectWorkspacePathStatusMap } from "../../shared/services/project-workspace-status";
import type {
  AgentKey,
  AgentAssetRecord,
  AgentEventRecord,
  AgentStepRecord,
  AgentUserInputAnswer as SharedAgentUserInputAnswer,
  AgentUserInputQuestionPrompt as SharedAgentUserInputQuestionPrompt,
  AiKeyItem,
  DesktopRuntimeInfo,
  LoginUser,
  DccMcpCapabilities,
  ProtocolUiHint,
} from "../../shared/types";
import { ChatMarkdown } from "../chat-markdown";
import {
  buildAgentWorkflowSkillExecutionPlan,
  buildAgentWorkflowPrompt,
  getAgentWorkflowById,
  listAgentWorkflowOverview,
} from "../../shared/workflow";
import {
  buildPlaywrightInteractiveRuntimePrompt,
  isPlaywrightInteractiveSkillId,
  normalizeAgentSkillId,
} from "../../shared/workflow/prompt-guidance";
import {
  getDesktopRuntimeInfo,
  getAgentRuntimeCapabilities,
  listAgentSkills,
  listMcpOverview,
} from "../../modules/common/services";
import type {
  AgentSkillItem,
  McpRegistrationItem,
} from "../../modules/common/services";
import {
  AGENT_HOME_PATH,
  AGENT_SETTINGS_PATH,
} from "../../modules/agent/routes";
import { useDesktopHeaderSlot } from "../app-header/header-slot-context";
import { DeskEmptyState } from "../settings-primitives";
import { resolveDesktopTextVariants, translateDesktopText, useDesktopI18n } from "../../shared/i18n";
import { DESKTOP_TEXT_VARIANT_GROUPS } from "../../shared/i18n/messages";
import {
  isAiProvider,
  mergeAiProviderSelectOptions,
  resolveAiProviderDefaultMode,
  resolveAiProviderDefaultModel,
  resolveAiProviderModeOptions,
  resolveAiProviderModeSelectValue,
  resolveAiProviderModelOptions,
  supportsAiProviderModeSelection,
  supportsAiProviderModelSelection,
} from "../../shared/ai-provider-catalog";
import type {
  AgentWorkflowDefinition,
  AgentWorkflowSkillPlanItem,
  WorkflowUiHint,
} from "../../shared/workflow";
import { resolveSessionUiConfig, type SessionAgentUiConfig } from "./config";
import {
  AGENT_EXECUTION_SELECTION_KEY,
  buildDesktopRuntimeCommandConstraint,
  resolveDesktopRuntimeArchLabel,
  resolveDesktopRuntimeSystemLabel,
  buildSessionContextPrompt,
  buildSessionSkillPrompt,
  buildSkillExecutionSelection,
  buildWorkflowExecutionSelection,
  EMPTY_SESSION_EXECUTION_SELECTION,
  AGENT_SKILL_SELECTED_KEY,
  AGENT_WORKFLOW_SELECTED_KEY,
  filterWorkflowStageContextMessages,
  pruneAssistantRetryTail,
  readSessionExecutionSelection,
  type SessionExecutionSelection,
  type MessageItem,
  type RetryTailPruneResult,
  type TraceRecord,
  upsertAssistantMessageBeforeAnchorById,
  upsertAssistantMessageById,
  writeSessionExecutionSelection,
} from "./prompt-utils";
import {
  resolveSessionExecutionRoute,
  type SessionExecutionRouteDecision,
} from "./execution-routing";
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
  displayMessages?: MessageItem[];
  resolvedDccSoftware?: string;
  resolvedCrossDccSoftwares?: string[];
  skipDccSelectionPrompt?: boolean;
  workflowIdOverride?: string;
  workflowStageIndex?: number;
  workflowPromptPreamble?: string;
  disableWorkflow?: boolean;
  selectedSkillIdsOverride?: string[];
  routeDecision?: SessionExecutionRouteDecision;
}

// 描述:
//
//   - 定义通用智能体执行响应结构，兼容动作、步骤、事件与资产返回。
interface AgentRunResponse {
  trace_id: string;
  control?: "continue" | "done";
  message: string;
  display_message?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  actions: string[];
  exported_file?: string;
  steps: AgentStepRecord[];
  events: AgentEventRecord[];
  assets: AgentAssetRecord[];
  ui_hint?: ProtocolUiHint;
}

// 描述：
//
//   - 定义会话请求发送到 Tauri/core 时使用的执行模式；普通对话仍允许工具读取，但不走多轮交付式编排。
type AgentExecutionMode = "workflow" | "chat";

// 描述：
//
//   - 定义纯模型总结调用的返回结构；仅返回最终文本与 token 使用量，不附带工具执行轨迹。
interface AgentSummaryResponse {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// 描述：
//
//   - 定义会话记忆模型返回结构；每个字段都表示“当前最新完整状态”，允许返回空数组表示显式清空。
interface SessionMemoryModelPayload {
  preferences?: string[];
  decisions?: string[];
  todos?: string[];
}

// 描述:
//
//   - 定义沙盒运行指标结构，供轮询状态展示使用。
interface AgentSandboxMetrics {
  memory_bytes: number;
  uptime_secs: number;
}

// 描述：
//
//   - 规范化工作流阶段索引，避免分阶段执行时出现负数或越界。
//
// Params:
//
//   - stageIndex: 原始阶段索引。
//   - totalStageCount: 总阶段数。
//
// Returns:
//
//   - 可安全使用的阶段索引。
function clampWorkflowStageIndex(stageIndex: number | undefined, totalStageCount: number): number {
  if (!Number.isFinite(totalStageCount) || totalStageCount <= 0) {
    return 0;
  }
  const normalizedStageIndex = Number.isFinite(Number(stageIndex)) ? Math.floor(Number(stageIndex)) : 0;
  return Math.min(Math.max(normalizedStageIndex, 0), totalStageCount - 1);
}

// 描述：
//
//   - 按当前阶段节点裁剪工作流定义，只把当前阶段相关执行链路注入 Prompt，避免一次性塞入整条链路。
//
// Params:
//
//   - workflow: 当前工作流定义。
//   - nodeId: 当前阶段节点 ID。
//
// Returns:
//
//   - 裁剪后的工作流定义；若无 nodeId 则返回原工作流。
function scopeWorkflowDefinitionToStageNode(
  workflow: AgentWorkflowDefinition | null,
  nodeId: string,
): AgentWorkflowDefinition | null {
  const normalizedNodeId = String(nodeId || "").trim();
  if (!workflow || !workflow.graph || !normalizedNodeId) {
    return workflow;
  }
  const scopedNodes = workflow.graph.nodes.filter((node) =>
    (node.type !== "skill" && node.type !== "action") || node.id === normalizedNodeId);
  const visibleNodeIdSet = new Set(scopedNodes.map((node) => node.id));
  return {
    ...workflow,
    graph: {
      ...workflow.graph,
      nodes: scopedNodes,
      edges: (workflow.graph.edges || []).filter(
        (edge) => visibleNodeIdSet.has(edge.sourceId) && visibleNodeIdSet.has(edge.targetId),
      ),
    },
  };
}

// 描述：
//
//   - 构建工作流阶段游标快照，供分阶段执行时恢复当前阶段和重试目标。
//
// Params:
//
//   - workflow: 当前工作流定义。
//   - rootPrompt: 本轮用户原始需求。
//   - currentStageIndex: 当前阶段索引。
//   - totalStageCount: 总阶段数。
//   - currentNodeId: 当前技能节点 ID。
//   - currentNodeTitle: 当前技能节点标题。
//   - currentMessageId: 当前阶段对应的助手消息 ID。
//
// Returns:
//
//   - 阶段游标快照。
function buildWorkflowPhaseCursorSnapshot(
  workflow: AgentWorkflowDefinition,
  rootPrompt: string,
  currentStageIndex: number,
  totalStageCount: number,
  currentNodeId: string,
  currentNodeTitle: string,
  currentMessageId: string,
): SessionWorkflowPhaseCursorSnapshot {
  return {
    workflowId: String(workflow.id || "").trim(),
    workflowName: String(workflow.name || "").trim(),
    rootPrompt: String(rootPrompt || ""),
    currentStageIndex: Math.max(0, currentStageIndex),
    totalStageCount: Math.max(0, totalStageCount),
    currentNodeId: String(currentNodeId || "").trim(),
    currentNodeTitle: String(currentNodeTitle || "").trim(),
    currentMessageId: String(currentMessageId || "").trim(),
    updatedAt: Date.now(),
  };
}

// 描述：
//
//   - 统一生成工作流阶段标题，供运行轨迹分割线、状态栏和复制文本复用。
//
// Params:
//
//   - currentStageIndex: 当前阶段索引（0 基）。
//   - totalStageCount: 工作流总阶段数。
//   - stageTitle: 当前阶段标题。
//
// Returns:
//
//   - 阶段标题文本。
function buildWorkflowStageDividerTitle(
  currentStageIndex: number,
  totalStageCount: number,
  stageTitle: string,
): string {
  return translateDesktopText("阶段 {{current}}/{{total}}：{{title}}", {
    current: currentStageIndex + 1,
    total: totalStageCount,
    title: String(stageTitle || "").trim() || translateDesktopText("未命名阶段"),
  });
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

// 描述：
//
//   - 定义文本流用户提问事件 data 的最小字段结构，统一承接 request_user_input 的请求体。
interface AgentRequestUserInputEventData {
  request_id?: string;
  questions?: SharedAgentUserInputQuestionPrompt[];
}

// 描述：
//
//   - 定义单题草稿状态；同一题只能二选一：预设选项或自由填写。
interface AgentUserInputDraftAnswer {
  selectedOptionIndex?: number;
  customValue: string;
}

const APPROVAL_TOOL_ARGS_PREVIEW_MAX_CHARS = 2000;
const PLANNING_META_PREFIX = "__libra_planning__:";
const INITIAL_THINKING_SEGMENT_ROLE = "initial_thinking";
const ROUND_DESCRIPTION_SEGMENT_ROLE = "round_description";
const WORKFLOW_STAGE_DIVIDER_SEGMENT_ROLE = "workflow_stage_divider";
const WORKFLOW_STAGE_SUMMARY_STEP_TYPE = "workflow_stage_summary";
const WORKFLOW_STAGE_VALIDATION_REQUIRED_KEYWORDS = [
  "补齐测试",
  "可运行代码与测试",
  "测试与错误提示映射",
  "运行验证",
  "测试验证",
];
const WORKFLOW_STAGE_VALIDATION_COMMAND_KEYWORDS = [
  "pnpm test",
  "npm test",
  "pnpm build",
  "npm run build",
  "vite build",
  "pnpm dev",
  "npm run dev",
  "vite preview",
  "pnpm preview",
  "npm run preview",
  "pnpm lint",
  "npm run lint",
  "pnpm check",
  "npm run check",
  "vitest",
  "jest",
  "playwright",
  "cargo test",
  "cargo check",
  "go test",
];
const WORKFLOW_STAGE_DIAGNOSTIC_LINE_PATTERNS = [
  /^Scripts:\s*/u,
  /^package\.json length:\s*\d+\s*$/iu,
  /^[A-Za-z0-9_.-]+(?:_str)? length:\s*\d+\s*$/u,
  /^Test Result Success:\s*(true|false)\s*$/iu,
];
const WORKFLOW_STAGE_AUTO_COMPLETION_LEAD_LINE_PATTERNS = [
  /^脚本执行完成（自动补全结果）[:：]?\s*$/u,
  /^脚本执行完成（未产生可见输出，系统自动收尾）[。：:：]?\s*$/u,
  /^执行完成（系统自动补全 finish）\s*$/u,
  /^执行完成（未返回总结，已自动收尾）\s*$/u,
];
const DCC_MODELING_SKILL_ID = "dcc-modeling";
const QUICK_START_CODE_WORKFLOW_ID = "wf-agent-full-delivery-v1";

// 描述：
//
//   - 定义工作流阶段完成性守门结果，避免模型误报 DONE 时前端直接提前收尾。
interface WorkflowStageCompletionDecision {
  control: "continue" | "done";
  reason: string;
  displayMessage: string;
}

// 描述：
//
//   - 定义工作流阶段摘要项，供最终“执行总结”正文按阶段生成可读列表。
interface WorkflowStageSummaryItem {
  index: number;
  title: string;
  summary: string;
}

// 描述：
//
//   - 汇总当前阶段的技能标题、节点要求和 `SKILL.md` 说明，用于判断是否必须补齐测试或运行验证。
//
// Params:
//
//   - item: 当前阶段技能计划项。
//
// Returns:
//
//   - 归一化后的阶段要求文本。
function resolveWorkflowStageRequirementText(item: AgentWorkflowSkillPlanItem | null): string {
  if (!item) {
    return "";
  }
  return [
    item.nodeTitle,
    item.skillId,
    item.skillTitle,
    item.skillDescription,
    item.instruction,
    item.skillMarkdownBody,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length > 0)
    .join("\n");
}

// 描述：
//
//   - 判断当前阶段是否属于“必须看到测试/构建/运行验证动作后才允许完成”的交付节点。
//
// Params:
//
//   - item: 当前阶段技能计划项。
//
// Returns:
//
//   - true: 当前阶段需要运行验证证据后才能视为完成。
function shouldRequireWorkflowStageValidation(item: AgentWorkflowSkillPlanItem | null): boolean {
  if (!item) {
    return false;
  }
  if (String(item.nodeId || "").trim() === "wf-agent-full-delivery-pages") {
    return true;
  }
  const requirementText = resolveWorkflowStageRequirementText(item);
  if (!requirementText) {
    return false;
  }
  return WORKFLOW_STAGE_VALIDATION_REQUIRED_KEYWORDS.some((keyword) => requirementText.includes(keyword.toLowerCase()));
}

// 描述：
//
//   - 从运行片段详情中提取后台终端实际执行命令，供阶段完成性校验复用。
//
// Params:
//
//   - segment: 当前运行片段。
//
// Returns:
//
//   - 解析出的命令文本；若未命中则返回空字符串。
function resolveTerminalCommandFromRunSegment(segment: AssistantRunSegment): string {
  const segmentData = segment.data && typeof segment.data === "object"
    ? (segment.data as Record<string, unknown>)
    : {};
  const explicitCommand = String(
    typeof segmentData.terminal_command === "string" ? segmentData.terminal_command : "",
  ).trim();
  if (explicitCommand) {
    return explicitCommand;
  }
  const detailText = String(segment.detail || "").trim();
  if (!detailText) {
    return "";
  }
  const matchedCommand = detailText.match(/^Command:\s*(.+)$/m);
  return matchedCommand?.[1]?.trim() || "";
}

// 描述：
//
//   - 汇总当前阶段已执行的终端命令，供“测试/构建/运行验证”守门逻辑判断是否已有真实验证动作。
//
// Params:
//
//   - runMeta: 当前运行消息的轨迹元数据。
//
// Returns:
//
//   - 已去重的终端命令列表。
function collectWorkflowStageTerminalCommands(runMeta: AssistantRunMeta | undefined): string[] {
  if (!runMeta || !Array.isArray(runMeta.segments)) {
    return [];
  }
  return Array.from(
    new Set(
      runMeta.segments
        .filter((segment) => {
          const stepType = segment.data && typeof segment.data.__step_type === "string"
            ? String(segment.data.__step_type).trim()
            : "";
          return stepType === "terminal";
        })
        .map((segment) => resolveTerminalCommandFromRunSegment(segment))
        .filter((command) => command.length > 0),
    ),
  );
}

// 描述：
//
//   - 判断当前阶段是否已出现测试、构建或运行验证命令，避免只写代码未验证就提前结束。
//
// Params:
//
//   - terminalCommands: 当前阶段终端命令列表。
//
// Returns:
//
//   - true: 已出现可作为完成证据的验证命令。
function hasWorkflowStageValidationEvidence(terminalCommands: string[]): boolean {
  return terminalCommands.some((command) => {
    const normalizedCommand = String(command || "").trim().toLowerCase();
    if (!normalizedCommand) {
      return false;
    }
    return WORKFLOW_STAGE_VALIDATION_COMMAND_KEYWORDS.some((keyword) => normalizedCommand.includes(keyword));
  });
}

// 描述：
//
//   - 结合阶段要求与本轮真实执行证据，收敛当前阶段最终完成态，避免“模型误报 DONE”导致工作流提前结束。
//
// Params:
//
//   - currentStageItem: 当前阶段技能计划项。
//   - responseControl: 模型返回的阶段控制信号。
//   - responseDisplayMessage: 当前阶段对用户可见的正文摘要。
//   - runMeta: 当前运行消息的执行轨迹元数据。
//
// Returns:
//
//   - 经过守门后的阶段完成结果。
function resolveWorkflowStageCompletionDecision(
  currentStageItem: AgentWorkflowSkillPlanItem | null,
  responseControl: "continue" | "done",
  responseDisplayMessage: string,
  runMeta: AssistantRunMeta | undefined,
): WorkflowStageCompletionDecision {
  if (responseControl !== "done" || !shouldRequireWorkflowStageValidation(currentStageItem)) {
    return {
      control: responseControl,
      reason: "",
      displayMessage: responseDisplayMessage,
    };
  }

  const terminalCommands = collectWorkflowStageTerminalCommands(runMeta);
  if (hasWorkflowStageValidationEvidence(terminalCommands)) {
    return {
      control: "done",
      reason: "",
      displayMessage: responseDisplayMessage,
    };
  }

  const validationReason = translateDesktopText("校验结果：未检测到测试、构建或运行验证动作，当前阶段继续执行。");
  return {
    control: "continue",
    reason: validationReason,
    displayMessage: responseDisplayMessage
      ? `${responseDisplayMessage}\n\n${validationReason}`
      : validationReason,
  };
}

// 描述：
//
//   - 将阶段摘要压缩为单行预览，避免最终总结直接塞入整段日志正文导致顶部消息过长。
//
// Params:
//
//   - value: 原始阶段摘要。
//
// Returns:
//
//   - 适合用于最终总结的单行摘要。
function resolveWorkflowStageSummaryPreview(value: string): string {
  const candidateLines = stripWorkflowStageAutoCompletionPlaceholder(String(value || ""))
    .split(/\r?\n/g)
    .map((line) => String(line || "").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter((line) => line.length > 0);
  return truncateRunText(candidateLines[0] || "", 160);
}

// 描述：
//
//   - 判断当前文本是否属于脚本自动补全 finish 生成的前缀占位行。
//   - 这类文案只用于兜底执行闭环，不应直接作为阶段正文展示给用户。
//
// Params:
//
//   - line: 单行候选文本。
//
// Returns:
//
//   - true 表示命中自动补全占位前缀。
function isWorkflowStageAutoCompletionLeadLine(line: string): boolean {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return false;
  }
  return WORKFLOW_STAGE_AUTO_COMPLETION_LEAD_LINE_PATTERNS.some((pattern) => pattern.test(normalizedLine));
}

// 描述：
//
//   - 从阶段正文候选文本中剥离脚本自动补全产生的占位前缀。
//   - 若占位前缀后仍带有真实正文，则保留正文；若只有占位句本身，则返回空字符串。
//
// Params:
//
//   - value: 原始正文候选。
//
// Returns:
//
//   - 去掉占位前缀后的正文文本。
function stripWorkflowStageAutoCompletionPlaceholder(value: string): string {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }
  const remainingLines = normalizedValue.split(/\r?\n/g);
  while (remainingLines.length > 0) {
    const firstLine = String(remainingLines[0] || "").trim();
    if (!isWorkflowStageAutoCompletionLeadLine(firstLine)) {
      break;
    }
    remainingLines.shift();
    while (remainingLines.length > 0 && !String(remainingLines[0] || "").trim()) {
      remainingLines.shift();
    }
  }
  const strippedValue = remainingLines.join("\n").trim();
  if (strippedValue) {
    return strippedValue;
  }
  if (isWorkflowStageAutoCompletionLeadLine(normalizedValue)) {
    return "";
  }
  return normalizedValue;
}

// 描述：
//
//   - 判断一行阶段摘要是否属于 agent 的调试/诊断输出，避免把 `Scripts:`、`length:` 等噪声注入前端正文。
//
// Params:
//
//   - line: 单行文本。
//
// Returns:
//
//   - true 表示该行应从用户可见正文中过滤。
function isWorkflowStageDiagnosticLine(line: string): boolean {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return false;
  }
  return WORKFLOW_STAGE_DIAGNOSTIC_LINE_PATTERNS.some((pattern) => pattern.test(normalizedLine));
}

// 描述：
//
//   - 清洗工作流阶段正文中的调试诊断行，仅保留用户可理解的总结内容。
//
// Params:
//
//   - primaryMessage: display_message 优先候选。
//   - fallbackMessage: message 兜底候选。
//
// Returns:
//
//   - 过滤后的阶段正文；若两者都只剩诊断信息，则返回通用总结文案。
function sanitizeWorkflowStageDisplayMessage(
  primaryMessage: string,
  fallbackMessage: string,
): string {
  const sanitizeMessage = (value: string): string => {
    const strippedValue = stripWorkflowStageAutoCompletionPlaceholder(String(value || ""));
    if (!strippedValue) {
      return "";
    }
    const rawLines = strippedValue.split(/\r?\n/g);
    const filteredLines: string[] = [];
    let previousLineEmpty = false;
    rawLines.forEach((line) => {
      const normalizedLine = String(line || "").trimEnd();
      if (!normalizedLine.trim()) {
        if (!previousLineEmpty && filteredLines.length > 0) {
          filteredLines.push("");
        }
        previousLineEmpty = true;
        return;
      }
      if (isWorkflowStageDiagnosticLine(normalizedLine)) {
        return;
      }
      filteredLines.push(normalizedLine);
      previousLineEmpty = false;
    });
    while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1] === "") {
      filteredLines.pop();
    }
    return filteredLines.join("\n").trim();
  };

  const normalizedPrimary = sanitizeMessage(primaryMessage);
  if (normalizedPrimary) {
    return normalizedPrimary;
  }
  const normalizedFallback = sanitizeMessage(fallbackMessage);
  if (normalizedFallback) {
    return normalizedFallback;
  }
  return translateDesktopText("已记录当前阶段结果。");
}

// 描述：
//
//   - 从当前运行轨迹与最后阶段摘要中提取按阶段排序的摘要列表，供总结 Prompt 与内部诊断复用。
//
// Params:
//
//   - runMeta: 当前运行消息元数据。
//   - finalStageIndex: 最后阶段索引。
//   - finalStageTitle: 最后阶段标题。
//   - finalStageSummary: 最后阶段摘要。
//
// Returns:
//
//   - 按阶段排序的摘要项列表。
function collectWorkflowStageSummaryItems(
  runMeta: AssistantRunMeta | undefined,
  finalStageIndex: number,
  finalStageTitle: string,
  finalStageSummary: string,
): WorkflowStageSummaryItem[] {
  const stageSummaryMap = new Map<number, WorkflowStageSummaryItem>();
  (runMeta?.segments || []).forEach((segment) => {
    const stepType = segment.data && typeof segment.data.__step_type === "string"
      ? String(segment.data.__step_type).trim()
      : "";
    if (stepType !== WORKFLOW_STAGE_SUMMARY_STEP_TYPE) {
      return;
    }
    const stageIndex = Number(segment.data?.workflow_stage_index);
    if (!Number.isFinite(stageIndex)) {
      return;
    }
    const stageTitle = String(segment.data?.workflow_stage_title || "").trim();
    const stageSummary = resolveWorkflowStageSummaryPreview(
      String(segment.data?.workflow_stage_summary_message || segment.step || "").trim(),
    );
    if (!stageSummary) {
      return;
    }
    stageSummaryMap.set(stageIndex, {
      index: Math.max(0, Math.floor(stageIndex)),
      title: stageTitle || translateDesktopText("未命名阶段"),
      summary: stageSummary,
    });
  });

  const normalizedFinalSummary = resolveWorkflowStageSummaryPreview(finalStageSummary);
  if (normalizedFinalSummary) {
    stageSummaryMap.set(finalStageIndex, {
      index: Math.max(0, Math.floor(finalStageIndex)),
      title: String(finalStageTitle || "").trim() || translateDesktopText("未命名阶段"),
      summary: normalizedFinalSummary,
    });
  }

  return Array.from(stageSummaryMap.values())
    .sort((left, right) => left.index - right.index);
}

// 描述：
//
//   - 将工作流阶段摘要列表拼接为诊断文本，供内部总结 Prompt 使用；不直接作为最终前端摘要展示。
//
// Params:
//
//   - runMeta: 当前运行消息元数据。
//   - finalStageIndex: 最后阶段索引。
//   - finalStageTitle: 最后阶段标题。
//   - finalStageSummary: 最后阶段摘要。
//
// Returns:
//
//   - 按阶段组织的摘要文本。
function buildWorkflowCompletionSummary(
  runMeta: AssistantRunMeta | undefined,
  finalStageIndex: number,
  finalStageTitle: string,
  finalStageSummary: string,
): string {
  const orderedStageSummaries = collectWorkflowStageSummaryItems(
    runMeta,
    finalStageIndex,
    finalStageTitle,
    finalStageSummary,
  );
  if (orderedStageSummaries.length === 0) {
    const normalizedFinalSummary = resolveWorkflowStageSummaryPreview(finalStageSummary);
    return normalizedFinalSummary || translateDesktopText("执行过程已完成。");
  }
  return [
    translateDesktopText("本次执行总结："),
    ...orderedStageSummaries.map((item) => `${item.index + 1}. ${item.title}：${item.summary}`),
  ].join("\n");
}

// 描述：
//
//   - 构建工作流最终执行总结 Prompt，只把真实阶段摘要与验证信息交给模型归纳，避免把前端拼接文本直接冒充最终结论。
//
// Params:
//
//   - workflowName: 工作流名称。
//   - stageSummaryDigest: 阶段摘要文本。
//   - actionText: 本轮动作摘要。
//   - exportedFile: 导出文件路径。
//
// Returns:
//
//   - 发给纯模型总结接口的 Prompt。
function buildWorkflowExecutionSummaryPrompt(
  workflowName: string,
  stageSummaryDigest: string,
  actionText: string,
  exportedFile?: string,
): string {
  const normalizedWorkflowName = String(workflowName || "").trim() || "未命名工作流";
  const normalizedStageSummaryDigest = String(stageSummaryDigest || "").trim();
  const normalizedActionText = String(actionText || "").trim() || "无";
  const normalizedExportedFile = String(exportedFile || "").trim();
  return [
    "你是桌面端会话执行总结助手。",
    "请基于以下真实执行记录，输出一段面向用户的中文总结。",
    "输出要求：",
    "1. 仅输出自然语言，不要 Markdown 围栏。",
    "2. 用 2-4 句话完成总结，不要改写成流水账。",
    "3. 必须说明已经完成了什么。",
    "4. 必须说明当前不足、未验证项或阻塞；如果暂时没有明确阻塞，也要指出仍建议补充的验证或风险点。",
    "5. 必须给出继续处理时的下一步建议。",
    "",
    `工作流：${normalizedWorkflowName}`,
    `动作汇总：${normalizedActionText}`,
    normalizedExportedFile ? `导出文件：${normalizedExportedFile}` : "",
    "",
    "阶段执行摘要：",
    normalizedStageSummaryDigest,
  ].filter((item) => Boolean(item)).join("\n");
}

const SESSION_MEMORY_ENTRY_LIMIT = 12;

// 描述：
//
//   - 规范化会话记忆模型返回的字符串数组，统一去空、去重并限制条数。
//
// Params：
//
//   - value: 原始数组值。
//
// Returns：
//
//   - 规范化后的字符串数组。
function normalizeSessionMemoryModelEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
  return normalized.filter((item, index) => normalized.indexOf(item) === index).slice(0, SESSION_MEMORY_ENTRY_LIMIT);
}

// 描述：
//
//   - 从模型返回文本中提取 JSON 对象正文，兼容 Markdown 围栏与前后噪声说明。
//
// Params：
//
//   - raw: 模型原始返回文本。
//
// Returns：
//
//   - 可交给 JSON.parse 的对象文本；无法定位时返回原始 trim 结果。
function extractJsonObjectText(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return "";
  }
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  const objectStart = unfenced.indexOf("{");
  const objectEnd = unfenced.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return unfenced.slice(objectStart, objectEnd + 1);
  }
  return unfenced;
}

// 描述：
//
//   - 解析会话记忆模型返回；字段缺失时保留 undefined，字段显式为空数组时表示该类记忆应被清空。
//
// Params：
//
//   - raw: 模型原始返回文本。
//
// Returns：
//
//   - 解析后的会话记忆负载；无法解析时返回 null。
function parseSessionMemoryModelPayload(raw: string): SessionMemoryModelPayload | null {
  const normalized = extractJsonObjectText(raw);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const source = parsed as Record<string, unknown>;
    const payload: SessionMemoryModelPayload = {
      preferences: Object.prototype.hasOwnProperty.call(source, "preferences")
        ? normalizeSessionMemoryModelEntries(source.preferences)
        : undefined,
      decisions: Object.prototype.hasOwnProperty.call(source, "decisions")
        ? normalizeSessionMemoryModelEntries(source.decisions)
        : undefined,
      todos: Object.prototype.hasOwnProperty.call(source, "todos")
        ? normalizeSessionMemoryModelEntries(source.todos)
        : undefined,
    };
    if (
      payload.preferences === undefined
      && payload.decisions === undefined
      && payload.todos === undefined
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// 描述：
//
//   - 构建单会话长期记忆提炼 Prompt；要求模型返回“最新完整状态”的 JSON，而不是本轮增量。
//
// Params：
//
//   - currentMemory: 当前会话记忆快照。
//   - userPrompt: 本轮用户请求。
//   - assistantReply: 本轮最终助手回复。
//   - turnDigest: 本轮执行摘要或动作摘要。
//
// Returns：
//
//   - 发给纯模型调用的记忆提炼 Prompt。
function buildSessionMemoryExtractionPrompt(
  currentMemory: SessionMemorySnapshot | null,
  userPrompt: string,
  assistantReply: string,
  turnDigest?: string,
): string {
  const normalizedUserPrompt = String(userPrompt || "").trim();
  const normalizedAssistantReply = String(assistantReply || "").trim();
  const normalizedTurnDigest = String(turnDigest || "").trim();
  const currentMemoryPayload = {
    preferences: currentMemory?.preferences || [],
    decisions: currentMemory?.decisions || [],
    todos: currentMemory?.todos || [],
  };
  return [
    "你是桌面端会话记忆提炼助手。",
    "请根据当前会话已知记忆与本轮对话结果，输出“最新完整状态”的会话记忆 JSON。",
    "输出要求：",
    "1. 只输出 JSON 对象，不要 Markdown 围栏，不要解释。",
    "2. JSON 结构固定为 {\"preferences\": string[], \"decisions\": string[], \"todos\": string[] }。",
    "3. 只保留对后续同会话继续协作有长期价值的信息。",
    "4. preferences 记录用户明确表达的偏好、禁忌、输出习惯或工具选择。",
    "5. decisions 记录已确认的技术决策、边界条件与稳定约束。",
    "6. todos 记录仍未完成、后续需要继续跟进的事项；已完成事项不要保留。",
    "7. 如果某一类当前没有内容，必须返回空数组 []。",
    "8. 这是完整覆盖结果，不是增量补丁；若旧记忆已失效或已完成，需要在结果中移除。",
    "",
    "当前记忆：",
    JSON.stringify(currentMemoryPayload, null, 2),
    "",
    "本轮用户请求：",
    normalizedUserPrompt || "无",
    "",
    "本轮最终回复：",
    normalizedAssistantReply || "无",
    ...(normalizedTurnDigest
      ? [
        "",
        "本轮执行摘要：",
        normalizedTurnDigest,
      ]
      : []),
  ].join("\n");
}

// 描述：
//
//   - 基于模型返回构建下一份会话记忆快照；模型显式返回空数组时允许清空对应类别。
//
// Params：
//
//   - agentKey: 智能体键。
//   - sessionId: 会话 ID。
//   - messageId: 最近已处理的助手消息 ID。
//   - currentMemory: 当前会话记忆。
//   - payload: 模型返回的最新记忆负载。
//
// Returns：
//
//   - 下一份会话记忆快照。
function buildNextSessionMemorySnapshot(
  agentKey: AgentKey,
  sessionId: string,
  messageId: string,
  currentMemory: SessionMemorySnapshot | null,
  payload: SessionMemoryModelPayload,
): SessionMemorySnapshot {
  return {
    agentKey,
    sessionId,
    updatedAt: Date.now(),
    lastProcessedMessageId: String(messageId || "").trim(),
    preferences: payload.preferences === undefined
      ? (currentMemory?.preferences || [])
      : payload.preferences,
    decisions: payload.decisions === undefined
      ? (currentMemory?.decisions || [])
      : payload.decisions,
    todos: payload.todos === undefined
      ? (currentMemory?.todos || [])
      : payload.todos,
  };
}

// 描述：
//
//   - 在流式 FINAL 事件到达时统一解析最终总结文案，优先复用已有阶段总结或运行轨迹摘要，
//     避免再次被“执行过程已完成”“执行完成”等泛化占位覆盖。
//
// Params:
//
//   - existingSummary: 当前运行态中已经生成的总结。
//   - payloadSummary: FINAL 事件直接携带的总结。
//   - fallbackSummary: 从运行轨迹反推出的兜底摘要。
//
// Returns:
//
//   - 最终展示给用户的总结正文。
function resolveFinalAssistantRunSummary(
  existingSummary: string,
  payloadSummary: string,
  fallbackSummary: string,
): string {
  const normalizedExistingSummary = String(existingSummary || "").trim();
  const normalizedPayloadSummary = String(payloadSummary || "").trim();
  const normalizedFallbackSummary = String(fallbackSummary || "").trim();
  if (normalizedExistingSummary && !isGenericFinishedRunSummaryText(normalizedExistingSummary)) {
    return normalizedExistingSummary;
  }
  if (normalizedPayloadSummary && !isGenericFinishedRunSummaryText(normalizedPayloadSummary)) {
    return normalizedPayloadSummary;
  }
  return normalizedFallbackSummary
    || normalizedPayloadSummary
    || normalizedExistingSummary
    || translateDesktopText("执行完成");
}

// 描述:
//
//   - 定义新会话页快速开始预设结构；点击卡片后只更新默认执行策略与输入框草稿，不直接发送。
interface SessionQuickStartPreset {
  id: string;
  title: string;
  description: string;
  prompt: string;
  workflowId?: string;
  skillIds?: string[];
}

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
  displayMessages: MessageItem[];
  contextMessages: MessageItem[];
  softwareOptions: DccSoftwareOption[];
  selectedSoftware: string;
  selectedTargetSoftware: string;
}

// 描述：
//
//   - 定义流式目标文本更新选项，支持在等待态刷新时跳过逐字动画，避免重复“从头打字”。
interface StreamingAssistantTargetOptions {
  immediate?: boolean;
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
  kind?: "default" | "divider";
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
  summarySource?: "ai" | "system" | "failure";
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

// 描述：
//
//   - 定义 dock 中任务计划项的状态类型，统一覆盖待处理、进行中、已完成和阻塞态。
type SessionTodoDockItemStatus = "pending" | "in_progress" | "completed" | "blocked";

// 描述：
//
//   - 定义 dock 中展示的任务计划项结构。
interface SessionTodoDockItem {
  id: string;
  content: string;
  status: SessionTodoDockItemStatus;
}

// 描述：
//
//   - 定义从运行片段中提取出的任务计划快照，供 `desk-prompt-dock` 统一渲染。
interface SessionTodoDockSnapshot {
  items: SessionTodoDockItem[];
  messageId: string;
}

// 描述:
//
//   - 定义单条助手消息下的 AI 原始请求/响应结构；用于保留多轮模型往返记录。
type SessionAiRawExchangeStatus = "running" | "finished" | "failed";

// 描述:
//
//   - 定义单条助手消息下的 AI 原始请求/响应结构；用于保留多轮模型往返记录。
interface SessionAiRawExchangeItem {
  requestRaw: string;
  responseRaw: string;
  stepCode?: string;
  stepSummary?: string;
  turnIndex?: number;
  capturedAt?: number;
  status?: SessionAiRawExchangeStatus;
  traceId?: string;
  stageTitle?: string;
}

// 描述:
//
//   - 定义助手消息维度的 AI 原始收发记录结构。
interface SessionAiRawByMessageItem {
  promptRaw: string;
  responseRaw: string;
  exchanges: SessionAiRawExchangeItem[];
}

// 描述：
//
//   - 规范化单条 AI 原始收发记录，统一清洗字段并保留原始文本内容。
//
// Params:
//
//   - input: 原始收发记录。
//
// Returns:
//
//   - 规范化后的收发记录；若请求和响应均为空则返回 null。
function normalizeSessionAiRawExchangeItem(input: Partial<SessionAiRawExchangeItem> | null | undefined): SessionAiRawExchangeItem | null {
  if (!input) {
    return null;
  }
  const requestRaw = String(input.requestRaw ?? "");
  const responseRaw = String(input.responseRaw ?? "");
  if (!requestRaw && !responseRaw) {
    return null;
  }
  const status = input.status === "running" || input.status === "failed"
    ? input.status
    : input.status === "finished"
      ? "finished"
      : undefined;
  return {
    requestRaw,
    responseRaw,
    stepCode: typeof input.stepCode === "string" ? String(input.stepCode || "").trim() || undefined : undefined,
    stepSummary: typeof input.stepSummary === "string" ? String(input.stepSummary ?? "") : undefined,
    turnIndex: Number.isFinite(Number(input.turnIndex)) ? Number(input.turnIndex) : undefined,
    capturedAt: Number.isFinite(Number(input.capturedAt)) ? Number(input.capturedAt) : undefined,
    status,
    traceId: typeof input.traceId === "string" ? String(input.traceId || "").trim() || undefined : undefined,
    stageTitle: typeof input.stageTitle === "string" ? String(input.stageTitle || "").trim() || undefined : undefined,
  };
}

// 描述：
//
//   - 基于 prompt/response 与 exchanges 构建单条助手消息的 AI 原始收发聚合结果。
//
// Params:
//
//   - input: 原始字段。
//
// Returns:
//
//   - 可直接写入状态与持久化层的聚合结构。
function buildSessionAiRawByMessageItem(input?: Partial<SessionAiRawByMessageItem> | null): SessionAiRawByMessageItem {
  const promptRaw = String(input?.promptRaw ?? "");
  const responseRaw = String(input?.responseRaw ?? "");
  const exchanges = Array.isArray(input?.exchanges)
    ? input.exchanges
      .map((item) => normalizeSessionAiRawExchangeItem(item))
      .filter((item): item is SessionAiRawExchangeItem => Boolean(item))
    : [];
  if (exchanges.length > 0) {
    return {
      promptRaw,
      responseRaw,
      exchanges,
    };
  }
  const fallbackExchange = normalizeSessionAiRawExchangeItem({
    requestRaw: promptRaw,
    responseRaw,
  });
  return {
    promptRaw,
    responseRaw,
    exchanges: fallbackExchange ? [fallbackExchange] : [],
  };
}

// 描述：
//
//   - 计算单条 AI 原始收发记录的稳定去重键；优先使用 trace / step / turn / request 组合，
//     缺失时再退回 request / response / capturedAt，避免阶段切换时被整段覆盖。
//
// Params:
//
//   - input: 原始收发记录。
//
// Returns:
//
//   - 稳定的去重键。
function buildSessionAiRawExchangeDedupKey(input: Partial<SessionAiRawExchangeItem>): string {
  const traceId = typeof input.traceId === "string" ? String(input.traceId || "").trim() : "";
  const stepCode = typeof input.stepCode === "string" ? String(input.stepCode || "").trim() : "";
  const turnIndex = Number.isFinite(Number(input.turnIndex)) ? String(Number(input.turnIndex)) : "";
  const requestRaw = String(input.requestRaw ?? "");
  if (traceId || stepCode || turnIndex || requestRaw) {
    return `primary:${traceId}:${stepCode}:${turnIndex}:${requestRaw}`;
  }
  const responseRaw = String(input.responseRaw ?? "");
  const capturedAt = Number.isFinite(Number(input.capturedAt)) ? String(Number(input.capturedAt)) : "";
  return `fallback:${requestRaw}:${responseRaw}:${capturedAt}`;
}

// 描述：
//
//   - 合并两条指向同一轮次的 AI 原始收发记录；保留已有部分响应，并用更新值补齐状态和元信息。
//
// Params:
//
//   - current: 当前记录。
//   - incoming: 待合并的新记录。
//
// Returns:
//
//   - 合并后的单条记录。
function mergeSessionAiRawExchangeItem(
  current: SessionAiRawExchangeItem,
  incoming: SessionAiRawExchangeItem,
): SessionAiRawExchangeItem {
  return {
    requestRaw: incoming.requestRaw || current.requestRaw,
    responseRaw: incoming.responseRaw || current.responseRaw,
    stepCode: incoming.stepCode || current.stepCode,
    stepSummary: incoming.stepSummary || current.stepSummary,
    turnIndex: incoming.turnIndex ?? current.turnIndex,
    capturedAt: incoming.capturedAt ?? current.capturedAt,
    status: incoming.status || current.status,
    traceId: incoming.traceId || current.traceId,
    stageTitle: incoming.stageTitle || current.stageTitle,
  };
}

// 描述：
//
//   - 以“追加新轮次、原位更新已存在轮次”的方式维护 AI 原始收发列表，避免覆盖历史往返。
//
// Params:
//
//   - exchanges: 当前记录列表。
//   - exchange: 待追加或更新的记录。
//
// Returns:
//
//   - 更新后的收发列表。
function appendSessionAiRawExchangeItem(
  exchanges: SessionAiRawExchangeItem[],
  exchange: Partial<SessionAiRawExchangeItem>,
): SessionAiRawExchangeItem[] {
  const normalizedExchange = normalizeSessionAiRawExchangeItem(exchange);
  const normalizedExchanges = exchanges
    .map((item) => normalizeSessionAiRawExchangeItem(item))
    .filter((item): item is SessionAiRawExchangeItem => Boolean(item));
  if (!normalizedExchange) {
    return normalizedExchanges;
  }
  const exchangeKey = buildSessionAiRawExchangeDedupKey(normalizedExchange);
  const matchedIndex = normalizedExchanges.findIndex((item) =>
    buildSessionAiRawExchangeDedupKey(item) === exchangeKey);
  if (matchedIndex < 0) {
    return [
      ...normalizedExchanges,
      normalizedExchange,
    ];
  }
  return normalizedExchanges.map((item, index) =>
    index === matchedIndex
      ? mergeSessionAiRawExchangeItem(item, normalizedExchange)
      : item);
}

// 描述：
//
//   - 按当前 trace 合并步骤回填出来的 AI 原始收发记录，保持历史阶段顺序不变，并按步骤顺序重建当前阶段轮次。
//
// Params:
//
//   - exchanges: 当前消息已有的原始收发列表。
//   - incoming: 当前阶段新完成的原始收发列表。
//   - traceId: 当前阶段 trace。
//
// Returns:
//
//   - 合并后的收发列表。
function mergeSessionAiRawExchangeItemsByTrace(
  exchanges: SessionAiRawExchangeItem[],
  incoming: SessionAiRawExchangeItem[],
  traceId: string,
): SessionAiRawExchangeItem[] {
  const normalizedTraceId = String(traceId || "").trim();
  const normalizedExchanges = exchanges
    .map((item) => normalizeSessionAiRawExchangeItem(item))
    .filter((item): item is SessionAiRawExchangeItem => Boolean(item));
  const normalizedIncoming = incoming
    .map((item) => normalizeSessionAiRawExchangeItem(item))
    .filter((item): item is SessionAiRawExchangeItem => Boolean(item));
  if (normalizedIncoming.length === 0) {
    return normalizedExchanges;
  }
  if (!normalizedTraceId) {
    return normalizedIncoming.reduce(
      (result, item) => appendSessionAiRawExchangeItem(result, item),
      normalizedExchanges,
    );
  }
  const preservedExchanges = normalizedExchanges.filter((item) => String(item.traceId || "").trim() !== normalizedTraceId);
  const currentTraceExchanges = normalizedExchanges.filter((item) => String(item.traceId || "").trim() === normalizedTraceId);
  const nextCurrentTraceExchanges = normalizedIncoming.map((incomingItem) => {
    const incomingKey = buildSessionAiRawExchangeDedupKey(incomingItem);
    const matchedCurrent = currentTraceExchanges.find((item) =>
      buildSessionAiRawExchangeDedupKey(item) === incomingKey);
    return matchedCurrent
      ? mergeSessionAiRawExchangeItem(matchedCurrent, incomingItem)
      : incomingItem;
  });
  const consumedKeys = new Set(nextCurrentTraceExchanges.map((item) => buildSessionAiRawExchangeDedupKey(item)));
  const leftoverCurrentTraceExchanges = currentTraceExchanges.filter((item) =>
    !consumedKeys.has(buildSessionAiRawExchangeDedupKey(item)));
  return [
    ...preservedExchanges,
    ...nextCurrentTraceExchanges,
    ...leftoverCurrentTraceExchanges,
  ];
}

// 描述：
//
//   - 从后端步骤记录中提取多轮 AI 原始请求/响应，保证复制排查时能看到完整往返链路。
//
// Params:
//
//   - steps: 当前响应返回的步骤记录。
//   - options: 额外补齐的 trace / stage / status 元信息。
//
// Returns:
//
//   - 按步骤顺序提取出的原始收发数组。
function extractSessionAiRawExchangesFromStepRecords(
  steps: AgentStepRecord[],
  options?: {
    status?: SessionAiRawExchangeStatus;
    traceId?: string;
    stageTitle?: string;
  },
): SessionAiRawExchangeItem[] {
  return (steps || [])
    .filter((step) => step?.data && typeof step.data === "object")
    .map((step) => {
      const stepData = step.data as Record<string, unknown>;
      return normalizeSessionAiRawExchangeItem({
        requestRaw: typeof stepData.llm_prompt_raw === "string" ? stepData.llm_prompt_raw : "",
        responseRaw: typeof stepData.llm_response_raw === "string" ? stepData.llm_response_raw : "",
        stepCode: step.code,
        stepSummary: step.summary,
        turnIndex: Number.isFinite(Number(stepData.turn_index)) ? Number(stepData.turn_index) : undefined,
        status: options?.status || "finished",
        traceId: options?.traceId,
        stageTitle: options?.stageTitle,
      });
    })
    .filter((item): item is SessionAiRawExchangeItem => Boolean(item));
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
//   - 判断工具是否属于“任务计划”步骤类型。
//
// Params:
//
//   - toolName: 工具名。
//
// Returns:
//
//   - true: 任务计划类工具。
function isTodoTool(toolName: string): boolean {
  return toolName === "todo_read" || toolName === "todo_write";
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
    || toolName === "apply_patch_file";
}

// 描述：
//
//   - 判断工具是否属于“创建目录/文件节点”步骤类型。
//
// Params:
//
//   - toolName: 工具名。
//
// Returns:
//
//   - true: 创建类工具。
function isCreateTool(toolName: string): boolean {
  return toolName === "mkdir";
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
//   - 判断工具是否属于“真实浏览器交互”步骤类型，统一覆盖 js_repl 与 browser_* 工具。
//
// Params:
//
//   - toolName: 工具名。
//
// Returns:
//
//   - true: 浏览器交互类工具。
function isBrowserTool(toolName: string): boolean {
  return toolName === "js_repl"
    || toolName === "js_repl_reset"
    || toolName === "browser_navigate"
    || toolName === "browser_snapshot"
    || toolName === "browser_click"
    || toolName === "browser_type"
    || toolName === "browser_wait_for"
    || toolName === "browser_take_screenshot"
    || toolName === "browser_tabs"
    || toolName === "browser_close";
}

// 描述：
//
//   - 将浏览器工具名映射为用户可见的进行中/完成态文案，避免执行流只显示原始工具编码。
//
// Params:
//
//   - toolName: 浏览器工具名。
//   - state: 当前动作阶段。
//   - payload: 浏览器工具返回的结构化结果。
//
// Returns:
//
//   - 用户可见的步骤文案。
function buildBrowserToolStepText(
  toolName: string,
  state: "running" | "finished",
  payload: Record<string, unknown>,
): string {
  const browserUrl = String(
    payload.url
    || payload.current_url
    || (payload.snapshot && typeof payload.snapshot === "object"
      ? (payload.snapshot as Record<string, unknown>).url
      : "")
    || "",
  ).trim();
  const screenshotPath = String(payload.path || "").trim();
  if (state === "running") {
    if (toolName === "browser_navigate") {
      return translateDesktopText("正在打开页面");
    }
    if (toolName === "browser_click") {
      return translateDesktopText("正在点击页面元素");
    }
    if (toolName === "browser_type") {
      return translateDesktopText("正在输入页面内容");
    }
    if (toolName === "browser_wait_for") {
      return translateDesktopText("正在等待页面条件");
    }
    if (toolName === "browser_snapshot") {
      return translateDesktopText("正在抓取页面快照");
    }
    if (toolName === "browser_take_screenshot") {
      return translateDesktopText("正在保存页面截图");
    }
    if (toolName === "browser_tabs") {
      return translateDesktopText("正在读取浏览器标签页");
    }
    if (toolName === "browser_close") {
      return translateDesktopText("正在关闭真实浏览器");
    }
    if (toolName === "js_repl_reset") {
      return translateDesktopText("正在重置浏览器会话");
    }
    return translateDesktopText("正在执行浏览器脚本");
  }
  if (toolName === "browser_navigate" && browserUrl) {
    return translateDesktopText("已在真实浏览器打开 {{url}}", { url: browserUrl });
  }
  if (toolName === "browser_snapshot") {
    return browserUrl
      ? translateDesktopText("已抓取页面快照 {{url}}", { url: browserUrl })
      : translateDesktopText("已抓取页面快照");
  }
  if (toolName === "browser_click") {
    return browserUrl
      ? translateDesktopText("已在真实浏览器点击页面元素 {{url}}", { url: browserUrl })
      : translateDesktopText("已在真实浏览器点击页面元素");
  }
  if (toolName === "browser_type") {
    return browserUrl
      ? translateDesktopText("已在真实浏览器输入内容 {{url}}", { url: browserUrl })
      : translateDesktopText("已在真实浏览器输入内容");
  }
  if (toolName === "browser_wait_for") {
    return translateDesktopText("已等待页面条件成立");
  }
  if (toolName === "browser_take_screenshot") {
    return screenshotPath
      ? translateDesktopText("已保存页面截图 {{path}}", { path: screenshotPath })
      : translateDesktopText("已保存页面截图");
  }
  if (toolName === "browser_tabs") {
    return translateDesktopText("已同步真实浏览器标签页");
  }
  if (toolName === "browser_close") {
    return translateDesktopText("已关闭真实浏览器");
  }
  if (toolName === "js_repl_reset") {
    return translateDesktopText("已重置浏览器会话");
  }
  return translateDesktopText("已执行浏览器脚本");
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
//   - 规整单个用户提问问题，过滤掉缺字段或空白项，避免前端交互卡片渲染非法数据。
function normalizeUserInputQuestionPrompt(
  value: unknown,
): SharedAgentUserInputQuestionPrompt | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const options = Array.isArray(raw.options)
    ? raw.options
      .map((option) => {
        if (!option || typeof option !== "object") {
          return null;
        }
        const rawOption = option as Record<string, unknown>;
        const label = String(rawOption.label || "").trim();
        const description = String(rawOption.description || "").trim();
        if (!label || !description) {
          return null;
        }
        return { label, description };
      })
      .filter((option): option is SharedAgentUserInputQuestionPrompt["options"][number] => Boolean(option))
    : [];
  const id = String(raw.id || "").trim();
  const header = String(raw.header || "").trim();
  const question = String(raw.question || "").trim();
  if (!id || !header || !question || options.length === 0) {
    return null;
  }
  return {
    id,
    header,
    question,
    options,
  };
}

// 描述：
//
//   - 规整单个用户提问回答，过滤空值并收敛 answer_type，避免运行片段与提交状态出现脏数据。
function normalizeUserInputAnswer(
  value: unknown,
): SharedAgentUserInputAnswer | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const questionId = String(raw.question_id || "").trim();
  const answerType = String(raw.answer_type || "").trim();
  const normalizedAnswerType = answerType === "custom" ? "custom" : answerType === "option" ? "option" : "";
  const valueText = String(raw.value || "").trim();
  if (!questionId || !normalizedAnswerType || !valueText) {
    return null;
  }
  const answer: SharedAgentUserInputAnswer = {
    question_id: questionId,
    answer_type: normalizedAnswerType,
    value: valueText,
  };
  if (Number.isFinite(Number(raw.option_index))) {
    answer.option_index = Math.max(0, Math.floor(Number(raw.option_index)));
  }
  if (typeof raw.option_label === "string" && String(raw.option_label || "").trim()) {
    answer.option_label = String(raw.option_label || "").trim();
  }
  return answer;
}

// 描述：
//
//   - 解析文本流中的用户提问 data 结构，提取请求 ID 与问题列表供底部卡片和运行流复用。
function resolveUserInputEventData(payload: AgentTextStreamEvent): AgentRequestUserInputEventData {
  if (!payload.data || typeof payload.data !== "object") {
    return {};
  }
  const data = payload.data as Record<string, unknown>;
  return {
    request_id: typeof data.request_id === "string" ? data.request_id : undefined,
    questions: Array.isArray(data.questions)
      ? data.questions
        .map((item) => normalizeUserInputQuestionPrompt(item))
        .filter((item): item is SharedAgentUserInputQuestionPrompt => Boolean(item))
      : undefined,
  };
}

// 描述：
//
//   - 构建用户提问片段 data，只保留跨页面恢复与导出所需关键字段。
function buildUserInputSegmentData(payload: AgentTextStreamEvent): Record<string, unknown> {
  const resolved = resolveUserInputEventData(payload);
  return {
    __segment_kind: payload.kind,
    __step_type: "user_input_request",
    request_id: String(resolved.request_id || "").trim(),
    question_count: Array.isArray(resolved.questions) ? resolved.questions.length : 0,
    questions: resolved.questions || [],
  };
}

// 描述：
//
//   - 从用户提问片段 data 中解析问题数量，优先读取显式计数，再回退到 questions 数组长度。
function resolveUserInputQuestionCount(data: Record<string, unknown> | undefined): number {
  if (data && Number.isFinite(Number(data.question_count))) {
    return Math.max(0, Math.floor(Number(data.question_count)));
  }
  if (data && Array.isArray(data.questions)) {
    return data.questions.length;
  }
  return 0;
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
//   - 将原始 todo 数组规整为 dock 可消费的任务项列表，并统一兼容 content/task/title/text 字段。
//
// Params:
//
//   - rawItems: 原始任务数组。
//
// Returns:
//
//   - 规整后的任务项列表。
function normalizeTodoDockItems(rawItems: unknown): SessionTodoDockItem[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }
  return rawItems
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const content = String(
        record.content
        ?? record.task
        ?? record.title
        ?? record.text
        ?? "",
      ).trim();
      if (!content) {
        return null;
      }
      const rawStatus = String(record.status ?? record.state ?? "").trim().toLowerCase();
      let status: SessionTodoDockItemStatus = "pending";
      if (
        rawStatus === "in_progress"
        || rawStatus === "in-progress"
        || rawStatus === "running"
        || rawStatus === "doing"
      ) {
        status = "in_progress";
      } else if (
        rawStatus === "completed"
        || rawStatus === "complete"
        || rawStatus === "done"
        || rawStatus === "finished"
        || rawStatus === "success"
      ) {
        status = "completed";
      } else if (
        rawStatus === "blocked"
        || rawStatus === "failed"
        || rawStatus === "cancelled"
        || rawStatus === "canceled"
      ) {
        status = "blocked";
      }
      return {
        id: String(record.id ?? `todo-${index + 1}`).trim() || `todo-${index + 1}`,
        content,
        status,
      } satisfies SessionTodoDockItem;
    })
    .filter((item): item is SessionTodoDockItem => Boolean(item));
}

// 描述：
//
//   - 从单个运行片段中提取任务计划项；仅识别显式透传的 `todo_items` 数据。
//
// Params:
//
//   - segment: 运行片段。
//
// Returns:
//
//   - 任务计划项列表；若当前片段不包含 todo 数据则返回 null。
function resolveTodoItemsFromSegment(segment: AssistantRunSegment): SessionTodoDockItem[] | null {
  const rawItems = segment.data && typeof segment.data === "object"
    ? (segment.data as Record<string, unknown>).todo_items
    : undefined;
  if (!Array.isArray(rawItems)) {
    return null;
  }
  return normalizeTodoDockItems(rawItems);
}

// 描述：
//
//   - 从当前会话的运行态里提取最近一次任务计划快照，优先取正在执行的消息，再回退到最新助手消息。
//
// Params:
//
//   - messages: 当前消息列表。
//   - runMetaMap: 运行态映射。
//   - preferredMessageId: 优先消息 ID。
//
// Returns:
//
//   - 最近一次任务计划快照；若尚无 todo 数据则返回 null。
function resolveAssistantTodoDockSnapshot(
  messages: MessageItem[],
  runMetaMap: Record<string, AssistantRunMeta>,
  preferredMessageId: string,
): SessionTodoDockSnapshot | null {
  const orderedMessageIds = Array.from(new Set([
    String(preferredMessageId || "").trim(),
    ...[...messages]
      .reverse()
      .map((item) => String(item.id || "").trim())
      .filter((item) => item.length > 0),
    ...Object.keys(runMetaMap).reverse(),
  ].filter((item) => item.length > 0)));

  for (const messageId of orderedMessageIds) {
    const meta = runMetaMap[messageId];
    if (!meta) {
      continue;
    }
    for (const segment of [...meta.segments].reverse()) {
      const items = resolveTodoItemsFromSegment(segment);
      if (!items) {
        continue;
      }
      return {
        items,
        messageId,
      };
    }
  }
  return null;
}

// 描述：
//
//   - 将任务状态翻译为用户可见文案，统一供 dock 任务卡片复用。
//
// Params:
//
//   - status: 任务状态。
//
// Returns:
//
//   - 中文状态文案。
function resolveTodoDockStatusLabel(status: SessionTodoDockItemStatus): string {
  if (status === "completed") {
    return translateDesktopText("已完成");
  }
  if (status === "in_progress") {
    return translateDesktopText("进行中");
  }
  if (status === "blocked") {
    return translateDesktopText("已阻塞");
  }
  return translateDesktopText("待处理");
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
    if (isBrowserTool(toolName)) {
      return {
        key: segmentKey,
        intro: translateDesktopText("真实浏览器"),
        step: buildBrowserToolStepText(toolName, "running", data.args_data || {}),
        status: "running",
        data: {
          __segment_kind: payload.kind,
          __step_type: "browser",
          tool_name: toolName,
        },
      };
    }
    if (isTodoTool(toolName)) {
      return {
        key: segmentKey,
        intro: translateDesktopText("任务计划"),
        step: toolName === "todo_write"
          ? translateDesktopText("正在更新任务计划")
          : translateDesktopText("正在读取任务计划"),
        status: "running",
        data: {
          __segment_kind: payload.kind,
          __step_type: "todo",
          todo_operation: toolName,
        },
      };
    }
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

    if (toolName === "request_user_input") {
      return null;
    }

    if (isTodoTool(toolName)) {
      const parsedResultRecord = parseJsonRecord(data.result);
      const parsedRawRecord = parseJsonRecord(resultData.raw);
      const normalizedTodoItems = normalizeTodoDockItems(
        resultData.items
        ?? parsedResultRecord?.items
        ?? parsedRawRecord?.items
        ?? [],
      );
      const todoCount = Math.max(
        0,
        Math.floor(Number(
          resultData.count
          ?? parsedResultRecord?.count
          ?? parsedRawRecord?.count
          ?? normalizedTodoItems.length,
        )),
      );
      const detail = truncateRunText(
        String(
          resultData.content_preview
          || data.result
          || JSON.stringify(normalizedTodoItems, null, 2)
          || eventMessage
          || "",
        ).trim(),
        64000,
      );
      return {
        key: segmentKey,
        intro: translateDesktopText("任务计划"),
        step: toolName === "todo_write"
          ? translateDesktopText("已同步 {{count}} 项任务", { count: todoCount })
          : translateDesktopText("已读取 {{count}} 项任务", { count: todoCount }),
        status: runOk ? "finished" : "failed",
        detail,
        data: {
          __segment_kind: payload.kind,
          __step_type: "todo",
          todo_operation: toolName,
          todo_items: normalizedTodoItems,
          todo_count: todoCount,
        },
      };
    }

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
        step: translateDesktopText("已执行命令 {{command}}", {
          command: command || "(unknown)",
        }),
        status: runOk ? "finished" : "failed",
        detail,
        data: {
          __segment_kind: payload.kind,
          __step_type: "terminal",
          terminal_command: command || "(unknown)",
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

    if (isCreateTool(toolName)) {
      const parsedResultRecord = parseJsonRecord(data.result);
      const parsedRawRecord = parseJsonRecord(resultData.raw);
      const path = String(
        resultData.path
        || parsedResultRecord?.path
        || parsedRawRecord?.path
        || argsData.path
        || "",
      ).trim();
      const detail = truncateRunText(
        path || String(resultData.raw || data.result || eventMessage || "").trim(),
        64000,
      );
      return {
        key: segmentKey,
        intro: translateDesktopText("文件创建"),
        step: translateDesktopText("已创建 {{path}}", {
          path: path || "unknown",
        }),
        status: runOk ? "finished" : "failed",
        detail,
        data: {
          __segment_kind: payload.kind,
          __step_type: "create",
          create_path: path,
        },
      };
    }

    if (isBrowserTool(toolName)) {
      const detail = truncateRunText(
        JSON.stringify(resultData || {}, null, 2),
        64000,
      );
      return {
        key: segmentKey,
        intro: translateDesktopText("真实浏览器"),
        step: buildBrowserToolStepText(toolName, "finished", resultData),
        status: runOk ? "finished" : "failed",
        detail,
        data: {
          __segment_kind: payload.kind,
          __step_type: "browser",
          tool_name: toolName,
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
      intro: translateDesktopText("工具执行"),
      step: runOk
        ? translateDesktopText("已执行 {{tool}}", {
          tool: toolName || translateDesktopText("未知工具"),
        })
        : translateDesktopText("{{tool}} 执行失败", {
          tool: toolName || translateDesktopText("未知工具"),
        }),
      status: runOk ? "finished" : "failed",
      detail: fallbackDetail,
      data: {
        __segment_kind: payload.kind,
        __step_type: "undefined",
        tool_name: toolName,
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

  if (payload.kind === STREAM_KINDS.REQUEST_USER_INPUT) {
    const data = resolveUserInputEventData(payload);
    const questionCount = Array.isArray(data.questions) ? data.questions.length : 0;
    return {
      key: segmentKey,
      intro: translateDesktopText("需要用户决定"),
      step: translateDesktopText("正在询问 {{count}} 个问题", { count: questionCount }),
      status: "running",
      data: buildUserInputSegmentData(payload),
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
//   - 判断运行片段是否属于“待用户决定”片段，供底部提问卡片与运行流恢复时复用。
function isUserInputPendingSegment(segment: AssistantRunSegment): boolean {
  const segmentKind = segment.data && typeof segment.data.__segment_kind === "string"
    ? segment.data.__segment_kind
    : "";
  const stepType = segment.data && typeof segment.data.__step_type === "string"
    ? segment.data.__step_type
    : "";
  return segment.intro === translateDesktopText("需要用户决定")
    || segmentKind === STREAM_KINDS.REQUEST_USER_INPUT
    || stepType === "user_input_request";
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
//   - 判断运行片段是否属于“规划说明”段；该类片段在执行流里只保留最新一条，避免多次 planning 累积占满视图。
//
// Params:
//
//   - segment: 待判定片段。
//
// Returns:
//
//   - true: 规划说明段。
function isRoundDescriptionSegment(segment: AssistantRunSegment): boolean {
  const segmentRole = segment.data && typeof segment.data.__segment_role === "string"
    ? segment.data.__segment_role
    : "";
  return segmentRole === ROUND_DESCRIPTION_SEGMENT_ROLE;
}

// 描述：
//
//   - 判断运行片段是否属于“工作流阶段分割线”；该类片段只负责在同一条助手消息里分隔不同技能节点，
//     不参与普通步骤合并。
//
// Params:
//
//   - segment: 待判定片段。
//
// Returns:
//
//   - true: 工作流阶段分割线。
function isWorkflowStageDividerSegment(segment: AssistantRunSegment): boolean {
  const segmentRole = segment.data && typeof segment.data.__segment_role === "string"
    ? segment.data.__segment_role
    : "";
  return segmentRole === WORKFLOW_STAGE_DIVIDER_SEGMENT_ROLE;
}

// 描述：
//
//   - 规范化运行片段列表，去掉历史遗留的重复思考占位；若当前仍处于纯等待阶段，
//     则只保留一条统一的初始化思考占位，避免返回会话后出现双“正在思考”或空执行过程组。
//   - 不再裁剪旧片段，确保同一条助手消息中的执行历史可完整保留并在刷新后恢复。
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
    .filter((item) => item.intro || item.step);
  if (sanitizedSegments.length === 0) {
    return [];
  }
  const dedupedSegments = sanitizedSegments.reduce<AssistantRunSegment[]>((accumulator, item) => {
    if (!isRoundDescriptionSegment(item)) {
      accumulator.push(item);
      return accumulator;
    }
    const preservedSegments = accumulator.filter((entry) => !isRoundDescriptionSegment(entry));
    return [...preservedSegments, item];
  }, []);
  const meaningfulSegments = dedupedSegments.filter((item) => !isThinkingPlaceholderSegment(item));
  if (meaningfulSegments.length > 0) {
    return meaningfulSegments;
  }
  const latestThinkingSegment = [...dedupedSegments].reverse().find((item) => isThinkingPlaceholderSegment(item));
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
    todoState?: {
      stepIndex: number;
      details: string[];
      detailSet: Set<string>;
      latestText: string;
      latestStatus: AssistantRunSegmentStatus;
    };
  }

  const groups: InternalGroup[] = [];
  let activeGroupIndex = -1;
  const ensureActiveGroup = (): number => {
    if (activeGroupIndex >= 0 && groups[activeGroupIndex]) {
      return activeGroupIndex;
    }
    groups.push({
      key: `run-group-${groups.length}-default`,
      title: "",
      kind: "default",
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
    const segmentKind = typeof segmentData.__segment_kind === "string" ? segmentData.__segment_kind : "";
    const stepType = typeof segmentData.__step_type === "string" ? segmentData.__step_type : "";
    const normalizedIntro = String(segment.intro || "").trim();
    const normalizedStep = String(segment.step || "").trim();
    const looksLikeRecoveredRoundDescription = segmentKind === STREAM_KINDS.PLANNING
      && normalizedIntro
      && normalizedStep === translateDesktopText("正在思考…");

    if (segmentRole === INITIAL_THINKING_SEGMENT_ROLE || isThinkingPlaceholderSegment(segment)) {
      // 描述：
      //
      //   - 初始化思考占位由统一底部指示器承载，不在分组内重复渲染步骤。
      return;
    }

    if (segmentRole === ROUND_DESCRIPTION_SEGMENT_ROLE || looksLikeRecoveredRoundDescription) {
      const title = normalizedIntro;
      if (!title) {
        return;
      }
      groups.push({
        key: `run-group-${groups.length}-${title}`,
        title,
        kind: "default",
        steps: [],
      });
      activeGroupIndex = groups.length - 1;
      return;
    }

    if (segmentRole === WORKFLOW_STAGE_DIVIDER_SEGMENT_ROLE || isWorkflowStageDividerSegment(segment)) {
      const title = normalizedIntro || normalizedStep;
      if (!title) {
        return;
      }
      groups.push({
        key: `run-group-${groups.length}-${title}`,
        title,
        kind: "divider",
        steps: [],
      });
      activeGroupIndex = -1;
      return;
    }

    const groupIndex = ensureActiveGroup();
    const currentGroup = groups[groupIndex];
    const detail = resolveRunSegmentStepDetail(segment, normalizedStep);
    if (stepType === "todo") {
      // 描述：
      //
      //   - 任务计划的读写步骤会频繁往返；主日志仅保留一条动态状态，
      //   - 既避免重复刷屏，也确保正文不会被成排的“已读取/已同步”步骤挤下去。
      const todoTimelineDetail = segment.status === "failed" && detail
        ? `${normalizedStep}\n${detail}`.trim()
        : normalizedStep;
      if (!currentGroup.todoState) {
        currentGroup.todoState = {
          stepIndex: currentGroup.steps.length,
          details: [],
          detailSet: new Set<string>(),
          latestText: normalizedStep || translateDesktopText("任务计划"),
          latestStatus: segment.status,
        };
        currentGroup.steps.push({
          key: `todo-${segment.key}-${index}`,
          status: segment.status,
          text: normalizedStep || translateDesktopText("任务计划"),
          detail: "",
          data: {
            __step_type: "todo",
            ...(segmentData && typeof segmentData === "object" ? { ...segmentData } : {}),
          },
        });
      }
      const todoState = currentGroup.todoState;
      if (!todoState) {
        return;
      }
      todoState.latestText = normalizedStep || todoState.latestText;
      todoState.latestStatus = segment.status;
      if (todoTimelineDetail && !todoState.detailSet.has(todoTimelineDetail)) {
        todoState.detailSet.add(todoTimelineDetail);
        todoState.details.push(todoTimelineDetail);
      }
      const todoStep = currentGroup.steps[todoState.stepIndex];
      if (todoStep) {
        todoStep.status = todoState.latestStatus;
        todoStep.text = todoState.latestText;
        todoStep.detail = todoState.details.join("\n");
        todoStep.data = {
          __step_type: "todo",
          ...(segmentData && typeof segmentData === "object" ? { ...segmentData } : {}),
        };
      }
      return;
    }

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
      kind: group.kind,
      steps: group.steps.filter((step) => String(step.text || "").trim()),
    }))
    .filter((group) => group.kind === "divider" || group.steps.length > 0);
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
  let intro = buildAssistantHeartbeatWaitingText(heartbeatCount);
  let step = translateDesktopText("执行仍在进行中，正在同步最新状态。");
  if (stage === "planning") {
    step = translateDesktopText("等待模型返回可执行编排脚本。");
  } else if (stage === "bridge") {
    step = translateDesktopText("环境检查完成后将继续执行当前步骤。");
  } else if (stage === "executing") {
    step = translateDesktopText("当前步骤仍在执行，请稍候。");
  } else if (stage === "finalizing") {
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
//   - 统一生成等待态文案；避免后端不同阶段的 heartbeat 把主消息刷成一长串细节描述，
//     只保留简洁的“正在思考…”与等待时长。
//
// Params:
//
//   - heartbeatCount: 当前 heartbeat 次数。
//
// Returns:
//
//   - 用于主消息展示的等待态文本。
function buildAssistantHeartbeatWaitingText(heartbeatCount: number): string {
  if (heartbeatCount <= 1) {
    return translateDesktopText("正在思考…");
  }
  const waitedSeconds = Math.max(1, Math.round(heartbeatCount * 1.2));
  const waitSuffix = translateDesktopText("（已等待约 {{seconds}} 秒）", { seconds: waitedSeconds });
  return translateDesktopText("正在思考…{{suffix}}", { suffix: waitSuffix });
}

// 描述：
//
//   - 将真实 heartbeat 文案补齐等待时长，避免长时间等待时主文案停留在同一句而看起来像“卡住”。
//
// Params:
//
//   - _message: 后端透传的 heartbeat 文案；当前统一收口为简洁等待态，不直接展示原始细节。
//   - heartbeatCount: 当前 heartbeat 次数。
//
// Returns:
//
//   - 追加等待时长后的展示文本。
function buildAssistantHeartbeatDisplayText(_message: string, heartbeatCount: number): string {
  return buildAssistantHeartbeatWaitingText(heartbeatCount);
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
    || (
      normalizedValue.startsWith(translateDesktopText("正在思考…"))
      && normalizedValue.includes(translateDesktopText("（已等待约"))
      && normalizedValue.endsWith(translateDesktopText(" 秒）"))
    )
    || normalizedValue === translateDesktopText("正在准备执行...")
    || normalizedValue === translateDesktopText("正在生成执行结果…")
    || normalizedValue === translateDesktopText("正在整理输出...")
    || normalizedValue === translateDesktopText("智能体正在思考…");
}

// 描述：
//
//   - 判断执行完成后的总结是否仍属于“通用过程性占位”。
//   - 这类文案只适合前端展示执行状态，不适合作为后续 agent 上下文继续传给模型。
//
// Params:
//
//   - value: 待判断的总结文本。
//
// Returns:
//
//   - true: 属于通用过程性占位总结。
function isGenericFinishedRunSummaryText(value: string): boolean {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return true;
  }
  return normalizedValue === translateDesktopText("执行过程已完成。")
    || normalizedValue === translateDesktopText("执行完成")
    || (
      normalizedValue.length > 0
      && stripWorkflowStageAutoCompletionPlaceholder(normalizedValue).length === 0
      && (
        isWorkflowStageAutoCompletionLeadLine(normalizedValue)
        || normalizedValue.startsWith("脚本执行完成（自动补全结果）：")
        || normalizedValue.startsWith("脚本执行完成（未产生可见输出，系统自动收尾）：")
      )
    );
}

// 描述：
//
//   - 解析当前助手消息应直接展示给用户的正文，优先保留真实正文，
//     避免被“正在思考/执行完成”这类状态占位覆盖后导致正文在 UI 中消失。
//
// Params:
//
//   - messageText: 当前助手消息文本。
//   - runMeta: 当前助手消息绑定的运行态。
//
// Returns:
//
//   - 可直接展示的正文；若当前仅有状态占位则返回空字符串。
function resolveVisibleAssistantBodyText(
  messageText: string,
  runMeta?: AssistantRunMeta,
): string {
  const normalizedMessageText = String(messageText || "").trim();
  if (
    normalizedMessageText
    && !isGenericRunningIndicatorText(normalizedMessageText)
    && !isGenericFinishedRunSummaryText(normalizedMessageText)
  ) {
    return normalizedMessageText;
  }
  const normalizedSummary = String(runMeta?.summary || "").trim();
  if (
    normalizedSummary
    && runMeta?.summarySource !== "failure"
    && !isGenericRunningIndicatorText(normalizedSummary)
    && !isGenericFinishedRunSummaryText(normalizedSummary)
  ) {
    return normalizedSummary;
  }
  return "";
}

// 描述：
//
//   - 解析运行中底部指示器文案；正文已单独显示时不再重复输出底部等待提示，
//     无正文时再回退到运行态中的状态提示，避免同一句话在正文区与底部状态区重复出现。
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
  const visibleBodyText = resolveVisibleAssistantBodyText(messageText, runMeta);
  if (visibleBodyText) {
    return "";
  }
  const normalizedSummary = String(runMeta?.summary || "").trim();
  if (normalizedSummary && normalizedSummary !== translateDesktopText("正在思考…")) {
    return normalizedSummary;
  }
  return translateDesktopText("正在思考…");
}

// 描述：
//
//   - 从前端完整 transcript 中提炼“供 agent 使用的上下文消息”。
//   - UI 侧保留所有正文与执行过程；agent 侧仅保留用户输入、关键助手结论，并主动剔除工作流根运行消息这类过程占位。
//
// Params:
//
//   - transcriptMessages: 前端展示用的完整消息列表。
//   - runMetaMap: 助手运行态映射。
//
// Returns:
//
//   - 精简后的 agent 上下文消息列表。
function buildPromptContextMessages(
  transcriptMessages: MessageItem[],
  runMetaMap: Record<string, AssistantRunMeta>,
): MessageItem[] {
  const workflowRootMessageIdSet = new Set(
    transcriptMessages
      .map((item) => String(item.id || "").trim())
      .filter((messageId) => {
        if (!messageId) {
          return false;
        }
        return transcriptMessages.some((candidate) => {
          const candidateId = String(candidate.id || "").trim();
          return candidateId.startsWith(`${messageId}-stage-`);
        });
      }),
  );
  return transcriptMessages
    .map((item) => {
      const normalizedMessageId = String(item.id || "").trim();
      if (item.role === "user") {
        const normalizedText = String(item.text || "").trim();
        if (!normalizedText) {
          return null;
        }
        return {
          ...item,
          text: normalizedText,
        } satisfies MessageItem;
      }
      if (normalizedMessageId && workflowRootMessageIdSet.has(normalizedMessageId)) {
        return null;
      }
      const runMeta = normalizedMessageId ? runMetaMap[normalizedMessageId] : undefined;
      const preferredSummaryText = runMeta?.summarySource === "ai"
        ? String(runMeta.summary || "").trim()
        : "";
      const effectiveText = String(
        preferredSummaryText
        || resolveVisibleAssistantBodyText(item.text, runMeta)
        || runMeta?.summary
        || item.text
        || "",
      ).trim();
      if (!effectiveText) {
        return null;
      }
      if (isGenericRunningIndicatorText(effectiveText) || isGenericFinishedRunSummaryText(effectiveText)) {
        return null;
      }
      return {
        ...item,
        text: effectiveText,
      } satisfies MessageItem;
    })
    .filter((item): item is MessageItem => Boolean(item));
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
    summarySource: input.summarySource === "ai"
      ? "ai"
      : input.summarySource === "failure"
        ? "failure"
        : input.summarySource === "system"
          ? "system"
          : undefined,
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
  const [sessionCumulativeTokenUsage, setSessionCumulativeTokenUsage] = useState<number>(
    () => resolveAgentSessionCumulativeTokenUsage(sessionId),
  );

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

  // 描述：格式化累计 token 数量，统一输出千分位文本，避免输入栏展示过长原始数字。
  const formatTokenUsage = (totalTokens: number) => {
    const normalizedTotalTokens = Number.isFinite(totalTokens) && totalTokens > 0
      ? Math.floor(totalTokens)
      : 0;
    return normalizedTotalTokens.toLocaleString("en-US");
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
  const activeWorkspacePath = String(activeWorkspace?.path || "").trim();
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
  const [activeWorkspacePathValid, setActiveWorkspacePathValid] = useState(true);
  const [sessionMemory, setSessionMemory] = useState<SessionMemorySnapshot | null>(null);
  const [desktopRuntimeInfo, setDesktopRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null);
  const desktopRuntimeInfoRef = useRef<DesktopRuntimeInfo | null>(null);
  const sessionMemoryRef = useRef<SessionMemorySnapshot | null>(null);
  const invalidWorkspacePromptMessage = t("项目目录已不存在，当前话题不能继续发送新消息。");
  const isActiveWorkspacePathMissing = Boolean(activeWorkspace?.id && activeWorkspacePath && !activeWorkspacePathValid);

  // 描述：
  //
  //   - 保持桌面运行时信息的 ref 与渲染态同步，避免异步发送链路读取到旧值。
  useEffect(() => {
    desktopRuntimeInfoRef.current = desktopRuntimeInfo;
  }, [desktopRuntimeInfo]);

  // 描述：
  //
  //   - 保持会话长期记忆的 ref 与渲染态同步，避免异步提炼链路读取到旧快照。
  useEffect(() => {
    sessionMemoryRef.current = sessionMemory;
  }, [sessionMemory]);

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
  //   - 读取当前会话绑定项目目录的真实可用性，目录丢失时用于统一禁用输入框、发送按钮与重试链路。
  //
  // Params:
  //
  //   - workspacePath: 当前项目目录路径。
  //
  // Returns:
  //
  //   - 目录存在且仍为文件夹时返回 true。
  const resolveActiveWorkspacePathValidity = useCallback(async (workspacePath: string): Promise<boolean> => {
    const normalizedWorkspacePath = String(workspacePath || "").trim();
    if (!normalizedWorkspacePath) {
      return true;
    }
    const statusMap = await getProjectWorkspacePathStatusMap([normalizedWorkspacePath]);
    return statusMap[normalizedWorkspacePath]?.valid !== false;
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!activeWorkspacePath) {
      setActiveWorkspacePathValid(true);
      return () => {
        disposed = true;
      };
    }
    void resolveActiveWorkspacePathValidity(activeWorkspacePath).then((nextValid) => {
      if (disposed) {
        return;
      }
      setActiveWorkspacePathValid(nextValid);
    });
    return () => {
      disposed = true;
    };
  }, [activeWorkspacePath, resolveActiveWorkspacePathValidity]);

  useEffect(() => {
    if (!IS_BROWSER || !activeWorkspacePath) {
      return;
    }
    let disposed = false;
    const syncActiveWorkspacePathValidity = () => {
      void resolveActiveWorkspacePathValidity(activeWorkspacePath).then((nextValid) => {
        if (disposed) {
          return;
        }
        setActiveWorkspacePathValid(nextValid);
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncActiveWorkspacePathValidity();
      }
    };
    window.addEventListener("focus", syncActiveWorkspacePathValidity);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      window.removeEventListener("focus", syncActiveWorkspacePathValidity);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeWorkspacePath, resolveActiveWorkspacePathValidity]);

  // 描述：
  //
  //   - 页面初始化时预读取桌面运行系统与架构，帮助后续 prompt 注入稳定的命令平台约束。
  useEffect(() => {
    let disposed = false;
    void getDesktopRuntimeInfo().then((runtimeInfo) => {
      if (disposed) {
        return;
      }
      desktopRuntimeInfoRef.current = runtimeInfo;
      setDesktopRuntimeInfo(runtimeInfo);
    });
    return () => {
      disposed = true;
    };
  }, []);

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
  const [agentContextMessages, setAgentContextMessages] = useState<MessageItem[]>([]);
  const [assistantRunMetaMap, setAssistantRunMetaMap] = useState<Record<string, AssistantRunMeta>>({});
  const [userInputDraftMap, setUserInputDraftMap] = useState<
    Record<string, Record<string, AgentUserInputDraftAnswer>>
  >({});
  const [userInputSubmittingRequestId, setUserInputSubmittingRequestId] = useState("");
  const [sessionApprovedToolNames, setSessionApprovedToolNames] = useState<string[]>([]);
  const [workflowPhaseCursor, setWorkflowPhaseCursor] = useState<SessionWorkflowPhaseCursorSnapshot | null>(null);
  const [expandedRunSegmentDetailMap, setExpandedRunSegmentDetailMap] = useState<Record<string, boolean>>({});
  const [sessionAiPromptRaw, setSessionAiPromptRaw] = useState("");
  const [sessionAiResponseRaw, setSessionAiResponseRaw] = useState("");
  const [sessionAiRawByMessage, setSessionAiRawByMessage] = useState<Record<string, SessionAiRawByMessageItem>>({});
  const [sessionCallRecords, setSessionCallRecords] = useState<SessionCallRecordSnapshot[]>([]);
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
  const [selectedModelName, setSelectedModelName] = useState<string>(
    () => resolveAgentSessionSelectedAiModel(sessionId),
  );
  const [selectedModeName, setSelectedModeName] = useState<string>(
    () => resolveAgentSessionSelectedAiMode(sessionId),
  );
  // 描述：解析当前选中的 Provider，未命中时回退到列表首项。
  const selectedAi = useMemo(
    () => availableAiKeys.find((item) => item.provider === selectedProvider) || availableAiKeys[0] || null,
    [availableAiKeys, selectedProvider],
  );
  const [executionSelection, setExecutionSelection] = useState<SessionExecutionSelection>(() =>
    readSessionExecutionSelection({
      storageKey: AGENT_EXECUTION_SELECTION_KEY,
      legacyWorkflowKey: AGENT_WORKFLOW_SELECTED_KEY,
      legacySkillKey: AGENT_SKILL_SELECTED_KEY,
      preferredWorkflowId: routePreferredWorkflowId,
      preferredSkillIds: routePreferredSkillIds,
    })
  );
  const selectedWorkflowId = executionSelection.kind === "workflow"
    ? String(executionSelection.workflowId || "").trim()
    : "";
  const selectedSkillIds = executionSelection.kind === "skill" && String(executionSelection.skillId || "").trim()
    ? [String(executionSelection.skillId || "").trim()]
    : [];
  // 描述：
  //
  //   - 兼容既有工作流回写调用点；内部统一写回单一执行选择状态。
  const setSelectedWorkflowId = useCallback((workflowId: string) => {
    setExecutionSelection(buildWorkflowExecutionSelection(workflowId));
  }, []);
  const [selectedDccSoftware, setSelectedDccSoftware] = useState<string>(
    () => resolveAgentSessionSelectedDccSoftware(sessionId),
  );
  const [pendingDccSelection, setPendingDccSelection] = useState<PendingDccSelectionState | null>(null);
  const [workflowSkillModalVisible, setWorkflowSkillModalVisible] = useState(false);
  const [draftExecutionSelection, setDraftExecutionSelection] = useState<SessionExecutionSelection>(
    EMPTY_SESSION_EXECUTION_SELECTION,
  );
  const draftWorkflowId = draftExecutionSelection.kind === "workflow"
    ? String(draftExecutionSelection.workflowId || "").trim()
    : "";
  const draftSkillIds = draftExecutionSelection.kind === "skill" && String(draftExecutionSelection.skillId || "").trim()
    ? [String(draftExecutionSelection.skillId || "").trim()]
    : [];
  const [availableSkills, setAvailableSkills] = useState<AgentSkillItem[]>([]);
  const [availableSkillsLoaded, setAvailableSkillsLoaded] = useState(false);

  useEffect(() => {
    setSessionCumulativeTokenUsage(resolveAgentSessionCumulativeTokenUsage(sessionId));
  }, [sessionId]);

  // 描述：
  //
  //   - 会话中的工作流选择器只展示“已注册”工作流，避免未注册内置模板直接出现在执行策略列表中。
  const workflows = useMemo<AgentWorkflowDefinition[]>(
    () => listAgentWorkflowOverview().registered,
    [],
  );
  // 描述：
  //
  //   - 缓存已注册工作流 ID 集合，供快速开始预设做严格注册校验，避免落到其他默认工作流。
  const registeredWorkflowIdSet = useMemo(
    () => new Set(workflows.map((item) => item.id)),
    [workflows],
  );
  const selectedWorkflow = useMemo<AgentWorkflowDefinition | null>(() => {
    if (executionSelection.kind !== "workflow") {
      return null;
    }
    return getAgentWorkflowById(selectedWorkflowId) || workflows.find((item) => item.id === selectedWorkflowId) || workflows[0] || null;
  }, [executionSelection.kind, workflows, selectedWorkflowId]);
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
  // 描述：
  //
  //   - 缓存已注册技能 ID 集合，供快速开始预设判断技能是否已真正安装可用。
  const registeredSkillIdSet = useMemo(
    () => new Set(availableSkills.map((item) => item.id)),
    [availableSkills],
  );
  const sessionQuickStartPresets = useMemo<SessionQuickStartPreset[]>(
    () => [
      {
        id: "quick-code",
        title: t("前端项目开发"),
        description: t("默认切到前端项目开发工作流，并填入代码任务草稿。"),
        prompt: t("请先分析当前项目结构，再根据我的需求修改代码并补齐测试。"),
        workflowId: QUICK_START_CODE_WORKFLOW_ID,
      },
      {
        id: "quick-modeling",
        title: t("建模"),
        description: t("默认启用建模技能，并填入建模任务草稿。"),
        prompt: t("请先确认本次建模要使用的软件、目标对象和交付格式，再开始执行。"),
        skillIds: [DCC_MODELING_SKILL_ID],
      },
    ],
    [t],
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
  // 描述：按 Provider 解析当前默认模型名，供会话级 AI 配置在切换 Provider 时自动回填。
  //
  // Params:
  //
  //   - provider: Provider 标识。
  //
  // Returns:
  //
  //   - 当前 Provider 在 AI Key 中保存的默认模型名；不存在时返回空字符串。
  const resolveProviderDefaultModelName = useCallback(
    (provider: string) => {
      if (!isAiProvider(provider)) {
        return "";
      }
      const storedModelName = String(
        availableAiKeys.find((item) => item.provider === provider)?.modelName || "",
      ).trim();
      return storedModelName || resolveAiProviderDefaultModel(provider);
    },
    [availableAiKeys],
  );
  // 描述：按 Provider 解析当前默认模式名，供会话级 AI 配置在切换 Provider 时自动回填。
  //
  // Params:
  //
  //   - provider: Provider 标识。
  //
  // Returns:
  //
  //   - 当前 Provider 在 AI Key 中保存的默认模式名；不存在时返回空字符串。
  const resolveProviderDefaultModeName = useCallback(
    (provider: string) => {
      if (!isAiProvider(provider)) {
        return "";
      }
      const storedModeName = String(
        availableAiKeys.find((item) => item.provider === provider)?.modeName || "",
      ).trim();
      return storedModeName || resolveAiProviderDefaultMode(provider);
    },
    [availableAiKeys],
  );
  // 描述：判断当前 Provider 是否支持会话级模型配置。
  //
  // Params:
  //
  //   - provider: Provider 标识。
  //
  // Returns:
  //
  //   - true: 当前 Provider 支持模型配置。
  const supportsProviderModelConfig = useCallback(
    (provider: string) => isAiProvider(provider) && supportsAiProviderModelSelection(provider),
    [],
  );
  // 描述：判断当前 Provider 是否支持会话级模式配置。
  //
  // Params:
  //
  //   - provider: Provider 标识。
  //
  // Returns:
  //
  //   - true: 当前 Provider 支持模式配置。
  const supportsProviderModeConfig = useCallback(
    (provider: string) => isAiProvider(provider) && supportsAiProviderModeSelection(provider),
    [],
  );
  // 描述：按 Provider 生成模型下拉选项，并补回历史自定义值。
  //
  // Params:
  //
  //   - provider: Provider 标识。
  //   - currentValue: 当前模型值。
  //
  // Returns:
  //
  //   - 可直接传入 AriSelect 的模型选项。
  const resolveProviderModelSelectOptions = useCallback(
    (provider: string, currentValue: string) => {
      if (!isAiProvider(provider)) {
        return [];
      }
      return mergeAiProviderSelectOptions(
        resolveAiProviderModelOptions(provider),
        currentValue,
      );
    },
    [],
  );
  // 描述：按 Provider 生成模式下拉选项，并补回历史自定义值。
  //
  // Params:
  //
  //   - provider: Provider 标识。
  //   - currentValue: 当前模式值。
  //
  // Returns:
  //
  //   - 可直接传入 AriSelect 的模式选项。
  const resolveProviderModeSelectOptions = useCallback(
    (provider: string, currentValue: string) => {
      if (!isAiProvider(provider)) {
        return [];
      }
      return mergeAiProviderSelectOptions(
        resolveAiProviderModeOptions(provider),
        resolveAiProviderModeSelectValue(provider, currentValue),
      );
    },
    [],
  );
  const workflowSkillSelectorLabel = useMemo(() => {
    if (selectedSessionSkills.length > 0) {
      return selectedSessionSkills[0]?.title || t("技能");
    }
    if (executionSelection.kind === "workflow") {
      return selectedWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel;
    }
    return t("不使用流程");
  }, [
    executionSelection.kind,
    t,
    resolvedSessionUiConfig.workflowFallbackLabel,
    selectedWorkflow?.name,
    selectedSessionSkills,
  ]);
  // 描述：
  //
  //   - 应用快速开始预设：为当前空会话切换默认工作流/技能，并写入一段可继续编辑的输入草稿。
  //
  // Params:
  //
  //   - preset: 目标快速开始预设。
  const handleApplyQuickStartPreset = useCallback((preset: SessionQuickStartPreset) => {
    const nextSkillIds = Array.isArray(preset.skillIds)
      ? preset.skillIds
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0)
      : [];
    const nextWorkflowId = String(preset.workflowId || "").trim();
    // 描述：
    //
    //   - 快速开始预设必须严格依赖自身声明的工作流或技能；缺失时只提示，不回退到其他默认策略。
    if (nextSkillIds.length > 0) {
      if (!availableSkillsLoaded) {
        const message = t("技能列表加载中...");
        AriMessage.warning({
          content: message,
          duration: 1800,
        });
        setStatus(message);
        return;
      }
      const missingSkillIds = nextSkillIds.filter((item) => !registeredSkillIdSet.has(item));
      if (missingSkillIds.length > 0) {
        const message = t("当前未注册“{{title}}”所需技能，请先注册后再试。", { title: preset.title });
        AriMessage.warning({
          content: message,
          duration: 2200,
        });
        setStatus(message);
        return;
      }
      setExecutionSelection(buildSkillExecutionSelection(nextSkillIds));
    } else {
      if (!nextWorkflowId || !registeredWorkflowIdSet.has(nextWorkflowId)) {
        const message = t("当前未注册“{{title}}”所需工作流，请先注册后再试。", { title: preset.title });
        AriMessage.warning({
          content: message,
          duration: 2200,
        });
        setStatus(message);
        return;
      }
      setExecutionSelection(buildWorkflowExecutionSelection(nextWorkflowId));
    }
    setInput(preset.prompt);
    setStatus(t("已选择“{{title}}”预设，可继续补充需求后发送。", { title: preset.title }));
  }, [availableSkillsLoaded, registeredSkillIdSet, registeredWorkflowIdSet, t]);
  // 描述：
  //
  //   - 为快速开始卡片补充键盘触发能力，确保整卡点击交互在键盘场景下也可用。
  //
  // Params:
  //
  //   - event: 卡片键盘事件。
  //   - preset: 目标快速开始预设。
  const handleQuickStartPresetCardKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLElement>,
    preset: SessionQuickStartPreset,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    handleApplyQuickStartPreset(preset);
  }, [handleApplyQuickStartPreset]);
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

  // 描述：以下 refs 始终指向最新的执行策略与会话上下文，确保用户中途切换后，下一条消息立即按当前选择路由。
  const executionSelectionRef = useRef<SessionExecutionSelection>(executionSelection);
  const selectedWorkflowRef = useRef<AgentWorkflowDefinition | null>(selectedWorkflow);
  const activeSelectedSkillIdsRef = useRef<string[]>(activeSelectedSkillIds);
  const availableSkillsRef = useRef<AgentSkillItem[]>(availableSkills);

  executionSelectionRef.current = executionSelection;
  selectedWorkflowRef.current = selectedWorkflow;
  activeSelectedSkillIdsRef.current = activeSelectedSkillIds;
  availableSkillsRef.current = availableSkills;

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
  const agentContextMessagesRef = useRef<MessageItem[]>([]);
  const sessionMemoryInFlightMessageIdSetRef = useRef<Set<string>>(new Set());
  const sendingRef = useRef(false);
  const sessionApprovedToolNameSetRef = useRef<Set<string>>(new Set());
  const workflowPhaseCursorRef = useRef<SessionWorkflowPhaseCursorSnapshot | null>(null);

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

  // 描述：设置当前流式消息目标文本，并按需触发逐帧渲染或立即更新。
  const setStreamingAssistantTarget = (
    targetText: string,
    options?: StreamingAssistantTargetOptions,
  ) => {
    const messageId = streamMessageIdRef.current;
    if (!messageId) {
      return;
    }
    streamLatestTextRef.current = targetText;
    if (options?.immediate) {
      stopStreamTypingTimer();
      streamDisplayedTextRef.current = targetText;
      setMessages((prev) => upsertAssistantMessageById(prev, messageId, targetText));
      return;
    }
    if (streamRenderPendingRef.current) {
      return;
    }
    streamRenderPendingRef.current = true;
    streamRenderFrameRef.current = window.requestAnimationFrame(renderStreamingAssistantFrame);
  };

  // 描述：更新当前运行消息的状态指示文案；该文案只进入运行态 summary，
  //   - 不直接覆盖助手正文，避免 heartbeat / planning 把已经输出的正文重新抹掉。
  //
  // Params:
  //
  //   - targetText: 当前运行状态文案。
  const setStreamingAssistantStatusTarget = (targetText: string) => {
    const messageId = String(streamMessageIdRef.current || "").trim();
    const normalizedTargetText = String(targetText || "").trim();
    if (!messageId || !normalizedTargetText) {
      return;
    }
    setAssistantRunMetaMap((prev) => {
      const current = prev[messageId];
      if (!current || current.status !== "running") {
        return prev;
      }
      if (String(current.summary || "").trim() === normalizedTargetText) {
        return prev;
      }
      return {
        ...prev,
        [messageId]: {
          ...current,
          summary: normalizedTargetText,
          summarySource: undefined,
        },
      };
    });
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
      const shouldResolvePendingInteractiveSegment = incomingSegmentKind === STREAM_KINDS.TOOL_CALL_FINISHED
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
      const isCancellationLikeError = incomingSegmentKind === STREAM_KINDS.ERROR
        && isCancelErrorCode(incomingErrorCode);
      const hasPendingInteractiveSegment = baseSegments.some(
        (item) => item.status === "running" && (isApprovalPendingSegment(item) || isUserInputPendingSegment(item)),
      );
      if (hasPendingInteractiveSegment && incomingSegmentKind === STREAM_KINDS.HEARTBEAT) {
        return prev;
      }
      const normalizedSegments = baseSegments.map((item) => {
        if (item.status !== "running") {
          return item;
        }
        if (!isApprovalPendingSegment(item) && !isUserInputPendingSegment(item)) {
          return { ...item, status: "finished" as const };
        }
        if (isApprovalPendingSegment(item)) {
          if (!shouldResolvePendingInteractiveSegment) {
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
        }
        if (!isUserInputPendingSegment(item) || !shouldResolvePendingInteractiveSegment) {
          return item;
        }
        const stepData = item.data && typeof item.data === "object" ? item.data : {};
        const questionCount = resolveUserInputQuestionCount(stepData);
        const ignoredStepText = t("已询问 {{count}} 个问题（已忽略）", {
          count: questionCount,
        });
        if (incomingSegmentKind === STREAM_KINDS.CANCELLED || isCancellationLikeError) {
          return {
            ...item,
            status: "finished" as const,
            step: ignoredStepText,
            data: {
              ...stepData,
              __step_type: "user_input_request",
              resolution: "ignored",
              answers: [],
            },
          };
        }
        return {
          ...item,
          status: "finished" as const,
          step: ignoredStepText,
          data: {
            ...stepData,
            __step_type: "user_input_request",
            resolution: "ignored",
            answers: [],
          },
        };
      });
      const nextRunMetaMap = {
        ...prev,
        [messageId]: {
          ...current,
          segments: normalizeAssistantRunSegments([...normalizedSegments, segment]),
        },
      };
      assistantRunMetaMapRef.current = nextRunMetaMap;
      return nextRunMetaMap;
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
  //   - 同步 agent 上下文 ref，供页面切走或重试时立即复用独立上下文，不受 UI transcript 结构影响。
  useEffect(() => {
    agentContextMessagesRef.current = agentContextMessages;
  }, [agentContextMessages]);

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

  // 描述：
  //
  //   - 同步工作流阶段游标到 ref，供重试和运行态持久化读取最新阶段位置。
  useEffect(() => {
    workflowPhaseCursorRef.current = workflowPhaseCursor;
  }, [workflowPhaseCursor]);

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
        setStreamingAssistantStatusTarget(
          String(heartbeatSegment.intro || "").trim() || t("智能体正在思考…"),
        );
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
    summarySource?: AssistantRunMeta["summarySource"],
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
          summarySource,
        },
      };
    });
  };

  // 描述：判断当前工作流是否仍有后续阶段待执行，供流式 FINAL 事件决定是否保持同一条消息继续运行。
  //
  // Returns:
  //
  //   - true: 当前仅完成了中间阶段，消息应继续保持 running。
  const hasPendingWorkflowStages = () => {
    const currentWorkflowPhaseCursor = workflowPhaseCursorRef.current;
    if (!currentWorkflowPhaseCursor) {
      return false;
    }
    return currentWorkflowPhaseCursor.totalStageCount > 0
      && currentWorkflowPhaseCursor.currentStageIndex + 1 < currentWorkflowPhaseCursor.totalStageCount;
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

  // 描述：向会话调用记录追加一条结构化轨迹，保证复制排查时可以完整回放。
  //
  // Params:
  //
  //   - record: 待追加的调用记录。
  const appendSessionCallRecord = (record: SessionCallRecordSnapshot) => {
    setSessionCallRecords((prev) => [...prev, record]);
  };

  // 描述：把智能体文本流事件压缩为可导出的调用记录，保证执行中的阶段状态也能进入“执行过程”导出。
  //
  // Params:
  //
  //   - payload: 当前文本流事件。
  //   - messageId: 当前执行消息 ID。
  //
  // Returns:
  //
  //   - 可持久化的调用记录；若当前事件不适合导出则返回 null。
  const buildAgentTextStreamCallRecord = (
    payload: AgentTextStreamEvent,
    messageId: string,
  ): SessionCallRecordSnapshot | null => {
    const kind = String(payload.kind || "").trim();
    if (!kind || kind === STREAM_KINDS.DELTA || kind === STREAM_KINDS.FINISHED) {
      return null;
    }

    const planningText = kind === STREAM_KINDS.PLANNING
      ? resolvePlanningDisplayText(payload)
      : "";
    const normalizedMessageId = String(messageId || "").trim();
    const normalizedTraceId = String(payload.trace_id || activeAgentStreamTraceRef.current || "").trim();
    const nextPayload: Record<string, unknown> = {
      event: kind,
      stream_stage: resolveAssistantRunStageByAgentTextStream(payload),
    };
    const eventMessage = String(payload.message || "").trim();
    if (eventMessage) {
      nextPayload.message = eventMessage;
    }
    if (planningText) {
      nextPayload.display_message = planningText;
    }
    if (payload.data && typeof payload.data === "object") {
      nextPayload.data = payload.data as Record<string, unknown>;
    }
    return {
      id: `call-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "stream_event",
      timestamp: Date.now(),
      messageId: normalizedMessageId || undefined,
      traceId: normalizedTraceId || undefined,
      payload: nextPayload,
    };
  };

  // 描述：读取当前工作流阶段标题，供 AI 原始收发轮次写入 stageTitle 元信息。
  //
  // Returns:
  //
  //   - 当前阶段标题；无工作流上下文时返回空字符串。
  const resolveCurrentAiRawStageTitle = () => String(workflowPhaseCursorRef.current?.currentNodeTitle || "").trim();

  // 描述：向指定助手消息追加一轮 AI 原始收发记录；若命中同一轮次键，则原位补齐而不是覆盖历史。
  //
  // Params:
  //
  //   - messageId: 助手消息 ID。
  //   - exchange: 待追加的原始收发记录。
  const appendSessionAiRawExchange = (
    messageId: string,
    exchange: Partial<SessionAiRawExchangeItem>,
  ) => {
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedMessageId) {
      return;
    }
    const normalizedExchange = normalizeSessionAiRawExchangeItem(exchange);
    if (!normalizedExchange) {
      return;
    }
    setSessionAiRawByMessage((prev) => {
      const current = buildSessionAiRawByMessageItem(prev[normalizedMessageId]);
      return {
        ...prev,
        [normalizedMessageId]: buildSessionAiRawByMessageItem({
          promptRaw: normalizedExchange.requestRaw || current.promptRaw,
          responseRaw: normalizedExchange.responseRaw || current.responseRaw,
          exchanges: appendSessionAiRawExchangeItem(current.exchanges, normalizedExchange),
        }),
      };
    });
  };

  // 描述：更新指定助手消息中最近一条匹配轮次的 AI 原始收发记录；用于流式 patch / finalize 当前进行中的一轮。
  //
  // Params:
  //
  //   - messageId: 助手消息 ID。
  //   - exchange: 待回填的原始收发补丁。
  //   - options: 匹配范围与缺失时是否追加。
  const patchLatestSessionAiRawExchange = (
    messageId: string,
    exchange: Partial<SessionAiRawExchangeItem>,
    options?: {
      traceId?: string;
      stepCode?: string;
      appendIfMissing?: boolean;
    },
  ) => {
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedMessageId) {
      return;
    }
    const normalizedExchange = normalizeSessionAiRawExchangeItem(exchange);
    if (!normalizedExchange) {
      return;
    }
    const normalizedTraceId = String(options?.traceId || "").trim();
    const normalizedStepCode = String(options?.stepCode || "").trim();
    setSessionAiRawByMessage((prev) => {
      const current = buildSessionAiRawByMessageItem(prev[normalizedMessageId]);
      const nextExchanges = [...current.exchanges];
      let matchedIndex = -1;
      for (let index = nextExchanges.length - 1; index >= 0; index -= 1) {
        const item = nextExchanges[index];
        const itemTraceId = String(item.traceId || "").trim();
        const itemStepCode = String(item.stepCode || "").trim();
        if (normalizedTraceId && itemTraceId && itemTraceId !== normalizedTraceId) {
          continue;
        }
        if (normalizedStepCode && itemStepCode && itemStepCode !== normalizedStepCode) {
          continue;
        }
        if (!normalizedTraceId && !normalizedStepCode && item.status !== "running") {
          continue;
        }
        matchedIndex = index;
        break;
      }
      if (matchedIndex < 0) {
        if (!options?.appendIfMissing) {
          return prev;
        }
        return {
          ...prev,
          [normalizedMessageId]: buildSessionAiRawByMessageItem({
            promptRaw: normalizedExchange.requestRaw || current.promptRaw,
            responseRaw: normalizedExchange.responseRaw || current.responseRaw,
            exchanges: appendSessionAiRawExchangeItem(current.exchanges, normalizedExchange),
          }),
        };
      }
      nextExchanges[matchedIndex] = mergeSessionAiRawExchangeItem(nextExchanges[matchedIndex], normalizedExchange);
      return {
        ...prev,
        [normalizedMessageId]: buildSessionAiRawByMessageItem({
          promptRaw: normalizedExchange.requestRaw || current.promptRaw,
          responseRaw: normalizedExchange.responseRaw || current.responseRaw,
          exchanges: nextExchanges,
        }),
      };
    });
  };

  // 描述：把某个 trace 内已经完成的 AI 往返回填到消息级累计列表，保持历史阶段顺序不变。
  //
  // Params:
  //
  //   - messageId: 助手消息 ID。
  //   - traceId: 当前阶段 trace。
  //   - exchanges: 当前阶段新完成的往返列表。
  //   - promptRaw: 当前阶段最新请求原文。
  //   - responseRaw: 当前阶段最新响应原文。
  const mergeSessionAiRawExchangesForTrace = (
    messageId: string,
    traceId: string,
    exchanges: SessionAiRawExchangeItem[],
    promptRaw: string,
    responseRaw: string,
  ) => {
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedMessageId || exchanges.length === 0) {
      return;
    }
    setSessionAiRawByMessage((prev) => {
      const current = buildSessionAiRawByMessageItem(prev[normalizedMessageId]);
      return {
        ...prev,
        [normalizedMessageId]: buildSessionAiRawByMessageItem({
          promptRaw: promptRaw || current.promptRaw,
          responseRaw: responseRaw || current.responseRaw,
          exchanges: mergeSessionAiRawExchangeItemsByTrace(current.exchanges, exchanges, traceId),
        }),
      };
    });
  };

  const appendTraceRecord = (input: TraceRecord) => {
    setTraceRecords((prev) => [input, ...prev]);
    appendSessionCallRecord({
      id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "trace",
      payload: {
        traceId: input.traceId,
        source: input.source,
        code: input.code,
        message: input.message,
      },
    });
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
    const debugRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source,
      stage,
      title,
      detail: normalizedDetail,
      timestamp: Date.now(),
    } as const;
    setDebugFlowRecords((prev) => [
      debugRecord,
      ...prev,
    ]);
    appendSessionCallRecord({
      id: `call-debug-${debugRecord.id}`,
      kind: "debug_flow",
      timestamp: debugRecord.timestamp,
      payload: {
        source: debugRecord.source,
        stage: debugRecord.stage,
        title: debugRecord.title,
        detail: debugRecord.detail,
      },
    });
  };

  // 描述：在顶层助手轮次完成后异步提炼单会话长期记忆；失败时只记录调试信息，不打断主交付链路。
  //
  // Params:
  //
  //   - messageId: 当前助手消息 ID。
  //   - userPrompt: 本轮用户请求。
  //   - assistantReply: 本轮最终助手回复。
  //   - turnDigest: 本轮执行摘要或动作摘要。
  const requestSessionMemoryExtraction = async (
    messageId: string,
    userPrompt: string,
    assistantReply: string,
    turnDigest?: string,
  ): Promise<void> => {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedMessageId = String(messageId || "").trim();
    const normalizedUserPrompt = String(userPrompt || "").trim();
    const normalizedAssistantReply = String(assistantReply || "").trim();
    if (!normalizedSessionId || !normalizedMessageId || !normalizedUserPrompt || !normalizedAssistantReply) {
      return;
    }
    const currentMemory = sessionMemoryRef.current;
    if (String(currentMemory?.lastProcessedMessageId || "").trim() === normalizedMessageId) {
      return;
    }
    if (sessionMemoryInFlightMessageIdSetRef.current.has(normalizedMessageId)) {
      return;
    }
    sessionMemoryInFlightMessageIdSetRef.current.add(normalizedMessageId);

    const provider = selectedAi?.provider || "codex";
    const providerApiKey = provider === "codex" || provider === "gemini-cli"
      ? undefined
      : String(selectedAi?.keyValue || "").trim() || undefined;
    const providerModel = supportsProviderModelConfig(provider)
      ? String(selectedModelName || "").trim() || undefined
      : undefined;
    const providerMode = supportsProviderModeConfig(provider)
      ? String(selectedModeName || "").trim() || undefined
      : undefined;
    const memoryPrompt = buildSessionMemoryExtractionPrompt(
      currentMemory,
      normalizedUserPrompt,
      normalizedAssistantReply,
      turnDigest,
    );
    const memoryTraceId = `session-memory-${normalizedMessageId}`;
    const requestTimestamp = Date.now();
    appendSessionCallRecord({
      id: `call-memory-request-${requestTimestamp}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "memory_request",
      timestamp: requestTimestamp,
      messageId: normalizedMessageId,
      traceId: memoryTraceId,
      payload: {
        provider,
        provider_model: providerModel || "",
        provider_mode: providerMode || "",
        prompt: memoryPrompt,
      },
    });
    appendDebugFlowRecord("ui", "ai_memory_prompt", t("会话记忆 Prompt"), memoryPrompt);
    appendSessionAiRawExchange(normalizedMessageId, {
      requestRaw: memoryPrompt,
      responseRaw: "",
      stepCode: "ai_session_memory",
      stepSummary: t("会话记忆"),
      status: "running",
      traceId: memoryTraceId,
      stageTitle: resolveCurrentAiRawStageTitle(),
      capturedAt: requestTimestamp,
    });

    try {
      const response = await invoke<AgentSummaryResponse>(COMMANDS.CALL_AI_MEMORY_COMMAND, {
        provider,
        providerApiKey,
        providerModel,
        providerMode,
        prompt: memoryPrompt,
        workdir: String(activeWorkspace?.path || "").trim() || undefined,
      });
      const responseText = String(response.content || "").trim();
      const responseTimestamp = Date.now();
      const totalTokens = Number(response.usage?.total_tokens || 0);
      appendSessionCallRecord({
        id: `call-memory-response-${responseTimestamp}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "memory_response",
        timestamp: responseTimestamp,
        messageId: normalizedMessageId,
        traceId: memoryTraceId,
        payload: {
          content: responseText,
          usage: response.usage || null,
        },
      });
      appendDebugFlowRecord(
        "ui",
        "ai_memory_raw",
        t("会话记忆原始返回"),
        JSON.stringify(
          {
            content: responseText,
            usage: response.usage || null,
          },
          null,
          2,
        ),
      );
      if (normalizedSessionId && Number.isFinite(totalTokens) && totalTokens > 0) {
        setSessionCumulativeTokenUsage(
          increaseAgentSessionCumulativeTokenUsage(normalizedSessionId, totalTokens),
        );
      }
      patchLatestSessionAiRawExchange(
        normalizedMessageId,
        {
          requestRaw: memoryPrompt,
          responseRaw: responseText,
          stepCode: "ai_session_memory",
          stepSummary: t("会话记忆"),
          status: "finished",
          traceId: memoryTraceId,
          stageTitle: resolveCurrentAiRawStageTitle(),
          capturedAt: responseTimestamp,
        },
        {
          traceId: memoryTraceId,
          stepCode: "ai_session_memory",
          appendIfMissing: true,
        },
      );

      const parsedPayload = parseSessionMemoryModelPayload(responseText);
      if (!parsedPayload) {
        appendDebugFlowRecord(
          "ui",
          "ai_memory_parse_failed",
          t("会话记忆提炼失败"),
          JSON.stringify(
            {
              message: "memory payload is not valid json",
              content: responseText,
            },
            null,
            2,
          ),
        );
        return;
      }

      const nextMemory = buildNextSessionMemorySnapshot(
        normalizedAgentKey,
        normalizedSessionId,
        normalizedMessageId,
        currentMemory,
        parsedPayload,
      );
      upsertSessionMemory(nextMemory);
      sessionMemoryRef.current = nextMemory;
      setSessionMemory(nextMemory);
      appendDebugFlowRecord(
        "ui",
        "ai_memory_snapshot",
        t("会话记忆更新"),
        JSON.stringify(nextMemory, null, 2),
      );
    } catch (error) {
      const reason = normalizeInvokeError(error);
      const errorTimestamp = Date.now();
      appendSessionCallRecord({
        id: `call-memory-error-${errorTimestamp}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "memory_error",
        timestamp: errorTimestamp,
        messageId: normalizedMessageId,
        traceId: memoryTraceId,
        payload: {
          message: reason,
        },
      });
      appendDebugFlowRecord(
        "ui",
        "ai_memory_error",
        t("会话记忆提炼失败"),
        JSON.stringify(
          {
            message: reason,
          },
          null,
          2,
        ),
      );
      patchLatestSessionAiRawExchange(
        normalizedMessageId,
        {
          requestRaw: memoryPrompt,
          responseRaw: reason,
          stepCode: "ai_session_memory",
          stepSummary: t("会话记忆"),
          status: "failed",
          traceId: memoryTraceId,
          stageTitle: resolveCurrentAiRawStageTitle(),
          capturedAt: errorTimestamp,
        },
        {
          traceId: memoryTraceId,
          stepCode: "ai_session_memory",
          appendIfMissing: true,
        },
      );
    } finally {
      sessionMemoryInFlightMessageIdSetRef.current.delete(normalizedMessageId);
    }
  };

  // 描述：请求工作流最终 AI 总结；该总结必须来自真实模型响应，缺失时保持为空，不再用前端拼接结果冒充。
  //
  // Params:
  //
  //   - messageId: 当前助手消息 ID。
  //   - traceId: 当前执行链路 Trace ID。
  //   - workflowName: 工作流名称。
  //   - stageSummaryDigest: 阶段摘要文本。
  //   - contextMessages: 当前上下文消息列表。
  //   - actionText: 动作摘要。
  //   - exportedFile: 导出文件路径。
  //
  // Returns:
  //
  //   - 总结文本、来源与更新后的上下文消息。
  const requestWorkflowExecutionSummary = async (
    messageId: string,
    traceId: string,
    workflowName: string,
    stageSummaryDigest: string,
    contextMessages: MessageItem[],
    actionText: string,
    exportedFile?: string,
  ): Promise<{
    summary: string;
    summarySource?: AssistantRunMeta["summarySource"];
    contextMessages: MessageItem[];
  }> => {
    const normalizedMessageId = String(messageId || "").trim();
    const normalizedDigest = String(stageSummaryDigest || "").trim();
    if (!normalizedMessageId || !normalizedDigest) {
      return {
        summary: "",
        summarySource: undefined,
        contextMessages,
      };
    }

    const provider = selectedAi?.provider || "codex";
    const providerApiKey = provider === "codex" || provider === "gemini-cli"
      ? undefined
      : String(selectedAi?.keyValue || "").trim() || undefined;
    const providerModel = supportsProviderModelConfig(provider)
      ? String(selectedModelName || "").trim() || undefined
      : undefined;
    const providerMode = supportsProviderModeConfig(provider)
      ? String(selectedModeName || "").trim() || undefined
      : undefined;
    const summaryPrompt = buildWorkflowExecutionSummaryPrompt(
      workflowName,
      normalizedDigest,
      actionText,
      exportedFile,
    );
    const requestTimestamp = Date.now();

    clearAssistantRunHeartbeatTimer();
    assistantRunLastActivityAtRef.current = requestTimestamp;
    appendSessionCallRecord({
      id: `call-summary-request-${requestTimestamp}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "summary_request",
      timestamp: requestTimestamp,
      messageId: normalizedMessageId,
      traceId,
      payload: {
        workflow_name: workflowName,
        provider,
        provider_model: providerModel || "",
        provider_mode: providerMode || "",
        prompt: summaryPrompt,
      },
    });
    appendDebugFlowRecord("ui", "ai_summary_prompt", t("执行总结 Prompt"), summaryPrompt);
    appendSessionAiRawExchange(normalizedMessageId, {
      requestRaw: summaryPrompt,
      responseRaw: "",
      stepCode: "ai_execution_summary",
      stepSummary: t("执行总结"),
      status: "running",
      traceId,
      stageTitle: resolveCurrentAiRawStageTitle(),
      capturedAt: requestTimestamp,
    });

    try {
      const summaryResponse = await invoke<AgentSummaryResponse>(COMMANDS.CALL_AI_SUMMARY_COMMAND, {
        provider,
        providerApiKey,
        providerModel,
        providerMode,
        prompt: summaryPrompt,
        workdir: String(activeWorkspace?.path || "").trim() || undefined,
      });
      const summaryText = String(summaryResponse.content || "").trim();
      const responseTimestamp = Date.now();
      const totalTokens = Number(summaryResponse.usage?.total_tokens || 0);
      appendSessionCallRecord({
        id: `call-summary-response-${responseTimestamp}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "summary_response",
        timestamp: responseTimestamp,
        messageId: normalizedMessageId,
        traceId,
        payload: {
          content: summaryText,
          usage: summaryResponse.usage || null,
        },
      });
      appendDebugFlowRecord(
        "ui",
        "ai_summary_raw",
        t("执行总结原始返回"),
        JSON.stringify(
          {
            content: summaryText,
            usage: summaryResponse.usage || null,
          },
          null,
          2,
        ),
      );
      if (sessionId && Number.isFinite(totalTokens) && totalTokens > 0) {
        setSessionCumulativeTokenUsage(
          increaseAgentSessionCumulativeTokenUsage(sessionId, totalTokens),
        );
      }

      setSessionAiPromptRaw(summaryPrompt);
      setSessionAiResponseRaw(summaryText);
      patchLatestSessionAiRawExchange(
        normalizedMessageId,
        {
          requestRaw: summaryPrompt,
          responseRaw: summaryText,
          stepCode: "ai_execution_summary",
          stepSummary: t("执行总结"),
          status: "finished",
          traceId,
          stageTitle: resolveCurrentAiRawStageTitle(),
          capturedAt: responseTimestamp,
        },
        {
          traceId,
          stepCode: "ai_execution_summary",
          appendIfMissing: true,
        },
      );

      if (!summaryText) {
        return {
          summary: "",
          summarySource: undefined,
          contextMessages,
        };
      }

      if (streamMessageIdRef.current === normalizedMessageId) {
        setStreamingAssistantTarget(summaryText, { immediate: true });
      } else {
        setMessages((prev) => upsertAssistantMessageById(prev, normalizedMessageId, summaryText));
      }
      const summarizedContextMessages = upsertAssistantMessageById(
        contextMessages,
        normalizedMessageId,
        summaryText,
      );
      setAgentContextMessages(summarizedContextMessages);
      return {
        summary: summaryText,
        summarySource: "ai",
        contextMessages: summarizedContextMessages,
      };
    } catch (error) {
      const reason = normalizeInvokeError(error);
      const errorTimestamp = Date.now();
      appendSessionCallRecord({
        id: `call-summary-error-${errorTimestamp}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "summary_error",
        timestamp: errorTimestamp,
        messageId: normalizedMessageId,
        traceId,
        payload: {
          message: reason,
        },
      });
      appendDebugFlowRecord(
        "ui",
        "ai_summary_error",
        t("执行总结失败"),
        JSON.stringify(
          {
            message: reason,
          },
          null,
          2,
        ),
      );
      patchLatestSessionAiRawExchange(
        normalizedMessageId,
        {
          requestRaw: summaryPrompt,
          responseRaw: reason,
          stepCode: "ai_execution_summary",
          stepSummary: t("执行总结"),
          status: "failed",
          traceId,
          stageTitle: resolveCurrentAiRawStageTitle(),
          capturedAt: errorTimestamp,
        },
        {
          traceId,
          stepCode: "ai_execution_summary",
          appendIfMissing: true,
        },
      );
      return {
        summary: "",
        summarySource: undefined,
        contextMessages,
      };
    }
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
    sessionMemoryInFlightMessageIdSetRef.current.clear();
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
    workflowPhaseCursorRef.current = null;
    setWorkflowPhaseCursor(null);
    setExpandedRunSegmentDetailMap({});
    setSessionAiPromptRaw("");
    setSessionAiResponseRaw("");
    setSessionAiRawByMessage({});
    setSessionCallRecords([]);
    setSending(false);
    setPendingDangerousPrompt("");
    setPendingDangerousToken("");
    if (!sessionId) {
      // 描述：新建会话时不注入默认欢迎语，仅保留空线程与输入框。
      setMessages([]);
      setAgentContextMessages([]);
      setSessionMemory(null);
      setMessagesHydrated(true);
      setHydratedSessionKey(sessionStorageKey);
      return;
    }
    const stored = filterWorkflowStageContextMessages(
      getSessionMessages(normalizedAgentKey, sessionId),
    );
    const storedAgentContext = getSessionAgentContextMessages(normalizedAgentKey, sessionId);
    const storedSessionMemory = getSessionMemory(normalizedAgentKey, sessionId);
    const debugArtifact = getSessionDebugArtifact(normalizedAgentKey, sessionId);
    const runSnapshot = getSessionRunState(normalizedAgentKey, sessionId);
    const restoredSessionApprovedToolNames = Array.isArray(runSnapshot?.sessionApprovedToolNames)
      ? runSnapshot?.sessionApprovedToolNames
        .map((toolName) => normalizeApprovalToolName(String(toolName || "")))
        .filter((toolName) => Boolean(toolName))
      : [];
    const restoredWorkflowPhaseCursor = runSnapshot?.workflowPhaseCursor && typeof runSnapshot.workflowPhaseCursor === "object"
      ? {
        workflowId: String(runSnapshot.workflowPhaseCursor.workflowId || "").trim(),
        workflowName: String(runSnapshot.workflowPhaseCursor.workflowName || "").trim(),
        rootPrompt: String(runSnapshot.workflowPhaseCursor.rootPrompt || ""),
        currentStageIndex: Math.max(0, Number(runSnapshot.workflowPhaseCursor.currentStageIndex || 0)),
        totalStageCount: Math.max(0, Number(runSnapshot.workflowPhaseCursor.totalStageCount || 0)),
        currentNodeId: String(runSnapshot.workflowPhaseCursor.currentNodeId || "").trim(),
        currentNodeTitle: String(runSnapshot.workflowPhaseCursor.currentNodeTitle || "").trim(),
        currentMessageId: String(runSnapshot.workflowPhaseCursor.currentMessageId || "").trim(),
        updatedAt: Number(runSnapshot.workflowPhaseCursor.updatedAt || Date.now()),
      }
      : null;
    setSessionApprovedToolNames(Array.from(new Set(restoredSessionApprovedToolNames)));
    workflowPhaseCursorRef.current = restoredWorkflowPhaseCursor;
    setWorkflowPhaseCursor(restoredWorkflowPhaseCursor);
    let nextMessages: MessageItem[] = stored.length > 0 ? stored : [];
    let normalizedRunMetaMap: Record<string, AssistantRunMeta> = {};
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
              buildSessionAiRawByMessageItem({
                promptRaw: String(rawItem.promptRaw ?? ""),
                responseRaw: String(rawItem.responseRaw ?? ""),
                exchanges: Array.isArray(rawItem.exchanges)
                  ? rawItem.exchanges
                  : undefined,
              }),
            ] as const;
          })
          .filter((item): item is readonly [string, SessionAiRawByMessageItem] => Boolean(item)),
      );
      setSessionAiRawByMessage(artifactAiRawByMessage);
      setSessionCallRecords(Array.isArray(debugArtifact.callRecords) ? debugArtifact.callRecords : []);
      agentPromptRawRef.current = artifactPromptRaw;
      agentLlmResponseRawRef.current = artifactResponseRaw;
    }
    if (runSnapshot && runSnapshot.runMetaMap && Object.keys(runSnapshot.runMetaMap).length > 0) {
      normalizedRunMetaMap = Object.fromEntries(
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
    const nextAgentContextMessages = storedAgentContext.length > 0
      ? storedAgentContext
      : buildPromptContextMessages(nextMessages, normalizedRunMetaMap);
    setMessages(nextMessages);
    setAgentContextMessages(nextAgentContextMessages);
    setSessionMemory(storedSessionMemory);
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
        messages: filterWorkflowStageContextMessages(messagesRef.current),
      });
      upsertSessionAgentContextMessages({
        agentKey: normalizedAgentKey,
        sessionId,
        messages: agentContextMessagesRef.current,
      });
      const normalizedSessionApprovedToolNames = Array.from(new Set(
        Array.from(sessionApprovedToolNameSetRef.current.values())
          .map((toolName) => normalizeApprovalToolName(toolName))
          .filter((toolName) => Boolean(toolName)),
      ));
      if (
        Object.keys(assistantRunMetaMapRef.current).length === 0
        && normalizedSessionApprovedToolNames.length === 0
        && !workflowPhaseCursorRef.current
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
        workflowPhaseCursor: workflowPhaseCursorRef.current,
        updatedAt: Date.now(),
      });
    };
  }, [agentContextMessages, hydratedSessionKey, messagesHydrated, normalizedAgentKey, sessionId, sessionStorageKey]);

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
        messages: filterWorkflowStageContextMessages(messages),
      });
      upsertSessionAgentContextMessages({
        agentKey: normalizedAgentKey,
        sessionId,
        messages: agentContextMessages,
      });
    }, persistDelay);
    return () => {
      clearSessionMessagePersistTimer();
    };
  }, [agentContextMessages, messages, messagesHydrated, hydratedSessionKey, normalizedAgentKey, sending, sessionId, sessionStorageKey]);

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
    if (
      Object.keys(assistantRunMetaMap).length === 0
      && normalizedSessionApprovedToolNames.length === 0
      && !workflowPhaseCursor
    ) {
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
        workflowPhaseCursor,
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
    workflowPhaseCursor,
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
    );
    if (
      traceRecords.length === 0
      && debugFlowRecords.length === 0
      && !promptRaw
      && !responseRaw
      && Object.keys(sessionAiRawByMessage).length === 0
      && sessionCallRecords.length === 0
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
      callRecords: sessionCallRecords,
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
    sessionCallRecords,
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
    setSelectedModelName(resolveAgentSessionSelectedAiModel(sessionId));
    setSelectedModeName(resolveAgentSessionSelectedAiMode(sessionId));
  }, [sessionId]);

  // 描述：仅在当前会话尚未绑定 Provider 或绑定项失效时回退到首个可用 Provider；一旦完成回退即写回会话元数据，冻结该话题后续默认值。
  useEffect(() => {
    if (availableAiKeys.length === 0) {
      setSelectedProvider("");
      setSelectedModelName("");
      setSelectedModeName("");
      if (sessionId) {
        rememberAgentSessionSelectedAiProvider(sessionId, "");
        rememberAgentSessionSelectedAiModel(sessionId, "");
        rememberAgentSessionSelectedAiMode(sessionId, "");
      }
      return;
    }
    const normalizedProvider = String(selectedProvider || "").trim();
    if (normalizedProvider && availableAiKeys.some((item) => item.provider === normalizedProvider)) {
      return;
    }
    const nextProvider = String(availableAiKeys[0]?.provider || "").trim();
    applySessionAiSelection(nextProvider);
  }, [availableAiKeys, selectedProvider, sessionId]);

  // 描述：为旧会话补齐模型/模式初始值；仅在当前会话尚未存储覆盖值时回填，避免 AI Key 新字段接入后出现空白执行参数。
  useEffect(() => {
    const normalizedProvider = String(selectedProvider || "").trim();
    if (!normalizedProvider) {
      return;
    }
    const nextModelName = supportsProviderModelConfig(normalizedProvider)
      ? resolveProviderDefaultModelName(normalizedProvider)
      : "";
    const nextModeName = supportsProviderModeConfig(normalizedProvider)
      ? resolveProviderDefaultModeName(normalizedProvider)
      : "";
    if (supportsProviderModelConfig(normalizedProvider) && !String(selectedModelName || "").trim() && nextModelName) {
      setSelectedModelName(nextModelName);
      if (sessionId) {
        rememberAgentSessionSelectedAiModel(sessionId, nextModelName);
      }
    }
    if (supportsProviderModeConfig(normalizedProvider) && !String(selectedModeName || "").trim() && nextModeName) {
      setSelectedModeName(nextModeName);
      if (sessionId) {
        rememberAgentSessionSelectedAiMode(sessionId, nextModeName);
      }
    }
  }, [
    resolveProviderDefaultModelName,
    resolveProviderDefaultModeName,
    selectedModeName,
    selectedModelName,
    selectedProvider,
    sessionId,
    supportsProviderModelConfig,
    supportsProviderModeConfig,
  ]);

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
      } finally {
        if (disposed) {
          return;
        }
        setAvailableSkillsLoaded(true);
      }
    };
    void loadSkills();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (executionSelection.kind !== "workflow") {
      return;
    }
    if (!selectedWorkflow) {
      return;
    }
    if (selectedWorkflow.id !== selectedWorkflowId) {
      setSelectedWorkflowId(selectedWorkflow.id);
      return;
    }
  }, [executionSelection.kind, selectedWorkflow, selectedWorkflowId, setSelectedWorkflowId]);

  // 描述：
  //
  //   - 持久化会话级执行选择；新版本统一落到单一 selection 键，并同步清理旧工作流/技能本地键。
  useEffect(() => {
    writeSessionExecutionSelection(
      executionSelection,
      AGENT_EXECUTION_SELECTION_KEY,
      AGENT_WORKFLOW_SELECTED_KEY,
      AGENT_SKILL_SELECTED_KEY,
    );
  }, [executionSelection]);

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
        const streamCallRecord = buildAgentTextStreamCallRecord(payload, streamMessageIdRef.current);
        if (streamCallRecord) {
          appendSessionCallRecord(streamCallRecord);
        }
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
        if (payload.kind === STREAM_KINDS.TOOL_CALL_FINISHED) {
          const toolData = resolveToolCallEventData(payload);
          const toolName = String(toolData.name || "").trim();
          if (toolName === "request_user_input") {
            const resultData = toolData.result_data || {};
            const requestId = String(resultData.request_id || "").trim();
            const resolution = String(resultData.resolution || "").trim() === "ignored"
              ? "ignored"
              : "answered";
            const answers = Array.isArray(resultData.answers)
              ? resultData.answers
                .map((item) => normalizeUserInputAnswer(item))
                .filter((item): item is SharedAgentUserInputAnswer => Boolean(item))
              : [];
            if (requestId) {
              markUserInputSegmentResolved(requestId, resolution, answers);
            }
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
        setStreamingAssistantStatusTarget(t("正在准备执行..."));
        return;
      }
      if (payload.kind === STREAM_KINDS.LLM_STARTED) {
        agentLlmDeltaBufferRef.current = "";
        setSessionAiResponseRaw("");
        setStreamingAssistantStatusTarget(t("正在生成执行结果…"));
        return;
      }
      if (payload.kind === STREAM_KINDS.LLM_FINISHED) {
        const normalizedRawResponse = String(agentLlmDeltaBufferRef.current || "");
        if (normalizedRawResponse) {
          agentLlmResponseRawRef.current = normalizedRawResponse;
          setSessionAiResponseRaw(normalizedRawResponse);
          const currentMessageId = String(streamMessageIdRef.current || "").trim();
          if (currentMessageId) {
            patchLatestSessionAiRawExchange(
              currentMessageId,
              {
                responseRaw: normalizedRawResponse,
                stepCode: "llm_python_codegen",
                status: "finished",
                traceId: activeAgentStreamTraceRef.current,
                stageTitle: resolveCurrentAiRawStageTitle(),
                capturedAt: Date.now(),
              },
              {
                traceId: activeAgentStreamTraceRef.current,
                stepCode: "llm_python_codegen",
                appendIfMissing: true,
              },
            );
          }
        }
        if (!agentStreamTextBufferRef.current.trim()) {
          setStreamingAssistantStatusTarget(t("正在整理输出..."));
        }
        return;
      }
      if (payload.kind === STREAM_KINDS.PLANNING) {
        const planningText = resolvePlanningDisplayText(payload);
        if (planningText) {
          setStreamingAssistantStatusTarget(planningText);
        }
        return;
      }
      if (payload.kind === STREAM_KINDS.HEARTBEAT) {
        assistantRunHeartbeatCountRef.current += 1;
        const heartbeatText = buildAssistantHeartbeatDisplayText(
          String(payload.message || "").trim(),
          assistantRunHeartbeatCountRef.current,
        );
        setStreamingAssistantStatusTarget(heartbeatText);
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
        const finalSummary = resolveFinalAssistantRunSummary(
          String(currentMeta?.summary || "").trim(),
          String(payload.message || "").trim(),
          fallbackSummary,
        );
        setStreamingAssistantTarget(finalSummary);
        if (hasPendingWorkflowStages()) {
          return;
        }
        finishAssistantRunMessage(streamMessageIdRef.current, "finished", finalSummary, "ai");
        setStatus(t("执行完成"));
        setSending(false);
        activeAgentStreamTraceRef.current = "";
        return;
      }
      if (payload.kind === STREAM_KINDS.CANCELLED) {
        const cancelledSummary = String(payload.message || "").trim() || t("任务已取消");
        const currentMessageId = String(streamMessageIdRef.current || "").trim();
        if (currentMessageId) {
          patchLatestSessionAiRawExchange(
            currentMessageId,
            {
              responseRaw: String(agentLlmDeltaBufferRef.current || ""),
              stepCode: "llm_python_codegen",
              status: "failed",
              traceId: activeAgentStreamTraceRef.current,
              stageTitle: resolveCurrentAiRawStageTitle(),
              capturedAt: Date.now(),
            },
            {
              traceId: activeAgentStreamTraceRef.current,
              stepCode: "llm_python_codegen",
              appendIfMissing: true,
            },
          );
        }
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
        finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary, "system");
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
        const currentMessageId = String(streamMessageIdRef.current || "").trim();
        if (currentMessageId) {
          patchLatestSessionAiRawExchange(
            currentMessageId,
            {
              responseRaw: agentLlmDeltaBufferRef.current,
              stepCode: "llm_python_codegen",
              status: "running",
              traceId: activeAgentStreamTraceRef.current,
              stageTitle: resolveCurrentAiRawStageTitle(),
            },
            {
              traceId: activeAgentStreamTraceRef.current,
              stepCode: "llm_python_codegen",
              appendIfMissing: true,
            },
          );
        }
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
          const currentMessageId = String(streamMessageIdRef.current || "").trim();
          if (currentMessageId) {
            patchLatestSessionAiRawExchange(
              currentMessageId,
              {
                responseRaw: String(agentLlmDeltaBufferRef.current || ""),
                stepCode: "llm_python_codegen",
                status: "failed",
                traceId: activeAgentStreamTraceRef.current,
                stageTitle: resolveCurrentAiRawStageTitle(),
                capturedAt: Date.now(),
              },
              {
                traceId: activeAgentStreamTraceRef.current,
                stepCode: "llm_python_codegen",
                appendIfMissing: true,
              },
            );
          }
          setStreamingAssistantTarget(cancelledSummary);
          finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary, "system");
          setStatus(cancelledSummary);
          setSending(false);
          activeAgentStreamTraceRef.current = "";
          return;
        }
        const errorSummary = t("执行失败：{{reason}}", {
          reason: String(payload.message || "").trim() || t("未知错误"),
        });
        const currentMessageId = String(streamMessageIdRef.current || "").trim();
        if (currentMessageId) {
          patchLatestSessionAiRawExchange(
            currentMessageId,
            {
              responseRaw: String(agentLlmDeltaBufferRef.current || ""),
              stepCode: "llm_python_codegen",
              status: "failed",
              traceId: activeAgentStreamTraceRef.current,
              stageTitle: resolveCurrentAiRawStageTitle(),
              capturedAt: Date.now(),
            },
            {
              traceId: activeAgentStreamTraceRef.current,
              stepCode: "llm_python_codegen",
              appendIfMissing: true,
            },
          );
        }
        setStreamingAssistantTarget(errorSummary);
        finishAssistantRunMessage(streamMessageIdRef.current, "failed", errorSummary, "failure");
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
    displayMessages: MessageItem[],
    contextMessages: MessageItem[],
    shouldUseDccPreflight: boolean,
    options?: ExecutePromptOptions,
  ): Promise<DccPreflightResult> => {
    if (!shouldUseDccPreflight) {
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
      ...displayMessages
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
          displayMessages,
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
        displayMessages,
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
    activeWorkspace?.path,
    selectedDccSoftware,
    sessionId,
  ]);

  // 描述：
  //
  //   - 当项目目录已被外部删除时，统一阻断当前话题的新执行请求，避免继续触发无效 workdir。
  //
  // Returns:
  //
  //   - true: 已命中阻断条件，调用方应立即停止继续执行。
  const shouldBlockPromptExecutionForMissingWorkspace = () => {
    if (!isActiveWorkspacePathMissing) {
      return false;
    }
    setStatus(invalidWorkspacePromptMessage);
    return true;
  };

  const executePromptDirect = async (content: string, options?: ExecutePromptOptions) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || sending) return;
    if (shouldBlockPromptExecutionForMissingWorkspace()) {
      return;
    }

    const allowDangerousAction = Boolean(options?.allowDangerousAction);
    const appendUserMessage = options?.appendUserMessage !== false;
    const currentDisplayMessages = messagesRef.current;
    const currentContextMessages = agentContextMessagesRef.current;
    const currentAvailableSkills = availableSkillsRef.current;
    const currentSelectedSkillIds = activeSelectedSkillIdsRef.current;
    const currentSelectedWorkflow = selectedWorkflowRef.current;
    const baseDisplayMessages = options?.displayMessages || currentDisplayMessages;
    const baseContextMessages = options?.contextMessages?.length
      ? options.contextMessages
      : currentContextMessages.length > 0
        ? currentContextMessages
        : buildPromptContextMessages(
          baseDisplayMessages,
          assistantRunMetaMapRef.current,
        );
    const effectiveSelectedSkillIds = Array.isArray(options?.selectedSkillIdsOverride)
      ? Array.from(new Set(
        options.selectedSkillIdsOverride
          .map((item) => String(item || "").trim())
          .filter((item) => item.length > 0),
      )).slice(0, 1)
      : currentSelectedSkillIds;
    const effectiveSelectedSessionSkills = currentAvailableSkills.filter((item) => effectiveSelectedSkillIds.includes(item.id));
    const activeWorkflow = options?.disableWorkflow
      ? null
      : options?.workflowIdOverride
        ? getAgentWorkflowById(options.workflowIdOverride) || workflows.find((item) => item.id === options.workflowIdOverride) || null
        : currentSelectedWorkflow;
    const effectiveUsesDccModelingSkill = effectiveSelectedSessionSkills.some((item) => isDccModelingSkill(item))
      || Boolean(
        (activeWorkflow?.graph?.nodes || []).some(
          (node) => node.type === "skill" && normalizeAgentSkillId(String(node.skillId || "").trim()) === DCC_MODELING_SKILL_ID,
        ),
      );
    const dccPreflight = await resolveDccPreflight(
      normalizedContent,
      baseDisplayMessages,
      baseContextMessages,
      effectiveUsesDccModelingSkill,
      options,
    );
    if (dccPreflight.blocked) {
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
    const activeWorkflowName = activeWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel;
    const activeWorkflowId = activeWorkflow?.id || "";
    const outputDir = undefined;
    const executionTraceId = `trace-${Date.now()}`;
    const executionMode: AgentExecutionMode = options?.routeDecision?.routeKind === "chat"
      ? "chat"
      : "workflow";
    let nextContextMessages = [...baseContextMessages];
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
            route_kind: options?.routeDecision?.routeKind || "direct",
            route_reason: options?.routeDecision?.reason || "",
            workflow_id: activeWorkflowId || null,
            workflow_name: activeWorkflowName,
            execution_mode: executionMode,
            prompt: normalizedContent,
            output_dir: outputDir || null,
            allow_dangerous_action: allowDangerousAction,
        },
        null,
        2,
      ),
    );
    if (appendUserMessage) {
      const nextUserMessage: MessageItem = {
        id: `user-${Date.now()}`,
        role: "user",
        text: normalizedContent,
      };
      nextContextMessages = [...nextContextMessages, nextUserMessage];
      setMessages((prev) => [...prev, nextUserMessage]);
    }
    setAgentContextMessages(nextContextMessages);

    try {
      const skillExecutionPlan = buildAgentWorkflowSkillExecutionPlan(activeWorkflow, currentAvailableSkills);
      if (skillExecutionPlan.blockingIssues.length > 0) {
        throw new Error(t("工作流阶段前检查未通过：{{issues}}", {
          issues: skillExecutionPlan.blockingIssues.join("；"),
        }));
      }
      workflowPhaseCursorRef.current = null;
      setWorkflowPhaseCursor(null);
      appendDebugFlowRecord(
        "ui",
        "skill_plan",
        t("阶段执行计划"),
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
          traceId: executionTraceId,
          source: "workflow:skill_plan",
          message: t("已加载 {{count}} 个阶段节点", { count: skillExecutionPlan.readyItems.length }),
        });
      }
      const totalWorkflowStageCount = skillExecutionPlan.totalReadyCount;
      const hasWorkflowStages = totalWorkflowStageCount > 0;
      const initialStageIndex = hasWorkflowStages
        ? clampWorkflowStageIndex(options?.workflowStageIndex, totalWorkflowStageCount)
        : 0;
      const availableSkills = currentAvailableSkills;
      const workflowRootStreamMessageId = String(options?.replaceAssistantMessageId || "").trim()
        || `assistant-stream-${Date.now()}`;

      let currentStageIndex = hasWorkflowStages ? initialStageIndex : 0;
      let currentStageAttempt = 0;
      while (currentStageIndex < (hasWorkflowStages ? totalWorkflowStageCount : 1)) {
        const currentStagePlan = hasWorkflowStages
          ? buildAgentWorkflowSkillExecutionPlan(activeWorkflow, availableSkills, { stageIndex: currentStageIndex })
          : buildAgentWorkflowSkillExecutionPlan(activeWorkflow, availableSkills);
        const currentStageItem = currentStagePlan.activeItem;
        const currentStageTitle = String(currentStageItem?.nodeTitle || "").trim();
        const scopedWorkflow = currentStageItem
          ? scopeWorkflowDefinitionToStageNode(activeWorkflow, currentStageItem.nodeId)
          : activeWorkflow;
        const stageTraceId = `${executionTraceId}-${currentStageIndex + 1}`;
        const streamMessageId = workflowRootStreamMessageId;
        const stageContextMessageId = hasWorkflowStages
          ? `${streamMessageId}-stage-${currentStageIndex + 1}`
          : streamMessageId;
        const stageDividerTitle = hasWorkflowStages && currentStageItem && currentStageAttempt === 0
          ? options?.routeDecision?.routeKind === "workflow_partial"
            ? t("从第 {{current}}/{{total}} 阶段开始：{{title}}", {
              current: currentStageIndex + 1,
              total: totalWorkflowStageCount,
              title: currentStageItem.nodeTitle,
            })
            : buildWorkflowStageDividerTitle(
              currentStageIndex,
              totalWorkflowStageCount,
              currentStageItem.nodeTitle,
            )
          : "";
        const initialStreamText = "";

        if (hasWorkflowStages && currentStageItem) {
          setStatus(
            t("正在执行阶段 {{current}}/{{total}}：{{title}}", {
              current: currentStageIndex + 1,
              total: totalWorkflowStageCount,
              title: currentStageItem.nodeTitle,
            }),
          );
          appendDebugFlowRecord(
            "ui",
            "workflow_stage",
            t("工作流阶段"),
            JSON.stringify(
              {
                workflow_id: activeWorkflowId || null,
                workflow_name: activeWorkflowName,
                current_stage_index: currentStageIndex + 1,
                total_stage_count: totalWorkflowStageCount,
                node_id: currentStageItem.nodeId,
                node_title: currentStageItem.nodeTitle,
                skill_id: currentStageItem.skillId,
                skill_version: currentStageItem.skillVersion,
              },
              null,
              2,
            ),
          );
        }

        stopStreamTypingTimer();
        streamMessageIdRef.current = streamMessageId;
        streamDisplayedTextRef.current = "";
        streamLatestTextRef.current = "";
        activeAgentStreamTraceRef.current = stageTraceId;
        agentStreamTextBufferRef.current = "";
        agentStreamSeenKeysRef.current.clear();
        setMessages((prev) => upsertAssistantMessageById(prev, streamMessageId, initialStreamText));
        if (!hasWorkflowStages) {
          nextContextMessages = upsertAssistantMessageById(nextContextMessages, streamMessageId, initialStreamText);
        }
        streamDisplayedTextRef.current = initialStreamText;
        streamLatestTextRef.current = initialStreamText;
        assistantRunStatusRef.current = "running";
        assistantRunStageRef.current = "planning";
        assistantRunHeartbeatCountRef.current = 0;
        assistantRunLastActivityAtRef.current = Date.now();
        setAssistantRunMetaMap((prev) => {
          const currentMeta = prev[streamMessageId];
          const shouldPreserveExistingWorkflowSegments = hasWorkflowStages
            && Boolean(currentMeta)
            && (currentStageIndex > initialStageIndex || initialStageIndex > 0 || currentStageAttempt > 0);
          const stageDividerSegments = stageDividerTitle ? [{
            key: `workflow-stage-divider-${Date.now()}-${currentStageIndex + 1}`,
            intro: stageDividerTitle,
            step: "",
            status: "finished" as const,
            data: {
              __segment_role: WORKFLOW_STAGE_DIVIDER_SEGMENT_ROLE,
              workflow_stage_index: currentStageIndex,
              workflow_stage_total: totalWorkflowStageCount,
              workflow_stage_title: String(currentStageItem?.nodeTitle || "").trim(),
            },
          }] : [];
          const thinkingSegments = hasWorkflowStages ? [] : [{
            key: `intro-${Date.now()}`,
            intro: "",
            step: t("正在思考…"),
            status: "running" as const,
            data: {
              __segment_role: INITIAL_THINKING_SEGMENT_ROLE,
            },
          }];
          const segments = shouldPreserveExistingWorkflowSegments && currentMeta
            ? normalizeAssistantRunSegments([
              ...currentMeta.segments,
              ...stageDividerSegments,
            ])
            : normalizeAssistantRunSegments([
              ...stageDividerSegments,
              ...thinkingSegments,
            ]);
          return {
            ...prev,
            [streamMessageId]: {
              status: "running",
              startedAt: shouldPreserveExistingWorkflowSegments && currentMeta
                ? currentMeta.startedAt
                : Date.now(),
              finishedAt: undefined,
              collapsed: false,
              summary: "",
              summarySource: undefined,
              segments,
            },
          };
        });
        if (activeWorkflow && currentStageItem && totalWorkflowStageCount > 0) {
          const nextWorkflowPhaseCursor = buildWorkflowPhaseCursorSnapshot(
            activeWorkflow,
            normalizedContent,
            currentStageIndex,
            totalWorkflowStageCount,
            currentStageItem.nodeId,
            currentStageItem.nodeTitle,
            streamMessageId,
          );
          workflowPhaseCursorRef.current = nextWorkflowPhaseCursor;
          setWorkflowPhaseCursor(nextWorkflowPhaseCursor);
        }
        setStreamingAssistantStatusTarget(t("正在准备执行..."));
        startAssistantRunHeartbeat(streamMessageId);

        const latestProjectProfile = activeWorkspace?.id
          ? (activeProjectProfile || getProjectWorkspaceProfile(activeWorkspace.id))
          : null;
        const runtimeInfo = desktopRuntimeInfoRef.current || await getDesktopRuntimeInfo();
        desktopRuntimeInfoRef.current = runtimeInfo;
        setDesktopRuntimeInfo(runtimeInfo);
        const selectedSessionSkillPrompt = buildSessionSkillPrompt(effectiveSelectedSessionSkills);
        const currentRequestPrompt = buildSessionContextPrompt(
          nextContextMessages,
          normalizedContent,
          undefined,
          latestProjectProfile,
          activeWorkspaceEnabledCapabilities,
          sessionMemoryRef.current,
          runtimeInfo,
        );
        const contextualRequestPrompt = buildSessionContextPrompt(
          nextContextMessages,
          normalizedContent,
          String(activeWorkspace?.path || "").trim() || undefined,
          latestProjectProfile,
          activeWorkspaceEnabledCapabilities,
          sessionMemoryRef.current,
          runtimeInfo,
        );
        const routedCurrentRequestPrompt = options?.workflowPromptPreamble
          ? `${options.workflowPromptPreamble}\n\n${currentRequestPrompt}`
          : currentRequestPrompt;
        const routedContextualRequestPrompt = options?.workflowPromptPreamble
          ? `${options.workflowPromptPreamble}\n\n${contextualRequestPrompt}`
          : contextualRequestPrompt;
        const runtimeCapabilities = await getAgentRuntimeCapabilities({
          workspaceRoot: String(activeWorkspace?.path || "").trim() || undefined,
        });
        const hasWorkflowPlaywrightInteractiveSkill = (scopedWorkflow?.graph?.nodes || []).some((node) =>
          node.type === "skill" && isPlaywrightInteractiveSkillId(String(node.skillId || "").trim()));
        const hasSelectedPlaywrightInteractiveSkill = effectiveSelectedSessionSkills.some((skill) =>
          isPlaywrightInteractiveSkillId(String(skill.id || "").trim()));
        const selectedPlaywrightRuntimePrompt = hasSelectedPlaywrightInteractiveSkill
          && !hasWorkflowPlaywrightInteractiveSkill
          ? buildPlaywrightInteractiveRuntimePrompt(runtimeCapabilities)
          : "";
        const workflowPrompt = buildAgentWorkflowPrompt(
          scopedWorkflow,
          routedContextualRequestPrompt || routedCurrentRequestPrompt,
          runtimeCapabilities,
        );
        const agentPrompt = currentStagePlan.planPrompt
          ? `${workflowPrompt}\n\n${currentStagePlan.planPrompt}${selectedPlaywrightRuntimePrompt ? `\n\n${selectedPlaywrightRuntimePrompt}` : ""}${selectedSessionSkillPrompt ? `\n\n${selectedSessionSkillPrompt}` : ""}${dccPreflight.promptBlock ? `\n\n${dccPreflight.promptBlock}` : ""}`
          : `${workflowPrompt}${selectedPlaywrightRuntimePrompt ? `\n\n${selectedPlaywrightRuntimePrompt}` : ""}${selectedSessionSkillPrompt ? `\n\n${selectedSessionSkillPrompt}` : ""}${dccPreflight.promptBlock ? `\n\n${dccPreflight.promptBlock}` : ""}`;
        agentPromptRawRef.current = agentPrompt;
        agentLlmDeltaBufferRef.current = "";
        agentLlmResponseRawRef.current = "";
        setSessionAiPromptRaw(agentPrompt);
        setSessionAiResponseRaw("");
        appendSessionAiRawExchange(streamMessageId, {
          requestRaw: agentPrompt,
          responseRaw: "",
          stepCode: "llm_python_codegen",
          status: "running",
          traceId: stageTraceId,
          stageTitle: currentStageTitle,
          capturedAt: Date.now(),
        });

        const response = await invoke<AgentRunResponse>(COMMANDS.RUN_AGENT_COMMAND, {
          agentKey: normalizedAgentKey,
          sessionId,
          provider,
          providerApiKey: provider === "codex" || provider === "gemini-cli"
            ? undefined
            : String(selectedAi?.keyValue || "").trim() || undefined,
          providerModel: supportsProviderModelConfig(provider)
            ? String(selectedModelName || "").trim() || undefined
            : undefined,
          providerMode: supportsProviderModeConfig(provider)
            ? String(selectedModeName || "").trim() || undefined
            : undefined,
          prompt: agentPrompt,
          traceId: stageTraceId,
          projectName: title,
          modelExportEnabled: dccMcpCapabilities.export,
          dccProviderAddr: DEFAULT_DCC_PROVIDER_ADDR,
          outputDir,
          workdir: String(activeWorkspace?.path || "").trim() || undefined,
          runtimeCapabilities,
          executionMode,
        });
        const responseSteps = response.steps || [];
        setStepRecords(responseSteps);
        setEventRecords(response.events || []);
        const responseTraceId = String(response.trace_id || stageTraceId || "").trim();
        const extractedRawExchanges = extractSessionAiRawExchangesFromStepRecords(responseSteps, {
          status: "finished",
          traceId: responseTraceId,
          stageTitle: currentStageTitle,
        });
        const codegenRawStep = [...responseSteps]
          .reverse()
          .find((item) => item.code === "llm_python_codegen" && item.data && typeof item.data === "object");
        const codegenRawData = codegenRawStep?.data || {};
        const responsePromptRaw = String(codegenRawData.llm_prompt_raw || "") || agentPrompt;
        const responseRawText = String(codegenRawData.llm_response_raw || "")
          || String(agentLlmResponseRawRef.current || agentLlmDeltaBufferRef.current || "");
        if (responsePromptRaw || responseRawText) {
          const completedExchanges = extractedRawExchanges.length > 0
            ? extractedRawExchanges
            : [{
              requestRaw: responsePromptRaw,
              responseRaw: responseRawText,
              stepCode: "llm_python_codegen",
              status: "finished" as const,
              traceId: responseTraceId,
              stageTitle: currentStageTitle,
              capturedAt: Date.now(),
            }];
          mergeSessionAiRawExchangesForTrace(
            streamMessageId,
            responseTraceId,
            completedExchanges,
            responsePromptRaw,
            responseRawText,
          );
        }
        setSessionCallRecords((prev) => [
          ...prev,
          ...responseSteps.map((step) => ({
            id: `call-step-${stageTraceId}-${step.index}`,
            kind: "step",
            timestamp: Date.now(),
            messageId: streamMessageId,
            traceId: response.trace_id || stageTraceId,
            payload: {
              index: step.index,
              code: step.code,
              status: step.status,
              elapsed_ms: step.elapsed_ms,
              summary: step.summary,
              error: step.error,
              data: step.data,
            },
          }) satisfies SessionCallRecordSnapshot),
          ...(response.events || []).map((event, eventIndex) => ({
            id: `call-event-${stageTraceId}-${eventIndex}`,
            kind: "event",
            timestamp: Number(event.timestamp_ms || Date.now()),
            messageId: streamMessageId,
            traceId: response.trace_id || stageTraceId,
            payload: {
              event: event.event,
              step_index: event.step_index,
              timestamp_ms: event.timestamp_ms,
              message: event.message,
            },
          }) satisfies SessionCallRecordSnapshot),
        ]);
        const responseTotalTokens = Number(response.usage?.total_tokens || 0);
        if (sessionId && Number.isFinite(responseTotalTokens) && responseTotalTokens > 0) {
          setSessionCumulativeTokenUsage(
            increaseAgentSessionCumulativeTokenUsage(sessionId, responseTotalTokens),
          );
        }
        const responseControl = String(response.control || "").trim().toLowerCase() === "done"
          ? "done"
          : "continue";
        const responseDisplayMessage = sanitizeWorkflowStageDisplayMessage(
          String(response.display_message || "").trim(),
          String(response.message || "").trim(),
        );
        const completionDecision = hasWorkflowStages
          ? resolveWorkflowStageCompletionDecision(
            currentStageItem,
            responseControl,
            responseDisplayMessage,
            assistantRunMetaMapRef.current[streamMessageId],
          )
          : {
            control: responseControl,
            reason: "",
            displayMessage: responseDisplayMessage,
          };
        const effectiveResponseControl = completionDecision.control;
        const effectiveResponseDisplayMessage = completionDecision.displayMessage;
        const responseControlLabel = responseControl === "done" ? t("完成") : t("继续");
        const effectiveResponseControlLabel = effectiveResponseControl === "done" ? t("完成") : t("继续");
        if (hasWorkflowStages && currentStageItem) {
          appendTraceRecord({
            traceId: response.trace_id || stageTraceId,
            source: "workflow:stage_completion",
            message: t("阶段 {{current}}/{{total}} 完成态：原始={{raw}}，校验后={{effective}}，原因={{reason}}", {
              current: currentStageIndex + 1,
              total: totalWorkflowStageCount,
              raw: responseControlLabel,
              effective: effectiveResponseControlLabel,
              reason: completionDecision.reason || t("无"),
            }),
          });
        }
        appendTraceRecord({
          traceId: response.trace_id,
          source: "agent:run",
          message: hasWorkflowStages && currentStageItem
            ? t("阶段 {{current}}/{{total}}：{{message}}", {
              current: currentStageIndex + 1,
              total: totalWorkflowStageCount,
              message: effectiveResponseDisplayMessage,
            })
            : effectiveResponseDisplayMessage,
        });
        setUiHint(response.ui_hint ? mapProtocolUiHint(response.ui_hint) : null);
        setPendingDangerousToken("");
        setStreamingAssistantTarget(effectiveResponseDisplayMessage);
        let finalMemoryAssistantReply = "";
        let finalMemoryTurnDigest = "";
        let shouldExtractSessionMemory = false;
        if (hasWorkflowStages) {
          appendAssistantRunSegment(streamMessageId, {
            key: `workflow-stage-summary-${Date.now()}-${currentStageIndex + 1}`,
            intro: "",
            step: effectiveResponseDisplayMessage,
            status: "finished",
            data: {
              __step_type: WORKFLOW_STAGE_SUMMARY_STEP_TYPE,
              workflow_stage_index: currentStageIndex,
              workflow_stage_total: totalWorkflowStageCount,
              workflow_stage_summary_message: sanitizeWorkflowStageDisplayMessage(
                String(response.display_message || "").trim(),
                String(response.message || "").trim(),
              ),
              workflow_stage_title: String(currentStageItem?.nodeTitle || "").trim(),
            },
          });
          nextContextMessages = upsertAssistantMessageBeforeAnchorById(
            nextContextMessages,
            stageContextMessageId,
            effectiveResponseDisplayMessage,
            streamMessageId,
          );
          setAgentContextMessages(nextContextMessages);
        } else {
          finishAssistantRunMessage(streamMessageId, "finished", effectiveResponseDisplayMessage, "ai");
          nextContextMessages = upsertAssistantMessageById(nextContextMessages, streamMessageId, effectiveResponseDisplayMessage);
          setAgentContextMessages(nextContextMessages);
        }
        const actionText = response.actions?.length > 0
          ? t("动作：{{actions}}", { actions: response.actions.join(", ") })
          : t("动作：无");
        if (!hasWorkflowStages) {
          finalMemoryAssistantReply = effectiveResponseDisplayMessage;
          finalMemoryTurnDigest = actionText;
          shouldExtractSessionMemory = true;
        }
        if (hasWorkflowStages && effectiveResponseControl !== "done") {
          currentStageAttempt += 1;
          const pendingStageStatus = completionDecision.reason
            ? t("阶段 {{current}}/{{total}} 尚未完成：{{reason}}", {
              current: currentStageIndex + 1,
              total: totalWorkflowStageCount,
              reason: completionDecision.reason,
            })
            : t("阶段 {{current}}/{{total}} 尚未完成，继续当前阶段…", {
              current: currentStageIndex + 1,
              total: totalWorkflowStageCount,
            });
          setStatus(pendingStageStatus);
          continue;
        }
        currentStageAttempt = 0;
        if (hasWorkflowStages && currentStageIndex + 1 < totalWorkflowStageCount) {
          setStatus(
            t("阶段 {{current}}/{{total}} 已完成，继续下一阶段…", {
              current: currentStageIndex + 1,
              total: totalWorkflowStageCount,
            }),
          );
          currentStageIndex += 1;
          continue;
        }
        if (hasWorkflowStages) {
          const stageSummaryItems = collectWorkflowStageSummaryItems(
            assistantRunMetaMapRef.current[streamMessageId],
            currentStageIndex,
            String(currentStageItem?.nodeTitle || "").trim(),
            String(response.message || "").trim() || effectiveResponseDisplayMessage,
          );
          const workflowCompletionDigest = stageSummaryItems.length > 0
            ? buildWorkflowCompletionSummary(
              assistantRunMetaMapRef.current[streamMessageId],
              currentStageIndex,
              String(currentStageItem?.nodeTitle || "").trim(),
              String(response.message || "").trim() || effectiveResponseDisplayMessage,
            )
            : "";
          if (workflowCompletionDigest) {
            setStatus(t("正在整理执行总结..."));
          }
          const workflowSummaryResult = workflowCompletionDigest
            ? await requestWorkflowExecutionSummary(
              streamMessageId,
              String(response.trace_id || stageTraceId || "").trim() || `summary-${Date.now()}`,
              activeWorkflowName,
              workflowCompletionDigest,
              nextContextMessages,
              actionText,
              response.exported_file,
            )
            : {
              summary: "",
              summarySource: undefined,
              contextMessages: nextContextMessages,
            };
          nextContextMessages = workflowSummaryResult.contextMessages;
          finishAssistantRunMessage(
            streamMessageId,
            "finished",
            workflowSummaryResult.summary,
            workflowSummaryResult.summarySource,
          );
          finalMemoryAssistantReply = String(workflowSummaryResult.summary || effectiveResponseDisplayMessage || "").trim();
          finalMemoryTurnDigest = workflowCompletionDigest || actionText;
          shouldExtractSessionMemory = finalMemoryAssistantReply.length > 0;
        }
        if (shouldExtractSessionMemory && finalMemoryAssistantReply.trim()) {
          void requestSessionMemoryExtraction(
            streamMessageId,
            normalizedContent,
            finalMemoryAssistantReply,
            finalMemoryTurnDigest,
          );
        }
        const activeExecutionTarget = activeWorkflow
          ? t("工作流：{{workflow}}", { workflow: activeWorkflowName })
          : effectiveSelectedSessionSkills.length > 0
            ? t("技能：{{skill}}", {
              skill: effectiveSelectedSessionSkills[0]?.title || effectiveSelectedSessionSkills[0]?.id || t("未命名技能"),
            })
            : t("普通对话");
        setStatus(
          response.exported_file
            ? t("{{actionText}}；{{target}}；导出文件：{{file}}", {
              actionText,
              target: activeExecutionTarget,
              file: response.exported_file,
            })
            : t("{{actionText}}；{{target}}", {
              actionText,
              target: activeExecutionTarget,
            }),
        );
        workflowPhaseCursorRef.current = null;
        setWorkflowPhaseCursor(null);
        break;
      }
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
          finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary, "system");
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
        );
        if (failedMessageId && (failedPromptRaw || rawCodeResponse)) {
          patchLatestSessionAiRawExchange(
            failedMessageId,
            {
              requestRaw: failedPromptRaw,
              responseRaw: rawCodeResponse,
              stepCode: "llm_python_codegen",
              status: "failed",
              traceId: activeAgentStreamTraceRef.current,
              stageTitle: resolveCurrentAiRawStageTitle(),
              capturedAt: Date.now(),
            },
            {
              traceId: activeAgentStreamTraceRef.current,
              stepCode: "llm_python_codegen",
              appendIfMissing: true,
            },
          );
        }
      }
      if (streamMessageIdRef.current) {
        const failedAssistantReply = t("执行失败：{{reason}}", { reason });
        setStreamingAssistantTarget(t("执行失败：{{reason}}", { reason }));
        finishAssistantRunMessage(
          streamMessageIdRef.current,
          "failed",
          failedAssistantReply,
          "failure",
        );
        void requestSessionMemoryExtraction(
          streamMessageIdRef.current,
          normalizedContent,
          failedAssistantReply,
          String(agentLlmResponseRawRef.current || agentLlmDeltaBufferRef.current || "").trim() || reason,
        );
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

  // 描述：
  //
  //   - 发送前先按消息级执行路由裁决当前消息该走完整工作流、部分工作流、技能执行、普通对话还是恢复未完成执行。
  //
  // Params:
  //
  //   - content: 用户输入内容。
  //   - options: 发送控制项。
  const executePrompt = async (content: string, options?: ExecutePromptOptions) => {
    const normalizedContent = String(content || "").trim();
    if (!normalizedContent || sending) {
      return;
    }
    const currentExecutionSelection = executionSelectionRef.current;
    const currentSelectedWorkflow = selectedWorkflowRef.current;
    const currentAvailableSkills = availableSkillsRef.current;
    const routeDecision = resolveSessionExecutionRoute({
      messageText: normalizedContent,
      selection: currentExecutionSelection,
      workflow: currentSelectedWorkflow,
      workflowPhaseCursor: workflowPhaseCursorRef.current,
      hasPendingApproval: Boolean(activeApprovalId),
      hasPendingUserInput: Boolean(activeUserInputRequestId),
    });
    appendDebugFlowRecord(
      "ui",
      "message_route",
      t("消息执行路由"),
      JSON.stringify(
        {
          route_kind: routeDecision.routeKind,
          workflow_id: routeDecision.workflowId || null,
          skill_id: routeDecision.skillId || null,
          stage_index: Number.isFinite(routeDecision.stageIndex) ? routeDecision.stageIndex : null,
          node_id: routeDecision.nodeId || null,
          resume_target: routeDecision.resumeTarget || null,
          reason: routeDecision.reason,
        },
        null,
        2,
      ),
    );
    appendTraceRecord({
      traceId: `trace-local-${Date.now()}`,
      source: "workflow:route",
      message: `${routeDecision.routeKind}: ${routeDecision.reason}`,
    });

    if (routeDecision.routeKind === "resume_pending") {
      setInput("");
      if (routeDecision.resumeTarget === "approval" || routeDecision.resumeTarget === "user_input") {
        setStatus(t("已恢复未完成执行，请先完成当前交互。"));
        return;
      }
      const currentWorkflowPhaseCursor = workflowPhaseCursorRef.current;
      if (!currentWorkflowPhaseCursor) {
        setStatus(t("当前没有可恢复的执行阶段。"));
        return;
      }
      setStatus(t("正在恢复未完成执行..."));
      await executePromptDirect(currentWorkflowPhaseCursor.rootPrompt || normalizedContent, {
        ...options,
        appendUserMessage: false,
        workflowIdOverride: routeDecision.workflowId || currentWorkflowPhaseCursor.workflowId,
        workflowStageIndex: routeDecision.stageIndex ?? currentWorkflowPhaseCursor.currentStageIndex,
        routeDecision,
      });
      return;
    }

    if (routeDecision.routeKind === "workflow_partial") {
      const totalWorkflowStageCount = Math.max(
        buildAgentWorkflowSkillExecutionPlan(currentSelectedWorkflow, currentAvailableSkills).totalReadyCount,
        Number(routeDecision.stageIndex || 0) + 1,
      );
      const workflowPromptPreamble = [
        t("【消息级执行路由】"),
        t("当前请求已路由为“工作流部分执行”。"),
        t("仅执行第 {{current}}/{{total}} 阶段。", {
          current: Number(routeDecision.stageIndex || 0) + 1,
          total: totalWorkflowStageCount,
        }),
        t("不要重新执行前置阶段。"),
        t("若该阶段依赖的事实缺失，可直接指出阻塞，但不要自作主张回到阶段 1。"),
      ].join("\n");
      await executePromptDirect(normalizedContent, {
        ...options,
        disableWorkflow: false,
        workflowIdOverride: routeDecision.workflowId,
        workflowStageIndex: routeDecision.stageIndex,
        selectedSkillIdsOverride: [],
        workflowPromptPreamble,
        routeDecision,
      });
      return;
    }

    if (routeDecision.routeKind === "workflow_full") {
      await executePromptDirect(normalizedContent, {
        ...options,
        disableWorkflow: false,
        workflowIdOverride: routeDecision.workflowId,
        workflowStageIndex: 0,
        selectedSkillIdsOverride: [],
        routeDecision,
      });
      return;
    }

    if (routeDecision.routeKind === "skill") {
      await executePromptDirect(normalizedContent, {
        ...options,
        disableWorkflow: true,
        selectedSkillIdsOverride: routeDecision.skillId ? [routeDecision.skillId] : [],
        routeDecision,
      });
      return;
    }

    await executePromptDirect(normalizedContent, {
      ...options,
      disableWorkflow: true,
      selectedSkillIdsOverride: [],
      routeDecision,
    });
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
    const nextPrunedRunMetaMap = { ...assistantRunMetaMapRef.current };
    if (prunedRetryTail.removedAssistantMessageIds.length > 0) {
      setMessages(prunedRetryTail.messages);
      prunedRetryTail.removedAssistantMessageIds.forEach((messageId) => {
        delete nextPrunedRunMetaMap[messageId];
      });
      setAssistantRunMetaMap(nextPrunedRunMetaMap);
    }
    const prunedRetryContextMessages = buildPromptContextMessages(
      prunedRetryTail.messages,
      nextPrunedRunMetaMap,
    );
    setAgentContextMessages(prunedRetryContextMessages);
    // 描述：若当前失败为 Gemini 未实现，并且已启用 Codex，则自动切换到 Codex 再重试。
    if (
      isGeminiProviderNotImplementedError(assistantMessage.text)
      && availableAiKeys.some((item) => item.provider === "codex" && item.enabled)
    ) {
      applySessionAiSelection("codex");
      setStatus(t("检测到 Gemini 暂不可用，已切换到 Codex 重试"));
    } else {
      setStatus(t("正在重试本轮执行..."));
    }
    const currentWorkflowPhaseCursor = workflowPhaseCursorRef.current;
    const shouldResumeWorkflowStage = Boolean(
      currentWorkflowPhaseCursor
      && String(currentWorkflowPhaseCursor.currentMessageId || "").trim() === String(assistantMessage.id || "").trim(),
    );
    await executePromptDirect(shouldResumeWorkflowStage ? currentWorkflowPhaseCursor?.rootPrompt || retryPrompt : retryPrompt, {
      allowDangerousAction: false,
      appendUserMessage: false,
      replaceAssistantMessageId: String(assistantMessage.id || "").trim() || undefined,
      displayMessages: prunedRetryTail.messages,
      contextMessages: prunedRetryContextMessages,
      workflowIdOverride: shouldResumeWorkflowStage ? currentWorkflowPhaseCursor?.workflowId : undefined,
      workflowStageIndex: shouldResumeWorkflowStage ? currentWorkflowPhaseCursor?.currentStageIndex : undefined,
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

  // 描述：应用当前会话的 AI 选择，统一收敛 Provider、模型与模式的会话级覆盖值。
  //
  // Params:
  //
  //   - provider: 目标 Provider 标识。
  //   - options: 可选的模型与模式覆盖值；未传时自动回填当前 Provider 默认值。
  function applySessionAiSelection(
    provider: string,
    options?: {
      modelName?: string;
      modeName?: string;
    },
  ) {
    const normalizedProvider = String(provider || "").trim();
    if (!normalizedProvider) {
      return;
    }
    const supportsModel = supportsProviderModelConfig(normalizedProvider);
    const supportsMode = supportsProviderModeConfig(normalizedProvider);
    const nextModelName = supportsModel
      ? String(options?.modelName ?? resolveProviderDefaultModelName(normalizedProvider)).trim()
      : "";
    const nextModeName = supportsMode
      ? String(options?.modeName ?? resolveProviderDefaultModeName(normalizedProvider)).trim()
      : "";
    setSelectedProvider(normalizedProvider);
    setSelectedModelName(nextModelName);
    setSelectedModeName(nextModeName);
    if (sessionId) {
      rememberAgentSessionSelectedAiProvider(sessionId, normalizedProvider);
      rememberAgentSessionSelectedAiModel(sessionId, nextModelName);
      rememberAgentSessionSelectedAiMode(sessionId, nextModeName);
    }
  }

  // 描述：切换会话级模型选择，确保当前 Provider 下的覆盖值立即持久化。
  //
  // Params:
  //
  //   - value: AriSelect 回传值。
  const handleChangeModel = (value: string | number | (string | number)[] | undefined) => {
    if (Array.isArray(value) || !supportsProviderModelConfig(selectedProvider)) {
      return;
    }
    applySessionAiSelection(selectedProvider, {
      modelName: String(value || "").trim(),
      modeName: selectedModeName,
    });
  };

  // 描述：切换会话级模式选择，并将结果立即写回当前会话。
  //
  // Params:
  //
  //   - value: AriSelect 回传值。
  const handleChangeMode = (value: string | number | (string | number)[] | undefined) => {
    if (Array.isArray(value) || !supportsProviderModeConfig(selectedProvider)) {
      return;
    }
    applySessionAiSelection(selectedProvider, {
      modelName: selectedModelName,
      modeName: String(value || "").trim(),
    });
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
        finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary, "system");
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
  // 描述：
  //
  //   - 处理 AI 下拉选择，统一把选择值收敛为 Provider 字符串，并在切换时同步重置会话级模型/模式。
  //
  // Params:
  //
  //   - value: AriSelect 回传值。
  const handleChangeProvider = (value: string | number | (string | number)[] | undefined) => {
    if (Array.isArray(value)) {
      return;
    }
    const nextProvider = String(value || "").trim();
    if (!nextProvider) {
      return;
    }
    applySessionAiSelection(nextProvider);
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

  // 描述：按 request_id 乐观更新用户提问片段，确保提交/忽略后卡片立即消失并同步展示最终回答。
  const markUserInputSegmentResolved = (
    requestId: string,
    resolution: "answered" | "ignored",
    answers: SharedAgentUserInputAnswer[],
  ) => {
    const normalizedRequestId = String(requestId || "").trim();
    if (!normalizedRequestId) {
      return;
    }
    setAssistantRunMetaMap((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([messageId, meta]) => {
          const nextSegments = (meta.segments || []).map((segment) => {
            const segmentRequestId = segment.data && typeof segment.data.request_id === "string"
              ? String(segment.data.request_id || "").trim()
              : "";
            if (!segmentRequestId || segmentRequestId !== normalizedRequestId || !isUserInputPendingSegment(segment)) {
              return segment;
            }
            const stepData = segment.data && typeof segment.data === "object" ? segment.data : {};
            const questionCount = resolveUserInputQuestionCount(stepData);
            return {
              ...segment,
              status: "finished" as const,
              step: resolution === "ignored"
                ? t("已询问 {{count}} 个问题（已忽略）", { count: questionCount })
                : t("已询问 {{count}} 个问题", { count: questionCount }),
              data: {
                ...stepData,
                __step_type: "user_input_request",
                resolution,
                answers,
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
    setUserInputDraftMap((prev) => {
      if (!(normalizedRequestId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[normalizedRequestId];
      return next;
    });
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

  // 描述：选中某题的预设选项，并清空对应的自定义填写内容，保持单题单选约束。
  const handleSelectUserInputOption = (
    requestId: string,
    questionId: string,
    optionIndex: number,
  ) => {
    const normalizedRequestId = String(requestId || "").trim();
    const normalizedQuestionId = String(questionId || "").trim();
    if (!normalizedRequestId || !normalizedQuestionId) {
      return;
    }
    setUserInputDraftMap((prev) => ({
      ...prev,
      [normalizedRequestId]: {
        ...(prev[normalizedRequestId] || {}),
        [normalizedQuestionId]: {
          selectedOptionIndex: optionIndex,
          customValue: "",
        },
      },
    }));
  };

  // 描述：更新某题的自由填写内容；一旦有文本输入，自动取消当前题目的预设选项选中状态。
  const handleChangeUserInputCustomValue = (
    requestId: string,
    questionId: string,
    value: string,
  ) => {
    const normalizedRequestId = String(requestId || "").trim();
    const normalizedQuestionId = String(questionId || "").trim();
    if (!normalizedRequestId || !normalizedQuestionId) {
      return;
    }
    setUserInputDraftMap((prev) => ({
      ...prev,
      [normalizedRequestId]: {
        ...(prev[normalizedRequestId] || {}),
        [normalizedQuestionId]: {
          selectedOptionIndex: undefined,
          customValue: value,
        },
      },
    }));
  };

  // 描述：提交当前用户提问卡片答案，成功后不新增 transcript 消息，只恢复原执行流。
  const handleSubmitAgentUserInput = async (
    requestId: string,
    questions: SharedAgentUserInputQuestionPrompt[],
  ) => {
    const normalizedRequestId = String(requestId || "").trim();
    if (!normalizedRequestId || questions.length === 0) {
      return;
    }
    const drafts = userInputDraftMap[normalizedRequestId] || {};
    const answers = questions.map<SharedAgentUserInputAnswer | null>((question) => {
      const draft = drafts[question.id];
      const selectedOptionIndex = typeof draft?.selectedOptionIndex === "number"
        ? draft.selectedOptionIndex
        : undefined;
      if (
        typeof selectedOptionIndex === "number"
        && selectedOptionIndex >= 0
        && selectedOptionIndex < question.options.length
      ) {
        const option = question.options[selectedOptionIndex];
        return {
          question_id: question.id,
          answer_type: "option",
          option_index: selectedOptionIndex,
          option_label: option.label,
          value: option.label,
        };
      }
      const customValue = String(draft?.customValue || "").trim();
      if (customValue) {
        return {
          question_id: question.id,
          answer_type: "custom",
          value: customValue,
        };
      }
      return null;
    });
    if (answers.some((item) => !item)) {
      AriMessage.warning({
        content: t("请先回答全部问题。"),
        duration: 1800,
      });
      return;
    }
    const normalizedAnswers = answers.filter((item): item is SharedAgentUserInputAnswer => Boolean(item));
    setUserInputSubmittingRequestId(normalizedRequestId);
    try {
      await invoke(COMMANDS.RESOLVE_AGENT_USER_INPUT, {
        id: normalizedRequestId,
        resolution: "answered",
        answers: normalizedAnswers,
      });
      markUserInputSegmentResolved(
        normalizedRequestId,
        "answered",
        normalizedAnswers,
      );
    } catch (_error) {
      setStatus(t("提交问题回答失败，请重试"));
    } finally {
      setUserInputSubmittingRequestId((current) => (
        current === normalizedRequestId ? "" : current
      ));
    }
  };

  // 描述：忽略当前用户提问卡片，不中断整轮执行，只把本次提问按 ignored 结果返回给 Agent。
  const handleIgnoreAgentUserInput = async (requestId: string) => {
    const normalizedRequestId = String(requestId || "").trim();
    if (!normalizedRequestId) {
      return;
    }
    setUserInputSubmittingRequestId(normalizedRequestId);
    try {
      await invoke(COMMANDS.RESOLVE_AGENT_USER_INPUT, {
        id: normalizedRequestId,
        resolution: "ignored",
      });
      markUserInputSegmentResolved(normalizedRequestId, "ignored", []);
    } catch (_error) {
      setStatus(t("忽略提问失败，请重试"));
    } finally {
      setUserInputSubmittingRequestId((current) => (
        current === normalizedRequestId ? "" : current
      ));
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
      const pendingDisplayMessages = pendingDccSelection.displayMessages;
      const pendingContextMessages = pendingDccSelection.contextMessages;
      setPendingDccSelection(null);
      await executePromptDirect(pendingPrompt, {
        ...pendingOptions,
        resolvedCrossDccSoftwares: [nextSoftware, nextTargetSoftware],
        skipDccSelectionPrompt: true,
        displayMessages: pendingDisplayMessages,
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
    const pendingDisplayMessages = pendingDccSelection.displayMessages;
    const pendingContextMessages = pendingDccSelection.contextMessages;
    setPendingDccSelection(null);
    await executePromptDirect(pendingPrompt, {
      ...pendingOptions,
      resolvedDccSoftware: nextSoftware,
      skipDccSelectionPrompt: true,
      displayMessages: pendingDisplayMessages,
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
  const activeUserInputSegment = (() => {
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
        (segment) => segment.status === "running" && isUserInputPendingSegment(segment),
      );
      if (hit) {
        return hit;
      }
    }
    return null;
  })();
  const activeUserInputData = activeUserInputSegment?.data && typeof activeUserInputSegment.data === "object"
    ? activeUserInputSegment.data
    : {};
  const activeUserInputRequestId = typeof activeUserInputData.request_id === "string"
    ? activeUserInputData.request_id
    : "";
  const activeUserInputQuestions = Array.isArray(activeUserInputData.questions)
    ? activeUserInputData.questions
      .map((item) => normalizeUserInputQuestionPrompt(item))
      .filter((item): item is SharedAgentUserInputQuestionPrompt => Boolean(item))
    : [];
  const activeUserInputDrafts = activeUserInputRequestId
    ? (userInputDraftMap[activeUserInputRequestId] || {})
    : {};
  const hasActiveUserInput = activeUserInputQuestions.length > 0;
  const isUserInputSubmitDisabled = !hasActiveUserInput
    || activeUserInputQuestions.some((question) => {
      const draft = activeUserInputDrafts[question.id];
      const hasOption = typeof draft?.selectedOptionIndex === "number"
        && draft.selectedOptionIndex >= 0
        && draft.selectedOptionIndex < question.options.length;
      const hasCustom = String(draft?.customValue || "").trim().length > 0;
      return !hasOption && !hasCustom;
    });
  const activeTodoDockSnapshot = useMemo(
    () => resolveAssistantTodoDockSnapshot(
      messages,
      assistantRunMetaMap,
      String(streamMessageIdRef.current || "").trim(),
    ),
    [assistantRunMetaMap, messages],
  );
  const activeTodoDockItems = activeTodoDockSnapshot?.items || [];
  const shouldShowTodoDock = activeTodoDockItems.length > 0;
  const completedTodoCount = activeTodoDockItems.filter((item) => item.status === "completed").length;

  useEffect(() => {
    if (!activeUserInputRequestId) {
      return undefined;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      void handleIgnoreAgentUserInput(activeUserInputRequestId);
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [activeUserInputRequestId]);
  const todoDockProgressText = activeTodoDockItems.length > 0
    ? t("已完成 {{done}} / {{total}}", {
      done: completedTodoCount,
      total: activeTodoDockItems.length,
    })
    : "";
  const todoDockCaption = workflowPhaseCursor && workflowPhaseCursor.totalStageCount > 0
    ? t("当前阶段：{{current}}/{{total}} · {{title}}", {
      current: workflowPhaseCursor.currentStageIndex + 1,
      total: workflowPhaseCursor.totalStageCount,
      title: workflowPhaseCursor.currentNodeTitle || t("未命名阶段"),
    })
    : t("会话内任务计划会随执行自动更新。");

  // 描述：
  //
  //   - 打开“工作流/技能”选择弹窗，并用当前生效配置初始化草稿状态。
  const handleOpenWorkflowSkillModal = () => {
    if (executionSelection.kind === "skill") {
      setDraftExecutionSelection(buildSkillExecutionSelection(activeSelectedSkillIds));
      setWorkflowSkillModalVisible(true);
      return;
    }
    if (executionSelection.kind === "workflow") {
      setDraftExecutionSelection(buildWorkflowExecutionSelection(activeSelectedWorkflowId));
      setWorkflowSkillModalVisible(true);
      return;
    }
    setDraftExecutionSelection(EMPTY_SESSION_EXECUTION_SELECTION);
    setWorkflowSkillModalVisible(true);
  };

  // 描述：
  //
  //   - 关闭“工作流/技能”选择弹窗，不提交草稿变更。
  const handleCloseWorkflowSkillModal = () => {
    setWorkflowSkillModalVisible(false);
    setDraftExecutionSelection(EMPTY_SESSION_EXECUTION_SELECTION);
  };

  // 描述：
  //
  //   - 将弹窗草稿切回“无执行上下文”，用于显式选择普通对话模式。
  const handleSelectDraftExecutionNone = () => {
    setDraftExecutionSelection(EMPTY_SESSION_EXECUTION_SELECTION);
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
  const nextSkillIds = draftSkillIds.includes(skillId) ? [] : [skillId];
  setDraftExecutionSelection(buildSkillExecutionSelection(nextSkillIds));
};

  // 描述：
  //
//   - 提交弹窗中的工作流与技能草稿配置，并按智能体类型写回当前会话状态。
//   - 当前执行策略约束为“技能单选”，提交前统一裁剪草稿技能列表。
const handleConfirmWorkflowSkillModal = () => {
  const nextWorkflowId = String(draftWorkflowId || "").trim();
  const nextSkillIds = draftSkillIds.slice(0, 1);
  if (nextSkillIds.length > 0) {
    setExecutionSelection(buildSkillExecutionSelection(nextSkillIds));
  } else if (nextWorkflowId) {
    setExecutionSelection(buildWorkflowExecutionSelection(nextWorkflowId || workflows[0]?.id || ""));
  } else {
    setExecutionSelection(EMPTY_SESSION_EXECUTION_SELECTION);
  }
  setWorkflowSkillModalVisible(false);
  setDraftExecutionSelection(EMPTY_SESSION_EXECUTION_SELECTION);
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
    await executePromptDirect(pending.prompt, {
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
      await executePromptDirect(pending.prompt, {
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
      await executePromptDirect(prompt, {
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
    const currentWorkflowPhaseCursor = workflowPhaseCursorRef.current;
    setStatus(t("正在重试最近一轮..."));
    await executePromptDirect(currentWorkflowPhaseCursor?.rootPrompt || normalizedPrompt, {
      allowDangerousAction: false,
      appendUserMessage: false,
      workflowIdOverride: currentWorkflowPhaseCursor?.workflowId,
      workflowStageIndex: currentWorkflowPhaseCursor?.currentStageIndex,
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

  // 描述：格式化“需保留原始空白字符”的 Markdown 代码块，用于完整导出消息正文与 AI 原始收发。
  //
  // Params:
  //
  //   - content: 原始内容。
  //   - language: 代码块语言标记。
  //
  // Returns:
  //
  //   - 保留原始换行与空格的 fenced code block。
  const wrapMarkdownCodeFencePreserveContent = (content: string, language = "text") => {
    const normalizedContent = String(content ?? "");
    const escapedContent = normalizedContent.replace(/```/g, "``\\`");
    return `\`\`\`${language}\n${escapedContent}\n\`\`\``;
  };

  // 描述：构建指定助手消息对应的 AI 原始收发列表；优先读取消息级完整 exchanges，缺失时兼容旧数据。
  //
  // Returns:
  //
  //   - 原始收发数组。
  const buildSessionAiRawExchangeList = (
    messageId: string,
    assistantIndex: number,
    assistantCount: number,
  ) => {
    const rawByMessage = messageId ? buildSessionAiRawByMessageItem(sessionAiRawByMessage[messageId]) : null;
    if (rawByMessage && rawByMessage.exchanges.length > 0) {
      return rawByMessage.exchanges;
    }
    // 描述：兼容历史会话（仅存会话级原始收发）时，仅在“单助手消息”场景回退，避免多消息错配。
    if (assistantCount !== 1 || assistantIndex !== 0) {
      return [];
    }
    const stepExchanges = extractSessionAiRawExchangesFromStepRecords(stepRecords);
    if (stepExchanges.length > 0) {
      return stepExchanges;
    }
    const latestCodegenStep = [...stepRecords]
      .reverse()
      .find((item) => item.code === "llm_python_codegen" && item.data && typeof item.data === "object");
    const latestCodegenData = latestCodegenStep?.data || {};
    const agentPromptRaw = String(latestCodegenData.llm_prompt_raw || "");
    const codeResponseRaw = String(latestCodegenData.llm_response_raw || "");
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
      return String(record?.detail ?? "");
    };
    const fallbackPromptRaw = findDebugFlowDetail(
      ["llm_plan_prompt", "ai_summary_prompt"],
      [t("Prompt"), t("提示词")],
    );
    const fallbackResponseRaw = findDebugFlowDetail(
      ["llm_plan_raw_response", "ai_summary_raw"],
      [t("原始返回"), "raw"],
    );
    const promptRaw = agentPromptRaw || fallbackPromptRaw || String(sessionAiPromptRaw || agentPromptRawRef.current || "");
    const responseRaw = codeResponseRaw
      || fallbackResponseRaw
      || String(sessionAiResponseRaw || agentLlmResponseRawRef.current || agentLlmDeltaBufferRef.current || "");
    const fallbackExchange = normalizeSessionAiRawExchangeItem({
      requestRaw: promptRaw,
      responseRaw,
      status: String(streamMessageIdRef.current || "").trim() === String(messageId || "").trim()
        && assistantRunStatusRef.current === "running"
        ? "running"
        : "finished",
    });
    return fallbackExchange ? [fallbackExchange] : [];
  };

  // 描述：构建指定助手消息对应的“AI 原始收发”文本，按“请求 1 / 响应 1”完整输出。
  //
  // Returns:
  //
  //   - AI 原始收发文本。
  const buildSessionAiRawExchangeText = (
    messageId: string,
    assistantIndex: number,
    assistantCount: number,
  ) => {
    const exchanges = buildSessionAiRawExchangeList(messageId, assistantIndex, assistantCount);
    if (exchanges.length === 0) {
      return "";
    }
    return [
      t("#### AI 原始收发"),
      ...exchanges.flatMap((exchange, index) => [
        t("##### 请求 {{index}}", { index: index + 1 }),
        wrapMarkdownCodeFencePreserveContent(exchange.requestRaw, "text"),
        "",
        exchange.status === "running"
          ? t("##### 响应 {{index}}（进行中）", { index: index + 1 })
          : t("##### 响应 {{index}}", { index: index + 1 }),
        wrapMarkdownCodeFencePreserveContent(exchange.responseRaw, "text"),
      ]),
    ].join("\n");
  };

  // 描述：构建会话消息文本，按消息顺序拼接完整原始消息；助手消息附带全部 AI 原始收发记录。
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
        const blocks = [
          t("### 消息 {{index}} · {{role}}", {
            index: index + 1,
            role: roleLabel,
          }),
        ];
        if (item.role === "user") {
          blocks.push(
            t("#### 原始消息"),
            wrapMarkdownCodeFencePreserveContent(String(item.text ?? ""), "text"),
          );
          return blocks.join("\n\n");
        }
        assistantMessageIndex += 1;
        const assistantMessageId = String(item.id || "").trim();
        const aiRawText = buildSessionAiRawExchangeText(
          assistantMessageId,
          assistantMessageIndex,
          assistantMessageCount,
        );
        if (aiRawText) {
          blocks.push(aiRawText);
        } else {
          blocks.push(
            t("#### AI 原始收发"),
            t("- （未记录 AI 原始收发）"),
          );
        }
        return blocks.join("\n\n");
      })
      .join("\n\n");
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
      const name = String(item.title || "").trim() || item.id;
      return `${name} (${item.id})`;
    });
    const executionSelectionLabel = executionSelection.kind === "workflow"
      ? t("工作流")
      : executionSelection.kind === "skill"
        ? t("技能")
        : t("不使用流程");
    const workflowSummary = selectedWorkflow
      ? `${selectedWorkflow.name} (${selectedWorkflow.id})`
      : t("（当前未选择工作流）");
    const skillSummary = configuredSkillItems.length > 0
      ? configuredSkillItems.join("；")
      : t("（当前未选择技能）");
    const providerName = String(selectedAi?.providerLabel || selectedAi?.provider || selectedProvider || "").trim() || "-";
    const providerId = String(selectedAi?.provider || selectedProvider || "").trim() || "-";
    const providerModel = String(selectedModelName || "").trim() || t("(未填写)");
    const providerMode = String(selectedModeName || "").trim() || t("(未填写)");
    return [
      t("- 会话类型：智能体"),
      t("- AI：{{name}} ({{id}})", { name: providerName, id: providerId }),
      t("- 模型：{{model}}", { model: providerModel }),
      t("- 模式：{{mode}}", { mode: providerMode }),
      t("- 执行上下文：{{selection}}", { selection: executionSelectionLabel }),
      t("- 工作流：{{workflow}}", { workflow: workflowSummary }),
      t("- 技能：{{skills}}", { skills: skillSummary }),
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
    const runtimeInfo = desktopRuntimeInfo;
    const runtimeSystem = resolveDesktopRuntimeSystemLabel(runtimeInfo);
    const runtimeArch = resolveDesktopRuntimeArchLabel(runtimeInfo);
    const runtimeConstraint = runtimeInfo
      ? buildDesktopRuntimeCommandConstraint(runtimeInfo)
      : "";
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
      ...(runtimeSystem
        ? [t("- 运行系统：{{system}}", { system: runtimeSystem })]
        : []),
      ...(runtimeArch
        ? [t("- 系统架构：{{arch}}", { arch: runtimeArch })]
        : []),
      ...(runtimeConstraint
        ? [t("- 命令约束：{{constraint}}", { constraint: runtimeConstraint })]
        : []),
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

  // 描述：构建会话长期记忆文本，仅用于调试导出，避免在普通会话区新增独立面板。
  //
  // Returns:
  //
  //   - 会话长期记忆文本。
  const buildSessionMemoryText = () => {
    if (!sessionMemory) {
      return t("- 当前会话尚无记忆快照。");
    }
    return wrapMarkdownCodeFence(JSON.stringify({
      updated_at: sessionMemory.updatedAt,
      last_processed_message_id: sessionMemory.lastProcessedMessageId,
      preferences: sessionMemory.preferences,
      decisions: sessionMemory.decisions,
      todos: sessionMemory.todos,
    }, null, 2), "json");
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

  // 描述：构建“运行片段”可见快照，严格复用会话页当前渲染规则，保证复制内容与 UI 所见一致。
  //
  // Returns:
  //
  //   - 运行片段 JSON 快照对象。
  const buildSessionRunSnippetSnapshot = () => {
    return messages.flatMap((message, index) => {
      if (message.role !== "assistant" || !message.id) {
        return [];
      }
      const runMeta = assistantRunMetaMap[message.id];
      if (!runMeta) {
        return [];
      }
      const messageKey = String(message.id || `message-${index}`);
      const dividerTitle = runMeta.status === "failed"
        ? t("执行中断，用时 {{duration}}", { duration: formatElapsedDuration(runMeta.startedAt, runMeta.finishedAt) })
        : t("已完成，用时 {{duration}}", { duration: formatElapsedDuration(runMeta.startedAt, runMeta.finishedAt) });
      const failureSummary = runMeta.status === "failed"
        ? buildAssistantFailureSummary(runMeta.summary || message.text)
        : null;
      const visibleBodyText = resolveVisibleAssistantBodyText(message.text, runMeta);
      const runSegmentsForRender: AssistantRunSegment[] = (() => {
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
      })();
      const hasPendingApprovalInRender = runMeta.status === "running"
        && runSegmentsForRender.some(
          (segment) => segment.status === "running" && isApprovalPendingSegment(segment),
        );
      const hasPendingUserInputInRender = runMeta.status === "running"
        && runSegmentsForRender.some(
          (segment) => segment.status === "running" && isUserInputPendingSegment(segment),
        );
      const runSegmentGroups = buildRunSegmentGroups(runSegmentsForRender);
      const runningIndicatorText = resolveRunningIndicatorText(message.text, runMeta);
      const visibleGroups = runMeta.status === "running" || !runMeta.collapsed
        ? runSegmentGroups.map((group) => {
          if (group.kind === "divider") {
            return {
              kind: "divider",
              title: group.title,
            };
          }
          return {
            kind: group.kind,
            title: group.title,
            steps: group.steps.map((step) => {
              const segmentKeyPrefix = runMeta.status === "running" ? "" : "collapsed-";
              const detailKey = `${messageKey}:${segmentKeyPrefix}${step.key}`;
              const detailExpanded = Boolean(expandedRunSegmentDetailMap[detailKey]);
              return {
                key: step.key,
                status: step.status,
                text: step.text,
                data: step.data,
                detail_expanded: detailExpanded,
                detail: detailExpanded ? step.detail : undefined,
              };
            }),
          };
        })
        : [];
      const visibleSummary = runMeta.status === "failed" && failureSummary
        ? {
          type: "failure" as const,
          title: t("执行失败"),
          detail: failureSummary.detail,
          hint: failureSummary.hint,
          action_label: t("重试本轮"),
        }
        : runMeta.summarySource === "ai"
          && String(runMeta.summary || "").trim()
          && String(runMeta.summary || "").trim() !== visibleBodyText
          ? {
            type: "markdown" as const,
            content: runMeta.summary,
          }
          : undefined;
      return [{
        message_index: index + 1,
        message_id: message.id,
        status: runMeta.status,
        started_at: formatSessionCopyTime(runMeta.startedAt),
        finished_at: formatSessionCopyTime(runMeta.finishedAt),
        visible_body: visibleBodyText || undefined,
        divider_title: runMeta.status === "running" ? undefined : dividerTitle,
        collapsed: runMeta.status === "running" ? undefined : runMeta.collapsed,
        visible_groups: visibleGroups,
        running_indicator: runMeta.status === "running"
          && !hasPendingApprovalInRender
          && !hasPendingUserInputInRender
          && runningIndicatorText
          ? runningIndicatorText
          : undefined,
        visible_summary: visibleSummary,
      }];
    });
  };

  // 描述：构建会话运行片段文本；内容严格来源于当前前端可见数据，并以 JSON 输出。
  //
  // Returns:
  //
  //   - 运行片段文本。
  const buildSessionRunSnippetText = () => {
    return wrapMarkdownCodeFence(JSON.stringify(buildSessionRunSnippetSnapshot(), null, 2), "json");
  };

  // 描述：构建会话执行过程文本，仅保留从第一句开始累计的全链路调用记录，并以 JSON 输出。
  //
  // Returns:
  //
  //   - 执行过程文本。
  const buildSessionProcessText = () => {
    const legacyRecords = [
      ...[...debugFlowRecords].reverse().map((record) => ({
        id: `legacy-debug-${record.id}`,
        kind: "debug_flow",
        timestamp: record.timestamp,
        payload: {
          source: record.source,
          stage: record.stage,
          title: record.title,
          detail: record.detail,
        },
      })),
      ...[...traceRecords].reverse().map((record, index) => ({
        id: `legacy-trace-${index + 1}`,
        kind: "trace",
        payload: {
          traceId: record.traceId,
          source: record.source,
          code: record.code,
          message: record.message,
        },
      })),
    ];
    const processRecords = sessionCallRecords.length > 0 ? sessionCallRecords : legacyRecords;
    return wrapMarkdownCodeFence(JSON.stringify(processRecords, null, 2), "json");
  };

  // 描述：构建可复制的完整会话文本，包含会话消息、执行配置、项目设置、运行片段与执行过程。
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
      t("### 3.2 会话记忆"),
      buildSessionMemoryText(),
      "",
      t("## 四、运行片段"),
      buildSessionRunSnippetText(),
      "",
      t("## 五、执行过程"),
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
    expandedRunSegmentDetailMap,
    t,
    messages,
    normalizedAgentKey,
    selectedAi,
    selectedModeName,
    selectedModelName,
    selectedWorkflow,
    selectedProvider,
    selectedSessionSkills,
    sessionAiPromptRaw,
    sessionAiRawByMessage,
    sessionAiResponseRaw,
    sessionCallRecords,
    sessionMemory,
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
    <AriContainer
      className="desk-content desk-session-content"
      height="100%"
      variant="plain"
      showBorderRadius={false}
    >
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
            value={t("模式")}
          />
          <AriList
            bordered
            size="sm"
            className="desk-session-strategy-list"
            emptyMessage={t("暂无可选模式")}
          >
            <AriListItem
              key="execution-none"
              split={false}
              className={`desk-session-strategy-item${draftExecutionSelection.kind === "none" ? " is-active" : ""}`}
              onClick={handleSelectDraftExecutionNone}
              extra={
                draftExecutionSelection.kind === "none" ? (
                  <AriContainer className="desk-session-strategy-item-extra" padding={0}>
                    <AriIcon name="done" />
                  </AriContainer>
                ) : null
              }
            >
              <AriFlex className="desk-session-strategy-item-main" align="center" space={8}>
                <AriContainer className="desk-session-strategy-item-icon" padding={0}>
                  <AriIcon name="chat_bubble_outline" />
                </AriContainer>
                <AriContainer className="desk-session-strategy-item-text" padding={0}>
                  <AriTypography variant="body" bold value={t("不使用流程")} />
                  <AriTypography
                    variant="caption"
                    value={t("当前消息默认按普通对话处理，不自动注入工作流或技能。")}
                  />
                </AriContainer>
              </AriFlex>
            </AriListItem>
          </AriList>

          <AriTypography
            className="desk-session-strategy-section-title"
            variant="caption"
            value={t("工作流")}
          />
          {workflowMenuItems.length > 0 ? (
            <AriList
              bordered
              size="sm"
              className="desk-session-strategy-list"
            >
              {workflowMenuItems.map((item) => (
                <AriListItem
                  key={`workflow-${item.key}`}
                  split={false}
                  className={`desk-session-strategy-item${draftWorkflowId === item.key ? " is-active" : ""}`}
                  onClick={() => {
                    setDraftExecutionSelection(buildWorkflowExecutionSelection(item.key));
                  }}
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
                      <AriTypography variant="body" bold value={item.label} />
                      <AriTypography
                        variant="caption"
                        value={item.description || t("按该工作流执行。")}
                      />
                    </AriContainer>
                  </AriFlex>
                </AriListItem>
              ))}
            </AriList>
          ) : (
            <DeskEmptyState
              title={t("暂无可选工作流")}
              description={t("请先注册工作流后再选择。")}
            />
          )}

          <AriTypography
            className="desk-session-strategy-section-title"
            variant="caption"
            value={t("技能")}
          />
          {availableSkills.length > 0 ? (
            <AriList
              bordered
              size="sm"
              className="desk-session-strategy-list"
            >
              {availableSkills.map((item) => (
                <AriListItem
                  key={`skill-${item.id}`}
                  split={false}
                  className={`desk-session-strategy-item${draftSkillIds.includes(item.id) ? " is-active" : ""}`}
                  onClick={() => {
                    handleToggleDraftSkill(item.id);
                  }}
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
                      <AriTypography variant="body" bold value={item.title} />
                      <AriTypography variant="caption" value={item.description} />
                    </AriContainer>
                  </AriFlex>
                </AriListItem>
              ))}
            </AriList>
          ) : (
            <DeskEmptyState
              title={t("暂无可用技能")}
              description={t("请先注册技能后再选择。")}
              titleVariant="body"
              titleBold
            />
          )}
        </AriContainer>
      </AriModal>
      <AriContainer className="desk-session-shell">
        <AriContainer className="desk-session-thread-wrap">
          <AriContainer className="desk-thread">
            {messages.length === 0 ? (
              <AriContainer className="desk-session-empty-state">
                <AriContainer className="desk-session-quick-start-heading" padding={0}>
                  <AriTypography variant="h4" bold value={t("快速开始")} />
                </AriContainer>
                <AriContainer className="desk-session-quick-start-grid" padding={0}>
                  {sessionQuickStartPresets.map((preset) => (
                    <AriCard
                      key={preset.id}
                      className="desk-session-empty-card desk-session-quick-start-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        handleApplyQuickStartPreset(preset);
                      }}
                      onKeyDown={(event) => {
                        handleQuickStartPresetCardKeyDown(event, preset);
                      }}
                    >
                      <AriContainer className="desk-session-quick-start-main" padding={0}>
                        <AriTypography variant="h4" value={preset.title} />
                        <AriTypography variant="caption" value={preset.description} />
                      </AriContainer>
                    </AriCard>
                  ))}
                </AriContainer>
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
              const visibleAssistantBodyText = runMeta
                ? resolveVisibleAssistantBodyText(message.text, runMeta)
                : "";
              const visibleRunSummaryText = runMeta?.summarySource === "ai"
                ? String(runMeta.summary || "").trim() !== visibleAssistantBodyText
                  ? String(runMeta.summary || "").trim()
                  : ""
                : "";
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
              const hasPendingUserInputInRender = runMeta?.status === "running"
                && runSegmentsForRender.some(
                  (segment) => segment.status === "running" && isUserInputPendingSegment(segment),
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
              const renderRunSegmentGroup = (group: AssistantRunSegmentGroup, segmentKeyPrefix = "") => {
                if (group.kind === "divider") {
                  return (
                    <AriContainer
                      key={`${segmentKeyPrefix}${group.key}`}
                      className="desk-run-divider desk-run-divider-static desk-run-stage-divider"
                      padding={0}
                    >
                      <span className="desk-run-divider-line" />
                      <span className="desk-run-divider-text">
                        {group.title}
                      </span>
                      <span className="desk-run-divider-line" />
                    </AriContainer>
                  );
                }
                return (
                  <AriContainer key={`${segmentKeyPrefix}${group.key}`} className="desk-run-group" padding={0}>
                    {String(group.title || "").trim() ? (
                      <AriTypography
                        className="desk-run-intro"
                        variant="body"
                        value={group.title}
                      />
                    ) : null}
                    <AriContainer className="desk-run-group-steps" padding={0}>
                      {group.steps.map((step) => renderRunSegment(step, segmentKeyPrefix))}
                    </AriContainer>
                  </AriContainer>
                );
              };
              const messageContent = useRunLayout && runMeta ? (
                <AriContainer className="desk-run-flow" padding={0}>
                  {visibleAssistantBodyText ? (
                    <AriContainer className="desk-run-body" padding={0}>
                      <ChatMarkdown content={visibleAssistantBodyText} />
                    </AriContainer>
                  ) : null}
                  {runMeta.status === "running" ? (
                    <AriContainer className="desk-run-segments" padding={0}>
                      {runSegmentGroups.map((group) => renderRunSegmentGroup(group))}
                      {!hasPendingApprovalInRender && !hasPendingUserInputInRender && runningIndicatorText ? (
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
                          {runSegmentGroups.map((group) => renderRunSegmentGroup(group, "collapsed-"))}
                        </AriContainer>
                      ) : null}
                      {(runMeta.status === "failed" && failureSummary) || visibleRunSummaryText ? (
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
                            content={visibleRunSummaryText}
                          />
                        )}
                        </AriContainer>
                      ) : null}
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
                      <AriTooltip content={t("编辑")} position="top">
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
                      <AriTooltip content={t("重试")} position="top">
                        <AriButton
                          ghost
                          size="sm"
                          icon="refresh"
                          aria-label={t("重试消息")}
                          disabled={sending}
                          onClick={() => {
                            void handleRetryAssistantMessage(index);
                          }}
                        />
                      </AriTooltip>
                    )}
                    <AriTooltip content={t("复制")} position="top">
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
          ) : activeUserInputSegment ? (
            <AriCard className="desk-action-slot desk-action-slot-info desk-action-slot-user-input">
              <AriFlex align="center" space={8}>
                <AriIcon name="help" />
                <AriTypography variant="h4" value={t("需要你做几个决定")} />
              </AriFlex>
              <AriTypography
                variant="caption"
                value={t("这些问题会直接影响当前实现方向；提交后智能体会继续执行。")}
              />
              <AriContainer className="desk-user-input-question-list" padding={0}>
                {activeUserInputQuestions.map((question, questionIndex) => {
                  const draft = activeUserInputDrafts[question.id];
                  const customValue = String(draft?.customValue || "");
                  return (
                    <AriContainer
                      key={`${activeUserInputRequestId}-${question.id}`}
                      className="desk-user-input-question"
                      padding={0}
                    >
                      <AriTypography
                        variant="caption"
                        value={`${questionIndex + 1}. ${question.header}`}
                      />
                      <AriTypography
                        variant="body"
                        value={question.question}
                      />
                      <AriContainer className="desk-user-input-option-list" padding={0}>
                        {question.options.map((option, optionIndex) => {
                          const isActive = draft?.selectedOptionIndex === optionIndex && !customValue.trim();
                          return (
                            <button
                              key={`${question.id}-option-${optionIndex}`}
                              type="button"
                              className={`desk-user-input-option ${isActive ? "is-active" : ""}`.trim()}
                              onClick={() => {
                                handleSelectUserInputOption(
                                  activeUserInputRequestId,
                                  question.id,
                                  optionIndex,
                                );
                              }}
                            >
                              <AriContainer className="desk-user-input-option-main" padding={0}>
                                <AriTypography
                                  className="desk-user-input-option-index"
                                  value={`${optionIndex + 1}.`}
                                />
                                <AriContainer className="desk-user-input-option-copy" padding={0}>
                                  <AriTypography
                                    className="desk-user-input-option-label"
                                    variant="body"
                                    value={option.label}
                                  />
                                  <AriTypography
                                    className="desk-user-input-option-description"
                                    variant="caption"
                                    value={option.description}
                                  />
                                </AriContainer>
                              </AriContainer>
                            </button>
                          );
                        })}
                        <AriContainer className="desk-user-input-custom" padding={0}>
                          <AriTypography
                            className="desk-user-input-option-index"
                            value="4."
                          />
                          <AriInput.TextArea
                            className="desk-user-input-custom-input"
                            value={customValue}
                            onChange={(value: unknown) => {
                              handleChangeUserInputCustomValue(
                                activeUserInputRequestId,
                                question.id,
                                String(value || ""),
                              );
                            }}
                            variant="embedded"
                            rows={2}
                            autoSize={{ minRows: 2, maxRows: 5 }}
                            placeholder={t("其他，请告知 Codex 如何调整")}
                            enableHoverFocusEffect={false}
                          />
                        </AriContainer>
                      </AriContainer>
                    </AriContainer>
                  );
                })}
              </AriContainer>
              <AriFlex align="center" space={8} className="desk-action-slot-actions">
                <AriButton
                  ghost
                  icon="close"
                  label={t("忽略")}
                  disabled={!activeUserInputRequestId || userInputSubmittingRequestId === activeUserInputRequestId}
                  onClick={() => {
                    void handleIgnoreAgentUserInput(activeUserInputRequestId);
                  }}
                />
                <AriButton
                  color="primary"
                  icon="check"
                  label={t("提交")}
                  disabled={
                    !activeUserInputRequestId
                    || isUserInputSubmitDisabled
                    || userInputSubmittingRequestId === activeUserInputRequestId
                  }
                  onClick={() => {
                    void handleSubmitAgentUserInput(activeUserInputRequestId, activeUserInputQuestions);
                  }}
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
          {shouldShowTodoDock ? (
            <AriCard className="desk-action-slot desk-action-slot-info desk-action-slot-todo">
              <AriFlex align="center" justify="space-between" className="desk-todo-dock-head">
                <AriTypography variant="h4" value={t("任务计划")} />
                {todoDockProgressText ? (
                  <AriTypography variant="caption" value={todoDockProgressText} />
                ) : null}
              </AriFlex>
              <AriTypography variant="caption" value={todoDockCaption} />
              <AriContainer className="desk-todo-dock-list">
                {activeTodoDockItems.map((item, index) => (
                  <AriFlex
                    key={`${item.id}-${index}`}
                    align="center"
                    justify="space-between"
                    className="desk-todo-dock-item"
                  >
                    <AriTypography
                      className={`desk-todo-dock-item-text ${item.status === "completed" ? "is-completed" : ""}`}
                      value={item.content}
                    />
                    <AriTypography
                      className={`desk-todo-dock-status desk-todo-dock-status-${item.status}`}
                      variant="caption"
                      value={resolveTodoDockStatusLabel(item.status)}
                    />
                  </AriFlex>
                ))}
              </AriContainer>
            </AriCard>
          ) : null}
          <AriCard className="desk-prompt-card desk-session-prompt-card">
            {isActiveWorkspacePathMissing ? (
              <AriTypography
                className="desk-session-invalid-workspace-text"
                variant="caption"
                value={invalidWorkspacePromptMessage}
              />
            ) : null}
            <AriInput.TextArea
              className="desk-session-prompt-input"
              value={input}
              onChange={setInput}
              variant="embedded"
              disabled={isActiveWorkspacePathMissing}
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
                  disabled={sending || isActiveWorkspacePathMissing}
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
                {supportsProviderModelConfig(selectedProvider) ? (
                  <AriSelect
                    className="desk-prompt-toolbar-select desk-prompt-toolbar-select-model"
                    value={selectedModelName || undefined}
                    options={resolveProviderModelSelectOptions(selectedProvider, selectedModelName)}
                    placeholder={t("选择 {{providerLabel}} 模型", {
                      providerLabel: String(selectedAi?.providerLabel || selectedProvider || "").trim(),
                    })}
                    bordered={false}
                    onChange={handleChangeModel}
                    disabled={availableAiKeys.length === 0}
                  />
                ) : null}
                {supportsProviderModeConfig(selectedProvider) ? (
                  <AriSelect
                    className="desk-prompt-toolbar-select desk-prompt-toolbar-select-mode"
                    value={isAiProvider(selectedProvider)
                      ? (resolveAiProviderModeSelectValue(selectedProvider, selectedModeName) || undefined)
                      : (selectedModeName || undefined)}
                    options={resolveProviderModeSelectOptions(selectedProvider, selectedModeName)}
                    placeholder={t("选择 {{providerLabel}} 模式", {
                      providerLabel: String(selectedAi?.providerLabel || selectedProvider || "").trim(),
                    })}
                    bordered={false}
                    onChange={handleChangeMode}
                    disabled={availableAiKeys.length === 0}
                  />
                ) : null}
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
                <AriTypography
                  variant="caption"
                  className="desk-session-token-usage"
                  value={t("Token：{{value}}", {
                    value: formatTokenUsage(sessionCumulativeTokenUsage),
                  })}
                />
              </AriFlex>
              <AriButton
                type="default"
                color="brand"
                shape="round"
                icon={sending ? "pause" : "arrow_upward"}
                className="desk-prompt-icon-btn"
                disabled={!sending && isActiveWorkspacePathMissing}
                onClick={handlePromptPrimaryAction}
              />
            </AriFlex>
          </AriCard>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
