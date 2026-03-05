use super::utils::{
    execute_command_with_timeout, parse_positive_usize_arg, resolve_executable_binary,
};
use super::{AgentTool, ToolContext};
use serde_json::{json, Value};
use std::process::Command;
use std::time::Duration;
use zodileap_mcp_common::ProtocolError;

pub struct GitStatusTool;

impl AgentTool for GitStatusTool {
    fn name(&self) -> &'static str {
        "git_status"
    }

    fn description(&self) -> &'static str {
        "查看当前沙盒工作目录的 git 状态（包括未追踪、已修改和暂存的文件）。无参数。"
    }

    fn execute(&self, _args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let git_bin = resolve_executable_binary("git", "--version").ok_or_else(|| {
            ProtocolError::new(
                "core.agent.python.git_status.git_missing",
                "未检测到可用 git 命令",
            )
        })?;

        let mut command = Command::new(git_bin);
        command
            .arg("status")
            .arg("-s")
            .current_dir(context.sandbox_root);

        let output = execute_command_with_timeout(
            command,
            Duration::from_secs(context.policy.tool_timeout_secs),
        )?;
        if output.timed_out {
            return Err(ProtocolError::new(
                "core.agent.python.git_status.timeout",
                "执行 git status 超时",
            ));
        }
        if !output.success {
            let error_msg = if output.stderr.trim().is_empty() {
                output.stdout.trim().to_string()
            } else {
                output.stderr.trim().to_string()
            };
            return Err(ProtocolError::new(
                "core.agent.python.git_status.failed",
                format!("执行失败: {}", error_msg),
            ));
        }

        Ok(json!({
            "status": output.stdout.trim(),
        }))
    }
}

pub struct GitDiffTool;

impl AgentTool for GitDiffTool {
    fn name(&self) -> &'static str {
        "git_diff"
    }

    fn description(&self) -> &'static str {
        "查看当前沙盒工作目录的 Git diff。支持通过 path 过滤。参数：{\"path\": \"可选的相对路径或文件模式\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let git_bin = resolve_executable_binary("git", "--version").ok_or_else(|| {
            ProtocolError::new(
                "core.agent.python.git_diff.git_missing",
                "未检测到可用 git 命令",
            )
        })?;

        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");

        let mut staged_cmd = Command::new(git_bin.as_str());
        staged_cmd.arg("diff").arg("--staged");
        if !path.trim().is_empty() {
            staged_cmd.arg("--").arg(path.trim());
        }
        staged_cmd.current_dir(context.sandbox_root);
        let staged_output = execute_command_with_timeout(
            staged_cmd,
            Duration::from_secs(context.policy.tool_timeout_secs),
        )?;

        let mut unstaged_cmd = Command::new(git_bin.as_str());
        unstaged_cmd.arg("diff");
        if !path.trim().is_empty() {
            unstaged_cmd.arg("--").arg(path.trim());
        }
        unstaged_cmd.current_dir(context.sandbox_root);
        let unstaged_output = execute_command_with_timeout(
            unstaged_cmd,
            Duration::from_secs(context.policy.tool_timeout_secs),
        )?;

        if staged_output.timed_out || unstaged_output.timed_out {
            return Err(ProtocolError::new(
                "core.agent.python.git_diff.timeout",
                "执行 git diff 超时",
            ));
        }
        if !staged_output.success {
            let error_msg = if staged_output.stderr.trim().is_empty() {
                staged_output.stdout.trim().to_string()
            } else {
                staged_output.stderr.trim().to_string()
            };
            return Err(ProtocolError::new(
                "core.agent.python.git_diff.failed",
                format!("读取 staged diff 失败: {}", error_msg),
            ));
        }
        if !unstaged_output.success {
            let error_msg = if unstaged_output.stderr.trim().is_empty() {
                unstaged_output.stdout.trim().to_string()
            } else {
                unstaged_output.stderr.trim().to_string()
            };
            return Err(ProtocolError::new(
                "core.agent.python.git_diff.failed",
                format!("读取 unstaged diff 失败: {}", error_msg),
            ));
        }

        let staged = staged_output.stdout.trim().to_string();
        let unstaged = unstaged_output.stdout.trim().to_string();

        Ok(json!({
            "staged_diff": if staged.is_empty() { Value::Null } else { Value::String(staged) },
            "unstaged_diff": if unstaged.is_empty() { Value::Null } else { Value::String(unstaged) },
        }))
    }
}

pub struct GitLogTool;

impl AgentTool for GitLogTool {
    fn name(&self) -> &'static str {
        "git_log"
    }

    fn description(&self) -> &'static str {
        "查看项目的 Git 提交日志历史。参数：{\"limit\": \"限制条数，默认 5\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let git_bin = resolve_executable_binary("git", "--version").ok_or_else(|| {
            ProtocolError::new(
                "core.agent.python.git_log.git_missing",
                "未检测到可用 git 命令",
            )
        })?;

        let limit = parse_positive_usize_arg(args, "limit", 5, 200)? as u64;

        let mut command = Command::new(git_bin);
        command
            .arg("log")
            .arg(format!("-n{}", limit))
            .arg("--oneline")
            .current_dir(context.sandbox_root);

        let output = execute_command_with_timeout(
            command,
            Duration::from_secs(context.policy.tool_timeout_secs),
        )?;

        if output.timed_out {
            return Err(ProtocolError::new(
                "core.agent.python.git_log.timeout",
                "执行 git log 超时",
            ));
        }
        if !output.success {
            return Err(ProtocolError::new(
                "core.agent.python.git_log.failed",
                "读取 git log 失败",
            ));
        }

        Ok(json!({
            "logs": output.stdout.trim().lines().map(|line| line.to_string()).collect::<Vec<String>>(),
        }))
    }
}
