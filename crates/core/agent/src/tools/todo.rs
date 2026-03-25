use super::AgentTool;
use super::ToolContext;
use libra_mcp_common::{now_millis, ProtocolError};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::PathBuf;

pub struct TodoReadTool;

impl AgentTool for TodoReadTool {
    fn name(&self) -> &'static str {
        "todo_read"
    }

    fn description(&self) -> &'static str {
        "读取当前会话的任务清单内容。无参数。"
    }

    fn execute(&self, _args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let todo_path = resolve_todo_file_path(context.session_id);
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
        "覆盖写入当前会话的任务清单。参数：{\"items\": [{\"task\": \"描述\", \"status\": \"pending\"}]}"
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
        let todo_path = resolve_todo_file_path(context.session_id);
        if let Some(parent) = todo_path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                ProtocolError::new(
                    "core.agent.python.todo.dir_create_failed",
                    format!("创建任务清单目录失败: {}", err),
                )
            })?;
        }
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

/// 描述：返回任务清单默认存储路径，固定在系统临时目录的会话态缓存区，避免污染用户项目目录。
pub(crate) fn resolve_todo_file_path(session_id: &str) -> PathBuf {
    let normalized_session_id = normalize_todo_session_id(session_id);
    env::temp_dir()
        .join("libra-agent")
        .join("todo")
        .join(format!("{}.json", normalized_session_id))
}

/// 描述：将会话 ID 规整为安全文件名，避免路径分隔符或特殊字符污染缓存路径。
fn normalize_todo_session_id(session_id: &str) -> String {
    let normalized = session_id
        .trim()
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || matches!(char, '-' | '_') {
                char
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if normalized.is_empty() {
        return "default-session".to_string();
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::{ToolApprovalDecision, ToolContext};
    use std::path::Path;

    /// 描述：验证 todo_write 作为会话态任务面板写入，默认不进入人工审批链路。
    #[test]
    fn should_keep_todo_write_as_allow_by_default() {
        let policy = crate::policy::AgentPolicy::default();
        let context = ToolContext {
            trace_id: "test-trace".to_string(),
            session_id: "test-session",
            sandbox_root: Path::new("/tmp/libra-agent-todo-approval"),
            policy: &policy,
            on_stream_event: None,
        };
        assert_eq!(
            TodoWriteTool.approval_decision(&serde_json::json!({"items": []}), &context),
            ToolApprovalDecision::Allow
        );
    }

    /// 描述：验证任务清单缓存路径落在系统临时目录，而不是项目工作目录下。
    #[test]
    fn should_store_todo_snapshot_outside_project_workspace() {
        let sandbox_root = PathBuf::from("/tmp/demo-workspace");
        let todo_path = resolve_todo_file_path("agent-session-1");
        assert!(!todo_path.starts_with(&sandbox_root));
        assert!(todo_path.ends_with(Path::new("agent-session-1.json")));
    }

    /// 描述：验证会话 ID 中的特殊字符会被规整，避免生成非法缓存文件名。
    #[test]
    fn should_normalize_todo_session_id_for_cache_file_name() {
        assert_eq!(
            normalize_todo_session_id(" agent/session:?*1 "),
            "agent-session---1"
        );
        assert_eq!(normalize_todo_session_id(""), "default-session");
    }
}
