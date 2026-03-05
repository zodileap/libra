import type { CodeWorkflowDefinition } from "./types";
import { readInstalledSkillIdsFromStorage } from "../../modules/common/services/skills";
import { resolveCodeSkillPromptGuide } from "./prompt-guidance";

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
//   - 读取当前已安装技能集合，复用 skills 服务的统一读取逻辑。
//
// Returns:
//
//   - 已安装技能 ID 集合。
function readInstalledSkillIdSet(): Set<string> {
  return new Set(readInstalledSkillIdsFromStorage());
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
          const skillGuide = resolveCodeSkillPromptGuide(item.skillId);
          const instructionText = item.instruction
            ? `；节点指令：${item.instruction}`
            : "";
          if (skillGuide) {
            return `${index + 1}. ${item.nodeTitle}：${skillGuide.name}；能力：${skillGuide.objective}；产出：${skillGuide.deliverable}${instructionText}`;
          }
          return `${index + 1}. ${item.nodeTitle}：技能编码 ${item.skillId}${instructionText}`;
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
