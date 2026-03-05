#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::Emitter;
use tauri::Manager;
use zodileap_agent_core::llm::{call_model, parse_provider};
use zodileap_agent_core::{
    run_agent_with_protocol_error_stream, AgentRunRequest, AgentStreamEvent,
};
use zodileap_mcp_common::{
    ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord,
    ProtocolStepStatus, ProtocolUiHint, ProtocolUiHintAction, ProtocolUiHintActionIntent,
    ProtocolUiHintLevel,
};
use zodileap_mcp_model::{
    blender_bridge_addon_script, blender_bridge_extension_manifest, build_recovery_ui_hint,
    build_safety_confirmation_ui_hint, build_step_trace_payload, check_capability_for_session_step,
    execute_model_tool, export_model, ping_blender_bridge, requires_safety_confirmation,
    validate_safety_confirmation_token, ExportModelFormat, ExportModelRequest, ModelPlanBranch,
    ModelPlanOperationKind, ModelPlanRiskLevel, ModelSessionCapabilityMatrix,
    ModelSessionPlannedStep, ModelToolAction, ModelToolRequest, ModelToolResult, ModelToolTarget,
};

// ── Tauri 事件名常量 ──────────────────────────────────────────────────
//
// 描述：前后端约定的 Tauri emit 事件名，前端 listen 时使用相同字符串。

/// 描述：代码智能体文本流事件名。
const EVENT_AGENT_TEXT_STREAM: &str = "agent:text_stream";

/// 描述：智能体后台日志事件名。
const EVENT_AGENT_LOG: &str = "agent:log";

/// 描述：模型会话流式事件名。
const EVENT_MODEL_SESSION_STREAM: &str = "model:session_stream";

/// 描述：模型调试轨迹事件名。
const EVENT_MODEL_DEBUG_TRACE: &str = "model:debug_trace";

// ── 错误码常量 ────────────────────────────────────────────────────────

/// 描述：模型会话 store 锁中毒错误码。
const ERR_STORE_LOCK_FAILED: &str = "core.desktop.model.store_lock_failed";

/// 描述：模型会话不存在错误码。
const ERR_SESSION_NOT_FOUND: &str = "core.desktop.model.session_not_found";

#[derive(Serialize)]
struct ExportModelResponse {
    exported_file: String,
    summary: String,
    target: String,
}

#[derive(Serialize)]
struct InstallBridgeResponse {
    message: String,
}

/// 描述：返回代码智能体会话取消标记表，用于跨命令处理主动取消竞态。
fn cancelled_agent_sessions() -> &'static Mutex<HashSet<String>> {
    static CANCELLED_AGENT_SESSIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED_AGENT_SESSIONS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 描述：标记会话为“用户主动取消”，供执行线程在错误归一阶段识别。
fn mark_agent_session_cancelled(session_id: &str) {
    if session_id.trim().is_empty() {
        return;
    }
    if let Ok(mut set) = cancelled_agent_sessions().lock() {
        set.insert(session_id.to_string());
    }
}

/// 描述：消费会话取消标记，返回是否命中并在命中后清除，避免影响后续新任务。
fn take_agent_session_cancelled(session_id: &str) -> bool {
    if session_id.trim().is_empty() {
        return false;
    }
    if let Ok(mut set) = cancelled_agent_sessions().lock() {
        return set.remove(session_id);
    }
    false
}

/// 描述：在新任务开始前清理旧取消标记，防止历史取消状态串扰。
fn clear_agent_session_cancelled(session_id: &str) {
    if session_id.trim().is_empty() {
        return;
    }
    if let Ok(mut set) = cancelled_agent_sessions().lock() {
        set.remove(session_id);
    }
}

#[derive(Serialize)]
struct BridgeHealthResponse {
    ok: bool,
    message: String,
}

const BLENDER_EXTENSION_MIN_VERSION: &str = "4.2.0";
const BLENDER_EXTENSION_REPO_ID: &str = "zodileap_local";
const BLENDER_EXTENSION_PACKAGE_NAME: &str = "zodileap_mcp_bridge-0.2.0.zip";
const APIFOX_MCP_PACKAGE_NAME: &str = "apifox-mcp-server";
const APIFOX_MCP_PACKAGE_VERSION: &str = "latest";

#[derive(Serialize)]
struct AgentRunResponse {
    trace_id: String,
    message: String,
    actions: Vec<String>,
    exported_file: Option<String>,
    steps: Vec<ProtocolStepRecord>,
    events: Vec<ProtocolEventRecord>,
    assets: Vec<ProtocolAssetRecord>,
    ui_hint: Option<ProtocolUiHint>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum DependencyEcosystem {
    Node,
    Go,
    Java,
}

impl DependencyEcosystem {
    /// 描述：返回依赖生态字符串标识，供前端展示与路由分流使用。
    fn as_str(&self) -> &'static str {
        match self {
            DependencyEcosystem::Node => "node",
            DependencyEcosystem::Go => "go",
            DependencyEcosystem::Java => "java",
        }
    }
}

#[derive(Debug, Clone)]
struct ParsedDependencyRule {
    raw: String,
    ecosystem: Option<DependencyEcosystem>,
    package_name: String,
    expected_version: String,
}

#[derive(Debug, Clone)]
struct DependencyVersionSnapshot {
    version: String,
    source_file: String,
}

#[derive(Serialize, Clone)]
struct DependencyRuleStatusItem {
    rule: String,
    ecosystem: String,
    package_name: String,
    expected_version: String,
    current_version: Option<String>,
    status: String,
    source_file: Option<String>,
    detail: Option<String>,
    upgradable: bool,
}

#[derive(Serialize, Clone)]
struct ProjectDependencyRuleCheckResponse {
    project_path: String,
    detected_ecosystems: Vec<String>,
    items: Vec<DependencyRuleStatusItem>,
    mismatches: Vec<DependencyRuleStatusItem>,
}

#[derive(Serialize, Clone)]
struct DependencyRuleUpgradeResult {
    ecosystem: String,
    package_name: String,
    expected_version: String,
    status: String,
    detail: Option<String>,
}

#[derive(Serialize, Clone)]
struct ProjectDependencyRuleUpgradeResponse {
    project_path: String,
    updated: Vec<DependencyRuleUpgradeResult>,
    skipped: Vec<DependencyRuleUpgradeResult>,
}

#[derive(Serialize, Clone)]
struct CodeWorkspaceProfileSeedResponse {
    project_path: String,
    api_data_models: Vec<String>,
    api_request_models: Vec<String>,
    api_response_models: Vec<String>,
    api_mock_cases: Vec<String>,
    frontend_pages: Vec<String>,
    frontend_navigation: Vec<String>,
    frontend_page_elements: Vec<String>,
    frontend_code_directories: Vec<String>,
    frontend_module_boundaries: Vec<String>,
    frontend_code_constraints: Vec<String>,
    directory_summary: Vec<String>,
    module_candidates: Vec<String>,
}

#[derive(Serialize, Clone)]
struct DesktopProtocolError {
    code: String,
    message: String,
    suggestion: Option<String>,
    retryable: bool,
}

impl From<ProtocolError> for DesktopProtocolError {
    fn from(value: ProtocolError) -> Self {
        Self {
            code: value.code,
            message: value.message,
            suggestion: value.suggestion,
            retryable: value.retryable,
        }
    }
}

/// 描述：构造 store 锁中毒 DesktopProtocolError，统一替代 14 处重复样板码。
fn store_lock_error() -> DesktopProtocolError {
    DesktopProtocolError {
        code: ERR_STORE_LOCK_FAILED.to_string(),
        message: "model session store lock poisoned".to_string(),
        suggestion: None,
        retryable: true,
    }
}

#[derive(Deserialize, Clone, Default)]
struct ModelMcpCapabilities {
    export: Option<bool>,
    scene: Option<bool>,
    transform: Option<bool>,
    geometry: Option<bool>,
    mesh_opt: Option<bool>,
    material: Option<bool>,
    file: Option<bool>,
}

type ModelStepRecord = ProtocolStepRecord;
type ModelEventRecord = ProtocolEventRecord;
type ModelAssetRecord = ProtocolAssetRecord;

#[derive(Default)]
struct ModelSessionState {
    steps: Vec<ModelStepRecord>,
    events: Vec<ModelEventRecord>,
    assets: Vec<ModelAssetRecord>,
    last_prompt: Option<String>,
    last_provider: Option<String>,
    last_output_dir: Option<String>,
    version: u64,
    cancelled: bool,
}

#[derive(Default, Clone)]
struct ModelSessionStore {
    sessions: Arc<Mutex<HashMap<String, ModelSessionState>>>,
}

#[derive(Debug, Clone, Default)]
struct SelectionContextSnapshot {
    active_object: Option<String>,
    selected_objects: Vec<String>,
}

#[derive(Serialize)]
struct ModelSessionRunResponse {
    trace_id: String,
    message: String,
    steps: Vec<ModelStepRecord>,
    events: Vec<ModelEventRecord>,
    assets: Vec<ModelAssetRecord>,
    exported_file: Option<String>,
    ui_hint: Option<ProtocolUiHint>,
}

#[derive(Serialize, Clone)]
struct AgentLogEvent {
    trace_id: String,
    level: String,
    stage: String,
    message: String,
}

#[derive(Serialize, Clone)]
struct AgentTextStreamEvent {
    trace_id: String,
    session_id: Option<String>,
    kind: String,
    message: String,
    delta: Option<String>,
    data: Option<serde_json::Value>,
}

#[derive(Serialize, Clone)]
struct ModelSessionStreamEvent {
    session_id: String,
    trace_id: String,
    status: String,
    message: String,
    step: Option<ModelStepRecord>,
    event: Option<ModelEventRecord>,
}

#[derive(Serialize, Clone)]
struct ModelDebugTraceEvent {
    session_id: String,
    trace_id: String,
    stage: String,
    title: String,
    detail: String,
    timestamp_ms: u128,
}

#[derive(Serialize)]
struct ModelSessionAiSummaryResponse {
    summary: String,
    prompt: String,
    raw_response: String,
    provider: String,
}

/// 描述：向前端派发通用智能体文本流事件，供代码会话逐字渲染。
fn emit_agent_text_stream_event(app: &tauri::AppHandle, payload: AgentTextStreamEvent) {
    let _ = app.emit(EVENT_AGENT_TEXT_STREAM, payload);
}

/// 描述：向前端派发模型会话流式事件，供会话页实时渲染中间过程。
fn emit_model_session_stream_event(app: &tauri::AppHandle, payload: ModelSessionStreamEvent) {
    let _ = app.emit(EVENT_MODEL_SESSION_STREAM, payload);
}

/// 描述：向前端派发模型会话调试事件，包含规划 prompt、原始返回与解析结果等关键信息。
fn emit_model_debug_trace_event(app: &tauri::AppHandle, payload: ModelDebugTraceEvent) {
    let _ = app.emit(EVENT_MODEL_DEBUG_TRACE, payload);
}

#[derive(Serialize)]
struct CodexCliHealthResponse {
    available: bool,
    outdated: bool,
    version: String,
    minimum_version: String,
    bin_path: String,
    message: String,
}

#[derive(Serialize)]
struct GeminiCliHealthResponse {
    available: bool,
    outdated: bool,
    version: String,
    minimum_version: String,
    bin_path: String,
    message: String,
}

#[derive(Serialize)]
struct GitCliHealthResponse {
    available: bool,
    version: String,
    bin_path: String,
    message: String,
}

#[derive(Serialize)]
struct PythonCliHealthResponse {
    available: bool,
    version: String,
    bin_path: String,
    message: String,
}

#[derive(Serialize)]
struct GitCloneResponse {
    path: String,
    name: String,
    message: String,
}

#[derive(Serialize)]
struct ApifoxMcpRuntimeStatusResponse {
    installed: bool,
    version: String,
    npm_bin: String,
    runtime_dir: String,
    entry_path: String,
    message: String,
}

#[derive(Deserialize)]
struct LlmModelPlanResponse {
    steps: Vec<LlmModelPlanStep>,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct LlmModelPlanStep {
    #[serde(rename = "type")]
    step_type: String,
    action: Option<String>,
    input: Option<String>,
    #[serde(alias = "export_format")]
    format: Option<String>,
    params: Option<serde_json::Value>,
    operation_kind: Option<String>,
    branch: Option<String>,
    recoverable: Option<bool>,
    risk: Option<String>,
    condition: Option<String>,
}

fn resolve_blender_bin(preferred: Option<String>) -> String {
    if let Some(path) = preferred.map(|value| value.trim().to_string()) {
        if !path.is_empty() {
            return path;
        }
    }
    if let Ok(path) = env::var("BLENDER_BIN") {
        let path = path.trim().to_string();
        if !path.is_empty() {
            return path;
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mac_default = "/Applications/Blender.app/Contents/MacOS/Blender";
        if Path::new(mac_default).exists() {
            return mac_default.to_string();
        }
        if let Ok(entries) = fs::read_dir("/Applications") {
            let mut app_candidates: Vec<PathBuf> = entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .map(|name| name.starts_with("Blender") && name.ends_with(".app"))
                        .unwrap_or(false)
                })
                .collect();
            app_candidates.sort_by(|a, b| b.cmp(a));
            for app_path in app_candidates {
                let bin_path = app_path.join("Contents").join("MacOS").join("Blender");
                if bin_path.exists() {
                    return bin_path.to_string_lossy().to_string();
                }
            }
        }
    }

    "blender".to_string()
}

fn resolve_codex_bins() -> Vec<String> {
    let mut bins: Vec<String> = Vec::new();
    if let Ok(path) = env::var("ZODILEAP_CODEX_BIN") {
        let path = path.trim().to_string();
        if !path.is_empty() {
            bins.push(path);
        }
    }
    bins.push("codex".to_string());
    bins.push("/opt/homebrew/bin/codex".to_string());
    if let Ok(home) = env::var("HOME") {
        bins.push(
            Path::new(&home)
                .join("Library")
                .join("pnpm")
                .join("codex")
                .to_string_lossy()
                .to_string(),
        );
    }
    bins
}

/// 描述：解析可用于执行 Gemini CLI 命令的候选二进制路径列表。
fn resolve_gemini_bins() -> Vec<String> {
    let mut bins: Vec<String> = Vec::new();
    if let Ok(path) = env::var("ZODILEAP_GEMINI_BIN") {
        let path = path.trim().to_string();
        if !path.is_empty() {
            bins.push(path);
        }
    }
    bins.push("gemini".to_string());
    bins.push("/opt/homebrew/bin/gemini".to_string());
    if let Ok(home) = env::var("HOME") {
        bins.push(
            Path::new(&home)
                .join("Library")
                .join("pnpm")
                .join("gemini")
                .to_string_lossy()
                .to_string(),
        );
    }
    bins
}

/// 描述：解析可用于执行 Git 命令的候选二进制路径列表。
fn resolve_git_bins() -> Vec<String> {
    let mut bins: Vec<String> = Vec::new();
    if let Ok(path) = env::var("ZODILEAP_GIT_BIN") {
        let path = path.trim().to_string();
        if !path.is_empty() {
            bins.push(path);
        }
    }
    bins.push("git".to_string());
    bins.push("/usr/bin/git".to_string());
    bins.push("/opt/homebrew/bin/git".to_string());
    bins
}

/// 描述：解析可用于执行 Python 命令的候选二进制路径列表。
fn resolve_python_bins() -> Vec<String> {
    let mut bins: Vec<String> = Vec::new();
    if let Ok(path) = env::var("ZODILEAP_PYTHON_BIN") {
        let path = path.trim().to_string();
        if !path.is_empty() {
            bins.push(path);
        }
    }
    bins.push("python3".to_string());
    bins.push("python".to_string());
    bins.push("/usr/bin/python3".to_string());
    bins.push("/opt/homebrew/bin/python3".to_string());
    bins
}

/// 描述：解析可用于执行 npm 命令的候选二进制路径列表。
fn resolve_npm_bins() -> Vec<String> {
    let mut bins: Vec<String> = Vec::new();
    if let Ok(path) = env::var("ZODILEAP_NPM_BIN") {
        let path = path.trim().to_string();
        if !path.is_empty() {
            bins.push(path);
        }
    }
    #[cfg(target_os = "windows")]
    {
        bins.push("npm.cmd".to_string());
        bins.push("npm".to_string());
    }
    #[cfg(not(target_os = "windows"))]
    {
        bins.push("npm".to_string());
    }
    bins.push("/usr/local/bin/npm".to_string());
    bins.push("/opt/homebrew/bin/npm".to_string());
    bins
}

/// 描述：读取 Git 版本号，命中失败时返回 None。
fn read_git_version(bin: &str) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    extract_semver(&text)
}

/// 描述：读取 Python 版本号，命中失败时返回 None。
fn read_python_version(bin: &str) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if let Some(version) = extract_semver(&stderr) {
        return Some(version);
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    extract_semver(&stdout)
}

/// 描述：读取 npm 版本号，命中失败时返回 None。
fn read_npm_version(bin: &str) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    extract_semver(&stdout)
}

/// 描述：返回第一个可用 Python 二进制路径与版本号。
fn detect_available_python() -> Option<(String, String)> {
    for bin in resolve_python_bins() {
        if let Some(version) = read_python_version(&bin) {
            return Some((bin, version));
        }
    }
    None
}

/// 描述：返回第一个可用 Git 二进制路径与版本号。
fn detect_available_git() -> Option<(String, String)> {
    for bin in resolve_git_bins() {
        if let Some(version) = read_git_version(&bin) {
            return Some((bin, version));
        }
    }
    None
}

/// 描述：返回第一个可用 npm 二进制路径与版本号。
fn detect_available_npm() -> Option<(String, String)> {
    for bin in resolve_npm_bins() {
        if let Some(version) = read_npm_version(&bin) {
            return Some((bin, version));
        }
    }
    None
}

/// 描述：从 Git 仓库地址推断目录名，并进行安全字符归一化。
fn infer_repo_name_from_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/').trim_end_matches(".git");
    let tail = trimmed
        .rsplit(['/', ':'])
        .next()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("project");
    let mut normalized = String::with_capacity(tail.len());
    for ch in tail.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            normalized.push(ch);
        } else {
            normalized.push('-');
        }
    }
    let normalized = normalized.trim_matches('-').to_string();
    if normalized.is_empty() {
        "project".to_string()
    } else {
        normalized
    }
}

fn read_codex_version(bin: &str) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let raw = if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    extract_semver(&raw)
}

/// 描述：读取 Gemini CLI 版本号，命中失败时返回 None。
fn read_gemini_version(bin: &str) -> Option<String> {
    read_codex_version(bin)
}

fn extract_semver(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    for i in 0..bytes.len() {
        let ch = bytes[i] as char;
        if !ch.is_ascii_digit() {
            continue;
        }
        let mut j = i;
        while j < bytes.len() {
            let c = bytes[j] as char;
            if c.is_ascii_digit() || c == '.' {
                j += 1;
            } else {
                break;
            }
        }
        let candidate = &raw[i..j];
        if candidate.split('.').count() >= 2 {
            return Some(candidate.to_string());
        }
    }
    None
}

fn parse_semver(value: &str) -> Option<(u32, u32, u32)> {
    let mut parts = value.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u32>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u32>().ok()?;
    Some((major, minor, patch))
}

fn is_lower_semver(current: &str, minimum: &str) -> Option<bool> {
    let current = parse_semver(current)?;
    let minimum = parse_semver(minimum)?;
    Some(current < minimum)
}

fn blender_user_root() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = env::var("HOME").map_err(|err| format!("read HOME failed: {}", err))?;
        return Ok(Path::new(&home)
            .join("Library")
            .join("Application Support")
            .join("Blender"));
    }

    #[cfg(target_os = "windows")]
    {
        let app_data =
            env::var("APPDATA").map_err(|err| format!("read APPDATA failed: {}", err))?;
        return Ok(Path::new(&app_data)
            .join("Blender Foundation")
            .join("Blender"));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let home = env::var("HOME").map_err(|err| format!("read HOME failed: {}", err))?;
        return Ok(Path::new(&home).join(".config").join("blender"));
    }
}

fn detect_blender_series(blender_bin: &str) -> Option<String> {
    let output = Command::new(blender_bin).arg("--version").output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let first_line = text.lines().next()?;
    let mut parts = first_line.split_whitespace();
    let _ = parts.next();
    let version = parts.next()?;
    let mut version_parts = version.split('.');
    let major = version_parts.next()?;
    let minor = version_parts.next()?;
    Some(format!("{}.{}", major, minor))
}

/// 描述：判断 Blender 主次版本是否达到 Extension 体系可用阈值（>= 4.2）。
fn blender_series_supports_extension(series: &str) -> bool {
    let normalized = format!("{}.0", series.trim());
    !is_lower_semver(&normalized, BLENDER_EXTENSION_MIN_VERSION).unwrap_or(true)
}

/// 描述：从 Blender 可执行文件推断是否应优先走 Extension 安装流程。
fn blender_supports_extension_install(blender_bin: &str) -> bool {
    detect_blender_series(blender_bin)
        .map(|series| blender_series_supports_extension(&series))
        .unwrap_or(false)
}

/// 描述：检测 Blender 是否提供 Extension 命令行入口。
fn blender_extension_cli_available(blender_bin: &str) -> bool {
    Command::new(blender_bin)
        .arg("--background")
        .arg("--command")
        .arg("extension")
        .arg("--help")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// 描述：执行 Blender Extension 子命令并统一返回输出文本。
fn run_blender_extension_command(
    blender_bin: &str,
    args: &[&str],
    trailing_path: Option<&Path>,
) -> Result<String, String> {
    let mut command = Command::new(blender_bin);
    command
        .arg("--background")
        .arg("--command")
        .arg("extension");
    for arg in args {
        command.arg(arg);
    }
    if let Some(path) = trailing_path {
        command.arg(path);
    }

    let output = command
        .output()
        .map_err(|err| format!("run extension command failed: {}", err))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let joined = format!("{} {}", stdout.trim(), stderr.trim())
        .trim()
        .to_string();

    if !output.status.success() {
        return Err(format!(
            "extension command failed (code: {:?}): {}",
            output.status.code(),
            joined
        ));
    }

    Ok(joined)
}

/// 描述：确保 Blender Extensions 用户仓库存在，便于后续 install-file 安装。
fn ensure_blender_extension_repo(blender_bin: &str) -> Result<(), String> {
    let repo_list = run_blender_extension_command(blender_bin, &["repo-list"], None)?;
    if repo_list.contains(BLENDER_EXTENSION_REPO_ID) {
        return Ok(());
    }

    match run_blender_extension_command(
        blender_bin,
        &[
            "repo-add",
            "--source",
            "USER",
            "--name",
            "Zodileap Local",
            BLENDER_EXTENSION_REPO_ID,
        ],
        None,
    ) {
        Ok(_) => Ok(()),
        Err(err) => {
            let lower = err.to_lowercase();
            if lower.contains("already") && lower.contains("exist") {
                Ok(())
            } else {
                Err(err)
            }
        }
    }
}

/// 描述：生成 Blender Extension 安装包（zip），用于 install-file 安装。
fn build_bridge_extension_archive() -> Result<PathBuf, String> {
    let package_dir = env::temp_dir().join(format!("zodileap-bridge-extension-{}", now_millis()));
    fs::create_dir_all(&package_dir)
        .map_err(|err| format!("create extension temp dir failed: {}", err))?;
    let archive_path = package_dir.join(BLENDER_EXTENSION_PACKAGE_NAME);
    let archive_file = fs::File::create(&archive_path)
        .map_err(|err| format!("create extension archive failed: {}", err))?;

    let mut zip_writer = zip::ZipWriter::new(archive_file);
    let file_options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    zip_writer
        .start_file("blender_manifest.toml", file_options)
        .map_err(|err| format!("write extension manifest entry failed: {}", err))?;
    zip_writer
        .write_all(blender_bridge_extension_manifest().as_bytes())
        .map_err(|err| format!("write extension manifest content failed: {}", err))?;

    zip_writer
        .start_file("__init__.py", file_options)
        .map_err(|err| format!("write extension init entry failed: {}", err))?;
    zip_writer
        .write_all(blender_bridge_addon_script().as_bytes())
        .map_err(|err| format!("write extension init content failed: {}", err))?;

    zip_writer
        .finish()
        .map_err(|err| format!("finish extension archive failed: {}", err))?;

    Ok(archive_path)
}

/// 描述：执行用户偏好落盘，确保插件启用状态在 Blender 重启后可保留。
fn save_blender_user_preferences(blender_bin: &str) -> Result<(), String> {
    let output = Command::new(blender_bin)
        .arg("--background")
        .arg("--python-expr")
        .arg(
            r#"import bpy
if hasattr(bpy.ops.wm, "save_userpref"):
    bpy.ops.wm.save_userpref()
"#,
        )
        .output()
        .map_err(|err| format!("run save_userpref failed: {}", err))?;
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "save user preference failed (code: {:?}): {} {}",
            output.status.code(),
            stdout.trim(),
            stderr.trim()
        ));
    }
    Ok(())
}

/// 描述：在 Extension 安装成功后清理 Legacy 插件脚本，避免偏好面板仍显示旧式来源。
fn cleanup_legacy_bridge_files(blender_bin: &str) -> Result<Vec<String>, String> {
    let user_root = blender_user_root()?;
    if !user_root.exists() {
        return Ok(Vec::new());
    }
    let version_dirs = discover_blender_version_dirs(&user_root, blender_bin);
    let mut removed_paths: Vec<String> = Vec::new();
    for version_dir in version_dirs {
        let legacy_addon = version_dir
            .join("scripts")
            .join("addons")
            .join("zodileap_blender_bridge_addon.py");
        let legacy_boot = version_dir
            .join("scripts")
            .join("startup")
            .join("zodileap_bridge_boot.py");
        for target in [legacy_addon, legacy_boot] {
            if target.exists() {
                fs::remove_file(&target)
                    .map_err(|err| format!("remove legacy bridge file failed: {}", err))?;
                removed_paths.push(target.to_string_lossy().to_string());
            }
        }
    }
    Ok(removed_paths)
}

/// 描述：使用 Blender Extension 体系安装并启用 Bridge；成功后同步保存用户偏好。
fn install_blender_bridge_by_extension(blender_bin: &str) -> Result<String, String> {
    if !blender_supports_extension_install(blender_bin) {
        return Err(format!(
            "blender version is lower than {}",
            BLENDER_EXTENSION_MIN_VERSION
        ));
    }
    if !blender_extension_cli_available(blender_bin) {
        return Err("blender extension cli is unavailable".to_string());
    }

    ensure_blender_extension_repo(blender_bin)?;
    let archive_path = build_bridge_extension_archive()?;
    let archive_dir = archive_path.parent().map(|path| path.to_path_buf());

    let install_result = run_blender_extension_command(
        blender_bin,
        &[
            "install-file",
            "--repo",
            BLENDER_EXTENSION_REPO_ID,
            "--enable",
        ],
        Some(&archive_path),
    );

    if let Some(path) = archive_dir {
        let _ = fs::remove_dir_all(path);
    }

    let install_output = install_result?;
    let cleanup_result = cleanup_legacy_bridge_files(blender_bin);
    let persist_warning = save_blender_user_preferences(blender_bin).err();
    let mut message = format!(
        "Bridge 已通过 Blender Extensions 安装并启用（repo: {}）",
        BLENDER_EXTENSION_REPO_ID
    );
    if !install_output.is_empty() {
        message.push_str(&format!("。{}", install_output));
    }
    match cleanup_result {
        Ok(removed_paths) => {
            if !removed_paths.is_empty() {
                message.push_str(&format!(
                    "。已清理 Legacy 文件：{}",
                    removed_paths.join(" | ")
                ));
            }
        }
        Err(err) => {
            message.push_str(&format!("。清理 Legacy 文件失败：{}", err));
        }
    }
    if let Some(warning) = persist_warning {
        message.push_str(&format!("。安装成功但偏好保存失败：{}", warning));
    } else {
        message.push_str("。已自动保存 Blender 用户偏好。");
    }
    Ok(message)
}

fn discover_blender_version_dirs(root: &Path, blender_bin: &str) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if name.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
                dirs.push(path);
            }
        }
    }

    if let Some(series) = detect_blender_series(blender_bin) {
        let path = root.join(series);
        if !dirs.iter().any(|item| item == &path) {
            dirs.push(path);
        }
    }

    if dirs.is_empty() {
        dirs.push(root.join("5.0"));
    }

    dirs
}

/// 描述：构建 Blender 启动脚本内容，确保每次启动都会尝试启用 Bridge 并保存用户偏好。
fn bridge_boot_script_content() -> &'static str {
    r#"import addon_utils
import bpy
MODULE = "zodileap_blender_bridge_addon"
try:
    addon_utils.enable(MODULE, default_set=True, persistent=True)
    if hasattr(bpy.ops.wm, "save_userpref"):
        bpy.ops.wm.save_userpref()
except Exception as err:
    print(f"[zodileap] bridge auto-enable failed: {err}")
"#
}

fn ensure_bridge_boot_script(startup_dir: &Path) -> Result<PathBuf, String> {
    let boot_script = startup_dir.join("zodileap_bridge_boot.py");
    fs::write(&boot_script, bridge_boot_script_content())
        .map_err(|err| format!("write bridge startup script failed: {}", err))?;
    Ok(boot_script)
}

/// 描述：构建后台启用 Bridge 的 Python 表达式，安装后会立刻保存用户偏好。
fn bridge_enable_and_save_expr() -> &'static str {
    r#"import addon_utils, bpy, traceback
MODULE = "zodileap_blender_bridge_addon"
try:
    addon_utils.enable(MODULE, default_set=True, persistent=True)
    if hasattr(bpy.ops.wm, "save_userpref"):
        bpy.ops.wm.save_userpref()
    print("[zodileap] bridge addon enabled and user preferences saved")
except Exception as err:
    traceback.print_exc()
    raise err
"#
}

/// 描述：在安装完成后通过 Blender 后台进程执行一次启用与持久化，降低重启后插件自动关闭概率。
fn persist_legacy_bridge_preferences(blender_bin: &str) -> Result<(), String> {
    let output = Command::new(blender_bin)
        .arg("--background")
        .arg("--python-expr")
        .arg(bridge_enable_and_save_expr())
        .output()
        .map_err(|err| format!("run blender background enable failed: {}", err))?;
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "background enable bridge failed (code: {:?}): {} {}",
            output.status.code(),
            stdout.trim(),
            stderr.trim()
        ));
    }
    Ok(())
}

/// 描述：使用 Legacy Add-on 方式写入 Bridge 文件并尝试持久化启用。
fn install_blender_bridge_legacy(blender_bin: &str) -> Result<String, String> {
    let user_root = blender_user_root()?;
    fs::create_dir_all(&user_root)
        .map_err(|err| format!("create blender user root failed: {}", err))?;

    let version_dirs = discover_blender_version_dirs(&user_root, &blender_bin);
    let addon_content = blender_bridge_addon_script();
    let mut installed_paths: Vec<String> = Vec::new();

    for version_dir in version_dirs {
        let addon_dir = version_dir.join("scripts").join("addons");
        let startup_dir = version_dir.join("scripts").join("startup");
        fs::create_dir_all(&addon_dir)
            .map_err(|err| format!("create addon dir failed: {}", err))?;
        fs::create_dir_all(&startup_dir)
            .map_err(|err| format!("create startup dir failed: {}", err))?;

        let addon_path = addon_dir.join("zodileap_blender_bridge_addon.py");
        fs::write(&addon_path, addon_content)
            .map_err(|err| format!("write bridge addon failed: {}", err))?;

        let startup_path = ensure_bridge_boot_script(&startup_dir)?;

        installed_paths.push(addon_path.to_string_lossy().to_string());
        installed_paths.push(startup_path.to_string_lossy().to_string());
    }

    let persist_warning = persist_legacy_bridge_preferences(blender_bin).err();
    let mut message = format!(
        "Bridge 已按 Legacy Add-on 方式写入。请重启 Blender 后生效。安装路径：{}",
        installed_paths.join(" | ")
    );
    if let Some(warning) = persist_warning {
        message.push_str(&format!("。已尝试自动持久化启用插件但失败：{}", warning));
    } else {
        message.push_str("。已自动执行插件持久化启用。");
    }
    Ok(message)
}

#[tauri::command]
async fn install_blender_bridge(
    blender_bin: Option<String>,
) -> Result<InstallBridgeResponse, String> {
    tauri::async_runtime::spawn_blocking(move || install_blender_bridge_inner(blender_bin))
        .await
        .map_err(|err| format!("install blender bridge task join failed: {}", err))?
}

/// 描述：执行 Bridge 安装主流程，包含 extension 优先与 legacy 回退策略。
fn install_blender_bridge_inner(
    blender_bin: Option<String>,
) -> Result<InstallBridgeResponse, String> {
    let blender_bin = resolve_blender_bin(blender_bin);
    if blender_supports_extension_install(&blender_bin) {
        match install_blender_bridge_by_extension(&blender_bin) {
            Ok(message) => {
                return Ok(InstallBridgeResponse { message });
            }
            Err(extension_err) => {
                let legacy_message = install_blender_bridge_legacy(&blender_bin)?;
                return Ok(InstallBridgeResponse {
                    message: format!(
                        "Extension 安装失败，已自动回退到 Legacy Add-on：{}。{}",
                        extension_err, legacy_message
                    ),
                });
            }
        }
    }

    let message = install_blender_bridge_legacy(&blender_bin)?;

    Ok(InstallBridgeResponse { message })
}

#[tauri::command]
async fn check_blender_bridge(blender_bridge_addr: Option<String>) -> BridgeHealthResponse {
    tauri::async_runtime::spawn_blocking(move || check_blender_bridge_inner(blender_bridge_addr))
        .await
        .unwrap_or_else(|err| BridgeHealthResponse {
            ok: false,
            message: format!("check blender bridge task join failed: {}", err),
        })
}

/// 描述：执行 Bridge 健康检查的阻塞逻辑，避免在 UI 事件循环线程中直接进行网络连接。
fn check_blender_bridge_inner(blender_bridge_addr: Option<String>) -> BridgeHealthResponse {
    match ping_blender_bridge(blender_bridge_addr) {
        Ok(message) => BridgeHealthResponse { ok: true, message },
        Err(err) => BridgeHealthResponse {
            ok: false,
            message: err.to_string(),
        },
    }
}

#[tauri::command]
async fn export_model_command(
    project_name: String,
    prompt: String,
    output_dir: Option<String>,
    blender_bridge_addr: Option<String>,
    target: Option<String>,
    export_format: Option<String>,
    export_params: Option<serde_json::Value>,
) -> Result<ExportModelResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_model_command_inner(
            project_name,
            prompt,
            output_dir,
            blender_bridge_addr,
            target,
            export_format,
            export_params,
        )
    })
    .await
    .map_err(|err| format!("export model task join failed: {}", err))?
}

/// 描述：执行模型导出的阻塞逻辑，供异步命令包装器在后台线程调用。
fn export_model_command_inner(
    project_name: String,
    prompt: String,
    output_dir: Option<String>,
    blender_bridge_addr: Option<String>,
    target: Option<String>,
    export_format: Option<String>,
    export_params: Option<serde_json::Value>,
) -> Result<ExportModelResponse, String> {
    let target = match target.as_deref() {
        Some("zbrush") => ModelToolTarget::ZBrush,
        _ => ModelToolTarget::Blender,
    };
    let output_dir = output_dir.unwrap_or_else(|| "exports".to_string());
    let output_dir = if Path::new(&output_dir).is_absolute() {
        output_dir
    } else {
        std::env::current_dir()
            .map(|value| value.join(&output_dir).to_string_lossy().to_string())
            .unwrap_or(output_dir)
    };

    let export_format = export_format
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.parse::<ExportModelFormat>())
        .transpose()?;
    let result = export_model(ExportModelRequest {
        project_name,
        prompt,
        output_dir,
        export_format,
        export_params,
        blender_bridge_addr,
        target,
    })
    .map_err(|err| err.to_string())?;

    Ok(ExportModelResponse {
        exported_file: result.exported_file,
        summary: result.summary,
        target: match result.target {
            ModelToolTarget::Blender => "blender".to_string(),
            ModelToolTarget::ZBrush => "zbrush".to_string(),
        },
    })
}

#[tauri::command]
async fn run_agent_command(
    app: tauri::AppHandle,
    agent_key: String,
    session_id: Option<String>,
    provider: Option<String>,
    prompt: String,
    trace_id: Option<String>,
    project_name: Option<String>,
    model_export_enabled: Option<bool>,
    blender_bridge_addr: Option<String>,
    output_dir: Option<String>,
    workdir: Option<String>,
) -> Result<AgentRunResponse, DesktopProtocolError> {
    tauri::async_runtime::spawn_blocking(move || {
        run_agent_command_inner(
            app,
            agent_key,
            session_id,
            provider,
            prompt,
            trace_id,
            project_name,
            model_export_enabled,
            blender_bridge_addr,
            output_dir,
            workdir,
        )
    })
    .await
    .map_err(|err| DesktopProtocolError {
        code: "core.desktop.agent.task_join_failed".to_string(),
        message: format!("agent command task join failed: {}", err),
        suggestion: Some("请重试一次；如仍失败请重启应用".to_string()),
        retryable: true,
    })?
}

fn run_agent_command_inner(
    app: tauri::AppHandle,
    agent_key: String,
    session_id: Option<String>,
    provider: Option<String>,
    prompt: String,
    trace_id: Option<String>,
    project_name: Option<String>,
    model_export_enabled: Option<bool>,
    blender_bridge_addr: Option<String>,
    output_dir: Option<String>,
    workdir: Option<String>,
) -> Result<AgentRunResponse, DesktopProtocolError> {
    fn is_cancelled_protocol_error(code: &str) -> bool {
        code == "core.agent.python.orchestration_timeout"
            || code == "core.agent.request_cancelled"
            || code == "core.agent.human_approval_timeout"
    }

    let trace_id = trace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("trace-unknown")
        .to_string();
    if let Some(session) = session_id.as_deref() {
        clear_agent_session_cancelled(session);
    }
    let log = |level: &str, stage: &str, message: String| {
        eprintln!("[agent][{}][{}][{}] {}", trace_id, level, stage, message);
        let payload = AgentLogEvent {
            trace_id: trace_id.clone(),
            level: level.to_string(),
            stage: stage.to_string(),
            message,
        };
        let _ = app.emit(EVENT_AGENT_LOG, payload);
    };

    let current_dir = env::current_dir().map_err(|err| DesktopProtocolError {
        code: "core.desktop.agent.current_dir_read_failed".to_string(),
        message: format!("read current dir failed: {}", err),
        suggestion: None,
        retryable: false,
    })?;
    // 描述：
    //
    //   - 优先使用会话传入的项目目录作为执行路径，确保代码智能体基于当前项目上下文工作。
    let selected_workdir = workdir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| current_dir.clone());
    let selected_workdir = if selected_workdir.is_absolute() {
        selected_workdir
    } else {
        current_dir.join(selected_workdir)
    };
    if !selected_workdir.exists() || !selected_workdir.is_dir() {
        return Err(DesktopProtocolError {
            code: "core.desktop.agent.workdir_invalid".to_string(),
            message: format!("workdir is invalid: {}", selected_workdir.to_string_lossy()),
            suggestion: Some("请确认会话绑定的项目目录存在且可访问".to_string()),
            retryable: false,
        });
    }
    let default_output_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|path| path.join("exports"))
        .unwrap_or_else(|| env::temp_dir().join("zodileap-agen").join("exports"));
    let selected_output_dir = output_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_output_dir);
    let mut selected_output_dir = if selected_output_dir.is_absolute() {
        selected_output_dir
    } else {
        selected_workdir.join(selected_output_dir)
    };

    if cfg!(debug_assertions) && selected_output_dir.starts_with(&selected_workdir) {
        let safe_output_dir = selected_workdir
            .parent()
            .map(|path| path.join("exports"))
            .unwrap_or_else(|| env::temp_dir().join("zodileap-agen").join("exports"));
        log(
            "warn",
            "request",
            format!(
                "output_dir {} is under workdir and may trigger dev restart; redirecting to {}",
                selected_output_dir.to_string_lossy(),
                safe_output_dir.to_string_lossy()
            ),
        );
        selected_output_dir = safe_output_dir;
    }
    fs::create_dir_all(&selected_output_dir).map_err(|err| DesktopProtocolError {
        code: "core.desktop.agent.output_dir_create_failed".to_string(),
        message: format!("create agent output dir failed: {}", err),
        suggestion: None,
        retryable: false,
    })?;
    log(
        "info",
        "request",
        format!(
            "agent_key={}, provider={}, prompt_len={}, model_export_enabled={}",
            agent_key,
            provider.as_deref().unwrap_or("codex"),
            prompt.chars().count(),
            model_export_enabled.unwrap_or(false)
        ),
    );
    log(
        "debug",
        "request",
        format!("workdir={}", selected_workdir.to_string_lossy()),
    );
    log(
        "debug",
        "request",
        format!("output_dir={}", selected_output_dir.to_string_lossy()),
    );

    emit_agent_text_stream_event(
        &app,
        AgentTextStreamEvent {
            trace_id: trace_id.clone(),
            session_id: session_id.clone(),
            kind: "started".to_string(),
            message: "LLM 执行已开始".to_string(),
            delta: None,
            data: None,
        },
    );

    let result = run_agent_with_protocol_error_stream(
        AgentRunRequest {
            trace_id: trace_id.clone(),
            session_id: session_id.clone().unwrap_or_else(|| "default".to_string()),
            agent_key,
            provider: provider.unwrap_or_else(|| "codex".to_string()),
            prompt,
            project_name,
            model_export_enabled: model_export_enabled.unwrap_or(false),
            blender_bridge_addr,
            output_dir: Some(selected_output_dir.to_string_lossy().to_string()),
            workdir: Some(selected_workdir.to_string_lossy().to_string()),
        },
        |stream_event| {
            let kind = stream_event.kind().to_string();
            match stream_event {
                AgentStreamEvent::LlmStarted { provider } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: format!("provider={} started", provider),
                            delta: None,
                            data: None,
                        },
                    );
                }
                AgentStreamEvent::LlmDelta { content } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: "chunk".to_string(),
                            delta: Some(content),
                            data: None,
                        },
                    );
                }
                AgentStreamEvent::LlmFinished { provider } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: format!("provider={} finished", provider),
                            delta: None,
                            data: None,
                        },
                    );
                }
                AgentStreamEvent::Planning { message } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message,
                            delta: None,
                            data: None,
                        },
                    );
                }
                AgentStreamEvent::ToolCallStarted { name, args } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: format!("正在执行工具: {}", name),
                            delta: None,
                            data: Some(json!({ "name": name, "args": args })),
                        },
                    );
                }
                AgentStreamEvent::ToolCallFinished { name, ok, result } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: format!(
                                "工具 {} 执行{}",
                                name,
                                if ok { "成功" } else { "失败" }
                            ),
                            delta: None,
                            data: Some(json!({ "name": name, "ok": ok, "result": result })),
                        },
                    );
                }
                AgentStreamEvent::RequireApproval {
                    approval_id,
                    tool_name,
                    tool_args,
                } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: format!("操作待授权: {}", tool_name),
                            delta: None,
                            data: Some(json!({
                                "approval_id": approval_id,
                                "tool_name": tool_name,
                                "tool_args": tool_args,
                            })),
                        },
                    );
                }
                AgentStreamEvent::Heartbeat { message } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message,
                            delta: None,
                            data: None,
                        },
                    );
                }
                AgentStreamEvent::Final { message } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message,
                            delta: None,
                            data: None,
                        },
                    );
                }
                AgentStreamEvent::Cancelled { message } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: message.clone(),
                            delta: None,
                            data: Some(json!({ "source": "core", "message": message })),
                        },
                    );
                }
                AgentStreamEvent::Error { code, message } => {
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: format!("{}: {}", code, message),
                            delta: None,
                            data: Some(json!({ "code": code })),
                        },
                    );
                }
            }
        },
    );

    let result = match result {
        Ok(mut value) => {
            let normalized_message = value.message.trim().to_string();
            if normalized_message.is_empty() {
                if value.actions.is_empty() {
                    return Err(DesktopProtocolError {
                        code: "core.desktop.agent.empty_result".to_string(),
                        message: "执行结束但未返回任何结果，请重试。".to_string(),
                        suggestion: Some(
                            "建议检查当前工作流技能配置，或切换模型后重试。若问题持续，请复制会话内容用于排查。"
                                .to_string(),
                        ),
                        retryable: true,
                    });
                }
                value.message = format!("执行完成（工具调用 {} 次）", value.actions.len());
            }
            log(
                "info",
                "result",
                format!(
                    "actions={}, exported_file={}",
                    if value.actions.is_empty() {
                        "none".to_string()
                    } else {
                        value.actions.join(",")
                    },
                    value.exported_file.as_deref().unwrap_or("-")
                ),
            );
            value
        }
        Err(err) => {
            let cancelled_by_user = session_id
                .as_deref()
                .map(take_agent_session_cancelled)
                .unwrap_or(false);
            let protocol_err =
                if cancelled_by_user && !is_cancelled_protocol_error(err.code.as_str()) {
                    ProtocolError::new("core.agent.request_cancelled", "任务已取消（用户主动终止）")
                        .with_suggestion("如需继续，请重新发起任务")
                } else {
                    err
                };
            log("error", "result", protocol_err.to_string());
            emit_agent_text_stream_event(
                &app,
                AgentTextStreamEvent {
                    trace_id: trace_id.clone(),
                    session_id: session_id.clone(),
                    kind: if is_cancelled_protocol_error(protocol_err.code.as_str()) {
                        "cancelled".to_string()
                    } else {
                        "error".to_string()
                    },
                    message: protocol_err.message.clone(),
                    delta: None,
                    data: Some(json!({ "code": protocol_err.code.clone() })),
                },
            );
            return Err(protocol_err.into());
        }
    };

    emit_agent_text_stream_event(
        &app,
        AgentTextStreamEvent {
            trace_id: trace_id.clone(),
            session_id,
            kind: "finished".to_string(),
            message: "智能体执行完成".to_string(),
            delta: None,
            data: None,
        },
    );

    Ok(AgentRunResponse {
        trace_id,
        message: result.message,
        actions: result.actions,
        exported_file: result.exported_file,
        steps: result.steps,
        events: result.events,
        assets: result.assets,
        ui_hint: result.ui_hint,
    })
}

/// 描述：解析单条依赖规范，支持 `node:pkg@1.0.0`、`go:module@v1.0.0`、`java:group:artifact@1.0.0` 与无前缀写法。
fn parse_dependency_rule(rule: &str) -> Result<ParsedDependencyRule, String> {
    let trimmed = rule.trim();
    if trimmed.is_empty() {
        return Err("规则为空".to_string());
    }

    let (ecosystem, body) = if let Some((prefix, rest)) = trimmed.split_once(':') {
        let normalized_prefix = prefix.trim().to_lowercase();
        match normalized_prefix.as_str() {
            "node" => (Some(DependencyEcosystem::Node), rest.trim()),
            "go" => (Some(DependencyEcosystem::Go), rest.trim()),
            "java" => (Some(DependencyEcosystem::Java), rest.trim()),
            _ => (None, trimmed),
        }
    } else {
        (None, trimmed)
    };

    let Some((package_name, expected_version)) = body.rsplit_once('@') else {
        return Err("缺少 @版本，格式应为 包名@版本".to_string());
    };
    let package_name = package_name.trim().to_string();
    let expected_version = expected_version.trim().to_string();
    if package_name.is_empty() || expected_version.is_empty() {
        return Err("包名或版本为空".to_string());
    }

    Ok(ParsedDependencyRule {
        raw: trimmed.to_string(),
        ecosystem,
        package_name,
        expected_version,
    })
}

/// 描述：当规则未声明生态前缀时，按包名特征推断默认生态。
fn infer_dependency_rule_ecosystem(package_name: &str) -> DependencyEcosystem {
    if package_name.contains(':') {
        return DependencyEcosystem::Java;
    }
    if package_name.starts_with("github.com/")
        || package_name.starts_with("golang.org/")
        || package_name.starts_with("gopkg.in/")
    {
        return DependencyEcosystem::Go;
    }
    DependencyEcosystem::Node
}

/// 描述：检测项目根目录启用的依赖生态，用于规则命中与提示。
fn detect_project_dependency_ecosystems(project_root: &Path) -> Vec<DependencyEcosystem> {
    let mut ecosystems = Vec::new();
    if project_root.join("package.json").exists() {
        ecosystems.push(DependencyEcosystem::Node);
    }
    if project_root.join("go.mod").exists() {
        ecosystems.push(DependencyEcosystem::Go);
    }
    if project_root.join("pom.xml").exists()
        || project_root.join("build.gradle").exists()
        || project_root.join("build.gradle.kts").exists()
    {
        ecosystems.push(DependencyEcosystem::Java);
    }
    ecosystems
}

/// 描述：向字符串数组追加唯一项，统一去空与去重逻辑。
fn push_unique_string(list: &mut Vec<String>, value: &str) {
    let normalized = value.trim();
    if normalized.is_empty() {
        return;
    }
    if list.iter().any(|item| item == normalized) {
        return;
    }
    list.push(normalized.to_string());
}

/// 描述：按文件名排序读取目录直系子项，供目录摘要与模块候选识别复用。
fn read_dir_entries_sorted(project_root: &Path) -> Vec<fs::DirEntry> {
    let mut entries: Vec<fs::DirEntry> = fs::read_dir(project_root)
        .ok()
        .into_iter()
        .flat_map(|iter| iter.filter_map(Result::ok))
        .collect();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_string());
    entries
}

/// 描述：读取项目 package.json，若文件不存在或解析失败则返回 None。
fn read_project_root_package_json(project_root: &Path) -> Option<serde_json::Value> {
    let package_json_path = project_root.join("package.json");
    if !package_json_path.exists() {
        return None;
    }
    let text = fs::read_to_string(package_json_path).ok()?;
    serde_json::from_str(&text).ok()
}

/// 描述：提取 package.json 中所有依赖名（含 dependencies/devDependencies/peerDependencies/optionalDependencies）。
fn collect_node_dependency_names(package_json: &serde_json::Value) -> HashSet<String> {
    let mut names = HashSet::new();
    for section in [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        let Some(dep_map) = package_json
            .get(section)
            .and_then(|value| value.as_object())
        else {
            continue;
        };
        for name in dep_map.keys() {
            names.insert(name.to_string());
        }
    }
    names
}

/// 描述：识别 Node 构建工具，结合依赖、脚本和配置文件判断。
fn detect_node_build_tools(
    project_root: &Path,
    package_json: &serde_json::Value,
    dependency_names: &HashSet<String>,
) -> Vec<String> {
    let mut tools: Vec<String> = Vec::new();
    let has_dep = |needle: &str| dependency_names.iter().any(|item| item.contains(needle));

    if has_dep("vite")
        || project_root.join("vite.config.ts").exists()
        || project_root.join("vite.config.js").exists()
    {
        push_unique_string(&mut tools, "vite");
    }
    if has_dep("webpack")
        || project_root.join("webpack.config.js").exists()
        || project_root.join("webpack.config.ts").exists()
    {
        push_unique_string(&mut tools, "webpack");
    }
    if has_dep("rollup")
        || project_root.join("rollup.config.js").exists()
        || project_root.join("rollup.config.ts").exists()
    {
        push_unique_string(&mut tools, "rollup");
    }
    if has_dep("esbuild") {
        push_unique_string(&mut tools, "esbuild");
    }
    if has_dep("next") {
        push_unique_string(&mut tools, "next build");
    }
    if has_dep("nuxt") {
        push_unique_string(&mut tools, "nuxt build");
    }
    if project_root.join("turbo.json").exists() || has_dep("turbo") {
        push_unique_string(&mut tools, "turbo");
    }

    if let Some(scripts) = package_json
        .get("scripts")
        .and_then(|value| value.as_object())
    {
        for (name, command) in scripts {
            let command_text = command.as_str().unwrap_or("").to_lowercase();
            if name == "build" || name == "dev" || name == "start" {
                if command_text.contains("vite") {
                    push_unique_string(&mut tools, "vite");
                }
                if command_text.contains("webpack") {
                    push_unique_string(&mut tools, "webpack");
                }
                if command_text.contains("rollup") {
                    push_unique_string(&mut tools, "rollup");
                }
                if command_text.contains("next") {
                    push_unique_string(&mut tools, "next build");
                }
                if command_text.contains("nuxt") {
                    push_unique_string(&mut tools, "nuxt build");
                }
                if command_text.contains("turbo") {
                    push_unique_string(&mut tools, "turbo");
                }
            }
        }
    }

    tools
}

/// 描述：读取顶层目录名称摘要，用于生成结构化项目模块候选。
fn collect_top_level_directory_names(project_root: &Path, limit: usize) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for entry in read_dir_entries_sorted(project_root) {
        if names.len() >= limit {
            break;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        names.push(name);
    }
    names
}

/// 描述：读取顶层关键文件名称摘要，帮助初始化阶段识别工程形态。
fn collect_top_level_file_names(project_root: &Path, limit: usize) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for entry in read_dir_entries_sorted(project_root) {
        if names.len() >= limit {
            break;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        names.push(name);
    }
    names
}

/// 描述：收集指定目录下一级子目录名称，供模块候选拓展。
fn collect_child_directory_names(target_dir: &Path, limit: usize) -> Vec<String> {
    if !target_dir.exists() || !target_dir.is_dir() {
        return Vec::new();
    }
    let mut names: Vec<String> = Vec::new();
    for entry in read_dir_entries_sorted(target_dir) {
        if names.len() >= limit {
            break;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        names.push(name);
    }
    names
}

/// 描述：识别可放入架构模块边界的目录候选，优先提取常见业务层级目录。
fn collect_workspace_module_candidates(project_root: &Path) -> Vec<String> {
    let mut modules: Vec<String> = Vec::new();
    let top_level_dirs = collect_top_level_directory_names(project_root, 16);
    for dir in &top_level_dirs {
        if [
            "apps", "packages", "modules", "services", "frontend", "backend", "client", "server",
        ]
        .contains(&dir.as_str())
        {
            push_unique_string(&mut modules, dir);
        }
    }

    for child in collect_child_directory_names(&project_root.join("src"), 8) {
        push_unique_string(&mut modules, format!("src/{}", child).as_str());
    }
    for child in collect_child_directory_names(&project_root.join("src/modules"), 8) {
        push_unique_string(&mut modules, format!("src/modules/{}", child).as_str());
    }
    for child in collect_child_directory_names(&project_root.join("modules"), 8) {
        push_unique_string(&mut modules, format!("modules/{}", child).as_str());
    }
    for child in collect_child_directory_names(&project_root.join("services"), 8) {
        push_unique_string(&mut modules, format!("services/{}", child).as_str());
    }

    if modules.is_empty() {
        for dir in top_level_dirs.iter().take(3) {
            push_unique_string(&mut modules, dir);
        }
    }
    modules
}

/// 描述：收集目录下一层文件 stem（去扩展名），用于抽取结构化语义候选。
fn collect_file_stems_in_dir(target_dir: &Path, limit: usize) -> Vec<String> {
    if !target_dir.exists() || !target_dir.is_dir() {
        return Vec::new();
    }
    let mut names: Vec<String> = Vec::new();
    for entry in read_dir_entries_sorted(target_dir) {
        if names.len() >= limit {
            break;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let stem = entry
            .path()
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        if stem.is_empty() || stem.starts_with('.') {
            continue;
        }
        names.push(stem);
    }
    names
}

/// 描述：收集前端页面候选，优先读取 pages/views 目录并兼容路由文件路径片段。
fn collect_workspace_frontend_pages(project_root: &Path) -> Vec<String> {
    let mut pages: Vec<String> = Vec::new();
    for dir in [
        "src/pages",
        "pages",
        "src/views",
        "views",
        "src/app",
        "app",
    ] {
        for child in collect_child_directory_names(&project_root.join(dir), 12) {
            push_unique_string(&mut pages, child.as_str());
        }
        for stem in collect_file_stems_in_dir(&project_root.join(dir), 12) {
            push_unique_string(&mut pages, stem.as_str());
        }
    }
    pages
}

/// 描述：从文本中提取菜单标签候选（label/title 字段）。
fn extract_navigation_candidates_from_text(text: &str, limit: usize) -> Vec<String> {
    let mut values: Vec<String> = Vec::new();
    for raw_line in text.lines() {
        if values.len() >= limit {
            break;
        }
        let line = raw_line.trim();
        if !(line.contains("label:") || line.contains("title:")) {
            continue;
        }
        let quote = if line.contains('"') {
            '"'
        } else if line.contains('\'') {
            '\''
        } else {
            continue;
        };
        let Some(start) = line.find(quote) else {
            continue;
        };
        let tail = &line[start + 1..];
        let Some(end) = tail.find(quote) else {
            continue;
        };
        let value = tail[..end].trim();
        if value.is_empty() {
            continue;
        }
        push_unique_string(&mut values, value);
    }
    values
}

/// 描述：收集前端导航与菜单项候选，优先扫描 routes/sidebar/menu 关键文件。
fn collect_workspace_frontend_navigation(project_root: &Path) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    let candidate_files = [
        "src/routes.ts",
        "src/routes.tsx",
        "src/router.ts",
        "src/router.tsx",
        "src/sidebar/index.tsx",
        "src/menu.ts",
        "src/menu.tsx",
        "src/modules/code/routes.tsx",
    ];
    for file in candidate_files {
        let path = project_root.join(file);
        if !path.exists() || !path.is_file() {
            continue;
        }
        if let Ok(text) = fs::read_to_string(path) {
            for item in extract_navigation_candidates_from_text(text.as_str(), 16) {
                push_unique_string(&mut items, item.as_str());
            }
        }
    }
    items
}

/// 描述：收集前端页面元素候选，优先读取 components/widgets 目录。
fn collect_workspace_frontend_page_elements(project_root: &Path) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    for dir in [
        "src/components",
        "components",
        "src/widgets",
        "widgets",
        "src/layouts",
        "layouts",
    ] {
        for child in collect_child_directory_names(&project_root.join(dir), 12) {
            push_unique_string(&mut items, child.as_str());
        }
        for stem in collect_file_stems_in_dir(&project_root.join(dir), 12) {
            push_unique_string(&mut items, stem.as_str());
        }
    }
    items
}

/// 描述：收集 API 数据模型候选，优先扫描 models/types/schema/dto 目录与常见规范文件。
fn collect_workspace_api_data_models(project_root: &Path) -> Vec<String> {
    let mut models: Vec<String> = Vec::new();
    for dir in [
        "src/models",
        "models",
        "src/model",
        "model",
        "src/types",
        "types",
        "src/schema",
        "schema",
        "src/dto",
        "dto",
        "services/entity",
    ] {
        for stem in collect_file_stems_in_dir(&project_root.join(dir), 16) {
            push_unique_string(&mut models, stem.as_str());
        }
    }
    for file in ["openapi.yaml", "openapi.yml", "openapi.json", "apifox.json"] {
        if project_root.join(file).exists() {
            push_unique_string(&mut models, file);
        }
    }
    models
}

/// 描述：执行代码项目初始化分析，输出结构化项目信息可用的 API 数据模型/页面布局/前端代码结构草稿。
fn inspect_code_workspace_profile_seed_inner(
    project_path: String,
) -> Result<CodeWorkspaceProfileSeedResponse, String> {
    let project_root = PathBuf::from(project_path.trim());
    if !project_root.exists() || !project_root.is_dir() {
        return Err("项目路径不存在或不是目录".to_string());
    }

    let mut languages: Vec<String> = Vec::new();
    let mut frontend_stacks: Vec<String> = Vec::new();
    let mut backend_stacks: Vec<String> = Vec::new();
    let mut database_stacks: Vec<String> = Vec::new();
    let mut package_managers: Vec<String> = Vec::new();
    let mut build_tools: Vec<String> = Vec::new();

    if project_root.join("go.mod").exists() {
        push_unique_string(&mut languages, "go");
        push_unique_string(&mut package_managers, "go modules");
        push_unique_string(&mut build_tools, "go build");
    }
    if project_root.join("Cargo.toml").exists() {
        push_unique_string(&mut languages, "rust");
        push_unique_string(&mut package_managers, "cargo");
        push_unique_string(&mut build_tools, "cargo build");
    }
    if project_root.join("pyproject.toml").exists()
        || project_root.join("requirements.txt").exists()
    {
        push_unique_string(&mut languages, "python");
        if project_root.join("poetry.lock").exists() {
            push_unique_string(&mut package_managers, "poetry");
        } else if project_root.join("uv.lock").exists() {
            push_unique_string(&mut package_managers, "uv");
        } else if project_root.join("Pipfile.lock").exists() {
            push_unique_string(&mut package_managers, "pipenv");
        } else {
            push_unique_string(&mut package_managers, "pip");
        }
    }
    if project_root.join("pom.xml").exists()
        || project_root.join("build.gradle").exists()
        || project_root.join("build.gradle.kts").exists()
    {
        push_unique_string(&mut languages, "java");
        if project_root.join("pom.xml").exists() {
            push_unique_string(&mut package_managers, "maven");
            push_unique_string(&mut build_tools, "maven");
        }
        if project_root.join("build.gradle").exists()
            || project_root.join("build.gradle.kts").exists()
        {
            push_unique_string(&mut package_managers, "gradle");
            push_unique_string(&mut build_tools, "gradle");
        }
    }

    if let Some(package_json) = read_project_root_package_json(&project_root) {
        push_unique_string(&mut languages, "javascript");
        if project_root.join("tsconfig.json").exists()
            || project_root.join("tsconfig.base.json").exists()
        {
            push_unique_string(&mut languages, "typescript");
        }

        let package_manager = detect_node_package_manager(&project_root, &package_json);
        push_unique_string(&mut package_managers, package_manager.as_str());
        let node_dependency_names = collect_node_dependency_names(&package_json);
        for tool in detect_node_build_tools(&project_root, &package_json, &node_dependency_names) {
            push_unique_string(&mut build_tools, tool.as_str());
        }

        let has_dep = |needle: &str| {
            node_dependency_names
                .iter()
                .any(|item| item.contains(needle))
        };
        if has_dep("react") {
            push_unique_string(&mut frontend_stacks, "react");
        }
        if has_dep("vue") {
            push_unique_string(&mut frontend_stacks, "vue");
        }
        if has_dep("svelte") {
            push_unique_string(&mut frontend_stacks, "svelte");
        }
        if has_dep("angular") {
            push_unique_string(&mut frontend_stacks, "angular");
        }
        if has_dep("next") {
            push_unique_string(&mut frontend_stacks, "next.js");
        }
        if has_dep("nuxt") {
            push_unique_string(&mut frontend_stacks, "nuxt");
        }
        if has_dep("astro") {
            push_unique_string(&mut frontend_stacks, "astro");
        }
        if has_dep("aries_react") {
            push_unique_string(&mut frontend_stacks, "aries_react");
        }

        if has_dep("express") {
            push_unique_string(&mut backend_stacks, "express");
        }
        if has_dep("koa") {
            push_unique_string(&mut backend_stacks, "koa");
        }
        if has_dep("nestjs") || has_dep("@nestjs/") {
            push_unique_string(&mut backend_stacks, "nestjs");
        }
        if has_dep("fastify") {
            push_unique_string(&mut backend_stacks, "fastify");
        }
        if has_dep("hapi") {
            push_unique_string(&mut backend_stacks, "hapi");
        }

        if has_dep("prisma") {
            push_unique_string(&mut database_stacks, "prisma");
        }
        if has_dep("typeorm") {
            push_unique_string(&mut database_stacks, "typeorm");
        }
        if has_dep("sequelize") {
            push_unique_string(&mut database_stacks, "sequelize");
        }
        if has_dep("mongoose") || has_dep("mongodb") {
            push_unique_string(&mut database_stacks, "mongodb");
        }
        if has_dep("mysql") {
            push_unique_string(&mut database_stacks, "mysql");
        }
        if has_dep("postgres") {
            push_unique_string(&mut database_stacks, "postgres");
        }
        if has_dep("redis") {
            push_unique_string(&mut database_stacks, "redis");
        }
    }

    if let Ok(go_snapshots) = read_go_dependency_snapshots(&project_root) {
        for module_name in go_snapshots.keys() {
            if module_name.contains("gin-gonic/gin") {
                push_unique_string(&mut backend_stacks, "gin");
            }
            if module_name.contains("gofiber/fiber") {
                push_unique_string(&mut backend_stacks, "fiber");
            }
            if module_name.contains("labstack/echo") {
                push_unique_string(&mut backend_stacks, "echo");
            }
            if module_name.contains("gorm.io/gorm") {
                push_unique_string(&mut database_stacks, "gorm");
            }
        }
    }

    if let Ok(java_snapshots) = read_java_dependency_snapshots(&project_root) {
        for package_name in java_snapshots.keys() {
            if package_name.contains("spring-boot") || package_name.contains("springframework") {
                push_unique_string(&mut backend_stacks, "spring");
            }
            if package_name.contains("mybatis") {
                push_unique_string(&mut database_stacks, "mybatis");
            }
            if package_name.contains("hibernate") {
                push_unique_string(&mut database_stacks, "hibernate");
            }
            if package_name.contains("mysql") {
                push_unique_string(&mut database_stacks, "mysql");
            }
            if package_name.contains("postgresql") {
                push_unique_string(&mut database_stacks, "postgres");
            }
            if package_name.contains("redis") {
                push_unique_string(&mut database_stacks, "redis");
            }
        }
    }

    let top_dirs = collect_top_level_directory_names(&project_root, 8);
    let top_files = collect_top_level_file_names(&project_root, 8);
    let mut directory_summary: Vec<String> = Vec::new();
    if !top_dirs.is_empty() {
        directory_summary.push(format!("顶层目录：{}", top_dirs.join("、")));
    }
    if !top_files.is_empty() {
        directory_summary.push(format!("关键文件：{}", top_files.join("、")));
    }

    let module_candidates = collect_workspace_module_candidates(&project_root);
    if !module_candidates.is_empty() {
        directory_summary.push(format!(
            "模块候选：{}",
            module_candidates
                .iter()
                .take(6)
                .cloned()
                .collect::<Vec<String>>()
                .join("、")
        ));
    }

    let api_data_models = collect_workspace_api_data_models(&project_root);
    let mut api_request_models: Vec<String> = Vec::new();
    let mut api_response_models: Vec<String> = Vec::new();
    for model in &api_data_models {
        let normalized = model.to_lowercase();
        if normalized.contains("request")
            || normalized.contains("req")
            || normalized.contains("input")
            || normalized.contains("dto")
        {
            push_unique_string(&mut api_request_models, model.as_str());
        }
        if normalized.contains("response")
            || normalized.contains("resp")
            || normalized.contains("output")
            || normalized.contains("vo")
            || normalized.contains("view")
        {
            push_unique_string(&mut api_response_models, model.as_str());
        }
    }
    if api_response_models.is_empty() && !api_data_models.is_empty() {
        api_response_models.extend(api_data_models.iter().take(4).cloned());
    }
    let api_mock_cases = vec![
        "成功返回场景".to_string(),
        "空数据场景".to_string(),
        "参数校验失败场景".to_string(),
        "权限不足场景".to_string(),
    ];

    let mut frontend_pages = collect_workspace_frontend_pages(&project_root);
    if frontend_pages.is_empty() {
        for module in module_candidates.iter().take(6) {
            push_unique_string(&mut frontend_pages, module.as_str());
        }
    }
    let mut frontend_navigation = collect_workspace_frontend_navigation(&project_root);
    if frontend_navigation.is_empty() {
        push_unique_string(&mut frontend_navigation, "顶部导航");
        push_unique_string(&mut frontend_navigation, "侧边菜单");
    }
    let frontend_page_elements = collect_workspace_frontend_page_elements(&project_root);
    let frontend_code_directories = module_candidates.clone();
    let mut frontend_module_boundaries: Vec<String> = Vec::new();
    for module in module_candidates.iter().take(6) {
        push_unique_string(
            &mut frontend_module_boundaries,
            format!("{} 负责独立业务域 UI 与交互实现", module).as_str(),
        );
    }
    let mut frontend_code_constraints: Vec<String> = Vec::new();
    for item in directory_summary.iter().take(4) {
        push_unique_string(
            &mut frontend_code_constraints,
            format!("目录摘要：{}", item).as_str(),
        );
    }

    Ok(CodeWorkspaceProfileSeedResponse {
        project_path: project_root.to_string_lossy().to_string(),
        api_data_models,
        api_request_models,
        api_response_models,
        api_mock_cases,
        frontend_pages,
        frontend_navigation,
        frontend_page_elements,
        frontend_code_directories,
        frontend_module_boundaries,
        frontend_code_constraints,
        directory_summary,
        module_candidates,
    })
}

/// 描述：抽取 XML 标签文本，若标签不存在则返回 None。
fn extract_xml_tag_text(block: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start = block.find(start_tag.as_str())?;
    let value_start = start + start_tag.len();
    let end_rel = block[value_start..].find(end_tag.as_str())?;
    let end = value_start + end_rel;
    Some(block[value_start..end].trim().to_string())
}

/// 描述：替换 XML 标签值，返回替换后的新文本；标签不存在时返回 None。
fn replace_xml_tag_text(block: &str, tag: &str, value: &str) -> Option<String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start = block.find(start_tag.as_str())?;
    let value_start = start + start_tag.len();
    let end_rel = block[value_start..].find(end_tag.as_str())?;
    let value_end = value_start + end_rel;
    let mut next = String::new();
    next.push_str(&block[..value_start]);
    next.push_str(value);
    next.push_str(&block[value_end..]);
    Some(next)
}

/// 描述：解析 Node 项目直接依赖版本快照（dependencies/devDependencies/peerDependencies/optionalDependencies）。
fn read_node_dependency_snapshots(
    project_root: &Path,
) -> Result<HashMap<String, DependencyVersionSnapshot>, String> {
    let package_json_path = project_root.join("package.json");
    if !package_json_path.exists() {
        return Ok(HashMap::new());
    }
    let text = fs::read_to_string(&package_json_path)
        .map_err(|err| format!("读取 package.json 失败: {}", err))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|err| format!("解析 package.json 失败: {}", err))?;

    let mut snapshots: HashMap<String, DependencyVersionSnapshot> = HashMap::new();
    let sections = [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ];
    for section in sections {
        let Some(section_value) = parsed.get(section) else {
            continue;
        };
        let Some(dep_map) = section_value.as_object() else {
            continue;
        };
        for (name, version_value) in dep_map {
            let Some(version) = version_value.as_str() else {
                continue;
            };
            let normalized_version = version.trim().to_string();
            if normalized_version.is_empty() {
                continue;
            }
            if snapshots.contains_key(name) {
                continue;
            }
            snapshots.insert(
                name.to_string(),
                DependencyVersionSnapshot {
                    version: normalized_version,
                    source_file: "package.json".to_string(),
                },
            );
        }
    }
    Ok(snapshots)
}

/// 描述：解析 go.mod 单行 require 语句。
fn parse_go_require_line(line: &str) -> Option<(String, String)> {
    let without_comment = line.split("//").next()?.trim();
    if without_comment.is_empty() || without_comment.contains("=>") {
        return None;
    }
    let parts: Vec<&str> = without_comment.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let module = parts[0].trim();
    let version = parts[1].trim();
    if module.is_empty() || version.is_empty() {
        return None;
    }
    Some((module.to_string(), version.to_string()))
}

/// 描述：解析 Go 项目直接依赖版本快照（go.mod require）。
fn read_go_dependency_snapshots(
    project_root: &Path,
) -> Result<HashMap<String, DependencyVersionSnapshot>, String> {
    let go_mod_path = project_root.join("go.mod");
    if !go_mod_path.exists() {
        return Ok(HashMap::new());
    }
    let text =
        fs::read_to_string(&go_mod_path).map_err(|err| format!("读取 go.mod 失败: {}", err))?;
    let mut snapshots: HashMap<String, DependencyVersionSnapshot> = HashMap::new();
    let mut in_require_block = false;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        if in_require_block {
            if line.starts_with(')') {
                in_require_block = false;
                continue;
            }
            if let Some((module, version)) = parse_go_require_line(line) {
                snapshots.insert(
                    module,
                    DependencyVersionSnapshot {
                        version,
                        source_file: "go.mod".to_string(),
                    },
                );
            }
            continue;
        }
        if line.starts_with("require (") {
            in_require_block = true;
            continue;
        }
        if let Some(rest) = line.strip_prefix("require ") {
            if let Some((module, version)) = parse_go_require_line(rest) {
                snapshots.insert(
                    module,
                    DependencyVersionSnapshot {
                        version,
                        source_file: "go.mod".to_string(),
                    },
                );
            }
        }
    }
    Ok(snapshots)
}

/// 描述：提取单行中被单双引号包裹的字符串（包含位置信息），用于 Gradle 坐标替换。
fn collect_line_quoted_segments(line: &str) -> Vec<(usize, usize, String)> {
    let mut segments: Vec<(usize, usize, String)> = Vec::new();
    let mut quote_char: Option<char> = None;
    let mut value_start = 0usize;
    for (idx, ch) in line.char_indices() {
        match quote_char {
            None => {
                if ch == '"' || ch == '\'' {
                    quote_char = Some(ch);
                    value_start = idx + ch.len_utf8();
                }
            }
            Some(current_quote) => {
                if ch == current_quote {
                    if idx >= value_start {
                        segments.push((value_start, idx, line[value_start..idx].to_string()));
                    }
                    quote_char = None;
                }
            }
        }
    }
    segments
}

/// 描述：解析 Maven pom.xml 依赖快照，键格式为 groupId:artifactId。
fn read_maven_dependency_snapshots(
    project_root: &Path,
) -> Result<HashMap<String, DependencyVersionSnapshot>, String> {
    let pom_path = project_root.join("pom.xml");
    if !pom_path.exists() {
        return Ok(HashMap::new());
    }
    let text =
        fs::read_to_string(&pom_path).map_err(|err| format!("读取 pom.xml 失败: {}", err))?;
    let mut snapshots: HashMap<String, DependencyVersionSnapshot> = HashMap::new();
    let mut cursor = 0usize;
    while let Some(start_rel) = text[cursor..].find("<dependency>") {
        let start = cursor + start_rel;
        let Some(end_rel) = text[start..].find("</dependency>") else {
            break;
        };
        let end = start + end_rel + "</dependency>".len();
        let block = &text[start..end];
        let group_id = extract_xml_tag_text(block, "groupId").unwrap_or_default();
        let artifact_id = extract_xml_tag_text(block, "artifactId").unwrap_or_default();
        let version = extract_xml_tag_text(block, "version").unwrap_or_default();
        if !group_id.is_empty() && !artifact_id.is_empty() && !version.is_empty() {
            let package_name = format!("{}:{}", group_id, artifact_id);
            snapshots
                .entry(package_name)
                .or_insert(DependencyVersionSnapshot {
                    version,
                    source_file: "pom.xml".to_string(),
                });
        }
        cursor = end;
    }
    Ok(snapshots)
}

/// 描述：解析 Gradle 文件依赖快照，支持 `group:artifact:version` 直接坐标声明。
fn read_gradle_dependency_snapshots_from_file(
    project_root: &Path,
    file_name: &str,
) -> Result<HashMap<String, DependencyVersionSnapshot>, String> {
    let gradle_path = project_root.join(file_name);
    if !gradle_path.exists() {
        return Ok(HashMap::new());
    }
    let text = fs::read_to_string(&gradle_path)
        .map_err(|err| format!("读取 {} 失败: {}", file_name, err))?;
    let mut snapshots: HashMap<String, DependencyVersionSnapshot> = HashMap::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        let segments = collect_line_quoted_segments(line);
        for (_, _, segment) in segments {
            let normalized = segment.trim();
            if normalized.is_empty() || normalized.contains("://") {
                continue;
            }
            let parts: Vec<&str> = normalized.split(':').collect();
            if parts.len() < 3 {
                continue;
            }
            let group = parts[0].trim();
            let artifact = parts[1].trim();
            let version = parts[2].trim();
            if group.is_empty() || artifact.is_empty() || version.is_empty() {
                continue;
            }
            let package_name = format!("{}:{}", group, artifact);
            snapshots
                .entry(package_name)
                .or_insert(DependencyVersionSnapshot {
                    version: version.to_string(),
                    source_file: file_name.to_string(),
                });
        }
    }
    Ok(snapshots)
}

/// 描述：合并读取 Java 项目依赖快照（pom.xml + build.gradle + build.gradle.kts）。
fn read_java_dependency_snapshots(
    project_root: &Path,
) -> Result<HashMap<String, DependencyVersionSnapshot>, String> {
    let mut snapshots = read_maven_dependency_snapshots(project_root)?;
    let gradle_groovy = read_gradle_dependency_snapshots_from_file(project_root, "build.gradle")?;
    for (name, snapshot) in gradle_groovy {
        snapshots.entry(name).or_insert(snapshot);
    }
    let gradle_kts = read_gradle_dependency_snapshots_from_file(project_root, "build.gradle.kts")?;
    for (name, snapshot) in gradle_kts {
        snapshots.entry(name).or_insert(snapshot);
    }
    Ok(snapshots)
}

/// 描述：按生态读取依赖快照映射，用于规则校验与升级计划构建。
fn read_dependency_snapshots_by_ecosystem(
    project_root: &Path,
    ecosystem: &DependencyEcosystem,
) -> Result<HashMap<String, DependencyVersionSnapshot>, String> {
    match ecosystem {
        DependencyEcosystem::Node => read_node_dependency_snapshots(project_root),
        DependencyEcosystem::Go => read_go_dependency_snapshots(project_root),
        DependencyEcosystem::Java => read_java_dependency_snapshots(project_root),
    }
}

/// 描述：执行依赖规则检查，输出规则命中结果与可升级项。
fn check_project_dependency_rules_inner(
    project_path: String,
    rules: Vec<String>,
) -> Result<ProjectDependencyRuleCheckResponse, String> {
    let project_root = PathBuf::from(project_path.trim());
    if !project_root.exists() || !project_root.is_dir() {
        return Err("项目路径不存在或不是目录".to_string());
    }

    let detected_ecosystems = detect_project_dependency_ecosystems(&project_root);
    let detected_set: HashSet<DependencyEcosystem> = detected_ecosystems.iter().cloned().collect();
    let mut snapshots_by_ecosystem: HashMap<
        DependencyEcosystem,
        HashMap<String, DependencyVersionSnapshot>,
    > = HashMap::new();
    for ecosystem in &detected_ecosystems {
        let snapshots = read_dependency_snapshots_by_ecosystem(&project_root, ecosystem)?;
        snapshots_by_ecosystem.insert(ecosystem.clone(), snapshots);
    }

    let mut items: Vec<DependencyRuleStatusItem> = Vec::new();
    for rule in rules {
        let parsed = match parse_dependency_rule(&rule) {
            Ok(value) => value,
            Err(detail) => {
                items.push(DependencyRuleStatusItem {
                    rule: rule.clone(),
                    ecosystem: "".to_string(),
                    package_name: "".to_string(),
                    expected_version: "".to_string(),
                    current_version: None,
                    status: "invalid".to_string(),
                    source_file: None,
                    detail: Some(detail),
                    upgradable: false,
                });
                continue;
            }
        };

        let target_ecosystem = parsed
            .ecosystem
            .clone()
            .unwrap_or_else(|| infer_dependency_rule_ecosystem(parsed.package_name.as_str()));
        if !detected_set.contains(&target_ecosystem) {
            items.push(DependencyRuleStatusItem {
                rule: parsed.raw.clone(),
                ecosystem: target_ecosystem.as_str().to_string(),
                package_name: parsed.package_name.clone(),
                expected_version: parsed.expected_version.clone(),
                current_version: None,
                status: "ecosystem_unavailable".to_string(),
                source_file: None,
                detail: Some("项目未检测到该生态清单文件".to_string()),
                upgradable: false,
            });
            continue;
        }

        let snapshots = snapshots_by_ecosystem
            .get(&target_ecosystem)
            .cloned()
            .unwrap_or_default();
        if let Some(current) = snapshots.get(parsed.package_name.as_str()) {
            if current.version.trim() == parsed.expected_version.trim() {
                items.push(DependencyRuleStatusItem {
                    rule: parsed.raw.clone(),
                    ecosystem: target_ecosystem.as_str().to_string(),
                    package_name: parsed.package_name.clone(),
                    expected_version: parsed.expected_version.clone(),
                    current_version: Some(current.version.clone()),
                    status: "aligned".to_string(),
                    source_file: Some(current.source_file.clone()),
                    detail: None,
                    upgradable: false,
                });
            } else {
                items.push(DependencyRuleStatusItem {
                    rule: parsed.raw.clone(),
                    ecosystem: target_ecosystem.as_str().to_string(),
                    package_name: parsed.package_name.clone(),
                    expected_version: parsed.expected_version.clone(),
                    current_version: Some(current.version.clone()),
                    status: "mismatch".to_string(),
                    source_file: Some(current.source_file.clone()),
                    detail: Some("版本不一致，可按规则升级".to_string()),
                    upgradable: true,
                });
            }
        } else {
            items.push(DependencyRuleStatusItem {
                rule: parsed.raw.clone(),
                ecosystem: target_ecosystem.as_str().to_string(),
                package_name: parsed.package_name.clone(),
                expected_version: parsed.expected_version.clone(),
                current_version: None,
                status: "missing".to_string(),
                source_file: None,
                detail: Some("项目中未使用该依赖".to_string()),
                upgradable: false,
            });
        }
    }

    let mismatches = items
        .iter()
        .filter(|item| item.status == "mismatch" && item.upgradable)
        .cloned()
        .collect::<Vec<_>>();

    Ok(ProjectDependencyRuleCheckResponse {
        project_path: project_root.to_string_lossy().to_string(),
        detected_ecosystems: detected_ecosystems
            .iter()
            .map(|item| item.as_str().to_string())
            .collect(),
        items,
        mismatches,
    })
}

/// 描述：检测 Node 项目包管理器类型，优先读取 packageManager 字段，回退 lockfile 识别。
fn detect_node_package_manager(project_root: &Path, package_json: &serde_json::Value) -> String {
    if let Some(package_manager) = package_json
        .get("packageManager")
        .and_then(|value| value.as_str())
    {
        let lower = package_manager.to_lowercase();
        if lower.starts_with("pnpm") {
            return "pnpm".to_string();
        }
        if lower.starts_with("yarn") {
            return "yarn".to_string();
        }
        if lower.starts_with("npm") {
            return "npm".to_string();
        }
    }
    if project_root.join("pnpm-lock.yaml").exists() {
        return "pnpm".to_string();
    }
    if project_root.join("yarn.lock").exists() {
        return "yarn".to_string();
    }
    if project_root.join("package-lock.json").exists() {
        return "npm".to_string();
    }
    "npm".to_string()
}

/// 描述：在指定目录执行命令并返回失败原因，统一用于依赖升级阶段的外部命令调用。
fn run_command_in_dir(project_root: &Path, bin: &str, args: &[String]) -> Result<(), String> {
    let output = Command::new(bin)
        .current_dir(project_root)
        .args(args)
        .output()
        .map_err(|err| format!("执行命令 `{}` 失败: {}", bin, err))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("退出码 {:?}", output.status.code())
    };
    Err(format!("命令 `{}` 执行失败: {}", bin, detail))
}

/// 描述：应用 Node 依赖升级：更新 package.json 中已存在依赖版本，并执行 install 刷新锁文件。
fn apply_node_dependency_rule_upgrades(
    project_root: &Path,
    rules: &[DependencyRuleStatusItem],
) -> Result<
    (
        Vec<DependencyRuleUpgradeResult>,
        Vec<DependencyRuleUpgradeResult>,
    ),
    String,
> {
    let package_json_path = project_root.join("package.json");
    let text = fs::read_to_string(&package_json_path)
        .map_err(|err| format!("读取 package.json 失败: {}", err))?;
    let mut parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|err| format!("解析 package.json 失败: {}", err))?;
    let sections = [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ];
    let mut updated: Vec<DependencyRuleUpgradeResult> = Vec::new();
    let mut skipped: Vec<DependencyRuleUpgradeResult> = Vec::new();
    let mut changed = false;

    for rule in rules {
        let mut hit = false;
        for section in sections {
            let Some(dep_map) = parsed
                .get_mut(section)
                .and_then(|value| value.as_object_mut())
            else {
                continue;
            };
            if let Some(current) = dep_map.get_mut(rule.package_name.as_str()) {
                hit = true;
                let current_text = current.as_str().unwrap_or("").trim().to_string();
                if current_text != rule.expected_version {
                    *current = serde_json::Value::String(rule.expected_version.clone());
                    changed = true;
                }
            }
        }
        if hit {
            updated.push(DependencyRuleUpgradeResult {
                ecosystem: "node".to_string(),
                package_name: rule.package_name.clone(),
                expected_version: rule.expected_version.clone(),
                status: "updated".to_string(),
                detail: None,
            });
        } else {
            skipped.push(DependencyRuleUpgradeResult {
                ecosystem: "node".to_string(),
                package_name: rule.package_name.clone(),
                expected_version: rule.expected_version.clone(),
                status: "skipped".to_string(),
                detail: Some("package.json 未找到该依赖".to_string()),
            });
        }
    }

    if changed {
        let serialized = serde_json::to_string_pretty(&parsed)
            .map_err(|err| format!("序列化 package.json 失败: {}", err))?;
        fs::write(&package_json_path, format!("{}\n", serialized))
            .map_err(|err| format!("写入 package.json 失败: {}", err))?;
        let package_manager = detect_node_package_manager(project_root, &parsed);
        let install_args = vec!["install".to_string()];
        run_command_in_dir(project_root, package_manager.as_str(), &install_args)?;
    }
    Ok((updated, skipped))
}

/// 描述：应用 Go 依赖升级：逐条执行 `go get module@version`，并在成功后执行 `go mod tidy`。
fn apply_go_dependency_rule_upgrades(
    project_root: &Path,
    rules: &[DependencyRuleStatusItem],
) -> (
    Vec<DependencyRuleUpgradeResult>,
    Vec<DependencyRuleUpgradeResult>,
) {
    let mut updated: Vec<DependencyRuleUpgradeResult> = Vec::new();
    let mut skipped: Vec<DependencyRuleUpgradeResult> = Vec::new();

    for rule in rules {
        let target = format!("{}@{}", rule.package_name, rule.expected_version);
        let args = vec!["get".to_string(), target];
        match run_command_in_dir(project_root, "go", &args) {
            Ok(_) => updated.push(DependencyRuleUpgradeResult {
                ecosystem: "go".to_string(),
                package_name: rule.package_name.clone(),
                expected_version: rule.expected_version.clone(),
                status: "updated".to_string(),
                detail: None,
            }),
            Err(detail) => skipped.push(DependencyRuleUpgradeResult {
                ecosystem: "go".to_string(),
                package_name: rule.package_name.clone(),
                expected_version: rule.expected_version.clone(),
                status: "skipped".to_string(),
                detail: Some(detail),
            }),
        }
    }

    if !updated.is_empty() {
        let tidy_args = vec!["mod".to_string(), "tidy".to_string()];
        if let Err(detail) = run_command_in_dir(project_root, "go", &tidy_args) {
            skipped.push(DependencyRuleUpgradeResult {
                ecosystem: "go".to_string(),
                package_name: "go.mod".to_string(),
                expected_version: "".to_string(),
                status: "skipped".to_string(),
                detail: Some(format!("go mod tidy 失败: {}", detail)),
            });
        }
    }

    (updated, skipped)
}

/// 描述：重写 pom.xml 依赖版本，仅更新 groupId/artifactId 命中的 dependency 块。
fn rewrite_pom_dependency_versions(
    content: &str,
    expected_map: &HashMap<String, String>,
) -> (String, HashSet<String>) {
    let mut rewritten = String::new();
    let mut cursor = 0usize;
    let mut updated_packages: HashSet<String> = HashSet::new();

    while let Some(start_rel) = content[cursor..].find("<dependency>") {
        let start = cursor + start_rel;
        let Some(end_rel) = content[start..].find("</dependency>") else {
            break;
        };
        let end = start + end_rel + "</dependency>".len();
        rewritten.push_str(&content[cursor..start]);
        let block = &content[start..end];
        let group_id = extract_xml_tag_text(block, "groupId").unwrap_or_default();
        let artifact_id = extract_xml_tag_text(block, "artifactId").unwrap_or_default();
        let package_name = if group_id.is_empty() || artifact_id.is_empty() {
            "".to_string()
        } else {
            format!("{}:{}", group_id, artifact_id)
        };
        if let Some(expected_version) = expected_map.get(package_name.as_str()) {
            let current_version = extract_xml_tag_text(block, "version").unwrap_or_default();
            if !current_version.is_empty() && current_version != *expected_version {
                if let Some(next_block) = replace_xml_tag_text(block, "version", expected_version) {
                    rewritten.push_str(next_block.as_str());
                    updated_packages.insert(package_name);
                } else {
                    rewritten.push_str(block);
                }
            } else {
                rewritten.push_str(block);
            }
        } else {
            rewritten.push_str(block);
        }
        cursor = end;
    }
    rewritten.push_str(&content[cursor..]);
    (rewritten, updated_packages)
}

/// 描述：重写 Gradle 依赖版本，支持单双引号坐标 `group:artifact:version`。
fn rewrite_gradle_dependency_versions(
    content: &str,
    expected_map: &HashMap<String, String>,
) -> (String, HashSet<String>) {
    let mut updated_packages: HashSet<String> = HashSet::new();
    let mut next_lines: Vec<String> = Vec::new();

    for raw_line in content.lines() {
        let mut line = raw_line.to_string();
        let mut segments = collect_line_quoted_segments(line.as_str());
        segments.reverse();
        for (start, end, segment) in segments {
            let normalized = segment.trim();
            if normalized.is_empty() || normalized.contains("://") {
                continue;
            }
            let parts: Vec<&str> = normalized.split(':').collect();
            if parts.len() < 3 {
                continue;
            }
            let group = parts[0].trim();
            let artifact = parts[1].trim();
            if group.is_empty() || artifact.is_empty() {
                continue;
            }
            let package_name = format!("{}:{}", group, artifact);
            let Some(expected_version) = expected_map.get(package_name.as_str()) else {
                continue;
            };
            let remain = if parts.len() > 3 {
                format!(":{}", parts[3..].join(":"))
            } else {
                String::new()
            };
            let replacement = format!("{}:{}:{}{}", group, artifact, expected_version, remain);
            if start <= end && end <= line.len() {
                line.replace_range(start..end, replacement.as_str());
                updated_packages.insert(package_name);
            }
        }
        next_lines.push(line);
    }

    let mut next_content = next_lines.join("\n");
    if content.ends_with('\n') {
        next_content.push('\n');
    }
    (next_content, updated_packages)
}

/// 描述：应用 Java 依赖升级，覆盖 pom.xml 与 build.gradle/build.gradle.kts 可识别坐标版本。
fn apply_java_dependency_rule_upgrades(
    project_root: &Path,
    rules: &[DependencyRuleStatusItem],
) -> Result<
    (
        Vec<DependencyRuleUpgradeResult>,
        Vec<DependencyRuleUpgradeResult>,
    ),
    String,
> {
    let mut expected_map: HashMap<String, String> = HashMap::new();
    for rule in rules {
        expected_map.insert(rule.package_name.clone(), rule.expected_version.clone());
    }
    let mut updated_packages: HashSet<String> = HashSet::new();

    let pom_path = project_root.join("pom.xml");
    if pom_path.exists() {
        let content =
            fs::read_to_string(&pom_path).map_err(|err| format!("读取 pom.xml 失败: {}", err))?;
        let (next_content, updated) =
            rewrite_pom_dependency_versions(content.as_str(), &expected_map);
        if next_content != content {
            fs::write(&pom_path, next_content)
                .map_err(|err| format!("写入 pom.xml 失败: {}", err))?;
        }
        updated_packages.extend(updated);
    }

    for file_name in ["build.gradle", "build.gradle.kts"] {
        let gradle_path = project_root.join(file_name);
        if !gradle_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&gradle_path)
            .map_err(|err| format!("读取 {} 失败: {}", file_name, err))?;
        let (next_content, updated) =
            rewrite_gradle_dependency_versions(content.as_str(), &expected_map);
        if next_content != content {
            fs::write(&gradle_path, next_content)
                .map_err(|err| format!("写入 {} 失败: {}", file_name, err))?;
        }
        updated_packages.extend(updated);
    }

    let mut updated: Vec<DependencyRuleUpgradeResult> = Vec::new();
    let mut skipped: Vec<DependencyRuleUpgradeResult> = Vec::new();
    for rule in rules {
        if updated_packages.contains(rule.package_name.as_str()) {
            updated.push(DependencyRuleUpgradeResult {
                ecosystem: "java".to_string(),
                package_name: rule.package_name.clone(),
                expected_version: rule.expected_version.clone(),
                status: "updated".to_string(),
                detail: None,
            });
        } else {
            skipped.push(DependencyRuleUpgradeResult {
                ecosystem: "java".to_string(),
                package_name: rule.package_name.clone(),
                expected_version: rule.expected_version.clone(),
                status: "skipped".to_string(),
                detail: Some("未在 pom.xml/build.gradle 中命中可升级坐标".to_string()),
            });
        }
    }

    Ok((updated, skipped))
}

/// 描述：执行规则命中依赖的一键升级，升级后返回更新与跳过明细。
fn apply_project_dependency_rule_upgrades_inner(
    project_path: String,
    rules: Vec<String>,
) -> Result<ProjectDependencyRuleUpgradeResponse, String> {
    let check = check_project_dependency_rules_inner(project_path.clone(), rules.clone())?;
    let project_root = PathBuf::from(check.project_path.clone());

    let mut node_rules: Vec<DependencyRuleStatusItem> = Vec::new();
    let mut go_rules: Vec<DependencyRuleStatusItem> = Vec::new();
    let mut java_rules: Vec<DependencyRuleStatusItem> = Vec::new();
    for item in &check.mismatches {
        match item.ecosystem.as_str() {
            "node" => node_rules.push(item.clone()),
            "go" => go_rules.push(item.clone()),
            "java" => java_rules.push(item.clone()),
            _ => {}
        }
    }

    let mut updated: Vec<DependencyRuleUpgradeResult> = Vec::new();
    let mut skipped: Vec<DependencyRuleUpgradeResult> = Vec::new();

    if !node_rules.is_empty() {
        let (node_updated, node_skipped) =
            apply_node_dependency_rule_upgrades(&project_root, &node_rules)?;
        updated.extend(node_updated);
        skipped.extend(node_skipped);
    }
    if !go_rules.is_empty() {
        let (go_updated, go_skipped) = apply_go_dependency_rule_upgrades(&project_root, &go_rules);
        updated.extend(go_updated);
        skipped.extend(go_skipped);
    }
    if !java_rules.is_empty() {
        let (java_updated, java_skipped) =
            apply_java_dependency_rule_upgrades(&project_root, &java_rules)?;
        updated.extend(java_updated);
        skipped.extend(java_skipped);
    }

    Ok(ProjectDependencyRuleUpgradeResponse {
        project_path: project_root.to_string_lossy().to_string(),
        updated,
        skipped,
    })
}

#[tauri::command]
async fn check_project_dependency_rules(
    project_path: String,
    rules: Vec<String>,
) -> Result<ProjectDependencyRuleCheckResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_project_dependency_rules_inner(project_path, rules)
    })
    .await
    .map_err(|err| format!("检查依赖规则任务异常: {}", err))?
}

#[tauri::command]
async fn apply_project_dependency_rule_upgrades(
    project_path: String,
    rules: Vec<String>,
) -> Result<ProjectDependencyRuleUpgradeResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_project_dependency_rule_upgrades_inner(project_path, rules)
    })
    .await
    .map_err(|err| format!("升级依赖规则任务异常: {}", err))?
}

#[tauri::command]
async fn inspect_code_workspace_profile_seed(
    project_path: String,
) -> Result<CodeWorkspaceProfileSeedResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        inspect_code_workspace_profile_seed_inner(project_path)
    })
    .await
    .map_err(|err| format!("项目结构化初始化分析任务异常: {}", err))?
}

#[tauri::command]
async fn check_codex_cli_health(minimum_version: Option<String>) -> CodexCliHealthResponse {
    tauri::async_runtime::spawn_blocking(move || check_codex_cli_health_inner(minimum_version))
        .await
        .unwrap_or_else(|err| CodexCliHealthResponse {
            available: false,
            outdated: true,
            version: "".to_string(),
            minimum_version: "0.91.0".to_string(),
            bin_path: "".to_string(),
            message: format!("check codex health task join failed: {}", err),
        })
}

#[tauri::command]
async fn check_gemini_cli_health(minimum_version: Option<String>) -> GeminiCliHealthResponse {
    tauri::async_runtime::spawn_blocking(move || check_gemini_cli_health_inner(minimum_version))
        .await
        .unwrap_or_else(|err| GeminiCliHealthResponse {
            available: false,
            outdated: true,
            version: "".to_string(),
            minimum_version: "0.0.0".to_string(),
            bin_path: "".to_string(),
            message: format!("check gemini health task join failed: {}", err),
        })
}

/// 描述：执行 Codex CLI 健康检查，包含命令行探测与版本比较逻辑。
fn check_codex_cli_health_inner(minimum_version: Option<String>) -> CodexCliHealthResponse {
    let minimum_version = minimum_version
        .or_else(|| env::var("ZODILEAP_CODEX_MIN_VERSION").ok())
        .unwrap_or_else(|| "0.91.0".to_string());

    for bin in resolve_codex_bins() {
        if let Some(version) = read_codex_version(&bin) {
            let outdated = is_lower_semver(&version, &minimum_version).unwrap_or(false);
            let message = if outdated {
                format!(
                    "Codex CLI 版本过低：{}，最低要求 {}。请更新后再使用。",
                    version, minimum_version
                )
            } else {
                format!("Codex CLI 可用：{} ({})", version, bin)
            };
            return CodexCliHealthResponse {
                available: true,
                outdated,
                version,
                minimum_version,
                bin_path: bin,
                message,
            };
        }
    }

    CodexCliHealthResponse {
        available: false,
        outdated: true,
        version: "".to_string(),
        minimum_version,
        bin_path: "".to_string(),
        message: "未检测到可用的 Codex CLI，请先安装或配置 ZODILEAP_CODEX_BIN".to_string(),
    }
}

/// 描述：执行 Gemini CLI 健康检查，包含命令行探测与版本比较逻辑。
fn check_gemini_cli_health_inner(minimum_version: Option<String>) -> GeminiCliHealthResponse {
    let minimum_version = minimum_version
        .or_else(|| env::var("ZODILEAP_GEMINI_MIN_VERSION").ok())
        .unwrap_or_else(|| "0.0.0".to_string());

    for bin in resolve_gemini_bins() {
        if let Some(version) = read_gemini_version(&bin) {
            let outdated = is_lower_semver(&version, &minimum_version).unwrap_or(false);
            let message = if outdated {
                format!(
                    "Gemini CLI 版本过低：{}，最低要求 {}。请更新后再使用。",
                    version, minimum_version
                )
            } else {
                format!("Gemini CLI 可用：{} ({})", version, bin)
            };
            return GeminiCliHealthResponse {
                available: true,
                outdated,
                version,
                minimum_version,
                bin_path: bin,
                message,
            };
        }
    }

    GeminiCliHealthResponse {
        available: false,
        outdated: true,
        version: "".to_string(),
        minimum_version,
        bin_path: "".to_string(),
        message: "未检测到可用的 Gemini CLI，请先安装或配置 ZODILEAP_GEMINI_BIN".to_string(),
    }
}

#[tauri::command]
async fn check_git_cli_health() -> GitCliHealthResponse {
    tauri::async_runtime::spawn_blocking(check_git_cli_health_inner)
        .await
        .unwrap_or_else(|err| GitCliHealthResponse {
            available: false,
            version: "".to_string(),
            bin_path: "".to_string(),
            message: format!("check git health task join failed: {}", err),
        })
}

#[tauri::command]
async fn check_python_cli_health() -> PythonCliHealthResponse {
    tauri::async_runtime::spawn_blocking(check_python_cli_health_inner)
        .await
        .unwrap_or_else(|err| PythonCliHealthResponse {
            available: false,
            version: "".to_string(),
            bin_path: "".to_string(),
            message: format!("check python health task join failed: {}", err),
        })
}

#[tauri::command]
async fn check_apifox_mcp_runtime_status(app: tauri::AppHandle) -> ApifoxMcpRuntimeStatusResponse {
    tauri::async_runtime::spawn_blocking(move || check_apifox_mcp_runtime_status_inner(app))
        .await
        .unwrap_or_else(|err| ApifoxMcpRuntimeStatusResponse {
            installed: false,
            version: "".to_string(),
            npm_bin: "".to_string(),
            runtime_dir: "".to_string(),
            entry_path: "".to_string(),
            message: format!("check apifox mcp runtime status task join failed: {}", err),
        })
}

#[tauri::command]
async fn install_apifox_mcp_runtime(
    app: tauri::AppHandle,
) -> Result<ApifoxMcpRuntimeStatusResponse, String> {
    tauri::async_runtime::spawn_blocking(move || install_apifox_mcp_runtime_inner(app))
        .await
        .map_err(|err| format!("install apifox mcp runtime task join failed: {}", err))?
}

#[tauri::command]
async fn uninstall_apifox_mcp_runtime(
    app: tauri::AppHandle,
) -> Result<ApifoxMcpRuntimeStatusResponse, String> {
    tauri::async_runtime::spawn_blocking(move || uninstall_apifox_mcp_runtime_inner(app))
        .await
        .map_err(|err| format!("uninstall apifox mcp runtime task join failed: {}", err))?
}

/// 描述：执行 Git CLI 健康检查，返回可用性、版本与命中路径。
fn check_git_cli_health_inner() -> GitCliHealthResponse {
    if let Some((bin, version)) = detect_available_git() {
        return GitCliHealthResponse {
            available: true,
            version: version.clone(),
            bin_path: bin.clone(),
            message: format!("Git 可用：{} ({})", version, bin),
        };
    }

    GitCliHealthResponse {
        available: false,
        version: "".to_string(),
        bin_path: "".to_string(),
        message: "未检测到可用的 Git，请先安装 Git。".to_string(),
    }
}

/// 描述：执行 Python CLI 健康检查，确保脚本沙盒可用。
fn check_python_cli_health_inner() -> PythonCliHealthResponse {
    if let Some((bin, version)) = detect_available_python() {
        return PythonCliHealthResponse {
            available: true,
            version: version.clone(),
            bin_path: bin.clone(),
            message: format!("Python 可用：{} ({})", version, bin),
        };
    }

    PythonCliHealthResponse {
        available: false,
        version: "".to_string(),
        bin_path: "".to_string(),
        message: "未检测到可用的 Python，请先安装 Python3 或设置 ZODILEAP_PYTHON_BIN。".to_string(),
    }
}

#[tauri::command]
async fn pick_local_project_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = rfd::FileDialog::new().pick_folder();
        Ok(selected.map(|path| path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|err| format!("pick local project folder task join failed: {}", err))?
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || open_external_url_inner(url.as_str()))
        .await
        .map_err(|err| format!("open external url task join failed: {}", err))?
}

/// 描述：打开外部网址，当前仅允许 http/https 协议。
fn open_external_url_inner(url: &str) -> Result<bool, String> {
    let normalized = url.trim();
    if !(normalized.starts_with("https://") || normalized.starts_with("http://")) {
        return Err("仅支持打开 http/https 外链".to_string());
    }

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(normalized).status();

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd")
        .args(["/C", "start", "", normalized])
        .status();

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let status = Command::new("xdg-open").arg(normalized).status();

    let status = status.map_err(|err| format!("open external url failed: {}", err))?;
    if !status.success() {
        return Err(format!(
            "open external url returned non-zero code: {:?}",
            status.code()
        ));
    }
    Ok(true)
}

#[tauri::command]
async fn clone_git_repository(
    app: tauri::AppHandle,
    repo_url: String,
) -> Result<GitCloneResponse, String> {
    tauri::async_runtime::spawn_blocking(move || clone_git_repository_inner(app, repo_url))
        .await
        .map_err(|err| format!("clone git repository task join failed: {}", err))?
}

/// 描述：将远端 Git 仓库克隆到应用数据目录下，并返回本地项目路径。
fn clone_git_repository_inner(
    app: tauri::AppHandle,
    repo_url: String,
) -> Result<GitCloneResponse, String> {
    let normalized_url = repo_url.trim().to_string();
    if normalized_url.is_empty() {
        return Err("仓库地址不能为空".to_string());
    }
    if !normalized_url.contains('/') {
        return Err("仓库地址格式不正确，请输入完整 URL".to_string());
    }

    let (git_bin, _) =
        detect_available_git().ok_or_else(|| "未检测到可用的 Git，请先安装 Git".to_string())?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位应用数据目录: {}", err))?;
    let workspace_root = app_data_dir.join("code_workspace_repos");
    fs::create_dir_all(&workspace_root)
        .map_err(|err| format!("create code workspace root failed: {}", err))?;

    let project_name = infer_repo_name_from_url(normalized_url.as_str());
    let mut destination = workspace_root.join(project_name.as_str());
    let mut suffix: u32 = 2;
    while destination.exists() {
        destination = workspace_root.join(format!("{}-{}", project_name, suffix));
        suffix += 1;
    }

    let output = Command::new(git_bin.as_str())
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg(normalized_url.as_str())
        .arg(destination.as_os_str())
        .output()
        .map_err(|err| format!("run git clone failed: {}", err))?;
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "git clone 失败（code={:?}）：{} {}",
            output.status.code(),
            stdout.trim(),
            stderr.trim()
        ));
    }

    Ok(GitCloneResponse {
        path: destination.to_string_lossy().to_string(),
        name: destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(project_name.as_str())
            .to_string(),
        message: format!("已克隆仓库到 {}", destination.to_string_lossy()),
    })
}

/// 描述：解析 Apifox 官方 MCP Runtime 根目录，固定在应用数据目录下，避免污染系统全局环境。
fn resolve_apifox_mcp_runtime_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位应用数据目录: {}", err))?;
    Ok(app_data_dir
        .join("mcp_runtime")
        .join("apifox_official"))
}

/// 描述：返回 Apifox MCP 可执行入口路径（跨平台）。
fn resolve_apifox_mcp_entry_path(runtime_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return runtime_root
            .join("node_modules")
            .join(".bin")
            .join("apifox-mcp-server.cmd");
    }
    #[cfg(not(target_os = "windows"))]
    {
        return runtime_root
            .join("node_modules")
            .join(".bin")
            .join("apifox-mcp-server");
    }
}

/// 描述：确保 Runtime 根目录中的 package.json 存在，便于 npm 安装到应用私有目录。
fn ensure_apifox_runtime_package_json(runtime_root: &Path) -> Result<(), String> {
    fs::create_dir_all(runtime_root)
        .map_err(|err| format!("创建 Apifox MCP runtime 目录失败: {}", err))?;
    let package_json_path = runtime_root.join("package.json");
    if package_json_path.exists() {
        return Ok(());
    }
    let package_json = json!({
        "name": "zodileap-desktop-apifox-mcp-runtime",
        "private": true,
        "version": "0.0.0"
    });
    let content = serde_json::to_string_pretty(&package_json)
        .map_err(|err| format!("构建 Apifox MCP package.json 失败: {}", err))?;
    fs::write(&package_json_path, format!("{}\n", content))
        .map_err(|err| format!("写入 Apifox MCP package.json 失败: {}", err))?;
    Ok(())
}

/// 描述：读取本地安装的 Apifox MCP 版本，未命中时返回空字符串。
fn read_apifox_runtime_version(runtime_root: &Path) -> String {
    let package_json_path = runtime_root
        .join("node_modules")
        .join(APIFOX_MCP_PACKAGE_NAME)
        .join("package.json");
    let raw = match fs::read_to_string(&package_json_path) {
        Ok(content) => content,
        Err(_) => return "".to_string(),
    };
    let parsed = match serde_json::from_str::<serde_json::Value>(raw.as_str()) {
        Ok(value) => value,
        Err(_) => return "".to_string(),
    };
    parsed
        .get("version")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

/// 描述：构建 Apifox MCP Runtime 状态响应，统一前端“是否真实安装”的判定口径。
fn build_apifox_mcp_runtime_status_response(
    runtime_root: &Path,
    npm_bin: String,
) -> ApifoxMcpRuntimeStatusResponse {
    let entry_path = resolve_apifox_mcp_entry_path(runtime_root);
    let installed = entry_path.exists();
    let version = read_apifox_runtime_version(runtime_root);
    let message = if installed {
        let version_text = if version.is_empty() {
            "unknown".to_string()
        } else {
            version.clone()
        };
        format!(
            "Apifox 官方 MCP 已安装（version={}，目录={}）。",
            version_text,
            runtime_root.to_string_lossy()
        )
    } else {
        format!(
            "Apifox 官方 MCP 未安装（目录={}）。",
            runtime_root.to_string_lossy()
        )
    };
    ApifoxMcpRuntimeStatusResponse {
        installed,
        version,
        npm_bin,
        runtime_dir: runtime_root.to_string_lossy().to_string(),
        entry_path: entry_path.to_string_lossy().to_string(),
        message,
    }
}

/// 描述：读取 Apifox MCP Runtime 当前状态，不执行安装动作。
fn check_apifox_mcp_runtime_status_inner(app: tauri::AppHandle) -> ApifoxMcpRuntimeStatusResponse {
    let npm_bin = detect_available_npm()
        .map(|(bin, _)| bin)
        .unwrap_or_default();
    match resolve_apifox_mcp_runtime_root(&app) {
        Ok(runtime_root) => build_apifox_mcp_runtime_status_response(&runtime_root, npm_bin),
        Err(err) => ApifoxMcpRuntimeStatusResponse {
            installed: false,
            version: "".to_string(),
            npm_bin,
            runtime_dir: "".to_string(),
            entry_path: "".to_string(),
            message: err,
        },
    }
}

/// 描述：将 Apifox 官方 MCP 安装到应用私有目录，避免写入用户全局 Node 环境。
fn install_apifox_mcp_runtime_inner(
    app: tauri::AppHandle,
) -> Result<ApifoxMcpRuntimeStatusResponse, String> {
    let (npm_bin, _) = detect_available_npm()
        .ok_or_else(|| "未检测到可用的 npm，请先安装 Node.js（建议 LTS 版本）。".to_string())?;
    let runtime_root = resolve_apifox_mcp_runtime_root(&app)?;
    ensure_apifox_runtime_package_json(&runtime_root)?;
    let output = Command::new(npm_bin.as_str())
        .arg("install")
        .arg(format!("{}@{}", APIFOX_MCP_PACKAGE_NAME, APIFOX_MCP_PACKAGE_VERSION))
        .arg("--no-fund")
        .arg("--no-audit")
        .arg("--prefix")
        .arg(runtime_root.as_os_str())
        .output()
        .map_err(|err| format!("执行 npm install 失败: {}", err))?;
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "安装 Apifox 官方 MCP 失败（code={:?}）：{} {}",
            output.status.code(),
            stdout.trim(),
            stderr.trim()
        ));
    }
    let status = build_apifox_mcp_runtime_status_response(&runtime_root, npm_bin);
    if !status.installed {
        return Err("安装完成但未检测到 Apifox MCP 可执行入口，请检查 npm 输出日志。".to_string());
    }
    Ok(status)
}

/// 描述：卸载应用私有目录下的 Apifox MCP Runtime。
fn uninstall_apifox_mcp_runtime_inner(
    app: tauri::AppHandle,
) -> Result<ApifoxMcpRuntimeStatusResponse, String> {
    let npm_bin = detect_available_npm()
        .map(|(bin, _)| bin)
        .unwrap_or_default();
    let runtime_root = resolve_apifox_mcp_runtime_root(&app)?;
    if runtime_root.exists() {
        fs::remove_dir_all(&runtime_root)
            .map_err(|err| format!("删除 Apifox MCP runtime 目录失败: {}", err))?;
    }
    Ok(build_apifox_mcp_runtime_status_response(&runtime_root, npm_bin))
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

/// 描述：将文本错误拆分为协议错误码和消息，优先复用上游返回的 `code: message` 格式。
fn split_error_code_and_message(raw: &str, fallback_code: &str) -> (String, String) {
    let normalized = raw.trim();
    if let Some((left, right)) = normalized.split_once(": ") {
        let code_like = left
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '.' || ch == '_');
        if code_like && left.contains('.') && !right.trim().is_empty() {
            return (left.to_string(), right.trim().to_string());
        }
    }
    (fallback_code.to_string(), normalized.to_string())
}

/// 描述：按错误码与错误文本做高频失败原因分类，便于统一用户提示与 trace 归因。
fn classify_model_error_category(code: &str, message: &str) -> &'static str {
    let lower_code = code.to_lowercase();
    let lower_message = message.to_lowercase();
    if lower_code.contains("bridge")
        || lower_message.contains("bridge")
        || lower_message.contains("connection refused")
        || lower_message.contains("cannot connect blender")
    {
        return "bridge";
    }
    if lower_message.contains("permission denied")
        || lower_message.contains("operation not permitted")
        || lower_message.contains("access denied")
        || lower_message.contains("read-only")
        || lower_message.contains("readonly")
    {
        return "permission";
    }
    if lower_message.contains("unsupported action")
        || lower_message.contains("not supported")
        || lower_message.contains("version")
        || lower_code.contains("version")
    {
        return "version_compat";
    }
    if lower_message.contains("no_target_object")
        || lower_message.contains("no selected mesh objects")
        || lower_message.contains("no active mesh object")
        || lower_message.contains("object_not_found")
        || lower_message.contains("selection")
        || lower_message.contains("undo_unavailable")
        || lower_message.contains("redo_unavailable")
    {
        return "scene_state";
    }
    if lower_code.contains("invalid")
        || lower_code.contains("missing")
        || lower_code.contains("out_of_range")
        || lower_message.contains("invalid")
        || lower_message.contains("requires")
        || lower_message.contains("must be")
        || lower_message.contains("缺少")
        || lower_message.contains("不能为空")
    {
        return "parameter";
    }
    "unknown"
}

/// 描述：根据分类结果构建用户友好错误文案，避免直接暴露底层技术细节。
fn build_user_friendly_model_error(
    category: &str,
    default_retryable: bool,
) -> (String, Option<String>, bool) {
    match category {
        "bridge" => (
            "无法连接 Blender 会话桥接服务。".to_string(),
            Some(
                "请确认 Blender 已启动，并在插件中启用 `Zodileap MCP Bridge` 后重试。".to_string(),
            ),
            true,
        ),
        "parameter" => (
            "本次操作参数无效或不完整。".to_string(),
            Some("请检查路径、对象名与参数范围后重试。".to_string()),
            false,
        ),
        "scene_state" => (
            "当前场景状态不满足执行条件。".to_string(),
            Some("请先选择可编辑对象，并确认目标对象存在且可操作后重试。".to_string()),
            true,
        ),
        "permission" => (
            "当前环境权限不足，无法完成操作。".to_string(),
            Some("请检查文件/目录权限，或更换有权限的路径后重试。".to_string()),
            false,
        ),
        "version_compat" => (
            "当前 Blender/Bridge 版本与该操作不兼容。".to_string(),
            Some("请升级到受支持版本并重启 Blender 后重试。".to_string()),
            false,
        ),
        _ => (
            "操作执行失败，请检查当前步骤配置后重试。".to_string(),
            None,
            default_retryable,
        ),
    }
}

/// 描述：将文本错误转换为协议错误对象，便于步骤记录和前端展示共用。
fn protocol_error_from_text(raw: &str, fallback_code: &str, retryable: bool) -> ProtocolError {
    let (code, message) = split_error_code_and_message(raw, fallback_code);
    let category = classify_model_error_category(code.as_str(), message.as_str());
    let (friendly_message, suggestion, friendly_retryable) =
        build_user_friendly_model_error(category, retryable);
    let mut error = ProtocolError::new(code, friendly_message).with_retryable(friendly_retryable);
    if let Some(hint) = suggestion {
        error = error.with_suggestion(hint);
    }
    error
}

/// 描述：将文本错误转换为桌面端命令错误，用于 Tauri invoke 结构化回传。
fn desktop_error_from_text(
    raw: &str,
    fallback_code: &str,
    retryable: bool,
) -> DesktopProtocolError {
    let protocol_error = protocol_error_from_text(raw, fallback_code, retryable);
    DesktopProtocolError::from(protocol_error)
}

/// 描述：根据协议错误生成桌面端 UI Hint，统一重试、配置修复等动作建议。
fn build_ui_hint_from_protocol_error(error: &ProtocolError) -> Option<ProtocolUiHint> {
    let lower_code = error.code.to_lowercase();
    let lower_message = error.message.to_lowercase();
    let lower_suggestion = error.suggestion.as_deref().unwrap_or("").to_lowercase();

    if lower_code.contains("selection_required")
        || lower_suggestion.contains("选择可编辑对象")
        || lower_suggestion.contains("选中目标对象")
        || lower_message.contains("场景状态不满足执行条件")
        || lower_message.contains("scene state")
        || lower_message.contains("no_target_object")
        || lower_message.contains("no selected mesh objects")
        || lower_message.contains("no active mesh object")
    {
        return Some(ProtocolUiHint {
            key: "selection-required".to_string(),
            level: ProtocolUiHintLevel::Warning,
            title: "需要先选择对象".to_string(),
            message: error.suggestion.clone().unwrap_or_else(|| {
                "当前未检测到可操作对象。请先在 Blender 中选中目标对象后再重试。".to_string()
            }),
            actions: vec![
                ProtocolUiHintAction {
                    key: "retry_last_step".to_string(),
                    label: "我已选择，重试".to_string(),
                    intent: ProtocolUiHintActionIntent::Primary,
                },
                ProtocolUiHintAction {
                    key: "dismiss".to_string(),
                    label: "暂不处理".to_string(),
                    intent: ProtocolUiHintActionIntent::Default,
                },
            ],
            context: None,
        });
    }

    if lower_code.contains("invalid_bridge_addr")
        || lower_code.contains("bridge_connect_failed")
        || (lower_code.contains("bridge") && !lower_suggestion.contains("选择可编辑对象"))
        || lower_message.contains("blender")
    {
        return Some(ProtocolUiHint {
            key: "restart-blender-bridge".to_string(),
            level: ProtocolUiHintLevel::Warning,
            title: "需要检查 Blender Bridge".to_string(),
            message: error.suggestion.clone().unwrap_or_else(|| {
                "请确认 Blender 已启动且 MCP Bridge 插件已启用，然后重试。".to_string()
            }),
            actions: vec![
                ProtocolUiHintAction {
                    key: "retry_last_step".to_string(),
                    label: "我已修复并重试".to_string(),
                    intent: ProtocolUiHintActionIntent::Primary,
                },
                ProtocolUiHintAction {
                    key: "dismiss".to_string(),
                    label: "暂不处理".to_string(),
                    intent: ProtocolUiHintActionIntent::Default,
                },
            ],
            context: None,
        });
    }

    if lower_message.contains("参数无效")
        || lower_message.contains("参数")
        || lower_suggestion.contains("参数范围")
    {
        return Some(ProtocolUiHint {
            key: "check-params".to_string(),
            level: ProtocolUiHintLevel::Warning,
            title: "请检查参数".to_string(),
            message: error
                .suggestion
                .clone()
                .unwrap_or_else(|| "请检查路径、对象名与参数范围后重试。".to_string()),
            actions: vec![
                ProtocolUiHintAction {
                    key: "retry_last_step".to_string(),
                    label: "我已修正，重试".to_string(),
                    intent: ProtocolUiHintActionIntent::Primary,
                },
                ProtocolUiHintAction {
                    key: "dismiss".to_string(),
                    label: "暂不处理".to_string(),
                    intent: ProtocolUiHintActionIntent::Default,
                },
            ],
            context: None,
        });
    }

    if lower_message.contains("权限不足") || lower_suggestion.contains("权限") {
        return Some(ProtocolUiHint {
            key: "check-permission".to_string(),
            level: ProtocolUiHintLevel::Warning,
            title: "需要文件权限".to_string(),
            message: error
                .suggestion
                .clone()
                .unwrap_or_else(|| "请检查文件/目录权限，或更换有权限的路径后重试。".to_string()),
            actions: vec![
                ProtocolUiHintAction {
                    key: "retry_last_step".to_string(),
                    label: "我已处理，重试".to_string(),
                    intent: ProtocolUiHintActionIntent::Primary,
                },
                ProtocolUiHintAction {
                    key: "dismiss".to_string(),
                    label: "暂不处理".to_string(),
                    intent: ProtocolUiHintActionIntent::Default,
                },
            ],
            context: None,
        });
    }

    if lower_message.contains("版本")
        || lower_message.contains("不兼容")
        || lower_suggestion.contains("受支持版本")
    {
        return Some(ProtocolUiHint {
            key: "version-incompatible".to_string(),
            level: ProtocolUiHintLevel::Info,
            title: "版本兼容性检查".to_string(),
            message: error
                .suggestion
                .clone()
                .unwrap_or_else(|| "请升级到受支持版本并重启 Blender 后重试。".to_string()),
            actions: vec![ProtocolUiHintAction {
                key: "dismiss".to_string(),
                label: "知道了".to_string(),
                intent: ProtocolUiHintActionIntent::Default,
            }],
            context: None,
        });
    }

    if lower_message.contains("导出能力已关闭") || lower_code.contains("capability_disabled")
    {
        return Some(ProtocolUiHint {
            key: "export-capability-disabled".to_string(),
            level: ProtocolUiHintLevel::Info,
            title: "导出能力已关闭".to_string(),
            message: "当前会话仍可执行编辑操作；如需导出，请先在模型设置中开启导出能力。"
                .to_string(),
            actions: vec![
                ProtocolUiHintAction {
                    key: "open_model_settings".to_string(),
                    label: "打开模型设置".to_string(),
                    intent: ProtocolUiHintActionIntent::Primary,
                },
                ProtocolUiHintAction {
                    key: "dismiss".to_string(),
                    label: "知道了".to_string(),
                    intent: ProtocolUiHintActionIntent::Default,
                },
            ],
            context: None,
        });
    }

    None
}

fn normalize_output_dir_for_model(
    app: &tauri::AppHandle,
    output_dir: Option<String>,
) -> Result<PathBuf, String> {
    let current_dir =
        env::current_dir().map_err(|err| format!("read current dir failed: {}", err))?;
    let default_output_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|path| path.join("exports"))
        .unwrap_or_else(|| env::temp_dir().join("zodileap-agen").join("exports"));
    let candidate = output_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_output_dir);
    let mut selected = if candidate.is_absolute() {
        candidate
    } else {
        current_dir.join(candidate)
    };

    if cfg!(debug_assertions) && selected.starts_with(&current_dir) {
        selected = current_dir
            .parent()
            .map(|path| path.join("exports"))
            .unwrap_or_else(|| env::temp_dir().join("zodileap-agen").join("exports"));
    }
    fs::create_dir_all(&selected).map_err(|err| format!("create output dir failed: {}", err))?;
    Ok(selected)
}

fn capability_enabled(value: Option<bool>) -> bool {
    value.unwrap_or(true)
}

/// 描述：将桌面侧能力配置映射为 Core 复杂会话能力矩阵。
fn to_core_capability_matrix(capabilities: &ModelMcpCapabilities) -> ModelSessionCapabilityMatrix {
    ModelSessionCapabilityMatrix {
        export: capability_enabled(capabilities.export),
        scene: capability_enabled(capabilities.scene),
        transform: capability_enabled(capabilities.transform),
        geometry: capability_enabled(capabilities.geometry),
        mesh_opt: capability_enabled(capabilities.mesh_opt),
        material: capability_enabled(capabilities.material),
        file: capability_enabled(capabilities.file),
    }
}

/// 描述：根据当前能力开关列出允许的 MCP 动作，供 AI 规划约束。
fn planner_allowed_actions(capabilities: &ModelMcpCapabilities) -> Vec<&'static str> {
    let mut actions: Vec<&'static str> = Vec::new();
    if capability_enabled(capabilities.scene) {
        actions.extend([
            "list_objects",
            "select_objects",
            "rename_object",
            "organize_hierarchy",
        ]);
    }
    if capability_enabled(capabilities.transform) {
        actions.extend([
            "translate_objects",
            "rotate_objects",
            "scale_objects",
            "align_origin",
            "normalize_scale",
            "normalize_axis",
        ]);
    }
    if capability_enabled(capabilities.geometry) {
        actions.extend([
            "add_cube", "solidify", "bevel", "mirror", "array", "boolean",
        ]);
    }
    if capability_enabled(capabilities.mesh_opt) {
        actions.extend(["auto_smooth", "weighted_normal", "decimate"]);
    }
    if capability_enabled(capabilities.material) {
        actions.extend([
            "tidy_material_slots",
            "check_texture_paths",
            "apply_texture_image",
            "pack_textures",
        ]);
    }
    if capability_enabled(capabilities.file) {
        actions.extend(["new_file", "open_file", "save_file", "undo", "redo"]);
    }
    actions
}

/// 描述：构建“仅输出 JSON” 的模型步骤规划提示词，禁止规则兜底。
fn build_model_plan_prompt(prompt: &str, capabilities: &ModelMcpCapabilities) -> String {
    let allowed_actions = planner_allowed_actions(capabilities).join(", ");
    let export_enabled = capability_enabled(capabilities.export);
    let selection_few_shot = model_plan_selection_few_shot_examples();
    format!(
        r#"你是模型 MCP 规划器。请把用户自然语言转换为可执行步骤。

强约束：
1) 只能输出 JSON，不要 Markdown，不要解释文字。
2) JSON 格式必须是：
{{
  "steps": [
    {{
      "type": "tool" | "export",
      "action": "仅当 type=tool 时必填，且必须来自允许动作列表",
      "input": "步骤说明",
      "format": "仅当 type=export 时可填，支持 glb|fbx|obj，默认 glb",
      "params": {{ "导出时为导出参数对象；工具步骤为动作参数对象" }},
      "operation_kind": "basic|boolean_chain|modifier_chain|batch_transform|batch_material|scene_file_ops",
      "branch": "primary|fallback",
      "recoverable": true,
      "risk": "low|medium|high",
      "condition": null
    }}
  ],
  "reason": "可选：无法规划时说明原因"
}}
3) 如果无法规划，返回 {{"steps":[],"reason":"具体原因"}}。
4) 不允许臆造文件路径；用户给了路径就原样写入 params.path。
5) 本次不允许规则兜底，必须给出结构化步骤或空步骤原因。
6) 除非用户明确要求，否则不要输出 select_objects 和 rename_object。
7) 如果用户要求“新建正方体并贴图”，优先输出 add_cube + apply_texture_image(path)。
8) 导出步骤规则：
   - export 默认 format=glb；如果用户明确提到 fbx/obj，必须填写对应 format
   - export 的 params 必须是对象；可选 params.use_selection (bool)、params.apply_modifiers (bool)、params.export_apply (bool)
9) 工具动作参数必须完整：
   - select_objects: params.names 必须是非空数组
   - rename_object: params.old_name 与 params.new_name 必须非空
   - translate_objects: params.delta 必须是长度为3的数组；当用户提到“这个物体/选中对象”时必须设置 params.selection_scope=active|selected；可选 params.target_names（非空字符串数组）；并补充 params.target_mode 与 params.require_selection
   - rotate_objects: params.delta_euler 必须是长度为3的数组；遵循同样的 selection_scope / target_names / target_mode / require_selection 规则
   - scale_objects: params.factor 必须是数字或长度为3数组；遵循同样的 selection_scope / target_names / target_mode / require_selection 规则
   - open_file: params.path 必须非空
   - apply_texture_image: 至少提供一个非空贴图路径参数：params.path（兼容旧字段）或 params.base_color_path 或 params.normal_path 或 params.roughness_path 或 params.metallic_path；可选 params.object（单对象）或 params.objects（非空字符串数组）用于批量贴图；当用户提到“这个物体/选中对象”且未给 object/objects 时，必须补充 selection_scope / target_mode / require_selection

允许动作列表：
{allowed_actions}

导出能力是否可用：{export_enabled}

选择集语义 few-shot（必须遵循）：
{selection_few_shot}

用户输入：
{prompt}"#
    )
}

/// 描述：提供选择集语义 few-shot，约束“这个物体/选中对象”类请求的目标定位行为。
fn model_plan_selection_few_shot_examples() -> &'static str {
    r#"- 示例1
  用户：对这个物体平移 0.5
  输出：tool=translate_objects，params.delta=[0.5,0,0]，params.selection_scope="active"，params.target_mode="active"，params.require_selection=true
- 示例2
  用户：对这个物体旋转30度
  输出：tool=rotate_objects，params.delta_euler=[0,0,0.5235987756]，params.selection_scope="active"，params.target_mode="active"，params.require_selection=true
- 示例3
  用户：对这个物体缩放到1.2倍
  输出：tool=scale_objects，params.factor=1.2，params.selection_scope="active"，params.target_mode="active"，params.require_selection=true
- 示例4
  用户：对选中的物体平移 1
  输出：tool=translate_objects，params.delta=[1,0,0]，params.selection_scope="selected"，params.target_mode="selected"，params.require_selection=true
- 示例5
  用户：把所有物体缩放到 0.9
  输出：tool=scale_objects，params.factor=0.9，params.selection_scope="all"，params.target_mode="all"，params.require_selection=false"#
}

/// 描述：将当前选择上下文格式化为 JSON 字符串，便于重规划提示词附带消歧信息。
fn format_selection_context_for_retry_prompt(snapshot: &SelectionContextSnapshot) -> String {
    let payload = json!({
        "active_object": snapshot.active_object,
        "selected_objects": snapshot.selected_objects,
        "selected_count": snapshot.selected_objects.len(),
    });
    serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string())
}

/// 描述：构建重规划提示词，把上次规划错误反馈给 AI，必要时附带选择上下文进行目标消歧。
fn build_model_plan_retry_prompt(
    prompt: &str,
    capabilities: &ModelMcpCapabilities,
    plan_error: &str,
    raw_plan: &str,
    selection_snapshot: Option<&SelectionContextSnapshot>,
    require_target_disambiguation: bool,
) -> String {
    let base = build_model_plan_prompt(prompt, capabilities);
    let selection_context = selection_snapshot
        .map(format_selection_context_for_retry_prompt)
        .unwrap_or_default();
    let selection_context_block = if selection_context.is_empty() {
        String::new()
    } else {
        format!(
            "\n当前 Blender 选择上下文（用于目标消歧，必须参考）：\n{}\n",
            selection_context
        )
    };
    let disambiguation_constraint = if require_target_disambiguation {
        "\n额外约束：你上次规划的目标对象不明确；本次必须让 transform 步骤目标唯一且可解释。\n- 当用户说“这个物体/当前物体/this object”且 active_object 非空时，selection_scope 必须为 active。\n- 当用户说“选中的物体/selected objects”时，selection_scope 必须为 selected。\n- 当 selected_count=0 且步骤依赖选择集时，返回空步骤并填写 reason。"
            .to_string()
    } else {
        String::new()
    };
    format!(
        r#"{base}

上一次规划结果存在错误，必须修复后重试：
- 错误原因：{plan_error}
- 上次输出：{raw_plan}
{selection_context_block}
{disambiguation_constraint}

请重新输出一份全新的 JSON 计划，严格满足约束。"#,
    )
}

/// 描述：从 LLM 文本中提取 JSON 对象，兼容模型意外输出前后缀文本。
fn extract_json_object(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed.to_string());
    }
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(trimmed[start..=end].to_string())
}

/// 描述：解析步骤分支字符串，默认主分支。
fn parse_plan_branch(raw: Option<&str>) -> Result<ModelPlanBranch, String> {
    match raw.unwrap_or("primary").trim().to_lowercase().as_str() {
        "primary" => Ok(ModelPlanBranch::Primary),
        "fallback" => Ok(ModelPlanBranch::Fallback),
        value => Err(format!("invalid branch: {}", value)),
    }
}

/// 描述：解析步骤风险等级字符串，默认 low。
fn parse_plan_risk(raw: Option<&str>) -> Result<ModelPlanRiskLevel, String> {
    match raw.unwrap_or("low").trim().to_lowercase().as_str() {
        "low" => Ok(ModelPlanRiskLevel::Low),
        "medium" => Ok(ModelPlanRiskLevel::Medium),
        "high" => Ok(ModelPlanRiskLevel::High),
        value => Err(format!("invalid risk: {}", value)),
    }
}

/// 描述：根据文本推断导出格式，优先识别 fbx/obj，其余默认 glb。
fn infer_export_format_from_text(raw: &str) -> ExportModelFormat {
    let lower = raw.to_lowercase();
    let normalized = lower.replace(
        ['，', ',', '。', '：', ':', '/', '\\', '-', '_', '(', ')'],
        " ",
    );
    let has_token = |token: &str| normalized.split_whitespace().any(|item| item == token);
    if lower.contains(".fbx") || has_token("fbx") {
        ExportModelFormat::Fbx
    } else if lower.contains(".obj") || has_token("obj") {
        ExportModelFormat::Obj
    } else {
        ExportModelFormat::Glb
    }
}

/// 描述：解析导出步骤格式，支持 `format` 字段、`params.format` 与输入文案推断。
fn parse_export_format(
    raw_format: Option<&str>,
    params: Option<&serde_json::Value>,
    input: Option<&str>,
) -> Result<ExportModelFormat, String> {
    if let Some(raw) = raw_format.map(str::trim).filter(|value| !value.is_empty()) {
        return raw
            .parse::<ExportModelFormat>()
            .map_err(|err| format!("invalid export format `{}`: {}", raw, err));
    }
    if let Some(format_from_params) = params
        .and_then(|value| value.get("format"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format_from_params
            .parse::<ExportModelFormat>()
            .map_err(|err| {
                format!(
                    "invalid export params.format `{}`: {}",
                    format_from_params, err
                )
            });
    }
    Ok(infer_export_format_from_text(input.unwrap_or_default()))
}

/// 描述：根据动作推断默认操作类型，避免模型遗漏字段时无法执行。
fn infer_operation_kind_for_action(action: ModelToolAction) -> ModelPlanOperationKind {
    match action {
        ModelToolAction::ListObjects
        | ModelToolAction::GetSelectionContext
        | ModelToolAction::SelectObjects
        | ModelToolAction::RenameObject
        | ModelToolAction::OrganizeHierarchy
        | ModelToolAction::AddCube
        | ModelToolAction::Undo
        | ModelToolAction::Redo => ModelPlanOperationKind::Basic,
        ModelToolAction::TranslateObjects
        | ModelToolAction::RotateObjects
        | ModelToolAction::ScaleObjects
        | ModelToolAction::AlignOrigin
        | ModelToolAction::NormalizeScale
        | ModelToolAction::NormalizeAxis => ModelPlanOperationKind::BatchTransform,
        ModelToolAction::Solidify
        | ModelToolAction::Bevel
        | ModelToolAction::Mirror
        | ModelToolAction::Array
        | ModelToolAction::AutoSmooth
        | ModelToolAction::WeightedNormal
        | ModelToolAction::Decimate
        | ModelToolAction::InspectMeshTopology => ModelPlanOperationKind::ModifierChain,
        ModelToolAction::Boolean => ModelPlanOperationKind::BooleanChain,
        ModelToolAction::TidyMaterialSlots
        | ModelToolAction::CheckTexturePaths
        | ModelToolAction::ApplyTextureImage
        | ModelToolAction::PackTextures => ModelPlanOperationKind::BatchMaterial,
        ModelToolAction::NewFile | ModelToolAction::OpenFile | ModelToolAction::SaveFile => {
            ModelPlanOperationKind::SceneFileOps
        }
    }
}

/// 描述：解析操作类型字符串；未提供时按动作推断，导出步骤默认 scene_file_ops。
fn parse_operation_kind(
    raw: Option<&str>,
    action: Option<ModelToolAction>,
    is_export: bool,
) -> Result<ModelPlanOperationKind, String> {
    let value = raw.map(|item| item.trim().to_lowercase());
    match value.as_deref() {
        Some("basic") => Ok(ModelPlanOperationKind::Basic),
        Some("boolean_chain") => Ok(ModelPlanOperationKind::BooleanChain),
        Some("modifier_chain") => Ok(ModelPlanOperationKind::ModifierChain),
        Some("batch_transform") => Ok(ModelPlanOperationKind::BatchTransform),
        Some("batch_material") => Ok(ModelPlanOperationKind::BatchMaterial),
        Some("scene_file_ops") => Ok(ModelPlanOperationKind::SceneFileOps),
        Some(other) => Err(format!("invalid operation_kind: {}", other)),
        None => {
            if is_export {
                Ok(ModelPlanOperationKind::SceneFileOps)
            } else if let Some(tool_action) = action {
                Ok(infer_operation_kind_for_action(tool_action))
            } else {
                Ok(ModelPlanOperationKind::Basic)
            }
        }
    }
}

/// 描述：解析 AI 返回的结构化计划 JSON，转换为模型会话步骤。
fn parse_llm_model_plan(
    raw: &str,
) -> Result<(Vec<ModelSessionPlannedStep>, Option<String>), String> {
    let json_text = extract_json_object(raw).ok_or_else(|| "LLM 未返回有效 JSON".to_string())?;
    let parsed: LlmModelPlanResponse =
        serde_json::from_str(&json_text).map_err(|err| format!("解析规划 JSON 失败: {}", err))?;

    let mut steps: Vec<ModelSessionPlannedStep> = Vec::new();
    for item in parsed.steps {
        let step_type = item.step_type.trim().to_lowercase();
        match step_type.as_str() {
            "export" => {
                let export_format = parse_export_format(
                    item.format.as_deref(),
                    item.params.as_ref(),
                    item.input.as_deref(),
                )?;
                let export_params = item.params.unwrap_or_else(|| json!({}));
                if !export_params.is_object() {
                    return Err("export 步骤的 params 必须是对象".to_string());
                }
                let operation_kind =
                    parse_operation_kind(item.operation_kind.as_deref(), None, true)?;
                let branch = parse_plan_branch(item.branch.as_deref())?;
                let risk = parse_plan_risk(item.risk.as_deref())?;
                steps.push(ModelSessionPlannedStep::Export {
                    format: export_format,
                    input: item.input.unwrap_or_else(|| {
                        format!("导出 {}", export_format.as_str().to_uppercase())
                    }),
                    params: export_params,
                    operation_kind,
                    branch,
                    recoverable: item.recoverable.unwrap_or(false),
                    risk,
                    condition: item.condition,
                });
            }
            "tool" => {
                let action_raw = item
                    .action
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "tool 步骤缺少 action".to_string())?;
                let action = action_raw
                    .parse::<ModelToolAction>()
                    .map_err(|err| format!("无效 action `{}`: {}", action_raw, err))?;
                let operation_kind =
                    parse_operation_kind(item.operation_kind.as_deref(), Some(action), false)?;
                let branch = parse_plan_branch(item.branch.as_deref())?;
                let risk = parse_plan_risk(item.risk.as_deref())?;
                steps.push(ModelSessionPlannedStep::Tool {
                    action,
                    input: item.input.unwrap_or_else(|| action.as_str().to_string()),
                    params: item.params.unwrap_or_else(|| json!({})),
                    operation_kind,
                    branch,
                    recoverable: item.recoverable.unwrap_or(true),
                    risk,
                    condition: item.condition,
                });
            }
            other => {
                return Err(format!("未知步骤类型: {}", other));
            }
        }
    }

    Ok((steps, parsed.reason))
}

/// 描述：校验 AI 规划步骤的结构完整性与基本意图一致性，失败时触发 AI 重规划。
fn validate_llm_model_plan_steps(
    steps: &[ModelSessionPlannedStep],
    prompt: &str,
) -> Result<(), String> {
    let lower = prompt.to_lowercase();
    let rename_intent = ["重命名", "rename"].iter().any(|key| lower.contains(key));
    let select_intent = ["选择", "选中", "select"]
        .iter()
        .any(|key| lower.contains(key));
    let selection_reference_intent = has_selection_reference_intent(&lower);
    let ensure_selection_scoped =
        |params: &serde_json::Value, action_name: &str| -> Result<(), String> {
            let scope = params
                .get("selection_scope")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .or_else(|| {
                    params
                        .get("selected_only")
                        .and_then(|value| value.as_bool())
                        .map(|selected_only| if selected_only { "selected" } else { "all" })
                })
                .unwrap_or("selected");
            if !matches!(scope, "active" | "selected" | "all") {
                return Err(format!(
                    "{} 的 selection_scope 非法，必须是 active|selected|all",
                    action_name
                ));
            }
            if selection_reference_intent && scope == "all" {
                return Err(format!(
                    "用户明确引用选中对象时，{} 不允许 selection_scope=all",
                    action_name
                ));
            }
            Ok(())
        };
    let ensure_target_names =
        |params: &serde_json::Value, action_name: &str| -> Result<(), String> {
            let Some(value) = params.get("target_names") else {
                return Ok(());
            };
            let names = value.as_array().ok_or_else(|| {
                format!(
                    "{} 的 params.target_names 必须是非空字符串数组",
                    action_name
                )
            })?;
            if names.is_empty() {
                return Err(format!(
                    "{} 的 params.target_names 不能为空数组",
                    action_name
                ));
            }
            let valid = names.iter().all(|item| {
                item.as_str()
                    .map(str::trim)
                    .map(|name| !name.is_empty())
                    .unwrap_or(false)
            });
            if !valid {
                return Err(format!(
                    "{} 的 params.target_names 必须全部为非空字符串",
                    action_name
                ));
            }
            Ok(())
        };
    let ensure_target_fields =
        |params: &serde_json::Value, action_name: &str| -> Result<(), String> {
            let scope = resolve_selection_scope_from_params(params);
            if let Some(target_mode) = params
                .get("target_mode")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if !matches!(target_mode, "active" | "selected" | "all" | "named") {
                    return Err(format!(
                        "{} 的 target_mode 非法，必须是 active|selected|all|named",
                        action_name
                    ));
                }
                if target_mode == "named" {
                    let name_count = params
                        .get("target_names")
                        .and_then(|value| value.as_array())
                        .map(|items| items.len())
                        .unwrap_or(0);
                    if name_count == 0 {
                        return Err(format!(
                            "{} 的 target_mode=named 时，target_names 不能为空",
                            action_name
                        ));
                    }
                }
            }
            if params.get("require_selection").is_some()
                && params
                    .get("require_selection")
                    .and_then(|value| value.as_bool())
                    .is_none()
            {
                return Err(format!("{} 的 require_selection 必须是布尔值", action_name));
            }
            if let Some(require_selection) = params
                .get("require_selection")
                .and_then(|value| value.as_bool())
            {
                if require_selection && scope == "all" {
                    return Err(format!(
                        "{} 的 require_selection=true 与 selection_scope=all 冲突",
                        action_name
                    ));
                }
                if !require_selection && scope != "all" {
                    return Err(format!(
                        "{} 的 require_selection=false 与 selection_scope={} 冲突",
                        action_name, scope
                    ));
                }
            }
            Ok(())
        };
    let ensure_selected_only_for_reference = |params: &serde_json::Value,
                                              action_name: &str,
                                              strict_required: bool|
     -> Result<(), String> {
        if params.get("selected_only").is_some()
            && params
                .get("selected_only")
                .and_then(|value| value.as_bool())
                .is_none()
        {
            return Err(format!("{} 的 selected_only 必须是布尔值", action_name));
        }
        if !selection_reference_intent {
            return Ok(());
        }
        let selected_only = params
            .get("selected_only")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        if strict_required && params.get("selected_only").is_none() {
            return Err(format!(
                "用户明确引用选中对象时，{} 必须显式设置 selected_only=true",
                action_name
            ));
        }
        if !selected_only {
            return Err(format!(
                "用户明确引用选中对象时，{} 不允许 selected_only=false",
                action_name
            ));
        }
        Ok(())
    };

    for step in steps {
        let ModelSessionPlannedStep::Export { params, .. } = step else {
            continue;
        };
        if !params.is_object() {
            return Err("export 步骤的 params 必须是对象".to_string());
        }
    }

    for step in steps {
        let ModelSessionPlannedStep::Tool { action, params, .. } = step else {
            continue;
        };
        match action {
            ModelToolAction::SelectObjects => {
                let valid = params
                    .get("names")
                    .and_then(|value| value.as_array())
                    .map(|items| {
                        items.iter().any(|item| {
                            item.as_str()
                                .map(str::trim)
                                .map(|value| !value.is_empty())
                                .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false);
                if !valid {
                    return Err("select_objects 缺少有效的 params.names".to_string());
                }
                if !select_intent {
                    return Err("用户未明确要求选择对象，不应规划 select_objects".to_string());
                }
            }
            ModelToolAction::RenameObject => {
                let old_name = params
                    .get("old_name")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                let new_name = params
                    .get("new_name")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if old_name.is_empty() || new_name.is_empty() {
                    return Err("rename_object 缺少 old_name/new_name".to_string());
                }
                if !rename_intent {
                    return Err("用户未明确要求重命名，不应规划 rename_object".to_string());
                }
            }
            ModelToolAction::TranslateObjects => {
                let delta = params
                    .get("delta")
                    .and_then(|value| value.as_array())
                    .ok_or_else(|| "translate_objects 缺少 params.delta".to_string())?;
                if delta.len() != 3 || !delta.iter().all(|value| value.as_f64().is_some()) {
                    return Err(
                        "translate_objects 的 params.delta 必须是长度为3的数字数组".to_string()
                    );
                }
                ensure_selection_scoped(params, "translate_objects")?;
                ensure_target_names(params, "translate_objects")?;
                ensure_target_fields(params, "translate_objects")?;
            }
            ModelToolAction::RotateObjects => {
                let delta = params
                    .get("delta_euler")
                    .and_then(|value| value.as_array())
                    .ok_or_else(|| "rotate_objects 缺少 params.delta_euler".to_string())?;
                if delta.len() != 3 || !delta.iter().all(|value| value.as_f64().is_some()) {
                    return Err(
                        "rotate_objects 的 params.delta_euler 必须是长度为3的数字数组".to_string(),
                    );
                }
                ensure_selection_scoped(params, "rotate_objects")?;
                ensure_target_names(params, "rotate_objects")?;
                ensure_target_fields(params, "rotate_objects")?;
            }
            ModelToolAction::ScaleObjects => {
                let factor = params
                    .get("factor")
                    .ok_or_else(|| "scale_objects 缺少 params.factor".to_string())?;
                let valid = factor.as_f64().is_some()
                    || factor
                        .as_array()
                        .map(|items| {
                            items.len() == 3 && items.iter().all(|item| item.as_f64().is_some())
                        })
                        .unwrap_or(false);
                if !valid {
                    return Err(
                        "scale_objects 的 params.factor 必须是数字或长度为3的数字数组".to_string(),
                    );
                }
                ensure_selection_scoped(params, "scale_objects")?;
                ensure_target_names(params, "scale_objects")?;
                ensure_target_fields(params, "scale_objects")?;
            }
            ModelToolAction::OpenFile => {
                let path = params
                    .get("path")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if path.is_empty() {
                    return Err("open_file 缺少 path".to_string());
                }
            }
            ModelToolAction::ApplyTextureImage => {
                let texture_keys = [
                    "path",
                    "base_color_path",
                    "normal_path",
                    "roughness_path",
                    "metallic_path",
                ];
                let mut provided = 0usize;
                for key in texture_keys {
                    if let Some(value) = params.get(key) {
                        let path = value.as_str().map(str::trim).ok_or_else(|| {
                            format!("apply_texture_image 的 {} 必须是字符串", key)
                        })?;
                        if path.is_empty() {
                            return Err(format!("apply_texture_image 的 {} 不能为空", key));
                        }
                        provided += 1;
                    }
                }
                if provided == 0 {
                    return Err(
                        "apply_texture_image 至少需要 path/base_color_path/normal_path/roughness_path/metallic_path 之一"
                            .to_string(),
                    );
                }
                if let Some(value) = params.get("object") {
                    let object_name = value
                        .as_str()
                        .map(str::trim)
                        .ok_or_else(|| "apply_texture_image 的 object 必须是字符串".to_string())?;
                    if object_name.is_empty() {
                        return Err("apply_texture_image 的 object 不能为空".to_string());
                    }
                }
                let mut has_explicit_targets = params
                    .get("object")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .map(|name| !name.is_empty())
                    .unwrap_or(false);
                if let Some(value) = params.get("objects") {
                    let objects = value.as_array().ok_or_else(|| {
                        "apply_texture_image 的 objects 必须是非空字符串数组".to_string()
                    })?;
                    if objects.is_empty() {
                        return Err("apply_texture_image 的 objects 不能为空数组".to_string());
                    }
                    let valid = objects.iter().all(|item| {
                        item.as_str()
                            .map(str::trim)
                            .map(|name| !name.is_empty())
                            .unwrap_or(false)
                    });
                    if !valid {
                        return Err(
                            "apply_texture_image 的 objects 必须全部为非空字符串".to_string()
                        );
                    }
                    has_explicit_targets = true;
                    if has_active_reference_intent(lower.as_str()) && objects.len() != 1 {
                        return Err(
                            "用户明确引用“这个物体”时，apply_texture_image 的 objects 必须仅包含一个对象"
                                .to_string(),
                        );
                    }
                }
                if selection_reference_intent && !has_explicit_targets {
                    if params.get("selection_scope").is_none()
                        && params.get("selected_only").is_none()
                    {
                        return Err(
                            "用户明确引用“这个物体/选中对象”时，apply_texture_image 必须显式设置 selection_scope 或 selected_only"
                                .to_string(),
                        );
                    }
                    ensure_selection_scoped(params, "apply_texture_image")?;
                    ensure_target_names(params, "apply_texture_image")?;
                    ensure_target_fields(params, "apply_texture_image")?;
                }
            }
            ModelToolAction::AlignOrigin => {
                ensure_selected_only_for_reference(params, "align_origin", false)?;
            }
            ModelToolAction::NormalizeScale => {
                ensure_selected_only_for_reference(params, "normalize_scale", false)?;
            }
            ModelToolAction::NormalizeAxis => {
                ensure_selected_only_for_reference(params, "normalize_axis", false)?;
            }
            ModelToolAction::AutoSmooth => {
                ensure_selected_only_for_reference(params, "auto_smooth", false)?;
            }
            ModelToolAction::WeightedNormal => {
                ensure_selected_only_for_reference(params, "weighted_normal", false)?;
            }
            ModelToolAction::TidyMaterialSlots => {
                // 描述：该动作在 Bridge 侧默认全场景，因此在“这个物体”语义下必须显式限制 selected_only=true。
                ensure_selected_only_for_reference(params, "tidy_material_slots", true)?;
            }
            _ => {}
        }
    }
    Ok(())
}

/// 描述：判断步骤是否为 transform 动作，供目标歧义检测复用。
fn is_transform_tool_action(action: ModelToolAction) -> bool {
    matches!(
        action,
        ModelToolAction::TranslateObjects
            | ModelToolAction::RotateObjects
            | ModelToolAction::ScaleObjects
    )
}

/// 描述：判断提示词是否包含 transform 意图，避免在非变换场景误触发目标歧义重规划。
fn has_transform_intent(lower: &str) -> bool {
    is_translate_intent(lower) || is_rotate_intent(lower) || is_scale_intent(lower)
}

/// 描述：检测规划结果是否存在“目标对象不明确”，用于触发一次带上下文的自动重规划。
fn detect_ambiguous_target_plan(
    steps: &[ModelSessionPlannedStep],
    prompt: &str,
    selection_snapshot: Option<&SelectionContextSnapshot>,
) -> Option<String> {
    let lower = prompt.to_lowercase();
    if !has_selection_reference_intent(lower.as_str()) || !has_transform_intent(lower.as_str()) {
        return None;
    }

    let transform_steps: Vec<(&ModelToolAction, &serde_json::Value)> = steps
        .iter()
        .filter_map(|step| {
            let ModelSessionPlannedStep::Tool { action, params, .. } = step else {
                return None;
            };
            if !is_transform_tool_action(*action) {
                return None;
            }
            Some((action, params))
        })
        .collect();
    if transform_steps.is_empty() {
        return Some("用户要求对引用对象做变换，但规划中没有 transform 步骤".to_string());
    }

    let active_reference = has_active_reference_intent(lower.as_str());
    for (action, params) in transform_steps {
        let scope = resolve_selection_scope_from_params(params);
        if scope == "all" {
            return Some(format!(
                "{} 使用 selection_scope=all，与引用对象语义冲突",
                action.as_str()
            ));
        }
        if active_reference && scope != "active" {
            return Some(format!(
                "用户引用“这个物体”时，{} 应优先 selection_scope=active",
                action.as_str()
            ));
        }
        if let Some(snapshot) = selection_snapshot {
            if scope == "active" && snapshot.active_object.is_none() {
                return Some(format!(
                    "{} 依赖 active 目标，但当前 active_object 为空",
                    action.as_str()
                ));
            }
            if scope == "selected" && snapshot.selected_objects.is_empty() {
                return Some(format!(
                    "{} 依赖 selected 目标，但当前 selected_objects 为空",
                    action.as_str()
                ));
            }
        }
    }
    None
}

/// 描述：使用 AI 进行模型步骤规划；若目标不明确会自动携带选择上下文重规划一次。
type ModelPlanDebugObserver<'a> = dyn FnMut(&str, &str, &str) + 'a;

fn plan_model_session_steps_with_llm(
    provider: Option<&str>,
    prompt: &str,
    capabilities: &ModelMcpCapabilities,
    workdir: Option<&str>,
    selection_snapshot: Option<&SelectionContextSnapshot>,
    mut on_debug: Option<&mut ModelPlanDebugObserver<'_>>,
) -> Result<Vec<ModelSessionPlannedStep>, DesktopProtocolError> {
    // 描述：
    //
    //   - 先使用本地规则规划器生成可执行步骤，命中后直接返回，避免额外 JSON 规划往返与解析噪声。
    //   - 若规则规划无法覆盖或校验失败，再回退到 LLM JSON 规划链路。
    let rule_based_steps = convert_rule_plan_steps(plan_model_steps(prompt));
    if !rule_based_steps.is_empty() {
        let mut normalized_rule_steps = rule_based_steps;
        enrich_transform_targets_for_steps(&mut normalized_rule_steps, prompt);
        enrich_selection_scoped_params_for_reference_steps(&mut normalized_rule_steps, prompt);

        if let Some(observer) = on_debug.as_deref_mut() {
            let parsed_lines = normalized_rule_steps
                .iter()
                .enumerate()
                .map(|(index, step)| {
                    let payload = build_step_trace_payload(step);
                    format!("{}. {}", index + 1, payload)
                })
                .collect::<Vec<_>>()
                .join("\n");
            observer(
                "rule_plan_parsed_steps",
                "规则规划结果",
                parsed_lines.as_str(),
            );
        }

        let validation_result = validate_llm_model_plan_steps(&normalized_rule_steps, prompt);
        let ambiguous_reason =
            detect_ambiguous_target_plan(&normalized_rule_steps, prompt, selection_snapshot);
        if validation_result.is_ok() && ambiguous_reason.is_none() {
            if let Some(observer) = on_debug.as_deref_mut() {
                observer("planner_source", "规划来源", "rule");
            }
            return Ok(normalized_rule_steps);
        }

        if let Some(observer) = on_debug.as_deref_mut() {
            let fallback_reason = match (validation_result.as_ref().err(), ambiguous_reason) {
                (Some(validation_error), Some(ambiguous_error)) => {
                    format!(
                        "规则规划未命中，转 LLM JSON。validation={}；ambiguous={}",
                        validation_error, ambiguous_error
                    )
                }
                (Some(validation_error), None) => {
                    format!(
                        "规则规划未命中，转 LLM JSON。validation={}",
                        validation_error
                    )
                }
                (None, Some(ambiguous_error)) => {
                    format!("规则规划未命中，转 LLM JSON。ambiguous={}", ambiguous_error)
                }
                (None, None) => "规则规划未命中，转 LLM JSON。".to_string(),
            };
            observer(
                "rule_plan_fallback",
                "规则规划回退",
                fallback_reason.as_str(),
            );
        }
    }

    let parsed_provider = parse_provider(provider.unwrap_or("codex"));
    let mut last_error = String::new();
    let mut previous_raw_plan = String::new();
    let prompt_lower = prompt.to_lowercase();
    let mut retry_with_selection_context = false;
    let mut retry_require_disambiguation = false;

    for attempt in 1..=2 {
        let planner_prompt = if attempt == 1 {
            build_model_plan_prompt(prompt, capabilities)
        } else {
            build_model_plan_retry_prompt(
                prompt,
                capabilities,
                last_error.as_str(),
                previous_raw_plan.as_str(),
                if retry_with_selection_context {
                    selection_snapshot
                } else {
                    None
                },
                retry_require_disambiguation,
            )
        };
        if let Some(observer) = on_debug.as_deref_mut() {
            observer(
                "llm_plan_prompt",
                &format!("模型规划 Prompt（attempt={}）", attempt),
                planner_prompt.as_str(),
            );
        }
        let raw_plan = call_model(parsed_provider, planner_prompt.as_str(), workdir)
            .map_err(|err| DesktopProtocolError::from(err.to_protocol_error()))?;
        if let Some(observer) = on_debug.as_deref_mut() {
            observer(
                "llm_plan_raw_response",
                &format!("模型规划原始返回（attempt={}）", attempt),
                raw_plan.content.as_str(),
            );
        }
        previous_raw_plan = raw_plan.content.clone();

        let parsed = parse_llm_model_plan(raw_plan.content.as_str());
        let (steps, reason) = match parsed {
            Ok(value) => value,
            Err(err) => {
                last_error = format!("规划 JSON 非法: {}", err);
                if attempt == 1 {
                    continue;
                }
                return Err(desktop_error_from_text(
                    last_error.as_str(),
                    "core.desktop.model.plan_parse_failed",
                    false,
                ));
            }
        };
        let mut steps = steps;
        enrich_transform_targets_for_steps(&mut steps, prompt);
        enrich_selection_scoped_params_for_reference_steps(&mut steps, prompt);

        if steps.is_empty() {
            last_error = reason.unwrap_or_else(|| "AI 未给出可执行步骤".to_string());
            if attempt == 1 {
                continue;
            }
            return Err(desktop_error_from_text(
                last_error.as_str(),
                "core.desktop.model.plan_empty",
                false,
            ));
        }

        if let Some(observer) = on_debug.as_deref_mut() {
            let parsed_lines = steps
                .iter()
                .enumerate()
                .map(|(index, step)| {
                    let payload = build_step_trace_payload(step);
                    format!("{}. {}", index + 1, payload)
                })
                .collect::<Vec<_>>()
                .join("\n");
            observer(
                "llm_plan_parsed_steps",
                &format!("模型规划解析结果（attempt={}）", attempt),
                parsed_lines.as_str(),
            );
        }

        if let Err(err) = validate_llm_model_plan_steps(&steps, prompt) {
            last_error = format!("规划步骤校验失败: {}", err);
            if attempt == 1 {
                if selection_snapshot.is_some()
                    && has_selection_reference_intent(prompt_lower.as_str())
                {
                    retry_with_selection_context = true;
                    retry_require_disambiguation = true;
                }
                continue;
            }
            return Err(desktop_error_from_text(
                last_error.as_str(),
                "core.desktop.model.plan_invalid",
                false,
            ));
        }
        if let Some(reason) = detect_ambiguous_target_plan(&steps, prompt, selection_snapshot) {
            last_error = format!("规划目标不明确: {}", reason);
            if attempt == 1 {
                retry_with_selection_context = selection_snapshot.is_some();
                retry_require_disambiguation = true;
                continue;
            }
            return Err(desktop_error_from_text(
                last_error.as_str(),
                "core.desktop.model.plan_target_ambiguous",
                false,
            ));
        }

        if let Some(observer) = on_debug.as_deref_mut() {
            observer("planner_source", "规划来源", "llm_json");
        }
        return Ok(steps);
    }

    Err(desktop_error_from_text(
        "模型步骤规划失败",
        "core.desktop.model.plan_failed",
        false,
    ))
}

fn parse_first_number(input: &str) -> Option<f64> {
    let mut buf = String::new();
    let mut started = false;
    for ch in input.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            buf.push(ch);
            started = true;
            continue;
        }
        if started {
            break;
        }
    }
    if buf.is_empty() {
        None
    } else {
        buf.parse::<f64>().ok()
    }
}

/// 描述：从文本中提取最多三个数字，用于向量参数（如平移）。
fn parse_first_three_numbers(input: &str) -> Vec<f64> {
    let mut numbers: Vec<f64> = Vec::new();
    let mut buf = String::new();
    for ch in input.chars() {
        if ch.is_ascii_digit() || ch == '.' || (ch == '-' && buf.is_empty()) {
            buf.push(ch);
            continue;
        }
        if !buf.is_empty() {
            if let Ok(value) = buf.parse::<f64>() {
                numbers.push(value);
                if numbers.len() >= 3 {
                    break;
                }
            }
            buf.clear();
        }
    }
    if numbers.len() < 3 && !buf.is_empty() {
        if let Ok(value) = buf.parse::<f64>() {
            numbers.push(value);
        }
    }
    numbers
}

/// 描述：识别“这个物体/当前物体”等单对象指代语义，默认映射 active 对象。
fn has_active_reference_intent(lower: &str) -> bool {
    [
        "这个物体",
        "当前物体",
        "这个对象",
        "当前对象",
        "active object",
        "current object",
        "this object",
    ]
    .iter()
    .any(|key| lower.contains(key))
}

/// 描述：识别“选中对象”语义，映射 selected 作用域。
fn has_selected_reference_intent(lower: &str) -> bool {
    [
        "选中的物体",
        "选中对象",
        "当前选中对象",
        "selected object",
        "selected objects",
    ]
    .iter()
    .any(|key| lower.contains(key))
}

/// 描述：识别“所有对象”语义，映射 all 作用域。
fn has_all_objects_intent(lower: &str) -> bool {
    [
        "所有对象",
        "全部对象",
        "所有物体",
        "全部物体",
        "整个场景",
        "all objects",
        "all meshes",
        "entire scene",
    ]
    .iter()
    .any(|key| lower.contains(key))
}

/// 描述：统一判断是否引用了选择对象，供规则校验阶段复用。
fn has_selection_reference_intent(lower: &str) -> bool {
    has_active_reference_intent(lower) || has_selected_reference_intent(lower)
}

/// 描述：根据语义推断选择作用域。
fn derive_selection_scope(lower: &str) -> &'static str {
    if has_all_objects_intent(lower) {
        return "all";
    }
    if has_active_reference_intent(lower) {
        return "active";
    }
    if has_selected_reference_intent(lower) || lower.contains("选中") {
        return "selected";
    }
    "selected"
}

/// 描述：识别“引用当前对象”且包含破坏性编辑语义的请求，用于规划前选择集预检查。
fn is_destructive_selection_intent(lower: &str) -> bool {
    if !has_selection_reference_intent(lower) {
        return false;
    }
    is_translate_intent(lower)
        || is_rotate_intent(lower)
        || is_scale_intent(lower)
        || [
            "加厚",
            "倒角",
            "镜像",
            "阵列",
            "布尔",
            "自动平滑",
            "法线加权",
            "减面",
            "贴图",
            "材质",
            "solidify",
            "bevel",
            "mirror",
            "array",
            "boolean",
            "smooth",
            "weighted normal",
            "decimate",
            "texture",
            "material",
        ]
        .iter()
        .any(|key| lower.contains(key))
}

/// 描述：判断是否应在规划阶段阻断破坏性步骤（当引用对象但当前无 active/selected）。
fn should_block_destructive_plan_for_empty_selection(
    prompt_lower: &str,
    snapshot: &SelectionContextSnapshot,
) -> bool {
    if !is_destructive_selection_intent(prompt_lower) {
        return false;
    }
    snapshot.active_object.is_none() && snapshot.selected_objects.is_empty()
}

/// 描述：从步骤参数推断选择范围，兼容新旧参数（selection_scope / selected_only）。
fn resolve_selection_scope_from_params(params: &serde_json::Value) -> &'static str {
    if let Some(scope) = params
        .get("selection_scope")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if scope == "active" {
            return "active";
        }
        if scope == "selected" {
            return "selected";
        }
        if scope == "all" {
            return "all";
        }
    }
    if let Some(selected_only) = params
        .get("selected_only")
        .and_then(|value| value.as_bool())
    {
        return if selected_only { "selected" } else { "all" };
    }
    "selected"
}

/// 描述：判断步骤是否需要“选中对象”预检查；仅在用户显式引用“这个物体/选中对象”时启用。
fn required_selection_scope_for_step(
    prompt_lower: &str,
    step: &ModelSessionPlannedStep,
) -> Option<&'static str> {
    if !has_selection_reference_intent(prompt_lower) {
        return None;
    }
    let ModelSessionPlannedStep::Tool { action, params, .. } = step else {
        return None;
    };
    match action {
        ModelToolAction::TranslateObjects
        | ModelToolAction::RotateObjects
        | ModelToolAction::ScaleObjects => {
            let scope = resolve_selection_scope_from_params(params);
            if scope == "all" {
                None
            } else {
                Some(scope)
            }
        }
        ModelToolAction::AlignOrigin
        | ModelToolAction::NormalizeScale
        | ModelToolAction::NormalizeAxis
        | ModelToolAction::AutoSmooth
        | ModelToolAction::WeightedNormal
        | ModelToolAction::TidyMaterialSlots => Some("selected"),
        ModelToolAction::Solidify
        | ModelToolAction::Bevel
        | ModelToolAction::Mirror
        | ModelToolAction::Array
        | ModelToolAction::Boolean
        | ModelToolAction::Decimate
        | ModelToolAction::ApplyTextureImage => {
            let explicit_object = params
                .get("object")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .map(|name| !name.is_empty())
                .unwrap_or(false);
            if explicit_object {
                None
            } else {
                Some("active")
            }
        }
        _ => None,
    }
}

/// 描述：从步骤参数读取目标对象名列表，仅保留非空字符串项。
fn extract_target_names_from_params(params: &serde_json::Value) -> Vec<String> {
    params
        .get("target_names")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(|name| name.to_string())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default()
}

/// 描述：根据选择范围与名称过滤参数推断结构化目标模式。
fn derive_target_mode(selection_scope: &str, target_names: &[String]) -> &'static str {
    if !target_names.is_empty() {
        return "named";
    }
    match selection_scope {
        "active" => "active",
        "all" => "all",
        _ => "selected",
    }
}

/// 描述：统一补齐 transform 参数中的结构化目标字段，便于规划结果和 trace 一致消费。
fn enrich_transform_target_params(params: &mut serde_json::Value, prompt: &str, lower: &str) {
    if !params.is_object() {
        *params = json!({});
    }
    let has_explicit_scope =
        params.get("selection_scope").is_some() || params.get("selected_only").is_some();
    let selection_scope = if has_explicit_scope {
        resolve_selection_scope_from_params(params)
    } else {
        derive_selection_scope(lower)
    };
    let mut target_names = extract_target_names_from_params(params);
    if target_names.is_empty() {
        target_names = parse_target_names_in_prompt(prompt, lower);
    }
    let target_mode = derive_target_mode(selection_scope, &target_names);
    let require_selection = selection_scope != "all";

    if let Some(raw) = params.as_object_mut() {
        raw.insert("selection_scope".to_string(), json!(selection_scope));
        raw.insert("selected_only".to_string(), json!(selection_scope != "all"));
        raw.insert("target_mode".to_string(), json!(target_mode));
        if target_names.is_empty() {
            raw.remove("target_names");
        } else {
            raw.insert("target_names".to_string(), json!(target_names));
        }
        raw.insert("require_selection".to_string(), json!(require_selection));
    }
}

/// 描述：在 AI 计划执行前补齐 transform 步骤目标字段，降低模型漏填导致的歧义。
fn enrich_transform_targets_for_steps(steps: &mut [ModelSessionPlannedStep], prompt: &str) {
    let lower = prompt.to_lowercase();
    for step in steps {
        let ModelSessionPlannedStep::Tool { action, params, .. } = step else {
            continue;
        };
        if matches!(
            action,
            ModelToolAction::TranslateObjects
                | ModelToolAction::RotateObjects
                | ModelToolAction::ScaleObjects
        ) {
            enrich_transform_target_params(params, prompt, lower.as_str());
        }
    }
}

/// 描述：当用户引用“这个物体/选中对象”时，为 selected_only 类动作补齐 selected_only=true，避免误改全场景对象。
fn enrich_selection_scoped_params_for_reference_steps(
    steps: &mut [ModelSessionPlannedStep],
    prompt: &str,
) {
    let lower = prompt.to_lowercase();
    if !has_selection_reference_intent(lower.as_str()) {
        return;
    }
    for step in steps {
        let ModelSessionPlannedStep::Tool { action, params, .. } = step else {
            continue;
        };
        if !matches!(
            action,
            ModelToolAction::AlignOrigin
                | ModelToolAction::NormalizeScale
                | ModelToolAction::NormalizeAxis
                | ModelToolAction::AutoSmooth
                | ModelToolAction::WeightedNormal
                | ModelToolAction::TidyMaterialSlots
        ) {
            continue;
        }
        if !params.is_object() {
            *params = json!({});
        }
        if let Some(raw) = params.as_object_mut() {
            raw.insert("selected_only".to_string(), json!(true));
        }
    }
}

/// 描述：解析 `get_selection_context` 动作结果，提取当前 active 与 selected 对象信息。
fn parse_selection_context_snapshot(data: &serde_json::Value) -> SelectionContextSnapshot {
    let active_object = data
        .get("active_object")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let selected_objects = data
        .get("selected_objects")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    SelectionContextSnapshot {
        active_object,
        selected_objects,
    }
}

/// 描述：检查当前选择上下文是否满足步骤作用域要求。
fn selection_context_meets_scope(
    snapshot: &SelectionContextSnapshot,
    required_scope: &str,
) -> bool {
    match required_scope {
        "active" => snapshot.active_object.is_some() || !snapshot.selected_objects.is_empty(),
        "selected" => !snapshot.selected_objects.is_empty(),
        _ => true,
    }
}

/// 描述：构建“需要先选择对象”场景的 UI Hint，指导用户手动完成选择后重试。
fn build_selection_required_ui_hint(
    required_scope: &str,
    snapshot: &SelectionContextSnapshot,
) -> ProtocolUiHint {
    let message = if required_scope == "active" {
        "你当前没有激活可编辑对象。请先在 Blender 里激活（或至少选中）一个网格对象后重试。"
    } else {
        "你当前没有选中可编辑对象。请先在 Blender 里选中目标网格对象后重试。"
    };
    ProtocolUiHint {
        key: "selection-required".to_string(),
        level: ProtocolUiHintLevel::Warning,
        title: "需要先选择对象".to_string(),
        message: message.to_string(),
        actions: vec![
            ProtocolUiHintAction {
                key: "retry_last_step".to_string(),
                label: "我已选择，重试".to_string(),
                intent: ProtocolUiHintActionIntent::Primary,
            },
            ProtocolUiHintAction {
                key: "dismiss".to_string(),
                label: "暂不处理".to_string(),
                intent: ProtocolUiHintActionIntent::Default,
            },
        ],
        context: Some(json!({
            "required_scope": required_scope,
            "active_object": snapshot.active_object,
            "selected_objects": snapshot.selected_objects,
            "selected_count": snapshot.selected_objects.len(),
        })),
    }
}

/// 描述：判断步骤成功后是否应失效已缓存的选择上下文，避免后续步骤读取过期状态。
fn should_invalidate_selection_context_cache(step: &ModelSessionPlannedStep) -> bool {
    match step {
        ModelSessionPlannedStep::Tool { action, .. } => !matches!(
            action,
            ModelToolAction::TranslateObjects
                | ModelToolAction::RotateObjects
                | ModelToolAction::ScaleObjects
        ),
        ModelSessionPlannedStep::Export { .. } => false,
    }
}

/// 描述：判断步骤成功后是否应触发拓扑质量检查；仅在几何/网格修改动作后执行。
fn should_run_topology_check_after_step(step: &ModelSessionPlannedStep) -> bool {
    let ModelSessionPlannedStep::Tool { action, .. } = step else {
        return false;
    };
    matches!(
        action,
        ModelToolAction::Solidify
            | ModelToolAction::Bevel
            | ModelToolAction::Mirror
            | ModelToolAction::Array
            | ModelToolAction::Boolean
            | ModelToolAction::AutoSmooth
            | ModelToolAction::WeightedNormal
            | ModelToolAction::Decimate
    )
}

/// 描述：判断步骤执行前是否需要创建文件恢复点，避免文件级操作污染当前会话。
fn should_create_file_recover_point_for_step(step: &ModelSessionPlannedStep) -> bool {
    let ModelSessionPlannedStep::Tool { action, .. } = step else {
        return false;
    };
    matches!(
        action,
        ModelToolAction::NewFile | ModelToolAction::OpenFile | ModelToolAction::SaveFile
    )
}

/// 描述：将任意文本转换为文件系统安全片段，作为恢复点目录名的一部分。
fn normalize_recover_point_segment(value: &str) -> String {
    let mut normalized = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch.to_ascii_lowercase());
        } else if matches!(ch, '-' | '_' | '.') {
            normalized.push('-');
        } else if ch.is_whitespace() {
            normalized.push('-');
        }
    }
    let trimmed = normalized.trim_matches('-');
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 描述：构建文件操作恢复点路径，按会话和 trace 进行隔离，便于失败后恢复。
fn build_file_recover_point_path(
    output_dir: &str,
    session_id: &str,
    trace_id: &str,
    step_index: usize,
) -> PathBuf {
    let session_segment = normalize_recover_point_segment(session_id);
    let trace_segment = normalize_recover_point_segment(trace_id);
    let timestamp = now_millis();
    Path::new(output_dir)
        .join("recover_points")
        .join(session_segment)
        .join(trace_segment)
        .join(format!("step-{}-{}.blend", step_index + 1, timestamp))
}

/// 描述：判断当前主链路是否需要开启操作事务；复杂链路默认启用事务快照保护。
fn should_create_operation_transaction(primary_steps: &[ModelSessionPlannedStep]) -> bool {
    primary_steps.len() >= 2
}

/// 描述：构建操作事务快照路径，用于复杂链路失败时回滚到执行前状态。
fn build_operation_transaction_snapshot_path(
    output_dir: &str,
    session_id: &str,
    trace_id: &str,
) -> PathBuf {
    let session_segment = normalize_recover_point_segment(session_id);
    let trace_segment = normalize_recover_point_segment(trace_id);
    let timestamp = now_millis();
    Path::new(output_dir)
        .join("recover_points")
        .join(session_segment)
        .join(trace_segment)
        .join(format!("transaction-start-{}.blend", timestamp))
}

/// 描述：从 list_objects 返回数据统计场景规模，输出对象总数与 Mesh 数量。
fn parse_scene_object_metrics(data: &serde_json::Value) -> (usize, usize) {
    let Some(objects) = data.get("objects").and_then(|value| value.as_array()) else {
        return (0, 0);
    };
    let total_count = objects.len();
    let mesh_count = objects
        .iter()
        .filter(|item| item.get("type").and_then(|value| value.as_str()) == Some("MESH"))
        .count();
    (total_count, mesh_count)
}

/// 描述：根据步骤数量与场景规模估算复杂流程耗时（毫秒），用于执行前提示。
fn estimate_complex_flow_duration_ms(primary_step_count: usize, mesh_count: usize) -> u64 {
    let base_ms = 1200u64;
    let step_cost_ms = (primary_step_count as u64).saturating_mul(420);
    let mesh_cost_ms = (mesh_count as u64).saturating_mul(12);
    base_ms
        .saturating_add(step_cost_ms)
        .saturating_add(mesh_cost_ms)
}

/// 描述：从拓扑检查结果提取最新面数基线，供后续步骤计算面数变化。
fn parse_topology_face_count_baseline(data: &serde_json::Value) -> HashMap<String, u64> {
    data.get("face_counts")
        .and_then(|value| value.as_object())
        .map(|items| {
            items
                .iter()
                .filter_map(|(name, count)| count.as_u64().map(|value| (name.clone(), value)))
                .collect::<HashMap<String, u64>>()
        })
        .unwrap_or_default()
}

/// 描述：识别“平移/移动”意图，支持中英文关键词。
fn is_translate_intent(lower: &str) -> bool {
    ["平移", "移动", "translate", "move"]
        .iter()
        .any(|key| lower.contains(key))
}

/// 描述：提取平移向量；只给单值时默认按 X 轴平移，未给值时使用默认步长。
fn parse_translate_delta(prompt: &str, lower: &str) -> (f64, f64, f64) {
    let numbers = parse_first_three_numbers(prompt);
    if numbers.len() >= 3 {
        return (numbers[0], numbers[1], numbers[2]);
    }
    if numbers.len() == 1 {
        let value = numbers[0];
        if lower.contains("y轴") || lower.contains(" y ") {
            return (0.0, value, 0.0);
        }
        if lower.contains("z轴") || lower.contains(" z ") {
            return (0.0, 0.0, value);
        }
        return (value, 0.0, 0.0);
    }
    (0.2, 0.0, 0.0)
}

/// 描述：识别“旋转”意图，支持中英文关键词。
fn is_rotate_intent(lower: &str) -> bool {
    ["旋转", "rotate"].iter().any(|key| lower.contains(key))
}

/// 描述：角度归一化为弧度；当数值明显超过 2π 时视为“度”输入。
fn normalize_angle_to_radian(value: f64) -> f64 {
    if value.abs() > std::f64::consts::TAU {
        value.to_radians()
    } else {
        value
    }
}

/// 描述：提取旋转向量（弧度）；单值场景按轴关键词分配。
fn parse_rotate_delta(prompt: &str, lower: &str) -> (f64, f64, f64) {
    let numbers = parse_first_three_numbers(prompt);
    if numbers.len() >= 3 {
        return (
            normalize_angle_to_radian(numbers[0]),
            normalize_angle_to_radian(numbers[1]),
            normalize_angle_to_radian(numbers[2]),
        );
    }
    if numbers.len() == 1 {
        let value = normalize_angle_to_radian(numbers[0]);
        if lower.contains("y轴") || lower.contains(" y ") {
            return (0.0, value, 0.0);
        }
        if lower.contains("z轴") || lower.contains(" z ") {
            return (0.0, 0.0, value);
        }
        return (value, 0.0, 0.0);
    }
    (0.0, 0.0, 0.1745329252)
}

/// 描述：识别“缩放”意图，支持中英文关键词。
fn is_scale_intent(lower: &str) -> bool {
    ["缩放", "scale"].iter().any(|key| lower.contains(key))
}

/// 描述：提取统一缩放因子，未提供时使用默认值。
fn parse_scale_factor(prompt: &str) -> f64 {
    parse_first_number(prompt)
        .unwrap_or(1.1)
        .clamp(0.001, 1000.0)
}

/// 描述：从文本中提取被引号包裹的片段，供目标对象名解析复用。
fn collect_wrapped_segments(prompt: &str, open: char, close: char) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    let mut cursor = prompt;
    while let Some(start_idx) = cursor.find(open) {
        let after_open_idx = start_idx + open.len_utf8();
        let after_open = &cursor[after_open_idx..];
        if let Some(end_idx) = after_open.find(close) {
            let candidate = after_open[..end_idx].trim();
            if !candidate.is_empty() {
                result.push(candidate.to_string());
            }
            let next_idx = end_idx + close.len_utf8();
            cursor = &after_open[next_idx..];
            continue;
        }
        break;
    }
    result
}

/// 描述：从自然语言中提取“按名称过滤”的对象名列表，命中 `名为/叫做/named` 或引号片段时生效。
fn parse_target_names_in_prompt(prompt: &str, lower: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let markers = ["名为", "叫做", "named "];
    for marker in markers {
        if let Some(start) = lower.find(marker) {
            let mut segment = prompt[start + marker.len()..].to_string();
            for stop in ["，", "。", "；", "!", "！", "?", "？", "\n"] {
                if let Some(idx) = segment.find(stop) {
                    segment = segment[..idx].to_string();
                }
            }
            let normalized = segment
                .replace("和", ",")
                .replace("、", ",")
                .replace("，", ",")
                .replace("及", ",")
                .replace("与", ",")
                .replace("/", ",");
            for raw_part in normalized.split(',') {
                let mut candidate = raw_part
                    .trim_matches(|ch| {
                        ch == '"'
                            || ch == '\''
                            || ch == '`'
                            || ch == '“'
                            || ch == '”'
                            || ch == '「'
                            || ch == '」'
                    })
                    .trim()
                    .to_string();
                for suffix in [
                    "的物体",
                    "的对象",
                    "物体",
                    "对象",
                    "进行",
                    "执行",
                    "平移",
                    "旋转",
                    "缩放",
                    "move",
                    "translate",
                    "rotate",
                    "scale",
                ] {
                    if let Some(idx) = candidate.to_lowercase().find(suffix) {
                        candidate = candidate[..idx].trim().to_string();
                    }
                }
                candidate = candidate
                    .trim_matches(|ch| {
                        ch == '"'
                            || ch == '\''
                            || ch == '`'
                            || ch == '“'
                            || ch == '”'
                            || ch == '「'
                            || ch == '」'
                    })
                    .trim()
                    .to_string();
                if !candidate.is_empty() && !candidate.contains('/') && !candidate.contains('\\') {
                    names.push(candidate);
                }
            }
        }
    }

    if names.is_empty() {
        let mut quoted = Vec::new();
        quoted.extend(collect_wrapped_segments(prompt, '“', '”'));
        quoted.extend(collect_wrapped_segments(prompt, '「', '」'));
        quoted.extend(collect_wrapped_segments(prompt, '"', '"'));
        quoted.extend(collect_wrapped_segments(prompt, '\'', '\''));
        quoted.extend(collect_wrapped_segments(prompt, '`', '`'));
        for candidate in quoted {
            let trimmed = candidate.trim();
            if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
                continue;
            }
            names.push(trimmed.to_string());
        }
    }

    let mut deduped: Vec<String> = Vec::new();
    for name in names {
        if !deduped.iter().any(|existing| existing == &name) {
            deduped.push(name);
        }
    }
    deduped
}

fn parse_path_in_prompt(prompt: &str) -> Option<String> {
    let normalize_candidate = |raw: &str| -> Option<String> {
        let trimmed = raw.trim_matches(|value| {
            value == '"'
                || value == '\''
                || value == '`'
                || value == '“'
                || value == '”'
                || value == '‘'
                || value == '’'
        });
        let head = trimmed
            .split(|value: char| {
                value.is_whitespace()
                    || value == '"'
                    || value == '\''
                    || value == '`'
                    || value == '“'
                    || value == '”'
                    || value == '‘'
                    || value == '’'
                    || value == '，'
                    || value == '。'
                    || value == '；'
                    || value == '！'
                    || value == '？'
            })
            .next()
            .unwrap_or("")
            .trim_matches(|value| {
                value == '"'
                    || value == '\''
                    || value == '`'
                    || value == '“'
                    || value == '”'
                    || value == '‘'
                    || value == '’'
                    || value == '，'
                    || value == '。'
                    || value == '；'
                    || value == '！'
                    || value == '？'
                    || value == ')'
                    || value == ']'
                    || value == '}'
            });
        if head.starts_with('/') || head.contains(":\\") {
            return Some(head.to_string());
        }
        None
    };

    let trimmed = prompt.trim();
    for token in trimmed.split_whitespace() {
        if let Some(candidate) = normalize_candidate(token) {
            return Some(candidate);
        }
    }
    if let Some(start) = trimmed.find('/') {
        let remaining = &trimmed[start..];
        if let Some(candidate) = normalize_candidate(remaining) {
            return Some(candidate);
        }
    }
    None
}

/// 描述：识别“将图片贴图应用到对象”的用户意图，避免把普通路径误判为材质指令。
fn is_apply_texture_intent(prompt: &str, lower: &str, path: &str) -> bool {
    let has_texture_keyword = ["贴图", "纹理", "材质", "texture", "image", "base color"]
        .iter()
        .any(|keyword| lower.contains(keyword));
    let has_apply_verb = [
        "添加", "替换", "设置", "应用", "assign", "apply", "set", "use",
    ]
    .iter()
    .any(|keyword| lower.contains(keyword));
    let lower_path = path.to_lowercase();
    let is_image_file = [
        ".png", ".jpg", ".jpeg", ".tga", ".bmp", ".tif", ".tiff", ".exr",
    ]
    .iter()
    .any(|suffix| lower_path.ends_with(suffix));
    let starts_with_material_instruction = ["贴图", "纹理", "材质", "texture", "image", "material"]
        .iter()
        .any(|prefix| prompt.trim_start().to_lowercase().starts_with(prefix));

    (has_texture_keyword && has_apply_verb && is_image_file)
        || (starts_with_material_instruction && is_image_file)
}

fn is_add_cube_intent(prompt: &str, lower: &str) -> bool {
    const CN_EXPLICIT: [&str; 16] = [
        "添加正方体",
        "添加一个正方体",
        "添加立方体",
        "添加一个立方体",
        "新建正方体",
        "新建一个正方体",
        "新建立方体",
        "新建一个立方体",
        "创建正方体",
        "创建一个正方体",
        "创建立方体",
        "创建一个立方体",
        "加个正方体",
        "加一个正方体",
        "加个立方体",
        "加一个立方体",
    ];
    if CN_EXPLICIT.iter().any(|pattern| lower.contains(pattern)) {
        return true;
    }

    const EN_EXPLICIT: [&str; 10] = [
        "add cube",
        "add a cube",
        "create cube",
        "create a cube",
        "new cube",
        "add box",
        "add a box",
        "create box",
        "create a box",
        "new box",
    ];
    if EN_EXPLICIT.iter().any(|pattern| lower.contains(pattern)) {
        return true;
    }

    let trimmed = prompt.trim_start();
    let starts_with_create_verb = ["添加", "新建", "创建", "生成", "add ", "create ", "new "]
        .iter()
        .any(|prefix| trimmed.to_lowercase().starts_with(prefix));
    let has_cube_noun = ["正方体", "立方体", "方块", "cube", "box"]
        .iter()
        .any(|keyword| lower.contains(keyword));

    starts_with_create_verb && has_cube_noun
}

#[allow(dead_code)]
#[derive(Clone)]
enum PlannedModelStep {
    Export {
        input: String,
        format: ExportModelFormat,
        params: serde_json::Value,
    },
    Tool {
        action: ModelToolAction,
        input: String,
        params: serde_json::Value,
    },
}

/// 描述：根据动作推断规则规划步骤的风险等级，供执行层的风险提示与审计复用。
fn infer_rule_plan_risk_for_action(action: ModelToolAction) -> ModelPlanRiskLevel {
    match action {
        ModelToolAction::Boolean => ModelPlanRiskLevel::High,
        ModelToolAction::NewFile
        | ModelToolAction::OpenFile
        | ModelToolAction::SaveFile
        | ModelToolAction::Undo
        | ModelToolAction::Redo
        | ModelToolAction::Decimate => ModelPlanRiskLevel::Medium,
        _ => ModelPlanRiskLevel::Low,
    }
}

/// 描述：将本地规则规划结果转换为统一会话步骤结构，确保后续执行与校验链路一致。
fn convert_rule_plan_steps(steps: Vec<PlannedModelStep>) -> Vec<ModelSessionPlannedStep> {
    steps
        .into_iter()
        .map(|step| match step {
            PlannedModelStep::Export {
                input,
                format,
                params,
            } => ModelSessionPlannedStep::Export {
                format,
                input,
                params,
                operation_kind: ModelPlanOperationKind::SceneFileOps,
                branch: ModelPlanBranch::Primary,
                recoverable: false,
                risk: ModelPlanRiskLevel::Medium,
                condition: None,
            },
            PlannedModelStep::Tool {
                action,
                input,
                params,
            } => ModelSessionPlannedStep::Tool {
                action,
                input,
                params,
                operation_kind: infer_operation_kind_for_action(action),
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: infer_rule_plan_risk_for_action(action),
                condition: None,
            },
        })
        .collect()
}

/// 描述：解析本地规则规划的导出参数，支持“仅导出选中对象”和“不应用修改器”语义。
fn build_export_plan_params(lower: &str) -> serde_json::Value {
    let use_selection = [
        "选中导出",
        "仅导出选中",
        "只导出选中",
        "selected only",
        "selection only",
    ]
    .iter()
    .any(|key| lower.contains(key));
    let disable_apply_modifiers = [
        "不应用修改器",
        "不应用所有修改器",
        "without modifiers",
        "no modifiers",
    ]
    .iter()
    .any(|key| lower.contains(key));
    json!({
        "use_selection": use_selection,
        "apply_modifiers": !disable_apply_modifiers,
        "export_apply": !disable_apply_modifiers
    })
}

fn plan_model_steps(prompt: &str) -> Vec<PlannedModelStep> {
    let lower = prompt.to_lowercase();
    let mut steps: Vec<PlannedModelStep> = Vec::new();

    if [
        "导出",
        "export",
        "输出glb",
        "输出fbx",
        "输出obj",
        "导出模型",
        "导出fbx",
        "导出obj",
    ]
    .iter()
    .any(|key| lower.contains(key))
    {
        let format = infer_export_format_from_text(lower.as_str());
        steps.push(PlannedModelStep::Export {
            input: format!("导出 {}", format.as_str().to_uppercase()),
            format,
            params: build_export_plan_params(lower.as_str()),
        });
    }
    if ["列出对象", "查看对象", "list objects"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::ListObjects,
            input: "列出对象".to_string(),
            params: json!({}),
        });
    }
    if lower.contains("选择对象") || lower.contains("select object") {
        let names_text = prompt
            .split_once("选择对象")
            .map(|(_, right)| right)
            .or_else(|| prompt.split_once("select object").map(|(_, right)| right))
            .unwrap_or("")
            .trim();
        let names = names_text
            .split(|value: char| value == ',' || value == '，' || value.is_whitespace())
            .filter_map(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
            .collect::<Vec<_>>();
        if !names.is_empty() {
            steps.push(PlannedModelStep::Tool {
                action: ModelToolAction::SelectObjects,
                input: format!("选择对象 {:?}", names),
                params: json!({ "names": names }),
            });
        }
    }
    let is_collection_context = lower.contains("集合") || lower.contains("collection");
    if is_collection_context {
        let mut collection_names: Vec<String> = Vec::new();
        collection_names.extend(collect_wrapped_segments(prompt, '“', '”'));
        collection_names.extend(collect_wrapped_segments(prompt, '「', '」'));
        collection_names.extend(collect_wrapped_segments(prompt, '"', '"'));
        collection_names.extend(collect_wrapped_segments(prompt, '\'', '\''));
        collection_names.extend(collect_wrapped_segments(prompt, '`', '`'));
        collection_names = collection_names
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty() && !value.contains('/') && !value.contains('\\'))
            .fold(Vec::<String>::new(), |mut acc, item| {
                if !acc.iter().any(|existing| existing == &item) {
                    acc.push(item);
                }
                acc
            });
        if collection_names.is_empty() {
            collection_names = parse_target_names_in_prompt(prompt, lower.as_str());
        }

        if (lower.contains("重命名") || lower.contains("rename")) && collection_names.len() >= 2
        {
            steps.push(PlannedModelStep::Tool {
                action: ModelToolAction::OrganizeHierarchy,
                input: format!(
                    "集合重命名 {} -> {}",
                    collection_names[0], collection_names[1]
                ),
                params: json!({
                    "mode": "collection_rename",
                    "collection": collection_names[0],
                    "new_name": collection_names[1]
                }),
            });
        } else if (lower.contains("重排")
            || lower.contains("reorder")
            || lower.contains("置顶")
            || lower.contains("最前")
            || lower.contains("最后")
            || lower.contains("末尾"))
            && !collection_names.is_empty()
        {
            let position = if ["置顶", "最前", "first", "front"]
                .iter()
                .any(|token| lower.contains(token))
            {
                "first"
            } else {
                "last"
            };
            let mut params = json!({
                "mode": "collection_reorder",
                "collection": collection_names[0],
                "position": position,
            });
            if let Some(parent_collection) = collection_names.get(1) {
                if let Some(raw) = params.as_object_mut() {
                    raw.insert("parent_collection".to_string(), json!(parent_collection));
                }
            }
            steps.push(PlannedModelStep::Tool {
                action: ModelToolAction::OrganizeHierarchy,
                input: format!("集合重排 {} -> {}", collection_names[0], position),
                params,
            });
        } else if (lower.contains("移动")
            || lower.contains("move")
            || lower.contains("层级")
            || lower.contains("parent"))
            && !collection_names.is_empty()
        {
            let mut params = json!({
                "mode": "collection_move",
                "collection": collection_names[0],
            });
            if let Some(parent_collection) = collection_names.get(1) {
                if let Some(raw) = params.as_object_mut() {
                    raw.insert("parent_collection".to_string(), json!(parent_collection));
                }
            }
            steps.push(PlannedModelStep::Tool {
                action: ModelToolAction::OrganizeHierarchy,
                input: format!("集合移动 {}", collection_names[0]),
                params,
            });
        }
    }

    if (lower.contains("重命名") || lower.contains("rename")) && !is_collection_context {
        if let Some((left, right)) = prompt.split_once("为") {
            let old_name = left
                .replace("重命名", "")
                .replace("对象", "")
                .trim()
                .to_string();
            let new_name = right.trim().to_string();
            if !old_name.is_empty() && !new_name.is_empty() {
                steps.push(PlannedModelStep::Tool {
                    action: ModelToolAction::RenameObject,
                    input: format!("重命名 {} -> {}", old_name, new_name),
                    params: json!({ "old_name": old_name, "new_name": new_name }),
                });
            }
        }
    }
    if !is_collection_context && (lower.contains("设为父级") || lower.contains("parent")) {
        let normalized = prompt.replace("设为父级", " ");
        let parts = normalized
            .split_whitespace()
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>();
        if parts.len() >= 2 {
            steps.push(PlannedModelStep::Tool {
                action: ModelToolAction::OrganizeHierarchy,
                input: format!("层级整理 {} -> {}", parts[0], parts[1]),
                params: json!({ "child": parts[0], "parent": parts[1] }),
            });
        }
    }
    if ["新建", "new file"].iter().any(|key| lower.contains(key)) {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::NewFile,
            input: "新建 Blender 文件".to_string(),
            params: json!({"use_empty": true}),
        });
    }
    if ["打开", "导入", "open file"]
        .iter()
        .any(|key| lower.contains(key))
    {
        if let Some(path) = parse_path_in_prompt(prompt) {
            steps.push(PlannedModelStep::Tool {
                action: ModelToolAction::OpenFile,
                input: format!("打开文件 {}", path),
                params: json!({ "path": path }),
            });
        }
    }
    if ["保存", "save file", "另存为", "save as"]
        .iter()
        .any(|key| lower.contains(key))
    {
        let path = parse_path_in_prompt(prompt);
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::SaveFile,
            input: "保存文件".to_string(),
            params: path
                .map(|value| json!({ "path": value }))
                .unwrap_or_else(|| json!({})),
        });
    }
    if ["撤销", "undo"].iter().any(|key| lower.contains(key)) {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::Undo,
            input: "撤销".to_string(),
            params: json!({}),
        });
    }
    if ["重做", "redo"].iter().any(|key| lower.contains(key)) {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::Redo,
            input: "重做".to_string(),
            params: json!({}),
        });
    }
    if ["对齐原点", "原点", "align origin"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::AlignOrigin,
            input: "对齐到原点".to_string(),
            params: json!({ "selected_only": true }),
        });
    }
    if is_translate_intent(&lower) {
        let delta = parse_translate_delta(prompt, &lower);
        let mut params = json!({
            "delta": [delta.0, delta.1, delta.2],
        });
        enrich_transform_target_params(&mut params, prompt, &lower);
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::TranslateObjects,
            input: "平移对象".to_string(),
            params,
        });
    }
    if is_rotate_intent(&lower) {
        let delta = parse_rotate_delta(prompt, &lower);
        let mut params = json!({
            "delta_euler": [delta.0, delta.1, delta.2],
        });
        enrich_transform_target_params(&mut params, prompt, &lower);
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::RotateObjects,
            input: "旋转对象".to_string(),
            params,
        });
    }
    if is_scale_intent(&lower) {
        let factor = parse_scale_factor(prompt);
        let mut params = json!({
            "factor": factor,
        });
        enrich_transform_target_params(&mut params, prompt, &lower);
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::ScaleObjects,
            input: "缩放对象".to_string(),
            params,
        });
    }
    if ["统一尺度", "normalize scale", "应用缩放"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::NormalizeScale,
            input: "统一尺度".to_string(),
            params: json!({ "selected_only": true, "apply": true }),
        });
    }
    if ["旋转方向", "坐标系", "normalize axis"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::NormalizeAxis,
            input: "旋转方向标准化".to_string(),
            params: json!({ "selected_only": true }),
        });
    }
    if is_add_cube_intent(prompt, &lower) {
        let size = parse_first_number(prompt)
            .unwrap_or(2.0)
            .clamp(0.001, 1000.0);
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::AddCube,
            input: format!("添加正方体 size={}", size),
            params: json!({ "size": size }),
        });
    }
    if ["加厚", "solidify"].iter().any(|key| lower.contains(key)) {
        let thickness = parse_first_number(prompt)
            .unwrap_or(0.02)
            .clamp(0.0001, 10.0);
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::Solidify,
            input: format!("加厚 {}", thickness),
            params: json!({ "thickness": thickness }),
        });
    }
    if ["倒角", "bevel"].iter().any(|key| lower.contains(key)) {
        let width = parse_first_number(prompt)
            .unwrap_or(0.02)
            .clamp(0.0001, 10.0);
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::Bevel,
            input: format!("倒角 {}", width),
            params: json!({ "width": width, "segments": 2 }),
        });
    }
    if ["镜像", "mirror"].iter().any(|key| lower.contains(key)) {
        let axis = if lower.contains(" y ") || lower.contains("y轴") || lower.contains(" y轴") {
            "Y"
        } else if lower.contains(" z ") || lower.contains("z轴") || lower.contains(" z轴") {
            "Z"
        } else {
            "X"
        };
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::Mirror,
            input: format!("镜像 {}", axis),
            params: json!({ "axis": axis }),
        });
    }
    if ["阵列", "array"].iter().any(|key| lower.contains(key)) {
        let count = parse_first_number(prompt)
            .map(|value| value as u64)
            .unwrap_or(3)
            .clamp(1, 128);
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::Array,
            input: format!("阵列 {}", count),
            params: json!({ "count": count, "offset": 1.0 }),
        });
    }
    if ["布尔", "boolean"].iter().any(|key| lower.contains(key)) {
        let operation = if lower.contains("并") || lower.contains("union") {
            "UNION"
        } else if lower.contains("交") || lower.contains("intersect") {
            "INTERSECT"
        } else {
            "DIFFERENCE"
        };
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::Boolean,
            input: format!("布尔 {}", operation),
            params: json!({ "operation": operation, "times": 1 }),
        });
    }
    if ["自动平滑", "auto smooth", "smooth"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::AutoSmooth,
            input: "自动平滑".to_string(),
            params: json!({ "angle": 0.5235987756, "selected_only": true }),
        });
    }
    if ["weighted normal", "法线加权"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::WeightedNormal,
            input: "Weighted Normal".to_string(),
            params: json!({ "selected_only": true }),
        });
    }
    if ["减面", "decimate"].iter().any(|key| lower.contains(key)) {
        let ratio = parse_first_number(prompt).unwrap_or(0.5).clamp(0.01, 1.0);
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::Decimate,
            input: format!("减面 {}", ratio),
            params: json!({ "ratio": ratio }),
        });
    }
    if ["材质槽", "整理材质"].iter().any(|key| lower.contains(key)) {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::TidyMaterialSlots,
            input: "整理材质槽".to_string(),
            params: json!({ "selected_only": false }),
        });
    }
    if ["贴图路径", "纹理路径", "check texture"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::CheckTexturePaths,
            input: "检查贴图路径".to_string(),
            params: json!({}),
        });
    }
    if let Some(path) = parse_path_in_prompt(prompt) {
        if is_apply_texture_intent(prompt, lower.as_str(), path.as_str()) {
            let mut params = json!({ "path": path });
            if has_selection_reference_intent(lower.as_str()) {
                enrich_transform_target_params(&mut params, prompt, lower.as_str());
            }
            steps.push(PlannedModelStep::Tool {
                action: ModelToolAction::ApplyTextureImage,
                input: format!("应用贴图 {}", path),
                params,
            });
        }
    }
    if ["打包贴图", "pack textures"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::PackTextures,
            input: "打包贴图".to_string(),
            params: json!({}),
        });
    }
    steps
}

#[allow(dead_code)]
fn check_capability_for_step(
    capabilities: &ModelMcpCapabilities,
    step: &PlannedModelStep,
) -> Result<(), String> {
    match step {
        PlannedModelStep::Export { .. } => {
            if !capability_enabled(capabilities.export) {
                return Err("导出能力已关闭，请在模型设置中开启“导出模型（Blender）”".to_string());
            }
        }
        PlannedModelStep::Tool { action, .. } => {
            let allowed = match action {
                ModelToolAction::ListObjects
                | ModelToolAction::GetSelectionContext
                | ModelToolAction::SelectObjects
                | ModelToolAction::RenameObject
                | ModelToolAction::OrganizeHierarchy => capability_enabled(capabilities.scene),
                ModelToolAction::TranslateObjects
                | ModelToolAction::RotateObjects
                | ModelToolAction::ScaleObjects
                | ModelToolAction::AlignOrigin
                | ModelToolAction::NormalizeScale
                | ModelToolAction::NormalizeAxis => capability_enabled(capabilities.transform),
                ModelToolAction::Solidify
                | ModelToolAction::AddCube
                | ModelToolAction::Bevel
                | ModelToolAction::Mirror
                | ModelToolAction::Array
                | ModelToolAction::Boolean => capability_enabled(capabilities.geometry),
                ModelToolAction::AutoSmooth
                | ModelToolAction::WeightedNormal
                | ModelToolAction::Decimate
                | ModelToolAction::InspectMeshTopology => capability_enabled(capabilities.mesh_opt),
                ModelToolAction::TidyMaterialSlots
                | ModelToolAction::CheckTexturePaths
                | ModelToolAction::ApplyTextureImage
                | ModelToolAction::PackTextures => capability_enabled(capabilities.material),
                ModelToolAction::NewFile
                | ModelToolAction::OpenFile
                | ModelToolAction::SaveFile
                | ModelToolAction::Undo
                | ModelToolAction::Redo => capability_enabled(capabilities.file),
            };
            if !allowed {
                return Err(format!(
                    "能力 `{}` 已关闭，请到模型设置中开启后再执行",
                    action
                ));
            }
        }
    }
    Ok(())
}

fn is_unsupported_action_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("unsupported action")
        || lower.contains("unsupported_action")
        || lower.contains("mcp.model.bridge.rejected")
}

/// 描述：判断错误是否属于 Bridge 不可用（未启动或端口未就绪）类别。
fn is_bridge_unavailable_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("bridge_connect_failed")
        || lower.contains("invalid_bridge_addr")
        || lower.contains("cannot connect blender bridge")
        || lower.contains("connection refused")
}

/// 描述：按动作类型尝试自动拉起 Blender；当为 OpenFile 时优先带文件路径启动。
fn launch_blender_for_action(
    action: ModelToolAction,
    params: &serde_json::Value,
) -> Result<(), String> {
    let blender_bin = resolve_blender_bin(None);
    let mut command = Command::new(&blender_bin);
    if matches!(action, ModelToolAction::OpenFile) {
        if let Some(path) = params
            .get("path")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            command.arg(path);
        }
    }
    command
        .spawn()
        .map_err(|err| format!("auto launch blender failed: {}", err))?;
    Ok(())
}

/// 描述：轮询检测 Bridge 可用性，等待 Blender 启动并加载插件。
fn wait_for_bridge_ready(
    blender_bridge_addr: Option<String>,
    attempts: u32,
    interval_ms: u64,
) -> bool {
    for _ in 0..attempts {
        if ping_blender_bridge(blender_bridge_addr.clone()).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(interval_ms));
    }
    false
}

/// 描述：执行模型动作并自动处理 Bridge 自动拉起与脚本升级，返回完整动作结果数据。
fn execute_model_tool_result_with_bridge_upgrade(
    action: ModelToolAction,
    params: serde_json::Value,
    blender_bridge_addr: Option<String>,
) -> Result<ModelToolResult, String> {
    let run_once = || {
        execute_model_tool(ModelToolRequest {
            action,
            params: params.clone(),
            blender_bridge_addr: blender_bridge_addr.clone(),
            timeout_secs: Some(45),
        })
        .map_err(|err| err.to_string())
    };

    match run_once() {
        Ok(result) => Ok(result),
        Err(first_err) => {
            if is_bridge_unavailable_error(&first_err) {
                let _ = install_blender_bridge(None);
                if let Err(launch_err) = launch_blender_for_action(action, &params) {
                    return Err(format!(
                        "{}。Bridge 不可用且自动启动 Blender 失败：{}",
                        first_err, launch_err
                    ));
                }
                if !wait_for_bridge_ready(blender_bridge_addr.clone(), 12, 1000) {
                    return Err(format!(
                        "{}。已尝试自动启动 Blender，但 Bridge 仍不可用；请确认插件 `Zodileap MCP Bridge` 已启用。",
                        first_err
                    ));
                }
                return run_once().map_err(|second_err| {
                    format!("{}。Bridge 已就绪但动作仍失败：{}", first_err, second_err)
                });
            }

            if !is_unsupported_action_error(&first_err) {
                return Err(first_err);
            }

            let _ = install_blender_bridge(None);
            match run_once() {
                Ok(result) => Ok(result),
                Err(second_err) => Err(format!(
                    "{}。已自动写入最新 Bridge 文件，但当前 Blender 会话仍是旧版本；请重启 Blender 后重试。",
                    second_err
                )),
            }
        }
    }
}

/// 描述：执行模型动作并返回消息与输出路径，兼容现有流程调用。
fn execute_model_tool_with_bridge_upgrade(
    action: ModelToolAction,
    params: serde_json::Value,
    blender_bridge_addr: Option<String>,
) -> Result<(String, Option<String>), String> {
    execute_model_tool_result_with_bridge_upgrade(action, params, blender_bridge_addr)
        .map(|result| (result.message, result.output_path))
}

/// 描述：在规划前读取当前选择上下文，供“这个物体”类指令做安全预检查。
fn fetch_selection_context_snapshot(
    blender_bridge_addr: Option<String>,
) -> Result<SelectionContextSnapshot, String> {
    let result = execute_model_tool_result_with_bridge_upgrade(
        ModelToolAction::GetSelectionContext,
        json!({}),
        blender_bridge_addr,
    )?;
    Ok(parse_selection_context_snapshot(&result.data))
}

#[tauri::command]
async fn run_model_session_command(
    app: tauri::AppHandle,
    store: tauri::State<'_, ModelSessionStore>,
    session_id: String,
    prompt: String,
    provider: Option<String>,
    trace_id: Option<String>,
    project_name: Option<String>,
    capabilities: Option<ModelMcpCapabilities>,
    output_dir: Option<String>,
    blender_bridge_addr: Option<String>,
    confirmation_token: Option<String>,
) -> Result<ModelSessionRunResponse, DesktopProtocolError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_model_session_command_inner(
            app,
            store,
            session_id,
            prompt,
            provider,
            trace_id,
            project_name,
            capabilities,
            output_dir,
            blender_bridge_addr,
            confirmation_token,
        )
    })
    .await
    .map_err(|err| DesktopProtocolError {
        code: "core.desktop.model.task_join_failed".to_string(),
        message: format!("model session task join failed: {}", err),
        suggestion: Some("请重试一次；如仍失败请重启应用".to_string()),
        retryable: true,
    })?
}

fn run_model_session_command_inner(
    app: tauri::AppHandle,
    store: ModelSessionStore,
    session_id: String,
    prompt: String,
    provider: Option<String>,
    trace_id: Option<String>,
    project_name: Option<String>,
    capabilities: Option<ModelMcpCapabilities>,
    output_dir: Option<String>,
    blender_bridge_addr: Option<String>,
    confirmation_token: Option<String>,
) -> Result<ModelSessionRunResponse, DesktopProtocolError> {
    let trace_id = trace_id.unwrap_or_else(|| format!("trace-{}", now_millis()));
    let normalized_prompt = prompt.trim();
    if normalized_prompt.is_empty() {
        return Err(DesktopProtocolError {
            code: "core.desktop.model.prompt_empty".to_string(),
            message: "prompt cannot be empty".to_string(),
            suggestion: Some("请输入具体的模型操作指令".to_string()),
            retryable: false,
        });
    }
    let capabilities = capabilities.unwrap_or_default();
    let core_capabilities = to_core_capability_matrix(&capabilities);
    let output_dir = normalize_output_dir_for_model(&app, output_dir).map_err(|err| {
        desktop_error_from_text(&err, "core.desktop.model.output_dir_invalid", false)
    })?;
    let output_dir_string = output_dir.to_string_lossy().to_string();
    let current_dir = env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let normalized_provider = provider
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "codex".to_string());
    let prompt_lower = normalized_prompt.to_lowercase();
    let mut planner_selection_snapshot: Option<SelectionContextSnapshot> = None;

    {
        let mut map = store.sessions.lock().map_err(|_| store_lock_error())?;
        let session = map.entry(session_id.clone()).or_default();
        session.cancelled = false;
        session.last_prompt = Some(normalized_prompt.to_string());
        session.last_provider = Some(normalized_provider.clone());
        session.last_output_dir = Some(output_dir_string.clone());
    }
    emit_model_session_stream_event(
        &app,
        ModelSessionStreamEvent {
            session_id: session_id.clone(),
            trace_id: trace_id.clone(),
            status: "started".to_string(),
            message: format!("模型会话已开始：{}", normalized_prompt),
            step: None,
            event: None,
        },
    );
    emit_model_debug_trace_event(
        &app,
        ModelDebugTraceEvent {
            session_id: session_id.clone(),
            trace_id: trace_id.clone(),
            stage: "session_request".to_string(),
            title: "模型会话请求".to_string(),
            detail: json!({
                "provider": normalized_provider.clone(),
                "prompt": normalized_prompt,
                "output_dir": output_dir_string.clone(),
                "project_name": project_name.clone(),
                "capabilities": {
                    "export": capabilities.export,
                    "scene": capabilities.scene,
                    "transform": capabilities.transform,
                    "geometry": capabilities.geometry,
                    "mesh_opt": capabilities.mesh_opt,
                    "material": capabilities.material,
                    "file": capabilities.file,
                },
            })
            .to_string(),
            timestamp_ms: now_millis(),
        },
    );

    if is_destructive_selection_intent(prompt_lower.as_str()) {
        let required_scope = if has_active_reference_intent(prompt_lower.as_str()) {
            "active"
        } else {
            "selected"
        };
        let snapshot = fetch_selection_context_snapshot(blender_bridge_addr.clone());
        match snapshot {
            Ok(snapshot)
                if should_block_destructive_plan_for_empty_selection(
                    prompt_lower.as_str(),
                    &snapshot,
                ) =>
            {
                let snapshot_active = snapshot.active_object.clone();
                let snapshot_selected = snapshot.selected_objects.clone();
                let snapshot_selected_count = snapshot_selected.len();
                let base_index = {
                    let map = store.sessions.lock().map_err(|_| store_lock_error())?;
                    map.get(&session_id)
                        .map(|state| state.steps.len())
                        .unwrap_or(0)
                };
                let blocked_error = ProtocolError::new(
                    "core.desktop.model.selection_required",
                    "你引用了“这个物体/选中对象”，但当前没有可用选择目标。",
                )
                .with_suggestion("请先在 Blender 中选择目标对象，再点击“重试最近一步”");
                let created_steps = vec![ModelStepRecord {
                    index: base_index,
                    code: "selection_target_confirmation".to_string(),
                    status: ProtocolStepStatus::Manual,
                    elapsed_ms: 0,
                    summary: "执行前检查：需要先选择目标对象".to_string(),
                    error: Some(blocked_error.clone()),
                    data: Some(json!({
                        "trace_id": trace_id,
                        "step_code": "selection_target_confirmation",
                        "operation_kind": "safety",
                        "branch": "primary",
                        "risk_level": "medium",
                        "recoverable": false,
                        "target_mode": required_scope,
                        "target_names": [],
                        "require_selection": true,
                        "selection_snapshot": {
                            "active_object": snapshot_active,
                            "selected_objects": snapshot_selected,
                            "selected_count": snapshot_selected_count,
                        },
                    })),
                }];
                let created_events = vec![ModelEventRecord {
                    event: "selection_target_confirmation_required".to_string(),
                    step_index: Some(base_index),
                    timestamp_ms: now_millis(),
                    message: "selection context missing for destructive prompt".to_string(),
                }];
                let ui_hint = build_selection_required_ui_hint(required_scope, &snapshot);
                let (all_steps, all_events, all_assets) = {
                    let mut map = store.sessions.lock().map_err(|_| store_lock_error())?;
                    let session = map.entry(session_id.clone()).or_default();
                    session.steps.extend(created_steps.clone());
                    session.events.extend(created_events.clone());
                    (
                        session.steps.clone(),
                        session.events.clone(),
                        session.assets.clone(),
                    )
                };
                let response_message =
                    "检测到你引用了当前对象，但尚未选择目标对象，请先选择后重试。".to_string();
                emit_model_session_stream_event(
                    &app,
                    ModelSessionStreamEvent {
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                        status: "manual".to_string(),
                        message: response_message.clone(),
                        step: None,
                        event: None,
                    },
                );
                return Ok(ModelSessionRunResponse {
                    trace_id,
                    message: response_message,
                    steps: all_steps,
                    events: all_events,
                    assets: all_assets,
                    exported_file: None,
                    ui_hint: Some(ui_hint),
                });
            }
            Err(err_text) => {
                let protocol_error = protocol_error_from_text(
                    err_text.as_str(),
                    "core.desktop.model.selection_context_unavailable",
                    true,
                );
                let ui_hint = build_ui_hint_from_protocol_error(&protocol_error);
                let base_index = {
                    let map = store.sessions.lock().map_err(|_| store_lock_error())?;
                    map.get(&session_id)
                        .map(|state| state.steps.len())
                        .unwrap_or(0)
                };
                let created_steps = vec![ModelStepRecord {
                    index: base_index,
                    code: "selection_context_unavailable".to_string(),
                    status: ProtocolStepStatus::Manual,
                    elapsed_ms: 0,
                    summary: "无法读取当前选择上下文".to_string(),
                    error: Some(protocol_error.clone()),
                    data: Some(json!({
                        "trace_id": trace_id,
                        "step_code": "selection_context_unavailable",
                        "operation_kind": "safety",
                        "branch": "primary",
                        "risk_level": "medium",
                        "recoverable": true,
                        "target_mode": required_scope,
                        "target_names": [],
                        "require_selection": true,
                    })),
                }];
                let created_events = vec![ModelEventRecord {
                    event: "selection_context_unavailable".to_string(),
                    step_index: Some(base_index),
                    timestamp_ms: now_millis(),
                    message: protocol_error.message.clone(),
                }];
                let (all_steps, all_events, all_assets) = {
                    let mut map = store.sessions.lock().map_err(|_| store_lock_error())?;
                    let session = map.entry(session_id.clone()).or_default();
                    session.steps.extend(created_steps.clone());
                    session.events.extend(created_events.clone());
                    (
                        session.steps.clone(),
                        session.events.clone(),
                        session.assets.clone(),
                    )
                };
                let response_message =
                    "无法确认当前选择上下文，请先确认 Blender Bridge 可用后再重试。".to_string();
                emit_model_session_stream_event(
                    &app,
                    ModelSessionStreamEvent {
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                        status: "failed".to_string(),
                        message: response_message.clone(),
                        step: None,
                        event: None,
                    },
                );
                return Ok(ModelSessionRunResponse {
                    trace_id,
                    message: response_message,
                    steps: all_steps,
                    events: all_events,
                    assets: all_assets,
                    exported_file: None,
                    ui_hint,
                });
            }
            Ok(snapshot) => {
                planner_selection_snapshot = Some(snapshot);
            }
        }
    }

    if planner_selection_snapshot.is_none() && has_selection_reference_intent(prompt_lower.as_str())
    {
        if let Ok(snapshot) = fetch_selection_context_snapshot(blender_bridge_addr.clone()) {
            planner_selection_snapshot = Some(snapshot);
        }
    }

    let mut planner_debug_observer = |stage: &str, title: &str, detail: &str| {
        emit_model_debug_trace_event(
            &app,
            ModelDebugTraceEvent {
                session_id: session_id.clone(),
                trace_id: trace_id.clone(),
                stage: stage.to_string(),
                title: title.to_string(),
                detail: detail.to_string(),
                timestamp_ms: now_millis(),
            },
        );
    };
    let planned_steps = plan_model_session_steps_with_llm(
        Some(normalized_provider.as_str()),
        normalized_prompt,
        &capabilities,
        current_dir.as_deref(),
        planner_selection_snapshot.as_ref(),
        Some(&mut planner_debug_observer),
    )?;

    if requires_safety_confirmation(&planned_steps) {
        let valid = confirmation_token
            .as_deref()
            .map(|value| validate_safety_confirmation_token(&trace_id, normalized_prompt, value))
            .unwrap_or(false);
        if !valid {
            let base_index = {
                let map = store.sessions.lock().map_err(|_| store_lock_error())?;
                map.get(&session_id)
                    .map(|state| state.steps.len())
                    .unwrap_or(0)
            };
            let ui_hint =
                build_safety_confirmation_ui_hint(&trace_id, normalized_prompt, &planned_steps);
            let created_steps = vec![ModelStepRecord {
                index: base_index,
                code: "safety_confirmation".to_string(),
                status: ProtocolStepStatus::Manual,
                elapsed_ms: 0,
                summary: "检测到高风险复杂操作，等待一次性确认".to_string(),
                error: None,
                data: Some(json!({
                    "trace_id": trace_id,
                    "step_code": "safety_confirmation",
                    "operation_kind": "safety",
                    "branch": "primary",
                    "risk_level": "high",
                    "recoverable": false,
                    "planned_step_count": planned_steps.len(),
                })),
            }];
            let created_events = vec![ModelEventRecord {
                event: "safety_confirmation_required".to_string(),
                step_index: Some(base_index),
                timestamp_ms: now_millis(),
                message: "complex session requires one-time confirmation token".to_string(),
            }];
            let (all_steps, all_events, all_assets) = {
                let mut map = store.sessions.lock().map_err(|_| store_lock_error())?;
                let session = map.entry(session_id.clone()).or_default();
                session.steps.extend(created_steps.clone());
                session.events.extend(created_events.clone());
                (
                    session.steps.clone(),
                    session.events.clone(),
                    session.assets.clone(),
                )
            };
            let response_message = "检测到高风险复杂操作，等待你确认后执行一次。".to_string();
            emit_model_session_stream_event(
                &app,
                ModelSessionStreamEvent {
                    session_id: session_id.clone(),
                    trace_id: trace_id.clone(),
                    status: "manual".to_string(),
                    message: response_message.clone(),
                    step: None,
                    event: None,
                },
            );
            return Ok(ModelSessionRunResponse {
                trace_id,
                message: response_message,
                steps: all_steps,
                events: all_events,
                assets: all_assets,
                exported_file: None,
                ui_hint: Some(ui_hint),
            });
        }
    }

    let mut created_steps: Vec<ModelStepRecord> = Vec::new();
    let mut created_events: Vec<ModelEventRecord> = Vec::new();
    let mut created_assets: Vec<ModelAssetRecord> = Vec::new();
    let mut exported_file: Option<String> = None;
    let fallback_steps: Vec<ModelSessionPlannedStep> = planned_steps
        .iter()
        .filter(|item| item.branch().as_str() == "fallback")
        .cloned()
        .collect();
    let primary_steps: Vec<ModelSessionPlannedStep> = planned_steps
        .iter()
        .filter(|item| item.branch().as_str() == "primary")
        .cloned()
        .collect();
    let mut selection_context_cache: Option<SelectionContextSnapshot> = None;
    let mut topology_face_count_baseline: Option<HashMap<String, u64>> = None;
    let mut operation_transaction_snapshot_path: Option<String> = None;

    if should_create_operation_transaction(&primary_steps) {
        let transaction_snapshot_path = build_operation_transaction_snapshot_path(
            output_dir_string.as_str(),
            session_id.as_str(),
            trace_id.as_str(),
        );
        if let Some(parent) = transaction_snapshot_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let transaction_snapshot_text = transaction_snapshot_path.to_string_lossy().to_string();
        created_events.push(ModelEventRecord {
            event: "operation_transaction_started".to_string(),
            step_index: None,
            timestamp_ms: now_millis(),
            message: "复杂流程事务已开启，准备写入执行前快照。".to_string(),
        });
        match execute_model_tool_result_with_bridge_upgrade(
            ModelToolAction::SaveFile,
            json!({"path": transaction_snapshot_text.clone()}),
            blender_bridge_addr.clone(),
        ) {
            Ok(_) => {
                operation_transaction_snapshot_path = Some(transaction_snapshot_text.clone());
                created_events.push(ModelEventRecord {
                    event: "operation_transaction_snapshot_created".to_string(),
                    step_index: None,
                    timestamp_ms: now_millis(),
                    message: format!("操作事务快照已创建：{}", transaction_snapshot_text),
                });
                created_assets.push(ModelAssetRecord {
                    kind: "operation_transaction_snapshot".to_string(),
                    path: transaction_snapshot_text,
                    version: now_millis() as u64,
                    meta: Some(json!({
                        "trace_id": trace_id,
                        "session_id": session_id,
                        "phase": "before_primary_steps",
                    })),
                });
            }
            Err(err) => {
                created_events.push(ModelEventRecord {
                    event: "operation_transaction_snapshot_skipped".to_string(),
                    step_index: None,
                    timestamp_ms: now_millis(),
                    message: format!("操作事务快照创建失败，继续执行：{}", err),
                });
            }
        }
    }

    if primary_steps.len() >= 3 {
        if let Ok(scene_info) = execute_model_tool_result_with_bridge_upgrade(
            ModelToolAction::ListObjects,
            json!({}),
            blender_bridge_addr.clone(),
        ) {
            let (total_count, mesh_count) = parse_scene_object_metrics(&scene_info.data);
            let estimated_ms = estimate_complex_flow_duration_ms(primary_steps.len(), mesh_count);
            created_events.push(ModelEventRecord {
                event: "performance_estimated".to_string(),
                step_index: None,
                timestamp_ms: now_millis(),
                message: format!(
                    "complex flow estimate: steps={}, objects={}, meshes={}, eta≈{}s",
                    primary_steps.len(),
                    total_count,
                    mesh_count,
                    (estimated_ms / 1000).max(1)
                ),
            });
            if mesh_count >= 200 || primary_steps.len() >= 10 {
                created_events.push(ModelEventRecord {
                    event: "performance_warning".to_string(),
                    step_index: None,
                    timestamp_ms: now_millis(),
                    message: "当前场景规模较大，建议拆分批次执行并提前保存。".to_string(),
                });
            }
        }
    }

    for step in primary_steps {
        {
            let map = store.sessions.lock().map_err(|_| store_lock_error())?;
            let session = map.get(&session_id).ok_or_else(|| DesktopProtocolError {
                code: ERR_SESSION_NOT_FOUND.to_string(),
                message: "session state not found".to_string(),
                suggestion: None,
                retryable: false,
            })?;
            if session.cancelled {
                return Err(DesktopProtocolError {
                    code: "core.desktop.model.cancelled".to_string(),
                    message: "步骤执行已取消".to_string(),
                    suggestion: Some("如需继续，可点击“重试最近一步”重新执行".to_string()),
                    retryable: true,
                });
            }
        }

        check_capability_for_session_step(&core_capabilities, &step).map_err(|err| {
            desktop_error_from_text(
                &err.to_string(),
                "core.desktop.model.capability_disabled",
                false,
            )
        })?;
        let next_index = {
            let map = store.sessions.lock().map_err(|_| store_lock_error())?;
            map.get(&session_id)
                .map(|state| state.steps.len())
                .unwrap_or(0)
        };
        created_events.push(ModelEventRecord {
            event: "step_started".to_string(),
            step_index: Some(next_index),
            timestamp_ms: now_millis(),
            message: format!("step {} started", next_index + 1),
        });
        if let Some(last_event) = created_events.last() {
            emit_model_session_stream_event(
                &app,
                ModelSessionStreamEvent {
                    session_id: session_id.clone(),
                    trace_id: trace_id.clone(),
                    status: "running".to_string(),
                    message: last_event.message.clone(),
                    step: None,
                    event: Some(last_event.clone()),
                },
            );
        }
        created_events.push(ModelEventRecord {
            event: "branch_selected".to_string(),
            step_index: Some(next_index),
            timestamp_ms: now_millis(),
            message: format!(
                "operation={} branch={} risk={}",
                step.operation_kind().as_str(),
                step.branch().as_str(),
                step.risk_level().as_str()
            ),
        });
        if let Some(last_event) = created_events.last() {
            emit_model_session_stream_event(
                &app,
                ModelSessionStreamEvent {
                    session_id: session_id.clone(),
                    trace_id: trace_id.clone(),
                    status: "running".to_string(),
                    message: last_event.message.clone(),
                    step: None,
                    event: Some(last_event.clone()),
                },
            );
        }
        let started = Instant::now();
        let step_code = step.code();
        let step_input = step.input().to_string();
        let step_trace_data = build_step_trace_payload(&step);
        let mut file_recover_point_path: Option<String> = None;
        emit_model_debug_trace_event(
            &app,
            ModelDebugTraceEvent {
                session_id: session_id.clone(),
                trace_id: trace_id.clone(),
                stage: "step_execute_request".to_string(),
                title: format!("执行步骤请求 #{}", next_index + 1),
                detail: json!({
                    "index": next_index,
                    "code": step_code,
                    "input": step_input,
                    "trace_payload": step_trace_data,
                })
                .to_string(),
                timestamp_ms: now_millis(),
            },
        );

        if should_create_file_recover_point_for_step(&step) {
            let recover_point_path = build_file_recover_point_path(
                output_dir_string.as_str(),
                session_id.as_str(),
                trace_id.as_str(),
                next_index,
            );
            if let Some(parent) = recover_point_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let recover_point_text = recover_point_path.to_string_lossy().to_string();
            match execute_model_tool_result_with_bridge_upgrade(
                ModelToolAction::SaveFile,
                json!({"path": recover_point_text.clone()}),
                blender_bridge_addr.clone(),
            ) {
                Ok(_) => {
                    file_recover_point_path = Some(recover_point_text.clone());
                    created_events.push(ModelEventRecord {
                        event: "recover_point_created".to_string(),
                        step_index: Some(next_index),
                        timestamp_ms: now_millis(),
                        message: format!("file recover point created: {}", recover_point_text),
                    });
                    created_assets.push(ModelAssetRecord {
                        kind: "recover_point".to_string(),
                        path: recover_point_text.clone(),
                        version: now_millis() as u64,
                        meta: Some(json!({
                            "trace_id": trace_id,
                            "step_code": step_code.clone(),
                            "step_index": next_index,
                            "session_id": session_id,
                        })),
                    });
                }
                Err(err) => {
                    created_events.push(ModelEventRecord {
                        event: "recover_point_skipped".to_string(),
                        step_index: Some(next_index),
                        timestamp_ms: now_millis(),
                        message: format!("create recover point skipped: {}", err),
                    });
                }
            }
        }

        if let Some(required_scope) =
            required_selection_scope_for_step(prompt_lower.as_str(), &step)
        {
            if selection_context_cache.is_none() {
                if let Ok(selection_result) = execute_model_tool_result_with_bridge_upgrade(
                    ModelToolAction::GetSelectionContext,
                    json!({}),
                    blender_bridge_addr.clone(),
                ) {
                    selection_context_cache =
                        Some(parse_selection_context_snapshot(&selection_result.data));
                }
            }
            if let Some(snapshot) = selection_context_cache.as_ref() {
                if !selection_context_meets_scope(snapshot, required_scope) {
                    let mut blocked_step_data = step_trace_data.clone();
                    if let Some(raw) = blocked_step_data.as_object_mut() {
                        raw.insert("input".to_string(), json!(step_input.clone()));
                        raw.insert("trace_id".to_string(), json!(trace_id.clone()));
                        raw.insert(
                            "selection_guard".to_string(),
                            json!({
                                "required_scope": required_scope,
                                "active_object": snapshot.active_object,
                                "selected_objects": snapshot.selected_objects,
                                "selected_count": snapshot.selected_objects.len(),
                            }),
                        );
                    }
                    let blocked_message = if required_scope == "active" {
                        "当前没有激活可编辑对象，请先在 Blender 中激活（或选中）目标对象。"
                    } else {
                        "当前没有选中可编辑对象，请先在 Blender 中选中目标对象。"
                    };
                    let blocked_error = ProtocolError::new(
                        "core.desktop.model.selection_required",
                        blocked_message,
                    )
                    .with_suggestion("先在 Blender 里完成选择，再点击重试最近一步");
                    created_steps.push(ModelStepRecord {
                        index: next_index,
                        code: step_code.clone(),
                        status: ProtocolStepStatus::Manual,
                        elapsed_ms: started.elapsed().as_millis(),
                        summary: "执行前检查未通过：需要先选择对象".to_string(),
                        error: Some(blocked_error.clone()),
                        data: Some(blocked_step_data),
                    });
                    created_events.push(ModelEventRecord {
                        event: "step_blocked".to_string(),
                        step_index: Some(next_index),
                        timestamp_ms: now_millis(),
                        message: blocked_error.message.clone(),
                    });
                    let (all_steps, all_events, all_assets) = {
                        let mut map = store.sessions.lock().map_err(|_| store_lock_error())?;
                        let session = map.entry(session_id.clone()).or_default();
                        session.steps.extend(created_steps.clone());
                        session.events.extend(created_events.clone());
                        session.assets.extend(created_assets.clone());
                        (
                            session.steps.clone(),
                            session.events.clone(),
                            session.assets.clone(),
                        )
                    };
                    emit_model_session_stream_event(
                        &app,
                        ModelSessionStreamEvent {
                            session_id: session_id.clone(),
                            trace_id: trace_id.clone(),
                            status: "manual".to_string(),
                            message: blocked_error.message.clone(),
                            step: created_steps.last().cloned(),
                            event: created_events.last().cloned(),
                        },
                    );
                    return Ok(ModelSessionRunResponse {
                        trace_id,
                        message: blocked_error.message,
                        steps: all_steps,
                        events: all_events,
                        assets: all_assets,
                        exported_file,
                        ui_hint: Some(build_selection_required_ui_hint(required_scope, snapshot)),
                    });
                }
            }
        }

        let step_result: Result<(String, Option<String>), String> = match &step {
            ModelSessionPlannedStep::Export { format, params, .. } => {
                export_model(ExportModelRequest {
                    project_name: project_name
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("model-project")
                        .to_string(),
                    prompt: normalized_prompt.to_string(),
                    output_dir: output_dir_string.clone(),
                    export_format: Some(*format),
                    export_params: params.as_object().and_then(|raw| {
                        if raw.is_empty() {
                            None
                        } else {
                            Some(params.clone())
                        }
                    }),
                    blender_bridge_addr: blender_bridge_addr.clone(),
                    target: ModelToolTarget::Blender,
                })
                .map(|result| {
                    (
                        format!(
                            "导出成功({})：{}",
                            format.as_str().to_uppercase(),
                            result.exported_file
                        ),
                        Some(result.exported_file),
                    )
                })
                .map_err(|err| err.to_string())
            }
            ModelSessionPlannedStep::Tool { action, params, .. } => {
                execute_model_tool_with_bridge_upgrade(
                    *action,
                    params.clone(),
                    blender_bridge_addr.clone(),
                )
            }
        };

        let elapsed = started.elapsed().as_millis();
        match step_result {
            Ok((summary, output_path)) => {
                emit_model_debug_trace_event(
                    &app,
                    ModelDebugTraceEvent {
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                        stage: "step_execute_result".to_string(),
                        title: format!("执行步骤完成 #{}", next_index + 1),
                        detail: json!({
                            "index": next_index,
                            "code": step_code,
                            "summary": summary.clone(),
                            "elapsed_ms": elapsed,
                            "output_path": output_path.clone(),
                        })
                        .to_string(),
                        timestamp_ms: now_millis(),
                    },
                );
                let mut step_data = step_trace_data.clone();
                if let Some(raw) = step_data.as_object_mut() {
                    raw.insert("input".to_string(), json!(step_input));
                    raw.insert("trace_id".to_string(), json!(trace_id.clone()));
                    raw.insert(
                        "recover_point_path".to_string(),
                        json!(file_recover_point_path.clone()),
                    );
                }
                if let Some(path) = output_path.clone() {
                    if let Some(raw) = step_data.as_object_mut() {
                        raw.insert("exported_file".to_string(), json!(path.clone()));
                    }
                }
                if should_run_topology_check_after_step(&step) {
                    let mut inspect_params = json!({
                        "selected_only": true,
                        "strict": false,
                    });
                    if let Some(baseline) = topology_face_count_baseline.as_ref() {
                        if !baseline.is_empty() {
                            if let Some(raw) = inspect_params.as_object_mut() {
                                raw.insert("baseline_face_counts".to_string(), json!(baseline));
                            }
                        }
                    }
                    match execute_model_tool_result_with_bridge_upgrade(
                        ModelToolAction::InspectMeshTopology,
                        inspect_params,
                        blender_bridge_addr.clone(),
                    ) {
                        Ok(topology_result) => {
                            let topology_data = topology_result.data.clone();
                            if let Some(raw) = step_data.as_object_mut() {
                                raw.insert("topology_check".to_string(), topology_data.clone());
                            }
                            let checked_count = topology_data
                                .get("checked_count")
                                .and_then(|value| value.as_u64())
                                .unwrap_or(0);
                            let issue_count = topology_data
                                .get("issue_count")
                                .and_then(|value| value.as_u64())
                                .unwrap_or(0);
                            let event_name = if issue_count > 0 {
                                "topology_check_warning"
                            } else {
                                "topology_check_passed"
                            };
                            created_events.push(ModelEventRecord {
                                event: event_name.to_string(),
                                step_index: Some(next_index),
                                timestamp_ms: now_millis(),
                                message: format!(
                                    "topology checked {} mesh(es), issues {}",
                                    checked_count, issue_count
                                ),
                            });
                            let baseline = parse_topology_face_count_baseline(&topology_data);
                            if !baseline.is_empty() {
                                topology_face_count_baseline = Some(baseline);
                            }
                        }
                        Err(err) => {
                            created_events.push(ModelEventRecord {
                                event: "topology_check_skipped".to_string(),
                                step_index: Some(next_index),
                                timestamp_ms: now_millis(),
                                message: format!("拓扑检查跳过：{}", err),
                            });
                        }
                    }
                }
                let step_record = ModelStepRecord {
                    index: next_index,
                    code: step_code.clone(),
                    status: ProtocolStepStatus::Success,
                    elapsed_ms: elapsed,
                    summary: summary.clone(),
                    error: None,
                    data: Some(step_data),
                };
                if let Some(path) = output_path.clone() {
                    exported_file = Some(path.clone());
                    let version = {
                        let mut map = store.sessions.lock().map_err(|_| store_lock_error())?;
                        let session =
                            map.get_mut(&session_id)
                                .ok_or_else(|| DesktopProtocolError {
                                    code: ERR_SESSION_NOT_FOUND.to_string(),
                                    message: "session state not found".to_string(),
                                    suggestion: None,
                                    retryable: false,
                                })?;
                        session.version += 1;
                        session.version
                    };
                    created_assets.push(ModelAssetRecord {
                        kind: "exported_model".to_string(),
                        path,
                        version,
                        meta: Some(step_trace_data.clone()),
                    });
                }
                created_events.push(ModelEventRecord {
                    event: "step_finished".to_string(),
                    step_index: Some(next_index),
                    timestamp_ms: now_millis(),
                    message: summary,
                });
                created_steps.push(step_record);
                if let Some(last_step) = created_steps.last() {
                    emit_model_session_stream_event(
                        &app,
                        ModelSessionStreamEvent {
                            session_id: session_id.clone(),
                            trace_id: trace_id.clone(),
                            status: "running".to_string(),
                            message: last_step.summary.clone(),
                            step: Some(last_step.clone()),
                            event: None,
                        },
                    );
                }
                if let Some(last_event) = created_events.last() {
                    emit_model_session_stream_event(
                        &app,
                        ModelSessionStreamEvent {
                            session_id: session_id.clone(),
                            trace_id: trace_id.clone(),
                            status: "running".to_string(),
                            message: last_event.message.clone(),
                            step: None,
                            event: Some(last_event.clone()),
                        },
                    );
                }
                if should_invalidate_selection_context_cache(&step) {
                    selection_context_cache = None;
                }
            }
            Err(err) => {
                let protocol_error =
                    protocol_error_from_text(&err, "core.desktop.model.step_failed", true);
                emit_model_debug_trace_event(
                    &app,
                    ModelDebugTraceEvent {
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                        stage: "step_execute_failed".to_string(),
                        title: format!("执行步骤失败 #{}", next_index + 1),
                        detail: json!({
                            "index": next_index,
                            "code": step_code,
                            "raw_error": err.clone(),
                            "protocol_error": {
                                "code": protocol_error.code.clone(),
                                "message": protocol_error.message.clone(),
                                "retryable": protocol_error.retryable,
                            },
                        })
                        .to_string(),
                        timestamp_ms: now_millis(),
                    },
                );
                let error_category =
                    classify_model_error_category(protocol_error.code.as_str(), err.as_str());
                let mut failed_step_data = step_trace_data.clone();
                if let Some(raw) = failed_step_data.as_object_mut() {
                    raw.insert("input".to_string(), json!(step_input.clone()));
                    raw.insert("trace_id".to_string(), json!(trace_id.clone()));
                    raw.insert("error_code".to_string(), json!(protocol_error.code.clone()));
                    raw.insert(
                        "error_message".to_string(),
                        json!(protocol_error.message.clone()),
                    );
                    raw.insert("raw_error_message".to_string(), json!(err.clone()));
                    raw.insert("error_category".to_string(), json!(error_category));
                    raw.insert("error_attribution".to_string(), json!(step.code()));
                }
                let step_record = ModelStepRecord {
                    index: next_index,
                    code: step_code.clone(),
                    status: ProtocolStepStatus::Failed,
                    elapsed_ms: elapsed,
                    summary: "执行失败".to_string(),
                    error: Some(protocol_error.clone()),
                    data: Some(failed_step_data),
                };
                created_events.push(ModelEventRecord {
                    event: "step_failed".to_string(),
                    step_index: Some(next_index),
                    timestamp_ms: now_millis(),
                    message: protocol_error.message.clone(),
                });
                created_steps.push(step_record.clone());
                emit_model_session_stream_event(
                    &app,
                    ModelSessionStreamEvent {
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                        status: "failed".to_string(),
                        message: protocol_error.message.clone(),
                        step: Some(step_record.clone()),
                        event: created_events.last().cloned(),
                    },
                );

                let mut recovery_summary = String::new();
                if let Some(recover_path) = file_recover_point_path.clone() {
                    if matches!(
                        step,
                        ModelSessionPlannedStep::Tool {
                            action: ModelToolAction::NewFile
                                | ModelToolAction::OpenFile
                                | ModelToolAction::SaveFile,
                            ..
                        }
                    ) {
                        if let Ok((restore_msg, _)) = execute_model_tool_with_bridge_upgrade(
                            ModelToolAction::OpenFile,
                            json!({"path": recover_path}),
                            blender_bridge_addr.clone(),
                        ) {
                            created_events.push(ModelEventRecord {
                                event: "recover_point_restored".to_string(),
                                step_index: Some(next_index),
                                timestamp_ms: now_millis(),
                                message: restore_msg,
                            });
                            recovery_summary = "已自动恢复到操作前文件快照。".to_string();
                        }
                    }
                }
                if let Some(transaction_snapshot_path) = operation_transaction_snapshot_path.clone()
                {
                    match execute_model_tool_with_bridge_upgrade(
                        ModelToolAction::OpenFile,
                        json!({"path": transaction_snapshot_path}),
                        blender_bridge_addr.clone(),
                    ) {
                        Ok((restore_msg, _)) => {
                            created_events.push(ModelEventRecord {
                                event: "operation_transaction_rollback_applied".to_string(),
                                step_index: Some(next_index),
                                timestamp_ms: now_millis(),
                                message: restore_msg,
                            });
                            recovery_summary = if recovery_summary.is_empty() {
                                "已恢复到事务起点快照。".to_string()
                            } else {
                                format!("{} 并恢复到事务起点快照。", recovery_summary)
                            };
                        }
                        Err(restore_err) => {
                            created_events.push(ModelEventRecord {
                                event: "operation_transaction_rollback_failed".to_string(),
                                step_index: Some(next_index),
                                timestamp_ms: now_millis(),
                                message: format!("事务快照回滚失败：{}", restore_err),
                            });
                        }
                    }
                }
                if step.recoverable() {
                    created_events.push(ModelEventRecord {
                        event: "rollback_started".to_string(),
                        step_index: Some(next_index),
                        timestamp_ms: now_millis(),
                        message: "主步骤失败，开始执行自动回滚".to_string(),
                    });
                    if let Ok((rollback_msg, _)) = execute_model_tool_with_bridge_upgrade(
                        ModelToolAction::Undo,
                        json!({}),
                        blender_bridge_addr.clone(),
                    ) {
                        let rollback_index = next_index + 1;
                        created_steps.push(ModelStepRecord {
                            index: rollback_index,
                            code: "rollback_undo".to_string(),
                            status: ProtocolStepStatus::Success,
                            elapsed_ms: 0,
                            summary: rollback_msg.clone(),
                            error: None,
                            data: Some(json!({
                                "trace_id": trace_id,
                                "operation_kind": step.operation_kind().as_str(),
                                "branch": "fallback",
                                "risk_level": "low",
                                "recoverable": false,
                                "rollback_of": step_code,
                                "condition": "on_primary_failed",
                            })),
                        });
                        created_events.push(ModelEventRecord {
                            event: "rollback_finished".to_string(),
                            step_index: Some(rollback_index),
                            timestamp_ms: now_millis(),
                            message: "自动回滚完成".to_string(),
                        });
                        recovery_summary = if recovery_summary.is_empty() {
                            "已自动执行 Undo 回滚。".to_string()
                        } else {
                            format!("{} 并执行了 Undo 回滚。", recovery_summary)
                        };
                    } else {
                        created_events.push(ModelEventRecord {
                            event: "rollback_failed".to_string(),
                            step_index: Some(next_index),
                            timestamp_ms: now_millis(),
                            message: "自动回滚失败".to_string(),
                        });
                    }
                }

                for fallback_step in fallback_steps.clone() {
                    if fallback_step.condition() != Some("on_primary_failed") {
                        continue;
                    }
                    if let ModelSessionPlannedStep::Tool { action, params, .. } = fallback_step {
                        let _ = execute_model_tool_with_bridge_upgrade(
                            action,
                            params,
                            blender_bridge_addr.clone(),
                        );
                    }
                }

                let (all_steps, all_events, all_assets) = {
                    let mut map = store.sessions.lock().map_err(|_| store_lock_error())?;
                    let session = map.entry(session_id.clone()).or_default();
                    session.steps.extend(created_steps.clone());
                    session.events.extend(created_events.clone());
                    session.assets.extend(created_assets.clone());
                    (
                        session.steps.clone(),
                        session.events.clone(),
                        session.assets.clone(),
                    )
                };

                let ui_hint = if step.recoverable() {
                    Some(build_recovery_ui_hint(&step, &protocol_error))
                } else {
                    build_ui_hint_from_protocol_error(&protocol_error)
                };
                let failure_message = format!(
                    "工作流在步骤 `{}` 失败：{} {}",
                    step.code(),
                    protocol_error.message,
                    recovery_summary
                );
                emit_model_session_stream_event(
                    &app,
                    ModelSessionStreamEvent {
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                        status: "failed".to_string(),
                        message: failure_message.clone(),
                        step: None,
                        event: None,
                    },
                );

                return Ok(ModelSessionRunResponse {
                    trace_id,
                    message: failure_message,
                    steps: all_steps,
                    events: all_events,
                    assets: all_assets,
                    exported_file,
                    ui_hint,
                });
            }
        }
    }

    if operation_transaction_snapshot_path.is_some() {
        created_events.push(ModelEventRecord {
            event: "operation_transaction_committed".to_string(),
            step_index: None,
            timestamp_ms: now_millis(),
            message: "复杂流程主链路执行完成，事务已提交。".to_string(),
        });
    }

    let (all_steps, all_events, all_assets) = {
        let mut map = store.sessions.lock().map_err(|_| store_lock_error())?;
        let session = map.entry(session_id.clone()).or_default();
        session.steps.extend(created_steps.clone());
        session.events.extend(created_events.clone());
        session.assets.extend(created_assets.clone());
        (
            session.steps.clone(),
            session.events.clone(),
            session.assets.clone(),
        )
    };

    let message = created_steps
        .iter()
        .map(|step| {
            format!(
                "- [{}] {}（{}ms）",
                step.code, step.summary, step.elapsed_ms
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let _ = app.emit(
        EVENT_AGENT_LOG,
        AgentLogEvent {
            trace_id: trace_id.clone(),
            level: "info".to_string(),
            stage: "model-session".to_string(),
            message: format!("session={}, steps={}", session_id, created_steps.len()),
        },
    );
    emit_model_session_stream_event(
        &app,
        ModelSessionStreamEvent {
            session_id: session_id.clone(),
            trace_id: trace_id.clone(),
            status: "finished".to_string(),
            message: message.clone(),
            step: None,
            event: None,
        },
    );
    emit_model_debug_trace_event(
        &app,
        ModelDebugTraceEvent {
            session_id: session_id.clone(),
            trace_id: trace_id.clone(),
            stage: "session_finished".to_string(),
            title: "模型会话完成".to_string(),
            detail: json!({
                "step_count": created_steps.len(),
                "event_count": created_events.len(),
                "asset_count": created_assets.len(),
                "exported_file": exported_file.clone(),
                "message": message.clone(),
            })
            .to_string(),
            timestamp_ms: now_millis(),
        },
    );

    Ok(ModelSessionRunResponse {
        trace_id,
        message,
        steps: all_steps,
        events: all_events,
        assets: all_assets,
        exported_file,
        ui_hint: None,
    })
}

#[tauri::command]
async fn retry_model_session_last_step(
    app: tauri::AppHandle,
    store: tauri::State<'_, ModelSessionStore>,
    session_id: String,
    trace_id: Option<String>,
    project_name: Option<String>,
    capabilities: Option<ModelMcpCapabilities>,
    blender_bridge_addr: Option<String>,
) -> Result<ModelSessionRunResponse, DesktopProtocolError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        retry_model_session_last_step_inner(
            app,
            store,
            session_id,
            trace_id,
            project_name,
            capabilities,
            blender_bridge_addr,
        )
    })
    .await
    .map_err(|err| DesktopProtocolError {
        code: "core.desktop.model.retry_task_join_failed".to_string(),
        message: format!("retry model session task join failed: {}", err),
        suggestion: Some("请重试一次；如仍失败请重启应用".to_string()),
        retryable: true,
    })?
}

fn retry_model_session_last_step_inner(
    app: tauri::AppHandle,
    store: ModelSessionStore,
    session_id: String,
    trace_id: Option<String>,
    project_name: Option<String>,
    capabilities: Option<ModelMcpCapabilities>,
    blender_bridge_addr: Option<String>,
) -> Result<ModelSessionRunResponse, DesktopProtocolError> {
    let (last_prompt, last_provider, last_output_dir) = {
        let map = store.sessions.lock().map_err(|_| store_lock_error())?;
        let state = map.get(&session_id).ok_or_else(|| DesktopProtocolError {
            code: ERR_SESSION_NOT_FOUND.to_string(),
            message: "会话不存在，无法重试".to_string(),
            suggestion: None,
            retryable: false,
        })?;
        (
            state
                .last_prompt
                .clone()
                .ok_or_else(|| DesktopProtocolError {
                    code: "core.desktop.model.retry_not_available".to_string(),
                    message: "暂无可重试步骤".to_string(),
                    suggestion: None,
                    retryable: false,
                })?,
            state.last_provider.clone(),
            state.last_output_dir.clone(),
        )
    };

    run_model_session_command_inner(
        app,
        store,
        session_id,
        last_prompt,
        last_provider,
        trace_id,
        project_name,
        capabilities,
        last_output_dir,
        blender_bridge_addr,
        None,
    )
}

#[tauri::command]
async fn undo_model_session_step(
    app: tauri::AppHandle,
    store: tauri::State<'_, ModelSessionStore>,
    session_id: String,
    trace_id: Option<String>,
    blender_bridge_addr: Option<String>,
) -> Result<ModelSessionRunResponse, DesktopProtocolError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        undo_model_session_step_inner(app, store, session_id, trace_id, blender_bridge_addr)
    })
    .await
    .map_err(|err| DesktopProtocolError {
        code: "core.desktop.model.undo_task_join_failed".to_string(),
        message: format!("undo model session task join failed: {}", err),
        suggestion: Some("请重试一次；如仍失败请重启应用".to_string()),
        retryable: true,
    })?
}

fn undo_model_session_step_inner(
    app: tauri::AppHandle,
    store: ModelSessionStore,
    session_id: String,
    trace_id: Option<String>,
    blender_bridge_addr: Option<String>,
) -> Result<ModelSessionRunResponse, DesktopProtocolError> {
    run_model_session_command_inner(
        app,
        store,
        session_id,
        "撤销".to_string(),
        None,
        trace_id,
        Some("undo-operation".to_string()),
        Some(ModelMcpCapabilities {
            file: Some(true),
            ..ModelMcpCapabilities::default()
        }),
        None,
        blender_bridge_addr,
        None,
    )
}

#[tauri::command]
fn cancel_model_session_step(
    store: tauri::State<ModelSessionStore>,
    session_id: String,
) -> Result<bool, String> {
    let mut map = store
        .sessions
        .lock()
        .map_err(|_| "model session store lock poisoned".to_string())?;
    let session = map.entry(session_id).or_default();
    session.cancelled = true;
    Ok(true)
}

#[tauri::command]
fn get_model_session_records(
    store: tauri::State<ModelSessionStore>,
    session_id: String,
) -> Result<ModelSessionRunResponse, String> {
    let map = store
        .sessions
        .lock()
        .map_err(|_| "model session store lock poisoned".to_string())?;
    let session = map
        .get(&session_id)
        .ok_or_else(|| "会话不存在".to_string())?;
    Ok(ModelSessionRunResponse {
        trace_id: "".to_string(),
        message: "".to_string(),
        steps: session.steps.clone(),
        events: session.events.clone(),
        assets: session.assets.clone(),
        exported_file: session.assets.last().map(|item| item.path.clone()),
        ui_hint: None,
    })
}

/// 描述：构建“模型执行总结”请求 Prompt，提供给 LLM 生成面向用户的最终说明。
fn build_model_session_summary_prompt(
    user_prompt: &str,
    workflow_message: Option<&str>,
    model_steps: &[ModelStepRecord],
    model_events: &[ModelEventRecord],
    exported_file: Option<&str>,
    bridge_warning: Option<&str>,
) -> String {
    let step_payload = model_steps
        .iter()
        .map(|item| {
            json!({
                "index": item.index,
                "code": item.code,
                "status": item.status,
                "elapsed_ms": item.elapsed_ms,
                "summary": item.summary,
                "error": item.error.as_ref().map(|err| err.message.clone()),
            })
        })
        .collect::<Vec<_>>();
    let event_payload = model_events
        .iter()
        .rev()
        .take(80)
        .map(|item| {
            json!({
                "event": item.event,
                "step_index": item.step_index,
                "message": item.message,
                "timestamp_ms": item.timestamp_ms,
            })
        })
        .collect::<Vec<_>>();
    let workflow_message = workflow_message.unwrap_or("");
    let exported_file = exported_file.unwrap_or("");
    let bridge_warning = bridge_warning.unwrap_or("");

    format!(
        "你是 3D 建模助手的总结器。请根据执行记录输出“给终端用户看的总结”，要求：\n\
1) 使用中文；\n\
2) 重点写“具体做了什么”和“结果是什么”；\n\
3) 不要输出内部实现术语（例如 workflow 节点名、trace id）；\n\
4) 若有失败或风险，明确指出；\n\
5) 保持简洁，建议 6-12 行。\n\
\n\
请按以下结构输出：\n\
已完成内容：\n\
- ...\n\
执行结果：\n\
- 成功/失败统计与关键产物\n\
后续建议：\n\
- 若一切成功可写“无需额外操作”；若有异常给出下一步。\n\
\n\
用户原始需求：\n\
{user_prompt}\n\
\n\
工作流消息：\n\
{workflow_message}\n\
\n\
步骤记录(JSON)：\n\
{step_json}\n\
\n\
事件记录(JSON)：\n\
{event_json}\n\
\n\
导出文件：\n\
{exported_file}\n\
\n\
环境提示：\n\
{bridge_warning}\n",
        user_prompt = user_prompt,
        workflow_message = workflow_message,
        step_json =
            serde_json::to_string_pretty(&step_payload).unwrap_or_else(|_| "[]".to_string()),
        event_json =
            serde_json::to_string_pretty(&event_payload).unwrap_or_else(|_| "[]".to_string()),
        exported_file = exported_file,
        bridge_warning = bridge_warning,
    )
}

/// 描述：调用 LLM 生成模型执行总结，输出给前端会话最终结果展示。
#[tauri::command]
async fn summarize_model_session_result(
    provider: Option<String>,
    user_prompt: String,
    workflow_message: Option<String>,
    model_steps: Vec<ModelStepRecord>,
    model_events: Vec<ModelEventRecord>,
    exported_file: Option<String>,
    bridge_warning: Option<String>,
) -> Result<ModelSessionAiSummaryResponse, DesktopProtocolError> {
    tauri::async_runtime::spawn_blocking(move || {
        summarize_model_session_result_inner(
            provider,
            user_prompt,
            workflow_message,
            model_steps,
            model_events,
            exported_file,
            bridge_warning,
        )
    })
    .await
    .map_err(|err| DesktopProtocolError {
        code: "core.desktop.model.summary_task_join_failed".to_string(),
        message: format!("summary task join failed: {}", err),
        suggestion: Some("请重试一次；若仍失败将自动回退规则总结".to_string()),
        retryable: true,
    })?
}

/// 描述：模型执行总结命令核心实现，负责组织 Prompt 并调用 LLM。
fn summarize_model_session_result_inner(
    provider: Option<String>,
    user_prompt: String,
    workflow_message: Option<String>,
    model_steps: Vec<ModelStepRecord>,
    model_events: Vec<ModelEventRecord>,
    exported_file: Option<String>,
    bridge_warning: Option<String>,
) -> Result<ModelSessionAiSummaryResponse, DesktopProtocolError> {
    let summary_prompt = build_model_session_summary_prompt(
        user_prompt.as_str(),
        workflow_message.as_deref(),
        model_steps.as_slice(),
        model_events.as_slice(),
        exported_file.as_deref(),
        bridge_warning.as_deref(),
    );
    let provider_name = provider
        .unwrap_or_else(|| "codex".to_string())
        .trim()
        .to_string();
    let parsed_provider = parse_provider(provider_name.as_str());
    let workdir = env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let raw_response = call_model(parsed_provider, summary_prompt.as_str(), workdir.as_deref())
        .map_err(|err| DesktopProtocolError::from(err.to_protocol_error()))?;
    let summary = raw_response.content.trim().to_string();
    if summary.is_empty() {
        return Err(DesktopProtocolError {
            code: "core.desktop.model.summary_empty".to_string(),
            message: "summary model returned empty response".to_string(),
            suggestion: Some("请重试一次；若仍失败将自动回退规则总结".to_string()),
            retryable: true,
        });
    }
    Ok(ModelSessionAiSummaryResponse {
        summary,
        prompt: summary_prompt,
        raw_response: raw_response.content,
        provider: provider_name,
    })
}

/// 描述：为主窗口应用系统材质效果，提升 Desktop 端玻璃质感表现。
///
/// Params:
///
///   - app: Tauri 应用句柄。
fn apply_main_window_effects(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(err) = window.set_background_color(None) {
        eprintln!("clear webview window background color failed: {}", err);
    }

    #[cfg(target_os = "macos")]
    {
        let effects = EffectsBuilder::new()
            .effect(Effect::HudWindow)
            .state(EffectState::Active)
            .build();
        if let Err(err) = window.set_effects(effects) {
            eprintln!("apply macOS window effects failed: {}", err);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let effects = EffectsBuilder::new().effect(Effect::Acrylic).build();
        if let Err(err) = window.set_effects(effects) {
            eprintln!("apply Windows window effects failed: {}", err);
        }
    }
}

#[tauri::command]
fn get_agent_sandbox_metrics(
    session_id: String,
) -> Result<Option<zodileap_agent_core::sandbox::SandboxMetrics>, String> {
    Ok(zodileap_agent_core::sandbox::SANDBOX_REGISTRY.get_metrics(&session_id))
}

#[tauri::command]
fn reset_agent_sandbox(session_id: String) -> Result<(), String> {
    zodileap_agent_core::sandbox::SANDBOX_REGISTRY.reset(&session_id);
    Ok(())
}

#[tauri::command]
fn cancel_agent_session(app: tauri::AppHandle, session_id: String) -> Result<bool, String> {
    mark_agent_session_cancelled(&session_id);
    zodileap_agent_core::sandbox::SANDBOX_REGISTRY.reset(&session_id);
    emit_agent_text_stream_event(
        &app,
        AgentTextStreamEvent {
            trace_id: format!("cancel-{}", now_millis()),
            session_id: Some(session_id),
            // 描述：复用 Core AgentStreamEvent 的 kind 映射，避免手写字符串。
            kind: "cancelled".to_string(),
            message: "任务已取消（用户主动终止）".to_string(),
            delta: None,
            data: Some(json!({ "code": "core.agent.request_cancelled" })),
        },
    );
    Ok(true)
}

#[tauri::command]
fn approve_agent_action(id: String, approved: bool) -> Result<bool, String> {
    let outcome = if approved {
        zodileap_agent_core::ApprovalOutcome::Approved
    } else {
        zodileap_agent_core::ApprovalOutcome::Rejected
    };
    let ok = zodileap_agent_core::APPROVAL_REGISTRY.submit_decision(&id, outcome);
    Ok(ok)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            apply_main_window_effects(app.handle());
            Ok(())
        })
        .manage(ModelSessionStore::default())
        .invoke_handler(tauri::generate_handler![
            export_model_command,
            install_blender_bridge,
            check_blender_bridge,
            run_agent_command,
            check_codex_cli_health,
            check_gemini_cli_health,
            check_git_cli_health,
            check_python_cli_health,
            check_apifox_mcp_runtime_status,
            install_apifox_mcp_runtime,
            uninstall_apifox_mcp_runtime,
            pick_local_project_folder,
            open_external_url,
            clone_git_repository,
            check_project_dependency_rules,
            apply_project_dependency_rule_upgrades,
            inspect_code_workspace_profile_seed,
            run_model_session_command,
            retry_model_session_last_step,
            undo_model_session_step,
            cancel_model_session_step,
            get_model_session_records,
            summarize_model_session_result,
            approve_agent_action,
            reset_agent_sandbox,
            cancel_agent_session,
            get_agent_sandbox_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running zodileap_agen_desktop");
}

#[cfg(test)]
mod tests {
    use super::{
        blender_series_supports_extension, bridge_boot_script_content, bridge_enable_and_save_expr,
        build_file_recover_point_path, build_model_plan_prompt, build_model_plan_retry_prompt,
        build_operation_transaction_snapshot_path, build_ui_hint_from_protocol_error,
        classify_model_error_category, convert_rule_plan_steps, detect_ambiguous_target_plan,
        estimate_complex_flow_duration_ms, is_bridge_unavailable_error,
        is_destructive_selection_intent, parse_llm_model_plan, parse_scene_object_metrics,
        parse_selection_context_snapshot, parse_target_names_in_prompt,
        parse_topology_face_count_baseline, plan_model_session_steps_with_llm, plan_model_steps,
        protocol_error_from_text, required_selection_scope_for_step, selection_context_meets_scope,
        should_block_destructive_plan_for_empty_selection,
        should_create_file_recover_point_for_step, should_create_operation_transaction,
        should_run_topology_check_after_step, split_error_code_and_message,
        validate_llm_model_plan_steps, ModelMcpCapabilities, PlannedModelStep,
        SelectionContextSnapshot,
    };
    use serde_json::json;
    use zodileap_mcp_common::ProtocolError;
    use zodileap_mcp_model::{
        ExportModelFormat, ModelPlanBranch, ModelPlanOperationKind, ModelPlanRiskLevel,
        ModelSessionPlannedStep, ModelToolAction,
    };

    #[test]
    fn add_cube_should_not_trigger_export() {
        let steps = plan_model_steps("在当前对话中，添加一个正方体");
        let has_export = steps
            .iter()
            .any(|step| matches!(step, PlannedModelStep::Export { .. }));
        let has_add_cube = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, .. } if action.as_str() == "add_cube"
            )
        });

        assert!(!has_export, "添加正方体不应自动触发导出");
        assert!(has_add_cube, "添加正方体应路由到 add_cube 动作");
    }

    #[test]
    fn export_keyword_should_trigger_export() {
        let steps = plan_model_steps("请把当前模型导出到 /tmp/exports");
        let has_export = steps
            .iter()
            .any(|step| matches!(step, PlannedModelStep::Export { .. }));
        assert!(has_export, "用户明确要求导出时应触发导出动作");
    }

    #[test]
    fn export_keyword_should_parse_export_format_and_params() {
        let steps = plan_model_steps("请仅导出选中对象为 FBX，并且不应用修改器");
        let has_fbx_export = steps.iter().any(|step| {
            if let PlannedModelStep::Export { format, params, .. } = step {
                return *format == ExportModelFormat::Fbx
                    && params
                        .get("use_selection")
                        .and_then(|value| value.as_bool())
                        == Some(true)
                    && params
                        .get("apply_modifiers")
                        .and_then(|value| value.as_bool())
                        == Some(false);
            }
            false
        });
        assert!(has_fbx_export);
    }

    #[test]
    fn should_convert_rule_steps_to_session_steps() {
        let steps = convert_rule_plan_steps(vec![
            PlannedModelStep::Tool {
                action: ModelToolAction::TranslateObjects,
                input: "平移对象".to_string(),
                params: json!({"delta":[0.5,0.0,0.0],"selection_scope":"active"}),
            },
            PlannedModelStep::Export {
                input: "导出 FBX".to_string(),
                format: ExportModelFormat::Fbx,
                params: json!({"use_selection": true}),
            },
        ]);
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].branch().as_str(), "primary");
        assert_eq!(steps[0].operation_kind().as_str(), "batch_transform");
        assert_eq!(steps[1].code(), "export_fbx");
    }

    #[test]
    fn should_prefer_rule_planner_before_llm_json() {
        let mut debug_events: Vec<(String, String)> = Vec::new();
        let mut observer = |stage: &str, _title: &str, detail: &str| {
            debug_events.push((stage.to_string(), detail.to_string()));
        };
        let planned = plan_model_session_steps_with_llm(
            Some("codex"),
            "在当前对话中，添加一个正方体",
            &ModelMcpCapabilities::default(),
            None,
            None,
            Some(&mut observer),
        );
        let planned = match planned {
            Ok(steps) => steps,
            Err(_) => panic!("rule planner should provide executable steps"),
        };
        assert!(
            planned.iter().any(|step| step.code() == "add_cube"),
            "规则规划应命中 add_cube"
        );
        assert!(
            debug_events
                .iter()
                .any(|(stage, detail)| stage == "planner_source" && detail == "rule"),
            "命中规则规划时应标记 planner_source=rule"
        );
    }

    #[test]
    fn should_split_protocol_error_text() {
        let (code, message) = split_error_code_and_message(
            "mcp.model.export.invalid_bridge_addr: invalid bridge addr `127.0.0.1:notaport`",
            "fallback.code",
        );
        assert_eq!(code, "mcp.model.export.invalid_bridge_addr");
        assert!(message.contains("invalid bridge addr"));
    }

    #[test]
    fn should_classify_model_error_category() {
        assert_eq!(
            classify_model_error_category("mcp.model.bridge.action_failed", "connection refused"),
            "bridge"
        );
        assert_eq!(
            classify_model_error_category("core.desktop.model.step_failed", "no_target_object"),
            "scene_state"
        );
        assert_eq!(
            classify_model_error_category(
                "mcp.model.tool.invalid_args",
                "apply_texture_image requires path"
            ),
            "parameter"
        );
    }

    #[test]
    fn should_build_user_friendly_protocol_error_from_text() {
        let error = protocol_error_from_text(
            "mcp.model.tool.invalid_args: scale_objects factor must be number",
            "core.desktop.model.step_failed",
            true,
        );
        assert!(error.message.contains("参数无效"));
        assert!(error
            .suggestion
            .as_deref()
            .unwrap_or("")
            .contains("参数范围"));
        assert!(!error.retryable);
    }

    #[test]
    fn should_build_bridge_ui_hint_from_protocol_error() {
        let error = ProtocolError::new(
            "mcp.model.export.invalid_bridge_addr",
            "invalid bridge addr",
        );
        let ui_hint = build_ui_hint_from_protocol_error(&error).expect("must have ui hint");
        assert_eq!(ui_hint.key, "restart-blender-bridge");
        assert!(!ui_hint.actions.is_empty());
    }

    #[test]
    fn should_build_selection_required_ui_hint_from_protocol_error() {
        let error = ProtocolError::new(
            "core.desktop.model.step_failed",
            "[no_target_object] translate_objects: no selected mesh objects found",
        );
        let ui_hint = build_ui_hint_from_protocol_error(&error).expect("must have ui hint");
        assert_eq!(ui_hint.key, "selection-required");
        assert!(!ui_hint.actions.is_empty());
    }

    #[test]
    fn should_build_parameter_ui_hint_from_friendly_error() {
        let error = protocol_error_from_text(
            "mcp.model.tool.invalid_args: apply_texture_image requires path",
            "core.desktop.model.step_failed",
            true,
        );
        let ui_hint = build_ui_hint_from_protocol_error(&error).expect("must have ui hint");
        assert_eq!(ui_hint.key, "check-params");
    }

    #[test]
    fn should_detect_bridge_unavailable_error() {
        assert!(is_bridge_unavailable_error(
            "mcp.model.export.bridge_connect_failed: cannot connect blender bridge"
        ));
        assert!(!is_bridge_unavailable_error(
            "mcp.model.bridge.action_failed: unsupported action"
        ));
    }

    #[test]
    fn should_include_save_userpref_in_boot_script() {
        let script = bridge_boot_script_content();
        assert!(script.contains("addon_utils.enable"));
        assert!(script.contains("save_userpref"));
    }

    #[test]
    fn should_include_save_userpref_in_background_enable_script() {
        let script = bridge_enable_and_save_expr();
        assert!(script.contains("addon_utils.enable"));
        assert!(script.contains("save_userpref"));
        assert!(script.contains("persistent=True"));
    }

    #[test]
    fn should_detect_extension_supported_series() {
        assert!(!blender_series_supports_extension("4.1"));
        assert!(blender_series_supports_extension("4.2"));
        assert!(blender_series_supports_extension("5.0"));
    }

    #[test]
    fn should_plan_apply_texture_image_step() {
        let steps = plan_model_steps(
            "我发现场景地板的贴图缺失了，能用“/Users/yoho/Downloads/image.png”添加吗",
        );
        let has_apply_texture = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, .. } if action.as_str() == "apply_texture_image"
            )
        });
        assert!(
            has_apply_texture,
            "贴图补图请求应路由到 apply_texture_image 动作"
        );
    }

    #[test]
    fn should_plan_apply_texture_image_step_with_quoted_space_path() {
        let steps = plan_model_steps(
            "我发现场景地板的贴图缺失了，能用“ /Users/yoho/Downloads/image.png”添加吗",
        );
        let has_apply_texture = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, .. } if action.as_str() == "apply_texture_image"
            )
        });
        assert!(
            has_apply_texture,
            "带空格引号路径也应路由到 apply_texture_image 动作"
        );
    }

    #[test]
    fn should_plan_apply_texture_with_selection_scope_for_selected_reference() {
        let steps = plan_model_steps("给这个物体应用贴图“/Users/yoho/Downloads/image.png”");
        let has_scoped_apply = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, params, .. }
                if action.as_str() == "apply_texture_image"
                    && matches!(
                        params.get("selection_scope").and_then(|value| value.as_str()),
                        Some("active" | "selected")
                    )
                    && params.get("require_selection").and_then(|value| value.as_bool()) == Some(true)
            )
        });
        assert!(has_scoped_apply, "引用这个物体贴图时应补齐 selection_scope");
    }

    #[test]
    fn should_plan_translate_selected_object_step() {
        let steps = plan_model_steps("对这个物体平移 0.5");
        let has_translate_selected_scope = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, params, .. }
                if action.as_str() == "translate_objects"
                    && matches!(
                        params.get("selection_scope").and_then(|value| value.as_str()),
                        Some("active" | "selected")
                    )
            )
        });
        assert!(
            has_translate_selected_scope,
            "引用“这个物体”时应路由到 selection_scope=active|selected 的 translate_objects"
        );
    }

    #[test]
    fn should_plan_rotate_selected_object_step() {
        let steps = plan_model_steps("对这个物体旋转30度");
        let has_rotate_selected_scope = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, params, .. }
                if action.as_str() == "rotate_objects"
                    && matches!(
                        params.get("selection_scope").and_then(|value| value.as_str()),
                        Some("active" | "selected")
                    )
            )
        });
        assert!(
            has_rotate_selected_scope,
            "引用“这个物体”时应路由到 selection_scope=active|selected 的 rotate_objects"
        );
    }

    #[test]
    fn should_plan_rotate_two_objects_with_selected_scope() {
        let steps = plan_model_steps("对这两个物体旋转 30 度");
        let has_rotate_selected_scope = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, params, .. }
                if action.as_str() == "rotate_objects"
                    && params.get("selection_scope").and_then(|value| value.as_str()) == Some("selected")
                    && params.get("target_mode").and_then(|value| value.as_str()) == Some("selected")
                    && params.get("require_selection").and_then(|value| value.as_bool()) == Some(true)
            )
        });
        assert!(
            has_rotate_selected_scope,
            "两个物体旋转应限定在 selected 作用域"
        );
    }

    #[test]
    fn should_plan_scale_all_objects_step() {
        let steps = plan_model_steps("把所有物体缩放到1.2倍");
        let has_scale_all_scope = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, params, .. }
                if action.as_str() == "scale_objects"
                    && params.get("selection_scope").and_then(|value| value.as_str()) == Some("all")
            )
        });
        assert!(
            has_scale_all_scope,
            "引用“所有物体”时应路由到 selection_scope=all 的 scale_objects"
        );
    }

    #[test]
    fn should_parse_target_names_in_prompt() {
        let names = parse_target_names_in_prompt(
            "对名为“Cube”和“Sphere”的物体平移 1",
            "对名为“cube”和“sphere”的物体平移 1",
        );
        assert_eq!(names, vec!["Cube".to_string(), "Sphere".to_string()]);
    }

    #[test]
    fn should_plan_translate_with_target_names_filter() {
        let steps = plan_model_steps("对名为“Cube”和“Sphere”的物体平移 1");
        let has_target_filter = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, params, .. }
                if action.as_str() == "translate_objects"
                    && params
                        .get("target_names")
                        .and_then(|value| value.as_array())
                        .map(|items| items.len() == 2)
                        .unwrap_or(false)
                    && params.get("target_mode").and_then(|value| value.as_str()) == Some("named")
                    && params
                        .get("require_selection")
                        .and_then(|value| value.as_bool())
                        == Some(true)
            )
        });
        assert!(
            has_target_filter,
            "名词过滤场景应输出 translate_objects.target_names"
        );
    }

    #[test]
    fn should_plan_save_file_for_save_as_keyword() {
        let steps = plan_model_steps("把当前场景另存为“/Users/yoho/Downloads/save_as_demo.blend”");
        let has_save = steps.iter().any(|step| {
            if let PlannedModelStep::Tool { action, params, .. } = step {
                let path = params
                    .get("path")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                return action.as_str() == "save_file"
                    && path == "/Users/yoho/Downloads/save_as_demo.blend";
            }
            false
        });
        assert!(has_save);
    }

    #[test]
    fn should_plan_collection_rename_step() {
        let steps = plan_model_steps("把集合“建筑组”重命名为“主建筑组”");
        let has_collection_rename = steps.iter().any(|step| {
            if let PlannedModelStep::Tool { action, params, .. } = step {
                let mode = params
                    .get("mode")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                return action.as_str() == "organize_hierarchy" && mode == "collection_rename";
            }
            false
        });
        assert!(has_collection_rename);
    }

    #[test]
    fn should_plan_collection_move_step() {
        let steps = plan_model_steps("把集合“窗户”移动到集合“建筑结构”下");
        let has_collection_move = steps.iter().any(|step| {
            if let PlannedModelStep::Tool { action, params, .. } = step {
                let mode = params
                    .get("mode")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                let parent = params
                    .get("parent_collection")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                return action.as_str() == "organize_hierarchy"
                    && mode == "collection_move"
                    && parent == "建筑结构";
            }
            false
        });
        assert!(has_collection_move);
    }

    #[test]
    fn should_parse_llm_model_plan_json() {
        let raw = r#"{
          "steps": [
            {
              "type": "tool",
              "action": "apply_texture_image",
              "input": "应用贴图",
              "params": {"path": "/Users/yoho/Downloads/image.png"},
              "operation_kind": "batch_material",
              "branch": "primary",
              "recoverable": true,
              "risk": "low",
              "condition": null
            }
          ]
        }"#;
        let (steps, reason) = parse_llm_model_plan(raw).expect("plan should parse");
        assert!(reason.is_none());
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].code(), "apply_texture_image");
    }

    #[test]
    fn should_parse_llm_model_export_step_with_format() {
        let raw = r#"{
          "steps": [
            {
              "type": "export",
              "format": "obj",
              "input": "导出 OBJ",
              "params": {"use_selection": true},
              "operation_kind": "scene_file_ops",
              "branch": "primary",
              "recoverable": false,
              "risk": "medium",
              "condition": null
            }
          ]
        }"#;
        let (steps, reason) = parse_llm_model_plan(raw).expect("plan should parse");
        assert!(reason.is_none());
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].code(), "export_obj");
        if let ModelSessionPlannedStep::Export { format, params, .. } = &steps[0] {
            assert_eq!(*format, ExportModelFormat::Obj);
            assert_eq!(
                params
                    .get("use_selection")
                    .and_then(|value| value.as_bool()),
                Some(true)
            );
        } else {
            panic!("expected export step");
        }
    }

    #[test]
    fn planner_prompt_should_require_json_only() {
        let prompt = build_model_plan_prompt(
            "给地板补贴图 /Users/yoho/Downloads/image.png",
            &ModelMcpCapabilities::default(),
        );
        assert!(prompt.contains("只能输出 JSON"));
        assert!(prompt.contains("不允许规则兜底"));
    }

    #[test]
    fn planner_prompt_should_include_selection_few_shot_examples() {
        let prompt =
            build_model_plan_prompt("对这个物体平移 0.5", &ModelMcpCapabilities::default());
        assert!(prompt.contains("选择集语义 few-shot"));
        assert!(prompt.contains("用户：对这个物体平移 0.5"));
        assert!(prompt.contains("selection_scope=\"active\""));
    }

    #[test]
    fn retry_prompt_should_include_selection_context_for_disambiguation() {
        let snapshot = SelectionContextSnapshot {
            active_object: Some("Cube".to_string()),
            selected_objects: vec!["Cube".to_string(), "Cube.001".to_string()],
        };
        let prompt = build_model_plan_retry_prompt(
            "对这个物体平移 0.5",
            &ModelMcpCapabilities::default(),
            "规划目标不明确",
            r#"{"steps":[]}"#,
            Some(&snapshot),
            true,
        );
        assert!(prompt.contains("当前 Blender 选择上下文"));
        assert!(prompt.contains("\"active_object\": \"Cube\""));
        assert!(prompt.contains("本次必须让 transform 步骤目标唯一且可解释"));
    }

    #[test]
    fn should_reject_unrequested_rename_step_in_plan_validation() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::RenameObject,
            input: "rename".to_string(),
            params: json!({"old_name":"Cube","new_name":"Cube_A"}),
            operation_kind: ModelPlanOperationKind::Basic,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let err = validate_llm_model_plan_steps(
            &steps,
            "创建一个正方体并贴图 /Users/yoho/Downloads/image.png",
        )
        .expect_err("rename without user intent should be rejected");
        assert!(err.contains("不应规划 rename_object"));
    }

    #[test]
    fn should_reject_translate_without_selected_scope_when_prompt_refs_selected_object() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TranslateObjects,
            input: "平移".to_string(),
            params: json!({"delta":[0.5,0,0],"selection_scope":"all"}),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let err = validate_llm_model_plan_steps(&steps, "对这个物体平移 0.5")
            .expect_err("translate with selection_scope=all should be rejected");
        assert!(err.contains("selection_scope=all"));
    }

    #[test]
    fn should_reject_rotate_with_all_scope_when_prompt_refs_selected_object() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::RotateObjects,
            input: "旋转".to_string(),
            params: json!({"delta_euler":[0.0,0.0,0.5],"selection_scope":"all"}),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let err = validate_llm_model_plan_steps(&steps, "对这个物体旋转 30 度")
            .expect_err("rotate with selection_scope=all should be rejected");
        assert!(err.contains("selection_scope=all"));
    }

    #[test]
    fn should_reject_transform_with_invalid_target_names() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TranslateObjects,
            input: "平移".to_string(),
            params: json!({"delta":[0.5,0,0],"selection_scope":"selected","target_names":["", 1]}),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let err = validate_llm_model_plan_steps(&steps, "对名为 Cube 的物体平移")
            .expect_err("invalid target_names should be rejected");
        assert!(err.contains("target_names"));
    }

    #[test]
    fn should_reject_transform_with_conflicted_require_selection() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::ScaleObjects,
            input: "缩放".to_string(),
            params: json!({"factor":1.2,"selection_scope":"all","require_selection":true}),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let err = validate_llm_model_plan_steps(&steps, "把所有物体缩放到1.2")
            .expect_err("conflicted require_selection should be rejected");
        assert!(err.contains("require_selection=true"));
    }

    #[test]
    fn should_reject_apply_texture_without_any_channel_path() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::ApplyTextureImage,
            input: "贴图".to_string(),
            params: json!({}),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let err = validate_llm_model_plan_steps(&steps, "给这个物体补贴图")
            .expect_err("apply_texture_image without any channel should be rejected");
        assert!(err.contains("至少需要"));
    }

    #[test]
    fn should_accept_apply_texture_with_multi_channel_paths() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::ApplyTextureImage,
            input: "贴图".to_string(),
            params: json!({
                "base_color_path": "/tmp/basecolor.png",
                "normal_path": "/tmp/normal.png",
                "roughness_path": "/tmp/roughness.png",
                "metallic_path": "/tmp/metallic.png",
                "selection_scope": "active",
                "target_mode": "active",
                "require_selection": true
            }),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let ok = validate_llm_model_plan_steps(&steps, "给这个物体设置 PBR 贴图");
        assert!(ok.is_ok());
    }

    #[test]
    fn should_reject_apply_texture_without_selection_scope_for_selected_reference() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::ApplyTextureImage,
            input: "贴图".to_string(),
            params: json!({
                "path": "/tmp/basecolor.png"
            }),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let err = validate_llm_model_plan_steps(&steps, "给这个物体补贴图")
            .expect_err("selection reference should require scoped apply_texture parameters");
        assert!(err.contains("selection_scope"));
    }

    #[test]
    fn should_reject_apply_texture_with_invalid_objects_list() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::ApplyTextureImage,
            input: "贴图".to_string(),
            params: json!({
                "path": "/tmp/basecolor.png",
                "objects": ["Cube", ""]
            }),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let err = validate_llm_model_plan_steps(&steps, "给两个对象贴图")
            .expect_err("invalid objects list should be rejected");
        assert!(err.contains("objects"));
    }

    #[test]
    fn should_accept_apply_texture_with_objects_list() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::ApplyTextureImage,
            input: "贴图".to_string(),
            params: json!({
                "path": "/tmp/basecolor.png",
                "objects": ["Cube", "Cube.001"]
            }),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let ok = validate_llm_model_plan_steps(&steps, "给两个对象贴图");
        assert!(ok.is_ok());
    }

    #[test]
    fn should_reject_tidy_material_slots_without_selected_only_for_selection_reference() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TidyMaterialSlots,
            input: "整理材质槽".to_string(),
            params: json!({}),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let err = validate_llm_model_plan_steps(&steps, "对这个物体整理材质槽")
            .expect_err("selection reference should require selected_only=true");
        assert!(err.contains("selected_only=true"));
    }

    #[test]
    fn should_detect_ambiguous_target_plan_for_active_reference() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TranslateObjects,
            input: "平移".to_string(),
            params: json!({"delta":[0.5,0.0,0.0],"selection_scope":"selected"}),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let snapshot = SelectionContextSnapshot {
            active_object: Some("Cube".to_string()),
            selected_objects: vec!["Cube".to_string(), "Cube.001".to_string()],
        };
        let reason = detect_ambiguous_target_plan(&steps, "对这个物体平移 0.5", Some(&snapshot));
        assert!(
            reason.is_some(),
            "active 引用但 scope 非 active 应视为目标不明确"
        );
    }

    #[test]
    fn should_not_detect_ambiguous_target_plan_when_active_scope_matches() {
        let steps = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::RotateObjects,
            input: "旋转".to_string(),
            params: json!({"delta_euler":[0.0,0.0,0.5],"selection_scope":"active"}),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        let snapshot = SelectionContextSnapshot {
            active_object: Some("Cube".to_string()),
            selected_objects: vec!["Cube".to_string()],
        };
        let reason = detect_ambiguous_target_plan(&steps, "对这个物体旋转 30 度", Some(&snapshot));
        assert!(
            reason.is_none(),
            "active 引用且 scope=active 时不应判定歧义"
        );
    }

    #[test]
    fn should_parse_selection_context_snapshot() {
        let snapshot = parse_selection_context_snapshot(&json!({
            "active_object": "Cube",
            "selected_objects": ["Cube", "Cube.001"],
        }));
        assert_eq!(snapshot.active_object.as_deref(), Some("Cube"));
        assert_eq!(snapshot.selected_objects.len(), 2);
    }

    #[test]
    fn should_require_selection_scope_for_selected_reference_step() {
        let step = ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TranslateObjects,
            input: "平移".to_string(),
            params: json!({"delta":[0.1,0.0,0.0],"selection_scope":"selected"}),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        };
        let required = required_selection_scope_for_step("对这个物体平移", &step);
        assert_eq!(required, Some("selected"));
    }

    #[test]
    fn should_require_active_scope_for_modifier_step_without_explicit_object() {
        let step = ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Solidify,
            input: "加厚".to_string(),
            params: json!({}),
            operation_kind: ModelPlanOperationKind::ModifierChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        };
        let required = required_selection_scope_for_step("对这个物体加厚", &step);
        assert_eq!(required, Some("active"));
    }

    #[test]
    fn should_require_selected_scope_for_selected_only_action_step() {
        let step = ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TidyMaterialSlots,
            input: "整理材质槽".to_string(),
            params: json!({"selected_only": true}),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        };
        let required = required_selection_scope_for_step("对这个物体整理材质槽", &step);
        assert_eq!(required, Some("selected"));
    }

    #[test]
    fn should_validate_selection_context_scope_readiness() {
        let empty = SelectionContextSnapshot::default();
        assert!(!selection_context_meets_scope(&empty, "selected"));
        assert!(!selection_context_meets_scope(&empty, "active"));

        let selected = SelectionContextSnapshot {
            active_object: None,
            selected_objects: vec!["Cube".to_string()],
        };
        assert!(selection_context_meets_scope(&selected, "selected"));
        assert!(selection_context_meets_scope(&selected, "active"));
    }

    #[test]
    fn should_detect_topology_check_required_for_modifier_step() {
        let step = ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Decimate,
            input: "减面".to_string(),
            params: json!({"ratio":0.5}),
            operation_kind: ModelPlanOperationKind::ModifierChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        };
        assert!(should_run_topology_check_after_step(&step));
    }

    #[test]
    fn should_detect_recover_point_required_for_file_step() {
        let file_step = ModelSessionPlannedStep::Tool {
            action: ModelToolAction::OpenFile,
            input: "打开文件".to_string(),
            params: json!({"path":"/tmp/a.blend"}),
            operation_kind: ModelPlanOperationKind::SceneFileOps,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::High,
            condition: None,
        };
        assert!(should_create_file_recover_point_for_step(&file_step));

        let transform_step = ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TranslateObjects,
            input: "平移".to_string(),
            params: json!({"delta":[0.1,0.0,0.0]}),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        };
        assert!(!should_create_file_recover_point_for_step(&transform_step));
    }

    #[test]
    fn should_build_file_recover_point_path() {
        let path =
            build_file_recover_point_path("/tmp/zodileap-exports", "session-01", "trace-abc", 2);
        let text = path.to_string_lossy().to_string();
        assert!(text.contains("recover_points"));
        assert!(text.contains("session-01"));
        assert!(text.contains("trace-abc"));
        assert!(text.ends_with(".blend"));
        assert!(text.contains("step-3-"));
    }

    #[test]
    fn should_build_operation_transaction_snapshot_path() {
        let path = build_operation_transaction_snapshot_path(
            "/tmp/zodileap-exports",
            "session-01",
            "trace-abc",
        );
        let text = path.to_string_lossy().to_string();
        assert!(text.contains("recover_points"));
        assert!(text.contains("session-01"));
        assert!(text.contains("trace-abc"));
        assert!(text.ends_with(".blend"));
        assert!(text.contains("transaction-start-"));
    }

    #[test]
    fn should_create_operation_transaction_for_complex_steps() {
        let one_step = vec![ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TranslateObjects,
            input: "平移".to_string(),
            params: json!({"delta":[0.1,0.0,0.0]}),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        }];
        assert!(!should_create_operation_transaction(&one_step));

        let two_steps = vec![
            ModelSessionPlannedStep::Tool {
                action: ModelToolAction::TranslateObjects,
                input: "平移".to_string(),
                params: json!({"delta":[0.1,0.0,0.0]}),
                operation_kind: ModelPlanOperationKind::BatchTransform,
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: ModelPlanRiskLevel::Low,
                condition: None,
            },
            ModelSessionPlannedStep::Tool {
                action: ModelToolAction::RotateObjects,
                input: "旋转".to_string(),
                params: json!({"delta_euler":[0.0,0.0,0.1]}),
                operation_kind: ModelPlanOperationKind::BatchTransform,
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: ModelPlanRiskLevel::Low,
                condition: None,
            },
        ];
        assert!(should_create_operation_transaction(&two_steps));
    }

    #[test]
    fn should_parse_scene_object_metrics() {
        let (total, meshes) = parse_scene_object_metrics(&json!({
            "objects": [
                {"name":"Cube","type":"MESH"},
                {"name":"Light","type":"LIGHT"},
                {"name":"Sphere","type":"MESH"}
            ]
        }));
        assert_eq!(total, 3);
        assert_eq!(meshes, 2);
    }

    #[test]
    fn should_estimate_complex_flow_duration_ms() {
        let small = estimate_complex_flow_duration_ms(3, 10);
        let large = estimate_complex_flow_duration_ms(8, 300);
        assert!(small > 0);
        assert!(large > small);
    }

    #[test]
    fn should_parse_topology_face_count_baseline_from_trace_data() {
        let baseline = parse_topology_face_count_baseline(&json!({
            "face_counts": {
                "Cube": 128,
                "Cube.001": 96
            }
        }));
        assert_eq!(baseline.get("Cube"), Some(&128));
        assert_eq!(baseline.get("Cube.001"), Some(&96));
    }

    #[test]
    fn should_detect_destructive_selection_intent() {
        assert!(is_destructive_selection_intent("对这个物体平移 1"));
        assert!(!is_destructive_selection_intent("这个物体叫什么名字"));
    }

    #[test]
    fn should_block_destructive_plan_when_selection_is_empty() {
        let empty = SelectionContextSnapshot::default();
        assert!(should_block_destructive_plan_for_empty_selection(
            "对这个物体旋转 10 度",
            &empty
        ));

        let selected = SelectionContextSnapshot {
            active_object: Some("Cube".to_string()),
            selected_objects: vec!["Cube".to_string()],
        };
        assert!(!should_block_destructive_plan_for_empty_selection(
            "对这个物体旋转 10 度",
            &selected
        ));
    }
}
