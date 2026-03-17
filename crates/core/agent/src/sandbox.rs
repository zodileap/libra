use crate::platform::CommandCandidate;
use dashmap::DashMap;
use libra_mcp_common::ProtocolError;
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
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
import ast
import io
import builtins
import tokenize
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
        return _remember_last_value({"ok": False, "error": "stdin_closed"})
    if line.startswith(_TOOL_RESULT_PREFIX):
        return _remember_last_value(json.loads(line[len(_TOOL_RESULT_PREFIX):]))
    return _remember_last_value({"ok": False, "error": "invalid_response"})

# 描述：记录最近一次工具或兼容层返回值，兼容模型将上一条结果写成 `_` 的 REPL 风格用法。
def _remember_last_value(value):
    try:
        setattr(builtins, "_", value)
    except Exception:
        pass
    return value

# 描述：为 `_` 提供稳定初始值，避免脚本在首次读取时直接触发 NameError。
try:
    setattr(builtins, "_", None)
except Exception:
    pass

def finish(message=None, status=None, summary=None, next=None, **kwargs):
    resolved_message = _pick_first_non_none([message, _pop_alias(kwargs, ("text", "value", "body", "TEXT", "VALUE", "BODY", "MESSAGE"))])
    resolved_status = _pick_first_non_none([status, _pop_alias(kwargs, ("state", "STATUS", "STATE"))])
    resolved_summary = _pick_first_non_none([summary, _pop_alias(kwargs, ("result", "content", "SUMMARY", "RESULT", "CONTENT"))])
    resolved_next = _pick_first_non_none([next, _pop_alias(kwargs, ("next_step", "nextStep", "NEXT", "NEXT_STEP"))])
    if isinstance(resolved_message, dict):
        envelope = dict(resolved_message)
        dict_status = _pop_mapping_alias(envelope, ("STATUS", "status", "state", "STATE"))
        dict_summary = _pop_mapping_alias(envelope, ("SUMMARY", "summary", "result", "RESULT", "content", "CONTENT"))
        dict_next = _pop_mapping_alias(envelope, ("NEXT", "next", "next_step", "nextStep", "NEXT_STEP"))
        dict_message = _pop_mapping_alias(envelope, ("message", "MESSAGE", "text", "TEXT", "value", "body"))
        resolved_status = _pick_first_non_none([resolved_status, dict_status])
        resolved_summary = _pick_first_non_none([resolved_summary, dict_summary])
        resolved_next = _pick_first_non_none([resolved_next, dict_next])
        if dict_message is not None:
            resolved_message = dict_message
        elif dict_status is not None or dict_summary is not None or dict_next is not None:
            resolved_message = None

    if resolved_status is not None or resolved_summary is not None or resolved_next is not None:
        lines = []
        if resolved_status is not None and str(resolved_status).strip():
            lines.append(f"STATUS: {resolved_status}")
        if resolved_summary is not None and str(resolved_summary).strip():
            lines.append(f"SUMMARY: {resolved_summary}")
        if resolved_next is not None and str(resolved_next).strip():
            lines.append(f"NEXT: {resolved_next}")
        if resolved_message is not None and str(resolved_message).strip():
            lines.append(str(resolved_message))
        payload_message = "\n".join(lines)
    else:
        payload_message = str(_require_arg(resolved_message, "message"))

    payload = json.dumps({"message": payload_message})
    print(f"{_FINAL_RESULT_PREFIX}{payload}", flush=True)

def _pick_first_non_none(values):
    for value in values:
        if value is not None:
            return value
    return None

class _DirectoryEntry(str):
    def __new__(cls, name="", path="", is_dir=False, is_file=False):
        resolved_name = "" if name is None else str(name)
        value = str.__new__(cls, resolved_name)
        value._meta = {
            "name": resolved_name,
            "path": "" if path is None else str(path),
            "is_dir": bool(is_dir),
            "is_file": bool(is_file),
        }
        return value

    def __getitem__(self, key):
        if isinstance(key, str):
            if key in self._meta:
                return self._meta[key]
            raise KeyError(key)
        return str.__getitem__(self, key)

    def get(self, key, default=None):
        return self._meta.get(key, default)

    def to_dict(self):
        return dict(self._meta)

# 描述：将 run_shell 默认结果包装为“可按 dict 读字段、也可做基础字符串判断”的兼容对象。
class _ShellResult(dict):
    def __getattr__(self, key):
        if key in self:
            return self[key]
        raise AttributeError(key)

    def _as_text(self):
        text_parts = []
        if self.get("timed_out"):
            text_parts.append("timed_out")
        elif self.get("success") is False or self.get("ok") is False:
            text_parts.append("failed")
        for key in ("stdout", "stderr", "error", "message"):
            value = self.get(key)
            if isinstance(value, str) and value.strip():
                text_parts.append(value)
        if not text_parts:
            return json.dumps(dict(self), ensure_ascii=False)
        return "\n".join(text_parts)

    def lower(self):
        return self._as_text().lower()

    def strip(self, chars=None):
        return self._as_text().strip(chars)

    def split(self, *args, **kwargs):
        return self._as_text().split(*args, **kwargs)

    def splitlines(self, *args, **kwargs):
        return self._as_text().splitlines(*args, **kwargs)

    def __str__(self):
        return self._as_text()

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

def _pop_mapping_alias(mapping, aliases):
    if not isinstance(mapping, dict):
        return None
    for alias in aliases:
        if alias in mapping:
            value = mapping.pop(alias)
            if value is not None:
                return value
    return None

def _require_arg(value, name):
    if value is None:
        raise TypeError(f"{name} is required")
    return value

def _normalize_dir_entries(entries):
    if not isinstance(entries, list):
        return entries
    normalized_entries = []
    for entry in entries:
        if isinstance(entry, dict):
            normalized_entries.append(_DirectoryEntry(
                entry.get("name"),
                entry.get("path"),
                entry.get("is_dir"),
                entry.get("is_file"),
            ))
        elif isinstance(entry, str):
            normalized_entries.append(_DirectoryEntry(entry))
        else:
            normalized_entries.append(entry)
    return normalized_entries

def run_shell(command=None, timeout_secs=None, with_meta=False, **kwargs):
    resolved_command = _pick_first_non_none([command, _pop_alias(kwargs, ("cmd", "shell_command"))])
    timeout_alias = _pop_alias(kwargs, ("timeout", "timeout_seconds"))
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    resolved_timeout = _resolve_with_alias(timeout_secs, timeout_alias, 30)
    response = _invoke_tool(
        "run_shell",
        {
            "command": _require_arg(resolved_command, "command"),
            "timeout_secs": resolved_timeout if resolved_timeout is not None else 30,
        },
    )
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(_ShellResult(data))
        return _remember_last_value(_ShellResult(response))
    return _remember_last_value(response)

def run_shell_command(command, timeout_secs=30, with_meta=False): return run_shell(command=command, timeout_secs=timeout_secs, with_meta=with_meta)
def read_text(path=None, with_meta=False, **kwargs):
    resolved_path = _pick_first_non_none([path, _pop_alias(kwargs, ("file_path", "filename"))])
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    response = _invoke_tool("read_text", {"path": _require_arg(resolved_path, "path")})
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            content = data.get("content")
            if isinstance(content, str):
                return _remember_last_value(content)
    return _remember_last_value(response)

def read_json(path=None, with_meta=False, **kwargs):
    resolved_path = _pick_first_non_none([path, _pop_alias(kwargs, ("file_path", "filename"))])
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    response = _invoke_tool("read_json", {"path": _require_arg(resolved_path, "path")})
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict) and "data" in data:
            return _remember_last_value(data.get("data"))
    return _remember_last_value(response)

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

def list_dir(path=".", with_meta=False, **kwargs):
    path_alias = _pop_alias(kwargs, ("dir_path", "file_path"))
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    resolved_path = _resolve_with_alias(path, path_alias, ".")
    response = _invoke_tool("list_dir", {"path": resolved_path})
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        if response.get("ok") is False:
            # 描述：目录探测是高频探索动作，缺失目录时优先回空列表，
            # 让脚本能够继续创建目录/文件，而不是把错误对象误当列表触发下游 KeyError。
            return _remember_last_value([])
        data = response.get("data")
        if isinstance(data, dict):
            entries = data.get("entries")
            if isinstance(entries, list):
                return _remember_last_value(_normalize_dir_entries(entries))
    return _remember_last_value(response)

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
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            items = data.get("items")
            if isinstance(items, list):
                return _remember_last_value(_normalize_todo_list(items))
    return _remember_last_value(response)

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

def _normalize_user_input_questions(questions):
    if isinstance(questions, list):
        return questions
    if isinstance(questions, dict):
        return [questions]
    return questions

def request_user_input(questions=None, with_meta=False, **kwargs):
    resolved_questions = _pick_first_non_none([questions, _pop_alias(kwargs, ("items", "prompts"))])
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    normalized_questions = _normalize_user_input_questions(resolved_questions)
    response = _invoke_tool(
        "request_user_input",
        {"questions": _require_arg(normalized_questions, "questions")},
    )
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            flattened = dict(data)
            flattened.setdefault("ok", bool(response.get("ok", True)))
            return _remember_last_value(flattened)
    return _remember_last_value(response)

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

def js_repl(source=None, with_meta=False, **kwargs):
    resolved_source = _pick_first_non_none([source, _pop_alias(kwargs, ("code",))])
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    response = _invoke_tool("js_repl", {"source": _require_arg(resolved_source, "source")})
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            if "value" in data:
                return _remember_last_value(data.get("value"))
            return _remember_last_value(data)
    return _remember_last_value(response)

def js_repl_reset(close_browser=True, with_meta=False, **kwargs):
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    resolved_close_browser = bool(_resolve_with_alias(close_browser, _pop_alias(kwargs, ("closeBrowser",)), True))
    response = _invoke_tool("js_repl_reset", {"close_browser": resolved_close_browser})
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(data)
    return _remember_last_value(response)

def browser_navigate(url=None, wait_until="domcontentloaded", timeout_ms=30000, with_meta=False, **kwargs):
    resolved_url = _pick_first_non_none([url, _pop_alias(kwargs, ("link",))])
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    resolved_wait_until = _resolve_with_alias(wait_until, _pop_alias(kwargs, ("waitUntil",)), "domcontentloaded")
    resolved_timeout_ms = _resolve_with_alias(timeout_ms, _pop_alias(kwargs, ("timeout",)), 30000)
    response = _invoke_tool("browser_navigate", {
        "url": _require_arg(resolved_url, "url"),
        "wait_until": resolved_wait_until if resolved_wait_until is not None else "domcontentloaded",
        "timeout_ms": resolved_timeout_ms if resolved_timeout_ms is not None else 30000,
    })
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(data)
    return _remember_last_value(response)

def browser_snapshot(max_elements=40, max_text_chars=4000, with_meta=False, **kwargs):
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    resolved_max_elements = _resolve_with_alias(max_elements, _pop_alias(kwargs, ("limit",)), 40)
    resolved_max_text_chars = _resolve_with_alias(max_text_chars, _pop_alias(kwargs, ("text_limit",)), 4000)
    response = _invoke_tool("browser_snapshot", {
        "max_elements": resolved_max_elements if resolved_max_elements is not None else 40,
        "max_text_chars": resolved_max_text_chars if resolved_max_text_chars is not None else 4000,
    })
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(data)
    return _remember_last_value(response)

def browser_click(selector=None, text=None, role=None, index=0, exact=False, button="left", double_click=False, timeout_ms=30000, with_meta=False, **kwargs):
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    resolved_selector = _pick_first_non_none([selector, _pop_alias(kwargs, ("path", "locator"))])
    resolved_text = _pick_first_non_none([text, _pop_alias(kwargs, ("name", "target_text"))])
    resolved_role = _resolve_with_alias(role, _pop_alias(kwargs, ("aria_role",)), "")
    resolved_index = _resolve_with_alias(index, _pop_alias(kwargs, ("nth",)), 0)
    resolved_exact = bool(_resolve_with_alias(exact, _pop_alias(kwargs, ("match_exact",)), False))
    resolved_button = _resolve_with_alias(button, _pop_alias(kwargs, ("mouse_button",)), "left")
    resolved_double_click = bool(_resolve_with_alias(double_click, _pop_alias(kwargs, ("doubleClick",)), False))
    resolved_timeout_ms = _resolve_with_alias(timeout_ms, _pop_alias(kwargs, ("timeout",)), 30000)
    response = _invoke_tool("browser_click", {
        "selector": resolved_selector or "",
        "text": resolved_text or "",
        "role": resolved_role or "",
        "index": resolved_index if resolved_index is not None else 0,
        "exact": resolved_exact,
        "button": resolved_button if resolved_button is not None else "left",
        "doubleClick": resolved_double_click,
        "timeout_ms": resolved_timeout_ms if resolved_timeout_ms is not None else 30000,
    })
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(data)
    return _remember_last_value(response)

def browser_type(selector=None, text=None, role=None, name=None, index=0, exact=False, clear_first=True, submit=False, slowly=False, timeout_ms=30000, with_meta=False, **kwargs):
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    resolved_selector = _pick_first_non_none([selector, _pop_alias(kwargs, ("path", "locator"))])
    resolved_text = _pick_first_non_none([text, _pop_alias(kwargs, ("value", "input"))])
    resolved_role = _resolve_with_alias(role, _pop_alias(kwargs, ("aria_role",)), "")
    resolved_name = _pick_first_non_none([name, _pop_alias(kwargs, ("target_text", "label"))])
    resolved_index = _resolve_with_alias(index, _pop_alias(kwargs, ("nth",)), 0)
    resolved_exact = bool(_resolve_with_alias(exact, _pop_alias(kwargs, ("match_exact",)), False))
    resolved_timeout_ms = _resolve_with_alias(timeout_ms, _pop_alias(kwargs, ("timeout",)), 30000)
    response = _invoke_tool("browser_type", {
        "selector": resolved_selector or "",
        "text": _require_arg(resolved_text, "text"),
        "role": resolved_role or "",
        "name": resolved_name or "",
        "index": resolved_index if resolved_index is not None else 0,
        "exact": resolved_exact,
        "clear_first": bool(_resolve_with_alias(clear_first, _pop_alias(kwargs, ("clearFirst",)), True)),
        "submit": bool(_resolve_with_alias(submit, _pop_alias(kwargs, ("press_enter",)), False)),
        "slowly": bool(_resolve_with_alias(slowly, _pop_alias(kwargs, ("type_slowly",)), False)),
        "timeout_ms": resolved_timeout_ms if resolved_timeout_ms is not None else 30000,
    })
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(data)
    return _remember_last_value(response)

def browser_wait_for(time_secs=None, text=None, text_gone=None, selector=None, timeout_ms=30000, with_meta=False, **kwargs):
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    resolved_timeout_ms = _resolve_with_alias(timeout_ms, _pop_alias(kwargs, ("timeout",)), 30000)
    response = _invoke_tool("browser_wait_for", {
        "time_secs": _resolve_with_alias(time_secs, _pop_alias(kwargs, ("time", "seconds")), 0) or 0,
        "text": _resolve_with_alias(text, _pop_alias(kwargs, ("contains_text",)), "") or "",
        "text_gone": _resolve_with_alias(text_gone, _pop_alias(kwargs, ("textGone", "gone_text")), "") or "",
        "selector": _resolve_with_alias(selector, _pop_alias(kwargs, ("path", "locator")), "") or "",
        "timeout_ms": resolved_timeout_ms if resolved_timeout_ms is not None else 30000,
    })
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(data)
    return _remember_last_value(response)

def browser_take_screenshot(path=None, full_page=False, type="png", with_meta=False, **kwargs):
    resolved_path = _pick_first_non_none([path, _pop_alias(kwargs, ("file_path", "filename"))])
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    response = _invoke_tool("browser_take_screenshot", {
        "path": _require_arg(resolved_path, "path"),
        "full_page": bool(_resolve_with_alias(full_page, _pop_alias(kwargs, ("fullPage",)), False)),
        "type": _resolve_with_alias(type, _pop_alias(kwargs, ("image_type",)), "png") or "png",
    })
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(data)
    return _remember_last_value(response)

def browser_tabs(action="list", index=0, url="", with_meta=False, **kwargs):
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    resolved_action = _resolve_with_alias(action, _pop_alias(kwargs, ("mode",)), "list")
    resolved_index = _resolve_with_alias(index, _pop_alias(kwargs, ("tab_index",)), 0)
    resolved_url = _resolve_with_alias(url, _pop_alias(kwargs, ("link",)), "")
    response = _invoke_tool("browser_tabs", {
        "action": resolved_action if resolved_action is not None else "list",
        "index": resolved_index if resolved_index is not None else 0,
        "url": resolved_url if resolved_url is not None else "",
    })
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(data)
    return _remember_last_value(response)

def browser_close(with_meta=False, **kwargs):
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    response = _invoke_tool("browser_close", {})
    if include_meta:
        return _remember_last_value(response)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict):
            return _remember_last_value(data)
    return _remember_last_value(response)

def read_file(file_path):
    return read_text(file_path)

def write_file(file_path, content):
    return write_text(file_path, content)

def _extract_list_dir_entries(result):
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        if result.get("ok") is False:
            return []
        # 描述：list_dir 会返回 {"ok": True, "data": {...}} 包装结构，
        # 兼容别名需要继续下钻到 data.entries，避免把响应对象误当成目录项列表返回。
        data = result.get("data")
        if isinstance(data, dict):
            entries = data.get("entries")
            if isinstance(entries, list):
                return entries
        entries = result.get("entries")
        if isinstance(entries, list):
            return entries
    return None

def _flatten_list_directory_entries(base_path, entries):
    flattened_entries = []
    pending = [("", base_path, entries)]
    visited = set()
    while pending:
        prefix, current_path, current_entries = pending.pop(0)
        normalized_current_path = os.path.normpath(current_path if isinstance(current_path, str) and current_path else ".")
        if normalized_current_path in visited:
            continue
        visited.add(normalized_current_path)
        if not isinstance(current_entries, list):
            continue
        for entry in current_entries:
            if isinstance(entry, dict):
                name = entry.get("name")
                is_dir = bool(entry.get("is_dir"))
                is_file = bool(entry.get("is_file"))
            elif isinstance(entry, str):
                name = str(entry)
                is_dir = False
                is_file = True
            else:
                name = None
                is_dir = False
                is_file = False
            if not isinstance(name, str) or not name:
                continue
            relative_name = os.path.join(prefix, name) if prefix else name
            flattened_entries.append({
                "name": relative_name,
                "path": os.path.join(base_path, relative_name) if isinstance(base_path, str) and base_path else relative_name,
                "is_dir": is_dir,
                "is_file": is_file,
            })
            if is_dir:
                child_path = os.path.join(current_path, name) if isinstance(current_path, str) and current_path else name
                child_entries = _extract_list_dir_entries(list_dir(child_path, with_meta=True))
                if isinstance(child_entries, list):
                    pending.append((relative_name, child_path, child_entries))
    return flattened_entries

def list_directory(dir_path=".", path=None, recursive=False, with_meta=False, **kwargs):
    path_alias = _pop_alias(kwargs, ("file_path", "target_path"))
    recursive_alias = _pop_alias(kwargs, ("deep", "walk"))
    include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, ("include_meta", "raw")), False))
    target_path = _pick_first_non_none([path, path_alias, dir_path, "."])
    should_recurse = bool(_resolve_with_alias(recursive, recursive_alias, False))
    result = list_dir(target_path, with_meta=True)
    entries = _extract_list_dir_entries(result)
    if isinstance(entries, list):
        if should_recurse:
            recursive_entries = _flatten_list_directory_entries(target_path, entries)
            if include_meta:
                return _remember_last_value({
                    "ok": True,
                    "data": {
                        "path": target_path,
                        "recursive": True,
                        "entries": recursive_entries,
                    },
                })
            return _remember_last_value([
                entry.get("name")
                for entry in recursive_entries
                if isinstance(entry, dict) and isinstance(entry.get("name"), str)
            ])
        if include_meta:
            return _remember_last_value(result)
        names = []
        for entry in entries:
            if isinstance(entry, dict):
                name = entry.get("name")
            elif isinstance(entry, str):
                name = str(entry)
            else:
                name = None
            if isinstance(name, str):
                names.append(name)
        return _remember_last_value(names)
    if include_meta:
        return _remember_last_value(result)
    return _remember_last_value(result)

def _register_python_tool_module_aliases():
    # 描述：兼容 Gemini 与通用 Python Agent 常见脚本习惯，允许历史模板继续使用
    #   `from gemini_cli_native_tools import ...`、`from tools import ...`、
    #   `from default_api import ...` 等旧式导入，避免触发 ModuleNotFoundError。
    try:
        import types
        exports = {
            "read_text": read_text,
            "read_json": read_json,
            "write_text": write_text,
            "write_json": write_json,
            "list_dir": list_dir,
            "list_directory": list_directory,
            "read_file": read_file,
            "write_file": write_file,
            "mkdir": mkdir,
            "stat": stat,
            "glob": glob,
            "search_files": search_files,
            "run_shell": run_shell,
            "run_shell_command": run_shell_command,
            "git_status": git_status,
            "git_diff": git_diff,
            "git_log": git_log,
            "apply_patch": apply_patch,
            "todo_read": todo_read,
            "todo_write": todo_write,
            "request_user_input": request_user_input,
            "web_search": web_search,
            "fetch_url": fetch_url,
            "mcp_tool": mcp_tool,
            "dcc_tool": dcc_tool,
            "tool_search": tool_search,
            "finish": finish,
        }
        for module_name in (
            "gemini_cli_native_tools",
            "tools",
            "default_api",
            "codex_tools",
            "openai_tools",
        ):
            module = types.ModuleType(module_name)
            for name, handler in exports.items():
                setattr(module, name, handler)
            sys.modules[module_name] = module
    except Exception:
        # 描述：别名注册失败不应阻断主流程，继续按内置工具函数执行。
        pass

_register_python_tool_module_aliases()

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
    # 描述：支持顶层函数调用入口（如 finish(...) / print(...) / todo_write(...)），
    # 避免前置自然语言剥离时把首个有效语句误裁掉。
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*\s*\(", text):
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

_COMMON_UNDEFINED_NAME_SUFFIXES = (
    "spec",
    "data",
    "content",
    "payload",
    "model",
    "models",
    "response",
    "result",
    "items",
    "list",
    "detail",
    "schema",
    "config",
)

class _PythonNameCollector(ast.NodeVisitor):
    def __init__(self):
        self.defined = set()
        self.loaded = set()

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Store):
            self.defined.add(node.id)
        elif isinstance(node.ctx, ast.Load):
            self.loaded.add(node.id)
        self.generic_visit(node)

    def visit_FunctionDef(self, node):
        self.defined.add(node.name)
        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
            self.defined.add(arg.arg)
        if node.args.vararg is not None:
            self.defined.add(node.args.vararg.arg)
        if node.args.kwarg is not None:
            self.defined.add(node.args.kwarg.arg)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node)

    def visit_ClassDef(self, node):
        self.defined.add(node.name)
        self.generic_visit(node)

    def visit_Import(self, node):
        for alias in node.names:
            self.defined.add(alias.asname or alias.name.split(".")[0])

    def visit_ImportFrom(self, node):
        for alias in node.names:
            if alias.name == "*":
                continue
            self.defined.add(alias.asname or alias.name.split(".")[0])

    def visit_ExceptHandler(self, node):
        if isinstance(node.name, str) and node.name:
            self.defined.add(node.name)
        self.generic_visit(node)

def _rewrite_name_tokens(code, replacements):
    if not replacements:
        return code
    try:
        token_stream = tokenize.generate_tokens(io.StringIO(code).readline)
        rewritten = []
        for token in token_stream:
            if token.type == tokenize.NAME and token.string in replacements:
                token = tokenize.TokenInfo(
                    token.type,
                    replacements[token.string],
                    token.start,
                    token.end,
                    token.line,
                )
            rewritten.append(token)
        return tokenize.untokenize(rewritten)
    except Exception:
        return code

def _repair_common_undefined_name_suffix_aliases(code):
    try:
        tree = ast.parse(code)
    except Exception:
        return code

    collector = _PythonNameCollector()
    collector.visit(tree)
    reserved_names = set(globals().keys()) | set(dir(builtins))
    undefined_names = sorted(
        name for name in collector.loaded
        if name not in collector.defined and name not in reserved_names
    )
    if not undefined_names:
        return code

    replacements = {}
    for name in undefined_names:
        for suffix in _COMMON_UNDEFINED_NAME_SUFFIXES:
            candidate = f"{name}_{suffix}"
            if candidate in collector.defined:
                replacements[name] = candidate
                break

    return _rewrite_name_tokens(code, replacements)

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
        # 描述：预先修正常见的变量名后缀笔误，例如已定义 `openapi_spec` 却误写成 `openapi`，
        # 以减少这类低级 NameError 直接打断整轮工作流。
        code = _repair_common_undefined_name_suffix_aliases(code)
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
        python_command: &CommandCandidate,
    ) -> Result<Self, ProtocolError> {
        info!(session_id = %session_id, "starting persistent python sandbox");

        let mut command = python_command.build_command();
        let mut child = command
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
        python_command: &CommandCandidate,
    ) -> Result<Arc<Mutex<SandboxInstance>>, ProtocolError> {
        if let Some(existing) = self.instances.get(session_id) {
            return Ok(existing.value().clone());
        }
        match self.instances.entry(session_id.to_string()) {
            dashmap::mapref::entry::Entry::Occupied(entry) => Ok(entry.get().clone()),
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                let instance = SandboxInstance::start(session_id, sandbox_root, python_command)?;
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
    fn should_register_python_tool_module_aliases_in_prelude() {
        // 描述：
        //
        //   - 沙盒预置脚本应同时注册 `gemini_cli_native_tools`、`tools`、`default_api`
        //     与其他历史工具模块别名，防止模型脚本沿用旧模板直接 import 时触发
        //     ModuleNotFoundError。
        assert!(PERSISTENT_PRELUDE.contains("_register_python_tool_module_aliases"));
        assert!(PERSISTENT_PRELUDE.contains("types.ModuleType(module_name)"));
        assert!(PERSISTENT_PRELUDE.contains("\"gemini_cli_native_tools\""));
        assert!(PERSISTENT_PRELUDE.contains("\"tools\""));
        assert!(PERSISTENT_PRELUDE.contains("\"default_api\""));
        assert!(PERSISTENT_PRELUDE.contains("\"codex_tools\""));
        assert!(PERSISTENT_PRELUDE.contains("\"openai_tools\""));
        assert!(PERSISTENT_PRELUDE.contains("sys.modules[module_name] = module"));
    }

    #[test]
    fn should_expose_run_shell_command_alias_in_prelude() {
        // 描述：
        //
        //   - 沙盒预置脚本应暴露 run_shell_command 别名，
        //     兼容模型常见调用习惯并映射到 run_shell。
        assert!(PERSISTENT_PRELUDE.contains("def run_shell_command(command, timeout_secs=30, with_meta=False): return run_shell(command=command, timeout_secs=timeout_secs, with_meta=with_meta)"));
        assert!(PERSISTENT_PRELUDE.contains("\"run_shell_command\": run_shell_command"));
    }

    #[test]
    fn should_unwrap_run_shell_result_and_expose_string_bridge_in_prelude() {
        // 描述：
        //
        //   - run_shell 默认应解包到命令结果对象本身，避免模型再手写 `response[\"data\"]`。
        //   - 兼容层还应提供 `_ShellResult.lower()` 等字符串桥，避免模型把结果当字符串时直接抛 AttributeError。
        assert!(PERSISTENT_PRELUDE.contains("class _ShellResult(dict):"));
        assert!(PERSISTENT_PRELUDE.contains(
            "def run_shell(command=None, timeout_secs=None, with_meta=False, **kwargs):"
        ));
        assert!(PERSISTENT_PRELUDE.contains("include_meta = bool(_resolve_with_alias(with_meta, _pop_alias(kwargs, (\"include_meta\", \"raw\")), False))"));
        assert!(PERSISTENT_PRELUDE.contains("return _remember_last_value(_ShellResult(data))"));
        assert!(PERSISTENT_PRELUDE
            .contains("self.get(\"success\") is False or self.get(\"ok\") is False"));
        assert!(PERSISTENT_PRELUDE.contains("def lower(self):"));
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
    fn should_expose_request_user_input_in_prelude() {
        // 描述：
        //
        //   - 沙盒预置脚本应直接暴露 `request_user_input(...)` 顶层函数，
        //     让 Python 编排脚本无需 import 就能挂起并等待用户回答。
        assert!(PERSISTENT_PRELUDE
            .contains("def request_user_input(questions=None, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("def _normalize_user_input_questions(questions):"));
        assert!(PERSISTENT_PRELUDE
            .contains("\"questions\": _require_arg(normalized_questions, \"questions\")"));
    }

    #[test]
    fn should_expose_browser_and_js_repl_tools_in_prelude() {
        // 描述：
        //
        //   - 沙盒预置脚本应暴露 js_repl / js_repl_reset / browser_* 顶层函数，
        //     让 Python 编排脚本可以直接发起真实浏览器交互，而不是退回 CLI Playwright 文件流。
        assert!(PERSISTENT_PRELUDE.contains("def js_repl(source=None, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE
            .contains("def js_repl_reset(close_browser=True, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("def browser_navigate(url=None, wait_until=\"domcontentloaded\", timeout_ms=30000, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("def browser_snapshot(max_elements=40, max_text_chars=4000, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("def browser_click(selector=None, text=None, role=None, index=0, exact=False, button=\"left\", double_click=False, timeout_ms=30000, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("def browser_type(selector=None, text=None, role=None, name=None, index=0, exact=False, clear_first=True, submit=False, slowly=False, timeout_ms=30000, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("def browser_wait_for(time_secs=None, text=None, text_gone=None, selector=None, timeout_ms=30000, with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("def browser_take_screenshot(path=None, full_page=False, type=\"png\", with_meta=False, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains(
            "def browser_tabs(action=\"list\", index=0, url=\"\", with_meta=False, **kwargs):"
        ));
        assert!(PERSISTENT_PRELUDE.contains("def browser_close(with_meta=False, **kwargs):"));
    }

    #[test]
    fn should_support_finish_keyword_envelope_in_prelude() {
        // 描述：
        //
        //   - 兼容层应支持 `finish(status=..., summary=..., next=...)` 以及 `finish(STATUS=..., SUMMARY=..., NEXT=...)` 关键字写法，
        //     避免模型生成结构化收尾时因签名不匹配直接抛 TypeError。
        assert!(PERSISTENT_PRELUDE
            .contains("def finish(message=None, status=None, summary=None, next=None, **kwargs):"));
        assert!(PERSISTENT_PRELUDE.contains("(\"state\", \"STATUS\", \"STATE\")"));
        assert!(PERSISTENT_PRELUDE
            .contains("(\"result\", \"content\", \"SUMMARY\", \"RESULT\", \"CONTENT\")"));
        assert!(
            PERSISTENT_PRELUDE.contains("(\"next_step\", \"nextStep\", \"NEXT\", \"NEXT_STEP\")")
        );
        assert!(PERSISTENT_PRELUDE.contains("lines.append(f\"STATUS: {resolved_status}\")"));
        assert!(PERSISTENT_PRELUDE.contains("lines.append(f\"SUMMARY: {resolved_summary}\")"));
        assert!(PERSISTENT_PRELUDE.contains("lines.append(f\"NEXT: {resolved_next}\")"));
        assert!(PERSISTENT_PRELUDE.contains("re.match(r\"^[A-Za-z_][A-Za-z0-9_]*\\s*\\(\", text)"));
    }

    #[test]
    fn should_repair_common_undefined_name_suffix_aliases_in_prelude() {
        // 描述：
        //
        //   - 兼容层应在执行前修正常见的后缀变量名笔误，例如已定义 `openapi_spec`
        //     却误写成 `openapi`，避免低级 NameError 直接打断整轮工作流。
        assert!(
            PERSISTENT_PRELUDE.contains("def _repair_common_undefined_name_suffix_aliases(code):")
        );
        assert!(PERSISTENT_PRELUDE.contains("_COMMON_UNDEFINED_NAME_SUFFIXES = ("));
        assert!(PERSISTENT_PRELUDE.contains("candidate = f\"{name}_{suffix}\""));
        assert!(PERSISTENT_PRELUDE
            .contains("code = _repair_common_undefined_name_suffix_aliases(code)"));
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

    #[test]
    fn should_remember_last_tool_result_in_prelude_underscore_alias() {
        // 描述：
        //
        //   - 沙盒兼容层应为 `_` 提供稳定初始值，并在每次工具或兼容层返回值后同步更新，
        //     兼容模型将上一条结果写成 `content = _` 的 REPL 风格脚本。
        assert!(PERSISTENT_PRELUDE.contains("def _remember_last_value(value):"));
        assert!(PERSISTENT_PRELUDE.contains("setattr(builtins, \"_\", None)"));
        assert!(PERSISTENT_PRELUDE
            .contains("return _remember_last_value(json.loads(line[len(_TOOL_RESULT_PREFIX):]))"));
        assert!(PERSISTENT_PRELUDE.contains("return _remember_last_value(content)"));
        assert!(PERSISTENT_PRELUDE.contains("return _remember_last_value(data.get(\"data\"))"));
    }
}
