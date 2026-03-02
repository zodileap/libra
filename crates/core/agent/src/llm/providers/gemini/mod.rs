use crate::llm::{
    LlmGatewayError, LlmGatewayPolicy, LlmProvider, LlmTextStreamObserver, LLM_RUNTIME_TAG,
};
use crate::workflow::{run_step_with_retry, DefaultWorkflowRecoveryHook};
use std::env;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GeminiOutputStreamKind {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone)]
struct GeminiOutputChunk {
    stream: GeminiOutputStreamKind,
    text: String,
}

/// 描述：通过工作流重试引擎执行 Gemini CLI 调用。
///
/// Params:
///
///   - prompt: 最终传递给 Gemini 的提示词。
///   - workdir: 命令执行目录。
///   - policy: LLM 网关策略（超时与重试）。
///   - on_chunk: 可选的文本增量回调。
///
/// Returns:
///
///   - 成功时返回模型文本；失败时返回统一网关错误。
pub fn call_with_retry(
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
) -> Result<String, LlmGatewayError> {
    let bins = resolve_gemini_bins();
    call_with_retry_and_bins(
        prompt,
        workdir,
        policy,
        on_chunk.as_deref_mut(),
        bins.as_slice(),
    )
}

/// 描述：通过指定 Gemini 二进制列表执行调用，便于测试场景注入自定义 bin。
///
/// Params:
///
///   - prompt: 最终传递给 Gemini 的提示词。
///   - workdir: 命令执行目录。
///   - policy: LLM 网关策略（超时与重试）。
///   - on_chunk: 可选的文本增量回调。
///   - bins: Gemini CLI 候选二进制路径列表。
///
/// Returns:
///
///   - 成功时返回模型文本；失败时返回统一网关错误。
fn call_with_retry_and_bins(
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
    bins: &[String],
) -> Result<String, LlmGatewayError> {
    let hook = DefaultWorkflowRecoveryHook;
    let run = run_step_with_retry("llm.gemini_cli", policy.retry_policy, &hook, |attempt| {
        call_once(
            prompt,
            workdir,
            policy.timeout_secs,
            attempt,
            on_chunk.as_deref_mut(),
            bins,
        )
    });
    run.outcome.map_err(|err| err.with_attempts(run.attempts))
}

/// 描述：执行单次 Gemini CLI 调用，负责命令启动、超时控制与结果读取。
///
/// Params:
///
///   - prompt: 最终传递给 Gemini 的提示词。
///   - workdir: 命令执行目录。
///   - timeout_secs: 超时秒数。
///   - attempt: 当前尝试序号。
///   - on_chunk: 可选的文本增量回调。
///   - bins: Gemini CLI 候选二进制路径列表。
///
/// Returns:
///
///   - 成功时返回模型文本；失败时返回统一网关错误。
fn call_once(
    prompt: &str,
    workdir: Option<&str>,
    timeout_secs: u64,
    attempt: u8,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
    bins: &[String],
) -> Result<String, LlmGatewayError> {
    let provider = LlmProvider::Gemini;
    let (mut child, selected_bin) = spawn_gemini_process(prompt, workdir, bins, attempt)?;
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

    let (tx, rx) = mpsc::channel::<GeminiOutputChunk>();
    let stdout_reader =
        spawn_gemini_stream_reader(stdout, GeminiOutputStreamKind::Stdout, tx.clone());
    let stderr_reader = spawn_gemini_stream_reader(stderr, GeminiOutputStreamKind::Stderr, tx);

    let timeout = Duration::from_secs(timeout_secs.max(1));
    let started = Instant::now();
    let mut stdout_text = String::new();
    let mut stderr_text = String::new();
    let status = loop {
        match rx.recv_timeout(Duration::from_millis(40)) {
            Ok(chunk) => match chunk.stream {
                GeminiOutputStreamKind::Stdout => {
                    stdout_text.push_str(chunk.text.as_str());
                    if let Some(callback) = on_chunk.as_deref_mut() {
                        callback(chunk.text.as_str());
                    }
                }
                GeminiOutputStreamKind::Stderr => {
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
                            "[{}] gemini cli timed out after {}s",
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
                    format!("[{}] wait gemini cli failed: {}", LLM_RUNTIME_TAG, err),
                )
                .with_retryable(true)
                .with_attempts(attempt));
            }
        }
    };

    while let Ok(chunk) = rx.try_recv() {
        match chunk.stream {
            GeminiOutputStreamKind::Stdout => {
                stdout_text.push_str(chunk.text.as_str());
                if let Some(callback) = on_chunk.as_deref_mut() {
                    callback(chunk.text.as_str());
                }
            }
            GeminiOutputStreamKind::Stderr => {
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
            "unknown gemini cli error".to_string()
        };
        return Err(
            build_gemini_failed_error(reason.as_str(), selected_bin.as_str())
                .with_attempts(attempt),
        );
    }

    let final_message = stdout_text.trim().to_string();
    if final_message.is_empty() {
        return Err(LlmGatewayError::new(
            provider,
            "core.agent.llm.empty_response",
            format!("[{}] gemini cli returned empty response", LLM_RUNTIME_TAG),
        )
        .with_suggestion("检查 Gemini CLI 登录态、模型可用性与提示词是否有效")
        .with_retryable(false)
        .with_attempts(attempt));
    }
    Ok(final_message)
}

/// 描述：构建 Gemini CLI 命令参数，并把 prompt 放在末尾作为输入内容。
///
/// Params:
///
///   - command: 可变命令构造器。
///   - prompt: 最终传递给 Gemini 的提示词。
fn append_gemini_prompt_args(command: &mut Command, prompt: &str) {
    let args = env::var("ZODILEAP_GEMINI_ARGS")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "-p".to_string());
    for part in args.split_whitespace() {
        command.arg(part);
    }
    command.arg(prompt);
}

/// 描述：启动 Gemini CLI 子进程；如果首个 bin 不可用，会自动尝试下一个候选路径。
///
/// Params:
///
///   - prompt: 最终传递给 Gemini 的提示词。
///   - workdir: 命令执行目录。
///   - bins: Gemini CLI 候选二进制路径列表。
///   - attempt: 当前尝试序号。
///
/// Returns:
///
///   - 启动成功时返回子进程与命中的 bin 路径。
fn spawn_gemini_process(
    prompt: &str,
    workdir: Option<&str>,
    bins: &[String],
    attempt: u8,
) -> Result<(Child, String), LlmGatewayError> {
    let provider = LlmProvider::Gemini;
    let mut spawn_errors: Vec<String> = Vec::new();
    for bin in bins {
        let mut command = Command::new(bin.as_str());
        append_gemini_prompt_args(&mut command, prompt);
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(cwd) = workdir.map(str::trim).filter(|value| !value.is_empty()) {
            command.current_dir(cwd);
        }
        match command.spawn() {
            Ok(child) => return Ok((child, bin.clone())),
            Err(err) => spawn_errors.push(format!("{} => {}", bin, err)),
        }
    }

    let reason = if spawn_errors.is_empty() {
        "no gemini binary candidates".to_string()
    } else {
        spawn_errors.join("; ")
    };
    Err(LlmGatewayError::new(
        provider,
        "core.agent.llm.gemini_spawn_failed",
        format!(
            "[{}] execute gemini cli failed: {}",
            LLM_RUNTIME_TAG, reason
        ),
    )
    .with_suggestion("确认 Gemini CLI 已安装并可执行，或通过 ZODILEAP_GEMINI_BIN 指定二进制路径")
    .with_retryable(false)
    .with_attempts(attempt))
}

/// 描述：解析可用于执行 Gemini CLI 命令的候选二进制路径列表。
///
/// Returns:
///
///   - Gemini CLI 候选二进制路径。
fn resolve_gemini_bins() -> Vec<String> {
    let mut bins: Vec<String> = Vec::new();
    if let Ok(path) = env::var("ZODILEAP_GEMINI_BIN") {
        let path = path.trim().to_string();
        if !path.is_empty() {
            bins.push(path);
        }
    }
    bins.push("gemini".to_string());
    bins.push("/opt/homebrew/bin/gemini".to_string());
    if let Ok(home) = env::var("HOME") {
        bins.push(format!("{}/Library/pnpm/gemini", home.trim()));
    }
    bins
}

/// 描述：将 Gemini CLI 失败原因转换为用户友好的网关错误。
///
/// Params:
///
///   - raw_reason: Gemini 原始 stderr/stdout 文本。
///   - bin: 本次命中的 Gemini 二进制路径。
///
/// Returns:
///
///   - 归一化后的网关错误。
fn build_gemini_failed_error(raw_reason: &str, bin: &str) -> LlmGatewayError {
    let provider = LlmProvider::Gemini;
    let summary = extract_primary_error_line(raw_reason)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Gemini CLI 执行失败，请检查配置后重试。".to_string());
    LlmGatewayError::new(
        provider,
        "core.agent.llm.gemini_failed",
        format!("Gemini CLI 执行失败：{}", summary),
    )
    .with_suggestion(format!(
        "请检查 Gemini CLI 登录态与权限（bin={}）；如参数不兼容，可设置 ZODILEAP_GEMINI_ARGS。",
        bin
    ))
    .with_retryable(true)
}

/// 描述：从 Gemini 失败输出中提取首个可读错误行，避免把完整运行日志透传给用户。
///
/// Params:
///
///   - raw_reason: Gemini 原始 stderr/stdout 文本。
///
/// Returns:
///
///   - 优先返回 ERROR 行；若不存在则返回第一条非诊断行。
fn extract_primary_error_line(raw_reason: &str) -> Option<String> {
    for line in raw_reason.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();
        if lower.starts_with("error:") {
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

/// 描述：判断当前行是否属于 CLI 元信息行，避免作为用户错误文案返回。
///
/// Params:
///
///   - line: 待判断的单行文本。
///
/// Returns:
///
///   - true 表示该行属于诊断元信息。
fn is_diagnostic_line(line: &str) -> bool {
    let normalized = line.trim().to_lowercase();
    normalized == "--------"
        || normalized.starts_with("model:")
        || normalized.starts_with("provider:")
        || normalized.starts_with("session id:")
}

/// 描述：启动 Gemini 输出流读取线程，并把文本分片发送给主线程聚合处理。
///
/// Params:
///
///   - reader: 标准输出或标准错误读取器。
///   - stream: 输出流类型。
///   - tx: 分片发送通道。
///
/// Returns:
///
///   - 读取线程句柄。
fn spawn_gemini_stream_reader<R>(
    mut reader: R,
    stream: GeminiOutputStreamKind,
    tx: mpsc::Sender<GeminiOutputChunk>,
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
                    if tx.send(GeminiOutputChunk { stream, text }).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 描述：验证 Gemini 失败文案会提取首个错误行，避免透传全部上下文。
    #[test]
    fn should_extract_primary_error_line_for_gemini_failure() {
        let raw = r#"model: gemini-2.5-pro
session id: abc
ERROR: invalid api key
stacktrace: omitted"#;
        let error = build_gemini_failed_error(raw, "gemini");
        assert_eq!(error.code, "core.agent.llm.gemini_failed");
        assert!(error.message.contains("invalid api key"));
        assert!(!error.message.contains("session id:"));
    }

    /// 描述：验证指定不存在的 bin 时会返回可识别的启动失败错误码。
    #[test]
    fn should_fail_when_gemini_bin_is_missing() {
        let bins = vec!["/path/to/missing-gemini-bin".to_string()];
        let result = call_with_retry_and_bins(
            "hello",
            None,
            LlmGatewayPolicy {
                timeout_secs: 1,
                retry_policy: crate::workflow::WorkflowRetryPolicy {
                    max_retries: 0,
                    backoff_millis: 0,
                },
            },
            None,
            bins.as_slice(),
        );
        assert!(result.is_err());
        let err = result.err().expect("must have error");
        assert_eq!(err.code, "core.agent.llm.gemini_spawn_failed");
        assert!(!err.retryable);
    }
}
