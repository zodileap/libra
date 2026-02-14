use crate::{
    build_recovery_ui_hint, build_safety_confirmation_token, build_safety_confirmation_ui_hint,
    check_capability_for_session_step, plan_model_session_steps, requires_safety_confirmation,
    validate_safety_confirmation_token, ModelPlanBranch, ModelPlanOperationKind,
    ModelPlanRiskLevel, ModelSessionCapabilityMatrix, ModelSessionPlannedStep, ModelToolAction,
};
use serde_json::json;
use zodileap_mcp_common::ProtocolError;

#[allow(non_snake_case)]
/// 描述：验证“布尔链”关键词会规划为多步高风险复合动作。
#[test]
fn TestShouldPlanBooleanChainSteps() {
    let steps = plan_model_session_steps("请执行布尔链 3 次，并在失败后回滚");
    let primary_boolean_steps = steps
        .iter()
        .filter(|item| {
            matches!(
                item,
                ModelSessionPlannedStep::Tool {
                    action: ModelToolAction::Boolean,
                    branch: ModelPlanBranch::Primary,
                    ..
                }
            )
        })
        .count();
    let fallback_steps = steps
        .iter()
        .filter(|item| item.branch() == ModelPlanBranch::Fallback)
        .count();
    assert_eq!(primary_boolean_steps, 3);
    assert!(fallback_steps >= 1);
}

#[allow(non_snake_case)]
/// 描述：验证高风险步骤会触发一次性确认要求。
#[test]
fn TestShouldRequireConfirmationForHighRiskSteps() {
    let steps = plan_model_session_steps("执行布尔链并保存场景");
    assert!(requires_safety_confirmation(&steps));
}

#[allow(non_snake_case)]
/// 描述：验证确认令牌生成和校验逻辑保持一致。
#[test]
fn TestShouldValidateConfirmationToken() {
    let trace_id = "trace-123";
    let prompt = "执行布尔链并导出";
    let token = build_safety_confirmation_token(trace_id, prompt);
    assert!(validate_safety_confirmation_token(trace_id, prompt, &token));
    assert!(!validate_safety_confirmation_token(trace_id, prompt, "confirm-invalid"));
}

#[allow(non_snake_case)]
/// 描述：验证能力关闭时会返回结构化能力禁用错误。
#[test]
fn TestShouldRejectStepWhenCapabilityDisabled() {
    let step = ModelSessionPlannedStep::Tool {
        action: ModelToolAction::Boolean,
        input: "布尔".to_string(),
        params: json!({"operation":"DIFFERENCE","times":1}),
        operation_kind: ModelPlanOperationKind::BooleanChain,
        branch: ModelPlanBranch::Primary,
        recoverable: true,
        risk: ModelPlanRiskLevel::High,
        condition: None,
    };
    let capabilities = ModelSessionCapabilityMatrix {
        geometry: false,
        ..ModelSessionCapabilityMatrix::default()
    };
    let result = check_capability_for_session_step(&capabilities, &step);
    assert!(result.is_err());
}

#[allow(non_snake_case)]
/// 描述：验证恢复提示包含“重试”和“应用恢复策略”动作。
#[test]
fn TestShouldBuildRecoveryUiHintActions() {
    let step = ModelSessionPlannedStep::Tool {
        action: ModelToolAction::Boolean,
        input: "布尔".to_string(),
        params: json!({"operation":"DIFFERENCE","times":1}),
        operation_kind: ModelPlanOperationKind::BooleanChain,
        branch: ModelPlanBranch::Primary,
        recoverable: true,
        risk: ModelPlanRiskLevel::High,
        condition: None,
    };
    let error = ProtocolError::new("mcp.model.bridge.action_failed", "布尔链执行失败");
    let hint = build_recovery_ui_hint(&step, &error);
    assert_eq!(hint.key, "complex-operation-recovery");
    assert!(hint.actions.iter().any(|item| item.key == "retry_last_step"));
    assert!(hint.actions.iter().any(|item| item.key == "apply_recovery_plan"));
}

#[allow(non_snake_case)]
/// 描述：验证安全提示中包含一次性确认令牌和风险原因。
#[test]
fn TestShouldBuildSafetyConfirmationUiHintContext() {
    let steps = plan_model_session_steps("执行布尔链 2 次");
    let hint = build_safety_confirmation_ui_hint("trace-abc", "执行布尔链 2 次", &steps);
    let context = hint.context.expect("context should exist");
    assert!(context.get("confirmation_token").is_some());
    assert!(context.get("risk_reasons").is_some());
}
