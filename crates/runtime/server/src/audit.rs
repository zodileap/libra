use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// 描述：runtime 审计日志上下文，统一承载跨宿主可关联的租户、会话与运行标识。
#[derive(Debug, Clone, Default)]
pub struct AuditContext {
    pub tenant_id: String,
    pub user_id: String,
    pub project_id: String,
    pub session_id: String,
    pub run_id: String,
    pub trace_id: String,
}

/// 描述：runtime 审计日志记录参数，固定收敛到单条 JSONL 所需的全部字段。
#[derive(Debug, Clone)]
pub struct AuditRecord {
    pub level: String,
    pub category: String,
    pub event: String,
    pub context: AuditContext,
    pub status: String,
    pub tool_name: String,
    pub duration_ms: Option<u64>,
    pub error_code: String,
    pub error_message: String,
    pub summary: String,
    pub meta: Value,
}

impl AuditRecord {
    /// 描述：构造一条默认信息级别审计日志，避免调用方手写重复字段。
    pub fn info(category: &str, event: &str) -> Self {
        Self {
            level: "info".to_string(),
            category: category.to_string(),
            event: event.to_string(),
            context: AuditContext::default(),
            status: String::new(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: String::new(),
            meta: Value::Null,
        }
    }

    /// 描述：构造一条错误级别审计日志，避免失败路径遗漏 level。
    pub fn error(category: &str, event: &str) -> Self {
        let mut record = Self::info(category, event);
        record.level = "error".to_string();
        record
    }
}

/// 描述：runtime 审计日志器，负责把结构化审计事件追加写入 JSONL 文件。
#[derive(Clone)]
pub struct RuntimeAuditLogger {
    runtime_id: String,
    path: PathBuf,
    file: Arc<Mutex<File>>,
}

impl RuntimeAuditLogger {
    /// 描述：在 runtime 数据目录下创建 `logs/runtime-audit.jsonl` 并返回可复用日志器。
    pub fn open(data_dir: &Path, runtime_id: impl Into<String>) -> Result<Self, std::io::Error> {
        let runtime_id = runtime_id.into();
        let log_dir = data_dir.join("logs");
        std::fs::create_dir_all(&log_dir)?;
        let path = log_dir.join("runtime-audit.jsonl");
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            runtime_id,
            path,
            file: Arc::new(Mutex::new(file)),
        })
    }

    /// 描述：返回审计日志文件路径，供测试与宿主诊断定位落盘文件。
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 描述：把单条结构化审计记录写入 JSONL 文件，并在写入后立即 flush。
    pub fn log(&self, record: AuditRecord) -> Result<(), std::io::Error> {
        let payload = AuditLine {
            timestamp: now_rfc3339(),
            level: record.level,
            category: record.category,
            event: record.event,
            runtime_id: self.runtime_id.clone(),
            tenant_id: record.context.tenant_id,
            user_id: record.context.user_id,
            project_id: record.context.project_id,
            session_id: record.context.session_id,
            run_id: record.context.run_id,
            trace_id: record.context.trace_id,
            status: record.status,
            tool_name: record.tool_name,
            duration_ms: record.duration_ms,
            error_code: record.error_code,
            error_message: sanitize_error_message(record.error_message.as_str()),
            summary: sanitize_summary(record.summary.as_str()),
            meta: sanitize_meta(record.meta),
        };
        let mut guard = self
            .file
            .lock()
            .map_err(|_| std::io::Error::other("runtime audit log lock poisoned"))?;
        serde_json::to_writer(&mut *guard, &payload)?;
        guard.write_all(b"\n")?;
        guard.flush()?;
        Ok(())
    }
}

/// 描述：JSONL 单行结构，字段固定，避免不同宿主写出不一致的审计格式。
#[derive(Debug, Serialize)]
struct AuditLine {
    timestamp: String,
    level: String,
    category: String,
    event: String,
    runtime_id: String,
    tenant_id: String,
    user_id: String,
    project_id: String,
    session_id: String,
    run_id: String,
    trace_id: String,
    status: String,
    tool_name: String,
    duration_ms: Option<u64>,
    error_code: String,
    error_message: String,
    summary: String,
    meta: Value,
}

/// 描述：返回当前 UTC 时间的 RFC3339 文本，供审计日志统一时间格式。
fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// 描述：归一化摘要文本，确保不会把大段全文直接写入审计日志。
fn sanitize_summary(raw: &str) -> String {
    let normalized = raw.trim();
    if normalized.is_empty() {
        return String::new();
    }
    normalized.chars().take(160).collect()
}

/// 描述：归一化错误消息，只保留受限长度，避免异常栈或长文本污染审计日志。
fn sanitize_error_message(raw: &str) -> String {
    raw.trim().chars().take(240).collect()
}

/// 描述：递归裁剪审计元数据，只保留结构信息与受限文本，避免密钥、全文或大对象落盘。
fn sanitize_meta(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter_map(|(key, value)| {
                    if is_sensitive_key(key.as_str()) {
                        return None;
                    }
                    Some((key, sanitize_meta(value)))
                })
                .collect(),
        ),
        Value::Array(list) => Value::Array(list.into_iter().map(sanitize_meta).collect()),
        Value::String(text) => Value::String(text.chars().take(120).collect()),
        other => other,
    }
}

/// 描述：判断字段名是否命中固定脱敏规则，避免把密钥、env 或 header 落盘。
fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.to_lowercase();
    normalized.contains("api_key")
        || normalized.contains("token")
        || normalized.contains("secret")
        || normalized == "env"
        || normalized.ends_with("_env")
        || normalized == "headers"
        || normalized.ends_with("_headers")
}

/// 描述：返回文本长度摘要，供 prompt、模型结果与工具输出等敏感正文只落结构信息。
pub fn content_length_meta(field: &str, value: &str) -> Value {
    json!({
        format!("{}_chars", field): value.chars().count()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// 描述：验证审计日志会落到固定路径，并对敏感字段与长文本做脱敏裁剪。
    #[test]
    fn should_write_sanitized_audit_jsonl() {
        let dir = tempdir().expect("tempdir");
        let logger = RuntimeAuditLogger::open(dir.path(), "runtime-test").expect("open logger");
        logger
            .log(AuditRecord {
                level: "info".to_string(),
                category: "run".to_string(),
                event: "started".to_string(),
                context: AuditContext {
                    tenant_id: "tenant-1".to_string(),
                    user_id: "user-1".to_string(),
                    project_id: "project-1".to_string(),
                    session_id: "session-1".to_string(),
                    run_id: "run-1".to_string(),
                    trace_id: "trace-1".to_string(),
                },
                status: "running".to_string(),
                tool_name: String::new(),
                duration_ms: None,
                error_code: String::new(),
                error_message: String::new(),
                summary: "a".repeat(400),
                meta: json!({
                    "prompt_chars": 32,
                    "provider_api_key": "secret",
                    "headers": {
                        "authorization": "Bearer 123"
                    },
                    "content_preview": "b".repeat(400),
                }),
            })
            .expect("write audit line");
        let payload = std::fs::read_to_string(logger.path()).expect("read log");
        assert!(payload.contains("\"event\":\"started\""));
        assert!(payload.contains("\"prompt_chars\":32"));
        assert!(!payload.contains("provider_api_key"));
        assert!(!payload.contains("\"headers\""));
        assert!(!payload.contains(&"a".repeat(200)));
        assert!(!payload.contains(&"b".repeat(200)));
    }
}
