use super::utils::{get_required_string, parse_positive_usize_arg, resolve_executable_binary};
use super::{AgentTool, ToolContext};
use serde_json::{json, Value};
use std::env;
use std::process::Command;
use url::Url;
use libra_mcp_common::ProtocolError;

const DEFAULT_WEB_MAX_BYTES: usize = 200_000;
const MAX_WEB_MAX_BYTES: usize = 2_000_000;

/// 描述：默认允许联网访问的域名列表；可通过环境变量覆盖或扩展。
const DEFAULT_ALLOWED_WEB_DOMAINS: [&str; 9] = [
    "api.duckduckgo.com",
    "duckduckgo.com",
    "github.com",
    "raw.githubusercontent.com",
    "docs.rs",
    "rust-lang.org",
    "npmjs.com",
    "pnpm.io",
    "tauri.app",
];

/// 描述：解析联网工具允许访问的域名白名单。
fn resolve_allowed_web_domains() -> Vec<String> {
    let configured = env::var("ZODILEAP_WEB_ALLOWED_DOMAINS")
        .ok()
        .map(|value| parse_allowed_web_domains(value.as_str()))
        .unwrap_or_default();
    if configured.is_empty() {
        return DEFAULT_ALLOWED_WEB_DOMAINS
            .iter()
            .map(|value| value.to_string())
            .collect();
    }
    configured
}

/// 描述：将逗号或空白分隔的域名文本标准化为白名单数组。
fn parse_allowed_web_domains(raw: &str) -> Vec<String> {
    raw.split(|ch: char| ch == ',' || ch.is_whitespace())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase())
        .collect()
}

/// 描述：提取 URL 主机名（自动移除端口与用户信息）。
fn extract_url_host(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    parsed
        .host_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase())
}

/// 描述：判断 host 是否命中白名单（支持子域名匹配）。
fn is_host_allowed(host: &str, allowlist: &[String]) -> bool {
    allowlist.iter().any(|domain| {
        if host == domain.as_str() {
            return true;
        }
        let suffix = format!(".{}", domain);
        host.ends_with(suffix.as_str())
    })
}

/// 描述：校验目标 URL 是否属于允许访问域名，命中失败直接阻断请求。
fn ensure_url_allowed(url: &str, allowlist: &[String]) -> Result<(), ProtocolError> {
    let host = extract_url_host(url).ok_or_else(|| {
        ProtocolError::new(
            "core.agent.python.web.invalid_url",
            "URL 解析失败，无法识别域名",
        )
    })?;
    if is_host_allowed(host.as_str(), allowlist) {
        return Ok(());
    }
    Err(ProtocolError::new(
        "core.agent.python.web.domain_not_allowed",
        format!("当前域名不在白名单中: {}", host),
    )
    .with_suggestion("请通过 ZODILEAP_WEB_ALLOWED_DOMAINS 配置允许访问的域名。"))
}

/// 描述：解析联网工具 method 参数，当前仅允许 GET。
fn resolve_web_method(args: &Value, default_value: &str) -> Result<String, ProtocolError> {
    let method = args
        .get("method")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_value)
        .to_uppercase();
    if method != "GET" {
        return Err(ProtocolError::new(
            "core.agent.python.web.method_not_allowed",
            format!("仅支持 GET 方法，收到 {}", method),
        )
        .with_suggestion("请将 method 调整为 GET。"));
    }
    Ok(method)
}

pub struct WebSearchTool;

impl AgentTool for WebSearchTool {
    fn name(&self) -> &'static str {
        "web_search"
    }

    fn description(&self) -> &'static str {
        "联网搜索公开网页并返回结构化结果，默认通过 DuckDuckGo Instant Answer API。参数：{\"query\": \"搜索词\", \"limit\": \"条数，默认 5\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let query =
            get_required_string(args, "query", "core.agent.python.web_search.query_missing")?;
        let limit = parse_positive_usize_arg(args, "limit", 5, 20)?;
        let timeout_secs = parse_positive_usize_arg(
            args,
            "timeout_secs",
            context.policy.tool_timeout_secs as usize,
            120,
        )?;
        let max_bytes =
            parse_positive_usize_arg(args, "max_bytes", DEFAULT_WEB_MAX_BYTES, MAX_WEB_MAX_BYTES)?;
        let _method = resolve_web_method(args, "GET")?;
        let curl_bin = resolve_executable_binary("curl", "--version").ok_or_else(|| {
            ProtocolError::new(
                "core.agent.python.web_search.curl_missing",
                "未检测到可用 curl",
            )
            .with_suggestion("请安装 curl 后重试。")
        })?;
        let encoded_query = url_encode_component(query.as_str());
        let url = format!(
            "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
            encoded_query
        );
        let allowlist = resolve_allowed_web_domains();
        ensure_url_allowed(url.as_str(), allowlist.as_slice())?;
        let timeout_text = timeout_secs.to_string();
        let output = Command::new(curl_bin.as_str())
            .args([
                "-L",
                "-sS",
                "--max-time",
                timeout_text.as_str(),
                url.as_str(),
            ])
            .output()
            .map_err(|err| {
                ProtocolError::new(
                    "core.agent.python.web_search.exec_failed",
                    format!("执行联网搜索失败: {}", err),
                )
            })?;
        if !output.status.success() {
            return Err(ProtocolError::new(
                "core.agent.python.web_search.failed",
                "联网搜索请求失败",
            ));
        }
        if output.stdout.len() > max_bytes {
            return Err(ProtocolError::new(
                "core.agent.python.web_search.too_large",
                format!("响应体过大（{} bytes）", output.stdout.len()),
            )
            .with_suggestion("请缩小查询范围，或调小 max_bytes。"));
        }
        let body = String::from_utf8_lossy(output.stdout.as_slice()).to_string();
        let parsed: Value = serde_json::from_str(body.as_str()).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.web_search.parse_failed",
                format!("解析联网搜索结果失败: {}", err),
            )
        })?;
        let results = extract_duckduckgo_results(&parsed, limit);
        Ok(json!({
            "query": query,
            "count": results.len(),
            "results": results,
        }))
    }
}

pub struct FetchUrlTool;

impl AgentTool for FetchUrlTool {
    fn name(&self) -> &'static str {
        "fetch_url"
    }

    fn description(&self) -> &'static str {
        "抓取网页正文片段，用于读取文档详情而非仅搜索摘要。参数：{\"url\": \"URL\", \"max_chars\": \"最大字符数，默认 8000\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let url = get_required_string(args, "url", "core.agent.python.fetch_url.url_missing")?;
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err(ProtocolError::new(
                "core.agent.python.fetch_url.invalid_url",
                "fetch_url 仅支持 http/https 协议",
            ));
        }
        let _method = resolve_web_method(args, "GET")?;
        let timeout_secs = parse_positive_usize_arg(
            args,
            "timeout_secs",
            context.policy.tool_timeout_secs as usize,
            120,
        )?;
        let max_chars = parse_positive_usize_arg(args, "max_chars", 8000, 120_000)?;
        let max_bytes =
            parse_positive_usize_arg(args, "max_bytes", DEFAULT_WEB_MAX_BYTES, MAX_WEB_MAX_BYTES)?;
        let allowlist = resolve_allowed_web_domains();
        ensure_url_allowed(url.as_str(), allowlist.as_slice())?;
        let timeout_text = timeout_secs.to_string();
        let max_bytes_text = max_bytes.to_string();
        let curl_bin = resolve_executable_binary("curl", "--version").ok_or_else(|| {
            ProtocolError::new(
                "core.agent.python.fetch_url.curl_missing",
                "未检测到可用 curl",
            )
            .with_suggestion("请安装 curl 后重试。")
        })?;
        let output = Command::new(curl_bin.as_str())
            .args([
                "-L",
                "-sS",
                "--max-time",
                timeout_text.as_str(),
                "--max-filesize",
                max_bytes_text.as_str(),
                url.as_str(),
            ])
            .output()
            .map_err(|err| {
                ProtocolError::new(
                    "core.agent.python.fetch_url.exec_failed",
                    format!("抓取网页失败: {}", err),
                )
            })?;
        if !output.status.success() {
            return Err(ProtocolError::new(
                "core.agent.python.fetch_url.failed",
                "网页抓取请求失败",
            ));
        }
        if output.stdout.len() > max_bytes {
            return Err(ProtocolError::new(
                "core.agent.python.fetch_url.too_large",
                format!("响应体过大（{} bytes）", output.stdout.len()),
            )
            .with_suggestion("请缩小抓取范围，或调小 max_bytes。"));
        }
        let html = String::from_utf8_lossy(output.stdout.as_slice()).to_string();
        let plain_text = strip_html_tags(html.as_str());
        let mut truncated = plain_text.clone();
        if truncated.chars().count() > max_chars {
            truncated = truncated.chars().take(max_chars).collect::<String>();
        }
        Ok(json!({
            "url": url,
            "content": truncated,
            "content_chars": truncated.chars().count(),
        }))
    }
}

/// 描述：解析 DuckDuckGo 响应并提取标题、链接、摘要结果列表。
fn extract_duckduckgo_results(parsed: &Value, limit: usize) -> Vec<Value> {
    let mut results: Vec<Value> = Vec::new();
    if let (Some(url), Some(text)) = (
        parsed.get("AbstractURL").and_then(|value| value.as_str()),
        parsed.get("AbstractText").and_then(|value| value.as_str()),
    ) {
        if !url.trim().is_empty() && !text.trim().is_empty() {
            results.push(json!({
                "title": parsed
                    .get("Heading")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Abstract"),
                "url": url,
                "snippet": text,
            }));
        }
    }
    if let Some(topics) = parsed
        .get("RelatedTopics")
        .and_then(|value| value.as_array())
    {
        collect_duckduckgo_topic_results(topics, &mut results, limit);
    }
    if results.len() > limit {
        results.truncate(limit);
    }
    results
}

/// 描述：递归解析 DuckDuckGo RelatedTopics，兼容分组 Topics 嵌套格式。
fn collect_duckduckgo_topic_results(topics: &[Value], results: &mut Vec<Value>, limit: usize) {
    for topic in topics {
        if results.len() >= limit {
            return;
        }
        if let Some(children) = topic.get("Topics").and_then(|value| value.as_array()) {
            collect_duckduckgo_topic_results(children, results, limit);
            continue;
        }
        let url = topic.get("FirstURL").and_then(|value| value.as_str());
        let text = topic.get("Text").and_then(|value| value.as_str());
        if let (Some(url), Some(text)) = (url, text) {
            if url.trim().is_empty() || text.trim().is_empty() {
                continue;
            }
            let title = text
                .split('-')
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Result");
            results.push(json!({
                "title": title,
                "url": url,
                "snippet": text,
            }));
        }
    }
}

/// 描述：对 URL 查询参数做百分号编码，避免联网请求中的特殊字符破坏查询语义。
pub fn url_encode_component(raw: &str) -> String {
    let mut encoded = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
        if keep {
            encoded.push(byte as char);
        } else if byte == b' ' {
            encoded.push('+');
        } else {
            encoded.push_str(format!("%{:02X}", byte).as_str());
        }
    }
    encoded
}

/// 描述：移除 HTML 标签并压缩空白，便于把网页正文以纯文本形式回传给编排脚本。
pub fn strip_html_tags(raw: &str) -> String {
    let mut plain = String::with_capacity(raw.len());
    let mut inside_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => plain.push(ch),
            _ => {}
        }
    }
    plain
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 描述：验证域名白名单文本支持逗号和空白混合分隔解析。
    #[test]
    fn should_parse_allowed_domain_list() {
        let parsed = parse_allowed_web_domains("docs.rs, github.com  tauri.app");
        assert_eq!(
            parsed,
            vec![
                "docs.rs".to_string(),
                "github.com".to_string(),
                "tauri.app".to_string()
            ]
        );
    }

    /// 描述：验证 URL 主机提取会移除认证信息和端口，避免白名单比对误判。
    #[test]
    fn should_extract_host_without_port() {
        let host = extract_url_host("https://user:pwd@docs.rs:443/crate");
        assert_eq!(host.as_deref(), Some("docs.rs"));
    }

    /// 描述：验证白名单匹配支持子域名，同时不会误放行无关域名。
    #[test]
    fn should_allow_subdomain_hosts() {
        let allowlist = vec!["github.com".to_string()];
        assert!(is_host_allowed("api.github.com", allowlist.as_slice()));
        assert!(!is_host_allowed("example.com", allowlist.as_slice()));
    }

    /// 描述：验证联网工具只允许 GET 请求方法，确保方法级别受控。
    #[test]
    fn should_reject_non_get_method() {
        let result = resolve_web_method(&json!({"method":"POST"}), "GET");
        assert!(result.is_err());
        assert_eq!(
            result.expect_err("post should be blocked").code,
            "core.agent.python.web.method_not_allowed"
        );
    }
}
