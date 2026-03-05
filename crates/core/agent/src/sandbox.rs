use dashmap::DashMap;
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
use zodileap_mcp_common::ProtocolError;

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
    print(f"{_FINAL_RESULT_PREFIX}{message}", flush=True)

def run_shell(command, timeout_secs=30): return _invoke_tool("run_shell", {"command": command, "timeout_secs": timeout_secs})
def run_shell_command(command, timeout_secs=30): return run_shell(command=command, timeout_secs=timeout_secs)
def read_text(path): return _invoke_tool("read_text", {"path": path})
def read_json(path): return _invoke_tool("read_json", {"path": path})
def write_text(path, content): return _invoke_tool("write_text", {"path": path, "content": content})
def write_json(path, data): return _invoke_tool("write_json", {"path": path, "data": data})
def list_dir(path="."): return _invoke_tool("list_dir", {"path": path})
def mkdir(path): return _invoke_tool("mkdir", {"path": path})
def stat(path): return _invoke_tool("stat", {"path": path})
def glob(pattern, max_results=100): return _invoke_tool("glob", {"pattern": pattern, "max_results": max_results})
def search_files(query, glob="", max_results=50): return _invoke_tool("search_files", {"query": query, "glob": glob, "max_results": max_results})
def git_status(): return _invoke_tool("git_status", {})
def git_diff(path=""): return _invoke_tool("git_diff", {"path": path})
def git_log(limit=5): return _invoke_tool("git_log", {"limit": limit})
def todo_read(): return _invoke_tool("todo_read", {})
def todo_write(items): return _invoke_tool("todo_write", {"items": items})
def apply_patch(patch, check_only=False): return _invoke_tool("apply_patch", {"patch": patch, "check_only": check_only})
def web_search(query, limit=5): return _invoke_tool("web_search", {"query": query, "limit": limit})
def fetch_url(url, max_chars=8000): return _invoke_tool("fetch_url", {"url": url, "max_chars": max_chars})
def mcp_model_tool(action, params=None): return _invoke_tool("mcp_model_tool", {"action": action, "params": params or {}})
def tool_search(query="", limit=10): return _invoke_tool("tool_search", {"query": query, "limit": limit})

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
        self.instances
            .get(session_id)
            .and_then(|r| r.value().lock().ok().map(|g| g.get_metrics()))
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
}
