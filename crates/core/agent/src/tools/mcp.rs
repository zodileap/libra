use super::{AgentTool, ToolContext};
use serde_json::Value;
use zodileap_mcp_common::ProtocolError;

#[allow(unused_imports)]
use serde_json::json;
#[allow(unused_imports)]
use super::utils::get_required_string;

pub struct McpModelTool {
    pub blender_bridge_addr: Option<String>,
}

impl AgentTool for McpModelTool {
    fn name(&self) -> &'static str {
        "mcp_model_tool"
    }

    fn description(&self) -> &'static str {
        "执行模型工具桥接调用；当前默认未启用，作为后续 MCP 接入预留。"
    }

    fn execute(
        &self,
        args: &Value,
        _context: ToolContext,
    ) -> Result<Value, ProtocolError> {
        #[cfg(feature = "with-mcp-model")]
        {
            let action_text = get_required_string(
                args,
                "action",
                "core.agent.python.model_tool.action_missing",
            )?;
            let action = action_text
                .parse::<zodileap_mcp_model::ModelToolAction>()
                .map_err(|err| {
                    ProtocolError::new(
                        "core.agent.python.model_tool.action_invalid",
                        format!("模型工具 action 无效: {}", err),
                    )
                })?;
            let params = args.get("params").cloned().unwrap_or_else(|| json!({}));
            let request = zodileap_mcp_model::ModelToolRequest {
                action,
                params,
                blender_bridge_addr: self.blender_bridge_addr.clone(),
                timeout_secs: None,
            };
            let result = zodileap_mcp_model::execute_model_tool(request)
                .map_err(|err| err.to_protocol_error())?;
            return Ok(json!({
                "action": result.action.as_str(),
                "message": result.message,
                "output_path": result.output_path,
                "data": result.data,
            }));
        }

        #[cfg(not(feature = "with-mcp-model"))]
        {
            let _ = args;
            Err(ProtocolError::new(
                "core.agent.python.model_tool_disabled",
                "当前构建未启用模型 MCP 工具能力",
            )
            .with_suggestion("请以 with-mcp-model 特性重新构建。"))
        }
    }
}
