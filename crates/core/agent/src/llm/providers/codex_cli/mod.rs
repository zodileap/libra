use crate::llm::{
    LlmGatewayError, LlmGatewayPolicy, LlmProvider, LlmRunResult, LlmTextStreamObserver, LlmUsage,
    LLM_RUNTIME_TAG,
};
use crate::workflow::{run_step_with_retry, DefaultWorkflowRecoveryHook};
use std::env;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexOutputStreamKind {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone)]
struct CodexOutputChunk {
    stream: CodexOutputStreamKind,
    text: String,
}

/// 描述：通过工作流重试引擎执行 Codex CLI 调用。
pub fn call_with_retry(
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
) -> Result<LlmRunResult, LlmGatewayError> {
    let hook = DefaultWorkflowRecoveryHook;
    let run = run_step_with_retry("llm.codex_cli", policy.retry_policy, &hook, |attempt| {
        call_once(
            prompt,
            workdir,
            policy.timeout_secs,
            attempt,
            on_chunk.as_deref_mut(),
        )
    });
    run.outcome.map_err(|err| err.with_attempts(run.attempts))
}

fn call_once(
    prompt: &str,
    workdir: Option<&str>,
    timeout_secs: u64,
    attempt: u8,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
) -> Result<LlmRunResult, LlmGatewayError> {
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

    let stdout = child.stdout.take().ok_or_else(|| {
        LlmGatewayError::new(
            provider,
            "core.agent.llm.stdout_pipe_missing",
            format!("[{}] stdout pipe is not available", LLM_RUNTIME_TAG),
        )
        .with_retryable(true)
        .with_attempts(attempt)
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        LlmGatewayError::new(
            provider,
            "core.agent.llm.stderr_pipe_missing",
            format!("[{}] stderr pipe is not available", LLM_RUNTIME_TAG),
        )
        .with_retryable(true)
        .with_attempts(attempt)
    })?;
    let (tx, rx) = mpsc::channel::<CodexOutputChunk>();
    let stdout_reader =
        spawn_codex_stream_reader(stdout, CodexOutputStreamKind::Stdout, tx.clone());
    let stderr_reader = spawn_codex_stream_reader(stderr, CodexOutputStreamKind::Stderr, tx);

    let timeout = Duration::from_secs(timeout_secs.max(1));
    let started = Instant::now();
    let mut stdout_text = String::new();
    let mut stderr_text = String::new();
    let status = loop {
        match rx.recv_timeout(Duration::from_millis(40)) {
            Ok(chunk) => match chunk.stream {
                CodexOutputStreamKind::Stdout => {
                    stdout_text.push_str(chunk.text.as_str());
                    if let Some(callback) = on_chunk.as_deref_mut() {
                        callback(chunk.text.as_str());
                    }
                }
                CodexOutputStreamKind::Stderr => {
                    stderr_text.push_str(chunk.text.as_str());
                }
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
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
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(LlmGatewayError::new(
                    provider,
                    "core.agent.llm.wait_failed",
                    format!("[{}] wait codex cli failed: {}", LLM_RUNTIME_TAG, err),
                )
                .with_retryable(true)
                .with_attempts(attempt));
            }
        }
    };

    while let Ok(chunk) = rx.try_recv() {
        match chunk.stream {
            CodexOutputStreamKind::Stdout => {
                stdout_text.push_str(chunk.text.as_str());
                if let Some(callback) = on_chunk.as_deref_mut() {
                    callback(chunk.text.as_str());
                }
            }
            CodexOutputStreamKind::Stderr => {
                stderr_text.push_str(chunk.text.as_str());
            }
        }
    }
    let _ = stdout_reader.join();
    let _ = stderr_reader.join();

    if !status.success() {
        let reason = if !stderr_text.trim().is_empty() {
            stderr_text
        } else if !stdout_text.trim().is_empty() {
            stdout_text
        } else {
            "unknown codex cli error".to_string()
        };
        return Err(build_codex_failed_error(reason.as_str()).with_attempts(attempt));
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

    let usage = LlmUsage::estimate(prompt, final_message.as_str());

    Ok(LlmRunResult {
        content: final_message,
        usage,
    })
}

fn build_codex_failed_error(raw_reason: &str) -> LlmGatewayError {
    let provider = LlmProvider::CodexCli;
    if is_usage_limit_error(raw_reason) {
        let suggestion = extract_retry_at(raw_reason)
            .map(|retry_at| format!("请在 {} 后重试，或升级 Pro / 购买更多 credits。", retry_at))
            .unwrap_or_else(|| "请升级 Pro / 购买更多 credits，或稍后重试。".to_string());
        return LlmGatewayError::new(
            provider,
            "core.agent.llm.codex_usage_limit",
            "Codex CLI 当前额度已用尽，请稍后重试。",
        )
        .with_suggestion(suggestion)
        .with_retryable(false);
    }

    let summary = extract_primary_error_line(raw_reason)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Codex CLI 执行失败，请检查配置后重试。".to_string());
    LlmGatewayError::new(
        provider,
        "core.agent.llm.codex_failed",
        format!("Codex CLI 执行失败：{}", summary),
    )
    .with_suggestion("请检查 Codex CLI 登录态、模型可用性与本地权限后重试。")
    .with_retryable(true)
}

fn is_usage_limit_error(raw_reason: &str) -> bool {
    let normalized = raw_reason.to_lowercase();
    normalized.contains("hit your usage limit")
        || normalized.contains("purchase more credits")
        || normalized.contains("/codex/settings/usage")
}

fn extract_retry_at(raw_reason: &str) -> Option<String> {
    let normalized = raw_reason.to_lowercase();
    let marker = "try again at ";
    let marker_index = normalized.find(marker)?;
    let raw_slice = raw_reason.get(marker_index + marker.len()..)?;
    let end_index = raw_slice
        .find('\n')
        .or_else(|| raw_slice.find('.'))
        .unwrap_or(raw_slice.len());
    let candidate = raw_slice.get(..end_index)?.trim();
    if candidate.is_empty() {
        return None;
    }
    Some(candidate.to_string())
}

fn extract_primary_error_line(raw_reason: &str) -> Option<String> {
    for line in raw_reason.lines() {
        let trimmed = line.trim();
        if trimmed.to_lowercase().starts_with("error:") {
            let (_, message) = trimmed.split_once(':').unwrap_or(("ERROR", trimmed));
            return Some(message.trim().to_string());
        }
    }

    for line in raw_reason.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || is_diagnostic_line(trimmed) {
            continue;
        }
        return Some(trimmed.to_string());
    }
    None
}

fn is_diagnostic_line(line: &str) -> bool {
    let normalized = line.trim().to_lowercase();
    normalized == "--------"
        || normalized.starts_with("openai codex")
        || normalized.starts_with("workdir:")
        || normalized.starts_with("model:")
        || normalized.starts_with("provider:")
        || normalized.starts_with("approval:")
        || normalized.starts_with("sandbox:")
        || normalized.starts_with("reasoning effort:")
        || normalized.starts_with("reasoning summaries:")
        || normalized.starts_with("session id:")
        || normalized.starts_with("mcp:")
        || normalized.starts_with("mcp startup:")
        || normalized.starts_with("warning: no last agent message")
}

fn spawn_codex_stream_reader<R>(
    mut reader: R,
    stream: CodexOutputStreamKind,
    tx: mpsc::Sender<CodexOutputChunk>,
) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let text = String::from_utf8_lossy(&buffer[..size]).to_string();
                    if tx.send(CodexOutputChunk { stream, text }).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    })
}

fn build_output_file() -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    env::temp_dir().join(format!("libra-agent-codex-{}.txt", now))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_map_usage_limit_error_to_friendly_message() {
        let raw = r#"ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Feb 27th, 2026 11:03 AM.
Warning: no last agent message; wrote empty content to /tmp/libra-agent-codex-1.txt"#;
        let error = build_codex_failed_error(raw);
        assert_eq!(error.code, "core.agent.llm.codex_usage_limit");
        assert_eq!(error.message, "Codex CLI 当前额度已用尽，请稍后重试。");
        assert_eq!(error.retryable, false);
        assert!(error
            .suggestion
            .as_deref()
            .unwrap_or_default()
            .contains("Feb 27th, 2026 11:03 AM"));
    }

    #[test]
    fn should_use_primary_error_line_for_generic_failure() {
        let raw = r#"OpenAI Codex v0.104.0
--------
workdir: /Users/yoho/code/libra/apps/desktop/src-tauri
model: gpt-5.3-codex
ERROR: request timeout while waiting gateway
Warning: no last agent message"#;
        let error = build_codex_failed_error(raw);
        assert_eq!(error.code, "core.agent.llm.codex_failed");
        assert!(error
            .message
            .contains("request timeout while waiting gateway"));
        assert!(!error.message.contains("workdir:"));
        assert_eq!(error.retryable, true);
    }
}
