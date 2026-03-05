pub mod file;
pub mod git;
pub mod mcp;
pub mod patch;
pub mod shell;
pub mod todo;
pub mod utils;
pub mod web;

use crate::policy::AgentPolicy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use zodileap_mcp_common::ProtocolError;

/// 描述：工具执行风险等级。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskLevel {
    /// 低风险：只读操作，或对环境无破坏性的操作，可直接执行。
    Low,
    /// 高风险：涉及文件修改、命令执行、删除或敏感网络请求，必须经过人工授权。
    High,
}

/// 描述：工具执行上下文，携带链路追踪 ID、沙盒路径及执行策略。
pub struct ToolContext<'a> {
    pub trace_id: String,
    pub sandbox_root: &'a Path,
    pub policy: &'a AgentPolicy,
}

/// 描述：智能体工具接口，所有可供 LLM 调用的能力均需实现此接口。
pub trait AgentTool: Send + Sync {
    /// 描述：返回工具的唯一名称标识（如 "run_shell"）。
    fn name(&self) -> &'static str;

    /// 描述：返回工具的描述信息，用于构建提示词中的工具清单。
    fn description(&self) -> &'static str;

    /// 描述：返回该工具的风险等级，默认均为低风险。
    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Low
    }

    /// 描述：执行工具逻辑。
    ///
    /// Params:
    ///   - args: 调用参数（JSON）。
    ///   - context: 执行上下文。
    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError>;
}

/// 描述：工具注册表，管理一组可用的智能体工具。
pub struct ToolRegistry {
    tools: std::collections::HashMap<String, Box<dyn AgentTool>>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: std::collections::HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Box<dyn AgentTool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn get(&self, name: &str) -> Option<&dyn AgentTool> {
        self.tools.get(name).map(|t| t.as_ref())
    }

    pub fn list_tools(&self) -> Vec<(&str, &str)> {
        self.tools
            .iter()
            .map(|(name, tool)| (name.as_str(), tool.description()))
            .collect()
    }
}
