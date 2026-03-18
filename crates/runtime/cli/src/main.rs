use clap::{Args, Parser, Subcommand};
use libra_runtime_client::{RuntimeClientConfig, RuntimeClientManager, RuntimeLaunchMode};
use libra_runtime_proto::runtime::{
    CallModelRequest, ListMessagesRequest, ListSessionsRequest, RunStartRequest, RuntimeContext,
    UserInputAnswer,
};
use libra_runtime_server::{serve, RuntimeServerConfig};
use serde_json::Value;
use std::net::SocketAddr;
use std::path::PathBuf;

/// 描述：Libra 统一 runtime CLI，负责 sidecar 启动、终端运行与宿主排障命令。
#[derive(Parser)]
#[command(name = "libra-runtime")]
#[command(version)]
struct Cli {
    #[arg(long, default_value = "127.0.0.1:46329")]
    addr: SocketAddr,

    #[arg(long, default_value = ".libra/runtime")]
    data_dir: PathBuf,

    #[arg(long)]
    runtime_bin: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

/// 描述：runtime CLI 子命令集合。
#[derive(Subcommand)]
enum Commands {
    Serve,
    Health,
    Run(RunArgs),
    Sessions(SessionsArgs),
    Messages(MessagesArgs),
    Cancel(CancelArgs),
    Approve(ApproveArgs),
    Answer(AnswerArgs),
    Model(ModelArgs),
}

/// 描述：终端运行参数。
#[derive(Args)]
struct RunArgs {
    #[arg(long)]
    session_id: String,
    #[arg(long, default_value = "agent-code-default")]
    agent_key: String,
    #[arg(long, default_value = "codex")]
    provider: String,
    #[arg(long)]
    prompt: String,
    #[arg(long, default_value = "workflow")]
    execution_mode: String,
    #[arg(long, default_value = "cli")]
    user_id: String,
    #[arg(long, default_value = "local")]
    tenant_id: String,
    #[arg(long, default_value = "default")]
    project_id: String,
    #[arg(long)]
    workdir: Option<String>,
    #[arg(long)]
    output_dir: Option<String>,
    #[arg(long)]
    provider_api_key: Option<String>,
    #[arg(long)]
    provider_model: Option<String>,
    #[arg(long)]
    provider_mode: Option<String>,
}

/// 描述：会话列表查询参数。
#[derive(Args)]
struct SessionsArgs {
    #[arg(long, default_value = "cli")]
    user_id: String,
    #[arg(long)]
    project_id: Option<String>,
    #[arg(long)]
    agent_code: Option<String>,
}

/// 描述：消息列表查询参数。
#[derive(Args)]
struct MessagesArgs {
    #[arg(long)]
    session_id: String,
    #[arg(long, default_value_t = 1)]
    page: i32,
    #[arg(long, default_value_t = 20)]
    page_size: i32,
}

/// 描述：运行取消参数。
#[derive(Args)]
struct CancelArgs {
    #[arg(long)]
    session_id: String,
}

/// 描述：人工审批参数。
#[derive(Args)]
struct ApproveArgs {
    #[arg(long)]
    approval_id: String,
    #[arg(long)]
    approved: bool,
}

/// 描述：结构化用户输入参数。
#[derive(Args)]
struct AnswerArgs {
    #[arg(long)]
    request_id: String,
    #[arg(long)]
    resolution: String,
    #[arg(long, default_value = "[]")]
    answers_json: String,
}

/// 描述：纯模型调用参数。
#[derive(Args)]
struct ModelArgs {
    #[arg(long, default_value = "codex")]
    provider: String,
    #[arg(long)]
    prompt: String,
    #[arg(long)]
    workdir: Option<String>,
    #[arg(long)]
    provider_api_key: Option<String>,
    #[arg(long)]
    provider_model: Option<String>,
    #[arg(long)]
    provider_mode: Option<String>,
}

/// 描述：CLI 入口；serve 模式直接启动 sidecar，其余命令通过 runtime client 自动连接或启动 runtime。
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    if matches!(cli.command, Commands::Serve) {
        serve(RuntimeServerConfig::new(cli.addr, cli.data_dir)).await?;
        return Ok(());
    }

    let mut config = RuntimeClientConfig::new(cli.addr, cli.data_dir);
    config.launch_mode = RuntimeLaunchMode::Process;
    config.runtime_bin = cli.runtime_bin;
    let manager = RuntimeClientManager::new(config);

    match cli.command {
        Commands::Serve => {}
        Commands::Health => {
            manager.ensure_started().await?;
            let health = manager.health().await?;
            println!(
                "ready={} version={} runtime_id={}",
                health.ready, health.version, health.runtime_id
            );
        }
        Commands::Run(args) => {
            let result = manager
                .run_session(
                    RunStartRequest {
                        context: Some(RuntimeContext {
                            tenant_id: args.tenant_id,
                            user_id: args.user_id,
                            project_id: args.project_id,
                            session_id: args.session_id,
                            ..Default::default()
                        }),
                        agent_key: args.agent_key,
                        provider: args.provider,
                        provider_api_key: args.provider_api_key.unwrap_or_default(),
                        provider_model: args.provider_model.unwrap_or_default(),
                        provider_mode: args.provider_mode.unwrap_or_default(),
                        prompt: args.prompt,
                        output_dir: args.output_dir.unwrap_or_default(),
                        workdir: args.workdir.unwrap_or_default(),
                        execution_mode: args.execution_mode,
                        ..Default::default()
                    },
                    |event| {
                        if event.kind == "delta" && !event.delta.is_empty() {
                            print!("{}", event.delta);
                            return;
                        }
                        eprintln!("[{}] {}", event.kind, event.message);
                    },
                )
                .await?;
            println!();
            println!("{}", result.display_message);
        }
        Commands::Sessions(args) => {
            let result = manager
                .list_sessions(ListSessionsRequest {
                    user_id: args.user_id,
                    project_id: args.project_id.unwrap_or_default(),
                    agent_code: args.agent_code.unwrap_or_default(),
                    ..Default::default()
                })
                .await?;
            for session in result.list {
                println!(
                    "{}\t{}\t{}\t{}",
                    session.id, session.agent_code, session.status, session.last_at
                );
            }
        }
        Commands::Messages(args) => {
            let result = manager
                .list_messages(ListMessagesRequest {
                    session_id: args.session_id,
                    page: args.page,
                    page_size: args.page_size,
                })
                .await?;
            for message in result.list {
                println!(
                    "{}\t{}\t{}\t{}",
                    message.message_id, message.role, message.created_at, message.content
                );
            }
        }
        Commands::Cancel(args) => {
            manager.cancel_run(args.session_id.as_str()).await?;
            println!("cancelled={}", args.session_id);
        }
        Commands::Approve(args) => {
            manager
                .submit_approval(args.approval_id.as_str(), args.approved)
                .await?;
            println!("approval_submitted={}", args.approval_id);
        }
        Commands::Answer(args) => {
            let answers = parse_answers_json(args.answers_json.as_str())?;
            manager
                .submit_user_input(args.request_id.as_str(), args.resolution.as_str(), answers)
                .await?;
            println!("answer_submitted={}", args.request_id);
        }
        Commands::Model(args) => {
            let result = manager
                .call_model(CallModelRequest {
                    provider: args.provider,
                    prompt: args.prompt,
                    workdir: args.workdir.unwrap_or_default(),
                    provider_api_key: args.provider_api_key.unwrap_or_default(),
                    provider_model: args.provider_model.unwrap_or_default(),
                    provider_mode: args.provider_mode.unwrap_or_default(),
                })
                .await?;
            println!("{}", result.content);
        }
    }

    Ok(())
}

/// 描述：把 CLI `answers_json` 参数解析为 runtime 协议结构，避免在命令入口散落字段校验。
fn parse_answers_json(raw: &str) -> Result<Vec<UserInputAnswer>, Box<dyn std::error::Error>> {
    let parsed: Value = serde_json::from_str(raw)?;
    let list = parsed
        .as_array()
        .ok_or("answers_json 必须是 JSON 数组")?
        .iter()
        .map(|item| UserInputAnswer {
            question_id: item
                .get("questionId")
                .or_else(|| item.get("question_id"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            answer_type: item
                .get("answerType")
                .or_else(|| item.get("answer_type"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            option_index: item
                .get("optionIndex")
                .or_else(|| item.get("option_index"))
                .and_then(Value::as_i64)
                .unwrap_or(-1) as i32,
            option_label: item
                .get("optionLabel")
                .or_else(|| item.get("option_label"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            value: item
                .get("value")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        })
        .collect();
    Ok(list)
}
