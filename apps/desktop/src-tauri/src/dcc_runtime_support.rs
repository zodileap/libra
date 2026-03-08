use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;

#[derive(Serialize)]
struct DccBridgePingRequest {
    action: String,
    payload: serde_json::Value,
    output_path: Option<String>,
}

#[derive(Deserialize)]
struct DccBridgePingResponse {
    ok: bool,
    code: Option<String>,
    message: Option<String>,
}

/// 描述：返回指定 DCC 软件在当前桌面端约定使用的环境变量键，便于前端提示用户如何补齐运行时配置。
///
/// Params:
///
///   - software: DCC 软件标识。
///
/// Returns:
///
///   - &[&str]: 当前软件建议配置的环境变量键列表。
pub(crate) fn required_dcc_runtime_env_keys(software: &str) -> &'static [&'static str] {
    match software.trim().to_lowercase().as_str() {
        "maya" => &["MAYA_BIN"],
        "c4d" => &["C4D_BIN"],
        _ => &[],
    }
}

/// 描述：判断指定 DCC 软件当前是否支持自动准备 Runtime，供前端决定展示“准备 Runtime”还是“手动准备”语义。
///
/// Params:
///
///   - software: DCC 软件标识。
///
/// Returns:
///
///   - true: 当前软件支持自动准备。
///   - false: 当前软件仅支持手动准备。
pub(crate) fn dcc_runtime_supports_auto_prepare(software: &str) -> bool {
    matches!(software.trim().to_lowercase().as_str(), "blender")
}

/// 描述：DCC 可执行文件探测结果，统一返回配置值与文件存在状态，便于各软件 Runtime 生成准确提示文案。
pub(crate) struct RuntimeBinaryProbe {
    pub(crate) configured_path: String,
    pub(crate) exists: bool,
}

/// 描述：读取指定环境变量中的 DCC 可执行文件路径，并同时判断该路径是否真实存在。
///
/// Params:
///
///   - env_key: 环境变量名，例如 `MAYA_BIN` 或 `C4D_BIN`。
///
/// Returns:
///
///   - Some(RuntimeBinaryProbe): 用户已配置可执行文件路径。
///   - None: 当前未配置对应环境变量。
pub(crate) fn probe_runtime_binary_from_env(env_key: &str) -> Option<RuntimeBinaryProbe> {
    let raw_path = env::var(env_key).ok()?.trim().to_string();
    if raw_path.is_empty() {
        return None;
    }
    Some(RuntimeBinaryProbe {
        configured_path: raw_path.clone(),
        exists: Path::new(&raw_path).exists(),
    })
}

/// 描述：探测指定 DCC Bridge 地址是否可建立 TCP 连接，仅验证端口连通性，不校验软件身份和协议语义。
///
/// Params:
///
///   - bridge_addr: 待探测的 DCC Bridge 地址。
///   - timeout_secs: TCP 连接超时时间（秒）。
///
/// Returns:
///
///   - Ok(Some(String)): 地址可连通，返回标准化后的地址文本。
///   - Ok(None): 未提供地址或地址为空。
///   - Err(String): 地址格式非法或当前不可连通。
#[cfg(test)]
pub(crate) fn probe_runtime_tcp_bridge(
    bridge_addr: Option<String>,
    timeout_secs: u64,
) -> Result<Option<String>, String> {
    let normalized_addr = bridge_addr
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(target_addr) = normalized_addr else {
        return Ok(None);
    };

    let socket_addr = target_addr
        .to_socket_addrs()
        .map_err(|err| format!("bridge 地址格式非法：{} ({})", target_addr, err))?
        .next()
        .ok_or_else(|| format!("bridge 地址格式非法：{}", target_addr))?;

    TcpStream::connect_timeout(&socket_addr, Duration::from_secs(timeout_secs))
        .map(|_stream| Some(target_addr))
        .map_err(|err| format!("bridge 地址不可连通：{} ({})", socket_addr, err))
}

/// 描述：按 Zodileap DCC Bridge 约定发送 `ping` 请求，验证对端是否支持统一的换行分隔 JSON 协议。
///
/// Params:
///
///   - bridge_addr: 待探测的 DCC Bridge 地址。
///   - timeout_secs: 连接与读取超时时间（秒）。
///
/// Returns:
///
///   - Ok(Some(String)): 协议探测成功，返回 Bridge 侧的 message。
///   - Ok(None): 未提供地址或地址为空。
///   - Err(String): 地址格式非法、不可连通或响应不符合 DCC Bridge 协议。
pub(crate) fn probe_runtime_bridge_protocol(
    bridge_addr: Option<String>,
    timeout_secs: u64,
) -> Result<Option<String>, String> {
    let normalized_addr = bridge_addr
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(target_addr) = normalized_addr else {
        return Ok(None);
    };

    let socket_addr = target_addr
        .to_socket_addrs()
        .map_err(|err| format!("bridge 地址格式非法：{} ({})", target_addr, err))?
        .next()
        .ok_or_else(|| format!("bridge 地址格式非法：{}", target_addr))?;

    let mut stream = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(timeout_secs))
        .map_err(|err| format!("bridge 地址不可连通：{} ({})", socket_addr, err))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(timeout_secs)))
        .map_err(|err| format!("设置 bridge 读取超时失败：{}", err))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(timeout_secs)))
        .map_err(|err| format!("设置 bridge 写入超时失败：{}", err))?;

    let payload = DccBridgePingRequest {
        action: "ping".to_string(),
        payload: json!({}),
        output_path: None,
    };
    let raw_request = serde_json::to_string(&payload)
        .map_err(|err| format!("编码 DCC Bridge ping 请求失败：{}", err))?;
    stream
        .write_all(format!("{}\n", raw_request).as_bytes())
        .map_err(|err| format!("发送 DCC Bridge ping 请求失败：{}", err))?;

    let mut reader = BufReader::new(stream);
    let mut raw_response = String::new();
    reader
        .read_line(&mut raw_response)
        .map_err(|err| format!("读取 DCC Bridge ping 响应失败：{}", err))?;
    if raw_response.trim().is_empty() {
        return Err("DCC Bridge 协议响应为空。".to_string());
    }

    let response: DccBridgePingResponse = serde_json::from_str(raw_response.trim())
        .map_err(|err| format!("解析 DCC Bridge 协议响应失败：{}", err))?;
    if response.ok {
        return Ok(Some(
            response
                .message
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "bridge 协议握手成功".to_string()),
        ));
    }

    let code = response.code.unwrap_or_else(|| "bridge_error".to_string());
    let message = response
        .message
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "bridge 返回失败状态".to_string());
    Err(format!("DCC Bridge 协议握手失败：{} ({})", message, code))
}
