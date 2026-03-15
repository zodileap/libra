use crate::tools::browser::detect_native_browser_tool_capabilities;
use crate::AgentRegisteredMcp;
use serde::{Deserialize, Serialize};

/// 描述：统一智能体在当前运行环境下可用的 Playwright 交互模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentInteractiveMode {
    Native,
    Mcp,
    None,
}

impl AgentInteractiveMode {
    /// 描述：将交互模式转换为稳定字符串，便于提示词与日志复用。
    ///
    /// Returns:
    ///
    ///   - 0: `native` / `mcp` / `none`。
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Mcp => "mcp",
            Self::None => "none",
        }
    }
}

/// 描述：统一智能体可见的运行时能力快照，前端、Tauri 与 core 共用同一份语义。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeCapabilities {
    pub native_js_repl: bool,
    pub native_browser_tools: bool,
    pub playwright_mcp_server_id: String,
    pub playwright_mcp_ready: bool,
    pub playwright_mcp_name: String,
    pub interactive_mode: AgentInteractiveMode,
    pub skip_reason: String,
}

impl Default for AgentRuntimeCapabilities {
    fn default() -> Self {
        Self {
            native_js_repl: false,
            native_browser_tools: false,
            playwright_mcp_server_id: String::new(),
            playwright_mcp_ready: false,
            playwright_mcp_name: String::new(),
            interactive_mode: AgentInteractiveMode::None,
            skip_reason: "当前环境无原生交互工具且无已启用 Playwright MCP，测试阶段已跳过。"
                .to_string(),
        }
    }
}

/// 描述：基于原生浏览器能力与 MCP 注册项解析最终运行时能力快照。
///
/// Params:
///
///   - native_js_repl: 原生 js_repl 是否可用。
///   - native_browser_tools: 原生 browser_* 工具是否可用。
///   - available_mcps: 当前已启用的 MCP 注册项快照。
///
/// Returns:
///
///   - 0: 统一智能体可见的运行时能力快照。
pub fn resolve_agent_runtime_capabilities(
    native_js_repl: bool,
    native_browser_tools: bool,
    available_mcps: &[AgentRegisteredMcp],
) -> AgentRuntimeCapabilities {
    if native_js_repl && native_browser_tools {
        return AgentRuntimeCapabilities {
            native_js_repl,
            native_browser_tools,
            playwright_mcp_server_id: String::new(),
            playwright_mcp_ready: false,
            playwright_mcp_name: String::new(),
            interactive_mode: AgentInteractiveMode::Native,
            skip_reason: String::new(),
        };
    }

    if let Some(playwright_mcp) = available_mcps
        .iter()
        .find(|item| is_ready_playwright_mcp_registration(item))
    {
        return AgentRuntimeCapabilities {
            native_js_repl,
            native_browser_tools,
            playwright_mcp_server_id: playwright_mcp.id.clone(),
            playwright_mcp_ready: true,
            playwright_mcp_name: playwright_mcp.name.clone(),
            interactive_mode: AgentInteractiveMode::Mcp,
            skip_reason: String::new(),
        };
    }

    AgentRuntimeCapabilities {
        native_js_repl,
        native_browser_tools,
        playwright_mcp_server_id: String::new(),
        playwright_mcp_ready: false,
        playwright_mcp_name: String::new(),
        interactive_mode: AgentInteractiveMode::None,
        skip_reason: build_native_skip_reason(native_js_repl, native_browser_tools),
    }
}

/// 描述：探测当前环境真实可用的浏览器交互能力，再结合 MCP 注册项生成统一快照。
///
/// Params:
///
///   - available_mcps: 当前已启用的 MCP 注册项快照。
///
/// Returns:
///
///   - 0: 统一智能体可见的运行时能力快照。
pub fn detect_agent_runtime_capabilities(
    available_mcps: &[AgentRegisteredMcp],
) -> AgentRuntimeCapabilities {
    let native = detect_native_browser_tool_capabilities();
    resolve_agent_runtime_capabilities(
        native.native_js_repl,
        native.native_browser_tools,
        available_mcps,
    )
}

/// 描述：判断注册项是否命中 Playwright MCP fallback 识别规则。
///
/// Params:
///
///   - registration: MCP 注册项快照。
///
/// Returns:
///
///   - true: 命中 Playwright MCP 规则。
pub fn is_playwright_mcp_registration(registration: &AgentRegisteredMcp) -> bool {
    if registration
        .template_id
        .trim()
        .eq_ignore_ascii_case("playwright-mcp")
    {
        return true;
    }

    let template_like_id = registration
        .id
        .trim()
        .eq_ignore_ascii_case("playwright-mcp");
    if template_like_id {
        return true;
    }

    if registration
        .software
        .trim()
        .eq_ignore_ascii_case("playwright")
    {
        return true;
    }

    let command_line = if registration.args.is_empty() {
        registration.command.clone()
    } else {
        format!("{} {}", registration.command, registration.args.join(" "))
    };
    if command_line.to_lowercase().contains("@playwright/mcp") {
        return true;
    }

    registration.capabilities.iter().any(|capability| {
        matches!(
            capability.trim(),
            "browser.navigate" | "browser.click" | "browser.snapshot"
        )
    })
}

/// 描述：判断注册项是否满足 Playwright MCP fallback 的就绪条件。
///
/// Params:
///
///   - registration: MCP 注册项快照。
///
/// Returns:
///
///   - true: 既命中 Playwright 规则又满足 transport 完整且 runtime_ready。
pub fn is_ready_playwright_mcp_registration(registration: &AgentRegisteredMcp) -> bool {
    if !is_playwright_mcp_registration(registration) || !registration.runtime_ready {
        return false;
    }
    match registration.transport.trim() {
        "stdio" => !registration.command.trim().is_empty(),
        "http" => !registration.url.trim().is_empty(),
        _ => false,
    }
}

/// 描述：在原生交互能力不可用时生成统一跳过原因，确保前端与总结口径一致。
fn build_native_skip_reason(native_js_repl: bool, native_browser_tools: bool) -> String {
    if !native_js_repl && !native_browser_tools {
        return "当前环境无原生交互工具且无已启用 Playwright MCP，测试阶段已跳过。".to_string();
    }
    if !native_js_repl {
        return "当前环境缺少原生 js_repl 且无已启用 Playwright MCP，测试阶段已跳过。".to_string();
    }
    if !native_browser_tools {
        return "当前环境缺少原生 browser_* 工具且无已启用 Playwright MCP，测试阶段已跳过。"
            .to_string();
    }
    "当前环境无可用 Playwright 交互能力，测试阶段已跳过。".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn build_mcp(
        id: &str,
        software: &str,
        command: &str,
        args: &[&str],
        capabilities: &[&str],
        runtime_ready: bool,
    ) -> AgentRegisteredMcp {
        AgentRegisteredMcp {
            id: id.to_string(),
            template_id: String::new(),
            name: "Playwright MCP".to_string(),
            domain: "general".to_string(),
            software: software.to_string(),
            capabilities: capabilities
                .iter()
                .map(|item| (*item).to_string())
                .collect(),
            priority: 0,
            supports_import: false,
            supports_export: false,
            transport: "stdio".to_string(),
            command: command.to_string(),
            args: args.iter().map(|item| (*item).to_string()).collect(),
            env: HashMap::new(),
            cwd: String::new(),
            url: String::new(),
            headers: HashMap::new(),
            runtime_kind: String::new(),
            official_provider: String::new(),
            runtime_ready,
            runtime_hint: None,
        }
    }

    /// 描述：验证原生 js_repl 与 browser_* 同时可用时，优先进入 native 模式。
    #[test]
    fn should_prefer_native_interactive_mode_when_native_tools_are_ready() {
        let capabilities = resolve_agent_runtime_capabilities(true, true, &[]);
        assert_eq!(capabilities.interactive_mode, AgentInteractiveMode::Native);
        assert!(capabilities.skip_reason.is_empty());
    }

    /// 描述：验证空注册表且无原生工具时，会返回 none 模式并附带稳定跳过原因。
    #[test]
    fn should_return_none_mode_when_no_native_tool_or_playwright_mcp_exists() {
        let capabilities = resolve_agent_runtime_capabilities(false, false, &[]);
        assert_eq!(capabilities.interactive_mode, AgentInteractiveMode::None);
        assert!(capabilities.skip_reason.contains("测试阶段已跳过"));
    }

    /// 描述：验证已启用且运行态就绪的 Playwright MCP 会触发 mcp 模式。
    #[test]
    fn should_return_mcp_mode_when_ready_playwright_registration_exists() {
        let registration = build_mcp(
            "playwright-mcp",
            "playwright",
            "npx",
            &["-y", "@playwright/mcp@latest"],
            &["browser.navigate"],
            true,
        );
        let capabilities = resolve_agent_runtime_capabilities(false, false, &[registration]);
        assert_eq!(capabilities.interactive_mode, AgentInteractiveMode::Mcp);
        assert_eq!(capabilities.playwright_mcp_server_id, "playwright-mcp");
        assert!(capabilities.playwright_mcp_ready);
    }

    /// 描述：验证未就绪或缺少 transport 关键字段的注册项不会误判为可用 Playwright MCP。
    #[test]
    fn should_ignore_non_ready_playwright_registration() {
        let mut registration = build_mcp("browser-kit", "", "", &[], &["browser.click"], false);
        registration.transport = "stdio".to_string();
        let capabilities = resolve_agent_runtime_capabilities(false, false, &[registration]);
        assert_eq!(capabilities.interactive_mode, AgentInteractiveMode::None);
    }

    /// 描述：验证 template_id 命中 playwright-mcp 时，即使 id 自定义，也会识别为 Playwright MCP。
    #[test]
    fn should_match_playwright_registration_by_template_id() {
        let mut registration = build_mcp(
            "custom-browser-server",
            "",
            "node",
            &["server.js"],
            &[],
            true,
        );
        registration.template_id = "playwright-mcp".to_string();
        assert!(is_playwright_mcp_registration(&registration));
    }
}
