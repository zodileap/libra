import type { ProjectWorkspaceProfile } from "../../shared/data";
import { IS_BROWSER, STORAGE_KEYS } from "../../shared/constants";
import type { AgentEventRecord, AgentStepRecord } from "../../shared/types";
import type { AgentSkillItem } from "../../modules/common/services";

// 描述:
//
//   - 定义会话消息结构，统一管理角色与文本内容。
export interface MessageItem {
  id?: string;
  role: "user" | "assistant";
  text: string;
}

// 描述：
//
//   - 定义“按助手消息重试”清理结果，包含裁剪后的消息列表与被移除的助手消息 ID。
export interface RetryTailPruneResult {
  messages: MessageItem[];
  removedAssistantMessageIds: string[];
}
// 描述:
//
//   - 统一智能体工作流当前选择项本地存储键。
export const AGENT_WORKFLOW_SELECTED_KEY = "libra.desktop.agent.selectedWorkflowId";

// 描述:
//
//   - 技能选中状态存储键，统一引用全局常量避免硬编码。
export const AGENT_SKILL_SELECTED_KEY = STORAGE_KEYS.AGENT_SKILL_SELECTED_IDS;

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
export function readSelectedWorkflowId(storageKey: string): string {
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
export function readSelectedSkillIds(storageKey: string): string[] {
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
//   - 构建“会话已选择技能”提示词片段，向智能体明确当前会话需优先遵循的技能上下文。
//
// Params:
//
//   - selectedSkills: 当前会话选择的技能列表。
//
// Returns:
//
//   - 可拼接到主提示词的技能片段；未选择技能时返回空字符串。
export function buildSessionSkillPrompt(selectedSkills: AgentSkillItem[]): string {
  if (selectedSkills.length === 0) {
    return "";
  }
  const blocks = selectedSkills.map((item) => {
    const lines = [`### ${item.name} (${item.id})`];
    if (item.description) {
      lines.push(item.description);
    }
    if (item.markdownBody) {
      lines.push(item.markdownBody);
    }
    return lines.join("\n\n");
  });
  return ["【会话技能】", ...blocks].join("\n\n");
}

// 描述：
//
//   - 会话上下文拼接时保留的历史消息条数上限，避免提示词无限膨胀。
export const AGENT_CONTEXT_HISTORY_LIMIT = 8;

// 描述：
//
//   - 会话上下文中单条消息的最大字符数，超长时进行截断。
export const AGENT_CONTEXT_MESSAGE_CHAR_LIMIT = 600;

// 描述：
//
//   - “重试/继续”类短指令关键词；命中后会改写为可执行请求，避免模型误判“缺少需求”。
export const AGENT_RETRY_HINT_KEYWORDS = ["重试", "再试", "retry", "继续", "继续执行", "继续处理"];

// 描述：
//
//   - 结构化项目信息上下文每个分类最多注入条数，避免提示词过长。
export const AGENT_PROFILE_CONTEXT_ITEM_LIMIT = 4;

// 描述：
//
//   - 结构化项目信息“按需注入”触发关键词；仅在模型明确需要项目语义基线时注入，避免首轮提示词冗长。
export const AGENT_PROFILE_ON_DEMAND_KEYWORDS = [
  "结构化项目信息",
  "结构化信息",
  "项目结构",
  "代码结构",
  "页面布局",
  "信息架构",
  "交互契约",
  "数据模型",
  "api 模型",
  "框架替换",
  "框架迁移",
  "重构",
  "迁移",
  "按项目规范",
];

// 描述：
//
//   - 识别“框架替换/迁移”需求的关键词，命中后会注入结构不变约束。
export const CODE_FRAMEWORK_REPLACEMENT_KEYWORDS = [
  "框架替换",
  "替换框架",
  "切换框架",
  "框架迁移",
  "迁移框架",
  "ui框架替换",
  "switch framework",
  "replace framework",
  "migrate framework",
];

// 描述：
//
//   - 常见 UI/前端框架词表，用于降低框架替换意图识别误判。
export const CODE_FRAMEWORK_HINT_KEYWORDS = [
  "react",
  "vue",
  "angular",
  "svelte",
  "next",
  "nuxt",
  "solid",
  "aries_react",
  "antd",
  "ant design",
  "mui",
  "element-plus",
  "chakra",
  "bootstrap",
  "tailwind",
];

// 描述：
//
//   - 将结构化项目信息转换为会话提示词上下文片段。
//
// Params:
//
//   - profile: 当前项目结构化信息。
//
// Returns:
//
//   - 可拼接到提示词的行数组。
export function buildCodeProjectProfileContextLines(
  profile?: ProjectWorkspaceProfile | null,
): string[] {
  if (!profile) {
    return [];
  }

  const lines: string[] = ["【项目结构化信息】"];
  const summary = String(profile.summary || "").trim();
  if (summary) {
    lines.push(`摘要：${summary}`);
  }

  const pushList = (label: string, items: string[]) => {
    const normalized = items
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0)
      .slice(0, AGENT_PROFILE_CONTEXT_ITEM_LIMIT);
    if (normalized.length === 0) {
      return;
    }
    lines.push(`${label}：${normalized.join("；")}`);
  };

  const knowledgeSections = Array.isArray(profile.knowledgeSections)
    ? profile.knowledgeSections
    : [];
  if (knowledgeSections.length > 0) {
    knowledgeSections.forEach((section) => {
      const sectionTitle = String(section.title || "").trim() || String(section.key || "").trim() || "未命名分类";
      (section.facets || []).forEach((facet) => {
        const facetLabel = String(facet.label || "").trim() || String(facet.key || "").trim() || "未命名字段";
        pushList(`${sectionTitle} · ${facetLabel}`, facet.entries || []);
      });
    });
  } else {
    pushList("API 数据实体", profile.apiDataModel.entities || []);
    pushList("API 请求模型", profile.apiDataModel.requestModels || []);
    pushList("API 响应模型", profile.apiDataModel.responseModels || []);
    pushList("API Mock 场景", profile.apiDataModel.mockCases || []);
    pushList("前端页面清单", profile.frontendPageLayout.pages || []);
    pushList("导航与菜单项", profile.frontendPageLayout.navigation || []);
    pushList("页面元素结构", profile.frontendPageLayout.pageElements || []);
    pushList("前端目录结构", profile.frontendCodeStructure.directories || []);
    pushList("前端模块边界", profile.frontendCodeStructure.moduleBoundaries || []);
    pushList("前端实现约束", profile.frontendCodeStructure.implementationConstraints || []);
    pushList("编码约定", profile.codingConventions || []);
  }
  lines.push("");
  return lines;
}

// 描述：
//
//   - 从结构化分类中读取指定 facet 条目；若分类不存在则回退到兼容字段。
//
// Params:
//
//   - profile: 项目结构化信息。
//   - sectionKey: 分类键。
//   - facetKey: 字段键。
//   - fallback: 兼容字段兜底值。
//
// Returns:
//
//   - 条目数组。
export function readProjectProfileFacetEntries(
  profile: ProjectWorkspaceProfile,
  sectionKey: string,
  facetKey: string,
  fallback: string[],
): string[] {
  const section = (profile.knowledgeSections || []).find((item) => item.key === sectionKey);
  const facet = section?.facets.find((item) => item.key === facetKey);
  const source = facet?.entries || fallback;
  return source
    .map((item) => String(item || "").trim())
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
}

// 描述：
//
//   - 判断当前请求是否为“框架替换但保留页面结构”的迁移类任务。
//
// Params:
//
//   - prompt: 当前用户输入。
//
// Returns:
//
//   - true 表示命中框架替换语义。
export function isFrameworkReplacementPrompt(prompt: string): boolean {
  const normalized = String(prompt || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (CODE_FRAMEWORK_REPLACEMENT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }
  const hasFrameworkWord = normalized.includes("框架");
  const hasReplacementVerb = /(替换|切换|迁移|改用|重写|升级)/.test(normalized);
  if (hasFrameworkWord && hasReplacementVerb) {
    return true;
  }
  const hasFrameworkHint = CODE_FRAMEWORK_HINT_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasSwitchIntent = /(replace|switch|migrate|rewrite|refactor|迁移|替换|切换)/.test(normalized);
  return hasFrameworkHint && hasSwitchIntent;
}

// 描述：
//
//   - 为“框架替换”场景构建结构保持约束，优先要求沿用页面布局与前端代码结构语义。
//
// Params:
//
//   - prompt: 当前用户输入。
//   - profile: 当前项目结构化信息。
//
// Returns:
//
//   - 可拼接到提示词的附加约束行数组。
export function buildFrameworkReplacementContextLines(
  prompt: string,
  profile?: ProjectWorkspaceProfile | null,
): string[] {
  if (!profile || !isFrameworkReplacementPrompt(prompt)) {
    return [];
  }
  const uiSectionKey = "ui_information_architecture";
  const frontendArchitectureSectionKey = "frontend_implementation_architecture";
  const pageBaseline = readProjectProfileFacetEntries(
    profile,
    uiSectionKey,
    "pages",
    profile.frontendPageLayout.pages || [],
  )
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0)
    .slice(0, AGENT_PROFILE_CONTEXT_ITEM_LIMIT);
  const moduleBaseline = [
    ...readProjectProfileFacetEntries(
      profile,
      frontendArchitectureSectionKey,
      "directories",
      profile.frontendCodeStructure.directories || [],
    ),
    ...readProjectProfileFacetEntries(
      profile,
      frontendArchitectureSectionKey,
      "moduleBoundaries",
      profile.frontendCodeStructure.moduleBoundaries || [],
    ),
  ]
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0)
    .slice(0, AGENT_PROFILE_CONTEXT_ITEM_LIMIT);
  const hasUiBaseline = pageBaseline.length > 0
    || readProjectProfileFacetEntries(
      profile,
      uiSectionKey,
      "navigation",
      profile.frontendPageLayout.navigation || [],
    ).length > 0
    || readProjectProfileFacetEntries(
      profile,
      uiSectionKey,
      "pageElements",
      profile.frontendPageLayout.pageElements || [],
    ).length > 0;
  const hasArchitectureBaseline = moduleBaseline.length > 0
    || readProjectProfileFacetEntries(
      profile,
      frontendArchitectureSectionKey,
      "implementationConstraints",
      profile.frontendCodeStructure.implementationConstraints || [],
    ).length > 0;
  if (!hasUiBaseline && !hasArchitectureBaseline) {
    return [];
  }
  const lines: string[] = [
    "【框架替换执行约束】",
    "保持页面结构语义、信息架构和交互目标不变，仅替换框架相关实现。",
  ];
  if (pageBaseline.length > 0) {
    lines.push(`页面结构基线：${pageBaseline.join("；")}`);
  }
  if (moduleBaseline.length > 0) {
    lines.push(`模块边界基线：${moduleBaseline.join("；")}`);
  }
  lines.push("优先复用既有 API 数据模型与页面布局定义，避免引入无关重构。");
  lines.push("若新框架能力存在差异，先说明差异，再给出兼容实现。");
  lines.push("");
  return lines;
}

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
export function normalizeCodeContextMessageText(text: string): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= AGENT_CONTEXT_MESSAGE_CHAR_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, AGENT_CONTEXT_MESSAGE_CHAR_LIMIT)}...(已截断)`;
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
export function isRetryOnlyPrompt(prompt: string): boolean {
  const normalized = String(prompt || "").trim().toLowerCase();
  return AGENT_RETRY_HINT_KEYWORDS.includes(normalized);
}

// 描述：
//
//   - 为智能体构建“历史上下文 + 当前请求”的提示词，确保“重试”场景不会丢失前文语义。
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
export function buildSessionContextPrompt(
  historyMessages: MessageItem[],
  currentPrompt: string,
  workspacePath?: string,
  projectProfile?: ProjectWorkspaceProfile | null,
): string {
  const normalizedCurrentPrompt = String(currentPrompt || "").trim();
  if (!normalizedCurrentPrompt) {
    return "";
  }
  const normalizedWorkspacePath = String(workspacePath || "").trim();
  // 描述：
  //
  //   - 仅在“重试继续”或当前请求明确依赖项目语义基线时注入结构化项目信息，避免首轮全量灌入。
  const shouldAttachProfileContext = isRetryOnlyPrompt(normalizedCurrentPrompt)
    || AGENT_PROFILE_ON_DEMAND_KEYWORDS.some((keyword) => normalizedCurrentPrompt.toLowerCase().includes(keyword.toLowerCase()));
  const profileContextLines = shouldAttachProfileContext
    ? buildCodeProjectProfileContextLines(projectProfile)
    : [];
  const frameworkReplacementContextLines = buildFrameworkReplacementContextLines(
    normalizedCurrentPrompt,
    projectProfile,
  );
  const historyLines = historyMessages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role === "user" ? "用户" : "助手",
      text: normalizeCodeContextMessageText(item.text),
    }))
    .filter((item) => item.text.length > 0)
    .slice(-AGENT_CONTEXT_HISTORY_LIMIT)
    .map((item, index) => `${index + 1}. ${item.role}：${item.text}`);

  if (historyLines.length === 0) {
    if (normalizedWorkspacePath) {
      return [
        "【当前项目】",
        `路径：${normalizedWorkspacePath}`,
        "约束：仅基于该目录进行分析与修改，不要切换到其它工程。",
        "",
        ...profileContextLines,
        ...frameworkReplacementContextLines,
        "【当前请求】",
        normalizedCurrentPrompt,
      ].join("\n");
    }
    if (profileContextLines.length > 0) {
      return [
        ...profileContextLines,
        ...frameworkReplacementContextLines,
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
    ...profileContextLines,
    ...frameworkReplacementContextLines,
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
export function trimOutputSuffix(path: string): string {
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
export function extractOutputDirFromPrompt(prompt: string): string | undefined {
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
// 描述：
//
//   - 定义会话调试 Trace 记录结构，用于 UI 侧聚合展示调试链路。
export interface TraceRecord {
  traceId: string;
  source: string;
  code?: string;
  message: string;
}

// 描述：将单条步骤记录合并到现有步骤列表，按 index 覆盖同编号项，避免流式重复追加。
export function mergeAgentStepRecords(records: AgentStepRecord[], incoming?: AgentStepRecord): AgentStepRecord[] {
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
export function mergeAgentEventRecords(records: AgentEventRecord[], incoming?: AgentEventRecord): AgentEventRecord[] {
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
export function upsertAssistantMessageById(messages: MessageItem[], messageId: string, text: string): MessageItem[] {
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
export function pruneAssistantRetryTail(
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
