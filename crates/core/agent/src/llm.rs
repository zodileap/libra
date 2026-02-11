use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const LLM_RUNTIME_TAG: &str = "llm-v2-no-a";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlmProvider {
    CodexCli,
    Gemini,
    Unknown,
}

pub fn parse_provider(raw: &str) -> LlmProvider {
    match raw.trim().to_lowercase().as_str() {
        "codex" | "codex-cli" => LlmProvider::CodexCli,
        "gemini" => LlmProvider::Gemini,
        _ => LlmProvider::Unknown,
    }
}

pub fn call_model(
    provider: LlmProvider,
    prompt: &str,
    workdir: Option<&str>,
) -> Result<String, String> {
    match provider {
        LlmProvider::CodexCli | LlmProvider::Unknown => call_codex_cli(prompt, workdir),
        LlmProvider::Gemini => Err("gemini provider is not implemented yet".to_string()),
    }
}

fn call_codex_cli(prompt: &str, workdir: Option<&str>) -> Result<String, String> {
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
        .arg(prompt);

    if let Some(cwd) = workdir.map(str::trim).filter(|value| !value.is_empty()) {
        command.current_dir(cwd);
    }

    let output = command
        .output()
        .map_err(|err| format!("[{}] execute codex cli failed: {}", LLM_RUNTIME_TAG, err))?;

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
        return Err(format!(
            "[{}] codex cli failed: {}",
            LLM_RUNTIME_TAG,
            reason.trim()
        ));
    }

    let message = fs::read_to_string(&output_file)
        .map_err(|err| format!("read codex result failed: {}", err))?;
    let final_message = message.trim().to_string();
    if final_message.is_empty() {
        return Err(format!("[{}] codex cli returned empty response", LLM_RUNTIME_TAG));
    }
    Ok(final_message)
}

fn build_output_file() -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    env::temp_dir().join(format!("zodileap-agent-codex-{}.txt", now))
}
