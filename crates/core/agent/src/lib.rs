//! Agent core shared capabilities for all intelligent agents.

pub mod activation;
pub mod flow;
pub mod llm;

use flow::{compose_prompt, AgentKind};
use llm::{call_model, parse_provider};

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
}

pub fn run_agent(request: AgentRunRequest) -> Result<AgentRunResult, String> {
    let agent_kind = parse_agent_kind(&request.agent_key);
    let (tool_context, actions, exported_file) = maybe_export_model(&request, agent_kind)?;

    let final_prompt = compose_prompt(agent_kind, &request.prompt, tool_context.as_deref());
    let provider = parse_provider(&request.provider);
    let reply = call_model(provider, &final_prompt, request.workdir.as_deref())?;

    let message = match tool_context {
        Some(context) => format!("{}\n\n{}", context, reply),
        None => reply,
    };

    Ok(AgentRunResult {
        message,
        actions,
        exported_file,
    })
}

fn parse_agent_kind(agent_key: &str) -> AgentKind {
    match agent_key.trim().to_lowercase().as_str() {
        "model" => AgentKind::Model,
        _ => AgentKind::Code,
    }
}

fn should_trigger_export(prompt: &str) -> bool {
    let content = prompt.to_lowercase();
    ["导出", "export", "输出glb", "生成glb", "导出模型"]
        .iter()
        .any(|keyword| content.contains(keyword))
}

#[cfg(feature = "with-mcp-model")]
fn maybe_export_model(
    request: &AgentRunRequest,
    agent_kind: AgentKind,
) -> Result<(Option<String>, Vec<String>, Option<String>), String> {
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
            blender_bridge_addr: request.blender_bridge_addr.clone(),
            target: mcp_model::ModelToolTarget::Blender,
        })
        .map_err(|err| err.to_string())?;

        return Ok((
            Some(format!("已执行模型导出，文件路径：{}", export_result.exported_file)),
            vec!["model.export.blender".to_string()],
            Some(export_result.exported_file),
        ));
    }

    Ok((None, Vec::new(), None))
}

#[cfg(not(feature = "with-mcp-model"))]
fn maybe_export_model(
    request: &AgentRunRequest,
    agent_kind: AgentKind,
) -> Result<(Option<String>, Vec<String>, Option<String>), String> {
    if agent_kind == AgentKind::Model
        && request.model_export_enabled
        && should_trigger_export(&request.prompt)
    {
        return Err("model export feature is not enabled".to_string());
    }
    Ok((None, Vec::new(), None))
}
