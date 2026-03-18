import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Tauri 主入口源码，校验 Desktop 与 Core 的命令候选解析是否保持一致。
//
// Returns:
//
//   - 0: `main.rs` 的 UTF-8 文本内容。
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

test("TestDesktopShouldReuseCoreCliCommandCandidates", () => {
  const source = readTauriSource();

  // 描述：
  //
  //   - Desktop 的 CLI 健康检查必须复用 Core 侧统一命令候选解析，避免“探测一套、运行一套”。
  assert.match(source, /resolve_codex_command_candidates,/);
  assert.match(source, /resolve_gemini_command_candidates,/);
  assert.match(source, /resolve_python_command_candidates,/);
  assert.match(
    source,
    /fn resolve_codex_bins\(\) -> Vec<CommandCandidate> \{\s*resolve_codex_command_candidates\(\)\s*\}/s,
  );
  assert.match(
    source,
    /fn resolve_gemini_bins\(\) -> Vec<CommandCandidate> \{\s*resolve_gemini_command_candidates\(\)\s*\}/s,
  );
  assert.match(
    source,
    /fn resolve_python_bins\(\) -> Vec<CommandCandidate> \{\s*resolve_python_command_candidates\(\)\s*\}/s,
  );
  assert.match(source, /candidate\.build_command\(\)\.arg\("--version"\)/);
  assert.match(source, /let bin_text = bin\.display\(\);/);
});
