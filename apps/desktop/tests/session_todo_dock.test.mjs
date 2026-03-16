import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供会话 todo dock 能力回归断言复用。
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

test("TestSessionTodoDockShouldRenderTodoSnapshotAndKeepAnalysisInChat", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const styleSource = readDesktopSource("src/styles.css");
  const promptGuidanceSource = readDesktopSource("src/shared/workflow/prompt-guidance.ts");
  const workflowTemplateSource = readDesktopSource("src/shared/workflow/templates.ts");
  const openapiSkillSource = readDesktopSource("src-tauri/resources/skills/openapi-model-designer/SKILL.md");

  // 描述：
  //
  //   - 会话页应为 todo 工具提供独立运行片段分支，并把任务项透传到 segment data，供 dock 复用。
  assert.match(sessionSource, /function isTodoTool\(toolName: string\): boolean \{/);
  assert.match(sessionSource, /intro: translateDesktopText\("任务计划"\)/);
  assert.match(sessionSource, /step: toolName === "todo_write"\s*\?\s*translateDesktopText\("正在更新任务计划"\)/s);
  assert.match(sessionSource, /step: toolName === "todo_write"\s*\?\s*translateDesktopText\("已同步 \{\{count\}\} 项任务"/s);
  assert.match(sessionSource, /todo_items: normalizedTodoItems/);
  assert.match(sessionSource, /todoState\?: \{/);
  assert.match(sessionSource, /if \(stepType === "todo"\) \{/);
  assert.match(sessionSource, /key: `todo-\$\{segment\.key\}-\$\{index\}`/);
  assert.match(sessionSource, /todoStep\.text = todoState\.latestText;/);
  assert.doesNotMatch(sessionSource, /shouldHideTodoSegmentInRunLog/);
  assert.match(sessionSource, /resolveAssistantTodoDockSnapshot\(/);
  assert.match(sessionSource, /const activeTodoDockSnapshot = useMemo\(/);
  assert.match(sessionSource, /const shouldShowTodoDock = activeTodoDockItems\.length > 0;/);
  assert.match(sessionSource, /className="desk-action-slot desk-action-slot-info desk-action-slot-todo"/);
  assert.match(sessionSource, /resolveTodoDockStatusLabel\(item\.status\)/);
  assert.doesNotMatch(sessionSource, /value=\{t\("当前暂无任务项"\)\}/);

  // 描述：
  //
  //   - dock 样式应为 todo 卡片、任务项和状态标签提供独立类，避免复用授权卡片样式导致信息混淆。
  assert.match(styleSource, /\.desk-action-slot-todo/);
  assert.match(styleSource, /\.desk-todo-dock-list/);
  assert.match(styleSource, /\.desk-todo-dock-item/);
  assert.match(styleSource, /\.desk-todo-dock-status-completed/);
  assert.match(styleSource, /\.desk-todo-dock-status-blocked/);

  // 描述：
  //
  //   - 提示词与工作流内嵌“需求分析”阶段都应明确：需求分析默认直接输出到会话，不写入项目计划文档；
  //   - run_shell 的返回值应提醒模型按结构化字段读取，需求分析阶段也不应提前初始化项目。
  assert.match(promptGuidanceSource, /todo_read\/todo_write 仅用于会话内任务计划同步；agent 编排、任务规划、阶段说明、过程总结等会话过程信息默认直接输出到会话，不要写入项目过程文件。/);
  assert.match(promptGuidanceSource, /AI 过程信息（如 agent 编排、任务规划、阶段分析、方案草案、阻塞说明、阶段总结）默认只允许持久化到会话上下文并发送到前端消息；除非用户明确要求导出，否则禁止写入 `REQUIREMENTS\.md`、`TODO\.md`、`api_design\.json`、`mock-plan\.md` 等过程文件。/);
  assert.match(promptGuidanceSource, /项目文件只写用户真正需要的交付物/);
  assert.match(promptGuidanceSource, /run_shell 默认返回结果对象（含 stdout\/stderr\/status\/success）/);
  assert.match(promptGuidanceSource, /result\.get\(\\\"stdout\\\"\) \/ result\.get\(\\\"stderr\\\"\) \/ result\.get\(\\\"success\\\"\)/);
  assert.match(workflowTemplateSource, /默认直接在会话中交付分析结果；只有用户明确要求导出时，才创建文档或文件。/);
  assert.match(workflowTemplateSource, /当前阶段只做分析，不执行 apply_patch、安装依赖、初始化项目、生成代码或创建过程文件。/);
  assert.match(openapiSkillSource, /接口建模正文、Mock 说明、OpenAPI 写入结果和阻塞原因，默认直接输出到当前会话并保留在会话上下文中；除非用户明确要求导出文件，否则不要创建或修改 `api-models\.md`、`mock-plan\.md` 等过程文件。/);
  assert.match(openapiSkillSource, /默认优先写入 `<workspace>\/docs\/openapi\/` 目录；文件名应根据当前项目或模块语义命名/);
  assert.match(openapiSkillSource, /不要假设固定业务名称/);
});
