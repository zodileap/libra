import { translateDesktopText } from "../i18n";

// 描述：
//
//   - 定义统一智能体可见的内置工具清单，用于拼接到执行提示词，约束模型只调用本系统支持的工具。
export const AGENT_TOOLSET_LINES: string[] = [
  translateDesktopText("【可用工具集（仅可使用以下内置工具）】"),
  translateDesktopText("- 文件与目录：read_text、read_json、write_text、write_json、list_dir/list_directory、mkdir、stat、glob、search_files"),
  translateDesktopText("- 终端与 Git：run_shell/run_shell_command、git_status、git_diff、git_log"),
  translateDesktopText("- 变更与任务：apply_patch、todo_read、todo_write、request_user_input"),
  translateDesktopText("- 联网与外部：web_search、fetch_url、mcp_tool、dcc_tool、tool_search"),
  "",
  translateDesktopText("【工具调用签名与示例（必须严格按函数签名调用）】"),
  "- read_text(path)：content = read_text(\"README.md\")  # 默认直接返回文本内容，不要依赖 _ 接收上一条结果",
  "- read_json(path)：data = read_json(\"package.json\")  # 默认直接返回 JSON data，不要依赖 _ 接收上一条结果",
  "- write_text(path, content)：write_text(\"src/main.ts\", \"console.log('ok')\\n\")",
  "- write_json(path, data)：write_json(\"meta.json\", {\"name\":\"demo\"})",
  "- run_shell(command, timeout_secs=30)：run_shell(\"pnpm test\", 120)",
  translateDesktopText("- run_shell 默认返回结果对象（含 stdout/stderr/status/success）；优先读取 result.get(\"stdout\") / result.get(\"stderr\") / result.get(\"success\")，不要把结果当纯字符串。"),
  "- apply_patch(patch, check_only=False)：apply_patch(\"*** Begin Patch\\n*** Update File: a.txt\\n@@\\n-old\\n+new\\n*** End Patch\\n\", False)",
  translateDesktopText("- todo_read()：todo_read()  # 默认返回任务项列表（items）"),
  translateDesktopText("- todo_write(items)：todo_write([{\"id\":\"next\",\"content\":\"设计前端框架\",\"status\":\"pending\"}])"),
  translateDesktopText("- request_user_input(questions)：request_user_input(questions=[{\"id\":\"style\",\"header\":\"展示方式\",\"question\":\"示例提示卡片是否需要提供复制按钮？\",\"options\":[{\"label\":\"需要复制按钮 (Recommended)\",\"description\":\"保留完整交互能力。\"},{\"label\":\"只展示文本\",\"description\":\"界面更简洁，但少一步操作。\"}]}])"),
  translateDesktopText("- todo_read/todo_write 仅用于会话内任务计划同步；agent 编排、任务规划、阶段说明、过程总结等会话过程信息默认直接输出到会话，不要写入项目过程文件。"),
  translateDesktopText("- AI 过程信息（如 agent 编排、任务规划、阶段分析、方案草案、阻塞说明、阶段总结）默认只允许持久化到会话上下文并发送到前端消息；除非用户明确要求导出，否则禁止写入 `REQUIREMENTS.md`、`TODO.md`、`api_design.json`、`mock-plan.md` 等过程文件。"),
  translateDesktopText("- 项目文件只写用户真正需要的交付物，例如源码、配置、测试、资源或用户明确要求导出的文档；不要把 AI 过程记录当成交付物落盘。"),
  translateDesktopText("- 错误示例（禁止）：todo_write(\"NEXT_STEP\", \"设计前端框架\")"),
  translateDesktopText("- 仅在需要用户做高影响决策时才允许调用 request_user_input；一次只能提 1-3 个问题。"),
  translateDesktopText("- request_user_input 的每个问题只允许 2-3 个互斥选项，推荐项必须放在第一个并带 `(Recommended)`。"),
  translateDesktopText("- 不要自己构造第 4 个“其他”选项；前端会固定补充自由填写入口。"),
  translateDesktopText("- 如果用户忽略本次提问，必须把 ignored 结果当作真实执行结果处理，不可无限重复追问同一组问题。"),
  "- dcc_tool(capability, action, arguments={}, software=\"blender\")：dcc_tool(\"mesh.edit\", \"list_mesh_objects\", {\"scope\":\"selected\"}, \"blender\")",
  translateDesktopText("- 跨软件迁移先调用：dcc_tool(\"cross_dcc.transfer\", \"plan_transfer\", {\"preferred_format\":\"fbx\"}, source_software=\"blender\", target_software=\"maya\")"),
  translateDesktopText("- 参数不确定时先调用：tool_search(\"todo_write\", 1) / tool_search(\"write_text\", 1)"),
  translateDesktopText("- 结束输出：finish(message)"),
  translateDesktopText("执行约束：禁止 import 第三方工具模块（例如 gemini_cli_native_tools、codex_tools、openai_tools）；必须直接调用上述内置函数。"),
];

// 描述：
//
//   - 旧版工作流中使用下划线技能编码；这里集中维护迁移别名，统一映射到标准 Agent Skills 名称。
const LEGACY_OPENAPI_SKILL_ALIAS = ["api", "fox", "_model_designer"].join("");

export const LEGACY_AGENT_SKILL_ID_ALIASES: Record<string, string> = {
  requirements_analyst: "requirements-analyst",
  [LEGACY_OPENAPI_SKILL_ALIAS]: "openapi-model-designer",
  openapi_model_designer: "openapi-model-designer",
  frontend_architect: "frontend-architect",
  frontend_page_builder: "frontend-page-builder",
  db_designer: "db-designer",
  api_codegen: "api-codegen",
  test_runner: "test-runner",
  report_builder: "report-builder",
};

// 描述：
//
//   - 将旧技能编码归一为标准 Agent Skills 名称，避免历史工作流因命名迁移失效。
//
// Params:
//
//   - skillId: 原始技能编码。
//
// Returns:
//
//   - 归一化后的技能编码。
export function normalizeAgentSkillId(skillId: string): string {
  const normalizedSkillId = String(skillId || "").trim();
  if (!normalizedSkillId) {
    return "";
  }
  return LEGACY_AGENT_SKILL_ID_ALIASES[normalizedSkillId] || normalizedSkillId;
}
