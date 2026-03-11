use crate::llm::{
    should_abort_for_output_idle, should_emit_waiting_progress, LlmGatewayError, LlmGatewayPolicy,
    LlmProgressObserver, LlmProvider, LlmRunResult, LlmTextStreamObserver, LlmUsage,
    LLM_RUNTIME_TAG,
};
use crate::platform::{resolve_codex_command_candidates, CommandCandidate};
use crate::workflow::{run_step_with_retry, DefaultWorkflowRecoveryHook};
use serde_json::Value;
use std::env;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Stdio};
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

#[derive(Debug, Default)]
struct CodexJsonlStreamParser {
    pending: String,
}

impl CodexJsonlStreamParser {
    /// 描述：向 JSONL 解析器写入增量文本，并提取当前已经完整闭合的 delta 文本事件。
    fn push_chunk(&mut self, chunk: &str) -> Vec<String> {
        self.pending.push_str(chunk);
        self.drain_complete_lines()
    }

    /// 描述：在子进程结束后冲刷残留缓冲，避免最后一条未换行 JSONL 事件丢失。
    fn finish(&mut self) -> Vec<String> {
        let tail = std::mem::take(&mut self.pending);
        let normalized = tail.trim();
        if normalized.is_empty() {
            return Vec::new();
        }
        extract_codex_json_delta_texts_from_line(normalized)
    }

    /// 描述：提取缓冲区中已经完整到达的 JSONL 行，只向上游回传真正的文本 delta。
    fn drain_complete_lines(&mut self) -> Vec<String> {
        let mut deltas: Vec<String> = Vec::new();
        while let Some(line_end) = self.pending.find('\n') {
            let line = self.pending[..line_end].trim().to_string();
            self.pending.drain(..=line_end);
            if line.is_empty() {
                continue;
            }
            deltas.extend(extract_codex_json_delta_texts_from_line(line.as_str()));
        }
        deltas
    }
}

/// 描述：通过工作流重试引擎执行 Codex CLI 调用。
pub fn call_with_retry(
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
    mut on_progress: Option<&mut LlmProgressObserver>,
) -> Result<LlmRunResult, LlmGatewayError> {
    let hook = DefaultWorkflowRecoveryHook;
    let run = run_step_with_retry("llm.codex_cli", policy.retry_policy, &hook, |attempt| {
        call_once(
            prompt,
            workdir,
            policy.timeout_secs,
            attempt,
            on_chunk.as_deref_mut(),
            on_progress.as_deref_mut(),
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
    mut on_progress: Option<&mut LlmProgressObserver>,
) -> Result<LlmRunResult, LlmGatewayError> {
    let provider = LlmProvider::CodexCli;
    let output_file = build_output_file();
    let output_path = output_file.to_string_lossy().to_string();
    let candidates = resolve_codex_command_candidates();
    let (mut child, selected_bin) = spawn_codex_process(
        prompt,
        workdir,
        output_path.as_str(),
        candidates.as_slice(),
        attempt,
    )?;

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
    let mut last_output_at = Instant::now();
    let mut stdout_text = String::new();
    let mut stdout_stream_text = String::new();
    let mut stderr_text = String::new();
    let mut stdout_jsonl_parser = CodexJsonlStreamParser::default();
    let mut last_progress_at: Option<Instant> = None;
    let mut has_received_stdout = false;
    let status = loop {
        match rx.recv_timeout(Duration::from_millis(40)) {
            Ok(chunk) => match chunk.stream {
                CodexOutputStreamKind::Stdout => {
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
                CodexOutputStreamKind::Stderr => {
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
                            "[{}] codex cli produced no output for {}s",
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
                    "Codex CLI 已启动，正在等待首个响应分片…",
                );
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
                for delta_text in stdout_jsonl_parser.push_chunk(chunk.text.as_str()) {
                    stdout_stream_text.push_str(delta_text.as_str());
                    if let Some(callback) = on_chunk.as_deref_mut() {
                        callback(delta_text.as_str());
                    }
                }
            }
            CodexOutputStreamKind::Stderr => {
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
            "unknown codex cli error".to_string()
        };
        return Err(
            build_codex_failed_error(reason.as_str(), selected_bin.as_str()).with_attempts(attempt),
        );
    }

    let message = fs::read_to_string(&output_file).unwrap_or_default();
    let final_message = if !message.trim().is_empty() {
        message.trim().to_string()
    } else {
        stdout_stream_text.trim().to_string()
    };
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

/// 描述：按候选列表尝试启动 Codex CLI，确保健康检查与真实运行复用同一套命令解析规则。
///
/// Params:
///
///   - prompt: 发送给 Codex 的提示词。
///   - workdir: 可选工作目录。
///   - output_path: `--output-last-message` 的文件落盘路径。
///   - candidates: 命令候选列表。
///   - attempt: 当前重试次数。
///
/// Returns:
///
///   - 0: 命中的子进程与候选展示文本。
fn spawn_codex_process(
    prompt: &str,
    workdir: Option<&str>,
    output_path: &str,
    candidates: &[CommandCandidate],
    attempt: u8,
) -> Result<(Child, String), LlmGatewayError> {
    let provider = LlmProvider::CodexCli;
    let mut spawn_errors: Vec<String> = Vec::new();
    for candidate in candidates {
        let mut command = candidate.build_command();
        command
            .arg("exec")
            .arg("--skip-git-repo-check")
            .arg("--sandbox")
            .arg("read-only")
            .arg("--json")
            .arg("--output-last-message")
            .arg(output_path)
            .arg(prompt)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(cwd) = workdir.map(str::trim).filter(|value| !value.is_empty()) {
            command.current_dir(cwd);
        }

        match command.spawn() {
            Ok(child) => return Ok((child, candidate.display())),
            Err(err) => spawn_errors.push(format!("{} => {}", candidate.display(), err)),
        }
    }

    let reason = if spawn_errors.is_empty() {
        "no codex binary candidates".to_string()
    } else {
        spawn_errors.join("; ")
    };
    Err(LlmGatewayError::new(
        provider,
        "core.agent.llm.codex_spawn_failed",
        format!("[{}] execute codex cli failed: {}", LLM_RUNTIME_TAG, reason),
    )
    .with_suggestion("确认 Codex CLI 已安装并可执行，或通过 ZODILEAP_CODEX_BIN 指定二进制路径")
    .with_retryable(false)
    .with_attempts(attempt))
}

/// 描述：在 CLI 尚未返回首个 stdout 分片时，按节流窗口向上层发送等待进度。
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

fn build_codex_failed_error(raw_reason: &str, bin: &str) -> LlmGatewayError {
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
    .with_suggestion(format!(
        "请检查 Codex CLI 登录态、模型可用性与本地权限（bin={}）；如路径不在 PATH 中，可设置 ZODILEAP_CODEX_BIN。",
        bin
    ))
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

/// 描述：从 Codex CLI 的 JSONL 事件中提取真正的文本 delta，忽略状态、诊断与最终整段消息回放。
fn extract_codex_json_delta_texts_from_line(line: &str) -> Vec<String> {
    let Ok(parsed) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    let mut deltas: Vec<String> = Vec::new();
    collect_codex_json_delta_texts(&parsed, false, &mut deltas);
    deltas
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect()
}

/// 描述：递归遍历 Codex JSON 事件，只在 delta 语义上下文中提取 text/content 字段，避免把完整消息重复推给前端。
fn collect_codex_json_delta_texts(value: &Value, delta_context: bool, output: &mut Vec<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_codex_json_delta_texts(item, delta_context, output);
            }
        }
        Value::Object(map) => {
            let type_text = map
                .get("type")
                .and_then(|value| value.as_str())
                .map(|value| value.to_lowercase())
                .unwrap_or_default();
            let object_delta_context = delta_context || type_text.contains("delta");
            for (key, child) in map {
                let key_lower = key.to_lowercase();
                let child_delta_context = object_delta_context || key_lower.contains("delta");
                match child {
                    Value::String(text) => {
                        if text.trim().is_empty() {
                            continue;
                        }
                        if key_lower.contains("delta")
                            || (child_delta_context
                                && matches!(
                                    key_lower.as_str(),
                                    "text" | "content" | "value" | "message"
                                ))
                        {
                            output.push(text.to_string());
                        }
                    }
                    _ => collect_codex_json_delta_texts(child, child_delta_context, output),
                }
            }
        }
        _ => {}
    }
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
        let error = build_codex_failed_error(raw, "codex");
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
        let error = build_codex_failed_error(raw, "codex");
        assert_eq!(error.code, "core.agent.llm.codex_failed");
        assert!(error
            .message
            .contains("request timeout while waiting gateway"));
        assert!(!error.message.contains("workdir:"));
        assert_eq!(error.retryable, true);
        assert!(error
            .suggestion
            .as_deref()
            .unwrap_or_default()
            .contains("bin=codex"));
    }

    #[test]
    fn should_report_idle_timeout_as_no_output() {
        let error = LlmGatewayError::new(
            LlmProvider::CodexCli,
            "core.agent.llm.timeout",
            format!("[{}] codex cli produced no output for {}s", LLM_RUNTIME_TAG, 300),
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
    fn should_extract_delta_field_from_codex_jsonl_line() {
        let deltas = extract_codex_json_delta_texts_from_line(
            r#"{"type":"response.output_text.delta","delta":"print('hello')"}"#,
        );
        assert_eq!(deltas, vec!["print('hello')".to_string()]);
    }

    #[test]
    fn should_extract_nested_delta_text_from_codex_jsonl_line() {
        let deltas = extract_codex_json_delta_texts_from_line(
            r#"{"type":"thread.item.delta","item":{"content":[{"type":"output_text_delta","text":"finish('ok')"}]}}"#,
        );
        assert_eq!(deltas, vec!["finish('ok')".to_string()]);
    }

    #[test]
    fn should_ignore_non_delta_codex_jsonl_line() {
        let deltas = extract_codex_json_delta_texts_from_line(
            r#"{"type":"thread.item.completed","item":{"content":[{"type":"output_text","text":"final"}]}}"#,
        );
        assert!(deltas.is_empty());
    }

    #[test]
    fn should_flush_partial_codex_jsonl_tail() {
        let mut parser = CodexJsonlStreamParser::default();
        let first = parser.push_chunk("{\"type\":\"response.output_text.delta\",\"delta\":\"hel");
        let second = parser.push_chunk("lo\"}\n");
        let tail = parser.finish();
        assert!(first.is_empty());
        assert_eq!(second, vec!["hello".to_string()]);
        assert!(tail.is_empty());
    }
}
