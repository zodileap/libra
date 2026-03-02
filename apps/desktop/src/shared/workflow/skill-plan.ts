import type { CodeWorkflowDefinition } from "./types";

// 描述：
//
//   - 技能安装状态本地存储键，与技能管理页保持一致。
const SKILL_INSTALL_STATE_STORAGE_KEY = "zodileap.desktop.skills.installed";

// 描述：
//
//   - 默认预装技能 ID 列表，用于首次启动时兜底安装态。
const DEFAULT_INSTALLED_SKILL_IDS = ["skill_creator", "skill_installer"];

// 描述：
//
//   - 定义技能节点执行状态枚举。
type CodeWorkflowSkillPlanStatus = "ready" | "missing_skill_id" | "not_installed";

// 描述：
//
//   - 定义单个技能节点执行计划项。
export interface CodeWorkflowSkillPlanItem {
  nodeId: string;
  nodeTitle: string;
  skillId: string;
  skillVersion: string;
  instruction: string;
  status: CodeWorkflowSkillPlanStatus;
}

// 描述：
//
//   - 定义代码工作流技能执行计划结构。
export interface CodeWorkflowSkillExecutionPlan {
  items: CodeWorkflowSkillPlanItem[];
  readyItems: CodeWorkflowSkillPlanItem[];
  blockingIssues: string[];
  planPrompt: string;
}

// 描述：
//
//   - 读取当前已安装技能集合；读取失败时使用默认预装集合兜底。
//
// Returns:
//
//   - 已安装技能 ID 集合。
function readInstalledSkillIdSet(): Set<string> {
  if (typeof window === "undefined") {
    return new Set(DEFAULT_INSTALLED_SKILL_IDS);
  }
  const rawValue = window.localStorage.getItem(SKILL_INSTALL_STATE_STORAGE_KEY);
  if (!rawValue) {
    return new Set(DEFAULT_INSTALLED_SKILL_IDS);
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set(DEFAULT_INSTALLED_SKILL_IDS);
    }
    const normalized = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (normalized.length === 0) {
      return new Set(DEFAULT_INSTALLED_SKILL_IDS);
    }
    return new Set(normalized);
  } catch (_err) {
    return new Set(DEFAULT_INSTALLED_SKILL_IDS);
  }
}

// 描述：
//
//   - 构建技能引用文本，格式为 skillId@version。
//
// Params:
//
//   - item: 技能计划项。
//
// Returns:
//
//   - 技能引用文本。
function buildSkillReference(item: Pick<CodeWorkflowSkillPlanItem, "skillId" | "skillVersion">): string {
  if (!item.skillVersion) {
    return item.skillId;
  }
  return `${item.skillId}@${item.skillVersion}`;
}

// 描述：
//
//   - 从代码工作流中构建技能执行计划，并返回可注入提示词的计划文本。
//
// Params:
//
//   - workflow: 当前代码工作流定义。
//
// Returns:
//
//   - 技能执行计划。
export function buildCodeWorkflowSkillExecutionPlan(
  workflow: CodeWorkflowDefinition | null | undefined,
): CodeWorkflowSkillExecutionPlan {
  const installedSkillIdSet = readInstalledSkillIdSet();
  const skillNodes = (workflow?.graph?.nodes || []).filter((node) => node.type === "skill");

  if (skillNodes.length === 0) {
    return {
      items: [],
      readyItems: [],
      blockingIssues: [],
      planPrompt: "",
    };
  }

  const items: CodeWorkflowSkillPlanItem[] = skillNodes.map((node) => {
    const nodeTitle = String(node.title || "技能节点").trim() || "技能节点";
    const skillId = String(node.skillId || "").trim();
    const skillVersion = String(node.skillVersion || "").trim();
    const instruction = String(node.instruction || "").trim();

    if (!skillId) {
      return {
        nodeId: node.id,
        nodeTitle,
        skillId: "",
        skillVersion,
        instruction,
        status: "missing_skill_id",
      };
    }

    if (!installedSkillIdSet.has(skillId)) {
      return {
        nodeId: node.id,
        nodeTitle,
        skillId,
        skillVersion,
        instruction,
        status: "not_installed",
      };
    }

    return {
      nodeId: node.id,
      nodeTitle,
      skillId,
      skillVersion,
      instruction,
      status: "ready",
    };
  });

  const readyItems = items.filter((item) => item.status === "ready");
  const blockingIssues = items
    .filter((item) => item.status !== "ready")
    .map((item) => {
      if (item.status === "missing_skill_id") {
        return `节点「${item.nodeTitle}」未配置技能编码`;
      }
      return `技能「${item.skillId}」未安装（节点：${item.nodeTitle}）`;
    });

  const planPrompt = readyItems.length > 0
    ? [
        "【Skill 执行计划】",
        ...readyItems.map((item, index) => {
          const skillRef = buildSkillReference(item);
          const instructionText = item.instruction
            ? `；节点指令：${item.instruction}`
            : "";
          return `${index + 1}. ${item.nodeTitle} -> ${skillRef}${instructionText}`;
        }),
        "执行约束：按顺序执行技能；若任一步骤失败，先输出阻塞原因与修复建议，再决定是否继续。",
      ].join("\n")
    : "";

  return {
    items,
    readyItems,
    blockingIssues,
    planPrompt,
  };
}
