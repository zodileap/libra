/// 描述：激活码校验参数，包含签名和设备绑定的策略开关。
#[derive(Debug, Clone)]
pub struct ActivationValidationOptions {
    pub expected_agent_key: Option<String>,
    pub device_id: Option<String>,
    pub require_signature: bool,
    pub require_device_binding: bool,
    pub now_unix_secs: Option<u64>,
    pub min_length: usize,
    pub max_length: usize,
}

impl Default for ActivationValidationOptions {
    fn default() -> Self {
        Self {
            expected_agent_key: None,
            device_id: None,
            require_signature: true,
            require_device_binding: false,
            now_unix_secs: None,
            min_length: 16,
            max_length: 128,
        }
    }
}

/// 描述：激活码结构化解析结果，预留签名与设备绑定字段。
#[derive(Debug, Clone)]
pub struct ActivationCodeParts {
    pub prefix: String,
    pub agent_key: String,
    pub payload: String,
    pub signature: String,
    pub bound_device: Option<String>,
    pub expires_at: Option<u64>,
}

/// 描述：激活码校验结果，便于上层展示失败原因与下一步动作。
#[derive(Debug, Clone)]
pub struct ActivationValidationResult {
    pub valid: bool,
    pub code: String,
    pub message: String,
    pub signature_checked: bool,
    pub device_binding_checked: bool,
    pub parsed: Option<ActivationCodeParts>,
}

impl ActivationValidationResult {
    /// 描述：构造一个失败结果。
    fn invalid(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            valid: false,
            code: code.into(),
            message: message.into(),
            signature_checked: false,
            device_binding_checked: false,
            parsed: None,
        }
    }

    /// 描述：构造一个成功结果。
    fn valid(
        parts: ActivationCodeParts,
        signature_checked: bool,
        device_binding_checked: bool,
    ) -> Self {
        Self {
            valid: true,
            code: "core.activation.ok".to_string(),
            message: "activation code is valid".to_string(),
            signature_checked,
            device_binding_checked,
            parsed: Some(parts),
        }
    }
}

/// 描述：兼容旧调用方的布尔校验入口。
pub fn validate_activation_code(code: &str) -> bool {
    validate_activation_code_with_options(code, &ActivationValidationOptions::default()).valid
}

/// 描述：按策略执行激活码校验（规则 + 签名预留 + 设备绑定预留）。
pub fn validate_activation_code_with_options(
    code: &str,
    options: &ActivationValidationOptions,
) -> ActivationValidationResult {
    let normalized = code.trim();
    if normalized.is_empty() {
        return ActivationValidationResult::invalid(
            "core.activation.empty",
            "activation code cannot be empty",
        );
    }

    if normalized.len() < options.min_length || normalized.len() > options.max_length {
        return ActivationValidationResult::invalid(
            "core.activation.length_invalid",
            format!(
                "activation code length must be in range [{}, {}]",
                options.min_length, options.max_length
            ),
        );
    }

    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return ActivationValidationResult::invalid(
            "core.activation.charset_invalid",
            "activation code must contain only ascii letters, digits, '-', and '_'",
        );
    }

    let parts = match parse_activation_code(normalized) {
        Some(value) => value,
        None => {
            return ActivationValidationResult::invalid(
                "core.activation.format_invalid",
                "activation code format should be ZL-<agent>-<payload>-<signature>[-<device>]",
            )
        }
    };

    if let Some(expected_agent) = options
        .expected_agent_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !parts.agent_key.eq_ignore_ascii_case(expected_agent) {
            return ActivationValidationResult::invalid(
                "core.activation.agent_mismatch",
                format!(
                    "activation code agent mismatch: expected `{}`, got `{}`",
                    expected_agent, parts.agent_key
                ),
            );
        }
    }

    if let Some(expires_at) = parts.expires_at {
        let now = options.now_unix_secs.unwrap_or_else(current_unix_secs);
        if now > expires_at {
            return ActivationValidationResult::invalid(
                "core.activation.expired",
                format!("activation code expired at {}", expires_at),
            );
        }
    }

    let mut signature_checked = false;
    if options.require_signature {
        signature_checked = true;
        if !verify_signature_placeholder(&parts.signature) {
            return ActivationValidationResult::invalid(
                "core.activation.signature_invalid",
                "activation signature is invalid",
            );
        }
    }

    let mut device_binding_checked = false;
    if options.require_device_binding {
        device_binding_checked = true;
        if !verify_device_binding_placeholder(
            options.device_id.as_deref(),
            parts.bound_device.as_deref(),
        ) {
            return ActivationValidationResult::invalid(
                "core.activation.device_binding_invalid",
                "activation device binding is invalid",
            );
        }
    }

    ActivationValidationResult::valid(parts, signature_checked, device_binding_checked)
}

/// 描述：解析激活码结构，当前阶段保留可扩展字段。
fn parse_activation_code(code: &str) -> Option<ActivationCodeParts> {
    let segments: Vec<&str> = code.split('-').collect();
    if segments.len() < 4 {
        return None;
    }

    let prefix = segments[0].trim().to_string();
    let agent_key = segments[1].trim().to_string();
    let payload = segments[2].trim().to_string();
    let signature = segments[3].trim().to_string();
    let bound_device = if segments.len() >= 5 {
        let value = segments[4..].join("-");
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    } else {
        None
    };

    if !prefix.eq_ignore_ascii_case("ZL")
        || agent_key.is_empty()
        || payload.is_empty()
        || signature.is_empty()
    {
        return None;
    }

    Some(ActivationCodeParts {
        prefix,
        agent_key,
        expires_at: parse_expire_from_payload(&payload),
        payload,
        signature,
        bound_device,
    })
}

/// 描述：从 payload 中解析过期时间字段（`exp<unix>`），未配置则返回 None。
fn parse_expire_from_payload(payload: &str) -> Option<u64> {
    for token in payload.split('_') {
        let lowered = token.trim().to_lowercase();
        if let Some(raw_value) = lowered.strip_prefix("exp") {
            if let Ok(ts) = raw_value.parse::<u64>() {
                return Some(ts);
            }
        }
    }
    None
}

/// 描述：签名校验占位实现，当前仅做长度和十六进制合法性检查。
fn verify_signature_placeholder(signature: &str) -> bool {
    let normalized = signature.trim();
    normalized.len() >= 8 && normalized.chars().all(|ch| ch.is_ascii_hexdigit())
}

/// 描述：设备绑定校验占位实现，当前按“激活码绑定设备 == 当前设备”规则校验。
fn verify_device_binding_placeholder(device_id: Option<&str>, bound_device: Option<&str>) -> bool {
    let expected = device_id.map(str::trim).filter(|value| !value.is_empty());
    let actual = bound_device
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match (expected, actual) {
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}

/// 描述：获取当前 unix 秒时间戳。
fn current_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "activation_tests.rs"]
mod tests;
