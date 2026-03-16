import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，校验 SkillNode 在工作流模型与编辑器中的接入状态。
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

test("TestWorkflowStageNodeShouldBeSupportedInTypesStorageAndEditor", () => {
  const typesSource = readDesktopSource("src/shared/workflow/types.ts");
  const storageSource = readDesktopSource("src/shared/workflow/storage.ts");
  const editorSource = readDesktopSource("src/widgets/workflow/page.tsx");

  // 描述：
  //
  //   - 工作流图节点类型应包含 action / skill，且节点结构仍需兼容 skillId/skillVersion 历史字段并持久化内嵌内容。
  assert.match(typesSource, /\| "action"/);
  assert.match(typesSource, /\| "skill"/);
  assert.match(typesSource, /content\?: string;/);
  assert.match(typesSource, /skillId\?: string;/);
  assert.match(typesSource, /skillVersion\?: string;/);
  assert.doesNotMatch(typesSource, /requiredCapabilities\?:/);
  assert.doesNotMatch(typesSource, /optionalCapabilities\?:/);

  // 描述：
  //
  //   - 存储层应能识别并持久化 action / skill 阶段节点，并在统一工作流提示词中附加执行链路信息。
  assert.match(storageSource, /raw === "action"/);
  assert.match(storageSource, /raw === "skill"/);
  assert.match(storageSource, /const normalizedContent = String\(node\.content \|\| ""\)\.trim\(\);/);
  assert.match(storageSource, /content: normalizedContent \|\| undefined,/);
  assert.match(storageSource, /translateDesktopText\("【执行链路】"\)/);
  assert.match(storageSource, /normalizeAgentSkillId/);

  // 描述：
  //
  //   - 工作流画布工具栏只保留普通节点新增入口；阶段节点需通过节点类型切换创建，并继续通过 Agent Skills 下拉维护技能编码。
  assert.match(editorSource, /nodeType: WorkflowGraphNodeType;/);
  assert.match(editorSource, /content: String\(source\.content \|\| ""\)\.trim\(\),/);
  assert.match(editorSource, /skillId: string;/);
  assert.match(editorSource, /skillVersion: string;/);
  assert.doesNotMatch(editorSource, /const addSkillNode = \(\) => \{/);
  assert.doesNotMatch(editorSource, /<AriButton[\s\S]*icon="new_releases"[\s\S]*onClick=\{addSkillNode\}[\s\S]*disabled=\{!canEditWorkflow\}[\s\S]*\/>/);
  assert.match(editorSource, /<AriButton ghost icon="add" onClick=\{addNode\} disabled=\{!canEditWorkflow\} \/>/);
  assert.match(editorSource, /listAgentSkills/);
  assert.match(editorSource, /label=\{t\("节点类型"\)\}/);
  assert.match(editorSource, /label=\{t\("动作"\)\}/);
  assert.match(editorSource, /label=\{t\("技能"\)\}/);
  assert.match(editorSource, /nodeType: "action"/);
  assert.match(editorSource, /nodeType: "skill"/);
  assert.match(editorSource, /label=\{t\("技能编码"\)\}/);
  assert.match(editorSource, /label=\{t\("节点内容"\)\}/);
  assert.match(editorSource, /<AriSelect/);
  assert.match(editorSource, /buildSkillSelectOptions/);
  assert.doesNotMatch(editorSource, /listProjectWorkspaceCapabilityManifests/);
  assert.doesNotMatch(editorSource, /value=\{t\("项目能力"\)\}/);
  assert.doesNotMatch(editorSource, /className="desk-workflow-edit-capability-list"/);
  assert.doesNotMatch(editorSource, /toggleWorkflowEditCapability/);
  assert.doesNotMatch(editorSource, /label="技能版本"/);
  assert.doesNotMatch(editorSource, /buildSkillVersionOptions/);
});

test("TestFrontendWorkflowShouldUseAgentSkillNames", () => {
  const templateSource = readDesktopSource("src/shared/workflow/templates.ts");
  const storageSource = readDesktopSource("src/shared/workflow/storage.ts");

  // 描述：
  //
  //   - 默认工作流应只保留“前端项目开发”，其中需求分析 / 前端架构 / 页面实现改为内嵌 action 阶段，测试交付复用 Playwright Interactive。
  assert.match(templateSource, /name: translateDesktopText\("前端项目开发"\)/);
  assert.match(templateSource, /id: "wf-agent-full-delivery-v1"/);
  assert.match(templateSource, /version: 2,/);
  assert.match(templateSource, /title: translateDesktopText\("需求分析"\)/);
  assert.match(templateSource, /title: translateDesktopText\("接口建模"\)/);
  assert.match(templateSource, /title: translateDesktopText\("前端架构"\)/);
  assert.match(templateSource, /title: translateDesktopText\("页面实现"\)/);
  assert.match(templateSource, /title: translateDesktopText\("测试交付"\)/);
  assert.match(templateSource, /content: buildFrontendRequirementsStageContent\(\),/);
  assert.match(templateSource, /content: buildFrontendArchitectureStageContent\(\),/);
  assert.match(templateSource, /content: buildFrontendPageImplementationStageContent\(\),/);
  assert.match(templateSource, /type: "action"/);
  assert.match(templateSource, /OpenAPI 文件/);
  assert.match(templateSource, /不要假设固定业务名称/);
  assert.match(templateSource, /skillId: "openapi-model-designer"/);
  assert.match(templateSource, /skillId: "playwright-interactive"/);
  assert.match(templateSource, /skillVersion: "1\.0\.0"/);
  assert.match(templateSource, /按工作流内嵌规范设计前端结构、实现页面，并在测试交付阶段使用技能完成验证/);
  assert.doesNotMatch(templateSource, /skillId: "requirements-analyst"/);
  assert.doesNotMatch(templateSource, /skillId: "frontend-architect"/);
  assert.doesNotMatch(templateSource, /skillId: "frontend-page-builder"/);
  assert.doesNotMatch(templateSource, /name: "完整项目开发（结构化信息）"/);
  assert.doesNotMatch(templateSource, /name: "前端项目-1（Skill 编排）"/);
  assert.doesNotMatch(templateSource, /name: "前端项目-2"/);
  assert.doesNotMatch(templateSource, /name: "后端项目"/);

  // 描述：
  //
  //   - 已从内置模板添加到注册列表的工作流，不应继续停留在“未注册”模板区。
  assert.match(storageSource, /const registeredTemplateIdSet = new Set/);
  assert.match(storageSource, /\.filter\(\(item\) => !registeredTemplateIdSet\.has\(item\.id\)\)/);
});
