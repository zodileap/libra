use crate::llm::{
    LlmGatewayError, LlmGatewayPolicy, LlmProgressObserver, LlmProvider, LlmProviderConfig,
    LlmRunResult, LlmTextStreamObserver, LlmUsage, LLM_RUNTIME_TAG,
};
use crate::workflow::{run_step_with_retry, DefaultWorkflowRecoveryHook};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::time::Duration;

const DEFAULT_IFLOW_BASE_URL: &str = "https://apis.iflow.cn/v1";
const DEFAULT_IFLOW_MODEL: &str = "qwen3-coder-plus";

/// 描述：通过工作流重试引擎执行 iFlow OpenAI 兼容 API 调用。
pub fn call_with_retry(
    prompt: &str,
    workdir: Option<&str>,
    policy: LlmGatewayPolicy,
    provider_config: Option<&LlmProviderConfig>,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
    mut on_progress: Option<&mut LlmProgressObserver>,
) -> Result<LlmRunResult, LlmGatewayError> {
    let hook = DefaultWorkflowRecoveryHook;
    let run = run_step_with_retry("llm.iflow_api", policy.retry_policy, &hook, |attempt| {
        call_once(
            prompt,
            workdir,
            policy.timeout_secs,
            attempt,
            provider_config,
            #[allow(clippy::needless_option_as_deref)]
            on_chunk.as_deref_mut(),
            #[allow(clippy::needless_option_as_deref)]
            on_progress.as_deref_mut(),
        )
    });
    run.outcome.map_err(|err| err.with_attempts(run.attempts))
}

/// 描述：执行单次 iFlow API 请求，复用 OpenAI 兼容 `/chat/completions` 协议。
fn call_once(
    prompt: &str,
    _workdir: Option<&str>,
    timeout_secs: u64,
    attempt: u8,
    provider_config: Option<&LlmProviderConfig>,
    mut on_chunk: Option<&mut LlmTextStreamObserver>,
    mut on_progress: Option<&mut LlmProgressObserver>,
) -> Result<LlmRunResult, LlmGatewayError> {
    let provider = LlmProvider::Iflow;
    let api_key = resolve_iflow_api_key(provider_config, attempt)?;
    let model = resolve_iflow_model(provider_config);
    let base_url = DEFAULT_IFLOW_BASE_URL.trim_end_matches('/');
    let endpoint = format!("{}/chat/completions", base_url);
    let request_payload = json!({
        "model": model,
        "stream": false,
        "messages": [
            {
                "role": "user",
                "content": prompt,
            }
        ],
    });

    if let Some(callback) = on_progress.as_deref_mut() {
        callback("iFlow API 已发起请求，正在等待模型响应…");
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(timeout_secs.max(1)))
        .build()
        .map_err(|err| {
            LlmGatewayError::new(
                provider,
                "core.agent.llm.iflow_client_build_failed",
                format!("[{}] build iflow client failed: {}", LLM_RUNTIME_TAG, err),
            )
            .with_retryable(true)
            .with_attempts(attempt)
        })?;

    let response = client
        .post(endpoint.as_str())
        .bearer_auth(api_key)
        .json(&request_payload)
        .send()
        .map_err(|err| {
            LlmGatewayError::new(
                provider,
                "core.agent.llm.iflow_request_failed",
                format!("[{}] request iflow api failed: {}", LLM_RUNTIME_TAG, err),
            )
            .with_suggestion(
                "请检查网络连通性、iFlow API Key 是否有效，以及账号是否具备对应模型权限。",
            )
            .with_retryable(true)
            .with_attempts(attempt)
        })?;
    let status = response.status();
    let response_text = response.text().map_err(|err| {
        LlmGatewayError::new(
            provider,
            "core.agent.llm.iflow_response_read_failed",
            format!("[{}] read iflow response failed: {}", LLM_RUNTIME_TAG, err),
        )
        .with_retryable(true)
        .with_attempts(attempt)
    })?;
    let parsed = serde_json::from_str::<Value>(response_text.as_str()).map_err(|err| {
        LlmGatewayError::new(
            provider,
            "core.agent.llm.iflow_response_parse_failed",
            format!("[{}] parse iflow response failed: {}", LLM_RUNTIME_TAG, err),
        )
        .with_suggestion("请检查 iFlow API 返回是否为标准 JSON，或稍后重试。")
        .with_retryable(true)
        .with_attempts(attempt)
    })?;

    if !status.is_success() {
        let summary = extract_iflow_error_message(&parsed)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        return Err(LlmGatewayError::new(
            provider,
            "core.agent.llm.iflow_failed",
            format!("iFlow API 调用失败：{}", summary),
        )
        .with_suggestion("请检查 iFlow API Key、模型名配置与账号权限是否正确。")
        .with_retryable(status.as_u16() >= 500 || status.as_u16() == 429)
        .with_attempts(attempt));
    }

    let content = extract_iflow_response_content(&parsed).ok_or_else(|| {
        LlmGatewayError::new(
            provider,
            "core.agent.llm.iflow_empty_response",
            format!("[{}] iflow api returned empty response", LLM_RUNTIME_TAG),
        )
        .with_suggestion("请确认所选 iFlow 模型支持聊天补全，并检查配额或服务状态。")
        .with_retryable(false)
        .with_attempts(attempt)
    })?;

    if let Some(callback) = on_chunk.as_deref_mut() {
        callback(content.as_str());
    }

    Ok(LlmRunResult {
        usage: extract_iflow_usage(&parsed)
            .unwrap_or_else(|| LlmUsage::estimate(prompt, content.as_str())),
        content,
    })
}

/// 描述：解析 iFlow API Key；缺失时返回统一配置错误，避免请求阶段才暴露 401。
fn resolve_iflow_api_key(
    provider_config: Option<&LlmProviderConfig>,
    attempt: u8,
) -> Result<String, LlmGatewayError> {
    let api_key = provider_config
        .and_then(|config| config.api_key.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    api_key.ok_or_else(|| {
        LlmGatewayError::new(
            LlmProvider::Iflow,
            "core.agent.llm.iflow_api_key_missing",
            "iFlow API Key 未配置",
        )
        .with_suggestion("请先在 AI Key 页面填写并启用 iFlow API Key。")
        .with_retryable(false)
        .with_attempts(attempt)
    })
}

/// 描述：解析 iFlow 目标模型；未填写时回落到默认代码模型。
fn resolve_iflow_model(provider_config: Option<&LlmProviderConfig>) -> String {
    provider_config
        .and_then(|config| config.model.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_IFLOW_MODEL)
        .to_string()
}

/// 描述：从 iFlow OpenAI 兼容响应中提取主回复内容，兼容字符串与数组分片两种 message.content 形态。
fn extract_iflow_response_content(response: &Value) -> Option<String> {
    let message = response
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
        .and_then(|value| value.get("message"))?;
    let content = message.get("content")?;
    if let Some(text) = content.as_str() {
        let normalized = text.trim();
        if !normalized.is_empty() {
            return Some(normalized.to_string());
        }
        return None;
    }
    let segments = content.as_array()?;
    let combined = segments
        .iter()
        .filter_map(|item| item.get("text").and_then(|value| value.as_str()))
        .collect::<Vec<&str>>()
        .join("");
    let normalized = combined.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

/// 描述：从 iFlow 错误响应中提取最具可读性的错误摘要，优先复用标准 `error.message` 字段。
fn extract_iflow_error_message(response: &Value) -> Option<String> {
    if let Some(message) = response
        .get("error")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
    {
        let normalized = message.trim();
        if !normalized.is_empty() {
            return Some(normalized.to_string());
        }
    }
    response
        .get("message")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// 描述：提取 iFlow 响应中的 token 使用量；缺失时回退到启发式估算。
fn extract_iflow_usage(response: &Value) -> Option<LlmUsage> {
    let usage = response.get("usage")?;
    let prompt_tokens = usage.get("prompt_tokens")?.as_u64()? as u32;
    let completion_tokens = usage.get("completion_tokens")?.as_u64()? as u32;
    let total_tokens = usage
        .get("total_tokens")
        .and_then(|value| value.as_u64())
        .map(|value| value as u32)
        .unwrap_or(prompt_tokens + completion_tokens);
    Some(LlmUsage {
        prompt_tokens,
        completion_tokens,
        total_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::LlmProviderConfig;
    use crate::workflow::WorkflowRetryPolicy;

    /// 描述：验证 iFlow provider 缺失 API Key 时返回统一错误码，避免错误地进入远端请求阶段。
    #[test]
    fn should_require_iflow_api_key() {
        let result = call_with_retry(
            "hello",
            None,
            LlmGatewayPolicy {
                timeout_secs: 1,
                retry_policy: WorkflowRetryPolicy {
                    max_retries: 0,
                    backoff_millis: 0,
                },
            },
            Some(&LlmProviderConfig::default()),
            None,
            None,
        );
        assert!(result.is_err());
        let err = result.err().expect("must have error");
        assert_eq!(err.code, "core.agent.llm.iflow_api_key_missing");
    }

    /// 描述：验证 iFlow 响应为字符串内容时可正确提取主回复文本。
    #[test]
    fn should_extract_iflow_content_from_string_message() {
        let response = json!({
            "choices": [
                {
                    "message": {
                        "content": "hello iflow"
                    }
                }
            ]
        });
        assert_eq!(
            extract_iflow_response_content(&response).as_deref(),
            Some("hello iflow")
        );
    }

    /// 描述：验证 iFlow 响应为多段文本数组时会正确拼接内容，兼容部分 OpenAI 兼容实现。
    #[test]
    fn should_extract_iflow_content_from_text_array() {
        let response = json!({
            "choices": [
                {
                    "message": {
                        "content": [
                            { "text": "hello " },
                            { "text": "iflow" }
                        ]
                    }
                }
            ]
        });
        assert_eq!(
            extract_iflow_response_content(&response).as_deref(),
            Some("hello iflow")
        );
    }

    /// 描述：验证未显式指定模型时会回落到当前 iFlow 默认模型，确保桌面端空值与后端默认保持一致。
    #[test]
    fn should_use_default_iflow_model_when_provider_model_is_missing() {
        assert_eq!(resolve_iflow_model(None), "qwen3-coder-plus");
        assert_eq!(
            resolve_iflow_model(Some(&LlmProviderConfig::default())),
            "qwen3-coder-plus"
        );
    }

    /// 描述：验证显式配置的 iFlow 模型会原样透传，避免默认值覆盖用户选择。
    #[test]
    fn should_use_custom_iflow_model_when_provider_model_is_present() {
        let provider_config = LlmProviderConfig {
            api_key: Some("test-key".to_string()),
            model: Some("deepseek-v3.2".to_string()),
            mode: None,
        };
        assert_eq!(
            resolve_iflow_model(Some(&provider_config)),
            "deepseek-v3.2"
        );
    }
}
