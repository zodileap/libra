use super::utils::{
    execute_command_with_timeout, get_required_string, parse_positive_usize_arg,
    resolve_sandbox_path,
};
use super::{AgentTool, ToolContext};
use libra_mcp_common::ProtocolError;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::env;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

pub struct RunShellTool;

impl AgentTool for RunShellTool {
    fn name(&self) -> &'static str {
        "run_shell"
    }

    fn description(&self) -> &'static str {
        "在项目沙盒内执行 shell 命令。参数：{\"command\": \"命令文本\", \"timeout_secs\": \"可选，默认根据策略\"}"
    }

    fn risk_level(&self) -> crate::tools::RiskLevel {
        crate::tools::RiskLevel::High
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let command_text = get_required_string(
            args,
            "command",
            "core.agent.python.run_shell.command_missing",
        )?;
        let timeout_secs = parse_positive_usize_arg(
            args,
            "timeout_secs",
            context.policy.tool_timeout_secs as usize,
            600,
        )? as u64;
        let command_names = evaluate_run_shell_policy(command_text.as_str())?;
        let validated_paths =
            validate_shell_paths_in_sandbox(command_text.as_str(), context.sandbox_root)?;
        let command = build_shell_command(command_text.as_str(), context.sandbox_root);

        let output = execute_command_with_timeout(command, Duration::from_secs(timeout_secs))?;
        if output.timed_out {
            return Ok(json!({
                "status": Value::Null,
                "success": false,
                "stdout": output.stdout,
                "stderr": output.stderr,
                "commands": command_names,
                "validated_paths": validated_paths,
                "timed_out": true,
                "elapsed_ms": output.elapsed_ms,
                "timeout_secs": timeout_secs,
            }));
        }

        Ok(json!({
            "status": output.status_code,
            "success": output.success,
            "stdout": output.stdout,
            "stderr": output.stderr,
            "commands": command_names,
            "validated_paths": validated_paths,
            "timed_out": false,
            "elapsed_ms": output.elapsed_ms,
            "timeout_secs": timeout_secs,
        }))
    }
}

/// 描述：根据当前平台构建实际执行的 shell 命令，避免把 `/bin/zsh` 等平台特定路径硬编码为唯一路径。
///
/// Params:
///
///   - command_text: 原始 shell 文本。
///   - sandbox_root: 命令执行目录。
///
/// Returns:
///
///   - 0: 已绑定工作目录的 `Command`。
fn build_shell_command(command_text: &str, sandbox_root: &Path) -> Command {
    #[cfg(target_os = "windows")]
    {
        let shell_program = resolve_windows_shell_program(env::var("ComSpec").ok().as_deref());
        let mut cmd = Command::new(shell_program);
        cmd.arg("/C").arg(command_text).current_dir(sandbox_root);
        return cmd;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let shell_program = resolve_unix_shell_program(
            env::var("SHELL").ok().as_deref(),
            Path::new("/bin/sh").exists(),
        );
        let mut cmd = Command::new(shell_program);
        cmd.arg("-c").arg(command_text).current_dir(sandbox_root);
        cmd
    }
}

#[cfg(any(target_os = "windows", test))]
/// 描述：解析 Windows shell 程序，优先使用 `ComSpec`，缺省回退到 `cmd`。
fn resolve_windows_shell_program(comspec_env: Option<&str>) -> String {
    comspec_env
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "cmd".to_string())
}

#[cfg(any(not(target_os = "windows"), test))]
/// 描述：解析 Unix shell 程序，优先使用 `SHELL`，缺省回退到 `/bin/sh` 或 `sh`。
fn resolve_unix_shell_program(shell_env: Option<&str>, sh_exists: bool) -> String {
    if let Some(shell) = shell_env.map(str::trim).filter(|value| !value.is_empty()) {
        return shell.to_string();
    }
    if sh_exists {
        return "/bin/sh".to_string();
    }
    "sh".to_string()
}

/// 描述：执行 run_shell 前的安全策略校验，支持环境变量白名单/黑名单扩展。
fn evaluate_run_shell_policy(command_text: &str) -> Result<Vec<String>, ProtocolError> {
    let allowlist = parse_command_set_from_env("ZODILEAP_AGENT_RUN_SHELL_ALLOWLIST");
    let mut denylist = default_run_shell_denylist();
    denylist.extend(parse_command_set_from_env(
        "ZODILEAP_AGENT_RUN_SHELL_DENYLIST",
    ));
    evaluate_run_shell_policy_with_sets(command_text, &allowlist, &denylist)
}

/// 描述：根据给定白名单/黑名单校验命令是否允许执行，用于生产逻辑与测试复用。
pub fn evaluate_run_shell_policy_with_sets(
    command_text: &str,
    allowlist: &HashSet<String>,
    denylist: &HashSet<String>,
) -> Result<Vec<String>, ProtocolError> {
    let command_names = collect_shell_command_names(command_text);
    if command_names.is_empty() {
        return Err(ProtocolError::new(
            "core.agent.python.run_shell.command_empty",
            "命令内容为空或无法解析可执行命令",
        ));
    }

    for command in &command_names {
        if denylist.contains(command) {
            return Err(ProtocolError::new(
                "core.agent.python.run_shell.command_blocked",
                format!("命令被安全策略拒绝: {}", command),
            )
            .with_suggestion("请改用 read_text/write_text/apply_patch，或调整安全策略配置。"));
        }
        if !allowlist.is_empty() && !allowlist.contains(command) {
            return Err(ProtocolError::new(
                "core.agent.python.run_shell.command_not_allowed",
                format!("命令不在白名单中: {}", command),
            )
            .with_suggestion(
                "请设置 ZODILEAP_AGENT_RUN_SHELL_ALLOWLIST，或改用内置文件工具完成操作。",
            ));
        }
    }
    Ok(command_names)
}

/// 描述：返回 run_shell 默认黑名单，阻断高风险系统命令。
fn default_run_shell_denylist() -> HashSet<String> {
    [
        "rm",
        "dd",
        "mkfs",
        "shutdown",
        "reboot",
        "halt",
        "poweroff",
        "diskutil",
        "fdisk",
        "format",
        "launchctl",
        "init",
    ]
    .iter()
    .map(|value| value.to_string())
    .collect()
}

/// 描述：读取并解析命令集合环境变量，支持逗号/空白分隔。
fn parse_command_set_from_env(key: &str) -> HashSet<String> {
    env::var(key)
        .ok()
        .map(|value| parse_command_set(value.as_str()))
        .unwrap_or_default()
}

/// 描述：解析命令集合文本，统一转小写并去重。
fn parse_command_set(raw: &str) -> HashSet<String> {
    raw.split(|ch: char| ch == ',' || ch.is_whitespace())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase())
        .collect()
}

/// 描述：从 shell 文本中提取每个分段的可执行命令名，用于安全策略判定与审计。
pub fn collect_shell_command_names(command_text: &str) -> Vec<String> {
    split_shell_segments(command_text)
        .iter()
        .filter_map(|segment| extract_executable_from_segment(segment.as_str()))
        .collect()
}

/// 描述：校验 shell 命令中的路径参数必须落在沙盒内，并返回归一化路径用于审计。
pub fn validate_shell_paths_in_sandbox(
    command_text: &str,
    sandbox_root: &Path,
) -> Result<Vec<String>, ProtocolError> {
    let segments = split_shell_segments(command_text);
    let mut validated: Vec<String> = Vec::new();
    let mut dedup: HashSet<String> = HashSet::new();
    for segment in segments {
        let tokens = tokenize_shell_words(segment.as_str());
        if tokens.is_empty() {
            continue;
        }
        let executable_index = locate_segment_executable_index(tokens.as_slice());
        let Some(command_index) = executable_index else {
            continue;
        };
        for token in tokens.iter().skip(command_index + 1) {
            let token = token.as_str();
            if token.starts_with('-') {
                if let Some((_, value)) = token.split_once('=') {
                    if let Some(path) = validate_shell_path_token(value, sandbox_root)? {
                        if dedup.insert(path.clone()) {
                            validated.push(path);
                        }
                    }
                }
                continue;
            }
            if let Some(path) = validate_shell_path_token(token, sandbox_root)? {
                if dedup.insert(path.clone()) {
                    validated.push(path);
                }
            }
        }
    }
    Ok(validated)
}

/// 描述：按 shell 控制符切分命令段，忽略引号内内容，控制符包括 `;`、`|`、`&&`、`||`。
pub fn split_shell_segments(command_text: &str) -> Vec<String> {
    let chars = command_text.chars().collect::<Vec<char>>();
    let mut result: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    let mut index = 0usize;

    while index < chars.len() {
        let ch = chars[index];
        if escaped {
            current.push(ch);
            escaped = false;
            index += 1;
            continue;
        }
        if ch == '\\' && !in_single {
            current.push(ch);
            escaped = true;
            index += 1;
            continue;
        }
        if ch == '\'' && !in_double {
            in_single = !in_single;
            current.push(ch);
            index += 1;
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
            current.push(ch);
            index += 1;
            continue;
        }
        if !in_single && !in_double {
            if ch == ';' {
                if !current.trim().is_empty() {
                    result.push(current.trim().to_string());
                }
                current.clear();
                index += 1;
                continue;
            }
            if ch == '|' {
                if !current.trim().is_empty() {
                    result.push(current.trim().to_string());
                }
                current.clear();
                if index + 1 < chars.len() && chars[index + 1] == '|' {
                    index += 2;
                } else {
                    index += 1;
                }
                continue;
            }
            if ch == '&' && index + 1 < chars.len() && chars[index + 1] == '&' {
                if !current.trim().is_empty() {
                    result.push(current.trim().to_string());
                }
                current.clear();
                index += 2;
                continue;
            }
        }
        current.push(ch);
        index += 1;
    }
    if !current.trim().is_empty() {
        result.push(current.trim().to_string());
    }
    result
}

/// 描述：从单个命令段中提取可执行命令，支持跳过环境变量和常见前缀包装器。
fn extract_executable_from_segment(segment: &str) -> Option<String> {
    let tokens = tokenize_shell_words(segment);
    if tokens.is_empty() {
        return None;
    }
    let command_index = locate_segment_executable_index(tokens.as_slice())?;
    normalize_shell_command_token(tokens[command_index].as_str())
}

/// 描述：定位命令段中真正的可执行 token 下标，跳过赋值、包装器与其参数。
pub fn locate_segment_executable_index(tokens: &[String]) -> Option<usize> {
    if tokens.is_empty() {
        return None;
    }
    let mut index = 0usize;
    while index < tokens.len() {
        while index < tokens.len() && is_shell_env_assignment(tokens[index].as_str()) {
            index += 1;
        }
        if index >= tokens.len() {
            return None;
        }
        let token_lower = tokens[index].to_lowercase();
        if token_lower == "sudo" {
            index += 1;
            while index < tokens.len() && tokens[index].starts_with('-') {
                index += 1;
            }
            continue;
        }
        if token_lower == "env" {
            index += 1;
            while index < tokens.len() {
                let token = tokens[index].as_str();
                if token.starts_with('-') || is_shell_env_assignment(token) {
                    index += 1;
                    continue;
                }
                break;
            }
            continue;
        }
        if matches!(
            token_lower.as_str(),
            "time" | "nohup" | "command" | "builtin"
        ) {
            index += 1;
            while index < tokens.len() && tokens[index].starts_with('-') {
                index += 1;
            }
            continue;
        }
        return Some(index);
    }
    None
}

/// 描述：校验单个 shell 参数是否是合法沙盒路径；非路径参数返回 None。
fn validate_shell_path_token(
    token: &str,
    sandbox_root: &Path,
) -> Result<Option<String>, ProtocolError> {
    let trimmed = token.trim();
    if !looks_like_shell_path_argument(trimmed) {
        return Ok(None);
    }
    if trimmed.contains('$') {
        return Err(ProtocolError::new(
            "core.agent.python.run_shell.dynamic_path_forbidden",
            format!("路径参数不允许使用变量展开: {}", trimmed),
        )
        .with_suggestion("请改为项目内明确的相对路径。"));
    }
    if trimmed.starts_with('~') {
        return Err(ProtocolError::new(
            "core.agent.python.run_shell.home_path_forbidden",
            format!("路径参数不允许使用用户目录前缀: {}", trimmed),
        )
        .with_suggestion("请改为项目内相对路径。"));
    }

    let normalized_input = normalize_shell_path_input(trimmed);
    if normalized_input.is_empty() {
        return Ok(None);
    }
    let resolved =
        resolve_sandbox_path(sandbox_root, normalized_input.as_str()).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.run_shell.path_outside_sandbox",
                format!("路径参数越界: {} ({})", trimmed, err.message),
            )
            .with_suggestion("run_shell 仅允许访问项目目录内路径。")
        })?;
    Ok(Some(resolved.to_string_lossy().to_string()))
}

/// 描述：判断参数是否看起来像路径；仅路径参数进入沙盒校验。
fn looks_like_shell_path_argument(token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    let lower = token.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return false;
    }
    if token == "." || token == ".." {
        return true;
    }
    if token.starts_with("./")
        || token.starts_with("../")
        || token.starts_with('/')
        || token.starts_with('\\')
        || token.starts_with("~/")
        || token.starts_with("~\\")
    {
        return true;
    }
    if token.len() >= 2 && token.as_bytes()[1] == b':' && token.as_bytes()[0].is_ascii_alphabetic()
    {
        return true;
    }
    if token.contains('/') || token.contains('\\') {
        return true;
    }
    if token.contains('*') || token.contains('?') || token.contains('[') {
        return true;
    }
    if token.ends_with(".rs")
        || token.ends_with(".ts")
        || token.ends_with(".tsx")
        || token.ends_with(".js")
        || token.ends_with(".json")
        || token.ends_with(".md")
        || token.ends_with(".toml")
        || token.ends_with(".yaml")
        || token.ends_with(".yml")
    {
        return true;
    }
    false
}

/// 描述：规范化 shell 路径参数，去掉 file:// 前缀、通配符尾部和尾随分隔符。
pub fn normalize_shell_path_input(token: &str) -> String {
    let mut raw = token
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    if let Some(value) = raw.strip_prefix("file://") {
        raw = value.to_string();
    }
    let wildcard_pos = raw.find(['*', '?', '[']).unwrap_or(raw.len());
    let mut candidate = raw
        .get(..wildcard_pos)
        .unwrap_or_default()
        .trim_end_matches(['/', '\\'])
        .to_string();
    if candidate.is_empty() && (token.contains('*') || token.contains('?') || token.contains('[')) {
        candidate = ".".to_string();
    }
    candidate
}

/// 描述：把 shell 命令段分词，支持基础引号和转义规则，输出去引号后的 token。
pub fn tokenize_shell_words(raw: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    for ch in raw.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' && !in_single {
            escaped = true;
            continue;
        }
        if ch == '\'' && !in_double {
            in_single = !in_single;
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
            continue;
        }
        if ch.is_whitespace() && !in_single && !in_double {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            continue;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// 描述：判断 token 是否是 shell 形式的环境变量赋值。
fn is_shell_env_assignment(token: &str) -> bool {
    let parts = token.split_once('=');
    let (key, _value) = match parts {
        Some(value) => value,
        None => return false,
    };
    if key.is_empty() {
        return false;
    }
    let mut chars = key.chars();
    let first = chars.next().unwrap_or_default();
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

/// 描述：标准化命令 token，只保留可执行名并统一小写。
fn normalize_shell_command_token(token: &str) -> Option<String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = Path::new(trimmed)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| trimmed.to_string())
        .to_lowercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 描述：验证 Unix shell 解析会优先尊重 `SHELL` 环境变量，避免强依赖固定 shell 路径。
    #[test]
    fn should_prefer_configured_unix_shell() {
        let shell = resolve_unix_shell_program(Some(" /usr/bin/fish "), true);
        assert_eq!(shell, "/usr/bin/fish");
    }

    /// 描述：验证 Unix shell 缺省会优先回退到 `/bin/sh`，缺失时再使用 `sh` 命令名。
    #[test]
    fn should_fallback_to_posix_shell_when_env_is_missing() {
        assert_eq!(resolve_unix_shell_program(None, true), "/bin/sh");
        assert_eq!(resolve_unix_shell_program(None, false), "sh");
    }

    /// 描述：验证 Windows shell 解析会优先使用 `ComSpec`，缺省保持 `cmd` 兼容。
    #[test]
    fn should_prefer_comspec_on_windows() {
        assert_eq!(
            resolve_windows_shell_program(Some(" C:\\Windows\\System32\\cmd.exe ")),
            "C:\\Windows\\System32\\cmd.exe"
        );
        assert_eq!(resolve_windows_shell_program(None), "cmd");
    }
}
