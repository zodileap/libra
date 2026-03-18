import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Tauri 主入口源码，验证 Desktop 已迁到统一 runtime client，而不是继续直调 core 执行入口。
function readTauriSource() {
  const currentDir = process.cwd();
  const desktopRoot = currentDir.endsWith(path.join("apps", "desktop"))
    ? currentDir
    : path.resolve(currentDir, "apps", "desktop");
  return fs.readFileSync(
    path.resolve(desktopRoot, "src-tauri/src/main.rs"),
    "utf8",
  );
}

test("TestDesktopShouldUseUnifiedRuntimeClient", () => {
  const source = readTauriSource();

  // 描述：
  //
  //   - Tauri 主链路应使用 runtime client 的 run/capabilities/model/sandbox 接口，并移除旧的 core 直调主路径。
  assert.match(source, /use libra_runtime_client::/);
  assert.match(source, /\.run_session\(/);
  assert.match(source, /\.detect_capabilities\(/);
  assert.match(source, /\.call_model\(/);
  assert.match(source, /\.cancel_run\(/);
  assert.match(source, /\.submit_approval\(/);
  assert.match(source, /\.submit_user_input\(/);
  assert.doesNotMatch(source, /run_agent_with_protocol_error_stream/);

  // 描述：
  //
  //   - Desktop 走嵌入式 runtime 时应显式放宽启动超时，避免冷启动阶段误报“等待 runtime 就绪超时”。
  assert.match(source, /config\.startup_timeout = Duration::from_secs\(30\);/);

  // 描述：
  //
  //   - Desktop 不应在真正打开 runtime 运行流之前伪造 started 事件；started 必须来自 runtime 自身。
  assert.match(source, /"started" \| "llm_started" \| "llm_finished" \| "planning" \| "heartbeat" \| "final"/);
  assert.doesNotMatch(
    source,
    /kind:\s*"started"\.to_string\(\),[\s\S]*message:\s*"LLM 执行已开始"\.to_string\(\)/,
  );
});
