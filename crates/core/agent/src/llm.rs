use crate::workflow::{
    run_step_with_retry, DefaultWorkflowRecoveryHook, RetryClassifiedError, WorkflowRetryPolicy,
};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use zodileap_mcp_common::ProtocolError;

const LLM_RUNTIME_TAG: &str = "llm-v3-gateway";
const DEFAULT_TIMEOUT_SECS: u64 = 120;
const DEFAULT_RETRY_MAX: u8 = 1;
const DEFAULT_RETRY_BACKOFF_MS: u64 = 400;

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
        "gemini" => LlmProvider::Gemini,
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

/// 描述：按指定策略调用模型网关，便于测试与不同运行环境注入。
pub fn call_model_with_policy(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
) -> Result<String, LlmGatewayError> {
    match provider {
        LlmProvider::CodexCli => call_codex_cli_with_retry(prompt, workdir, policy),
        LlmProvider::Gemini => Err(LlmGatewayError::new(
            provider,
            "core.agent.llm.provider_not_implemented",
            "gemini provider is not implemented yet",
        )
        .with_suggestion("当前可使用 provider=codex；如需 Gemini，请补齐网关实现")),
        LlmProvider::Unknown => Err(LlmGatewayError::new(
            provider,
            "core.agent.llm.provider_unknown",
            "unknown llm provider",
        )
        .with_suggestion("请将 provider 设置为 codex 或 gemini")),
    }
}

/// 描述：通过工作流重试引擎执行 Codex CLI 调用。
fn call_codex_cli_with_retry(
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
) -> Result<String, LlmGatewayError> {
    let hook = DefaultWorkflowRecoveryHook;
    let run = run_step_with_retry("llm.codex_cli", policy.retry_policy, &hook, |attempt| {
        call_codex_cli_once(prompt, workdir, policy.timeout_secs, attempt)
    });

    run.outcome.map_err(|err| err.with_attempts(run.attempts))
}

/// 描述：执行单次 Codex CLI 调用，负责超时控制与结果读取。
fn call_codex_cli_once(
    prompt: &str,
    workdir: Option<&str>,
    timeout_secs: u64,
    attempt: u8,
) -> Result<String, LlmGatewayError> {
    let provider = LlmProvider::CodexCli;
    let output_file = build_output_file();
    let output_path = output_file.to_string_lossy().to_string();

    let mut command = Command::new("codex");
    command
        .arg("exec")
        .arg("--skip-git-repo-check")
        .arg("--sandbox")
        .arg("read-only")
        .arg("--output-last-message")
        .arg(&output_path)
        .arg(prompt)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cwd) = workdir.map(str::trim).filter(|value| !value.is_empty()) {
        command.current_dir(cwd);
    }

    let mut child = command.spawn().map_err(|err| {
        LlmGatewayError::new(
            provider,
            "core.agent.llm.codex_spawn_failed",
            format!("[{}] execute codex cli failed: {}", LLM_RUNTIME_TAG, err),
        )
        .with_suggestion("确认 codex CLI 已安装并在 PATH 中")
        .with_retryable(false)
        .with_attempts(attempt)
    })?;

    let timeout = Duration::from_secs(timeout_secs.max(1));
    let started = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(LlmGatewayError::new(
                        provider,
                        "core.agent.llm.timeout",
                        format!(
                            "[{}] codex cli timed out after {}s",
                            LLM_RUNTIME_TAG, timeout_secs
                        ),
                    )
                    .with_suggestion("缩短 prompt 或提高 ZODILEAP_LLM_TIMEOUT_SECS")
                    .with_retryable(true)
                    .with_attempts(attempt));
                }
                thread::sleep(Duration::from_millis(80));
            }
            Err(err) => {
                return Err(LlmGatewayError::new(
                    provider,
                    "core.agent.llm.wait_failed",
                    format!("[{}] wait codex cli failed: {}", LLM_RUNTIME_TAG, err),
                )
                .with_retryable(true)
                .with_attempts(attempt));
            }
        }
    }

    let output = child.wait_with_output().map_err(|err| {
        LlmGatewayError::new(
            provider,
            "core.agent.llm.output_read_failed",
            format!("[{}] read codex output failed: {}", LLM_RUNTIME_TAG, err),
        )
        .with_retryable(true)
        .with_attempts(attempt)
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let reason = if !stderr.trim().is_empty() {
            stderr
        } else if !stdout.trim().is_empty() {
            stdout
        } else {
            "unknown codex cli error".to_string()
        };
        return Err(LlmGatewayError::new(
            provider,
            "core.agent.llm.codex_failed",
            format!("[{}] codex cli failed: {}", LLM_RUNTIME_TAG, reason.trim()),
        )
        .with_suggestion("检查 codex CLI 登录态、模型可用性与本地权限")
        .with_retryable(true)
        .with_attempts(attempt));
    }

    let message = fs::read_to_string(&output_file).map_err(|err| {
        LlmGatewayError::new(
            provider,
            "core.agent.llm.result_read_failed",
            format!("read codex result failed: {}", err),
        )
        .with_retryable(true)
        .with_attempts(attempt)
    })?;
    let final_message = message.trim().to_string();
    if final_message.is_empty() {
        return Err(LlmGatewayError::new(
            provider,
            "core.agent.llm.empty_response",
            format!("[{}] codex cli returned empty response", LLM_RUNTIME_TAG),
        )
        .with_suggestion("检查 prompt 是否过短或模型输出是否被拦截")
        .with_retryable(false)
        .with_attempts(attempt));
    }
    Ok(final_message)
}

/// 描述：构建一次调用的临时输出文件路径。
fn build_output_file() -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    env::temp_dir().join(format!("zodileap-agent-codex-{}.txt", now))
}

#[cfg(test)]
#[path = "llm_tests.rs"]
mod tests;
