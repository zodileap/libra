use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use zodileap_mcp_common::{
    normalize_segment, now_millis, McpError, McpResult, ProtocolAssetRecord, ProtocolEventRecord,
    ProtocolStepRecord, ProtocolStepStatus,
};

use crate::{ExportModelRequest, ExportModelResult, ModelToolTarget};

const DEFAULT_BRIDGE_ADDR: &str = "127.0.0.1:23331";

#[derive(Serialize)]
struct BridgeRequest {
    action: String,
    payload: Value,
    output_path: Option<String>,
}

#[derive(Deserialize)]
struct BridgeResponse {
    ok: bool,
    code: Option<String>,
    output_path: Option<String>,
    message: Option<String>,
    data: Option<Value>,
    suggestion: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BridgeActionResponse {
    pub message: String,
    pub output_path: Option<String>,
    pub data: Value,
}

pub fn export_current_scene(request: ExportModelRequest) -> McpResult<ExportModelResult> {
    let started_at = now_millis();
    let output_dir = Path::new(request.output_dir.trim());
    fs::create_dir_all(output_dir).map_err(|err| {
        McpError::new(
            "mcp.model.export.output_dir_create_failed",
            format!("create output dir failed: {}", err),
        )
    })?;

    let output_path = build_output_path(output_dir, &request.project_name);
    let bridge_response = invoke_action(
        "export_glb",
        json!({ "output_path": output_path.to_string_lossy().to_string() }),
        request.blender_bridge_addr,
        Some(120),
    )?;

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
    let finished_at = now_millis();

    Ok(ExportModelResult {
        exported_file: final_path.clone(),
        summary: format!(
            "blender current session exported: project=`{}` prompt=`{}`",
            request.project_name, request.prompt
        ),
        target: ModelToolTarget::Blender,
        steps: vec![ProtocolStepRecord {
            index: 0,
            code: "export_glb".to_string(),
            status: ProtocolStepStatus::Success,
            elapsed_ms: finished_at.saturating_sub(started_at),
            summary: "当前 Blender 场景导出成功".to_string(),
            error: None,
            data: None,
        }],
        events: vec![
            ProtocolEventRecord {
                event: "step_started".to_string(),
                step_index: Some(0),
                timestamp_ms: started_at,
                message: "action=export_glb started".to_string(),
            },
            ProtocolEventRecord {
                event: "step_finished".to_string(),
                step_index: Some(0),
                timestamp_ms: finished_at,
                message: "action=export_glb finished".to_string(),
            },
        ],
        assets: vec![ProtocolAssetRecord {
            kind: "exported_model".to_string(),
            path: final_path,
            version: 1,
            meta: Some(json!({"target":"blender"})),
        }],
        ui_hint: None,
    })
}

pub fn ping_bridge(addr: Option<String>) -> McpResult<String> {
    let response = invoke_action("ping", json!({}), addr, Some(8))?;
    Ok(if response.message.trim().is_empty() {
        "bridge is reachable".to_string()
    } else {
        response.message
    })
}

pub fn invoke_action(
    action: &str,
    payload: Value,
    addr: Option<String>,
    timeout_secs: Option<u64>,
) -> McpResult<BridgeActionResponse> {
    let addr = addr
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_BRIDGE_ADDR);
    let timeout_secs = timeout_secs.unwrap_or(45).clamp(1, 240);
    let mut stream = connect_bridge(addr, timeout_secs)?;

    let bridge_request = BridgeRequest {
        action: action.to_string(),
        output_path: payload
            .get("output_path")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        payload,
    };
    let raw_request = serde_json::to_string(&bridge_request).map_err(|err| {
        McpError::new(
            "mcp.model.bridge.request_encode_failed",
            format!("encode bridge request failed: {}", err),
        )
    })?;
    stream
        .write_all(format!("{}\n", raw_request).as_bytes())
        .map_err(|err| {
            McpError::new(
                "mcp.model.bridge.request_send_failed",
                format!("send bridge request failed: {}", err),
            )
        })?;

    let mut reader = BufReader::new(stream);
    let mut raw_response = String::new();
    reader.read_line(&mut raw_response).map_err(|err| {
        McpError::new(
            "mcp.model.bridge.response_read_failed",
            format!("read bridge response failed: {}", err),
        )
    })?;

    if raw_response.trim().is_empty() {
        return Err(McpError::new(
            "mcp.model.bridge.empty_response",
            format!("bridge response is empty for action `{}`", action),
        ));
    }

    let bridge_response: BridgeResponse =
        serde_json::from_str(raw_response.trim()).map_err(|err| {
            McpError::new(
                "mcp.model.bridge.response_parse_failed",
                format!("parse bridge response failed: {}", err),
            )
        })?;

    if !bridge_response.ok {
        let code = bridge_response
            .code
            .unwrap_or_else(|| "mcp.model.bridge.rejected".to_string());
        let message = bridge_response
            .message
            .unwrap_or_else(|| "bridge rejected request".to_string());
        let suggestion = bridge_response.suggestion.unwrap_or_default();
        let merged = if suggestion.trim().is_empty() {
            message
        } else {
            format!("{}（建议：{}）", message, suggestion)
        };
        return Err(McpError::new(
            "mcp.model.bridge.action_failed",
            format!("[{}] {}: {}", code, action, merged),
        ));
    }

    Ok(BridgeActionResponse {
        message: bridge_response
            .message
            .unwrap_or_else(|| format!("action `{}` succeeded", action)),
        output_path: bridge_response.output_path,
        data: bridge_response.data.unwrap_or_else(|| json!({})),
    })
}

fn connect_bridge(addr: &str, timeout_secs: u64) -> McpResult<TcpStream> {
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
        .set_read_timeout(Some(Duration::from_secs(timeout_secs)))
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
