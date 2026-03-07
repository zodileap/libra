use libra_mcp_common::{McpError, McpResult};

pub fn unsupported_code_capability(capability: &str) -> McpResult<()> {
    Err(McpError::new(
        "mcp.code.unsupported",
        format!("capability `{}` is not enabled", capability),
    ))
}
