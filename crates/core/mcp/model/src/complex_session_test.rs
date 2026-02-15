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

#[allow(non_snake_case)]
/// 描述：验证中文引号路径可被识别为 OpenFile 步骤。
#[test]
fn TestShouldParseOpenFilePathWithChineseQuotes() {
    let steps = plan_model_session_steps("打开模型“/Users/yoho/Downloads/demo.blend”");
    let has_open_file = steps.iter().any(|item| {
        matches!(
            item,
            ModelSessionPlannedStep::Tool {
                action: ModelToolAction::OpenFile,
                ..
            }
        )
    });
    assert!(has_open_file);
}

#[allow(non_snake_case)]
/// 描述：验证“贴图 + 图片路径”会规划为应用贴图动作。
#[test]
fn TestShouldPlanApplyTextureImageStep() {
    let steps = plan_model_session_steps("我发现场景地板的贴图缺失了，能用“/Users/yoho/Downloads/image.png”添加吗");
    let has_apply_texture = steps.iter().any(|item| {
        matches!(
            item,
            ModelSessionPlannedStep::Tool {
                action: ModelToolAction::ApplyTextureImage,
                ..
            }
        )
    });
    assert!(has_apply_texture);
}

#[allow(non_snake_case)]
/// 描述：验证引号后含空格且尾部跟随文案时，仍可正确提取贴图路径并规划动作。
#[test]
fn TestShouldPlanApplyTextureImageStepWithQuotedSpacePath() {
    let steps = plan_model_session_steps("我发现场景地板的贴图缺失了，能用“ /Users/yoho/Downloads/image.png”添加吗");
    let has_apply_texture = steps.iter().any(|item| {
        matches!(
            item,
            ModelSessionPlannedStep::Tool {
                action: ModelToolAction::ApplyTextureImage,
                ..
            }
        )
    });
    assert!(has_apply_texture);
}

#[allow(non_snake_case)]
/// 描述：验证“这个物体平移”会规划为仅作用于选中对象的 translate_objects 步骤。
#[test]
fn TestShouldPlanTranslateObjectsStepWithSelectionScope() {
    let steps = plan_model_session_steps("对这个物体平移 0.5");
    let has_translate_scoped = steps.iter().any(|item| {
        if let ModelSessionPlannedStep::Tool { action, params, .. } = item {
            let scope = params
                .get("selection_scope")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            return *action == ModelToolAction::TranslateObjects && matches!(scope, "active" | "selected");
        }
        false
    });
    assert!(has_translate_scoped);
}

#[allow(non_snake_case)]
/// 描述：验证“这个物体旋转”会规划为 rotate_objects，且作用域为 active 或 selected。
#[test]
fn TestShouldPlanRotateObjectsStepWithSelectionScope() {
    let steps = plan_model_session_steps("对这个物体旋转 30");
    let has_rotate_scoped = steps.iter().any(|item| {
        if let ModelSessionPlannedStep::Tool { action, params, .. } = item {
            let scope = params
                .get("selection_scope")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            return *action == ModelToolAction::RotateObjects && matches!(scope, "active" | "selected");
        }
        false
    });
    assert!(has_rotate_scoped);
}

#[allow(non_snake_case)]
/// 描述：验证“所有对象缩放”会规划为 all 作用域，避免误判为仅选中对象。
#[test]
fn TestShouldPlanScaleObjectsWithAllScope() {
    let steps = plan_model_session_steps("对所有对象缩放 1.2");
    let has_scale_all = steps.iter().any(|item| {
        if let ModelSessionPlannedStep::Tool { action, params, .. } = item {
            let scope = params
                .get("selection_scope")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            return *action == ModelToolAction::ScaleObjects && scope == "all";
        }
        false
    });
    assert!(has_scale_all);
}

#[allow(non_snake_case)]
/// 描述：验证“名为 A/B 的物体平移”会在 transform 参数中包含 target_names 过滤列表。
#[test]
fn TestShouldPlanTranslateObjectsWithTargetNames() {
    let steps = plan_model_session_steps("对名为“Cube”和“Sphere”的物体平移 1");
    let has_target_names = steps.iter().any(|item| {
        if let ModelSessionPlannedStep::Tool { action, params, .. } = item {
            let names = params
                .get("target_names")
                .and_then(|value| value.as_array())
                .map(|items| items.len())
                .unwrap_or(0);
            let target_mode = params
                .get("target_mode")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let require_selection = params
                .get("require_selection")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            return *action == ModelToolAction::TranslateObjects
                && names == 2
                && target_mode == "named"
                && require_selection;
        }
        false
    });
    assert!(has_target_names);
}

#[allow(non_snake_case)]
/// 描述：验证 transform 步骤 trace 会补充 selection_scope 与 single/multi/all 观测字段。
#[test]
fn TestShouldBuildSelectionScopeTracePayload() {
    let step = ModelSessionPlannedStep::Tool {
        action: ModelToolAction::TranslateObjects,
        input: "平移".to_string(),
        params: json!({
            "delta": [0.2, 0.0, 0.0],
            "selection_scope": "selected",
            "target_names": ["Cube", "Sphere"]
        }),
        operation_kind: ModelPlanOperationKind::BatchTransform,
        branch: ModelPlanBranch::Primary,
        recoverable: true,
        risk: ModelPlanRiskLevel::Low,
        condition: None,
    };
    let trace = step.trace_payload();
    assert_eq!(
        trace
            .get("selection_scope")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        "selected"
    );
    assert_eq!(
        trace
            .get("selection_scope_trace")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        "multi"
    );
    assert_eq!(
        trace
            .get("target_mode")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        "named"
    );
    assert_eq!(
        trace
            .get("require_selection")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        true
    );
}
