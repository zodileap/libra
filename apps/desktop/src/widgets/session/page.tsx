import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
  getCodeWorkspaceGroupById,
  getCodeWorkspaceIdBySessionId,
  getSessionRunState,
  getSessionMessages,
  resolveAgentSessionTitle,
  removeSessionRunState,
  SESSION_TITLE_UPDATED_EVENT,
  upsertModelProject,
  upsertSessionRunState,
  upsertSessionMessages,
  getAgentSessionMetaSnapshot,
  removeAgentSession,
  renameAgentSession,
  togglePinnedAgentSession,
  type SessionRunMeta as PersistedSessionRunMeta,
} from "../../shared/data";
import { updateRuntimeSessionStatus } from "../../shared/services/backend-api";
import {
  DEFAULT_BLENDER_BRIDGE_ADDR,
  normalizeInvokeError,
  normalizeInvokeErrorDetail,
  type NormalizedInvokeErrorDetail,
} from "../../shared/services/blender-bridge";
import {
  buildUiHintFromProtocolError,
  mapProtocolUiHint,
} from "../../shared/services/protocol-ui-hint";
import type {
  AgentKey,
  ModelAssetRecord,
  ModelEventRecord,
  ModelStepRecord,
  AiKeyItem,
  BlenderBridgeEnsureOptions,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  LoginUser,
  ModelMcpCapabilities,
  ProtocolUiHint,
} from "../../shared/types";
import { ChatMarkdown } from "../chat-markdown";
import {
  buildCodeWorkflowSkillExecutionPlan,
  buildCodeWorkflowPrompt,
  listCodeWorkflows,
  listModelWorkflows,
  runModelWorkflow,
} from "../../shared/workflow";
import { listInstalledSkills } from "../../modules/common/services";
import type { SkillCatalogItem } from "../../modules/common/services";
import { useDesktopHeaderSlot } from "../app-header/header-slot-context";
import type {
  CodeWorkflowDefinition,
  WorkflowDefinition,
  WorkflowStepRecord,
  WorkflowUiHint,
} from "../../shared/workflow";
import { resolveSessionUiConfig, type SessionAgentUiConfig } from "./config";
import {
  IS_BROWSER,
  COMMANDS,
  EVENT_AGENT_TEXT_STREAM,
  EVENT_MODEL_DEBUG_TRACE,
  EVENT_MODEL_SESSION_STREAM,
  isCancelErrorCode,
  STORAGE_KEYS,
  STREAM_KINDS,
} from "../../shared/constants";
import type {
  AgentTextStreamEvent,
  ModelDebugTraceEvent,
} from "../../shared/types";

// 描述:
//
//   - 定义会话页面组件入参，统一传入会话上下文、用户信息与能力依赖。
interface SessionPageProps {
  agentKey: AgentKey;
  sessionId: string;
  sessionUiConfig?: SessionAgentUiConfig;
  currentUser?: LoginUser | null;
  modelMcpCapabilities: ModelMcpCapabilities;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: (options?: BlenderBridgeEnsureOptions) => Promise<BlenderBridgeEnsureResult>;
  aiKeys: AiKeyItem[];
}

// 描述:
//
//   - 定义会话路由 state 结构，用于跨页透传自动提问与目录上下文。
interface SessionRouteState {
  autoPrompt?: string;
  workspaceId?: string;
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
}

// 描述:
//
//   - 定义通用智能体执行响应结构，兼容动作、步骤、事件与资产返回。
interface AgentRunResponse {
  trace_id: string;
  message: string;
  actions: string[];
  exported_file?: string;
  steps: ModelStepRecord[];
  events: ModelEventRecord[];
  assets: ModelAssetRecord[];
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
  args?: {
    command?: string;
    path?: string;
  };
}

// 描述:
//
//   - 定义文本流人工审批事件 data 的最小字段结构。
interface AgentRequireApprovalEventData {
  tool_name?: string;
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
//   - 定义模型会话重试等流程的响应结构。
interface ModelSessionRunResponse {
  trace_id: string;
  message: string;
  steps: ModelStepRecord[];
  events: ModelEventRecord[];
  assets: ModelAssetRecord[];
  exported_file?: string;
  ui_hint?: ProtocolUiHint;
}

// 描述:
//
//   - 定义会话消息结构，统一管理角色与文本内容。
interface MessageItem {
  id?: string;
  role: "user" | "assistant";
  text: string;
}

// 描述：
//
//   - 定义“按助手消息重试”清理结果，包含裁剪后的消息列表与被移除的助手消息 ID。
interface RetryTailPruneResult {
  messages: MessageItem[];
  removedAssistantMessageIds: string[];
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

// 描述:
//
//   - 定义模型会话流式事件结构，包含步骤与事件增量。
interface ModelSessionStreamEvent {
  session_id: string;
  trace_id: string;
  status: string;
  message: string;
  step?: ModelStepRecord;
  event?: ModelEventRecord;
}

// AgentTextStreamEvent 和 ModelDebugTraceEvent 已提取至 shared/types.ts 统一定义。

// 描述:
//
//   - 定义模型会话 AI 总结响应结构。
interface ModelSessionAiSummaryResponse {
  summary: string;
  prompt: string;
  raw_response: string;
  provider: string;
}

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
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

// 描述：把模型会话流式事件映射为“说明 + 步骤”结构，用于进行中轨迹渲染。
//
// Params:
//
//   - payload: 模型会话流式事件。
//   - segmentKey: 段唯一键。
//
// Returns:
//
//   - 轨迹段；若事件无有效文本则返回 null。
function mapModelStreamToRunSegment(
  payload: ModelSessionStreamEvent,
  segmentKey: string,
): AssistantRunSegment | null {
  const stepText = (payload.step?.summary || payload.event?.message || payload.message || "").trim();
  if (!stepText) {
    return null;
  }

  const eventName = payload.event?.event || "";
  const code = payload.step?.code || "";
  const status: AssistantRunSegmentStatus =
    payload.status === "failed" || payload.step?.status === "failed" || eventName === "step_failed"
      ? "failed"
      : payload.status === "finished" || payload.step?.status === "success" || eventName === "step_finished"
        ? "finished"
        : "running";

  let intro = status === "running" ? "正在处理当前步骤" : "当前步骤已完成";
  if (code) {
    if (status === "running") {
      intro = `正在执行「${code}」`;
    } else if (status === "failed") {
      intro = `「${code}」执行失败，准备恢复`;
    } else {
      intro = `已完成「${code}」`;
    }
  } else if (eventName === "step_started") {
    intro = "开始执行步骤";
  } else if (eventName === "branch_selected") {
    intro = "已选择执行分支";
  } else if (eventName === "operation_transaction_started") {
    intro = "开始创建执行事务";
  } else if (eventName === "operation_transaction_committed") {
    intro = "事务执行完成并提交";
  } else if (status === "failed") {
    intro = "执行中断，正在处理";
  }

  return {
    key: segmentKey,
    intro,
    step: stepText,
    status,
  };
}

// 描述:
//
//   - 解析文本流中的工具调用 data 结构，避免 any 带来的字段误用风险。
function resolveToolCallEventData(payload: AgentTextStreamEvent): AgentToolCallEventData {
  if (!payload.data || typeof payload.data !== "object") {
    return {};
  }
  const data = payload.data as Record<string, unknown>;
  const rawArgs = data.args;
  const args = rawArgs && typeof rawArgs === "object"
    ? (rawArgs as Record<string, unknown>)
    : undefined;
  return {
    name: typeof data.name === "string" ? data.name : undefined,
    args: {
      command: typeof args?.command === "string" ? args.command : undefined,
      path: typeof args?.path === "string" ? args.path : undefined,
    },
  };
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
    tool_name: typeof data.tool_name === "string" ? data.tool_name : undefined,
  };
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

// 描述：把代码智能体文本流事件映射为“说明 + 步骤”结构，用于统一的进行中轨迹渲染。
//
// Params:
//
//   - payload: 代码智能体文本流事件。
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
  if (payload.kind === STREAM_KINDS.DELTA) {
    return null;
  }

  if (payload.kind === STREAM_KINDS.STARTED) {
    return {
      key: segmentKey,
      intro: "已接收需求，开始规划执行",
      step: eventMessage || "正在准备执行本次任务…",
      status: "running",
    };
  }

  if (payload.kind === STREAM_KINDS.LLM_STARTED) {
    return {
      key: segmentKey,
      intro: "正在处理当前步骤",
      step: eventMessage || "模型会话已开始，正在生成执行计划…",
      status: "running",
    };
  }

  if (payload.kind === STREAM_KINDS.LLM_FINISHED) {
    return {
      key: segmentKey,
      intro: "当前步骤已完成",
      step: eventMessage || "模型生成阶段已完成，正在整理执行结果…",
      status: "finished",
    };
  }

  if (payload.kind === STREAM_KINDS.FINISHED || payload.kind === STREAM_KINDS.FINAL) {
    return {
      key: segmentKey,
      intro: "当前步骤已完成",
      step: eventMessage || "执行结束，正在输出最终结果…",
      status: "finished",
    };
  }

  if (payload.kind === STREAM_KINDS.CANCELLED) {
    return {
      key: segmentKey,
      intro: "任务已取消",
      step: eventMessage || "当前任务已终止，不再继续执行。",
      status: "finished",
    };
  }

  if (payload.kind === STREAM_KINDS.PLANNING) {
    return {
      key: segmentKey,
      intro: "智能体正在思考",
      step: eventMessage || "正在规划执行策略…",
      status: "running",
    };
  }

  if (payload.kind === STREAM_KINDS.TOOL_CALL_STARTED) {
    const data = resolveToolCallEventData(payload);
    let detail = "";
    if (data.name) {
      if (data.name === "run_shell" && data.args?.command) {
        detail = data.args.command.substring(0, 30);
        if (data.args.command.length > 30) detail += "...";
      } else if (data.args?.path) {
        detail = data.args.path;
      }
    }
    const suffix = detail ? ` [${detail}]` : "";
    return {
      key: segmentKey,
      intro: "正在执行工具",
      step: eventMessage ? `${eventMessage}${suffix}` : `正在调用系统工具…`,
      status: "running",
    };
  }

  if (payload.kind === STREAM_KINDS.TOOL_CALL_FINISHED) {
    return {
      key: segmentKey,
      intro: "工具执行结果",
      step: eventMessage || "任务步骤执行完成",
      status: "finished",
    };
  }

  if (payload.kind === STREAM_KINDS.HEARTBEAT) {
    return {
      key: segmentKey,
      intro: "任务处理中",
      step: eventMessage || "操作较长，请耐心等待…",
      status: "running",
    };
  }

  if (payload.kind === STREAM_KINDS.REQUIRE_APPROVAL) {
    const data = resolveApprovalEventData(payload);
    return {
      key: segmentKey,
      intro: "需要人工授权",
      step: eventMessage || `正在请求执行 ${data?.tool_name || "高危操作"}`,
      status: "running",
      data: payload.data, // 透传 approval_id 等
    };
  }

  if (payload.kind === STREAM_KINDS.ERROR) {
    return {
      key: segmentKey,
      intro: "执行中断，正在处理",
      step: eventMessage || "执行失败，请检查错误详情后重试。",
      status: "failed",
    };
  }

  if (!eventMessage) {
    return null;
  }

  return {
    key: segmentKey,
    intro: "执行进度更新",
    step: eventMessage,
    status: "running",
  };
}

// 描述：根据模型流式事件判断当前执行阶段，用于无事件时的“心跳提示”文案。
//
// Params:
//
//   - payload: 模型会话流式事件。
//
// Returns:
//
//   - 归一化后的执行阶段。
function resolveAssistantRunStage(payload: ModelSessionStreamEvent): AssistantRunStage {
  const eventName = payload.event?.event || "";
  const code = payload.step?.code || "";
  const lowerMessage = (payload.message || payload.event?.message || payload.step?.summary || "").toLowerCase();

  if (payload.status === "finished") {
    return "finalizing";
  }
  if (eventName.includes("transaction") || lowerMessage.includes("bridge") || lowerMessage.includes("blender")) {
    return "bridge";
  }
  if (code || eventName.includes("step") || eventName.includes("branch")) {
    return "executing";
  }
  return "planning";
}

// 描述：根据代码智能体文本流事件判断当前执行阶段，用于无事件时的“心跳提示”文案。
//
// Params:
//
//   - payload: 代码智能体文本流事件。
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
  if (lowerMessage.includes("bridge") || lowerMessage.includes("环境") || lowerMessage.includes("授权")) {
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
  agentKind: "model" | "code",
): AssistantRunSegment {
  let step = "正在同步执行状态，请稍候…";
  if (stage === "planning") {
    if (agentKind === "model") {
      step = heartbeatCount <= 1
        ? "正在解析需求并规划执行步骤…"
        : "规划中：正在确认本次操作所需的 Blender 指令…";
    } else {
      step = heartbeatCount <= 1
        ? "正在解析需求并规划执行步骤…"
        : "规划中：正在确认本次操作所需的工具链与任务顺序…";
    }
  } else if (stage === "bridge") {
    if (agentKind === "model") {
      step = heartbeatCount <= 1
        ? "正在检查 Blender Bridge 与当前会话连接状态…"
        : "已发出环境检查请求，等待 Blender 返回状态…";
    } else {
      step = heartbeatCount <= 1
        ? "正在检查当前执行环境与权限状态…"
        : "已发出环境检查请求，等待工具返回状态…";
    }
  } else if (stage === "executing") {
    if (agentKind === "model") {
      step = heartbeatCount <= 1
        ? "步骤正在执行中，等待 Blender 返回本步结果…"
        : "仍在执行当前步骤，正在持续收集事件回传…";
    } else {
      step = heartbeatCount <= 1
        ? "步骤正在执行中，等待工具返回本步结果…"
        : "仍在执行当前步骤，正在持续收集事件回传…";
    }
  } else if (stage === "finalizing") {
    step = "正在整理执行结果并生成最终总结…";
  }

  return {
    key: segmentKey,
    intro: "正在处理当前步骤",
    step,
    status: "running",
  };
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
  const detail = raw.replace(/^执行失败[:：]\s*/u, "").trim() || "执行过程中出现异常，请稍后重试。";
  const lower = detail.toLowerCase();
  if (lower.includes("provider") && lower.includes("not implemented")) {
    return {
      detail,
      hint: "当前 Provider 暂未实现该能力，请切换为 Codex CLI 后重试。",
    };
  }
  if (lower.includes("timed out") || detail.includes("超时")) {
    return {
      detail,
      hint: "执行超时，建议稍后重试，或切换执行策略后再试。",
    };
  }
  return {
    detail,
    hint: "请重试，或切换执行策略后再试。",
  };
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

// 描述:
//
//   - 匹配引号包裹的导出目录表达。
const OUTPUT_DIR_QUOTED_REGEX =
  /(?:导出到|导出至|输出到|保存到|export\s+to|save\s+to)\s*[“"']([^"”']+)[”"']/i;

// 描述:
//
//   - 匹配未使用引号包裹的导出目录表达。
const OUTPUT_DIR_PLAIN_REGEX =
  /(?:导出到|导出至|输出到|保存到|export\s+to|save\s+to)\s*(\/[^\s`"'，。；！？]+|[a-zA-Z]:\\[^\s`"'，。；！？]+)/i;

// 描述:
//
//   - 匹配提示词中的纹理图片路径。
const IMAGE_PATH_REGEX = /((?:\/|[a-zA-Z]:\\)[^\s`"'，。；！？]+?\.(?:png|jpe?g|webp|bmp|gif|tiff?))/i;

// 描述:
//
//   - 模型工作流当前选择项本地存储键。
const MODEL_WORKFLOW_SELECTED_KEY = "zodileap.desktop.model.selectedWorkflowId";

// 描述:
//
//   - 代码工作流当前选择项本地存储键。
const CODE_WORKFLOW_SELECTED_KEY = "zodileap.desktop.code.selectedWorkflowId";

// 描述:
//
//   - 技能选中状态存储键，统一引用全局常量避免硬编码。
const MODEL_SKILL_SELECTED_KEY = STORAGE_KEYS.MODEL_SKILL_SELECTED_IDS;
const CODE_SKILL_SELECTED_KEY = STORAGE_KEYS.CODE_SKILL_SELECTED_IDS;

// 描述:
//
//   - 连续心跳无新增事件的最大次数，超过后自动终止本轮执行，避免“永远进行中”。
const ASSISTANT_RUN_HEARTBEAT_STALE_LIMIT = 240;

// 描述：
//
//   - 从本地存储读取当前智能体最近一次选择的工作流 ID，未命中时返回空字符串。
//
// Params:
//
//   - storageKey: 本地存储键。
//
// Returns:
//
//   - 工作流 ID。
function readSelectedWorkflowId(storageKey: string): string {
  if (!IS_BROWSER) {
    return "";
  }
  const value = window.localStorage.getItem(storageKey);
  return String(value || "").trim();
}

// 描述：
//
//   - 从本地存储读取当前智能体最近一次选择的技能 ID 列表，未命中时返回空列表。
//   - 当前执行策略约束为“技能仅允许单选”，因此读取时会自动裁剪为 1 项。
//
// Params:
//
//   - storageKey: 本地存储键。
//
// Returns:
//
//   - 技能 ID 列表。
function readSelectedSkillIds(storageKey: string): string[] {
  if (!IS_BROWSER) {
    return [];
  }
  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const normalized = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return Array.from(new Set(normalized)).slice(0, 1);
  } catch (_err) {
    return [];
  }
}

// 描述：
//
//   - 构建“会话已选择技能”提示词片段，向代码智能体明确当前会话需优先遵循的技能上下文。
//
// Params:
//
//   - selectedSkills: 当前会话选择的技能列表。
//
// Returns:
//
//   - 可拼接到主提示词的技能片段；未选择技能时返回空字符串。
function buildSessionSkillPrompt(selectedSkills: SkillCatalogItem[]): string {
  if (selectedSkills.length === 0) {
    return "";
  }
  const lines = selectedSkills.map((item) => {
    const version = String(item.versions?.[0] || "").trim();
    const versionLabel = version ? `@${version}` : "";
    const description = String(item.description || "").trim();
    if (description) {
      return `- ${item.name}（${item.id}${versionLabel}）：${description}`;
    }
    return `- ${item.name}（${item.id}${versionLabel}）`;
  });
  return ["【会话技能】", ...lines].join("\n");
}

// 描述：
//
//   - 会话上下文拼接时保留的历史消息条数上限，避免提示词无限膨胀。
const CODE_CONTEXT_HISTORY_LIMIT = 8;

// 描述：
//
//   - 会话上下文中单条消息的最大字符数，超长时进行截断。
const CODE_CONTEXT_MESSAGE_CHAR_LIMIT = 600;

// 描述：
//
//   - “重试/继续”类短指令关键词；命中后会改写为可执行请求，避免模型误判“缺少需求”。
const CODE_RETRY_HINT_KEYWORDS = ["重试", "再试", "retry", "继续", "继续执行", "继续处理"];

// 描述：
//
//   - 压缩并裁剪单条会话消息文本，减少上下文噪声并控制 token 体积。
//
// Params:
//
//   - text: 原始消息文本。
//
// Returns:
//
//   - 规范化后的消息文本。
function normalizeCodeContextMessageText(text: string): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= CODE_CONTEXT_MESSAGE_CHAR_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, CODE_CONTEXT_MESSAGE_CHAR_LIMIT)}...(已截断)`;
}

// 描述：
//
//   - 判断当前输入是否为“仅重试提示”类短句。
//
// Params:
//
//   - prompt: 当前输入文本。
//
// Returns:
//
//   - true 表示当前输入不含明确任务细节，仅表达“重试/继续”意图。
function isRetryOnlyPrompt(prompt: string): boolean {
  const normalized = String(prompt || "").trim().toLowerCase();
  return CODE_RETRY_HINT_KEYWORDS.includes(normalized);
}

// 描述：
//
//   - 为代码智能体构建“历史上下文 + 当前请求”的提示词，确保“重试”场景不会丢失前文语义。
//
// Params:
//
//   - historyMessages: 当前会话已存在的历史消息。
//   - currentPrompt: 当前用户输入。
//   - workspacePath: 当前会话绑定的项目目录路径。
//
// Returns:
//
//   - 拼接后的上下文提示词。
function buildCodeSessionContextPrompt(
  historyMessages: MessageItem[],
  currentPrompt: string,
  workspacePath?: string,
): string {
  const normalizedCurrentPrompt = String(currentPrompt || "").trim();
  if (!normalizedCurrentPrompt) {
    return "";
  }
  const normalizedWorkspacePath = String(workspacePath || "").trim();
  const historyLines = historyMessages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role === "user" ? "用户" : "助手",
      text: normalizeCodeContextMessageText(item.text),
    }))
    .filter((item) => item.text.length > 0)
    .slice(-CODE_CONTEXT_HISTORY_LIMIT)
    .map((item, index) => `${index + 1}. ${item.role}：${item.text}`);

  if (historyLines.length === 0) {
    if (normalizedWorkspacePath) {
      return [
        "【当前项目】",
        `路径：${normalizedWorkspacePath}`,
        "约束：仅基于该目录进行分析与修改，不要切换到其它工程。",
        "",
        "【当前请求】",
        normalizedCurrentPrompt,
      ].join("\n");
    }
    return normalizedCurrentPrompt;
  }
  const normalizedRequest = isRetryOnlyPrompt(normalizedCurrentPrompt)
    ? "请基于以上会话上下文继续上一轮任务并直接给出可执行结果，不要要求我重复需求。"
    : normalizedCurrentPrompt;
  const workspaceLines = normalizedWorkspacePath
    ? [
      "【当前项目】",
      `路径：${normalizedWorkspacePath}`,
      "约束：仅基于该目录进行分析与修改，不要切换到其它工程。",
      "",
    ]
    : [];
  return [
    ...workspaceLines,
    "【会话上下文】",
    ...historyLines,
    "",
    "【当前请求】",
    normalizedRequest,
  ].join("\n");
}

// 描述:
//
//   - 清理导出路径尾部噪声字符，提升路径解析命中率。
//
// Params:
//
//   - path: 原始路径文本。
//
// Returns:
//
//   - 清理后的路径文本。
function trimOutputSuffix(path: string): string {
  let result = path.trim().replace(/[，。；！？、]+$/u, "");
  result = result.replace(/[)"'`”]+$/u, "");
  if ((result.startsWith("/") || /^[a-zA-Z]:\\/.test(result)) && /[中里]$/.test(result)) {
    result = result.slice(0, -1);
  }
  return result;
}

// 描述:
//
//   - 从提示词中提取导出目录路径。
//
// Params:
//
//   - prompt: 用户提示词。
//
// Returns:
//
//   - 导出目录；未命中返回 undefined。
function extractOutputDirFromPrompt(prompt: string): string | undefined {
  const quotedMatch = prompt.match(OUTPUT_DIR_QUOTED_REGEX);
  if (quotedMatch?.[1]) {
    const normalized = trimOutputSuffix(quotedMatch[1]);
    return normalized || undefined;
  }

  const plainMatch = prompt.match(OUTPUT_DIR_PLAIN_REGEX);
  if (plainMatch?.[1]) {
    const normalized = trimOutputSuffix(plainMatch[1]);
    return normalized || undefined;
  }

  return undefined;
}

// 描述：从用户输入中提取首个贴图路径，供完成总结文案引用。
//
// Params:
//
//   - prompt: 用户输入原文。
//
// Returns:
//
//   - 贴图路径；未命中时返回 undefined。
function extractTexturePathFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(IMAGE_PATH_REGEX);
  if (!match?.[1]) {
    return undefined;
  }
  return trimOutputSuffix(match[1]) || undefined;
}

// 描述：把模型步骤记录转换为用户可读的动作文案，避免暴露内部术语。
//
// Params:
//
//   - step: 模型步骤记录。
//   - texturePath: 用户输入中提取的贴图路径。
//
// Returns:
//
//   - 面向用户的单步总结文案。
function buildUserReadableStepLine(step: ModelStepRecord, texturePath?: string): string {
  const code = step.code || "unknown";
  const summary = (step.summary || "").trim();

  if (code === "new_file") {
    return "已新建 Blender 场景文件。";
  }
  if (code === "add_cube") {
    const name = summary.match(/`([^`]+)`/)?.[1];
    if (name) {
      return `已创建正方体对象「${name}」。`;
    }
    return "已创建一个正方体对象。";
  }
  if (code === "apply_texture_image") {
    if (texturePath) {
      return `已将贴图「${texturePath}」应用到目标对象材质。`;
    }
    return "已为目标对象应用贴图材质。";
  }

  if (summary) {
    return `已完成「${code}」：${summary}`;
  }
  return `已完成「${code}」步骤。`;
}

// 描述：构建模型执行的用户可读总结，突出“做了什么”和“最终结果”。
//
// Params:
//
//   - requestPrompt: 用户原始指令。
//   - steps: 模型步骤记录。
//   - exportedFile: 导出文件路径。
//   - bridgeRecovered: 是否发生过 Bridge 预检失败但已恢复。
//
// Returns:
//
//   - 可直接展示给用户的总结文本。
function buildUserReadableModelSummary(
  requestPrompt: string,
  steps: ModelStepRecord[],
  exportedFile?: string,
  bridgeRecovered = false,
): string {
  const successSteps = steps.filter((item) => item.status === "success");
  const failedSteps = steps.filter((item) => item.status === "failed");
  const texturePath = extractTexturePathFromPrompt(requestPrompt);
  const lines: string[] = ["已按你的需求完成本次模型操作。"];

  if (successSteps.length > 0) {
    lines.push("", "本次执行内容：");
    successSteps.forEach((step, index) => {
      lines.push(`${index + 1}. ${buildUserReadableStepLine(step, texturePath)}`);
    });
  } else {
    lines.push("", "本次未获取到可确认的成功步骤记录。");
  }

  if (failedSteps.length > 0) {
    lines.push("", `注意：仍有 ${failedSteps.length} 个步骤执行失败，请根据日志继续重试。`);
  }

  if (exportedFile) {
    lines.push("", `导出结果：${exportedFile}`);
  }

  if (bridgeRecovered) {
    lines.push("", "环境说明：执行前检测到 Bridge 短暂不可用，系统已自动恢复后继续执行。");
  }

  lines.push(
    "",
    `执行结果：成功 ${successSteps.length} 步${failedSteps.length > 0 ? `，失败 ${failedSteps.length} 步` : ""}。`,
  );
  return lines.join("\n").trim();
}
  // 描述：渲染通用会话页，统一承载 code/model 会话交互、流式渲染与工作流执行。

interface TraceRecord {
  traceId: string;
  source: string;
  code?: string;
  message: string;
}

// 描述：将单条步骤记录合并到现有步骤列表，按 index 覆盖同编号项，避免流式重复追加。
function mergeModelStepRecords(records: ModelStepRecord[], incoming?: ModelStepRecord): ModelStepRecord[] {
  if (!incoming) {
    return records;
  }
  const next = [...records];
  const hit = next.findIndex((item) => item.index === incoming.index);
  if (hit >= 0) {
    next[hit] = incoming;
    return next;
  }
  next.push(incoming);
  next.sort((a, b) => a.index - b.index);
  return next;
}

// 描述：将单条事件记录合并到现有事件列表，按 event+step_index+timestamp 去重，避免流式抖动。
function mergeModelEventRecords(records: ModelEventRecord[], incoming?: ModelEventRecord): ModelEventRecord[] {
  if (!incoming) {
    return records;
  }
  const exists = records.some((item) =>
    item.event === incoming.event
    && item.step_index === incoming.step_index
    && item.timestamp_ms === incoming.timestamp_ms);
  if (exists) {
    return records;
  }
  return [...records, incoming];
}

// 描述：按消息 ID 替换现有消息文本，若未命中则追加到末尾。
function upsertAssistantMessageById(messages: MessageItem[], messageId: string, text: string): MessageItem[] {
  if (!messageId) {
    return [...messages, { role: "assistant", text }];
  }
  const hit = messages.findIndex((item) => item.id === messageId);
  if (hit < 0) {
    return [...messages, { id: messageId, role: "assistant", text }];
  }
  const next = [...messages];
  next[hit] = {
    ...next[hit],
    role: "assistant",
    text,
  };
  return next;
}

// 描述：按目标助手消息索引清理其后的“同轮助手尾部消息”，用于重试时覆盖旧结果。
//
// Params:
//
//   - messages: 当前会话消息列表。
//   - assistantMessageIndex: 触发重试的助手消息索引。
//
// Returns:
//
//   - 清理后的消息列表与被移除消息 ID。
function pruneAssistantRetryTail(
  messages: MessageItem[],
  assistantMessageIndex: number,
): RetryTailPruneResult {
  if (assistantMessageIndex < 0 || assistantMessageIndex >= messages.length) {
    return {
      messages: [...messages],
      removedAssistantMessageIds: [],
    };
  }
  let rangeEnd = messages.length;
  for (let cursor = assistantMessageIndex + 1; cursor < messages.length; cursor += 1) {
    if (messages[cursor]?.role === "user") {
      rangeEnd = cursor;
      break;
    }
  }
  if (rangeEnd <= assistantMessageIndex + 1) {
    return {
      messages: [...messages],
      removedAssistantMessageIds: [],
    };
  }

  const removedAssistantMessageIds: string[] = [];
  const nextMessages: MessageItem[] = [];
  messages.forEach((item, index) => {
    const inPruneRange = index > assistantMessageIndex && index < rangeEnd;
    if (inPruneRange && item.role === "assistant") {
      const messageId = String(item.id || "").trim();
      if (messageId) {
        removedAssistantMessageIds.push(messageId);
      }
      return;
    }
    nextMessages.push(item);
  });

  return {
    messages: nextMessages,
    removedAssistantMessageIds,
  };
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
    ? input.segments
      .filter((item) => item && typeof item.key === "string")
      .map<AssistantRunSegment>((item) => ({
        key: String(item.key),
        intro: String(item.intro || "").trim(),
        step: String(item.step || "").trim(),
        status:
          item.status === "failed"
            ? "failed"
            : item.status === "finished"
              ? "finished"
              : "running",
      }))
      .filter((item) => item.intro || item.step)
      .slice(-160)
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
  modelMcpCapabilities,
  blenderBridgeRuntime,
  ensureBlenderBridge,
  aiKeys,
}: SessionPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state || {}) as SessionRouteState;
  const routeAutoPrompt = String(routeState.autoPrompt || "").trim();
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
  const [stepRecords, setStepRecords] = useState<ModelStepRecord[]>([]);
  const [eventRecords, setEventRecords] = useState<ModelEventRecord[]>([]);
  const [assetRecords, setAssetRecords] = useState<ModelAssetRecord[]>([]);
  const [workflowStepRecords, setWorkflowStepRecords] = useState<WorkflowStepRecord[]>([]);
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
  // 描述：解析当前会话 UI 配置，未传入时按智能体类型回退默认配置。
  const resolvedSessionUiConfig = sessionUiConfig || resolveSessionUiConfig(agentKey);
  const isWorkflowSession = resolvedSessionUiConfig.sessionKind === "workflow";
  const normalizedAgentKey = agentKey;
  const [sessionTitle, setSessionTitle] = useState(() => resolveAgentSessionTitle(normalizedAgentKey, sessionId));
  const sessionStorageKey = `${normalizedAgentKey}:${sessionId || "__none__"}`;
  const title = sessionTitle || resolveAgentSessionTitle(normalizedAgentKey, sessionId);
  const workspaceIdFromRouteState = String(routeState.workspaceId || "").trim();
  // 描述：从 URL 查询参数中提取目录上下文，兼容侧边栏与页面跳转携带方式。
  const workspaceIdFromQuery = useMemo(
    () => new URLSearchParams(location.search).get("workspaceId")?.trim() || "",
    [location.search],
  );
  // 描述：从本地会话绑定关系中恢复 code 会话所属目录。
  const workspaceIdFromBinding = useMemo(
    () => (normalizedAgentKey === "code" ? getCodeWorkspaceIdBySessionId(sessionId) : ""),
    [normalizedAgentKey, sessionId],
  );
  // 描述：解析当前 code 会话所属目录详情（路径、名称、依赖规则），用于会话提示与规则校验。
  const activeCodeWorkspace = useMemo(() => {
    if (normalizedAgentKey !== "code") {
      return null;
    }
    const workspaceId = workspaceIdFromRouteState || workspaceIdFromQuery || workspaceIdFromBinding;
    if (!workspaceId) {
      return null;
    }
    return getCodeWorkspaceGroupById(workspaceId);
  }, [normalizedAgentKey, workspaceIdFromBinding, workspaceIdFromQuery, workspaceIdFromRouteState]);
  // 描述：提取当前 code 会话一级目录名称，展示在标题后方。
  const codeWorkspaceGroupName = useMemo(() => {
    return String(activeCodeWorkspace?.name || "").trim();
  }, [activeCodeWorkspace?.name]);
  // 描述：当会话处于二级目录（如 code workspace）时，在标题后展示一级菜单名（纯名字）。
  const sessionHeadParentHint = codeWorkspaceGroupName;
  const isSessionPinned = useMemo(
    () => getAgentSessionMetaSnapshot().pinnedIds.includes(sessionId),
    [sessionId, sessionMenuVersion],
  );
  const sessionHeadMenuItems = useMemo(
    () => [
      {
        key: "pin",
        label: isSessionPinned ? "取消固定会话" : "固定会话",
      },
      {
        key: "copy_session",
        label: "复制会话内容",
      },
      {
        key: "rename",
        label: "重命名会话",
      },
      {
        key: "delete",
        label: "删除会话",
      },
    ],
    [isSessionPinned],
  );
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [assistantRunMetaMap, setAssistantRunMetaMap] = useState<Record<string, AssistantRunMeta>>({});
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
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  // 描述：解析当前选中的 Provider，未命中时回退到列表首项。
  const selectedAi = useMemo(
    () => availableAiKeys.find((item) => item.provider === selectedProvider) || availableAiKeys[0] || null,
    [availableAiKeys, selectedProvider],
  );
  const [selectedModelWorkflowId, setSelectedModelWorkflowId] = useState<string>(
    () => readSelectedWorkflowId(MODEL_WORKFLOW_SELECTED_KEY),
  );
  const [selectedCodeWorkflowId, setSelectedCodeWorkflowId] = useState<string>(
    () => readSelectedWorkflowId(CODE_WORKFLOW_SELECTED_KEY),
  );
  const [selectedModelSkillIds, setSelectedModelSkillIds] = useState<string[]>(
    () => readSelectedSkillIds(MODEL_SKILL_SELECTED_KEY),
  );
  const [selectedCodeSkillIds, setSelectedCodeSkillIds] = useState<string[]>(
    () => readSelectedSkillIds(CODE_SKILL_SELECTED_KEY),
  );
  const [workflowSkillModalVisible, setWorkflowSkillModalVisible] = useState(false);
  const [draftWorkflowId, setDraftWorkflowId] = useState("");
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([]);
  const [installedSkills, setInstalledSkills] = useState<SkillCatalogItem[]>([]);
  const modelWorkflows = useMemo<WorkflowDefinition[]>(() => listModelWorkflows(), []);
  const codeWorkflows = useMemo<CodeWorkflowDefinition[]>(
    () => listCodeWorkflows(),
    [],
  );
  const selectedModelWorkflow = useMemo<WorkflowDefinition | null>(() => {
    if (selectedModelSkillIds.length > 0) {
      return null;
    }
    return modelWorkflows.find((item) => item.id === selectedModelWorkflowId) || modelWorkflows[0] || null;
  }, [modelWorkflows, selectedModelSkillIds.length, selectedModelWorkflowId]);
  const selectedCodeWorkflow = useMemo<CodeWorkflowDefinition | null>(() => {
    if (selectedCodeSkillIds.length > 0) {
      return null;
    }
    return codeWorkflows.find((item) => item.id === selectedCodeWorkflowId) || codeWorkflows[0] || null;
  }, [codeWorkflows, selectedCodeSkillIds.length, selectedCodeWorkflowId]);
  const workflowMenuItems = useMemo(() => {
    if (isWorkflowSession) {
      return modelWorkflows.map((workflow) => ({
        key: workflow.id,
        label: workflow.name,
        description: String(workflow.description || "").trim(),
      }));
    }
    return codeWorkflows.map((workflow) => ({
      key: workflow.id,
      label: workflow.name,
      description: String(workflow.description || "").trim(),
    }));
  }, [codeWorkflows, isWorkflowSession, modelWorkflows]);
  const activeSelectedSkillIds = isWorkflowSession ? selectedModelSkillIds : selectedCodeSkillIds;
  const selectedSessionSkills = useMemo(
    () => installedSkills.filter((item) => activeSelectedSkillIds.includes(item.id)),
    [activeSelectedSkillIds, installedSkills],
  );
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
      return selectedSessionSkills[0]?.name || "技能";
    }
    const workflowLabel = isWorkflowSession
      ? selectedModelWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel
      : selectedCodeWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel;
    return workflowLabel;
  }, [
    isWorkflowSession,
    resolvedSessionUiConfig.workflowFallbackLabel,
    selectedCodeWorkflow?.name,
    selectedModelWorkflow?.name,
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
  const activeSelectedWorkflowId = isWorkflowSession
    ? selectedModelWorkflow?.id || ""
    : selectedCodeWorkflow?.id || "";

  // 描述：以下 refs 用于维护流式渲染、去重、心跳与定时器状态，避免高频更新触发重复渲染。
  const streamMessageIdRef = useRef("");
  const stepRecordsRef = useRef<ModelStepRecord[]>([]);
  const eventRecordsRef = useRef<ModelEventRecord[]>([]);
  const streamDisplayedTextRef = useRef("");
  const streamLatestTextRef = useRef("");
  const streamRenderPendingRef = useRef(false);
  const streamRenderFrameRef = useRef<number | null>(null);
  const sessionMessagePersistTimerRef = useRef<number | null>(null);
  const debugSnapshotTimerRef = useRef<number | null>(null);
  const modelStreamRecordFlushTimerRef = useRef<number | null>(null);
  const activeAgentStreamTraceRef = useRef("");
  const agentStreamTextBufferRef = useRef("");
  const agentStreamSeenKeysRef = useRef<Set<string>>(new Set());
  const modelStreamSeenKeysRef = useRef<Set<string>>(new Set());
  const modelStreamDebugSeenKeysRef = useRef<Set<string>>(new Set());
  const assistantRunHeartbeatTimerRef = useRef<number | null>(null);
  const assistantRunLastActivityAtRef = useRef(0);
  const assistantRunHeartbeatCountRef = useRef(0);
  const assistantRunAgentKindRef = useRef<"model" | "code">("code");
  const assistantRunStageRef = useRef<AssistantRunStage>("planning");
  const assistantRunStatusRef = useRef<AssistantRunMeta["status"] | "idle">("idle");
  const autoPromptDispatchedRef = useRef(false);

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

  // 描述：清理调试快照定时器，避免 Dev 调试面板在流式期间过高频刷新。
  const clearDebugSnapshotTimer = () => {
    if (debugSnapshotTimerRef.current !== null) {
      window.clearTimeout(debugSnapshotTimerRef.current);
      debugSnapshotTimerRef.current = null;
    }
  };

  // 描述：清理模型步骤/事件刷新的节流定时器，避免会话切换时写入旧会话状态。
  const clearModelStreamRecordFlushTimer = () => {
    if (modelStreamRecordFlushTimerRef.current !== null) {
      window.clearTimeout(modelStreamRecordFlushTimerRef.current);
      modelStreamRecordFlushTimerRef.current = null;
    }
  };

  // 描述：清理模型会话心跳提示定时器，避免会话结束后继续追加“进行中”段落。
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

  // 描述：把模型会话流式事件映射进运行轨迹，并按唯一键去重防止重复刷屏。
  const appendModelStreamEventToMessage = (payload: ModelSessionStreamEvent) => {
    const messageId = streamMessageIdRef.current;
    if (!messageId) {
      return;
    }
    const eventKey = payload.event
      ? `event:${payload.event.event}:${payload.event.step_index ?? -1}:${payload.event.timestamp_ms}`
      : payload.step
        ? `step:${payload.step.index}:${payload.step.status}:${payload.step.elapsed_ms}:${payload.step.summary}`
        : `status:${payload.status}:${payload.message}`;
    if (modelStreamSeenKeysRef.current.has(eventKey)) {
      return;
    }
    modelStreamSeenKeysRef.current.add(eventKey);
    // 描述：收到真实流式事件后重置心跳计数，代表执行链路仍在持续推进。
    assistantRunHeartbeatCountRef.current = 0;
    assistantRunLastActivityAtRef.current = Date.now();
    assistantRunStageRef.current = resolveAssistantRunStage(payload);
    const runSegment = mapModelStreamToRunSegment(payload, eventKey);
    if (runSegment) {
      appendAssistantRunSegment(messageId, runSegment);
    }
  };

  // 描述：节流同步模型步骤与事件到状态，避免流式期间每个事件都触发整页重渲染。
  const scheduleModelRecordFlush = (forceImmediate = false) => {
    const flush = () => {
      modelStreamRecordFlushTimerRef.current = null;
      setStepRecords(stepRecordsRef.current);
      setEventRecords(eventRecordsRef.current);
    };
    if (forceImmediate) {
      clearModelStreamRecordFlushTimer();
      flush();
      return;
    }
    if (modelStreamRecordFlushTimerRef.current !== null) {
      return;
    }
    modelStreamRecordFlushTimerRef.current = window.setTimeout(flush, 220);
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
      const last = current.segments[current.segments.length - 1];
      const isDuplicate = Boolean(
        last
        && last.intro === segment.intro
        && last.step === segment.step
        && last.status === segment.status,
      );
      if (isDuplicate) {
        return prev;
      }
      // 描述：保证同一时刻仅有一个 running 段，避免出现多个“同时闪烁”的进行中步骤。
      const normalizedSegments = current.segments.map((item) =>
        item.status === "running" ? { ...item, status: "finished" as const } : item);
      return {
        ...prev,
        [messageId]: {
          ...current,
          segments: [...normalizedSegments, segment].slice(-160),
        },
      };
    });
  };

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

      const idleMs = Date.now() - assistantRunLastActivityAtRef.current;
      if (idleMs >= 1400) {
        assistantRunHeartbeatCountRef.current += 1;
        if (assistantRunHeartbeatCountRef.current >= ASSISTANT_RUN_HEARTBEAT_STALE_LIMIT) {
          const timeoutSummary = assistantRunAgentKindRef.current === "model"
            ? "执行超时：长时间未收到模型执行结果，请重试。"
            : "执行超时：长时间未收到工具执行结果，请重试。";
          setStreamingAssistantTarget(timeoutSummary);
          finishAssistantRunMessage(messageId, "failed", timeoutSummary);
          setStatus(timeoutSummary);
          setSending(false);
          if (!isWorkflowSession) {
            activeAgentStreamTraceRef.current = "";
          }
          clearAssistantRunHeartbeatTimer();
          return;
        }
        appendAssistantRunSegment(
          messageId,
          buildAssistantHeartbeatSegment(
            assistantRunStageRef.current,
            assistantRunHeartbeatCountRef.current,
            `heartbeat-${Date.now()}`,
            assistantRunAgentKindRef.current,
          ),
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
    clearDebugSnapshotTimer();
    clearModelStreamRecordFlushTimer();
    clearAssistantRunHeartbeatTimer();
    streamMessageIdRef.current = "";
    stepRecordsRef.current = [];
    eventRecordsRef.current = [];
    streamDisplayedTextRef.current = "";
    streamLatestTextRef.current = "";
    activeAgentStreamTraceRef.current = "";
    agentStreamTextBufferRef.current = "";
    agentStreamSeenKeysRef.current.clear();
    modelStreamSeenKeysRef.current.clear();
    modelStreamDebugSeenKeysRef.current.clear();
    assistantRunHeartbeatCountRef.current = 0;
    assistantRunLastActivityAtRef.current = 0;
    assistantRunAgentKindRef.current = "code";
    assistantRunStageRef.current = "planning";
    assistantRunStatusRef.current = "idle";
    autoPromptDispatchedRef.current = false;
    setUiHint(null);
    setTraceRecords([]);
    setDebugFlowRecords([]);
    setAssistantRunMetaMap({});
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
    const runSnapshot = getSessionRunState(normalizedAgentKey, sessionId);
    let nextMessages: MessageItem[] = stored.length > 0 ? stored : [];
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
        const recoveredText = String(
          recoveredMeta?.summary
          || recoveredMeta?.segments.slice(-1)[0]?.step
          || "正在处理当前步骤…",
        ).trim();
        nextMessages = upsertAssistantMessageById(nextMessages, recoveredMessageId, recoveredText);
        streamMessageIdRef.current = recoveredMessageId;
        streamDisplayedTextRef.current = recoveredText;
        streamLatestTextRef.current = recoveredText;
        if (recoveredMeta?.status === "running") {
          assistantRunStatusRef.current = "running";
          assistantRunLastActivityAtRef.current = Date.now();
          assistantRunAgentKindRef.current = normalizedAgentKey === "model" ? "model" : "code";
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
  }, [isWorkflowSession, normalizedAgentKey, sessionId, sessionStorageKey]);

  useEffect(() => () => {
    stopStreamTypingTimer();
    clearSessionMessagePersistTimer();
    clearDebugSnapshotTimer();
    clearModelStreamRecordFlushTimer();
    clearAssistantRunHeartbeatTimer();
  }, []);

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

  useEffect(() => {
    if (!sessionId || !messagesHydrated || hydratedSessionKey !== sessionStorageKey) {
      return;
    }
    if (Object.keys(assistantRunMetaMap).length === 0) {
      removeSessionRunState(normalizedAgentKey, sessionId);
      return;
    }
    upsertSessionRunState({
      agentKey: normalizedAgentKey,
      sessionId,
      activeMessageId: String(streamMessageIdRef.current || "").trim(),
      sending,
      runMetaMap: assistantRunMetaMap,
      updatedAt: Date.now(),
    });
  }, [
    assistantRunMetaMap,
    hydratedSessionKey,
    messagesHydrated,
    normalizedAgentKey,
    sending,
    sessionId,
    sessionStorageKey,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    clearDebugSnapshotTimer();
    const dispatchDelay = sending ? 360 : 120;
    debugSnapshotTimerRef.current = window.setTimeout(() => {
      debugSnapshotTimerRef.current = null;
      window.dispatchEvent(
        new CustomEvent("zodileap:session-debug", {
          detail: {
            sessionId,
            agentKey: normalizedAgentKey,
            title,
            status,
            workflowStepRecords: workflowStepRecords.slice(-20),
            stepRecords: stepRecords.slice(-20),
            eventRecords: eventRecords.slice(-20),
            assetRecords: assetRecords.slice(-20),
            traceRecords: traceRecords.slice(0, 20),
            debugFlowRecords: debugFlowRecords.slice(0, 120),
            messageCount: messages.length,
            timestamp: Date.now(),
          },
        }),
      );
    }, dispatchDelay);
    return () => {
      clearDebugSnapshotTimer();
    };
  }, [
    assetRecords,
    debugFlowRecords,
    eventRecords,
    messages.length,
    normalizedAgentKey,
    sessionId,
    sending,
    status,
    stepRecords,
    traceRecords,
    title,
    workflowStepRecords,
  ]);

  useEffect(() => {
    if (availableAiKeys.length === 0) {
      setSelectedProvider("");
      return;
    }
    if (!availableAiKeys.some((item) => item.provider === selectedProvider)) {
      setSelectedProvider(availableAiKeys[0].provider);
    }
  }, [availableAiKeys, selectedProvider]);

  // 描述：加载“已安装技能”列表，供会话中的“工作流/技能”弹窗选择器使用。
  useEffect(() => {
    let disposed = false;
    const loadSkills = async () => {
      try {
        const skills = await listInstalledSkills();
        if (disposed) {
          return;
        }
        setInstalledSkills(skills);
      } catch (_err) {
        if (disposed) {
          return;
        }
        setInstalledSkills([]);
      }
    };
    void loadSkills();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedModelWorkflow) {
      return;
    }
    if (selectedModelWorkflow.id !== selectedModelWorkflowId) {
      setSelectedModelWorkflowId(selectedModelWorkflow.id);
      return;
    }
    if (IS_BROWSER) {
      window.localStorage.setItem(MODEL_WORKFLOW_SELECTED_KEY, selectedModelWorkflow.id);
    }
  }, [selectedModelWorkflow, selectedModelWorkflowId]);

  useEffect(() => {
    if (!selectedCodeWorkflow) {
      return;
    }
    if (selectedCodeWorkflow.id !== selectedCodeWorkflowId) {
      setSelectedCodeWorkflowId(selectedCodeWorkflow.id);
      return;
    }
    if (IS_BROWSER) {
      window.localStorage.setItem(CODE_WORKFLOW_SELECTED_KEY, selectedCodeWorkflow.id);
    }
  }, [selectedCodeWorkflow, selectedCodeWorkflowId]);

  // 描述：持久化模型会话选择的技能列表，保持跨会话复用。
  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }
    window.localStorage.setItem(MODEL_SKILL_SELECTED_KEY, JSON.stringify(selectedModelSkillIds));
  }, [selectedModelSkillIds]);

  // 描述：持久化代码会话选择的技能列表，保持跨会话复用。
  useEffect(() => {
    if (!IS_BROWSER) {
      return;
    }
    window.localStorage.setItem(CODE_SKILL_SELECTED_KEY, JSON.stringify(selectedCodeSkillIds));
  }, [selectedCodeSkillIds]);

  useEffect(() => {
    if (!isWorkflowSession || !sessionId) {
      return;
    }
    void invoke<ModelSessionRunResponse>(COMMANDS.GET_MODEL_SESSION_RECORDS, { sessionId })
      .then((records) => {
        setStepRecords(records.steps || []);
        setEventRecords(records.events || []);
        setAssetRecords(records.assets || []);
      })
      .catch(() => {
        // 会话首次打开或后端无记录时忽略
      });
  }, [isWorkflowSession, sessionId]);

  useEffect(() => {
    if (!isWorkflowSession || !sessionId) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<ModelSessionStreamEvent>(EVENT_MODEL_SESSION_STREAM, (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      if (!payload || payload.session_id !== sessionId) {
        return;
      }
      const nextSteps = mergeModelStepRecords(stepRecordsRef.current, payload.step);
      const nextEvents = mergeModelEventRecords(eventRecordsRef.current, payload.event);
      stepRecordsRef.current = nextSteps;
      eventRecordsRef.current = nextEvents;
      if (payload.status === "running") {
        scheduleModelRecordFlush(false);
      } else {
        scheduleModelRecordFlush(true);
        appendTraceRecord({
          traceId: payload.trace_id || `trace-local-${Date.now()}`,
          source: "model:stream",
          message: payload.message || "模型会话流式更新",
        });
      }
      if (payload.status === "failed") {
        setStatus(`执行失败：${payload.message}`);
      } else if (payload.status === "finished") {
        setStatus("执行完成");
      } else {
        setStatus("智能体执行中...");
      }
      const debugKey = payload.event
        ? `event:${payload.event.event}:${payload.event.timestamp_ms}`
        : payload.step
          ? `step:${payload.step.index}:${payload.step.status}:${payload.step.elapsed_ms}`
          : `status:${payload.status}:${payload.message}`;
      if (!modelStreamDebugSeenKeysRef.current.has(debugKey)) {
        modelStreamDebugSeenKeysRef.current.add(debugKey);
        appendDebugFlowRecord(
          "ui",
          "model_session_stream",
          `流式事件(${payload.status})`,
          JSON.stringify({
            message: payload.message,
            step: payload.step
              ? {
                index: payload.step.index,
                code: payload.step.code,
                status: payload.step.status,
                elapsed_ms: payload.step.elapsed_ms,
                summary: payload.step.summary,
              }
              : null,
            event: payload.event
              ? {
                event: payload.event.event,
                step_index: payload.event.step_index,
                message: payload.event.message,
              }
              : null,
          }, null, 2),
        );
      }
      appendModelStreamEventToMessage(payload);
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // 流式监听初始化失败时不阻断主流程，保留最终响应展示。
      });
    return () => {
      disposed = true;
      clearModelStreamRecordFlushTimer();
      if (unlisten) {
        unlisten();
      }
    };
  }, [isWorkflowSession, sessionId]);

  useEffect(() => {
    if (!isWorkflowSession || !sessionId) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<ModelDebugTraceEvent>(EVENT_MODEL_DEBUG_TRACE, (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      if (!payload || payload.session_id !== sessionId) {
        return;
      }
      appendDebugFlowRecord(
        "backend",
        payload.stage || "backend",
        payload.title || "后端调试",
        payload.detail || "",
      );
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // 后端调试流监听失败时不影响主流程。
      });
    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [isWorkflowSession, sessionId]);

  useEffect(() => {
    if (isWorkflowSession || !sessionId) {
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
      const segmentKey = `agent:${payload.kind}:${payload.message}:${payload.delta || ""}`;
      if (!agentStreamSeenKeysRef.current.has(segmentKey)) {
        agentStreamSeenKeysRef.current.add(segmentKey);
        // 描述：收到真实文本流事件后重置心跳计数，避免误判为“无进展超时”。
        assistantRunHeartbeatCountRef.current = 0;
        const runSegment = mapAgentTextStreamToRunSegment(payload, segmentKey);
        if (runSegment) {
          appendAssistantRunSegment(streamMessageIdRef.current, runSegment);
        }
      }
      if (payload.kind === STREAM_KINDS.STARTED) {
        setStreamingAssistantTarget("正在准备执行...");
        return;
      }
      if (payload.kind === STREAM_KINDS.LLM_STARTED) {
        setStreamingAssistantTarget("模型会话已开始，正在执行策略…");
        return;
      }
      if (payload.kind === STREAM_KINDS.LLM_FINISHED) {
        if (!agentStreamTextBufferRef.current.trim()) {
          setStreamingAssistantTarget("正在整理输出...");
        }
        return;
      }
      if (payload.kind === STREAM_KINDS.FINISHED || payload.kind === STREAM_KINDS.FINAL) {
        const finalSummary = String(agentStreamTextBufferRef.current || "").trim()
          || String(payload.message || "").trim()
          || "执行完成";
        setStreamingAssistantTarget(finalSummary);
        finishAssistantRunMessage(streamMessageIdRef.current, "finished", finalSummary);
        setStatus("执行完成");
        setSending(false);
        activeAgentStreamTraceRef.current = "";
        return;
      }
      if (payload.kind === STREAM_KINDS.CANCELLED) {
        const cancelledSummary = String(payload.message || "").trim() || "任务已取消";
        appendDebugFlowRecord(
          "ui",
          "stream_cancelled",
          "流取消事件",
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
        agentStreamTextBufferRef.current = `${agentStreamTextBufferRef.current}${delta}`;
        setStreamingAssistantTarget(agentStreamTextBufferRef.current);
        return;
      }
      if (payload.kind === STREAM_KINDS.ERROR) {
        // 兜底：如果 error 事件携带取消类错误码，按取消态处理，避免与 cancelled 事件竞态时文案闪烁。
        const errorCode = resolveStreamErrorCode(payload);
        if (isCancelErrorCode(errorCode)) {
          const cancelledSummary = `任务已取消：${String(payload.message || "").trim() || "未知原因"}`;
          setStreamingAssistantTarget(cancelledSummary);
          finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary);
          setStatus(cancelledSummary);
          setSending(false);
          activeAgentStreamTraceRef.current = "";
          return;
        }
        const errorSummary = `执行失败：${String(payload.message || "").trim() || "未知错误"}`;
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
  }, [isWorkflowSession, sessionId]);

  // 描述：调用模型生成最终用户总结，输出更自然的结果说明；若失败则由上层回退规则总结。
  //
  // Params:
  //
  //   - provider: 当前选择的模型提供商。
  //   - requestPrompt: 用户输入需求。
  //   - workflowMessage: 工作流完成消息。
  //   - modelSteps: 模型步骤记录。
  //   - modelEvents: 模型事件记录。
  //   - exportedFile: 导出文件路径。
  //   - bridgeWarning: Bridge 恢复提示。
  //
  // Returns:
  //
  //   - AI 总结字符串。
  const summarizeModelSessionWithAi = async (
    provider: string,
    requestPrompt: string,
    workflowMessage: string,
    modelSteps: ModelStepRecord[],
    modelEvents: ModelEventRecord[],
    exportedFile?: string,
    bridgeWarning?: string,
  ) => {
    const response = await invoke<ModelSessionAiSummaryResponse>(COMMANDS.SUMMARIZE_MODEL_SESSION_RESULT, {
      provider,
      userPrompt: requestPrompt,
      workflowMessage,
      modelSteps,
      modelEvents,
      exportedFile,
      bridgeWarning: bridgeWarning || null,
    });
    appendDebugFlowRecord("backend", "ai_summary_prompt", "总结模型 Prompt", response.prompt);
    appendDebugFlowRecord("backend", "ai_summary_raw", "总结模型原始返回", response.raw_response);
    appendDebugFlowRecord("backend", "ai_summary_final", "总结模型解析结果", response.summary);
    return response.summary.trim();
  };

  const executePrompt = async (content: string, options?: ExecutePromptOptions) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || sending) return;

    const allowDangerousAction = Boolean(options?.allowDangerousAction);
    const confirmationToken = options?.confirmationToken;
    const appendUserMessage = options?.appendUserMessage !== false;
    const contextMessages = options?.contextMessages || messages;

    // 描述：代码智能体在正式执行前先检查项目依赖规则；发现版本不一致时先弹确认，不直接中断。
    if (!isWorkflowSession && normalizedAgentKey === "code" && !options?.skipDependencyRuleCheck) {
      const projectPath = String(activeCodeWorkspace?.path || "").trim();
      const dependencyRules = activeCodeWorkspace?.dependencyRules || [];
      if (projectPath && dependencyRules.length > 0) {
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
            setStatus(`检测到 ${mismatches.length} 项依赖版本与规范不一致，请先确认。`);
            return;
          }
        } catch (checkErr) {
          // 描述：依赖规则检查异常时不阻断主执行链路，使用状态栏提示并允许继续。
          const reason = normalizeInvokeError(checkErr);
          setStatus(`依赖规则检查失败，已跳过：${reason}`);
        }
      }
    }

    const provider = selectedAi?.provider || "codex";
    const activeWorkflowName = isWorkflowSession
      ? selectedModelWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel
      : selectedCodeWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel;
    const activeWorkflowId = isWorkflowSession
      ? selectedModelWorkflow?.id || ""
      : selectedCodeWorkflow?.id || "";
    const outputDir = isWorkflowSession ? extractOutputDirFromPrompt(normalizedContent) : undefined;
    const streamMessageId = String(options?.replaceAssistantMessageId || "").trim()
      || `assistant-stream-${Date.now()}`;
    const codeTraceId = isWorkflowSession ? "" : `trace-${Date.now()}`;
    setInput("");
    setSending(true);
    setStatus("智能体执行中...");
    setUiHint(null);
    appendDebugFlowRecord(
      "ui",
      "user_submit",
      "用户发送消息",
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
    modelStreamSeenKeysRef.current.clear();
    if (!isWorkflowSession) {
      activeAgentStreamTraceRef.current = codeTraceId;
      agentStreamTextBufferRef.current = "";
      agentStreamSeenKeysRef.current.clear();
    }
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
    assistantRunAgentKindRef.current = normalizedAgentKey === "model" ? "model" : "code";
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
            intro: "已接收需求，开始规划执行",
            step: normalizedContent,
            status: "running",
          },
        ],
      },
    }));
    setStreamingAssistantTarget(isWorkflowSession ? "正在规划本次模型操作…" : "正在准备执行...");
    startAssistantRunHeartbeat(streamMessageId);

    try {
      if (isWorkflowSession) {
        let bridgePrecheckWarning = "";
        const bridgeEnsureResult = await ensureBlenderBridge();
        appendDebugFlowRecord(
          "ui",
          "bridge_precheck",
          "Bridge 预检结果",
          JSON.stringify(bridgeEnsureResult, null, 2),
        );
        if (!bridgeEnsureResult.ok) {
          // 描述：Bridge 预检失败不立即作为错误 trace 写入，避免后续自动恢复成功时形成误导。
          bridgePrecheckWarning = bridgeEnsureResult.message;
          setStatus("Bridge 未就绪，正在尝试自动拉起 Blender 并重试...");
        }
        const response = await runModelWorkflow({
          sessionId: sessionId || "model-session",
          projectName: title,
          prompt: normalizedContent,
          provider,
          workflowId: selectedModelWorkflow?.id || "wf-model-full-v1",
          referenceImages: [],
          styleImages: [],
          aiKeys,
          modelMcpCapabilities,
          outputDir,
          allowDangerousAction,
          confirmationToken,
        });
        appendDebugFlowRecord(
          "ui",
          "workflow_response",
          "工作流执行返回",
          JSON.stringify(
            {
              workflow_message: response.message,
              workflow_steps: (response.steps || []).map((item) => ({
                name: item.name,
                kind: item.kind,
                status: item.status,
                summary: item.summary,
              })),
              model_trace_id: response.modelSession?.trace_id || null,
              model_step_count: response.modelSession?.steps?.length || 0,
              model_event_count: response.modelSession?.events?.length || 0,
              exported_file: response.exportedFile || null,
            },
            null,
            2,
          ),
        );
        setWorkflowStepRecords(response.steps || []);
        setStepRecords(response.modelSession?.steps || []);
        setEventRecords(response.modelSession?.events || []);
        setAssetRecords(response.modelSession?.assets || []);
        if (response.modelSession?.trace_id) {
          appendTraceRecord({
            traceId: response.modelSession.trace_id,
            source: "workflow:model_session",
            message: response.message,
          });
        }
        if (bridgePrecheckWarning) {
          appendTraceRecord({
            traceId: `trace-local-${Date.now()}`,
            source: "bridge:ensure",
            message: `Bridge 预检未通过，但执行阶段已自动恢复并完成。预检详情：${bridgePrecheckWarning}`,
          });
          appendAssistantRunSegment(streamMessageId, {
            key: `bridge-warning-${Date.now()}`,
            intro: "环境检查提示",
            step: bridgePrecheckWarning,
            status: "finished",
          });
        }
        const nextUpdatedAt = new Date().toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        upsertModelProject({
          id: sessionId,
          title,
          prompt: normalizedContent,
          updatedAt: nextUpdatedAt,
        });
        let completionSummary = buildUserReadableModelSummary(
          normalizedContent,
          response.modelSession?.steps || [],
          response.exportedFile,
          Boolean(bridgePrecheckWarning),
        );
        try {
          const aiSummary = await summarizeModelSessionWithAi(
            provider,
            normalizedContent,
            response.message,
            response.modelSession?.steps || [],
            response.modelSession?.events || [],
            response.exportedFile,
            bridgePrecheckWarning,
          );
          if (aiSummary) {
            completionSummary = aiSummary;
          }
        } catch (summaryErr) {
          const summaryErrorMessage = normalizeInvokeError(summaryErr);
          appendDebugFlowRecord(
            "backend",
            "ai_summary_failed",
            "总结模型失败，回退规则总结",
            summaryErrorMessage,
          );
        }
        setStreamingAssistantTarget(completionSummary);
        finishAssistantRunMessage(streamMessageId, "finished", completionSummary);
        setUiHint(response.uiHint || null);
        if (response.uiHint?.key === "dangerous-operation-confirm") {
          const hintPrompt = response.uiHint.context?.prompt;
          const hintToken = response.uiHint.context?.confirmation_token;
          setPendingDangerousPrompt(typeof hintPrompt === "string" ? hintPrompt : normalizedContent);
          setPendingDangerousToken(typeof hintToken === "string" ? hintToken : "");
        } else {
          setPendingDangerousPrompt("");
          setPendingDangerousToken("");
        }
        setStatus(
          response.exportedFile
            ? `已完成 ${response.steps?.length || 0} 个步骤；导出文件：${response.exportedFile}`
            : `已完成 ${response.steps?.length || 0} 个步骤`
        );
      } else {
        const skillExecutionPlan = buildCodeWorkflowSkillExecutionPlan(selectedCodeWorkflow);
        if (skillExecutionPlan.blockingIssues.length > 0) {
          throw new Error(`技能执行前检查未通过：${skillExecutionPlan.blockingIssues.join("；")}`);
        }
        const selectedSessionSkillPrompt = buildSessionSkillPrompt(selectedSessionSkills);
        const codeRequestPrompt = buildCodeSessionContextPrompt(messages, normalizedContent);
        const contextualCodeRequestPrompt = buildCodeSessionContextPrompt(
          contextMessages,
          normalizedContent,
          String(activeCodeWorkspace?.path || "").trim() || undefined,
        );
        const codeWorkflowPrompt = buildCodeWorkflowPrompt(
          selectedCodeWorkflow,
          contextualCodeRequestPrompt || codeRequestPrompt,
        );
        const codePrompt = skillExecutionPlan.planPrompt
          ? `${codeWorkflowPrompt}\n\n${skillExecutionPlan.planPrompt}${selectedSessionSkillPrompt ? `\n\n${selectedSessionSkillPrompt}` : ""}`
          : `${codeWorkflowPrompt}${selectedSessionSkillPrompt ? `\n\n${selectedSessionSkillPrompt}` : ""}`;
        appendDebugFlowRecord(
          "ui",
          "skill_plan",
          "技能执行计划",
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
            traceId: codeTraceId,
            source: "workflow:skill_plan",
            message: `已加载 ${skillExecutionPlan.readyItems.length} 个技能节点`,
          });
        }
        const response = await invoke<AgentRunResponse>(COMMANDS.RUN_AGENT_COMMAND, {
          agentKey: agentKey || "code",
          sessionId,
          provider,
          prompt: codePrompt,
          traceId: codeTraceId,
          projectName: title,
          modelExportEnabled: modelMcpCapabilities.export,
          blenderBridgeAddr: DEFAULT_BLENDER_BRIDGE_ADDR,
          outputDir,
          workdir: String(activeCodeWorkspace?.path || "").trim() || undefined,
        });
        setStepRecords(response.steps || []);
        setEventRecords(response.events || []);
        setAssetRecords(response.assets || []);
        appendTraceRecord({
          traceId: response.trace_id,
          source: "agent:run",
          message: response.message,
        });
        setUiHint(response.ui_hint ? mapProtocolUiHint(response.ui_hint) : null);
        setPendingDangerousToken("");
        setStreamingAssistantTarget(response.message);
        finishAssistantRunMessage(streamMessageId, "finished", response.message);
        const actionText =
          response.actions?.length > 0 ? `动作：${response.actions.join(", ")}` : "动作：无";
        setStatus(
          response.exported_file
            ? `${actionText}；工作流：${activeWorkflowName}；导出文件：${response.exported_file}`
            : `${actionText}；工作流：${activeWorkflowName}`
        );
      }
    } catch (err) {
      const detail = normalizeInvokeErrorDetail(err);
      const reason = detail.message;
      if (isCancelErrorCode(String(detail.code || ""))) {
        const cancelledSummary = `任务已取消：${reason}`;
        appendDebugFlowRecord(
          "ui",
          "execute_cancelled",
          "执行取消",
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
        "执行失败",
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
        setStreamingAssistantTarget(`执行失败：${reason}`);
        finishAssistantRunMessage(streamMessageIdRef.current, "failed", `执行失败：${reason}`);
      } else {
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: "assistant", text: `执行失败：${reason}` },
        ]);
      }
      setStatus(`执行失败：${reason}`);
      setUiHint(buildUiHintFromProtocolError(detail));
    } finally {
      setSending(false);
      if (!isWorkflowSession) {
        activeAgentStreamTraceRef.current = "";
      }
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
    if (sending) {
      setStatus("当前仍在执行中，请稍后再试");
      return;
    }
    const assistantMessage = messages[assistantMessageIndex];
    if (!assistantMessage || assistantMessage.role !== "assistant") {
      setStatus("无法重试：目标消息不存在");
      return;
    }
    const retryPrompt = resolveRetryPromptByAssistantMessageIndex(assistantMessageIndex);
    if (!retryPrompt) {
      setStatus("无法重试：未找到对应的用户输入");
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
      setStatus("检测到 Gemini 暂不可用，已切换到 Codex 重试");
    } else {
      setStatus("正在重试本轮执行...");
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
      setStatus("该条消息为空，无法编辑");
      return;
    }
    setInput(normalized);
    setStatus("已加载到输入框，修改后可重新发送");
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
      setStatus("暂无可复制内容");
      return;
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        setStatus("复制失败，请检查系统剪贴板权限");
        return;
      }
      await navigator.clipboard.writeText(normalizedContent);
      setStatus("消息内容已复制");
    } catch {
      setStatus("复制失败，请检查系统剪贴板权限");
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
      setStatus("沙盒环境已重置（跨轮次上下文已清空）");
    } catch (err) {
      setStatus("沙盒重置失败，请查看日志");
    }
  };

  // 描述：主动取消当前执行任务，要求后端立即终止对应会话沙盒。
  const handleCancelCurrentRun = async () => {
    if (!sending || !sessionId) {
      return;
    }
    try {
      await invoke(COMMANDS.CANCEL_AGENT_SESSION, { sessionId });
      const cancelledSummary = "任务已取消（用户主动终止）";
      if (streamMessageIdRef.current) {
        setStreamingAssistantTarget(cancelledSummary);
        finishAssistantRunMessage(streamMessageIdRef.current, "finished", cancelledSummary);
      }
      setStatus(cancelledSummary);
      setUiHint(null);
    } catch (_err) {
      setStatus("取消失败，请重试");
    } finally {
      setSending(false);
      activeAgentStreamTraceRef.current = "";
    }
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
  };

  const handleApproveAgentAction = async (id: string, approved: boolean) => {
    try {
      await invoke(COMMANDS.APPROVE_AGENT_ACTION, { id, approved });
    } catch (err) {
      setStatus("授权操作失败，请重试");
    }
  };

  // 描述：获取当前最后一个待授权的任务。
  const activeApprovalSegment = (() => {
    if (!sending || !streamMessageIdRef.current) return null;
    const meta = assistantRunMetaMap[streamMessageIdRef.current];
    if (!meta) return null;
    return meta.segments.find(s => s.status === "running" && s.intro === "需要人工授权") || null;
  })();
  const activeApprovalData = activeApprovalSegment?.data || {};
  const activeApprovalId =
    typeof activeApprovalData.approval_id === "string" ? activeApprovalData.approval_id : "";
  const activeApprovalToolName =
    typeof activeApprovalData.tool_name === "string" ? activeApprovalData.tool_name : "工具";
  const activeApprovalToolArgs =
    typeof activeApprovalData.tool_args === "string" ? activeApprovalData.tool_args : "";

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
      content: "请选择一个执行策略。",
      duration: 2500,
    });
    return;
  }
  if (isWorkflowSession) {
    if (nextSkillIds.length > 0) {
      setSelectedModelSkillIds(nextSkillIds);
      setSelectedModelWorkflowId("");
    } else {
      setSelectedModelSkillIds([]);
      setSelectedModelWorkflowId(nextWorkflowId || modelWorkflows[0]?.id || "");
    }
  } else {
    if (nextSkillIds.length > 0) {
      setSelectedCodeSkillIds(nextSkillIds);
      setSelectedCodeWorkflowId("");
    } else {
      setSelectedCodeSkillIds([]);
      setSelectedCodeWorkflowId(nextWorkflowId || codeWorkflows[0]?.id || "");
    }
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
          ? `依赖升级完成：已更新 ${updatedCount} 项，跳过 ${skippedCount} 项。`
          : `依赖升级完成：已更新 ${updatedCount} 项。`,
      );
      setDependencyRuleConfirmState(null);
      await executePrompt(pending.prompt, {
        ...pending.options,
        skipDependencyRuleCheck: true,
      });
    } catch (upgradeErr) {
      const reason = normalizeInvokeError(upgradeErr);
      setStatus(`依赖升级失败：${reason}`);
    } finally {
      setDependencyRuleUpgrading(false);
    }
  };

  const handleUiHintAction = async (action: WorkflowUiHint["actions"][number]) => {
    if (action.kind === "dismiss") {
      setUiHint(null);
      return;
    }

    if (action.kind === "open_model_settings") {
      setUiHint(null);
      navigate("/agents/model/settings");
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
        setStatus("无法继续：缺少待确认的指令内容");
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
      setStatus("已取消本次危险操作");
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: "assistant", text: "已取消本次危险操作。" },
      ]);
    }
  };

  const retryLastStep = async () => {
    if (!sessionId || sending || !isWorkflowSession) {
      return;
    }
    const traceId = `trace-${Date.now()}`;
    setSending(true);
    setStatus("重试中...");
    try {
      const response = await invoke<ModelSessionRunResponse>(COMMANDS.RETRY_MODEL_SESSION_LAST_STEP, {
        sessionId,
        traceId,
        projectName: title,
        capabilities: modelMcpCapabilities,
        blenderBridgeAddr: DEFAULT_BLENDER_BRIDGE_ADDR,
      });
      setStepRecords(response.steps || []);
      setEventRecords(response.events || []);
      setAssetRecords(response.assets || []);
      if (response.trace_id) {
        appendTraceRecord({
          traceId: response.trace_id,
          source: "session:retry",
          message: response.message,
        });
      }
      setUiHint(response.ui_hint ? mapProtocolUiHint(response.ui_hint) : null);
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: "assistant", text: response.message },
      ]);
      setStatus("重试完成");
    } catch (err) {
      const detail = normalizeInvokeErrorDetail(err);
      const reason = normalizeInvokeError(err);
      appendTraceRecord({
        traceId: `trace-local-${Date.now()}`,
        source: "session:retry_error",
        code: detail.code,
        message: reason,
      });
      setStatus(`重试失败：${reason}`);
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: "assistant", text: `重试失败：${reason}` },
      ]);
      setUiHint(buildUiHintFromProtocolError(detail));
    } finally {
      setSending(false);
    }
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
    const deletingWorkspaceId = normalizedAgentKey === "code"
      ? workspaceIdFromRouteState || workspaceIdFromQuery || workspaceIdFromBinding
      : "";
    removeAgentSession(normalizedAgentKey, sessionId);
    if (normalizedAgentKey === "code") {
      const search = deletingWorkspaceId ? `?workspaceId=${encodeURIComponent(deletingWorkspaceId)}` : "";
      navigate(`/agents/code${search}`);
    } else {
      navigate("/agents/model");
    }
    if (!currentUser?.id) {
      return;
    }
    try {
      await updateRuntimeSessionStatus(currentUser.id, sessionId, 0);
    } catch {
      // 描述：后端删除失败时保留本地删除结果，避免会话在界面上反复出现。
    }
  };

  // 描述：构建可复制的完整会话文本，按消息顺序拼接“角色 + 内容”。
  //
  // Params:
  //
  //   - items: 当前会话消息列表。
  //
  // Returns:
  //
  //   - 可直接写入剪贴板的完整会话文本。
  const buildSessionConversationText = (items: MessageItem[]) => {
    if (!items.length) {
      return `会话：${title}\n\n（当前会话暂无消息）`;
    }

    const lines = items.map((item, index) => {
      const roleLabel = item.role === "user" ? "用户" : "助手";
      const content = String(item.text || "").trim() || "（空消息）";
      return `${index + 1}. ${roleLabel}：\n${content}`;
    });
    return [`会话：${title}`, "", ...lines].join("\n\n");
  };

  // 描述：复制完整会话内容到系统剪贴板，成功或失败均反馈用户可读提示。
  const handleCopySessionContentByHeaderMenu = async () => {
    try {
      if (!navigator?.clipboard?.writeText) {
        setStatus("复制失败，请检查系统剪贴板权限");
        return;
      }
      const fullConversationText = buildSessionConversationText(messages);
      await navigator.clipboard.writeText(fullConversationText);
      setStatus("会话内容已复制");
    } catch {
      setStatus("复制失败，请检查系统剪贴板权限");
    }
  };

  // 描述：处理 Header 更多菜单动作，复用侧边栏右键会话菜单同款能力。
  const handleSelectSessionHeadMenu = (key: string) => {
    if (key === "pin") {
      togglePinnedAgentSession(sessionId);
      setSessionMenuVersion((current) => current + 1);
      return;
    }
    if (key === "copy_session") {
      void handleCopySessionContentByHeaderMenu();
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
              aria-label="更多操作"
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
        title="依赖版本需确认"
        onClose={handleCloseDependencyRuleConfirm}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              type="default"
              label="取消"
              disabled={dependencyRuleUpgrading}
              onClick={handleCloseDependencyRuleConfirm}
            />
            <AriButton
              type="default"
              label="本次跳过继续"
              disabled={dependencyRuleUpgrading}
              onClick={() => {
                void handleSkipDependencyRuleAndContinue();
              }}
            />
            <AriButton
              type="default"
              color="brand"
              label={dependencyRuleUpgrading ? "升级中..." : "升级并继续"}
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
            value={`检测到 ${dependencyRuleConfirmState?.mismatches?.length || 0} 项依赖与项目规范不一致。`}
          />
          <AriContainer padding={0}>
            {(dependencyRuleConfirmState?.mismatches || []).slice(0, 8).map((item, index) => (
              <AriTypography
                key={`${item.ecosystem}-${item.package_name}-${index}`}
                variant="caption"
                value={`${item.ecosystem}: ${item.package_name} ${item.current_version || "(未读取)"} -> ${item.expected_version}`}
              />
            ))}
          </AriContainer>
        </AriContainer>
      </AriModal>
      <AriModal
        visible={renameModalVisible}
        title="重命名会话"
        onClose={() => {
          setRenameModalVisible(false);
          setRenameValue("");
        }}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              type="default"
              label="取消"
              onClick={() => {
                setRenameModalVisible(false);
                setRenameValue("");
              }}
            />
            <AriButton
              type="default"
              color="brand"
              label="确定"
              onClick={handleConfirmRenameSession}
            />
          </AriFlex>
        )}
      >
        <AriInput
          value={renameValue}
          onChange={setRenameValue}
          placeholder="请输入会话名称"
          maxLength={60}
        />
      </AriModal>
      <AriModal
        visible={workflowSkillModalVisible}
        title="选择执行策略"
        onClose={handleCloseWorkflowSkillModal}
        footer={(
          <AriFlex justify="flex-end" align="center" space={8}>
            <AriButton
              type="default"
              label="取消"
              onClick={handleCloseWorkflowSkillModal}
            />
            <AriButton
              type="default"
              color="brand"
              label="确定"
              onClick={handleConfirmWorkflowSkillModal}
            />
          </AriFlex>
        )}
      >
        <AriContainer className="desk-session-strategy-modal-body" padding={0}>
          <AriTypography
            className="desk-session-strategy-section-title"
            variant="caption"
            value="工作流"
          />
          <AriList
            bordered
            className="desk-session-strategy-list"
            emptyMessage="暂无可选工作流"
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
                  <AriTypography key={`${item.key}-type`} variant="caption" value="工作流" />,
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
                      value={item.description || "按该工作流执行。"}
                    />
                  </AriContainer>
                </AriFlex>
              </AriListItem>
            ))}
          </AriList>

          <AriTypography
            className="desk-session-strategy-section-title"
            variant="caption"
            value="技能"
          />
          <AriList
            bordered
            className="desk-session-strategy-list"
            emptyMessage="暂无已安装技能"
          >
            {installedSkills.map((item) => (
              <AriListItem
                key={`skill-${item.id}`}
                split={false}
                className={`desk-session-strategy-item${draftSkillIds.includes(item.id) ? " is-active" : ""}`}
                onClick={() => {
                  handleToggleDraftSkill(item.id);
                }}
                actions={[
                  <AriTypography key={`${item.id}-origin`} variant="caption" value="系统" />,
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
                  <AriTypography variant="h4" value="快速开始" />
                  <AriTypography
                    variant="caption"
                    value={resolvedSessionUiConfig.emptyStatePrimary}
                  />
                </AriCard>
                <AriCard className="desk-session-empty-card">
                  <AriTypography variant="h4" value="提示" />
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
              const dividerTitle = runMeta
                ? runMeta.status === "failed"
                  ? `执行中断，用时 ${formatElapsedDuration(runMeta.startedAt, runMeta.finishedAt)}`
                  : `已完成，用时 ${formatElapsedDuration(runMeta.startedAt, runMeta.finishedAt)}`
                : "";
              const failureSummary = runMeta?.status === "failed"
                ? buildAssistantFailureSummary(runMeta.summary || message.text)
                : null;
              const messageContent = useRunLayout && runMeta ? (
                <AriContainer className="desk-run-flow" padding={0}>
                  {runMeta.status === "running" ? (
                    <AriContainer className="desk-run-segments" padding={0}>
                      {runMeta.segments.map((segment) => (
                        <AriContainer
                          key={segment.key}
                          className="desk-run-segment"
                          padding={0}
                        >
                          <AriTypography
                            className="desk-run-intro"
                            variant="caption"
                            value={segment.intro}
                          />
                          <AriTypography
                            className={`desk-run-step ${segment.status === "running" ? "desk-run-step-running" : ""}`}
                            variant="caption"
                            value={segment.step}
                          />
                        </AriContainer>
                      ))}
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
                          {runMeta.segments.map((segment) => (
                            <AriContainer
                              key={`collapsed-${segment.key}`}
                              className="desk-run-segment"
                              padding={0}
                            >
                              <AriTypography
                                className="desk-run-intro"
                                variant="caption"
                                value={segment.intro}
                              />
                              <AriTypography
                                className="desk-run-step"
                                variant="caption"
                                value={segment.step}
                              />
                            </AriContainer>
                          ))}
                        </AriContainer>
                      ) : null}
                      <AriContainer className={`desk-run-summary ${runMeta.status === "failed" ? "desk-run-summary-failed" : ""}`} padding={0}>
                        {runMeta.status === "failed" && failureSummary ? (
                          <AriContainer className="desk-run-failure-card">
                            <AriFlex className="desk-run-failure-head" align="center" space={8}>
                              <AriIcon name="error" />
                              <AriTypography variant="h4" value="执行失败" />
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
                                label="重试本轮"
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
                  key={message.id || `message-${index}`}
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
                      <AriTooltip content="编辑" position="top" minWidth={0} matchTriggerWidth={false}>
                        <AriButton
                          ghost
                          size="sm"
                          icon="edit"
                          aria-label="编辑消息"
                          disabled={sending}
                          onClick={() => {
                            handleEditUserMessage(message.text);
                          }}
                        />
                      </AriTooltip>
                    ) : (
                      <AriTooltip content="重试" position="top" minWidth={0} matchTriggerWidth={false}>
                        <AriButton
                          ghost
                          size="sm"
                          icon="refresh"
                          aria-label="重试消息"
                          disabled={sending}
                          onClick={() => {
                            void handleRetryAssistantMessage(index);
                          }}
                        />
                      </AriTooltip>
                    )}
                    <AriTooltip content="复制" position="top" minWidth={0} matchTriggerWidth={false}>
                      <AriButton
                        ghost
                        size="sm"
                        icon="content_copy"
                        aria-label="复制消息"
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
                <AriTypography variant="h4" value="高危操作待授权" />
              </AriFlex>
              <AriTypography
                variant="caption"
                value={`智能体申请执行 ${activeApprovalToolName}：`}
              />
              <AriContainer className="desk-approval-tool-args">
                {activeApprovalToolArgs}
              </AriContainer>
              <AriFlex align="center" space={8} className="desk-action-slot-actions">
                <AriButton
                  color="primary"
                  label="批准执行 (Approve)"
                  disabled={!activeApprovalId}
                  onClick={() =>
                    handleApproveAgentAction(
                      activeApprovalId,
                      true
                    )
                  }
                />
                <AriButton
                  label="拒绝 (Reject)"
                  disabled={!activeApprovalId}
                  onClick={() =>
                    handleApproveAgentAction(
                      activeApprovalId,
                      false
                    )
                  }
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
                  className="desk-prompt-toolbar-select"
                  value={selectedAi?.provider || undefined}
                  options={aiSelectOptions}
                  placeholder="选择 AI"
                  bordered={false}
                  onChange={handleChangeProvider}
                  disabled={availableAiKeys.length === 0}
                />
                <AriSelect
                  className="desk-prompt-toolbar-select"
                  value="workflow_skill"
                  options={workflowSkillSelectOptions}
                  bordered={false}
                  openOnTriggerClick={false}
                  onTriggerClick={() => {
                    handleOpenWorkflowSkillModal();
                  }}
                  disabled={workflowMenuItems.length === 0 && installedSkills.length === 0}
                />
                {sandboxMetrics && (
                  <AriFlex align="center" className="desk-sandbox-metrics">
                    <span>RAM: {formatMemory(sandboxMetrics.memory_bytes)}</span>
                    <span>Uptime: {formatUptime(sandboxMetrics.uptime_secs)}</span>
                  </AriFlex>
                )}
                <AriTooltip content="重置沙盒环境 (清空变量)" position="top" minWidth={0} matchTriggerWidth={false}>
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
                icon={sending ? "hourglass_top" : "arrow_upward"}
                className="desk-prompt-icon-btn"
                onClick={sendMessage}
                disabled={
                  sending ||
                  (isWorkflowSession && blenderBridgeRuntime.checking)
                }
              />
              {sending ? (
                <AriButton
                  type="default"
                  shape="round"
                  icon="stop"
                  className="desk-prompt-icon-btn"
                  onClick={() => {
                    void handleCancelCurrentRun();
                  }}
                />
              ) : null}
            </AriFlex>
          </AriCard>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
