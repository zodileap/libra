import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供消息级执行路由回归测试复用。
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

test("TestSessionExecutionRoutingShouldSupportWorkflowSkillChatAndResumePaths", () => {
  const routingSource = readDesktopSource("src/widgets/session/execution-routing.ts");
  const sessionPageSource = readDesktopSource("src/widgets/session/page.tsx");
  const promptUtilsSource = readDesktopSource("src/widgets/session/prompt-utils.ts");

  // 描述：
  //
  //   - 路由器应显式声明五种消息级执行路径，并只基于规则裁决，不依赖额外模型分类。
  assert.match(routingSource, /type SessionExecutionRouteKind =/);
  assert.match(routingSource, /"resume_pending"/);
  assert.match(routingSource, /"workflow_full"/);
  assert.match(routingSource, /"workflow_partial"/);
  assert.match(routingSource, /"skill"/);
  assert.match(routingSource, /"chat"/);
  assert.match(routingSource, /const RESUME_MESSAGE_KEYWORDS = \[/);
  assert.match(routingSource, /const EXECUTION_INTENT_KEYWORDS = \[/);
  assert.match(routingSource, /const WORKFLOW_FULL_INTENT_KEYWORDS = \[/);
  assert.match(routingSource, /export function resolveSessionExecutionRoute\(/);

  // 描述：
  //
  //   - “继续”只恢复当前会话仍未完成的阶段或挂起交互，不会因为历史上完成过工作流而重新跑整条流程。
  assert.match(routingSource, /if \(wantsResume\) \{/);
  assert.match(routingSource, /if \(options\.hasPendingApproval\) \{/);
  assert.match(routingSource, /resumeTarget: "approval"/);
  assert.match(routingSource, /if \(options\.hasPendingUserInput\) \{/);
  assert.match(routingSource, /resumeTarget: "user_input"/);
  assert.match(routingSource, /if \(options\.workflowPhaseCursor\) \{/);
  assert.match(routingSource, /resumeTarget: "workflow_stage"/);

  // 描述：
  //
  //   - 选择为 none 时直接走普通对话；选择为 skill 时只在具备执行意图时进入技能执行。
  assert.match(routingSource, /if \(!hasExecutionIntent\(normalizedMessageText\)\) \{/);
  assert.match(routingSource, /routeKind: "chat"/);
  assert.match(routingSource, /当前消息缺少明确执行意图，按普通对话处理。/);
  assert.match(routingSource, /if \(normalizedSelection\.kind === "none"\) \{/);
  assert.match(routingSource, /当前会话未选择工作流或技能，按普通对话处理。/);
  assert.match(routingSource, /if \(normalizedSelection\.kind === "skill"\) \{/);
  assert.match(routingSource, /routeKind: "skill"/);

  // 描述：
  //
  //   - 工作流模式应优先命中部分阶段；若未命中阶段但已明确选择工作流，则默认从起点完整执行。
  assert.match(routingSource, /const matchedStage = findBestWorkflowStageMatch\(options\.workflow, normalizedMessageText\);/);
  assert.match(routingSource, /routeKind: "workflow_partial"/);
  assert.match(routingSource, /当前消息命中了工作流中的定向阶段，将直接从该阶段开始执行。/);
  assert.match(routingSource, /if \(hasWorkflowFullIntent\(normalizedMessageText\)\) \{/);
  assert.match(routingSource, /routeKind: "workflow_full"/);
  assert.match(routingSource, /当前消息表达了完整交付意图，将从工作流起点开始执行。/);
  assert.match(routingSource, /当前会话已选择工作流，且消息具备执行意图，将从工作流起点开始执行。/);
  assert.match(routingSource, /if \(score < 3\) \{/);
  assert.match(routingSource, /score === bestMatch\.score && stageIndex > bestMatch\.stageIndex/);
  assert.doesNotMatch(routingSource, /当前消息未命中任何工作流阶段，按普通对话处理。/);

  // 描述：
  //
  //   - 会话页发送前必须先记录消息级执行路由，再按不同路由分别分流 prompt 构建与执行入口。
  assert.match(sessionPageSource, /const executionSelectionRef = useRef<SessionExecutionSelection>\(executionSelection\);/);
  assert.match(sessionPageSource, /executionSelectionRef\.current = executionSelection;/);
  assert.match(sessionPageSource, /const selectedWorkflowRef = useRef<AgentWorkflowDefinition \| null>\(selectedWorkflow\);/);
  assert.match(sessionPageSource, /selectedWorkflowRef\.current = selectedWorkflow;/);
  assert.match(sessionPageSource, /const activeSelectedSkillIdsRef = useRef<string\[\]>\(activeSelectedSkillIds\);/);
  assert.match(sessionPageSource, /activeSelectedSkillIdsRef\.current = activeSelectedSkillIds;/);
  assert.match(sessionPageSource, /const availableSkillsRef = useRef<AgentSkillItem\[\]>\(availableSkills\);/);
  assert.match(sessionPageSource, /availableSkillsRef\.current = availableSkills;/);
  assert.match(sessionPageSource, /const currentExecutionSelection = executionSelectionRef\.current;/);
  assert.match(sessionPageSource, /const currentSelectedWorkflow = selectedWorkflowRef\.current;/);
  assert.match(sessionPageSource, /const currentAvailableSkills = availableSkillsRef\.current;/);
  assert.match(sessionPageSource, /const routeDecision = resolveSessionExecutionRoute\(\{/);
  assert.match(sessionPageSource, /selection: currentExecutionSelection,/);
  assert.match(sessionPageSource, /workflow: currentSelectedWorkflow,/);
  assert.match(sessionPageSource, /workflowPhaseCursor: workflowPhaseCursorRef\.current,/);
  assert.match(sessionPageSource, /appendDebugFlowRecord\(\s*"ui",\s*"message_route",\s*t\("消息执行路由"\)/s);
  assert.match(sessionPageSource, /source: "workflow:route"/);
  assert.match(sessionPageSource, /if \(routeDecision\.routeKind === "resume_pending"\) \{/);
  assert.match(sessionPageSource, /setStatus\(t\("已恢复未完成执行，请先完成当前交互。"\)\);/);
  assert.match(sessionPageSource, /setStatus\(t\("正在恢复未完成执行\.\.\."\)\);/);
  assert.match(sessionPageSource, /if \(routeDecision\.routeKind === "workflow_partial"\) \{/);
  assert.match(sessionPageSource, /t\("【消息级执行路由】"\)/);
  assert.match(sessionPageSource, /t\("当前请求已路由为“工作流部分执行”。"\)/);
  assert.match(sessionPageSource, /t\("不要重新执行前置阶段。"\)/);
  assert.match(sessionPageSource, /workflowPromptPreamble,/);
  assert.match(sessionPageSource, /if \(routeDecision\.routeKind === "workflow_full"\) \{/);
  assert.match(sessionPageSource, /workflowStageIndex: 0,/);
  assert.match(sessionPageSource, /if \(routeDecision\.routeKind === "skill"\) \{/);
  assert.match(sessionPageSource, /disableWorkflow: true,/);
  assert.match(sessionPageSource, /const currentSelectedSkillIds = activeSelectedSkillIdsRef\.current;/);
  assert.match(sessionPageSource, /: currentSelectedSkillIds;/);
  assert.match(sessionPageSource, /const effectiveSelectedSessionSkills = currentAvailableSkills\.filter/);
  assert.match(sessionPageSource, /: currentSelectedWorkflow;/);
  assert.match(sessionPageSource, /buildAgentWorkflowSkillExecutionPlan\(activeWorkflow, currentAvailableSkills\)/);
  assert.match(sessionPageSource, /buildAgentWorkflowSkillExecutionPlan\(currentSelectedWorkflow, currentAvailableSkills\)\.totalReadyCount/);
  assert.match(sessionPageSource, /selectedSkillIdsOverride: routeDecision\.skillId \? \[routeDecision\.skillId\] : \[\],/);
  assert.match(sessionPageSource, /selectedSkillIdsOverride: \[\],/);
  assert.match(sessionPageSource, /const executionMode: AgentExecutionMode = options\?\.routeDecision\?\.routeKind === "chat"/);
  assert.match(sessionPageSource, /executionMode,/);

  // 描述：
  //
  //   - 分阶段执行的 UI 文案应明确显示“从第 N 阶段开始”，普通对话则不注入工作流执行包装。
  assert.match(sessionPageSource, /routeDecision\?\.routeKind === "workflow_partial"/);
  assert.match(sessionPageSource, /从第 \{\{current\}\}\/\{\{total\}\} 阶段开始：\{\{title\}\}/);
  assert.doesNotMatch(sessionPageSource, /routeDecision\.routeKind === "chat"[\s\S]*workflowStageIndex: 0,/);

  // 描述：
  //
  //   - 会话选择存储应使用新的单一执行选择键，并保留旧键迁移读取能力。
  assert.match(promptUtilsSource, /export const AGENT_EXECUTION_SELECTION_KEY = STORAGE_KEYS\.AGENT_EXECUTION_SELECTION;/);
  assert.match(promptUtilsSource, /type SessionExecutionSelection =/);
  assert.match(promptUtilsSource, /export function readSessionExecutionSelection\(/);
  assert.match(promptUtilsSource, /const preferredSkillSelection = buildSkillExecutionSelection/);
  assert.match(promptUtilsSource, /const legacySkillSelection = buildSkillExecutionSelection/);
  assert.match(promptUtilsSource, /export function writeSessionExecutionSelection\(/);
  assert.match(promptUtilsSource, /window\.localStorage\.removeItem\(legacyWorkflowKey\);/);
  assert.match(promptUtilsSource, /window\.localStorage\.removeItem\(legacySkillKey\);/);
});
