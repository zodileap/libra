use libra_runtime_proto::runtime::runtime_service_client::RuntimeServiceClient;
use libra_runtime_proto::runtime::{
    self, AgentRunResult, CallModelRequest, CallModelResponse, CancelRunRequest,
    DetectCapabilitiesRequest, DetectCapabilitiesResponse, GetSandboxMetricsRequest,
    GetSandboxMetricsResponse, HealthRequest, HealthResponse, ListMessagesRequest,
    ListMessagesResponse, ListSessionsRequest, ListSessionsResponse, ResetSandboxRequest,
    RunControlRequest, RunEvent, RunStartRequest, SubmitApprovalRequest, SubmitUserInputRequest,
};
use libra_runtime_server::{start_embedded, EmbeddedRuntimeHandle, RuntimeServerConfig};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::io::IsTerminal;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::{sleep, Instant};
use tokio_stream::wrappers::ReceiverStream;

/// 描述：runtime 启动模式；Desktop 默认使用嵌入式启动，sidecar SDK/CLI 可切换为子进程模式。
#[derive(Debug, Clone)]
pub enum RuntimeLaunchMode {
    Embedded,
    Process,
}

/// 描述：runtime 客户端配置，统一约束监听地址、数据目录、启动方式与可执行路径。
#[derive(Debug, Clone)]
pub struct RuntimeClientConfig {
    pub addr: SocketAddr,
    pub data_dir: PathBuf,
    pub launch_mode: RuntimeLaunchMode,
    pub runtime_bin: Option<PathBuf>,
    pub startup_timeout: Duration,
    pub run_open_timeout: Duration,
}

impl RuntimeClientConfig {
    /// 描述：创建一个默认 runtime 客户端配置。
    pub fn new(addr: SocketAddr, data_dir: impl Into<PathBuf>) -> Self {
        Self {
            addr,
            data_dir: data_dir.into(),
            launch_mode: RuntimeLaunchMode::Embedded,
            runtime_bin: None,
            startup_timeout: Duration::from_secs(10),
            run_open_timeout: Duration::from_secs(15),
        }
    }

    /// 描述：返回当前配置对应的 gRPC 端点地址。
    pub fn endpoint(&self) -> String {
        format!("http://{}", self.addr)
    }
}

/// 描述：runtime 客户端错误，统一包装启动失败、gRPC 失败和运行时返回错误。
#[derive(Debug, Clone)]
pub struct RuntimeClientError {
    pub code: String,
    pub message: String,
}

impl RuntimeClientError {
    /// 描述：创建一个客户端错误。
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl Display for RuntimeClientError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for RuntimeClientError {}

/// 描述：运行时客户端管理器，负责确保 runtime 已启动，并管理会话级控制流发送器。
#[derive(Clone)]
pub struct RuntimeClientManager {
    config: RuntimeClientConfig,
    embedded_handle: Arc<Mutex<Option<EmbeddedRuntimeHandle>>>,
    process_child: Arc<Mutex<Option<Child>>>,
    active_runs: Arc<Mutex<HashMap<String, mpsc::Sender<RunControlRequest>>>>,
}

impl RuntimeClientManager {
    /// 描述：基于客户端配置创建 runtime 管理器。
    pub fn new(config: RuntimeClientConfig) -> Self {
        Self {
            config,
            embedded_handle: Arc::new(Mutex::new(None)),
            process_child: Arc::new(Mutex::new(None)),
            active_runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 描述：确保 runtime 已启动并可接受 gRPC 请求；若尚未启动，则按配置自动拉起。
    pub async fn ensure_started(&self) -> Result<(), RuntimeClientError> {
        if self.health().await.is_ok() {
            return Ok(());
        }

        match self.config.launch_mode {
            RuntimeLaunchMode::Embedded => self.ensure_embedded_started().await?,
            RuntimeLaunchMode::Process => self.ensure_process_started().await?,
        }

        let deadline = Instant::now() + self.config.startup_timeout;
        loop {
            if self.health().await.is_ok() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(RuntimeClientError::new(
                    "runtime.client.startup_timeout",
                    "等待 runtime 就绪超时",
                ));
            }
            sleep(Duration::from_millis(120)).await;
        }
    }

    /// 描述：调用 runtime 健康检查接口。
    pub async fn health(&self) -> Result<HealthResponse, RuntimeClientError> {
        let mut client = self.connect().await?;
        client
            .health(HealthRequest {})
            .await
            .map(|item| item.into_inner())
            .map_err(status_to_client_error)
    }

    /// 描述：调用 runtime 能力探测接口。
    pub async fn detect_capabilities(
        &self,
        request: DetectCapabilitiesRequest,
    ) -> Result<DetectCapabilitiesResponse, RuntimeClientError> {
        self.ensure_started().await?;
        let mut client = self.connect().await?;
        client
            .detect_capabilities(request)
            .await
            .map(|item| item.into_inner())
            .map_err(status_to_client_error)
    }

    /// 描述：查询 runtime 持久化会话列表。
    pub async fn list_sessions(
        &self,
        request: ListSessionsRequest,
    ) -> Result<ListSessionsResponse, RuntimeClientError> {
        self.ensure_started().await?;
        let mut client = self.connect().await?;
        client
            .list_sessions(request)
            .await
            .map(|item| item.into_inner())
            .map_err(status_to_client_error)
    }

    /// 描述：分页查询 runtime 持久化消息列表。
    pub async fn list_messages(
        &self,
        request: ListMessagesRequest,
    ) -> Result<ListMessagesResponse, RuntimeClientError> {
        self.ensure_started().await?;
        let mut client = self.connect().await?;
        client
            .list_messages(request)
            .await
            .map(|item| item.into_inner())
            .map_err(status_to_client_error)
    }

    /// 描述：调用 runtime 纯模型接口，供总结与记忆场景复用。
    pub async fn call_model(
        &self,
        request: CallModelRequest,
    ) -> Result<CallModelResponse, RuntimeClientError> {
        self.ensure_started().await?;
        let mut client = self.connect().await?;
        client
            .call_model(request)
            .await
            .map(|item| item.into_inner())
            .map_err(status_to_client_error)
    }

    /// 描述：查询会话沙盒指标。
    pub async fn get_sandbox_metrics(
        &self,
        session_id: impl Into<String>,
    ) -> Result<GetSandboxMetricsResponse, RuntimeClientError> {
        self.ensure_started().await?;
        let mut client = self.connect().await?;
        client
            .get_sandbox_metrics(GetSandboxMetricsRequest {
                session_id: session_id.into(),
            })
            .await
            .map(|item| item.into_inner())
            .map_err(status_to_client_error)
    }

    /// 描述：强制重置指定会话沙盒。
    pub async fn reset_sandbox(
        &self,
        session_id: impl Into<String>,
    ) -> Result<(), RuntimeClientError> {
        self.ensure_started().await?;
        let mut client = self.connect().await?;
        client
            .reset_sandbox(ResetSandboxRequest {
                session_id: session_id.into(),
            })
            .await
            .map(|_| ())
            .map_err(status_to_client_error)
    }

    /// 描述：建立会话运行流，并在运行期间为后续取消、审批和用户输入保留控制通道。
    pub async fn run_session<F>(
        &self,
        request: RunStartRequest,
        mut on_event: F,
    ) -> Result<AgentRunResult, RuntimeClientError>
    where
        F: FnMut(RunEvent) + Send,
    {
        self.ensure_started().await?;
        let mut client = self.connect().await?;
        let session_id = request
            .context
            .as_ref()
            .map(|item| item.session_id.trim().to_string())
            .unwrap_or_default();
        let (tx, rx) = mpsc::channel(32);
        tx.send(RunControlRequest {
            payload: Some(runtime::run_control_request::Payload::StartRun(request)),
        })
        .await
        .map_err(|err| {
            RuntimeClientError::new(
                "runtime.client.stream_send_failed",
                format!("发送 start_run 失败: {}", err),
            )
        })?;
        let response = tokio::time::timeout(
            self.config.run_open_timeout,
            client.run(ReceiverStream::new(rx)),
        )
        .await
        .map_err(|_| {
            RuntimeClientError::new(
                "runtime.client.run_open_timeout",
                "等待 runtime 打开运行流超时",
            )
        })?
        .map_err(status_to_client_error)?;

        if !session_id.is_empty() {
            self.register_active_run(session_id.as_str(), tx.clone());
        }

        let mut stream = response.into_inner();
        while let Some(event) = stream.message().await.map_err(status_to_client_error)? {
            on_event(event.clone());
            if event.kind == "result" {
                self.unregister_active_run(session_id.as_str());
                return event.final_result.ok_or_else(|| {
                    RuntimeClientError::new(
                        "runtime.client.missing_final_result",
                        "runtime result 事件缺少 final_result 载荷",
                    )
                });
            }
            if event.kind == "error" || event.kind == "cancelled" {
                self.unregister_active_run(session_id.as_str());
                return Err(RuntimeClientError::new(
                    if event.code.trim().is_empty() {
                        "runtime.client.run_failed"
                    } else {
                        event.code.as_str()
                    },
                    event.message,
                ));
            }
        }

        self.unregister_active_run(session_id.as_str());
        Err(RuntimeClientError::new(
            "runtime.client.stream_closed",
            "runtime 运行流在返回最终结果前已关闭",
        ))
    }

    /// 描述：取消指定会话的运行；若本进程持有活动流发送器，则优先通过流内控制完成。
    pub async fn cancel_run(&self, session_id: &str) -> Result<(), RuntimeClientError> {
        self.ensure_started().await?;
        if self
            .send_control_if_active(
                session_id,
                RunControlRequest {
                    payload: Some(runtime::run_control_request::Payload::CancelRun(
                        CancelRunRequest {
                            session_id: session_id.to_string(),
                            run_id: String::new(),
                        },
                    )),
                },
            )
            .await
        {
            return Ok(());
        }

        let mut client = self.connect().await?;
        client
            .cancel_run(CancelRunRequest {
                session_id: session_id.to_string(),
                run_id: String::new(),
            })
            .await
            .map(|_| ())
            .map_err(status_to_client_error)
    }

    /// 描述：提交人工审批结果；若本进程持有活动流发送器，则优先写入当前 bidirectional stream。
    pub async fn submit_approval(
        &self,
        approval_id: &str,
        approved: bool,
    ) -> Result<(), RuntimeClientError> {
        self.ensure_started().await?;
        let payload = SubmitApprovalRequest {
            approval_id: approval_id.to_string(),
            approved,
        };
        let mut client = self.connect().await?;
        client
            .submit_approval(payload)
            .await
            .map(|_| ())
            .map_err(status_to_client_error)
    }

    /// 描述：提交结构化用户输入结果。
    pub async fn submit_user_input(
        &self,
        request_id: &str,
        resolution: &str,
        answers: Vec<runtime::UserInputAnswer>,
    ) -> Result<(), RuntimeClientError> {
        self.ensure_started().await?;
        let mut client = self.connect().await?;
        client
            .submit_user_input(SubmitUserInputRequest {
                request_id: request_id.to_string(),
                resolution: resolution.to_string(),
                answers,
            })
            .await
            .map(|_| ())
            .map_err(status_to_client_error)
    }

    /// 描述：建立 gRPC 客户端连接。
    async fn connect(
        &self,
    ) -> Result<RuntimeServiceClient<tonic::transport::Channel>, RuntimeClientError> {
        RuntimeServiceClient::connect(self.config.endpoint())
            .await
            .map_err(|err| {
                RuntimeClientError::new(
                    "runtime.client.connect_failed",
                    format!("连接 runtime 失败: {}", err),
                )
            })
    }

    /// 描述：确保嵌入式 runtime 已在当前宿主进程内启动。
    async fn ensure_embedded_started(&self) -> Result<(), RuntimeClientError> {
        let should_start = self
            .embedded_handle
            .lock()
            .map_err(|_| {
                RuntimeClientError::new("runtime.client.lock_failed", "embedded handle 锁获取失败")
            })?
            .is_none();
        if !should_start {
            return Ok(());
        }

        let handle = start_embedded(RuntimeServerConfig::new(
            self.config.addr,
            self.config.data_dir.clone(),
        ))
        .await
        .map_err(|err| {
            RuntimeClientError::new(
                "runtime.client.embedded_start_failed",
                format!("启动嵌入式 runtime 失败: {}", err),
            )
        })?;
        let mut guard = self.embedded_handle.lock().map_err(|_| {
            RuntimeClientError::new("runtime.client.lock_failed", "embedded handle 锁获取失败")
        })?;
        if guard.is_none() {
            *guard = Some(handle);
        }
        Ok(())
    }

    /// 描述：确保 sidecar 子进程已启动；若未提供显式路径，则回退到 `libra-runtime`。
    async fn ensure_process_started(&self) -> Result<(), RuntimeClientError> {
        let mut guard = self.process_child.lock().map_err(|_| {
            RuntimeClientError::new("runtime.client.lock_failed", "process child 锁获取失败")
        })?;
        if guard.is_some() {
            return Ok(());
        }
        let runtime_bin = self
            .config
            .runtime_bin
            .clone()
            .unwrap_or_else(|| PathBuf::from("libra-runtime"));
        let stdout = process_stdio_for_host(should_inherit_process_stdio(
            std::io::stdout().is_terminal(),
        ));
        let stderr = process_stdio_for_host(should_inherit_process_stdio(
            std::io::stderr().is_terminal(),
        ));
        let child = Command::new(runtime_bin)
            .arg("--addr")
            .arg(self.config.addr.to_string())
            .arg("--data-dir")
            .arg(&self.config.data_dir)
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .spawn()
            .map_err(|err| {
                RuntimeClientError::new(
                    "runtime.client.process_start_failed",
                    format!("启动 runtime 子进程失败: {}", err),
                )
            })?;
        *guard = Some(child);
        Ok(())
    }

    /// 描述：注册活动会话的控制发送器，供取消与控制消息复用。
    fn register_active_run(&self, session_id: &str, sender: mpsc::Sender<RunControlRequest>) {
        if session_id.trim().is_empty() {
            return;
        }
        if let Ok(mut guard) = self.active_runs.lock() {
            guard.insert(session_id.trim().to_string(), sender);
        }
    }

    /// 描述：注销活动会话控制发送器，避免后续误发控制消息。
    fn unregister_active_run(&self, session_id: &str) {
        if session_id.trim().is_empty() {
            return;
        }
        if let Ok(mut guard) = self.active_runs.lock() {
            guard.remove(session_id.trim());
        }
    }

    /// 描述：若本进程存在活动流发送器，则直接通过当前运行流发送控制消息。
    async fn send_control_if_active(&self, session_id: &str, request: RunControlRequest) -> bool {
        let sender = self
            .active_runs
            .lock()
            .ok()
            .and_then(|guard| guard.get(session_id.trim()).cloned());
        if let Some(sender) = sender {
            return sender.send(request).await.is_ok();
        }
        false
    }
}

/// 描述：根据宿主输出是否直接连接到终端，决定 sidecar 子进程的 stdout/stderr 去向。
///
/// Returns:
///
///   - `Stdio::inherit()`: 交互式终端场景，保留 sidecar 诊断输出可见性。
///   - `Stdio::null()`: 非终端捕获场景，避免 sidecar 长持有管道导致 CLI/测试阻塞。
fn process_stdio_for_host(should_inherit: bool) -> Stdio {
    if should_inherit {
        return Stdio::inherit();
    }
    Stdio::null()
}

/// 描述：判断宿主当前输出环境是否应将 sidecar 输出直接透传到控制台。
///
/// Returns:
///
///   - `true`: 宿主 stdout/stderr 直连终端，sidecar 诊断输出可以直接复用。
///   - `false`: 宿主处于捕获或管道模式，需静默 sidecar 输出避免阻塞父进程退出。
fn should_inherit_process_stdio(is_terminal: bool) -> bool {
    is_terminal
}

/// 描述：把 tonic status 统一映射为 runtime 客户端错误。
fn status_to_client_error(status: tonic::Status) -> RuntimeClientError {
    RuntimeClientError::new("runtime.client.grpc_failed", status.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// 描述：构造一个固定的未知 provider 运行请求，供客户端回归测试复用。
    fn build_unknown_provider_request(session_id: &str) -> RunStartRequest {
        RunStartRequest {
            context: Some(runtime::RuntimeContext {
                user_id: "user-1".to_string(),
                session_id: session_id.to_string(),
                ..Default::default()
            }),
            agent_key: "agent-code-default".to_string(),
            provider: "unknown-provider".to_string(),
            prompt: "hello".to_string(),
            execution_mode: "workflow".to_string(),
            ..Default::default()
        }
    }

    /// 描述：验证客户端在嵌入式模式下会自动拉起 runtime，并能完成健康检查。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn should_auto_start_embedded_runtime() {
        let dir = tempdir().expect("tempdir");
        let manager = RuntimeClientManager::new(RuntimeClientConfig::new(
            "127.0.0.1:55091".parse().expect("addr"),
            dir.path(),
        ));
        let health = manager.health().await;
        assert!(health.is_err());
        manager.ensure_started().await.expect("ensure started");
        let health = manager.health().await.expect("health after start");
        assert!(health.ready);
    }

    /// 描述：验证默认客户端配置会为运行流打开阶段设置独立超时，避免宿主长期停留在“正在思考”。
    #[test]
    fn should_set_default_run_open_timeout() {
        let config = RuntimeClientConfig::new(
            "127.0.0.1:55099".parse().expect("addr"),
            "/tmp/libra-runtime-client-default-timeout",
        );
        assert_eq!(config.startup_timeout, Duration::from_secs(10));
        assert_eq!(config.run_open_timeout, Duration::from_secs(15));
    }

    /// 描述：验证同一个 session_id 连续两次运行时，客户端会收到流内结构化错误，而不是把第二次误判为 open timeout。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn should_return_structured_error_for_second_same_session_run() {
        let dir = tempdir().expect("tempdir");
        let manager = RuntimeClientManager::new(RuntimeClientConfig::new(
            "127.0.0.1:55092".parse().expect("addr"),
            dir.path(),
        ));

        let first = manager
            .run_session(build_unknown_provider_request("session-reused"), |_| {})
            .await
            .expect_err("first run should fail with unknown provider");
        assert_eq!(first.code, "core.agent.llm.provider_unknown");

        let second = manager
            .run_session(build_unknown_provider_request("session-reused"), |_| {})
            .await
            .expect_err("second run should still fail structurally");
        assert_eq!(second.code, "core.agent.llm.provider_unknown");
        assert_ne!(second.code, "runtime.client.run_open_timeout");
    }

    /// 描述：验证非终端环境下会将 sidecar 输出静默，避免捕获 stdout/stderr 的宿主被子进程阻塞。
    #[test]
    fn should_silence_sidecar_stdio_when_host_is_not_terminal() {
        assert!(!should_inherit_process_stdio(false));
        assert!(should_inherit_process_stdio(true));
    }
}
