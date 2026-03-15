import type { SessionWorkflowPhaseCursorSnapshot } from "../../shared/data";
import { translateDesktopText } from "../../shared/i18n";
import type { AgentWorkflowDefinition, WorkflowGraphNode } from "../../shared/workflow";
import { normalizeAgentSkillId } from "../../shared/workflow/prompt-guidance";
import type { SessionExecutionSelection } from "./prompt-utils";

// 描述：
//
//   - 定义消息级执行路由类型，统一覆盖恢复执行、完整工作流、部分工作流、技能执行与普通对话五类入口。
export type SessionExecutionRouteKind =
  | "resume_pending"
  | "workflow_full"
  | "workflow_partial"
  | "skill"
  | "chat";

// 描述：
//
//   - 定义恢复执行的细分目标；用于区分“恢复阶段执行”和“恢复挂起交互”。
export type SessionExecutionResumeTarget = "workflow_stage" | "approval" | "user_input";

// 描述：
//
//   - 定义消息级执行路由结果，供页面在发送前决定 prompt 拼接与是否恢复未完成执行。
export interface SessionExecutionRouteDecision {
  routeKind: SessionExecutionRouteKind;
  workflowId?: string;
  skillId?: string;
  stageIndex?: number;
  nodeId?: string;
  reason: string;
  resumeTarget?: SessionExecutionResumeTarget;
}

// 描述：
//
//   - 定义执行路由器入参，统一提供会话选择、当前工作流和未完成执行快照。
export interface ResolveSessionExecutionRouteOptions {
  messageText: string;
  selection: SessionExecutionSelection;
  workflow: AgentWorkflowDefinition | null;
  workflowPhaseCursor: SessionWorkflowPhaseCursorSnapshot | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
}

// 描述：
//
//   - “继续执行”语义关键词；仅在消息明显表达恢复意图时，才尝试恢复未完成阶段或挂起交互。
const RESUME_MESSAGE_KEYWORDS = [
  "继续",
  "继续执行",
  "继续刚才的",
  "接着",
  "resume",
];

// 描述：
//
//   - 用于识别“本条消息是否更像执行请求”的动作词，避免普通问答误入工作流或技能执行。
const EXECUTION_INTENT_KEYWORDS = [
  "创建",
  "实现",
  "开发",
  "搭建",
  "编写",
  "测试",
  "运行",
  "验证",
  "检查",
  "修复",
  "修改",
  "更新",
  "使用",
  "启动",
  "打开",
  "生成",
  "新增",
  "补齐",
  "联调",
  "调试",
  "排查",
  "重构",
  "配置",
  "安装",
  "删除",
  "执行",
  "create",
  "build",
  "implement",
  "develop",
  "test",
  "run",
  "verify",
  "check",
  "fix",
  "modify",
  "update",
  "use",
  "start",
  "open",
  "generate",
  "debug",
  "refactor",
  "configure",
  "install",
];

// 描述：
//
//   - 用于识别“端到端 / 完整交付”宽任务的关键词；命中时优先走完整工作流。
const WORKFLOW_FULL_INTENT_KEYWORDS = [
  "完整项目",
  "完整流程",
  "完整交付",
  "端到端",
  "从零开始",
  "从头开始",
  "从零",
  "从头",
  "需要可运行",
  "可运行的完整项目",
  "完整工作流",
  "build",
  "from scratch",
  "end to end",
  "end-to-end",
  "complete project",
];

// 描述：
//
//   - 将消息文本归一化为适合规则匹配的检索串，统一去空白、转小写并剔除大部分标点。
//
// Params:
//
//   - value: 原始文本。
//
// Returns:
//
//   - 归一化后的文本。
export function normalizeExecutionRouteText(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 描述：
//
//   - 判断消息是否表达了恢复未完成执行的意图。
//
// Params:
//
//   - messageText: 原始消息文本。
//
// Returns:
//
//   - true: 命中恢复语义。
export function isResumePendingMessage(messageText: string): boolean {
  const normalizedText = normalizeExecutionRouteText(messageText);
  if (!normalizedText) {
    return false;
  }
  return RESUME_MESSAGE_KEYWORDS.some((keyword) => normalizedText.includes(keyword));
}

// 描述：
//
//   - 判断消息是否具备明确执行意图；未命中时统一按普通对话处理。
//
// Params:
//
//   - messageText: 原始消息文本。
//
// Returns:
//
//   - true: 应进入技能/工作流执行判断。
export function hasExecutionIntent(messageText: string): boolean {
  const normalizedText = normalizeExecutionRouteText(messageText);
  if (!normalizedText) {
    return false;
  }
  return EXECUTION_INTENT_KEYWORDS.some((keyword) => normalizedText.includes(keyword));
}

// 描述：
//
//   - 判断消息是否更像“从头完整交付”而非某个阶段的定向请求。
//
// Params:
//
//   - messageText: 原始消息文本。
//
// Returns:
//
//   - true: 应从完整工作流起点执行。
export function hasWorkflowFullIntent(messageText: string): boolean {
  const normalizedText = normalizeExecutionRouteText(messageText);
  if (!normalizedText) {
    return false;
  }
  return WORKFLOW_FULL_INTENT_KEYWORDS.some((keyword) => normalizedText.includes(keyword));
}

// 描述：
//
//   - 解析消息级执行路由，严格按“恢复 > 普通对话 > 技能 > 部分工作流 > 完整工作流”的规则优先级裁决。
//
// Params:
//
//   - options: 路由所需上下文。
//
// Returns:
//
//   - 路由决策对象。
export function resolveSessionExecutionRoute(
  options: ResolveSessionExecutionRouteOptions,
): SessionExecutionRouteDecision {
  const normalizedMessageText = String(options.messageText || "").trim();
  const normalizedSelection = options.selection;
  const wantsResume = isResumePendingMessage(normalizedMessageText);

  if (wantsResume) {
    if (options.hasPendingApproval) {
      return {
        routeKind: "resume_pending",
        reason: translateDesktopText("检测到挂起的人工授权，请先恢复未完成交互。"),
        resumeTarget: "approval",
      };
    }
    if (options.hasPendingUserInput) {
      return {
        routeKind: "resume_pending",
        reason: translateDesktopText("检测到挂起的用户提问，请先恢复未完成交互。"),
        resumeTarget: "user_input",
      };
    }
    if (options.workflowPhaseCursor) {
      return {
        routeKind: "resume_pending",
        workflowId: options.workflowPhaseCursor.workflowId,
        stageIndex: options.workflowPhaseCursor.currentStageIndex,
        nodeId: options.workflowPhaseCursor.currentNodeId,
        reason: translateDesktopText("检测到未完成的工作流阶段，将恢复当前阶段继续执行。"),
        resumeTarget: "workflow_stage",
      };
    }
  }

  if (!hasExecutionIntent(normalizedMessageText)) {
    return {
      routeKind: "chat",
      reason: translateDesktopText("当前消息缺少明确执行意图，按普通对话处理。"),
    };
  }

  if (normalizedSelection.kind === "none") {
    return {
      routeKind: "chat",
      reason: translateDesktopText("当前会话未选择工作流或技能，按普通对话处理。"),
    };
  }

  if (normalizedSelection.kind === "skill") {
    return {
      routeKind: "skill",
      skillId: normalizedSelection.skillId,
      reason: translateDesktopText("当前会话已选择技能，且消息具备执行意图，将按技能执行。"),
    };
  }

  const matchedStage = findBestWorkflowStageMatch(options.workflow, normalizedMessageText);
  if (matchedStage) {
    return {
      routeKind: "workflow_partial",
      workflowId: normalizedSelection.workflowId,
      stageIndex: matchedStage.stageIndex,
      nodeId: matchedStage.node.id,
      reason: translateDesktopText("当前消息命中了工作流中的定向阶段，将直接从该阶段开始执行。"),
    };
  }

  if (hasWorkflowFullIntent(normalizedMessageText)) {
    return {
      routeKind: "workflow_full",
      workflowId: normalizedSelection.workflowId,
      stageIndex: 0,
      reason: translateDesktopText("当前消息表达了完整交付意图，将从工作流起点开始执行。"),
    };
  }

  return {
    routeKind: "chat",
    reason: translateDesktopText("当前消息未命中任何工作流阶段，按普通对话处理。"),
  };
}

interface WorkflowStageMatchResult {
  node: WorkflowGraphNode;
  stageIndex: number;
  score: number;
}

// 描述：
//
//   - 在工作流技能节点中寻找最匹配当前消息的阶段；只要得分达不到阈值，就不触发部分工作流执行。
//
// Params:
//
//   - workflow: 当前工作流定义。
//   - messageText: 原始消息文本。
//
// Returns:
//
//   - 命中的阶段与索引；未命中返回 `null`。
function findBestWorkflowStageMatch(
  workflow: AgentWorkflowDefinition | null,
  messageText: string,
): WorkflowStageMatchResult | null {
  const skillNodes = (workflow?.graph?.nodes || []).filter((node) => node.type === "skill");
  if (skillNodes.length === 0) {
    return null;
  }
  const normalizedMessage = normalizeExecutionRouteText(messageText);
  if (!normalizedMessage) {
    return null;
  }

  let bestMatch: WorkflowStageMatchResult | null = null;
  skillNodes.forEach((node, stageIndex) => {
    const score = scoreWorkflowStageMatch(node, normalizedMessage);
    if (score < 3) {
      return;
    }
    if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && stageIndex > bestMatch.stageIndex)) {
      bestMatch = { node, stageIndex, score };
    }
  });
  return bestMatch;
}

// 描述：
//
//   - 计算消息文本与工作流阶段的匹配分数；优先命中 skillId、title，其次命中描述、说明和关键词重叠。
//
// Params:
//
//   - node: 工作流技能节点。
//   - normalizedMessage: 已归一化的消息文本。
//
// Returns:
//
//   - 匹配分值。
function scoreWorkflowStageMatch(node: WorkflowGraphNode, normalizedMessage: string): number {
  const normalizedSkillId = normalizeAgentSkillId(String(node.skillId || "").trim()).toLowerCase();
  const normalizedTitle = normalizeExecutionRouteText(node.title || "");
  const normalizedDescription = normalizeExecutionRouteText(node.description || "");
  const normalizedInstruction = normalizeExecutionRouteText(node.instruction || "");
  const haystacks = [normalizedTitle, normalizedDescription, normalizedInstruction, normalizedSkillId]
    .filter((item) => item.length > 0);

  let score = 0;
  if (normalizedSkillId && normalizedMessage.includes(normalizedSkillId)) {
    score += 8;
  }
  if (normalizedTitle && normalizedMessage.includes(normalizedTitle)) {
    score += 7;
  }
  if (normalizedInstruction && normalizedMessage.includes(normalizedInstruction)) {
    score += 5;
  }
  if (normalizedDescription && normalizedMessage.includes(normalizedDescription)) {
    score += 4;
  }

  const messageTerms = extractSearchTerms(normalizedMessage);
  const stageTerms = new Set(haystacks.flatMap((item) => extractSearchTerms(item)));
  messageTerms.forEach((term) => {
    if (stageTerms.has(term)) {
      score += term.length >= 4 ? 2 : 1;
    }
  });
  return score;
}

// 描述：
//
//   - 从检索文本中提取可用于重叠匹配的中英关键词；中文连续片段会拆成 2-4 字短语以提高模糊匹配命中率。
//
// Params:
//
//   - text: 已归一化文本。
//
// Returns:
//
//   - 关键词数组。
function extractSearchTerms(text: string): string[] {
  const normalizedText = normalizeExecutionRouteText(text);
  if (!normalizedText) {
    return [];
  }
  const asciiTerms = normalizedText
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
  const hanTerms = Array.from(normalizedText.matchAll(/[\p{Script=Han}]{2,}/gu))
    .flatMap((match) => buildHanNgrams(match[0]));
  return Array.from(new Set([...asciiTerms, ...hanTerms]));
}

// 描述：
//
//   - 将中文连续片段拆成 2-4 字短语，用于提升阶段文本与用户消息的模糊匹配能力。
//
// Params:
//
//   - text: 中文连续片段。
//
// Returns:
//
//   - 去重后的中文短语数组。
function buildHanNgrams(text: string): string[] {
  const source = String(text || "").trim();
  if (source.length < 2) {
    return [];
  }
  const grams = new Set<string>();
  const maxGramLength = Math.min(4, source.length);
  for (let gramLength = 2; gramLength <= maxGramLength; gramLength += 1) {
    for (let cursor = 0; cursor <= source.length - gramLength; cursor += 1) {
      grams.add(source.slice(cursor, cursor + gramLength));
    }
  }
  return Array.from(grams);
}
