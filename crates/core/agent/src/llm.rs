use crate::workflow::{RetryClassifiedError, WorkflowRetryPolicy};
use std::env;
use zodileap_mcp_common::ProtocolError;

#[path = "llm/providers/mod.rs"]
mod providers;

pub(crate) const LLM_RUNTIME_TAG: &str = "llm-v3-gateway";
const DEFAULT_TIMEOUT_SECS: u64 = 300;
const DEFAULT_RETRY_MAX: u8 = 1;
const DEFAULT_RETRY_BACKOFF_MS: u64 = 400;

/// 描述：LLM 文本增量回调签名，输出为原始文本分片。
pub type LlmTextStreamObserver<'a> = dyn FnMut(&str) + 'a;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlmProvider {
    CodexCli,
    Gemini,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct LlmGatewayPolicy {
    pub timeout_secs: u64,
    pub retry_policy: WorkflowRetryPolicy,
}

impl LlmGatewayPolicy {
    /// 描述：从环境变量加载网关策略，未配置时使用默认值。
    pub fn from_env() -> Self {
        let timeout_secs = env::var("ZODILEAP_LLM_TIMEOUT_SECS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_TIMEOUT_SECS);
        let max_retries = env::var("ZODILEAP_LLM_RETRY_MAX")
            .ok()
            .and_then(|value| value.trim().parse::<u8>().ok())
            .unwrap_or(DEFAULT_RETRY_MAX);
        let backoff_millis = env::var("ZODILEAP_LLM_RETRY_BACKOFF_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(DEFAULT_RETRY_BACKOFF_MS);

        Self {
            timeout_secs,
            retry_policy: WorkflowRetryPolicy {
                max_retries,
                backoff_millis,
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct LlmGatewayError {
    pub provider: LlmProvider,
    pub code: String,
    pub message: String,
    pub suggestion: Option<String>,
    pub retryable: bool,
    pub attempts: u8,
}

impl LlmGatewayError {
    /// 描述：创建一个 LLM 网关错误。
    pub fn new(provider: LlmProvider, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            provider,
            code: code.into(),
            message: message.into(),
            suggestion: None,
            retryable: false,
            attempts: 1,
        }
    }

    /// 描述：设置错误建议文案，给上层交互层做指引展示。
    pub fn with_suggestion(mut self, suggestion: impl Into<String>) -> Self {
        self.suggestion = Some(suggestion.into());
        self
    }

    /// 描述：标记错误是否可重试，驱动网关与工作流恢复逻辑。
    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    /// 描述：写入最终尝试次数，便于错误定位与重试观测。
    pub fn with_attempts(mut self, attempts: u8) -> Self {
        self.attempts = attempts;
        self
    }

    /// 描述：转换成统一协议错误，供 agent 层直接透传给 UI。
    pub fn to_protocol_error(&self) -> ProtocolError {
        let mut message = self.message.clone();
        if self.attempts > 1 {
            message = format!("{}（attempts={}）", message, self.attempts);
        }

        let mut error =
            ProtocolError::new(self.code.clone(), message).with_retryable(self.retryable);
        if let Some(suggestion) = self.suggestion.as_deref() {
            if !suggestion.trim().is_empty() {
                error = error.with_suggestion(suggestion.to_string());
            }
        }
        error
    }
}

impl std::fmt::Display for LlmGatewayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.suggestion.as_deref() {
            Some(suggestion) if !suggestion.trim().is_empty() => {
                write!(
                    f,
                    "{}: {} (suggestion: {})",
                    self.code, self.message, suggestion
                )
            }
            _ => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

impl RetryClassifiedError for LlmGatewayError {
    fn is_retryable(&self) -> bool {
        self.retryable
    }
}

/// 描述：将原始 provider 字符串映射为网关支持的提供方枚举。
pub fn parse_provider(raw: &str) -> LlmProvider {
    match raw.trim().to_lowercase().as_str() {
        "codex" | "codex-cli" => LlmProvider::CodexCli,
        "gemini" | "gemini-cli" => LlmProvider::Gemini,
        _ => LlmProvider::Unknown,
    }
}

/// 描述：按默认策略调用模型网关，包含路由、超时、重试与错误归一。
pub fn call_model(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
) -> Result<String, LlmGatewayError> {
    call_model_with_policy(provider, prompt, workdir, LlmGatewayPolicy::from_env())
}

/// 描述：按默认策略调用模型网关并返回文本增量，供上层实现 token 级流式输出。
pub fn call_model_with_stream(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
    on_chunk: &mut LlmTextStreamObserver,
) -> Result<String, LlmGatewayError> {
    call_model_with_policy_and_stream(
        provider,
        prompt,
        workdir,
        LlmGatewayPolicy::from_env(),
        Some(on_chunk),
    )
}

/// 描述：按指定策略调用模型网关，便于测试与不同运行环境注入。
pub fn call_model_with_policy(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
) -> Result<String, LlmGatewayError> {
    call_model_with_policy_and_stream(provider, prompt, workdir, policy, None)
}

/// 描述：按指定策略调用模型网关，并可选输出增量文本事件。
fn call_model_with_policy_and_stream(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
    on_chunk: Option<&mut LlmTextStreamObserver>,
) -> Result<String, LlmGatewayError> {
    match provider {
        LlmProvider::CodexCli => {
            providers::codex_cli::call_with_retry(prompt, workdir, policy, on_chunk)
        }
        LlmProvider::Gemini => providers::gemini::call_with_retry(prompt, workdir, policy, on_chunk),
        LlmProvider::Unknown => Err(LlmGatewayError::new(
            provider,
            "core.agent.llm.provider_unknown",
            "unknown llm provider",
        )
        .with_suggestion("请将 provider 设置为 codex / codex-cli 或 gemini / gemini-cli")),
    }
}

#[cfg(test)]
#[path = "llm_tests.rs"]
mod tests;
