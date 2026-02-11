#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Emitter;
use tauri::Manager;
use zodileap_agent_core::{run_agent, AgentRunRequest};
use zodileap_mcp_model::{
    blender_bridge_addon_script, export_model, ping_blender_bridge, ExportModelRequest,
    ModelToolTarget,
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
    let raw = if stdout.trim().is_empty() { stderr } else { stdout };
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
) -> Result<AgentRunResponse, String> {
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

    let current_dir = env::current_dir().map_err(|err| format!("read current dir failed: {}", err))?;
    let output_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|path| path.join("exports"))
        .unwrap_or_else(|| env::temp_dir().join("zodileap-agen").join("exports"));
    fs::create_dir_all(&output_dir)
        .map_err(|err| format!("create agent output dir failed: {}", err))?;
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

    let result = run_agent(AgentRunRequest {
        agent_key,
        provider: provider.unwrap_or_else(|| "codex".to_string()),
        prompt,
        project_name,
        model_export_enabled: model_export_enabled.unwrap_or(false),
        blender_bridge_addr,
        output_dir: Some(output_dir.to_string_lossy().to_string()),
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
            log("error", "result", err.clone());
            return Err(err);
        }
    };

    Ok(AgentRunResponse {
        trace_id,
        message: result.message,
        actions: result.actions,
        exported_file: result.exported_file,
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            export_model_command,
            install_blender_bridge,
            check_blender_bridge,
            run_agent_command,
            check_codex_cli_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running zodileap_agen_desktop");
}
