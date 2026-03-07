use serde_json::Value;
use std::env;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use libra_mcp_common::ProtocolError;

/// 描述：读取必填字符串参数，缺失或类型不符时返回统一协议错误。
pub fn get_required_string(args: &Value, key: &str, code: &str) -> Result<String, ProtocolError> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| ProtocolError::new(code, format!("缺少参数: {}", key)))
}

/// 描述：读取必填原始字符串参数，保留首尾空白与换行，适用于文件内容和补丁内容。
pub fn get_required_raw_string(
    args: &Value,
    key: &str,
    code: &str,
) -> Result<String, ProtocolError> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| ProtocolError::new(code, format!("缺少参数: {}", key)))
}

/// 描述：读取布尔参数，支持 bool 与字符串表达，缺省回退到默认值。
pub fn parse_bool_arg(args: &Value, key: &str, default_value: bool) -> Result<bool, ProtocolError> {
    let raw = match args.get(key) {
        Some(value) => value,
        None => return Ok(default_value),
    };
    if let Some(value) = raw.as_bool() {
        return Ok(value);
    }
    if let Some(text) = raw.as_str().map(|value| value.trim().to_lowercase()) {
        if matches!(text.as_str(), "1" | "true" | "yes" | "on") {
            return Ok(true);
        }
        if matches!(text.as_str(), "0" | "false" | "no" | "off") {
            return Ok(false);
        }
    }
    Err(ProtocolError::new(
        "core.agent.python.arg_invalid",
        format!("参数 {} 必须是布尔值", key),
    ))
}

/// 描述：读取正整数参数并限定上界，避免工具调用传入异常大值导致资源风险。
pub fn parse_positive_usize_arg(
    args: &Value,
    key: &str,
    default_value: usize,
    max_value: usize,
) -> Result<usize, ProtocolError> {
    let value = args
        .get(key)
        .and_then(|raw| {
            raw.as_u64().or_else(|| {
                raw.as_str()
                    .and_then(|text| text.trim().parse::<u64>().ok())
            })
        })
        .map(|raw| raw as usize)
        .unwrap_or(default_value);
    if value == 0 {
        return Err(ProtocolError::new(
            "core.agent.python.arg_invalid",
            format!("参数 {} 必须大于 0", key),
        ));
    }
    Ok(value.min(max_value))
}

/// 描述：解析可执行文件路径，优先环境变量，再尝试命令名。
pub fn resolve_executable_binary(bin: &str, probe_arg: &str) -> Option<String> {
    let env_key = format!("ZODILEAP_{}_BIN", bin.to_uppercase());
    let mut candidates: Vec<String> = Vec::new();
    if let Some(from_env) = env::var(env_key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        candidates.push(from_env);
    }
    candidates.push(bin.to_string());
    for candidate in candidates {
        let output = Command::new(candidate.as_str()).arg(probe_arg).output();
        if output
            .as_ref()
            .map(|result| result.status.success())
            .unwrap_or(false)
        {
            return Some(candidate);
        }
    }
    None
}

/// 描述：规范化路径并限制在沙盒根目录，防止通过 `..` 访问外部路径。
pub fn resolve_sandbox_path(sandbox_root: &Path, raw_path: &str) -> Result<PathBuf, ProtocolError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(ProtocolError::new(
            "core.agent.python.path_empty",
            "路径不能为空",
        ));
    }

    let root_normalized = normalize_lexical_path(sandbox_root);
    let candidate = PathBuf::from(trimmed);
    let joined = if candidate.is_absolute() {
        candidate
    } else {
        root_normalized.join(candidate)
    };
    let normalized = normalize_lexical_path(&joined);

    if !normalized.starts_with(&root_normalized) {
        return Err(ProtocolError::new(
            "core.agent.python.path_outside_sandbox",
            format!("路径越界: {}", normalized.to_string_lossy()),
        ));
    }
    Ok(normalized)
}

/// 描述：执行词法级路径规范化，移除 `.` 与 `..`，避免沙盒路径校验被绕过。
pub fn normalize_lexical_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                let _ = normalized.pop();
            }
            Component::Normal(value) => normalized.push(value),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
        }
    }
    normalized
}

#[derive(Debug)]
pub struct CommandExecutionOutput {
    pub status_code: Option<i32>,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub elapsed_ms: u128,
}

/// 描述：以超时控制方式执行命令并捕获 stdout/stderr，避免工具调用被长任务阻塞。
pub fn execute_command_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<CommandExecutionOutput, ProtocolError> {
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    let started = Instant::now();
    let mut child = command.spawn().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.command.spawn_failed",
            format!("启动命令失败: {}", err),
        )
    })?;

    let stdout_reader = child.stdout.take();
    let stderr_reader = child.stderr.take();
    let stdout_handle = thread::spawn(move || -> Vec<u8> {
        let mut buffer: Vec<u8> = Vec::new();
        if let Some(mut reader) = stdout_reader {
            let _ = reader.read_to_end(&mut buffer);
        }
        buffer
    });
    let stderr_handle = thread::spawn(move || -> Vec<u8> {
        let mut buffer: Vec<u8> = Vec::new();
        if let Some(mut reader) = stderr_reader {
            let _ = reader.read_to_end(&mut buffer);
        }
        buffer
    });

    let mut timed_out = false;
    let exit_status = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                break Some(status);
            }
            Ok(None) => {
                if started.elapsed() >= timeout {
                    // 强化强杀逻辑：不仅 kill 自身，还要在以后支持进程组中断。
                    let _ = child.kill();
                    let waited = child.wait().ok();
                    timed_out = true;
                    break waited;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                return Err(ProtocolError::new(
                    "core.agent.python.command.wait_failed",
                    format!("等待命令结束失败: {}", err),
                ));
            }
        }
    };

    let stdout_raw = stdout_handle.join().unwrap_or_default();
    let stderr_raw = stderr_handle.join().unwrap_or_default();
    let status_code = exit_status.and_then(|status| status.code());
    let success = !timed_out && exit_status.map(|status| status.success()).unwrap_or(false);
    Ok(CommandExecutionOutput {
        status_code,
        success,
        stdout: String::from_utf8_lossy(stdout_raw.as_slice()).to_string(),
        stderr: String::from_utf8_lossy(stderr_raw.as_slice()).to_string(),
        timed_out,
        elapsed_ms: started.elapsed().as_millis(),
    })
}

/// 描述：构建带有特定前缀的时间戳临时目录路径。
pub fn build_temp_dir(prefix: &str) -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    env::temp_dir().join(format!("{}-{}", prefix, millis))
}

/// 描述：对文本中的敏感信息（如 API Key、密码、Token）进行模糊化脱敏处理。
pub fn scrub_sensitive_info(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }

    let patterns = [
        "key",
        "password",
        "secret",
        "token",
        "auth",
        "credential",
        "api_key",
        "access_key",
    ];

    let mut result = text.to_string();
    for pattern in patterns {
        let mut lines: Vec<String> = Vec::new();
        for line in result.lines() {
            let mut scrubbed_line = line.to_string();
            let lower_line = line.to_lowercase();
            if lower_line.contains(&pattern.to_lowercase()) {
                if let Some(pos) = line.find(['=', ':']) {
                    let (prefix, suffix) = line.split_at(pos + 1);
                    if suffix.trim().len() > 3 {
                        scrubbed_line = format!("{} [REDACTED]", prefix.trim_end());
                    }
                }
            }
            lines.push(scrubbed_line);
        }
        result = lines.join("\n");
    }
    result
}
