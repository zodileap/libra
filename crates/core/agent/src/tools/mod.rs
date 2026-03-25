pub mod browser;
pub mod file;
pub mod git;
pub mod mcp;
pub mod patch;
pub mod shell;
pub mod todo;
pub mod utils;
pub mod web;

use crate::policy::AgentPolicy;
use libra_mcp_common::ProtocolError;
use serde_json::Value;
use std::path::Path;

/// 描述：工具执行期间向外派发流式事件的回调签名，供长驻进程等需要增量反馈的工具复用。
pub type ToolStreamEventSink<'a> = &'a mut dyn FnMut(crate::AgentStreamEvent);

/// 描述：工具审批决策，统一表达“直接执行 / 进入审批 / 直接拒绝”三种分支。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolApprovalDecision {
    /// 低风险或已确认安全，可直接执行工具逻辑。
    Allow,
    /// 存在外部副作用或高风险操作，需要经过人工授权。
    RequireApproval,
    /// 参数非法、路径越界或命中硬限制时，直接拒绝且不进入审批。
    Deny(ProtocolError),
}

/// 描述：工具执行上下文，携带链路追踪 ID、沙盒路径及执行策略。
pub struct ToolContext<'a> {
    pub trace_id: String,
    pub session_id: &'a str,
    pub sandbox_root: &'a Path,
    pub policy: &'a AgentPolicy,
    pub on_stream_event: Option<ToolStreamEventSink<'a>>,
}

impl ToolContext<'_> {
    /// 描述：向宿主派发一条工具侧流式事件；若当前上下文未提供回调，则静默忽略。
    ///
    /// Params:
    ///
    ///   - event: 待派发的流式事件。
    pub fn emit_stream_event(&mut self, event: crate::AgentStreamEvent) {
        if let Some(callback) = self.on_stream_event.as_mut() {
            callback(event);
        }
    }
}

/// 描述：智能体工具接口，所有可供 LLM 调用的能力均需实现此接口。
pub trait AgentTool: Send + Sync {
    /// 描述：返回工具的唯一名称标识（如 "run_shell"）。
    fn name(&self) -> &'static str;

    /// 描述：返回工具的描述信息，用于构建提示词中的工具清单。
    fn description(&self) -> &'static str;

    /// 描述：基于当前参数与上下文返回审批决策，默认直接执行。
    ///
    /// Params:
    ///
    ///   - args: 调用参数（JSON）。
    ///   - context: 执行上下文。
    fn approval_decision(&self, _args: &Value, _context: &ToolContext<'_>) -> ToolApprovalDecision {
        ToolApprovalDecision::Allow
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
