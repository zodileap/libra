use super::*;

/// 描述：验证 provider 解析支持大小写与 codex-cli 别名。
#[test]
fn should_parse_provider() {
    assert_eq!(parse_provider("codex"), LlmProvider::CodexCli);
    assert_eq!(parse_provider(" codex-cli "), LlmProvider::CodexCli);
    assert_eq!(parse_provider("gemini"), LlmProvider::Gemini);
    assert_eq!(parse_provider("unknown"), LlmProvider::Unknown);
}

/// 描述：验证 Unknown provider 会返回统一错误码与不可重试标记。
#[test]
fn should_reject_unknown_provider() {
    let result = call_model_with_policy(
        LlmProvider::Unknown,
        "hello",
        None,
        LlmGatewayPolicy {
            timeout_secs: 1,
            retry_policy: WorkflowRetryPolicy {
                max_retries: 0,
                backoff_millis: 0,
            },
        },
    );
    assert!(result.is_err());
    let err = result.err().expect("must have error");
    assert_eq!(err.code, "core.agent.llm.provider_unknown");
    assert!(!err.retryable);
}

/// 描述：验证 Gemini provider 走未实现分支并携带建议文案。
#[test]
fn should_reject_gemini_provider_as_not_implemented() {
    let result = call_model_with_policy(
        LlmProvider::Gemini,
        "hello",
        None,
        LlmGatewayPolicy {
            timeout_secs: 1,
            retry_policy: WorkflowRetryPolicy {
                max_retries: 0,
                backoff_millis: 0,
            },
        },
    );
    assert!(result.is_err());
    let err = result.err().expect("must have error");
    assert_eq!(err.code, "core.agent.llm.provider_not_implemented");
    assert!(!err.retryable);
    assert!(err
        .suggestion
        .as_deref()
        .unwrap_or_default()
        .contains("provider=codex"));
}

/// 描述：验证网关错误转换协议错误时会带上 attempts 与 suggestion。
#[test]
fn should_convert_gateway_error_to_protocol_error() {
    let protocol_error =
        LlmGatewayError::new(LlmProvider::CodexCli, "core.agent.llm.test", "test failure")
            .with_suggestion("retry later")
            .with_retryable(true)
            .with_attempts(3)
            .to_protocol_error();

    assert_eq!(protocol_error.code, "core.agent.llm.test");
    assert!(protocol_error.message.contains("attempts=3"));
    assert_eq!(protocol_error.suggestion.as_deref(), Some("retry later"));
    assert!(protocol_error.retryable);
}

/// 描述：验证默认策略会回落到内置默认值。
#[test]
fn should_use_default_gateway_policy() {
    let policy = LlmGatewayPolicy::from_env();
    assert!(policy.timeout_secs > 0);
    assert!(policy.retry_policy.backoff_millis > 0);
}

/// 描述：验证流式调用接口在 provider 非法时返回一致错误且不会输出文本分片。
#[test]
fn should_reject_unknown_provider_for_stream_call() {
    let mut chunks: Vec<String> = Vec::new();
    let mut on_chunk = |chunk: &str| {
        chunks.push(chunk.to_string());
    };
    let result = call_model_with_stream(LlmProvider::Unknown, "hello", None, &mut on_chunk);
    assert!(result.is_err());
    let err = result.err().expect("must have error");
    assert_eq!(err.code, "core.agent.llm.provider_unknown");
    assert!(chunks.is_empty());
}
