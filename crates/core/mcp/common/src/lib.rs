use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpError {
    pub code: String,
    pub message: String,
    pub suggestion: Option<String>,
    pub retryable: bool,
}

impl McpError {
    /// 描述：创建一个 MCP 统一错误对象。
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            suggestion: None,
            retryable: false,
        }
    }

    /// 描述：为错误追加可操作建议，用于前端展示下一步动作。
    pub fn with_suggestion(mut self, suggestion: impl Into<String>) -> Self {
        self.suggestion = Some(suggestion.into());
        self
    }

    /// 描述：设置错误是否支持重试，用于上层交互判断。
    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    /// 描述：将 MCP 错误转换为统一协议错误，便于 agent 与 UI 共用。
    pub fn to_protocol_error(&self) -> ProtocolError {
        ProtocolError {
            code: self.code.clone(),
            message: self.message.clone(),
            suggestion: self.suggestion.clone(),
            retryable: self.retryable,
        }
    }
}

impl Display for McpError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self.suggestion.as_deref() {
            Some(suggestion) if !suggestion.trim().is_empty() => {
                write!(
                    f,
                    "{}: {} (suggestion: {})",
                    self.code, self.message, suggestion
                )
            }
            _ => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

impl std::error::Error for McpError {}

pub type McpResult<T> = Result<T, McpError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolStepStatus {
    Success,
    Failed,
    Skipped,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
    pub suggestion: Option<String>,
    pub retryable: bool,
}

impl ProtocolError {
    /// 描述：创建一个对外协议级错误对象，统一承载错误码与消息。
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            suggestion: None,
            retryable: false,
        }
    }

    /// 描述：追加错误建议文案，给桌面端交互层展示下一步动作。
    pub fn with_suggestion(mut self, suggestion: impl Into<String>) -> Self {
        self.suggestion = Some(suggestion.into());
        self
    }

    /// 描述：设置错误可重试标记，供上层逻辑决定是否展示重试按钮。
    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }
}

impl Display for ProtocolError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self.suggestion.as_deref() {
            Some(suggestion) if !suggestion.trim().is_empty() => {
                write!(
                    f,
                    "{}: {} (suggestion: {})",
                    self.code, self.message, suggestion
                )
            }
            _ => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

impl From<McpError> for ProtocolError {
    fn from(value: McpError) -> Self {
        value.to_protocol_error()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolUiHintLevel {
    Info,
    Warning,
    Danger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolUiHintActionIntent {
    Primary,
    Default,
    Danger,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolUiHintAction {
    pub key: String,
    pub label: String,
    pub intent: ProtocolUiHintActionIntent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProtocolUiHint {
    pub key: String,
    pub level: ProtocolUiHintLevel,
    pub title: String,
    pub message: String,
    pub actions: Vec<ProtocolUiHintAction>,
    pub context: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProtocolStepRecord {
    pub index: usize,
    pub code: String,
    pub status: ProtocolStepStatus,
    pub elapsed_ms: u128,
    pub summary: String,
    pub error: Option<ProtocolError>,
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProtocolEventRecord {
    pub event: String,
    pub step_index: Option<usize>,
    pub timestamp_ms: u128,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProtocolAssetRecord {
    pub kind: String,
    pub path: String,
    pub version: u64,
    pub meta: Option<Value>,
}

/// 描述：获取当前 unix 毫秒时间戳，用于步骤与事件的统一时间字段。
pub fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

/// 描述：将任意输入转换为可用于文件名与标识的 slug 片段。
pub fn normalize_segment(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
            continue;
        }
        if ch == '-' || ch == '_' {
            result.push('-');
            continue;
        }
        if ch.is_whitespace() {
            result.push('-');
        }
    }
    let trimmed = result.trim_matches('-');
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 描述：验证 MCP 错误转换为协议错误时字段保持一致。
    #[test]
    fn should_convert_mcp_error_to_protocol_error() {
        let protocol_error = McpError::new("mcp.test.failed", "failed")
            .with_suggestion("retry")
            .with_retryable(true)
            .to_protocol_error();
        assert_eq!(protocol_error.code, "mcp.test.failed");
        assert_eq!(protocol_error.message, "failed");
        assert_eq!(protocol_error.suggestion.as_deref(), Some("retry"));
        assert!(protocol_error.retryable);
    }

    /// 描述：验证错误格式化文本会输出建议信息。
    #[test]
    fn should_display_error_with_suggestion() {
        let error =
            McpError::new("mcp.test.failed", "failed").with_suggestion("check bridge service");
        let displayed = error.to_string();
        assert!(displayed.contains("mcp.test.failed"));
        assert!(displayed.contains("check bridge service"));
    }

    /// 描述：验证 segment 归一化会去掉无效字符并转小写。
    #[test]
    fn should_normalize_segment() {
        assert_eq!(normalize_segment("My Project"), "my-project");
        assert_eq!(normalize_segment("__HELLO__"), "hello");
        assert_eq!(normalize_segment("@@@"), "untitled");
    }
}
