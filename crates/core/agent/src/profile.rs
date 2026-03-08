use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// 描述：智能体运行时能力开关，用于替代零散的 cfg 控制，实现编译与运行时的统一。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentFeatureFlags {
    pub mcp_model_enabled: bool,
    pub mcp_code_enabled: bool,
    pub enable_unsafe_tools: bool,
}

impl AgentFeatureFlags {
    /// 描述：返回当前环境的默认能力开启情况。
    pub fn default_for_env() -> Self {
        Self {
            mcp_model_enabled: cfg!(feature = "with-mcp-model"),
            mcp_code_enabled: cfg!(feature = "with-mcp-code"),
            enable_unsafe_tools: false,
        }
    }
}

/// 描述：智能体档案（Profile），包含所有个性化配置、工具偏好与提示词模板。
///
/// 目标是实现新增智能体无需修改执行引擎，仅需编排档案。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProfile {
    pub id: String,
    pub display_name: String,
    pub system_prompt: String,
    /// 该档案允许使用的工具名称列表。如果为空则使用注册表中所有可用工具。
    pub allowed_tools: HashSet<String>,
    pub features: AgentFeatureFlags,
}

impl AgentProfile {
    /// 描述：内置统一智能体默认档案。
    pub fn default_profile() -> Self {
        Self {
            id: "agent".to_string(),
            display_name: "智能体".to_string(),
            system_prompt: "你是统一智能体。目标：输出可执行、可维护的实现方案与代码建议。约束：优先模块化、明确文件结构、优先复用工作流、技能与 MCP。".to_string(),
            allowed_tools: HashSet::new(),
            features: AgentFeatureFlags::default_for_env(),
        }
    }
}
