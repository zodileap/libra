use super::*;

/// 描述：验证基础合法激活码可通过校验。
#[test]
fn should_validate_basic_code() {
    let options = ActivationValidationOptions {
        require_signature: true,
        require_device_binding: false,
        ..ActivationValidationOptions::default()
    };
    let result =
        validate_activation_code_with_options("ZL-model-abc_exp9999999999-abcdef12", &options);
    assert!(result.valid);
}

/// 描述：验证 agent 绑定不匹配时返回对应错误码。
#[test]
fn should_reject_wrong_agent() {
    let options = ActivationValidationOptions {
        expected_agent_key: Some("code".to_string()),
        require_signature: false,
        ..ActivationValidationOptions::default()
    };
    let result =
        validate_activation_code_with_options("ZL-model-abc_exp9999999999-abcdef12", &options);
    assert!(!result.valid);
    assert_eq!(result.code, "core.activation.agent_mismatch");
}

/// 描述：验证设备绑定匹配时可通过校验。
#[test]
fn should_check_device_binding() {
    let options = ActivationValidationOptions {
        device_id: Some("device-a".to_string()),
        require_signature: false,
        require_device_binding: true,
        ..ActivationValidationOptions::default()
    };
    let result = validate_activation_code_with_options(
        "ZL-model-abc_exp9999999999-abcdef12-device-a",
        &options,
    );
    assert!(result.valid);
}

/// 描述：验证激活码过期时返回过期错误。
#[test]
fn should_reject_expired_code() {
    let options = ActivationValidationOptions {
        now_unix_secs: Some(200),
        require_signature: false,
        ..ActivationValidationOptions::default()
    };
    let result = validate_activation_code_with_options("ZL-model-abc_exp100-abcdef12", &options);
    assert!(!result.valid);
    assert_eq!(result.code, "core.activation.expired");
}

/// 描述：验证签名不合法时返回签名错误。
#[test]
fn should_reject_invalid_signature() {
    let options = ActivationValidationOptions {
        require_signature: true,
        ..ActivationValidationOptions::default()
    };
    let result =
        validate_activation_code_with_options("ZL-model-abc_exp9999999999-not_hex", &options);
    assert!(!result.valid);
    assert_eq!(result.code, "core.activation.signature_invalid");
}

/// 描述：验证设备绑定不匹配时返回设备绑定错误。
#[test]
fn should_reject_device_binding_mismatch() {
    let options = ActivationValidationOptions {
        device_id: Some("device-a".to_string()),
        require_signature: false,
        require_device_binding: true,
        ..ActivationValidationOptions::default()
    };
    let result = validate_activation_code_with_options(
        "ZL-model-abc_exp9999999999-abcdef12-device-b",
        &options,
    );
    assert!(!result.valid);
    assert_eq!(result.code, "core.activation.device_binding_invalid");
}
