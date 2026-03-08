use super::utils::get_required_string;
use super::{AgentTool, RiskLevel, ToolContext};
use crate::AgentRegisteredMcp;
use libra_mcp_common::ProtocolError;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const MCP_STDIO_PROTOCOL_VERSION: &str = "2024-11-05";
const MCP_STDIO_TIMEOUT_SECS: u64 = 20;
const MCP_HTTP_TIMEOUT_SECS: u64 = 20;
const MCP_INITIALIZE_REQUEST_ID: u64 = 1;
const MCP_TOOL_REQUEST_ID: u64 = 2;
const DEFAULT_DCC_TRANSFER_FORMATS: [&str; 3] = ["fbx", "glb", "obj"];

/// 描述：统一 MCP 工具入口，负责历史 DCC 兼容分支与外部注册 MCP 的调度。
pub struct McpTool {
    pub dcc_provider_addr: Option<String>,
    pub registered_mcps: Vec<AgentRegisteredMcp>,
}

/// 描述：DCC 能力路由工具，负责在已启用 DCC MCP 中按 capability / software 选择合适 provider。
pub struct DccTool {
    pub registered_mcps: Vec<AgentRegisteredMcp>,
}

/// 描述：单次 MCP 工具调用请求，统一收敛 server/tool/arguments 三段结构。
#[derive(Debug, Clone)]
struct McpToolCallRequest {
    server: String,
    tool: String,
    arguments: Value,
}

/// 描述：DCC 工具调用请求，统一收敛 capability / action / software 三层语义。
#[derive(Debug, Clone)]
struct DccToolCallRequest {
    capability: String,
    action: String,
    arguments: Value,
    software: String,
    source_software: String,
    target_software: String,
}

impl AgentTool for McpTool {
    fn name(&self) -> &'static str {
        "mcp_tool"
    }

    fn description(&self) -> &'static str {
        "调用已注册的 MCP Server；当前支持模型 MCP 兼容入口、stdio MCP 与 HTTP MCP。"
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::High
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let request = parse_mcp_tool_request(args)?;

        if should_route_to_model_mcp(request.server.as_str()) {
            return execute_model_mcp_tool(
                self.dcc_provider_addr.clone(),
                request.tool.as_str(),
                request.arguments,
            );
        }

        let registration =
            select_registered_mcp(self.registered_mcps.as_slice(), request.server.as_str())?;
        execute_registered_mcp_tool(registration, &request, context.sandbox_root)
    }
}

impl AgentTool for DccTool {
    fn name(&self) -> &'static str {
        "dcc_tool"
    }

    fn description(&self) -> &'static str {
        "调用 DCC 建模能力路由；可按 capability / software 选择建模软件，并支持生成跨软件迁移计划。"
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::High
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let request = parse_dcc_tool_request(args)?;
        if is_cross_dcc_request(&request) {
            return build_cross_dcc_transfer_plan(self.registered_mcps.as_slice(), &request);
        }

        let registration = select_dcc_provider(
            self.registered_mcps.as_slice(),
            request.capability.as_str(),
            request.software.as_str(),
        )?;
        let mcp_request = McpToolCallRequest {
            server: registration.id.clone(),
            tool: request.action.clone(),
            arguments: request.arguments.clone(),
        };
        let mut response =
            execute_registered_mcp_tool(registration, &mcp_request, context.sandbox_root)?;
        if let Some(map) = response.as_object_mut() {
            map.insert("capability".to_string(), json!(request.capability));
            map.insert("software".to_string(), json!(registration.software));
            map.insert("provider_id".to_string(), json!(registration.id));
            map.insert("provider_name".to_string(), json!(registration.name));
        }
        Ok(response)
    }
}

/// 描述：解析 MCP 工具调用参数，兼容 `tool/name/action` 与 `arguments/params/payload` 等历史写法。
///
/// Params:
///
///   - args: Python 侧上送的工具参数。
///
/// Returns:
///
///   - 统一化后的 MCP 调用请求。
fn parse_mcp_tool_request(args: &Value) -> Result<McpToolCallRequest, ProtocolError> {
    let server = args
        .get("server")
        .or_else(|| args.get("mcp"))
        .or_else(|| args.get("server_id"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let tool = get_required_string(args, "tool", "core.agent.mcp.tool_missing")
        .or_else(|_| get_required_string(args, "name", "core.agent.mcp.tool_missing"))
        .or_else(|_| get_required_string(args, "action", "core.agent.mcp.tool_missing"))?;
    let arguments = args
        .get("arguments")
        .or_else(|| args.get("params"))
        .or_else(|| args.get("payload"))
        .or_else(|| args.get("data"))
        .cloned()
        .unwrap_or_else(|| json!({}));

    Ok(McpToolCallRequest {
        server,
        tool,
        arguments,
    })
}

/// 描述：解析 DCC 工具调用参数，兼容 `action/tool/name`、`sourceSoftware/targetSoftware` 等历史别名。
///
/// Params:
///
///   - args: Python 侧上送的工具参数。
///
/// Returns:
///
///   - 统一化后的 DCC 调用请求。
fn parse_dcc_tool_request(args: &Value) -> Result<DccToolCallRequest, ProtocolError> {
    let capability = get_required_string(args, "capability", "core.agent.dcc.capability_missing")?;
    let action = get_required_string(args, "action", "core.agent.dcc.action_missing")
        .or_else(|_| get_required_string(args, "tool", "core.agent.dcc.action_missing"))
        .or_else(|_| get_required_string(args, "name", "core.agent.dcc.action_missing"))?;
    let arguments = args
        .get("arguments")
        .or_else(|| args.get("params"))
        .or_else(|| args.get("payload"))
        .or_else(|| args.get("data"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let software = read_optional_string_arg(args, &["software", "dcc"]);
    let source_software =
        read_optional_string_arg(args, &["source_software", "sourceSoftware", "source"]);
    let target_software =
        read_optional_string_arg(args, &["target_software", "targetSoftware", "target"]);

    Ok(DccToolCallRequest {
        capability,
        action,
        arguments,
        software,
        source_software,
        target_software,
    })
}

/// 描述：读取可选字符串参数，兼容多个别名键并统一做 trim。
///
/// Params:
///
///   - args: 原始 JSON 参数。
///   - keys: 允许的键集合。
///
/// Returns:
///
///   - 命中后的字符串；未命中则返回空字符串。
fn read_optional_string_arg(args: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| args.get(*key))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string()
}

/// 描述：判断当前 DCC 请求是否为跨软件迁移计划；一旦涉及 source/target 或 cross capability，统一进入计划分支。
///
/// Params:
///
///   - request: DCC 调用请求。
///
/// Returns:
///
///   - true: 当前请求应走跨软件迁移计划。
fn is_cross_dcc_request(request: &DccToolCallRequest) -> bool {
    request
        .capability
        .trim()
        .eq_ignore_ascii_case("cross_dcc.transfer")
        || !request.source_software.trim().is_empty()
        || !request.target_software.trim().is_empty()
}

/// 描述：判断当前请求是否应继续走历史模型 MCP 分支，用于兼容旧脚本与 Blender 桥接链路。
///
/// Params:
///
///   - server: 请求中声明的 server 标识。
///
/// Returns:
///
///   - true: 继续路由到模型 MCP。
fn should_route_to_model_mcp(server: &str) -> bool {
    let normalized = server.trim().to_lowercase();
    normalized.is_empty()
        || normalized == "model"
        || normalized == "blender"
        || normalized == "blender-bridge"
}

/// 描述：执行单个已注册 MCP 调用，统一处理 runtime_ready 校验和 transport 分发。
///
/// Params:
///
///   - registration: 目标 MCP 注册项。
///   - request: 调用请求。
///   - sandbox_root: 当前智能体工作目录。
///
/// Returns:
///
///   - MCP 的结构化响应。
fn execute_registered_mcp_tool(
    registration: &AgentRegisteredMcp,
    request: &McpToolCallRequest,
    sandbox_root: &Path,
) -> Result<Value, ProtocolError> {
    if !registration.runtime_ready {
        let message = registration.runtime_hint.clone().unwrap_or_else(|| {
            format!(
                "MCP `{}` 当前不可用，请先检查运行时配置。",
                registration.name
            )
        });
        return Err(
            ProtocolError::new("core.agent.mcp.runtime_not_ready", message)
                .with_suggestion("请在 MCP 页面完成校验后重试。"),
        );
    }

    match registration.transport.trim().to_lowercase().as_str() {
        "stdio" => execute_stdio_mcp_tool(registration, request, sandbox_root),
        "http" => execute_http_mcp_tool(registration, request),
        _ => Err(ProtocolError::new(
            "core.agent.mcp.transport_unsupported",
            format!("不支持的 MCP 传输方式: {}", registration.transport),
        )),
    }
}

/// 描述：在已注册 MCP 列表中查找目标服务，支持按 `id` 或 `name` 匹配。
///
/// Params:
///
///   - registrations: 已启用的 MCP 注册项。
///   - server: 目标服务标识。
///
/// Returns:
///
///   - 命中的 MCP 注册项引用。
fn select_registered_mcp<'a>(
    registrations: &'a [AgentRegisteredMcp],
    server: &str,
) -> Result<&'a AgentRegisteredMcp, ProtocolError> {
    let normalized = server.trim().to_lowercase();
    if normalized.is_empty() {
        return Err(ProtocolError::new(
            "core.agent.mcp.server_missing",
            "调用外部 MCP 时必须显式指定 server。",
        )
        .with_suggestion(
            "请先调用 `mcp_tool(server=\"<id>\", tool=\"list_tools\")` 查看该 MCP 支持的能力。",
        ));
    }
    if let Some(item) = registrations.iter().find(|item| {
        item.id.trim().eq_ignore_ascii_case(normalized.as_str())
            || item.name.trim().eq_ignore_ascii_case(normalized.as_str())
    }) {
        return Ok(item);
    }
    let available_ids = registrations
        .iter()
        .map(|item| item.id.clone())
        .collect::<Vec<String>>()
        .join(", ");
    Err(ProtocolError::new(
        "core.agent.mcp.server_not_found",
        format!("未找到已启用的 MCP server `{}`。", server.trim()),
    )
    .with_suggestion(format!(
        "当前可用 MCP: {}",
        if available_ids.is_empty() {
            "（无）".to_string()
        } else {
            available_ids
        }
    )))
}

/// 描述：在 DCC MCP 中按 capability / software 选择目标 provider。
///
/// Params:
///
///   - registrations: 当前已启用的 MCP 注册项。
///   - capability: 目标能力组，如 `mesh.edit`。
///   - software: 用户已绑定的软件；为空时会检查是否存在歧义。
///
/// Returns:
///
///   - 命中的 DCC MCP provider。
fn select_dcc_provider<'a>(
    registrations: &'a [AgentRegisteredMcp],
    capability: &str,
    software: &str,
) -> Result<&'a AgentRegisteredMcp, ProtocolError> {
    let normalized_capability = capability.trim().to_lowercase();
    let normalized_software = software.trim().to_lowercase();
    let matches: Vec<&AgentRegisteredMcp> = registrations
        .iter()
        .filter(|item| item.domain.trim().eq_ignore_ascii_case("dcc"))
        .filter(|item| item.runtime_ready)
        .filter(|item| {
            item.capabilities.iter().any(|registered_capability| {
                registered_capability
                    .trim()
                    .eq_ignore_ascii_case(normalized_capability.as_str())
            })
        })
        .filter(|item| {
            normalized_software.is_empty()
                || item
                    .software
                    .trim()
                    .eq_ignore_ascii_case(normalized_software.as_str())
        })
        .collect();

    if matches.is_empty() {
        return Err(ProtocolError::new(
            "core.agent.dcc.provider_not_found",
            format!(
                "未找到支持能力 `{}` 的 DCC MCP{}。",
                capability.trim(),
                if normalized_software.is_empty() {
                    "".to_string()
                } else {
                    format!("（software={}）", software.trim())
                }
            ),
        )
        .with_suggestion("请先在 MCP 页面启用对应的建模软件，并确认其 capability 配置完整。"));
    }

    if normalized_software.is_empty() {
        let mut software_names = matches
            .iter()
            .map(|item| normalized_dcc_software_name(item.software.as_str()))
            .collect::<Vec<String>>();
        software_names.sort();
        software_names.dedup();
        if software_names.len() > 1 {
            return Err(ProtocolError::new(
                "core.agent.dcc.software_choice_required",
                format!(
                    "当前能力 `{}` 可由多个建模软件提供，必须先明确 software。",
                    capability.trim()
                ),
            )
            .with_suggestion(format!("可选软件: {}", software_names.join(", "))));
        }
    }

    choose_best_registered_mcp(matches)
}

/// 描述：在多个候选 MCP 中按优先级选择最佳 provider；优先级相同时按 id 稳定排序。
///
/// Params:
///
///   - items: 候选 MCP 集合。
///
/// Returns:
///
///   - 命中的最佳 MCP provider。
fn choose_best_registered_mcp<'a>(
    mut items: Vec<&'a AgentRegisteredMcp>,
) -> Result<&'a AgentRegisteredMcp, ProtocolError> {
    items.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.id.cmp(&right.id))
    });
    items.first().copied().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.dcc.provider_not_found",
            "当前没有可用的 DCC MCP provider。",
        )
    })
}

/// 描述：规范化 DCC 软件名称，优先使用 software 字段本身；为空时回退到 provider id，避免提示为空字符串。
///
/// Params:
///
///   - software: MCP 注册项中的 software。
///
/// Returns:
///
///   - 可展示的软件标识。
fn normalized_dcc_software_name(software: &str) -> String {
    let normalized = software.trim();
    if normalized.is_empty() {
        "unknown".to_string()
    } else {
        normalized.to_string()
    }
}

/// 描述：构建跨软件迁移计划；当前阶段仅生成源软件 -> 中间格式 -> 目标软件的显式计划，不直接执行双端工具调用。
///
/// Params:
///
///   - registrations: 当前已启用的 MCP 注册项。
///   - request: DCC 调用请求。
///
/// Returns:
///
///   - 结构化的跨软件迁移计划。
fn build_cross_dcc_transfer_plan(
    registrations: &[AgentRegisteredMcp],
    request: &DccToolCallRequest,
) -> Result<Value, ProtocolError> {
    if !request.action.trim().eq_ignore_ascii_case("plan_transfer") {
        return Err(ProtocolError::new(
            "core.agent.dcc.cross_action_unsupported",
            "跨软件 DCC 操作当前仅支持 `plan_transfer`。",
        )
        .with_suggestion(
            "请先调用 `dcc_tool(capability=\"cross_dcc.transfer\", action=\"plan_transfer\", source_software=\"<源软件>\", target_software=\"<目标软件>\", arguments={...})` 生成迁移计划。",
        ));
    }

    let source_software = request.source_software.trim();
    let target_software = request.target_software.trim();
    if source_software.is_empty() || target_software.is_empty() {
        return Err(ProtocolError::new(
            "core.agent.dcc.cross_software_missing",
            "跨软件迁移必须同时提供 source_software 和 target_software。",
        )
        .with_suggestion("请先在对话中或 dcc_tool 参数中明确源软件和目标软件。"));
    }
    if source_software.eq_ignore_ascii_case(target_software) {
        return Err(ProtocolError::new(
            "core.agent.dcc.cross_software_same",
            "跨软件迁移要求源软件和目标软件不能相同。",
        ));
    }

    let source_provider = select_cross_dcc_endpoint(registrations, source_software, true)?;
    let target_provider = select_cross_dcc_endpoint(registrations, target_software, false)?;
    let preferred_format = resolve_preferred_transfer_format(&request.arguments);
    Ok(json!({
        "mode": "cross_dcc_plan",
        "capability": request.capability,
        "action": request.action,
        "preferred_format": preferred_format,
        "source": {
            "software": source_provider.software,
            "provider_id": source_provider.id,
            "provider_name": source_provider.name,
        },
        "target": {
            "software": target_provider.software,
            "provider_id": target_provider.id,
            "provider_name": target_provider.name,
        },
        "steps": [
            format!("在 {} 中执行导出。", source_provider.software),
            format!("使用 {} 作为中间格式传递资产。", preferred_format),
            format!("在 {} 中执行导入并继续后续处理。", target_provider.software),
        ],
        "arguments": request.arguments,
    }))
}

/// 描述：按软件与导入/导出能力选择跨软件迁移端点；同一软件存在多个 provider 时按优先级选择。
///
/// Params:
///
///   - registrations: 当前已启用的 MCP 注册项。
///   - software: 目标软件标识。
///   - require_export: true 表示选择源端；false 表示选择目标端。
///
/// Returns:
///
///   - 命中的源端或目标端 provider。
fn select_cross_dcc_endpoint<'a>(
    registrations: &'a [AgentRegisteredMcp],
    software: &str,
    require_export: bool,
) -> Result<&'a AgentRegisteredMcp, ProtocolError> {
    let normalized_software = software.trim().to_lowercase();
    let matches = registrations
        .iter()
        .filter(|item| item.domain.trim().eq_ignore_ascii_case("dcc"))
        .filter(|item| item.runtime_ready)
        .filter(|item| {
            item.software
                .trim()
                .eq_ignore_ascii_case(normalized_software.as_str())
        })
        .filter(|item| {
            if require_export {
                item.supports_export
            } else {
                item.supports_import
            }
        })
        .collect::<Vec<&AgentRegisteredMcp>>();
    if matches.is_empty() {
        return Err(ProtocolError::new(
            if require_export {
                "core.agent.dcc.source_provider_not_found"
            } else {
                "core.agent.dcc.target_provider_not_found"
            },
            format!(
                "未找到软件 `{}` 的{} DCC MCP。",
                software.trim(),
                if require_export {
                    "导出端"
                } else {
                    "导入端"
                }
            ),
        )
        .with_suggestion("请先在 MCP 页面确认该软件已启用，并具备导入/导出能力。"));
    }
    choose_best_registered_mcp(matches)
}

/// 描述：解析跨软件迁移的中间格式；若用户未指定，则按固定优先级回退到默认格式。
///
/// Params:
///
///   - arguments: DCC 调用参数。
///
/// Returns:
///
///   - 归一化后的中间格式字符串。
fn resolve_preferred_transfer_format(arguments: &Value) -> String {
    arguments
        .get("preferred_format")
        .or_else(|| arguments.get("format"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
        .unwrap_or_else(|| DEFAULT_DCC_TRANSFER_FORMATS[0].to_string())
}

/// 描述：执行历史模型 MCP 调用，保持旧版 DCC 桥接能力与脚本兼容。
///
/// Params:
///
///   - dcc_provider_addr: DCC Provider 地址。
///   - tool: 模型 MCP 动作名称。
///   - arguments: 动作参数。
///
/// Returns:
///
///   - 标准化后的执行结果。
fn execute_model_mcp_tool(
    dcc_provider_addr: Option<String>,
    tool: &str,
    arguments: Value,
) -> Result<Value, ProtocolError> {
    #[cfg(feature = "with-mcp-model")]
    {
        let action = tool
            .parse::<libra_mcp_model::ModelToolAction>()
            .map_err(|err| {
                ProtocolError::new(
                    "core.agent.python.model_tool.action_invalid",
                    format!("模型工具 action 无效: {}", err),
                )
            })?;
        let request = libra_mcp_model::ModelToolRequest {
            action,
            params: arguments,
            blender_bridge_addr: dcc_provider_addr,
            timeout_secs: None,
        };
        let result =
            libra_mcp_model::execute_model_tool(request).map_err(|err| err.to_protocol_error())?;
        return Ok(json!({
            "server": "model",
            "tool": result.action.as_str(),
            "message": result.message,
            "output_path": result.output_path,
            "data": result.data,
        }));
    }

    #[cfg(not(feature = "with-mcp-model"))]
    {
        let _ = dcc_provider_addr;
        let _ = tool;
        let _ = arguments;
        Err(ProtocolError::new(
            "core.agent.python.model_tool_disabled",
            "当前构建未启用模型 MCP 工具能力",
        )
        .with_suggestion("请以 with-mcp-model 特性重新构建。"))
    }
}

/// 描述：执行 stdio MCP 调用，按 MCP JSON-RPC 协议完成 initialize 与 tools/list 或 tools/call。
///
/// Params:
///
///   - registration: MCP 注册项。
///   - request: 调用请求。
///   - sandbox_root: 当前智能体的工作目录。
///
/// Returns:
///
///   - MCP 返回的结构化结果。
fn execute_stdio_mcp_tool(
    registration: &AgentRegisteredMcp,
    request: &McpToolCallRequest,
    sandbox_root: &Path,
) -> Result<Value, ProtocolError> {
    let (tx, rx) = mpsc::channel();
    let registration_snapshot = registration.clone();
    let request_snapshot = request.clone();
    let sandbox_root = sandbox_root.to_path_buf();

    let mut child = spawn_stdio_mcp_process(&registration, sandbox_root.as_path())?;
    let stdin = child.stdin.take().ok_or_else(|| {
        ProtocolError::new("core.agent.mcp.stdin_missing", "MCP 进程 stdin 管道不可用")
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.mcp.stdout_missing",
            "MCP 进程 stdout 管道不可用",
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.mcp.stderr_missing",
            "MCP 进程 stderr 管道不可用",
        )
    })?;

    thread::spawn(move || {
        let result = execute_stdio_mcp_worker(
            &registration_snapshot,
            &request_snapshot,
            stdin,
            stdout,
            stderr,
        );
        let _ = tx.send(result);
    });

    let result = match rx.recv_timeout(Duration::from_secs(MCP_STDIO_TIMEOUT_SECS)) {
        Ok(result) => result,
        Err(_) => Err(ProtocolError::new(
            "core.agent.mcp.timeout",
            format!(
                "MCP `{}` 在 {} 秒内未返回结果。",
                registration.name, MCP_STDIO_TIMEOUT_SECS
            ),
        )
        .with_suggestion("请检查 MCP 进程是否卡死，或缩小本次调用范围。")),
    };

    let _ = child.kill();
    let _ = child.wait();
    result
}

/// 描述：执行 HTTP MCP 调用，按 JSON-RPC 结构通过 POST 请求访问远端服务，补齐非 stdio 的最小可用链路。
///
/// Params:
///
///   - registration: MCP 注册项。
///   - request: 调用请求。
///
/// Returns:
///
///   - MCP 返回的结构化结果。
fn execute_http_mcp_tool(
    registration: &AgentRegisteredMcp,
    request: &McpToolCallRequest,
) -> Result<Value, ProtocolError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(MCP_HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|err| {
            ProtocolError::new(
                "core.agent.mcp.http_client_build_failed",
                format!("构建 HTTP MCP 客户端失败: {}", err),
            )
        })?;
    let payload = build_http_mcp_payload(request)?;
    let headers = build_http_headers(registration)?;
    let response = client
        .post(registration.url.as_str())
        .headers(headers)
        .json(&payload)
        .send()
        .map_err(|err| {
            ProtocolError::new(
                "core.agent.mcp.http_request_failed",
                format!("调用 HTTP MCP `{}` 失败: {}", registration.name, err),
            )
        })?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if !status.is_success() {
        let body = response.text().map_err(|err| {
            ProtocolError::new(
                "core.agent.mcp.http_response_read_failed",
                format!("读取 HTTP MCP 响应失败: {}", err),
            )
        })?;
        return Err(ProtocolError::new(
            "core.agent.mcp.http_status_failed",
            format!(
                "HTTP MCP `{}` 返回状态码 {}: {}",
                registration.name,
                status.as_u16(),
                truncate_stderr(body.as_str())
            ),
        ));
    }
    let response_value = if is_http_mcp_sse_content_type(content_type.as_deref()) {
        let mut reader = BufReader::new(response);
        read_http_mcp_sse_response_for_id(&mut reader, MCP_TOOL_REQUEST_ID)?
    } else {
        let body = response.text().map_err(|err| {
            ProtocolError::new(
                "core.agent.mcp.http_response_read_failed",
                format!("读取 HTTP MCP 响应失败: {}", err),
            )
        })?;
        parse_http_mcp_response(content_type.as_deref(), body.as_str())?
    };
    let result = extract_jsonrpc_result_with_diagnostic(
        &response_value,
        if request.tool.trim().eq_ignore_ascii_case("list_tools")
            || request.tool.trim().eq_ignore_ascii_case("tools/list")
        {
            "tools/list"
        } else {
            "tools/call"
        },
        None,
    )?;
    if request.tool.trim().eq_ignore_ascii_case("list_tools")
        || request.tool.trim().eq_ignore_ascii_case("tools/list")
    {
        return Ok(json!({
            "server": registration.id,
            "name": registration.name,
            "tools": result.get("tools").cloned().unwrap_or_else(|| json!([])),
        }));
    }
    Ok(json!({
        "server": registration.id,
        "name": registration.name,
        "tool": request.tool.clone(),
        "result": result,
    }))
}

/// 描述：判断 HTTP MCP 响应头是否声明为 SSE / streamable HTTP 传输，供运行时切换增量消费路径。
///
/// Params:
///
///   - content_type: HTTP Content-Type。
///
/// Returns:
///
///   - true: 应按 SSE 逐事件消费。
fn is_http_mcp_sse_content_type(content_type: Option<&str>) -> bool {
    content_type
        .unwrap_or("")
        .trim()
        .to_lowercase()
        .contains("text/event-stream")
}

/// 描述：解析 HTTP MCP 响应，兼容标准 JSON 响应与 `text/event-stream` 风格的流式 JSON-RPC 响应体。
///
/// Params:
///
///   - content_type: HTTP Content-Type。
///   - body: 响应体文本。
///
/// Returns:
///
///   - 解析后的 JSON-RPC 响应对象。
fn parse_http_mcp_response(content_type: Option<&str>, body: &str) -> Result<Value, ProtocolError> {
    let normalized_body = body.trim();
    if normalized_body.is_empty() {
        return Err(ProtocolError::new(
            "core.agent.mcp.response_invalid",
            "HTTP MCP 响应体为空。",
        ));
    }
    if is_http_mcp_sse_content_type(content_type)
        || normalized_body
            .lines()
            .any(|line| line.trim_start().starts_with("data:"))
    {
        return parse_http_mcp_sse_response(normalized_body);
    }
    serde_json::from_str::<Value>(normalized_body).map_err(|err| {
        ProtocolError::new(
            "core.agent.mcp.response_invalid",
            format!("解析 HTTP MCP 响应 JSON 失败: {}", err),
        )
    })
}

/// 描述：解析 SSE 风格的 HTTP MCP 响应，提取最后一条合法 JSON `data:` 事件作为 JSON-RPC 结果。
///
/// Params:
///
///   - body: SSE 响应体文本。
///
/// Returns:
///
///   - 解析后的 JSON-RPC 响应对象。
fn parse_http_mcp_sse_response(body: &str) -> Result<Value, ProtocolError> {
    let cursor = std::io::Cursor::new(body.as_bytes());
    let mut reader = BufReader::new(cursor);
    read_http_mcp_sse_response_for_id(&mut reader, MCP_TOOL_REQUEST_ID)
}

/// 描述：按 SSE 协议逐行读取 HTTP MCP 响应，并在遇到目标 JSON-RPC `id` 后立即返回，避免等待完整 body 收齐。
///
/// Params:
///
///   - reader: SSE 响应读取器。
///   - target_id: 目标 JSON-RPC id。
///
/// Returns:
///
///   - 首条命中的目标 JSON-RPC 响应；若未命中则回退到最后一个合法 JSON 事件。
fn read_http_mcp_sse_response_for_id<R: Read>(
    reader: &mut BufReader<R>,
    target_id: u64,
) -> Result<Value, ProtocolError> {
    let mut current_event_data: Vec<String> = Vec::new();
    let mut latest_candidate: Option<Value> = None;
    let mut line = String::new();
    loop {
        line.clear();
        let read_bytes = reader.read_line(&mut line).map_err(|err| {
            ProtocolError::new(
                "core.agent.mcp.http_response_read_failed",
                format!("读取 HTTP MCP SSE 响应失败: {}", err),
            )
        })?;
        if read_bytes == 0 {
            break;
        }
        let normalized_line = line.trim_end_matches('\n').trim_end_matches('\r');
        if normalized_line.is_empty() {
            if let Some(value) = take_sse_event_payload_as_json(&mut current_event_data) {
                if is_target_jsonrpc_response(&value, target_id) {
                    return Ok(value);
                }
                latest_candidate = Some(value);
            }
            continue;
        }
        if normalized_line.starts_with(':')
            || normalized_line.starts_with("event:")
            || normalized_line.starts_with("id:")
            || normalized_line.starts_with("retry:")
        {
            continue;
        }
        if let Some(data) = normalized_line.strip_prefix("data:") {
            current_event_data.push(data.trim_start().to_string());
        }
    }
    if let Some(value) = take_sse_event_payload_as_json(&mut current_event_data) {
        if is_target_jsonrpc_response(&value, target_id) {
            return Ok(value);
        }
        latest_candidate = Some(value);
    }
    latest_candidate.ok_or_else(|| {
        ProtocolError::new(
            "core.agent.mcp.response_invalid",
            "HTTP MCP 的 SSE 响应中未找到合法 JSON 数据。",
        )
    })
}

/// 描述：判断 SSE 事件是否为当前工具调用对应的 JSON-RPC 响应，命中后即可提前结束读取。
///
/// Params:
///
///   - value: 当前事件解析出的 JSON 值。
///   - target_id: 目标 JSON-RPC id。
///
/// Returns:
///
///   - true: 当前事件已携带目标调用的最终响应。
fn is_target_jsonrpc_response(value: &Value, target_id: u64) -> bool {
    value
        .get("id")
        .and_then(|item| item.as_u64())
        .map(|id| id == target_id)
        .unwrap_or(false)
        && (value.get("result").is_some() || value.get("error").is_some())
}

/// 描述：消费当前 SSE 事件缓冲区并尝试解析 JSON；无法解析的事件会被忽略，避免进度事件中断整体调用。
///
/// Params:
///
///   - current_event_data: 当前事件的 data 行缓冲区。
///
/// Returns:
///
///   - 解析成功时返回 JSON 值；无数据或非 JSON 时返回 None。
fn take_sse_event_payload_as_json(current_event_data: &mut Vec<String>) -> Option<Value> {
    if current_event_data.is_empty() {
        return None;
    }
    let payload = current_event_data.join("\n");
    current_event_data.clear();
    let trimmed = payload.trim();
    if trimmed.is_empty() || trimmed == "[DONE]" {
        return None;
    }
    serde_json::from_str::<Value>(trimmed).ok()
}

/// 描述：构建 HTTP MCP 的 JSON-RPC 请求体，统一兼容 `list_tools` 与 `tools/call` 两种调用形态。
///
/// Params:
///
///   - request: MCP 调用请求。
///
/// Returns:
///
///   - 可直接发送的 JSON-RPC 请求体。
fn build_http_mcp_payload(request: &McpToolCallRequest) -> Result<Value, ProtocolError> {
    if request.tool.trim().eq_ignore_ascii_case("list_tools")
        || request.tool.trim().eq_ignore_ascii_case("tools/list")
    {
        return Ok(json!({
            "jsonrpc": "2.0",
            "id": MCP_TOOL_REQUEST_ID,
            "method": "tools/list",
            "params": {}
        }));
    }
    if !request.arguments.is_object() && !request.arguments.is_null() {
        return Err(ProtocolError::new(
            "core.agent.mcp.arguments_invalid",
            "外部 MCP 的 arguments 必须是 JSON 对象。",
        ));
    }
    Ok(json!({
        "jsonrpc": "2.0",
        "id": MCP_TOOL_REQUEST_ID,
        "method": "tools/call",
        "params": {
            "name": request.tool.clone(),
            "arguments": if request.arguments.is_null() {
                json!({})
            } else {
                request.arguments.clone()
            }
        }
    }))
}

/// 描述：构建 HTTP MCP 请求头，自动透传注册项中的自定义 Header，并补齐 JSON 内容类型。
///
/// Params:
///
///   - registration: MCP 注册项。
///
/// Returns:
///
///   - 可直接用于 reqwest 的 HeaderMap。
fn build_http_headers(registration: &AgentRegisteredMcp) -> Result<HeaderMap, ProtocolError> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    for (key, value) in &registration.headers {
        let header_name = HeaderName::from_bytes(key.as_bytes()).map_err(|err| {
            ProtocolError::new(
                "core.agent.mcp.http_header_invalid",
                format!("HTTP MCP 请求头名称非法（{}）: {}", key, err),
            )
        })?;
        let header_value = HeaderValue::from_str(value.as_str()).map_err(|err| {
            ProtocolError::new(
                "core.agent.mcp.http_header_invalid",
                format!("HTTP MCP 请求头值非法（{}）: {}", key, err),
            )
        })?;
        headers.insert(header_name, header_value);
    }
    Ok(headers)
}

/// 描述：启动 stdio MCP 进程，统一继承注册项中的命令、参数、环境变量与工作目录。
///
/// Params:
///
///   - registration: MCP 注册项。
///   - sandbox_root: 智能体当前工作目录。
///
/// Returns:
///
///   - 已启动的 MCP 子进程。
fn spawn_stdio_mcp_process(
    registration: &AgentRegisteredMcp,
    sandbox_root: &Path,
) -> Result<std::process::Child, ProtocolError> {
    let mut command = Command::new(registration.command.as_str());
    command.args(registration.args.as_slice());
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    if registration.cwd.trim().is_empty() {
        command.current_dir(sandbox_root);
    } else {
        command.current_dir(registration.cwd.trim());
    }
    for (key, value) in &registration.env {
        command.env(key, value);
    }
    command.spawn().map_err(|err| {
        ProtocolError::new(
            "core.agent.mcp.spawn_failed",
            format!(
                "启动 MCP `{}` 失败（command={}）：{}",
                registration.name, registration.command, err
            ),
        )
    })
}

/// 描述：在线程中执行完整 stdio MCP 交互，避免主线程阻塞在 JSON-RPC 消息读取上。
///
/// Params:
///
///   - registration: MCP 注册项。
///   - request: 调用请求。
///   - stdin: 子进程 stdin。
///   - stdout: 子进程 stdout。
///   - stderr: 子进程 stderr。
///
/// Returns:
///
///   - MCP 返回的结构化结果。
fn execute_stdio_mcp_worker(
    registration: &AgentRegisteredMcp,
    request: &McpToolCallRequest,
    mut stdin: ChildStdin,
    stdout: ChildStdout,
    mut stderr: ChildStderr,
) -> Result<Value, ProtocolError> {
    let (stderr_tx, stderr_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer: Vec<u8> = Vec::new();
        let _ = stderr.read_to_end(&mut buffer);
        let _ = stderr_tx.send(String::from_utf8_lossy(buffer.as_slice()).to_string());
    });

    let mut reader = BufReader::new(stdout);
    write_jsonrpc_message(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": MCP_INITIALIZE_REQUEST_ID,
            "method": "initialize",
            "params": {
                "protocolVersion": MCP_STDIO_PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "clientInfo": {
                    "name": "zodileap-agent",
                    "version": env!("CARGO_PKG_VERSION"),
                }
            }
        }),
    )?;
    let initialize_response = read_jsonrpc_response_for_id(&mut reader, MCP_INITIALIZE_REQUEST_ID)?;
    extract_jsonrpc_result(&initialize_response, "initialize", &stderr_rx)?;

    write_jsonrpc_message(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }),
    )?;

    if request.tool.trim().eq_ignore_ascii_case("list_tools")
        || request.tool.trim().eq_ignore_ascii_case("tools/list")
    {
        write_jsonrpc_message(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": MCP_TOOL_REQUEST_ID,
                "method": "tools/list",
                "params": {}
            }),
        )?;
        let response = read_jsonrpc_response_for_id(&mut reader, MCP_TOOL_REQUEST_ID)?;
        let result = extract_jsonrpc_result(&response, "tools/list", &stderr_rx)?;
        return Ok(json!({
            "server": registration.id,
            "name": registration.name,
            "tools": result.get("tools").cloned().unwrap_or_else(|| json!([])),
        }));
    }

    if !request.arguments.is_object() && !request.arguments.is_null() {
        return Err(ProtocolError::new(
            "core.agent.mcp.arguments_invalid",
            "外部 MCP 的 arguments 必须是 JSON 对象。",
        ));
    }

    write_jsonrpc_message(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": MCP_TOOL_REQUEST_ID,
            "method": "tools/call",
            "params": {
                "name": request.tool.clone(),
                "arguments": if request.arguments.is_null() {
                    json!({})
                } else {
                    request.arguments.clone()
                }
            }
        }),
    )?;
    let response = read_jsonrpc_response_for_id(&mut reader, MCP_TOOL_REQUEST_ID)?;
    let result = extract_jsonrpc_result(&response, "tools/call", &stderr_rx)?;
    Ok(json!({
        "server": registration.id,
        "name": registration.name,
        "tool": request.tool.clone(),
        "result": result,
    }))
}

/// 描述：向 stdio MCP 进程写入单条带 Content-Length 头的 JSON-RPC 消息。
///
/// Params:
///
///   - stdin: MCP 子进程标准输入。
///   - payload: 待发送的 JSON-RPC 对象。
///
/// Returns:
///
///   - 0: 写入成功。
fn write_jsonrpc_message(stdin: &mut ChildStdin, payload: &Value) -> Result<(), ProtocolError> {
    let body = serde_json::to_vec(payload).map_err(|err| {
        ProtocolError::new(
            "core.agent.mcp.request_serialize_failed",
            format!("序列化 MCP 请求失败: {}", err),
        )
    })?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    stdin.write_all(header.as_bytes()).map_err(|err| {
        ProtocolError::new(
            "core.agent.mcp.write_failed",
            format!("写入 MCP 请求头失败: {}", err),
        )
    })?;
    stdin.write_all(body.as_slice()).map_err(|err| {
        ProtocolError::new(
            "core.agent.mcp.write_failed",
            format!("写入 MCP 请求体失败: {}", err),
        )
    })?;
    stdin.flush().map_err(|err| {
        ProtocolError::new(
            "core.agent.mcp.write_failed",
            format!("刷新 MCP 请求失败: {}", err),
        )
    })
}

/// 描述：读取目标 `id` 的 JSON-RPC 响应，自动跳过 server 主动发送的通知消息。
///
/// Params:
///
///   - reader: MCP stdout 读取器。
///   - target_id: 期望响应的 JSON-RPC id。
///
/// Returns:
///
///   - 命中的 JSON-RPC 消息对象。
fn read_jsonrpc_response_for_id<R: Read>(
    reader: &mut BufReader<R>,
    target_id: u64,
) -> Result<Value, ProtocolError> {
    loop {
        let message = read_jsonrpc_message(reader)?;
        let id_matches = message
            .get("id")
            .and_then(|value| value.as_u64())
            .map(|value| value == target_id)
            .unwrap_or(false);
        if id_matches {
            return Ok(message);
        }
        if message.get("id").is_none() {
            continue;
        }
    }
}

/// 描述：从 stdio 流中读取单条 MCP JSON-RPC 消息，按 Content-Length 头做精准截断。
///
/// Params:
///
///   - reader: MCP stdout 读取器。
///
/// Returns:
///
///   - 反序列化后的 JSON 值。
fn read_jsonrpc_message<R: Read>(reader: &mut BufReader<R>) -> Result<Value, ProtocolError> {
    let mut content_length: Option<usize> = None;
    let mut line = String::new();
    loop {
        line.clear();
        let read_bytes = reader.read_line(&mut line).map_err(|err| {
            ProtocolError::new(
                "core.agent.mcp.read_failed",
                format!("读取 MCP 响应头失败: {}", err),
            )
        })?;
        if read_bytes == 0 {
            return Err(ProtocolError::new(
                "core.agent.mcp.eof",
                "MCP 进程提前结束，未返回完整响应。",
            ));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = value.trim().parse::<usize>().ok();
        }
    }
    let body_length = content_length.ok_or_else(|| {
        ProtocolError::new(
            "core.agent.mcp.content_length_missing",
            "MCP 响应缺少 Content-Length 头。",
        )
    })?;
    let mut body = vec![0u8; body_length];
    reader.read_exact(body.as_mut_slice()).map_err(|err| {
        ProtocolError::new(
            "core.agent.mcp.read_failed",
            format!("读取 MCP 响应体失败: {}", err),
        )
    })?;
    serde_json::from_slice::<Value>(body.as_slice()).map_err(|err| {
        ProtocolError::new(
            "core.agent.mcp.response_invalid",
            format!("解析 MCP 响应 JSON 失败: {}", err),
        )
    })
}

/// 描述：从 JSON-RPC 响应中提取 result 字段，并在 error 分支上拼接 stderr 摘要，方便快速定位问题。
///
/// Params:
///
///   - response: JSON-RPC 响应对象。
///   - method: 当前调用的方法名。
///   - stderr_rx: stderr 接收端，用于附带诊断信息。
///
/// Returns:
///
///   - JSON-RPC 的 `result` 字段。
fn extract_jsonrpc_result(
    response: &Value,
    method: &str,
    stderr_rx: &mpsc::Receiver<String>,
) -> Result<Value, ProtocolError> {
    extract_jsonrpc_result_with_diagnostic(
        response,
        method,
        stderr_rx
            .try_recv()
            .ok()
            .map(|text| truncate_stderr(text.as_str()))
            .filter(|text| !text.is_empty()),
    )
}

/// 描述：从 JSON-RPC 响应中提取 result 字段，并允许附加诊断信息，供 stdio/HTTP 两种传输复用。
///
/// Params:
///
///   - response: JSON-RPC 响应对象。
///   - method: 当前调用的方法名。
///   - diagnostic: 可选的诊断文本。
///
/// Returns:
///
///   - JSON-RPC 的 `result` 字段。
fn extract_jsonrpc_result_with_diagnostic(
    response: &Value,
    method: &str,
    diagnostic: Option<String>,
) -> Result<Value, ProtocolError> {
    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown MCP error")
            .to_string();
        let merged_message = match diagnostic {
            Some(text) => format!("{}；诊断: {}", message, text),
            None => message,
        };
        return Err(ProtocolError::new(
            "core.agent.mcp.call_failed",
            format!("MCP {} 调用失败: {}", method, merged_message),
        ));
    }
    response.get("result").cloned().ok_or_else(|| {
        ProtocolError::new(
            "core.agent.mcp.result_missing",
            "MCP 响应缺少 result 字段。",
        )
    })
}

/// 描述：截断 stderr 文本，避免外部 MCP 把大量日志直接灌入会话结果。
///
/// Params:
///
///   - text: 原始 stderr 文本。
///
/// Returns:
///
///   - 截断后的摘要字符串。
fn truncate_stderr(text: &str) -> String {
    let normalized = text.trim();
    if normalized.is_empty() {
        return String::new();
    }
    let mut chars = normalized.chars();
    let preview = chars.by_ref().take(240).collect::<String>();
    if chars.next().is_some() {
        format!("{}...", preview)
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_cross_dcc_transfer_plan, build_http_headers, build_http_mcp_payload,
        parse_dcc_tool_request, parse_http_mcp_response, parse_mcp_tool_request,
        read_jsonrpc_message, select_dcc_provider, select_registered_mcp, AgentRegisteredMcp,
        DccToolCallRequest, McpToolCallRequest,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::io::{BufReader, Cursor};

    /// 描述：构建最小 MCP 注册项样例，避免每个测试重复手写字段。
    fn build_registered_mcp(id: &str, name: &str) -> AgentRegisteredMcp {
        AgentRegisteredMcp {
            id: id.to_string(),
            name: name.to_string(),
            domain: "general".to_string(),
            software: "".to_string(),
            capabilities: Vec::new(),
            priority: 0,
            supports_import: false,
            supports_export: false,
            transport: "stdio".to_string(),
            command: "echo".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            runtime_kind: "".to_string(),
            official_provider: "".to_string(),
            runtime_ready: true,
            runtime_hint: None,
        }
    }

    /// 描述：验证 MCP 调用参数解析兼容 `name/params` 历史写法，避免旧脚本直接失效。
    #[test]
    fn should_parse_legacy_mcp_request_alias_fields() {
        let request = parse_mcp_tool_request(&json!({
            "name": "list_objects",
            "params": {
                "scope": "scene"
            }
        }))
        .expect("should parse request");
        assert_eq!(request.server, "");
        assert_eq!(request.tool, "list_objects");
        assert_eq!(
            request
                .arguments
                .get("scope")
                .and_then(|value| value.as_str()),
            Some("scene")
        );
    }

    /// 描述：验证 DCC 调用参数解析兼容 `tool/name` 与 `sourceSoftware/targetSoftware` 历史别名。
    #[test]
    fn should_parse_dcc_request_alias_fields() {
        let request = parse_dcc_tool_request(&json!({
            "capability": "mesh.edit",
            "tool": "list_mesh_objects",
            "params": {
                "scope": "selected"
            },
            "sourceSoftware": "blender",
            "targetSoftware": "maya"
        }))
        .expect("should parse dcc request");
        assert_eq!(request.capability, "mesh.edit");
        assert_eq!(request.action, "list_mesh_objects");
        assert_eq!(request.source_software, "blender");
        assert_eq!(request.target_software, "maya");
        assert_eq!(
            request
                .arguments
                .get("scope")
                .and_then(|value| value.as_str()),
            Some("selected")
        );
    }

    /// 描述：验证外部 MCP 可按 `id` 或 `name` 命中，保证用户输入更宽松时仍能找到目标服务。
    #[test]
    fn should_match_registered_mcp_by_id_or_name() {
        let items = vec![
            build_registered_mcp("apifox-official", "Apifox 官方 MCP"),
            build_registered_mcp("design-tools", "Design Tools"),
        ];
        let by_id =
            select_registered_mcp(items.as_slice(), "apifox-official").expect("match by id");
        let by_name =
            select_registered_mcp(items.as_slice(), "Design Tools").expect("match by name");
        assert_eq!(by_id.id, "apifox-official");
        assert_eq!(by_name.id, "design-tools");
    }

    /// 描述：验证 DCC provider 选择会在同一软件下按 priority 选中最佳 MCP，避免 provider 歧义导致结果不稳定。
    #[test]
    fn should_select_best_dcc_provider_by_priority() {
        let mut lower = build_registered_mcp("blender-fallback", "Blender Fallback");
        lower.domain = "dcc".to_string();
        lower.software = "blender".to_string();
        lower.capabilities = vec!["mesh.edit".to_string()];
        lower.priority = 10;

        let mut higher = build_registered_mcp("blender-primary", "Blender Primary");
        higher.domain = "dcc".to_string();
        higher.software = "blender".to_string();
        higher.capabilities = vec!["mesh.edit".to_string()];
        higher.priority = 100;

        let providers = [lower, higher];
        let selected = select_dcc_provider(&providers, "mesh.edit", "blender")
            .expect("should select dcc provider");
        assert_eq!(selected.id, "blender-primary");
    }

    /// 描述：验证未指定软件且存在多个 DCC 软件时，DCC 路由会拒绝自动选择，避免违背会话级用户选择规则。
    #[test]
    fn should_require_software_when_multiple_dcc_softwares_match() {
        let mut blender = build_registered_mcp("blender-primary", "Blender Primary");
        blender.domain = "dcc".to_string();
        blender.software = "blender".to_string();
        blender.capabilities = vec!["mesh.edit".to_string()];

        let mut maya = build_registered_mcp("maya-primary", "Maya Primary");
        maya.domain = "dcc".to_string();
        maya.software = "maya".to_string();
        maya.capabilities = vec!["mesh.edit".to_string()];

        let error = select_dcc_provider(&[blender, maya], "mesh.edit", "")
            .expect_err("should require explicit software");
        assert_eq!(error.code, "core.agent.dcc.software_choice_required");
    }

    /// 描述：验证跨软件迁移计划会生成源软件 -> 中间格式 -> 目标软件结构，且优先返回用户指定格式。
    #[test]
    fn should_build_cross_dcc_transfer_plan_with_explicit_format() {
        let mut blender = build_registered_mcp("blender-primary", "Blender Primary");
        blender.domain = "dcc".to_string();
        blender.software = "blender".to_string();
        blender.supports_export = true;

        let mut maya = build_registered_mcp("maya-primary", "Maya Primary");
        maya.domain = "dcc".to_string();
        maya.software = "maya".to_string();
        maya.supports_import = true;

        let providers = [blender, maya];
        let plan = build_cross_dcc_transfer_plan(
            &providers,
            &DccToolCallRequest {
                capability: "cross_dcc.transfer".to_string(),
                action: "plan_transfer".to_string(),
                arguments: json!({"preferred_format": "usd"}),
                software: "".to_string(),
                source_software: "blender".to_string(),
                target_software: "maya".to_string(),
            },
        )
        .expect("should build transfer plan");
        assert_eq!(
            plan.get("preferred_format")
                .and_then(|value| value.as_str()),
            Some("usd")
        );
        assert_eq!(
            plan.get("source")
                .and_then(|value| value.get("provider_id"))
                .and_then(|value| value.as_str()),
            Some("blender-primary")
        );
        assert_eq!(
            plan.get("target")
                .and_then(|value| value.get("provider_id"))
                .and_then(|value| value.as_str()),
            Some("maya-primary")
        );
    }

    /// 描述：验证 MCP stdio 响应解析支持 Content-Length 头，避免不同 server 帧格式回归。
    #[test]
    fn should_parse_content_length_jsonrpc_message() {
        let payload = br#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#;
        let source = [
            format!("Content-Length: {}\r\n\r\n", payload.len()).into_bytes(),
            payload.to_vec(),
        ]
        .concat();
        let mut reader = BufReader::new(Cursor::new(source));
        let message = read_jsonrpc_message(&mut reader).expect("parse message");
        assert_eq!(
            message.get("jsonrpc").and_then(|value| value.as_str()),
            Some("2.0")
        );
        assert_eq!(message.get("id").and_then(|value| value.as_u64()), Some(1));
    }

    /// 描述：验证 HTTP MCP 请求头会透传自定义 Header，并补齐 JSON Content-Type。
    #[test]
    fn should_build_http_mcp_headers_with_custom_values() {
        let mut registration = build_registered_mcp("http-tools", "HTTP Tools");
        registration.transport = "http".to_string();
        registration
            .headers
            .insert("Authorization".to_string(), "Bearer test-token".to_string());
        let headers = build_http_headers(&registration).expect("build headers");
        assert_eq!(
            headers
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );
        assert_eq!(
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer test-token")
        );
    }

    /// 描述：验证 HTTP MCP 请求体会根据 `list_tools` 与普通工具调用输出不同的 JSON-RPC 结构。
    #[test]
    fn should_build_http_mcp_payload_for_list_and_call() {
        let list_payload = build_http_mcp_payload(&McpToolCallRequest {
            server: "http-tools".to_string(),
            tool: "list_tools".to_string(),
            arguments: json!({}),
        })
        .expect("build list payload");
        assert_eq!(
            list_payload.get("method").and_then(|value| value.as_str()),
            Some("tools/list")
        );

        let call_payload = build_http_mcp_payload(&McpToolCallRequest {
            server: "http-tools".to_string(),
            tool: "ping".to_string(),
            arguments: json!({ "name": "demo" }),
        })
        .expect("build call payload");
        assert_eq!(
            call_payload.get("method").and_then(|value| value.as_str()),
            Some("tools/call")
        );
        assert_eq!(
            call_payload
                .get("params")
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str()),
            Some("ping")
        );
    }

    /// 描述：验证 HTTP MCP 能解析 `text/event-stream` 风格的 JSON-RPC 响应，兼容 streamable HTTP 服务端。
    #[test]
    fn should_parse_http_mcp_sse_response() {
        let response = parse_http_mcp_response(
            Some("text/event-stream"),
            "event: message\n\
data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"ping\"}]}}\n\n\
data: [DONE]\n\n",
        )
        .expect("parse sse response");
        assert_eq!(
            response.get("jsonrpc").and_then(|value| value.as_str()),
            Some("2.0")
        );
        assert_eq!(
            response
                .get("result")
                .and_then(|value| value.get("tools"))
                .and_then(|value| value.as_array())
                .map(|value| value.len()),
            Some(1)
        );
    }

    /// 描述：验证 HTTP MCP 的 SSE 解析会跳过非目标事件，并在命中目标 JSON-RPC id 后立即返回结果。
    #[test]
    fn should_skip_non_target_sse_events_and_match_target_id() {
        let response = parse_http_mcp_response(
            Some("text/event-stream"),
            "event: progress\n\
data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"status\":\"warming\"}}\n\n\
event: progress\n\
data: {\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{\"status\":\"planning\"}}\n\n\
event: message\n\
data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"refine\"}]}}\n\n",
        )
        .expect("parse target sse response");
        assert_eq!(response.get("id").and_then(|value| value.as_u64()), Some(2));
        assert_eq!(
            response
                .get("result")
                .and_then(|value| value.get("tools"))
                .and_then(|value| value.as_array())
                .map(|value| value.len()),
            Some(1)
        );
    }

    /// 描述：验证 HTTP MCP 的 SSE 响应若全为非法 JSON 事件，会明确返回解析错误而不是静默成功。
    #[test]
    fn should_fail_when_sse_response_contains_no_valid_json() {
        let err = parse_http_mcp_response(
            Some("text/event-stream"),
            "event: progress\n\
data: loading...\n\n\
data: [DONE]\n\n",
        )
        .expect_err("sse without valid json should fail");
        assert_eq!(err.code, "core.agent.mcp.response_invalid");
    }
}
