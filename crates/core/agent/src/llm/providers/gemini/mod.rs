use crate::llm::{LlmGatewayError, LlmProvider};

/// 描述：Gemini 提供方入口，当前阶段返回未实现错误并附带替代建议。
///
/// Params:
///
///   - provider: 当前路由到的模型提供方枚举。
///
/// Returns:
///
///   - 统一网关错误，提示调用方先使用 codex。
pub fn call(provider: LlmProvider) -> Result<String, LlmGatewayError> {
    Err(LlmGatewayError::new(
        provider,
        "core.agent.llm.provider_not_implemented",
        "gemini provider is not implemented yet",
    )
    .with_suggestion("当前可使用 provider=codex；如需 Gemini，请补齐网关实现"))
}
