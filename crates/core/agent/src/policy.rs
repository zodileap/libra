use crate::workflow::WorkflowRetryPolicy;
use std::env;

/// 描述：全局智能体执行策略，包含 LLM、编排脚本与单工具调用的三级超时配置。
#[derive(Debug, Clone)]
pub struct AgentPolicy {
    pub llm_timeout_secs: u64,
    pub orchestration_timeout_secs: u64,
    pub tool_timeout_secs: u64,
    pub approval_timeout_secs: u64,
    pub sandbox_idle_timeout_mins: u64,
    pub llm_retry_policy: WorkflowRetryPolicy,
}

impl AgentPolicy {
    /// 描述：从环境变量加载执行策略，支持统一的 ZODILEAP_ 前缀配置。
    pub fn from_env() -> Self {
        let llm_timeout_secs = env::var("ZODILEAP_LLM_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(300);

        let orchestration_timeout_secs = env::var("ZODILEAP_ORCHESTRATION_TIMEOUT_SECS")
            .or_else(|_| env::var("ZODILEAP_PYTHON_TIMEOUT_SECS")) // 兼容旧版
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(300);

        let tool_timeout_secs = env::var("ZODILEAP_TOOL_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(60);

        let approval_timeout_secs = env::var("ZODILEAP_APPROVAL_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(300);

        let sandbox_idle_timeout_mins = env::var("ZODILEAP_SANDBOX_IDLE_TIMEOUT_MINS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(30);

        let max_retries = env::var("ZODILEAP_LLM_RETRY_MAX")
            .ok()
            .and_then(|v| v.trim().parse::<u8>().ok())
            .unwrap_or(1);

        let backoff_millis = env::var("ZODILEAP_LLM_RETRY_BACKOFF_MS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(400);

        Self {
            llm_timeout_secs,
            orchestration_timeout_secs,
            tool_timeout_secs,
            approval_timeout_secs,
            sandbox_idle_timeout_mins,
            llm_retry_policy: WorkflowRetryPolicy {
                max_retries,
                backoff_millis,
            },
        }
    }
}

impl Default for AgentPolicy {
    fn default() -> Self {
        Self {
            llm_timeout_secs: 300,
            orchestration_timeout_secs: 300,
            tool_timeout_secs: 60,
            approval_timeout_secs: 300,
            sandbox_idle_timeout_mins: 30,
            llm_retry_policy: WorkflowRetryPolicy::default(),
        }
    }
}

#[cfg(test)]
#[path = "policy_tests.rs"]
mod tests;
