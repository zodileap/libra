mod audit;

use audit::{content_length_meta, AuditContext, AuditRecord, RuntimeAuditLogger};
use futures::Stream;
use libra_agent_core::llm::{
    call_model_with_policy_and_config, parse_provider, LlmGatewayPolicy, LlmProviderConfig,
};
use libra_agent_core::{
    detect_agent_runtime_capabilities, AgentExecutionMode, AgentRegisteredMcp, AgentRunRequest,
    AgentRuntimeCapabilities, AgentStreamEvent, ApprovalOutcome, QuestionOption, QuestionPrompt,
    UserInputAnswer, UserInputResolution,
};
use libra_mcp_common::{
    ProtocolAssetRecord, ProtocolError, ProtocolEventRecord, ProtocolStepRecord, ProtocolUiHint,
    ProtocolUiHintAction,
};
use libra_runtime_proto::runtime::runtime_service_server::{RuntimeService, RuntimeServiceServer};
use libra_runtime_proto::runtime::{
    self, AgentRunResult, CallModelRequest, CallModelResponse, CancelRunRequest, CancelRunResponse,
    CreateMessageRequest, CreateMessageResponse, CreatePreviewRequest, CreatePreviewResponse,
    CreateSandboxRequest, CreateSandboxResponse, CreateSessionRequest, CreateSessionResponse,
    DetectCapabilitiesRequest, DetectCapabilitiesResponse, ExpirePreviewRequest,
    ExpirePreviewResponse, GetSandboxMetricsRequest, GetSandboxMetricsResponse, GetSessionRequest,
    GetSessionResponse, HealthRequest, HealthResponse, ListMessagesRequest, ListMessagesResponse,
    ListPreviewsRequest, ListPreviewsResponse, ListSandboxesRequest, ListSandboxesResponse,
    ListSessionsRequest, ListSessionsResponse, LlmUsage, ProtocolAssetRecord as ProtoAssetRecord,
    ProtocolErrorRecord as ProtoErrorRecord, ProtocolEventRecord as ProtoEventRecord,
    ProtocolStepRecord as ProtoStepRecord, ProtocolUiHint as ProtoUiHint,
    ProtocolUiHintAction as ProtoUiHintAction, QuestionOption as ProtoQuestionOption,
    QuestionPrompt as ProtoQuestionPrompt, RecycleSandboxRequest, RecycleSandboxResponse,
    RegisteredMcp, ResetSandboxRequest, ResetSandboxResponse, RunControlRequest, RunEvent,
    RunStartRequest, RuntimeCapabilities, RuntimeContext, RuntimeSessionRecord, SandboxMetrics,
    SubmitApprovalRequest, SubmitApprovalResponse, SubmitUserInputRequest, SubmitUserInputResponse,
    UpdateSessionStatusRequest, UpdateSessionStatusResponse,
    UserInputAnswer as ProtoUserInputAnswer,
};
use libra_runtime_store::{RuntimeStore, RuntimeStoreError};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::{mpsc, oneshot};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{transport::Server, Request, Response, Status};
use tracing::warn;
use uuid::Uuid;

/// 描述：runtime 服务配置，统一承载监听地址、数据目录与运行时标识。
#[derive(Debug, Clone)]
pub struct RuntimeServerConfig {
    pub addr: SocketAddr,
    pub data_dir: PathBuf,
    pub runtime_id: String,
}

impl RuntimeServerConfig {
    /// 描述：基于监听地址和数据目录创建 runtime 服务配置。
    pub fn new(addr: SocketAddr, data_dir: impl Into<PathBuf>) -> Self {
        Self {
            addr,
            data_dir: data_dir.into(),
            runtime_id: format!("runtime-{}", Uuid::new_v4().simple()),
        }
    }
}

/// 描述：嵌入式 runtime 服务句柄，允许宿主在当前进程内启动与关闭统一 runtime。
pub struct EmbeddedRuntimeHandle {
    pub addr: SocketAddr,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl EmbeddedRuntimeHandle {
    /// 描述：关闭嵌入式 runtime 服务。
    pub async fn shutdown(mut self) {
        libra_agent_core::tools::shell::cleanup_all_resident_processes();
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// 描述：运行时 gRPC 服务实现，负责协议映射、执行编排与状态持久化。
#[derive(Clone)]
pub struct RuntimeServiceImpl {
    store: RuntimeStore,
    audit: RuntimeAuditLogger,
    runtime_id: String,
    cancelled_sessions: Arc<Mutex<HashSet<String>>>,
    active_session_runs: Arc<Mutex<HashMap<String, SessionRunPhase>>>,
}

/// 描述：标记同一 session_id 当前运行所处的生命周期阶段，避免二次 run 被静默挂起。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SessionRunPhase {
    Preparing,
    Running,
    Closing,
}

impl SessionRunPhase {
    /// 描述：返回用户可读的阶段描述，供冲突错误提示复用。
    fn label(&self) -> &'static str {
        match self {
            Self::Preparing => "准备",
            Self::Running => "执行",
            Self::Closing => "收尾",
        }
    }
}

/// 描述：持有同会话运行注册表租约，并在任务结束时统一释放 session 占用。
#[derive(Debug)]
struct SessionRunLease {
    registry: Arc<Mutex<HashMap<String, SessionRunPhase>>>,
    session_id: String,
}

impl SessionRunLease {
    /// 描述：更新当前会话运行所处的生命周期阶段。
    fn set_phase(&self, phase: SessionRunPhase) {
        if let Ok(mut guard) = self.registry.lock() {
            if let Some(entry) = guard.get_mut(self.session_id.as_str()) {
                *entry = phase;
            }
        }
    }
}

impl Drop for SessionRunLease {
    /// 描述：在租约释放时移除会话占用，避免历史运行状态阻塞后续新任务。
    fn drop(&mut self) {
        if let Ok(mut guard) = self.registry.lock() {
            guard.remove(self.session_id.as_str());
        }
    }
}

impl RuntimeServiceImpl {
    /// 描述：基于 runtime 数据目录创建 gRPC 服务实现。
    pub fn open(data_dir: &Path, runtime_id: impl Into<String>) -> Result<Self, RuntimeStoreError> {
        let runtime_id = runtime_id.into();
        let audit = RuntimeAuditLogger::open(data_dir, runtime_id.clone()).map_err(|err| {
            RuntimeStoreError::new(format!("初始化 runtime 审计日志失败: {}", err))
        })?;
        let store = match RuntimeStore::open(data_dir) {
            Ok(store) => {
                let _ = audit.log(AuditRecord {
                    level: "info".to_string(),
                    category: "runtime".to_string(),
                    event: "sqlite_opened".to_string(),
                    context: AuditContext::default(),
                    status: "ready".to_string(),
                    tool_name: String::new(),
                    duration_ms: None,
                    error_code: String::new(),
                    error_message: String::new(),
                    summary: "runtime sqlite store ready".to_string(),
                    meta: json!({
                        "data_dir": data_dir.display().to_string(),
                        "db_path": store.db_path().display().to_string(),
                        "version": env!("CARGO_PKG_VERSION"),
                    }),
                });
                store
            }
            Err(err) => {
                let _ = audit.log(AuditRecord {
                    level: "error".to_string(),
                    category: "runtime".to_string(),
                    event: "sqlite_open_failed".to_string(),
                    context: AuditContext::default(),
                    status: "failed".to_string(),
                    tool_name: String::new(),
                    duration_ms: None,
                    error_code: "runtime.store.open_failed".to_string(),
                    error_message: err.to_string(),
                    summary: "runtime sqlite store open failed".to_string(),
                    meta: json!({
                        "data_dir": data_dir.display().to_string(),
                        "version": env!("CARGO_PKG_VERSION"),
                    }),
                });
                return Err(err);
            }
        };
        Ok(Self {
            store,
            audit,
            runtime_id,
            cancelled_sessions: Arc::new(Mutex::new(HashSet::new())),
            active_session_runs: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// 描述：标记会话已被宿主取消，供错误归一化阶段把沙盒中断翻译为用户主动取消。
    fn mark_cancelled(&self, session_id: &str) {
        if session_id.trim().is_empty() {
            return;
        }
        if let Ok(mut guard) = self.cancelled_sessions.lock() {
            guard.insert(session_id.trim().to_string());
        }
    }

    /// 描述：消费会话取消标记，避免历史取消状态影响后续新任务。
    fn take_cancelled(&self, session_id: &str) -> bool {
        if session_id.trim().is_empty() {
            return false;
        }
        if let Ok(mut guard) = self.cancelled_sessions.lock() {
            return guard.remove(session_id.trim());
        }
        false
    }

    /// 描述：为给定会话注册一条活动运行；若同会话已有任务在准备、执行或收尾阶段，则立即返回结构化冲突错误。
    fn begin_session_run(&self, session_id: &str) -> Result<SessionRunLease, ProtocolError> {
        let normalized_session_id = session_id.trim();
        let mut guard = self.active_session_runs.lock().map_err(|_| {
            ProtocolError::new(
                "runtime.session.registry_lock_failed",
                "会话运行注册表锁获取失败",
            )
            .with_suggestion("请稍后重试。")
            .with_retryable(true)
        })?;
        if let Some(existing) = guard.get(normalized_session_id) {
            return Err(ProtocolError::new(
                "runtime.session.run_conflict",
                format!("当前会话已有任务处于{}阶段，请稍后重试。", existing.label()),
            )
            .with_suggestion("如需重新发起，请等待当前任务结束，或先取消当前任务。")
            .with_retryable(true));
        }
        guard.insert(
            normalized_session_id.to_string(),
            SessionRunPhase::Preparing,
        );
        Ok(SessionRunLease {
            registry: Arc::clone(&self.active_session_runs),
            session_id: normalized_session_id.to_string(),
        })
    }

    /// 描述：写入审计日志，并在审计写入失败时退化到宿主 stderr，避免业务主流程被日志错误阻塞。
    fn audit_log(&self, record: AuditRecord) {
        if let Err(err) = self.audit.log(record) {
            warn!("runtime audit log failed: {}", err);
        }
    }

    /// 描述：记录 runtime 启停事件，统一复用监听地址、数据目录与版本元信息。
    fn audit_runtime_server_event(
        &self,
        event: &str,
        status: &str,
        addr: SocketAddr,
        data_dir: &Path,
        error_message: Option<&str>,
    ) {
        let mut record = if error_message.is_some() {
            AuditRecord::error("runtime", event)
        } else {
            AuditRecord::info("runtime", event)
        };
        record.status = status.to_string();
        record.error_code = if error_message.is_some() {
            "runtime.server.lifecycle_failed".to_string()
        } else {
            String::new()
        };
        record.error_message = error_message.unwrap_or("").to_string();
        record.summary = format!("runtime server {}", event);
        record.meta = json!({
            "addr": addr.to_string(),
            "data_dir": data_dir.display().to_string(),
            "version": env!("CARGO_PKG_VERSION"),
            "audit_log_path": self.audit.path().display().to_string(),
        });
        self.audit_log(record);
    }

    /// 描述：构造统一审计上下文，保证 run 与控制流日志都能带上固定关联字段。
    fn build_audit_context(
        &self,
        context: &RuntimeContext,
        session_id: &str,
        run_id: &str,
        trace_id: &str,
    ) -> AuditContext {
        AuditContext {
            tenant_id: context.tenant_id.trim().to_string(),
            user_id: context.user_id.trim().to_string(),
            project_id: context.project_id.trim().to_string(),
            session_id: session_id.trim().to_string(),
            run_id: run_id.trim().to_string(),
            trace_id: trace_id.trim().to_string(),
        }
    }

    /// 描述：记录运行流上的工具与交互事件，只落结构化摘要，不写入原始全文内容。
    fn audit_stream_event(&self, context: &AuditContext, event: &AgentStreamEvent) {
        match event {
            AgentStreamEvent::ToolCallStarted {
                name, args_data, ..
            } => {
                self.audit_log(AuditRecord {
                    level: "info".to_string(),
                    category: "tool".to_string(),
                    event: "tool_call_started".to_string(),
                    context: context.clone(),
                    status: "running".to_string(),
                    tool_name: name.clone(),
                    duration_ms: None,
                    error_code: String::new(),
                    error_message: String::new(),
                    summary: "tool call started".to_string(),
                    meta: json!({
                        "arg_keys": json_value_keys(args_data),
                        "arg_key_count": json_value_keys(args_data).len(),
                    }),
                });
            }
            AgentStreamEvent::ToolCallFinished {
                name,
                ok,
                result,
                result_data,
                ..
            } => {
                self.audit_log(AuditRecord {
                    level: if *ok {
                        "info".to_string()
                    } else {
                        "error".to_string()
                    },
                    category: "tool".to_string(),
                    event: "tool_call_finished".to_string(),
                    context: context.clone(),
                    status: if *ok {
                        "succeeded".to_string()
                    } else {
                        "failed".to_string()
                    },
                    tool_name: name.clone(),
                    duration_ms: None,
                    error_code: String::new(),
                    error_message: String::new(),
                    summary: "tool call finished".to_string(),
                    meta: json!({
                        "result_chars": result.chars().count(),
                        "result_key_count": json_value_keys(result_data).len(),
                        "result_keys": json_value_keys(result_data),
                    }),
                });
            }
            AgentStreamEvent::ResidentProcessState {
                process_id,
                name,
                status,
                pid,
                exit_code,
                ..
            } => {
                self.audit_log(AuditRecord {
                    level: "info".to_string(),
                    category: "resident_process".to_string(),
                    event: "resident_process_state".to_string(),
                    context: context.clone(),
                    status: status.clone(),
                    tool_name: name.clone(),
                    duration_ms: None,
                    error_code: String::new(),
                    error_message: String::new(),
                    summary: "resident process state changed".to_string(),
                    meta: json!({
                        "process_id": process_id,
                        "pid": pid,
                        "exit_code": exit_code,
                    }),
                });
            }
            AgentStreamEvent::ResidentProcessLog {
                process_id,
                name,
                stream,
                text,
                sequence,
                ..
            } => {
                self.audit_log(AuditRecord {
                    level: "info".to_string(),
                    category: "resident_process".to_string(),
                    event: "resident_process_log".to_string(),
                    context: context.clone(),
                    status: "running".to_string(),
                    tool_name: name.clone(),
                    duration_ms: None,
                    error_code: String::new(),
                    error_message: String::new(),
                    summary: "resident process log received".to_string(),
                    meta: json!({
                        "process_id": process_id,
                        "stream": stream,
                        "sequence": sequence,
                        "chars": text.chars().count(),
                    }),
                });
            }
            AgentStreamEvent::RequireApproval {
                approval_id,
                tool_name,
                ..
            } => {
                self.audit_log(AuditRecord {
                    level: "info".to_string(),
                    category: "control".to_string(),
                    event: "approval_requested".to_string(),
                    context: context.clone(),
                    status: "waiting".to_string(),
                    tool_name: tool_name.clone(),
                    duration_ms: None,
                    error_code: String::new(),
                    error_message: String::new(),
                    summary: "approval requested".to_string(),
                    meta: json!({
                        "approval_id": approval_id,
                    }),
                });
            }
            AgentStreamEvent::RequestUserInput {
                request_id,
                questions,
            } => {
                self.audit_log(AuditRecord {
                    level: "info".to_string(),
                    category: "control".to_string(),
                    event: "user_input_requested".to_string(),
                    context: context.clone(),
                    status: "waiting".to_string(),
                    tool_name: String::new(),
                    duration_ms: None,
                    error_code: String::new(),
                    error_message: String::new(),
                    summary: "user input requested".to_string(),
                    meta: json!({
                        "request_id": request_id,
                        "question_count": questions.len(),
                        "question_ids": questions.iter().map(|item| item.id.clone()).collect::<Vec<_>>(),
                    }),
                });
            }
            AgentStreamEvent::Error { code, message } => {
                self.audit_log(AuditRecord {
                    level: "error".to_string(),
                    category: "run".to_string(),
                    event: "run_stream_error".to_string(),
                    context: context.clone(),
                    status: "failed".to_string(),
                    tool_name: String::new(),
                    duration_ms: None,
                    error_code: code.clone(),
                    error_message: message.clone(),
                    summary: "runtime stream emitted error".to_string(),
                    meta: Value::Null,
                });
            }
            AgentStreamEvent::Cancelled { message } => {
                self.audit_log(AuditRecord {
                    level: "info".to_string(),
                    category: "run".to_string(),
                    event: "run_stream_cancelled".to_string(),
                    context: context.clone(),
                    status: "cancelled".to_string(),
                    tool_name: String::new(),
                    duration_ms: None,
                    error_code: String::new(),
                    error_message: sanitize_log_text(message.as_str(), 120),
                    summary: "runtime stream emitted cancelled".to_string(),
                    meta: Value::Null,
                });
            }
            AgentStreamEvent::Final { message } => {
                self.audit_log(AuditRecord {
                    level: "info".to_string(),
                    category: "run".to_string(),
                    event: "run_stream_final".to_string(),
                    context: context.clone(),
                    status: "done".to_string(),
                    tool_name: String::new(),
                    duration_ms: None,
                    error_code: String::new(),
                    error_message: String::new(),
                    summary: "runtime stream emitted final".to_string(),
                    meta: content_length_meta("final_message", message.as_str()),
                });
            }
            _ => {}
        }
    }
}

/// 描述：启动独立的 runtime gRPC 服务并阻塞等待结束，供 sidecar 二进制复用。
pub async fn serve(config: RuntimeServerConfig) -> Result<(), Box<dyn std::error::Error>> {
    let service = RuntimeServiceImpl::open(config.data_dir.as_path(), config.runtime_id)?;
    service.audit_runtime_server_event(
        "server_started",
        "listening",
        config.addr,
        config.data_dir.as_path(),
        None,
    );
    let result = Server::builder()
        .add_service(RuntimeServiceServer::new(service.clone()))
        .serve(config.addr)
        .await;
    match result {
        Ok(()) => {
            service.audit_runtime_server_event(
                "server_stopped",
                "stopped",
                config.addr,
                config.data_dir.as_path(),
                None,
            );
            Ok(())
        }
        Err(err) => {
            service.audit_runtime_server_event(
                "server_stopped",
                "failed",
                config.addr,
                config.data_dir.as_path(),
                Some(err.to_string().as_str()),
            );
            Err(Box::new(err))
        }
    }
}

/// 描述：在当前进程内后台启动 runtime 服务，供 Desktop 这类宿主直接复用统一协议层。
pub async fn start_embedded(
    config: RuntimeServerConfig,
) -> Result<EmbeddedRuntimeHandle, Box<dyn std::error::Error>> {
    let service = RuntimeServiceImpl::open(config.data_dir.as_path(), config.runtime_id)?;
    let addr = config.addr;
    let data_dir = config.data_dir.clone();
    service.audit_runtime_server_event(
        "embedded_started",
        "listening",
        addr,
        data_dir.as_path(),
        None,
    );
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let result = Server::builder()
            .add_service(RuntimeServiceServer::new(service.clone()))
            .serve_with_shutdown(addr, async move {
                let _ = shutdown_rx.await;
            })
            .await;
        match result {
            Ok(()) => {
                service.audit_runtime_server_event(
                    "embedded_stopped",
                    "stopped",
                    addr,
                    data_dir.as_path(),
                    None,
                );
            }
            Err(err) => {
                service.audit_runtime_server_event(
                    "embedded_stopped",
                    "failed",
                    addr,
                    data_dir.as_path(),
                    Some(err.to_string().as_str()),
                );
                warn!("runtime embedded server exited with error: {}", err);
            }
        }
    });
    Ok(EmbeddedRuntimeHandle {
        addr,
        shutdown_tx: Some(shutdown_tx),
    })
}

type RunEventStream = Pin<Box<dyn Stream<Item = Result<RunEvent, Status>> + Send + 'static>>;

#[tonic::async_trait]
impl RuntimeService for RuntimeServiceImpl {
    type RunStream = RunEventStream;

    /// 描述：返回 runtime 健康状态，供宿主启动探测与版本匹配复用。
    async fn health(
        &self,
        _request: Request<HealthRequest>,
    ) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse {
            version: env!("CARGO_PKG_VERSION").to_string(),
            runtime_id: self.runtime_id.clone(),
            ready: true,
        }))
    }

    /// 描述：根据宿主传入的 MCP 快照计算运行时能力，统一复用 core 的探测逻辑。
    async fn detect_capabilities(
        &self,
        request: Request<DetectCapabilitiesRequest>,
    ) -> Result<Response<DetectCapabilitiesResponse>, Status> {
        let mcps = request
            .into_inner()
            .available_mcps
            .iter()
            .map(proto_registered_mcp_to_core)
            .collect::<Vec<_>>();
        let capabilities = detect_agent_runtime_capabilities(mcps.as_slice());
        Ok(Response::new(DetectCapabilitiesResponse {
            capabilities: Some(core_runtime_capabilities_to_proto(&capabilities)),
        }))
    }

    /// 描述：创建新会话，并把跨语言宿主传入的上下文直接落到 runtime SQLite。
    async fn create_session(
        &self,
        request: Request<CreateSessionRequest>,
    ) -> Result<Response<CreateSessionResponse>, Status> {
        let payload = request.into_inner();
        let session = self
            .store
            .create_session(
                payload.tenant_id.as_str(),
                payload.user_id.as_str(),
                payload.project_id.as_str(),
                payload.agent_code.as_str(),
                payload.status,
            )
            .map_err(store_error_to_status)?;
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "session".to_string(),
            event: "session_created".to_string(),
            context: AuditContext {
                tenant_id: session.tenant_id.clone(),
                user_id: session.user_id.clone(),
                project_id: session.project_id.clone(),
                session_id: session.id.clone(),
                run_id: String::new(),
                trace_id: String::new(),
            },
            status: "created".to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime session created".to_string(),
            meta: json!({
                "agent_code": session.agent_code,
                "status": session.status,
            }),
        });
        Ok(Response::new(CreateSessionResponse {
            session: Some(session),
        }))
    }

    /// 描述：查询 runtime 内部持久化的会话列表。
    async fn list_sessions(
        &self,
        request: Request<ListSessionsRequest>,
    ) -> Result<Response<ListSessionsResponse>, Status> {
        let payload = request.into_inner();
        let list = self
            .store
            .list_sessions(
                empty_to_none(payload.tenant_id.as_str()),
                empty_to_none(payload.user_id.as_str()),
                empty_to_none(payload.project_id.as_str()),
                empty_to_none(payload.agent_code.as_str()),
                positive_i32_to_option(payload.status),
            )
            .map_err(store_error_to_status)?;
        Ok(Response::new(ListSessionsResponse { list }))
    }

    /// 描述：查询单个会话详情。
    async fn get_session(
        &self,
        request: Request<GetSessionRequest>,
    ) -> Result<Response<GetSessionResponse>, Status> {
        let payload = request.into_inner();
        let session = self
            .store
            .get_session(payload.session_id.as_str())
            .map_err(store_error_to_status)?
            .ok_or_else(|| Status::not_found("session not found"))?;
        Ok(Response::new(GetSessionResponse {
            session: Some(session),
        }))
    }

    /// 描述：更新指定会话状态，并把新状态回写到统一 SQLite 存储。
    async fn update_session_status(
        &self,
        request: Request<UpdateSessionStatusRequest>,
    ) -> Result<Response<UpdateSessionStatusResponse>, Status> {
        let payload = request.into_inner();
        let session = self
            .store
            .update_session_status(payload.session_id.as_str(), payload.status)
            .map_err(store_error_to_status)?;
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "session".to_string(),
            event: "session_status_updated".to_string(),
            context: AuditContext {
                tenant_id: session.tenant_id.clone(),
                user_id: session.user_id.clone(),
                project_id: session.project_id.clone(),
                session_id: session.id.clone(),
                run_id: String::new(),
                trace_id: String::new(),
            },
            status: session.status.to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime session status updated".to_string(),
            meta: Value::Null,
        });
        Ok(Response::new(UpdateSessionStatusResponse {
            session: Some(session),
        }))
    }

    /// 描述：创建会话消息，并保持消息写入和 session 最后活跃时间更新由 runtime 统一负责。
    async fn create_message(
        &self,
        request: Request<CreateMessageRequest>,
    ) -> Result<Response<CreateMessageResponse>, Status> {
        let payload = request.into_inner();
        let message = self
            .store
            .append_message(
                payload.session_id.as_str(),
                payload.user_id.as_str(),
                payload.role.as_str(),
                payload.content.as_str(),
            )
            .map_err(store_error_to_status)?;
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "message".to_string(),
            event: "message_created".to_string(),
            context: AuditContext {
                tenant_id: String::new(),
                user_id: message.user_id.clone(),
                project_id: String::new(),
                session_id: message.session_id.clone(),
                run_id: String::new(),
                trace_id: String::new(),
            },
            status: "created".to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime message created".to_string(),
            meta: json!({
                "role": message.role,
                "content_chars": payload.content.chars().count(),
            }),
        });
        Ok(Response::new(CreateMessageResponse {
            message: Some(message),
        }))
    }

    /// 描述：分页查询会话消息。
    async fn list_messages(
        &self,
        request: Request<ListMessagesRequest>,
    ) -> Result<Response<ListMessagesResponse>, Status> {
        let payload = request.into_inner();
        let result = self
            .store
            .list_messages(payload.session_id.as_str(), payload.page, payload.page_size)
            .map_err(store_error_to_status)?;
        Ok(Response::new(result))
    }

    /// 描述：查询 Sandbox 列表，供 services 保留既有 REST 查询面但底层统一改走 runtime SQLite。
    async fn list_sandboxes(
        &self,
        request: Request<ListSandboxesRequest>,
    ) -> Result<Response<ListSandboxesResponse>, Status> {
        let payload = request.into_inner();
        let list = self
            .store
            .list_sandboxes(
                empty_to_none(payload.sandbox_id.as_str()),
                empty_to_none(payload.session_id.as_str()),
            )
            .map_err(store_error_to_status)?;
        Ok(Response::new(ListSandboxesResponse { list }))
    }

    /// 描述：创建 Sandbox 记录，并确保会话侧的唯一持久化仍由 runtime 管理。
    async fn create_sandbox(
        &self,
        request: Request<CreateSandboxRequest>,
    ) -> Result<Response<CreateSandboxResponse>, Status> {
        let payload = request.into_inner();
        let sandbox = self
            .store
            .create_sandbox(
                payload.session_id.as_str(),
                payload.container_id.as_str(),
                payload.preview_url.as_str(),
                payload.status,
            )
            .map_err(store_error_to_status)?;
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "sandbox".to_string(),
            event: "sandbox_created".to_string(),
            context: AuditContext {
                tenant_id: String::new(),
                user_id: String::new(),
                project_id: String::new(),
                session_id: sandbox.session_id.clone(),
                run_id: String::new(),
                trace_id: String::new(),
            },
            status: "created".to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime sandbox created".to_string(),
            meta: json!({
                "container_id_set": !sandbox.container_id.is_empty(),
                "preview_url_set": !sandbox.preview_url.is_empty(),
            }),
        });
        Ok(Response::new(CreateSandboxResponse {
            sandbox: Some(sandbox),
        }))
    }

    /// 描述：回收一个或多个 Sandbox，并同步失效其关联 Preview。
    async fn recycle_sandbox(
        &self,
        request: Request<RecycleSandboxRequest>,
    ) -> Result<Response<RecycleSandboxResponse>, Status> {
        let payload = request.into_inner();
        let recycled_count = self
            .store
            .recycle_sandboxes(
                empty_to_none(payload.sandbox_id.as_str()),
                empty_to_none(payload.session_id.as_str()),
            )
            .map_err(store_error_to_status)?;
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "sandbox".to_string(),
            event: "sandbox_recycled".to_string(),
            context: AuditContext {
                tenant_id: String::new(),
                user_id: String::new(),
                project_id: String::new(),
                session_id: payload.session_id.clone(),
                run_id: String::new(),
                trace_id: String::new(),
            },
            status: if recycled_count > 0 {
                "recycled".to_string()
            } else {
                "noop".to_string()
            },
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime sandbox recycled".to_string(),
            meta: json!({
                "sandbox_id": payload.sandbox_id,
                "recycled_count": recycled_count,
            }),
        });
        Ok(Response::new(RecycleSandboxResponse {
            ok: recycled_count > 0,
            recycled_count,
        }))
    }

    /// 描述：查询 Preview 列表，供 services 继续保留现有查询路由。
    async fn list_previews(
        &self,
        request: Request<ListPreviewsRequest>,
    ) -> Result<Response<ListPreviewsResponse>, Status> {
        let payload = request.into_inner();
        let list = self
            .store
            .list_previews(
                empty_to_none(payload.preview_id.as_str()),
                empty_to_none(payload.sandbox_id.as_str()),
            )
            .map_err(store_error_to_status)?;
        Ok(Response::new(ListPreviewsResponse { list }))
    }

    /// 描述：创建 Preview 记录，并把过期时间计算统一收敛到 runtime 存储层。
    async fn create_preview(
        &self,
        request: Request<CreatePreviewRequest>,
    ) -> Result<Response<CreatePreviewResponse>, Status> {
        let payload = request.into_inner();
        let preview = self
            .store
            .create_preview(
                payload.sandbox_id.as_str(),
                payload.url.as_str(),
                payload.status,
                payload.expiration_secs,
            )
            .map_err(store_error_to_status)?;
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "preview".to_string(),
            event: "preview_created".to_string(),
            context: AuditContext {
                tenant_id: String::new(),
                user_id: String::new(),
                project_id: String::new(),
                session_id: String::new(),
                run_id: String::new(),
                trace_id: String::new(),
            },
            status: "created".to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime preview created".to_string(),
            meta: json!({
                "sandbox_id": preview.sandbox_id,
                "url_chars": preview.url.chars().count(),
                "expires_at_set": !preview.expires_at.is_empty(),
            }),
        });
        Ok(Response::new(CreatePreviewResponse {
            preview: Some(preview),
        }))
    }

    /// 描述：让一个或多个 Preview 失效，并返回实际失效数量。
    async fn expire_preview(
        &self,
        request: Request<ExpirePreviewRequest>,
    ) -> Result<Response<ExpirePreviewResponse>, Status> {
        let payload = request.into_inner();
        let expired_count = self
            .store
            .expire_previews(
                empty_to_none(payload.preview_id.as_str()),
                empty_to_none(payload.sandbox_id.as_str()),
            )
            .map_err(store_error_to_status)?;
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "preview".to_string(),
            event: "preview_expired".to_string(),
            context: AuditContext {
                tenant_id: String::new(),
                user_id: String::new(),
                project_id: String::new(),
                session_id: String::new(),
                run_id: String::new(),
                trace_id: String::new(),
            },
            status: if expired_count > 0 {
                "expired".to_string()
            } else {
                "noop".to_string()
            },
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime preview expired".to_string(),
            meta: json!({
                "preview_id": payload.preview_id,
                "sandbox_id": payload.sandbox_id,
                "expired_count": expired_count,
            }),
        });
        Ok(Response::new(ExpirePreviewResponse {
            ok: expired_count > 0,
            expired_count,
        }))
    }

    /// 描述：建立双向运行流；首条消息必须是 start_run，后续控制消息可用于取消、审批与用户输入。
    async fn run(
        &self,
        request: Request<tonic::Streaming<RunControlRequest>>,
    ) -> Result<Response<Self::RunStream>, Status> {
        let mut inbound = request.into_inner();
        let first = match inbound.message().await {
            Ok(Some(first)) => first,
            Ok(None) => {
                self.audit_log(AuditRecord {
                    level: "error".to_string(),
                    category: "grpc".to_string(),
                    event: "run_start_missing".to_string(),
                    context: AuditContext::default(),
                    status: "rejected".to_string(),
                    tool_name: String::new(),
                    duration_ms: None,
                    error_code: "runtime.grpc.missing_start_run".to_string(),
                    error_message: "missing start_run payload".to_string(),
                    summary: "run stream missing first start_run payload".to_string(),
                    meta: Value::Null,
                });
                return Err(Status::invalid_argument("missing start_run payload"));
            }
            Err(err) => {
                self.audit_log(AuditRecord {
                    level: "error".to_string(),
                    category: "grpc".to_string(),
                    event: "run_start_receive_failed".to_string(),
                    context: AuditContext::default(),
                    status: "failed".to_string(),
                    tool_name: String::new(),
                    duration_ms: None,
                    error_code: "runtime.grpc.start_receive_failed".to_string(),
                    error_message: err.to_string(),
                    summary: "failed to receive first run control frame".to_string(),
                    meta: Value::Null,
                });
                return Err(Status::internal(err.to_string()));
            }
        };
        let start = match first.payload {
            Some(runtime::run_control_request::Payload::StartRun(start)) => start,
            _ => {
                self.audit_log(AuditRecord {
                    level: "error".to_string(),
                    category: "grpc".to_string(),
                    event: "run_start_invalid_payload".to_string(),
                    context: AuditContext::default(),
                    status: "rejected".to_string(),
                    tool_name: String::new(),
                    duration_ms: None,
                    error_code: "runtime.grpc.invalid_start_run".to_string(),
                    error_message: "first run control message must be start_run".to_string(),
                    summary: "run stream first frame is not start_run".to_string(),
                    meta: Value::Null,
                });
                return Err(Status::invalid_argument(
                    "first run control message must be start_run",
                ));
            }
        };

        let context = start.context.clone().ok_or_else(|| {
            self.audit_log(AuditRecord {
                level: "error".to_string(),
                category: "grpc".to_string(),
                event: "run_context_missing".to_string(),
                context: AuditContext::default(),
                status: "rejected".to_string(),
                tool_name: String::new(),
                duration_ms: None,
                error_code: "runtime.grpc.missing_context".to_string(),
                error_message: "missing runtime context".to_string(),
                summary: "run stream start payload missing runtime context".to_string(),
                meta: Value::Null,
            });
            Status::invalid_argument("missing runtime context")
        })?;
        let tenant_id = context.tenant_id.trim().to_string();
        let user_id = context.user_id.trim().to_string();
        let project_id = context.project_id.trim().to_string();
        let normalized_session_id = if context.session_id.trim().is_empty() {
            new_runtime_id("session")
        } else {
            context.session_id.trim().to_string()
        };
        let run_id = if context.run_id.trim().is_empty() {
            new_runtime_id("run")
        } else {
            context.run_id.trim().to_string()
        };
        let trace_id = if context.trace_id.trim().is_empty() {
            format!("trace-{}", run_id)
        } else {
            context.trace_id.trim().to_string()
        };
        let audit_context = self.build_audit_context(
            &context,
            normalized_session_id.as_str(),
            run_id.as_str(),
            trace_id.as_str(),
        );
        let run_started_at = Instant::now();
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "grpc".to_string(),
            event: "run_start_received".to_string(),
            context: audit_context.clone(),
            status: "received".to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime run start received".to_string(),
            meta: json!({
                "session_id": normalized_session_id.as_str(),
                "agent_key": start.agent_key.as_str(),
                "provider": start.provider.as_str(),
                "execution_mode": start.execution_mode.as_str(),
                "prompt_chars": start.prompt.chars().count(),
                "provider_model_set": !start.provider_model.is_empty(),
                "provider_mode_set": !start.provider_mode.is_empty(),
                "provider_api_key_set": !start.provider_api_key.is_empty(),
                "workdir_set": !start.workdir.is_empty(),
                "output_dir_set": !start.output_dir.is_empty(),
            }),
        });
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "grpc".to_string(),
            event: "run_stream_opened".to_string(),
            context: audit_context.clone(),
            status: "accepted".to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime run stream accepted".to_string(),
            meta: json!({
                "session_id": normalized_session_id.as_str(),
                "run_id": run_id.as_str(),
                "trace_id": trace_id.as_str(),
            }),
        });

        let (event_tx, event_rx) = mpsc::channel::<Result<RunEvent, Status>>(64);
        let control_service = self.clone();
        let session_id_for_control = normalized_session_id.clone();
        let audit_context_for_control = audit_context.clone();
        tokio::spawn(async move {
            loop {
                let next = inbound.message().await;
                match next {
                    Ok(Some(control)) => {
                        if let Err(err) = apply_control_message(
                            &control_service,
                            control,
                            session_id_for_control.as_str(),
                            &audit_context_for_control,
                        )
                        .await
                        {
                            control_service.audit_log(AuditRecord {
                                level: "error".to_string(),
                                category: "control".to_string(),
                                event: "run_control_apply_failed".to_string(),
                                context: audit_context_for_control.clone(),
                                status: "failed".to_string(),
                                tool_name: String::new(),
                                duration_ms: None,
                                error_code: "runtime.control.apply_failed".to_string(),
                                error_message: err.to_string(),
                                summary: "runtime control message apply failed".to_string(),
                                meta: Value::Null,
                            });
                            warn!("runtime control message failed: {}", err);
                        }
                    }
                    Ok(None) => break,
                    Err(err) => {
                        control_service.audit_log(AuditRecord {
                            level: "error".to_string(),
                            category: "grpc".to_string(),
                            event: "run_control_receive_failed".to_string(),
                            context: audit_context_for_control.clone(),
                            status: "failed".to_string(),
                            tool_name: String::new(),
                            duration_ms: None,
                            error_code: "runtime.grpc.control_receive_failed".to_string(),
                            error_message: err.to_string(),
                            summary: "runtime inbound control stream failed".to_string(),
                            meta: Value::Null,
                        });
                        warn!("runtime inbound stream failed: {}", err);
                        break;
                    }
                }
            }
        });

        let run_service = self.clone();
        let audit_context_for_run = audit_context.clone();
        let session_id_for_run = normalized_session_id.clone();
        let run_id_for_run = run_id.clone();
        let trace_id_for_run = trace_id.clone();
        let tenant_id_for_run = tenant_id.clone();
        let user_id_for_run = user_id.clone();
        let project_id_for_run = project_id.clone();
        let start_for_run = start.clone();
        tokio::task::spawn_blocking(move || {
            let emit = |event: RunEvent| {
                let _ = event_tx.blocking_send(Ok(event));
            };

            let session_run_lease = match run_service.begin_session_run(session_id_for_run.as_str())
            {
                Ok(lease) => lease,
                Err(err) => {
                    run_service.audit_log(AuditRecord {
                        level: "error".to_string(),
                        category: "run".to_string(),
                        event: "run_session_conflict".to_string(),
                        context: audit_context_for_run.clone(),
                        status: "rejected".to_string(),
                        tool_name: String::new(),
                        duration_ms: None,
                        error_code: err.code.clone(),
                        error_message: err.message.clone(),
                        summary: "runtime run rejected due to active session conflict".to_string(),
                        meta: json!({
                            "session_id": session_id_for_run.as_str(),
                        }),
                    });
                    emit(protocol_error_to_run_event(
                        trace_id_for_run.as_str(),
                        session_id_for_run.as_str(),
                        &err,
                    ));
                    return;
                }
            };

            let prepare_started_at = Instant::now();
            run_service.audit_log(AuditRecord {
                level: "info".to_string(),
                category: "run".to_string(),
                event: "run_session_prepare_started".to_string(),
                context: audit_context_for_run.clone(),
                status: "preparing".to_string(),
                tool_name: String::new(),
                duration_ms: None,
                error_code: String::new(),
                error_message: String::new(),
                summary: "runtime run session prepare started".to_string(),
                meta: json!({
                    "session_id": session_id_for_run.as_str(),
                    "run_id": run_id_for_run.as_str(),
                }),
            });

            let session = match run_service.store.ensure_session(
                tenant_id_for_run.as_str(),
                user_id_for_run.as_str(),
                project_id_for_run.as_str(),
                session_id_for_run.as_str(),
                start_for_run.agent_key.as_str(),
            ) {
                Ok(session) => session,
                Err(err) => {
                    let protocol_error = store_error_to_protocol_error(err);
                    session_run_lease.set_phase(SessionRunPhase::Closing);
                    run_service.audit_log(AuditRecord {
                        level: "error".to_string(),
                        category: "run".to_string(),
                        event: "run_session_prepare_failed".to_string(),
                        context: audit_context_for_run.clone(),
                        status: "failed".to_string(),
                        tool_name: String::new(),
                        duration_ms: Some(prepare_started_at.elapsed().as_millis() as u64),
                        error_code: protocol_error.code.clone(),
                        error_message: protocol_error.message.clone(),
                        summary: "runtime run session prepare failed".to_string(),
                        meta: json!({
                            "stage": "ensure_session",
                        }),
                    });
                    emit(protocol_error_to_run_event(
                        trace_id_for_run.as_str(),
                        session_id_for_run.as_str(),
                        &protocol_error,
                    ));
                    return;
                }
            };

            if !start_for_run.prompt.trim().is_empty() {
                if let Err(err) = run_service.store.append_message(
                    session.id.as_str(),
                    user_id_for_run.as_str(),
                    "user",
                    start_for_run.prompt.as_str(),
                ) {
                    let protocol_error = store_error_to_protocol_error(err);
                    session_run_lease.set_phase(SessionRunPhase::Closing);
                    run_service.audit_log(AuditRecord {
                        level: "error".to_string(),
                        category: "run".to_string(),
                        event: "run_session_prepare_failed".to_string(),
                        context: audit_context_for_run.clone(),
                        status: "failed".to_string(),
                        tool_name: String::new(),
                        duration_ms: Some(prepare_started_at.elapsed().as_millis() as u64),
                        error_code: protocol_error.code.clone(),
                        error_message: protocol_error.message.clone(),
                        summary: "runtime run session prepare failed".to_string(),
                        meta: json!({
                            "stage": "append_message",
                        }),
                    });
                    emit(protocol_error_to_run_event(
                        trace_id_for_run.as_str(),
                        session_id_for_run.as_str(),
                        &protocol_error,
                    ));
                    return;
                }
            }

            if let Err(err) = run_service.store.mark_run_started(
                run_id_for_run.as_str(),
                session.id.as_str(),
                tenant_id_for_run.as_str(),
                user_id_for_run.as_str(),
                project_id_for_run.as_str(),
                trace_id_for_run.as_str(),
            ) {
                let protocol_error = store_error_to_protocol_error(err);
                session_run_lease.set_phase(SessionRunPhase::Closing);
                run_service.audit_log(AuditRecord {
                    level: "error".to_string(),
                    category: "run".to_string(),
                    event: "run_session_prepare_failed".to_string(),
                    context: audit_context_for_run.clone(),
                    status: "failed".to_string(),
                    tool_name: String::new(),
                    duration_ms: Some(prepare_started_at.elapsed().as_millis() as u64),
                    error_code: protocol_error.code.clone(),
                    error_message: protocol_error.message.clone(),
                    summary: "runtime run session prepare failed".to_string(),
                    meta: json!({
                        "stage": "mark_run_started",
                    }),
                });
                emit(protocol_error_to_run_event(
                    trace_id_for_run.as_str(),
                    session_id_for_run.as_str(),
                    &protocol_error,
                ));
                return;
            }

            run_service.audit_log(AuditRecord {
                level: "info".to_string(),
                category: "run".to_string(),
                event: "run_session_prepare_finished".to_string(),
                context: audit_context_for_run.clone(),
                status: "prepared".to_string(),
                tool_name: String::new(),
                duration_ms: Some(prepare_started_at.elapsed().as_millis() as u64),
                error_code: String::new(),
                error_message: String::new(),
                summary: "runtime run session prepare finished".to_string(),
                meta: json!({
                    "session_id": session.id.as_str(),
                    "prompt_appended": !start_for_run.prompt.trim().is_empty(),
                }),
            });

            session_run_lease.set_phase(SessionRunPhase::Running);
            run_service.audit_log(AuditRecord {
                level: "info".to_string(),
                category: "run".to_string(),
                event: "run_started".to_string(),
                context: audit_context_for_run.clone(),
                status: "running".to_string(),
                tool_name: String::new(),
                duration_ms: None,
                error_code: String::new(),
                error_message: String::new(),
                summary: "runtime run started".to_string(),
                meta: json!({
                    "prompt_chars": start_for_run.prompt.chars().count(),
                    "agent_key": start_for_run.agent_key.as_str(),
                    "execution_mode": start_for_run.execution_mode.as_str(),
                }),
            });
            emit(RunEvent {
                trace_id: trace_id_for_run.clone(),
                session_id: session.id.clone(),
                kind: "started".to_string(),
                message: "LLM 执行已开始".to_string(),
                ..Default::default()
            });

            let request = build_core_run_request(
                &start_for_run,
                &session,
                &run_id_for_run,
                &trace_id_for_run,
                &tenant_id_for_run,
                &user_id_for_run,
                &project_id_for_run,
            );
            let mut on_stream_event = |event: AgentStreamEvent| {
                run_service.audit_stream_event(&audit_context_for_run, &event);
                emit(core_stream_event_to_proto(
                    trace_id_for_run.as_str(),
                    session.id.as_str(),
                    &event,
                ));
            };

            let result = libra_agent_core::run_agent_with_protocol_error_stream(
                request,
                &mut on_stream_event,
            );

            match result {
                Ok(value) => {
                    session_run_lease.set_phase(SessionRunPhase::Closing);
                    let summary = if value.display_message.trim().is_empty() {
                        value.message.trim().to_string()
                    } else {
                        value.display_message.trim().to_string()
                    };
                    if !summary.is_empty() {
                        let _ = run_service.store.append_message(
                            session.id.as_str(),
                            user_id.as_str(),
                            "assistant",
                            summary.as_str(),
                        );
                    }
                    let _ = run_service.store.mark_run_finished(
                        run_id_for_run.as_str(),
                        "succeeded",
                        None,
                        None,
                    );
                    libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(session.id.as_str());
                    run_service.audit_log(AuditRecord {
                        level: "info".to_string(),
                        category: "sandbox".to_string(),
                        event: "sandbox_reset".to_string(),
                        context: audit_context_for_run.clone(),
                        status: "reset".to_string(),
                        tool_name: String::new(),
                        duration_ms: None,
                        error_code: String::new(),
                        error_message: String::new(),
                        summary: "sandbox reset after run success".to_string(),
                        meta: json!({
                            "reason": "run_completed",
                        }),
                    });
                    run_service.audit_log(AuditRecord {
                        level: "info".to_string(),
                        category: "run".to_string(),
                        event: "run_succeeded".to_string(),
                        context: audit_context_for_run.clone(),
                        status: "succeeded".to_string(),
                        tool_name: String::new(),
                        duration_ms: Some(run_started_at.elapsed().as_millis() as u64),
                        error_code: String::new(),
                        error_message: String::new(),
                        summary: "runtime run succeeded".to_string(),
                        meta: json!({
                            "message_chars": value.message.chars().count(),
                            "display_message_chars": value.display_message.chars().count(),
                            "steps_count": value.steps.len(),
                            "events_count": value.events.len(),
                            "assets_count": value.assets.len(),
                        }),
                    });
                    emit(RunEvent {
                        trace_id: trace_id_for_run.clone(),
                        session_id: session.id.clone(),
                        kind: "result".to_string(),
                        message: value.message.clone(),
                        final_result: Some(core_result_to_proto(value)),
                        ..Default::default()
                    });
                }
                Err(err) => {
                    session_run_lease.set_phase(SessionRunPhase::Closing);
                    let normalized_error = if run_service.take_cancelled(session.id.as_str()) {
                        ProtocolError::new(
                            "core.agent.request_cancelled",
                            "任务已取消（用户主动终止）",
                        )
                        .with_suggestion("如需继续，请重新发起任务")
                    } else {
                        err
                    };
                    let status_text = if normalized_error.code == "core.agent.request_cancelled" {
                        "cancelled"
                    } else {
                        "failed"
                    };
                    let _ = run_service.store.mark_run_finished(
                        run_id_for_run.as_str(),
                        status_text,
                        Some(normalized_error.code.as_str()),
                        Some(normalized_error.message.as_str()),
                    );
                    libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(session.id.as_str());
                    run_service.audit_log(AuditRecord {
                        level: "info".to_string(),
                        category: "sandbox".to_string(),
                        event: "sandbox_reset".to_string(),
                        context: audit_context_for_run.clone(),
                        status: "reset".to_string(),
                        tool_name: String::new(),
                        duration_ms: None,
                        error_code: String::new(),
                        error_message: String::new(),
                        summary: "sandbox reset after run failure".to_string(),
                        meta: json!({
                            "reason": status_text,
                        }),
                    });
                    run_service.audit_log(AuditRecord {
                        level: if normalized_error.code == "core.agent.request_cancelled" {
                            "info".to_string()
                        } else {
                            "error".to_string()
                        },
                        category: "run".to_string(),
                        event: if normalized_error.code == "core.agent.request_cancelled" {
                            "run_cancelled".to_string()
                        } else {
                            "run_failed".to_string()
                        },
                        context: audit_context_for_run.clone(),
                        status: status_text.to_string(),
                        tool_name: String::new(),
                        duration_ms: Some(run_started_at.elapsed().as_millis() as u64),
                        error_code: normalized_error.code.clone(),
                        error_message: normalized_error.message.clone(),
                        summary: if normalized_error.code == "core.agent.request_cancelled" {
                            "runtime run cancelled".to_string()
                        } else {
                            "runtime run failed".to_string()
                        },
                        meta: Value::Null,
                    });
                    emit(RunEvent {
                        trace_id: trace_id_for_run.clone(),
                        session_id: session.id.clone(),
                        kind: if normalized_error.code == "core.agent.request_cancelled" {
                            "cancelled".to_string()
                        } else {
                            "error".to_string()
                        },
                        message: normalized_error.message.clone(),
                        code: normalized_error.code.clone(),
                        ..Default::default()
                    });
                }
            }
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(event_rx))))
    }

    /// 描述：通过 unary RPC 取消会话运行，供宿主在 bidirectional stream 之外也能安全发起取消。
    async fn cancel_run(
        &self,
        request: Request<CancelRunRequest>,
    ) -> Result<Response<CancelRunResponse>, Status> {
        let payload = request.into_inner();
        self.mark_cancelled(payload.session_id.as_str());
        libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(payload.session_id.as_str());
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "control".to_string(),
            event: "cancel_requested".to_string(),
            context: AuditContext {
                tenant_id: String::new(),
                user_id: String::new(),
                project_id: String::new(),
                session_id: payload.session_id.clone(),
                run_id: payload.run_id.clone(),
                trace_id: String::new(),
            },
            status: "accepted".to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime cancel requested".to_string(),
            meta: json!({
                "run_id_set": !payload.run_id.is_empty(),
            }),
        });
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "sandbox".to_string(),
            event: "sandbox_reset".to_string(),
            context: AuditContext {
                tenant_id: String::new(),
                user_id: String::new(),
                project_id: String::new(),
                session_id: payload.session_id,
                run_id: payload.run_id,
                trace_id: String::new(),
            },
            status: "reset".to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "sandbox reset by cancel rpc".to_string(),
            meta: json!({
                "reason": "cancel_run",
            }),
        });
        Ok(Response::new(CancelRunResponse { ok: true }))
    }

    /// 描述：将人工审批结果写回 core 授权注册表。
    async fn submit_approval(
        &self,
        request: Request<SubmitApprovalRequest>,
    ) -> Result<Response<SubmitApprovalResponse>, Status> {
        let payload = request.into_inner();
        let ok = libra_agent_core::APPROVAL_REGISTRY.submit_decision(
            payload.approval_id.as_str(),
            if payload.approved {
                ApprovalOutcome::Approved
            } else {
                ApprovalOutcome::Rejected
            },
        );
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "control".to_string(),
            event: "approval_submitted".to_string(),
            context: AuditContext::default(),
            status: if payload.approved {
                "approved".to_string()
            } else {
                "rejected".to_string()
            },
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime approval submitted".to_string(),
            meta: json!({
                "approval_id": payload.approval_id,
                "ok": ok,
            }),
        });
        Ok(Response::new(SubmitApprovalResponse { ok }))
    }

    /// 描述：将结构化用户输入结果写回 core 用户提问注册表。
    async fn submit_user_input(
        &self,
        request: Request<SubmitUserInputRequest>,
    ) -> Result<Response<SubmitUserInputResponse>, Status> {
        let payload = request.into_inner();
        let ok = libra_agent_core::USER_INPUT_REGISTRY.submit_resolution(
            payload.request_id.as_str(),
            UserInputResolution {
                resolution: payload.resolution.clone(),
                answers: payload
                    .answers
                    .iter()
                    .map(proto_user_input_answer_to_core)
                    .collect(),
            },
        );
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "control".to_string(),
            event: "user_input_submitted".to_string(),
            context: AuditContext::default(),
            status: payload.resolution.clone(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime user input submitted".to_string(),
            meta: json!({
                "request_id": payload.request_id,
                "question_ids": payload.answers.iter().map(|item| item.question_id.clone()).collect::<Vec<_>>(),
                "answers_count": payload.answers.len(),
                "ok": ok,
            }),
        });
        Ok(Response::new(SubmitUserInputResponse { ok }))
    }

    /// 描述：通过 runtime 代理纯模型调用，统一收敛 Desktop 的总结/记忆类请求。
    async fn call_model(
        &self,
        request: Request<CallModelRequest>,
    ) -> Result<Response<CallModelResponse>, Status> {
        let payload = request.into_inner();
        let provider = parse_provider(payload.provider.as_str());
        let result = call_model_with_policy_and_config(
            provider,
            payload.prompt.as_str(),
            empty_to_none(payload.workdir.as_str()),
            LlmGatewayPolicy::from_env(),
            Some(&LlmProviderConfig {
                api_key: empty_to_option_string(payload.provider_api_key.as_str()),
                model: empty_to_option_string(payload.provider_model.as_str()),
                mode: empty_to_option_string(payload.provider_mode.as_str()),
            }),
        )
        .map_err(|err| protocol_error_to_status(err.to_protocol_error()))?;
        Ok(Response::new(CallModelResponse {
            content: result.content,
            usage: Some(LlmUsage {
                prompt_tokens: result.usage.prompt_tokens,
                completion_tokens: result.usage.completion_tokens,
                total_tokens: result.usage.total_tokens,
            }),
        }))
    }

    /// 描述：查询指定会话的沙盒指标，兼容 Desktop 侧调试面板。
    async fn get_sandbox_metrics(
        &self,
        request: Request<GetSandboxMetricsRequest>,
    ) -> Result<Response<GetSandboxMetricsResponse>, Status> {
        let payload = request.into_inner();
        let metrics = libra_agent_core::sandbox::SANDBOX_REGISTRY
            .get_metrics(payload.session_id.as_str())
            .map(|item| SandboxMetrics {
                memory_bytes: item.memory_bytes,
                uptime_secs: item.uptime_secs,
            });
        if metrics.is_none() {
            self.audit_log(AuditRecord {
                level: "error".to_string(),
                category: "sandbox".to_string(),
                event: "sandbox_metrics_missing".to_string(),
                context: AuditContext {
                    tenant_id: String::new(),
                    user_id: String::new(),
                    project_id: String::new(),
                    session_id: payload.session_id,
                    run_id: String::new(),
                    trace_id: String::new(),
                },
                status: "missing".to_string(),
                tool_name: String::new(),
                duration_ms: None,
                error_code: "runtime.sandbox.metrics_missing".to_string(),
                error_message: "sandbox metrics not found".to_string(),
                summary: "sandbox metrics lookup returned empty".to_string(),
                meta: Value::Null,
            });
        }
        Ok(Response::new(GetSandboxMetricsResponse { metrics }))
    }

    /// 描述：强制重置指定会话的沙盒，供宿主主动恢复损坏状态。
    async fn reset_sandbox(
        &self,
        request: Request<ResetSandboxRequest>,
    ) -> Result<Response<ResetSandboxResponse>, Status> {
        let payload = request.into_inner();
        libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(payload.session_id.as_str());
        self.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "sandbox".to_string(),
            event: "sandbox_reset".to_string(),
            context: AuditContext {
                tenant_id: String::new(),
                user_id: String::new(),
                project_id: String::new(),
                session_id: payload.session_id,
                run_id: String::new(),
                trace_id: String::new(),
            },
            status: "reset".to_string(),
            tool_name: String::new(),
            duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            summary: "sandbox reset by reset_sandbox rpc".to_string(),
            meta: json!({
                "reason": "reset_sandbox_rpc",
            }),
        });
        Ok(Response::new(ResetSandboxResponse { ok: true }))
    }
}

/// 描述：应用 runtime 流上的控制消息；若宿主选择 stream 内控制，则与 unary 控制共享同一套行为。
async fn apply_control_message(
    service: &RuntimeServiceImpl,
    control: RunControlRequest,
    default_session_id: &str,
    audit_context: &AuditContext,
) -> Result<(), Status> {
    match control.payload {
        Some(runtime::run_control_request::Payload::CancelRun(payload)) => {
            let session_id = if payload.session_id.trim().is_empty() {
                default_session_id
            } else {
                payload.session_id.as_str()
            };
            service.mark_cancelled(session_id);
            libra_agent_core::sandbox::SANDBOX_REGISTRY.reset(session_id);
            service.audit_log(AuditRecord {
                level: "info".to_string(),
                category: "control".to_string(),
                event: "cancel_received".to_string(),
                context: audit_context.clone(),
                status: "accepted".to_string(),
                tool_name: String::new(),
                duration_ms: None,
                error_code: String::new(),
                error_message: String::new(),
                summary: "runtime stream cancel received".to_string(),
                meta: json!({
                    "session_id": session_id,
                    "run_id": payload.run_id,
                }),
            });
            service.audit_log(AuditRecord {
                level: "info".to_string(),
                category: "sandbox".to_string(),
                event: "sandbox_reset".to_string(),
                context: audit_context.clone(),
                status: "reset".to_string(),
                tool_name: String::new(),
                duration_ms: None,
                error_code: String::new(),
                error_message: String::new(),
                summary: "sandbox reset by stream cancel".to_string(),
                meta: json!({
                    "reason": "run_control_cancel",
                }),
            });
        }
        Some(runtime::run_control_request::Payload::SubmitApproval(payload)) => {
            let ok = libra_agent_core::APPROVAL_REGISTRY.submit_decision(
                payload.approval_id.as_str(),
                if payload.approved {
                    ApprovalOutcome::Approved
                } else {
                    ApprovalOutcome::Rejected
                },
            );
            service.audit_log(AuditRecord {
                level: "info".to_string(),
                category: "control".to_string(),
                event: "approval_received".to_string(),
                context: audit_context.clone(),
                status: if payload.approved {
                    "approved".to_string()
                } else {
                    "rejected".to_string()
                },
                tool_name: String::new(),
                duration_ms: None,
                error_code: String::new(),
                error_message: String::new(),
                summary: "runtime stream approval received".to_string(),
                meta: json!({
                    "approval_id": payload.approval_id,
                    "ok": ok,
                }),
            });
        }
        Some(runtime::run_control_request::Payload::SubmitUserInput(payload)) => {
            let ok = libra_agent_core::USER_INPUT_REGISTRY.submit_resolution(
                payload.request_id.as_str(),
                UserInputResolution {
                    resolution: payload.resolution.clone(),
                    answers: payload
                        .answers
                        .iter()
                        .map(proto_user_input_answer_to_core)
                        .collect(),
                },
            );
            service.audit_log(AuditRecord {
                level: "info".to_string(),
                category: "control".to_string(),
                event: "user_input_received".to_string(),
                context: audit_context.clone(),
                status: payload.resolution,
                tool_name: String::new(),
                duration_ms: None,
                error_code: String::new(),
                error_message: String::new(),
                summary: "runtime stream user input received".to_string(),
                meta: json!({
                    "request_id": payload.request_id,
                    "question_ids": payload.answers.iter().map(|item| item.question_id.clone()).collect::<Vec<_>>(),
                    "answers_count": payload.answers.len(),
                    "ok": ok,
                }),
            });
        }
        Some(runtime::run_control_request::Payload::StartRun(_)) | None => {}
    }
    Ok(())
}

/// 描述：把 gRPC start_run 请求转换为 core 可执行的统一请求对象。
fn build_core_run_request(
    start: &RunStartRequest,
    session: &RuntimeSessionRecord,
    _run_id: &str,
    trace_id: &str,
    tenant_id: &str,
    user_id: &str,
    project_id: &str,
) -> AgentRunRequest {
    let _ = tenant_id;
    let _ = user_id;
    let _ = project_id;
    AgentRunRequest {
        trace_id: trace_id.to_string(),
        session_id: session.id.clone(),
        agent_key: start.agent_key.clone(),
        provider: if start.provider.trim().is_empty() {
            "codex".to_string()
        } else {
            start.provider.clone()
        },
        provider_api_key: empty_to_option_string(start.provider_api_key.as_str()),
        provider_model: empty_to_option_string(start.provider_model.as_str()),
        provider_mode: empty_to_option_string(start.provider_mode.as_str()),
        prompt: start.prompt.clone(),
        project_name: empty_to_option_string(start.project_name.as_str()),
        model_export_enabled: start.model_export_enabled,
        dcc_provider_addr: empty_to_option_string(start.dcc_provider_addr.as_str()),
        output_dir: empty_to_option_string(start.output_dir.as_str()),
        workdir: empty_to_option_string(start.workdir.as_str()),
        available_mcps: start
            .available_mcps
            .iter()
            .map(proto_registered_mcp_to_core)
            .collect(),
        runtime_capabilities: start
            .runtime_capabilities
            .as_ref()
            .map(proto_runtime_capabilities_to_core)
            .unwrap_or_default(),
        execution_mode: parse_execution_mode(start.execution_mode.as_str()),
    }
}

/// 描述：将 core 流事件转换为跨语言可复用的 gRPC 事件结构。
fn core_stream_event_to_proto(
    trace_id: &str,
    session_id: &str,
    event: &AgentStreamEvent,
) -> RunEvent {
    match event {
        AgentStreamEvent::LlmStarted { provider } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "llm_started".to_string(),
            message: format!("provider={} started", provider),
            ..Default::default()
        },
        AgentStreamEvent::LlmDelta { content } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "delta".to_string(),
            message: "chunk".to_string(),
            delta: content.clone(),
            ..Default::default()
        },
        AgentStreamEvent::LlmFinished { provider } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "llm_finished".to_string(),
            message: format!("provider={} finished", provider),
            ..Default::default()
        },
        AgentStreamEvent::Planning { message } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "planning".to_string(),
            message: message.clone(),
            ..Default::default()
        },
        AgentStreamEvent::ToolCallStarted { name, args, .. } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "tool_call_started".to_string(),
            message: format!("tool={} started", name),
            tool_name: name.clone(),
            tool_args: args.clone(),
            tool_args_data_json: match event {
                AgentStreamEvent::ToolCallStarted { args_data, .. } => args_data.to_string(),
                _ => String::new(),
            },
            ..Default::default()
        },
        AgentStreamEvent::ToolCallFinished {
            name, ok, result, ..
        } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "tool_call_finished".to_string(),
            message: result.clone(),
            tool_name: name.clone(),
            result: result.clone(),
            ok: *ok,
            tool_result_data_json: match event {
                AgentStreamEvent::ToolCallFinished { result_data, .. } => result_data.to_string(),
                _ => String::new(),
            },
            ..Default::default()
        },
        AgentStreamEvent::Heartbeat { message } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "heartbeat".to_string(),
            message: message.clone(),
            ..Default::default()
        },
        AgentStreamEvent::ResidentProcessState {
            process_id,
            name,
            status,
            pid,
            exit_code,
            started_at_ms,
            last_output_at_ms,
            uptime_secs,
            workdir,
        } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "resident_process_state".to_string(),
            message: format!("process={} status={}", name, status),
            tool_result_data_json: json!({
                "process_id": process_id,
                "name": name,
                "status": status,
                "pid": pid,
                "exit_code": exit_code,
                "started_at_ms": started_at_ms,
                "last_output_at_ms": last_output_at_ms,
                "uptime_secs": uptime_secs,
                "workdir": workdir,
            })
            .to_string(),
            ..Default::default()
        },
        AgentStreamEvent::ResidentProcessLog {
            process_id,
            name,
            stream,
            text,
            sequence,
            timestamp_ms,
        } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "resident_process_log".to_string(),
            message: text.clone(),
            tool_result_data_json: json!({
                "process_id": process_id,
                "name": name,
                "stream": stream,
                "text": text,
                "sequence": sequence,
                "timestamp_ms": timestamp_ms,
            })
            .to_string(),
            ..Default::default()
        },
        AgentStreamEvent::RequireApproval {
            approval_id,
            tool_name,
            tool_args,
        } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "require_approval".to_string(),
            message: approval_id.clone(),
            tool_name: tool_name.clone(),
            tool_args: tool_args.clone(),
            ..Default::default()
        },
        AgentStreamEvent::RequestUserInput {
            request_id,
            questions,
        } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "request_user_input".to_string(),
            message: request_id.clone(),
            questions: questions
                .iter()
                .map(core_question_prompt_to_proto)
                .collect(),
            ..Default::default()
        },
        AgentStreamEvent::Final { message } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "final".to_string(),
            message: message.clone(),
            ..Default::default()
        },
        AgentStreamEvent::Cancelled { message } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "cancelled".to_string(),
            message: message.clone(),
            ..Default::default()
        },
        AgentStreamEvent::Error { code, message } => RunEvent {
            trace_id: trace_id.to_string(),
            session_id: session_id.to_string(),
            kind: "error".to_string(),
            message: message.clone(),
            code: code.clone(),
            ..Default::default()
        },
    }
}

/// 描述：将 core 最终运行结果映射为 gRPC 最终结果对象，供宿主语言直接消费。
fn core_result_to_proto(value: libra_agent_core::AgentRunResult) -> AgentRunResult {
    AgentRunResult {
        trace_id: value.trace_id,
        control: value.control,
        message: value.message,
        display_message: value.display_message,
        usage: value.usage.map(|item| LlmUsage {
            prompt_tokens: item.prompt_tokens,
            completion_tokens: item.completion_tokens,
            total_tokens: item.total_tokens,
        }),
        actions: value.actions,
        exported_file: value.exported_file.unwrap_or_default(),
        steps: value.steps.iter().map(core_step_record_to_proto).collect(),
        events: value
            .events
            .iter()
            .map(core_event_record_to_proto)
            .collect(),
        assets: value
            .assets
            .iter()
            .map(core_asset_record_to_proto)
            .collect(),
        ui_hint: value.ui_hint.as_ref().map(core_ui_hint_to_proto),
    }
}

/// 描述：把 proto 注册项转换为 core MCP 注册快照。
fn proto_registered_mcp_to_core(item: &RegisteredMcp) -> AgentRegisteredMcp {
    AgentRegisteredMcp {
        id: item.id.clone(),
        template_id: item.template_id.clone(),
        name: item.name.clone(),
        domain: item.domain.clone(),
        software: item.software.clone(),
        capabilities: item.capabilities.clone(),
        priority: item.priority,
        supports_import: item.supports_import,
        supports_export: item.supports_export,
        transport: item.transport.clone(),
        command: item.command.clone(),
        args: item.args.clone(),
        env: item.env.clone(),
        cwd: item.cwd.clone(),
        url: item.url.clone(),
        headers: item.headers.clone(),
        runtime_kind: item.runtime_kind.clone(),
        official_provider: item.official_provider.clone(),
        runtime_ready: item.runtime_ready,
        runtime_hint: empty_to_option_string(item.runtime_hint.as_str()),
    }
}

/// 描述：把 proto 运行时能力快照转换为 core 运行时能力结构。
fn proto_runtime_capabilities_to_core(value: &RuntimeCapabilities) -> AgentRuntimeCapabilities {
    AgentRuntimeCapabilities {
        native_js_repl: value.native_js_repl,
        native_browser_tools: value.native_browser_tools,
        playwright_mcp_server_id: value.playwright_mcp_server_id.clone(),
        playwright_mcp_ready: value.playwright_mcp_ready,
        playwright_mcp_name: value.playwright_mcp_name.clone(),
        interactive_mode: match value.interactive_mode.trim() {
            "native" => libra_agent_core::AgentInteractiveMode::Native,
            "mcp" => libra_agent_core::AgentInteractiveMode::Mcp,
            _ => libra_agent_core::AgentInteractiveMode::None,
        },
        skip_reason: value.skip_reason.clone(),
    }
}

/// 描述：把 core 运行时能力结构转换为 proto，供宿主语言复用。
fn core_runtime_capabilities_to_proto(value: &AgentRuntimeCapabilities) -> RuntimeCapabilities {
    RuntimeCapabilities {
        native_js_repl: value.native_js_repl,
        native_browser_tools: value.native_browser_tools,
        playwright_mcp_server_id: value.playwright_mcp_server_id.clone(),
        playwright_mcp_ready: value.playwright_mcp_ready,
        playwright_mcp_name: value.playwright_mcp_name.clone(),
        interactive_mode: value.interactive_mode.as_str().to_string(),
        skip_reason: value.skip_reason.clone(),
    }
}

/// 描述：把 proto 用户输入答案转换为 core 结构，统一回写到用户提问注册表。
fn proto_user_input_answer_to_core(value: &ProtoUserInputAnswer) -> UserInputAnswer {
    UserInputAnswer {
        question_id: value.question_id.clone(),
        answer_type: value.answer_type.clone(),
        option_index: if value.option_index < 0 {
            None
        } else {
            Some(value.option_index as usize)
        },
        option_label: empty_to_option_string(value.option_label.as_str()),
        value: value.value.clone(),
    }
}

/// 描述：把 core 问题定义转换为 proto 问题结构。
fn core_question_prompt_to_proto(value: &QuestionPrompt) -> ProtoQuestionPrompt {
    ProtoQuestionPrompt {
        id: value.id.clone(),
        header: value.header.clone(),
        question: value.question.clone(),
        options: value
            .options
            .iter()
            .map(core_question_option_to_proto)
            .collect(),
    }
}

/// 描述：把 core 问题选项转换为 proto 选项结构。
fn core_question_option_to_proto(value: &QuestionOption) -> ProtoQuestionOption {
    ProtoQuestionOption {
        label: value.label.clone(),
        description: value.description.clone(),
    }
}

/// 描述：把 core step 记录转换为 proto 协议记录。
fn core_step_record_to_proto(value: &ProtocolStepRecord) -> ProtoStepRecord {
    ProtoStepRecord {
        index: value.index as u32,
        code: value.code.clone(),
        status: format!("{:?}", value.status).to_lowercase(),
        elapsed_ms: value.elapsed_ms as u64,
        summary: value.summary.clone(),
        error: value.error.as_ref().map(protocol_error_to_proto),
        data_json: value
            .data
            .as_ref()
            .map(|item| item.to_string())
            .unwrap_or_default(),
    }
}

/// 描述：把 core event 记录转换为 proto 协议记录。
fn core_event_record_to_proto(value: &ProtocolEventRecord) -> ProtoEventRecord {
    ProtoEventRecord {
        event: value.event.clone(),
        step_index: value.step_index.unwrap_or_default() as u32,
        has_step_index: value.step_index.is_some(),
        timestamp_ms: value.timestamp_ms as u64,
        message: value.message.clone(),
    }
}

/// 描述：把 core asset 记录转换为 proto 协议记录。
fn core_asset_record_to_proto(value: &ProtocolAssetRecord) -> ProtoAssetRecord {
    ProtoAssetRecord {
        kind: value.kind.clone(),
        path: value.path.clone(),
        version: value.version,
        meta_json: value
            .meta
            .as_ref()
            .map(|item| item.to_string())
            .unwrap_or_default(),
    }
}

/// 描述：把 core UI hint 转换为 proto 协议记录。
fn core_ui_hint_to_proto(value: &ProtocolUiHint) -> ProtoUiHint {
    ProtoUiHint {
        key: value.key.clone(),
        level: format!("{:?}", value.level).to_lowercase(),
        title: value.title.clone(),
        message: value.message.clone(),
        actions: value
            .actions
            .iter()
            .map(core_ui_hint_action_to_proto)
            .collect(),
        context_json: value
            .context
            .as_ref()
            .map(|item| item.to_string())
            .unwrap_or_default(),
    }
}

/// 描述：把 core UI hint action 转换为 proto 协议记录。
fn core_ui_hint_action_to_proto(value: &ProtocolUiHintAction) -> ProtoUiHintAction {
    ProtoUiHintAction {
        key: value.key.clone(),
        label: value.label.clone(),
        intent: format!("{:?}", value.intent).to_lowercase(),
    }
}

/// 描述：把协议错误转换为 proto 错误结构。
fn protocol_error_to_proto(value: &ProtocolError) -> ProtoErrorRecord {
    ProtoErrorRecord {
        code: value.code.clone(),
        message: value.message.clone(),
        suggestion: value.suggestion.clone().unwrap_or_default(),
        retryable: value.retryable,
    }
}

/// 描述：把协议错误转换为 gRPC status，统一保持稳定错误码与消息。
fn protocol_error_to_status(value: ProtocolError) -> Status {
    Status::internal(format!("{}: {}", value.code, value.message))
}

/// 描述：把协议错误转换为运行流 error 事件，保证客户端在流已打开后能收到结构化失败结果。
fn protocol_error_to_run_event(
    trace_id: &str,
    session_id: &str,
    value: &ProtocolError,
) -> RunEvent {
    RunEvent {
        trace_id: trace_id.to_string(),
        session_id: session_id.to_string(),
        kind: "error".to_string(),
        message: value.message.clone(),
        code: value.code.clone(),
        ..Default::default()
    }
}

/// 描述：把存储错误转换为 gRPC status，避免在服务端泄露 SQLite 细节结构。
fn store_error_to_status(value: RuntimeStoreError) -> Status {
    let message = value.to_string();
    if message.contains("not found") {
        Status::not_found(message)
    } else {
        Status::internal(message)
    }
}

/// 描述：把存储错误转换为运行流协议错误，确保流已打开后仍能回传稳定的结构化失败语义。
fn store_error_to_protocol_error(value: RuntimeStoreError) -> ProtocolError {
    let message = value.to_string();
    if message.contains("not found") {
        return ProtocolError::new("runtime.store.not_found", message);
    }
    ProtocolError::new("runtime.store.failed", message)
        .with_suggestion("请稍后重试；若持续失败请检查本地 Runtime 数据目录状态。")
        .with_retryable(true)
}

/// 描述：把执行模式字符串转换为 core 枚举，未知值回退到 workflow。
fn parse_execution_mode(raw: &str) -> AgentExecutionMode {
    match raw.trim() {
        "chat" => AgentExecutionMode::Chat,
        _ => AgentExecutionMode::Workflow,
    }
}

/// 描述：把空字符串转换为 `Option<String>`，便于 core 与 LLM 配置复用。
fn empty_to_option_string(raw: &str) -> Option<String> {
    let normalized = raw.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

/// 描述：把空字符串转换为 `Option<&str>`，用于 workdir 等可选字段传递。
fn empty_to_none(raw: &str) -> Option<&str> {
    let normalized = raw.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

/// 描述：把大于 0 的整型转换为 `Option<i32>`，供 proto 默认零值与实际筛选条件做区分。
fn positive_i32_to_option(raw: i32) -> Option<i32> {
    if raw > 0 {
        Some(raw)
    } else {
        None
    }
}

/// 描述：从 JSON 值中提取顶层键名，供审计日志只记录结构摘要而不落全文。
fn json_value_keys(value: &serde_json::Value) -> Vec<String> {
    match value {
        serde_json::Value::Object(map) => map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

/// 描述：按最大字符数裁剪日志文本，避免把长错误消息或正文直接写入审计日志。
fn sanitize_log_text(raw: &str, max_chars: usize) -> String {
    raw.trim().chars().take(max_chars).collect()
}

/// 描述：生成 runtime 内部主键，供 run_id 等记录复用。
fn new_runtime_id(prefix: &str) -> String {
    format!("{}-{}", prefix, Uuid::new_v4().simple())
}

#[cfg(test)]
mod tests {
    use super::*;
    use libra_runtime_proto::runtime::runtime_service_client::RuntimeServiceClient;
    use libra_runtime_proto::runtime::{
        CreateMessageRequest, CreatePreviewRequest, CreateSandboxRequest, CreateSessionRequest,
        ExpirePreviewRequest, ListPreviewsRequest, ListSandboxesRequest, RunControlRequest,
        RunEvent, RunStartRequest, RuntimeContext, SubmitUserInputRequest,
        UpdateSessionStatusRequest,
    };
    use serde_json::Value;
    use std::fs;
    use tempfile::tempdir;
    use tokio::time::{sleep, Duration};

    /// 描述：为未知 provider 场景打开一条运行流，供同会话连续运行回归测试复用。
    async fn open_unknown_provider_run_stream(
        client: &mut RuntimeServiceClient<tonic::transport::Channel>,
        session_id: &str,
    ) -> tonic::Streaming<RunEvent> {
        let (tx, rx) = mpsc::channel(8);
        tx.send(RunControlRequest {
            payload: Some(runtime::run_control_request::Payload::StartRun(
                RunStartRequest {
                    context: Some(RuntimeContext {
                        user_id: "u-1".to_string(),
                        session_id: session_id.to_string(),
                        ..Default::default()
                    }),
                    agent_key: "agent-code-default".to_string(),
                    provider: "unknown-provider".to_string(),
                    prompt: "hello".to_string(),
                    execution_mode: "workflow".to_string(),
                    ..Default::default()
                },
            )),
        })
        .await
        .expect("send start");
        let response =
            tokio::time::timeout(Duration::from_secs(3), client.run(ReceiverStream::new(rx)))
                .await
                .expect("run open should not timeout")
                .expect("run stream");
        drop(tx);
        response.into_inner()
    }

    /// 描述：读取运行流上的终态 error/cancelled/result 事件，避免测试在中间 heartbeat 上提前结束。
    async fn read_terminal_run_event(stream: &mut tonic::Streaming<RunEvent>) -> RunEvent {
        while let Some(item) = stream.message().await.expect("stream item") {
            if item.kind == "error" || item.kind == "cancelled" || item.kind == "result" {
                return item;
            }
        }
        panic!("stream closed without terminal event");
    }

    /// 描述：验证 resident_process_state 事件会稳定映射到 runtime RunEvent，并携带结构化 JSON 数据。
    #[test]
    fn should_map_resident_process_state_event_to_proto() {
        let event = AgentStreamEvent::ResidentProcessState {
            process_id: "proc-1".to_string(),
            name: "desktop-dev".to_string(),
            status: "running".to_string(),
            pid: Some(1234),
            exit_code: None,
            started_at_ms: 100,
            last_output_at_ms: Some(200),
            uptime_secs: 3,
            workdir: "/tmp/demo".to_string(),
        };
        let proto = core_stream_event_to_proto("trace-1", "session-1", &event);
        assert_eq!(proto.kind, "resident_process_state");
        let payload: Value =
            serde_json::from_str(proto.tool_result_data_json.as_str()).expect("state payload");
        assert_eq!(payload.get("process_id").and_then(|value| value.as_str()), Some("proc-1"));
        assert_eq!(payload.get("status").and_then(|value| value.as_str()), Some("running"));
        assert_eq!(payload.get("pid").and_then(|value| value.as_u64()), Some(1234));
    }

    /// 描述：验证 resident_process_log 事件会稳定映射到 runtime RunEvent，并保留日志正文与序号。
    #[test]
    fn should_map_resident_process_log_event_to_proto() {
        let event = AgentStreamEvent::ResidentProcessLog {
            process_id: "proc-1".to_string(),
            name: "desktop-dev".to_string(),
            stream: "stdout".to_string(),
            text: "ready".to_string(),
            sequence: 7,
            timestamp_ms: 123,
        };
        let proto = core_stream_event_to_proto("trace-1", "session-1", &event);
        assert_eq!(proto.kind, "resident_process_log");
        assert_eq!(proto.message, "ready");
        let payload: Value =
            serde_json::from_str(proto.tool_result_data_json.as_str()).expect("log payload");
        assert_eq!(payload.get("stream").and_then(|value| value.as_str()), Some("stdout"));
        assert_eq!(payload.get("sequence").and_then(|value| value.as_u64()), Some(7));
    }

    /// 描述：验证 runtime 服务启动后可通过健康检查返回 ready 状态。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn should_report_runtime_health() {
        let dir = tempdir().expect("tempdir");
        let config = RuntimeServerConfig::new("127.0.0.1:55081".parse().expect("addr"), dir.path());
        let handle = start_embedded(config).await.expect("start runtime");
        sleep(Duration::from_millis(120)).await;
        let mut client = RuntimeServiceClient::connect("http://127.0.0.1:55081")
            .await
            .expect("connect");
        let response = client.health(HealthRequest {}).await.expect("health");
        assert!(response.into_inner().ready);
        drop(client);
        handle.shutdown().await;
    }

    /// 描述：验证未知 provider 会通过运行流回传结构化 error 事件，而不是让服务端直接崩溃。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn should_stream_error_for_unknown_provider() {
        let dir = tempdir().expect("tempdir");
        let config = RuntimeServerConfig::new("127.0.0.1:55082".parse().expect("addr"), dir.path());
        let handle = start_embedded(config).await.expect("start runtime");
        sleep(Duration::from_millis(120)).await;
        let mut client = RuntimeServiceClient::connect("http://127.0.0.1:55082")
            .await
            .expect("connect");
        let (tx, rx) = mpsc::channel(8);
        tx.send(RunControlRequest {
            payload: Some(runtime::run_control_request::Payload::StartRun(
                RunStartRequest {
                    context: Some(RuntimeContext {
                        user_id: "u-1".to_string(),
                        ..Default::default()
                    }),
                    agent_key: "agent-code-default".to_string(),
                    provider: "unknown-provider".to_string(),
                    prompt: "hello".to_string(),
                    execution_mode: "workflow".to_string(),
                    ..Default::default()
                },
            )),
        })
        .await
        .expect("send start");
        let response = client
            .run(ReceiverStream::new(rx))
            .await
            .expect("run stream");
        drop(tx);
        let mut stream = response.into_inner();
        let mut saw_error = false;
        while let Some(item) = stream.message().await.expect("stream item") {
            if item.kind == "error" {
                saw_error = true;
                break;
            }
        }
        assert!(saw_error);
        drop(client);
        let _ = handle;
    }

    /// 描述：验证同一个 session_id 连续两次运行时，第二次会正常开流并返回结构化错误，而不是卡在 open timeout。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn should_allow_sequential_runs_for_same_session_id() {
        let dir = tempdir().expect("tempdir");
        let config = RuntimeServerConfig::new("127.0.0.1:55084".parse().expect("addr"), dir.path());
        let handle = start_embedded(config).await.expect("start runtime");
        sleep(Duration::from_millis(120)).await;
        let mut client = RuntimeServiceClient::connect("http://127.0.0.1:55084")
            .await
            .expect("connect");

        let mut first_stream =
            open_unknown_provider_run_stream(&mut client, "session-reused").await;
        let first_terminal = read_terminal_run_event(&mut first_stream).await;
        assert_eq!(first_terminal.kind, "error");
        assert_eq!(first_terminal.code, "core.agent.llm.provider_unknown");

        let mut second_stream =
            open_unknown_provider_run_stream(&mut client, "session-reused").await;
        let second_terminal = read_terminal_run_event(&mut second_stream).await;
        assert_eq!(second_terminal.kind, "error");
        assert_eq!(second_terminal.code, "core.agent.llm.provider_unknown");

        sleep(Duration::from_millis(120)).await;
        let audit_payload = fs::read_to_string(dir.path().join("logs/runtime-audit.jsonl"))
            .expect("read audit log");
        assert!(
            audit_payload
                .matches("\"event\":\"run_start_received\"")
                .count()
                >= 2
        );
        assert!(
            audit_payload
                .matches("\"event\":\"run_stream_opened\"")
                .count()
                >= 2
        );
        assert!(
            audit_payload
                .matches("\"event\":\"run_session_prepare_started\"")
                .count()
                >= 2
        );
        assert!(
            audit_payload
                .matches("\"event\":\"run_session_prepare_finished\"")
                .count()
                >= 2
        );
        assert!(!audit_payload.contains("\"event\":\"run_session_conflict\""));

        drop(client);
        handle.shutdown().await;
    }

    /// 描述：验证同会话运行生命周期注册表会在冲突时拒绝第二条运行，并在租约释放后允许再次进入。
    #[test]
    fn should_reject_conflicting_active_session_run() {
        let dir = tempdir().expect("tempdir");
        let service = RuntimeServiceImpl::open(dir.path(), "runtime-session-conflict-test")
            .expect("open runtime");

        let first_lease = service
            .begin_session_run("session-conflict")
            .expect("first run lease");
        let conflict = service
            .begin_session_run("session-conflict")
            .expect_err("second run should conflict");
        assert_eq!(conflict.code, "runtime.session.run_conflict");
        assert!(conflict.retryable);
        assert!(conflict.message.contains("准备"));

        drop(first_lease);

        let second_lease = service
            .begin_session_run("session-conflict")
            .expect("lease should be reusable after release");
        drop(second_lease);
    }

    /// 描述：验证 session/message/sandbox/preview 管理 RPC 会统一落到 runtime SQLite，而不是 services 本地 JSON。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn should_support_management_rpcs_via_grpc() {
        let dir = tempdir().expect("tempdir");
        let config = RuntimeServerConfig::new("127.0.0.1:55083".parse().expect("addr"), dir.path());
        let handle = start_embedded(config).await.expect("start runtime");
        sleep(Duration::from_millis(120)).await;
        let mut client = RuntimeServiceClient::connect("http://127.0.0.1:55083")
            .await
            .expect("connect");

        let created = client
            .create_session(CreateSessionRequest {
                tenant_id: "tenant-1".to_string(),
                user_id: "user-1".to_string(),
                project_id: "project-1".to_string(),
                agent_code: "agent-a".to_string(),
                status: 1,
            })
            .await
            .expect("create session")
            .into_inner()
            .session
            .expect("session");
        assert_eq!(created.user_id, "user-1");

        let listed = client
            .list_sessions(ListSessionsRequest {
                tenant_id: "tenant-1".to_string(),
                user_id: "user-1".to_string(),
                project_id: "project-1".to_string(),
                agent_code: "agent-a".to_string(),
                status: 1,
            })
            .await
            .expect("list sessions")
            .into_inner();
        assert_eq!(listed.list.len(), 1);

        let updated = client
            .update_session_status(UpdateSessionStatusRequest {
                session_id: created.id.clone(),
                status: 2,
            })
            .await
            .expect("update session")
            .into_inner()
            .session
            .expect("updated session");
        assert_eq!(updated.status, 2);

        let message = client
            .create_message(CreateMessageRequest {
                session_id: created.id.clone(),
                user_id: "user-1".to_string(),
                role: "user".to_string(),
                content: "hello".to_string(),
            })
            .await
            .expect("create message")
            .into_inner()
            .message
            .expect("message");
        assert_eq!(message.content, "hello");

        let messages = client
            .list_messages(ListMessagesRequest {
                session_id: created.id.clone(),
                page: 1,
                page_size: 20,
            })
            .await
            .expect("list messages")
            .into_inner();
        assert_eq!(messages.total, 1);

        let sandbox = client
            .create_sandbox(CreateSandboxRequest {
                session_id: created.id.clone(),
                container_id: "container-1".to_string(),
                preview_url: "http://preview.local".to_string(),
                status: 1,
            })
            .await
            .expect("create sandbox")
            .into_inner()
            .sandbox
            .expect("sandbox");
        let sandboxes = client
            .list_sandboxes(ListSandboxesRequest {
                sandbox_id: String::new(),
                session_id: created.id.clone(),
            })
            .await
            .expect("list sandboxes")
            .into_inner();
        assert_eq!(sandboxes.list.len(), 1);

        let preview = client
            .create_preview(CreatePreviewRequest {
                sandbox_id: sandbox.id.clone(),
                url: "http://preview.local/app".to_string(),
                status: 1,
                expiration_secs: 120,
            })
            .await
            .expect("create preview")
            .into_inner()
            .preview
            .expect("preview");
        assert!(!preview.expires_at.is_empty());

        let previews = client
            .list_previews(ListPreviewsRequest {
                preview_id: String::new(),
                sandbox_id: sandbox.id.clone(),
            })
            .await
            .expect("list previews")
            .into_inner();
        assert_eq!(previews.list.len(), 1);

        let expired = client
            .expire_preview(ExpirePreviewRequest {
                preview_id: preview.id.clone(),
                sandbox_id: String::new(),
            })
            .await
            .expect("expire preview")
            .into_inner();
        assert!(expired.ok);

        let recycled = client
            .recycle_sandbox(RecycleSandboxRequest {
                sandbox_id: sandbox.id.clone(),
                session_id: String::new(),
            })
            .await
            .expect("recycle sandbox")
            .into_inner();
        assert!(recycled.ok);

        handle.shutdown().await;
    }

    /// 描述：验证 runtime 审计日志会落盘，并且不会把 prompt、用户输入答案或 API key 全文写入文件。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn should_write_redacted_runtime_audit_log() {
        let dir = tempdir().expect("tempdir");
        let service =
            RuntimeServiceImpl::open(dir.path(), "runtime-audit-test").expect("open runtime");

        let created = service
            .create_session(Request::new(CreateSessionRequest {
                tenant_id: "tenant-1".to_string(),
                user_id: "user-1".to_string(),
                project_id: "project-1".to_string(),
                agent_code: "agent-a".to_string(),
                status: 1,
            }))
            .await
            .expect("create session")
            .into_inner()
            .session
            .expect("session");

        let _ = service
            .submit_approval(Request::new(SubmitApprovalRequest {
                approval_id: "approval-1".to_string(),
                approved: true,
            }))
            .await
            .expect("submit approval");
        let _ = service
            .submit_user_input(Request::new(SubmitUserInputRequest {
                request_id: "request-1".to_string(),
                resolution: "answered".to_string(),
                answers: vec![ProtoUserInputAnswer {
                    question_id: "q-1".to_string(),
                    answer_type: "text".to_string(),
                    option_index: -1,
                    option_label: String::new(),
                    value: "very-secret-answer".to_string(),
                }],
            }))
            .await
            .expect("submit user input");
        let _ = service
            .cancel_run(Request::new(CancelRunRequest {
                session_id: created.id.clone(),
                run_id: "run-cancel".to_string(),
            }))
            .await
            .expect("cancel run");
        service.audit_log(AuditRecord {
            level: "info".to_string(),
            category: "run".to_string(),
            event: "run_succeeded".to_string(),
            context: AuditContext {
                tenant_id: "tenant-1".to_string(),
                user_id: "user-1".to_string(),
                project_id: "project-1".to_string(),
                session_id: created.id.clone(),
                run_id: "run-success".to_string(),
                trace_id: "trace-success".to_string(),
            },
            status: "succeeded".to_string(),
            tool_name: String::new(),
            duration_ms: Some(128),
            error_code: String::new(),
            error_message: String::new(),
            summary: "runtime run succeeded".to_string(),
            meta: json!({
                "prompt_chars": "执行 playwright-interactive 技能".chars().count(),
                "provider_api_key_set": true,
                "provider_api_key": "api-key-secret",
            }),
        });
        service.audit_log(AuditRecord {
            level: "error".to_string(),
            category: "run".to_string(),
            event: "run_failed".to_string(),
            context: AuditContext {
                tenant_id: "tenant-1".to_string(),
                user_id: "user-1".to_string(),
                project_id: "project-1".to_string(),
                session_id: created.id.clone(),
                run_id: "run-failed".to_string(),
                trace_id: "trace-failed".to_string(),
            },
            status: "failed".to_string(),
            tool_name: String::new(),
            duration_ms: Some(32),
            error_code: "runtime.test.failed".to_string(),
            error_message: "unknown provider".to_string(),
            summary: "runtime run failed".to_string(),
            meta: json!({
                "prompt_chars": "会失败".chars().count(),
            }),
        });

        sleep(Duration::from_millis(120)).await;
        let log_path = dir.path().join("logs/runtime-audit.jsonl");
        let payload = fs::read_to_string(&log_path).expect("read audit log");
        assert!(payload.contains("\"event\":\"sqlite_opened\""));
        assert!(payload.contains("\"event\":\"run_succeeded\""));
        assert!(payload.contains("\"event\":\"run_failed\""));
        assert!(payload.contains("\"event\":\"approval_submitted\""));
        assert!(payload.contains("\"event\":\"user_input_submitted\""));
        assert!(payload.contains("\"event\":\"sandbox_reset\""));
        assert!(!payload.contains("执行 playwright-interactive 技能"));
        assert!(!payload.contains("very-secret-answer"));
        assert!(!payload.contains("api-key-secret"));

        let lines = payload
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).expect("json line"))
            .collect::<Vec<_>>();
        assert!(lines.iter().any(|item| item["event"] == "run_succeeded"));
        assert!(lines.iter().any(|item| item["event"] == "run_failed"));
    }
}
