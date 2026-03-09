use libra_mcp_common::{
    normalize_segment, now_millis, McpError, McpResult, ProtocolAssetRecord, ProtocolEventRecord,
    ProtocolStepRecord, ProtocolStepStatus,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::{ExportModelFormat, ExportModelRequest, ExportModelResult, ModelToolTarget};

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

    let export_format = request
        .export_format
        .unwrap_or_else(|| parse_export_format_from_prompt(&request.prompt));
    let output_path = build_output_path(output_dir, &request.project_name, export_format);
    let action = export_format.bridge_action();
    let payload = build_export_payload(
        export_format,
        output_path.to_string_lossy().to_string(),
        request.export_params.as_ref(),
    )?;
    let bridge_response = invoke_action(action, payload, request.blender_bridge_addr, Some(120))?;

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
    let file_size = fs::metadata(&final_path)
        .map(|value| value.len())
        .unwrap_or(0);
    if file_size == 0 {
        return Err(McpError::new(
            "mcp.model.export.file_empty",
            format!("bridge exported empty file: {}", final_path),
        ));
    }
    let expected_ext = export_format.file_extension();
    let has_expected_ext = Path::new(&final_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(expected_ext))
        .unwrap_or(false);
    if !has_expected_ext {
        return Err(McpError::new(
            "mcp.model.export.file_extension_mismatch",
            format!(
                "exported file extension mismatch: expected .{}, got {}",
                expected_ext, final_path
            ),
        ));
    }
    let finished_at = now_millis();

    Ok(ExportModelResult {
        exported_file: final_path.clone(),
        summary: format!(
            "blender current session exported: project=`{}` format=`{}` prompt=`{}`",
            request.project_name, export_format, request.prompt
        ),
        target: ModelToolTarget::Blender,
        steps: vec![ProtocolStepRecord {
            index: 0,
            code: action.to_string(),
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
                message: format!("action={} started", action),
            },
            ProtocolEventRecord {
                event: "step_finished".to_string(),
                step_index: Some(0),
                timestamp_ms: finished_at,
                message: format!("action={} finished", action),
            },
        ],
        assets: vec![ProtocolAssetRecord {
            kind: "exported_model".to_string(),
            path: final_path,
            version: 1,
            meta: Some(json!({
                "target":"blender",
                "format": export_format.as_str(),
                "file_size_bytes": file_size
            })),
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

fn build_output_path(
    output_dir: &Path,
    project_name: &str,
    export_format: ExportModelFormat,
) -> std::path::PathBuf {
    let normalized_project = normalize_segment(project_name);
    let platform_segment = normalize_segment(std::env::consts::OS);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let timestamp_segment = format!("ts-{}", timestamp);
    let file_name = format!(
        "{}-{}-{}.{}",
        normalized_project,
        platform_segment,
        timestamp,
        export_format.file_extension()
    );
    output_dir
        .join(normalized_project)
        .join(timestamp_segment)
        .join(file_name)
}

impl ExportModelFormat {
    /// 描述：返回 Blender Bridge 的导出动作名。
    fn bridge_action(&self) -> &'static str {
        match self {
            Self::Glb => "export_glb",
            Self::Fbx => "export_fbx",
            Self::Obj => "export_obj",
        }
    }

    /// 描述：返回导出文件扩展名（不带点号）。
    fn file_extension(&self) -> &'static str {
        match self {
            Self::Glb => "glb",
            Self::Fbx => "fbx",
            Self::Obj => "obj",
        }
    }
}

/// 描述：根据自然语言提示词推断导出格式，未命中时默认 glb。
fn parse_export_format_from_prompt(prompt: &str) -> ExportModelFormat {
    let lower = prompt.to_lowercase();
    let normalized = lower.replace(
        ['，', ',', '。', '：', ':', '/', '\\', '-', '_', '(', ')'],
        " ",
    );
    let has_token = |token: &str| normalized.split_whitespace().any(|item| item == token);
    if lower.contains(".fbx") || has_token("fbx") {
        ExportModelFormat::Fbx
    } else if lower.contains(".obj") || has_token("obj") {
        ExportModelFormat::Obj
    } else {
        ExportModelFormat::Glb
    }
}

/// 描述：构建导出动作 payload，仅允许对象参数并自动补齐 output_path 与 format。
fn build_export_payload(
    format: ExportModelFormat,
    output_path: String,
    export_params: Option<&Value>,
) -> McpResult<Value> {
    let mut payload = json!({
        "output_path": output_path,
        "format": format.as_str(),
    });
    if let Some(params) = export_params {
        let params_obj = params.as_object().ok_or_else(|| {
            McpError::new(
                "mcp.model.export.invalid_params",
                "export_params must be a JSON object",
            )
        })?;
        if let Some(raw) = payload.as_object_mut() {
            for (key, value) in params_obj {
                if matches!(key.as_str(), "output_path" | "format") {
                    continue;
                }
                raw.insert(key.clone(), value.clone());
            }
        }
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(non_snake_case)]
    /// 描述：验证导出路径包含项目名目录、时间戳目录和平台兼容文件名。
    #[test]
    fn TestShouldBuildOutputPathWithProjectTimestampAndPlatform() {
        let output_dir = Path::new("/tmp/libra-exports");
        let path = build_output_path(output_dir, "My Demo Project", ExportModelFormat::Glb);
        let path_text = path.to_string_lossy();
        assert!(path_text.contains("my-demo-project"));
        assert!(path_text.contains("ts-"));
        assert!(path_text.ends_with(".glb"));

        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        assert!(file_name.contains("my-demo-project"));
        assert!(file_name.contains(&normalize_segment(std::env::consts::OS)));
    }

    #[allow(non_snake_case)]
    /// 描述：验证项目名归一化为空时回退为 untitled，确保目录结构稳定可写。
    #[test]
    fn TestShouldFallbackToUntitledWhenProjectNameIsInvalid() {
        let output_dir = Path::new("/tmp/libra-exports");
        let path = build_output_path(output_dir, "@@@", ExportModelFormat::Obj);
        let project_segment = path
            .parent()
            .and_then(|value| value.parent())
            .and_then(|value| value.file_name())
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        assert_eq!(project_segment, "untitled");
        assert!(path.to_string_lossy().ends_with(".obj"));
    }

    #[allow(non_snake_case)]
    /// 描述：验证提示词中含 fbx/obj 关键词时可推断导出格式，默认回退 glb。
    #[test]
    fn TestShouldParseExportFormatFromPrompt() {
        assert_eq!(
            parse_export_format_from_prompt("请导出 fbx 文件"),
            ExportModelFormat::Fbx
        );
        assert_eq!(
            parse_export_format_from_prompt("export current scene as .obj"),
            ExportModelFormat::Obj
        );
        assert_eq!(
            parse_export_format_from_prompt("list objects only"),
            ExportModelFormat::Glb
        );
        assert_eq!(
            parse_export_format_from_prompt("导出当前模型"),
            ExportModelFormat::Glb
        );
    }

    #[allow(non_snake_case)]
    /// 描述：验证导出 payload 会保留参数对象并强制覆盖 format/output_path 字段。
    #[test]
    fn TestShouldBuildExportPayloadWithParams() {
        let payload = build_export_payload(
            ExportModelFormat::Fbx,
            "/tmp/a.fbx".to_string(),
            Some(&json!({"use_selection": true, "format": "obj"})),
        )
        .expect("payload should build");
        assert_eq!(
            payload.get("output_path").and_then(|value| value.as_str()),
            Some("/tmp/a.fbx")
        );
        assert_eq!(
            payload.get("format").and_then(|value| value.as_str()),
            Some("fbx")
        );
        assert_eq!(
            payload
                .get("use_selection")
                .and_then(|value| value.as_bool()),
            Some(true)
        );
    }
}
