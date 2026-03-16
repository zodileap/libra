import { translateDesktopText } from "../i18n";

// 描述：
//
//   - 定义统一智能体运行时可见的 Playwright 交互模式，前端 prompt 与 core agent 共享同一语义。
export type AgentInteractiveMode = "native" | "mcp" | "none";

// 描述：
//
//   - 定义前端可消费的智能体运行时能力快照，统一承载原生交互工具与 Playwright MCP fallback 判定结果。
export interface AgentRuntimeCapabilities {
  nativeJsRepl: boolean;
  nativeBrowserTools: boolean;
  playwrightMcpServerId: string;
  playwrightMcpReady: boolean;
  playwrightMcpName: string;
  interactiveMode: AgentInteractiveMode;
  skipReason: string;
}

// 描述：
//
//   - 提供稳定的运行时能力默认值；当后端尚未返回真实快照时，前端统一按 none 模式兜底。
export const DEFAULT_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  nativeJsRepl: false,
  nativeBrowserTools: false,
  playwrightMcpServerId: "",
  playwrightMcpReady: false,
  playwrightMcpName: "",
  interactiveMode: "none",
  skipReason: translateDesktopText("当前环境无原生交互工具且无已启用 Playwright MCP，测试阶段已跳过。"),
};

// 描述：
//
//   - 将未知值规整为合法交互模式，避免 Tauri 返回异常值时 prompt 分支失控。
//
// Params:
//
//   - value: 原始交互模式值。
//
// Returns:
//
//   - 合法交互模式。
function normalizeInteractiveMode(value: unknown): AgentInteractiveMode {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === "native" || normalizedValue === "mcp" || normalizedValue === "none") {
    return normalizedValue;
  }
  return "none";
}

// 描述：
//
//   - 将未知运行时能力快照转换为前端稳定结构，供 prompt 构建、执行请求与页面展示复用。
//
// Params:
//
//   - value: 原始运行时能力快照。
//
// Returns:
//
//   - 归一化后的运行时能力快照。
export function normalizeAgentRuntimeCapabilities(value: unknown): AgentRuntimeCapabilities {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_AGENT_RUNTIME_CAPABILITIES };
  }
  const source = value as Partial<AgentRuntimeCapabilities>;
  const interactiveMode = normalizeInteractiveMode(source.interactiveMode);
  const skipReason = String(source.skipReason || "").trim();
  return {
    nativeJsRepl: Boolean(source.nativeJsRepl),
    nativeBrowserTools: Boolean(source.nativeBrowserTools),
    playwrightMcpServerId: String(source.playwrightMcpServerId || "").trim(),
    playwrightMcpReady: Boolean(source.playwrightMcpReady),
    playwrightMcpName: String(source.playwrightMcpName || "").trim(),
    interactiveMode,
    skipReason: skipReason || (
      interactiveMode === "none"
        ? DEFAULT_AGENT_RUNTIME_CAPABILITIES.skipReason
        : ""
    ),
  };
}

// 描述：
//
//   - 判断给定技能编码是否属于 `playwright-interactive`，兼容历史别名与空白字符。
//
// Params:
//
//   - skillId: 原始技能编码。
//
// Returns:
//
//   - true: 命中 `playwright-interactive`。
export function isPlaywrightInteractiveSkillId(skillId: string): boolean {
  return normalizeAgentSkillId(skillId) === "playwright-interactive";
}

// 描述：
//
//   - 按运行时能力快照构建统一智能体可见的工具清单，确保 Playwright 原生浏览器工具只在 native 模式暴露。
//
// Params:
//
//   - runtimeCapabilities: 运行时能力快照。
//
// Returns:
//
//   - Prompt 中的工具清单行数组。
export function buildAgentToolsetLines(runtimeCapabilities?: unknown): string[] {
  const normalizedRuntimeCapabilities = normalizeAgentRuntimeCapabilities(runtimeCapabilities);
  const lines: string[] = [
    translateDesktopText("【可用工具集（仅可使用以下内置工具）】"),
    translateDesktopText("- 文件与目录：read_text、read_json、write_text、write_json、list_dir/list_directory、mkdir、stat、glob、search_files"),
    translateDesktopText("- 终端与 Git：run_shell/run_shell_command、git_status、git_diff、git_log"),
    translateDesktopText("- 变更与任务：apply_patch、todo_read、todo_write、request_user_input"),
    translateDesktopText("- 联网与外部：web_search、fetch_url、mcp_tool、dcc_tool、tool_search"),
  ];
  if (normalizedRuntimeCapabilities.interactiveMode === "native") {
    lines.push(
      translateDesktopText("- 真实浏览器交互：js_repl、js_repl_reset、browser_navigate、browser_snapshot、browser_click、browser_type、browser_wait_for、browser_take_screenshot、browser_tabs、browser_close"),
    );
  }
  lines.push(
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
  );
  if (normalizedRuntimeCapabilities.interactiveMode === "native") {
    lines.push(
      "- js_repl(source)：js_repl(\"const title = await page.title(); return title;\")",
      "- browser_navigate(url=\"http://127.0.0.1:3000\") / browser_click(selector=\"button[data-testid='submit']\")",
      "- browser_type(selector=\"input[name='email']\", text=\"demo@example.com\") / browser_wait_for(text=\"保存成功\")",
      "- browser_snapshot() / browser_take_screenshot(path=\"artifacts/ui.png\") / browser_tabs(action=\"list\") / browser_close() / js_repl_reset(close_browser=True)",
    );
  }
  lines.push(
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
    translateDesktopText("执行约束：禁止 import 第三方工具模块（例如 tools、gemini_cli_native_tools、codex_tools、openai_tools）；必须直接调用上述内置函数。"),
  );
  return lines;
}

// 描述：
//
//   - 兼容现有静态导入场景的默认工具清单；当外层未显式传入能力快照时，默认按 none 模式输出。
export const AGENT_TOOLSET_LINES: string[] = buildAgentToolsetLines();

// 描述：
//
//   - 为 `playwright-interactive` 构建运行时执行契约，明确 native / mcp / none 三种模式的禁止与必需动作。
//
// Params:
//
//   - runtimeCapabilities: 运行时能力快照。
//
// Returns:
//
//   - 可直接拼接到 Prompt 的执行契约文本；无内容时返回空字符串。
export function buildPlaywrightInteractiveRuntimePrompt(runtimeCapabilities?: unknown): string {
  const normalizedRuntimeCapabilities = normalizeAgentRuntimeCapabilities(runtimeCapabilities);
  if (normalizedRuntimeCapabilities.interactiveMode === "native") {
    return [
      translateDesktopText("【Playwright Interactive 运行模式】"),
      translateDesktopText("当前环境已注入 js_repl 与 browser_* 原生工具，必须通过真实 Chromium 窗口完成交互验证。"),
      translateDesktopText("禁止回退到 `playwright.config.ts`、`e2e/*.spec.ts` 或 `npx playwright test`。"),
    ].join("\n");
  }
  if (normalizedRuntimeCapabilities.interactiveMode === "mcp") {
    return [
      translateDesktopText("【Playwright Interactive 运行模式】"),
      translateDesktopText("当前环境未注入原生 browser_* 工具，但已检测到可用 Playwright MCP。"),
      translateDesktopText("必须先执行 `mcp_tool(server=\"{{serverId}}\", tool=\"list_tools\")` 探测能力，再通过该 MCP 完成真实浏览器交互。", {
        serverId: normalizedRuntimeCapabilities.playwrightMcpServerId || "playwright-mcp",
      }),
      translateDesktopText("禁止回退到 `playwright.config.ts`、`e2e/*.spec.ts` 或 `npx playwright test`。"),
    ].join("\n");
  }
  return [
    translateDesktopText("【Playwright Interactive 运行模式】"),
    normalizedRuntimeCapabilities.skipReason || DEFAULT_AGENT_RUNTIME_CAPABILITIES.skipReason,
    translateDesktopText("当前阶段必须显式标记为“已跳过”，禁止生成 `playwright.config.ts`、`e2e/*.spec.ts`，也禁止执行 `npx playwright test`。"),
  ].join("\n");
}

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
  const normalizedWorkflowId = String(skillId || "").trim();
  if (!normalizedWorkflowId) {
    return "";
  }
  return LEGACY_AGENT_SKILL_ID_ALIASES[normalizedWorkflowId] || normalizedWorkflowId;
}
