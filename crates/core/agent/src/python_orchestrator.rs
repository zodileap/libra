use crate::flow::build_system_prompt;
use crate::llm::parse_provider;
use crate::sandbox::{BATCH_SIZE_PREFIX, FINAL_RESULT_PREFIX, SANDBOX_ERROR_PREFIX, TOOL_CALL_PREFIX, TURN_END_MARKER};
use crate::{AgentRunRequest, AgentRunResult, AgentStreamEvent};
use serde_json::{json, Value};
use std::env;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tracing::{info_span, warn};
use zodileap_mcp_common::{
    now_millis, ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord, ProtocolStepStatus,
};

#[derive(Debug)]
pub(crate) struct PythonScriptExecutionResult {
    pub message: String,
    pub actions: Vec<String>,
    pub events: Vec<ProtocolEventRecord>,
    pub assets: Vec<ProtocolAssetRecord>,
}

pub(crate) struct PythonScriptExecutionRequest<'a> {
    pub user_script: &'a str,
    pub workdir: Option<&'a str>,
    pub blender_bridge_addr: Option<&'a str>,
    pub policy: &'a crate::policy::AgentPolicy,
    pub trace_id: String,
    pub session_id: String,
}

/// 描述：执行代码智能体 Python 编排主流程，包含脚本生成与沙盒执行。
pub(crate) fn run_code_agent_with_python_workflow(
    request: AgentRunRequest,
    policy: crate::policy::AgentPolicy,
    _profile: crate::profile::AgentProfile,
    on_stream_event: &mut dyn FnMut(AgentStreamEvent),
) -> Result<AgentRunResult, ProtocolError> {
    let provider = parse_provider(&request.provider);
    let trace_id = request.trace_id.clone();

    on_stream_event(AgentStreamEvent::Planning {
        message: "正在规划代码执行策略".to_string(),
    });
    on_stream_event(AgentStreamEvent::LlmStarted {
        provider: request.provider.clone(),
    });

    let prompt = build_python_workflow_prompt(&request.prompt, request.project_name.as_deref());
    let started_at = now_millis();
    let llm_policy = crate::llm::LlmGatewayPolicy {
        timeout_secs: policy.llm_timeout_secs,
        retry_policy: policy.llm_retry_policy,
    };

    let mut stream_observer = |chunk: &str| {
        on_stream_event(AgentStreamEvent::LlmDelta {
            content: chunk.to_string(),
        });
    };

    let run_result = crate::llm::call_model_with_policy_and_stream(
        provider,
        &prompt,
        request.workdir.as_deref(),
        llm_policy,
        Some(&mut stream_observer),
    )
    .map_err(|err| err.to_protocol_error())?;

    on_stream_event(AgentStreamEvent::LlmFinished {
        provider: request.provider.clone(),
    });

    let generated_script = extract_python_script(&run_result.content);
    if generated_script.trim().is_empty() {
        return Err(
            ProtocolError::new("core.agent.python.empty_script", "模型未返回可执行 Python 脚本")
                .with_suggestion("请重试，或调整提示词让模型只输出 Python 代码。"),
        );
    }

    on_stream_event(AgentStreamEvent::Planning {
        message: "脚本已生成，开始执行沙盒任务".to_string(),
    });

    let execution = execute_python_script(
        PythonScriptExecutionRequest {
            user_script: &generated_script,
            workdir: request.workdir.as_deref(),
            blender_bridge_addr: request.blender_bridge_addr.as_deref(),
            policy: &policy,
            trace_id: trace_id.clone(),
            session_id: request.session_id.clone(),
        },
        on_stream_event,
    )?;

    on_stream_event(AgentStreamEvent::Final {
        message: execution.message.clone(),
    });

    let finished_at = now_millis();
    let steps = vec![
        ProtocolStepRecord {
            index: 0,
            code: "llm_python_codegen".to_string(),
            status: ProtocolStepStatus::Success,
            elapsed_ms: finished_at.saturating_sub(started_at),
            summary: format!("provider={} 已生成 Python 编排脚本", request.provider),
            error: None,
            data: Some(json!({
                "script_length": generated_script.chars().count(),
                "usage": run_result.usage,
            })),
        },
        ProtocolStepRecord {
            index: 1,
            code: "python_workflow_execute".to_string(),
            status: ProtocolStepStatus::Success,
            elapsed_ms: 0,
            summary: "Python 沙盒执行完成".to_string(),
            error: None,
            data: Some(json!({
                "actions": execution.actions,
            })),
        },
    ];

    Ok(AgentRunResult {
        trace_id,
        message: execution.message,
        usage: Some(run_result.usage),
        actions: execution.actions,
        exported_file: None,
        steps,
        events: execution.events,
        assets: execution.assets,
        ui_hint: None,
    })
}

/// 描述：构建 Python 编排提示词。
fn build_python_workflow_prompt(user_prompt: &str, project_name: Option<&str>) -> String {
    let project_name_text = project_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名项目");
    let system_prompt = build_system_prompt(crate::flow::AgentKind::Code);

    format!(
        "{system_prompt}\n你必须只输出可执行 Python3 代码，禁止输出 Markdown 围栏。\n当前项目：{project_name_text}\n用户需求：\n{user_prompt}"
    )
}

/// 描述：从模型返回结果中提取 Python 脚本正文，兼容 fenced block。
fn extract_python_script(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("```") {
        let mut lines = trimmed.lines();
        let _ = lines.next();
        let mut body: Vec<&str> = Vec::new();
        for line in lines {
            if line.trim_start().starts_with("```") {
                break;
            }
            body.push(line);
        }
        return body.join("\n").trim().to_string();
    }
    trimmed.to_string()
}

pub(crate) fn execute_python_script<F>(
    request: PythonScriptExecutionRequest<'_>,
    on_stream_event: &mut F,
) -> Result<PythonScriptExecutionResult, ProtocolError>
where
    F: FnMut(AgentStreamEvent) + ?Sized,
{
    let PythonScriptExecutionRequest {
        user_script,
        workdir,
        blender_bridge_addr,
        policy,
        trace_id,
        session_id,
    } = request;
    let span = info_span!("python_sandbox_execute", trace_id = %trace_id, session_id = %session_id);
    let _enter = span.enter();

    let python_bin = resolve_python_binary()?;
    let sandbox_root = resolve_sandbox_root(workdir)?;

    // 从持久化注册表中获取或创建沙盒
    let sandbox_ref = crate::sandbox::SANDBOX_REGISTRY.get_or_create(
        &session_id,
        &sandbox_root,
        &python_bin
    )?;
    let mut sandbox = sandbox_ref
        .lock()
        .map_err(|_| ProtocolError::new("sandbox.lock_failed", "sandbox 锁获取失败"))?;
    sandbox.last_active_at = Instant::now();

    // 为了兼容性，我们通过 BATCH_SIZE 协议发送用户脚本。
    // 在持久化模式下，我们不再需要 FS::write 写入临时文件，直接内存注入。
    let payload = build_batch_payload(user_script);
    sandbox.stdin.write_all(payload.as_bytes()).map_err(|err| ProtocolError::new("sandbox.write_failed", err.to_string()))?;
    sandbox.stdin.flush().ok();

    let mut final_message = String::new();
    let mut actions = Vec::new();
    let mut events = Vec::new();
    let assets = Vec::new();
    let mut last_event_at = Instant::now();
    let execution_started_at = Instant::now();
    let registry = build_default_tool_registry(blender_bridge_addr);

    loop {
        if execution_started_at.elapsed() >= Duration::from_secs(policy.orchestration_timeout_secs) {
            let timeout_message = format!(
                "编排执行超时（{}s），任务已自动终止",
                policy.orchestration_timeout_secs
            );
            on_stream_event(AgentStreamEvent::Cancelled {
                message: timeout_message.clone(),
            });
            events.push(ProtocolEventRecord {
                event: "orchestration_timeout".to_string(),
                step_index: None,
                timestamp_ms: now_millis(),
                message: timeout_message.clone(),
            });
            return Err(
                ProtocolError::new("core.agent.python.orchestration_timeout", timeout_message)
                    .with_suggestion("请缩小任务范围，或调大 ZODILEAP_ORCHESTRATION_TIMEOUT_SECS。"),
            );
        }

        let now = Instant::now();
        if now.duration_since(last_event_at) > Duration::from_secs(5) {
            on_stream_event(AgentStreamEvent::Heartbeat {
                message: "沙盒正在保持连接并执行指令...".to_string(),
            });
            last_event_at = now;
        }

        // 监听沙盒输出
        match sandbox.receiver.recv_timeout(Duration::from_millis(40)) {
            Ok(crate::sandbox::SandboxOutput::Stdout(line)) => {
                last_event_at = Instant::now();

                if line == TURN_END_MARKER {
                    break;
                }

                if let Some(payload) = line.strip_prefix(TOOL_CALL_PREFIX) {
                    let parsed: Value = serde_json::from_str(payload).map_err(|err| {
                        ProtocolError::new("core.agent.python.tool_payload_invalid", format!("工具调用载荷解析失败: {}", err))
                    })?;

                    let tool_name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                    let tool_args = parsed.get("args").cloned().unwrap_or_else(|| json!({}));

                    on_stream_event(AgentStreamEvent::ToolCallStarted {
                        name: tool_name.clone(),
                        args: tool_args.to_string(),
                    });
                    events.push(ProtocolEventRecord {
                        event: "tool_call_started".to_string(),
                        step_index: None,
                        timestamp_ms: now_millis(),
                        message: format!("tool={} started", tool_name),
                    });

                    // 高危拦截逻辑 (Human-in-the-loop)
                    if let Some(tool) = registry.get(&tool_name) {
                        if tool.risk_level() == crate::tools::RiskLevel::High {
                            let approval_id = format!("appr-{}", now_millis());
                            on_stream_event(AgentStreamEvent::RequireApproval {
                                approval_id: approval_id.clone(),
                                tool_name: tool_name.clone(),
                                tool_args: tool_args.to_string(),
                            });
                            events.push(ProtocolEventRecord {
                                event: "approval_requested".to_string(),
                                step_index: None,
                                timestamp_ms: now_millis(),
                                message: format!("tool={} approval_requested id={}", tool_name, approval_id),
                            });

                            let signal = crate::APPROVAL_REGISTRY.create_request(&approval_id);
                            let wait_started_at = Instant::now();
                            let mut last_wait_heartbeat = Instant::now();
                            let mut approval_timed_out = false;
                            let outcome = loop {
                                let decision = match signal.lock() {
                                    Ok(guard) => *guard,
                                    Err(poisoned) => *poisoned.into_inner(),
                                };
                                if let Some(o) = decision { break o; }
                                if wait_started_at.elapsed() >= Duration::from_secs(policy.approval_timeout_secs) {
                                    approval_timed_out = true;
                                    let _ = crate::APPROVAL_REGISTRY.remove_request(&approval_id);
                                    break crate::ApprovalOutcome::Rejected;
                                }
                                if last_wait_heartbeat.elapsed() >= Duration::from_secs(5) {
                                    on_stream_event(AgentStreamEvent::Heartbeat {
                                        message: format!(
                                            "等待人工授权中（{}s 超时）",
                                            policy.approval_timeout_secs
                                        ),
                                    });
                                    last_wait_heartbeat = Instant::now();
                                }
                                thread::sleep(Duration::from_millis(200));
                            };

                            if matches!(outcome, crate::ApprovalOutcome::Rejected) {
                                let (event_name, reject_message, reject_code) =
                                    resolve_approval_reject_payload(approval_timed_out);
                                events.push(ProtocolEventRecord {
                                    event: event_name.to_string(),
                                    step_index: None,
                                    timestamp_ms: now_millis(),
                                    message: format!("tool={} {}", tool_name, event_name),
                                });
                                let result_line = json!({"ok": false, "error": reject_message, "code": reject_code});
                                sandbox.write_tool_result(&result_line)?;
                                continue;
                            }
                            events.push(ProtocolEventRecord {
                                event: "approval_approved".to_string(),
                                step_index: None,
                                timestamp_ms: now_millis(),
                                message: format!("tool={} approval_approved", tool_name),
                            });
                        }
                    }

                    let context = crate::tools::ToolContext {
                        trace_id: trace_id.clone(),
                        sandbox_root: &sandbox_root,
                        policy,
                    };

                    let tool_response = if tool_name == "tool_search" {
                        tool_tool_search(&tool_args)
                    } else if let Some(tool) = registry.get(&tool_name) {
                        tool.execute(&tool_args, context)
                    } else {
                        Err(ProtocolError::new("core.agent.python.tool_unsupported", format!("不支持的工具: {}", tool_name)))
                    };

                    let (ok, result_data, error_detail) = match &tool_response {
                        Ok(data) => (true, data.clone(), None),
                        Err(err) => (false, json!(null), Some(err.clone())),
                    };

                    let failure_summary_payload = json!(
                        error_detail
                            .as_ref()
                            .map(|e| e.message.clone())
                            .unwrap_or_default()
                    );
                    let summary_source = if ok {
                        &result_data
                    } else {
                        &failure_summary_payload
                    };

                    on_stream_event(AgentStreamEvent::ToolCallFinished {
                        name: tool_name.clone(),
                        ok,
                        result: summarize_tool_result(&tool_name, ok, summary_source),
                    });
                    events.push(ProtocolEventRecord {
                        event: if ok {
                            "tool_call_finished"
                        } else {
                            "tool_call_failed"
                        }
                        .to_string(),
                        step_index: None,
                        timestamp_ms: now_millis(),
                        message: format!("tool={} ok={}", tool_name, ok),
                    });

                    let response_val = if ok {
                        json!({"ok": true, "data": result_data})
                    } else {
                        let e = error_detail.unwrap_or_else(|| {
                            ProtocolError::new(
                                "core.agent.python.tool_unknown_error",
                                "工具执行失败，未返回错误详情",
                            )
                        });
                        json!({"ok": false, "error": e.message, "code": e.code})
                    };

                    sandbox.write_tool_result(&response_val)?;
                    actions.push(tool_name);
                    continue;
                }

                if let Some(msg) = line.strip_prefix(FINAL_RESULT_PREFIX) {
                    final_message = msg.to_string();
                } else if line.starts_with(SANDBOX_ERROR_PREFIX) {
                    return Err(ProtocolError::new("sandbox.runtime_error", line));
                }
            }
            Ok(crate::sandbox::SandboxOutput::Stderr(line)) => {
                warn!(stderr = %line, "python sandbox error output");
            }
            Ok(crate::sandbox::SandboxOutput::Terminated(code)) => {
                return Err(ProtocolError::new("sandbox.terminated", format!("沙盒进程意外终止: {}", code)));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(Some(status)) = sandbox.child.try_wait() {
                    return Err(ProtocolError::new("sandbox.crashed", format!("进程已崩溃: {}", status)));
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(ProtocolError::new(
                    "sandbox.channel_disconnected",
                    "沙盒通信通道已断开",
                ));
            }
        }
    }

    sandbox.last_active_at = Instant::now();
    Ok(PythonScriptExecutionResult {
        message: final_message,
        actions,
        events,
        assets,
    })
}

/// 描述：根据是否超时解析人工授权拒绝分支的事件名、用户提示与错误码。
fn resolve_approval_reject_payload(approval_timed_out: bool) -> (&'static str, &'static str, &'static str) {
    if approval_timed_out {
        (
            "approval_timeout",
            "授权等待超时，操作已取消",
            "core.agent.human_approval_timeout",
        )
    } else {
        (
            "approval_rejected",
            "操作已被用户拒绝",
            "core.agent.human_refused",
        )
    }
}


use crate::tools::utils::*;
use crate::tools::file::{
    GlobTool, ListDirTool, MkdirTool, ReadJsonTool, ReadTextTool, SearchFilesTool, StatTool,
    WriteJsonTool, WriteTextTool,
};
use crate::tools::git::{GitDiffTool, GitLogTool, GitStatusTool};
use crate::tools::mcp::McpModelTool;
use crate::tools::patch::ApplyPatchTool;
use crate::tools::shell::RunShellTool;
use crate::tools::todo::{TodoReadTool, TodoWriteTool};
use crate::tools::web::{FetchUrlTool, WebSearchTool};
use crate::tools::ToolRegistry;

/// 描述：对工具执行结果进行语义摘要，过滤技术噪声并自动执行脱敏，确保展示信息的安全性与可读性。
fn summarize_tool_result(name: &str, ok: bool, data: &Value) -> String {
    if !ok {
        let err_msg = data.as_str().unwrap_or("执行失败");
        return scrub_sensitive_info(err_msg);
    }

    let summary = match name {
        "run_shell" => {
            let stdout = data.get("stdout").and_then(|v| v.as_str()).unwrap_or("");
            let stderr = data.get("stderr").and_then(|v| v.as_str()).unwrap_or("");
            let timed_out = data
                .get("timed_out")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let timeout_secs = data
                .get("timeout_secs")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            if timed_out {
                return if timeout_secs > 0 {
                    format!("执行超时（{}s），已终止", timeout_secs)
                } else {
                    "执行超时，已终止".to_string()
                };
            }
            let exit_code = data.get("status").and_then(|v| v.as_i64()).unwrap_or(0);

            let last_lines: Vec<&str> = stdout.lines().rev().take(3).collect();
            let mut s = if last_lines.is_empty() {
                if stderr.is_empty() { "执行完成（无输出）".to_string() }
                else { format!("执行完成，错误输出摘要: {}", stderr.chars().take(100).collect::<String>()) }
            } else {
                format!("执行完成，输出末尾: \n{}", last_lines.into_iter().rev().collect::<Vec<_>>().join("\n"))
            };
            s.push_str(&format!(" (退出码: {})", exit_code));
            s
        }
        "read_text" => {
            let content = data.get("content").and_then(|v| v.as_str()).unwrap_or("");
            format!("读取完成，共 {} 字符", content.chars().count())
        }
        "read_json" => {
            "读取 JSON 成功".to_string()
        }
        "write_json" => {
            let bytes = data.get("bytes").and_then(|v| v.as_u64()).unwrap_or(0);
            format!("写入 JSON 成功，共 {} 字节", bytes)
        }
        "git_status" => {
            let status = data.get("status").and_then(|v| v.as_str()).unwrap_or("");
            let lines = status.lines().count();
            if lines == 0 {
                "工作区干净".to_string()
            } else {
                format!("发现 {} 个变更文件", lines)
            }
        }
        "git_diff" => {
            let staged = data.get("staged_diff").and_then(|v| v.as_str()).unwrap_or("");
            let unstaged = data.get("unstaged_diff").and_then(|v| v.as_str()).unwrap_or("");
            if staged.is_empty() && unstaged.is_empty() {
                "无差异".to_string()
            } else {
                "提取 diff 成功".to_string()
            }
        }
        "git_log" => {
            let logs = data.get("logs").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            format!("已读取 {} 条提交记录", logs)
        }
        "list_dir" => {
            let entries = data.get("entries").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            format!("扫描完成，共发现 {} 个文件/目录", entries)
        }
        "glob" => {
            let matches = data.get("matches").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            format!("模式匹配完成，共命中 {} 条", matches)
        }
        "mkdir" => {
            "目录创建成功".to_string()
        }
        "stat" => {
            let is_dir = data.get("is_dir").and_then(|v| v.as_bool()).unwrap_or(false);
            let size = data.get("size_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
            if is_dir {
                "目录状态读取成功".to_string()
            } else {
                format!("文件状态读取成功，大小 {} 字节", size)
            }
        }
        "search_files" => {
            let matches = data.get("matches").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            format!("检索完成，共匹配 {} 处结果", matches)
        }
        "apply_patch" => {
            let files = data.get("files").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            format!("补丁应用完成，共修改 {} 个文件", files)
        }
        "web_search" => {
            let results = data.get("results").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            format!("检索完成，共返回 {} 条结果", results)
        }
        "fetch_url" => {
            let chars = data.get("content_chars").and_then(|v| v.as_u64()).unwrap_or(0);
            format!("抓取完成，共 {} 字符", chars)
        }
        _ => {
            let s = data.to_string();
            if s.len() > 200 {
                format!("{}...", &s[..200])
            } else {
                s
            }
        }
    };

    scrub_sensitive_info(summary.as_str())
}

/// 描述：按沙盒批量协议构建脚本载荷，长度字段使用字符数与 Python `read(size)` 语义一致。
fn build_batch_payload(user_script: &str) -> String {
    let script_char_count = user_script.chars().count();
    format!("{}{}\n{}", BATCH_SIZE_PREFIX, script_char_count, user_script)
}

/// 描述：构建代码智能体默认可用的工具注册表。
fn build_default_tool_registry(blender_bridge_addr: Option<&str>) -> ToolRegistry {
    #[allow(unused_mut)]
    let mut registry = ToolRegistry::new();
    registry.register(Box::new(ReadTextTool));
    registry.register(Box::new(ReadJsonTool));
    registry.register(Box::new(WriteJsonTool));
    registry.register(Box::new(WriteTextTool));
    registry.register(Box::new(ListDirTool));
    registry.register(Box::new(MkdirTool));
    registry.register(Box::new(StatTool));
    registry.register(Box::new(GlobTool));
    registry.register(Box::new(SearchFilesTool));
    registry.register(Box::new(RunShellTool));
    registry.register(Box::new(GitStatusTool));
    registry.register(Box::new(GitDiffTool));
    registry.register(Box::new(GitLogTool));
    registry.register(Box::new(TodoReadTool));
    registry.register(Box::new(TodoWriteTool));
    registry.register(Box::new(ApplyPatchTool));
    registry.register(Box::new(WebSearchTool));
    registry.register(Box::new(FetchUrlTool));
    registry.register(Box::new(McpModelTool {
        blender_bridge_addr: blender_bridge_addr.map(String::from),
    }));
    registry
}

/// 描述：解析并执行单次 Python 工具调用，所有文件与命令均限制在沙盒目录内。
struct AgentToolDescriptor {
    name: &'static str,
    description: &'static str,
    params: &'static str,
    tags: &'static [&'static str],
    example: &'static str,
}

/// 描述：返回智能体内置工具目录，用于 tool_search 检索与能力发现。
fn builtin_tool_descriptors() -> &'static [AgentToolDescriptor] {
    &[
        AgentToolDescriptor {
            name: "read_text",
            description: "读取项目内文本文件",
            params: "path: string",
            tags: &["file", "read", "text"],
            example: r#"read_text("README.md")"#,
        },
        AgentToolDescriptor {
            name: "read_json",
            description: "读取并解析项目内 JSON 文件",
            params: "path: string",
            tags: &["file", "read", "json"],
            example: r#"read_json("package.json")"#,
        },
        AgentToolDescriptor {
            name: "write_text",
            description: "写入项目内文本文件",
            params: "path: string, content: string",
            tags: &["file", "write", "text"],
            example: r#"write_text("src/app.ts", "console.log('ok')\n")"#,
        },
        AgentToolDescriptor {
            name: "write_json",
            description: "写入项目内 JSON 文件",
            params: "path: string, data: object",
            tags: &["file", "write", "json"],
            example: r#"write_json("meta.json", {"name":"demo"})"#,
        },
        AgentToolDescriptor {
            name: "apply_patch",
            description: "按 unified diff 批量修改文件",
            params: "patch: string, check_only?: bool",
            tags: &["file", "patch", "edit", "diff"],
            example: r#"apply_patch("--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n-old\n+new\n", False)"#,
        },
        AgentToolDescriptor {
            name: "glob",
            description: "按 glob 模式列出文件",
            params: "pattern: string, max_results?: number",
            tags: &["file", "glob", "pattern"],
            example: r#"glob("src/**/*.rs", 200)"#,
        },
        AgentToolDescriptor {
            name: "list_dir",
            description: "列出项目目录结构",
            params: "path?: string",
            tags: &["file", "list", "tree"],
            example: r#"list_dir("src")"#,
        },
        AgentToolDescriptor {
            name: "mkdir",
            description: "创建目录（支持递归父目录）",
            params: "path: string",
            tags: &["file", "mkdir", "write"],
            example: r#"mkdir("tmp/output")"#,
        },
        AgentToolDescriptor {
            name: "stat",
            description: "读取文件或目录基础状态",
            params: "path: string",
            tags: &["file", "stat", "metadata"],
            example: r#"stat("Cargo.toml")"#,
        },
        AgentToolDescriptor {
            name: "search_files",
            description: "在项目内执行全文检索（优先 ripgrep）",
            params: "query: string, glob?: string, max_results?: number",
            tags: &["search", "code", "grep"],
            example: r#"search_files("run_agent", "crates/**/*.rs", 20)"#,
        },
        AgentToolDescriptor {
            name: "run_shell",
            description: "在项目沙盒中执行命令（含安全策略与超时）",
            params: "command: string, timeout_secs?: number",
            tags: &["shell", "exec", "command"],
            example: r#"run_shell("cargo test -p zodileap_agent_core", 120)"#,
        },
        AgentToolDescriptor {
            name: "git_status",
            description: "查看当前沙盒工作目录的 git 状态（包括未追踪、已修改和暂存的文件）",
            params: "none",
            tags: &["git", "status", "vcs"],
            example: r#"git_status()"#,
        },
        AgentToolDescriptor {
            name: "git_diff",
            description: "查看当前沙盒工作目录的 Git diff",
            params: "path?: string",
            tags: &["git", "diff", "vcs"],
            example: r#"git_diff("src/main.rs")"#,
        },
        AgentToolDescriptor {
            name: "git_log",
            description: "查看项目的 Git 提交日志历史",
            params: "limit?: number",
            tags: &["git", "log", "vcs"],
            example: r#"git_log(5)"#,
        },
        AgentToolDescriptor {
            name: "todo_read",
            description: "读取任务清单（支持跨轮次持续追踪）",
            params: "none",
            tags: &["todo", "plan", "task"],
            example: r#"todo_read()"#,
        },
        AgentToolDescriptor {
            name: "todo_write",
            description: "覆盖写入任务清单（列表）",
            params: "items: array<object>",
            tags: &["todo", "plan", "task"],
            example: r#"todo_write([{"id":"1","content":"实现接口","status":"in_progress"}])"#,
        },
        AgentToolDescriptor {
            name: "web_search",
            description: "联网搜索公开资料（标题、链接、摘要）",
            params: "query: string, limit?: number",
            tags: &["web", "search", "internet"],
            example: r#"web_search("rust tauri command best practices", 5)"#,
        },
        AgentToolDescriptor {
            name: "fetch_url",
            description: "抓取网页正文片段",
            params: "url: string, max_chars?: number",
            tags: &["web", "fetch", "http"],
            example: r#"fetch_url("https://example.com", 4000)"#,
        },
        AgentToolDescriptor {
            name: "tool_search",
            description: "搜索可用工具及参数说明",
            params: "query?: string, limit?: number",
            tags: &["tooling", "discover"],
            example: r#"tool_search("web", 5)"#,
        },
        AgentToolDescriptor {
            name: "mcp_model_tool",
            description: "调用模型 MCP 工具（构建启用时）",
            params: "action: string, params?: object",
            tags: &["mcp", "model", "bridge"],
            example: r#"mcp_model_tool("list_objects", {})"#,
        },
    ]
}

/// 描述：在工具目录中按关键词检索可用工具，避免每次把全量工具说明写入提示词。
pub(crate) fn tool_tool_search(args: &Value) -> Result<Value, ProtocolError> {
    let query = args
        .get("query")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("");
    let limit = parse_positive_usize_arg(args, "limit", 10, 100)?;
    let normalized_query = query.to_lowercase();
    let mut matched: Vec<Value> = Vec::new();

    for descriptor in builtin_tool_descriptors() {
        if !normalized_query.is_empty() {
            let tag_match = descriptor
                .tags
                .iter()
                .any(|tag| tag.to_lowercase().contains(normalized_query.as_str()));
            let text_match = descriptor
                .name
                .to_lowercase()
                .contains(normalized_query.as_str())
                || descriptor
                    .description
                    .to_lowercase()
                    .contains(normalized_query.as_str())
                || descriptor
                    .params
                    .to_lowercase()
                    .contains(normalized_query.as_str());
            if !(tag_match || text_match) {
                continue;
            }
        }
        matched.push(json!({
            "name": descriptor.name,
            "description": descriptor.description,
            "params": descriptor.params,
            "tags": descriptor.tags,
            "example": descriptor.example,
        }));
    }

    let total = matched.len();
    if matched.len() > limit {
        matched.truncate(limit);
    }

    Ok(json!({
        "query": query,
        "total": total,
        "tools": matched,
    }))
}


/// 描述：解析并返回可用 Python 解释器路径。
pub(crate) fn resolve_python_binary() -> Result<String, ProtocolError> {
    let mut candidates: Vec<String> = Vec::new();
    if let Some(bin) = env::var("ZODILEAP_PYTHON_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        candidates.push(bin);
    }
    candidates.push("python3".to_string());
    candidates.push("python".to_string());

    for bin in candidates {
        let output = Command::new(bin.as_str()).arg("--version").output();
        if output.is_ok() {
            return Ok(bin);
        }
    }

    Err(
        ProtocolError::new("core.agent.python.not_found", "未检测到可用 Python 解释器")
            .with_suggestion("请安装 Python3，或设置环境变量 ZODILEAP_PYTHON_BIN。"),
    )
}

/// 描述：解析沙盒根目录，默认使用当前工作目录并转换为绝对路径。
fn resolve_sandbox_root(workdir: Option<&str>) -> Result<PathBuf, ProtocolError> {
    let current_dir = env::current_dir().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.current_dir_failed",
            format!("读取当前目录失败: {}", err),
        )
    })?;
    let selected = workdir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| current_dir.clone());
    let absolute = if selected.is_absolute() {
        selected
    } else {
        current_dir.join(selected)
    };
    if !absolute.exists() || !absolute.is_dir() {
        return Err(ProtocolError::new(
            "core.agent.python.workdir_invalid",
            format!("工作目录无效: {}", absolute.to_string_lossy()),
        ));
    }
    Ok(absolute)
}

/// 描述：构建 Python 临时运行目录路径，目录名包含时间戳避免并发冲突。
#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::env;
    use std::path::{Path, PathBuf};
    use serde_json::json;
    use zodileap_mcp_common::now_millis;

    // 从 tools 模块导入公共类型
    use crate::tools::file::parse_search_line;
    use crate::tools::utils::{resolve_sandbox_path, resolve_executable_binary};
    use crate::tools::patch::{
        collect_patch_paths, validate_patch_paths_in_sandbox, ApplyPatchTool,
    };
    use crate::tools::shell::{
        collect_shell_command_names, evaluate_run_shell_policy_with_sets,
        validate_shell_paths_in_sandbox, RunShellTool,
    };
    use crate::tools::git::GitDiffTool;
    use crate::tools::todo::{TodoReadTool, TodoWriteTool};
    use crate::tools::web::{strip_html_tags, url_encode_component};
    use crate::tools::{AgentTool, ToolContext};
    use super::*;

    fn build_test_context<'a>(sandbox_root: &'a Path, policy: &'a crate::policy::AgentPolicy) -> ToolContext<'a> {
        ToolContext {
            trace_id: "test-trace".to_string(),
            sandbox_root,
            policy,
        }
    }

    /// 描述：验证 fenced Python 代码块能够被正确提取为可执行脚本。
    #[test]
    fn should_extract_python_script_from_fenced_block() {
        let raw = "```python\nprint('hello')\nfinish('ok')\n```";
        let script = extract_python_script(raw);
        assert!(script.contains("print('hello')"));
        assert!(script.contains("finish('ok')"));
    }

    /// 描述：验证沙盒路径解析会拒绝越界访问。
    #[test]
    fn should_reject_path_outside_sandbox() {
        let root = PathBuf::from("/tmp/zodileap-agent-test");
        let path = resolve_sandbox_path(&root, "../../etc/passwd");
        assert!(path.is_err());
    }

    /// 描述：验证 Python 沙盒可实际执行脚本并返回 finish 消息。
    #[test]
    fn should_execute_python_script_in_sandbox() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = env::temp_dir().join(format!("zodileap-agent-python-test-{}", now_millis()));
        fs::create_dir_all(&root).expect("create temp root");
        fs::write(root.join("hello.txt"), "hello").expect("seed test file");
        let script = r#"
items = list_dir(".")
if not isinstance(items, dict):
    raise RuntimeError("list_dir should return dict")
finish("python sandbox ok")
"#;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                blender_bridge_addr: None,
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session".to_string(),
            },
            &mut |_| {}
        )
        .expect("python script should execute successfully");
        assert_eq!(result.message, "python sandbox ok");
    }

    /// 描述：验证工具搜索可以按关键词返回匹配工具，避免全量工具说明重复注入。
    #[test]
    fn should_search_tools_by_keyword() {
        let result = tool_tool_search(&json!({"query":"web","limit":5})).expect("tool search ok");
        let tools = result
            .get("tools")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            tools.iter().any(|item| {
                item.get("name")
                    .and_then(|value| value.as_str())
                    .map(|name| name == "web_search" || name == "fetch_url")
                    .unwrap_or(false)
            }),
            "web 关键词应命中 web_search 或 fetch_url"
        );
    }

    /// 描述：验证工具目录检索可返回 glob 条目，保证文件匹配能力对模型可见。
    #[test]
    fn should_search_glob_tool_descriptor() {
        let result = tool_tool_search(&json!({"query":"glob","limit":10})).expect("tool search ok");
        let tools = result
            .get("tools")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            tools.iter().any(|item| {
                item.get("name")
                    .and_then(|value| value.as_str())
                    .map(|name| name == "glob")
                    .unwrap_or(false)
            }),
            "glob 关键词应命中 glob 工具"
        );
    }

    /// 描述：验证默认工具注册表已接入新增文件工具，避免声明与运行时能力不一致。
    #[test]
    fn should_register_extended_file_tools() {
        let registry = build_default_tool_registry(None);
        assert!(registry.get("write_json").is_some());
        assert!(registry.get("mkdir").is_some());
        assert!(registry.get("stat").is_some());
        assert!(registry.get("glob").is_some());
    }

    /// 描述：验证搜索行解析逻辑能正确拆解 path/line/content 三段信息。
    #[test]
    fn should_parse_search_line_payload() {
        let parsed = parse_search_line("src/main.rs:42:let value = 1;").expect("must parse");
        assert_eq!(
            parsed.get("path").and_then(|value| value.as_str()),
            Some("src/main.rs")
        );
        assert_eq!(
            parsed.get("line").and_then(|value| value.as_u64()),
            Some(42)
        );
    }

    /// 描述：验证 HTML 去标签逻辑会产出纯文本内容。
    #[test]
    fn should_strip_html_tags_to_plain_text() {
        let plain = strip_html_tags("<h1>Hello</h1><p>world &amp; rust</p>");
        assert!(plain.contains("Hello"));
        assert!(plain.contains("world & rust"));
    }

    /// 描述：验证 URL 编码会处理空格和特殊字符。
    #[test]
    fn should_encode_url_component() {
        let encoded = url_encode_component("rust tauri/cmd");
        assert_eq!(encoded, "rust+tauri%2Fcmd");
    }

    /// 描述：验证补丁路径提取会过滤 /dev/null 并去重。
    #[test]
    fn should_collect_patch_paths() {
        let patch = r#"
diff --git a/src/a.txt b/src/a.txt
--- a/src/a.txt
+++ b/src/a.txt
@@ -1 +1 @@
-old
+new
--- /dev/null
+++ src/new.txt
@@ -0,0 +1 @@
+hello
"#;
        let paths = collect_patch_paths(patch);
        assert!(paths.contains(&"src/a.txt".to_string()));
        assert!(paths.contains(&"src/new.txt".to_string()));
        assert_eq!(paths.len(), 2);
    }

    /// 描述：验证补丁路径校验会拒绝沙盒外路径。
    #[test]
    fn should_reject_patch_path_outside_sandbox() {
        let root = PathBuf::from("/tmp/zodileap-agent-test");
        let result = validate_patch_paths_in_sandbox(&["../../etc/passwd".to_string()], &root);
        assert!(result.is_err());
    }

    /// 描述：验证 apply_patch 工具可以在沙盒内创建新文件。
    #[test]
    fn should_apply_patch_in_sandbox() {
        if resolve_executable_binary("git", "--version").is_none() {
            return;
        }
        let root = env::temp_dir().join(format!("zodileap-agent-apply-patch-{}", now_millis()));
        fs::create_dir_all(&root).expect("create sandbox root");
        fs::write(root.join("hello.txt"), "old\n").expect("seed old file");
        let patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+hello\n";
        let policy = crate::policy::AgentPolicy::default();
        let context = build_test_context(root.as_path(), &policy);
        let result = ApplyPatchTool.execute(&json!({ "patch": patch }), context)
            .expect("apply patch should succeed");
        assert_eq!(
            result.get("success").and_then(|value| value.as_bool()),
            Some(true)
        );
        let content = fs::read_to_string(root.join("hello.txt")).expect("read patched file");
        assert_eq!(content, "hello\n");
    }

    /// 描述：验证 apply_patch 在 check_only 模式下仅预检查，不会实际改写文件。
    #[test]
    fn should_check_patch_without_apply() {
        if resolve_executable_binary("git", "--version").is_none() {
            return;
        }
        let root = env::temp_dir().join(format!("zodileap-agent-patch-check-{}", now_millis()));
        fs::create_dir_all(&root).expect("create sandbox root");
        fs::write(root.join("hello.txt"), "old\n").expect("seed old file");
        let patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+hello\n";
        let policy = crate::policy::AgentPolicy::default();
        let context = build_test_context(root.as_path(), &policy);
        let result = ApplyPatchTool.execute(
            &json!({ "patch": patch, "check_only": true }),
            context
        )
        .expect("patch check should succeed");
        assert_eq!(
            result.get("checked").and_then(|value| value.as_bool()),
            Some(true)
        );
        assert_eq!(
            result.get("applied").and_then(|value| value.as_bool()),
            Some(false)
        );
        let content = fs::read_to_string(root.join("hello.txt")).expect("read origin file");
        assert_eq!(content, "old\n");
    }

    /// 描述：验证任务清单工具可写入并读取同一份数据。
    #[test]
    fn should_write_and_read_todo_items() {
        let root = env::temp_dir().join(format!("zodileap-agent-todo-{}", now_millis()));
        fs::create_dir_all(&root).expect("create todo sandbox");
        let policy = crate::policy::AgentPolicy::default();

        let write_result = TodoWriteTool.execute(
            &json!({
                "items": [
                    { "id": "1", "content": "需求分析", "status": "completed" },
                    { "id": "2", "content": "实现代码", "status": "in_progress" }
                ]
            }),
            build_test_context(root.as_path(), &policy)
        )
        .expect("write todo should succeed");
        assert_eq!(
            write_result
                .get("success")
                .and_then(|value| value.as_bool()),
            Some(true)
        );

        let read_result = TodoReadTool.execute(
            &json!({}),
            build_test_context(root.as_path(), &policy)
        ).expect("read todo should succeed");
        assert_eq!(
            read_result.get("count").and_then(|value| value.as_u64()),
            Some(2)
        );
    }

    /// 描述：验证 run_shell 工具在超时时会返回 timed_out 状态且不中断测试进程。
    #[test]
    fn should_timeout_run_shell() {
        let root = env::temp_dir().join(format!("zodileap-agent-run-shell-{}", now_millis()));
        fs::create_dir_all(&root).expect("create shell sandbox");
        #[cfg(target_os = "windows")]
        let command = "ping -n 3 127.0.0.1 > nul";
        #[cfg(not(target_os = "windows"))]
        let command = "sleep 2";

        let policy = crate::policy::AgentPolicy {
            tool_timeout_secs: 1,
            ..Default::default()
        };

        let result = RunShellTool.execute(
            &json!({
                "command": command,
                "timeout_secs": 1
            }),
            build_test_context(root.as_path(), &policy)
        )
        .expect("run_shell should return timeout payload");
        assert_eq!(
            result.get("timed_out").and_then(|value| value.as_bool()),
            Some(true)
        );
        assert_eq!(
            result.get("success").and_then(|value| value.as_bool()),
            Some(false)
        );
    }

    /// 描述：验证 run_shell 摘要会读取 status 字段作为退出码，避免展示错误的 0 退出码。
    #[test]
    fn should_summarize_run_shell_using_status_code() {
        let summary = summarize_tool_result(
            "run_shell",
            true,
            &json!({
                "status": 7,
                "stdout": "",
                "stderr": "failed",
            }),
        );
        assert!(summary.contains("退出码: 7"));
    }

    /// 描述：验证 run_shell 超时摘要不会误展示退出码，避免把超时误导为成功执行。
    #[test]
    fn should_summarize_timed_out_run_shell_without_fake_exit_code() {
        let summary = summarize_tool_result(
            "run_shell",
            true,
            &json!({
                "stdout": "",
                "stderr": "",
                "status": null,
                "timed_out": true,
                "timeout_secs": 30
            }),
        );
        assert!(summary.contains("执行超时（30s）"));
        assert!(!summary.contains("退出码"));
    }

    /// 描述：验证批量脚本载荷长度字段按字符数计算，避免非 ASCII 脚本在沙盒读取时卡住。
    #[test]
    fn should_build_batch_payload_with_unicode_char_length() {
        let script = "print('中文')\nfinish('ok')";
        let payload = build_batch_payload(script);
        let mut lines = payload.lines();
        let header = lines.next().unwrap_or_default();
        let body = lines.collect::<Vec<&str>>().join("\n");
        assert_eq!(header, format!("{}{}", BATCH_SIZE_PREFIX, script.chars().count()));
        assert_eq!(body, script);
    }

    /// 描述：验证命令分段解析能提取每段的真实可执行命令名。
    #[test]
    fn should_collect_shell_command_names_from_segments() {
        let names = collect_shell_command_names(
            "FOO=1 env BAR=2 git status && echo ok | rg ok; cargo test",
        );
        assert_eq!(
            names,
            vec![
                "git".to_string(),
                "echo".to_string(),
                "rg".to_string(),
                "cargo".to_string()
            ]
        );
    }

    /// 描述：验证黑名单命令会被 run_shell 安全策略拒绝。
    #[test]
    fn should_reject_blacklisted_shell_command() {
        let allowlist: HashSet<String> = HashSet::new();
        let mut denylist: HashSet<String> = HashSet::new();
        denylist.insert("rm".to_string());
        let result = evaluate_run_shell_policy_with_sets("rm -rf ./tmp", &allowlist, &denylist);
        assert!(result.is_err());
        let error = result.expect_err("should reject blacklisted command");
        assert_eq!(error.code, "core.agent.python.run_shell.command_blocked");
    }

    /// 描述：验证白名单模式下只允许显式声明的命令执行。
    #[test]
    fn should_enforce_shell_allowlist() {
        let mut allowlist: HashSet<String> = HashSet::new();
        allowlist.insert("git".to_string());
        let denylist: HashSet<String> = HashSet::new();
        let result = evaluate_run_shell_policy_with_sets("git status && ls", &allowlist, &denylist);
        assert!(result.is_err());
        let error = result.expect_err("should reject non-allowlisted command");
        assert_eq!(
            error.code,
            "core.agent.python.run_shell.command_not_allowed"
        );
    }

    /// 描述：验证 run_shell 路径校验会接受沙盒内路径参数并返回归一化路径。
    #[test]
    fn should_validate_shell_paths_in_sandbox() {
        let root = PathBuf::from("/tmp/zodileap-agent-shell-path-ok");
        let paths =
            validate_shell_paths_in_sandbox("cat ./src/main.rs --output=dist/app.js", &root)
                .expect("paths in sandbox should pass");
        assert!(paths.iter().any(|value| value.ends_with("/src/main.rs")));
        assert!(paths.iter().any(|value| value.ends_with("/dist/app.js")));
    }

    /// 描述：验证 run_shell 路径校验会拒绝访问沙盒外路径。
    #[test]
    fn should_reject_shell_path_outside_sandbox() {
        let root = PathBuf::from("/tmp/zodileap-agent-shell-path-block");
        let result = validate_shell_paths_in_sandbox("cat ../outside.txt", &root);
        assert!(result.is_err());
        let error = result.expect_err("outside sandbox path should fail");
        assert_eq!(
            error.code,
            "core.agent.python.run_shell.path_outside_sandbox"
        );
    }

    /// 描述：验证 run_shell 路径校验会拒绝变量展开路径，避免绕过沙盒限制。
    #[test]
    fn should_reject_dynamic_shell_path() {
        let root = PathBuf::from("/tmp/zodileap-agent-shell-path-var");
        let result = validate_shell_paths_in_sandbox("cat $HOME/.ssh/id_rsa", &root);
        assert!(result.is_err());
        let error = result.expect_err("dynamic path should fail");
        assert_eq!(
            error.code,
            "core.agent.python.run_shell.dynamic_path_forbidden"
        );
    }

    /// 描述：验证非 Git 仓库执行 git_diff 时会返回失败错误，避免被静默为“无差异”。
    #[test]
    fn should_fail_git_diff_outside_repository() {
        let root = env::temp_dir().join(format!("zodileap-agent-git-diff-{}", now_millis()));
        fs::create_dir_all(&root).expect("create git diff sandbox");
        let policy = crate::policy::AgentPolicy::default();

        let result = GitDiffTool.execute(
            &json!({}),
            build_test_context(root.as_path(), &policy),
        );
        assert!(result.is_err());
        let error = result.expect_err("git diff outside repository should fail");
        assert_eq!(error.code, "core.agent.python.git_diff.failed");
    }

    /// 描述：验证人工授权超时分支会产出 timeout 事件与专用错误码，避免与主动拒绝混淆。
    #[test]
    fn should_map_approval_timeout_to_timeout_payload() {
        let (event_name, reject_message, reject_code) = resolve_approval_reject_payload(true);
        assert_eq!(event_name, "approval_timeout");
        assert_eq!(reject_message, "授权等待超时，操作已取消");
        assert_eq!(reject_code, "core.agent.human_approval_timeout");
    }

    /// 描述：验证人工授权主动拒绝分支会产出 rejected 事件与拒绝错误码。
    #[test]
    fn should_map_approval_reject_to_rejected_payload() {
        let (event_name, reject_message, reject_code) = resolve_approval_reject_payload(false);
        assert_eq!(event_name, "approval_rejected");
        assert_eq!(reject_message, "操作已被用户拒绝");
        assert_eq!(reject_code, "core.agent.human_refused");
    }
}
