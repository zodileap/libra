#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;
use zodileap_agent_core::llm::{call_model, parse_provider};
use zodileap_agent_core::{run_agent_with_protocol_error, AgentRunRequest};
use zodileap_mcp_common::{
    ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord, ProtocolStepStatus,
    ProtocolUiHint, ProtocolUiHintAction, ProtocolUiHintActionIntent, ProtocolUiHintLevel,
};
use zodileap_mcp_model::{
    blender_bridge_addon_script, blender_bridge_extension_manifest, build_recovery_ui_hint,
    build_safety_confirmation_ui_hint, build_step_trace_payload, check_capability_for_session_step,
    execute_model_tool, export_model, ping_blender_bridge, requires_safety_confirmation,
    validate_safety_confirmation_token, ExportModelRequest,
    ModelPlanBranch, ModelPlanOperationKind, ModelPlanRiskLevel, ModelSessionCapabilityMatrix,
    ModelSessionPlannedStep, ModelToolAction, ModelToolRequest, ModelToolResult, ModelToolTarget,
};

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

#[derive(Serialize)]
struct BridgeHealthResponse {
    ok: bool,
    message: String,
}

const BLENDER_EXTENSION_MIN_VERSION: &str = "4.2.0";
const BLENDER_EXTENSION_REPO_ID: &str = "zodileap_local";
const BLENDER_EXTENSION_PACKAGE_NAME: &str = "zodileap_mcp_bridge-0.2.0.zip";

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

#[derive(Default)]
struct ModelSessionStore {
    sessions: Mutex<HashMap<String, ModelSessionState>>,
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

#[derive(Serialize)]
struct CodexCliHealthResponse {
    available: bool,
    outdated: bool,
    version: String,
    minimum_version: String,
    bin_path: String,
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
    let joined = format!("{} {}", stdout.trim(), stderr.trim()).trim().to_string();

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
                message.push_str(&format!("。已清理 Legacy 文件：{}", removed_paths.join(" | ")));
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
        message.push_str(&format!(
            "。已尝试自动持久化启用插件但失败：{}",
            warning
        ));
    } else {
        message.push_str("。已自动执行插件持久化启用。");
    }
    Ok(message)
}

#[tauri::command]
fn install_blender_bridge(blender_bin: Option<String>) -> Result<InstallBridgeResponse, String> {
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

    Ok(InstallBridgeResponse {
        message,
    })
}

#[tauri::command]
fn check_blender_bridge(blender_bridge_addr: Option<String>) -> BridgeHealthResponse {
    match ping_blender_bridge(blender_bridge_addr) {
        Ok(message) => BridgeHealthResponse { ok: true, message },
        Err(err) => BridgeHealthResponse {
            ok: false,
            message: err.to_string(),
        },
    }
}

#[tauri::command]
fn export_model_command(
    project_name: String,
    prompt: String,
    output_dir: Option<String>,
    blender_bridge_addr: Option<String>,
    target: Option<String>,
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

    let result = export_model(ExportModelRequest {
        project_name,
        prompt,
        output_dir,
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
fn run_agent_command(
    app: tauri::AppHandle,
    agent_key: String,
    provider: Option<String>,
    prompt: String,
    trace_id: Option<String>,
    project_name: Option<String>,
    model_export_enabled: Option<bool>,
    blender_bridge_addr: Option<String>,
    output_dir: Option<String>,
) -> Result<AgentRunResponse, DesktopProtocolError> {
    let trace_id = trace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("trace-unknown")
        .to_string();
    let log = |level: &str, stage: &str, message: String| {
        eprintln!("[agent][{}][{}][{}] {}", trace_id, level, stage, message);
        let payload = AgentLogEvent {
            trace_id: trace_id.clone(),
            level: level.to_string(),
            stage: stage.to_string(),
            message,
        };
        let _ = app.emit("agent:log", payload);
    };

    let current_dir = env::current_dir().map_err(|err| DesktopProtocolError {
        code: "core.desktop.agent.current_dir_read_failed".to_string(),
        message: format!("read current dir failed: {}", err),
        suggestion: None,
        retryable: false,
    })?;
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
        current_dir.join(selected_output_dir)
    };

    if cfg!(debug_assertions) && selected_output_dir.starts_with(&current_dir) {
        let safe_output_dir = current_dir
            .parent()
            .map(|path| path.join("exports"))
            .unwrap_or_else(|| env::temp_dir().join("zodileap-agen").join("exports"));
        log(
            "warn",
            "request",
            format!(
                "output_dir {} is under src-tauri and may trigger dev restart; redirecting to {}",
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
        format!("workdir={}", current_dir.to_string_lossy()),
    );
    log(
        "debug",
        "request",
        format!("output_dir={}", selected_output_dir.to_string_lossy()),
    );

    let result = run_agent_with_protocol_error(AgentRunRequest {
        agent_key,
        provider: provider.unwrap_or_else(|| "codex".to_string()),
        prompt,
        project_name,
        model_export_enabled: model_export_enabled.unwrap_or(false),
        blender_bridge_addr,
        output_dir: Some(selected_output_dir.to_string_lossy().to_string()),
        workdir: Some(current_dir.to_string_lossy().to_string()),
    });

    let result = match result {
        Ok(value) => {
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
            log("error", "result", err.to_string());
            return Err(err.into());
        }
    };

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

#[tauri::command]
fn check_codex_cli_health(minimum_version: Option<String>) -> CodexCliHealthResponse {
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

/// 描述：将文本错误转换为协议错误对象，便于步骤记录和前端展示共用。
fn protocol_error_from_text(raw: &str, fallback_code: &str, retryable: bool) -> ProtocolError {
    let (code, message) = split_error_code_and_message(raw, fallback_code);
    ProtocolError::new(code, message).with_retryable(retryable)
}

/// 描述：将文本错误转换为桌面端命令错误，用于 Tauri invoke 结构化回传。
fn desktop_error_from_text(raw: &str, fallback_code: &str, retryable: bool) -> DesktopProtocolError {
    let protocol_error = protocol_error_from_text(raw, fallback_code, retryable);
    DesktopProtocolError::from(protocol_error)
}

/// 描述：根据协议错误生成桌面端 UI Hint，统一重试、配置修复等动作建议。
fn build_ui_hint_from_protocol_error(error: &ProtocolError) -> Option<ProtocolUiHint> {
    let lower_code = error.code.to_lowercase();
    let lower_message = error.message.to_lowercase();

    if lower_code.contains("invalid_bridge_addr")
        || lower_code.contains("bridge_connect_failed")
        || lower_message.contains("blender")
    {
        return Some(ProtocolUiHint {
            key: "restart-blender-bridge".to_string(),
            level: ProtocolUiHintLevel::Warning,
            title: "需要检查 Blender Bridge".to_string(),
            message: error
                .suggestion
                .clone()
                .unwrap_or_else(|| "请确认 Blender 已启动且 MCP Bridge 插件已启用，然后重试。".to_string()),
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

    if lower_message.contains("no_target_object")
        || lower_message.contains("no selected mesh objects")
        || lower_message.contains("no active mesh object")
    {
        return Some(ProtocolUiHint {
            key: "selection-required".to_string(),
            level: ProtocolUiHintLevel::Warning,
            title: "需要先选择对象".to_string(),
            message: "当前未检测到可操作对象。请先在 Blender 中选中目标对象后再重试。".to_string(),
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

    if lower_message.contains("导出能力已关闭") || lower_code.contains("capability_disabled") {
        return Some(ProtocolUiHint {
            key: "export-capability-disabled".to_string(),
            level: ProtocolUiHintLevel::Info,
            title: "导出能力已关闭".to_string(),
            message: "当前会话仍可执行编辑操作；如需导出，请先在模型设置中开启导出能力。".to_string(),
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
        actions.extend(["add_cube", "solidify", "bevel", "mirror", "array", "boolean"]);
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
      "params": {{ }},
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
8) 工具动作参数必须完整：
   - select_objects: params.names 必须是非空数组
   - rename_object: params.old_name 与 params.new_name 必须非空
   - translate_objects: params.delta 必须是长度为3的数组；当用户提到“这个物体/选中对象”时必须设置 params.selection_scope=active|selected
   - rotate_objects: params.delta_euler 必须是长度为3的数组；遵循同样的 selection_scope 规则
   - scale_objects: params.factor 必须是数字或长度为3数组；遵循同样的 selection_scope 规则
   - open_file: params.path 必须非空
   - apply_texture_image: params.path 必须非空

允许动作列表：
{allowed_actions}

导出能力是否可用：{export_enabled}

用户输入：
{prompt}"#
    )
}

/// 描述：构建重规划提示词，把上次规划错误反馈给 AI，要求只返回修正后的 JSON。
fn build_model_plan_retry_prompt(
    prompt: &str,
    capabilities: &ModelMcpCapabilities,
    plan_error: &str,
    raw_plan: &str,
) -> String {
    let base = build_model_plan_prompt(prompt, capabilities);
    format!(
        r#"{base}

上一次规划结果存在错误，必须修复后重试：
- 错误原因：{plan_error}
- 上次输出：{raw_plan}

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
        | ModelToolAction::Decimate => ModelPlanOperationKind::ModifierChain,
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
fn parse_llm_model_plan(raw: &str) -> Result<(Vec<ModelSessionPlannedStep>, Option<String>), String> {
    let json_text = extract_json_object(raw).ok_or_else(|| "LLM 未返回有效 JSON".to_string())?;
    let parsed: LlmModelPlanResponse = serde_json::from_str(&json_text)
        .map_err(|err| format!("解析规划 JSON 失败: {}", err))?;

    let mut steps: Vec<ModelSessionPlannedStep> = Vec::new();
    for item in parsed.steps {
        let step_type = item.step_type.trim().to_lowercase();
        match step_type.as_str() {
            "export" => {
                let operation_kind =
                    parse_operation_kind(item.operation_kind.as_deref(), None, true)?;
                let branch = parse_plan_branch(item.branch.as_deref())?;
                let risk = parse_plan_risk(item.risk.as_deref())?;
                steps.push(ModelSessionPlannedStep::Export {
                    input: item.input.unwrap_or_else(|| "导出 GLB".to_string()),
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
                let operation_kind = parse_operation_kind(
                    item.operation_kind.as_deref(),
                    Some(action),
                    false,
                )?;
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
    let select_intent = ["选择", "选中", "select"].iter().any(|key| lower.contains(key));
    let selection_reference_intent = has_selection_reference_intent(&lower);
    let ensure_selection_scoped = |params: &serde_json::Value, action_name: &str| -> Result<(), String> {
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
                    return Err("translate_objects 的 params.delta 必须是长度为3的数字数组".to_string());
                }
                ensure_selection_scoped(params, "translate_objects")?;
            }
            ModelToolAction::RotateObjects => {
                let delta = params
                    .get("delta_euler")
                    .and_then(|value| value.as_array())
                    .ok_or_else(|| "rotate_objects 缺少 params.delta_euler".to_string())?;
                if delta.len() != 3 || !delta.iter().all(|value| value.as_f64().is_some()) {
                    return Err("rotate_objects 的 params.delta_euler 必须是长度为3的数字数组".to_string());
                }
                ensure_selection_scoped(params, "rotate_objects")?;
            }
            ModelToolAction::ScaleObjects => {
                let factor = params
                    .get("factor")
                    .ok_or_else(|| "scale_objects 缺少 params.factor".to_string())?;
                let valid = factor.as_f64().is_some()
                    || factor
                        .as_array()
                        .map(|items| items.len() == 3 && items.iter().all(|item| item.as_f64().is_some()))
                        .unwrap_or(false);
                if !valid {
                    return Err("scale_objects 的 params.factor 必须是数字或长度为3的数字数组".to_string());
                }
                ensure_selection_scoped(params, "scale_objects")?;
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
                let path = params
                    .get("path")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .unwrap_or("");
                if path.is_empty() {
                    return Err("apply_texture_image 缺少 path".to_string());
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// 描述：使用 AI 进行模型步骤规划；不允许规则兜底，失败时直接返回错误。
fn plan_model_session_steps_with_llm(
    provider: Option<&str>,
    prompt: &str,
    capabilities: &ModelMcpCapabilities,
    workdir: Option<&str>,
) -> Result<Vec<ModelSessionPlannedStep>, DesktopProtocolError> {
    let parsed_provider = parse_provider(provider.unwrap_or("codex"));
    let mut last_error = String::new();
    let mut previous_raw_plan = String::new();

    for attempt in 1..=2 {
        let planner_prompt = if attempt == 1 {
            build_model_plan_prompt(prompt, capabilities)
        } else {
            build_model_plan_retry_prompt(
                prompt,
                capabilities,
                last_error.as_str(),
                previous_raw_plan.as_str(),
            )
        };
        let raw_plan = call_model(parsed_provider, planner_prompt.as_str(), workdir).map_err(|err| {
            DesktopProtocolError::from(err.to_protocol_error())
        })?;
        previous_raw_plan = raw_plan.clone();

        let parsed = parse_llm_model_plan(raw_plan.as_str());
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

        if let Err(err) = validate_llm_model_plan_steps(&steps, prompt) {
            last_error = format!("规划步骤校验失败: {}", err);
            if attempt == 1 {
                continue;
            }
            return Err(desktop_error_from_text(
                last_error.as_str(),
                "core.desktop.model.plan_invalid",
                false,
            ));
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
    if let Some(selected_only) = params.get("selected_only").and_then(|value| value.as_bool()) {
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
    if !matches!(
        action,
        ModelToolAction::TranslateObjects | ModelToolAction::RotateObjects | ModelToolAction::ScaleObjects
    ) {
        return None;
    }
    let scope = resolve_selection_scope_from_params(params);
    if scope == "all" {
        None
    } else {
        Some(scope)
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
fn selection_context_meets_scope(snapshot: &SelectionContextSnapshot, required_scope: &str) -> bool {
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
    ["旋转", "rotate"]
        .iter()
        .any(|key| lower.contains(key))
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
    ["缩放", "scale"]
        .iter()
        .any(|key| lower.contains(key))
}

/// 描述：提取统一缩放因子，未提供时使用默认值。
fn parse_scale_factor(prompt: &str) -> f64 {
    parse_first_number(prompt).unwrap_or(1.1).clamp(0.001, 1000.0)
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
    let has_apply_verb = ["添加", "替换", "设置", "应用", "assign", "apply", "set", "use"]
        .iter()
        .any(|keyword| lower.contains(keyword));
    let lower_path = path.to_lowercase();
    let is_image_file = [".png", ".jpg", ".jpeg", ".tga", ".bmp", ".tif", ".tiff", ".exr"]
        .iter()
        .any(|suffix| lower_path.ends_with(suffix));
    let starts_with_material_instruction =
        ["贴图", "纹理", "材质", "texture", "image", "material"]
            .iter()
            .any(|prefix| prompt.trim_start().to_lowercase().starts_with(prefix));

    (has_texture_keyword && has_apply_verb && is_image_file)
        || (starts_with_material_instruction && is_image_file)
}

fn is_add_cube_intent(prompt: &str, lower: &str) -> bool {
    const CN_EXPLICIT: [&str; 12] = [
        "添加正方体",
        "添加一个正方体",
        "添加立方体",
        "添加一个立方体",
        "新建正方体",
        "新建立方体",
        "创建正方体",
        "创建立方体",
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
    },
    Tool {
        action: ModelToolAction,
        input: String,
        params: serde_json::Value,
    },
}

fn plan_model_steps(prompt: &str) -> Vec<PlannedModelStep> {
    let lower = prompt.to_lowercase();
    let mut steps: Vec<PlannedModelStep> = Vec::new();

    if ["导出", "export", "输出glb", "导出模型"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(PlannedModelStep::Export {
            input: "导出 GLB".to_string(),
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
    if lower.contains("重命名") || lower.contains("rename") {
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
    if lower.contains("设为父级") || lower.contains("parent") {
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
    if ["保存", "save file"].iter().any(|key| lower.contains(key)) {
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
        let selection_scope = derive_selection_scope(&lower);
        let selected_only = selection_scope != "all";
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::TranslateObjects,
            input: "平移对象".to_string(),
            params: json!({
                "delta": [delta.0, delta.1, delta.2],
                "selection_scope": selection_scope,
                "selected_only": selected_only,
            }),
        });
    }
    if is_rotate_intent(&lower) {
        let delta = parse_rotate_delta(prompt, &lower);
        let selection_scope = derive_selection_scope(&lower);
        let selected_only = selection_scope != "all";
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::RotateObjects,
            input: "旋转对象".to_string(),
            params: json!({
                "delta_euler": [delta.0, delta.1, delta.2],
                "selection_scope": selection_scope,
                "selected_only": selected_only,
            }),
        });
    }
    if is_scale_intent(&lower) {
        let factor = parse_scale_factor(prompt);
        let selection_scope = derive_selection_scope(&lower);
        let selected_only = selection_scope != "all";
        steps.push(PlannedModelStep::Tool {
            action: ModelToolAction::ScaleObjects,
            input: "缩放对象".to_string(),
            params: json!({
                "factor": factor,
                "selection_scope": selection_scope,
                "selected_only": selected_only,
            }),
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
            steps.push(PlannedModelStep::Tool {
                action: ModelToolAction::ApplyTextureImage,
                input: format!("应用贴图 {}", path),
                params: json!({ "path": path }),
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
                | ModelToolAction::Decimate => capability_enabled(capabilities.mesh_opt),
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
fn launch_blender_for_action(action: ModelToolAction, params: &serde_json::Value) -> Result<(), String> {
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
fn wait_for_bridge_ready(blender_bridge_addr: Option<String>, attempts: u32, interval_ms: u64) -> bool {
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
                    format!(
                        "{}。Bridge 已就绪但动作仍失败：{}",
                        first_err, second_err
                    )
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

#[tauri::command]
fn run_model_session_command(
    app: tauri::AppHandle,
    store: tauri::State<ModelSessionStore>,
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
    let output_dir = normalize_output_dir_for_model(&app, output_dir)
        .map_err(|err| desktop_error_from_text(&err, "core.desktop.model.output_dir_invalid", false))?;
    let output_dir_string = output_dir.to_string_lossy().to_string();
    let current_dir = env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let normalized_provider = provider
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "codex".to_string());
    let planned_steps = plan_model_session_steps_with_llm(
        Some(normalized_provider.as_str()),
        normalized_prompt,
        &capabilities,
        current_dir.as_deref(),
    )?;

    {
        let mut map = store
            .sessions
            .lock()
            .map_err(|_| DesktopProtocolError {
                code: "core.desktop.model.store_lock_failed".to_string(),
                message: "model session store lock poisoned".to_string(),
                suggestion: None,
                retryable: true,
            })?;
        let session = map.entry(session_id.clone()).or_default();
        session.cancelled = false;
        session.last_prompt = Some(normalized_prompt.to_string());
        session.last_provider = Some(normalized_provider.clone());
        session.last_output_dir = Some(output_dir_string.clone());
    }

    if requires_safety_confirmation(&planned_steps) {
        let valid = confirmation_token
            .as_deref()
            .map(|value| validate_safety_confirmation_token(&trace_id, normalized_prompt, value))
            .unwrap_or(false);
        if !valid {
            let base_index = {
                let map = store
                    .sessions
                    .lock()
                    .map_err(|_| DesktopProtocolError {
                        code: "core.desktop.model.store_lock_failed".to_string(),
                        message: "model session store lock poisoned".to_string(),
                        suggestion: None,
                        retryable: true,
                    })?;
                map.get(&session_id).map(|state| state.steps.len()).unwrap_or(0)
            };
            let ui_hint = build_safety_confirmation_ui_hint(&trace_id, normalized_prompt, &planned_steps);
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
                let mut map = store
                    .sessions
                    .lock()
                    .map_err(|_| DesktopProtocolError {
                        code: "core.desktop.model.store_lock_failed".to_string(),
                        message: "model session store lock poisoned".to_string(),
                        suggestion: None,
                        retryable: true,
                    })?;
                let session = map.entry(session_id.clone()).or_default();
                session.steps.extend(created_steps.clone());
                session.events.extend(created_events.clone());
                (
                    session.steps.clone(),
                    session.events.clone(),
                    session.assets.clone(),
                )
            };
            return Ok(ModelSessionRunResponse {
                trace_id,
                message: "检测到高风险复杂操作，等待你确认后执行一次。".to_string(),
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
    let prompt_lower = normalized_prompt.to_lowercase();
    let mut selection_context_cache: Option<SelectionContextSnapshot> = None;

    for step in primary_steps {
        {
            let map = store
                .sessions
                .lock()
                .map_err(|_| DesktopProtocolError {
                    code: "core.desktop.model.store_lock_failed".to_string(),
                    message: "model session store lock poisoned".to_string(),
                    suggestion: None,
                    retryable: true,
                })?;
            let session = map
                .get(&session_id)
                .ok_or_else(|| DesktopProtocolError {
                    code: "core.desktop.model.session_not_found".to_string(),
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
            let map = store
                .sessions
                .lock()
                .map_err(|_| DesktopProtocolError {
                    code: "core.desktop.model.store_lock_failed".to_string(),
                    message: "model session store lock poisoned".to_string(),
                    suggestion: None,
                    retryable: true,
                })?;
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
        let started = Instant::now();
        let step_code = step.code();
        let step_input = step.input().to_string();
        let step_trace_data = build_step_trace_payload(&step);

        if let Some(required_scope) = required_selection_scope_for_step(prompt_lower.as_str(), &step) {
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
                        let mut map = store
                            .sessions
                            .lock()
                            .map_err(|_| DesktopProtocolError {
                                code: "core.desktop.model.store_lock_failed".to_string(),
                                message: "model session store lock poisoned".to_string(),
                                suggestion: None,
                                retryable: true,
                            })?;
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
            ModelSessionPlannedStep::Export { .. } => {
                export_model(ExportModelRequest {
                    project_name: project_name
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("model-project")
                        .to_string(),
                    prompt: normalized_prompt.to_string(),
                    output_dir: output_dir_string.clone(),
                    blender_bridge_addr: blender_bridge_addr.clone(),
                    target: ModelToolTarget::Blender,
                })
                .map(|result| {
                    (
                        format!("导出成功：{}", result.exported_file),
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
                let mut step_data = step_trace_data.clone();
                if let Some(raw) = step_data.as_object_mut() {
                    raw.insert("input".to_string(), json!(step_input));
                    raw.insert("trace_id".to_string(), json!(trace_id.clone()));
                }
                if let Some(path) = output_path.clone() {
                    if let Some(raw) = step_data.as_object_mut() {
                        raw.insert("exported_file".to_string(), json!(path.clone()));
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
                        let mut map = store
                            .sessions
                            .lock()
                            .map_err(|_| DesktopProtocolError {
                                code: "core.desktop.model.store_lock_failed".to_string(),
                                message: "model session store lock poisoned".to_string(),
                                suggestion: None,
                                retryable: true,
                            })?;
                        let session = map
                            .get_mut(&session_id)
                            .ok_or_else(|| DesktopProtocolError {
                                code: "core.desktop.model.session_not_found".to_string(),
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
                if should_invalidate_selection_context_cache(&step) {
                    selection_context_cache = None;
                }
            }
            Err(err) => {
                let protocol_error =
                    protocol_error_from_text(&err, "core.desktop.model.step_failed", true);
                let mut failed_step_data = step_trace_data.clone();
                if let Some(raw) = failed_step_data.as_object_mut() {
                    raw.insert("input".to_string(), json!(step_input.clone()));
                    raw.insert("trace_id".to_string(), json!(trace_id.clone()));
                    raw.insert("error_code".to_string(), json!(protocol_error.code.clone()));
                    raw.insert("error_message".to_string(), json!(protocol_error.message.clone()));
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

                let mut recovery_summary = String::new();
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
                        recovery_summary = "已自动执行 Undo 回滚。".to_string();
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
                    let mut map = store
                        .sessions
                        .lock()
                        .map_err(|_| DesktopProtocolError {
                            code: "core.desktop.model.store_lock_failed".to_string(),
                            message: "model session store lock poisoned".to_string(),
                            suggestion: None,
                            retryable: true,
                        })?;
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

                return Ok(ModelSessionRunResponse {
                    trace_id,
                    message: format!(
                        "工作流在步骤 `{}` 失败：{} {}",
                        step.code(),
                        protocol_error.message,
                        recovery_summary
                    ),
                    steps: all_steps,
                    events: all_events,
                    assets: all_assets,
                    exported_file,
                    ui_hint,
                });
            }
        }
    }

    let (all_steps, all_events, all_assets) = {
        let mut map = store
            .sessions
            .lock()
            .map_err(|_| DesktopProtocolError {
                code: "core.desktop.model.store_lock_failed".to_string(),
                message: "model session store lock poisoned".to_string(),
                suggestion: None,
                retryable: true,
            })?;
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
        "agent:log",
        AgentLogEvent {
            trace_id: trace_id.clone(),
            level: "info".to_string(),
            stage: "model-session".to_string(),
            message: format!("session={}, steps={}", session_id, created_steps.len()),
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
fn retry_model_session_last_step(
    app: tauri::AppHandle,
    store: tauri::State<ModelSessionStore>,
    session_id: String,
    trace_id: Option<String>,
    project_name: Option<String>,
    capabilities: Option<ModelMcpCapabilities>,
    blender_bridge_addr: Option<String>,
) -> Result<ModelSessionRunResponse, DesktopProtocolError> {
    let (last_prompt, last_provider, last_output_dir) = {
        let map = store
            .sessions
            .lock()
            .map_err(|_| DesktopProtocolError {
                code: "core.desktop.model.store_lock_failed".to_string(),
                message: "model session store lock poisoned".to_string(),
                suggestion: None,
                retryable: true,
            })?;
        let state = map
            .get(&session_id)
            .ok_or_else(|| DesktopProtocolError {
                code: "core.desktop.model.session_not_found".to_string(),
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

    run_model_session_command(
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
fn undo_model_session_step(
    app: tauri::AppHandle,
    store: tauri::State<ModelSessionStore>,
    session_id: String,
    trace_id: Option<String>,
    blender_bridge_addr: Option<String>,
) -> Result<ModelSessionRunResponse, DesktopProtocolError> {
    run_model_session_command(
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

fn main() {
    tauri::Builder::default()
        .manage(ModelSessionStore::default())
        .invoke_handler(tauri::generate_handler![
            export_model_command,
            install_blender_bridge,
            check_blender_bridge,
            run_agent_command,
            check_codex_cli_health,
            run_model_session_command,
            retry_model_session_last_step,
            undo_model_session_step,
            cancel_model_session_step,
            get_model_session_records
        ])
        .run(tauri::generate_context!())
        .expect("error while running zodileap_agen_desktop");
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use super::{
        blender_series_supports_extension, bridge_boot_script_content, bridge_enable_and_save_expr,
        build_model_plan_prompt, build_ui_hint_from_protocol_error, is_bridge_unavailable_error,
        parse_llm_model_plan, parse_selection_context_snapshot, plan_model_steps,
        required_selection_scope_for_step, selection_context_meets_scope,
        split_error_code_and_message, validate_llm_model_plan_steps, ModelMcpCapabilities,
        PlannedModelStep, SelectionContextSnapshot,
    };
    use zodileap_mcp_model::{ModelPlanBranch, ModelPlanOperationKind, ModelPlanRiskLevel, ModelSessionPlannedStep, ModelToolAction};
    use zodileap_mcp_common::ProtocolError;

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
    fn should_split_protocol_error_text() {
        let (code, message) = split_error_code_and_message(
            "mcp.model.export.invalid_bridge_addr: invalid bridge addr `127.0.0.1:notaport`",
            "fallback.code",
        );
        assert_eq!(code, "mcp.model.export.invalid_bridge_addr");
        assert!(message.contains("invalid bridge addr"));
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
    fn should_detect_bridge_unavailable_error() {
        assert!(is_bridge_unavailable_error(
            "mcp.model.export.bridge_connect_failed: cannot connect blender bridge"
        ));
        assert!(!is_bridge_unavailable_error("mcp.model.bridge.action_failed: unsupported action"));
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
        let steps = plan_model_steps("我发现场景地板的贴图缺失了，能用“/Users/yoho/Downloads/image.png”添加吗");
        let has_apply_texture = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, .. } if action.as_str() == "apply_texture_image"
            )
        });
        assert!(has_apply_texture, "贴图补图请求应路由到 apply_texture_image 动作");
    }

    #[test]
    fn should_plan_apply_texture_image_step_with_quoted_space_path() {
        let steps = plan_model_steps("我发现场景地板的贴图缺失了，能用“ /Users/yoho/Downloads/image.png”添加吗");
        let has_apply_texture = steps.iter().any(|step| {
            matches!(
                step,
                PlannedModelStep::Tool { action, .. } if action.as_str() == "apply_texture_image"
            )
        });
        assert!(has_apply_texture, "带空格引号路径也应路由到 apply_texture_image 动作");
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
    fn planner_prompt_should_require_json_only() {
        let prompt = build_model_plan_prompt(
            "给地板补贴图 /Users/yoho/Downloads/image.png",
            &ModelMcpCapabilities::default(),
        );
        assert!(prompt.contains("只能输出 JSON"));
        assert!(prompt.contains("不允许规则兜底"));
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
        let err = validate_llm_model_plan_steps(&steps, "创建一个正方体并贴图 /Users/yoho/Downloads/image.png")
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
}
