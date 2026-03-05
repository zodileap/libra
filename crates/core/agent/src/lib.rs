//! Agent core shared capabilities for all intelligent agents.

pub mod activation;
pub mod flow;
pub mod llm;
pub mod policy;
pub mod profile;
mod python_orchestrator;
pub mod sandbox;
pub mod tools;
pub mod workflow;

use once_cell::sync::Lazy;
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
use flow::{compose_prompt, AgentKind};
use llm::{parse_provider, LlmUsage};
use policy::AgentPolicy;
use profile::AgentProfile;
use serde_json::json;
use tracing::{info, info_span};
use zodileap_mcp_common::{
    now_millis, ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord,
    ProtocolStepStatus, ProtocolUiHint,
};

#[cfg(feature = "with-mcp-model")]
pub use zodileap_mcp_model as mcp_model;

#[cfg(feature = "with-mcp-code")]
pub use zodileap_mcp_code as mcp_code;

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

#[derive(Debug, Clone)]
pub struct AgentRunRequest {
    pub trace_id: String,
    pub session_id: String,
    pub agent_key: String,
    pub provider: String,
    pub prompt: String,
    pub project_name: Option<String>,
    pub model_export_enabled: bool,
    pub blender_bridge_addr: Option<String>,
    pub output_dir: Option<String>,
    pub workdir: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AgentRunResult {
    pub trace_id: String,
    pub message: String,
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
    },
    /// 描述：工具调用完成（成功或失败）。
    ToolCallFinished {
        name: String,
        ok: bool,
        result: String,
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

    let agent_kind = parse_agent_kind(&request.agent_key);

    let (executor, profile): (Box<dyn AgentExecutor>, AgentProfile) = match agent_kind {
        AgentKind::Code => (Box::new(CodeAgentExecutor), AgentProfile::code_default()),
        AgentKind::Model => (Box::new(ModelAgentExecutor), AgentProfile::model_default()),
    };

    executor.run(request, policy, profile, &mut on_stream_event)
}

struct CodeAgentExecutor;

impl AgentExecutor for CodeAgentExecutor {
    fn run(
        &self,
        request: AgentRunRequest,
        policy: AgentPolicy,
        profile: AgentProfile,
        on_stream_event: &mut dyn FnMut(AgentStreamEvent),
    ) -> Result<AgentRunResult, ProtocolError> {
        python_orchestrator::run_code_agent_with_python_workflow(
            request,
            policy,
            profile,
            on_stream_event,
        )
    }
}

struct ModelAgentExecutor;

impl AgentExecutor for ModelAgentExecutor {
    fn run(
        &self,
        request: AgentRunRequest,
        policy: AgentPolicy,
        _profile: AgentProfile,
        on_stream_event: &mut dyn FnMut(AgentStreamEvent),
    ) -> Result<AgentRunResult, ProtocolError> {
        let trace_id = request.trace_id.clone();
        let span = info_span!("model_agent_run", trace_id = %trace_id, agent = %request.agent_key);
        let _enter = span.enter();

        info!("starting model agent workflow");
        let agent_kind = AgentKind::Model;
        on_stream_event(AgentStreamEvent::Planning {
            message: "正在检查工具调用需求".to_string(),
        });
        let mut tool_outcome =
            maybe_export_model(&request, agent_kind, trace_id.clone(), on_stream_event)?;

        let llm_started = now_millis();
        on_stream_event(AgentStreamEvent::LlmStarted {
            provider: request.provider.clone(),
        });

        let final_prompt = compose_prompt(
            agent_kind,
            &request.prompt,
            tool_outcome.tool_context.as_deref(),
        );
        let provider = parse_provider(&request.provider);

        let llm_policy = llm::LlmGatewayPolicy {
            timeout_secs: policy.llm_timeout_secs,
            retry_policy: policy.llm_retry_policy,
        };

        let mut observer = |chunk: &str| {
            on_stream_event(AgentStreamEvent::LlmDelta {
                content: chunk.to_string(),
            });
        };

        let run_result = llm::call_model_with_policy_and_stream(
            provider,
            &final_prompt,
            request.workdir.as_deref(),
            llm_policy,
            Some(&mut observer),
        )
        .map_err(|err| err.to_protocol_error())?;

        let reply = run_result.content;
        let llm_usage = run_result.usage;

        on_stream_event(AgentStreamEvent::LlmFinished {
            provider: request.provider.clone(),
        });

        on_stream_event(AgentStreamEvent::Final {
            message: reply.clone(),
        });

        let llm_finished = now_millis();
        tool_outcome.steps.push(ProtocolStepRecord {
            index: tool_outcome.steps.len(),
            code: "llm_call".to_string(),
            status: ProtocolStepStatus::Success,
            elapsed_ms: llm_finished.saturating_sub(llm_started),
            summary: format!("provider={} 执行完成", request.provider),
            error: None,
            data: Some(json!({
                "usage": llm_usage,
            })),
        });
        tool_outcome.events.push(ProtocolEventRecord {
            event: "llm_finished".to_string(),
            step_index: Some(tool_outcome.steps.len().saturating_sub(1)),
            timestamp_ms: llm_finished,
            message: format!("provider={} finished", request.provider),
        });

        let message = match tool_outcome.tool_context {
            Some(context) => format!("{}\n\n{}", context, reply),
            None => reply,
        };

        Ok(AgentRunResult {
            trace_id,
            message,
            usage: Some(llm_usage),
            actions: tool_outcome.actions,
            exported_file: tool_outcome.exported_file,
            steps: tool_outcome.steps,
            events: tool_outcome.events,
            assets: tool_outcome.assets,
            ui_hint: tool_outcome.ui_hint,
        })
    }
}

#[derive(Debug, Default)]
struct ToolExecutionOutcome {
    tool_context: Option<String>,
    actions: Vec<String>,
    exported_file: Option<String>,
    steps: Vec<ProtocolStepRecord>,
    events: Vec<ProtocolEventRecord>,
    assets: Vec<ProtocolAssetRecord>,
    ui_hint: Option<ProtocolUiHint>,
}

/// 描述：解析 agent_key 到内部智能体类型，未知值默认回退为 Code。
fn parse_agent_kind(agent_key: &str) -> AgentKind {
    match agent_key.trim().to_lowercase().as_str() {
        "model" => AgentKind::Model,
        _ => AgentKind::Code,
    }
}

/// 描述：判断用户输入是否触发“模型导出”路径，用于决定是否调用 MCP 导出。
fn should_trigger_export(prompt: &str) -> bool {
    let content = prompt.to_lowercase();
    if ["导出", "export", "导出模型"]
        .iter()
        .any(|keyword| content.contains(keyword))
    {
        return true;
    }
    let has_output_verb = ["输出", "生成", "export", "output"]
        .iter()
        .any(|keyword| content.contains(keyword));
    let has_format_hint = ["glb", "gltf", "fbx", "obj"]
        .iter()
        .any(|keyword| content.contains(keyword));
    has_output_verb && has_format_hint
}

#[cfg(feature = "with-mcp-model")]
/// 描述：在模型能力启用时按需执行导出，并将 MCP 返回结构映射为统一结果。
fn maybe_export_model<F>(
    request: &AgentRunRequest,
    agent_kind: AgentKind,
    _trace_id: String,
    on_stream_event: &mut F,
) -> Result<ToolExecutionOutcome, ProtocolError>
where
    F: FnMut(AgentStreamEvent) + ?Sized,
{
    if agent_kind == AgentKind::Model
        && request.model_export_enabled
        && should_trigger_export(&request.prompt)
    {
        let project_name = request
            .project_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("model-project")
            .to_string();

        let tool_name = "model.export.blender".to_string();
        on_stream_event(AgentStreamEvent::ToolCallStarted {
            name: tool_name.clone(),
            args: format!("project_name={}", project_name),
        });

        let export_result = mcp_model::export_model(mcp_model::ExportModelRequest {
            project_name,
            prompt: request.prompt.clone(),
            output_dir: request
                .output_dir
                .clone()
                .unwrap_or_else(|| "exports".to_string()),
            export_format: None,
            export_params: None,
            blender_bridge_addr: request.blender_bridge_addr.clone(),
            target: mcp_model::ModelToolTarget::Blender,
        })
        .map_err(|err| {
            let protocol_err = err.to_protocol_error();
            on_stream_event(AgentStreamEvent::Error {
                code: protocol_err.code.clone(),
                message: protocol_err.message.clone(),
            });
            protocol_err
        })?;

        on_stream_event(AgentStreamEvent::ToolCallFinished {
            name: tool_name,
            ok: true,
            result: format!("exported_file={}", export_result.exported_file),
        });

        return Ok(ToolExecutionOutcome {
            tool_context: Some(format!(
                "已执行模型导出，文件路径：{}",
                export_result.exported_file
            )),
            actions: vec!["model.export.blender".to_string()],
            exported_file: Some(export_result.exported_file),
            steps: export_result.steps,
            events: export_result.events,
            assets: export_result.assets,
            ui_hint: export_result.ui_hint,
        });
    }

    Ok(ToolExecutionOutcome::default())
}

#[cfg(not(feature = "with-mcp-model"))]
/// 描述：在模型能力未启用时返回明确错误，避免前端误判为运行时故障。
fn maybe_export_model<F>(
    request: &AgentRunRequest,
    agent_kind: AgentKind,
    _trace_id: String,
    on_stream_event: &mut F,
) -> Result<ToolExecutionOutcome, ProtocolError>
where
    F: FnMut(AgentStreamEvent) + ?Sized,
{
    if agent_kind == AgentKind::Model
        && request.model_export_enabled
        && should_trigger_export(&request.prompt)
    {
        let protocol_err = ProtocolError::new(
            "core.agent.feature_disabled",
            "model export feature is not enabled",
        )
        .with_suggestion("重新构建并启用 feature: with-mcp-model");

        on_stream_event(AgentStreamEvent::Error {
            code: protocol_err.code.clone(),
            message: protocol_err.message.clone(),
        });

        return Err(protocol_err);
    }
    Ok(ToolExecutionOutcome::default())
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
