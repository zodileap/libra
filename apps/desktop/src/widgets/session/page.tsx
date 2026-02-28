import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  AriButton,
  AriCard,
  AriContainer,
  AriFlex,
  AriInput,
  AriMenu,
  AriModal,
  AriTooltip,
  AriTypography,
} from "aries_react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getCodeWorkspaceGroupById,
  getCodeWorkspaceIdBySessionId,
  getSessionMessages,
  resolveAgentSessionTitle,
  SESSION_TITLE_UPDATED_EVENT,
  upsertModelProject,
  upsertSessionMessages,
  getAgentSessionMetaSnapshot,
  removeAgentSession,
  renameAgentSession,
  togglePinnedAgentSession,
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
  buildCodeWorkflowPrompt,
  listCodeWorkflows,
  listModelWorkflows,
  runModelWorkflow,
} from "../../shared/workflow";
import { useDesktopHeaderSlot } from "../app-header/header-slot-context";
import type {
  CodeWorkflowDefinition,
  WorkflowDefinition,
  WorkflowStepRecord,
  WorkflowUiHint,
} from "../../shared/workflow";
import { resolveSessionUiConfig, type SessionAgentUiConfig } from "./config";

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

// 描述:
//
//   - 定义通用文本流事件结构。
interface AgentTextStreamEvent {
  trace_id: string;
  session_id?: string;
  kind: string;
  message: string;
  delta?: string;
}

// 描述:
//
//   - 定义模型调试轨迹事件结构，供调试面板展示。
interface ModelDebugTraceEvent {
  session_id: string;
  trace_id: string;
  stage: string;
  title: string;
  detail: string;
  timestamp_ms: number;
}

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
  let step = "正在同步执行状态，请稍候…";
  if (stage === "planning") {
    step = heartbeatCount <= 1
      ? "正在解析需求并规划执行步骤…"
      : "规划中：正在确认本次操作所需的 Blender 指令…";
  } else if (stage === "bridge") {
    step = heartbeatCount <= 1
      ? "正在检查 Blender Bridge 与当前会话连接状态…"
      : "已发出环境检查请求，等待 Blender 返回状态…";
  } else if (stage === "executing") {
    step = heartbeatCount <= 1
      ? "步骤正在执行中，等待 Blender 返回本步结果…"
      : "仍在执行当前步骤，正在持续收集事件回传…";
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

// 描述：将底部状态文案压缩为短文本，避免在操作槽中展示过长错误原文。
//
// Params:
//
//   - rawStatus: 原始状态文案。
//
// Returns:
//
//   - 适合在 `desk-action-slot` 展示的简短状态文案。
function buildCompactActionSlotStatus(rawStatus: string): string {
  const normalizedStatus = rawStatus.trim();
  if (!normalizedStatus) {
    return "";
  }

  if (normalizedStatus.startsWith("执行失败")) {
    return "执行失败，请查看对话详情后重试。";
  }

  if (normalizedStatus.length > 72) {
    return `${normalizedStatus.slice(0, 72)}…`;
  }

  return normalizedStatus;
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
  if (typeof window === "undefined") {
    return "";
  }
  const value = window.localStorage.getItem(storageKey);
  return String(value || "").trim();
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
  const headerSlotElement = useDesktopHeaderSlot();
  // 描述：将底部状态文案压缩为适合 action slot 展示的短文案。
  const compactActionSlotStatus = useMemo(() => buildCompactActionSlotStatus(status), [status]);
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
  // 描述：解析当前 code 会话所属目录名称，用于标题后一级菜单提示。
  const codeWorkspaceGroupName = useMemo(() => {
    if (normalizedAgentKey !== "code") {
      return "";
    }
    const workspaceId = workspaceIdFromRouteState || workspaceIdFromQuery || workspaceIdFromBinding;
    if (!workspaceId) {
      return "";
    }
    return getCodeWorkspaceGroupById(workspaceId)?.name?.trim() || "";
  }, [normalizedAgentKey, workspaceIdFromBinding, workspaceIdFromQuery, workspaceIdFromRouteState]);
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
        (item) =>
          item.enabled
          || item.keyValue.trim().length > 0,
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
  const modelWorkflows = useMemo<WorkflowDefinition[]>(() => listModelWorkflows(), []);
  const codeWorkflows = useMemo<CodeWorkflowDefinition[]>(
    () => listCodeWorkflows(),
    [],
  );
  const selectedModelWorkflow = useMemo<WorkflowDefinition | null>(
    () =>
      modelWorkflows.find((item) => item.id === selectedModelWorkflowId) ||
      modelWorkflows[0] ||
      null,
    [modelWorkflows, selectedModelWorkflowId],
  );
  const selectedCodeWorkflow = useMemo<CodeWorkflowDefinition | null>(
    () =>
      codeWorkflows.find((item) => item.id === selectedCodeWorkflowId) ||
      codeWorkflows[0] ||
      null,
    [codeWorkflows, selectedCodeWorkflowId],
  );
  const workflowMenuItems = useMemo(() => {
    if (isWorkflowSession) {
      return modelWorkflows.map((workflow) => ({
        key: workflow.id,
        label: workflow.name,
      }));
    }
    return codeWorkflows.map((workflow) => ({
      key: workflow.id,
      label: workflow.name,
    }));
  }, [codeWorkflows, isWorkflowSession, modelWorkflows]);

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
  const modelStreamSeenKeysRef = useRef<Set<string>>(new Set());
  const modelStreamDebugSeenKeysRef = useRef<Set<string>>(new Set());
  const assistantRunHeartbeatTimerRef = useRef<number | null>(null);
  const assistantRunLastActivityAtRef = useRef(0);
  const assistantRunHeartbeatCountRef = useRef(0);
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

  // 描述：设置当前流式消息文本并按帧批量更新，避免高频 setState 导致页面卡顿。
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
    streamRenderFrameRef.current = window.requestAnimationFrame(() => {
      streamRenderPendingRef.current = false;
      streamRenderFrameRef.current = null;
      const currentMessageId = streamMessageIdRef.current;
      const nextText = streamLatestTextRef.current;
      if (!currentMessageId) {
        return;
      }
      if (streamDisplayedTextRef.current === nextText) {
        return;
      }
      streamDisplayedTextRef.current = nextText;
      setMessages((prev) => upsertAssistantMessageById(prev, currentMessageId, nextText));
    });
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

  // 描述：启动模型执行心跳，在长时间无流式事件时持续补充用户可见进度。
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
        appendAssistantRunSegment(
          messageId,
          buildAssistantHeartbeatSegment(
            assistantRunStageRef.current,
            assistantRunHeartbeatCountRef.current,
            `heartbeat-${Date.now()}`,
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
    modelStreamSeenKeysRef.current.clear();
    modelStreamDebugSeenKeysRef.current.clear();
    assistantRunHeartbeatCountRef.current = 0;
    assistantRunLastActivityAtRef.current = 0;
    assistantRunStageRef.current = "planning";
    assistantRunStatusRef.current = "idle";
    autoPromptDispatchedRef.current = false;
    setUiHint(null);
    setTraceRecords([]);
    setDebugFlowRecords([]);
    setAssistantRunMetaMap({});
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
    setMessages(stored.length > 0 ? stored : []);
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

  useEffect(() => {
    if (!selectedModelWorkflow) {
      return;
    }
    if (selectedModelWorkflow.id !== selectedModelWorkflowId) {
      setSelectedModelWorkflowId(selectedModelWorkflow.id);
      return;
    }
    if (typeof window !== "undefined") {
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
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CODE_WORKFLOW_SELECTED_KEY, selectedCodeWorkflow.id);
    }
  }, [selectedCodeWorkflow, selectedCodeWorkflowId]);

  useEffect(() => {
    if (!isWorkflowSession || !sessionId) {
      return;
    }
    void invoke<ModelSessionRunResponse>("get_model_session_records", { sessionId })
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
    void listen<ModelSessionStreamEvent>("model:session_stream", (event) => {
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
    void listen<ModelDebugTraceEvent>("model:debug_trace", (event) => {
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
    void listen<AgentTextStreamEvent>("agent:text_stream", (event) => {
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
      if (payload.kind === "delta") {
        const delta = payload.delta || "";
        if (!delta) {
          return;
        }
        agentStreamTextBufferRef.current = `${agentStreamTextBufferRef.current}${delta}`;
        setStreamingAssistantTarget(agentStreamTextBufferRef.current);
        return;
      }
      if (payload.kind === "error") {
        setStreamingAssistantTarget(`执行失败：${payload.message}`);
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
    const response = await invoke<ModelSessionAiSummaryResponse>("summarize_model_session_result", {
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

  const executePrompt = async (
    content: string,
    options?: {
      allowDangerousAction?: boolean;
      appendUserMessage?: boolean;
      confirmationToken?: string;
    },
  ) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || sending) return;

    const allowDangerousAction = Boolean(options?.allowDangerousAction);
    const confirmationToken = options?.confirmationToken;
    const appendUserMessage = options?.appendUserMessage !== false;
    const provider = selectedAi?.provider || "codex";
    const activeWorkflowName = isWorkflowSession
      ? selectedModelWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel
      : selectedCodeWorkflow?.name || resolvedSessionUiConfig.workflowFallbackLabel;
    const activeWorkflowId = isWorkflowSession
      ? selectedModelWorkflow?.id || ""
      : selectedCodeWorkflow?.id || "";
    const outputDir = isWorkflowSession ? extractOutputDirFromPrompt(normalizedContent) : undefined;
    const streamMessageId = `assistant-stream-${Date.now()}`;
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
    }
    setMessages((prev) =>
      upsertAssistantMessageById(
        prev,
        streamMessageId,
        "",
      ));
    if (isWorkflowSession) {
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
              intro: "已接收需求，开始规划执行",
              step: normalizedContent,
              status: "running",
            },
          ],
        },
      }));
      setStreamingAssistantTarget("正在规划本次模型操作…");
      startAssistantRunHeartbeat(streamMessageId);
    }

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
        const response = await invoke<AgentRunResponse>("run_agent_command", {
          agentKey: agentKey || "code",
          sessionId,
          provider,
          prompt: buildCodeWorkflowPrompt(selectedCodeWorkflow, content),
          traceId: codeTraceId,
          projectName: title,
          modelExportEnabled: modelMcpCapabilities.export,
          blenderBridgeAddr: DEFAULT_BLENDER_BRIDGE_ADDR,
          outputDir,
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
        if (isWorkflowSession) {
          finishAssistantRunMessage(streamMessageIdRef.current, "failed", `执行失败：${reason}`);
        }
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
      const response = await invoke<ModelSessionRunResponse>("retry_model_session_last_step", {
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
              const useRunLayout =
                message.role === "assistant" && Boolean(runMeta);
              const dividerTitle = runMeta
                ? runMeta.status === "failed"
                  ? `执行中断，用时 ${formatElapsedDuration(runMeta.startedAt, runMeta.finishedAt)}`
                  : `已完成，用时 ${formatElapsedDuration(runMeta.startedAt, runMeta.finishedAt)}`
                : "";
              return (
                <AriCard
                  key={message.id || `message-${index}`}
                  className={`desk-msg ${roleClass}`}
                >
                  {useRunLayout && runMeta ? (
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
                          <AriContainer className="desk-run-summary" padding={0}>
                            <ChatMarkdown
                              content={runMeta.summary || message.text}
                            />
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
                  )}
                </AriCard>
              );
            })}
          </AriContainer>
        </AriContainer>

        <AriContainer className="desk-prompt-dock">
          {uiHint || compactActionSlotStatus ? (
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
              {compactActionSlotStatus ? (
                <AriTypography
                  className="desk-prompt-status"
                  variant="caption"
                  value={compactActionSlotStatus}
                />
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
                <AriTooltip
                  content={
                    <AriMenu
                      items={availableAiKeys.map((item) => ({
                        key: item.provider,
                        label: item.providerLabel,
                      }))}
                      selectedKey={selectedAi?.provider || ""}
                      onSelect={(key: string) => setSelectedProvider(key)}
                    />
                  }
                >
                  <AriButton
                    type="text"
                    label={selectedAi?.providerLabel || "选择 AI"}
                    icon="arrow_drop_down"
                    disabled={availableAiKeys.length === 0}
                  />
                </AriTooltip>
                <AriTooltip
                  content={
                    <AriMenu
                      items={workflowMenuItems}
                      selectedKey={
                        isWorkflowSession
                          ? selectedModelWorkflow?.id || ""
                          : selectedCodeWorkflow?.id || ""
                      }
                      onSelect={(key: string) => {
                        if (isWorkflowSession) {
                          setSelectedModelWorkflowId(key);
                          return;
                        }
                        setSelectedCodeWorkflowId(key);
                      }}
                    />
                  }
                >
                  <AriButton
                    type="text"
                    label={
                      isWorkflowSession
                        ? selectedModelWorkflow?.name ||
                          resolvedSessionUiConfig.workflowFallbackLabel
                        : selectedCodeWorkflow?.name ||
                          resolvedSessionUiConfig.workflowFallbackLabel
                    }
                    icon="arrow_drop_down"
                    disabled={workflowMenuItems.length === 0}
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
            </AriFlex>
          </AriCard>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
