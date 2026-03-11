use std::env;
use std::path::Path;
use std::process::Command;

/// 描述：可执行命令候选，统一承载程序路径与固定前置参数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandCandidate {
    pub program: String,
    pub args: Vec<String>,
}

impl CommandCandidate {
    /// 描述：使用给定程序名构建无前置参数的命令候选。
    ///
    /// Params:
    ///
    ///   - program: 可执行程序名或绝对路径。
    ///
    /// Returns:
    ///
    ///   - 0: 标准化后的命令候选。
    pub fn new(program: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
        }
    }

    /// 描述：使用给定程序名和固定前置参数构建命令候选。
    ///
    /// Params:
    ///
    ///   - program: 可执行程序名或绝对路径。
    ///   - args: 启动前需要追加的固定参数。
    ///
    /// Returns:
    ///
    ///   - 0: 标准化后的命令候选。
    pub fn with_args(program: impl Into<String>, args: &[&str]) -> Self {
        Self {
            program: program.into(),
            args: args.iter().map(|value| value.to_string()).collect(),
        }
    }

    /// 描述：基于候选构建可继续追加参数的 `Command` 实例。
    ///
    /// Returns:
    ///
    ///   - 0: 已注入固定前置参数的 `Command`。
    pub fn build_command(&self) -> Command {
        let mut command = Command::new(self.program.as_str());
        command.args(self.args.as_slice());
        command
    }

    /// 描述：将命令候选格式化为适合日志与 UI 展示的文本。
    ///
    /// Returns:
    ///
    ///   - 0: `program` 或 `program + args` 的人类可读文本。
    pub fn display(&self) -> String {
        if self.args.is_empty() {
            return self.program.clone();
        }
        format!("{} {}", self.program, self.args.join(" "))
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlatformTarget {
    Windows,
    MacOs,
    Unix,
}

/// 描述：解析 Codex CLI 的命令候选列表，供健康检查与实际执行共用。
///
/// Returns:
///
///   - 0: 按优先级排序后的命令候选。
pub fn resolve_codex_command_candidates() -> Vec<CommandCandidate> {
    resolve_cli_command_candidates("ZODILEAP_CODEX_BIN", "codex")
}

/// 描述：解析 Gemini CLI 的命令候选列表，供健康检查与实际执行共用。
///
/// Returns:
///
///   - 0: 按优先级排序后的命令候选。
pub fn resolve_gemini_command_candidates() -> Vec<CommandCandidate> {
    resolve_cli_command_candidates("ZODILEAP_GEMINI_BIN", "gemini")
}

/// 描述：解析 Python 解释器命令候选列表，兼容 Windows `py -3` 启动器。
///
/// Returns:
///
///   - 0: 按优先级排序后的命令候选。
pub fn resolve_python_command_candidates() -> Vec<CommandCandidate> {
    resolve_python_command_candidates_with(
        env::var("ZODILEAP_PYTHON_BIN").ok().as_deref(),
        current_platform_target(),
    )
}

/// 描述：按平台生成 CLI 候选列表，统一 Codex/Gemini 的探测与执行口径。
fn resolve_cli_command_candidates(env_path: &str, bin_name: &str) -> Vec<CommandCandidate> {
    resolve_cli_command_candidates_with(
        env::var(env_path).ok().as_deref(),
        bin_name,
        env::var("HOME").ok().as_deref(),
        current_platform_target(),
    )
}

/// 描述：按给定输入生成 CLI 候选列表，便于测试验证不同平台分支。
fn resolve_cli_command_candidates_with(
    env_path: Option<&str>,
    bin_name: &str,
    home: Option<&str>,
    target: PlatformTarget,
) -> Vec<CommandCandidate> {
    let mut candidates: Vec<CommandCandidate> = Vec::new();
    if let Some(path) = env_path.map(str::trim).filter(|value| !value.is_empty()) {
        push_unique_candidate(&mut candidates, CommandCandidate::new(path.to_string()));
    }

    match target {
        PlatformTarget::Windows => {
            push_unique_candidate(
                &mut candidates,
                CommandCandidate::new(format!("{}.cmd", bin_name)),
            );
            push_unique_candidate(&mut candidates, CommandCandidate::new(bin_name.to_string()));
        }
        PlatformTarget::MacOs => {
            push_unique_candidate(&mut candidates, CommandCandidate::new(bin_name.to_string()));
            push_unique_candidate(
                &mut candidates,
                CommandCandidate::new(format!("/opt/homebrew/bin/{}", bin_name)),
            );
            if let Some(home) = home.map(str::trim).filter(|value| !value.is_empty()) {
                push_unique_candidate(
                    &mut candidates,
                    CommandCandidate::new(
                        Path::new(home)
                            .join("Library")
                            .join("pnpm")
                            .join(bin_name)
                            .to_string_lossy()
                            .to_string(),
                    ),
                );
            }
        }
        PlatformTarget::Unix => {
            push_unique_candidate(&mut candidates, CommandCandidate::new(bin_name.to_string()));
        }
    }

    candidates
}

/// 描述：按给定输入生成 Python 候选列表，便于测试验证不同平台分支。
fn resolve_python_command_candidates_with(
    env_path: Option<&str>,
    target: PlatformTarget,
) -> Vec<CommandCandidate> {
    let mut candidates: Vec<CommandCandidate> = Vec::new();
    if let Some(path) = env_path.map(str::trim).filter(|value| !value.is_empty()) {
        push_unique_candidate(&mut candidates, CommandCandidate::new(path.to_string()));
    }

    match target {
        PlatformTarget::Windows => {
            push_unique_candidate(&mut candidates, CommandCandidate::with_args("py", &["-3"]));
            push_unique_candidate(&mut candidates, CommandCandidate::new("python".to_string()));
            push_unique_candidate(
                &mut candidates,
                CommandCandidate::new("python3".to_string()),
            );
        }
        PlatformTarget::MacOs => {
            push_unique_candidate(
                &mut candidates,
                CommandCandidate::new("python3".to_string()),
            );
            push_unique_candidate(&mut candidates, CommandCandidate::new("python".to_string()));
            push_unique_candidate(
                &mut candidates,
                CommandCandidate::new("/usr/bin/python3".to_string()),
            );
            push_unique_candidate(
                &mut candidates,
                CommandCandidate::new("/opt/homebrew/bin/python3".to_string()),
            );
        }
        PlatformTarget::Unix => {
            push_unique_candidate(
                &mut candidates,
                CommandCandidate::new("python3".to_string()),
            );
            push_unique_candidate(&mut candidates, CommandCandidate::new("python".to_string()));
            push_unique_candidate(
                &mut candidates,
                CommandCandidate::new("/usr/bin/python3".to_string()),
            );
        }
    }

    candidates
}

/// 描述：向候选列表中追加唯一命令，避免同一路径重复探测。
fn push_unique_candidate(candidates: &mut Vec<CommandCandidate>, candidate: CommandCandidate) {
    if candidates.iter().any(|item| item == &candidate) {
        return;
    }
    candidates.push(candidate);
}

/// 描述：识别当前编译目标的平台类型，供运行时候选解析使用。
fn current_platform_target() -> PlatformTarget {
    #[cfg(target_os = "windows")]
    {
        return PlatformTarget::Windows;
    }

    #[cfg(target_os = "macos")]
    {
        return PlatformTarget::MacOs;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        PlatformTarget::Unix
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 描述：验证 Windows CLI 候选会优先包含 `.cmd` 包装器，兼容 npm 全局命令安装形态。
    #[test]
    fn should_include_windows_cmd_wrapper_for_cli_candidates() {
        let candidates =
            resolve_cli_command_candidates_with(None, "codex", None, PlatformTarget::Windows);
        assert_eq!(
            candidates,
            vec![
                CommandCandidate::new("codex.cmd".to_string()),
                CommandCandidate::new("codex".to_string()),
            ]
        );
    }

    /// 描述：验证 macOS CLI 候选会包含 Homebrew 与 pnpm 默认安装路径。
    #[test]
    fn should_include_macos_specific_cli_locations() {
        let candidates = resolve_cli_command_candidates_with(
            Some(" /custom/bin/gemini "),
            "gemini",
            Some("/Users/demo"),
            PlatformTarget::MacOs,
        );
        assert_eq!(
            candidates,
            vec![
                CommandCandidate::new("/custom/bin/gemini".to_string()),
                CommandCandidate::new("gemini".to_string()),
                CommandCandidate::new("/opt/homebrew/bin/gemini".to_string()),
                CommandCandidate::new("/Users/demo/Library/pnpm/gemini".to_string()),
            ]
        );
    }

    /// 描述：验证 Windows Python 候选会优先包含 `py -3`，兼容官方启动器。
    #[test]
    fn should_include_py_launcher_for_windows_python() {
        let candidates = resolve_python_command_candidates_with(None, PlatformTarget::Windows);
        assert_eq!(
            candidates,
            vec![
                CommandCandidate::with_args("py", &["-3"]),
                CommandCandidate::new("python".to_string()),
                CommandCandidate::new("python3".to_string()),
            ]
        );
    }

    /// 描述：验证命令候选展示文本会拼接固定前置参数，便于日志直接复用。
    #[test]
    fn should_display_command_candidate_with_fixed_args() {
        let candidate = CommandCandidate::with_args("py", &["-3"]);
        assert_eq!(candidate.display(), "py -3");
    }
}
