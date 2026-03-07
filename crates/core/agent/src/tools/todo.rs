use super::AgentTool;
use super::ToolContext;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use libra_mcp_common::{now_millis, ProtocolError};

pub struct TodoReadTool;

impl AgentTool for TodoReadTool {
    fn name(&self) -> &'static str {
        "todo_read"
    }

    fn description(&self) -> &'static str {
        "读取当前工作目录的任务清单内容。无参数。"
    }

    fn execute(&self, _args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let todo_path = resolve_todo_file_path(context.sandbox_root);
        if !todo_path.exists() {
            return Ok(json!({
                "path": todo_path.to_string_lossy().to_string(),
                "items": [],
                "count": 0,
            }));
        }
        let content = fs::read_to_string(&todo_path).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.todo.read_failed",
                format!("读取任务清单失败: {}", err),
            )
        })?;
        let parsed: Value = serde_json::from_str(content.as_str()).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.todo.parse_failed",
                format!("解析任务清单失败: {}", err),
            )
        })?;
        let items = parsed
            .get("items")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(json!({
            "path": todo_path.to_string_lossy().to_string(),
            "items": items,
            "count": items.len(),
        }))
    }
}

pub struct TodoWriteTool;

impl AgentTool for TodoWriteTool {
    fn name(&self) -> &'static str {
        "todo_write"
    }

    fn description(&self) -> &'static str {
        "覆盖写入任务清单。参数：{\"items\": [{\"task\": \"描述\", \"status\": \"pending\"}]}"
    }

    fn risk_level(&self) -> crate::tools::RiskLevel {
        crate::tools::RiskLevel::High
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let items = args
            .get("items")
            .and_then(|value| value.as_array())
            .cloned()
            .ok_or_else(|| {
                ProtocolError::new(
                    "core.agent.python.todo.items_invalid",
                    "todo_write 的 items 必须是数组",
                )
            })?;
        let todo_path = resolve_todo_file_path(context.sandbox_root);
        let payload = json!({
            "updated_at": now_millis(),
            "items": items,
        });
        let pretty = serde_json::to_string_pretty(&payload).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.todo.serialize_failed",
                format!("序列化任务清单失败: {}", err),
            )
        })?;
        fs::write(&todo_path, pretty.as_bytes()).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.todo.write_failed",
                format!("写入任务清单失败: {}", err),
            )
        })?;
        Ok(json!({
            "path": todo_path.to_string_lossy().to_string(),
            "count": payload.get("items").and_then(|value| value.as_array()).map(|value| value.len()).unwrap_or(0),
            "success": true,
        }))
    }
}

/// 描述：返回任务清单默认存储路径，固定在沙盒根目录。
fn resolve_todo_file_path(sandbox_root: &Path) -> PathBuf {
    sandbox_root.join(".libra_agent_todo.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 描述：验证 todo_write 被标记为高风险，确保写操作进入人工审批流程。
    #[test]
    fn should_mark_todo_write_as_high_risk() {
        assert!(matches!(
            TodoWriteTool.risk_level(),
            crate::tools::RiskLevel::High
        ));
    }
}
