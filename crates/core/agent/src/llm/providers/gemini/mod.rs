use crate::llm::{
    should_abort_for_output_idle, should_emit_waiting_progress, LlmGatewayError, LlmGatewayPolicy,
    LlmProgressObserver, LlmProvider, LlmProviderConfig, LlmRunResult, LlmTextStreamObserver,
    LlmUsage, LLM_RUNTIME_TAG,
};
use crate::platform::{resolve_gemini_command_candidates, CommandCandidate};
use crate::workflow::{run_step_with_retry, DefaultWorkflowRecoveryHook};
use serde_json::Value;
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

#[derive(Debug, Default)]
struct GeminiJsonlStreamParser {
    pending: String,
    saw_structured_event: bool,
}

impl GeminiJsonlStreamParser {
    /// 描述：向 Gemini JSONL 解析器写入增量文本，并提取当前已经完整闭合的 assistant 文本分片。
    fn push_chunk(&mut self, chunk: &str) -> Vec<String> {
        self.pending.push_str(chunk);
        self.drain_complete_lines()
    }

    /// 描述：在子进程结束后冲刷残留缓冲，避免最后一条未换行的 JSONL 事件丢失。
    fn finish(&mut self) -> Vec<String> {
        let tail = std::mem::take(&mut self.pending);
        let normalized = tail.trim();
        if normalized.is_empty() {
            return Vec::new();
        }
        let (deltas, saw_structured_event) = extract_gemini_json_delta_texts_from_line(normalized);
        if saw_structured_event {
            self.saw_structured_event = true;
        }
        deltas
    }

    /// 描述：提取缓冲区中已经完整到达的 JSONL 行，只向上游回传真正的 assistant 文本增量。
    fn drain_complete_lines(&mut self) -> Vec<String> {
        let mut deltas: Vec<String> = Vec::new();
        while let Some(line_end) = self.pending.find('\n') {
            let line = self.pending[..line_end].trim().to_string();
            self.pending.drain(..=line_end);
            if line.is_empty() {
                continue;
            }
            let (line_deltas, saw_structured_event) =
                extract_gemini_json_delta_texts_from_line(line.as_str());
            if saw_structured_event {
                self.saw_structured_event = true;
            }
            deltas.extend(line_deltas);
        }
        deltas
    }
}

/// 描述：通过工作流重试引擎执行 Gemini CLI 调用。
pub fn call_with_retry(
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
    provider_config: Option<&LlmProviderConfig>,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
    mut on_progress: Option<&mut LlmProgressObserver>,
) -> Result<LlmRunResult, LlmGatewayError> {
    let bins = resolve_gemini_command_candidates();
    call_with_retry_and_bins(
        prompt,
        workdir,
        policy,
        provider_config,
        #[allow(clippy::needless_option_as_deref)]
        on_chunk.as_deref_mut(),
        #[allow(clippy::needless_option_as_deref)]
        on_progress.as_deref_mut(),
        bins.as_slice(),
    )
}

pub(crate) fn call_with_retry_and_bins(
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
    provider_config: Option<&LlmProviderConfig>,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
    mut on_progress: Option<&mut LlmProgressObserver>,
    bins: &[CommandCandidate],
) -> Result<LlmRunResult, LlmGatewayError> {
    let hook = DefaultWorkflowRecoveryHook;
    let run = run_step_with_retry("llm.gemini_cli", policy.retry_policy, &hook, |attempt| {
        call_once(
            prompt,
            workdir,
            policy.timeout_secs,
            attempt,
            provider_config,
            #[allow(clippy::needless_option_as_deref)]
            on_chunk.as_deref_mut(),
            #[allow(clippy::needless_option_as_deref)]
            on_progress.as_deref_mut(),
            bins,
        )
    });
    run.outcome.map_err(|err| err.with_attempts(run.attempts))
}

fn call_once(
    prompt: &str,
    workdir: Option<&str>,
    timeout_secs: u64,
    attempt: u8,
    provider_config: Option<&LlmProviderConfig>,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
    mut on_progress: Option<&mut LlmProgressObserver>,
    bins: &[CommandCandidate],
) -> Result<LlmRunResult, LlmGatewayError> {
    let provider = LlmProvider::Gemini;
    let (mut child, selected_bin) =
        spawn_gemini_process(prompt, workdir, provider_config, bins, attempt)?;
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
    let mut last_output_at = Instant::now();
    let mut stdout_text = String::new();
    let mut stdout_stream_text = String::new();
    let mut stderr_text = String::new();
    let mut stdout_jsonl_parser = GeminiJsonlStreamParser::default();
    let mut last_progress_at: Option<Instant> = None;
    let mut has_received_stdout = false;
    let status = loop {
        match rx.recv_timeout(Duration::from_millis(40)) {
            Ok(chunk) => match chunk.stream {
                GeminiOutputStreamKind::Stdout => {
                    last_output_at = Instant::now();
                    has_received_stdout = true;
                    stdout_text.push_str(chunk.text.as_str());
                    for delta_text in stdout_jsonl_parser.push_chunk(chunk.text.as_str()) {
                        stdout_stream_text.push_str(delta_text.as_str());
                        if let Some(callback) = on_chunk.as_deref_mut() {
                            callback(delta_text.as_str());
                        }
                    }
                }
                GeminiOutputStreamKind::Stderr => {
                    last_output_at = Instant::now();
                    stderr_text.push_str(chunk.text.as_str());
                }
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                let now = Instant::now();
                if should_abort_for_output_idle(last_output_at, now, timeout) {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(LlmGatewayError::new(
                        provider,
                        "core.agent.llm.timeout",
                        format!(
                            "[{}] gemini cli produced no output for {}s",
                            LLM_RUNTIME_TAG, timeout_secs
                        ),
                    )
                    .with_suggestion(
                        "确认模型仍在持续输出，或提高 ZODILEAP_LLM_TIMEOUT_SECS（当前按无输出空闲时长判定超时）",
                    )
                    .with_retryable(true)
                    .with_attempts(attempt));
                }
                maybe_emit_waiting_progress(
                    on_progress.as_deref_mut(),
                    &mut last_progress_at,
                    has_received_stdout,
                    "Gemini CLI 已启动，正在等待首个响应分片…",
                );
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
                for delta_text in stdout_jsonl_parser.push_chunk(chunk.text.as_str()) {
                    stdout_stream_text.push_str(delta_text.as_str());
                    if let Some(callback) = on_chunk.as_deref_mut() {
                        callback(delta_text.as_str());
                    }
                }
            }
            GeminiOutputStreamKind::Stderr => {
                stderr_text.push_str(chunk.text.as_str());
            }
        }
    }
    for delta_text in stdout_jsonl_parser.finish() {
        stdout_stream_text.push_str(delta_text.as_str());
        if let Some(callback) = on_chunk.as_deref_mut() {
            callback(delta_text.as_str());
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

    let trimmed_stdout = stdout_text.trim();
    let final_message = if !stdout_stream_text.trim().is_empty() {
        stdout_stream_text.trim().to_string()
    } else if !stdout_jsonl_parser.saw_structured_event && !trimmed_stdout.is_empty() {
        trimmed_stdout.to_string()
    } else {
        String::new()
    };
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

    // 默认估算消耗，后续可解析 stderr 中的特定输出
    let usage = LlmUsage::estimate(prompt, final_message.as_str());

    Ok(LlmRunResult {
        content: final_message,
        usage,
    })
}

/// 描述：在 Gemini CLI 尚未返回首个 stdout 分片时，按节流窗口向上层发送等待进度。
///
/// Params:
///
///   - on_progress: 等待进度回调。
///   - last_progress_at: 最近一次发送等待进度的时间。
///   - has_received_stdout: 是否已经收到首个 stdout 分片。
///   - message: 本次要发送的进度文案。
fn maybe_emit_waiting_progress(
    mut on_progress: Option<&mut LlmProgressObserver>,
    last_progress_at: &mut Option<Instant>,
    has_received_stdout: bool,
    message: &str,
) {
    if has_received_stdout {
        return;
    }
    let Some(callback) = on_progress.as_deref_mut() else {
        return;
    };
    let now = Instant::now();
    if should_emit_waiting_progress(*last_progress_at, now) {
        callback(message);
        *last_progress_at = Some(now);
    }
}

fn append_gemini_prompt_args(command: &mut Command, prompt: &str) {
    let args = env::var("ZODILEAP_GEMINI_ARGS")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "-p".to_string());
    let parts: Vec<&str> = args.split_whitespace().collect();
    if !parts
        .iter()
        .any(|part| *part == "--output-format" || part.starts_with("--output-format="))
    {
        command.arg("--output-format").arg("stream-json");
    }
    for part in parts {
        command.arg(part);
    }
    command.arg(prompt);
}

/// 描述：为 Gemini CLI 注入 Provider 运行时配置，支持 API Key 鉴权与模型透传。
///
/// Params:
///
///   - command: 待启动的 Gemini CLI 命令。
///   - provider_config: Provider 运行时配置。
fn apply_gemini_provider_config(
    command: &mut Command,
    provider_config: Option<&LlmProviderConfig>,
) {
    if let Some(api_key) = provider_config
        .and_then(|config| config.api_key.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.env("GEMINI_API_KEY", api_key);
    }
    if let Some(model) = provider_config
        .and_then(|config| config.model.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("-m").arg(model);
    }
}

fn spawn_gemini_process(
    prompt: &str,
    workdir: Option<&str>,
    provider_config: Option<&LlmProviderConfig>,
    bins: &[CommandCandidate],
    attempt: u8,
) -> Result<(Child, String), LlmGatewayError> {
    let provider = LlmProvider::Gemini;
    let mut spawn_errors: Vec<String> = Vec::new();
    for bin in bins {
        let mut command = bin.build_command();
        apply_gemini_provider_config(&mut command, provider_config);
        append_gemini_prompt_args(&mut command, prompt);
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(cwd) = workdir.map(str::trim).filter(|value| !value.is_empty()) {
            command.current_dir(cwd);
        }
        match command.spawn() {
            Ok(child) => return Ok((child, bin.display())),
            Err(err) => spawn_errors.push(format!("{} => {}", bin.display(), err)),
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

fn is_diagnostic_line(line: &str) -> bool {
    let normalized = line.trim().to_lowercase();
    normalized == "--------"
        || normalized.starts_with("model:")
        || normalized.starts_with("provider:")
        || normalized.starts_with("session id:")
}

/// 描述：从 Gemini `stream-json` 事件中提取真正的 assistant 文本增量，忽略 init、tool 与 result 等事件。
///
/// Returns:
///
///   - 0: 当前 JSONL 行中的 assistant 文本增量列表。
///   - 1: 当前行是否已经成功解析为结构化 JSON 事件。
fn extract_gemini_json_delta_texts_from_line(line: &str) -> (Vec<String>, bool) {
    let Ok(parsed) = serde_json::from_str::<Value>(line) else {
        return (Vec::new(), false);
    };
    let Some(object) = parsed.as_object() else {
        return (Vec::new(), true);
    };
    let event_type = object
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let role = object
        .get("role")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let content = object
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if event_type == "message" && role == "assistant" && !content.trim().is_empty() {
        return (vec![content.to_string()], true);
    }
    (Vec::new(), true)
}

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

    #[test]
    fn should_fail_when_gemini_bin_is_missing() {
        let bins = vec![CommandCandidate::new(
            "/path/to/missing-gemini-bin".to_string(),
        )];
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
            None,
            None,
            bins.as_slice(),
        );
        assert!(result.is_err());
        let err = result.err().expect("must have error");
        assert_eq!(err.code, "core.agent.llm.gemini_spawn_failed");
        assert!(!err.retryable);
    }

    #[test]
    fn should_report_gemini_idle_timeout_as_no_output() {
        let error = LlmGatewayError::new(
            LlmProvider::Gemini,
            "core.agent.llm.timeout",
            format!("[{}] gemini cli produced no output for {}s", LLM_RUNTIME_TAG, 300),
        )
        .with_suggestion(
            "确认模型仍在持续输出，或提高 ZODILEAP_LLM_TIMEOUT_SECS（当前按无输出空闲时长判定超时）",
        )
        .with_retryable(true);
        assert!(error.message.contains("produced no output for 300s"));
        assert!(error
            .suggestion
            .as_deref()
            .unwrap_or_default()
            .contains("无输出空闲时长"));
    }

    #[test]
    fn should_extract_assistant_delta_from_gemini_stream_json_line() {
        let line = r#"{"type":"message","timestamp":"2026-03-11T00:00:00Z","role":"assistant","content":"hello","delta":true}"#;
        let (deltas, saw_structured_event) = extract_gemini_json_delta_texts_from_line(line);
        assert!(saw_structured_event);
        assert_eq!(deltas, vec!["hello".to_string()]);
    }

    #[test]
    fn should_apply_provider_config_to_gemini_command() {
        let mut command = Command::new("gemini");
        let provider_config = LlmProviderConfig {
            api_key: Some("demo-key".to_string()),
            model: Some("gemini-2.5-pro".to_string()),
            mode: None,
        };
        apply_gemini_provider_config(&mut command, Some(&provider_config));
        let debug_args = format!("{:?}", command);
        let debug_envs = format!("{:?}", command.get_envs().collect::<Vec<_>>());
        assert!(debug_args.contains("-m"));
        assert!(debug_args.contains("gemini-2.5-pro"));
        assert!(debug_envs.contains("GEMINI_API_KEY"));
        assert!(debug_envs.contains("demo-key"));
    }

    #[test]
    fn should_ignore_non_message_gemini_stream_json_line() {
        let line = r#"{"type":"tool_result","timestamp":"2026-03-11T00:00:00Z","tool_id":"tool-1","status":"success"}"#;
        let (deltas, saw_structured_event) = extract_gemini_json_delta_texts_from_line(line);
        assert!(saw_structured_event);
        assert!(deltas.is_empty());
    }

    #[test]
    fn should_flush_partial_gemini_jsonl_tail() {
        let mut parser = GeminiJsonlStreamParser::default();
        let deltas = parser.push_chunk(
            "{\"type\":\"message\",\"timestamp\":\"2026-03-11T00:00:00Z\",\"role\":\"assistant\",\"content\":\"hello\"",
        );
        assert!(deltas.is_empty());
        let deltas = parser.push_chunk("}\n");
        assert_eq!(deltas, vec!["hello".to_string()]);
        assert!(parser.saw_structured_event);
    }
}
