use super::*;

/// 描述：验证 Code 智能体提示词包含代码场景约束。
#[test]
fn should_build_code_prompt() {
    let prompt = build_system_prompt(AgentKind::Code);
    assert!(prompt.contains("代码智能体"));
    assert!(prompt.contains("模块化"));
}

/// 描述：验证 Model 智能体提示词包含建模场景约束。
#[test]
fn should_build_model_prompt() {
    let prompt = build_system_prompt(AgentKind::Model);
    assert!(prompt.contains("三维模型智能体"));
    assert!(prompt.contains("操作步骤"));
}

/// 描述：验证带工具上下文时会把上下文拼接到最终 prompt 中。
#[test]
fn should_compose_prompt_with_tool_context() {
    let composed = compose_prompt(AgentKind::Model, "请继续", Some("已导出 glb"));
    assert!(composed.contains("工具执行结果"));
    assert!(composed.contains("已导出 glb"));
    assert!(composed.contains("用户输入：\n请继续"));
}

/// 描述：验证空工具上下文时不会输出工具结果区块。
#[test]
fn should_compose_prompt_without_tool_context() {
    let composed = compose_prompt(AgentKind::Code, "生成接口", Some("  "));
    assert!(!composed.contains("工具执行结果"));
    assert!(composed.contains("用户输入：\n生成接口"));
}
