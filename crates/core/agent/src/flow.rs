/// 描述：构建统一智能体系统提示词，约束模型输出风格与目标。
pub fn build_system_prompt() -> &'static str {
    "你是统一智能体。目标：输出可执行、可维护的实现方案与代码建议。\
    约束：优先模块化、明确文件结构、优先复用工作流、技能与 MCP。"
}

/// 描述：组合最终提示词，在有工具上下文时注入执行结果以支持连续决策。
pub fn compose_prompt(user_prompt: &str, tool_context: Option<&str>) -> String {
    let system = build_system_prompt();
    match tool_context {
        Some(context) if !context.trim().is_empty() => format!(
            "{system}\n\n工具执行结果：\n{context}\n\n用户输入：\n{user_prompt}\n\n请基于以上信息给出下一步。"
        ),
        _ => format!("{system}\n\n用户输入：\n{user_prompt}"),
    }
}

#[cfg(test)]
#[path = "flow_tests.rs"]
mod tests;
