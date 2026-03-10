import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 描述：
//
//   - 读取仓库根目录中的发布脚本文本，供临时夹具复制与执行测试复用。
//
// Returns:
//
//   - 打包脚本源码文本。
function readReleaseScriptSource() {
  const absolutePath = path.resolve(process.cwd(), "..", "..", "scripts/package-desktop-release.sh");
  return fs.readFileSync(absolutePath, "utf8");
}

// 描述：
//
//   - 创建最小化 Desktop 发布夹具，便于在临时目录中真实执行版本同步脚本。
//
// Returns:
//
//   - rootDir: 临时仓库根目录。
//   - scriptPath: 临时脚本路径。
function createReleaseFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "libra-desktop-release-"));
  const scriptPath = path.join(rootDir, "scripts/package-desktop-release.sh");
  const rootPackagePath = path.join(rootDir, "package.json");
  const desktopPackagePath = path.join(rootDir, "apps/desktop/package.json");
  const tauriConfigPath = path.join(rootDir, "apps/desktop/src-tauri/tauri.conf.json");
  const cargoTomlPath = path.join(rootDir, "apps/desktop/src-tauri/Cargo.toml");

  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.mkdirSync(path.dirname(desktopPackagePath), { recursive: true });
  fs.mkdirSync(path.dirname(tauriConfigPath), { recursive: true });

  fs.writeFileSync(scriptPath, readReleaseScriptSource(), "utf8");
  fs.chmodSync(scriptPath, 0o755);
  fs.writeFileSync(rootPackagePath, `${JSON.stringify({ name: "libra", version: "0.1.0" }, null, 2)}\n`, "utf8");
  fs.writeFileSync(desktopPackagePath, `${JSON.stringify({ name: "@libra/desktop", version: "0.1.0" }, null, 2)}\n`, "utf8");
  fs.writeFileSync(tauriConfigPath, `${JSON.stringify({ productName: "Libra Desktop", version: "0.1.0" }, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    cargoTomlPath,
    `[package]
name = "libra_desktop"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
`,
    "utf8",
  );

  return { rootDir, scriptPath, rootPackagePath, desktopPackagePath, tauriConfigPath, cargoTomlPath };
}

// 描述：
//
//   - 从 JSON 文件中读取 version 字段，供版本同步断言复用。
//
// Params:
//
//   - filePath: JSON 文件路径。
//
// Returns:
//
//   - version 字段内容。
function readJsonVersion(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")).version;
}

// 描述：
//
//   - 从 Cargo.toml 的 [package] 段读取 version 字段，确保断言目标为应用版本而非依赖版本。
//
// Params:
//
//   - filePath: Cargo.toml 文件路径。
//
// Returns:
//
//   - [package] 段 version 内容。
function readCargoVersion(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const match = source.match(/\[package\][\s\S]*?version = "([^"]+)"/);
  return match ? match[1] : "";
}

test("TestDesktopReleaseScriptShouldSyncSpecifiedVersion", () => {
  const fixture = createReleaseFixture();

  try {
    const output = execFileSync(
      "bash",
      [fixture.scriptPath, "--version", "1.2.3", "--sync-only"],
      { cwd: fixture.rootDir, encoding: "utf8" },
    );

    // 描述：
    //
    //   - 传入目标版本后，脚本应同步更新四个版本文件，并在仅同步模式下跳过打包。
    assert.match(output, /Synced Desktop version to 1\.2\.3/);
    assert.match(output, /Version sync completed\. Skipped packaging\./);
    assert.equal(readJsonVersion(fixture.rootPackagePath), "1.2.3");
    assert.equal(readJsonVersion(fixture.desktopPackagePath), "1.2.3");
    assert.equal(readJsonVersion(fixture.tauriConfigPath), "1.2.3");
    assert.equal(readCargoVersion(fixture.cargoTomlPath), "1.2.3");
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("TestDesktopReleaseScriptShouldRejectNonTripletVersion", () => {
  const fixture = createReleaseFixture();

  try {
    let hitError = null;
    try {
      execFileSync(
        "bash",
        [fixture.scriptPath, "--version", "1.2", "--sync-only"],
        { cwd: fixture.rootDir, encoding: "utf8", stdio: "pipe" },
      );
    } catch (error) {
      hitError = error;
    }

    // 描述：
    //
    //   - 非三段式版本号应直接失败，并把具体原因写到 stderr，避免发版脚本静默退出。
    assert.ok(hitError);
    assert.match(String(hitError.stderr || ""), /invalid version: 1\.2 \(expected Major\.Minor\.Patch\)/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});
