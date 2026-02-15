mod blender_session;
mod complex_session;
mod zbrush;

use serde_json::Value;
use zodileap_mcp_common::{
    now_millis, McpError, McpResult, ProtocolAssetRecord, ProtocolEventRecord, ProtocolStepRecord,
    ProtocolStepStatus, ProtocolUiHint,
};

pub use complex_session::{
    build_recovery_ui_hint, build_safety_confirmation_token, build_safety_confirmation_ui_hint,
    build_step_trace_payload, check_capability_for_session_step, plan_model_session_steps,
    requires_safety_confirmation, validate_safety_confirmation_token, ModelPlanBranch,
    ModelPlanOperationKind, ModelPlanRiskLevel, ModelSessionCapabilityMatrix,
    ModelSessionPlannedStep,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelToolTarget {
    Blender,
    ZBrush,
}

#[derive(Debug, Clone)]
pub struct ExportModelRequest {
    pub project_name: String,
    pub prompt: String,
    pub output_dir: String,
    pub blender_bridge_addr: Option<String>,
    pub target: ModelToolTarget,
}

#[derive(Debug, Clone)]
pub struct ExportModelResult {
    pub exported_file: String,
    pub summary: String,
    pub target: ModelToolTarget,
    pub steps: Vec<ProtocolStepRecord>,
    pub events: Vec<ProtocolEventRecord>,
    pub assets: Vec<ProtocolAssetRecord>,
    pub ui_hint: Option<ProtocolUiHint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelToolAction {
    ListObjects,
    GetSelectionContext,
    SelectObjects,
    RenameObject,
    OrganizeHierarchy,
    TranslateObjects,
    RotateObjects,
    ScaleObjects,
    AlignOrigin,
    NormalizeScale,
    NormalizeAxis,
    AddCube,
    Solidify,
    Bevel,
    Mirror,
    Array,
    Boolean,
    AutoSmooth,
    WeightedNormal,
    Decimate,
    TidyMaterialSlots,
    CheckTexturePaths,
    ApplyTextureImage,
    PackTextures,
    NewFile,
    OpenFile,
    SaveFile,
    Undo,
    Redo,
}

impl ModelToolAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            ModelToolAction::ListObjects => "list_objects",
            ModelToolAction::GetSelectionContext => "get_selection_context",
            ModelToolAction::SelectObjects => "select_objects",
            ModelToolAction::RenameObject => "rename_object",
            ModelToolAction::OrganizeHierarchy => "organize_hierarchy",
            ModelToolAction::TranslateObjects => "translate_objects",
            ModelToolAction::RotateObjects => "rotate_objects",
            ModelToolAction::ScaleObjects => "scale_objects",
            ModelToolAction::AlignOrigin => "align_origin",
            ModelToolAction::NormalizeScale => "normalize_scale",
            ModelToolAction::NormalizeAxis => "normalize_axis",
            ModelToolAction::AddCube => "add_cube",
            ModelToolAction::Solidify => "solidify",
            ModelToolAction::Bevel => "bevel",
            ModelToolAction::Mirror => "mirror",
            ModelToolAction::Array => "array",
            ModelToolAction::Boolean => "boolean",
            ModelToolAction::AutoSmooth => "auto_smooth",
            ModelToolAction::WeightedNormal => "weighted_normal",
            ModelToolAction::Decimate => "decimate",
            ModelToolAction::TidyMaterialSlots => "tidy_material_slots",
            ModelToolAction::CheckTexturePaths => "check_texture_paths",
            ModelToolAction::ApplyTextureImage => "apply_texture_image",
            ModelToolAction::PackTextures => "pack_textures",
            ModelToolAction::NewFile => "new_file",
            ModelToolAction::OpenFile => "open_file",
            ModelToolAction::SaveFile => "save_file",
            ModelToolAction::Undo => "undo",
            ModelToolAction::Redo => "redo",
        }
    }
}

impl std::fmt::Display for ModelToolAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ModelToolAction {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_lowercase().as_str() {
            "list_objects" => Ok(Self::ListObjects),
            "get_selection_context" => Ok(Self::GetSelectionContext),
            "select_objects" => Ok(Self::SelectObjects),
            "rename_object" => Ok(Self::RenameObject),
            "organize_hierarchy" => Ok(Self::OrganizeHierarchy),
            "translate_objects" => Ok(Self::TranslateObjects),
            "rotate_objects" => Ok(Self::RotateObjects),
            "scale_objects" => Ok(Self::ScaleObjects),
            "align_origin" => Ok(Self::AlignOrigin),
            "normalize_scale" => Ok(Self::NormalizeScale),
            "normalize_axis" => Ok(Self::NormalizeAxis),
            "add_cube" => Ok(Self::AddCube),
            "solidify" => Ok(Self::Solidify),
            "bevel" => Ok(Self::Bevel),
            "mirror" => Ok(Self::Mirror),
            "array" => Ok(Self::Array),
            "boolean" => Ok(Self::Boolean),
            "auto_smooth" => Ok(Self::AutoSmooth),
            "weighted_normal" => Ok(Self::WeightedNormal),
            "decimate" => Ok(Self::Decimate),
            "tidy_material_slots" => Ok(Self::TidyMaterialSlots),
            "check_texture_paths" => Ok(Self::CheckTexturePaths),
            "apply_texture_image" => Ok(Self::ApplyTextureImage),
            "pack_textures" => Ok(Self::PackTextures),
            "new_file" => Ok(Self::NewFile),
            "open_file" => Ok(Self::OpenFile),
            "save_file" => Ok(Self::SaveFile),
            "undo" => Ok(Self::Undo),
            "redo" => Ok(Self::Redo),
            _ => Err(format!("unsupported model tool action: {}", value)),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ModelToolRequest {
    pub action: ModelToolAction,
    pub params: Value,
    pub blender_bridge_addr: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct ModelToolResult {
    pub action: ModelToolAction,
    pub message: String,
    pub output_path: Option<String>,
    pub data: Value,
    pub steps: Vec<ProtocolStepRecord>,
    pub events: Vec<ProtocolEventRecord>,
    pub assets: Vec<ProtocolAssetRecord>,
    pub ui_hint: Option<ProtocolUiHint>,
}

pub fn export_model(request: ExportModelRequest) -> McpResult<ExportModelResult> {
    if request.project_name.trim().is_empty() {
        return Err(McpError::new(
            "mcp.model.export.invalid_project",
            "project_name cannot be empty",
        ));
    }
    if request.prompt.trim().is_empty() {
        return Err(McpError::new(
            "mcp.model.export.invalid_prompt",
            "prompt cannot be empty",
        ));
    }
    if request.output_dir.trim().is_empty() {
        return Err(McpError::new(
            "mcp.model.export.invalid_output",
            "output_dir cannot be empty",
        ));
    }
    match request.target {
        ModelToolTarget::Blender => blender_session::export_current_scene(request),
        ModelToolTarget::ZBrush => zbrush::export_model(request),
    }
}

pub fn blender_bridge_script() -> &'static str {
    include_str!("../assets/blender_mcp_bridge.py")
}

pub fn blender_bridge_addon_script() -> &'static str {
    include_str!("../assets/blender_bridge_addon.py")
}

/// 描述：返回 Blender Extension 安装包需要的 manifest 内容。
pub fn blender_bridge_extension_manifest() -> &'static str {
    include_str!("../assets/blender_extension_manifest.toml")
}

pub fn ping_blender_bridge(addr: Option<String>) -> McpResult<String> {
    blender_session::ping_bridge(addr)
}

pub fn execute_model_tool(request: ModelToolRequest) -> McpResult<ModelToolResult> {
    let started_at = now_millis();
    validate_tool_request(&request)?;
    let response = blender_session::invoke_action(
        request.action.as_str(),
        request.params,
        request.blender_bridge_addr,
        request.timeout_secs,
    )?;
    let finished_at = now_millis();
    let output_path = response.output_path.clone();
    let mut assets: Vec<ProtocolAssetRecord> = Vec::new();
    if let Some(path) = output_path.clone() {
        assets.push(ProtocolAssetRecord {
            kind: "model_output".to_string(),
            path,
            version: 1,
            meta: None,
        });
    }
    Ok(ModelToolResult {
        action: request.action,
        message: response.message,
        output_path,
        data: response.data,
        steps: vec![ProtocolStepRecord {
            index: 0,
            code: request.action.as_str().to_string(),
            status: ProtocolStepStatus::Success,
            elapsed_ms: finished_at.saturating_sub(started_at),
            summary: "模型工具执行成功".to_string(),
            error: None,
            data: None,
        }],
        events: vec![
            ProtocolEventRecord {
                event: "step_started".to_string(),
                step_index: Some(0),
                timestamp_ms: started_at,
                message: format!("action={} started", request.action.as_str()),
            },
            ProtocolEventRecord {
                event: "step_finished".to_string(),
                step_index: Some(0),
                timestamp_ms: finished_at,
                message: format!("action={} finished", request.action.as_str()),
            },
        ],
        assets,
        ui_hint: None,
    })
}

fn validate_tool_request(request: &ModelToolRequest) -> McpResult<()> {
    // 描述：校验选择范围参数，仅允许 active/selected/all，保持与 Blender Bridge 语义一致。
    let validate_selection_scope = || -> McpResult<()> {
        let scope = request
            .params
            .get("selection_scope")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("selected");
        if !matches!(scope, "active" | "selected" | "all") {
            return Err(McpError::new(
                "mcp.model.tool.invalid_selection_scope",
                "selection_scope must be one of: active, selected, all",
            ));
        }
        Ok(())
    };

    // 描述：校验三维向量参数，确保是 3 个数字且处于合理范围。
    let validate_vec3 = |key: &str, min: f64, max: f64, code_prefix: &str| -> McpResult<()> {
        let vec = request
            .params
            .get(key)
            .and_then(|value| value.as_array())
            .ok_or_else(|| {
                McpError::new(
                    format!("{}.missing", code_prefix),
                    format!("{} requires `{}` array with 3 numeric values", request.action, key),
                )
            })?;
        if vec.len() != 3 {
            return Err(McpError::new(
                format!("{}.invalid", code_prefix),
                format!("{} `{}` must contain exactly 3 values", request.action, key),
            ));
        }
        for value in vec {
            let number = value.as_f64().ok_or_else(|| {
                McpError::new(
                    format!("{}.invalid", code_prefix),
                    format!("{} `{}` must be numeric", request.action, key),
                )
            })?;
            if !(min..=max).contains(&number) {
                return Err(McpError::new(
                    format!("{}.out_of_range", code_prefix),
                    format!(
                        "{} `{}` item must be in range [{}, {}]",
                        request.action, key, min, max
                    ),
                ));
            }
        }
        Ok(())
    };

    match request.action {
        ModelToolAction::AddCube => {
            let size = request
                .params
                .get("size")
                .and_then(|value| value.as_f64())
                .unwrap_or(2.0);
            if !(0.001..=1000.0).contains(&size) {
                return Err(McpError::new(
                    "mcp.model.tool.add_cube_size_out_of_range",
                    "cube size must be in range [0.001, 1000.0]",
                ));
            }
        }
        ModelToolAction::Array => {
            let count = request
                .params
                .get("count")
                .and_then(|value| value.as_u64())
                .unwrap_or(2);
            if count == 0 || count > 128 {
                return Err(McpError::new(
                    "mcp.model.tool.array_count_out_of_range",
                    "array count must be in range [1, 128]",
                ));
            }
        }
        ModelToolAction::Decimate => {
            let ratio = request
                .params
                .get("ratio")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.5);
            if !(0.01..=1.0).contains(&ratio) {
                return Err(McpError::new(
                    "mcp.model.tool.decimate_ratio_out_of_range",
                    "decimate ratio must be in range [0.01, 1.0]",
                ));
            }
        }
        ModelToolAction::Bevel => {
            let width = request
                .params
                .get("width")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.02);
            if !(0.0001..=10.0).contains(&width) {
                return Err(McpError::new(
                    "mcp.model.tool.bevel_width_out_of_range",
                    "bevel width must be in range [0.0001, 10.0]",
                ));
            }
            let segments = request
                .params
                .get("segments")
                .and_then(|value| value.as_u64())
                .unwrap_or(2);
            if segments == 0 || segments > 32 {
                return Err(McpError::new(
                    "mcp.model.tool.bevel_segments_out_of_range",
                    "bevel segments must be in range [1, 32]",
                ));
            }
        }
        ModelToolAction::Solidify => {
            let thickness = request
                .params
                .get("thickness")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.02);
            if !(0.0001..=10.0).contains(&thickness) {
                return Err(McpError::new(
                    "mcp.model.tool.solidify_thickness_out_of_range",
                    "solidify thickness must be in range [0.0001, 10.0]",
                ));
            }
        }
        ModelToolAction::Boolean => {
            let times = request
                .params
                .get("times")
                .and_then(|value| value.as_u64())
                .unwrap_or(1);
            if times == 0 || times > 8 {
                return Err(McpError::new(
                    "mcp.model.tool.boolean_times_out_of_range",
                    "boolean times must be in range [1, 8]",
                ));
            }
        }
        ModelToolAction::TranslateObjects => {
            validate_selection_scope()?;
            validate_vec3("delta", -10000.0, 10000.0, "mcp.model.tool.translate_delta")?;
        }
        ModelToolAction::RotateObjects => {
            validate_selection_scope()?;
            validate_vec3(
                "delta_euler",
                -3600.0,
                3600.0,
                "mcp.model.tool.rotate_delta_euler",
            )?;
        }
        ModelToolAction::ScaleObjects => {
            validate_selection_scope()?;
            let factor = request.params.get("factor").ok_or_else(|| {
                McpError::new(
                    "mcp.model.tool.scale_factor_missing",
                    "scale_objects requires `factor` as number or [x,y,z]",
                )
            })?;
            if let Some(value) = factor.as_f64() {
                if !(0.001..=1000.0).contains(&value) {
                    return Err(McpError::new(
                        "mcp.model.tool.scale_factor_out_of_range",
                        "scale_objects factor must be in range [0.001, 1000.0]",
                    ));
                }
            } else if let Some(vec) = factor.as_array() {
                if vec.len() != 3 {
                    return Err(McpError::new(
                        "mcp.model.tool.scale_factor_invalid",
                        "scale_objects factor array must contain exactly 3 values",
                    ));
                }
                for item in vec {
                    let value = item.as_f64().ok_or_else(|| {
                        McpError::new(
                            "mcp.model.tool.scale_factor_invalid",
                            "scale_objects factor array must be numeric",
                        )
                    })?;
                    if !(0.001..=1000.0).contains(&value) {
                        return Err(McpError::new(
                            "mcp.model.tool.scale_factor_out_of_range",
                            "scale_objects factor item must be in range [0.001, 1000.0]",
                        ));
                    }
                }
            } else {
                return Err(McpError::new(
                    "mcp.model.tool.scale_factor_invalid",
                    "scale_objects factor must be number or [x,y,z]",
                ));
            }
        }
        ModelToolAction::OpenFile => {
            let path = request
                .params
                .get("path")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .unwrap_or("");
            if path.is_empty() {
                return Err(McpError::new(
                    "mcp.model.tool.open_file_missing_path",
                    "open_file requires non-empty `path`",
                ));
            }
        }
        ModelToolAction::ApplyTextureImage => {
            let path = request
                .params
                .get("path")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .unwrap_or("");
            if path.is_empty() {
                return Err(McpError::new(
                    "mcp.model.tool.apply_texture_missing_path",
                    "apply_texture_image requires non-empty `path`",
                ));
            }
        }
        ModelToolAction::SaveFile => {
            if let Some(path) = request.params.get("path").and_then(|value| value.as_str()) {
                if path.trim().is_empty() {
                    return Err(McpError::new(
                        "mcp.model.tool.save_file_invalid_path",
                        "save_file path cannot be empty when provided",
                    ));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;

    #[test]
    fn export_should_reject_missing_project_name() {
        let temp_dir = env::temp_dir();
        let result = export_model(ExportModelRequest {
            project_name: "".to_string(),
            prompt: "导出".to_string(),
            output_dir: temp_dir.to_string_lossy().to_string(),
            blender_bridge_addr: None,
            target: ModelToolTarget::Blender,
        });
        assert!(result.is_err());
    }

    #[test]
    fn export_should_fail_without_running_bridge() {
        let output_dir = env::temp_dir().join("zodileap-mcp-model-tests");
        let _ = fs::create_dir_all(&output_dir);

        let result = export_model(ExportModelRequest {
            project_name: "Robot".to_string(),
            prompt: "导出 glb".to_string(),
            output_dir: output_dir.to_string_lossy().to_string(),
            blender_bridge_addr: Some("127.0.0.1:9".to_string()),
            target: ModelToolTarget::Blender,
        });
        assert!(result.is_err());
    }

    #[test]
    fn addon_script_should_persist_user_preferences() {
        let script = blender_bridge_addon_script();
        assert!(script.contains("save_userpref"));
        assert!(script.contains("_persist_user_preferences"));
        assert!(script.contains("view_layer"));
        assert!(script.contains("_RestrictContext"));
    }

    #[test]
    fn bridge_script_should_persist_user_preferences() {
        let script = blender_bridge_script();
        assert!(script.contains("save_userpref"));
        assert!(script.contains("_persist_user_preferences"));
        assert!(script.contains("view_layer"));
        assert!(script.contains("_RestrictContext"));
        assert!(script.contains("translate_objects"));
        assert!(script.contains("get_selection_context"));
    }

    #[test]
    fn extension_manifest_should_contain_required_fields() {
        let manifest = blender_bridge_extension_manifest();
        assert!(manifest.contains("schema_version"));
        assert!(manifest.contains("id = \"zodileap_mcp_bridge\""));
        assert!(manifest.contains("type = \"add-on\""));
        assert!(manifest.contains("blender_version_min = \"4.2.0\""));
    }

    #[test]
    fn translate_tool_should_require_valid_delta() {
        let err = validate_tool_request(&ModelToolRequest {
            action: ModelToolAction::TranslateObjects,
            params: serde_json::json!({}),
            blender_bridge_addr: None,
            timeout_secs: None,
        })
        .expect_err("translate without delta should fail");
        assert!(err.to_string().contains("translate_objects requires"));

        let ok = validate_tool_request(&ModelToolRequest {
            action: ModelToolAction::TranslateObjects,
            params: serde_json::json!({ "delta": [0.1, 0.0, -0.2], "selected_only": true }),
            blender_bridge_addr: None,
            timeout_secs: None,
        });
        assert!(ok.is_ok());
    }

    #[test]
    fn rotate_tool_should_require_delta_euler_and_valid_scope() {
        let err = validate_tool_request(&ModelToolRequest {
            action: ModelToolAction::RotateObjects,
            params: serde_json::json!({ "delta_euler": [30, 0, 0], "selection_scope": "invalid" }),
            blender_bridge_addr: None,
            timeout_secs: None,
        })
        .expect_err("rotate with invalid scope should fail");
        assert!(err.to_string().contains("selection_scope"));

        let ok = validate_tool_request(&ModelToolRequest {
            action: ModelToolAction::RotateObjects,
            params: serde_json::json!({ "delta_euler": [15, 0, -5], "selection_scope": "active" }),
            blender_bridge_addr: None,
            timeout_secs: None,
        });
        assert!(ok.is_ok());
    }

    #[test]
    fn scale_tool_should_require_factor() {
        let err = validate_tool_request(&ModelToolRequest {
            action: ModelToolAction::ScaleObjects,
            params: serde_json::json!({ "selection_scope": "selected" }),
            blender_bridge_addr: None,
            timeout_secs: None,
        })
        .expect_err("scale without factor should fail");
        assert!(err.to_string().contains("factor"));

        let ok = validate_tool_request(&ModelToolRequest {
            action: ModelToolAction::ScaleObjects,
            params: serde_json::json!({ "factor": [1.1, 1.0, 0.9], "selection_scope": "selected" }),
            blender_bridge_addr: None,
            timeout_secs: None,
        });
        assert!(ok.is_ok());
    }
}

#[cfg(test)]
#[path = "complex_session_test.rs"]
mod complex_session_tests;
