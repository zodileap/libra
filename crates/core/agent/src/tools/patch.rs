use super::utils::{
    build_temp_dir, execute_command_with_timeout, get_required_raw_string, parse_bool_arg,
    resolve_executable_binary, resolve_sandbox_path,
};
use super::{AgentTool, ToolContext};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use zodileap_mcp_common::ProtocolError;

pub struct ApplyPatchTool;

impl AgentTool for ApplyPatchTool {
    fn name(&self) -> &'static str {
        "apply_patch"
    }

    fn description(&self) -> &'static str {
        "应用 unified diff 补丁到沙盒目录，适合一次修改多个文件。参数：{\"patch\": \"补丁文本\", \"check_only\": false}"
    }

    fn risk_level(&self) -> crate::tools::RiskLevel {
        crate::tools::RiskLevel::High
    }

    fn execute(
        &self,
        args: &Value,
        context: ToolContext,
    ) -> Result<Value, ProtocolError> {
        let patch_text = get_required_raw_string(
            args,
            "patch",
            "core.agent.python.apply_patch.patch_missing",
        )?;
        let check_only = parse_bool_arg(args, "check_only", false)?;
        if patch_text.trim().is_empty() {
            return Err(ProtocolError::new(
                "core.agent.python.apply_patch.empty_patch",
                "补丁内容不能为空",
            ));
        }

        let paths = collect_patch_paths(patch_text.as_str());
        if paths.is_empty() {
            return Err(ProtocolError::new(
                "core.agent.python.apply_patch.no_path",
                "补丁中未识别到文件路径",
            )
            .with_suggestion("请确保 patch 使用 unified diff 格式并包含 ---/+++ 头部。"));
        }
        validate_patch_paths_in_sandbox(paths.as_slice(), context.sandbox_root)?;

        let git_bin = resolve_executable_binary("git", "--version").ok_or_else(|| {
            ProtocolError::new(
                "core.agent.python.apply_patch.git_missing",
                "未检测到可用 git，无法应用补丁",
            )
            .with_suggestion("请安装 git 后重试。")
        })?;

        let runtime_dir = build_temp_dir("zodileap-agent-patch");
        fs::create_dir_all(&runtime_dir).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.apply_patch.runtime_dir_failed",
                format!("创建补丁临时目录失败: {}", err),
            )
        })?;
        let patch_path = runtime_dir.join("agent.patch");
        fs::write(&patch_path, patch_text.as_bytes()).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.apply_patch.write_failed",
                format!("写入补丁文件失败: {}", err),
            )
        })?;

        let mut check_command = Command::new(git_bin.as_str());
        check_command
            .args([
                "apply",
                "--check",
                "--whitespace=nowarn",
                "--recount",
                patch_path.to_string_lossy().as_ref(),
            ])
            .current_dir(context.sandbox_root);
        let check_output = execute_command_with_timeout(check_command, Duration::from_secs(30))?;
        if check_output.timed_out {
            return Err(ProtocolError::new(
                "core.agent.python.apply_patch.check_timeout",
                "补丁预检查超时",
            ));
        }
        if !check_output.success {
            let stderr_text = if check_output.stderr.trim().is_empty() {
                check_output.stdout.trim().to_string()
            } else {
                check_output.stderr.trim().to_string()
            };
            return Err(ProtocolError::new(
                "core.agent.python.apply_patch.check_failed",
                if stderr_text.is_empty() {
                    "补丁预检查失败".to_string()
                } else {
                    stderr_text
                },
            ));
        }

        if check_only {
            return Ok(json!({
                "files": paths,
                "patch_bytes": patch_text.len(),
                "checked": true,
                "applied": false,
                "success": true,
            }));
        }

        let mut apply_command = Command::new(git_bin.as_str());
        apply_command
            .args([
                "apply",
                "--whitespace=nowarn",
                "--recount",
                patch_path.to_string_lossy().as_ref(),
            ])
            .current_dir(context.sandbox_root);
        let apply_output = execute_command_with_timeout(apply_command, Duration::from_secs(30))?;
        if apply_output.timed_out {
            return Err(ProtocolError::new(
                "core.agent.python.apply_patch.timeout",
                "应用补丁超时",
            ));
        }
        if !apply_output.success {
            let stderr_text = if apply_output.stderr.trim().is_empty() {
                apply_output.stdout.trim().to_string()
            } else {
                apply_output.stderr.trim().to_string()
            };
            return Err(ProtocolError::new(
                "core.agent.python.apply_patch.failed",
                if stderr_text.is_empty() {
                    "应用补丁失败".to_string()
                } else {
                    stderr_text
                },
            ));
        }

        Ok(json!({
            "files": paths,
            "patch_bytes": patch_text.len(),
            "checked": true,
            "applied": true,
            "success": true,
        }))
    }
}

/// 描述：从 unified diff 文本中提取补丁目标路径，自动去重并忽略 /dev/null。
pub fn collect_patch_paths(patch_text: &str) -> Vec<String> {
    let mut set: HashSet<String> = HashSet::new();
    for line in patch_text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            let mut parts = rest.split_whitespace();
            if let Some(left) = parts.next() {
                if let Some(path) = normalize_patch_path_token(left) {
                    set.insert(path);
                }
            }
            if let Some(right) = parts.next() {
                if let Some(path) = normalize_patch_path_token(right) {
                    set.insert(path);
                }
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("+++ ") {
            if let Some(path) = normalize_patch_path_token(rest) {
                set.insert(path);
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("--- ") {
            if let Some(path) = normalize_patch_path_token(rest) {
                set.insert(path);
            }
        }
    }
    let mut result = set.into_iter().collect::<Vec<String>>();
    result.sort();
    result
}

/// 描述：标准化 patch 头部路径字段，去掉 a/ b/ 前缀与时间戳部分。
fn normalize_patch_path_token(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let head = trimmed
        .split('\t')
        .next()
        .unwrap_or(trimmed)
        .trim_matches('"')
        .trim();
    if head.is_empty() || head == "/dev/null" {
        return None;
    }
    let normalized = head
        .strip_prefix("a/")
        .or_else(|| head.strip_prefix("b/"))
        .unwrap_or(head)
        .trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.to_string())
}

/// 描述：验证补丁涉及的所有路径都位于沙盒目录内，阻断越界写入风险。
pub fn validate_patch_paths_in_sandbox(
    paths: &[String],
    sandbox_root: &Path,
) -> Result<(), ProtocolError> {
    for path in paths {
        resolve_sandbox_path(sandbox_root, path.as_str()).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.apply_patch.path_outside_sandbox",
                format!("补丁路径越界: {} ({})", path, err.message),
            )
        })?;
    }
    Ok(())
}
