use crate::blender_runtime::{check_blender_runtime_status, prepare_blender_runtime};
use crate::c4d_runtime::{check_c4d_runtime_status, prepare_c4d_runtime};
use crate::maya_runtime::{check_maya_runtime_status, prepare_maya_runtime};
use serde::Serialize;

/// 描述：前端可消费的 DCC Runtime 状态结构，统一收敛软件标识、运行时状态与提示文案。
#[derive(Serialize, Clone)]
pub(crate) struct DccRuntimeStatusResponse {
    pub(crate) software: String,
    pub(crate) available: bool,
    pub(crate) message: String,
    pub(crate) resolved_path: String,
    pub(crate) runtime_kind: String,
    pub(crate) required_env_keys: Vec<String>,
    pub(crate) supports_auto_prepare: bool,
}

/// 描述：将任意 DCC 软件标识规整为小写，便于统一匹配通用运行时命令。
pub(crate) fn normalize_dcc_software_name(value: &str) -> String {
    value.trim().to_lowercase()
}

/// 描述：为当前尚未支持自动准备的 DCC 软件构建统一状态返回，避免前端暴露软件专属命令。
pub(crate) fn build_unsupported_dcc_runtime_status(software: &str) -> DccRuntimeStatusResponse {
    DccRuntimeStatusResponse {
        software: software.to_string(),
        available: false,
        message: format!(
            "当前尚未支持自动准备 {} Runtime，请改为手动安装对应 MCP Bridge 后再校验。",
            software
        ),
        resolved_path: String::new(),
        runtime_kind: "dcc_bridge".to_string(),
        required_env_keys: Vec::new(),
        supports_auto_prepare: false,
    }
}

/// 描述：声明单个 DCC Runtime 处理器，统一收敛软件标识以及 prepare/check 两类入口。
struct DccRuntimeHandler {
    software: &'static str,
    prepare: fn(Option<String>) -> Result<DccRuntimeStatusResponse, String>,
    check: fn(Option<String>) -> Result<DccRuntimeStatusResponse, String>,
}

/// 描述：返回内置 DCC Runtime 处理器列表，便于后续新增 Maya/C4D 等软件时只追加模块映射。
fn builtin_dcc_runtime_handlers() -> &'static [DccRuntimeHandler] {
    static BUILTIN_HANDLERS: [DccRuntimeHandler; 3] = [
        DccRuntimeHandler {
            software: "blender",
            prepare: prepare_blender_runtime,
            check: check_blender_runtime_status,
        },
        DccRuntimeHandler {
            software: "maya",
            prepare: prepare_maya_runtime,
            check: check_maya_runtime_status,
        },
        DccRuntimeHandler {
            software: "c4d",
            prepare: prepare_c4d_runtime,
            check: check_c4d_runtime_status,
        },
    ];
    &BUILTIN_HANDLERS
}

/// 描述：根据软件标识解析内置 DCC Runtime 处理器，避免路由层继续硬编码 if/else 分支。
///
/// Params:
///
///   - software: 当前 DCC 软件标识。
///
/// Returns:
///
///   - Some(&DccRuntimeHandler): 命中的软件处理器。
///   - None: 当前未注册该软件处理器。
fn resolve_dcc_runtime_handler(software: &str) -> Option<&'static DccRuntimeHandler> {
    builtin_dcc_runtime_handlers()
        .iter()
        .find(|handler| handler.software == software)
}

/// 描述：执行 DCC Runtime 准备主流程，当前对 Blender 提供自动安装与健康检查闭环。
///
/// Params:
///
///   - software: 当前要准备的 DCC 软件标识。
///   - dcc_provider_addr: 当前 DCC Provider 地址，可为空。
///
/// Returns:
///
///   - Ok(DccRuntimeStatusResponse): 当前软件的运行时状态。
///   - Err(String): Runtime 准备过程中的阻塞错误。
pub(crate) fn prepare_dcc_runtime_inner(
    software: String,
    dcc_provider_addr: Option<String>,
) -> Result<DccRuntimeStatusResponse, String> {
    let normalized_software = normalize_dcc_software_name(&software);
    let Some(handler) = resolve_dcc_runtime_handler(normalized_software.as_str()) else {
        return Ok(build_unsupported_dcc_runtime_status(
            normalized_software.as_str(),
        ));
    };
    (handler.prepare)(dcc_provider_addr)
}

/// 描述：执行 DCC Runtime 校验主流程，当前对 Blender 提供本地 Bridge 健康检查。
///
/// Params:
///
///   - software: 当前要校验的 DCC 软件标识。
///   - dcc_provider_addr: 当前 DCC Provider 地址，可为空。
///
/// Returns:
///
///   - Ok(DccRuntimeStatusResponse): 当前软件的运行时状态。
///   - Err(String): Runtime 校验过程中的阻塞错误。
pub(crate) fn check_dcc_runtime_status_inner(
    software: String,
    dcc_provider_addr: Option<String>,
) -> Result<DccRuntimeStatusResponse, String> {
    let normalized_software = normalize_dcc_software_name(&software);
    let Some(handler) = resolve_dcc_runtime_handler(normalized_software.as_str()) else {
        return Ok(build_unsupported_dcc_runtime_status(
            normalized_software.as_str(),
        ));
    };
    (handler.check)(dcc_provider_addr)
}
