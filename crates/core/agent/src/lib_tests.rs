use super::*;

/// 描述：构造测试用基础请求，默认不触发模型导出路径。
fn build_base_request() -> AgentRunRequest {
    AgentRunRequest {
        trace_id: "test-trace".to_string(),
        session_id: "test-session".to_string(),
        agent_key: "code".to_string(),
        provider: "unknown".to_string(),
        prompt: "hello".to_string(),
        project_name: None,
        model_export_enabled: false,
        blender_bridge_addr: None,
        output_dir: None,
        workdir: None,
    }
}

/// 描述：验证 agent_key 解析逻辑会把未知值归并到 Code。
#[test]
fn should_parse_agent_kind() {
    assert_eq!(parse_agent_kind("model"), AgentKind::Model);
    assert_eq!(parse_agent_kind("MODEL"), AgentKind::Model);
    assert_eq!(parse_agent_kind("code"), AgentKind::Code);
    assert_eq!(parse_agent_kind("unknown"), AgentKind::Code);
}

/// 描述：验证模型导出触发词识别覆盖中英文关键词。
#[test]
fn should_trigger_export_by_keywords() {
    assert!(should_trigger_export("请导出当前模型"));
    assert!(should_trigger_export("export glb now"));
    assert!(should_trigger_export("请输出 fbx"));
    assert!(!should_trigger_export("只给我分析步骤"));
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

/// 描述：验证流式执行接口在失败前会先发送 LLM started 事件，便于前端及时进入“生成中”状态。
#[test]
fn should_emit_started_stream_event_before_provider_failure() {
    let request = build_base_request();
    let mut events: Vec<AgentStreamEvent> = Vec::new();
    let err = run_agent_with_protocol_error_stream(request, |event| {
        events.push(event);
    })
    .expect_err("must fail");
    assert_eq!(err.code, "core.agent.llm.provider_unknown");
    assert!(
        events
            .iter()
            .any(|event| matches!(event, AgentStreamEvent::LlmStarted { .. })),
        "unknown provider 失败前应发出 LlmStarted 事件"
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

/// 描述：验证在未启用 model feature 时导出请求返回能力未启用错误。
#[cfg(not(feature = "with-mcp-model"))]
#[test]
fn should_fail_when_model_export_feature_disabled() {
    let mut request = build_base_request();
    request.agent_key = "model".to_string();
    request.prompt = "请导出模型".to_string();
    request.provider = "codex".to_string();
    request.model_export_enabled = true;

    let err = run_agent_with_protocol_error(request).expect_err("must fail");
    assert_eq!(err.code, "core.agent.feature_disabled");
    assert!(err.message.contains("model export feature is not enabled"));
}

/// 描述：验证启用模型能力时，agent->mcp 失败会返回统一协议错误字段。
#[cfg(feature = "with-mcp-model")]
#[test]
fn should_map_mcp_bridge_error_to_protocol_error() {
    let mut request = build_base_request();
    request.agent_key = "model".to_string();
    request.provider = "codex".to_string();
    request.prompt = "请导出当前模型".to_string();
    request.model_export_enabled = true;
    request.blender_bridge_addr = Some("127.0.0.1:notaport".to_string());
    request.output_dir = Some(
        std::env::temp_dir()
            .join("libra-agent-core-tests")
            .to_string_lossy()
            .to_string(),
    );

    let err = run_agent_with_protocol_error(request).expect_err("must fail");
    assert_eq!(err.code, "mcp.model.export.invalid_bridge_addr");
    assert!(err.message.contains("invalid bridge addr"));
    assert!(!err.retryable);
}
