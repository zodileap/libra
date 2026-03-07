// 描述：
//
//   - 定义代码智能体可见的内置工具清单，用于拼接到执行提示词，约束模型只调用本系统支持的工具。
export const CODE_AGENT_TOOLSET_LINES: string[] = [
  "【可用工具集（仅可使用以下内置工具）】",
  "- 文件与目录：read_text、read_json、write_text、write_json、list_dir/list_directory、mkdir、stat、glob、search_files",
  "- 终端与 Git：run_shell/run_shell_command、git_status、git_diff、git_log",
  "- 变更与任务：apply_patch、todo_read、todo_write",
  "- 联网与外部：web_search、fetch_url、mcp_model_tool、tool_search",
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
//   - 定义技能在提示词中的可执行语义说明，避免仅提供 skillId/version 导致模型难以理解。
export interface CodeSkillPromptGuide {
  name: string;
  objective: string;
  deliverable: string;
}

// 描述：
//
//   - 代码工作流常用技能的提示词引导信息映射。
export const CODE_SKILL_PROMPT_GUIDE: Record<string, CodeSkillPromptGuide> = {
  requirements_analyst: {
    name: "需求分析",
    objective: "拆解业务目标、边界条件与验收标准",
    deliverable: "需求拆解清单、边界条件、可验证验收项",
  },
  apifox_model_designer: {
    name: "交互契约设计",
    objective: "定义 API 实体、请求模型、响应模型并同步 Apifox",
    deliverable: "实体/请求/响应模型与 Apifox 同步结果",
  },
  frontend_architect: {
    name: "前端架构设计",
    objective: "确定目录结构、模块边界、实现约束",
    deliverable: "前端目录方案、模块边界说明、实现约束",
  },
  frontend_page_builder: {
    name: "页面实现",
    objective: "明确页面元素结构并实现页面交互",
    deliverable: "页面布局结构、交互实现与可运行代码",
  },
  db_designer: {
    name: "数据库设计",
    objective: "输出实体、字段、索引与迁移策略",
    deliverable: "数据库设计文档与迁移方案",
  },
  api_codegen: {
    name: "接口代码生成",
    objective: "生成 API 代码与测试骨架",
    deliverable: "接口代码、调用层与基础测试样例",
  },
  test_runner: {
    name: "测试执行",
    objective: "执行测试并定位失败原因",
    deliverable: "测试结果、失败定位与修复建议",
  },
  report_builder: {
    name: "报告生成",
    objective: "汇总过程与结果形成可交付报告",
    deliverable: "结构化交付报告与风险清单",
  },
};

// 描述：
//
//   - 根据 skillId 解析技能提示引导信息；未命中时返回 null。
//
// Params:
//
//   - skillId: 技能编码。
//
// Returns:
//
//   - 技能引导信息。
export function resolveCodeSkillPromptGuide(skillId: string): CodeSkillPromptGuide | null {
  const normalizedSkillId = String(skillId || "").trim();
  if (!normalizedSkillId) {
    return null;
  }
  return CODE_SKILL_PROMPT_GUIDE[normalizedSkillId] || null;
}
