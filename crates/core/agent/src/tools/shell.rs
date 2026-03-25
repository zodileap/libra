use super::utils::{
    execute_command_with_timeout, get_required_string, parse_positive_usize_arg,
    resolve_sandbox_path,
};
use super::{AgentTool, ToolApprovalDecision, ToolContext};
use dashmap::DashMap;
use libra_mcp_common::ProtocolError;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::{HashSet, VecDeque};
use std::env;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub struct RunShellTool;
pub struct ShellStartTool;
pub struct ShellStatusTool;
pub struct ShellLogsTool;
pub struct ShellStopTool;
pub struct ShellListTool;

const DEFAULT_SHELL_READY_TIMEOUT_SECS: usize = 10;
const DEFAULT_SHELL_BOOTSTRAP_WAIT_MILLIS: u64 = 800;
const DEFAULT_SHELL_LOG_TAIL_LINES: usize = 40;
const RESIDENT_PROCESS_LOG_LIMIT: usize = 400;

static RESIDENT_PROCESS_REGISTRY: Lazy<DashMap<String, Arc<ResidentProcessHandle>>> =
    Lazy::new(DashMap::new);
static RESIDENT_PROCESS_NAME_INDEX: Lazy<DashMap<String, String>> = Lazy::new(DashMap::new);
static RESIDENT_PROCESS_ID_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static RESIDENT_PROCESS_LOG_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// 描述：run_shell 安全策略决策结果，统一返回命令审计信息与是否需要人工授权。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunShellPolicyDecision {
    pub command_names: Vec<String>,
    pub requires_approval: bool,
}

/// 描述：长驻进程单条日志片段，统一记录流名、顺序号与时间戳，供 follow/tail 与事件派发复用。
#[derive(Debug, Clone, PartialEq, Eq)]
struct ResidentProcessLogEntry {
    sequence: u64,
    stream: String,
    text: String,
    timestamp_ms: u64,
}

/// 描述：长驻进程运行态快照，统一维护状态、退出码和日志 ring buffer。
#[derive(Debug)]
struct ResidentProcessState {
    status: String,
    pid: u32,
    started_at_ms: u64,
    last_output_at_ms: Option<u64>,
    exit_code: Option<i32>,
    logs: VecDeque<ResidentProcessLogEntry>,
}

/// 描述：单个长驻进程句柄；按 session 维度持久化复用，并允许跨轮次查询状态与日志。
struct ResidentProcessHandle {
    process_id: String,
    session_id: String,
    name: String,
    command: String,
    workdir: String,
    child: Arc<Mutex<Child>>,
    state: Arc<(Mutex<ResidentProcessState>, Condvar)>,
}

/// 描述：面向工具返回与流式事件的长驻进程状态快照。
#[derive(Debug, Clone, PartialEq, Eq)]
struct ResidentProcessSnapshot {
    process_id: String,
    name: String,
    status: String,
    pid: u32,
    exit_code: Option<i32>,
    started_at_ms: u64,
    last_output_at_ms: Option<u64>,
    uptime_secs: u64,
    workdir: String,
    command: String,
}

impl AgentTool for RunShellTool {
    fn name(&self) -> &'static str {
        "run_shell"
    }

    fn description(&self) -> &'static str {
        "在项目沙盒内执行 shell 命令。参数：{\"command\": \"命令文本\", \"timeout_secs\": \"可选，默认根据策略\"}"
    }

    fn approval_decision(&self, args: &Value, context: &ToolContext<'_>) -> ToolApprovalDecision {
        let command_text = match get_required_string(
            args,
            "command",
            "core.agent.python.run_shell.command_missing",
        ) {
            Ok(value) => value,
            Err(err) => return ToolApprovalDecision::Deny(err),
        };
        if let Err(err) = parse_positive_usize_arg(
            args,
            "timeout_secs",
            context.policy.tool_timeout_secs as usize,
            600,
        ) {
            return ToolApprovalDecision::Deny(err);
        }
        let policy_decision = match evaluate_run_shell_policy(command_text.as_str()) {
            Ok(value) => value,
            Err(err) => return ToolApprovalDecision::Deny(err),
        };
        if let Err(err) =
            validate_shell_paths_in_sandbox(command_text.as_str(), context.sandbox_root)
        {
            return ToolApprovalDecision::Deny(err);
        }
        if policy_decision.requires_approval {
            ToolApprovalDecision::RequireApproval
        } else {
            ToolApprovalDecision::Allow
        }
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
        let policy_decision = evaluate_run_shell_policy(command_text.as_str())?;
        let command_names = policy_decision.command_names;
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

impl AgentTool for ShellStartTool {
    fn name(&self) -> &'static str {
        "shell_start"
    }

    fn description(&self) -> &'static str {
        "启动当前会话可复用的长驻 shell 进程。参数：{\"command\": \"命令文本\", \"name\": \"进程别名\", \"ready_pattern\": \"可选\", \"ready_timeout_secs\": \"可选\"}"
    }

    fn approval_decision(&self, args: &Value, context: &ToolContext<'_>) -> ToolApprovalDecision {
        let command_text = match get_required_string(
            args,
            "command",
            "core.agent.python.shell_start.command_missing",
        ) {
            Ok(value) => value,
            Err(err) => return ToolApprovalDecision::Deny(err),
        };
        if let Err(err) = get_required_string(
            args,
            "name",
            "core.agent.python.shell_start.name_missing",
        ) {
            return ToolApprovalDecision::Deny(err);
        }
        if let Err(err) = parse_positive_usize_arg(
            args,
            "ready_timeout_secs",
            DEFAULT_SHELL_READY_TIMEOUT_SECS,
            600,
        ) {
            return ToolApprovalDecision::Deny(err);
        }
        let policy_decision = match evaluate_run_shell_policy(command_text.as_str()) {
            Ok(value) => value,
            Err(err) => return ToolApprovalDecision::Deny(err),
        };
        if let Err(err) =
            validate_shell_paths_in_sandbox(command_text.as_str(), context.sandbox_root)
        {
            return ToolApprovalDecision::Deny(err);
        }
        if policy_decision.requires_approval {
            ToolApprovalDecision::RequireApproval
        } else {
            ToolApprovalDecision::Allow
        }
    }

    fn execute(&self, args: &Value, mut context: ToolContext) -> Result<Value, ProtocolError> {
        let command_text = get_required_string(
            args,
            "command",
            "core.agent.python.shell_start.command_missing",
        )?;
        let name = get_required_string(args, "name", "core.agent.python.shell_start.name_missing")?;
        let ready_pattern = args
            .get("ready_pattern")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let ready_timeout_secs = parse_positive_usize_arg(
            args,
            "ready_timeout_secs",
            DEFAULT_SHELL_READY_TIMEOUT_SECS,
            600,
        )? as u64;
        let policy_decision = evaluate_run_shell_policy(command_text.as_str())?;
        let validated_paths =
            validate_shell_paths_in_sandbox(command_text.as_str(), context.sandbox_root)?;
        ensure_resident_process_name_available(context.session_id, name.as_str())?;

        let handle = start_resident_process(
            context.session_id,
            name.as_str(),
            command_text.as_str(),
            context.sandbox_root,
        )?;
        let initial_snapshot = snapshot_resident_process(handle.as_ref());
        emit_resident_process_state_event(&mut context, &initial_snapshot);

        let wait_duration = if ready_pattern.is_some() {
            Duration::from_secs(ready_timeout_secs)
        } else {
            Duration::from_millis(DEFAULT_SHELL_BOOTSTRAP_WAIT_MILLIS)
        };
        let follow_outcome = follow_resident_process_logs(
            &handle,
            0,
            wait_duration,
            ready_pattern.as_deref(),
            Some(&mut context),
        );
        let snapshot = snapshot_resident_process(handle.as_ref());
        emit_resident_process_state_event(&mut context, &snapshot);

        Ok(json!({
            "process_id": snapshot.process_id,
            "name": snapshot.name,
            "status": snapshot.status,
            "pid": snapshot.pid,
            "exit_code": snapshot.exit_code,
            "started_at": snapshot.started_at_ms,
            "last_output_at": snapshot.last_output_at_ms,
            "uptime_secs": snapshot.uptime_secs,
            "workdir": snapshot.workdir,
            "command": snapshot.command,
            "commands": policy_decision.command_names,
            "validated_paths": validated_paths,
            "ready_pattern": ready_pattern,
            "ready": follow_outcome.ready,
            "ready_timeout_secs": ready_timeout_secs,
            "initial_output_tail": render_resident_process_log_tail(follow_outcome.logs.as_slice()),
        }))
    }
}

impl AgentTool for ShellStatusTool {
    fn name(&self) -> &'static str {
        "shell_status"
    }

    fn description(&self) -> &'static str {
        "读取当前会话长驻进程状态。参数：{\"process_id_or_name\": \"进程 ID 或别名\"}"
    }

    fn execute(&self, args: &Value, mut context: ToolContext) -> Result<Value, ProtocolError> {
        let identifier = get_required_string(
            args,
            "process_id_or_name",
            "core.agent.python.shell_status.identifier_missing",
        )?;
        let handle = resolve_resident_process_handle(context.session_id, identifier.as_str())?;
        let snapshot = snapshot_resident_process(handle.as_ref());
        emit_resident_process_state_event(&mut context, &snapshot);
        Ok(resident_process_snapshot_to_value(&snapshot))
    }
}

impl AgentTool for ShellLogsTool {
    fn name(&self) -> &'static str {
        "shell_logs"
    }

    fn description(&self) -> &'static str {
        "读取当前会话长驻进程日志，可按需在本轮继续 follow。参数：{\"process_id_or_name\": \"进程 ID 或别名\", \"tail_lines\": \"可选\", \"follow_secs\": \"可选\"}"
    }

    fn execute(&self, args: &Value, mut context: ToolContext) -> Result<Value, ProtocolError> {
        let identifier = get_required_string(
            args,
            "process_id_or_name",
            "core.agent.python.shell_logs.identifier_missing",
        )?;
        let tail_lines =
            parse_positive_usize_arg(args, "tail_lines", DEFAULT_SHELL_LOG_TAIL_LINES, 400)?;
        let follow_secs = parse_positive_usize_arg(args, "follow_secs", 0, 120)? as u64;
        let handle = resolve_resident_process_handle(context.session_id, identifier.as_str())?;

        let (tail_entries, latest_sequence) = resident_process_tail_entries(handle.as_ref(), tail_lines);
        let mut followed_entries: Vec<ResidentProcessLogEntry> = Vec::new();
        if follow_secs > 0 {
            let follow_result = follow_resident_process_logs(
                &handle,
                latest_sequence,
                Duration::from_secs(follow_secs),
                None,
                Some(&mut context),
            );
            followed_entries = follow_result.logs;
        }
        let snapshot = snapshot_resident_process(handle.as_ref());
        let mut combined_tail = tail_entries.clone();
        combined_tail.extend(followed_entries);
        if combined_tail.len() > tail_lines {
            let start = combined_tail.len().saturating_sub(tail_lines);
            combined_tail = combined_tail.into_iter().skip(start).collect();
        }
        Ok(json!({
            "process_id": snapshot.process_id,
            "name": snapshot.name,
            "status": snapshot.status,
            "pid": snapshot.pid,
            "exit_code": snapshot.exit_code,
            "started_at": snapshot.started_at_ms,
            "last_output_at": snapshot.last_output_at_ms,
            "uptime_secs": snapshot.uptime_secs,
            "workdir": snapshot.workdir,
            "command": snapshot.command,
            "tail_lines": resident_process_log_entries_to_value(combined_tail.as_slice()),
            "tail_text": render_resident_process_log_tail(combined_tail.as_slice()),
            "follow_secs": follow_secs,
        }))
    }
}

impl AgentTool for ShellStopTool {
    fn name(&self) -> &'static str {
        "shell_stop"
    }

    fn description(&self) -> &'static str {
        "停止当前会话长驻进程。参数：{\"process_id_or_name\": \"进程 ID 或别名\", \"force\": \"可选\"}"
    }

    fn execute(&self, args: &Value, mut context: ToolContext) -> Result<Value, ProtocolError> {
        let identifier = get_required_string(
            args,
            "process_id_or_name",
            "core.agent.python.shell_stop.identifier_missing",
        )?;
        let force = args.get("force").and_then(|value| value.as_bool()).unwrap_or(false);
        let handle = resolve_resident_process_handle(context.session_id, identifier.as_str())?;
        stop_resident_process(handle.as_ref(), force)?;
        let snapshot = snapshot_resident_process(handle.as_ref());
        emit_resident_process_state_event(&mut context, &snapshot);
        Ok(json!({
            "stopped": true,
            "force": force,
            "process_id": snapshot.process_id,
            "name": snapshot.name,
            "status": snapshot.status,
            "pid": snapshot.pid,
            "exit_code": snapshot.exit_code,
            "started_at": snapshot.started_at_ms,
            "last_output_at": snapshot.last_output_at_ms,
            "uptime_secs": snapshot.uptime_secs,
            "workdir": snapshot.workdir,
            "command": snapshot.command,
        }))
    }
}

impl AgentTool for ShellListTool {
    fn name(&self) -> &'static str {
        "shell_list"
    }

    fn description(&self) -> &'static str {
        "列出当前会话全部长驻进程摘要。参数：{}"
    }

    fn execute(&self, _args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let processes = collect_session_resident_process_snapshots(context.session_id);
        Ok(json!({
            "count": processes.len(),
            "processes": processes
                .iter()
                .map(resident_process_snapshot_to_value)
                .collect::<Vec<Value>>(),
        }))
    }
}

/// 描述：返回当前毫秒级时间戳，供状态快照、日志事件和测试断言统一复用。
fn now_millis_u64() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as u64
}

/// 描述：构造长驻进程的全局唯一 ID，避免不同 session/同名进程在跨轮查询时发生混淆。
fn build_resident_process_id() -> String {
    format!(
        "proc-{}-{}",
        now_millis_u64(),
        RESIDENT_PROCESS_ID_SEQUENCE.fetch_add(1, Ordering::SeqCst)
    )
}

/// 描述：生成会话级别的 name 索引键，确保同一个 session 内的进程别名唯一。
fn resident_process_name_key(session_id: &str, name: &str) -> String {
    format!("{}::{}", session_id.trim(), name.trim())
}

/// 描述：判断长驻进程状态是否仍属于可复用的活跃态。
fn resident_process_status_is_active(status: &str) -> bool {
    matches!(status, "starting" | "running")
}

/// 描述：从句柄构造当前状态快照，统一给工具返回值、流式事件与列表展示复用。
fn snapshot_resident_process(handle: &ResidentProcessHandle) -> ResidentProcessSnapshot {
    let (lock, _) = &*handle.state;
    let state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    ResidentProcessSnapshot {
        process_id: handle.process_id.clone(),
        name: handle.name.clone(),
        status: state.status.clone(),
        pid: state.pid,
        exit_code: state.exit_code,
        started_at_ms: state.started_at_ms,
        last_output_at_ms: state.last_output_at_ms,
        uptime_secs: now_millis_u64()
            .saturating_sub(state.started_at_ms)
            .checked_div(1000)
            .unwrap_or(0),
        workdir: handle.workdir.clone(),
        command: handle.command.clone(),
    }
}

/// 描述：将长驻进程快照编码为统一 JSON，对外保持稳定字段命名。
fn resident_process_snapshot_to_value(snapshot: &ResidentProcessSnapshot) -> Value {
    json!({
        "process_id": snapshot.process_id,
        "name": snapshot.name,
        "status": snapshot.status,
        "pid": snapshot.pid,
        "exit_code": snapshot.exit_code,
        "started_at": snapshot.started_at_ms,
        "last_output_at": snapshot.last_output_at_ms,
        "uptime_secs": snapshot.uptime_secs,
        "workdir": snapshot.workdir,
        "command": snapshot.command,
    })
}

/// 描述：把单条日志片段转成可展示文本，统一在 tail/follow 与前端日志详情中复用。
fn render_resident_process_log_line(entry: &ResidentProcessLogEntry) -> String {
    format!(
        "[{}] {}",
        entry.stream.to_uppercase(),
        entry.text.trim_end_matches(['\r', '\n'])
    )
}

/// 描述：把日志 tail 聚合为多行文本，供工具结果摘要与 Desktop 详情面板直接展示。
fn render_resident_process_log_tail(entries: &[ResidentProcessLogEntry]) -> String {
    entries
        .iter()
        .map(render_resident_process_log_line)
        .collect::<Vec<String>>()
        .join("\n")
}

/// 描述：把日志 tail 转成结构化 JSON 数组，便于前端按需做明细渲染或导出。
fn resident_process_log_entries_to_value(entries: &[ResidentProcessLogEntry]) -> Vec<Value> {
    entries
        .iter()
        .map(|entry| {
            json!({
                "sequence": entry.sequence,
                "stream": entry.stream,
                "text": entry.text,
                "timestamp_ms": entry.timestamp_ms,
            })
        })
        .collect()
}

/// 描述：向工具上下文派发长驻进程状态事件。
fn emit_resident_process_state_event(
    context: &mut ToolContext<'_>,
    snapshot: &ResidentProcessSnapshot,
) {
    context.emit_stream_event(crate::AgentStreamEvent::ResidentProcessState {
        process_id: snapshot.process_id.clone(),
        name: snapshot.name.clone(),
        status: snapshot.status.clone(),
        pid: Some(snapshot.pid),
        exit_code: snapshot.exit_code,
        started_at_ms: snapshot.started_at_ms,
        last_output_at_ms: snapshot.last_output_at_ms,
        uptime_secs: snapshot.uptime_secs,
        workdir: snapshot.workdir.clone(),
    });
}

/// 描述：向工具上下文派发长驻进程日志事件，仅在 follow/启动采样期间推送新增片段。
fn emit_resident_process_log_event(
    context: &mut ToolContext<'_>,
    handle: &ResidentProcessHandle,
    entry: &ResidentProcessLogEntry,
) {
    context.emit_stream_event(crate::AgentStreamEvent::ResidentProcessLog {
        process_id: handle.process_id.clone(),
        name: handle.name.clone(),
        stream: entry.stream.clone(),
        text: entry.text.clone(),
        sequence: entry.sequence,
        timestamp_ms: entry.timestamp_ms,
    });
}

/// 描述：向日志 ring buffer 追加一条新日志，并唤醒可能正在 follow 的等待者。
fn append_resident_process_log(handle: &ResidentProcessHandle, stream: &str, text: &str) {
    let normalized = text.trim_end_matches(['\r', '\n']).trim();
    if normalized.is_empty() {
        return;
    }
    let entry = ResidentProcessLogEntry {
        sequence: RESIDENT_PROCESS_LOG_SEQUENCE.fetch_add(1, Ordering::SeqCst),
        stream: stream.to_string(),
        text: normalized.to_string(),
        timestamp_ms: now_millis_u64(),
    };
    let (lock, condvar) = &*handle.state;
    let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    state.last_output_at_ms = Some(entry.timestamp_ms);
    state.logs.push_back(entry);
    while state.logs.len() > RESIDENT_PROCESS_LOG_LIMIT {
        state.logs.pop_front();
    }
    condvar.notify_all();
}

/// 描述：更新进程终态并释放 name 索引，避免同名新进程被旧索引卡住。
fn update_resident_process_terminal_state(
    handle: &ResidentProcessHandle,
    status: &str,
    exit_code: Option<i32>,
) {
    let (lock, condvar) = &*handle.state;
    {
        let mut state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.status = status.to_string();
        if exit_code.is_some() {
            state.exit_code = exit_code;
        }
    }
    RESIDENT_PROCESS_NAME_INDEX.remove(&resident_process_name_key(
        handle.session_id.as_str(),
        handle.name.as_str(),
    ));
    condvar.notify_all();
}

/// 描述：启动 stdout/stderr 读取线程，把子进程增量输出写入 ring buffer。
fn spawn_resident_process_log_pump(
    handle: Arc<ResidentProcessHandle>,
    stream_name: &'static str,
    reader: impl std::io::Read + Send + 'static,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            let bytes = reader.read_line(&mut line).unwrap_or(0);
            if bytes == 0 {
                break;
            }
            append_resident_process_log(handle.as_ref(), stream_name, line.as_str());
        }
    });
}

/// 描述：轮询子进程退出状态，确保自然退出时也会更新快照并释放别名索引。
fn spawn_resident_process_exit_watcher(handle: Arc<ResidentProcessHandle>) {
    thread::spawn(move || loop {
        let child_status = {
            let mut child = handle
                .child
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            child.try_wait().ok().flatten().map(|status| status.code())
        };
        if let Some(exit_code) = child_status {
            let snapshot = snapshot_resident_process(handle.as_ref());
            if resident_process_status_is_active(snapshot.status.as_str()) {
                update_resident_process_terminal_state(handle.as_ref(), "exited", exit_code);
            }
            break;
        }
        let snapshot = snapshot_resident_process(handle.as_ref());
        if !resident_process_status_is_active(snapshot.status.as_str()) {
            break;
        }
        thread::sleep(Duration::from_millis(200));
    });
}

/// 描述：读取当前日志 tail 与最新序号，供 shell_logs / shell_start follow 起点复用。
fn resident_process_tail_entries(
    handle: &ResidentProcessHandle,
    tail_lines: usize,
) -> (Vec<ResidentProcessLogEntry>, u64) {
    let (lock, _) = &*handle.state;
    let state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let latest_sequence = state.logs.back().map(|entry| entry.sequence).unwrap_or(0);
    let entries = state
        .logs
        .iter()
        .rev()
        .take(tail_lines)
        .cloned()
        .collect::<Vec<ResidentProcessLogEntry>>()
        .into_iter()
        .rev()
        .collect::<Vec<ResidentProcessLogEntry>>();
    (entries, latest_sequence)
}

/// 描述：跟随长驻进程新增日志一段时间，并在匹配 ready_pattern 或超时后返回采样结果。
fn follow_resident_process_logs(
    handle: &Arc<ResidentProcessHandle>,
    start_after_sequence: u64,
    wait_for: Duration,
    ready_pattern: Option<&str>,
    mut context: Option<&mut ToolContext<'_>>,
) -> ResidentProcessFollowOutcome {
    let deadline = Instant::now() + wait_for;
    let mut last_sequence = start_after_sequence;
    let mut ready = false;
    let mut collected: Vec<ResidentProcessLogEntry> = Vec::new();
    let has_ready_pattern = ready_pattern.is_some();

    loop {
        let snapshot = snapshot_resident_process(handle.as_ref());
        let new_entries = {
            let (lock, _) = &*handle.state;
            let state = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            state
                .logs
                .iter()
                .filter(|entry| entry.sequence > last_sequence)
                .cloned()
                .collect::<Vec<ResidentProcessLogEntry>>()
        };

        if !new_entries.is_empty() {
            for entry in &new_entries {
                last_sequence = last_sequence.max(entry.sequence);
                if let Some(pattern) = ready_pattern {
                    if entry.text.contains(pattern) {
                        ready = true;
                    }
                }
                if let Some(tool_context) = context.as_deref_mut() {
                    emit_resident_process_log_event(tool_context, handle.as_ref(), entry);
                }
            }
            collected.extend(new_entries);
        }

        if ready {
            break;
        }
        if !has_ready_pattern && Instant::now() >= deadline {
            ready = true;
            break;
        }
        if !resident_process_status_is_active(snapshot.status.as_str()) {
            if !has_ready_pattern {
                ready = true;
            }
            break;
        }
        if has_ready_pattern && Instant::now() >= deadline {
            break;
        }

        let (lock, condvar) = &*handle.state;
        let guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let wait_timeout = deadline.saturating_duration_since(Instant::now());
        if wait_timeout.is_zero() {
            break;
        }
        let _ = condvar
            .wait_timeout(guard, wait_timeout)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }

    ResidentProcessFollowOutcome {
        ready,
        logs: collected,
    }
}

/// 描述：按 session 收集全部长驻进程快照，并按启动时间倒序排列，便于 shell_list 输出稳定。
fn collect_session_resident_process_snapshots(session_id: &str) -> Vec<ResidentProcessSnapshot> {
    let mut snapshots = RESIDENT_PROCESS_REGISTRY
        .iter()
        .filter(|entry| entry.value().session_id == session_id)
        .map(|entry| snapshot_resident_process(entry.value().as_ref()))
        .collect::<Vec<ResidentProcessSnapshot>>();
    snapshots.sort_by(|left, right| right.started_at_ms.cmp(&left.started_at_ms));
    snapshots
}

/// 描述：确保同 session 下的进程别名未被活跃进程占用；旧的非活跃索引会自动清理。
fn ensure_resident_process_name_available(
    session_id: &str,
    name: &str,
) -> Result<(), ProtocolError> {
    let key = resident_process_name_key(session_id, name);
    if let Some(process_id) = RESIDENT_PROCESS_NAME_INDEX.get(&key).map(|value| value.clone()) {
        if let Some(handle) = RESIDENT_PROCESS_REGISTRY.get(process_id.as_str()) {
            let snapshot = snapshot_resident_process(handle.value().as_ref());
            if resident_process_status_is_active(snapshot.status.as_str()) {
                return Err(ProtocolError::new(
                    "core.agent.python.shell_start.name_conflict",
                    format!("当前会话中已存在运行中的长驻进程别名: {}", name),
                )
                .with_suggestion("请先使用 shell_stop 停止现有进程，或改用新的 name。"));
            }
        }
        RESIDENT_PROCESS_NAME_INDEX.remove(&key);
    }
    Ok(())
}

/// 描述：按进程 ID 或别名解析当前 session 下的长驻进程句柄，兼容活跃与已退出历史进程的查询。
fn resolve_resident_process_handle(
    session_id: &str,
    process_id_or_name: &str,
) -> Result<Arc<ResidentProcessHandle>, ProtocolError> {
    let identifier = process_id_or_name.trim();
    if identifier.is_empty() {
        return Err(ProtocolError::new(
            "core.agent.python.shell.identifier_empty",
            "长驻进程标识不能为空",
        ));
    }

    if let Some(handle) = RESIDENT_PROCESS_REGISTRY.get(identifier) {
        if handle.value().session_id == session_id {
            return Ok(handle.clone());
        }
        return Err(ProtocolError::new(
            "core.agent.python.shell.process_forbidden",
            "当前会话无权访问该长驻进程",
        ));
    }

    let name_key = resident_process_name_key(session_id, identifier);
    if let Some(process_id) = RESIDENT_PROCESS_NAME_INDEX.get(&name_key).map(|value| value.clone()) {
        if let Some(handle) = RESIDENT_PROCESS_REGISTRY.get(process_id.as_str()) {
            return Ok(handle.clone());
        }
        RESIDENT_PROCESS_NAME_INDEX.remove(&name_key);
    }

    let mut candidates = RESIDENT_PROCESS_REGISTRY
        .iter()
        .filter(|entry| entry.value().session_id == session_id && entry.value().name == identifier)
        .map(|entry| snapshot_resident_process(entry.value().as_ref()))
        .collect::<Vec<ResidentProcessSnapshot>>();
    candidates.sort_by(|left, right| right.started_at_ms.cmp(&left.started_at_ms));
    if let Some(latest) = candidates.first() {
        if let Some(handle) = RESIDENT_PROCESS_REGISTRY.get(latest.process_id.as_str()) {
            return Ok(handle.clone());
        }
    }

    Err(ProtocolError::new(
        "core.agent.python.shell.process_not_found",
        format!("未找到当前会话中的长驻进程: {}", identifier),
    ))
}

/// 描述：启动新的长驻进程，接管 stdout/stderr 并把句柄注册到全局 registry 中。
fn start_resident_process(
    session_id: &str,
    name: &str,
    command_text: &str,
    sandbox_root: &Path,
) -> Result<Arc<ResidentProcessHandle>, ProtocolError> {
    let mut command = build_shell_command(command_text, sandbox_root);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.shell_start.spawn_failed",
            format!("启动长驻进程失败: {}", err),
        )
    })?;
    let pid = child.id();
    let stdout = child.stdout.take().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.python.shell_start.stdout_unavailable",
            "长驻进程 stdout 无法接管",
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.python.shell_start.stderr_unavailable",
            "长驻进程 stderr 无法接管",
        )
    })?;

    let process_id = build_resident_process_id();
    let handle = Arc::new(ResidentProcessHandle {
        process_id: process_id.clone(),
        session_id: session_id.to_string(),
        name: name.trim().to_string(),
        command: command_text.to_string(),
        workdir: sandbox_root.to_string_lossy().to_string(),
        child: Arc::new(Mutex::new(child)),
        state: Arc::new((
            Mutex::new(ResidentProcessState {
                status: "running".to_string(),
                pid,
                started_at_ms: now_millis_u64(),
                last_output_at_ms: None,
                exit_code: None,
                logs: VecDeque::new(),
            }),
            Condvar::new(),
        )),
    });

    RESIDENT_PROCESS_REGISTRY.insert(process_id.clone(), Arc::clone(&handle));
    RESIDENT_PROCESS_NAME_INDEX.insert(
        resident_process_name_key(session_id, name),
        process_id,
    );
    spawn_resident_process_log_pump(Arc::clone(&handle), "stdout", stdout);
    spawn_resident_process_log_pump(Arc::clone(&handle), "stderr", stderr);
    spawn_resident_process_exit_watcher(Arc::clone(&handle));
    Ok(handle)
}

/// 描述：尝试停止长驻进程；默认先做温和终止，必要时再强制 kill，并更新终态快照。
fn stop_resident_process(
    handle: &ResidentProcessHandle,
    force: bool,
) -> Result<(), ProtocolError> {
    let mut child = handle
        .child
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if child.try_wait().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.shell_stop.status_failed",
            format!("读取进程状态失败: {}", err),
        )
    })?
    .is_some()
    {
        update_resident_process_terminal_state(handle, "stopped", None);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    if !force {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(child.id().to_string())
            .status();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(status) = child.try_wait().map_err(|err| {
                ProtocolError::new(
                    "core.agent.python.shell_stop.status_failed",
                    format!("读取进程状态失败: {}", err),
                )
            })? {
                update_resident_process_terminal_state(handle, "stopped", status.code());
                return Ok(());
            }
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    child.kill().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.shell_stop.kill_failed",
            format!("停止长驻进程失败: {}", err),
        )
    })?;
    let exit_status = child.wait().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.shell_stop.wait_failed",
            format!("等待长驻进程退出失败: {}", err),
        )
    })?;
    update_resident_process_terminal_state(handle, "stopped", exit_status.code());
    Ok(())
}

/// 描述：清理全部长驻进程；供 runtime 关闭与应用退出时统一回收后台子进程。
pub fn cleanup_all_resident_processes() {
    let handles = RESIDENT_PROCESS_REGISTRY
        .iter()
        .map(|entry| Arc::clone(entry.value()))
        .collect::<Vec<Arc<ResidentProcessHandle>>>();
    for handle in handles {
        let _ = stop_resident_process(handle.as_ref(), true);
    }
    RESIDENT_PROCESS_NAME_INDEX.clear();
    RESIDENT_PROCESS_REGISTRY.clear();
}

/// 描述：长驻进程日志 follow 结果，统一回传 ready 判定与新增 tail。
struct ResidentProcessFollowOutcome {
    ready: bool,
    logs: Vec<ResidentProcessLogEntry>,
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
fn evaluate_run_shell_policy(command_text: &str) -> Result<RunShellPolicyDecision, ProtocolError> {
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
) -> Result<RunShellPolicyDecision, ProtocolError> {
    let command_names = collect_shell_command_names(command_text);
    if command_names.is_empty() {
        return Err(ProtocolError::new(
            "core.agent.python.run_shell.command_empty",
            "命令内容为空或无法解析可执行命令",
        ));
    }

    let mut requires_approval = false;
    for command in &command_names {
        if !allowlist.is_empty() && !allowlist.contains(command) {
            return Err(ProtocolError::new(
                "core.agent.python.run_shell.command_not_allowed",
                format!("命令不在白名单中: {}", command),
            )
            .with_suggestion(
                "请设置 ZODILEAP_AGENT_RUN_SHELL_ALLOWLIST，或改用内置文件工具完成操作。",
            ));
        }
        if denylist.contains(command) {
            requires_approval = true;
        }
    }
    Ok(RunShellPolicyDecision {
        command_names,
        requires_approval,
    })
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
    use crate::AgentStreamEvent;
    use once_cell::sync::Lazy;
    use serde_json::json;
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::thread;
    use std::time::Duration;

    static RESIDENT_PROCESS_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

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

    /// 描述：验证命中危险命令黑名单时不会直接报错，而是转为人工授权分支。
    #[test]
    fn should_require_approval_for_blacklisted_shell_command() {
        let allowlist: HashSet<String> = HashSet::new();
        let mut denylist: HashSet<String> = HashSet::new();
        denylist.insert("rm".to_string());
        let decision = evaluate_run_shell_policy_with_sets("rm -rf ./tmp", &allowlist, &denylist)
            .expect("blacklisted command should require approval");
        assert_eq!(decision.command_names, vec!["rm".to_string()]);
        assert!(decision.requires_approval);
    }

    /// 描述：验证白名单命中的安全命令可直接执行，不会误触发审批卡。
    #[test]
    fn should_allow_safe_shell_command_without_approval() {
        let allowlist: HashSet<String> = HashSet::new();
        let denylist: HashSet<String> = HashSet::new();
        let decision =
            evaluate_run_shell_policy_with_sets("git status && ls", &allowlist, &denylist)
                .expect("safe command should be allowed");
        assert_eq!(
            decision.command_names,
            vec!["git".to_string(), "ls".to_string()]
        );
        assert!(!decision.requires_approval);
    }

    /// 描述：验证显式白名单仍然属于硬限制，未命中的命令会直接拒绝而不是进入审批。
    #[test]
    fn should_deny_non_allowlisted_shell_command() {
        let mut allowlist: HashSet<String> = HashSet::new();
        allowlist.insert("git".to_string());
        let denylist: HashSet<String> = HashSet::new();
        let result = evaluate_run_shell_policy_with_sets("git status && ls", &allowlist, &denylist);
        let error = result.expect_err("non-allowlisted command should be denied");
        assert_eq!(
            error.code,
            "core.agent.python.run_shell.command_not_allowed"
        );
    }

    /// 描述：构造测试专用沙盒上下文，统一关闭流式事件回调，避免样板代码散落在各测试中。
    fn build_context<'a>(
        sandbox_root: &'a Path,
        session_id: &'a str,
        policy: &'a crate::policy::AgentPolicy,
    ) -> ToolContext<'a> {
        ToolContext {
            trace_id: "test-trace".to_string(),
            session_id,
            sandbox_root,
            policy,
            on_stream_event: None,
        }
    }

    /// 描述：构造测试专用沙盒目录，避免多个测试共享同一路径导致长驻进程输出互相污染。
    fn build_test_sandbox_root(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = env::temp_dir().join(format!("libra-shell-tool-test-{}-{}", label, nanos));
        fs::create_dir_all(&root).expect("create shell test sandbox");
        root
    }

    #[cfg(not(target_os = "windows"))]
    /// 描述：验证 shell_start 能创建长驻进程并通过 shell_status 读取 running 状态。
    #[test]
    fn should_start_and_query_resident_process_status() {
        let _guard = RESIDENT_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cleanup_all_resident_processes();
        let sandbox_root = build_test_sandbox_root("resident-start");
        let policy = crate::policy::AgentPolicy::default();
        let start_result = ShellStartTool
            .execute(
                &json!({
                    "command": "sleep 20",
                    "name": "dev-server",
                }),
                build_context(&sandbox_root, "resident-start-session", &policy),
            )
            .expect("shell_start should succeed");
        let process_id = start_result
            .get("process_id")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert!(!process_id.is_empty());
        assert_eq!(
            start_result.get("status").and_then(|value| value.as_str()),
            Some("running")
        );

        let status_result = ShellStatusTool
            .execute(
                &json!({"process_id_or_name": process_id}),
                build_context(&sandbox_root, "resident-start-session", &policy),
            )
            .expect("shell_status should succeed");
        assert_eq!(
            status_result.get("status").and_then(|value| value.as_str()),
            Some("running")
        );
        cleanup_all_resident_processes();
    }

    #[cfg(not(target_os = "windows"))]
    /// 描述：验证 shell_list 仅返回当前 session 的长驻进程摘要，供后续跨轮恢复句柄时稳定复用。
    #[test]
    fn should_list_resident_processes_for_current_session_only() {
        let _guard = RESIDENT_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cleanup_all_resident_processes();
        let sandbox_root = build_test_sandbox_root("resident-list");
        let policy = crate::policy::AgentPolicy::default();
        ShellStartTool
            .execute(
                &json!({
                    "command": "sleep 20",
                    "name": "session-a",
                }),
                build_context(&sandbox_root, "resident-list-session-a", &policy),
            )
            .expect("first shell_start should succeed");
        ShellStartTool
            .execute(
                &json!({
                    "command": "sleep 20",
                    "name": "session-b",
                }),
                build_context(&sandbox_root, "resident-list-session-b", &policy),
            )
            .expect("second shell_start should succeed");

        let list_result = ShellListTool
            .execute(
                &json!({}),
                build_context(&sandbox_root, "resident-list-session-a", &policy),
            )
            .expect("shell_list should succeed");
        let count = list_result
            .get("count")
            .and_then(|value| value.as_u64())
            .unwrap_or_default();
        let processes = list_result
            .get("processes")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(count, 1);
        assert_eq!(processes.len(), 1);
        assert_eq!(
            processes[0].get("name").and_then(|value| value.as_str()),
            Some("session-a")
        );
        cleanup_all_resident_processes();
    }

    #[cfg(not(target_os = "windows"))]
    /// 描述：验证同一 session 下运行中的长驻进程别名不可重复启动，避免隐式重启覆盖旧句柄。
    #[test]
    fn should_reject_duplicate_running_resident_process_name() {
        let _guard = RESIDENT_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cleanup_all_resident_processes();
        let sandbox_root = build_test_sandbox_root("resident-duplicate");
        let policy = crate::policy::AgentPolicy::default();
        ShellStartTool
            .execute(
                &json!({
                    "command": "sleep 20",
                    "name": "dev-server",
                }),
                build_context(&sandbox_root, "resident-duplicate-session", &policy),
            )
            .expect("first shell_start should succeed");

        let error = ShellStartTool
            .execute(
                &json!({
                    "command": "sleep 20",
                    "name": "dev-server",
                }),
                build_context(&sandbox_root, "resident-duplicate-session", &policy),
            )
            .expect_err("duplicate shell_start should fail");
        assert_eq!(error.code, "core.agent.python.shell_start.name_conflict");
        cleanup_all_resident_processes();
    }

    #[cfg(not(target_os = "windows"))]
    /// 描述：验证 shell_status 能跨轮读取已自然退出的长驻进程状态，满足“启动后再查状态”的典型流程。
    #[test]
    fn should_report_exited_resident_process_across_calls() {
        let _guard = RESIDENT_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cleanup_all_resident_processes();
        let sandbox_root = build_test_sandbox_root("resident-exited");
        let policy = crate::policy::AgentPolicy::default();
        let start_result = ShellStartTool
            .execute(
                &json!({
                    "command": "printf ready\\n",
                    "name": "quick-task",
                    "ready_pattern": "ready",
                    "ready_timeout_secs": 3,
                }),
                build_context(&sandbox_root, "resident-exited-session", &policy),
            )
            .expect("shell_start should succeed");
        let process_id = start_result
            .get("process_id")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        thread::sleep(Duration::from_millis(300));
        let status_result = ShellStatusTool
            .execute(
                &json!({"process_id_or_name": process_id}),
                build_context(&sandbox_root, "resident-exited-session", &policy),
            )
            .expect("shell_status should succeed");
        assert_eq!(
            status_result.get("status").and_then(|value| value.as_str()),
            Some("exited")
        );
        cleanup_all_resident_processes();
    }

    #[cfg(not(target_os = "windows"))]
    /// 描述：验证 shell_logs 在 follow 模式下会持续派发新增日志事件，并把 follow 结果写回 tail。
    #[test]
    fn should_follow_resident_process_logs_and_emit_events() {
        let _guard = RESIDENT_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cleanup_all_resident_processes();
        let sandbox_root = build_test_sandbox_root("resident-logs");
        let policy = crate::policy::AgentPolicy::default();
        let start_result = ShellStartTool
            .execute(
                &json!({
                    "command": "printf 'start\\n'; sleep 0.5; printf 'follow\\n'; sleep 3",
                    "name": "logger",
                    "ready_pattern": "start",
                    "ready_timeout_secs": 3,
                }),
                build_context(&sandbox_root, "resident-logs-session", &policy),
            )
            .expect("shell_start should succeed");
        let process_id = start_result
            .get("process_id")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();

        let mut events: Vec<AgentStreamEvent> = Vec::new();
        let mut sink = |event: AgentStreamEvent| events.push(event);
        let logs_result = ShellLogsTool
            .execute(
                &json!({
                    "process_id_or_name": process_id,
                    "tail_lines": 20,
                    "follow_secs": 3,
                }),
                ToolContext {
                    trace_id: "test-trace".to_string(),
                    session_id: "resident-logs-session",
                    sandbox_root: &sandbox_root,
                    policy: &policy,
                    on_stream_event: Some(&mut sink),
                },
            )
            .expect("shell_logs should succeed");

        let tail_text = logs_result
            .get("tail_text")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert!(tail_text.contains("start"));
        assert!(tail_text.contains("follow"));
        assert!(events.iter().any(|event| matches!(
            event,
            AgentStreamEvent::ResidentProcessLog { text, .. } if text.contains("follow")
        )));
        cleanup_all_resident_processes();
    }

    #[cfg(not(target_os = "windows"))]
    /// 描述：验证 shell_stop 会停止运行中的长驻进程，并保留 stopped 终态供后续状态查询。
    #[test]
    fn should_stop_resident_process_and_preserve_stopped_status() {
        let _guard = RESIDENT_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cleanup_all_resident_processes();
        let sandbox_root = build_test_sandbox_root("resident-stop");
        let policy = crate::policy::AgentPolicy::default();
        let start_result = ShellStartTool
            .execute(
                &json!({
                    "command": "sleep 20",
                    "name": "stop-me",
                }),
                build_context(&sandbox_root, "resident-stop-session", &policy),
            )
            .expect("shell_start should succeed");
        let process_id = start_result
            .get("process_id")
            .and_then(|value| value.as_str())
            .unwrap_or("");

        let stop_result = ShellStopTool
            .execute(
                &json!({
                    "process_id_or_name": process_id,
                    "force": true,
                }),
                build_context(&sandbox_root, "resident-stop-session", &policy),
            )
            .expect("shell_stop should succeed");
        assert_eq!(
            stop_result.get("status").and_then(|value| value.as_str()),
            Some("stopped")
        );

        let status_result = ShellStatusTool
            .execute(
                &json!({"process_id_or_name": process_id}),
                build_context(&sandbox_root, "resident-stop-session", &policy),
            )
            .expect("shell_status after stop should succeed");
        assert_eq!(
            status_result.get("status").and_then(|value| value.as_str()),
            Some("stopped")
        );
        cleanup_all_resident_processes();
    }

    #[cfg(not(target_os = "windows"))]
    /// 描述：验证 cleanup_all_resident_processes 会统一停止并清空 registry，避免宿主退出后残留后台孤儿进程。
    #[test]
    fn should_cleanup_all_resident_processes_and_clear_registry() {
        let _guard = RESIDENT_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cleanup_all_resident_processes();
        let sandbox_root = build_test_sandbox_root("resident-cleanup");
        let policy = crate::policy::AgentPolicy::default();
        ShellStartTool
            .execute(
                &json!({
                    "command": "sleep 20",
                    "name": "cleanup-a",
                }),
                build_context(&sandbox_root, "resident-cleanup-session", &policy),
            )
            .expect("first shell_start should succeed");
        ShellStartTool
            .execute(
                &json!({
                    "command": "sleep 20",
                    "name": "cleanup-b",
                }),
                build_context(&sandbox_root, "resident-cleanup-session", &policy),
            )
            .expect("second shell_start should succeed");

        cleanup_all_resident_processes();

        let list_result = ShellListTool
            .execute(
                &json!({}),
                build_context(&sandbox_root, "resident-cleanup-session", &policy),
            )
            .expect("shell_list should succeed");
        assert_eq!(
            list_result.get("count").and_then(|value| value.as_u64()),
            Some(0)
        );
    }
}
