use crate::flow::build_system_prompt;
use crate::llm::{parse_provider, LlmUsage};
use crate::sandbox::{
    BATCH_SIZE_PREFIX, FINAL_RESULT_PREFIX, SANDBOX_ERROR_PREFIX, TOOL_CALL_PREFIX, TURN_END_MARKER,
};
use crate::{AgentRegisteredMcp, AgentRunRequest, AgentRunResult, AgentStreamEvent};
use libra_mcp_common::{
    now_millis, ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord,
    ProtocolStepStatus,
};
use serde_json::{json, Value};
use std::env;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tracing::{info_span, warn};

#[derive(Debug)]
pub(crate) struct PythonScriptExecutionResult {
    pub message: String,
    pub actions: Vec<String>,
    pub events: Vec<ProtocolEventRecord>,
    pub assets: Vec<ProtocolAssetRecord>,
}

pub(crate) struct PythonScriptExecutionRequest<'a> {
    pub user_script: &'a str,
    pub workdir: Option<&'a str>,
    pub dcc_provider_addr: Option<&'a str>,
    pub available_mcps: &'a [AgentRegisteredMcp],
    pub policy: &'a crate::policy::AgentPolicy,
    pub trace_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone)]
struct AgentTurnRecord {
    turn_index: usize,
    summary: String,
    next: String,
    actions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnControl {
    Continue,
    Done,
}

#[derive(Debug, Clone)]
struct TurnResultEnvelope {
    control: TurnControl,
    summary: String,
    next: String,
}

const TOOL_ARGS_STREAM_PREVIEW_MAX_CHARS: usize = 1200;
const TOOL_ARGS_CONTENT_PREVIEW_MAX_CHARS: usize = 240;
const PLANNING_META_PREFIX: &str = "__libra_planning__:";
const STREAM_TEXT_MAX_CHARS: usize = 4000;

/// 描述：执行智能体 Python 编排主流程，包含脚本生成与沙盒执行。
pub(crate) fn run_agent_with_python_workflow(
    request: AgentRunRequest,
    policy: crate::policy::AgentPolicy,
    _profile: crate::profile::AgentProfile,
    on_stream_event: &mut dyn FnMut(AgentStreamEvent),
) -> Result<AgentRunResult, ProtocolError> {
    let provider = parse_provider(&request.provider);
    let trace_id = request.trace_id.clone();
    let max_turns = resolve_agent_max_turns();
    let llm_policy = crate::llm::LlmGatewayPolicy {
        timeout_secs: policy.llm_timeout_secs,
        retry_policy: policy.llm_retry_policy,
    };
    let mut usage_total = LlmUsage::default();
    let mut steps: Vec<ProtocolStepRecord> = Vec::new();
    let mut events: Vec<ProtocolEventRecord> = Vec::new();
    let mut assets: Vec<ProtocolAssetRecord> = Vec::new();
    let mut actions: Vec<String> = Vec::new();
    let mut turn_records: Vec<AgentTurnRecord> = Vec::new();
    let mut final_message = String::new();
    let mut completed = false;

    for turn_index in 1..=max_turns {
        let round_description_prompt = build_round_description_prompt(
            &request.prompt,
            request.project_name.as_deref(),
            turn_index,
            max_turns,
            &turn_records,
        );
        let round_description_started_at = now_millis();
        let mut round_progress_observer = |progress: &str| {
            on_stream_event(AgentStreamEvent::Heartbeat {
                message: build_llm_waiting_heartbeat_message(
                    "正在确认本次操作所需的工具链与任务顺序…",
                    progress,
                ),
            });
        };
        let round_description_result = crate::llm::call_model_with_policy_and_stream(
            provider,
            &round_description_prompt,
            request.workdir.as_deref(),
            llm_policy.clone(),
            None,
            Some(&mut round_progress_observer),
        )
        .map_err(|err| err.to_protocol_error())?;
        let round_description_finished_at = now_millis();
        usage_total.prompt_tokens = usage_total
            .prompt_tokens
            .saturating_add(round_description_result.usage.prompt_tokens);
        usage_total.completion_tokens = usage_total
            .completion_tokens
            .saturating_add(round_description_result.usage.completion_tokens);
        usage_total.total_tokens = usage_total
            .total_tokens
            .saturating_add(round_description_result.usage.total_tokens);
        let round_description =
            normalize_round_description(round_description_result.content.as_str(), turn_index);
        on_stream_event(AgentStreamEvent::Planning {
            message: build_planning_meta_message(json!({
                "type": "round_description",
                "turn_index": turn_index,
                "text": round_description,
            })),
        });

        on_stream_event(AgentStreamEvent::LlmStarted {
            provider: request.provider.clone(),
        });
        let prompt = build_python_workflow_prompt(
            &request.prompt,
            request.project_name.as_deref(),
            turn_index,
            max_turns,
            &turn_records,
            request.available_mcps.as_slice(),
        );
        let llm_started_at = now_millis();
        let run_result = {
            let stream_event_cell = std::cell::RefCell::new(&mut *on_stream_event);
            let mut stream_observer = |chunk: &str| {
                let mut emitter = stream_event_cell.borrow_mut();
                (*emitter)(AgentStreamEvent::LlmDelta {
                    content: chunk.to_string(),
                });
            };
            let mut codegen_progress_observer = |progress: &str| {
                let mut emitter = stream_event_cell.borrow_mut();
                (*emitter)(AgentStreamEvent::Heartbeat {
                    message: build_llm_waiting_heartbeat_message(
                        "正在等待模型返回可执行脚本的首个片段…",
                        progress,
                    ),
                });
            };
            crate::llm::call_model_with_policy_and_stream(
                provider,
                &prompt,
                request.workdir.as_deref(),
                llm_policy.clone(),
                Some(&mut stream_observer),
                Some(&mut codegen_progress_observer),
            )
        }
        .map_err(|err| err.to_protocol_error())?;
        let llm_finished_at = now_millis();
        usage_total.prompt_tokens = usage_total
            .prompt_tokens
            .saturating_add(run_result.usage.prompt_tokens);
        usage_total.completion_tokens = usage_total
            .completion_tokens
            .saturating_add(run_result.usage.completion_tokens);
        usage_total.total_tokens = usage_total
            .total_tokens
            .saturating_add(run_result.usage.total_tokens);
        on_stream_event(AgentStreamEvent::LlmFinished {
            provider: request.provider.clone(),
        });

        let llm_raw_response = run_result.content.clone();
        let generated_script = extract_python_script(&llm_raw_response);
        if generated_script.trim().is_empty() {
            return Err(ProtocolError::new(
                "core.agent.python.empty_script",
                "模型未返回可执行 Python 脚本",
            )
            .with_suggestion("请重试，或调整提示词让模型只输出 Python 代码。"));
        }
        let generated_script = repair_missing_python_block_body(&generated_script);
        let generated_script = repair_unterminated_python_string_literals(&generated_script);
        let generated_script = ensure_script_has_finish(&generated_script);
        let generated_script = truncate_script_after_first_top_level_finish(&generated_script);
        let exec_started_at = now_millis();
        let execution = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: &generated_script,
                workdir: request.workdir.as_deref(),
                dcc_provider_addr: request.dcc_provider_addr.as_deref(),
                available_mcps: request.available_mcps.as_slice(),
                policy: &policy,
                trace_id: trace_id.clone(),
                session_id: request.session_id.clone(),
            },
            on_stream_event,
        )?;
        let exec_finished_at = now_millis();

        let turn_result = parse_turn_result_envelope(
            &execution.message,
            &execution.actions,
            turn_index,
            max_turns,
        );
        final_message = turn_result.summary.clone();
        turn_records.push(AgentTurnRecord {
            turn_index,
            summary: turn_result.summary.clone(),
            next: turn_result.next.clone(),
            actions: execution.actions.clone(),
        });

        let step_index_base = steps.len();
        steps.push(ProtocolStepRecord {
            index: step_index_base,
            code: "llm_round_description".to_string(),
            status: ProtocolStepStatus::Success,
            elapsed_ms: round_description_finished_at.saturating_sub(round_description_started_at),
            summary: format!("第 {} 轮：已生成本轮任务描述", turn_index),
            error: None,
            data: Some(json!({
                "turn_index": turn_index,
                "usage": round_description_result.usage,
                "llm_prompt_raw": round_description_prompt,
                "llm_response_raw": round_description_result.content,
                "round_description": round_description,
            })),
        });
        steps.push(ProtocolStepRecord {
            index: step_index_base + 1,
            code: "llm_python_codegen".to_string(),
            status: ProtocolStepStatus::Success,
            elapsed_ms: llm_finished_at.saturating_sub(llm_started_at),
            summary: format!(
                "第 {} 轮：provider={} 已生成 Python 编排脚本",
                turn_index, request.provider
            ),
            error: None,
            data: Some(json!({
                "turn_index": turn_index,
                "script_length": generated_script.chars().count(),
                "usage": run_result.usage,
                "llm_prompt_raw": prompt,
                "llm_response_raw": llm_raw_response,
                "llm_script_extracted": generated_script,
            })),
        });
        steps.push(ProtocolStepRecord {
            index: step_index_base + 2,
            code: "python_workflow_execute".to_string(),
            status: ProtocolStepStatus::Success,
            elapsed_ms: exec_finished_at.saturating_sub(exec_started_at),
            summary: format!("第 {} 轮：Python 沙盒执行完成", turn_index),
            error: None,
            data: Some(json!({
                "turn_index": turn_index,
                "actions": execution.actions,
                "turn_control": if turn_result.control == TurnControl::Done { "done" } else { "continue" },
                "turn_summary": turn_result.summary,
                "next": turn_result.next,
            })),
        });

        events.push(ProtocolEventRecord {
            event: "turn_completed".to_string(),
            step_index: Some(step_index_base + 2),
            timestamp_ms: now_millis(),
            message: format!(
                "turn={} control={}",
                turn_index,
                if turn_result.control == TurnControl::Done {
                    "done"
                } else {
                    "continue"
                }
            ),
        });
        events.extend(execution.events);
        assets.extend(execution.assets);
        actions.extend(execution.actions);

        if turn_result.control == TurnControl::Done {
            completed = true;
            break;
        }
    }

    if !completed {
        let fallback_message = if final_message.trim().is_empty() {
            "已达到本轮最大执行次数，当前进展已保存，请继续发起下一轮。".to_string()
        } else {
            format!(
                "已达到本轮最大执行次数（{} 轮），当前进展：{}",
                max_turns, final_message
            )
        };
        final_message = fallback_message;
    }

    if final_message.trim().is_empty() {
        final_message = "执行完成（未返回总结，已自动收尾）".to_string();
    }
    on_stream_event(AgentStreamEvent::Final {
        message: final_message.clone(),
    });

    Ok(AgentRunResult {
        trace_id,
        message: final_message,
        usage: Some(usage_total),
        actions,
        exported_file: None,
        steps,
        events,
        assets,
        ui_hint: None,
    })
}

/// 描述：构建“本轮任务描述”提示词，要求模型只返回一段口语化中文描述。
fn build_round_description_prompt(
    user_prompt: &str,
    project_name: Option<&str>,
    turn_index: usize,
    max_turns: usize,
    turn_records: &[AgentTurnRecord],
) -> String {
    let project_name_text = project_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名项目");
    let system_prompt = build_system_prompt();
    let turn_context = build_turn_context(turn_records);

    format!(
        "{system_prompt}\n\
你正在执行“多轮智能体流程”，当前为第 {turn_index} 轮（最多 {max_turns} 轮）。\n\
本次仅输出“本轮任务描述”，禁止输出代码、列表、序号、Markdown 围栏。\n\
输出要求：\n\
1. 仅输出一段中文自然语言，偏口语化，面向用户可读；\n\
2. 必须说明“本轮会做什么”与“为什么先做这一步”；\n\
3. 长度控制在 30-120 字；\n\
4. 不要出现 PLAN_TITLE、PLAN_STEP、STATUS、SUMMARY、NEXT 等协议词。\n\
当前项目：{project_name_text}\n\
历史执行摘要（最近轮次）：\n\
{turn_context}\n\
用户需求：\n\
{user_prompt}"
    )
}

/// 描述：构建 Python 编排提示词。
fn build_python_workflow_prompt(
    user_prompt: &str,
    project_name: Option<&str>,
    turn_index: usize,
    max_turns: usize,
    turn_records: &[AgentTurnRecord],
    available_mcps: &[AgentRegisteredMcp],
) -> String {
    let project_name_text = project_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名项目");
    let system_prompt = build_system_prompt();
    let turn_context = build_turn_context(turn_records);
    let registered_mcp_context = build_registered_mcp_context(available_mcps);

    format!(
        "{system_prompt}\n\
你正在执行“多轮智能体流程”，当前为第 {turn_index} 轮（最多 {max_turns} 轮）。\n\
你必须严格遵守以下输出协议：\n\
1. 仅输出可执行 Python3 代码，禁止输出 Markdown 围栏与任何自然语言说明。\n\
2. 第一行必须是 Python 代码（如 import/from/def/class/# 注释），不能是英文句子。\n\
3. 每一轮必须完成“一个可验证子任务”，并优先调用可用工具（例如 read_text/write_text/apply_patch/run_shell）完成落地。\n\
4. 脚本末尾必须调用 finish(\"...\")，且内容必须按以下文本协议返回：\n\
   STATUS: CONTINUE 或 DONE\n\
   SUMMARY: 本轮已完成的具体结果（必须是已执行事实，不是计划）\n\
   NEXT: 下一步要做什么（若 STATUS=DONE 则写“无”）\n\
5. 禁止输出“我将会...”等计划性句子，计划应写成代码注释。\n\
6. 禁止导入 `gemini_cli_native_tools` / `codex_tools` / `openai_tools` 等外部工具模块，直接调用内置函数（如 list_directory/write_file/run_shell_command）。\n\
7. 可用内置工具：read_text/read_json/write_text/write_json/list_dir/list_directory/mkdir/stat/glob/search_files/run_shell/run_shell_command/git_status/git_diff/git_log/apply_patch/todo_read/todo_write/web_search/fetch_url/mcp_tool/dcc_tool/tool_search。\n\
8. 工具调用前若不确定参数，必须先执行 `tool_search(\"工具名\", 1)` 查看签名与示例，再落地调用。\n\
9. 关键签名示例：\n\
   - read_text(path)  # 默认返回文件 content 字符串（非原始响应对象）\n\
   - read_json(path)  # 默认返回 JSON data 对象（非原始响应对象）\n\
   - write_text(path, content)\n\
   - apply_patch(patch, check_only=False)\n\
   - run_shell(command, timeout_secs=30)\n\
   - todo_read()  # 默认返回 items 列表\n\
   - todo_write(items)  # 仅允许一个参数 items（数组）；禁止 todo_write(\"A\", \"B\")\n\
10. 只要需求尚未完全落地（代码/配置/测试未完成），必须返回 STATUS: CONTINUE，禁止提前 DONE。\n\
11. 严禁“只写文档就结束”；必须持续执行，直到需求完成并给出 DONE。\n\
12. 严格只允许一个顶层 finish(...) 调用；完成本轮子任务后必须立即 finish 结束脚本。\n\
13. 禁止在同一脚本里拼接第二轮任务或多个 STATUS/SUMMARY/NEXT 区块。\n\
14. 需要调用 DCC 建模能力时优先使用 `dcc_tool(capability=\"<capability>\", action=\"<tool>\", arguments={{...}}, software=\"<software>\")`；\
如需跨软件迁移，先调用 `dcc_tool(capability=\"cross_dcc.transfer\", action=\"plan_transfer\", source_software=\"<源软件>\", target_software=\"<目标软件>\", arguments={{...}})` 生成计划。\n\
15. 需要调用通用外部 MCP 时使用 `mcp_tool(server=\"<id>\", tool=\"<name>\", arguments={{...}})`；\
如不确定某个 MCP 支持的能力，先调用 `mcp_tool(server=\"<id>\", tool=\"list_tools\")` 进行探测。\n\
当前项目：{project_name_text}\n\
历史执行摘要（最近轮次）：\n\
{turn_context}\n\
当前已启用的 MCP：\n\
{registered_mcp_context}\n\
用户需求：\n\
{user_prompt}"
    )
}

/// 描述：将结构化 planning 事件编码为前端可识别的统一文本协议。
fn build_planning_meta_message(payload: Value) -> String {
    format!("{}{}", PLANNING_META_PREFIX, payload)
}

/// 描述：为等待中的 LLM 调用拼装更可读的心跳文案，避免前端只能看到无信息量的“正在思考”。
///
/// Params:
///
///   - fallback: 当前阶段的高层语义描述。
///   - progress_detail: 底层 provider 给出的等待进度细节。
///
/// Returns:
///
///   - String: 适合直接透传给前端的心跳文案。
fn build_llm_waiting_heartbeat_message(fallback: &str, progress_detail: &str) -> String {
    let detail = progress_detail.trim();
    if detail.is_empty() {
        return fallback.trim().to_string();
    }
    let fallback_text = fallback.trim();
    if fallback_text.contains(detail) {
        return fallback_text.to_string();
    }
    format!("{}（{}）", fallback_text, detail)
}

/// 描述：规范化“本轮任务描述”文本，兼容模型偶发返回 JSON/前后缀噪声。
fn normalize_round_description(raw: &str, turn_index: usize) -> String {
    let source = raw.trim();
    if source.is_empty() {
        return format!(
            "第 {} 轮开始：我会先梳理本轮可执行入口，再推进具体改动。",
            turn_index
        );
    }
    if let Ok(parsed) = serde_json::from_str::<Value>(source) {
        if let Some(text) = parsed
            .get("description")
            .or_else(|| parsed.get("text"))
            .and_then(|value| value.as_str())
        {
            let normalized = normalize_round_description_candidate(text, turn_index);
            if !normalized.is_empty() {
                return normalized;
            }
        }
    }
    if let Some(text) = source.lines().map(str::trim).find(|line| {
        !line.is_empty()
            && !line.starts_with('#')
            && !line.starts_with("STATUS:")
            && !line.starts_with("SUMMARY:")
            && !line.starts_with("NEXT:")
            && !line.starts_with("PLAN_")
    }) {
        let normalized = normalize_round_description_candidate(text, turn_index);
        if !normalized.is_empty() {
            return normalized;
        }
    }
    format!(
        "第 {} 轮开始：我会先梳理本轮可执行入口，再推进具体改动。",
        turn_index
    )
}

/// 描述：规范化“本轮任务描述”候选文本，过滤协议/代码噪声并兜底为口语化描述句。
fn normalize_round_description_candidate(raw: &str, turn_index: usize) -> String {
    let normalized = truncate_stream_text(raw, STREAM_TEXT_MAX_CHARS);
    let text = normalized.trim();
    if text.is_empty() {
        return String::new();
    }
    let lower = text.to_lowercase();
    if lower.starts_with("status:")
        || lower.starts_with("summary:")
        || lower.starts_with("next:")
        || lower.contains("finish(")
        || lower.starts_with("import ")
        || lower.starts_with("from ")
        || lower.starts_with("def ")
        || lower.starts_with("class ")
    {
        return format!(
            "第 {} 轮开始：我会先梳理本轮可执行入口，再推进具体改动。",
            turn_index
        );
    }
    let sentence_like = text.contains('，') || text.contains('。') || text.contains(',');
    if text.chars().count() < 16 || !sentence_like {
        return format!(
            "我会先围绕“{}”梳理本轮可执行项，先拿到必要上下文，再推进落地修改。",
            text.trim_matches(|ch| ch == '"' || ch == '\'' || ch == '#' || ch == ':')
        );
    }
    text.to_string()
}

/// 描述：解析智能体多轮上限配置，未配置时默认 6 轮。
fn resolve_agent_max_turns() -> usize {
    env::var("ZODILEAP_CODE_AGENT_MAX_TURNS")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .map(|value| value.min(12))
        .unwrap_or(6)
}

/// 描述：构建回合上下文摘要，供后续轮次提示词注入，避免模型丢失执行连续性。
fn build_turn_context(turn_records: &[AgentTurnRecord]) -> String {
    if turn_records.is_empty() {
        return "（首轮执行，无历史上下文）".to_string();
    }
    let start = turn_records.len().saturating_sub(6);
    turn_records[start..]
        .iter()
        .map(|item| {
            let actions = if item.actions.is_empty() {
                "无".to_string()
            } else {
                item.actions.join(", ")
            };
            let next = if item.next.trim().is_empty() {
                "无".to_string()
            } else {
                item.next.trim().to_string()
            };
            format!(
                "- 第 {} 轮：SUMMARY={}；NEXT={}；ACTIONS={}",
                item.turn_index,
                item.summary.trim(),
                next,
                actions
            )
        })
        .collect::<Vec<String>>()
        .join("\n")
}

/// 描述：将当前启用中的 MCP 注册项压缩为提示词上下文，避免把敏感命令、Header 或环境变量直接暴露给模型。
///
/// Params:
///
///   - available_mcps: 运行时可见的 MCP 注册项。
///
/// Returns:
///
///   - 适合直接拼接到提示词中的 MCP 摘要文本。
fn build_registered_mcp_context(available_mcps: &[AgentRegisteredMcp]) -> String {
    if available_mcps.is_empty() {
        return "（当前未启用外部 MCP 注册项；如需 DCC 建模能力，请先注册并启用对应的 DCC MCP）"
            .to_string();
    }

    available_mcps
        .iter()
        .map(|item| {
            let domain_text = if item.domain.trim().is_empty() {
                "general".to_string()
            } else {
                item.domain.trim().to_string()
            };
            let software_text = if item.software.trim().is_empty() {
                "n/a".to_string()
            } else {
                item.software.trim().to_string()
            };
            let capability_text = if item.capabilities.is_empty() {
                "[]".to_string()
            } else {
                format!("[{}]", item.capabilities.join(", "))
            };
            let runtime_text = if item.runtime_kind.trim().is_empty() {
                "generic".to_string()
            } else {
                item.runtime_kind.trim().to_string()
            };
            let provider_text = if item.official_provider.trim().is_empty() {
                "custom".to_string()
            } else {
                item.official_provider.trim().to_string()
            };
            let readiness_text = if item.runtime_ready {
                "ready".to_string()
            } else {
                format!(
                    "not-ready: {}",
                    item.runtime_hint
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("运行时未就绪")
                )
            };
            format!(
                "- id={}; name={}; domain={}; software={}; transport={}; runtime={}; provider={}; priority={}; import={}; export={}; capabilities={}; status={}",
                item.id,
                item.name,
                domain_text,
                software_text,
                item.transport,
                runtime_text,
                provider_text,
                item.priority,
                item.supports_import,
                item.supports_export,
                capability_text,
                readiness_text
            )
        })
        .collect::<Vec<String>>()
        .join("\n")
}

/// 描述：解析每轮执行结果中的控制信号（DONE/CONTINUE）与总结，供编排器判断是否继续下一轮。
fn parse_turn_result_envelope(
    raw_message: &str,
    actions: &[String],
    turn_index: usize,
    max_turns: usize,
) -> TurnResultEnvelope {
    let normalized = raw_message.trim();
    let status_line = normalized
        .lines()
        .find_map(|line| line.trim().strip_prefix("STATUS:").map(str::trim))
        .unwrap_or("");
    let summary_line = normalized
        .lines()
        .find_map(|line| line.trim().strip_prefix("SUMMARY:").map(str::trim))
        .unwrap_or("");
    let next_line = normalized
        .lines()
        .find_map(|line| line.trim().strip_prefix("NEXT:").map(str::trim))
        .unwrap_or("");
    let normalized_summary = if summary_line.is_empty() {
        normalized
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !trimmed.starts_with("STATUS:")
                    && !trimmed.starts_with("SUMMARY:")
                    && !trimmed.starts_with("NEXT:")
            })
            .collect::<Vec<&str>>()
            .join("\n")
            .trim()
            .to_string()
    } else {
        summary_line.to_string()
    };
    let summary = if normalized_summary.is_empty() {
        "本轮已执行，等待下一步".to_string()
    } else {
        normalized_summary
    };
    let summary = if summary.contains("系统自动补全 finish") {
        if actions.is_empty() {
            "本轮脚本由系统自动收尾，准备继续下一轮。".to_string()
        } else {
            format!(
                "本轮已执行 {} 个工具动作，脚本由系统自动收尾，准备继续下一轮。",
                actions.len()
            )
        }
    } else {
        summary
    };
    let next = next_line.to_string();
    let lower_message = normalized.to_lowercase();
    let has_continue_signal = status_line.eq_ignore_ascii_case("continue")
        || lower_message.contains("[continue]")
        || lower_message.contains("status: continue")
        || normalized.contains("下一步")
        || normalized.contains("继续")
        || normalized.contains("待完成")
        || normalized.contains("未完成");
    let has_done_signal = status_line.eq_ignore_ascii_case("done")
        || lower_message.contains("[done]")
        || lower_message.contains("status: done")
        || normalized.contains("全部完成")
        || normalized.contains("已完成全部");

    let mut control = if has_continue_signal {
        TurnControl::Continue
    } else if has_done_signal {
        TurnControl::Done
    } else if turn_index < max_turns {
        // 描述：未出现明确 DONE 信号时默认继续，避免“只写文档/只跑一轮”后提前结束。
        TurnControl::Continue
    } else {
        TurnControl::Done
    };
    if turn_index >= max_turns {
        control = TurnControl::Done;
    }

    TurnResultEnvelope {
        control,
        summary,
        next,
    }
}

/// 描述：从模型返回结果中提取 Python 脚本正文，兼容 fenced block 与前置自然语言。
fn extract_python_script(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(fenced) = extract_fenced_python_block(trimmed) {
        return fenced;
    }
    if let Some(plain_script) = extract_plain_python_from_mixed_text(trimmed) {
        return plain_script;
    }
    trimmed.to_string()
}

/// 描述：确保脚本包含 finish(...) 终止调用；若缺失则自动补全，避免执行结束后返回空结果。
///
/// Params:
///
///   - script: 提取后的 Python 脚本。
///
/// Returns:
///
///   - 补全 finish 后的脚本文本。
fn ensure_script_has_finish(script: &str) -> String {
    let normalized = script.trim();
    if normalized.is_empty() {
        return String::new();
    }
    if contains_finish_call(normalized) {
        return normalized.to_string();
    }
    format!(
        "{normalized}\n\n# 描述：模型未显式调用 finish(...) 时由系统自动补全，避免返回空结果。\nfinish(\"执行完成（系统自动补全 finish）\")"
    )
}

/// 描述：仅保留脚本中首个“顶层 finish(...)”之前的内容，避免单轮脚本串联多轮任务。
///
/// Params:
///
///   - script: 已补全 finish 的脚本文本。
///
/// Returns:
///
///   - 截断后的单轮脚本。
fn truncate_script_after_first_top_level_finish(script: &str) -> String {
    let normalized = script.trim();
    if normalized.is_empty() {
        return String::new();
    }
    let mut retained: Vec<String> = Vec::new();
    let mut found_finish_start = false;
    let mut finish_call_state: Option<FinishCallParseState> = None;

    for line in normalized.lines() {
        retained.push(line.to_string());

        if let Some(state) = finish_call_state.as_mut() {
            update_finish_call_parse_state(line, state);
            if is_finish_call_parse_completed(state) {
                break;
            }
            continue;
        }

        if is_top_level_finish_call_start(line) {
            found_finish_start = true;
            let mut state = FinishCallParseState::default();
            update_finish_call_parse_state(line, &mut state);
            if is_finish_call_parse_completed(&state) {
                break;
            }
            finish_call_state = Some(state);
        }
    }

    if !found_finish_start {
        return normalized.to_string();
    }
    retained.join("\n").trim().to_string()
}

#[derive(Debug, Clone, Copy, Default)]
struct FinishCallParseState {
    paren_balance: usize,
    in_single_quote: bool,
    in_double_quote: bool,
    in_triple_single_quote: bool,
    in_triple_double_quote: bool,
    escaped: bool,
}

/// 描述：判断一行是否是顶层 finish(...) 调用起始行。
fn is_top_level_finish_call_start(line: &str) -> bool {
    let trimmed = line.trim_start();
    let indent_chars = line.len().saturating_sub(trimmed.len());
    !trimmed.starts_with('#') && indent_chars == 0 && trimmed.starts_with("finish(")
}

/// 描述：更新 finish(...) 解析状态，支持跨行三引号字符串与括号平衡计数。
fn update_finish_call_parse_state(line: &str, state: &mut FinishCallParseState) {
    let bytes = line.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        let current = bytes[index] as char;

        if state.in_triple_single_quote {
            if starts_with_bytes(bytes, index, b"'''") {
                state.in_triple_single_quote = false;
                index += 3;
                continue;
            }
            index += 1;
            continue;
        }
        if state.in_triple_double_quote {
            if starts_with_bytes(bytes, index, b"\"\"\"") {
                state.in_triple_double_quote = false;
                index += 3;
                continue;
            }
            index += 1;
            continue;
        }
        if state.in_single_quote {
            if state.escaped {
                state.escaped = false;
                index += 1;
                continue;
            }
            if current == '\\' {
                state.escaped = true;
                index += 1;
                continue;
            }
            if current == '\'' {
                state.in_single_quote = false;
            }
            index += 1;
            continue;
        }
        if state.in_double_quote {
            if state.escaped {
                state.escaped = false;
                index += 1;
                continue;
            }
            if current == '\\' {
                state.escaped = true;
                index += 1;
                continue;
            }
            if current == '"' {
                state.in_double_quote = false;
            }
            index += 1;
            continue;
        }
        if current == '#' {
            break;
        }
        if starts_with_bytes(bytes, index, b"'''") {
            state.in_triple_single_quote = true;
            index += 3;
            continue;
        }
        if starts_with_bytes(bytes, index, b"\"\"\"") {
            state.in_triple_double_quote = true;
            index += 3;
            continue;
        }
        if current == '\'' {
            state.in_single_quote = true;
            index += 1;
            continue;
        }
        if current == '"' {
            state.in_double_quote = true;
            index += 1;
            continue;
        }
        if current == '(' {
            state.paren_balance = state.paren_balance.saturating_add(1);
            index += 1;
            continue;
        }
        if current == ')' {
            state.paren_balance = state.paren_balance.saturating_sub(1);
            index += 1;
            continue;
        }
        index += 1;
    }
}

/// 描述：判断 finish(...) 是否已完整闭合（括号归零且未处于字符串上下文）。
fn is_finish_call_parse_completed(state: &FinishCallParseState) -> bool {
    state.paren_balance == 0
        && !state.in_single_quote
        && !state.in_double_quote
        && !state.in_triple_single_quote
        && !state.in_triple_double_quote
}

/// 描述：按索引判断字节切片是否匹配目标字面量。
fn starts_with_bytes(source: &[u8], index: usize, target: &[u8]) -> bool {
    let end = index.saturating_add(target.len());
    end <= source.len() && &source[index..end] == target
}

/// 描述：判断脚本是否显式调用了顶层 finish(...)，用于执行前的兼容补全。
///
/// 说明：
///
///   - 仅识别“顶层语句”的 finish 调用，避免把 `def main(): finish(...)` 这类未执行分支误判为已完成。
fn contains_finish_call(script: &str) -> bool {
    script
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .any(|line| {
            let trimmed = line.trim_start();
            let indent_chars = line.len().saturating_sub(trimmed.len());
            indent_chars == 0 && trimmed.starts_with("finish(")
        })
}

/// 描述：修复模型脚本中“需要代码块但缺少可执行语句”的常见缩进错误，避免直接触发 IndentationError。
///
/// Params:
///
///   - script: 提取后的 Python 脚本。
///
/// Returns:
///
///   - 修复后的脚本；若未命中问题则返回原脚本。
fn repair_missing_python_block_body(script: &str) -> String {
    let normalized = script.trim();
    if normalized.is_empty() {
        return String::new();
    }
    let mut lines: Vec<String> = normalized.lines().map(ToOwned::to_owned).collect();
    let mut cursor = 0usize;
    let mut updated = false;
    while cursor < lines.len() {
        let header_line = lines[cursor].clone();
        if !is_python_block_header_line(&header_line) {
            cursor += 1;
            continue;
        }
        let header_indent = leading_indent_width(&header_line);
        let mut probe = cursor + 1;
        let mut has_executable_line = false;
        while probe < lines.len() {
            let next_line = lines[probe].clone();
            let trimmed = next_line.trim();
            if trimmed.is_empty() {
                probe += 1;
                continue;
            }
            let next_indent = leading_indent_width(&next_line);
            if next_indent <= header_indent {
                break;
            }
            if !trimmed.starts_with('#') {
                has_executable_line = true;
                break;
            }
            probe += 1;
        }
        if has_executable_line {
            cursor += 1;
            continue;
        }
        let indent_prefix = leading_indent_prefix(&header_line);
        let block_indent = if indent_prefix.contains('\t') && !indent_prefix.contains(' ') {
            format!("{indent_prefix}\t")
        } else {
            format!("{indent_prefix}    ")
        };
        lines.insert(
            cursor + 1,
            format!("{block_indent}pass  # 描述：系统自动补全空代码块，避免 IndentationError。"),
        );
        updated = true;
        cursor += 2;
    }
    if updated {
        lines.join("\n")
    } else {
        normalized.to_string()
    }
}

/// 描述：修复未闭合的 Python 字符串字面量，优先处理三引号字符串导致的 SyntaxError。
///
/// Params:
///
///   - script: 提取后的 Python 脚本。
///
/// Returns:
///
///   - 尝试补齐后的脚本；若未发现未闭合字符串则返回原脚本。
fn repair_unterminated_python_string_literals(script: &str) -> String {
    let normalized = script.trim();
    if normalized.is_empty() {
        return String::new();
    }
    let mut lines: Vec<String> = normalized.lines().map(ToOwned::to_owned).collect();
    let mut parser_state = PythonStringParseState::default();
    let mut cursor = 0usize;
    let mut updated = false;

    while cursor < lines.len() {
        let current_line = lines[cursor].clone();
        let current_trimmed = current_line.trim_start();
        let indent_chars = current_line.len().saturating_sub(current_trimmed.len());
        // 描述：
        //
        //   - 若当前仍处于三引号字符串上下文，且下一行出现顶层 finish(...)，
        //     说明大概率是“字符串忘记闭合导致 finish 被吞进字符串”。
        //   - 在 finish 前补一行闭合引号，尽可能恢复脚本可执行性并保留原有 finish 语义。
        if indent_chars == 0
            && current_trimmed.starts_with("finish(")
            && (parser_state.in_triple_single_quote || parser_state.in_triple_double_quote)
        {
            if parser_state.in_triple_single_quote {
                lines.insert(cursor, "'''".to_string());
                parser_state.in_triple_single_quote = false;
                updated = true;
                cursor = cursor.saturating_add(1);
                continue;
            }
            if parser_state.in_triple_double_quote {
                lines.insert(cursor, "\"\"\"".to_string());
                parser_state.in_triple_double_quote = false;
                updated = true;
                cursor = cursor.saturating_add(1);
                continue;
            }
        }
        update_python_string_parse_state(&current_line, &mut parser_state);
        cursor = cursor.saturating_add(1);
    }

    if parser_state.in_triple_single_quote {
        lines.push("'''".to_string());
        parser_state.in_triple_single_quote = false;
        updated = true;
    }
    if parser_state.in_triple_double_quote {
        lines.push("\"\"\"".to_string());
        parser_state.in_triple_double_quote = false;
        updated = true;
    }
    if parser_state.in_single_quote {
        lines.push("'".to_string());
        parser_state.in_single_quote = false;
        updated = true;
    }
    if parser_state.in_double_quote {
        lines.push("\"".to_string());
        parser_state.in_double_quote = false;
        updated = true;
    }

    if updated {
        lines.join("\n")
    } else {
        normalized.to_string()
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct PythonStringParseState {
    in_single_quote: bool,
    in_double_quote: bool,
    in_triple_single_quote: bool,
    in_triple_double_quote: bool,
    escaped: bool,
}

/// 描述：按行更新 Python 字符串解析状态，支持单双引号、三引号与注释截断。
fn update_python_string_parse_state(line: &str, state: &mut PythonStringParseState) {
    let bytes = line.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        let current = bytes[index] as char;
        if state.in_triple_single_quote {
            if starts_with_bytes(bytes, index, b"'''") {
                state.in_triple_single_quote = false;
                index = index.saturating_add(3);
                continue;
            }
            index = index.saturating_add(1);
            continue;
        }
        if state.in_triple_double_quote {
            if starts_with_bytes(bytes, index, b"\"\"\"") {
                state.in_triple_double_quote = false;
                index = index.saturating_add(3);
                continue;
            }
            index = index.saturating_add(1);
            continue;
        }
        if state.in_single_quote {
            if state.escaped {
                state.escaped = false;
                index = index.saturating_add(1);
                continue;
            }
            if current == '\\' {
                state.escaped = true;
                index = index.saturating_add(1);
                continue;
            }
            if current == '\'' {
                state.in_single_quote = false;
            }
            index = index.saturating_add(1);
            continue;
        }
        if state.in_double_quote {
            if state.escaped {
                state.escaped = false;
                index = index.saturating_add(1);
                continue;
            }
            if current == '\\' {
                state.escaped = true;
                index = index.saturating_add(1);
                continue;
            }
            if current == '"' {
                state.in_double_quote = false;
            }
            index = index.saturating_add(1);
            continue;
        }
        if current == '#' {
            break;
        }
        if starts_with_bytes(bytes, index, b"'''") {
            state.in_triple_single_quote = true;
            index = index.saturating_add(3);
            continue;
        }
        if starts_with_bytes(bytes, index, b"\"\"\"") {
            state.in_triple_double_quote = true;
            index = index.saturating_add(3);
            continue;
        }
        if current == '\'' {
            state.in_single_quote = true;
            index = index.saturating_add(1);
            continue;
        }
        if current == '"' {
            state.in_double_quote = true;
            index = index.saturating_add(1);
            continue;
        }
        index = index.saturating_add(1);
    }
}

/// 描述：判断一行是否属于 Python 代码块头（以冒号结尾且命中控制/定义关键字）。
fn is_python_block_header_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || !trimmed.ends_with(':') {
        return false;
    }
    trimmed.starts_with("def ")
        || trimmed.starts_with("class ")
        || trimmed.starts_with("if ")
        || trimmed.starts_with("elif ")
        || trimmed.starts_with("else:")
        || trimmed.starts_with("for ")
        || trimmed.starts_with("while ")
        || trimmed.starts_with("try:")
        || trimmed.starts_with("except ")
        || trimmed.starts_with("except:")
        || trimmed.starts_with("finally:")
        || trimmed.starts_with("with ")
        || trimmed.starts_with("match ")
        || trimmed.starts_with("case ")
        || trimmed.starts_with("async def ")
        || trimmed.starts_with("async for ")
        || trimmed.starts_with("async with ")
}

/// 描述：读取行首缩进宽度，统一把 Tab 视作 4 空格以便进行缩进层级比较。
fn leading_indent_width(line: &str) -> usize {
    let mut width = 0usize;
    for ch in line.chars() {
        match ch {
            ' ' => width += 1,
            '\t' => width += 4,
            _ => break,
        }
    }
    width
}

/// 描述：提取行首缩进前缀，供自动注入 `pass` 时复用原有缩进风格。
fn leading_indent_prefix(line: &str) -> String {
    line.chars()
        .take_while(|ch| *ch == ' ' || *ch == '\t')
        .collect::<String>()
}

/// 描述：提取 Markdown fenced code block 中的 Python 脚本。
///
/// Params:
///
///   - raw: 模型原始文本。
///
/// Returns:
///
///   - 代码块正文；若未命中 fenced block 返回 None。
fn extract_fenced_python_block(raw: &str) -> Option<String> {
    let mut blocks: Vec<(String, String)> = Vec::new();
    let mut in_block = false;
    let mut language = String::new();
    let mut body: Vec<String> = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            if in_block {
                let normalized_body = body.join("\n").trim().to_string();
                if !normalized_body.is_empty() {
                    blocks.push((language.clone(), normalized_body));
                }
                in_block = false;
                language.clear();
                body.clear();
                continue;
            }
            in_block = true;
            language = trimmed.trim_start_matches("```").trim().to_lowercase();
            body.clear();
            continue;
        }
        if in_block {
            body.push(line.to_string());
        }
    }

    if in_block {
        let normalized_body = body.join("\n").trim().to_string();
        if !normalized_body.is_empty() {
            blocks.push((language, normalized_body));
        }
    }

    // 描述：优先提取 language 明确为 python/py 的代码块，避免误拿到 text/json 等说明块。
    if let Some((_, python_block)) = blocks.iter().find(|(lang, _)| {
        let normalized = lang.trim();
        normalized == "python" || normalized == "py"
    }) {
        return Some(python_block.clone());
    }

    // 描述：若无 python 标识，则回退到“内容看起来像 Python”的 fenced block。
    blocks
        .into_iter()
        .find(|(_, body_text)| {
            body_text
                .lines()
                .map(str::trim)
                .any(is_probable_python_entry_line)
        })
        .map(|(_, body_text)| body_text)
}

/// 描述：从“前置说明 + 代码”的混合文本中提取可执行 Python 片段。
///
/// Params:
///
///   - raw: 模型原始文本。
///
/// Returns:
///
///   - 推断出的 Python 脚本；若未识别出可信代码起点返回 None。
fn extract_plain_python_from_mixed_text(raw: &str) -> Option<String> {
    let lines: Vec<&str> = raw.lines().collect();
    let entry_index = lines
        .iter()
        .position(|line| is_probable_python_entry_line(line.trim()))?;
    let mut start = entry_index;
    while start > 0 {
        let previous = lines[start - 1].trim();
        if previous.is_empty() || previous.starts_with('#') {
            start -= 1;
            continue;
        }
        break;
    }
    let candidate = lines[start..].join("\n").trim().to_string();
    if candidate.is_empty() {
        return None;
    }
    Some(candidate)
}

/// 描述：判断一行文本是否可能是 Python 脚本入口行。
///
/// Params:
///
///   - line: 经过 trim 的单行文本。
///
/// Returns:
///
///   - true 表示该行可以作为 Python 代码起点。
fn is_probable_python_entry_line(line: &str) -> bool {
    if line.is_empty() {
        return false;
    }
    if line.starts_with("import ")
        || line.starts_with("from ")
        || line.starts_with("def ")
        || line.starts_with("class ")
        || line.starts_with("if ")
        || line.starts_with("for ")
        || line.starts_with("while ")
        || line.starts_with("try:")
        || line.starts_with("with ")
        || line.starts_with('@')
        || line.starts_with('#')
        || line.starts_with("\"\"\"")
        || line.starts_with("'''")
    {
        return true;
    }
    is_probable_python_assignment(line)
}

/// 描述：基于赋值结构粗略判断一行是否像 Python 代码。
///
/// Params:
///
///   - line: 经过 trim 的单行文本。
///
/// Returns:
///
///   - true 表示命中赋值语句特征。
fn is_probable_python_assignment(line: &str) -> bool {
    let Some(eq_index) = line.find('=') else {
        return false;
    };
    if line.contains("==") || line.contains(">=") || line.contains("<=") || line.contains("!=") {
        return false;
    }
    let left = line[..eq_index].trim();
    if left.is_empty() {
        return false;
    }
    left.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '_' | ' ' | ',' | '.' | '[' | ']' | '(' | ')')
    })
}

/// 描述：对外发流式事件前构建工具参数预览，避免把超长正文（如 write_text content）直接推送到前端。
///
/// Params:
///
///   - args: 工具参数 JSON。
///   - max_chars: 输出最大字符数。
///
/// Returns:
///
///   - 适合执行流展示的参数预览字符串。
fn build_tool_args_stream_preview(args: &Value, max_chars: usize) -> String {
    let Some(object) = args.as_object() else {
        return truncate_stream_text(&args.to_string(), max_chars);
    };
    let mut preview = serde_json::Map::new();
    for key in ["path", "command", "pattern", "query", "url", "glob", "name"] {
        let Some(value) = object.get(key) else {
            continue;
        };
        let rendered = if let Some(text) = value.as_str() {
            Value::String(truncate_stream_text(
                text,
                TOOL_ARGS_CONTENT_PREVIEW_MAX_CHARS,
            ))
        } else {
            value.clone()
        };
        preview.insert(key.to_string(), rendered);
    }
    if let Some(content) = object.get("content").and_then(|value| value.as_str()) {
        preview.insert(
            "content_preview".to_string(),
            Value::String(truncate_stream_text(
                content,
                TOOL_ARGS_CONTENT_PREVIEW_MAX_CHARS,
            )),
        );
        preview.insert("content_length".to_string(), json!(content.chars().count()));
    }
    if let Some(data) = object.get("data") {
        let data_summary = if data.is_object() {
            "object"
        } else if data.is_array() {
            "array"
        } else {
            "scalar"
        };
        preview.insert(
            "data_type".to_string(),
            Value::String(data_summary.to_string()),
        );
    }
    if preview.is_empty() {
        preview.insert(
            "keys".to_string(),
            Value::Array(
                object
                    .keys()
                    .take(10)
                    .map(|key| Value::String(key.clone()))
                    .collect::<Vec<Value>>(),
            ),
        );
    }
    truncate_stream_text(&Value::Object(preview).to_string(), max_chars)
}

/// 描述：按字符数裁剪文本，避免超长事件数据导致前端阻塞。
fn truncate_stream_text(value: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let count = value.chars().count();
    if count <= max_chars {
        return value.to_string();
    }
    let mut text = value.chars().take(max_chars).collect::<String>();
    text.push('…');
    text
}

/// 描述：构建工具调用的结构化参数数据，供前端执行流按“浏览/编辑/终端”分类渲染。
fn build_tool_args_stream_data(tool_name: &str, args: &Value) -> Value {
    let mut payload = serde_json::Map::new();
    payload.insert("tool".to_string(), Value::String(tool_name.to_string()));
    if let Some(object) = args.as_object() {
        for key in ["path", "command", "pattern", "query", "glob", "url"] {
            if let Some(value) = object.get(key).and_then(|item| item.as_str()) {
                payload.insert(
                    key.to_string(),
                    Value::String(truncate_stream_text(value, STREAM_TEXT_MAX_CHARS)),
                );
            }
        }
        if let Some(content) = object.get("content").and_then(|item| item.as_str()) {
            payload.insert("content_length".to_string(), json!(content.chars().count()));
        }
        if let Some(patch_text) = object.get("patch").and_then(|item| item.as_str()) {
            let patch_preview = patch_text
                .lines()
                .take(160)
                .collect::<Vec<&str>>()
                .join("\n");
            payload.insert(
                "patch_preview".to_string(),
                Value::String(truncate_stream_text(
                    patch_preview.as_str(),
                    STREAM_TEXT_MAX_CHARS,
                )),
            );
            payload.insert(
                "patch_files".to_string(),
                json!(crate::tools::patch::collect_patch_paths(patch_text)),
            );
        }
    }
    Value::Object(payload)
}

/// 描述：构建工具执行结果的结构化数据，避免前端只能消费“固定摘要文案”。
fn build_tool_result_stream_data(
    tool_name: &str,
    ok: bool,
    result_data: &Value,
    tool_args: &Value,
    error_detail: Option<&ProtocolError>,
) -> Value {
    if !ok {
        return json!({
            "ok": false,
            "error": error_detail.map(|item| item.message.clone()).unwrap_or_default(),
            "code": error_detail.map(|item| item.code.clone()).unwrap_or_default(),
        });
    }
    match tool_name {
        "run_shell" => json!({
            "ok": true,
            "status": result_data.get("status").cloned().unwrap_or(Value::Null),
            "timed_out": result_data.get("timed_out").and_then(|item| item.as_bool()).unwrap_or(false),
            "timeout_secs": result_data.get("timeout_secs").and_then(|item| item.as_u64()).unwrap_or(0),
            "elapsed_ms": result_data.get("elapsed_ms").and_then(|item| item.as_u64()).unwrap_or(0),
            "commands": result_data.get("commands").cloned().unwrap_or_else(|| json!([])),
            "stdout": truncate_stream_text(
                result_data.get("stdout").and_then(|item| item.as_str()).unwrap_or(""),
                STREAM_TEXT_MAX_CHARS,
            ),
            "stderr": truncate_stream_text(
                result_data.get("stderr").and_then(|item| item.as_str()).unwrap_or(""),
                STREAM_TEXT_MAX_CHARS,
            ),
            "command": tool_args.get("command").and_then(|item| item.as_str()).unwrap_or(""),
        }),
        "write_text" | "write_json" => {
            let content_preview = if tool_name == "write_json" {
                tool_args
                    .get("data")
                    .map(|value| {
                        truncate_stream_text(value.to_string().as_str(), STREAM_TEXT_MAX_CHARS * 4)
                    })
                    .unwrap_or_default()
            } else {
                tool_args
                    .get("content")
                    .and_then(|item| item.as_str())
                    .map(|value| truncate_stream_text(value, STREAM_TEXT_MAX_CHARS * 4))
                    .unwrap_or_default()
            };
            json!({
                "ok": true,
                "path": result_data.get("path").and_then(|item| item.as_str()).unwrap_or(""),
                "bytes": result_data.get("bytes").and_then(|item| item.as_u64()).unwrap_or(0),
                "added_lines": result_data.get("added_lines").and_then(|item| item.as_u64()).unwrap_or(0),
                "removed_lines": result_data.get("removed_lines").and_then(|item| item.as_u64()).unwrap_or(0),
                "content_preview": content_preview,
                "diff_preview": truncate_stream_text(
                    result_data.get("diff_preview").and_then(|item| item.as_str()).unwrap_or(""),
                    STREAM_TEXT_MAX_CHARS * 4,
                ),
            })
        }
        "apply_patch" => {
            let patch_preview = tool_args
                .get("patch")
                .and_then(|item| item.as_str())
                .map(|item| item.lines().take(200).collect::<Vec<&str>>().join("\n"))
                .unwrap_or_default();
            let (added_lines, removed_lines) =
                patch_preview
                    .lines()
                    .fold((0u64, 0u64), |(add, remove), line| {
                        if line.starts_with("+++ ") || line.starts_with("--- ") {
                            return (add, remove);
                        }
                        if line.starts_with('+') {
                            return (add.saturating_add(1), remove);
                        }
                        if line.starts_with('-') {
                            return (add, remove.saturating_add(1));
                        }
                        (add, remove)
                    });
            json!({
                "ok": true,
                "files": result_data.get("files").cloned().unwrap_or_else(|| json!([])),
                "patch_bytes": result_data.get("patch_bytes").and_then(|item| item.as_u64()).unwrap_or(0),
                "added_lines": added_lines,
                "removed_lines": removed_lines,
                "diff_preview": truncate_stream_text(patch_preview.as_str(), STREAM_TEXT_MAX_CHARS * 4),
            })
        }
        "read_text" | "read_json" => json!({
            "ok": true,
            "path": result_data.get("path").and_then(|item| item.as_str()).unwrap_or(""),
        }),
        "search_files" => json!({
            "ok": true,
            "query": result_data.get("query").and_then(|item| item.as_str()).unwrap_or(""),
            "glob": result_data.get("glob").and_then(|item| item.as_str()).unwrap_or(""),
            "count": result_data.get("count").and_then(|item| item.as_u64()).unwrap_or(0),
            "matches": result_data
                .get("matches")
                .and_then(|item| item.as_array())
                .map(|items| items.iter().take(24).cloned().collect::<Vec<Value>>())
                .unwrap_or_default(),
        }),
        "list_dir" => json!({
            "ok": true,
            "path": result_data.get("path").and_then(|item| item.as_str()).unwrap_or(""),
            "count": result_data
                .get("entries")
                .and_then(|item| item.as_array())
                .map(|items| items.len())
                .unwrap_or(0),
            "entries": result_data
                .get("entries")
                .and_then(|item| item.as_array())
                .map(|items| items.iter().take(60).cloned().collect::<Vec<Value>>())
                .unwrap_or_default(),
        }),
        "glob" => json!({
            "ok": true,
            "pattern": result_data.get("pattern").and_then(|item| item.as_str()).unwrap_or(""),
            "count": result_data.get("count").and_then(|item| item.as_u64()).unwrap_or(0),
            "matches": result_data
                .get("matches")
                .and_then(|item| item.as_array())
                .map(|items| items.iter().take(60).cloned().collect::<Vec<Value>>())
                .unwrap_or_default(),
        }),
        "todo_read" => json!({
            "ok": true,
            "path": result_data.get("path").and_then(|item| item.as_str()).unwrap_or(""),
            "count": result_data.get("count").and_then(|item| item.as_u64()).unwrap_or(0),
            "items": result_data
                .get("items")
                .and_then(|item| item.as_array())
                .map(|items| items.iter().take(40).cloned().collect::<Vec<Value>>())
                .unwrap_or_default(),
        }),
        "todo_write" => json!({
            "ok": true,
            "path": result_data.get("path").and_then(|item| item.as_str()).unwrap_or(""),
            "count": result_data.get("count").and_then(|item| item.as_u64()).unwrap_or(0),
            "success": result_data.get("success").and_then(|item| item.as_bool()).unwrap_or(true),
        }),
        _ => json!({
            "ok": true,
            "raw": truncate_stream_text(result_data.to_string().as_str(), STREAM_TEXT_MAX_CHARS),
        }),
    }
}

/// 描述：解析 finish(...) 的最终结果载荷，兼容历史纯文本格式与当前 JSON 包装格式。
///
/// Params:
///
///   - raw: 去掉 `FINAL_RESULT_PREFIX` 后的原始字符串。
///
/// Returns:
///
///   - 归一化后的结果文本。
fn parse_final_result_message(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        if let Some(message) = value.get("message").and_then(|item| item.as_str()) {
            return message.trim().to_string();
        }
    }
    trimmed.to_string()
}

/// 描述：从脚本标准输出中提炼兜底结果文案，兼容脚本未显式调用 finish 的场景。
///
/// Params:
///
///   - lines: 沙盒脚本输出行。
///
/// Returns:
///
///   - 可用于回传前端的最终结果文案。
fn synthesize_final_message_from_stdout(lines: &[String]) -> String {
    let normalized: Vec<String> = lines
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if normalized.is_empty() {
        return String::new();
    }
    let tail_lines: Vec<&str> = normalized
        .iter()
        .rev()
        .take(3)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let tail_summary = tail_lines.join("\n");
    let max_chars = 1000;
    if tail_summary.chars().count() > max_chars {
        let truncated = tail_summary.chars().take(max_chars).collect::<String>();
        return format!("脚本执行完成（自动补全结果）：\n{}…", truncated);
    }
    format!("脚本执行完成（自动补全结果）：\n{}", tail_summary)
}

/// 描述：当脚本未产生 stdout / finish / 工具调用时，基于脚本源码生成兜底结果，避免直接报 empty_result。
///
/// Params:
///
///   - script: 已发送到沙盒执行的脚本文本。
///
/// Returns:
///
///   - 兜底结果文案；若脚本无有效内容则返回空字符串。
fn synthesize_final_message_from_script(script: &str) -> String {
    let normalized = script.trim();
    if normalized.is_empty() {
        return String::new();
    }
    let preview_lines: Vec<String> = normalized
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .take(3)
        .map(ToOwned::to_owned)
        .collect();
    if preview_lines.is_empty() {
        return "脚本执行完成（未产生可见输出，系统自动收尾）。".to_string();
    }
    format!(
        "脚本执行完成（未产生可见输出，系统自动收尾）：\n{}",
        preview_lines.join("\n")
    )
}

pub(crate) fn execute_python_script<F>(
    request: PythonScriptExecutionRequest<'_>,
    on_stream_event: &mut F,
) -> Result<PythonScriptExecutionResult, ProtocolError>
where
    F: FnMut(AgentStreamEvent) + ?Sized,
{
    let PythonScriptExecutionRequest {
        user_script,
        workdir,
        dcc_provider_addr,
        available_mcps,
        policy,
        trace_id,
        session_id,
    } = request;
    let span = info_span!("python_sandbox_execute", trace_id = %trace_id, session_id = %session_id);
    let _enter = span.enter();

    let python_bin = resolve_python_binary()?;
    let sandbox_root = resolve_sandbox_root(workdir)?;

    // 从持久化注册表中获取或创建沙盒
    let sandbox_ref =
        crate::sandbox::SANDBOX_REGISTRY.get_or_create(&session_id, &sandbox_root, &python_bin)?;
    let mut sandbox = sandbox_ref
        .lock()
        .map_err(|_| ProtocolError::new("sandbox.lock_failed", "sandbox 锁获取失败"))?;
    sandbox.last_active_at = Instant::now();

    // 为了兼容性，我们通过 BATCH_SIZE 协议发送用户脚本。
    // 在持久化模式下，我们不再需要 FS::write 写入临时文件，直接内存注入。
    let payload = build_batch_payload(user_script);
    sandbox
        .stdin
        .write_all(payload.as_bytes())
        .map_err(|err| ProtocolError::new("sandbox.write_failed", err.to_string()))?;
    sandbox.stdin.flush().ok();

    let mut final_message = String::new();
    let mut actions = Vec::new();
    let mut events = Vec::new();
    let assets = Vec::new();
    let mut plain_stdout_lines: Vec<String> = Vec::new();
    let mut last_event_at = Instant::now();
    let execution_started_at = Instant::now();
    let registry = build_default_tool_registry(dcc_provider_addr, available_mcps);

    loop {
        let now = Instant::now();
        if now.duration_since(last_event_at) > Duration::from_secs(5) {
            on_stream_event(AgentStreamEvent::Heartbeat {
                message: format!(
                    "等待工具返回本步结果…（已耗时 {}s，已调用工具 {} 次）",
                    execution_started_at.elapsed().as_secs(),
                    actions.len()
                ),
            });
            last_event_at = now;
        }

        // 监听沙盒输出
        match sandbox.receiver.recv_timeout(Duration::from_millis(40)) {
            Ok(crate::sandbox::SandboxOutput::Stdout(line)) => {
                last_event_at = Instant::now();

                if line == TURN_END_MARKER {
                    break;
                }

                if let Some(payload) = line.strip_prefix(TOOL_CALL_PREFIX) {
                    let parsed: Value = serde_json::from_str(payload).map_err(|err| {
                        ProtocolError::new(
                            "core.agent.python.tool_payload_invalid",
                            format!("工具调用载荷解析失败: {}", err),
                        )
                    })?;

                    let tool_name = parsed
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let tool_args = parsed.get("args").cloned().unwrap_or_else(|| json!({}));
                    let tool_args_preview = build_tool_args_stream_preview(
                        &tool_args,
                        TOOL_ARGS_STREAM_PREVIEW_MAX_CHARS,
                    );
                    let tool_args_data = build_tool_args_stream_data(&tool_name, &tool_args);

                    on_stream_event(AgentStreamEvent::ToolCallStarted {
                        name: tool_name.clone(),
                        args: tool_args_preview.clone(),
                        args_data: tool_args_data,
                    });
                    events.push(ProtocolEventRecord {
                        event: "tool_call_started".to_string(),
                        step_index: None,
                        timestamp_ms: now_millis(),
                        message: format!("tool={} started", tool_name),
                    });

                    // 高危拦截逻辑 (Human-in-the-loop)
                    if let Some(tool) = registry.get(&tool_name) {
                        if tool.risk_level() == crate::tools::RiskLevel::High {
                            let approval_id = format!("appr-{}", now_millis());
                            on_stream_event(AgentStreamEvent::RequireApproval {
                                approval_id: approval_id.clone(),
                                tool_name: tool_name.clone(),
                                tool_args: tool_args_preview,
                            });
                            events.push(ProtocolEventRecord {
                                event: "approval_requested".to_string(),
                                step_index: None,
                                timestamp_ms: now_millis(),
                                message: format!(
                                    "tool={} approval_requested id={}",
                                    tool_name, approval_id
                                ),
                            });

                            let signal = crate::APPROVAL_REGISTRY.create_request(&approval_id);
                            let outcome = loop {
                                let decision = match signal.lock() {
                                    Ok(guard) => *guard,
                                    Err(poisoned) => *poisoned.into_inner(),
                                };
                                if let Some(o) = decision {
                                    break o;
                                }
                                thread::sleep(Duration::from_millis(200));
                            };

                            if matches!(outcome, crate::ApprovalOutcome::Rejected) {
                                let (event_name, reject_message, reject_code) =
                                    resolve_approval_reject_payload();
                                events.push(ProtocolEventRecord {
                                    event: event_name.to_string(),
                                    step_index: None,
                                    timestamp_ms: now_millis(),
                                    message: format!("tool={} {}", tool_name, event_name),
                                });
                                let result_line = json!({"ok": false, "error": reject_message, "code": reject_code});
                                sandbox.write_tool_result(&result_line)?;
                                continue;
                            }
                            events.push(ProtocolEventRecord {
                                event: "approval_approved".to_string(),
                                step_index: None,
                                timestamp_ms: now_millis(),
                                message: format!("tool={} approval_approved", tool_name),
                            });
                        }
                    }

                    let context = crate::tools::ToolContext {
                        trace_id: trace_id.clone(),
                        sandbox_root: &sandbox_root,
                        policy,
                    };

                    let tool_response = if tool_name == "tool_search" {
                        tool_tool_search(&tool_args)
                    } else if let Some(tool) = registry.get(&tool_name) {
                        tool.execute(&tool_args, context)
                    } else {
                        Err(ProtocolError::new(
                            "core.agent.python.tool_unsupported",
                            format!("不支持的工具: {}", tool_name),
                        ))
                    };

                    let (ok, result_data, error_detail) = match &tool_response {
                        Ok(data) => (true, data.clone(), None),
                        Err(err) => (false, json!(null), Some(err.clone())),
                    };

                    let failure_summary_payload = json!(error_detail
                        .as_ref()
                        .map(|e| e.message.clone())
                        .unwrap_or_default());
                    let summary_source = if ok {
                        &result_data
                    } else {
                        &failure_summary_payload
                    };
                    let stream_result_data = build_tool_result_stream_data(
                        &tool_name,
                        ok,
                        &result_data,
                        &tool_args,
                        error_detail.as_ref(),
                    );

                    on_stream_event(AgentStreamEvent::ToolCallFinished {
                        name: tool_name.clone(),
                        ok,
                        result: summarize_tool_result(&tool_name, ok, summary_source),
                        result_data: stream_result_data,
                    });
                    events.push(ProtocolEventRecord {
                        event: if ok {
                            "tool_call_finished"
                        } else {
                            "tool_call_failed"
                        }
                        .to_string(),
                        step_index: None,
                        timestamp_ms: now_millis(),
                        message: format!("tool={} ok={}", tool_name, ok),
                    });

                    let response_val = if ok {
                        json!({"ok": true, "data": result_data})
                    } else {
                        let e = error_detail.unwrap_or_else(|| {
                            ProtocolError::new(
                                "core.agent.python.tool_unknown_error",
                                "工具执行失败，未返回错误详情",
                            )
                        });
                        json!({"ok": false, "error": e.message, "code": e.code})
                    };

                    sandbox.write_tool_result(&response_val)?;
                    actions.push(tool_name);
                    continue;
                }

                if let Some(msg) = line.strip_prefix(FINAL_RESULT_PREFIX) {
                    let incoming = parse_final_result_message(msg);
                    let current = final_message.trim();
                    let incoming_is_auto = incoming.contains("系统自动补全 finish");
                    let current_is_auto = current.contains("系统自动补全 finish");
                    if current.is_empty() || (current_is_auto && !incoming_is_auto) {
                        final_message = incoming;
                    }
                } else if line.starts_with(SANDBOX_ERROR_PREFIX) {
                    // 描述：沙盒异常为多行 traceback，首行只包含前缀与标题；需继续读取直到 TURN_END，
                    // 否则前端只能看到 “Traceback (most recent call last):” 而丢失关键错误位置与异常类型。
                    let mut traceback_lines: Vec<String> = Vec::new();
                    let first_trace_line = line
                        .strip_prefix(SANDBOX_ERROR_PREFIX)
                        .unwrap_or("")
                        .to_string();
                    if !first_trace_line.trim().is_empty() {
                        traceback_lines.push(first_trace_line);
                    }
                    let collect_started_at = Instant::now();
                    loop {
                        if collect_started_at.elapsed() >= Duration::from_secs(2) {
                            break;
                        }
                        match sandbox.receiver.recv_timeout(Duration::from_millis(40)) {
                            Ok(crate::sandbox::SandboxOutput::Stdout(next_line)) => {
                                if next_line == TURN_END_MARKER {
                                    break;
                                }
                                traceback_lines.push(next_line);
                            }
                            Ok(crate::sandbox::SandboxOutput::Stderr(stderr_line)) => {
                                warn!(stderr = %stderr_line, "python sandbox error output while collecting traceback");
                            }
                            Ok(crate::sandbox::SandboxOutput::Terminated(code)) => {
                                traceback_lines
                                    .push(format!("(sandbox process terminated: {})", code));
                                break;
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                if let Ok(Some(status)) = sandbox.child.try_wait() {
                                    traceback_lines
                                        .push(format!("(sandbox process exited: {})", status));
                                    break;
                                }
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                traceback_lines.push("(sandbox channel disconnected)".to_string());
                                break;
                            }
                        }
                    }
                    let normalized_traceback = traceback_lines.join("\n").trim().to_string();
                    // 描述：运行时异常后主动重置会话沙盒，避免残留输出污染下一次执行。
                    // 这里必须先释放当前 sandbox 锁，再触发 reset（reset 内部会再次加锁并 kill 子进程）。
                    drop(sandbox);
                    crate::sandbox::SANDBOX_REGISTRY.reset(&session_id);
                    return Err(ProtocolError::new(
                        "sandbox.runtime_error",
                        if normalized_traceback.is_empty() {
                            "Python 沙盒执行失败（未返回 traceback 详情）".to_string()
                        } else {
                            normalized_traceback
                        },
                    ));
                } else if !line.trim().is_empty() {
                    plain_stdout_lines.push(line);
                }
            }
            Ok(crate::sandbox::SandboxOutput::Stderr(line)) => {
                warn!(stderr = %line, "python sandbox error output");
            }
            Ok(crate::sandbox::SandboxOutput::Terminated(code)) => {
                return Err(ProtocolError::new(
                    "sandbox.terminated",
                    format!("沙盒进程意外终止: {}", code),
                ));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(Some(status)) = sandbox.child.try_wait() {
                    return Err(ProtocolError::new(
                        "sandbox.crashed",
                        format!("进程已崩溃: {}", status),
                    ));
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(ProtocolError::new(
                    "sandbox.channel_disconnected",
                    "沙盒通信通道已断开",
                ));
            }
        }
    }

    sandbox.last_active_at = Instant::now();
    let normalized_message = if final_message.trim().is_empty() {
        synthesize_final_message_from_stdout(&plain_stdout_lines)
    } else {
        final_message.trim().to_string()
    };
    if normalized_message.is_empty() && actions.is_empty() {
        let fallback_message = synthesize_final_message_from_script(user_script);
        if !fallback_message.is_empty() {
            events.push(ProtocolEventRecord {
                event: "empty_result_auto_fallback".to_string(),
                step_index: None,
                timestamp_ms: now_millis(),
                message: "脚本未产生可见输出，已使用源码摘要作为兜底结果".to_string(),
            });
            return Ok(PythonScriptExecutionResult {
                message: fallback_message,
                actions,
                events,
                assets,
            });
        }
        return Err(
            ProtocolError::new(
                "core.agent.python.empty_result",
                "编排脚本执行结束，但未输出结果且未执行任何工具调用",
            )
            .with_suggestion("请在脚本末尾调用 finish(...)，并使用 write_text/apply_patch/run_shell 等工具落地产出。"),
        );
    }
    Ok(PythonScriptExecutionResult {
        message: if normalized_message.is_empty() {
            format!("编排脚本执行完成（工具调用 {} 次）", actions.len())
        } else {
            normalized_message
        },
        actions,
        events,
        assets,
    })
}

/// 描述：解析人工授权拒绝分支的事件名、用户提示与错误码。
fn resolve_approval_reject_payload() -> (&'static str, &'static str, &'static str) {
    (
        "approval_rejected",
        "操作已被用户拒绝",
        "core.agent.human_refused",
    )
}

use crate::tools::file::{
    GlobTool, ListDirTool, MkdirTool, ReadJsonTool, ReadTextTool, SearchFilesTool, StatTool,
    WriteJsonTool, WriteTextTool,
};
use crate::tools::git::{GitDiffTool, GitLogTool, GitStatusTool};
use crate::tools::mcp::{DccTool, McpTool};
use crate::tools::patch::ApplyPatchTool;
use crate::tools::shell::RunShellTool;
use crate::tools::todo::{TodoReadTool, TodoWriteTool};
use crate::tools::utils::*;
use crate::tools::web::{FetchUrlTool, WebSearchTool};
use crate::tools::ToolRegistry;

/// 描述：对工具执行结果进行语义摘要，过滤技术噪声并自动执行脱敏，确保展示信息的安全性与可读性。
fn summarize_tool_result(name: &str, ok: bool, data: &Value) -> String {
    if !ok {
        let err_msg = data.as_str().unwrap_or("执行失败");
        return scrub_sensitive_info(err_msg);
    }

    let summary = match name {
        "run_shell" => {
            let stdout = data.get("stdout").and_then(|v| v.as_str()).unwrap_or("");
            let stderr = data.get("stderr").and_then(|v| v.as_str()).unwrap_or("");
            let timed_out = data
                .get("timed_out")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let timeout_secs = data
                .get("timeout_secs")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            if timed_out {
                return if timeout_secs > 0 {
                    format!("执行超时（{}s），已终止", timeout_secs)
                } else {
                    "执行超时，已终止".to_string()
                };
            }
            let exit_code = data.get("status").and_then(|v| v.as_i64()).unwrap_or(0);

            let last_lines: Vec<&str> = stdout.lines().rev().take(3).collect();
            let mut s = if last_lines.is_empty() {
                if stderr.is_empty() {
                    "执行完成（无输出）".to_string()
                } else {
                    format!(
                        "执行完成，错误输出摘要: {}",
                        stderr.chars().take(100).collect::<String>()
                    )
                }
            } else {
                format!(
                    "执行完成，输出末尾: \n{}",
                    last_lines.into_iter().rev().collect::<Vec<_>>().join("\n")
                )
            };
            s.push_str(&format!(" (退出码: {})", exit_code));
            s
        }
        "read_text" => {
            let content = data.get("content").and_then(|v| v.as_str()).unwrap_or("");
            format!("读取完成，共 {} 字符", content.chars().count())
        }
        "read_json" => "读取 JSON 成功".to_string(),
        "write_json" => {
            let bytes = data.get("bytes").and_then(|v| v.as_u64()).unwrap_or(0);
            format!("写入 JSON 成功，共 {} 字节", bytes)
        }
        "git_status" => {
            let status = data.get("status").and_then(|v| v.as_str()).unwrap_or("");
            let lines = status.lines().count();
            if lines == 0 {
                "工作区干净".to_string()
            } else {
                format!("发现 {} 个变更文件", lines)
            }
        }
        "git_diff" => {
            let staged = data
                .get("staged_diff")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let unstaged = data
                .get("unstaged_diff")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if staged.is_empty() && unstaged.is_empty() {
                "无差异".to_string()
            } else {
                "提取 diff 成功".to_string()
            }
        }
        "git_log" => {
            let logs = data
                .get("logs")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            format!("已读取 {} 条提交记录", logs)
        }
        "list_dir" => {
            let entries = data
                .get("entries")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            format!("扫描完成，共发现 {} 个文件/目录", entries)
        }
        "glob" => {
            let matches = data
                .get("matches")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            format!("模式匹配完成，共命中 {} 条", matches)
        }
        "mkdir" => "目录创建成功".to_string(),
        "stat" => {
            let is_dir = data
                .get("is_dir")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let size = data.get("size_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
            if is_dir {
                "目录状态读取成功".to_string()
            } else {
                format!("文件状态读取成功，大小 {} 字节", size)
            }
        }
        "search_files" => {
            let matches = data
                .get("matches")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            format!("检索完成，共匹配 {} 处结果", matches)
        }
        "apply_patch" => {
            let files = data
                .get("files")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            format!("补丁应用完成，共修改 {} 个文件", files)
        }
        "web_search" => {
            let results = data
                .get("results")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            format!("检索完成，共返回 {} 条结果", results)
        }
        "fetch_url" => {
            let chars = data
                .get("content_chars")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            format!("抓取完成，共 {} 字符", chars)
        }
        _ => {
            let s = data.to_string();
            let mut chars = s.chars();
            let preview = chars.by_ref().take(200).collect::<String>();
            if chars.next().is_some() {
                format!("{}...", preview)
            } else {
                s
            }
        }
    };

    scrub_sensitive_info(summary.as_str())
}

/// 描述：按沙盒批量协议构建脚本载荷，长度字段使用字符数与 Python `read(size)` 语义一致。
fn build_batch_payload(user_script: &str) -> String {
    let script_char_count = user_script.chars().count();
    format!(
        "{}{}\n{}",
        BATCH_SIZE_PREFIX, script_char_count, user_script
    )
}

/// 描述：构建智能体默认可用的工具注册表。
fn build_default_tool_registry(
    dcc_provider_addr: Option<&str>,
    available_mcps: &[AgentRegisteredMcp],
) -> ToolRegistry {
    #[allow(unused_mut)]
    let mut registry = ToolRegistry::new();
    registry.register(Box::new(ReadTextTool));
    registry.register(Box::new(ReadJsonTool));
    registry.register(Box::new(WriteJsonTool));
    registry.register(Box::new(WriteTextTool));
    registry.register(Box::new(ListDirTool));
    registry.register(Box::new(MkdirTool));
    registry.register(Box::new(StatTool));
    registry.register(Box::new(GlobTool));
    registry.register(Box::new(SearchFilesTool));
    registry.register(Box::new(RunShellTool));
    registry.register(Box::new(GitStatusTool));
    registry.register(Box::new(GitDiffTool));
    registry.register(Box::new(GitLogTool));
    registry.register(Box::new(TodoReadTool));
    registry.register(Box::new(TodoWriteTool));
    registry.register(Box::new(ApplyPatchTool));
    registry.register(Box::new(WebSearchTool));
    registry.register(Box::new(FetchUrlTool));
    registry.register(Box::new(McpTool {
        dcc_provider_addr: dcc_provider_addr.map(String::from),
        registered_mcps: available_mcps.to_vec(),
    }));
    registry.register(Box::new(DccTool {
        registered_mcps: available_mcps.to_vec(),
    }));
    registry
}

/// 描述：解析并执行单次 Python 工具调用，所有文件与命令均限制在沙盒目录内。
struct AgentToolDescriptor {
    name: &'static str,
    description: &'static str,
    params: &'static str,
    tags: &'static [&'static str],
    example: &'static str,
}

/// 描述：返回智能体内置工具目录，用于 tool_search 检索与能力发现。
fn builtin_tool_descriptors() -> &'static [AgentToolDescriptor] {
    &[
        AgentToolDescriptor {
            name: "read_text",
            description: "读取项目内文本文件",
            params: "path: string",
            tags: &["file", "read", "text"],
            example: r#"read_text("README.md")"#,
        },
        AgentToolDescriptor {
            name: "read_json",
            description: "读取并解析项目内 JSON 文件",
            params: "path: string",
            tags: &["file", "read", "json"],
            example: r#"read_json("package.json")"#,
        },
        AgentToolDescriptor {
            name: "write_text",
            description: "写入项目内文本文件",
            params: "path: string, content: string",
            tags: &["file", "write", "text"],
            example: r#"write_text("src/app.ts", "console.log('ok')\n")"#,
        },
        AgentToolDescriptor {
            name: "write_json",
            description: "写入项目内 JSON 文件",
            params: "path: string, data: object",
            tags: &["file", "write", "json"],
            example: r#"write_json("meta.json", {"name":"demo"})"#,
        },
        AgentToolDescriptor {
            name: "apply_patch",
            description: "按 unified diff 批量修改文件",
            params: "patch: string, check_only?: bool",
            tags: &["file", "patch", "edit", "diff"],
            example: r#"apply_patch("--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n-old\n+new\n", False)"#,
        },
        AgentToolDescriptor {
            name: "glob",
            description: "按 glob 模式列出文件",
            params: "pattern: string, max_results?: number",
            tags: &["file", "glob", "pattern"],
            example: r#"glob("src/**/*.rs", 200)"#,
        },
        AgentToolDescriptor {
            name: "list_dir",
            description: "列出项目目录结构",
            params: "path?: string",
            tags: &["file", "list", "tree"],
            example: r#"list_dir("src")"#,
        },
        AgentToolDescriptor {
            name: "mkdir",
            description: "创建目录（支持递归父目录）",
            params: "path: string",
            tags: &["file", "mkdir", "write"],
            example: r#"mkdir("tmp/output")"#,
        },
        AgentToolDescriptor {
            name: "stat",
            description: "读取文件或目录基础状态",
            params: "path: string",
            tags: &["file", "stat", "metadata"],
            example: r#"stat("Cargo.toml")"#,
        },
        AgentToolDescriptor {
            name: "search_files",
            description: "在项目内执行全文检索（优先 ripgrep）",
            params: "query: string, glob?: string, max_results?: number",
            tags: &["search", "code", "grep"],
            example: r#"search_files("run_agent", "crates/**/*.rs", 20)"#,
        },
        AgentToolDescriptor {
            name: "run_shell",
            description: "在项目沙盒中执行命令（含安全策略与超时）",
            params: "command: string, timeout_secs?: number",
            tags: &["shell", "exec", "command"],
            example: r#"run_shell("cargo test -p libra_agent_core", 120)"#,
        },
        AgentToolDescriptor {
            name: "git_status",
            description: "查看当前沙盒工作目录的 git 状态（包括未追踪、已修改和暂存的文件）",
            params: "none",
            tags: &["git", "status", "vcs"],
            example: r#"git_status()"#,
        },
        AgentToolDescriptor {
            name: "git_diff",
            description: "查看当前沙盒工作目录的 Git diff",
            params: "path?: string",
            tags: &["git", "diff", "vcs"],
            example: r#"git_diff("src/main.rs")"#,
        },
        AgentToolDescriptor {
            name: "git_log",
            description: "查看项目的 Git 提交日志历史",
            params: "limit?: number",
            tags: &["git", "log", "vcs"],
            example: r#"git_log(5)"#,
        },
        AgentToolDescriptor {
            name: "todo_read",
            description: "读取任务清单（支持跨轮次持续追踪）",
            params: "none",
            tags: &["todo", "plan", "task"],
            example: r#"todo_read()"#,
        },
        AgentToolDescriptor {
            name: "todo_write",
            description: "覆盖写入任务清单（列表）",
            params: "items: array<object>",
            tags: &["todo", "plan", "task"],
            example: r#"todo_write([{"id":"1","content":"实现接口","status":"in_progress"}])"#,
        },
        AgentToolDescriptor {
            name: "web_search",
            description: "联网搜索公开资料（标题、链接、摘要）",
            params: "query: string, limit?: number",
            tags: &["web", "search", "internet"],
            example: r#"web_search("rust tauri command best practices", 5)"#,
        },
        AgentToolDescriptor {
            name: "fetch_url",
            description: "抓取网页正文片段",
            params: "url: string, max_chars?: number",
            tags: &["web", "fetch", "http"],
            example: r#"fetch_url("https://example.com", 4000)"#,
        },
        AgentToolDescriptor {
            name: "tool_search",
            description: "搜索可用工具及参数说明",
            params: "query?: string, limit?: number",
            tags: &["tooling", "discover"],
            example: r#"tool_search("web", 5)"#,
        },
        AgentToolDescriptor {
            name: "mcp_tool",
            description: "调用已注册的 MCP Server；对未知能力可先用 list_tools 探测",
            params: "server?: string, tool: string, arguments?: object",
            tags: &["mcp", "tool", "server", "bridge"],
            example: r#"mcp_tool(server="apifox-official", tool="list_tools")"#,
        },
        AgentToolDescriptor {
            name: "dcc_tool",
            description: "调用 DCC 建模能力路由；支持按 capability/software 选择建模软件与生成跨软件迁移计划",
            params: "capability: string, action: string, arguments?: object, software?: string, source_software?: string, target_software?: string",
            tags: &["dcc", "mcp", "modeling", "capability", "blender", "maya", "c4d"],
            example: r#"dcc_tool(capability="mesh.edit", action="list_mesh_objects", arguments={"scope":"selected"}, software="blender")"#,
        },
    ]
}

/// 描述：在工具目录中按关键词检索可用工具，避免每次把全量工具说明写入提示词。
pub(crate) fn tool_tool_search(args: &Value) -> Result<Value, ProtocolError> {
    let query = args
        .get("query")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("");
    let limit = parse_positive_usize_arg(args, "limit", 10, 100)?;
    let normalized_query = query.to_lowercase();
    let mut matched: Vec<Value> = Vec::new();

    for descriptor in builtin_tool_descriptors() {
        if !normalized_query.is_empty() {
            let tag_match = descriptor
                .tags
                .iter()
                .any(|tag| tag.to_lowercase().contains(normalized_query.as_str()));
            let text_match = descriptor
                .name
                .to_lowercase()
                .contains(normalized_query.as_str())
                || descriptor
                    .description
                    .to_lowercase()
                    .contains(normalized_query.as_str())
                || descriptor
                    .params
                    .to_lowercase()
                    .contains(normalized_query.as_str());
            if !(tag_match || text_match) {
                continue;
            }
        }
        matched.push(json!({
            "name": descriptor.name,
            "description": descriptor.description,
            "params": descriptor.params,
            "tags": descriptor.tags,
            "example": descriptor.example,
        }));
    }

    let total = matched.len();
    if matched.len() > limit {
        matched.truncate(limit);
    }

    Ok(json!({
        "query": query,
        "total": total,
        "tools": matched,
    }))
}

/// 描述：解析并返回可用 Python 解释器路径。
pub(crate) fn resolve_python_binary() -> Result<String, ProtocolError> {
    let mut candidates: Vec<String> = Vec::new();
    if let Some(bin) = env::var("ZODILEAP_PYTHON_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        candidates.push(bin);
    }
    candidates.push("python3".to_string());
    candidates.push("python".to_string());

    for bin in candidates {
        let output = Command::new(bin.as_str()).arg("--version").output();
        if output.is_ok() {
            return Ok(bin);
        }
    }

    Err(
        ProtocolError::new("core.agent.python.not_found", "未检测到可用 Python 解释器")
            .with_suggestion("请安装 Python3，或设置环境变量 ZODILEAP_PYTHON_BIN。"),
    )
}

/// 描述：解析沙盒根目录，默认使用当前工作目录并转换为绝对路径。
fn resolve_sandbox_root(workdir: Option<&str>) -> Result<PathBuf, ProtocolError> {
    let current_dir = env::current_dir().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.current_dir_failed",
            format!("读取当前目录失败: {}", err),
        )
    })?;
    let selected = workdir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| current_dir.clone());
    let absolute = if selected.is_absolute() {
        selected
    } else {
        current_dir.join(selected)
    };
    if !absolute.exists() || !absolute.is_dir() {
        return Err(ProtocolError::new(
            "core.agent.python.workdir_invalid",
            format!("工作目录无效: {}", absolute.to_string_lossy()),
        ));
    }
    Ok(absolute)
}

/// 描述：构建 Python 临时运行目录路径，目录名包含时间戳避免并发冲突。
#[cfg(test)]
mod tests {
    use libra_mcp_common::now_millis;
    use serde_json::json;
    use std::collections::HashSet;
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};

    // 从 tools 模块导入公共类型
    use super::*;
    use crate::tools::file::parse_search_line;
    use crate::tools::git::GitDiffTool;
    use crate::tools::patch::{
        collect_patch_paths, validate_patch_paths_in_sandbox, ApplyPatchTool,
    };
    use crate::tools::shell::{
        collect_shell_command_names, evaluate_run_shell_policy_with_sets,
        validate_shell_paths_in_sandbox, RunShellTool,
    };
    use crate::tools::todo::{TodoReadTool, TodoWriteTool};
    use crate::tools::utils::{resolve_executable_binary, resolve_sandbox_path};
    use crate::tools::web::{strip_html_tags, url_encode_component};
    use crate::tools::{AgentTool, ToolContext};

    /// 描述：为并发测试生成唯一沙盒目录，避免多个用例在同一毫秒命中同一路径导致任务清单互相污染。
    ///
    /// Returns:
    ///
    ///   - 当前测试专用的临时目录路径。
    fn build_unique_test_root() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        env::temp_dir().join(format!(
            "libra-agent-python-test-{}-{}",
            now_millis(),
            nanos
        ))
    }

    fn build_test_context<'a>(
        sandbox_root: &'a Path,
        policy: &'a crate::policy::AgentPolicy,
    ) -> ToolContext<'a> {
        ToolContext {
            trace_id: "test-trace".to_string(),
            sandbox_root,
            policy,
        }
    }

    /// 描述：验证 fenced Python 代码块能够被正确提取为可执行脚本。
    #[test]
    fn should_extract_python_script_from_fenced_block() {
        let raw = "```python\nprint('hello')\nfinish('ok')\n```";
        let script = extract_python_script(raw);
        assert!(script.contains("print('hello')"));
        assert!(script.contains("finish('ok')"));
    }

    /// 描述：验证当前置为自然语言说明时，仍可提取首段可执行 Python 脚本。
    #[test]
    fn should_extract_python_script_from_mixed_natural_language_response() {
        let raw = r#"
I will start by investigating the existing code.
I'll read the existing files first.

import os
import json

def implementation():
    finish("ok")
"#;
        let script = extract_python_script(raw);
        assert!(script.starts_with("import os"));
        assert!(script.contains("def implementation():"));
        assert!(script.contains("finish(\"ok\")"));
    }

    /// 描述：验证与线上报错一致的“英文说明 + import”前缀可被正确剥离。
    #[test]
    fn should_extract_python_script_when_first_line_is_plain_english_sentence() {
        let raw = r#"
I will list the current directory to verify the workspace state before proceeding with the design.
import os
import json

def main():
    finish("ok")
"#;
        let script = extract_python_script(raw);
        assert!(script.starts_with("import os"));
        assert!(script.contains("import json"));
        assert!(script.contains("def main():"));
    }

    /// 描述：验证 fenced 代码块不在首行时，依然优先提取 fenced block 正文。
    #[test]
    fn should_extract_python_script_from_late_fenced_block() {
        let raw = r#"
先说明下思路：
```python
print("hello")
finish("done")
```
"#;
        let script = extract_python_script(raw);
        assert_eq!(script, "print(\"hello\")\nfinish(\"done\")");
    }

    /// 描述：验证当脚本缺少 finish 调用时，会自动补全 finish(...) 兜底收尾。
    #[test]
    fn should_append_finish_when_missing() {
        let script = "import os\nprint('hello')";
        let normalized = ensure_script_has_finish(script);
        assert!(normalized.contains("import os"));
        assert!(normalized.contains("finish(\"执行完成（系统自动补全 finish）\")"));
    }

    /// 描述：验证当脚本已存在 finish 调用时，不应重复追加兜底 finish。
    #[test]
    fn should_keep_existing_finish_without_duplicate_append() {
        let script = "import os\nfinish(\"ok\")";
        let normalized = ensure_script_has_finish(script);
        let finish_count = normalized.matches("finish(").count();
        assert_eq!(finish_count, 1);
        assert!(normalized.contains("finish(\"ok\")"));
    }

    /// 描述：验证当 finish(...) 仅存在于函数体内部时，仍会补全顶层 finish 兜底，避免误判已完成。
    #[test]
    fn should_append_finish_when_finish_exists_only_in_nested_block() {
        let script = r#"
def main():
    finish("nested")
"#;
        let normalized = ensure_script_has_finish(script);
        assert!(normalized.contains("finish(\"nested\")"));
        assert!(normalized.contains("finish(\"执行完成（系统自动补全 finish）\")"));
    }

    /// 描述：验证函数体仅包含注释时，会自动补全 pass，避免运行时触发 IndentationError。
    #[test]
    fn should_repair_missing_block_body_with_pass() {
        let script = r#"
import os

def main():
    # placeholder

finish("ok")
"#;
        let repaired = repair_missing_python_block_body(script);
        assert!(repaired.contains("pass  # 描述：系统自动补全空代码块，避免 IndentationError。"));
        assert!(repaired.contains("finish(\"ok\")"));
    }

    /// 描述：验证当首个 fenced block 为 text 说明时，应继续提取后续 python fenced block。
    #[test]
    fn should_skip_non_python_fenced_block_and_pick_python_block() {
        let raw = r#"
```text
I will inspect project first.
```

```python
import os
finish("ok")
```
"#;
        let script = extract_python_script(raw);
        assert!(script.starts_with("import os"));
        assert!(script.contains("finish(\"ok\")"));
        assert!(!script.contains("I will inspect project first."));
    }

    /// 描述：验证当 fenced block 全是说明文本时，应回退到正文中的 Python 代码起点提取。
    #[test]
    fn should_fallback_to_plain_python_when_fenced_block_is_not_python_code() {
        let raw = r#"
```text
I will start by listing files.
Then I will implement.
```

import json
def main():
    finish("done")
"#;
        let script = extract_python_script(raw);
        assert!(script.starts_with("import json"));
        assert!(script.contains("def main():"));
        assert!(script.contains("finish(\"done\")"));
    }

    /// 描述：验证当脚本未调用 finish 但有标准输出时，会自动合成最终结果文案。
    #[test]
    fn should_synthesize_final_message_from_stdout_lines() {
        let lines = vec![
            "step1".to_string(),
            "step2".to_string(),
            "ready".to_string(),
        ];
        let message = synthesize_final_message_from_stdout(&lines);
        assert!(message.contains("自动补全结果"));
        assert!(message.contains("step1"));
        assert!(message.contains("ready"));
    }

    /// 描述：验证沙盒路径解析会拒绝越界访问。
    #[test]
    fn should_reject_path_outside_sandbox() {
        let root = PathBuf::from("/tmp/libra-agent-test");
        let path = resolve_sandbox_path(&root, "../../etc/passwd");
        assert!(path.is_err());
    }

    /// 描述：验证 Python 沙盒可实际执行脚本并返回 finish 消息。
    #[test]
    fn should_execute_python_script_in_sandbox() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        fs::write(root.join("hello.txt"), "hello").expect("seed test file");
        let script = r#"
items = list_dir(".")
if not isinstance(items, dict):
    raise RuntimeError("list_dir should return dict")
finish("python sandbox ok")
"#;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session".to_string(),
            },
            &mut |_| {},
        )
        .expect("python script should execute successfully");
        assert_eq!(result.message, "python sandbox ok");
    }

    /// 描述：验证兼容工具别名在未调用 finish 时仍可执行，并通过 stdout 自动补全结果。
    #[test]
    fn should_support_compatibility_tool_aliases_without_finish() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let script = r#"
items = list_directory(dir_path=".")
print(f"alias items count: {len(items)}")
"#;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-alias-tools".to_string(),
            },
            &mut |_| {},
        )
        .expect("alias tools script should execute successfully");
        assert!(result.message.contains("自动补全结果"));
        assert!(result.actions.iter().any(|item| item == "list_dir"));
    }

    /// 描述：验证 `write_text(file_path=..., text=...)` 关键字参数写法可被兼容层正确映射，不再触发 TypeError。
    #[test]
    fn should_support_write_text_keyword_alias_arguments() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let script = r##"
result = write_text(file_path="requirements.md", text="# alias write ok\n")
if not isinstance(result, dict) or not result.get("ok"):
    raise RuntimeError(f"write_text alias failed: {result}")
finish("write_text keyword alias ok")
"##;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-write-text-alias".to_string(),
            },
            &mut |event| {
                if let AgentStreamEvent::RequireApproval { approval_id, .. } = event {
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(20));
                        let _ = crate::APPROVAL_REGISTRY
                            .submit_decision(&approval_id, crate::ApprovalOutcome::Approved);
                    });
                }
            },
        )
        .expect("write_text alias script should execute successfully");
        assert_eq!(result.message, "write_text keyword alias ok");
        let written_content = fs::read_to_string(root.join("requirements.md"))
            .expect("write_text alias should create requirements.md");
        assert_eq!(written_content, "# alias write ok\n");
        assert!(result.actions.iter().any(|item| item == "write_text"));
    }

    /// 描述：验证 `todo_write("KEY", "VALUE")` 历史两参数写法可被兼容层映射，不再触发参数个数错误。
    #[test]
    fn should_support_todo_write_legacy_two_positional_arguments() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let script = r##"
result = todo_write("NEXT_STEP", "设计前端框架")
if not isinstance(result, dict) or not result.get("ok"):
    raise RuntimeError(f"todo_write legacy style failed: {result}")
finish("todo_write legacy positional alias ok")
"##;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-todo-write-legacy-alias".to_string(),
            },
            &mut |event| {
                if let AgentStreamEvent::RequireApproval { approval_id, .. } = event {
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(20));
                        let _ = crate::APPROVAL_REGISTRY
                            .submit_decision(&approval_id, crate::ApprovalOutcome::Approved);
                    });
                }
            },
        )
        .expect("todo_write legacy alias script should execute successfully");
        assert_eq!(result.message, "todo_write legacy positional alias ok");
        let todo_path = root.join(".libra_agent_todo.json");
        let todo_content =
            fs::read_to_string(todo_path).expect("todo_write should create todo snapshot file");
        let parsed: serde_json::Value = serde_json::from_str(todo_content.as_str())
            .expect("todo snapshot should be valid json");
        let items = parsed
            .get("items")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(items.len(), 1);
        let first = items.first().expect("todo item should exist");
        assert_eq!(
            first
                .get("content")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            "设计前端框架"
        );
        assert_eq!(
            first
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            "pending"
        );
        assert!(result.actions.iter().any(|item| item == "todo_write"));
    }

    /// 描述：验证 todo_read 默认返回任务项列表，避免脚本直接遍历返回值时因结构误判触发类型错误。
    #[test]
    fn should_return_todo_items_list_by_default() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let script = r##"
write_result = todo_write([{"id":"step-1","content":"实现页面布局","status":"pending"}])
if not isinstance(write_result, dict) or not write_result.get("ok"):
    raise RuntimeError(f"todo_write prepare failed: {write_result}")
items = todo_read()
if not isinstance(items, list):
    raise RuntimeError(f"todo_read should return list by default: {items}")
if len(items) < 1:
    raise RuntimeError(f"todo_read list should not be empty: {items}")
first = items[0]
if not isinstance(first, dict):
    raise RuntimeError(f"todo_read list item should be dict: {first}")
if first.get("content") != "实现页面布局":
    raise RuntimeError(f"todo_read item content mismatch: {first}")
finish("todo_read default items list ok")
"##;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-todo-read-default-list".to_string(),
            },
            &mut |event| {
                if let AgentStreamEvent::RequireApproval { approval_id, .. } = event {
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(20));
                        let _ = crate::APPROVAL_REGISTRY
                            .submit_decision(&approval_id, crate::ApprovalOutcome::Approved);
                    });
                }
            },
        )
        .expect("todo_read default list script should execute successfully");
        assert_eq!(result.message, "todo_read default items list ok");
        assert!(result.actions.iter().any(|item| item == "todo_write"));
        assert!(result.actions.iter().any(|item| item == "todo_read"));
    }

    /// 描述：验证 todo_read 会为缺失 id 的历史任务项补齐默认字段，避免脚本直接 item['id'] 时触发 KeyError。
    #[test]
    fn should_normalize_todo_items_with_missing_id_in_todo_read() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let legacy_payload = json!({
            "updated_at": now_millis(),
            "items": [
                {"content": "需求分析", "status": "done"},
                {"id": "", "task": "接口设计"},
                "页面实现"
            ],
        });
        fs::write(
            root.join(".libra_agent_todo.json"),
            serde_json::to_string_pretty(&legacy_payload).expect("serialize legacy todo payload"),
        )
        .expect("write legacy todo payload");
        let script = r##"
items = todo_read()
if not isinstance(items, list):
    raise RuntimeError(f"todo_read should return list: {items}")
for idx, item in enumerate(items):
    if not isinstance(item, dict):
        raise RuntimeError(f"todo_read item should be dict: {item}")
    if not item["id"]:
        raise RuntimeError(f"todo_read should normalize missing id: {item}")
    if "content" not in item:
        raise RuntimeError(f"todo_read should normalize missing content: {item}")
    if "status" not in item:
        raise RuntimeError(f"todo_read should normalize missing status: {item}")
finish("todo_read normalize missing id ok")
"##;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-todo-read-normalize-missing-id".to_string(),
            },
            &mut |_| {},
        )
        .expect("todo_read normalize script should execute successfully");
        assert_eq!(result.message, "todo_read normalize missing id ok");
        assert!(result.actions.iter().any(|item| item == "todo_read"));
    }

    /// 描述：验证 read_text/read_json 默认返回解包后的内容，避免脚本重复手写 JSON 解包并触发类型错误。
    #[test]
    fn should_unwrap_read_text_and_read_json_payloads_by_default() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        fs::write(root.join("note.txt"), "{\"step\":\"ok\"}\n")
            .expect("prepare read_text fixture file");
        fs::write(root.join("meta.json"), r#"{"stage":"test","count":2}"#)
            .expect("prepare read_json fixture file");
        let script = r##"
text_content = read_text("note.txt")
if not isinstance(text_content, str):
    raise RuntimeError(f"read_text should return str by default: {text_content}")
if "\"step\":\"ok\"" not in text_content:
    raise RuntimeError(f"read_text content mismatch: {text_content}")

json_data = read_json("meta.json")
if not isinstance(json_data, dict):
    raise RuntimeError(f"read_json should return dict by default: {json_data}")
if json_data.get("stage") != "test" or json_data.get("count") != 2:
    raise RuntimeError(f"read_json payload mismatch: {json_data}")

text_meta = read_text("note.txt", with_meta=True)
if not isinstance(text_meta, dict) or not isinstance(text_meta.get("data"), dict):
    raise RuntimeError(f"read_text with_meta should return raw response: {text_meta}")
if "content" not in text_meta["data"]:
    raise RuntimeError(f"read_text with_meta missing content field: {text_meta}")

json_meta = read_json("meta.json", include_meta=True)
if not isinstance(json_meta, dict) or not isinstance(json_meta.get("data"), dict):
    raise RuntimeError(f"read_json include_meta should return raw response: {json_meta}")
if "data" not in json_meta["data"]:
    raise RuntimeError(f"read_json include_meta missing data field: {json_meta}")

finish("read_text/read_json default unwrap ok")
"##;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-read-text-json-default-unwrap".to_string(),
            },
            &mut |event| {
                if let AgentStreamEvent::RequireApproval { approval_id, .. } = event {
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(20));
                        let _ = crate::APPROVAL_REGISTRY
                            .submit_decision(&approval_id, crate::ApprovalOutcome::Approved);
                    });
                }
            },
        )
        .expect("read_text/read_json default unwrap script should execute successfully");
        assert_eq!(result.message, "read_text/read_json default unwrap ok");
        assert!(result.actions.iter().any(|item| item == "read_text"));
        assert!(result.actions.iter().any(|item| item == "read_json"));
    }

    /// 描述：验证当脚本既未输出 finish 结果也未执行工具调用时，会触发“源码摘要兜底”而非直接失败。
    #[test]
    fn should_fallback_when_script_has_no_result_and_no_actions() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let script = "value = 1 + 1";
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-empty-result".to_string(),
            },
            &mut |_| {},
        )
        .expect("script without visible output should fallback");
        assert!(result.message.contains("系统自动收尾"));
        assert!(result.actions.is_empty());
    }

    /// 描述：验证“函数定义 + __main__ 入口调用”的脚本在自动补全 finish 后可稳定返回结果，覆盖线上用户场景。
    #[test]
    fn should_execute_requirement_style_script_with_auto_finish() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let raw_script = r#"
import os
import json

def requirements_analyst():
    print("step1")
    return {"ok": True}

if __name__ == "__main__":
    requirements_analyst()
"#;
        let prepared_script =
            ensure_script_has_finish(&repair_missing_python_block_body(raw_script));
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: &prepared_script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-requirement-style-script".to_string(),
            },
            &mut |_| {},
        )
        .expect("script with __main__ entry should execute");
        assert!(
            result.message.contains("执行完成（系统自动补全 finish）")
                || result.message.contains("自动补全结果")
        );
    }

    /// 描述：验证脚本出现多个 finish(...) 时，优先保留模型显式返回的业务结果，避免被自动补全文案覆盖。
    #[test]
    fn should_prefer_explicit_finish_message_over_auto_finish_message() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let script = r##"
def run():
    finish("STATUS: CONTINUE\nSUMMARY: 已完成需求分析\nNEXT: 进入 API 模型设计")

if __name__ == "__main__":
    run()

finish("执行完成（系统自动补全 finish）")
"##;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-multi-finish-priority".to_string(),
            },
            &mut |_| {},
        )
        .expect("script with multiple finish messages should execute");
        assert!(
            result.message.starts_with("STATUS: CONTINUE"),
            "expected explicit finish payload, got: {}",
            result.message
        );
        assert!(result.message.contains("SUMMARY: 已完成需求分析"));
    }

    /// 描述：验证脚本仅使用普通 print（未显式 flush）时，仍可通过 stdout 自动补全最终结果，避免误报 empty_result。
    #[test]
    fn should_capture_plain_print_stdout_without_finish_or_tools() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let script = r#"
print("requirements done")
print("api model done")
"#;
        let result = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id: "test-session-plain-print".to_string(),
            },
            &mut |_| {},
        )
        .expect("plain print script should synthesize final message");
        assert!(result.message.contains("自动补全结果"));
        assert!(result.message.contains("requirements done"));
        assert!(result.message.contains("api model done"));
        assert!(result.actions.is_empty());
    }

    /// 描述：验证沙盒运行时异常会返回完整 traceback，而不是仅首行标题。
    #[test]
    fn should_capture_full_traceback_for_sandbox_runtime_error() {
        if resolve_python_binary().is_err() {
            return;
        }
        let root = build_unique_test_root();
        fs::create_dir_all(&root).expect("create temp root");
        let session_id = format!("test-session-traceback-{}", now_millis());
        let script = r#"
def run():
    raise RuntimeError("boom runtime")

run()
"#;
        let error = execute_python_script(
            PythonScriptExecutionRequest {
                user_script: script,
                workdir: root.to_str(),
                dcc_provider_addr: None,
                available_mcps: &[],
                policy: &crate::policy::AgentPolicy::default(),
                trace_id: "test-trace".to_string(),
                session_id,
            },
            &mut |_| {},
        )
        .expect_err("runtime error should fail");
        assert_eq!(error.code, "sandbox.runtime_error");
        assert!(
            error.message.contains("Traceback (most recent call last):"),
            "error message should include traceback header, got: {}",
            error.message
        );
        assert!(
            error.message.contains("RuntimeError: boom runtime"),
            "error message should include root exception line, got: {}",
            error.message
        );
    }

    /// 描述：验证工具搜索可以按关键词返回匹配工具，避免全量工具说明重复注入。
    #[test]
    fn should_search_tools_by_keyword() {
        let result = tool_tool_search(&json!({"query":"web","limit":5})).expect("tool search ok");
        let tools = result
            .get("tools")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            tools.iter().any(|item| {
                item.get("name")
                    .and_then(|value| value.as_str())
                    .map(|name| name == "web_search" || name == "fetch_url")
                    .unwrap_or(false)
            }),
            "web 关键词应命中 web_search 或 fetch_url"
        );
    }

    /// 描述：验证工具目录检索可返回 glob 条目，保证文件匹配能力对模型可见。
    #[test]
    fn should_search_glob_tool_descriptor() {
        let result = tool_tool_search(&json!({"query":"glob","limit":10})).expect("tool search ok");
        let tools = result
            .get("tools")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            tools.iter().any(|item| {
                item.get("name")
                    .and_then(|value| value.as_str())
                    .map(|name| name == "glob")
                    .unwrap_or(false)
            }),
            "glob 关键词应命中 glob 工具"
        );
    }

    /// 描述：验证工具目录中的 MCP 条目已切换到通用 `mcp_tool`，避免提示词与运行时入口不一致。
    #[test]
    fn should_search_generic_mcp_tool_descriptor() {
        let result = tool_tool_search(&json!({"query":"mcp","limit":10})).expect("tool search ok");
        let tools = result
            .get("tools")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(tools.iter().any(|item| {
            item.get("name")
                .and_then(|value| value.as_str())
                .map(|name| name == "mcp_tool")
                .unwrap_or(false)
        }));
    }

    /// 描述：验证工具目录可检索到 `dcc_tool`，确保建模 Skill 能看到显式 DCC 路由入口。
    #[test]
    fn should_search_dcc_tool_descriptor() {
        let result = tool_tool_search(&json!({"query":"dcc","limit":10})).expect("tool search ok");
        let tools = result
            .get("tools")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(tools.iter().any(|item| {
            item.get("name")
                .and_then(|value| value.as_str())
                .map(|name| name == "dcc_tool")
                .unwrap_or(false)
        }));
    }

    /// 描述：验证默认工具注册表已接入新增文件工具，避免声明与运行时能力不一致。
    #[test]
    fn should_register_extended_file_tools() {
        let registry = build_default_tool_registry(None, &[]);
        assert!(registry.get("write_json").is_some());
        assert!(registry.get("mkdir").is_some());
        assert!(registry.get("stat").is_some());
        assert!(registry.get("glob").is_some());
        assert!(registry.get("mcp_tool").is_some());
        assert!(registry.get("dcc_tool").is_some());
    }

    /// 描述：验证搜索行解析逻辑能正确拆解 path/line/content 三段信息。
    #[test]
    fn should_parse_search_line_payload() {
        let parsed = parse_search_line("src/main.rs:42:let value = 1;").expect("must parse");
        assert_eq!(
            parsed.get("path").and_then(|value| value.as_str()),
            Some("src/main.rs")
        );
        assert_eq!(
            parsed.get("line").and_then(|value| value.as_u64()),
            Some(42)
        );
    }

    /// 描述：验证 HTML 去标签逻辑会产出纯文本内容。
    #[test]
    fn should_strip_html_tags_to_plain_text() {
        let plain = strip_html_tags("<h1>Hello</h1><p>world &amp; rust</p>");
        assert!(plain.contains("Hello"));
        assert!(plain.contains("world & rust"));
    }

    /// 描述：验证 URL 编码会处理空格和特殊字符。
    #[test]
    fn should_encode_url_component() {
        let encoded = url_encode_component("rust tauri/cmd");
        assert_eq!(encoded, "rust+tauri%2Fcmd");
    }

    /// 描述：验证补丁路径提取会过滤 /dev/null 并去重。
    #[test]
    fn should_collect_patch_paths() {
        let patch = r#"
diff --git a/src/a.txt b/src/a.txt
--- a/src/a.txt
+++ b/src/a.txt
@@ -1 +1 @@
-old
+new
--- /dev/null
+++ src/new.txt
@@ -0,0 +1 @@
+hello
"#;
        let paths = collect_patch_paths(patch);
        assert!(paths.contains(&"src/a.txt".to_string()));
        assert!(paths.contains(&"src/new.txt".to_string()));
        assert_eq!(paths.len(), 2);
    }

    /// 描述：验证补丁路径校验会拒绝沙盒外路径。
    #[test]
    fn should_reject_patch_path_outside_sandbox() {
        let root = PathBuf::from("/tmp/libra-agent-test");
        let result = validate_patch_paths_in_sandbox(&["../../etc/passwd".to_string()], &root);
        assert!(result.is_err());
    }

    /// 描述：验证 apply_patch 工具可以在沙盒内创建新文件。
    #[test]
    fn should_apply_patch_in_sandbox() {
        if resolve_executable_binary("git", "--version").is_none() {
            return;
        }
        let root = env::temp_dir().join(format!("libra-agent-apply-patch-{}", now_millis()));
        fs::create_dir_all(&root).expect("create sandbox root");
        fs::write(root.join("hello.txt"), "old\n").expect("seed old file");
        let patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+hello\n";
        let policy = crate::policy::AgentPolicy::default();
        let context = build_test_context(root.as_path(), &policy);
        let result = ApplyPatchTool
            .execute(&json!({ "patch": patch }), context)
            .expect("apply patch should succeed");
        assert_eq!(
            result.get("success").and_then(|value| value.as_bool()),
            Some(true)
        );
        let content = fs::read_to_string(root.join("hello.txt")).expect("read patched file");
        assert_eq!(content, "hello\n");
    }

    /// 描述：验证 apply_patch 在 check_only 模式下仅预检查，不会实际改写文件。
    #[test]
    fn should_check_patch_without_apply() {
        if resolve_executable_binary("git", "--version").is_none() {
            return;
        }
        let root = env::temp_dir().join(format!("libra-agent-patch-check-{}", now_millis()));
        fs::create_dir_all(&root).expect("create sandbox root");
        fs::write(root.join("hello.txt"), "old\n").expect("seed old file");
        let patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+hello\n";
        let policy = crate::policy::AgentPolicy::default();
        let context = build_test_context(root.as_path(), &policy);
        let result = ApplyPatchTool
            .execute(&json!({ "patch": patch, "check_only": true }), context)
            .expect("patch check should succeed");
        assert_eq!(
            result.get("checked").and_then(|value| value.as_bool()),
            Some(true)
        );
        assert_eq!(
            result.get("applied").and_then(|value| value.as_bool()),
            Some(false)
        );
        let content = fs::read_to_string(root.join("hello.txt")).expect("read origin file");
        assert_eq!(content, "old\n");
    }

    /// 描述：验证任务清单工具可写入并读取同一份数据。
    #[test]
    fn should_write_and_read_todo_items() {
        let root = env::temp_dir().join(format!("libra-agent-todo-{}", now_millis()));
        fs::create_dir_all(&root).expect("create todo sandbox");
        let policy = crate::policy::AgentPolicy::default();

        let write_result = TodoWriteTool
            .execute(
                &json!({
                    "items": [
                        { "id": "1", "content": "需求分析", "status": "completed" },
                        { "id": "2", "content": "实现代码", "status": "in_progress" }
                    ]
                }),
                build_test_context(root.as_path(), &policy),
            )
            .expect("write todo should succeed");
        assert_eq!(
            write_result
                .get("success")
                .and_then(|value| value.as_bool()),
            Some(true)
        );

        let read_result = TodoReadTool
            .execute(&json!({}), build_test_context(root.as_path(), &policy))
            .expect("read todo should succeed");
        assert_eq!(
            read_result.get("count").and_then(|value| value.as_u64()),
            Some(2)
        );
    }

    /// 描述：验证 run_shell 工具在超时时会返回 timed_out 状态且不中断测试进程。
    #[test]
    fn should_timeout_run_shell() {
        let root = env::temp_dir().join(format!("libra-agent-run-shell-{}", now_millis()));
        fs::create_dir_all(&root).expect("create shell sandbox");
        #[cfg(target_os = "windows")]
        let command = "ping -n 3 127.0.0.1 > nul";
        #[cfg(not(target_os = "windows"))]
        let command = "sleep 2";

        let policy = crate::policy::AgentPolicy {
            tool_timeout_secs: 1,
            ..Default::default()
        };

        let result = RunShellTool
            .execute(
                &json!({
                    "command": command,
                    "timeout_secs": 1
                }),
                build_test_context(root.as_path(), &policy),
            )
            .expect("run_shell should return timeout payload");
        assert_eq!(
            result.get("timed_out").and_then(|value| value.as_bool()),
            Some(true)
        );
        assert_eq!(
            result.get("success").and_then(|value| value.as_bool()),
            Some(false)
        );
    }

    /// 描述：验证 run_shell 摘要会读取 status 字段作为退出码，避免展示错误的 0 退出码。
    #[test]
    fn should_summarize_run_shell_using_status_code() {
        let summary = summarize_tool_result(
            "run_shell",
            true,
            &json!({
                "status": 7,
                "stdout": "",
                "stderr": "failed",
            }),
        );
        assert!(summary.contains("退出码: 7"));
    }

    /// 描述：验证 run_shell 超时摘要不会误展示退出码，避免把超时误导为成功执行。
    #[test]
    fn should_summarize_timed_out_run_shell_without_fake_exit_code() {
        let summary = summarize_tool_result(
            "run_shell",
            true,
            &json!({
                "stdout": "",
                "stderr": "",
                "status": null,
                "timed_out": true,
                "timeout_secs": 30
            }),
        );
        assert!(summary.contains("执行超时（30s）"));
        assert!(!summary.contains("退出码"));
    }

    /// 描述：验证未知工具摘要分支在包含中文且超长 JSON 时不会因字节切片触发 panic。
    #[test]
    fn should_summarize_unknown_tool_payload_with_unicode_without_panicking() {
        let summary = summarize_tool_result(
            "unknown_tool",
            true,
            &json!({
                "diff_preview": format!("{}{}", "用户管理系统需求分析".repeat(40), "END")
            }),
        );
        assert!(summary.ends_with("..."));
        assert!(summary.contains("用户管理系统"));
    }

    /// 描述：验证批量脚本载荷长度字段按字符数计算，避免非 ASCII 脚本在沙盒读取时卡住。
    #[test]
    fn should_build_batch_payload_with_unicode_char_length() {
        let script = "print('中文')\nfinish('ok')";
        let payload = build_batch_payload(script);
        let mut lines = payload.lines();
        let header = lines.next().unwrap_or_default();
        let body = lines.collect::<Vec<&str>>().join("\n");
        assert_eq!(
            header,
            format!("{}{}", BATCH_SIZE_PREFIX, script.chars().count())
        );
        assert_eq!(body, script);
    }

    /// 描述：验证命令分段解析能提取每段的真实可执行命令名。
    #[test]
    fn should_collect_shell_command_names_from_segments() {
        let names = collect_shell_command_names(
            "FOO=1 env BAR=2 git status && echo ok | rg ok; cargo test",
        );
        assert_eq!(
            names,
            vec![
                "git".to_string(),
                "echo".to_string(),
                "rg".to_string(),
                "cargo".to_string()
            ]
        );
    }

    /// 描述：验证黑名单命令会被 run_shell 安全策略拒绝。
    #[test]
    fn should_reject_blacklisted_shell_command() {
        let allowlist: HashSet<String> = HashSet::new();
        let mut denylist: HashSet<String> = HashSet::new();
        denylist.insert("rm".to_string());
        let result = evaluate_run_shell_policy_with_sets("rm -rf ./tmp", &allowlist, &denylist);
        assert!(result.is_err());
        let error = result.expect_err("should reject blacklisted command");
        assert_eq!(error.code, "core.agent.python.run_shell.command_blocked");
    }

    /// 描述：验证白名单模式下只允许显式声明的命令执行。
    #[test]
    fn should_enforce_shell_allowlist() {
        let mut allowlist: HashSet<String> = HashSet::new();
        allowlist.insert("git".to_string());
        let denylist: HashSet<String> = HashSet::new();
        let result = evaluate_run_shell_policy_with_sets("git status && ls", &allowlist, &denylist);
        assert!(result.is_err());
        let error = result.expect_err("should reject non-allowlisted command");
        assert_eq!(
            error.code,
            "core.agent.python.run_shell.command_not_allowed"
        );
    }

    /// 描述：验证 run_shell 路径校验会接受沙盒内路径参数并返回归一化路径。
    #[test]
    fn should_validate_shell_paths_in_sandbox() {
        let root = PathBuf::from("/tmp/libra-agent-shell-path-ok");
        let paths =
            validate_shell_paths_in_sandbox("cat ./src/main.rs --output=dist/app.js", &root)
                .expect("paths in sandbox should pass");
        assert!(paths.iter().any(|value| value.ends_with("/src/main.rs")));
        assert!(paths.iter().any(|value| value.ends_with("/dist/app.js")));
    }

    /// 描述：验证 run_shell 路径校验会拒绝访问沙盒外路径。
    #[test]
    fn should_reject_shell_path_outside_sandbox() {
        let root = PathBuf::from("/tmp/libra-agent-shell-path-block");
        let result = validate_shell_paths_in_sandbox("cat ../outside.txt", &root);
        assert!(result.is_err());
        let error = result.expect_err("outside sandbox path should fail");
        assert_eq!(
            error.code,
            "core.agent.python.run_shell.path_outside_sandbox"
        );
    }

    /// 描述：验证 run_shell 路径校验会拒绝变量展开路径，避免绕过沙盒限制。
    #[test]
    fn should_reject_dynamic_shell_path() {
        let root = PathBuf::from("/tmp/libra-agent-shell-path-var");
        let result = validate_shell_paths_in_sandbox("cat $HOME/.ssh/id_rsa", &root);
        assert!(result.is_err());
        let error = result.expect_err("dynamic path should fail");
        assert_eq!(
            error.code,
            "core.agent.python.run_shell.dynamic_path_forbidden"
        );
    }

    /// 描述：验证非 Git 仓库执行 git_diff 时会返回失败错误，避免被静默为“无差异”。
    #[test]
    fn should_fail_git_diff_outside_repository() {
        let root = env::temp_dir().join(format!("libra-agent-git-diff-{}", now_millis()));
        fs::create_dir_all(&root).expect("create git diff sandbox");
        let policy = crate::policy::AgentPolicy::default();

        let result = GitDiffTool.execute(&json!({}), build_test_context(root.as_path(), &policy));
        assert!(result.is_err());
        let error = result.expect_err("git diff outside repository should fail");
        assert_eq!(error.code, "core.agent.python.git_diff.failed");
    }

    /// 描述：验证人工授权主动拒绝分支会产出 rejected 事件与拒绝错误码。
    #[test]
    fn should_map_approval_reject_to_rejected_payload() {
        let (event_name, reject_message, reject_code) = resolve_approval_reject_payload();
        assert_eq!(event_name, "approval_rejected");
        assert_eq!(reject_message, "操作已被用户拒绝");
        assert_eq!(reject_code, "core.agent.human_refused");
    }

    /// 描述：验证多轮结果解析可识别 STATUS: CONTINUE，并正确提取 SUMMARY/NEXT 字段。
    #[test]
    fn should_parse_continue_turn_result_envelope() {
        let message =
            "STATUS: CONTINUE\nSUMMARY: 已完成需求拆解并写入文档\nNEXT: 开始实现 API 接口";
        let envelope = parse_turn_result_envelope(message, &["write_text".to_string()], 1, 6);
        assert_eq!(envelope.control, TurnControl::Continue);
        assert_eq!(envelope.summary, "已完成需求拆解并写入文档");
        assert_eq!(envelope.next, "开始实现 API 接口");
    }

    /// 描述：验证当未提供 DONE/CONTINUE 显式标记且无工具动作时，默认继续下一轮避免“只计划即结束”。
    #[test]
    fn should_default_continue_when_no_actions_and_no_status_marker() {
        let message = "已完成方案规划";
        let envelope = parse_turn_result_envelope(message, &[], 1, 6);
        assert_eq!(envelope.control, TurnControl::Continue);
    }

    /// 描述：验证未显式返回 DONE/CONTINUE 且已有工具动作时，仍默认继续下一轮，避免“首轮写文档后提前结束”。
    #[test]
    fn should_continue_with_actions_when_status_marker_missing() {
        let message = "本轮已写入需求文档";
        let envelope = parse_turn_result_envelope(message, &["write_text".to_string()], 1, 6);
        assert_eq!(envelope.control, TurnControl::Continue);
        assert_eq!(envelope.summary, "本轮已写入需求文档");
    }

    /// 描述：验证多轮结果解析可识别 STATUS: DONE，并收敛到完成态。
    #[test]
    fn should_parse_done_turn_result_envelope() {
        let message = "STATUS: DONE\nSUMMARY: 代码与测试均已完成\nNEXT: 无";
        let envelope = parse_turn_result_envelope(message, &["apply_patch".to_string()], 3, 6);
        assert_eq!(envelope.control, TurnControl::Done);
        assert_eq!(envelope.summary, "代码与测试均已完成");
        assert_eq!(envelope.next, "无");
    }

    /// 描述：验证最终结果载荷可从 JSON 包装格式正确解析出多行消息，保障 STATUS/SUMMARY/NEXT 协议完整透传。
    #[test]
    fn should_parse_json_wrapped_final_result_message() {
        let raw = r#"{"message":"STATUS: CONTINUE\nSUMMARY: 已完成需求分析\nNEXT: 进入 API 设计"}"#;
        let parsed = parse_final_result_message(raw);
        assert!(parsed.contains("STATUS: CONTINUE"));
        assert!(parsed.contains("SUMMARY: 已完成需求分析"));
        assert!(parsed.contains("NEXT: 进入 API 设计"));
    }

    /// 描述：验证最终结果载荷仍兼容历史纯文本格式，避免老数据解析回归。
    #[test]
    fn should_parse_legacy_plain_text_final_result_message() {
        let parsed = parse_final_result_message("执行完成（系统自动补全 finish）");
        assert_eq!(parsed, "执行完成（系统自动补全 finish）");
    }

    /// 描述：验证自动补全 finish 文案会被转换为可读总结，避免“执行完成（系统自动补全 finish）”污染执行流结果。
    #[test]
    fn should_normalize_auto_finish_summary_for_turn_result() {
        let message = "执行完成（系统自动补全 finish）";
        let envelope = parse_turn_result_envelope(message, &["write_text".to_string()], 2, 6);
        assert_eq!(envelope.control, TurnControl::Continue);
        assert!(envelope.summary.contains("本轮已执行 1 个工具动作"));
        assert!(envelope.summary.contains("系统自动收尾"));
    }

    /// 描述：验证多轮编排脚本提示词不再强制 PLAN 注释协议，避免前端展示固定模板化步骤。
    #[test]
    fn should_not_require_plan_comment_protocol_in_prompt() {
        let prompt = build_python_workflow_prompt("实现登录页面", Some("demo"), 1, 6, &[], &[]);
        assert!(!prompt.contains("# PLAN_TITLE:"));
        assert!(!prompt.contains("# PLAN_STEP_1:"));
        assert!(prompt.contains("STATUS: CONTINUE 或 DONE"));
        assert!(prompt.contains("严格只允许一个顶层 finish"));
        assert!(prompt.contains("tool_search(\"工具名\", 1)"));
        assert!(prompt.contains("mcp_tool"));
        assert!(prompt.contains("dcc_tool"));
        assert!(prompt.contains("plan_transfer"));
        assert!(prompt.contains("list_tools"));
        assert!(prompt.contains("read_text(path)  # 默认返回文件 content 字符串"));
        assert!(prompt.contains("todo_write(items)"));
        assert!(prompt.contains("禁止 todo_write(\"A\", \"B\")"));
    }

    /// 描述：验证本轮描述提示词包含“仅返回口语化描述”约束，确保执行流先显示任务意图再执行步骤。
    #[test]
    fn should_build_round_description_prompt_with_natural_language_constraints() {
        let prompt = build_round_description_prompt("实现登录页面", Some("demo"), 1, 6, &[]);
        assert!(prompt.contains("本次仅输出“本轮任务描述”"));
        assert!(prompt.contains("禁止输出代码"));
    }

    /// 描述：验证等待模型返回时会拼装阶段语义与底层 provider 细节，避免前端只能看到笼统占位文案。
    #[test]
    fn should_build_llm_waiting_heartbeat_message_with_progress_detail() {
        let message = build_llm_waiting_heartbeat_message(
            "正在确认本次操作所需的工具链与任务顺序…",
            "Gemini CLI 已启动，正在等待首个响应分片…",
        );
        assert!(message.contains("正在确认本次操作所需的工具链与任务顺序"));
        assert!(message.contains("Gemini CLI 已启动"));
    }

    /// 描述：验证等待模型返回时在 provider 没有补充细节的情况下，会回退到阶段默认文案。
    #[test]
    fn should_fallback_to_default_waiting_message_when_progress_detail_is_empty() {
        let message =
            build_llm_waiting_heartbeat_message("正在等待模型返回可执行脚本的首个片段…", "   ");
        assert_eq!(message, "正在等待模型返回可执行脚本的首个片段…");
    }

    /// 描述：验证 Python 编排提示词会注入已启用 MCP 摘要，避免模型看不到外部能力入口。
    #[test]
    fn should_include_registered_mcp_context_in_prompt() {
        let prompt = build_python_workflow_prompt(
            "同步 Apifox 接口",
            Some("demo"),
            1,
            6,
            &[],
            &[AgentRegisteredMcp {
                id: "apifox-official".to_string(),
                name: "Apifox 官方 MCP".to_string(),
                domain: "general".to_string(),
                software: "".to_string(),
                capabilities: Vec::new(),
                priority: 0,
                supports_import: false,
                supports_export: false,
                transport: "stdio".to_string(),
                command: "/tmp/apifox-mcp".to_string(),
                args: Vec::new(),
                env: std::collections::HashMap::new(),
                cwd: "".to_string(),
                url: "".to_string(),
                headers: std::collections::HashMap::new(),
                runtime_kind: "apifox_runtime".to_string(),
                official_provider: "Apifox".to_string(),
                runtime_ready: true,
                runtime_hint: None,
            }],
        );
        assert!(prompt.contains("当前已启用的 MCP"));
        assert!(prompt.contains("apifox-official"));
        assert!(prompt.contains("Apifox 官方 MCP"));
    }

    /// 描述：验证未闭合三引号字符串会在顶层 finish(...) 前自动补齐，避免 finish 被吞进字符串导致 SyntaxError。
    #[test]
    fn should_repair_unterminated_triple_quote_before_finish_line() {
        let script = r##"
write_text("api_design.md", """# API 数据模型
- 字段: id
finish("STATUS: CONTINUE\nSUMMARY: ok\nNEXT: next")
"##;
        let repaired = repair_unterminated_python_string_literals(script);
        assert!(repaired.contains("\n\"\"\"\nfinish(\"STATUS: CONTINUE"));
    }

    /// 描述：验证脚本末尾未闭合三引号字符串会自动在尾部补齐，避免解释器直接抛出 unterminated 错误。
    #[test]
    fn should_append_missing_triple_quote_at_script_end() {
        let script = r##"
write_text("api_design.md", """# API 数据模型
- 字段: id
"##;
        let repaired = repair_unterminated_python_string_literals(script);
        assert!(repaired.trim_end().ends_with("\"\"\""));
    }

    /// 描述：验证脚本出现多个顶层 finish(...) 时，仅保留第一个 finish 之前的内容，确保单轮只执行一个子任务。
    #[test]
    fn should_truncate_script_after_first_top_level_finish() {
        let script = r#"
print("round-1")
finish("STATUS: CONTINUE\nSUMMARY: 第一轮完成\nNEXT: 第二轮")
print("round-2")
finish("STATUS: DONE\nSUMMARY: 第二轮完成\nNEXT: 无")
"#;
        let normalized = truncate_script_after_first_top_level_finish(script);
        assert!(normalized.contains("round-1"));
        assert!(normalized.contains("第一轮完成"));
        assert!(!normalized.contains("round-2"));
        assert!(!normalized.contains("第二轮完成"));
        assert_eq!(normalized.matches("finish(").count(), 1);
    }

    /// 描述：验证首个 finish(...) 为跨行三引号字符串时仍会完整保留，避免被截断导致 SyntaxError。
    #[test]
    fn should_keep_multiline_finish_call_without_truncating_string_body() {
        let script = r#"
print("round-1")
finish(f"""STATUS: CONTINUE
SUMMARY: 第一轮完成
NEXT: 第二轮""")
print("round-2")
finish("STATUS: DONE\nSUMMARY: 第二轮完成\nNEXT: 无")
"#;
        let normalized = truncate_script_after_first_top_level_finish(script);
        assert!(normalized.contains("round-1"));
        assert!(normalized.contains("STATUS: CONTINUE"));
        assert!(normalized.contains("SUMMARY: 第一轮完成"));
        assert!(normalized.contains("NEXT: 第二轮\"\"\")"));
        assert!(!normalized.contains("round-2"));
        assert!(!normalized.contains("第二轮完成"));
        assert_eq!(normalized.matches("finish(").count(), 1);
    }

    /// 描述：验证短标题式 round 描述会自动扩展为口语化句子，避免展示“需求分析与定义”这类生硬标题。
    #[test]
    fn should_expand_short_round_description_into_conversational_sentence() {
        let description = normalize_round_description("需求分析与定义", 2);
        assert!(description.contains("我会先围绕"));
        assert!(description.contains("需求分析与定义"));
    }

    /// 描述：验证工具参数预览会裁剪超长 content，避免把大文本直接推给前端流事件。
    #[test]
    fn should_truncate_large_tool_args_preview() {
        let args = json!({
            "path": "docs/design/requirements.md",
            "content": "A".repeat(5000),
        });
        let preview = build_tool_args_stream_preview(&args, 800);
        assert!(preview.contains("content_preview"));
        assert!(preview.contains("content_length"));
        assert!(preview.chars().count() <= 801);
    }

    /// 描述：验证 write_text 结果流包含 content_preview，确保前端“已编辑”详情可直接展示写入后的文件文本。
    #[test]
    fn should_include_write_text_content_preview_in_result_stream_data() {
        let result_data = json!({
            "path": "/tmp/demo.md",
            "bytes": 12,
            "added_lines": 3,
            "removed_lines": 1,
            "diff_preview": "--- a\n+++ b\n+hello",
        });
        let tool_args = json!({
            "path": "/tmp/demo.md",
            "content": "# 标题\n- 列表项\n",
        });
        let stream_data =
            build_tool_result_stream_data("write_text", true, &result_data, &tool_args, None);
        assert_eq!(
            stream_data.get("path").and_then(|item| item.as_str()),
            Some("/tmp/demo.md")
        );
        assert_eq!(
            stream_data
                .get("content_preview")
                .and_then(|item| item.as_str()),
            Some("# 标题\n- 列表项\n")
        );
    }
}
