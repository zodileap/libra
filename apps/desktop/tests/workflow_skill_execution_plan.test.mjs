import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，用于校验 Skill 执行计划与会话执行链路接入。
//
// Params:
//
//   - relativePath: 基于 apps/desktop 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readDesktopSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestWorkflowSkillExecutionPlanShouldValidateRegistryStateAndBuildPrompt", () => {
  const skillPlanSource = readDesktopSource("src/shared/workflow/skill-plan.ts");
  const workflowStorageSource = readDesktopSource("src/shared/workflow/storage.ts");
  const promptGuidanceSource = readDesktopSource("src/shared/workflow/prompt-guidance.ts");
  const workflowIndexSource = readDesktopSource("src/shared/workflow/index.ts");
  const sessionPageSource = [
    readDesktopSource("src/widgets/session/page.tsx"),
    readDesktopSource("src/widgets/session/prompt-utils.ts"),
  ].join("\n");

  // 描述：
  //
  //   - 阶段计划构建器应基于真实技能注册表校验 skill 节点，并支持 action 节点直接携带内嵌正文。
  assert.match(skillPlanSource, /buildAgentSkillMap/);
  assert.match(skillPlanSource, /status: "missing_skill_id"/);
  assert.match(skillPlanSource, /status: "not_found"/);
  assert.match(skillPlanSource, /blockingIssues/);
  assert.match(skillPlanSource, /activeItem: AgentWorkflowSkillPlanItem \| null;/);
  assert.match(skillPlanSource, /activeStageIndex: number;/);
  assert.match(skillPlanSource, /totalReadyCount: number;/);
  assert.match(skillPlanSource, /hasNextStage: boolean;/);
  assert.match(skillPlanSource, /stageIndex\?: number;/);
  assert.match(skillPlanSource, /nodeType: WorkflowGraphNodeType;/);
  assert.match(skillPlanSource, /return nodeType === "action" \|\| nodeType === "skill";/);
  assert.match(skillPlanSource, /if \(nodeType === "action"\) \{/);
  assert.match(skillPlanSource, /skillMarkdownBody: content,/);
  assert.match(skillPlanSource, /"【阶段执行计划】"/);
  assert.match(skillPlanSource, /"当前阶段：\{\{current\}\}\/\{\{total\}\}"/);
  assert.match(skillPlanSource, /"执行约束：本轮仅执行当前阶段，禁止提前执行后续阶段；若当前阶段失败，先输出阻塞原因与修复建议，再决定是否继续。"/);
  assert.match(skillPlanSource, /"【阶段定义】"/);
  assert.match(skillPlanSource, /skillMarkdownBody/);
  assert.match(skillPlanSource, /normalizeAgentSkillId/);
  assert.match(skillPlanSource, /buildAgentWorkflowSkillExecutionPlan/);

  // 描述：
  //
  //   - 工作流 Prompt 构建应支持运行时动态工具清单，同时通过技能别名归一化兼容旧工作流。
  assert.match(promptGuidanceSource, /AGENT_TOOLSET_LINES/);
  assert.match(promptGuidanceSource, /buildAgentToolsetLines/);
  assert.match(promptGuidanceSource, /buildPlaywrightInteractiveRuntimePrompt/);
  assert.match(promptGuidanceSource, /DEFAULT_AGENT_RUNTIME_CAPABILITIES/);
  assert.match(promptGuidanceSource, /interactiveMode: "none"/);
  assert.match(promptGuidanceSource, /if \(normalizedRuntimeCapabilities\.interactiveMode === "native"\)/);
  assert.match(promptGuidanceSource, /js_repl、js_repl_reset、browser_navigate、browser_snapshot、browser_click、browser_type、browser_wait_for、browser_take_screenshot、browser_tabs、browser_close/);
  assert.match(promptGuidanceSource, /mcp_tool\(server=.*tool=.*list_tools/);
  assert.match(promptGuidanceSource, /当前阶段必须显式标记为“已跳过”/);
  assert.match(promptGuidanceSource, /禁止 import 第三方工具模块/);
  assert.match(promptGuidanceSource, /工具调用签名与示例/);
  assert.match(promptGuidanceSource, /- read_text\(path\)：content = read_text/);
  assert.match(promptGuidanceSource, /- read_json\(path\)：data = read_json/);
  assert.match(promptGuidanceSource, /不要依赖 _ 接收上一条结果/);
  assert.match(promptGuidanceSource, /todo_write\(items\)/);
  assert.match(promptGuidanceSource, /request_user_input/);
  assert.match(promptGuidanceSource, /仅在需要用户做高影响决策时才允许调用 request_user_input/);
  assert.match(promptGuidanceSource, /每个问题只允许 2-3 个互斥选项/);
  assert.match(promptGuidanceSource, /不要自己构造第 4 个“其他”选项/);
  assert.match(promptGuidanceSource, /ignored 结果当作真实执行结果处理/);
  assert.match(promptGuidanceSource, /LEGACY_AGENT_SKILL_ID_ALIASES/);
  assert.match(promptGuidanceSource, /normalizeAgentSkillId/);
  assert.match(workflowStorageSource, /buildAgentToolsetLines/);
  assert.match(workflowStorageSource, /buildPlaywrightInteractiveRuntimePrompt/);
  assert.match(workflowStorageSource, /isPlaywrightInteractiveSkillId/);
  assert.match(workflowStorageSource, /normalizeAgentSkillId/);
  assert.match(workflowStorageSource, /return nodeType === "action" \|\| nodeType === "skill";/);
  assert.match(workflowStorageSource, /translateDesktopText\("- \{\{label\}\}：技能编码 \{\{skillId\}\}"/);
  assert.match(workflowStorageSource, /translateDesktopText\("【执行链路】"\)/);
  assert.match(workflowStorageSource, /兼容读取历史工作流中残留的项目能力声明字段/);
  assert.doesNotMatch(workflowStorageSource, /translateDesktopText\("【项目能力声明】"\)/);
  assert.doesNotMatch(workflowStorageSource, /getProjectWorkspaceCapabilityManifest/);

  // 描述：
  //
  //   - workflow 模块索引应导出 skill-plan，供会话执行链路复用。
  assert.match(workflowIndexSource, /export \* from "\.\/skill-plan";/);

  // 描述：
  //
  //   - 统一智能体发送前应执行阶段计划校验，失败时阻断；成功时将计划拼接到 prompt。
  assert.match(sessionPageSource, /buildAgentWorkflowSkillExecutionPlan\(activeWorkflow, availableSkills\)/);
  assert.match(sessionPageSource, /buildAgentWorkflowSkillExecutionPlan\(activeWorkflow, availableSkills, \{ stageIndex: currentStageIndex \}\)/);
  assert.match(sessionPageSource, /if \(skillExecutionPlan\.blockingIssues\.length > 0\)/);
  assert.match(sessionPageSource, /throw new Error\(t\("工作流阶段前检查未通过：\{\{issues\}\}", \{\s*issues: skillExecutionPlan\.blockingIssues\.join\("；"\),\s*\}\)\)/s);
  assert.doesNotMatch(sessionPageSource, /selectedWorkflowMissingRequiredCapabilities/);
  assert.match(sessionPageSource, /const latestProjectProfile = activeWorkspace\?\.id\s*\?\s*\(activeProjectProfile \|\| getProjectWorkspaceProfile\(activeWorkspace\.id\)\)\s*:\s*null;/s);
  assert.match(sessionPageSource, /const currentRequestPrompt = buildSessionContextPrompt\(\s*nextContextMessages,\s*normalizedContent,\s*undefined,\s*latestProjectProfile,\s*activeWorkspaceEnabledCapabilities,\s*runtimeInfo,\s*\);/s);
  assert.match(sessionPageSource, /const contextualRequestPrompt = buildSessionContextPrompt\(\s*nextContextMessages,\s*normalizedContent,\s*String\(activeWorkspace\?\.path \|\| ""\)\.trim\(\) \|\| undefined,\s*latestProjectProfile,\s*activeWorkspaceEnabledCapabilities,\s*runtimeInfo,\s*\);/s);
  assert.match(sessionPageSource, /const runtimeCapabilities = await getAgentRuntimeCapabilities\(\{/);
  assert.match(sessionPageSource, /workspaceRoot: String\(activeWorkspace\?\.path \|\| ""\)\.trim\(\) \|\| undefined,/);
  assert.match(sessionPageSource, /const hasWorkflowPlaywrightInteractiveSkill = \(scopedWorkflow\?\.graph\?\.nodes \|\| \[\]\)\.some/);
  assert.match(sessionPageSource, /const hasSelectedPlaywrightInteractiveSkill = effectiveSelectedSessionSkills\.some/);
  assert.match(sessionPageSource, /const selectedPlaywrightRuntimePrompt = hasSelectedPlaywrightInteractiveSkill/);
  assert.match(sessionPageSource, /scopeWorkflowDefinitionToStageNode\(activeWorkflow, currentStageItem\.nodeId\)/);
  assert.match(sessionPageSource, /const agentPrompt = currentStagePlan\.planPrompt/);
  assert.match(sessionPageSource, /source: "workflow:skill_plan"/);
  assert.match(sessionPageSource, /prompt: agentPrompt/);
  assert.match(sessionPageSource, /runtimeCapabilities,/);
  assert.match(sessionPageSource, /const effectiveSelectedSkillIds = Array\.isArray\(options\?\.selectedSkillIdsOverride\)/);
  assert.match(sessionPageSource, /const activeWorkflow = options\?\.disableWorkflow/);
  assert.match(sessionPageSource, /const routedCurrentRequestPrompt = options\?\.workflowPromptPreamble/);
  assert.match(sessionPageSource, /const routedContextualRequestPrompt = options\?\.workflowPromptPreamble/);
  assert.match(sessionPageSource, /let currentStageIndex = hasWorkflowStages \? initialStageIndex : 0;/);
  assert.match(sessionPageSource, /let currentStageAttempt = 0;/);
  assert.match(sessionPageSource, /while \(currentStageIndex < \(hasWorkflowStages \? totalWorkflowStageCount : 1\)\)/);
  assert.match(sessionPageSource, /interface WorkflowStageCompletionDecision \{/);
  assert.match(sessionPageSource, /function shouldRequireWorkflowStageValidation\(item: AgentWorkflowSkillPlanItem \| null\): boolean \{/);
  assert.match(sessionPageSource, /String\(item\.nodeId \|\| ""\)\.trim\(\) === "wf-agent-full-delivery-pages"/);
  assert.match(sessionPageSource, /function collectWorkflowStageTerminalCommands\(runMeta: AssistantRunMeta \| undefined\): string\[] \{/);
  assert.match(sessionPageSource, /function hasWorkflowStageValidationEvidence\(terminalCommands: string\[\]\): boolean \{/);
  assert.match(sessionPageSource, /function resolveWorkflowStageCompletionDecision\(/);
  assert.match(sessionPageSource, /const completionDecision = hasWorkflowStages\s*\?\s*resolveWorkflowStageCompletionDecision\(/s);
  assert.match(sessionPageSource, /const effectiveResponseControl = completionDecision\.control;/);
  assert.match(sessionPageSource, /const effectiveResponseDisplayMessage = completionDecision\.displayMessage;/);
  assert.match(sessionPageSource, /if \(hasWorkflowStages && effectiveResponseControl !== "done"\) \{/);
  assert.match(sessionPageSource, /const pendingStageStatus = completionDecision\.reason/);
  assert.match(sessionPageSource, /const nextWorkflowPhaseCursor = buildWorkflowPhaseCursorSnapshot\(/);
  assert.match(sessionPageSource, /setWorkflowPhaseCursor\(nextWorkflowPhaseCursor\);/);
  assert.match(skillPlanSource, /lines\.push\(item\.skillMarkdownBody\);/);

  // 描述：
  //
  //   - 项目知识能力启用后才允许按需注入结构化项目信息，避免首轮请求默认拼接全量项目语义基线。
  assert.match(sessionPageSource, /const AGENT_PROFILE_ON_DEMAND_KEYWORDS = resolveDesktopTextVariants\(DESKTOP_TEXT_VARIANT_GROUPS\.agentProfileOnDemand\);/);
  assert.match(sessionPageSource, /const projectKnowledgeEnabled = enabledCapabilities\.includes\("project-knowledge"\);/);
  assert.match(sessionPageSource, /const shouldAttachProfileContext = isRetryOnlyPrompt\(normalizedCurrentPrompt\)/);
  assert.match(sessionPageSource, /AGENT_PROFILE_ON_DEMAND_KEYWORDS\.some\(\(keyword\) => normalizedCurrentPrompt\.toLowerCase\(\)\.includes\(keyword\)\)/);
  assert.match(sessionPageSource, /const runtimeInfo = desktopRuntimeInfoRef\.current \|\| await getDesktopRuntimeInfo\(\);/);
});
