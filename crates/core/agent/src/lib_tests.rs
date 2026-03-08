use super::*;

/// 描述：构造测试用基础请求，默认不触发模型导出路径。
fn build_base_request() -> AgentRunRequest {
    AgentRunRequest {
        trace_id: "test-trace".to_string(),
        session_id: "test-session".to_string(),
        agent_key: "agent".to_string(),
        provider: "unknown".to_string(),
        prompt: "hello".to_string(),
        project_name: None,
        model_export_enabled: false,
        dcc_provider_addr: None,
        output_dir: None,
        workdir: None,
        available_mcps: Vec::new(),
    }
}

/// 描述：验证旧 agent_key 会被统一收敛到同一智能体标识。
#[test]
fn should_normalize_agent_key() {
    assert_eq!(normalize_agent_key("model"), "agent");
    assert_eq!(normalize_agent_key("MODEL"), "agent");
    assert_eq!(normalize_agent_key("code"), "agent");
    assert_eq!(normalize_agent_key("unknown"), "agent");
    assert_eq!(normalize_agent_key("agent"), "agent");
}

/// 描述：验证特性探测结果与当前编译期 feature 开关一致。
#[test]
fn should_match_enabled_features() {
    let flags = enabled_feature_flags();
    assert_eq!(
        flags.contains(&AgentFeatureFlag::WithMcpModel),
        cfg!(feature = "with-mcp-model")
    );
    assert_eq!(
        flags.contains(&AgentFeatureFlag::WithMcpCode),
        cfg!(feature = "with-mcp-code")
    );
}

/// 描述：验证 provider 非法时会返回统一协议错误码。
#[test]
fn should_return_protocol_error_for_unknown_provider() {
    let request = build_base_request();
    let err = run_agent_with_protocol_error(request).expect_err("must fail");
    assert_eq!(err.code, "core.agent.llm.provider_unknown");
    assert!(!err.retryable);
}

/// 描述：验证流式执行接口在 provider 非法时会直接返回协议错误；前端“开始执行”状态由 Tauri started 事件承担。
#[test]
fn should_return_provider_error_without_requiring_llm_started_event() {
    let request = build_base_request();
    let mut events: Vec<AgentStreamEvent> = Vec::new();
    let err = run_agent_with_protocol_error_stream(request, |event| {
        events.push(event);
    })
    .expect_err("must fail");
    assert_eq!(err.code, "core.agent.llm.provider_unknown");
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, AgentStreamEvent::LlmFinished { .. })),
        "provider 非法时不应继续进入 LLM 完成事件"
    );
}

/// 描述：验证授权请求可被显式清理，避免超时/中断场景遗留挂起记录。
#[test]
fn should_remove_pending_approval_request() {
    let registry = ApprovalRegistry {
        pending: std::sync::Mutex::new(std::collections::HashMap::new()),
    };
    let _signal = registry.create_request("approval-test-1");
    assert!(registry.remove_request("approval-test-1"));
    assert!(!registry.remove_request("approval-test-1"));
}

/// 描述：验证旧 key 仍可进入统一执行链，并返回与未知 provider 一致的错误。
#[test]
fn should_route_legacy_key_to_unified_agent() {
    let mut request = build_base_request();
    request.agent_key = "model".to_string();

    let err = run_agent_with_protocol_error(request).expect_err("must fail");
    assert_eq!(err.code, "core.agent.llm.provider_unknown");
}
