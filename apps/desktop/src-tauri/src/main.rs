#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_skills;
mod blender_runtime;
mod c4d_runtime;
mod dcc_runtime;
mod dcc_runtime_support;
#[cfg(test)]
mod dcc_runtime_tests;
mod maya_runtime;
mod mcp_registry;

use agent_skills::{
    import_agent_skill_from_path, list_agent_skill_overview, list_agent_skills,
    open_builtin_agent_skill_folder, pick_agent_skill_folder, register_builtin_agent_skill,
    remove_user_agent_skill, unregister_builtin_agent_skill,
};
use dcc_runtime::{
    DccRuntimeStatusResponse, check_dcc_runtime_status_inner, prepare_dcc_runtime_inner,
};
use libra_agent_core::{
    AgentRegisteredMcp, AgentRunRequest, AgentRuntimeCapabilities, AgentStreamEvent,
    UserInputAnswer, UserInputResolution, detect_agent_runtime_capabilities,
    llm::{
        LlmGatewayPolicy, LlmProviderConfig, LlmUsage, call_model_with_policy_and_config,
        parse_provider,
    },
    platform::{
        CommandCandidate, resolve_codex_command_candidates, resolve_gemini_command_candidates,
        resolve_python_command_candidates,
    },
    run_agent_with_protocol_error_stream,
};
use libra_mcp_common::{
    ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord, ProtocolUiHint,
};
use mcp_registry::{
    list_enabled_mcp_registrations, list_registered_mcps, remove_mcp_registration,
    save_mcp_registration, validate_mcp_registration,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::any::Any;
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri_plugin_updater::UpdaterExt;

// ── Tauri 事件名常量 ──────────────────────────────────────────────────
//
// 描述：前后端约定的 Tauri emit 事件名，前端 listen 时使用相同字符串。

/// 描述：智能体文本流事件名。
const EVENT_AGENT_TEXT_STREAM: &str = "agent:text_stream";

/// 描述：智能体后台日志事件名。
const EVENT_AGENT_LOG: &str = "agent:log";
const EMBEDDED_UPDATER_PUBKEY: &str = include_str!("../updater/public.key");

#[derive(Serialize, Clone)]
struct DesktopRuntimeInfoResponse {
    current_version: String,
    platform: String,
    arch: String,
}

#[derive(Deserialize, Clone)]
struct DesktopUpdateDownloadRequest {
    version: String,
    download_url: String,
    checksum_sha256: Option<String>,
}

#[derive(Serialize, Clone)]
struct DesktopUpdateStateResponse {
    status: String,
    current_version: String,
    target_version: String,
    progress: f64,
    message: String,
    download_path: Option<String>,
}

#[derive(Default, Clone)]
struct DesktopUpdateState {
    status: String,
    current_version: String,
    target_version: String,
    progress: f64,
    message: String,
    download_path: Option<String>,
    checksum_sha256: Option<String>,
}

/// 描述：返回智能体会话取消标记表，用于跨命令处理主动取消竞态。
fn cancelled_agent_sessions() -> &'static Mutex<HashSet<String>> {
    static CANCELLED_AGENT_SESSIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED_AGENT_SESSIONS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 描述：返回桌面端更新状态存储，统一管理下载/安装流程状态。
fn desktop_update_state_store() -> &'static Mutex<DesktopUpdateState> {
    static DESKTOP_UPDATE_STATE: OnceLock<Mutex<DesktopUpdateState>> = OnceLock::new();
    DESKTOP_UPDATE_STATE.get_or_init(|| {
        Mutex::new(DesktopUpdateState {
            status: "idle".to_string(),
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            target_version: String::new(),
            progress: 0.0,
            message: "尚未检查更新".to_string(),
            download_path: None,
            checksum_sha256: None,
        })
    })
}

/// 描述：读取编译进应用的 updater 公钥；若仍是占位内容，则表示构建主机尚未注入真实公钥。
fn resolve_embedded_updater_pubkey() -> Option<String> {
    let value = EMBEDDED_UPDATER_PUBKEY.trim();
    if value.is_empty() || value == "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY" {
        return None;
    }
    Some(value.to_string())
}

/// 描述：将内部桌面更新状态转换为前端可消费结构。
fn snapshot_desktop_update_state() -> DesktopUpdateStateResponse {
    let fallback = DesktopUpdateState {
        status: "failed".to_string(),
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        target_version: String::new(),
        progress: 0.0,
        message: "更新状态读取失败".to_string(),
        download_path: None,
        checksum_sha256: None,
    };
    let state = desktop_update_state_store()
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or(fallback);
    DesktopUpdateStateResponse {
        status: state.status,
        current_version: state.current_version,
        target_version: state.target_version,
        progress: state.progress,
        message: state.message,
        download_path: state.download_path,
    }
}

/// 描述：更新桌面端状态存储，供下载线程与命令统一复用。
fn set_desktop_update_state(mutator: impl FnOnce(&mut DesktopUpdateState)) {
    if let Ok(mut guard) = desktop_update_state_store().lock() {
        mutator(&mut guard);
    }
}

/// 描述：将 updater 检查/安装错误归一化为用户可读文案，避免直接暴露底层错误细节。
fn build_desktop_update_error_message(error: impl std::fmt::Display) -> String {
    format!("更新失败：{}", error)
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
struct AgentRunResponse {
    trace_id: String,
    control: String,
    message: String,
    display_message: String,
    usage: Option<LlmUsage>,
    actions: Vec<String>,
    exported_file: Option<String>,
    steps: Vec<ProtocolStepRecord>,
    events: Vec<ProtocolEventRecord>,
    assets: Vec<ProtocolAssetRecord>,
    ui_hint: Option<ProtocolUiHint>,
}

#[derive(Serialize)]
struct AgentSummaryResponse {
    content: String,
    usage: Option<LlmUsage>,
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
struct ProjectWorkspaceProfileSeedResponse {
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

const AGENT_STREAM_ARGS_MAX_CHARS: usize = 1200;
const AGENT_STREAM_APPROVAL_ARGS_MAX_CHARS: usize = 2000;

/// 描述：裁剪流式事件文本，避免超长载荷在 Tauri 事件桥接阶段阻塞前端。
fn truncate_agent_stream_text(value: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut text = value.chars().take(max_chars).collect::<String>();
    text.push('…');
    text
}

/// 描述：向前端派发通用智能体文本流事件，供代码会话逐字渲染。
fn emit_agent_text_stream_event(app: &tauri::AppHandle, payload: AgentTextStreamEvent) {
    let _ = app.emit(EVENT_AGENT_TEXT_STREAM, payload);
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

fn resolve_codex_bins() -> Vec<CommandCandidate> {
    resolve_codex_command_candidates()
}

/// 描述：解析可用于执行 Gemini CLI 命令的候选二进制路径列表。
fn resolve_gemini_bins() -> Vec<CommandCandidate> {
    resolve_gemini_command_candidates()
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

/// 描述：解析可用于执行 Python 命令的候选列表，复用 Core 侧统一规则。
fn resolve_python_bins() -> Vec<CommandCandidate> {
    resolve_python_command_candidates()
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
fn read_python_version(candidate: &CommandCandidate) -> Option<String> {
    let output = candidate.build_command().arg("--version").output().ok()?;
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

/// 描述：返回第一个可用 Python 命令候选与版本号。
fn detect_available_python() -> Option<(CommandCandidate, String)> {
    for candidate in resolve_python_bins() {
        if let Some(version) = read_python_version(&candidate) {
            return Some((candidate, version));
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

fn read_codex_version(candidate: &CommandCandidate) -> Option<String> {
    let output = candidate.build_command().arg("--version").output().ok()?;
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
fn read_gemini_version(candidate: &CommandCandidate) -> Option<String> {
    let output = candidate.build_command().arg("--version").output().ok()?;
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

#[tauri::command]
async fn prepare_dcc_runtime(
    software: String,
    dcc_provider_addr: Option<String>,
) -> Result<DccRuntimeStatusResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        prepare_dcc_runtime_inner(software, dcc_provider_addr)
    })
    .await
    .map_err(|err| format!("prepare dcc runtime task join failed: {}", err))?
}

#[tauri::command]
async fn check_dcc_runtime_status(
    software: String,
    dcc_provider_addr: Option<String>,
) -> Result<DccRuntimeStatusResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_dcc_runtime_status_inner(software, dcc_provider_addr)
    })
    .await
    .map_err(|err| format!("check dcc runtime task join failed: {}", err))?
}

#[tauri::command]
async fn run_agent_command(
    app: tauri::AppHandle,
    agent_key: String,
    session_id: Option<String>,
    provider: Option<String>,
    provider_api_key: Option<String>,
    provider_model: Option<String>,
    provider_mode: Option<String>,
    prompt: String,
    trace_id: Option<String>,
    project_name: Option<String>,
    model_export_enabled: Option<bool>,
    dcc_provider_addr: Option<String>,
    output_dir: Option<String>,
    workdir: Option<String>,
    runtime_capabilities: Option<AgentRuntimeCapabilities>,
) -> Result<AgentRunResponse, DesktopProtocolError> {
    tauri::async_runtime::spawn_blocking(move || {
        match catch_unwind(AssertUnwindSafe(|| {
            run_agent_command_inner(
                app,
                agent_key,
                session_id,
                provider,
                provider_api_key,
                provider_model,
                provider_mode,
                prompt,
                trace_id,
                project_name,
                model_export_enabled,
                dcc_provider_addr,
                output_dir,
                workdir,
                runtime_capabilities,
            )
        })) {
            Ok(result) => result,
            Err(panic_payload) => Err(DesktopProtocolError {
                code: "core.desktop.agent.runtime_panic".to_string(),
                message: format!(
                    "agent command runtime panicked: {}",
                    describe_panic_payload(panic_payload.as_ref())
                ),
                suggestion: Some("请重试一次；如仍失败请重启应用".to_string()),
                retryable: true,
            }),
        }
    })
    .await
    .map_err(|err| DesktopProtocolError {
        code: "core.desktop.agent.task_join_failed".to_string(),
        message: format!("agent command task join failed: {}", err),
        suggestion: Some("请重试一次；如仍失败请重启应用".to_string()),
        retryable: true,
    })?
}

#[tauri::command]
async fn get_agent_runtime_capabilities(
    app: tauri::AppHandle,
    workdir: Option<String>,
) -> Result<AgentRuntimeCapabilities, DesktopProtocolError> {
    tauri::async_runtime::spawn_blocking(move || {
        get_agent_runtime_capabilities_inner(app, workdir)
    })
    .await
    .map_err(|err| DesktopProtocolError {
        code: "core.desktop.agent.runtime_capabilities_join_failed".to_string(),
        message: format!("get agent runtime capabilities task join failed: {}", err),
        suggestion: Some("请重试一次；如仍失败请重启应用。".to_string()),
        retryable: true,
    })?
}

#[tauri::command]
async fn call_ai_summary_command(
    provider: Option<String>,
    provider_api_key: Option<String>,
    provider_model: Option<String>,
    provider_mode: Option<String>,
    prompt: String,
    workdir: Option<String>,
) -> Result<AgentSummaryResponse, DesktopProtocolError> {
    tauri::async_runtime::spawn_blocking(move || {
        call_ai_summary_command_inner(
            provider,
            provider_api_key,
            provider_model,
            provider_mode,
            prompt,
            workdir,
        )
    })
    .await
    .map_err(|err| DesktopProtocolError {
        code: "core.desktop.agent.summary_task_join_failed".to_string(),
        message: format!("summary task join failed: {}", err),
        suggestion: Some("请重试一次；如仍失败请重启应用".to_string()),
        retryable: true,
    })?
}

/// 描述：提取 panic payload 的可读信息，优先返回字符串消息，避免显示 Any 类型噪声。
fn describe_panic_payload(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic payload".to_string()
}

/// 描述：将桌面端 MCP 注册表转换为 core agent 可直接消费的运行时快照。
///
/// Params:
///
///   - app: 当前桌面应用句柄。
///
/// Returns:
///
///   - 统一智能体可见的 MCP 注册项列表。
fn build_runtime_registered_mcps(
    _app: &tauri::AppHandle,
    workspace_root: Option<&Path>,
) -> Result<Vec<AgentRegisteredMcp>, DesktopProtocolError> {
    let registrations = list_enabled_mcp_registrations(
        workspace_root.and_then(|path| path.to_str()),
    )
    .map_err(|err| DesktopProtocolError {
        code: "core.desktop.mcp.registry_read_failed".to_string(),
        message: format!("读取 MCP 注册表失败: {}", err),
        suggestion: Some("请检查 MCP 页面中的注册项是否存在无效 JSON。".to_string()),
        retryable: false,
    })?;

    let mut runtime_mcps: Vec<AgentRegisteredMcp> = Vec::with_capacity(registrations.len());
    for item in registrations {
        let effective_command = item.command.trim().to_string();
        let effective_args = item.args.clone();
        let effective_env = item.env.clone();
        let mut runtime_ready = true;
        let mut runtime_hint: Option<String> = None;

        if item.transport == "stdio" && effective_command.is_empty() {
            runtime_ready = false;
            runtime_hint = Some("Stdio MCP 缺少启动命令，请先在 MCP 页面补齐配置。".to_string());
        } else if item.transport == "http" && item.url.trim().is_empty() {
            runtime_ready = false;
            runtime_hint = Some("HTTP MCP 缺少服务地址，请先在 MCP 页面补齐配置。".to_string());
        }

        runtime_mcps.push(AgentRegisteredMcp {
            id: item.id,
            template_id: item.template_id,
            name: item.name,
            domain: item.domain,
            software: item.software,
            capabilities: item.capabilities,
            priority: item.priority,
            supports_import: item.supports_import,
            supports_export: item.supports_export,
            transport: item.transport,
            command: effective_command,
            args: effective_args,
            env: effective_env,
            cwd: item.cwd,
            url: item.url,
            headers: item.headers,
            runtime_kind: item.runtime_kind,
            official_provider: item.official_provider,
            runtime_ready,
            runtime_hint,
        });
    }

    Ok(runtime_mcps)
}

/// 描述：解析智能体请求的工作目录，统一兼容绝对路径、相对路径与缺省回退逻辑。
///
/// Params:
///
///   - workdir: 会话或前端透传的工作目录。
///
/// Returns:
///
///   - 归一化后的绝对工作目录。
fn resolve_agent_selected_workdir(workdir: Option<String>) -> Result<PathBuf, DesktopProtocolError> {
    let current_dir = env::current_dir().map_err(|err| DesktopProtocolError {
        code: "core.desktop.agent.current_dir_read_failed".to_string(),
        message: format!("read current dir failed: {}", err),
        suggestion: None,
        retryable: false,
    })?;
    let selected_workdir = workdir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| current_dir.clone());
    let normalized_workdir = if selected_workdir.is_absolute() {
        selected_workdir
    } else {
        current_dir.join(selected_workdir)
    };
    if !normalized_workdir.exists() || !normalized_workdir.is_dir() {
        return Err(DesktopProtocolError {
            code: "core.desktop.agent.workdir_invalid".to_string(),
            message: format!("workdir is invalid: {}", normalized_workdir.to_string_lossy()),
            suggestion: Some("请确认会话绑定的项目目录存在且可访问".to_string()),
            retryable: false,
        });
    }
    Ok(normalized_workdir)
}

/// 描述：基于当前工作目录与已启用 MCP 注册表，构建统一智能体可见的运行时能力快照。
///
/// Params:
///
///   - app: 当前桌面应用句柄。
///   - workdir: 可选工作目录。
///
/// Returns:
///
///   - 运行时能力快照。
fn get_agent_runtime_capabilities_inner(
    app: tauri::AppHandle,
    workdir: Option<String>,
) -> Result<AgentRuntimeCapabilities, DesktopProtocolError> {
    let selected_workdir = resolve_agent_selected_workdir(workdir)?;
    let available_mcps = build_runtime_registered_mcps(&app, Some(selected_workdir.as_path()))?;
    Ok(detect_agent_runtime_capabilities(&available_mcps))
}

fn run_agent_command_inner(
    app: tauri::AppHandle,
    agent_key: String,
    session_id: Option<String>,
    provider: Option<String>,
    provider_api_key: Option<String>,
    provider_model: Option<String>,
    provider_mode: Option<String>,
    prompt: String,
    trace_id: Option<String>,
    project_name: Option<String>,
    model_export_enabled: Option<bool>,
    dcc_provider_addr: Option<String>,
    output_dir: Option<String>,
    workdir: Option<String>,
    runtime_capabilities: Option<AgentRuntimeCapabilities>,
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
        // 描述：
        //
        //   - 每次新的顶层请求都从干净的 Python 沙盒开始，避免上一轮执行残留状态
        //     （如未消费输出、挂起工具结果或解释器上下文）串扰后续请求。
        libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(session);
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

    // 描述：
    //
    //   - 优先使用会话传入的项目目录作为执行路径，确保智能体基于当前项目上下文工作。
    let selected_workdir = resolve_agent_selected_workdir(workdir.clone())?;
    let default_output_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|path| path.join("exports"))
        .unwrap_or_else(|| env::temp_dir().join("libra").join("exports"));
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
            .unwrap_or_else(|| env::temp_dir().join("libra").join("exports"));
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
    let available_mcps = build_runtime_registered_mcps(&app, Some(selected_workdir.as_path()))?;
    let resolved_runtime_capabilities = runtime_capabilities
        .unwrap_or_else(|| detect_agent_runtime_capabilities(&available_mcps));
    log(
        "debug",
        "request",
        format!("enabled_mcps={}", available_mcps.len()),
    );
    log(
        "debug",
        "request",
        format!(
            "interactive_mode={}",
            resolved_runtime_capabilities.interactive_mode.as_str()
        ),
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
            provider_api_key,
            provider_model,
            provider_mode,
            prompt,
            project_name,
            model_export_enabled: model_export_enabled.unwrap_or(false),
            dcc_provider_addr,
            output_dir: Some(selected_output_dir.to_string_lossy().to_string()),
            workdir: Some(selected_workdir.to_string_lossy().to_string()),
            available_mcps,
            runtime_capabilities: resolved_runtime_capabilities,
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
                AgentStreamEvent::ToolCallStarted {
                    name,
                    args,
                    args_data,
                } => {
                    let args_preview =
                        truncate_agent_stream_text(args.as_str(), AGENT_STREAM_ARGS_MAX_CHARS);
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: format!("正在执行工具: {}", name),
                            delta: None,
                            data: Some(json!({
                                "name": name,
                                "args": args_preview,
                                "args_data": args_data,
                            })),
                        },
                    );
                }
                AgentStreamEvent::ToolCallFinished {
                    name,
                    ok,
                    result,
                    result_data,
                } => {
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
                            data: Some(json!({
                                "name": name,
                                "ok": ok,
                                "result": result,
                                "result_data": result_data,
                            })),
                        },
                    );
                }
                AgentStreamEvent::RequireApproval {
                    approval_id,
                    tool_name,
                    tool_args,
                } => {
                    let tool_args_preview = truncate_agent_stream_text(
                        tool_args.as_str(),
                        AGENT_STREAM_APPROVAL_ARGS_MAX_CHARS,
                    );
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
                                "tool_args": tool_args_preview,
                            })),
                        },
                    );
                }
                AgentStreamEvent::RequestUserInput {
                    request_id,
                    questions,
                } => {
                    let question_count = questions.len();
                    emit_agent_text_stream_event(
                        &app,
                        AgentTextStreamEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            kind,
                            message: format!("正在询问 {} 个问题", question_count),
                            delta: None,
                            data: Some(json!({
                                "request_id": request_id,
                                "questions": questions,
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
            if let Some(session) = session_id.as_deref() {
                // 描述：
                //
                //   - 异常终止后立即回收当前会话沙盒，避免故障状态污染下一次同会话执行。
                libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(session);
            }
            return Err(protocol_err.into());
        }
    };

    emit_agent_text_stream_event(
        &app,
        AgentTextStreamEvent {
            trace_id: trace_id.clone(),
            session_id: session_id.clone(),
            kind: "finished".to_string(),
            message: "智能体执行完成".to_string(),
            delta: None,
            data: None,
        },
    );
    if let Some(session) = session_id.as_deref() {
        // 描述：
        //
        //   - 当前顶层请求结束后释放会话沙盒，保证下一次用户发送从全新解释器开始。
        libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(session);
    }

    Ok(AgentRunResponse {
        trace_id,
        control: result.control,
        message: result.message,
        display_message: result.display_message,
        usage: result.usage,
        actions: result.actions,
        exported_file: result.exported_file,
        steps: result.steps,
        events: result.events,
        assets: result.assets,
        ui_hint: result.ui_hint,
    })
}

/// 描述：直接调用当前 provider 生成执行总结，避免再经过 agent 编排导致多余的 planning / codegen 噪声。
fn call_ai_summary_command_inner(
    provider: Option<String>,
    provider_api_key: Option<String>,
    provider_model: Option<String>,
    provider_mode: Option<String>,
    prompt: String,
    workdir: Option<String>,
) -> Result<AgentSummaryResponse, DesktopProtocolError> {
    let normalized_prompt = prompt.trim().to_string();
    if normalized_prompt.is_empty() {
        return Err(DesktopProtocolError {
            code: "core.desktop.agent.summary_prompt_empty".to_string(),
            message: "summary prompt is empty".to_string(),
            suggestion: Some("请先提供用于总结的执行记录。".to_string()),
            retryable: false,
        });
    }

    let current_dir = env::current_dir().map_err(|err| DesktopProtocolError {
        code: "core.desktop.agent.current_dir_read_failed".to_string(),
        message: format!("read current dir failed: {}", err),
        suggestion: None,
        retryable: false,
    })?;
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

    let provider_name = provider.unwrap_or_else(|| "codex".to_string());
    let provider_config = LlmProviderConfig {
        api_key: provider_api_key
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        model: provider_model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        mode: provider_mode
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };
    let result = call_model_with_policy_and_config(
        parse_provider(provider_name.as_str()),
        normalized_prompt.as_str(),
        Some(selected_workdir.to_string_lossy().as_ref()),
        LlmGatewayPolicy::from_env(),
        Some(&provider_config),
    )
    .map_err(|err| DesktopProtocolError {
        code: err.code,
        message: err.message,
        suggestion: err.suggestion,
        retryable: err.retryable,
    })?;

    Ok(AgentSummaryResponse {
        content: result.content.trim().to_string(),
        usage: Some(result.usage),
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
    for dir in ["src/pages", "pages", "src/views", "views", "src/app", "app"] {
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
        "src/modules/agent/routes.tsx",
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
    ] {
        for stem in collect_file_stems_in_dir(&project_root.join(dir), 16) {
            push_unique_string(&mut models, stem.as_str());
        }
    }
    for file in ["openapi.yaml", "openapi.yml", "openapi.json", "swagger.json"] {
        if project_root.join(file).exists() {
            push_unique_string(&mut models, file);
        }
    }
    models
}

/// 描述：执行代码项目初始化分析，输出结构化项目信息可用的 API 数据模型/页面布局/前端代码结构草稿。
fn inspect_project_workspace_profile_seed_inner(
    project_path: String,
) -> Result<ProjectWorkspaceProfileSeedResponse, String> {
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
        if has_dep("@aries-kit/react") || has_dep("aries_react") {
            push_unique_string(&mut frontend_stacks, "@aries-kit/react");
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

    Ok(ProjectWorkspaceProfileSeedResponse {
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
async fn inspect_project_workspace_profile_seed(
    project_path: String,
) -> Result<ProjectWorkspaceProfileSeedResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        inspect_project_workspace_profile_seed_inner(project_path)
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
            let bin_text = bin.display();
            let outdated = is_lower_semver(&version, &minimum_version).unwrap_or(false);
            let message = if outdated {
                format!(
                    "Codex CLI 版本过低：{}，最低要求 {}。请更新后再使用。",
                    version, minimum_version
                )
            } else {
                format!("Codex CLI 可用：{} ({})", version, bin_text)
            };
            return CodexCliHealthResponse {
                available: true,
                outdated,
                version,
                minimum_version,
                bin_path: bin_text,
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
            let bin_text = bin.display();
            let outdated = is_lower_semver(&version, &minimum_version).unwrap_or(false);
            let message = if outdated {
                format!(
                    "Gemini CLI 版本过低：{}，最低要求 {}。请更新后再使用。",
                    version, minimum_version
                )
            } else {
                format!("Gemini CLI 可用：{} ({})", version, bin_text)
            };
            return GeminiCliHealthResponse {
                available: true,
                outdated,
                version,
                minimum_version,
                bin_path: bin_text,
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
        let bin_text = bin.display();
        return PythonCliHealthResponse {
            available: true,
            version: version.clone(),
            bin_path: bin_text.clone(),
            message: format!("Python 可用：{} ({})", version, bin_text),
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

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
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

/// 描述：获取桌面端运行时信息（版本/平台/架构），供前端检查更新时上报。
#[tauri::command]
fn get_desktop_runtime_info() -> DesktopRuntimeInfoResponse {
    DesktopRuntimeInfoResponse {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
    }
}

/// 描述：返回当前桌面端更新状态快照。
#[tauri::command]
fn get_desktop_update_state() -> DesktopUpdateStateResponse {
    snapshot_desktop_update_state()
}

/// 描述：根据下载 URL 解析文件扩展名，命中失败时回退到 bin。
fn resolve_update_file_extension(download_url: &str) -> String {
    let lower_url = download_url.to_lowercase();
    for extension in ["dmg", "pkg", "zip", "exe", "msi", "appimage", "deb", "rpm"] {
        if lower_url.contains(&format!(".{}", extension)) {
            return extension.to_string();
        }
    }
    "bin".to_string()
}

/// 描述：基于官方 Tauri updater 检查静态更新清单；命中新版时自动下载、安装并在 macOS/Linux 上重启应用。
#[tauri::command]
async fn check_desktop_update(
    app: tauri::AppHandle,
    manifest_url: String,
) -> Result<DesktopUpdateStateResponse, String> {
    let normalized_url = manifest_url.trim().to_string();
    if normalized_url.is_empty() {
        set_desktop_update_state(|state| {
            state.status = "idle".to_string();
            state.target_version.clear();
            state.progress = 0.0;
            state.message = "未配置可用更新源".to_string();
            state.download_path = None;
        });
        return Ok(snapshot_desktop_update_state());
    }

    let Some(pubkey) = resolve_embedded_updater_pubkey() else {
        set_desktop_update_state(|state| {
            state.status = "failed".to_string();
            state.target_version.clear();
            state.progress = 0.0;
            state.message = "未配置更新签名公钥，请先在构建主机运行发布脚本。".to_string();
            state.download_path = None;
        });
        return Ok(snapshot_desktop_update_state());
    };

    let current_state = snapshot_desktop_update_state();
    if current_state.status == "checking"
        || current_state.status == "downloading"
        || current_state.status == "installing"
    {
        return Ok(current_state);
    }

    set_desktop_update_state(|state| {
        state.status = "checking".to_string();
        state.progress = 0.0;
        state.target_version.clear();
        state.message = "正在检查更新...".to_string();
        state.download_path = None;
    });

    let manifest_endpoint =
        reqwest::Url::parse(&normalized_url).map_err(build_desktop_update_error_message)?;

    let update = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![manifest_endpoint])
        .map_err(build_desktop_update_error_message)?
        .build()
        .map_err(build_desktop_update_error_message)?
        .check()
        .await
        .map_err(build_desktop_update_error_message)?;

    let Some(update) = update else {
        set_desktop_update_state(|state| {
            state.status = "idle".to_string();
            state.progress = 0.0;
            state.target_version.clear();
            state.message = "当前已是最新版本".to_string();
            state.download_path = None;
        });
        return Ok(snapshot_desktop_update_state());
    };

    let target_version = update.version.clone();
    set_desktop_update_state(|state| {
        state.status = "downloading".to_string();
        state.target_version = target_version.clone();
        state.progress = 0.0;
        state.message = format!("发现新版本 {}，开始下载更新包。", target_version);
        state.download_path = None;
    });

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut downloaded_bytes: u64 = 0;
        let install_result = update
            .download_and_install(
                |chunk_length, content_length| {
                    downloaded_bytes += chunk_length as u64;
                    let progress = content_length
                        .map(|total| {
                            if total > 0 {
                                (downloaded_bytes as f64 / total as f64) * 100.0
                            } else {
                                0.0
                            }
                        })
                        .unwrap_or(0.0);
                    set_desktop_update_state(|state| {
                        state.status = "downloading".to_string();
                        state.progress = progress.clamp(0.0, 100.0);
                        state.message = if let Some(total) = content_length {
                            format!("更新下载中（{downloaded_bytes}/{total}）")
                        } else {
                            "更新下载中".to_string()
                        };
                    });
                },
                || {
                    set_desktop_update_state(|state| {
                        state.status = "installing".to_string();
                        state.progress = 100.0;
                        state.message = "更新下载完成，正在安装...".to_string();
                    });
                },
            )
            .await;

        match install_result {
            Ok(()) => {
                set_desktop_update_state(|state| {
                    state.status = "installing".to_string();
                    state.progress = 100.0;
                    state.message = "更新已安装，应用即将重启。".to_string();
                    state.download_path = None;
                });
                #[cfg(not(target_os = "windows"))]
                {
                    app_handle.restart();
                }
            }
            Err(error) => {
                set_desktop_update_state(|state| {
                    state.status = "failed".to_string();
                    state.progress = 0.0;
                    state.message = build_desktop_update_error_message(error);
                    state.download_path = None;
                });
            }
        }
    });

    Ok(snapshot_desktop_update_state())
}

/// 描述：构建更新包下载路径，按目标版本和下载地址生成稳定文件名。
fn resolve_update_download_path(version: &str, download_url: &str) -> Result<PathBuf, String> {
    let updates_root = env::temp_dir().join("libra-desktop-updates");
    fs::create_dir_all(&updates_root)
        .map_err(|err| format!("create update temp dir failed: {}", err))?;
    let extension = resolve_update_file_extension(download_url);
    let safe_version = version.replace(['/', '\\', ' '], "_");
    Ok(updates_root.join(format!("libra-{}.{}", safe_version, extension)))
}

/// 描述：计算文件的 SHA256 哈希值，用于更新包完整性校验。
fn calculate_file_sha256(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|err| format!("open file failed: {}", err))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 64];
    loop {
        let size = file
            .read(&mut buffer)
            .map_err(|err| format!("read file failed: {}", err))?;
        if size == 0 {
            break;
        }
        hasher.update(&buffer[..size]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// 描述：执行更新包下载，并按进度同步全局状态。
fn download_desktop_update_package(
    request: DesktopUpdateDownloadRequest,
) -> Result<PathBuf, String> {
    let download_path = resolve_update_download_path(&request.version, &request.download_url)?;
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60 * 20))
        .build()
        .map_err(|err| format!("create update http client failed: {}", err))?;
    let mut response = client
        .get(&request.download_url)
        .send()
        .map_err(|err| format!("download update package failed: {}", err))?;
    if !response.status().is_success() {
        return Err(format!(
            "download update package failed: status {}",
            response.status()
        ));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut file = fs::File::create(&download_path)
        .map_err(|err| format!("create update package file failed: {}", err))?;
    let mut downloaded_bytes: u64 = 0;
    let mut buffer = [0u8; 1024 * 64];
    loop {
        let size = response
            .read(&mut buffer)
            .map_err(|err| format!("read update package stream failed: {}", err))?;
        if size == 0 {
            break;
        }
        file.write_all(&buffer[..size])
            .map_err(|err| format!("write update package file failed: {}", err))?;
        downloaded_bytes += size as u64;
        let progress = if total_bytes > 0 {
            (downloaded_bytes as f64 / total_bytes as f64) * 100.0
        } else {
            0.0
        };
        set_desktop_update_state(|state| {
            state.progress = progress;
            state.message = if total_bytes > 0 {
                format!("更新下载中（{:.1}%）", progress.clamp(0.0, 100.0))
            } else {
                "更新下载中".to_string()
            };
        });
    }

    if let Some(expected) = request.checksum_sha256.as_ref() {
        let actual = calculate_file_sha256(&download_path)?;
        if actual.to_lowercase() != expected.trim().to_lowercase() {
            let _ = fs::remove_file(&download_path);
            return Err("更新包校验失败，请重新检查版本源配置".to_string());
        }
    }

    Ok(download_path)
}

/// 描述：后台启动更新包下载任务，下载完成后前端可展示“更新”按钮。
#[tauri::command]
fn start_desktop_update_download(
    request: DesktopUpdateDownloadRequest,
) -> Result<DesktopUpdateStateResponse, String> {
    let normalized_version = request.version.trim().to_string();
    let normalized_url = request.download_url.trim().to_string();
    if normalized_version.is_empty() || normalized_url.is_empty() {
        return Err("更新参数无效，缺少版本号或下载地址".to_string());
    }

    let current_state = snapshot_desktop_update_state();
    if current_state.status == "downloading" {
        return Ok(current_state);
    }

    set_desktop_update_state(|state| {
        state.status = "downloading".to_string();
        state.target_version = normalized_version.clone();
        state.progress = 0.0;
        state.message = "更新下载中".to_string();
        state.download_path = None;
        state.checksum_sha256 = request.checksum_sha256.clone();
    });

    let async_request = DesktopUpdateDownloadRequest {
        version: normalized_version,
        download_url: normalized_url,
        checksum_sha256: request.checksum_sha256,
    };
    thread::spawn(
        move || match download_desktop_update_package(async_request.clone()) {
            Ok(path) => {
                set_desktop_update_state(|state| {
                    state.status = "ready".to_string();
                    state.progress = 100.0;
                    state.message = "更新已准备完成，点击“更新”开始安装".to_string();
                    state.download_path = Some(path.to_string_lossy().to_string());
                    state.target_version = async_request.version;
                });
            }
            Err(err) => {
                set_desktop_update_state(|state| {
                    state.status = "failed".to_string();
                    state.progress = 0.0;
                    state.message = format!("更新下载失败：{}", err);
                    state.download_path = None;
                });
            }
        },
    );

    Ok(snapshot_desktop_update_state())
}

/// 描述：打开已下载的安装包，触发系统安装流程。
fn open_downloaded_update_installer(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|err| format!("open installer failed: {}", err))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(path.to_string_lossy().to_string())
            .spawn()
            .map_err(|err| format!("start installer failed: {}", err))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|err| format!("open installer failed: {}", err))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("当前平台暂不支持自动打开安装包".to_string())
}

/// 描述：执行更新安装（打开系统安装器）；仅在下载完成后可触发。
#[tauri::command]
fn install_downloaded_desktop_update() -> Result<DesktopUpdateStateResponse, String> {
    let (download_path, target_version) = desktop_update_state_store()
        .lock()
        .map(|guard| (guard.download_path.clone(), guard.target_version.clone()))
        .map_err(|_| "更新状态读取失败".to_string())?;
    let Some(path_text) = download_path else {
        return Err("尚未下载更新包，请先检查更新".to_string());
    };
    let installer_path = PathBuf::from(path_text);
    if !installer_path.exists() {
        return Err("更新包不存在，请重新下载".to_string());
    }

    open_downloaded_update_installer(&installer_path)?;
    set_desktop_update_state(|state| {
        state.status = "installing".to_string();
        state.progress = 100.0;
        state.message = format!("已启动安装器（目标版本：{}）", target_version);
    });
    Ok(snapshot_desktop_update_state())
}

#[tauri::command]
fn get_agent_sandbox_metrics(
    session_id: String,
) -> Result<Option<libra_agent_core::sandbox::SandboxMetrics>, String> {
    Ok(libra_agent_core::sandbox::SANDBOX_REGISTRY.get_metrics(&session_id))
}

#[tauri::command]
fn reset_agent_sandbox(session_id: String) -> Result<(), String> {
    libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(&session_id);
    Ok(())
}

#[tauri::command]
fn cancel_agent_session(app: tauri::AppHandle, session_id: String) -> Result<bool, String> {
    mark_agent_session_cancelled(&session_id);
    libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(&session_id);
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
        libra_agent_core::ApprovalOutcome::Approved
    } else {
        libra_agent_core::ApprovalOutcome::Rejected
    };
    let ok = libra_agent_core::APPROVAL_REGISTRY.submit_decision(&id, outcome);
    Ok(ok)
}

#[tauri::command]
fn resolve_agent_user_input(
    id: String,
    resolution: String,
    answers: Option<Vec<UserInputAnswer>>,
) -> Result<bool, String> {
    let normalized_id = id.trim().to_string();
    if normalized_id.is_empty() {
        return Err("用户提问请求 ID 不能为空".to_string());
    }
    let normalized_resolution = resolution.trim().to_lowercase();
    if normalized_resolution != "answered" && normalized_resolution != "ignored" {
        return Err("用户提问结果必须是 answered 或 ignored".to_string());
    }
    let normalized_answers = answers.unwrap_or_default();
    if normalized_resolution == "answered" && normalized_answers.is_empty() {
        return Err("answered 状态必须携带至少一个回答".to_string());
    }
    for answer in &normalized_answers {
        if answer.question_id.trim().is_empty() {
            return Err("用户提问回答缺少 question_id".to_string());
        }
        if answer.value.trim().is_empty() {
            return Err("用户提问回答缺少 value".to_string());
        }
        let normalized_answer_type = answer.answer_type.trim();
        if normalized_answer_type != "option" && normalized_answer_type != "custom" {
            return Err("用户提问回答的 answer_type 只能是 option 或 custom".to_string());
        }
        if normalized_answer_type == "option"
            && answer
                .option_label
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            return Err("预设选项回答必须携带 option_label".to_string());
        }
    }
    let ok = libra_agent_core::USER_INPUT_REGISTRY.submit_resolution(
        &normalized_id,
        UserInputResolution {
            resolution: normalized_resolution,
            answers: normalized_answers,
        },
    );
    Ok(ok)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            apply_main_window_effects(app.handle());
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .expect("failed to initialize updater plugin");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_agent_skills,
            list_agent_skill_overview,
            register_builtin_agent_skill,
            unregister_builtin_agent_skill,
            open_builtin_agent_skill_folder,
            pick_agent_skill_folder,
            import_agent_skill_from_path,
            remove_user_agent_skill,
            list_registered_mcps,
            save_mcp_registration,
            remove_mcp_registration,
            validate_mcp_registration,
            prepare_dcc_runtime,
            check_dcc_runtime_status,
            get_agent_runtime_capabilities,
            run_agent_command,
            call_ai_summary_command,
            check_codex_cli_health,
            check_gemini_cli_health,
            check_git_cli_health,
            check_python_cli_health,
            pick_local_project_folder,
            open_external_url,
            clone_git_repository,
            check_project_dependency_rules,
            apply_project_dependency_rule_upgrades,
            inspect_project_workspace_profile_seed,
            approve_agent_action,
            resolve_agent_user_input,
            get_desktop_runtime_info,
            check_desktop_update,
            start_desktop_update_download,
            get_desktop_update_state,
            install_downloaded_desktop_update,
            reset_agent_sandbox,
            cancel_agent_session,
            get_agent_sandbox_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running libra_desktop");
}

#[cfg(test)]
mod tests {
    use super::blender_runtime::{
        blender_series_supports_extension, bridge_boot_script_content, bridge_enable_and_save_expr,
    };
    use super::{describe_panic_payload, truncate_agent_stream_text};

    #[test]
    fn should_truncate_agent_stream_text_by_char_count() {
        let source = "你好".repeat(2000);
        let result = truncate_agent_stream_text(source.as_str(), 120);
        assert!(result.chars().count() <= 121);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn should_describe_panic_payload_for_str() {
        let payload: &str = "panic-str";
        let message = describe_panic_payload(&payload);
        assert_eq!(message, "panic-str");
    }

    #[test]
    fn should_describe_panic_payload_for_string() {
        let payload = "panic-string".to_string();
        let message = describe_panic_payload(&payload);
        assert_eq!(message, "panic-string");
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

}
