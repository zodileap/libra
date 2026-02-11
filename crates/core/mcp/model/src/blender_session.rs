use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use zodileap_mcp_common::{normalize_segment, McpError, McpResult};

use crate::{ExportModelRequest, ExportModelResult, ModelToolTarget};

const DEFAULT_BRIDGE_ADDR: &str = "127.0.0.1:23331";

#[derive(Serialize)]
struct BridgeRequest {
    action: &'static str,
    output_path: String,
}

#[derive(Deserialize)]
struct BridgeResponse {
    ok: bool,
    output_path: Option<String>,
    message: Option<String>,
}

pub fn export_current_scene(request: ExportModelRequest) -> McpResult<ExportModelResult> {
    let output_dir = Path::new(request.output_dir.trim());
    fs::create_dir_all(output_dir).map_err(|err| {
        McpError::new(
            "mcp.model.export.output_dir_create_failed",
            format!("create output dir failed: {}", err),
        )
    })?;

    let output_path = build_output_path(output_dir, &request.project_name);
    let addr = request
        .blender_bridge_addr
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_BRIDGE_ADDR);

    let mut stream = connect_bridge(addr)?;

    let bridge_request = BridgeRequest {
        action: "export_glb",
        output_path: output_path.to_string_lossy().to_string(),
    };
    let raw_request = serde_json::to_string(&bridge_request).map_err(|err| {
        McpError::new(
            "mcp.model.export.request_encode_failed",
            format!("encode bridge request failed: {}", err),
        )
    })?;

    stream
        .write_all(format!("{}\n", raw_request).as_bytes())
        .map_err(|err| {
            McpError::new(
                "mcp.model.export.request_send_failed",
                format!("send bridge request failed: {}", err),
            )
        })?;

    let mut reader = BufReader::new(stream);
    let mut raw_response = String::new();
    reader.read_line(&mut raw_response).map_err(|err| {
        McpError::new(
            "mcp.model.export.response_read_failed",
            format!("read bridge response failed: {}", err),
        )
    })?;

    if raw_response.trim().is_empty() {
        return Err(McpError::new(
            "mcp.model.export.empty_response",
            "bridge response is empty",
        ));
    }

    let bridge_response: BridgeResponse =
        serde_json::from_str(raw_response.trim()).map_err(|err| {
            McpError::new(
                "mcp.model.export.response_parse_failed",
                format!("parse bridge response failed: {}", err),
            )
        })?;

    if !bridge_response.ok {
        return Err(McpError::new(
            "mcp.model.export.bridge_rejected",
            bridge_response
                .message
                .unwrap_or_else(|| "bridge rejected request".to_string()),
        ));
    }

    let final_path = bridge_response
        .output_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| output_path.to_string_lossy().to_string());

    if !Path::new(&final_path).exists() {
        return Err(McpError::new(
            "mcp.model.export.file_not_found",
            format!(
                "bridge reported success but exported file not found: {}",
                final_path
            ),
        ));
    }

    Ok(ExportModelResult {
        exported_file: final_path.clone(),
        summary: format!(
            "blender current session exported: project=`{}` prompt=`{}`",
            request.project_name, request.prompt
        ),
        target: ModelToolTarget::Blender,
    })
}

pub fn ping_bridge(addr: Option<String>) -> McpResult<String> {
    let addr = addr
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_BRIDGE_ADDR);

    let mut stream = connect_bridge(addr)?;
    let request = BridgeRequest {
        action: "ping",
        output_path: "".to_string(),
    };
    let raw_request = serde_json::to_string(&request).map_err(|err| {
        McpError::new(
            "mcp.model.bridge.ping_encode_failed",
            format!("encode ping request failed: {}", err),
        )
    })?;

    stream
        .write_all(format!("{}\n", raw_request).as_bytes())
        .map_err(|err| {
            McpError::new(
                "mcp.model.bridge.ping_send_failed",
                format!("send ping failed: {}", err),
            )
        })?;

    let mut reader = BufReader::new(stream);
    let mut raw_response = String::new();
    reader.read_line(&mut raw_response).map_err(|err| {
        McpError::new(
            "mcp.model.bridge.ping_read_failed",
            format!("read ping response failed: {}", err),
        )
    })?;

    if raw_response.trim().is_empty() {
        return Err(McpError::new(
            "mcp.model.bridge.ping_empty_response",
            "bridge ping response is empty",
        ));
    }

    let bridge_response: BridgeResponse =
        serde_json::from_str(raw_response.trim()).map_err(|err| {
            McpError::new(
                "mcp.model.bridge.ping_parse_failed",
                format!("parse ping response failed: {}", err),
            )
        })?;

    if !bridge_response.ok {
        return Err(McpError::new(
            "mcp.model.bridge.ping_rejected",
            bridge_response
                .message
                .unwrap_or_else(|| "bridge rejected ping".to_string()),
        ));
    }

    Ok("bridge is reachable".to_string())
}

fn connect_bridge(addr: &str) -> McpResult<TcpStream> {
    let socket_addr = addr
        .to_socket_addrs()
        .map_err(|err| {
            McpError::new(
                "mcp.model.export.invalid_bridge_addr",
                format!("invalid bridge addr `{}`: {}", addr, err),
            )
        })?
        .next()
        .ok_or_else(|| {
            McpError::new(
                "mcp.model.export.invalid_bridge_addr",
                format!("invalid bridge addr `{}`", addr),
            )
        })?;

    let stream = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(3)).map_err(|err| {
        McpError::new(
            "mcp.model.export.bridge_connect_failed",
            format!(
                "cannot connect blender bridge `{}`: {}. 请确认 Blender 已重启，并在 Preferences > Add-ons 启用 `Zodileap MCP Bridge` 插件",
                addr, err
            ),
        )
    })?;

    stream
        .set_read_timeout(Some(Duration::from_secs(120)))
        .map_err(|err| {
            McpError::new(
                "mcp.model.export.bridge_timeout_set_failed",
                format!("set read timeout failed: {}", err),
            )
        })?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|err| {
            McpError::new(
                "mcp.model.export.bridge_timeout_set_failed",
                format!("set write timeout failed: {}", err),
            )
        })?;

    Ok(stream)
}

fn build_output_path(output_dir: &Path, project_name: &str) -> std::path::PathBuf {
    let normalized = normalize_segment(project_name);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    output_dir.join(format!("{}-{}.glb", normalized, timestamp))
}
