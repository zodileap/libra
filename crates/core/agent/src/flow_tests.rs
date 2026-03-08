use super::*;

/// 描述：验证统一智能体提示词包含通用执行约束。
#[test]
fn should_build_unified_prompt() {
    let prompt = build_system_prompt();
    assert!(prompt.contains("统一智能体"));
    assert!(prompt.contains("工作流"));
}

/// 描述：验证系统提示词包含统一智能体关键约束。
#[test]
fn should_include_skill_constraint_in_prompt() {
    let prompt = build_system_prompt();
    assert!(prompt.contains("统一智能体"));
    assert!(prompt.contains("技能"));
}

/// 描述：验证带工具上下文时会把上下文拼接到最终 prompt 中。
#[test]
fn should_compose_prompt_with_tool_context() {
    let composed = compose_prompt("请继续", Some("已导出 glb"));
    assert!(composed.contains("工具执行结果"));
    assert!(composed.contains("已导出 glb"));
    assert!(composed.contains("用户输入：\n请继续"));
}

/// 描述：验证空工具上下文时不会输出工具结果区块。
#[test]
fn should_compose_prompt_without_tool_context() {
    let composed = compose_prompt("生成接口", Some("  "));
    assert!(!composed.contains("工具执行结果"));
    assert!(composed.contains("用户输入：\n生成接口"));
}
