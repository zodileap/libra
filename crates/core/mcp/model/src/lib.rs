mod blender_session;
mod zbrush;

use zodileap_mcp_common::{McpError, McpResult};

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

pub fn ping_blender_bridge(addr: Option<String>) -> McpResult<String> {
    blender_session::ping_bridge(addr)
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
}
