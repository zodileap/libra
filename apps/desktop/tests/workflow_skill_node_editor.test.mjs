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

test("TestWorkflowSkillNodeShouldBeSupportedInTypesStorageAndEditor", () => {
  const typesSource = readDesktopSource("src/shared/workflow/types.ts");
  const storageSource = readDesktopSource("src/shared/workflow/storage.ts");
  const editorSource = readDesktopSource("src/widgets/workflow/page.tsx");

  // 描述：
  //
  //   - 工作流图节点类型应包含 skill，且节点结构应支持 skillId/skillVersion。
  assert.match(typesSource, /\| "skill"/);
  assert.match(typesSource, /skillId\?: string;/);
  assert.match(typesSource, /skillVersion\?: string;/);

  // 描述：
  //
  //   - 存储层应能识别并持久化 skill 节点类型，并在代码工作流提示词中附加技能链路信息。
  assert.match(storageSource, /raw === "skill"/);
  assert.match(storageSource, /node\.type === "skill"/);
  assert.match(storageSource, /"【技能链路】"/);

  // 描述：
  //
  //   - 工作流画布应提供 SkillNode 创建入口，并通过“已安装技能”下拉维护技能编码与版本。
  assert.match(editorSource, /nodeType: WorkflowGraphNodeType;/);
  assert.match(editorSource, /skillId: string;/);
  assert.match(editorSource, /skillVersion: string;/);
  assert.match(editorSource, /const addSkillNode = \(\) => \{/);
  assert.match(editorSource, /<AriButton ghost icon="new_releases" onClick=\{addSkillNode\} \/>/);
  assert.match(editorSource, /listInstalledSkills/);
  assert.match(editorSource, /label="节点类型"/);
  assert.match(editorSource, /label="技能编码"/);
  assert.match(editorSource, /label="技能版本"/);
  assert.match(editorSource, /<AriSelect/);
  assert.match(editorSource, /buildSkillSelectOptions/);
  assert.match(editorSource, /buildSkillVersionOptions/);
});

test("TestCodeFrontendWorkflowShouldUseSkillDrivenGraph", () => {
  const templateSource = readDesktopSource("src/shared/workflow/templates.ts");

  // 描述：
  //
  //   - “前端项目-1”默认工作流应升级为 Skill 编排链路，包含需求分析/数据库设计/接口代码/报告等技能节点。
  assert.match(templateSource, /name: "前端项目-1（Skill 编排）"/);
  assert.match(templateSource, /title: "需求分析 Skill"/);
  assert.match(templateSource, /title: "数据库设计 Skill"/);
  assert.match(templateSource, /title: "接口代码 Skill"/);
  assert.match(templateSource, /title: "报告 Skill"/);
  assert.match(templateSource, /skillId: "requirements_analyst"/);
  assert.match(templateSource, /skillId: "db_designer"/);
  assert.match(templateSource, /skillId: "api_codegen"/);
  assert.match(templateSource, /skillId: "report_builder"/);
  assert.match(templateSource, /id: "wf-code-full-delivery-v1"/);
  assert.match(templateSource, /name: "完整项目开发（结构化信息）"/);
  assert.match(templateSource, /title: "理解项目需求"/);
  assert.match(templateSource, /title: "构建 API 数据模型"/);
  assert.match(templateSource, /title: "构建 API 与 Mock"/);
  assert.match(templateSource, /title: "设计前端框架"/);
  assert.match(templateSource, /title: "实现页面布局"/);
  assert.match(templateSource, /title: "项目测试"/);
  assert.match(templateSource, /skillId: "apifox_model_designer"/);
  assert.match(templateSource, /skillId: "frontend_architect"/);
  assert.match(templateSource, /skillId: "frontend_page_builder"/);
});
