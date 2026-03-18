use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Command;
use std::thread::sleep;
use std::time::Duration;
use tempfile::tempdir;

/// 描述：验证 CLI 执行一次 health 命令后，会同时创建 runtime.db 与 runtime 审计日志文件。
#[test]
fn should_create_runtime_db_and_audit_log_after_cli_run() {
    let bin = env!("CARGO_BIN_EXE_libra-runtime");
    let dir = tempdir().expect("tempdir");
    let data_dir = dir.path().join("runtime-data");
    let addr = allocate_free_addr();
    let output = Command::new(bin)
        .arg("--addr")
        .arg(addr.as_str())
        .arg("--data-dir")
        .arg(data_dir.as_os_str())
        .arg("--runtime-bin")
        .arg(bin)
        .arg("health")
        .output()
        .expect("execute cli health");

    assert!(
        output.status.success(),
        "health command should succeed; stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );

    let runtime_db = data_dir.join("runtime.db");
    let audit_log = PathBuf::from(&data_dir).join("logs/runtime-audit.jsonl");
    for _ in 0..30 {
        if runtime_db.exists() && audit_log.exists() {
            break;
        }
        sleep(Duration::from_millis(100));
    }
    assert!(
        runtime_db.exists(),
        "runtime.db should exist after cli run; stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        audit_log.exists(),
        "runtime-audit.jsonl should exist after cli run; stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// 描述：为 CLI 集成测试分配一个短暂空闲的本地监听地址，避免连到其他已存在的 sidecar 进程。
fn allocate_free_addr() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test port");
    let addr = listener.local_addr().expect("local addr");
    addr.to_string()
}
