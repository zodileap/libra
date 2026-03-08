use dashmap::DashMap;
use libra_mcp_common::ProtocolError;
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tracing::info;

/// 描述：持久化沙盒的单次任务执行结果。
pub struct SandboxExecutionResult {
    pub message: String,
    pub actions: Vec<String>,
    pub stdout_lines: Vec<String>,
    pub stderr_text: String,
}

/// 描述：沙盒运行时指标数据。
#[derive(Debug, Clone, Serialize)]
pub struct SandboxMetrics {
    pub memory_bytes: u64,
    pub uptime_secs: u64,
}

/// 描述：沙盒内生的流事件，用于向外同步 Python 内部状态。
#[derive(Debug)]
pub enum SandboxOutput {
    Stdout(String),
    Stderr(String),
    Terminated(i32),
}

/// 描述：持有单个会话的持久化 Python 运行时。
pub struct SandboxInstance {
    pub session_id: String,
    pub child: Child,
    pub stdin: ChildStdin,
    pub receiver: mpsc::Receiver<SandboxOutput>,
    pub last_active_at: Instant,
    pub started_at: Instant,
}

// ── 沙盒协议常量 ──────────────────────────────────────────────────────
//
// 描述：Python 侧预载脚本与 Rust 侧通讯使用的前缀/标记，双端必须保持一致。

/// 描述：Python → Rust 的工具调用请求前缀。
pub const TOOL_CALL_PREFIX: &str = "__AGENT_TOOL_CALL__";

/// 描述：Rust → Python 的工具执行结果前缀。
pub const TOOL_RESULT_PREFIX: &str = "__AGENT_TOOL_RESULT__";

/// 描述：Python → Rust 的最终结果前缀。
pub const FINAL_RESULT_PREFIX: &str = "__AGENT_FINAL__";

/// 描述：Python → Rust 的单次执行结束标记。
pub const TURN_END_MARKER: &str = "__AGENT_TURN_END__";

/// 描述：沙盒就绪标记。
pub const SANDBOX_READY_MARKER: &str = "SANDBOX_READY";

/// 描述：沙盒异常前缀。
pub const SANDBOX_ERROR_PREFIX: &str = "SANDBOX_ERROR:";

/// 描述：批量代码发送协议前缀。
pub const BATCH_SIZE_PREFIX: &str = "BATCH_SIZE:";

const PERSISTENT_PRELUDE: &str = r##"
import json
import sys
import os
import re
import traceback

_TOOL_CALL_PREFIX = "__AGENT_TOOL_CALL__"
_TOOL_RESULT_PREFIX = "__AGENT_TOOL_RESULT__"
_FINAL_RESULT_PREFIX = "__AGENT_FINAL__"
_TURN_END_MARKER = "__AGENT_TURN_END__"

# 描述：强制开启行缓冲与直写模式，确保用户脚本中的普通 print(...) 在持久化进程中也能被 Rust 侧及时读取。
try:
    sys.stdout.reconfigure(line_buffering=True, write_through=True)
except Exception:
    pass

def _invoke_tool(name, args):
    payload = json.dumps({"name": name, "args": args})
    print(f"{_TOOL_CALL_PREFIX}{payload}", flush=True)
    line = sys.stdin.readline()
    if not line:
        return {"ok": False, "error": "stdin_closed"}
    if line.startswith(_TOOL_RESULT_PREFIX):
        return json.loads(line[len(_TOOL_RESULT_PREFIX):])
    return {"ok": False, "error": "invalid_response"}

def finish(message):
    payload = json.dumps({"message": str(message)})
    print(f"{_FINAL_RESULT_PREFIX}{payload}", flush=True)

def _pick_first_non_none(values):
    for value in values:
        if value is not None:
            return value
    return None

def _resolve_with_alias(primary, alias_value, default=None):
    if alias_value is not None:
        return alias_value
    if primary is not None:
        return primary
    return default

def _pop_alias(kwargs, aliases):
    if not isinstance(kwargs, dict):
        return None
    for alias in aliases:
        if alias in kwargs:
            value = kwargs.pop(alias)
            if value is not None:
                return value
    return None

def _require_arg(value, name):
    if value is None:
        raise TypeError(f"{name} is required")
    return value

def run_shell(command=None, timeout_secs=None, **kwargs):
    resolved_command = _pick_first_non_none([command, _pop_alias(kwargs, ("cmd", "shell_command"))])
    timeout_alias = _pop_alias(kwargs, ("timeout", "timeout_seconds"))
    resolved_timeout = _resolve_with_alias(timeout_secs, timeout_alias, 30)
    return _invoke_tool(
        "run_shell",
        {
            "command": _require_arg(resolved_command, "command"),
            "timeout_secs": resolved_timeout if resolved_timeout is not None else 30,
        },
    )

def run_shell_command(command, timeout_secs=30): return run_shell(command=command, timeout_secs=timeout_secs)
def read_text(path=None, with_meta=False, **kwargs):
    resolved_path = _pick_first_non_none([path, _pop_alias(kwargs, ("file_path", "filename"))])
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    response = _invoke_tool("read_text", {"path": _require_arg(resolved_path, "path")})
    if include_meta:
        return response
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            content = data.get("content")
            if isinstance(content, str):
                return content
    return response

def read_json(path=None, with_meta=False, **kwargs):
    resolved_path = _pick_first_non_none([path, _pop_alias(kwargs, ("file_path", "filename"))])
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    response = _invoke_tool("read_json", {"path": _require_arg(resolved_path, "path")})
    if include_meta:
        return response
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict) and "data" in data:
            return data.get("data")
    return response

def write_text(path=None, content=None, **kwargs):
    resolved_path = _pick_first_non_none([path, _pop_alias(kwargs, ("file_path", "filename"))])
    resolved_content = _pick_first_non_none([content, _pop_alias(kwargs, ("text", "value", "body"))])
    return _invoke_tool(
        "write_text",
        {
            "path": _require_arg(resolved_path, "path"),
            "content": _require_arg(resolved_content, "content"),
        },
    )

def write_json(path=None, data=None, **kwargs):
    resolved_path = _pick_first_non_none([path, _pop_alias(kwargs, ("file_path", "filename"))])
    resolved_data = _pick_first_non_none([data, _pop_alias(kwargs, ("value", "payload"))])
    return _invoke_tool(
        "write_json",
        {
            "path": _require_arg(resolved_path, "path"),
            "data": _require_arg(resolved_data, "data"),
        },
    )

def list_dir(path=".", **kwargs):
    path_alias = _pop_alias(kwargs, ("dir_path", "file_path"))
    resolved_path = _resolve_with_alias(path, path_alias, ".")
    return _invoke_tool("list_dir", {"path": resolved_path})

def mkdir(path=None, **kwargs):
    resolved_path = _pick_first_non_none([path, _pop_alias(kwargs, ("dir_path", "file_path"))])
    return _invoke_tool("mkdir", {"path": _require_arg(resolved_path, "path")})

def stat(path=None, **kwargs):
    resolved_path = _pick_first_non_none([path, _pop_alias(kwargs, ("file_path", "target_path"))])
    return _invoke_tool("stat", {"path": _require_arg(resolved_path, "path")})

def glob(pattern=None, max_results=100, **kwargs):
    resolved_pattern = _pick_first_non_none([pattern, _pop_alias(kwargs, ("query", "glob_pattern"))])
    max_results_alias = _pop_alias(kwargs, ("limit",))
    resolved_max_results = _resolve_with_alias(max_results, max_results_alias, 100)
    return _invoke_tool(
        "glob",
        {
            "pattern": _require_arg(resolved_pattern, "pattern"),
            "max_results": resolved_max_results if resolved_max_results is not None else 100,
        },
    )

def search_files(query=None, glob="", max_results=50, **kwargs):
    resolved_query = _pick_first_non_none([query, _pop_alias(kwargs, ("keyword", "q"))])
    glob_alias = _pop_alias(kwargs, ("pattern", "glob_pattern"))
    resolved_glob = _resolve_with_alias(glob, glob_alias, "")
    max_results_alias = _pop_alias(kwargs, ("limit",))
    resolved_max_results = _resolve_with_alias(max_results, max_results_alias, 50)
    return _invoke_tool(
        "search_files",
        {
            "query": _require_arg(resolved_query, "query"),
            "glob": resolved_glob if resolved_glob is not None else "",
            "max_results": resolved_max_results if resolved_max_results is not None else 50,
        },
    )

def git_status(): return _invoke_tool("git_status", {})
def git_diff(path="", **kwargs):
    path_alias = _pop_alias(kwargs, ("file_path", "target_path"))
    resolved_path = _resolve_with_alias(path, path_alias, "")
    return _invoke_tool("git_diff", {"path": resolved_path})

def git_log(limit=5, **kwargs):
    limit_alias = _pop_alias(kwargs, ("max_results", "count"))
    resolved_limit = _resolve_with_alias(limit, limit_alias, 5)
    return _invoke_tool("git_log", {"limit": resolved_limit})

def _normalize_todo_record(record, index):
    default_id = f"todo_{index + 1}"
    if isinstance(record, dict):
        normalized = dict(record)
        normalized_id = normalized.get("id")
        if normalized_id is None or str(normalized_id).strip() == "":
            normalized["id"] = default_id
        else:
            normalized["id"] = str(normalized_id)
        normalized_content = normalized.get("content")
        if normalized_content is None:
            normalized_content = normalized.get("task")
        if normalized_content is None:
            normalized_content = normalized.get("text")
        if normalized_content is None:
            normalized_content = ""
        normalized["content"] = str(normalized_content)
        normalized_status = normalized.get("status")
        if not isinstance(normalized_status, str) or normalized_status.strip() == "":
            normalized["status"] = "pending"
        return normalized
    if isinstance(record, str):
        return {"id": default_id, "content": record, "status": "pending"}
    if record is None:
        return {"id": default_id, "content": "", "status": "pending"}
    return {"id": default_id, "content": str(record), "status": "pending"}

def _normalize_todo_list(items):
    if not isinstance(items, list):
        return items
    normalized_items = []
    for index, item in enumerate(items):
        normalized_items.append(_normalize_todo_record(item, index))
    return normalized_items

def todo_read(with_meta=False, **kwargs):
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    response = _invoke_tool("todo_read", {})
    if include_meta:
        return response
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            items = data.get("items")
            if isinstance(items, list):
                return _normalize_todo_list(items)
    return response

def _normalize_todo_items(items, value=None):
    if isinstance(items, list):
        return _normalize_todo_list(items)
    if isinstance(items, dict):
        return _normalize_todo_list([items])
    if isinstance(items, str) and value is not None:
        return _normalize_todo_list([{
            "id": items,
            "content": str(value),
            "status": "pending",
        }])
    if items is None and isinstance(value, list):
        return _normalize_todo_list(value)
    if items is None and isinstance(value, dict):
        return _normalize_todo_list([value])
    if items is None and isinstance(value, str):
        return _normalize_todo_list([{
            "content": value,
            "status": "pending",
        }])
    return items

def todo_write(items=None, value=None, **kwargs):
    alias_items = _pop_alias(kwargs, ("todos", "tasks"))
    alias_value = _pop_alias(kwargs, ("value", "content", "text", "task"))
    resolved_items = _pick_first_non_none([items, alias_items])
    resolved_value = _pick_first_non_none([value, alias_value])
    normalized_items = _normalize_todo_items(resolved_items, resolved_value)
    return _invoke_tool("todo_write", {"items": _require_arg(normalized_items, "items")})

def apply_patch(patch=None, check_only=False, **kwargs):
    resolved_patch = _pick_first_non_none([patch, _pop_alias(kwargs, ("content", "diff"))])
    check_only_alias = _pop_alias(kwargs, ("dry_run",))
    resolved_check_only = _resolve_with_alias(check_only, check_only_alias, False)
    return _invoke_tool(
        "apply_patch",
        {
            "patch": _require_arg(resolved_patch, "patch"),
            "check_only": bool(resolved_check_only),
        },
    )

def web_search(query=None, limit=5, **kwargs):
    resolved_query = _pick_first_non_none([query, _pop_alias(kwargs, ("q", "keyword"))])
    limit_alias = _pop_alias(kwargs, ("max_results",))
    resolved_limit = _resolve_with_alias(limit, limit_alias, 5)
    return _invoke_tool(
        "web_search",
        {"query": _require_arg(resolved_query, "query"), "limit": resolved_limit if resolved_limit is not None else 5},
    )

def fetch_url(url=None, max_chars=8000, **kwargs):
    resolved_url = _pick_first_non_none([url, _pop_alias(kwargs, ("link",))])
    max_chars_alias = _pop_alias(kwargs, ("limit",))
    resolved_max_chars = _resolve_with_alias(max_chars, max_chars_alias, 8000)
    return _invoke_tool(
        "fetch_url",
        {"url": _require_arg(resolved_url, "url"), "max_chars": resolved_max_chars if resolved_max_chars is not None else 8000},
    )

def mcp_tool(server=None, tool=None, arguments=None, **kwargs):
    resolved_server = _pick_first_non_none([server, _pop_alias(kwargs, ("mcp", "server_id"))])
    resolved_tool = _pick_first_non_none([tool, _pop_alias(kwargs, ("name", "action"))])
    resolved_arguments = _pick_first_non_none([arguments, _pop_alias(kwargs, ("params", "payload", "data"))])
    return _invoke_tool(
        "mcp_tool",
        {
            "server": resolved_server or "",
            "tool": _require_arg(resolved_tool, "tool"),
            "arguments": resolved_arguments or {},
        },
    )

def dcc_tool(capability=None, action=None, arguments=None, software=None, source_software=None, target_software=None, **kwargs):
    resolved_capability = _pick_first_non_none([capability, _pop_alias(kwargs, ("domain_capability",))])
    resolved_action = _pick_first_non_none([action, _pop_alias(kwargs, ("tool", "name"))])
    resolved_arguments = _pick_first_non_none([arguments, _pop_alias(kwargs, ("params", "payload", "data"))])
    resolved_software = _pick_first_non_none([software, _pop_alias(kwargs, ("dcc",))])
    resolved_source_software = _pick_first_non_none([source_software, _pop_alias(kwargs, ("sourceSoftware", "source"))])
    resolved_target_software = _pick_first_non_none([target_software, _pop_alias(kwargs, ("targetSoftware", "target"))])
    return _invoke_tool(
        "dcc_tool",
        {
            "capability": _require_arg(resolved_capability, "capability"),
            "action": _require_arg(resolved_action, "action"),
            "arguments": resolved_arguments or {},
            "software": resolved_software or "",
            "source_software": resolved_source_software or "",
            "target_software": resolved_target_software or "",
        },
    )

def mcp_model_tool(action=None, params=None, **kwargs):
    resolved_action = _pick_first_non_none([action, _pop_alias(kwargs, ("name", "tool"))])
    resolved_params = _pick_first_non_none([params, _pop_alias(kwargs, ("payload", "data"))])
    return mcp_tool(server="model", tool=_require_arg(resolved_action, "action"), arguments=resolved_params or {})

def tool_search(query="", limit=10, **kwargs):
    query_alias = _pop_alias(kwargs, ("q", "keyword"))
    resolved_query = _resolve_with_alias(query, query_alias, "")
    limit_alias = _pop_alias(kwargs, ("max_results",))
    resolved_limit = _resolve_with_alias(limit, limit_alias, 10)
    return _invoke_tool(
        "tool_search",
        {
            "query": resolved_query if resolved_query is not None else "",
            "limit": resolved_limit if resolved_limit is not None else 10,
        },
    )

def read_file(file_path):
    return read_text(file_path)

def write_file(file_path, content):
    return write_text(file_path, content)

def list_directory(dir_path=".", path=None):
    target_path = path if path is not None else dir_path
    result = list_dir(target_path)
    if isinstance(result, dict):
        entries = result.get("entries")
        if isinstance(entries, list):
            names = []
            for entry in entries:
                if isinstance(entry, dict):
                    name = entry.get("name")
                    if isinstance(name, str):
                        names.append(name)
            return names
    return result

def _register_gemini_native_tools_alias():
    # 描述：兼容 Gemini 常见脚本习惯，允许 `from gemini_cli_native_tools import ...` 直接工作。
    try:
        import types
        module = types.ModuleType("gemini_cli_native_tools")
        exports = {
            "list_directory": list_directory,
            "write_file": write_file,
            "read_file": read_file,
            "run_shell_command": run_shell_command,
            "finish": finish,
        }
        for name, handler in exports.items():
            setattr(module, name, handler)
        sys.modules["gemini_cli_native_tools"] = module
    except Exception:
        # 描述：别名注册失败不应阻断主流程，继续按内置工具函数执行。
        pass

_register_gemini_native_tools_alias()

def _is_probable_python_entry(line):
    text = line.strip().lstrip("\ufeff")
    if not text:
        return False
    prefixes = (
        "import ", "from ", "def ", "class ", "if ", "for ", "while ",
        "try:", "with ", "@", "#", "\"\"\"", "'''"
    )
    if text.startswith(prefixes):
        return True
    # 描述：支持最常见的赋值语句入口，避免前置自然语言导致整段脚本失效。
    if "=" in text and not any(op in text for op in ("==", ">=", "<=", "!=")):
        return True
    return False

def _strip_non_code_prefix(code):
    lines = code.splitlines()
    for index, line in enumerate(lines):
        if _is_probable_python_entry(line):
            return "\n".join(lines[index:]).strip()
    return code

print("SANDBOX_READY", flush=True)

while True:
    try:
        header = sys.stdin.readline()
        if not header: break
        if not header.startswith("BATCH_SIZE:"): continue
        size = int(header.split(":")[1])
        code = sys.stdin.read(size)
        # 描述：双重兜底，避免 LLM 返回前置自然语言时直接触发 line 1 语法错误。
        code = _strip_non_code_prefix(code)
        exec(code, globals())
        print(_TURN_END_MARKER, flush=True)
    except Exception as e:
        print(f"SANDBOX_ERROR:{traceback.format_exc()}", flush=True)
        print(_TURN_END_MARKER, flush=True)
"##;

impl SandboxInstance {
    pub fn start(
        session_id: &str,
        sandbox_root: &Path,
        python_bin: &str,
    ) -> Result<Self, ProtocolError> {
        info!(session_id = %session_id, "starting persistent python sandbox");

        let mut child = Command::new(python_bin)
            .arg("-I")
            .arg("-c")
            .arg(PERSISTENT_PRELUDE)
            .current_dir(sandbox_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| ProtocolError::new("sandbox.spawn_failed", err.to_string()))?;

        let stdin = child.stdin.take().ok_or_else(|| {
            ProtocolError::new("sandbox.stdin_missing", "Python 进程 stdin 管道不可用")
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            ProtocolError::new("sandbox.stdout_missing", "Python 进程 stdout 管道不可用")
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            ProtocolError::new("sandbox.stderr_missing", "Python 进程 stderr 管道不可用")
        })?;

        let (tx, rx) = mpsc::channel();
        let tx_out = tx.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok() && !line.is_empty() {
                let text = line.trim_end().to_string();
                if tx_out.send(SandboxOutput::Stdout(text)).is_err() {
                    break;
                }
                line.clear();
            }
        });

        let tx_err = tx.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok() && !line.is_empty() {
                let text = line.trim_end().to_string();
                if tx_err.send(SandboxOutput::Stderr(text)).is_err() {
                    break;
                }
                line.clear();
            }
        });

        let ready_timeout = Duration::from_secs(5);
        let started = Instant::now();
        loop {
            if started.elapsed() > ready_timeout {
                let _ = child.kill();
                return Err(ProtocolError::new(
                    "sandbox.init_timeout",
                    "Python 运行时初始化超时",
                ));
            }
            if let Ok(SandboxOutput::Stdout(line)) = rx.try_recv() {
                if line == SANDBOX_READY_MARKER {
                    break;
                }
            }
            thread::sleep(Duration::from_millis(100));
        }

        Ok(Self {
            session_id: session_id.to_string(),
            child,
            stdin,
            receiver: rx,
            last_active_at: Instant::now(),
            started_at: Instant::now(),
        })
    }

    pub fn get_metrics(&self) -> SandboxMetrics {
        let mut sys = System::new_all();
        let pid = Pid::from(self.child.id() as usize);
        let _ = sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);

        let memory_bytes = sys.process(pid).map(|p| p.memory()).unwrap_or(0);
        let uptime_secs = self.started_at.elapsed().as_secs();

        SandboxMetrics {
            memory_bytes,
            uptime_secs,
        }
    }

    pub fn write_tool_result(&mut self, result: &Value) -> Result<(), ProtocolError> {
        let line = format!("{}{result}\n", TOOL_RESULT_PREFIX);
        self.stdin
            .write_all(line.as_bytes())
            .map_err(|err| ProtocolError::new("sandbox.write_failed", err.to_string()))?;
        self.stdin.flush().ok();
        Ok(())
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
    }
}

pub struct SandboxRegistry {
    instances: DashMap<String, Arc<Mutex<SandboxInstance>>>,
}

impl SandboxRegistry {
    pub fn get_or_create(
        &self,
        session_id: &str,
        sandbox_root: &Path,
        python_bin: &str,
    ) -> Result<Arc<Mutex<SandboxInstance>>, ProtocolError> {
        if let Some(existing) = self.instances.get(session_id) {
            return Ok(existing.value().clone());
        }
        match self.instances.entry(session_id.to_string()) {
            dashmap::mapref::entry::Entry::Occupied(entry) => Ok(entry.get().clone()),
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                let instance = SandboxInstance::start(session_id, sandbox_root, python_bin)?;
                let handle = Arc::new(Mutex::new(instance));
                entry.insert(handle.clone());
                Ok(handle)
            }
        }
    }

    pub fn get_metrics(&self, session_id: &str) -> Option<SandboxMetrics> {
        self.instances.get(session_id).and_then(|r| {
            // 描述：
            //
            //   - 指标查询必须非阻塞，避免“等待人工授权”等长时占锁阶段把桌面端命令线程挂住。
            r.value().try_lock().ok().map(|g| g.get_metrics())
        })
    }

    pub fn remove(&self, session_id: &str) {
        if let Some((_, instance)) = self.instances.remove(session_id) {
            info!(session_id = %session_id, "killing sandbox instance");
            if let Ok(mut guard) = instance.lock() {
                guard.kill();
            }
        }
    }

    pub fn reset(&self, session_id: &str) {
        self.remove(session_id);
        info!(session_id = %session_id, "sandbox marked for lazy restart");
    }

    pub fn cleanup_idle(&self, timeout: Duration) {
        let to_remove: Vec<String> = self
            .instances
            .iter()
            .filter(|r| {
                r.value()
                    .lock()
                    .map(|g| g.last_active_at.elapsed() > timeout)
                    .unwrap_or(false)
            })
            .map(|r| r.key().clone())
            .collect();
        for id in to_remove {
            info!(session_id = %id, "cleaning up idle sandbox");
            self.remove(&id);
        }
    }
}

pub static SANDBOX_REGISTRY: Lazy<SandboxRegistry> = Lazy::new(|| SandboxRegistry {
    instances: DashMap::new(),
});

#[cfg(test)]
mod tests {
    use super::PERSISTENT_PRELUDE;

    #[test]
    fn should_register_gemini_native_tools_alias_in_prelude() {
        // 描述：
        //
        //   - 沙盒预置脚本应注册 `gemini_cli_native_tools` 兼容模块别名，
        //     防止模型脚本直接 import 时触发 ModuleNotFoundError。
        assert!(PERSISTENT_PRELUDE.contains("_register_gemini_native_tools_alias"));
        assert!(PERSISTENT_PRELUDE.contains("types.ModuleType(\"gemini_cli_native_tools\")"));
        assert!(PERSISTENT_PRELUDE.contains("sys.modules[\"gemini_cli_native_tools\"] = module"));
    }

    #[test]
    fn should_expose_run_shell_command_alias_in_prelude() {
        // 描述：
        //
        //   - 沙盒预置脚本应暴露 run_shell_command 别名，
        //     兼容模型常见调用习惯并映射到 run_shell。
        assert!(PERSISTENT_PRELUDE.contains("def run_shell_command(command, timeout_secs=30): return run_shell(command=command, timeout_secs=timeout_secs)"));
        assert!(PERSISTENT_PRELUDE.contains("\"run_shell_command\": run_shell_command"));
    }

    #[test]
    fn should_support_keyword_aliases_for_write_text_in_prelude() {
        // 描述：
        //
        //   - 兼容层应支持模型常用的 `write_text(file_path=..., text=...)` 关键字参数写法，
        //     避免触发 unexpected keyword argument 并导致整轮执行失败。
        assert!(PERSISTENT_PRELUDE.contains("def write_text(path=None, content=None, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("(\"file_path\", \"filename\")"));
        assert!(PERSISTENT_PRELUDE.contains("(\"text\", \"value\", \"body\")"));
    }

    #[test]
    fn should_support_todo_write_legacy_two_argument_style_in_prelude() {
        // 描述：
        //
        //   - 兼容层应支持历史脚本中的 `todo_write(\"KEY\", \"VALUE\")` 写法，
        //     避免因参数个数不匹配直接抛 TypeError 导致整轮执行失败。
        assert!(PERSISTENT_PRELUDE.contains("def todo_write(items=None, value=None, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("def _normalize_todo_items(items, value=None):"));
        assert!(PERSISTENT_PRELUDE.contains("if isinstance(items, str) and value is not None:"));
    }

    #[test]
    fn should_guard_alias_parser_and_unwrap_todo_read_items_in_prelude() {
        // 描述：
        //
        //   - 兼容层应在 `_pop_alias` 中校验 kwargs 类型，避免异常脚本把字符串当 kwargs 传入时触发类型错误。
        //   - todo_read 默认应返回 items 列表，且每项具备 id/content/status，减少脚本直接索引字段时的结构误判。
        assert!(PERSISTENT_PRELUDE.contains("if not isinstance(kwargs, dict):"));
        assert!(PERSISTENT_PRELUDE.contains("def todo_read(with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("def _normalize_todo_record(record, index):"));
        assert!(PERSISTENT_PRELUDE.contains("def _normalize_todo_list(items):"));
        assert!(PERSISTENT_PRELUDE.contains("return _normalize_todo_list(items)"));
    }

    #[test]
    fn should_unwrap_read_text_and_read_json_results_by_default_in_prelude() {
        // 描述：
        //
        //   - read_text/read_json 默认应返回业务脚本最常用的数据主体，
        //     分别是文本 content 与 JSON data，避免模型重复手写 data 解包逻辑。
        //   - 当脚本需要完整元信息时，仍可通过 with_meta/include_meta/raw 获取原始响应。
        assert!(PERSISTENT_PRELUDE.contains("def read_text(path=None, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("content = data.get(\"content\")"));
        assert!(PERSISTENT_PRELUDE.contains("def read_json(path=None, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("if isinstance(data, dict) and \"data\" in data:"));
        assert!(PERSISTENT_PRELUDE.contains("_pop_alias(kwargs, (\"include_meta\", \"raw\"))"));
    }
}
