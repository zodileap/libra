use libra_mcp_common::{McpError, McpResult};

use crate::{ExportModelRequest, ExportModelResult};

pub fn export_model(_request: ExportModelRequest) -> McpResult<ExportModelResult> {
    Err(McpError::new(
        "mcp.model.zbrush.todo",
        "zbrush export is not enabled in current iteration",
    ))
}
