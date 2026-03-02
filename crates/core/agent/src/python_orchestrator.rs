use crate::flow::build_system_prompt;
use crate::llm::{call_model_with_stream, parse_provider};
use crate::{AgentRunRequest, AgentRunResult, AgentStreamEvent};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use zodileap_mcp_common::{
    now_millis, ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord,
    ProtocolStepStatus,
};

const TOOL_CALL_PREFIX: &str = "__AGENT_TOOL_CALL__";
const TOOL_RESULT_PREFIX: &str = "__AGENT_TOOL_RESULT__";
const FINAL_RESULT_PREFIX: &str = "__AGENT_FINAL__";
const DEFAULT_PYTHON_WORKFLOW_TIMEOUT_SECS: u64 = 300;

const PYTHON_RUNTIME_PRELUDE: &str = r#"import json
import sys

_TOOL_CALL_PREFIX = "__AGENT_TOOL_CALL__"
_TOOL_RESULT_PREFIX = "__AGENT_TOOL_RESULT__"
_FINAL_RESULT_PREFIX = "__AGENT_FINAL__"


def _invoke_tool(name, args=None):
    payload = {
        "name": str(name),
        "args": args if isinstance(args, dict) else {},
    };
    sys.stdout.write(_TOOL_CALL_PREFIX + json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("tool bridge closed")
    if not line.startswith(_TOOL_RESULT_PREFIX):
        raise RuntimeError("invalid tool result frame")
    result = json.loads(line[len(_TOOL_RESULT_PREFIX):])
    if not result.get("ok", False):
        raise RuntimeError(str(result.get("error", "tool call failed")))
    return result.get("data")


def read_text(path):
    return _invoke_tool("read_text", {"path": path})


def write_text(path, content):
    return _invoke_tool("write_text", {"path": path, "content": content})


def apply_patch(patch, check_only=False):
    return _invoke_tool(
        "apply_patch",
        {"patch": patch, "check_only": bool(check_only)},
    )


def list_dir(path="."):
    return _invoke_tool("list_dir", {"path": path})


def run_shell(command, timeout_secs=30):
    return _invoke_tool(
        "run_shell",
        {"command": command, "timeout_secs": int(timeout_secs)},
    )


def search_files(query, glob="", max_results=50):
    return _invoke_tool(
        "search_files",
        {"query": query, "glob": glob, "max_results": int(max_results)},
    )


def tool_search(query="", limit=10):
    return _invoke_tool("tool_search", {"query": query, "limit": int(limit)})


def web_search(query, limit=5):
    return _invoke_tool("web_search", {"query": query, "limit": int(limit)})


def fetch_url(url, max_chars=8000):
    return _invoke_tool("fetch_url", {"url": url, "max_chars": int(max_chars)})


def todo_read():
    return _invoke_tool("todo_read", {})


def todo_write(items):
    return _invoke_tool("todo_write", {"items": items})


def mcp_model_tool(action, params=None):
    payload = {"action": action}
    if isinstance(params, dict):
        payload["params"] = params
    return _invoke_tool("mcp_model_tool", payload)


def finish(message):
    payload = {"message": str(message)}
    sys.stdout.write(_FINAL_RESULT_PREFIX + json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
"#;

#[derive(Debug)]
enum PythonRunnerOutput {
    Stdout(String),
    Stderr(String),
}

#[derive(Debug)]
struct PythonScriptExecutionResult {
    message: String,
    actions: Vec<String>,
    events: Vec<ProtocolEventRecord>,
    assets: Vec<ProtocolAssetRecord>,
}

/// 描述：执行代码智能体的 Python 单策略编排流程，包含代码生成与沙盒执行。
///
/// Params:
///
///   - request: 智能体请求参数，包含 provider、用户输入与工作目录。
///   - on_stream_event: 流式事件回调，用于向上层持续发送 LLM 增量文本。
///
/// Returns:
///
///   - 成功时返回结构化执行结果；失败时返回协议错误。
pub fn run_code_agent_with_python_workflow<F>(
    request: AgentRunRequest,
    on_stream_event: &mut F,
) -> Result<AgentRunResult, ProtocolError>
where
    F: FnMut(AgentStreamEvent),
{
    let provider = parse_provider(&request.provider);
    on_stream_event(AgentStreamEvent::LlmStarted {
        provider: request.provider.clone(),
    });

    let script_prompt =
        build_python_workflow_prompt(&request.prompt, request.project_name.as_deref());
    let llm_started_at = now_millis();
    let script_output = call_model_with_stream(
        provider,
        script_prompt.as_str(),
        request.workdir.as_deref(),
        &mut |chunk| {
            on_stream_event(AgentStreamEvent::LlmDelta {
                content: chunk.to_string(),
            });
        },
    )
    .map_err(|err| err.to_protocol_error())?;

    on_stream_event(AgentStreamEvent::LlmFinished {
        provider: request.provider.clone(),
    });

    let extracted_script = extract_python_script(script_output.as_str());
    if extracted_script.trim().is_empty() {
        return Err(ProtocolError::new(
            "core.agent.python.empty_script",
            "模型未返回可执行 Python 脚本",
        )
        .with_suggestion("请重试，或调整提示词让模型直接输出 Python 代码。"));
    };

    let mut steps: Vec<ProtocolStepRecord> = vec![ProtocolStepRecord {
        index: 0,
        code: "llm_python_codegen".to_string(),
        status: ProtocolStepStatus::Success,
        elapsed_ms: now_millis().saturating_sub(llm_started_at),
        summary: format!("provider={} 已生成 Python 编排脚本", request.provider),
        error: None,
        data: Some(json!({
            "script_length": extracted_script.chars().count(),
        })),
    }];
    let mut events: Vec<ProtocolEventRecord> = vec![ProtocolEventRecord {
        event: "llm_python_codegen_finished".to_string(),
        step_index: Some(0),
        timestamp_ms: now_millis(),
        message: "Python 编排脚本生成完成".to_string(),
    }];

    let run_started_at = Instant::now();
    let execution_result = execute_python_script(
        extracted_script.as_str(),
        request.workdir.as_deref(),
        request.blender_bridge_addr.as_deref(),
    )?;

    let python_step_index = steps.len();
    steps.push(ProtocolStepRecord {
        index: python_step_index,
        code: "python_workflow_execute".to_string(),
        status: ProtocolStepStatus::Success,
        elapsed_ms: run_started_at.elapsed().as_millis(),
        summary: "Python 编排脚本执行完成".to_string(),
        error: None,
        data: Some(json!({
            "actions": execution_result.actions,
        })),
    });
    events.push(ProtocolEventRecord {
        event: "python_workflow_execute_finished".to_string(),
        step_index: Some(python_step_index),
        timestamp_ms: now_millis(),
        message: "Python 沙盒执行完成".to_string(),
    });
    events.extend(execution_result.events);

    Ok(AgentRunResult {
        message: execution_result.message,
        actions: execution_result.actions,
        exported_file: None,
        steps,
        events,
        assets: execution_result.assets,
        ui_hint: None,
    })
}

/// 描述：构建 Python 编排提示词，要求模型只输出可执行脚本并通过工具函数完成任务。
///
/// Params:
///
///   - user_prompt: 用户原始输入。
///   - project_name: 可选项目名，用于辅助模型理解当前上下文。
///
/// Returns:
///
///   - Python 编排提示词。
fn build_python_workflow_prompt(user_prompt: &str, project_name: Option<&str>) -> String {
    let project_name_text = project_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名项目");
    let system_prompt = build_system_prompt(crate::flow::AgentKind::Code);

    format!(
        "{system_prompt}\n\
你必须输出一段可直接执行的 Python3 代码，禁止输出 Markdown、解释文字和代码块围栏。\n\
当前项目：{project_name_text}\n\
可用工具函数（已注入运行时）：\n\
- read_text(path): 读取文本文件。\n\
- write_text(path, content): 写入文本文件。\n\
- apply_patch(patch, check_only=False): 以 unified diff 形式批量修改文件（支持仅预检查）。\n\
- list_dir(path='.'): 列出目录。\n\
- run_shell(command, timeout_secs=30): 在项目沙盒目录执行 shell 命令（带超时）。\n\
- search_files(query, glob='', max_results=50): 在项目内全文检索。\n\
- tool_search(query='', limit=10): 查询可用工具清单与参数说明。\n\
- web_search(query, limit=5): 联网搜索公开资料（结果标题/链接/摘要）。\n\
- fetch_url(url, max_chars=8000): 抓取网页正文片段。\n\
- todo_read(): 读取任务清单。\n\
- todo_write(items): 覆盖写入任务清单（列表）。\n\
- mcp_model_tool(action, params=None): 调用模型 MCP 工具（若构建启用）。\n\
- finish(message): 输出最终结果并结束。\n\
强约束：\n\
1. 所有路径必须使用项目目录内相对路径。\n\
2. 必须至少调用一次 finish(message)。\n\
3. 若工具调用失败，你需要在 Python 中捕获异常并返回可读错误。\n\
4. 开始复杂任务前优先调用 tool_search() 获取工具能力，再决定调用顺序。\n\
5. run_shell 会执行安全策略校验，禁止高风险命令；必要时改用文件工具与 apply_patch。\n\
6. 仅返回 Python 代码。\n\
用户需求：\n{user_prompt}"
    )
}

/// 描述：从模型返回文本中提取 Python 脚本正文，兼容 fenced code block 场景。
///
/// Params:
///
///   - raw: 模型原始返回文本。
///
/// Returns:
///
///   - 去除围栏后的 Python 代码。
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

/// 描述：执行 Python 脚本并通过标准输入输出桥接工具调用，限制在工作目录沙盒内。
///
/// Params:
///
///   - user_script: LLM 产出的 Python 脚本。
///   - workdir: 执行工作目录。
///   - blender_bridge_addr: 可选模型工具桥接地址（预留）。
///
/// Returns:
///
///   - Python 执行结果，包括最终消息、动作列表、事件与资产。
fn execute_python_script(
    user_script: &str,
    workdir: Option<&str>,
    blender_bridge_addr: Option<&str>,
) -> Result<PythonScriptExecutionResult, ProtocolError> {
    let python_bin = resolve_python_binary()?;
    let sandbox_root = resolve_sandbox_root(workdir)?;
    let timeout_secs = resolve_python_timeout_secs();

    let runtime_dir = build_python_runtime_dir();
    fs::create_dir_all(&runtime_dir).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.runtime_dir_create_failed",
            format!("创建 Python 运行目录失败: {}", err),
        )
    })?;

    let script_path = runtime_dir.join("agent_workflow.py");
    let composed_script = format!("{}\n\n{}\n", PYTHON_RUNTIME_PRELUDE, user_script.trim());
    fs::write(&script_path, composed_script).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.script_write_failed",
            format!("写入 Python 脚本失败: {}", err),
        )
    })?;

    let mut command = Command::new(&python_bin);
    command
        .arg("-I")
        .arg(script_path.to_string_lossy().to_string())
        .current_dir(&sandbox_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONUNBUFFERED", "1");

    let mut child = command.spawn().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.spawn_failed",
            format!("启动 Python 运行时失败: {}", err),
        )
        .with_suggestion("请确认系统已安装 Python3，或设置 ZODILEAP_PYTHON_BIN。")
    })?;

    let mut child_stdin = child.stdin.take().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.python.stdin_missing",
            "Python 进程标准输入不可用",
        )
    })?;
    let child_stdout = child.stdout.take().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.python.stdout_missing",
            "Python 进程标准输出不可用",
        )
    })?;
    let child_stderr = child.stderr.take().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.python.stderr_missing",
            "Python 进程标准错误不可用",
        )
    })?;

    let (tx, rx) = mpsc::channel::<PythonRunnerOutput>();
    let stdout_reader = spawn_python_output_reader(child_stdout, true, tx.clone());
    let stderr_reader = spawn_python_output_reader(child_stderr, false, tx);

    let started = Instant::now();
    let timeout = Duration::from_secs(timeout_secs.max(1));
    let mut stderr_text = String::new();
    let mut plain_stdout_lines: Vec<String> = Vec::new();
    let mut final_message: Option<String> = None;
    let mut actions: Vec<String> = Vec::new();
    let mut events: Vec<ProtocolEventRecord> = Vec::new();

    loop {
        match rx.recv_timeout(Duration::from_millis(40)) {
            Ok(PythonRunnerOutput::Stdout(line)) => {
                if let Some(payload) = line.strip_prefix(TOOL_CALL_PREFIX) {
                    let tool_response = execute_python_tool_call(
                        payload,
                        &sandbox_root,
                        blender_bridge_addr,
                        &mut actions,
                        &mut events,
                    );
                    let response_line = match tool_response {
                        Ok(data) => format!(
                            "{}{}\n",
                            TOOL_RESULT_PREFIX,
                            json!({"ok": true, "data": data})
                        ),
                        Err(error) => format!(
                            "{}{}\n",
                            TOOL_RESULT_PREFIX,
                            json!({"ok": false, "error": error.message, "code": error.code})
                        ),
                    };
                    child_stdin
                        .write_all(response_line.as_bytes())
                        .map_err(|err| {
                            ProtocolError::new(
                                "core.agent.python.stdin_write_failed",
                                format!("回写工具执行结果失败: {}", err),
                            )
                        })?;
                    child_stdin.flush().map_err(|err| {
                        ProtocolError::new(
                            "core.agent.python.stdin_flush_failed",
                            format!("刷新工具执行结果失败: {}", err),
                        )
                    })?;
                    continue;
                }
                if let Some(payload) = line.strip_prefix(FINAL_RESULT_PREFIX) {
                    if let Ok(raw) = serde_json::from_str::<Value>(payload) {
                        if let Some(message) = raw.get("message").and_then(|value| value.as_str()) {
                            final_message = Some(message.to_string());
                        }
                    }
                    continue;
                }
                if !line.trim().is_empty() {
                    plain_stdout_lines.push(line);
                }
            }
            Ok(PythonRunnerOutput::Stderr(line)) => {
                if !line.trim().is_empty() {
                    stderr_text.push_str(line.as_str());
                    stderr_text.push('\n');
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                while let Ok(output) = rx.try_recv() {
                    match output {
                        PythonRunnerOutput::Stdout(line) => {
                            if !line.trim().is_empty() {
                                plain_stdout_lines.push(line);
                            }
                        }
                        PythonRunnerOutput::Stderr(line) => {
                            if !line.trim().is_empty() {
                                stderr_text.push_str(line.as_str());
                                stderr_text.push('\n');
                            }
                        }
                    }
                }
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();

                if !status.success() {
                    let stderr_summary = if stderr_text.trim().is_empty() {
                        "Python 编排脚本执行失败".to_string()
                    } else {
                        stderr_text.trim().to_string()
                    };
                    return Err(ProtocolError::new(
                        "core.agent.python.exec_failed",
                        stderr_summary,
                    )
                    .with_suggestion("请检查脚本逻辑或工具调用参数后重试。"));
                }

                let message = final_message
                    .or_else(|| {
                        let joined = plain_stdout_lines.join("\n");
                        let value = joined.trim();
                        if value.is_empty() {
                            None
                        } else {
                            Some(value.to_string())
                        }
                    })
                    .unwrap_or_else(|| "Python 编排执行完成。".to_string());

                let assets = vec![ProtocolAssetRecord {
                    kind: "python_workflow_script".to_string(),
                    path: script_path.to_string_lossy().to_string(),
                    version: now_millis() as u64,
                    meta: Some(json!({
                        "python_bin": python_bin,
                        "sandbox_root": sandbox_root.to_string_lossy().to_string(),
                    })),
                }];

                return Ok(PythonScriptExecutionResult {
                    message,
                    actions,
                    events,
                    assets,
                });
            }
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(ProtocolError::new(
                        "core.agent.python.timeout",
                        format!("Python 编排脚本执行超时（{}s）", timeout_secs),
                    )
                    .with_suggestion("请缩短任务复杂度，或提高 ZODILEAP_PYTHON_TIMEOUT_SECS。")
                    .with_retryable(true));
                }
                thread::sleep(Duration::from_millis(60));
            }
            Err(err) => {
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(ProtocolError::new(
                    "core.agent.python.wait_failed",
                    format!("等待 Python 进程结束失败: {}", err),
                ));
            }
        }
    }
}

/// 描述：解析并执行单次 Python 工具调用，所有文件与命令均限制在沙盒目录内。
///
/// Params:
///
///   - payload: Python 输出的工具调用 JSON 载荷。
///   - sandbox_root: 沙盒根目录。
///   - blender_bridge_addr: 预留的模型桥接地址。
///   - actions: 动作列表累积容器。
///   - events: 协议事件累积容器。
///
/// Returns:
///
///   - 成功时返回 JSON 数据对象；失败时返回协议错误。
fn execute_python_tool_call(
    payload: &str,
    sandbox_root: &Path,
    blender_bridge_addr: Option<&str>,
    actions: &mut Vec<String>,
    events: &mut Vec<ProtocolEventRecord>,
) -> Result<Value, ProtocolError> {
    let parsed: Value = serde_json::from_str(payload).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.tool_payload_invalid",
            format!("工具调用载荷解析失败: {}", err),
        )
    })?;
    let name = parsed
        .get("name")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ProtocolError::new("core.agent.python.tool_name_missing", "工具调用缺少 name")
        })?;
    let args = parsed.get("args").cloned().unwrap_or_else(|| json!({}));

    let result = match name {
        "read_text" => tool_read_text(&args, sandbox_root),
        "write_text" => tool_write_text(&args, sandbox_root),
        "apply_patch" => tool_apply_patch(&args, sandbox_root),
        "list_dir" => tool_list_dir(&args, sandbox_root),
        "run_shell" => tool_run_shell(&args, sandbox_root),
        "search_files" => tool_search_files(&args, sandbox_root),
        "tool_search" => tool_tool_search(&args),
        "web_search" => tool_web_search(&args),
        "fetch_url" => tool_fetch_url(&args),
        "todo_read" => tool_todo_read(sandbox_root),
        "todo_write" => tool_todo_write(&args, sandbox_root),
        "mcp_model_tool" => tool_mcp_model_tool(&args, blender_bridge_addr),
        other => Err(ProtocolError::new(
            "core.agent.python.tool_unsupported",
            format!("不支持的工具调用: {}", other),
        )),
    }?;

    actions.push(name.to_string());
    events.push(ProtocolEventRecord {
        event: "python_tool_call".to_string(),
        step_index: None,
        timestamp_ms: now_millis(),
        message: format!("tool={} executed", name),
    });
    Ok(result)
}

/// 描述：读取文本文件工具实现，路径必须位于工作目录沙盒范围内。
fn tool_read_text(args: &Value, sandbox_root: &Path) -> Result<Value, ProtocolError> {
    let path = get_required_string(args, "path", "core.agent.python.read_text.path_missing")?;
    let target = resolve_sandbox_path(sandbox_root, path.as_str())?;
    let content = fs::read_to_string(&target).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.read_text_failed",
            format!("读取文件失败: {}", err),
        )
    })?;
    Ok(json!({
        "path": target.to_string_lossy().to_string(),
        "content": content,
    }))
}

/// 描述：写入文本文件工具实现，路径必须位于工作目录沙盒范围内。
fn tool_write_text(args: &Value, sandbox_root: &Path) -> Result<Value, ProtocolError> {
    let path = get_required_string(args, "path", "core.agent.python.write_text.path_missing")?;
    let content = get_required_raw_string(
        args,
        "content",
        "core.agent.python.write_text.content_missing",
    )?;
    let target = resolve_sandbox_path(sandbox_root, path.as_str())?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.write_text_parent_failed",
                format!("创建目录失败: {}", err),
            )
        })?;
    }
    fs::write(&target, content.as_bytes()).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.write_text_failed",
            format!("写入文件失败: {}", err),
        )
    })?;
    Ok(json!({
        "path": target.to_string_lossy().to_string(),
        "bytes": content.as_bytes().len(),
    }))
}

/// 描述：应用 unified diff 补丁到沙盒目录，适合一次修改多个文件。
fn tool_apply_patch(args: &Value, sandbox_root: &Path) -> Result<Value, ProtocolError> {
    let patch_text =
        get_required_raw_string(args, "patch", "core.agent.python.apply_patch.patch_missing")?;
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
    validate_patch_paths_in_sandbox(paths.as_slice(), sandbox_root)?;

    let git_bin = resolve_executable_binary("git", "--version").ok_or_else(|| {
        ProtocolError::new(
            "core.agent.python.apply_patch.git_missing",
            "未检测到可用 git，无法应用补丁",
        )
        .with_suggestion("请安装 git 后重试。")
    })?;

    let runtime_dir = build_python_runtime_dir();
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
        .current_dir(sandbox_root);
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
            "patch_bytes": patch_text.as_bytes().len(),
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
        .current_dir(sandbox_root);
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
        "patch_bytes": patch_text.as_bytes().len(),
        "checked": true,
        "applied": true,
        "success": true,
    }))
}

/// 描述：列出目录工具实现，路径必须位于工作目录沙盒范围内。
fn tool_list_dir(args: &Value, sandbox_root: &Path) -> Result<Value, ProtocolError> {
    let path = args
        .get("path")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(".");
    let target = resolve_sandbox_path(sandbox_root, path)?;
    let mut entries: Vec<Value> = Vec::new();
    let read_dir = fs::read_dir(&target).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.list_dir_failed",
            format!("读取目录失败: {}", err),
        )
    })?;
    for item in read_dir {
        let entry = item.map_err(|err| {
            ProtocolError::new(
                "core.agent.python.list_dir_entry_failed",
                format!("读取目录项失败: {}", err),
            )
        })?;
        let path = entry.path();
        let metadata = entry.metadata().ok();
        entries.push(json!({
            "name": path.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_default(),
            "path": path.to_string_lossy().to_string(),
            "is_dir": metadata.as_ref().map(|meta| meta.is_dir()).unwrap_or(false),
            "is_file": metadata.as_ref().map(|meta| meta.is_file()).unwrap_or(false),
        }));
    }
    Ok(json!({
        "path": target.to_string_lossy().to_string(),
        "entries": entries,
    }))
}

/// 描述：执行 shell 命令工具实现，命令在沙盒根目录内执行并返回输出。
fn tool_run_shell(args: &Value, sandbox_root: &Path) -> Result<Value, ProtocolError> {
    let command_text = get_required_string(
        args,
        "command",
        "core.agent.python.run_shell.command_missing",
    )?;
    let timeout_secs = parse_positive_usize_arg(args, "timeout_secs", 30, 600)? as u64;
    let command_names = evaluate_run_shell_policy(command_text.as_str())?;
    let validated_paths = validate_shell_paths_in_sandbox(command_text.as_str(), sandbox_root)?;

    #[cfg(target_os = "windows")]
    let command = {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C")
            .arg(command_text.as_str())
            .current_dir(sandbox_root);
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    let command = {
        let mut cmd = Command::new("/bin/zsh");
        cmd.arg("-lc")
            .arg(command_text.as_str())
            .current_dir(sandbox_root);
        cmd
    };

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

/// 描述：读取任务清单文件，若不存在则返回空列表。
fn tool_todo_read(sandbox_root: &Path) -> Result<Value, ProtocolError> {
    let todo_path = resolve_todo_file_path(sandbox_root);
    if !todo_path.exists() {
        return Ok(json!({
            "path": todo_path.to_string_lossy().to_string(),
            "items": [],
            "count": 0,
        }));
    }
    let content = fs::read_to_string(&todo_path).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.todo.read_failed",
            format!("读取任务清单失败: {}", err),
        )
    })?;
    let parsed: Value = serde_json::from_str(content.as_str()).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.todo.parse_failed",
            format!("解析任务清单失败: {}", err),
        )
    })?;
    let items = parsed
        .get("items")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(json!({
        "path": todo_path.to_string_lossy().to_string(),
        "items": items,
        "count": items.len(),
    }))
}

/// 描述：覆盖写入任务清单文件，要求 items 为数组结构。
fn tool_todo_write(args: &Value, sandbox_root: &Path) -> Result<Value, ProtocolError> {
    let items = args
        .get("items")
        .and_then(|value| value.as_array())
        .cloned()
        .ok_or_else(|| {
            ProtocolError::new(
                "core.agent.python.todo.items_invalid",
                "todo_write 的 items 必须是数组",
            )
        })?;
    let todo_path = resolve_todo_file_path(sandbox_root);
    let payload = json!({
        "updated_at": now_millis(),
        "items": items,
    });
    let pretty = serde_json::to_string_pretty(&payload).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.todo.serialize_failed",
            format!("序列化任务清单失败: {}", err),
        )
    })?;
    fs::write(&todo_path, pretty.as_bytes()).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.todo.write_failed",
            format!("写入任务清单失败: {}", err),
        )
    })?;
    Ok(json!({
        "path": todo_path.to_string_lossy().to_string(),
        "count": payload.get("items").and_then(|value| value.as_array()).map(|value| value.len()).unwrap_or(0),
        "success": true,
    }))
}

/// 描述：执行 run_shell 前的安全策略校验，支持环境变量白名单/黑名单扩展。
///
/// Params:
///
///   - command_text: shell 命令文本。
///
/// Returns:
///
///   - 返回解析后的命令名列表（按分段顺序）。
fn evaluate_run_shell_policy(command_text: &str) -> Result<Vec<String>, ProtocolError> {
    let allowlist = parse_command_set_from_env("ZODILEAP_AGENT_RUN_SHELL_ALLOWLIST");
    let mut denylist = default_run_shell_denylist();
    denylist.extend(parse_command_set_from_env(
        "ZODILEAP_AGENT_RUN_SHELL_DENYLIST",
    ));
    evaluate_run_shell_policy_with_sets(command_text, &allowlist, &denylist)
}

/// 描述：根据给定白名单/黑名单校验命令是否允许执行，用于生产逻辑与测试复用。
fn evaluate_run_shell_policy_with_sets(
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
fn collect_shell_command_names(command_text: &str) -> Vec<String> {
    split_shell_segments(command_text)
        .iter()
        .filter_map(|segment| extract_executable_from_segment(segment.as_str()))
        .collect()
}

/// 描述：校验 shell 命令中的路径参数必须落在沙盒内，并返回归一化路径用于审计。
fn validate_shell_paths_in_sandbox(
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
        for index in (command_index + 1)..tokens.len() {
            let token = tokens[index].as_str();
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
fn split_shell_segments(command_text: &str) -> Vec<String> {
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
fn locate_segment_executable_index(tokens: &[String]) -> Option<usize> {
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
fn normalize_shell_path_input(token: &str) -> String {
    let mut raw = token
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    if let Some(value) = raw.strip_prefix("file://") {
        raw = value.to_string();
    }
    let wildcard_pos = raw
        .find(|ch| matches!(ch, '*' | '?' | '['))
        .unwrap_or(raw.len());
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
fn tokenize_shell_words(raw: &str) -> Vec<String> {
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

#[derive(Debug)]
struct CommandExecutionOutput {
    status_code: Option<i32>,
    success: bool,
    stdout: String,
    stderr: String,
    timed_out: bool,
    elapsed_ms: u128,
}

/// 描述：以超时控制方式执行命令并捕获 stdout/stderr，避免工具调用被长任务阻塞。
fn execute_command_with_timeout(
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

#[derive(Clone, Copy)]
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
            name: "write_text",
            description: "写入项目内文本文件",
            params: "path: string, content: string",
            tags: &["file", "write", "text"],
            example: r#"write_text("src/app.ts", "console.log('ok')\n")"#,
        },
        AgentToolDescriptor {
            name: "apply_patch",
            description: "按 unified diff 批量修改文件",
            params: "patch: string, check_only?: bool",
            tags: &["file", "patch", "edit", "diff"],
            example: r#"apply_patch("--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n-old\n+new\n", False)"#,
        },
        AgentToolDescriptor {
            name: "list_dir",
            description: "列出项目目录结构",
            params: "path?: string",
            tags: &["file", "list", "tree"],
            example: r#"list_dir("src")"#,
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
fn tool_tool_search(args: &Value) -> Result<Value, ProtocolError> {
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

/// 描述：在项目中执行全文检索，优先使用 ripgrep，未命中时回退 grep。
fn tool_search_files(args: &Value, sandbox_root: &Path) -> Result<Value, ProtocolError> {
    let query = get_required_string(
        args,
        "query",
        "core.agent.python.search_files.query_missing",
    )?;
    let glob = args
        .get("glob")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let max_results = parse_positive_usize_arg(args, "max_results", 50, 500)?;

    let matches = match resolve_executable_binary("rg", "--version") {
        Some(rg_bin) => run_rg_search(
            rg_bin.as_str(),
            sandbox_root,
            query.as_str(),
            glob.as_str(),
            max_results,
        )?,
        None => run_grep_search(sandbox_root, query.as_str(), glob.as_str(), max_results)?,
    };
    Ok(json!({
        "query": query,
        "glob": glob,
        "count": matches.len(),
        "matches": matches,
    }))
}

/// 描述：联网搜索公开网页并返回结构化结果，默认通过 DuckDuckGo Instant Answer API。
fn tool_web_search(args: &Value) -> Result<Value, ProtocolError> {
    let query = get_required_string(args, "query", "core.agent.python.web_search.query_missing")?;
    let limit = parse_positive_usize_arg(args, "limit", 5, 20)?;
    let curl_bin = resolve_executable_binary("curl", "--version").ok_or_else(|| {
        ProtocolError::new(
            "core.agent.python.web_search.curl_missing",
            "未检测到可用 curl",
        )
        .with_suggestion("请安装 curl 后重试。")
    })?;
    let encoded_query = url_encode_component(query.as_str());
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        encoded_query
    );
    let output = Command::new(curl_bin.as_str())
        .args(["-L", "-sS", "--max-time", "20", url.as_str()])
        .output()
        .map_err(|err| {
            ProtocolError::new(
                "core.agent.python.web_search.exec_failed",
                format!("执行联网搜索失败: {}", err),
            )
        })?;
    if !output.status.success() {
        return Err(ProtocolError::new(
            "core.agent.python.web_search.failed",
            "联网搜索请求失败",
        ));
    }
    let body = String::from_utf8_lossy(output.stdout.as_slice()).to_string();
    let parsed: Value = serde_json::from_str(body.as_str()).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.web_search.parse_failed",
            format!("解析联网搜索结果失败: {}", err),
        )
    })?;
    let results = extract_duckduckgo_results(&parsed, limit);
    Ok(json!({
        "query": query,
        "count": results.len(),
        "results": results,
    }))
}

/// 描述：抓取网页正文片段，用于读取文档详情而非仅搜索摘要。
fn tool_fetch_url(args: &Value) -> Result<Value, ProtocolError> {
    let url = get_required_string(args, "url", "core.agent.python.fetch_url.url_missing")?;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(ProtocolError::new(
            "core.agent.python.fetch_url.invalid_url",
            "fetch_url 仅支持 http/https 协议",
        ));
    }
    let max_chars = parse_positive_usize_arg(args, "max_chars", 8000, 120_000)?;
    let curl_bin = resolve_executable_binary("curl", "--version").ok_or_else(|| {
        ProtocolError::new(
            "core.agent.python.fetch_url.curl_missing",
            "未检测到可用 curl",
        )
        .with_suggestion("请安装 curl 后重试。")
    })?;
    let output = Command::new(curl_bin.as_str())
        .args(["-L", "-sS", "--max-time", "20", url.as_str()])
        .output()
        .map_err(|err| {
            ProtocolError::new(
                "core.agent.python.fetch_url.exec_failed",
                format!("抓取网页失败: {}", err),
            )
        })?;
    if !output.status.success() {
        return Err(ProtocolError::new(
            "core.agent.python.fetch_url.failed",
            "网页抓取请求失败",
        ));
    }
    let html = String::from_utf8_lossy(output.stdout.as_slice()).to_string();
    let plain_text = strip_html_tags(html.as_str());
    let mut truncated = plain_text.clone();
    if truncated.chars().count() > max_chars {
        truncated = truncated.chars().take(max_chars).collect::<String>();
    }
    Ok(json!({
        "url": url,
        "content": truncated,
        "content_chars": truncated.chars().count(),
    }))
}

/// 描述：执行模型工具桥接调用；当前默认未启用，作为后续 MCP 接入预留。
fn tool_mcp_model_tool(
    args: &Value,
    blender_bridge_addr: Option<&str>,
) -> Result<Value, ProtocolError> {
    #[cfg(feature = "with-mcp-model")]
    {
        let action_text = get_required_string(
            args,
            "action",
            "core.agent.python.model_tool.action_missing",
        )?;
        let action = action_text
            .parse::<zodileap_mcp_model::ModelToolAction>()
            .map_err(|err| {
                ProtocolError::new(
                    "core.agent.python.model_tool.action_invalid",
                    format!("模型工具 action 无效: {}", err),
                )
            })?;
        let params = args.get("params").cloned().unwrap_or_else(|| json!({}));
        let request = zodileap_mcp_model::ModelToolRequest {
            action,
            params,
            blender_bridge_addr: blender_bridge_addr.map(str::to_string),
            timeout_secs: None,
        };
        let result = zodileap_mcp_model::execute_model_tool(request)
            .map_err(|err| err.to_protocol_error())?;
        return Ok(json!({
            "action": result.action.as_str(),
            "message": result.message,
            "output_path": result.output_path,
            "data": result.data,
        }));
    }

    #[cfg(not(feature = "with-mcp-model"))]
    {
        let _ = args;
        let _ = blender_bridge_addr;
        Err(ProtocolError::new(
            "core.agent.python.model_tool_disabled",
            "当前构建未启用模型 MCP 工具能力",
        )
        .with_suggestion("请以 with-mcp-model 特性重新构建。"))
    }
}

/// 描述：读取必填字符串参数，缺失或类型不符时返回统一协议错误。
fn get_required_string(args: &Value, key: &str, code: &str) -> Result<String, ProtocolError> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| ProtocolError::new(code, format!("缺少参数: {}", key)))
}

/// 描述：读取必填原始字符串参数，保留首尾空白与换行，适用于文件内容和补丁内容。
fn get_required_raw_string(args: &Value, key: &str, code: &str) -> Result<String, ProtocolError> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| ProtocolError::new(code, format!("缺少参数: {}", key)))
}

/// 描述：读取布尔参数，支持 bool 与字符串表达，缺省回退到默认值。
fn parse_bool_arg(args: &Value, key: &str, default_value: bool) -> Result<bool, ProtocolError> {
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
fn parse_positive_usize_arg(
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
fn resolve_executable_binary(bin: &str, probe_arg: &str) -> Option<String> {
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

/// 描述：执行 ripgrep 搜索并返回结构化结果。
fn run_rg_search(
    rg_bin: &str,
    sandbox_root: &Path,
    query: &str,
    glob: &str,
    max_results: usize,
) -> Result<Vec<Value>, ProtocolError> {
    let mut command = Command::new(rg_bin);
    command
        .arg("--line-number")
        .arg("--no-heading")
        .arg("--color")
        .arg("never")
        .arg(query);
    if !glob.trim().is_empty() {
        command.arg("-g").arg(glob);
    }
    command.arg(".").current_dir(sandbox_root);
    let output = command.output().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.search_files.exec_failed",
            format!("执行 rg 搜索失败: {}", err),
        )
    })?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(ProtocolError::new(
            "core.agent.python.search_files.failed",
            String::from_utf8_lossy(output.stderr.as_slice())
                .trim()
                .to_string(),
        ));
    }
    let text = String::from_utf8_lossy(output.stdout.as_slice()).to_string();
    let mut matches = text
        .lines()
        .filter_map(parse_search_line)
        .collect::<Vec<Value>>();
    if matches.len() > max_results {
        matches.truncate(max_results);
    }
    Ok(matches)
}

/// 描述：在未安装 ripgrep 时回退 grep 实现，保障基础检索可用。
fn run_grep_search(
    sandbox_root: &Path,
    query: &str,
    glob: &str,
    max_results: usize,
) -> Result<Vec<Value>, ProtocolError> {
    let mut command = Command::new("grep");
    command
        .arg("-R")
        .arg("-n")
        .arg("--exclude-dir")
        .arg(".git")
        .arg(query)
        .arg(".");
    if !glob.trim().is_empty() {
        command.arg(format!("--include={}", glob));
    }
    command.current_dir(sandbox_root);
    let output = command.output().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.search_files.exec_failed",
            format!("执行 grep 搜索失败: {}", err),
        )
    })?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(ProtocolError::new(
            "core.agent.python.search_files.failed",
            String::from_utf8_lossy(output.stderr.as_slice())
                .trim()
                .to_string(),
        ));
    }
    let text = String::from_utf8_lossy(output.stdout.as_slice()).to_string();
    let mut matches = text
        .lines()
        .filter_map(parse_search_line)
        .collect::<Vec<Value>>();
    if matches.len() > max_results {
        matches.truncate(max_results);
    }
    Ok(matches)
}

/// 描述：解析单行 grep/rg 输出为统一结构，格式为 `path:line:content`。
fn parse_search_line(raw_line: &str) -> Option<Value> {
    let mut parts = raw_line.splitn(3, ':');
    let path = parts.next()?.trim();
    let line = parts.next()?.trim().parse::<usize>().ok()?;
    let content = parts.next().unwrap_or("").trim().to_string();
    Some(json!({
        "path": path,
        "line": line,
        "content": content,
    }))
}

/// 描述：从 unified diff 文本中提取补丁目标路径，自动去重并忽略 /dev/null。
fn collect_patch_paths(patch_text: &str) -> Vec<String> {
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
fn validate_patch_paths_in_sandbox(
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

/// 描述：解析 DuckDuckGo 响应并提取标题、链接、摘要结果列表。
fn extract_duckduckgo_results(parsed: &Value, limit: usize) -> Vec<Value> {
    let mut results: Vec<Value> = Vec::new();
    if let (Some(url), Some(text)) = (
        parsed.get("AbstractURL").and_then(|value| value.as_str()),
        parsed.get("AbstractText").and_then(|value| value.as_str()),
    ) {
        if !url.trim().is_empty() && !text.trim().is_empty() {
            results.push(json!({
                "title": parsed
                    .get("Heading")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Abstract"),
                "url": url,
                "snippet": text,
            }));
        }
    }
    if let Some(topics) = parsed
        .get("RelatedTopics")
        .and_then(|value| value.as_array())
    {
        collect_duckduckgo_topic_results(topics, &mut results, limit);
    }
    if results.len() > limit {
        results.truncate(limit);
    }
    results
}

/// 描述：递归解析 DuckDuckGo RelatedTopics，兼容分组 Topics 嵌套格式。
fn collect_duckduckgo_topic_results(topics: &[Value], results: &mut Vec<Value>, limit: usize) {
    for topic in topics {
        if results.len() >= limit {
            return;
        }
        if let Some(children) = topic.get("Topics").and_then(|value| value.as_array()) {
            collect_duckduckgo_topic_results(children, results, limit);
            continue;
        }
        let url = topic.get("FirstURL").and_then(|value| value.as_str());
        let text = topic.get("Text").and_then(|value| value.as_str());
        if let (Some(url), Some(text)) = (url, text) {
            if url.trim().is_empty() || text.trim().is_empty() {
                continue;
            }
            let title = text
                .split('-')
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Result");
            results.push(json!({
                "title": title,
                "url": url,
                "snippet": text,
            }));
        }
    }
}

/// 描述：对 URL 查询参数做百分号编码，避免联网请求中的特殊字符破坏查询语义。
fn url_encode_component(raw: &str) -> String {
    let mut encoded = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
        if keep {
            encoded.push(byte as char);
        } else if byte == b' ' {
            encoded.push('+');
        } else {
            encoded.push_str(format!("%{:02X}", byte).as_str());
        }
    }
    encoded
}

/// 描述：移除 HTML 标签并压缩空白，便于把网页正文以纯文本形式回传给编排脚本。
fn strip_html_tags(raw: &str) -> String {
    let mut plain = String::with_capacity(raw.len());
    let mut inside_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => plain.push(ch),
            _ => {}
        }
    }
    plain
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

/// 描述：解析并返回可用 Python 解释器路径。
fn resolve_python_binary() -> Result<String, ProtocolError> {
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

/// 描述：解析 Python 执行超时时间，未配置时使用默认值。
fn resolve_python_timeout_secs() -> u64 {
    env::var("ZODILEAP_PYTHON_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_PYTHON_WORKFLOW_TIMEOUT_SECS)
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
fn build_python_runtime_dir() -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    env::temp_dir().join(format!("zodileap-agent-python-{}", millis))
}

/// 描述：规范化路径并限制在沙盒根目录，防止通过 `..` 访问外部路径。
fn resolve_sandbox_path(sandbox_root: &Path, raw_path: &str) -> Result<PathBuf, ProtocolError> {
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
fn normalize_lexical_path(path: &Path) -> PathBuf {
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

/// 描述：返回任务清单默认存储路径，固定在沙盒根目录。
fn resolve_todo_file_path(sandbox_root: &Path) -> PathBuf {
    sandbox_root.join(".zodileap_agent_todo.json")
}

/// 描述：启动 Python 输出读取线程，按行读取 stdout/stderr 并发送到主线程。
fn spawn_python_output_reader<R>(
    reader: R,
    is_stdout: bool,
    tx: mpsc::Sender<PythonRunnerOutput>,
) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffered = BufReader::new(reader);
        loop {
            let mut line = String::new();
            let read = buffered.read_line(&mut line);
            match read {
                Ok(0) => break,
                Ok(_) => {
                    let normalized = line.trim_end_matches(['\n', '\r']).to_string();
                    let message = if is_stdout {
                        PythonRunnerOutput::Stdout(normalized)
                    } else {
                        PythonRunnerOutput::Stderr(normalized)
                    };
                    if tx.send(message).is_err() {
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
        let result = execute_python_script(script, root.to_str(), None)
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
        let result = tool_apply_patch(&json!({ "patch": patch }), root.as_path())
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
        let result = tool_apply_patch(
            &json!({ "patch": patch, "check_only": true }),
            root.as_path(),
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
        let write_result = tool_todo_write(
            &json!({
                "items": [
                    { "id": "1", "content": "需求分析", "status": "completed" },
                    { "id": "2", "content": "实现代码", "status": "in_progress" }
                ]
            }),
            root.as_path(),
        )
        .expect("write todo should succeed");
        assert_eq!(
            write_result
                .get("success")
                .and_then(|value| value.as_bool()),
            Some(true)
        );

        let read_result = tool_todo_read(root.as_path()).expect("read todo should succeed");
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
        let result = tool_run_shell(
            &json!({
                "command": command,
                "timeout_secs": 1
            }),
            root.as_path(),
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
}
