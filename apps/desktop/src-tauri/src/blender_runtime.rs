use crate::dcc_runtime::DccRuntimeStatusResponse;
use crate::dcc_runtime_support::dcc_runtime_supports_auto_prepare;
use libra_mcp_model::{
    blender_bridge_addon_script, blender_bridge_extension_manifest, ping_blender_bridge,
};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

const BLENDER_EXTENSION_MIN_VERSION: &str = "4.2.0";
const BLENDER_EXTENSION_REPO_ID: &str = "libra_local";
const BLENDER_EXTENSION_PACKAGE_NAME: &str = "libra_mcp_bridge-0.2.0.zip";

/// 描述：读取 Blender 用户配置根目录，兼容 macOS、Windows 与类 Unix 平台。
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

/// 描述：根据 Blender 可执行文件版本输出主次版本号，供扩展能力探测复用。
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
pub(crate) fn blender_series_supports_extension(series: &str) -> bool {
    let normalized = format!("{}.0", series.trim());
    !crate::is_lower_semver(&normalized, BLENDER_EXTENSION_MIN_VERSION).unwrap_or(true)
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
    let package_dir =
        env::temp_dir().join(format!("libra-bridge-extension-{}", crate::now_millis()));
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
            .join("libra_blender_bridge_addon.py");
        let legacy_boot = version_dir
            .join("scripts")
            .join("startup")
            .join("libra_bridge_boot.py");
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

/// 描述：根据 Blender 用户目录列出候选版本路径，兼容显式版本与兜底目录。
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
pub(crate) fn bridge_boot_script_content() -> &'static str {
    r#"import addon_utils
import bpy
MODULE = "libra_blender_bridge_addon"
try:
    addon_utils.enable(MODULE, default_set=True, persistent=True)
    if hasattr(bpy.ops.wm, "save_userpref"):
        bpy.ops.wm.save_userpref()
except Exception as err:
    print(f"[libra] bridge auto-enable failed: {err}")
"#
}

/// 描述：写入 Blender 启动脚本，保证 Legacy 模式下重启后仍会尝试自动启用 Bridge。
fn ensure_bridge_boot_script(startup_dir: &Path) -> Result<PathBuf, String> {
    let boot_script = startup_dir.join("libra_bridge_boot.py");
    fs::write(&boot_script, bridge_boot_script_content())
        .map_err(|err| format!("write bridge startup script failed: {}", err))?;
    Ok(boot_script)
}

/// 描述：构建后台启用 Bridge 的 Python 表达式，安装后会立刻保存用户偏好。
pub(crate) fn bridge_enable_and_save_expr() -> &'static str {
    r#"import addon_utils, bpy, traceback
MODULE = "libra_blender_bridge_addon"
try:
    addon_utils.enable(MODULE, default_set=True, persistent=True)
    if hasattr(bpy.ops.wm, "save_userpref"):
        bpy.ops.wm.save_userpref()
    print("[libra] bridge addon enabled and user preferences saved")
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

    let version_dirs = discover_blender_version_dirs(&user_root, blender_bin);
    let addon_content = blender_bridge_addon_script();
    let mut installed_paths: Vec<String> = Vec::new();

    for version_dir in version_dirs {
        let addon_dir = version_dir.join("scripts").join("addons");
        let startup_dir = version_dir.join("scripts").join("startup");
        fs::create_dir_all(&addon_dir)
            .map_err(|err| format!("create addon dir failed: {}", err))?;
        fs::create_dir_all(&startup_dir)
            .map_err(|err| format!("create startup dir failed: {}", err))?;

        let addon_path = addon_dir.join("libra_blender_bridge_addon.py");
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

/// 描述：执行 Bridge 安装主流程，包含 extension 优先与 legacy 回退策略。
///
/// Params:
///
///   - blender_bin: 可选的 Blender 可执行文件路径。
///
/// Returns:
///
///   - Ok(String): 安装完成后的提示文案。
///   - Err(String): 安装过程中的阻塞错误。
pub(crate) fn install_blender_bridge(blender_bin: Option<String>) -> Result<String, String> {
    let blender_bin = crate::resolve_blender_bin(blender_bin);
    if blender_supports_extension_install(&blender_bin) {
        match install_blender_bridge_by_extension(&blender_bin) {
            Ok(message) => {
                return Ok(message);
            }
            Err(extension_err) => {
                let legacy_message = install_blender_bridge_legacy(&blender_bin)?;
                return Ok(format!(
                    "Extension 安装失败，已自动回退到 Legacy Add-on：{}。{}",
                    extension_err, legacy_message
                ));
            }
        }
    }

    install_blender_bridge_legacy(&blender_bin)
}

/// 描述：执行 Bridge 健康检查的阻塞逻辑，避免在 UI 事件循环线程中直接进行网络连接。
///
/// Params:
///
///   - dcc_provider_addr: 当前 DCC Provider 地址，可为空。
///
/// Returns:
///
///   DccRuntimeStatusResponse: Blender Bridge 的当前运行状态。
pub(crate) fn check_blender_bridge(dcc_provider_addr: Option<String>) -> DccRuntimeStatusResponse {
    let resolved_path = dcc_provider_addr.clone().unwrap_or_default();
    match ping_blender_bridge(dcc_provider_addr) {
        Ok(message) => DccRuntimeStatusResponse {
            software: "blender".to_string(),
            available: true,
            message,
            resolved_path,
            runtime_kind: "dcc_bridge".to_string(),
            required_env_keys: Vec::new(),
            supports_auto_prepare: dcc_runtime_supports_auto_prepare("blender"),
        },
        Err(err) => DccRuntimeStatusResponse {
            software: "blender".to_string(),
            available: false,
            message: err.to_string(),
            resolved_path,
            runtime_kind: "dcc_bridge".to_string(),
            required_env_keys: Vec::new(),
            supports_auto_prepare: dcc_runtime_supports_auto_prepare("blender"),
        },
    }
}

/// 描述：执行 Blender Runtime 准备主流程，统一封装安装与健康检查逻辑，供 DCC 路由层复用。
///
/// Params:
///
///   - dcc_provider_addr: 当前 DCC Provider 地址，可为空。
///
/// Returns:
///
///   - Ok(DccRuntimeStatusResponse): Blender Runtime 当前状态。
///   - Err(String): 安装过程中的阻塞错误。
pub(crate) fn prepare_blender_runtime(
    dcc_provider_addr: Option<String>,
) -> Result<DccRuntimeStatusResponse, String> {
    let install_message = install_blender_bridge(None)?;
    let mut status = check_blender_bridge(dcc_provider_addr);
    if status.available {
        status.message = format!("{}；{}", status.message, install_message);
    } else {
        status.message = format!("{}；{}", install_message, status.message);
    }
    Ok(status)
}

/// 描述：执行 Blender Runtime 状态校验，统一封装本地 Bridge 健康检查。
///
/// Params:
///
///   - dcc_provider_addr: 当前 DCC Provider 地址，可为空。
///
/// Returns:
///
///   - Ok(DccRuntimeStatusResponse): Blender Runtime 当前状态。
///   - Err(String): 当前实现始终返回 Ok，保留 Result 以对齐通用 DCC 路由签名。
pub(crate) fn check_blender_runtime_status(
    dcc_provider_addr: Option<String>,
) -> Result<DccRuntimeStatusResponse, String> {
    Ok(check_blender_bridge(dcc_provider_addr))
}
