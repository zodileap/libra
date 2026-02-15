#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;
use zodileap_agent_core::{run_agent_with_protocol_error, AgentRunRequest};
use zodileap_mcp_common::{
    ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord, ProtocolStepStatus,
    ProtocolUiHint, ProtocolUiHintAction, ProtocolUiHintActionIntent, ProtocolUiHintLevel,
};
use zodileap_mcp_model::{
    blender_bridge_addon_script, build_recovery_ui_hint, build_safety_confirmation_ui_hint,
    build_step_trace_payload, check_capability_for_session_step, execute_model_tool, export_model,
    ping_blender_bridge, plan_model_session_steps, requires_safety_confirmation,
    validate_safety_confirmation_token, ExportModelRequest, ModelSessionCapabilityMatrix,
    ModelSessionPlannedStep, ModelToolAction, ModelToolRequest, ModelToolTarget,
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
    last_output_dir: Option<String>,
    version: u64,
    cancelled: bool,
}

#[derive(Default)]
struct ModelSessionStore {
    sessions: Mutex<HashMap<String, ModelSessionState>>,
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
    let mac_default = "/Applications/Blender.app/Contents/MacOS/Blender";
    if Path::new(mac_default).exists() {
        return mac_default.to_string();
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

fn ensure_bridge_boot_script(startup_dir: &Path) -> Result<PathBuf, String> {
    let boot_script = startup_dir.join("zodileap_bridge_boot.py");
    let content = r#"import addon_utils
MODULE = "zodileap_blender_bridge_addon"
try:
    addon_utils.enable(MODULE, default_set=True, persistent=True)
except Exception as err:
    print(f"[zodileap] bridge auto-enable failed: {err}")
"#;
    fs::write(&boot_script, content)
        .map_err(|err| format!("write bridge startup script failed: {}", err))?;
    Ok(boot_script)
}

#[tauri::command]
fn install_blender_bridge(blender_bin: Option<String>) -> Result<InstallBridgeResponse, String> {
    let blender_bin = resolve_blender_bin(blender_bin);
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

    Ok(InstallBridgeResponse {
        message: format!(
            "Bridge 文件已写入。请重启 Blender 后生效。安装路径：{}",
            installed_paths.join(" | ")
        ),
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

fn parse_path_in_prompt(prompt: &str) -> Option<String> {
    let trimmed = prompt.trim();
    for token in trimmed.split_whitespace() {
        let candidate = token.trim_matches(|value| value == '"' || value == '\'' || value == '`');
        if candidate.starts_with('/') || candidate.contains(":\\") {
            return Some(candidate.to_string());
        }
    }
    None
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
                | ModelToolAction::SelectObjects
                | ModelToolAction::RenameObject
                | ModelToolAction::OrganizeHierarchy => capability_enabled(capabilities.scene),
                ModelToolAction::AlignOrigin
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

fn execute_model_tool_with_bridge_upgrade(
    action: ModelToolAction,
    params: serde_json::Value,
    blender_bridge_addr: Option<String>,
) -> Result<(String, Option<String>), String> {
    let run_once = || {
        execute_model_tool(ModelToolRequest {
            action,
            params: params.clone(),
            blender_bridge_addr: blender_bridge_addr.clone(),
            timeout_secs: Some(45),
        })
        .map(|result| (result.message, result.output_path))
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

#[tauri::command]
fn run_model_session_command(
    app: tauri::AppHandle,
    store: tauri::State<ModelSessionStore>,
    session_id: String,
    prompt: String,
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
    let planned_steps = plan_model_session_steps(normalized_prompt);
    if planned_steps.is_empty() {
        let lower = normalized_prompt.to_lowercase();
        let has_dcc_intent = [
            "blender", "zbrush", "模型", "mcp", "移动", "旋转", "缩放", "颜色", "材质", "导入",
            "导出", "打开", "保存", "正方体", "立方体", "cube", "box", "布尔链", "修改器链",
            "批量变换", "批量材质", "场景级操作", "scene pipeline", "boolean chain",
        ]
        .iter()
        .any(|keyword| lower.contains(keyword));
        if has_dcc_intent {
            return Err(desktop_error_from_text(
                "已识别为 DCC 操作，但当前 MCP 暂不支持该具体指令；不会自动替换成其他动作。当前可用：导出、列出对象、选择对象、重命名、层级整理、新建/打开/保存、撤销/重做、对齐原点、统一尺度/方向、添加正方体、加厚、倒角、镜像、阵列、布尔、自动平滑、法线加权、减面、材质槽整理、贴图路径检查、打包贴图。",
                "core.desktop.model.unsupported_action",
                false,
            ));
        }
        return Err(desktop_error_from_text(
            "未识别到可执行的模型操作。可尝试：导出、打开文件、保存、加厚、倒角、镜像、阵列、减面、自动平滑。",
            "core.desktop.model.unrecognized_step",
            false,
        ));
    }

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
    let (last_prompt, last_output_dir) = {
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
            state.last_output_dir.clone(),
        )
    };

    run_model_session_command(
        app,
        store,
        session_id,
        last_prompt,
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
    use super::{
        build_ui_hint_from_protocol_error, is_bridge_unavailable_error, plan_model_steps,
        split_error_code_and_message, PlannedModelStep,
    };
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
    fn should_detect_bridge_unavailable_error() {
        assert!(is_bridge_unavailable_error(
            "mcp.model.export.bridge_connect_failed: cannot connect blender bridge"
        ));
        assert!(!is_bridge_unavailable_error("mcp.model.bridge.action_failed: unsupported action"));
    }
}
