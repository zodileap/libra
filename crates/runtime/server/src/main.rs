use libra_runtime_server::{serve, RuntimeServerConfig};
use std::net::SocketAddr;
use std::path::PathBuf;

/// 描述：sidecar 二进制入口，读取命令行参数后启动统一 runtime gRPC 服务。
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let mut addr: SocketAddr = "127.0.0.1:46329".parse()?;
    let mut data_dir = PathBuf::from(".libra/runtime");

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--addr" => {
                if let Some(value) = args.next() {
                    addr = value.parse()?;
                }
            }
            "--data-dir" => {
                if let Some(value) = args.next() {
                    data_dir = PathBuf::from(value);
                }
            }
            _ => {}
        }
    }

    serve(RuntimeServerConfig::new(addr, data_dir)).await
}
