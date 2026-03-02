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

test("TestWorkflowSkillExecutionPlanShouldValidateInstallStateAndBuildPrompt", () => {
  const skillPlanSource = readDesktopSource("src/shared/workflow/skill-plan.ts");
  const workflowIndexSource = readDesktopSource("src/shared/workflow/index.ts");
  const sessionPageSource = readDesktopSource("src/widgets/session/page.tsx");

  // 描述：
  //
  //   - Skill 计划构建器应读取安装态、识别阻塞项，并生成 Skill 执行计划提示词。
  assert.match(skillPlanSource, /const SKILL_INSTALL_STATE_STORAGE_KEY = "zodileap\.desktop\.skills\.installed";/);
  assert.match(skillPlanSource, /status: "missing_skill_id"/);
  assert.match(skillPlanSource, /status: "not_installed"/);
  assert.match(skillPlanSource, /blockingIssues/);
  assert.match(skillPlanSource, /"【Skill 执行计划】"/);
  assert.match(skillPlanSource, /buildCodeWorkflowSkillExecutionPlan/);

  // 描述：
  //
  //   - workflow 模块索引应导出 skill-plan，供会话执行链路复用。
  assert.match(workflowIndexSource, /export \* from "\.\/skill-plan";/);

  // 描述：
  //
  //   - 代码智能体发送前应执行 Skill 计划校验，失败时阻断；成功时将计划拼接到 prompt。
  assert.match(sessionPageSource, /buildCodeWorkflowSkillExecutionPlan\(selectedCodeWorkflow\)/);
  assert.match(sessionPageSource, /if \(skillExecutionPlan\.blockingIssues\.length > 0\)/);
  assert.match(sessionPageSource, /throw new Error\(`技能执行前检查未通过：\$\{skillExecutionPlan\.blockingIssues\.join\("；"\)\}`\)/);
  assert.match(sessionPageSource, /buildCodeSessionContextPrompt\(messages, normalizedContent\)/);
  assert.match(sessionPageSource, /const codeRequestPrompt = buildCodeSessionContextPrompt\(messages, normalizedContent\);/);
  assert.match(sessionPageSource, /const codePrompt = skillExecutionPlan\.planPrompt/);
  assert.match(sessionPageSource, /source: "workflow:skill_plan"/);
  assert.match(sessionPageSource, /prompt: codePrompt/);
});
