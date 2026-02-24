//! Agent core shared capabilities for all intelligent agents.

pub mod activation;
pub mod flow;
pub mod llm;
pub mod workflow;

use flow::{compose_prompt, AgentKind};
use llm::{call_model_with_stream, parse_provider};
use zodileap_mcp_common::{
    now_millis, ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord,
    ProtocolStepStatus, ProtocolUiHint,
};

#[cfg(feature = "with-mcp-model")]
pub use zodileap_mcp_model as mcp_model;

#[cfg(feature = "with-mcp-code")]
pub use zodileap_mcp_code as mcp_code;

#[derive(Debug, Clone)]
pub struct AgentRunRequest {
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
    pub message: String,
    pub actions: Vec<String>,
    pub exported_file: Option<String>,
    pub steps: Vec<ProtocolStepRecord>,
    pub events: Vec<ProtocolEventRecord>,
    pub assets: Vec<ProtocolAssetRecord>,
    pub ui_hint: Option<ProtocolUiHint>,
}

#[derive(Debug, Clone)]
pub enum AgentStreamEvent {
    LlmStarted { provider: String },
    LlmDelta { content: String },
    LlmFinished { provider: String },
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
    let agent_kind = parse_agent_kind(&request.agent_key);
    let mut tool_outcome = maybe_export_model(&request, agent_kind)?;

    let llm_started = now_millis();
    tool_outcome.events.push(ProtocolEventRecord {
        event: "llm_started".to_string(),
        step_index: Some(tool_outcome.steps.len()),
        timestamp_ms: llm_started,
        message: format!("provider={} started", request.provider),
    });

    let final_prompt = compose_prompt(
        agent_kind,
        &request.prompt,
        tool_outcome.tool_context.as_deref(),
    );
    let provider = parse_provider(&request.provider);
    on_stream_event(AgentStreamEvent::LlmStarted {
        provider: request.provider.clone(),
    });
    let reply = call_model_with_stream(
        provider,
        &final_prompt,
        request.workdir.as_deref(),
        &mut |chunk| {
            on_stream_event(AgentStreamEvent::LlmDelta {
                content: chunk.to_string(),
            });
        },
    )
    .map_err(|err| err.to_protocol_error())?;
    on_stream_event(AgentStreamEvent::LlmFinished {
        provider: request.provider.clone(),
    });

    let llm_finished = now_millis();
    tool_outcome.steps.push(ProtocolStepRecord {
        index: tool_outcome.steps.len(),
        code: "llm_call".to_string(),
        status: ProtocolStepStatus::Success,
        elapsed_ms: llm_finished.saturating_sub(llm_started),
        summary: format!("provider={} 执行完成", request.provider),
        error: None,
        data: None,
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
        message,
        actions: tool_outcome.actions,
        exported_file: tool_outcome.exported_file,
        steps: tool_outcome.steps,
        events: tool_outcome.events,
        assets: tool_outcome.assets,
        ui_hint: tool_outcome.ui_hint,
    })
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
fn maybe_export_model(
    request: &AgentRunRequest,
    agent_kind: AgentKind,
) -> Result<ToolExecutionOutcome, ProtocolError> {
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
        .map_err(|err| err.to_protocol_error())?;

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
fn maybe_export_model(
    request: &AgentRunRequest,
    agent_kind: AgentKind,
) -> Result<ToolExecutionOutcome, ProtocolError> {
    if agent_kind == AgentKind::Model
        && request.model_export_enabled
        && should_trigger_export(&request.prompt)
    {
        return Err(ProtocolError::new(
            "core.agent.feature_disabled",
            "model export feature is not enabled",
        )
        .with_suggestion("重新构建并启用 feature: with-mcp-model"));
    }
    Ok(ToolExecutionOutcome::default())
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
