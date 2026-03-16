import type { AgentSkillItem } from "../../modules/common/services/skills";
import { translateDesktopText } from "../i18n";
import { normalizeAgentSkillId } from "./prompt-guidance";
import type { AgentWorkflowDefinition, WorkflowGraphNodeType } from "./types";

// 描述：
//
//   - 定义技能节点执行状态枚举。
type AgentWorkflowSkillPlanStatus = "ready" | "missing_skill_id" | "not_found";

// 描述：
//
//   - 定义单个技能节点执行计划项。
export interface AgentWorkflowSkillPlanItem {
  nodeId: string;
  nodeTitle: string;
  nodeType: WorkflowGraphNodeType;
  skillId: string;
  skillVersion: string;
  skillTitle: string;
  skillDescription: string;
  skillMarkdownBody: string;
  instruction: string;
  status: AgentWorkflowSkillPlanStatus;
}

// 描述：
//
//   - 定义统一智能体工作流技能执行计划结构。
export interface AgentWorkflowSkillExecutionPlan {
  items: AgentWorkflowSkillPlanItem[];
  readyItems: AgentWorkflowSkillPlanItem[];
  blockingIssues: string[];
  activeItem: AgentWorkflowSkillPlanItem | null;
  activeStageIndex: number;
  totalReadyCount: number;
  hasNextStage: boolean;
  planPrompt: string;
}

// 描述：
//
//   - 定义构建工作流技能执行计划时的可选参数，供运行时按阶段裁剪 Prompt。
export interface BuildAgentWorkflowSkillExecutionPlanOptions {
  stageIndex?: number;
}

// 描述：
//
//   - 判断节点类型是否属于会进入阶段执行链路的节点；当前 action / skill 都会参与统一阶段编排。
//
// Params:
//
//   - nodeType: 节点类型。
//
// Returns:
//
//   - true: 当前节点会进入阶段执行计划。
function isExecutableWorkflowNodeType(nodeType: WorkflowGraphNodeType): boolean {
  return nodeType === "action" || nodeType === "skill";
}

// 描述：
//
//   - 将可用技能列表转换为按标准技能编码索引的映射，供工作流执行前校验复用。
//
// Params:
//
//   - skills: 当前已发现的技能列表。
//
// Returns:
//
//   - 按技能编码索引的映射。
function buildAgentSkillMap(skills: AgentSkillItem[]): Map<string, AgentSkillItem> {
  const skillMap = new Map<string, AgentSkillItem>();
  skills.forEach((item) => {
    const normalizedSkillId = normalizeAgentSkillId(item.id);
    if (!normalizedSkillId) {
      return;
    }
    skillMap.set(normalizedSkillId, item);
  });
  return skillMap;
}

// 描述：
//
//   - 为单个阶段构造执行说明块；技能节点会追加技能定义，动作节点则直接使用工作流内嵌内容。
//
// Params:
//
//   - item: 已就绪的技能计划项。
//
// Returns:
//   - 阶段说明文本块。
function buildSkillInstructionBlock(item: AgentWorkflowSkillPlanItem): string {
  const lines = [`### ${item.nodeTitle}`];
  if (item.nodeType === "skill" && item.skillId) {
    lines.push(`技能：${item.skillTitle} (${item.skillId})`);
  }
  if (item.skillDescription) {
    lines.push(item.skillDescription);
  }
  if (item.instruction) {
    lines.push(translateDesktopText("节点要求：{{instruction}}", { instruction: item.instruction }));
  }
  if (item.skillMarkdownBody) {
    lines.push(item.skillMarkdownBody);
  }
  return lines.filter((line) => String(line || "").trim().length > 0).join("\n\n");
}

// 描述：
//
//   - 从统一智能体工作流中构建技能执行计划，并返回可注入提示词的计划文本。
//
// Params:
//
//   - workflow: 当前智能体工作流定义。
//   - skills: 当前已发现的技能列表。
//
// Returns:
//
//   - 技能执行计划。
export function buildAgentWorkflowSkillExecutionPlan(
  workflow: AgentWorkflowDefinition | null | undefined,
  skills: AgentSkillItem[],
  options?: BuildAgentWorkflowSkillExecutionPlanOptions,
): AgentWorkflowSkillExecutionPlan {
  const skillMap = buildAgentSkillMap(skills);
  const skillNodes = (workflow?.graph?.nodes || []).filter((node) => isExecutableWorkflowNodeType(node.type));

  if (skillNodes.length === 0) {
    return {
      items: [],
      readyItems: [],
      blockingIssues: [],
      activeItem: null,
      activeStageIndex: 0,
      totalReadyCount: 0,
      hasNextStage: false,
      planPrompt: "",
    };
  }

  const items: AgentWorkflowSkillPlanItem[] = skillNodes.map((node) => {
    const nodeType = node.type === "skill" ? "skill" : "action";
    const nodeTitle = String(node.title || translateDesktopText("阶段节点")).trim() || translateDesktopText("阶段节点");
    const skillId = normalizeAgentSkillId(String(node.skillId || "").trim());
    const skillVersion = String(node.skillVersion || "").trim();
    const description = String(node.description || "").trim();
    const instruction = String(node.instruction || "").trim();
    const content = String(node.content || "").trim();

    if (nodeType === "action") {
      return {
        nodeId: node.id,
        nodeTitle,
        nodeType,
        skillId: "",
        skillVersion: "",
        skillTitle: nodeTitle,
        skillDescription: description,
        skillMarkdownBody: content,
        instruction,
        status: "ready",
      };
    }

    if (!skillId) {
      return {
        nodeId: node.id,
        nodeTitle,
        nodeType,
        skillId: "",
        skillVersion,
        skillTitle: "",
        skillDescription: "",
        skillMarkdownBody: "",
        instruction,
        status: "missing_skill_id",
      };
    }

    const resolvedSkill = skillMap.get(skillId);
    if (!resolvedSkill) {
      return {
        nodeId: node.id,
        nodeTitle,
        nodeType,
        skillId,
        skillVersion,
        skillTitle: "",
        skillDescription: "",
        skillMarkdownBody: "",
        instruction,
        status: "not_found",
      };
    }

    return {
      nodeId: node.id,
      nodeTitle,
      nodeType,
      skillId,
      skillVersion,
      skillTitle: resolvedSkill.title,
      skillDescription: resolvedSkill.description,
      skillMarkdownBody: resolvedSkill.markdownBody,
      instruction,
      status: "ready",
    };
  });

  const readyItems = items.filter((item) => item.status === "ready");
  const blockingIssues = items
    .filter((item) => item.status !== "ready")
    .map((item) => {
      if (item.status === "missing_skill_id") {
        return translateDesktopText("节点「{{title}}」未配置技能编码", { title: item.nodeTitle });
      }
      return translateDesktopText("技能「{{skillId}}」未在 Agent Skills 注册表中找到（节点：{{title}}）", {
        skillId: item.skillId,
        title: item.nodeTitle,
      });
    });

  const totalReadyCount = readyItems.length;
  const rawStageIndex = Number(options?.stageIndex ?? 0);
  const normalizedStageIndex = totalReadyCount > 0
    ? Math.min(Math.max(Number.isFinite(rawStageIndex) ? Math.floor(rawStageIndex) : 0, 0), totalReadyCount - 1)
    : 0;
  const stageScoped = typeof options?.stageIndex === "number" && totalReadyCount > 0;
  const activeItem = totalReadyCount > 0 ? readyItems[normalizedStageIndex] : null;
  const promptItems = stageScoped && activeItem ? [activeItem] : readyItems;

  const planPrompt = promptItems.length > 0
    ? [
        translateDesktopText("【阶段执行计划】"),
        ...(stageScoped
          ? [
            translateDesktopText("当前阶段：{{current}}/{{total}}", {
              current: normalizedStageIndex + 1,
              total: totalReadyCount,
            }),
          ]
          : []),
        ...promptItems.map((item, index) => {
          const instructionText = item.instruction
            ? translateDesktopText("；节点要求：{{instruction}}", { instruction: item.instruction })
            : "";
          const descriptionText = item.skillDescription
            ? translateDesktopText(item.nodeType === "skill" ? "；技能说明：{{description}}" : "；阶段说明：{{description}}", {
              description: item.skillDescription,
            })
            : "";
          const displayIndex = stageScoped ? normalizedStageIndex : index;
          if (item.nodeType === "skill") {
            return `${displayIndex + 1}. ${item.nodeTitle}：${item.skillTitle} (${item.skillId})${descriptionText}${instructionText}`;
          }
          return `${displayIndex + 1}. ${item.nodeTitle}${descriptionText}${instructionText}`;
        }),
        stageScoped
          ? translateDesktopText("执行约束：本轮仅执行当前阶段，禁止提前执行后续阶段；若当前阶段失败，先输出阻塞原因与修复建议，再决定是否继续。")
          : translateDesktopText("执行约束：按顺序执行阶段；若任一步骤失败，先输出阻塞原因与修复建议，再决定是否继续。"),
        "",
        translateDesktopText("【阶段定义】"),
        ...promptItems.map((item) => buildSkillInstructionBlock(item)),
      ].join("\n\n")
    : "";

  return {
    items,
    readyItems,
    blockingIssues,
    activeItem,
    activeStageIndex: normalizedStageIndex,
    totalReadyCount,
    hasNextStage: totalReadyCount > 0 && normalizedStageIndex + 1 < totalReadyCount,
    planPrompt,
  };
}
