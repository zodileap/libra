use super::utils::{
    execute_command_with_timeout, get_required_raw_string, get_required_string, parse_bool_arg,
    parse_positive_usize_arg, resolve_sandbox_path,
};
use super::{AgentTool, ToolContext};
use crate::platform::{resolve_node_command_candidates, CommandCandidate};
use dashmap::DashMap;
use libra_mcp_common::ProtocolError;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tracing::warn;

const BROWSER_DRIVER_REQUEST_TIMEOUT_SECS: u64 = 45;
const BROWSER_DRIVER_READY_TIMEOUT_SECS: u64 = 20;
const BROWSER_DRIVER_READY_EVENT: &str = "ready";
const BROWSER_DRIVER_LOG_EVENT: &str = "log";
const DEFAULT_BROWSER_WAIT_TIMEOUT_SECS: usize = 30;

/// 描述：原生浏览器交互能力探测结果，供运行时快照统一复用。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeBrowserToolCapabilities {
    pub native_js_repl: bool,
    pub native_browser_tools: bool,
}

/// 描述：持久化 Node/Playwright 驱动进程的单个输出事件。
enum BrowserDriverOutput {
    Stdout(String),
    Terminated(i32),
}

/// 描述：单个会话的浏览器驱动实例；按 session_id 维度复用。
struct BrowserDriverSession {
    child: Child,
    stdin: ChildStdin,
    receiver: mpsc::Receiver<BrowserDriverOutput>,
    last_active_at: Instant,
}

impl Drop for BrowserDriverSession {
    fn drop(&mut self) {
        // 描述：会话释放时主动结束底层驱动进程，避免测试与长生命周期会话留下孤儿子进程。
        let _ = self.stdin.flush();
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

static BROWSER_DRIVER_REGISTRY: Lazy<DashMap<String, Arc<Mutex<BrowserDriverSession>>>> =
    Lazy::new(DashMap::new);
static BROWSER_DRIVER_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// 描述：`js_repl` 低层逃生工具，直接把 JavaScript 代码发送给持久化 Node/Playwright 驱动执行。
pub struct JsReplTool;

/// 描述：`js_repl_reset` 重置工具，用于清空持久化绑定并按需关闭浏览器。
pub struct JsReplResetTool;

/// 描述：浏览器导航工具，负责创建/复用 Chromium 窗口并打开目标页面。
pub struct BrowserNavigateTool;

/// 描述：浏览器快照工具，返回页面文本摘要与可交互元素概览。
pub struct BrowserSnapshotTool;

/// 描述：浏览器点击工具，支持 selector / text / role 三类定位方式。
pub struct BrowserClickTool;

/// 描述：浏览器输入工具，支持 selector / text / role 三类定位方式。
pub struct BrowserTypeTool;

/// 描述：浏览器等待工具，支持时间、文本、选择器等条件。
pub struct BrowserWaitTool;

/// 描述：浏览器截图工具，输出图片到沙盒路径。
pub struct BrowserTakeScreenshotTool;

/// 描述：浏览器标签页工具，支持列出、切换、关闭和新建标签页。
pub struct BrowserTabsTool;

/// 描述：浏览器关闭工具，关闭当前会话的 Chromium，但保留驱动进程以便后续重启。
pub struct BrowserCloseTool;

impl AgentTool for JsReplTool {
    fn name(&self) -> &'static str {
        "js_repl"
    }

    fn description(&self) -> &'static str {
        "在持久化 Node/Playwright 会话中执行 JavaScript（支持 async/await）。参数：{\"source\": \"JavaScript 源码\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let source =
            get_required_raw_string(args, "source", "core.agent.browser.js_repl.source_missing")
                .or_else(|_| {
                    get_required_raw_string(
                        args,
                        "code",
                        "core.agent.browser.js_repl.source_missing",
                    )
                })?;
        execute_browser_driver_request(
            context.session_id,
            "js.repl",
            json!({
                "source": source,
            }),
        )
    }
}

impl AgentTool for JsReplResetTool {
    fn name(&self) -> &'static str {
        "js_repl_reset"
    }

    fn description(&self) -> &'static str {
        "重置持久化 Node/Playwright 会话中的自定义绑定，并按需关闭浏览器。参数：{\"close_browser\": true}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let close_browser = parse_bool_arg(args, "close_browser", true)?;
        execute_browser_driver_request(
            context.session_id,
            "js.repl_reset",
            json!({
                "close_browser": close_browser,
            }),
        )
    }
}

impl AgentTool for BrowserNavigateTool {
    fn name(&self) -> &'static str {
        "browser_navigate"
    }

    fn description(&self) -> &'static str {
        "在真实 Chromium 窗口中导航到指定 URL。参数：{\"url\": \"https://example.com\", \"wait_until\": \"domcontentloaded\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let url = get_required_string(args, "url", "core.agent.browser.navigate.url_missing")?;
        let wait_until = args
            .get("wait_until")
            .or_else(|| args.get("waitUntil"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("domcontentloaded");
        let timeout_ms = (parse_positive_usize_arg(
            args,
            "timeout_ms",
            DEFAULT_BROWSER_WAIT_TIMEOUT_SECS * 1000,
            120_000,
        )?) as u64;
        execute_browser_driver_request(
            context.session_id,
            "browser.navigate",
            json!({
                "url": url,
                "wait_until": wait_until,
                "timeout_ms": timeout_ms,
            }),
        )
    }
}

impl AgentTool for BrowserSnapshotTool {
    fn name(&self) -> &'static str {
        "browser_snapshot"
    }

    fn description(&self) -> &'static str {
        "提取当前页面的文本摘要、URL 和可交互元素概览。参数：{\"max_elements\": 40, \"max_text_chars\": 4000}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let max_elements = parse_positive_usize_arg(args, "max_elements", 40, 200)?;
        let max_text_chars = parse_positive_usize_arg(args, "max_text_chars", 4000, 20_000)?;
        execute_browser_driver_request(
            context.session_id,
            "browser.snapshot",
            json!({
                "max_elements": max_elements,
                "max_text_chars": max_text_chars,
            }),
        )
    }
}

impl AgentTool for BrowserClickTool {
    fn name(&self) -> &'static str {
        "browser_click"
    }

    fn description(&self) -> &'static str {
        "点击当前页面元素，支持 selector / text / role 三类定位。参数：{\"selector\": \"button[data-testid='submit']\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        execute_browser_driver_request(
            context.session_id,
            "browser.click",
            build_browser_locator_params(args, None)?,
        )
    }
}

impl AgentTool for BrowserTypeTool {
    fn name(&self) -> &'static str {
        "browser_type"
    }

    fn description(&self) -> &'static str {
        "向当前页面元素输入文本，支持 selector / text / role 三类定位。参数：{\"selector\": \"input[name='email']\", \"text\": \"demo@example.com\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let text = get_required_raw_string(args, "text", "core.agent.browser.type.text_missing")?;
        let selector = args
            .get("selector")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("");
        let role = args
            .get("role")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("");
        let name = args
            .get("name")
            .or_else(|| args.get("target_text"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("");
        if selector.is_empty() && name.is_empty() {
            return Err(ProtocolError::new(
                "core.agent.browser.type.locator_missing",
                "browser_type 需要提供 selector，或配合 role 使用 name/target_text",
            ));
        }
        let mut params = json!({
            "selector": selector,
            "role": role,
            "name": name,
            "index": args.get("index").and_then(|value| value.as_u64()).unwrap_or(0),
            "exact": parse_bool_arg(args, "exact", false)?,
            "timeout_ms": (parse_positive_usize_arg(
                args,
                "timeout_ms",
                DEFAULT_BROWSER_WAIT_TIMEOUT_SECS * 1000,
                120_000,
            )?) as u64,
        });
        if let Some(object) = params.as_object_mut() {
            object.insert("text".to_string(), json!(text));
            object.insert(
                "clear_first".to_string(),
                json!(parse_bool_arg(args, "clear_first", true)?),
            );
            object.insert(
                "submit".to_string(),
                json!(parse_bool_arg(args, "submit", false)?),
            );
            object.insert(
                "slowly".to_string(),
                json!(parse_bool_arg(args, "slowly", false)?),
            );
        }
        execute_browser_driver_request(context.session_id, "browser.type", params)
    }
}

impl AgentTool for BrowserWaitTool {
    fn name(&self) -> &'static str {
        "browser_wait_for"
    }

    fn description(&self) -> &'static str {
        "等待页面条件成立，支持 time/text/text_gone/selector 四类条件。参数：{\"time_secs\": 2}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let time_secs = args
            .get("time_secs")
            .and_then(|value| value.as_u64())
            .map(|value| value.min(300));
        let text = args
            .get("text")
            .and_then(|value| value.as_str())
            .map(str::trim);
        let text_gone = args
            .get("text_gone")
            .or_else(|| args.get("textGone"))
            .and_then(|value| value.as_str())
            .map(str::trim);
        let selector = args
            .get("selector")
            .and_then(|value| value.as_str())
            .map(str::trim);
        if time_secs.unwrap_or(0) == 0
            && text.unwrap_or("").is_empty()
            && text_gone.unwrap_or("").is_empty()
            && selector.unwrap_or("").is_empty()
        {
            return Err(ProtocolError::new(
                "core.agent.browser.wait.condition_missing",
                "browser_wait_for 至少需要提供 time_secs / text / text_gone / selector 之一",
            ));
        }
        execute_browser_driver_request(
            context.session_id,
            "browser.wait_for",
            json!({
                "time_secs": time_secs.unwrap_or(0),
                "text": text.unwrap_or(""),
                "text_gone": text_gone.unwrap_or(""),
                "selector": selector.unwrap_or(""),
                "timeout_ms": (parse_positive_usize_arg(
                    args,
                    "timeout_ms",
                    DEFAULT_BROWSER_WAIT_TIMEOUT_SECS * 1000,
                    120_000,
                )?) as u64,
            }),
        )
    }
}

impl AgentTool for BrowserTakeScreenshotTool {
    fn name(&self) -> &'static str {
        "browser_take_screenshot"
    }

    fn description(&self) -> &'static str {
        "对当前页面截图并保存到沙盒路径。参数：{\"path\": \"artifacts/browser.png\", \"full_page\": true}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let requested_path = args
            .get("path")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("artifacts/browser-screenshot.png");
        let screenshot_path = resolve_sandbox_path(context.sandbox_root, requested_path)?;
        if let Some(parent) = screenshot_path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                ProtocolError::new(
                    "core.agent.browser.screenshot_dir_create_failed",
                    format!("创建截图目录失败: {}", err),
                )
            })?;
        }
        execute_browser_driver_request(
            context.session_id,
            "browser.take_screenshot",
            json!({
                "path": screenshot_path.to_string_lossy().to_string(),
                "full_page": parse_bool_arg(args, "full_page", false)?,
                "type": args.get("type").and_then(|value| value.as_str()).map(str::trim).filter(|value| !value.is_empty()).unwrap_or("png"),
            }),
        )
    }
}

impl AgentTool for BrowserTabsTool {
    fn name(&self) -> &'static str {
        "browser_tabs"
    }

    fn description(&self) -> &'static str {
        "管理当前浏览器标签页，支持 list/select/close/new。参数：{\"action\": \"list\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let action = get_required_string(args, "action", "core.agent.browser.tabs.action_missing")?;
        execute_browser_driver_request(
            context.session_id,
            "browser.tabs",
            json!({
                "action": action,
                "index": args.get("index").and_then(|value| value.as_u64()).unwrap_or(0),
                "url": args.get("url").and_then(|value| value.as_str()).map(str::trim).unwrap_or(""),
            }),
        )
    }
}

impl AgentTool for BrowserCloseTool {
    fn name(&self) -> &'static str {
        "browser_close"
    }

    fn description(&self) -> &'static str {
        "关闭当前会话的 Chromium 窗口，但保留驱动进程以便后续重新打开。参数：{}"
    }

    fn execute(&self, _args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        execute_browser_driver_request(context.session_id, "browser.close", json!({}))
    }
}

/// 描述：探测当前环境是否具备原生 Node/Playwright 浏览器交互能力。
///
/// Returns:
///
///   - 0: 原生 js_repl 与 browser_* 工具可用性。
pub fn detect_native_browser_tool_capabilities() -> NativeBrowserToolCapabilities {
    if resolve_node_command().is_none() {
        return NativeBrowserToolCapabilities {
            native_js_repl: false,
            native_browser_tools: false,
        };
    }

    if let Some(script_path) = resolve_browser_driver_script_override() {
        if script_path.exists() {
            return NativeBrowserToolCapabilities {
                native_js_repl: true,
                native_browser_tools: true,
            };
        }
    }

    let Some(runtime_cwd) = resolve_browser_runtime_cwd() else {
        return NativeBrowserToolCapabilities {
            native_js_repl: false,
            native_browser_tools: false,
        };
    };
    let Some(node_command) = resolve_node_command() else {
        return NativeBrowserToolCapabilities {
            native_js_repl: false,
            native_browser_tools: false,
        };
    };

    let mut command = node_command.build_command();
    command
        .arg("-e")
        .arg("require.resolve('playwright'); process.stdout.write('ready');")
        .current_dir(runtime_cwd);
    let output = execute_command_with_timeout(command, Duration::from_secs(8));
    let ready = output
        .ok()
        .map(|item| item.success && item.stdout.trim() == "ready")
        .unwrap_or(false);
    NativeBrowserToolCapabilities {
        native_js_repl: ready,
        native_browser_tools: ready,
    }
}

/// 描述：构建浏览器元素定位参数，统一兼容 selector / text / role / index / exact。
fn build_browser_locator_params(
    args: &Value,
    allow_missing_text_key: Option<&str>,
) -> Result<Value, ProtocolError> {
    let selector = args
        .get("selector")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("");
    let text_key = allow_missing_text_key.unwrap_or("text");
    let text = args
        .get(text_key)
        .or_else(|| args.get("name"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("");
    let role = args
        .get("role")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("");
    if selector.is_empty() && text.is_empty() {
        return Err(ProtocolError::new(
            "core.agent.browser.locator_missing",
            "浏览器工具至少需要 selector 或 text/name 之一",
        ));
    }
    Ok(json!({
        "selector": selector,
        "text": text,
        "role": role,
        "index": args.get("index").and_then(|value| value.as_u64()).unwrap_or(0),
        "exact": parse_bool_arg(args, "exact", false)?,
        "timeout_ms": (parse_positive_usize_arg(
            args,
            "timeout_ms",
            DEFAULT_BROWSER_WAIT_TIMEOUT_SECS * 1000,
            120_000,
        )?) as u64,
    }))
}

/// 描述：按 session_id 执行一次浏览器驱动请求，并在进程失效时自动重建一次。
fn execute_browser_driver_request(
    session_id: &str,
    method: &str,
    params: Value,
) -> Result<Value, ProtocolError> {
    let request = json!({
        "id": BROWSER_DRIVER_REQUEST_SEQUENCE.fetch_add(1, Ordering::SeqCst),
        "method": method,
        "params": params,
    });
    let response = execute_browser_driver_request_once(session_id, &request);
    if response.is_ok() {
        return response;
    }
    BROWSER_DRIVER_REGISTRY.remove(session_id);
    execute_browser_driver_request_once(session_id, &request)
}

/// 描述：执行一次浏览器驱动请求，不做重试；由外层决定是否重建会话。
fn execute_browser_driver_request_once(
    session_id: &str,
    request: &Value,
) -> Result<Value, ProtocolError> {
    let session_ref = get_or_create_browser_driver_session(session_id)?;
    let mut session = session_ref.lock().map_err(|_| {
        ProtocolError::new(
            "core.agent.browser.session_lock_failed",
            "浏览器会话锁获取失败",
        )
    })?;
    session.last_active_at = Instant::now();
    let request_line = format!("{}\n", request);
    session
        .stdin
        .write_all(request_line.as_bytes())
        .and_then(|_| session.stdin.flush())
        .map_err(|err| {
            ProtocolError::new(
                "core.agent.browser.request_write_failed",
                format!("写入浏览器驱动请求失败: {}", err),
            )
        })?;

    let request_id = request
        .get("id")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let started_at = Instant::now();
    loop {
        let remaining = Duration::from_secs(BROWSER_DRIVER_REQUEST_TIMEOUT_SECS)
            .checked_sub(started_at.elapsed())
            .unwrap_or(Duration::from_secs(0));
        if remaining.is_zero() {
            return Err(ProtocolError::new(
                "core.agent.browser.request_timeout",
                format!("浏览器驱动请求超时: {}", request_id),
            ));
        }
        match session
            .receiver
            .recv_timeout(remaining.min(Duration::from_millis(250)))
        {
            Ok(BrowserDriverOutput::Stdout(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let payload: Value = serde_json::from_str(trimmed).map_err(|err| {
                    ProtocolError::new(
                        "core.agent.browser.response_invalid",
                        format!("解析浏览器驱动响应失败: {}", err),
                    )
                })?;
                if payload
                    .get("event")
                    .and_then(|value| value.as_str())
                    .map(|value| {
                        value == BROWSER_DRIVER_LOG_EVENT || value == BROWSER_DRIVER_READY_EVENT
                    })
                    .unwrap_or(false)
                {
                    continue;
                }
                if payload.get("id").and_then(|value| value.as_u64()) != Some(request_id) {
                    continue;
                }
                if payload
                    .get("ok")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
                {
                    return Ok(payload.get("result").cloned().unwrap_or_else(|| json!({})));
                }
                let error_code = payload
                    .get("error")
                    .and_then(|value| value.get("code"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("core.agent.browser.request_failed");
                let error_message = payload
                    .get("error")
                    .and_then(|value| value.get("message"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("浏览器驱动执行失败");
                return Err(ProtocolError::new(error_code, error_message));
            }
            Ok(BrowserDriverOutput::Terminated(code)) => {
                return Err(ProtocolError::new(
                    "core.agent.browser.process_terminated",
                    format!("浏览器驱动进程已退出: {}", code),
                ));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(ProtocolError::new(
                    "core.agent.browser.response_channel_closed",
                    "浏览器驱动响应通道已关闭",
                ))
            }
        }
    }
}

/// 描述：获取或创建浏览器驱动会话，确保同一 session_id 复用同一持久化进程。
fn get_or_create_browser_driver_session(
    session_id: &str,
) -> Result<Arc<Mutex<BrowserDriverSession>>, ProtocolError> {
    if let Some(existing) = BROWSER_DRIVER_REGISTRY.get(session_id) {
        return Ok(existing.value().clone());
    }
    let created = Arc::new(Mutex::new(spawn_browser_driver_session()?));
    match BROWSER_DRIVER_REGISTRY.entry(session_id.to_string()) {
        dashmap::mapref::entry::Entry::Occupied(entry) => Ok(entry.get().clone()),
        dashmap::mapref::entry::Entry::Vacant(entry) => {
            entry.insert(created.clone());
            Ok(created)
        }
    }
}

/// 描述：启动底层 Node/Playwright 驱动进程，并等待 READY 事件后返回会话。
fn spawn_browser_driver_session() -> Result<BrowserDriverSession, ProtocolError> {
    let node_command = resolve_node_command().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.browser.node_not_found",
            "未检测到可用 Node.js 运行时，无法启动原生 Playwright 浏览器工具",
        )
        .with_suggestion("请安装 Node.js，或改用已启用的 Playwright MCP。")
    })?;
    let runtime_cwd = resolve_browser_runtime_cwd().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.browser.runtime_cwd_missing",
            "未找到可用于加载 Playwright 依赖的运行时目录",
        )
        .with_suggestion("请确认 apps/desktop 目录存在，或设置 ZODILEAP_BROWSER_RUNTIME_CWD。")
    })?;
    let script_path = resolve_browser_driver_script()?;
    let mut command = node_command.build_command();
    command
        .arg(script_path.to_string_lossy().to_string())
        .current_dir(runtime_cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|err| {
        ProtocolError::new(
            "core.agent.browser.spawn_failed",
            format!("启动浏览器驱动失败: {}", err),
        )
    })?;
    let stdin = child.stdin.take().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.browser.stdin_missing",
            "浏览器驱动缺少 stdin 管道",
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.browser.stdout_missing",
            "浏览器驱动缺少 stdout 管道",
        )
    })?;
    let stderr = child.stderr.take();
    let receiver = spawn_browser_driver_reader(stdout, stderr);
    wait_browser_driver_ready(&receiver)?;
    Ok(BrowserDriverSession {
        child,
        stdin,
        receiver,
        last_active_at: Instant::now(),
    })
}

/// 描述：启动浏览器驱动 stdout/stderr 读取线程，避免主线程被阻塞或 stderr 缓冲区写满。
fn spawn_browser_driver_reader(
    stdout: ChildStdout,
    stderr: Option<ChildStderr>,
) -> mpsc::Receiver<BrowserDriverOutput> {
    let (sender, receiver) = mpsc::channel();
    let stdout_sender = sender.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = stdout_sender.send(BrowserDriverOutput::Terminated(0));
                    break;
                }
                Ok(_) => {
                    let _ = stdout_sender.send(BrowserDriverOutput::Stdout(line.clone()));
                }
                Err(_) => {
                    let _ = stdout_sender.send(BrowserDriverOutput::Terminated(-1));
                    break;
                }
            }
        }
    });

    if let Some(stderr_pipe) = stderr {
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr_pipe);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let text = line.trim();
                        if !text.is_empty() {
                            warn!("browser-driver: {}", text);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    receiver
}

/// 描述：等待浏览器驱动就绪握手，确保后续请求可以直接发送。
fn wait_browser_driver_ready(
    receiver: &mpsc::Receiver<BrowserDriverOutput>,
) -> Result<(), ProtocolError> {
    let started_at = Instant::now();
    loop {
        let remaining = Duration::from_secs(BROWSER_DRIVER_READY_TIMEOUT_SECS)
            .checked_sub(started_at.elapsed())
            .unwrap_or(Duration::from_secs(0));
        if remaining.is_zero() {
            return Err(ProtocolError::new(
                "core.agent.browser.ready_timeout",
                "等待浏览器驱动就绪超时",
            ));
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(BrowserDriverOutput::Stdout(line)) => {
                let payload: Value = serde_json::from_str(line.trim()).map_err(|err| {
                    ProtocolError::new(
                        "core.agent.browser.ready_payload_invalid",
                        format!("解析浏览器驱动 READY 事件失败: {}", err),
                    )
                })?;
                if payload
                    .get("event")
                    .and_then(|value| value.as_str())
                    .map(|value| value == BROWSER_DRIVER_READY_EVENT)
                    .unwrap_or(false)
                {
                    return Ok(());
                }
            }
            Ok(BrowserDriverOutput::Terminated(code)) => {
                return Err(ProtocolError::new(
                    "core.agent.browser.process_terminated",
                    format!("浏览器驱动进程已提前退出: {}", code),
                ));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(ProtocolError::new(
                    "core.agent.browser.ready_channel_closed",
                    "浏览器驱动 READY 通道已关闭",
                ));
            }
        }
    }
}

/// 描述：解析 Node 命令候选并返回首个可执行项。
fn resolve_node_command() -> Option<CommandCandidate> {
    for candidate in resolve_node_command_candidates() {
        let output = execute_command_with_timeout(
            {
                let mut command = candidate.build_command();
                command.arg("--version");
                command
            },
            Duration::from_secs(5),
        );
        if output.as_ref().map(|item| item.success).unwrap_or(false) {
            return Some(candidate);
        }
    }
    None
}

/// 描述：解析浏览器驱动运行目录，优先使用显式环境变量，其次回退到仓库内 apps/desktop。
fn resolve_browser_runtime_cwd() -> Option<PathBuf> {
    if let Some(value) = env::var_os("ZODILEAP_BROWSER_RUNTIME_CWD") {
        let candidate = PathBuf::from(value);
        if candidate.exists() && candidate.is_dir() {
            return Some(candidate);
        }
    }
    let current_dir = env::current_dir().ok()?;
    let desktop_workspace = current_dir.join("apps").join("desktop");
    if desktop_workspace.join("package.json").exists() {
        return Some(desktop_workspace);
    }
    if current_dir.join("package.json").exists() {
        return Some(current_dir);
    }
    None
}

/// 描述：读取浏览器驱动脚本覆盖路径，供测试与自定义调试场景复用。
fn resolve_browser_driver_script_override() -> Option<PathBuf> {
    env::var_os("ZODILEAP_BROWSER_DRIVER_SCRIPT")
        .map(PathBuf::from)
        .filter(|path| path.exists())
}

/// 描述：解析浏览器驱动脚本路径；若未配置覆盖脚本，则把内置脚本写入临时目录。
fn resolve_browser_driver_script() -> Result<PathBuf, ProtocolError> {
    if let Some(path) = resolve_browser_driver_script_override() {
        return Ok(path);
    }
    let target_dir = env::temp_dir().join("libra-browser-driver");
    fs::create_dir_all(&target_dir).map_err(|err| {
        ProtocolError::new(
            "core.agent.browser.driver_dir_create_failed",
            format!("创建浏览器驱动目录失败: {}", err),
        )
    })?;
    let script_path = target_dir.join("playwright-driver.cjs");
    fs::write(&script_path, BROWSER_DRIVER_SOURCE.as_bytes()).map_err(|err| {
        ProtocolError::new(
            "core.agent.browser.driver_write_failed",
            format!("写入浏览器驱动脚本失败: {}", err),
        )
    })?;
    Ok(script_path)
}

const BROWSER_DRIVER_SOURCE: &str = r###"#!/usr/bin/env node
const readline = require("node:readline");
const { chromium } = require("playwright");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let browser = null;
let context = null;
let pages = [];
let activePageIndex = 0;
let bindings = {};

function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function normalizeValue(value, depth = 0) {
  if (depth > 4) {
    return "[MaxDepth]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => normalizeValue(item, depth + 1));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      next[key] = normalizeValue(item, depth + 1);
    }
    return next;
  }
  return String(value);
}

async function ensureBrowser() {
  let started = false;
  if (!browser) {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    context.on("page", (page) => {
      pages = context.pages();
      activePageIndex = Math.max(0, pages.indexOf(page));
    });
    const page = await context.newPage();
    pages = [page];
    activePageIndex = 0;
    started = true;
  }
  if (!context) {
    context = await browser.newContext();
  }
  if (!pages.length) {
    const page = await context.newPage();
    pages = [page];
    activePageIndex = 0;
  }
  return { started, page: pages[activePageIndex] };
}

function getActivePage() {
  if (!pages.length) {
    return null;
  }
  if (!pages[activePageIndex]) {
    activePageIndex = 0;
  }
  return pages[activePageIndex] || null;
}

async function resolveLocator(page, params = {}) {
  const selector = String(params.selector || "").trim();
  const role = String(params.role || "").trim();
  const text = String(params.text || params.name || "").trim();
  const exact = Boolean(params.exact);
  const index = Number.isFinite(Number(params.index)) ? Math.max(0, Number(params.index)) : 0;
  if (selector) {
    return page.locator(selector).nth(index);
  }
  if (role) {
    return page.getByRole(role, text ? { name: text, exact } : {}).nth(index);
  }
  if (text) {
    return page.getByText(text, { exact }).nth(index);
  }
  throw new Error("locator_missing");
}

async function snapshotPage(params = {}) {
  const { page } = await ensureBrowser();
  const maxTextChars = Number.isFinite(Number(params.max_text_chars)) ? Number(params.max_text_chars) : 4000;
  const text = await page.locator("body").innerText().catch(() => "");
  const title = await page.title().catch(() => "");
  const url = page.url();
  const elements = await page.evaluate((limit) => {
    function buildCssPath(element) {
      if (!element || element.nodeType !== 1) {
        return "";
      }
      if (element.id) {
        return `#${String(element.id).replace(/["\\]/g, "\\$&")}`;
      }
      if (element.getAttribute("data-testid")) {
        return `[data-testid="${String(element.getAttribute("data-testid")).replace(/["\\]/g, "\\$&")}"]`;
      }
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1 && current !== document.body) {
        const tag = String(current.tagName || "").toLowerCase();
        if (!tag) {
          break;
        }
        let part = tag;
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((item) => item.tagName === current.tagName)
          : [];
        if (siblings.length > 1) {
          const index = siblings.indexOf(current);
          part += `:nth-of-type(${index + 1})`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    }
    const interactiveSelectors = [
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[data-testid]",
    ];
    const candidates = Array.from(document.querySelectorAll(interactiveSelectors.join(","))).slice(0, limit);
    return candidates.map((element, index) => ({
      index,
      tag: String(element.tagName || "").toLowerCase(),
      text: String((element.innerText || element.textContent || "")).trim().slice(0, 120),
      role: String(element.getAttribute("role") || "").trim(),
      selector: buildCssPath(element),
      placeholder: String(element.getAttribute("placeholder") || "").trim(),
      inputType: String(element.getAttribute("type") || "").trim(),
    }));
  }, Number.isFinite(Number(params.max_elements)) ? Number(params.max_elements) : 40);
  return {
    title,
    url,
    text: String(text || "").slice(0, maxTextChars),
    elements,
  };
}

async function handleRequest(request) {
  const method = String(request.method || "").trim();
  const params = request.params || {};
  if (method === "browser.navigate") {
    const { started, page } = await ensureBrowser();
    await page.goto(String(params.url || ""), {
      waitUntil: String(params.wait_until || "domcontentloaded"),
      timeout: Number(params.timeout_ms || 30000),
    });
    return {
      browserStarted: started,
      title: await page.title().catch(() => ""),
      url: page.url(),
    };
  }
  if (method === "browser.snapshot") {
    return snapshotPage(params);
  }
  if (method === "browser.click") {
    const { page } = await ensureBrowser();
    const locator = await resolveLocator(page, params);
    await locator.click({
      timeout: Number(params.timeout_ms || 30000),
      button: String(params.button || "left"),
      clickCount: params.doubleClick ? 2 : 1,
    });
    return {
      clicked: true,
      snapshot: await snapshotPage({ max_elements: 10, max_text_chars: 1200 }),
    };
  }
  if (method === "browser.type") {
    const { page } = await ensureBrowser();
    const locator = await resolveLocator(page, params);
    if (params.clear_first !== false) {
      await locator.fill("", { timeout: Number(params.timeout_ms || 30000) });
    }
    if (params.slowly) {
      await locator.type(String(params.text || ""), { timeout: Number(params.timeout_ms || 30000) });
    } else {
      await locator.fill(String(params.text || ""), { timeout: Number(params.timeout_ms || 30000) });
    }
    if (params.submit) {
      await locator.press("Enter", { timeout: Number(params.timeout_ms || 30000) });
    }
    return {
      typed: true,
      snapshot: await snapshotPage({ max_elements: 10, max_text_chars: 1200 }),
    };
  }
  if (method === "browser.wait_for") {
    const { page } = await ensureBrowser();
    if (Number(params.time_secs || 0) > 0) {
      await page.waitForTimeout(Number(params.time_secs) * 1000);
    }
    if (String(params.selector || "").trim()) {
      await page.waitForSelector(String(params.selector), { timeout: Number(params.timeout_ms || 30000) });
    }
    if (String(params.text || "").trim()) {
      await page.getByText(String(params.text)).waitFor({ timeout: Number(params.timeout_ms || 30000) });
    }
    if (String(params.text_gone || "").trim()) {
      await page.getByText(String(params.text_gone)).waitFor({
        state: "hidden",
        timeout: Number(params.timeout_ms || 30000),
      });
    }
    return {
      waited: true,
      snapshot: await snapshotPage({ max_elements: 10, max_text_chars: 1200 }),
    };
  }
  if (method === "browser.take_screenshot") {
    const { page } = await ensureBrowser();
    const path = String(params.path || "").trim();
    await page.screenshot({
      path,
      fullPage: Boolean(params.full_page),
      type: String(params.type || "png"),
    });
    return {
      saved: true,
      path,
    };
  }
  if (method === "browser.tabs") {
    const { page } = await ensureBrowser();
    pages = context.pages();
    const action = String(params.action || "list").trim();
    if (action === "new") {
      const newPage = await context.newPage();
      pages = context.pages();
      activePageIndex = Math.max(0, pages.indexOf(newPage));
      if (String(params.url || "").trim()) {
        await newPage.goto(String(params.url), { waitUntil: "domcontentloaded" });
      }
    } else if (action === "select") {
      activePageIndex = Math.min(
        Math.max(0, Number(params.index || 0)),
        Math.max(0, pages.length - 1),
      );
      await pages[activePageIndex].bringToFront();
    } else if (action === "close") {
      const index = Math.min(
        Math.max(0, Number(params.index || activePageIndex)),
        Math.max(0, pages.length - 1),
      );
      await pages[index].close();
      pages = context.pages();
      activePageIndex = Math.min(activePageIndex, Math.max(0, pages.length - 1));
    }
    return {
      currentUrl: (getActivePage() || page).url(),
      activeIndex: activePageIndex,
      tabs: await Promise.all(
        pages.map(async (item, index) => ({
          index,
          title: await item.title().catch(() => ""),
          url: item.url(),
          active: index === activePageIndex,
        })),
      ),
    };
  }
  if (method === "browser.close") {
    if (browser) {
      await browser.close();
    }
    browser = null;
    context = null;
    pages = [];
    activePageIndex = 0;
    return { closed: true };
  }
  if (method === "js.repl") {
    const { page } = await ensureBrowser();
    const fn = new AsyncFunction(
      "page",
      "browser",
      "context",
      "pages",
      "bindings",
      String(params.source || ""),
    );
    const result = await fn(page, browser, context, pages, bindings);
    return { value: normalizeValue(result) };
  }
  if (method === "js.repl_reset") {
    bindings = {};
    if (params.close_browser !== false && browser) {
      await browser.close();
      browser = null;
      context = null;
      pages = [];
      activePageIndex = 0;
    }
    return { reset: true };
  }
  throw new Error(`unsupported_method:${method}`);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

write({ event: "ready" });

rl.on("line", async (line) => {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return;
  }
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    write({
      id: 0,
      ok: false,
      error: {
        code: "invalid_json",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return;
  }
  try {
    const result = await handleRequest(request);
    write({ id: request.id, ok: true, result: normalizeValue(result) });
  } catch (error) {
    write({
      id: request.id,
      ok: false,
      error: {
        code: "browser_driver_error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
"###;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;
    use std::sync::Mutex;

    static BROWSER_TEST_ENV_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn write_fake_browser_driver_script() -> PathBuf {
        let dir = env::temp_dir().join("libra-browser-driver-tests");
        fs::create_dir_all(&dir).expect("create fake browser driver dir");
        let script_path = dir.join("fake-browser-driver.cjs");
        let source = r###"
const readline = require("node:readline");
const instanceId = String(process.pid);
let resetCount = 0;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
process.stdout.write(JSON.stringify({ event: "ready" }) + "\n");
rl.on("line", async (line) => {
  const request = JSON.parse(line);
  const method = String(request.method || "");
  if (method === "js.repl_reset") {
    resetCount += 1;
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { reset: true, instanceId, resetCount } }) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { instanceId, method, params: request.params || {}, resetCount } }) + "\n");
});
"###;
        fs::write(&script_path, source.as_bytes()).expect("write fake browser driver");
        script_path
    }

    fn build_context<'a>(
        sandbox_root: &'a Path,
        session_id: &'a str,
        policy: &'a crate::policy::AgentPolicy,
    ) -> ToolContext<'a> {
        ToolContext {
            trace_id: "trace-test".to_string(),
            session_id,
            sandbox_root,
            policy,
            on_stream_event: None,
        }
    }

    /// 描述：验证同一 session_id 下会复用同一个浏览器驱动进程，满足跨轮次持久会话要求。
    #[test]
    fn should_reuse_browser_driver_session_per_session_id() {
        let _guard = BROWSER_TEST_ENV_LOCK.lock().expect("lock browser env");
        let script_path = write_fake_browser_driver_script();
        let runtime_dir = env::temp_dir().join("libra-browser-driver-runtime");
        fs::create_dir_all(&runtime_dir).expect("create runtime dir");
        env::set_var("ZODILEAP_BROWSER_DRIVER_SCRIPT", &script_path);
        env::set_var("ZODILEAP_BROWSER_RUNTIME_CWD", &runtime_dir);
        BROWSER_DRIVER_REGISTRY.clear();
        let sandbox_root = env::temp_dir().join("libra-browser-driver-sandbox");
        fs::create_dir_all(&sandbox_root).expect("create sandbox root");
        let policy = crate::policy::AgentPolicy::default();
        let context = build_context(&sandbox_root, "session-a", &policy);

        let first = BrowserNavigateTool
            .execute(&json!({ "url": "http://127.0.0.1:3000" }), context)
            .expect("first navigate");
        let second = BrowserSnapshotTool
            .execute(
                &json!({}),
                build_context(&sandbox_root, "session-a", &policy),
            )
            .expect("snapshot");
        let first_id = first
            .get("instanceId")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let second_id = second
            .get("instanceId")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert!(!first_id.is_empty());
        assert_eq!(first_id, second_id);
    }

    /// 描述：验证 `js_repl_reset` 会命中持久会话并返回结构化重置结果。
    #[test]
    fn should_forward_js_repl_reset_to_browser_driver() {
        let _guard = BROWSER_TEST_ENV_LOCK.lock().expect("lock browser env");
        let script_path = write_fake_browser_driver_script();
        let runtime_dir = env::temp_dir().join("libra-browser-driver-runtime-reset");
        fs::create_dir_all(&runtime_dir).expect("create runtime dir");
        env::set_var("ZODILEAP_BROWSER_DRIVER_SCRIPT", &script_path);
        env::set_var("ZODILEAP_BROWSER_RUNTIME_CWD", &runtime_dir);
        BROWSER_DRIVER_REGISTRY.clear();
        let sandbox_root = env::temp_dir().join("libra-browser-driver-sandbox-reset");
        fs::create_dir_all(&sandbox_root).expect("create sandbox root");
        let policy = crate::policy::AgentPolicy::default();
        let reset = JsReplResetTool
            .execute(
                &json!({ "close_browser": true }),
                build_context(&sandbox_root, "session-b", &policy),
            )
            .expect("reset");
        assert!(reset
            .get("reset")
            .and_then(|value| value.as_bool())
            .unwrap_or(false));
        assert_eq!(
            reset.get("resetCount").and_then(|value| value.as_u64()),
            Some(1)
        );
    }

    /// 描述：验证显式覆盖脚本存在时，原生浏览器能力探测会返回可用，避免测试依赖真实 Playwright 包。
    #[test]
    fn should_treat_existing_driver_override_as_native_capability() {
        let _guard = BROWSER_TEST_ENV_LOCK.lock().expect("lock browser env");
        let script_path = write_fake_browser_driver_script();
        env::set_var("ZODILEAP_BROWSER_DRIVER_SCRIPT", &script_path);
        let detected = detect_native_browser_tool_capabilities();
        assert!(detected.native_js_repl);
        assert!(detected.native_browser_tools);
    }
}
