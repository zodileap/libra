use crate::workflow::{RetryClassifiedError, WorkflowRetryPolicy};
use libra_mcp_common::ProtocolError;
use serde::Serialize;
use std::env;
use std::time::{Duration, Instant};

#[path = "llm/providers/mod.rs"]
mod providers;

pub(crate) const LLM_RUNTIME_TAG: &str = "llm-v3-gateway";
const DEFAULT_TIMEOUT_SECS: u64 = 300;
const DEFAULT_RETRY_MAX: u8 = 1;
const DEFAULT_RETRY_BACKOFF_MS: u64 = 400;
const WAITING_PROGRESS_INTERVAL_MS: u64 = 1200;

/// 描述：LLM 调用产生的 Token 使用量统计。
#[derive(Debug, Clone, Default, Serialize)]
pub struct LlmUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// 描述：LLM 网关调用结果，包含生成的文本内容与消耗统计。
#[derive(Debug, Clone)]
pub struct LlmRunResult {
    pub content: String,
    pub usage: LlmUsage,
}

/// 描述：LLM Provider 运行时配置，统一承载 API Key、模型名等非提示词参数。
#[derive(Debug, Clone, Default)]
pub struct LlmProviderConfig {
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub mode: Option<String>,
}

impl LlmUsage {
    /// 描述：基于文本长度执行启发式 Token 估算（1 token 约等于 4 字符）。
    pub fn estimate(prompt: &str, completion: &str) -> Self {
        let prompt_tokens = (prompt.chars().count() as f32 / 4.0).ceil() as u32;
        let completion_tokens = (completion.chars().count() as f32 / 4.0).ceil() as u32;
        Self {
            prompt_tokens,
            completion_tokens,
            total_tokens: prompt_tokens + completion_tokens,
        }
    }
}

/// 描述：LLM 文本增量回调签名，输出为原始文本分片。
pub type LlmTextStreamObserver<'a> = dyn FnMut(&str) + 'a;

/// 描述：LLM 等待阶段的进度回调签名，输出为适合直接展示的简短状态文案。
pub type LlmProgressObserver<'a> = dyn FnMut(&str) + 'a;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlmProvider {
    CodexCli,
    Gemini,
    Iflow,
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
        "iflow" | "iflow-api" => LlmProvider::Iflow,
        _ => LlmProvider::Unknown,
    }
}

/// 描述：按默认策略调用模型网关，包含路由、超时、重试与错误归一。
pub fn call_model(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
) -> Result<LlmRunResult, LlmGatewayError> {
    call_model_with_policy(provider, prompt, workdir, LlmGatewayPolicy::from_env())
}

/// 描述：按默认策略调用模型网关并返回文本增量，供上层实现 token 级流式输出。
pub fn call_model_with_stream(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
    on_chunk: &mut LlmTextStreamObserver,
) -> Result<LlmRunResult, LlmGatewayError> {
    call_model_with_policy_and_stream(
        provider,
        prompt,
        workdir,
        LlmGatewayPolicy::from_env(),
        None,
        Some(on_chunk),
        None,
    )
}

/// 描述：按指定策略调用模型网关，便于测试与不同运行环境注入。
pub fn call_model_with_policy(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
) -> Result<LlmRunResult, LlmGatewayError> {
    call_model_with_policy_and_stream(provider, prompt, workdir, policy, None, None, None)
}

/// 描述：按指定策略调用模型网关，并可选输出增量文本事件。
pub(crate) fn call_model_with_policy_and_stream(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
    provider_config: Option<&LlmProviderConfig>,
    on_chunk: Option<&mut LlmTextStreamObserver>,
    on_progress: Option<&mut LlmProgressObserver>,
) -> Result<LlmRunResult, LlmGatewayError> {
    match provider {
        LlmProvider::CodexCli => providers::codex_cli::call_with_retry(
            prompt,
            workdir,
            policy,
            provider_config,
            on_chunk,
            on_progress,
        ),
        LlmProvider::Gemini => providers::gemini::call_with_retry(
            prompt,
            workdir,
            policy,
            provider_config,
            on_chunk,
            on_progress,
        ),
        LlmProvider::Iflow => providers::iflow::call_with_retry(
            prompt,
            workdir,
            policy,
            provider_config,
            on_chunk,
            on_progress,
        ),
        LlmProvider::Unknown => Err(LlmGatewayError::new(
            provider,
            "core.agent.llm.provider_unknown",
            "unknown llm provider",
        )
        .with_suggestion(
            "请将 provider 设置为 codex / codex-cli、gemini / gemini-cli 或 iflow / iflow-api",
        )),
    }
}

/// 描述：判断当前是否应继续发出“等待模型首个片段”心跳，避免等待阶段过于频繁地推送重复事件。
///
/// Params:
///
///   - last_emitted_at: 上一次发出等待心跳的时间。
///   - now: 当前时间。
///
/// Returns:
///
///   - true: 应发出新的等待心跳。
///   - false: 仍处于节流窗口内，跳过本次发送。
pub(crate) fn should_emit_waiting_progress(last_emitted_at: Option<Instant>, now: Instant) -> bool {
    match last_emitted_at {
        None => true,
        Some(last) => {
            now.duration_since(last) >= Duration::from_millis(WAITING_PROGRESS_INTERVAL_MS)
        }
    }
}

/// 描述：判断 provider 是否已经超过“空闲无输出超时”窗口。
///
/// Params:
///
///   - last_output_at: 最近一次收到 provider 原始输出的时间。
///   - now: 当前时间。
///   - timeout: 允许持续空闲的最长时长。
///
/// Returns:
///
///   - true: 已经超过空闲阈值，应终止当前调用。
///   - false: 仍处于活动或可继续等待状态。
pub(crate) fn should_abort_for_output_idle(
    last_output_at: Instant,
    now: Instant,
    timeout: Duration,
) -> bool {
    now.duration_since(last_output_at) >= timeout
}

#[cfg(test)]
#[path = "llm_tests.rs"]
mod tests;
