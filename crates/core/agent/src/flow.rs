#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    Code,
    Model,
}

pub fn build_system_prompt(agent_kind: AgentKind) -> &'static str {
    match agent_kind {
        AgentKind::Code => {
            "你是代码智能体。目标：输出可执行、可维护的实现方案与代码建议。\
            约束：优先模块化、明确文件结构、明确下一步动作。"
        }
        AgentKind::Model => {
            "你是三维模型智能体。目标：帮助用户完成建模任务，并在可用时调用导出能力。\
            约束：输出操作步骤要具体，先给可执行动作，再给解释。"
        }
    }
}

pub fn compose_prompt(agent_kind: AgentKind, user_prompt: &str, tool_context: Option<&str>) -> String {
    let system = build_system_prompt(agent_kind);
    match tool_context {
        Some(context) if !context.trim().is_empty() => format!(
            "{system}\n\n工具执行结果：\n{context}\n\n用户输入：\n{user_prompt}\n\n请基于以上信息给出下一步。"
        ),
        _ => format!("{system}\n\n用户输入：\n{user_prompt}"),
    }
}
