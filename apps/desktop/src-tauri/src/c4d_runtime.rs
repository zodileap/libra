use crate::dcc_runtime::DccRuntimeStatusResponse;
use crate::dcc_runtime_support::{
    dcc_runtime_supports_auto_prepare, probe_runtime_binary_from_env,
    probe_runtime_bridge_protocol, required_dcc_runtime_env_keys,
};

/// 描述：构建 C4D Runtime 的统一占位状态，明确当前仅支持手动准备 Bridge。
///
/// Params:
///
///   - message: 需要返回给前端的提示文案。
///
/// Returns:
///
///   C4D Runtime 的标准状态结构。
fn build_c4d_runtime_status(message: &str) -> DccRuntimeStatusResponse {
    DccRuntimeStatusResponse {
        software: "c4d".to_string(),
        available: false,
        message: message.to_string(),
        resolved_path: String::new(),
        runtime_kind: "dcc_bridge".to_string(),
        required_env_keys: required_dcc_runtime_env_keys("c4d")
            .iter()
            .map(|item| item.to_string())
            .collect(),
        supports_auto_prepare: dcc_runtime_supports_auto_prepare("c4d"),
    }
}

/// 描述：根据当前探测结果构建 C4D Runtime 状态，优先暴露 bridge 地址，其次返回用户配置的 C4D 可执行文件路径。
///
/// Params:
///
///   - available: 当前 Runtime 是否已就绪。
///   - message: 需要返回给前端的提示文案。
///   - resolved_path: 当前命中的 bridge 地址或可执行文件路径。
///
/// Returns:
///
///   C4D Runtime 的标准状态结构。
fn build_c4d_runtime_status_with_path(
    available: bool,
    message: &str,
    resolved_path: String,
) -> DccRuntimeStatusResponse {
    DccRuntimeStatusResponse {
        software: "c4d".to_string(),
        available,
        message: message.to_string(),
        resolved_path,
        runtime_kind: "dcc_bridge".to_string(),
        required_env_keys: required_dcc_runtime_env_keys("c4d")
            .iter()
            .map(|item| item.to_string())
            .collect(),
        supports_auto_prepare: dcc_runtime_supports_auto_prepare("c4d"),
    }
}

/// 描述：执行 C4D Runtime 准备主流程；当前阶段仅返回明确的手动准备提示，避免误导前端假成功。
///
/// Params:
///
///   - _dcc_provider_addr: 当前 DCC Provider 地址，可为空；当前实现未消费该字段。
///
/// Returns:
///
///   - Ok(DccRuntimeStatusResponse): C4D Runtime 当前状态。
///   - Err(String): 当前实现始终返回 Ok，保留 Result 以对齐通用 DCC 路由签名。
pub(crate) fn prepare_c4d_runtime(
    dcc_provider_addr: Option<String>,
) -> Result<DccRuntimeStatusResponse, String> {
    if let Some(protocol_message) = probe_runtime_bridge_protocol(dcc_provider_addr.clone(), 3)? {
        return Ok(build_c4d_runtime_status_with_path(
            true,
            format!(
                "C4D Bridge 已通过 Zodileap DCC Bridge 协议校验；当前尚未内置自动安装器，将直接复用现有 Runtime。{}",
                if protocol_message.is_empty() {
                    String::new()
                } else {
                    format!("（{}）", protocol_message)
                }
            )
            .as_str(),
            dcc_provider_addr.unwrap_or_default(),
        ));
    }

    if let Some(binary_probe) = probe_runtime_binary_from_env("C4D_BIN") {
        if binary_probe.exists {
            return Ok(build_c4d_runtime_status_with_path(
                false,
                "已检测到 Cinema 4D 可执行文件；当前仓库尚未内置 C4D Bridge 自动安装器，请在 Cinema 4D 中手动安装并启动 Bridge 后再校验。",
                binary_probe.configured_path,
            ));
        }
        return Ok(build_c4d_runtime_status_with_path(
            false,
            "检测到 C4D_BIN 已配置，但路径不存在；请修正可执行文件路径后再准备 Runtime。",
            binary_probe.configured_path,
        ));
    }

    Ok(build_c4d_runtime_status(
        "未检测到 C4D Bridge 地址，也未配置 C4D_BIN；请先安装 Cinema 4D 并配置 Bridge。",
    ))
}

/// 描述：执行 C4D Runtime 状态校验；当前阶段仅返回手动准备提示。
///
/// Params:
///
///   - _dcc_provider_addr: 当前 DCC Provider 地址，可为空；当前实现未消费该字段。
///
/// Returns:
///
///   - Ok(DccRuntimeStatusResponse): C4D Runtime 当前状态。
///   - Err(String): 当前实现始终返回 Ok，保留 Result 以对齐通用 DCC 路由签名。
pub(crate) fn check_c4d_runtime_status(
    dcc_provider_addr: Option<String>,
) -> Result<DccRuntimeStatusResponse, String> {
    match probe_runtime_bridge_protocol(dcc_provider_addr.clone(), 3) {
        Ok(Some(protocol_message)) => Ok(build_c4d_runtime_status_with_path(
            true,
            format!(
                "C4D Bridge 已通过 Zodileap DCC Bridge 协议校验。{}",
                if protocol_message.is_empty() {
                    String::new()
                } else {
                    format!("（{}）", protocol_message)
                }
            )
            .as_str(),
            dcc_provider_addr.unwrap_or_default(),
        )),
        Ok(None) => {
            if let Some(binary_probe) = probe_runtime_binary_from_env("C4D_BIN") {
                if binary_probe.exists {
                    return Ok(build_c4d_runtime_status_with_path(
                        false,
                        "已检测到 Cinema 4D 可执行文件，但未检测到可连通的 C4D Bridge；请先在 Cinema 4D 中启动 Bridge。",
                        binary_probe.configured_path,
                    ));
                }
                return Ok(build_c4d_runtime_status_with_path(
                    false,
                    "检测到 C4D_BIN 已配置，但路径不存在；请修正可执行文件路径后再校验 Runtime。",
                    binary_probe.configured_path,
                ));
            }
            Ok(build_c4d_runtime_status(
                "未检测到 C4D Bridge 地址，也未配置 C4D_BIN；请先安装并启动 Cinema 4D Bridge。",
            ))
        }
        Err(err) => {
            if let Some(binary_probe) = probe_runtime_binary_from_env("C4D_BIN") {
                let fallback_message = if binary_probe.exists {
                    format!(
                        "{}；已检测到 Cinema 4D 可执行文件，但 Bridge 尚未通过 Zodileap DCC Bridge 协议校验，请先在 Cinema 4D 中启动兼容 Bridge。",
                        err
                    )
                } else {
                    format!(
                        "{}；另外检测到 C4D_BIN 配置路径不存在，请修正后再重试。",
                        err
                    )
                };
                return Ok(build_c4d_runtime_status_with_path(
                    false,
                    fallback_message.as_str(),
                    binary_probe.configured_path,
                ));
            }
            Ok(build_c4d_runtime_status(err.as_str()))
        }
    }
}
