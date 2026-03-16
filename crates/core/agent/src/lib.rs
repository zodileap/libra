//! Agent core shared capabilities for all intelligent agents.

pub mod activation;
pub mod flow;
pub mod llm;
pub mod platform;
pub mod policy;
pub mod profile;
mod python_orchestrator;
pub mod runtime_capabilities;
pub mod sandbox;
pub mod tools;
pub mod workflow;

use once_cell::sync::Lazy;
pub use runtime_capabilities::{
    detect_agent_runtime_capabilities, resolve_agent_runtime_capabilities, AgentInteractiveMode,
    AgentRuntimeCapabilities,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// 描述：授权结果。
#[derive(Debug, Clone, Copy)]
pub enum ApprovalOutcome {
    Approved,
    Rejected,
}

/// 描述：全局授权管理器，管理所有挂起中的人工授权请求。
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, Arc<Mutex<Option<ApprovalOutcome>>>>>,
}

impl ApprovalRegistry {
    /// 描述：创建一个新的授权请求并返回用于等待的信号量。
    pub fn create_request(&self, id: &str) -> Arc<Mutex<Option<ApprovalOutcome>>> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let outcome = Arc::new(Mutex::new(None));
        pending.insert(id.to_string(), outcome.clone());
        outcome
    }

    /// 描述：提交授权决策（批准或拒绝），唤醒阻塞的执行流。
    pub fn submit_decision(&self, id: &str, outcome: ApprovalOutcome) -> bool {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(signal) = pending.remove(id) {
            let mut guard = signal
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *guard = Some(outcome);
            return true;
        }
        false
    }

    /// 描述：移除挂起授权请求（用于超时/中断清理），避免 pending 表长期积压。
    pub fn remove_request(&self, id: &str) -> bool {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending.remove(id).is_some()
    }
}

pub static APPROVAL_REGISTRY: Lazy<ApprovalRegistry> = Lazy::new(|| ApprovalRegistry {
    pending: Mutex::new(HashMap::new()),
});

/// 描述：单个问题选项结构，供智能体向用户发起结构化单选问题时复用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}

/// 描述：单个用户问题结构；一次请求允许批量携带 1-3 个问题。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionPrompt {
    pub id: String,
    pub header: String,
    pub question: String,
    pub options: Vec<QuestionOption>,
}

/// 描述：用户回答结构，统一兼容“选项回答”和“自由填写”两种结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInputAnswer {
    pub question_id: String,
    pub answer_type: String,
    pub option_index: Option<usize>,
    pub option_label: Option<String>,
    pub value: String,
}

/// 描述：用户提问请求的最终决议结果；answered 表示已回答，ignored 表示已忽略。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInputResolution {
    pub resolution: String,
    pub answers: Vec<UserInputAnswer>,
}

/// 描述：全局用户提问管理器，管理所有挂起中的“等待用户决定”请求。
pub struct UserInputRegistry {
    pending: Mutex<HashMap<String, Arc<Mutex<Option<UserInputResolution>>>>>,
}

impl UserInputRegistry {
    /// 描述：创建一个新的用户提问请求并返回可等待的结果信号量。
    pub fn create_request(&self, id: &str) -> Arc<Mutex<Option<UserInputResolution>>> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let outcome = Arc::new(Mutex::new(None));
        pending.insert(id.to_string(), outcome.clone());
        outcome
    }

    /// 描述：提交用户提问结果（已回答或已忽略），并唤醒阻塞中的执行流。
    pub fn submit_resolution(&self, id: &str, resolution: UserInputResolution) -> bool {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(signal) = pending.remove(id) {
            let mut guard = signal
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *guard = Some(resolution);
            return true;
        }
        false
    }

    /// 描述：移除挂起中的用户提问请求，避免中断后 pending 表长期残留。
    pub fn remove_request(&self, id: &str) -> bool {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending.remove(id).is_some()
    }
}

pub static USER_INPUT_REGISTRY: Lazy<UserInputRegistry> = Lazy::new(|| UserInputRegistry {
    pending: Mutex::new(HashMap::new()),
});
use libra_mcp_common::{
    ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord, ProtocolUiHint,
};
use llm::LlmUsage;
use policy::AgentPolicy;
use profile::AgentProfile;
use serde_json::Value;

#[cfg(feature = "with-mcp-model")]
pub use libra_mcp_model as mcp_model;

#[cfg(feature = "with-mcp-code")]
pub use libra_mcp_code as mcp_code;

/// 描述：智能体核心执行器接口，统一了不同智能体（Code/Model）的执行协议。
pub trait AgentExecutor {
    fn run(
        &self,
        request: AgentRunRequest,
        policy: AgentPolicy,
        profile: AgentProfile,
        on_stream_event: &mut dyn FnMut(AgentStreamEvent),
    ) -> Result<AgentRunResult, ProtocolError>;
}

/// 描述：智能体运行时可见的 MCP 注册项快照，统一携带执行所需的最小上下文。
#[derive(Debug, Clone)]
pub struct AgentRegisteredMcp {
    pub id: String,
    pub template_id: String,
    pub name: String,
    pub domain: String,
    pub software: String,
    pub capabilities: Vec<String>,
    pub priority: i64,
    pub supports_import: bool,
    pub supports_export: bool,
    pub transport: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub cwd: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub runtime_kind: String,
    pub official_provider: String,
    pub runtime_ready: bool,
    pub runtime_hint: Option<String>,
}

/// 描述：统一智能体执行请求，承载会话上下文、执行目录以及外部能力注册信息。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentExecutionMode {
    Workflow,
    Chat,
}

impl AgentExecutionMode {
    /// 描述：返回执行模式的稳定字符串表示，供日志与前端协议复用。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Workflow => "workflow",
            Self::Chat => "chat",
        }
    }
}

/// 描述：统一智能体执行请求，承载会话上下文、执行目录以及外部能力注册信息。
#[derive(Debug, Clone)]
pub struct AgentRunRequest {
    pub trace_id: String,
    pub session_id: String,
    pub agent_key: String,
    pub provider: String,
    pub provider_api_key: Option<String>,
    pub provider_model: Option<String>,
    pub provider_mode: Option<String>,
    pub prompt: String,
    pub project_name: Option<String>,
    pub model_export_enabled: bool,
    pub dcc_provider_addr: Option<String>,
    pub output_dir: Option<String>,
    pub workdir: Option<String>,
    pub available_mcps: Vec<AgentRegisteredMcp>,
    pub runtime_capabilities: AgentRuntimeCapabilities,
    pub execution_mode: AgentExecutionMode,
}

#[derive(Debug, Clone)]
pub struct AgentRunResult {
    pub trace_id: String,
    pub control: String,
    pub message: String,
    pub display_message: String,
    pub usage: Option<LlmUsage>,
    pub actions: Vec<String>,
    pub exported_file: Option<String>,
    pub steps: Vec<ProtocolStepRecord>,
    pub events: Vec<ProtocolEventRecord>,
    pub assets: Vec<ProtocolAssetRecord>,
    pub ui_hint: Option<ProtocolUiHint>,
}

#[derive(Debug, Clone)]
pub enum AgentStreamEvent {
    LlmStarted {
        provider: String,
    },
    LlmDelta {
        content: String,
    },
    LlmFinished {
        provider: String,
    },
    /// 描述：智能体开始规划下一步任务。
    Planning {
        message: String,
    },
    /// 描述：发起工具调用。
    ToolCallStarted {
        name: String,
        args: String,
        args_data: Value,
    },
    /// 描述：工具调用完成（成功或失败）。
    ToolCallFinished {
        name: String,
        ok: bool,
        result: String,
        result_data: Value,
    },
    /// 描述：长任务期间的周期性心跳。
    Heartbeat {
        message: String,
    },
    /// 描述：高危操作需要人工授权。
    RequireApproval {
        approval_id: String,
        tool_name: String,
        tool_args: String,
    },
    /// 描述：执行过程中需要用户做产品/实现决策时，挂起并请求结构化回答。
    RequestUserInput {
        request_id: String,
        questions: Vec<QuestionPrompt>,
    },
    /// 描述：执行产生最终答案（通常是 LLM 总结后的文本）。
    Final {
        message: String,
    },
    /// 描述：执行被取消并进入终态（如超时中断或主动取消）。
    Cancelled {
        message: String,
    },
    /// 描述：执行过程中发生不可恢复错误。
    Error {
        code: String,
        message: String,
    },
}

impl AgentStreamEvent {
    /// 描述：返回事件 kind 字符串标识，与前端 `STREAM_KINDS` 常量一一映射，
    /// 避免 Tauri 侧在转发时手工硬编码 kind 字符串。
    pub fn kind(&self) -> &'static str {
        match self {
            Self::LlmStarted { .. } => "llm_started",
            Self::LlmDelta { .. } => "delta",
            Self::LlmFinished { .. } => "llm_finished",
            Self::Planning { .. } => "planning",
            Self::ToolCallStarted { .. } => "tool_call_started",
            Self::ToolCallFinished { .. } => "tool_call_finished",
            Self::Heartbeat { .. } => "heartbeat",
            Self::RequireApproval { .. } => "require_approval",
            Self::RequestUserInput { .. } => "request_user_input",
            Self::Final { .. } => "final",
            Self::Cancelled { .. } => "cancelled",
            Self::Error { .. } => "error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentFeatureFlag {
    WithMcpModel,
    WithMcpCode,
}

/// 描述：返回某个 agent 特性在当前编译产物中是否已启用。
pub fn is_feature_enabled(flag: AgentFeatureFlag) -> bool {
    match flag {
        AgentFeatureFlag::WithMcpModel => cfg!(feature = "with-mcp-model"),
        AgentFeatureFlag::WithMcpCode => cfg!(feature = "with-mcp-code"),
    }
}

/// 描述：返回当前构建实际启用的特性列表，供桌面端做能力探测。
pub fn enabled_feature_flags() -> Vec<AgentFeatureFlag> {
    let mut flags: Vec<AgentFeatureFlag> = Vec::new();
    if is_feature_enabled(AgentFeatureFlag::WithMcpModel) {
        flags.push(AgentFeatureFlag::WithMcpModel);
    }
    if is_feature_enabled(AgentFeatureFlag::WithMcpCode) {
        flags.push(AgentFeatureFlag::WithMcpCode);
    }
    flags
}

/// 描述：执行智能体流程，失败时返回字符串错误，兼容现有调用方。
pub fn run_agent(request: AgentRunRequest) -> Result<AgentRunResult, String> {
    run_agent_with_protocol_error(request).map_err(|err| err.to_string())
}

/// 描述：执行智能体流程，失败时返回统一协议错误，便于 UI 做结构化展示。
pub fn run_agent_with_protocol_error(
    request: AgentRunRequest,
) -> Result<AgentRunResult, ProtocolError> {
    run_agent_with_protocol_error_stream(request, |_event| {})
}

/// 描述：执行智能体流程并输出增量流事件，供上层实现 token 级展示。
pub fn run_agent_with_protocol_error_stream<F>(
    request: AgentRunRequest,
    mut on_stream_event: F,
) -> Result<AgentRunResult, ProtocolError>
where
    F: FnMut(AgentStreamEvent),
{
    let policy = AgentPolicy::from_env();

    // 触发闲置沙盒清理
    sandbox::SANDBOX_REGISTRY
        .cleanup_idle(Duration::from_secs(policy.sandbox_idle_timeout_mins * 60));

    let _ = normalize_agent_key(&request.agent_key);
    let executor: Box<dyn AgentExecutor> = Box::new(UnifiedAgentExecutor);
    let profile = AgentProfile::default_profile();

    executor.run(request, policy, profile, &mut on_stream_event)
}

struct UnifiedAgentExecutor;

impl AgentExecutor for UnifiedAgentExecutor {
    fn run(
        &self,
        request: AgentRunRequest,
        policy: AgentPolicy,
        profile: AgentProfile,
        on_stream_event: &mut dyn FnMut(AgentStreamEvent),
    ) -> Result<AgentRunResult, ProtocolError> {
        python_orchestrator::run_agent_with_python_workflow(
            request,
            policy,
            profile,
            on_stream_event,
        )
    }
}

/// 描述：归一化 agent_key；当前统一智能体实现下，所有旧 key 均收敛到同一执行链。
fn normalize_agent_key(agent_key: &str) -> &'static str {
    let _ = agent_key;
    "agent"
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
