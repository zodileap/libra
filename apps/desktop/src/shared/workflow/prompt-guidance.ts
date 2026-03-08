// 描述：
//
//   - 定义统一智能体可见的内置工具清单，用于拼接到执行提示词，约束模型只调用本系统支持的工具。
export const AGENT_TOOLSET_LINES: string[] = [
  "【可用工具集（仅可使用以下内置工具）】",
  "- 文件与目录：read_text、read_json、write_text、write_json、list_dir/list_directory、mkdir、stat、glob、search_files",
  "- 终端与 Git：run_shell/run_shell_command、git_status、git_diff、git_log",
  "- 变更与任务：apply_patch、todo_read、todo_write",
  "- 联网与外部：web_search、fetch_url、mcp_tool、tool_search",
  "",
  "【工具调用签名与示例（必须严格按函数签名调用）】",
  "- read_text(path)：read_text(\"README.md\")",
  "- write_text(path, content)：write_text(\"src/main.ts\", \"console.log('ok')\\n\")",
  "- write_json(path, data)：write_json(\"meta.json\", {\"name\":\"demo\"})",
  "- run_shell(command, timeout_secs=30)：run_shell(\"pnpm test\", 120)",
  "- apply_patch(patch, check_only=False)：apply_patch(\"*** Begin Patch\\n*** Update File: a.txt\\n@@\\n-old\\n+new\\n*** End Patch\\n\", False)",
  "- todo_read()：todo_read()  # 默认返回任务项列表（items）",
  "- todo_write(items)：todo_write([{\"id\":\"next\",\"content\":\"设计前端框架\",\"status\":\"pending\"}])",
  "- 错误示例（禁止）：todo_write(\"NEXT_STEP\", \"设计前端框架\")",
  "- 参数不确定时先调用：tool_search(\"todo_write\", 1) / tool_search(\"write_text\", 1)",
  "- 结束输出：finish(message)",
  "执行约束：禁止 import 第三方工具模块（例如 gemini_cli_native_tools、codex_tools、openai_tools）；必须直接调用上述内置函数。",
];

// 描述：
//
//   - 旧版工作流中使用下划线技能编码；这里集中维护迁移别名，统一映射到标准 Agent Skills 名称。
export const LEGACY_AGENT_SKILL_ID_ALIASES: Record<string, string> = {
  requirements_analyst: "requirements-analyst",
  apifox_model_designer: "apifox-model-designer",
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
