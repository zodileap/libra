import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 描述：
//
//   - 读取仓库根目录中的跨平台发布脚本文本，供临时夹具复制与执行测试复用。
//
// Returns:
//
//   - 打包脚本源码文本。
function readReleaseScriptSource() {
  const absolutePath = path.resolve(process.cwd(), "..", "..", "scripts/package-desktop-release.mjs");
  return fs.readFileSync(absolutePath, "utf8");
}

// 描述：
//
//   - 读取仓库中的平台包装脚本文本，确保 Bash 与 Windows CMD 入口都统一委托到跨平台 Node CLI。
//
// Params:
//
//   - relativePath: 包装脚本相对仓库根目录的路径。
//
// Returns:
//
//   - 包装脚本源码文本。
function readWrapperSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), "..", "..", relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

// 描述：
//
//   - 创建最小化的 Tauri wrapper 夹具，并用伪造的 pnpm 入口捕获实际下发给 Tauri CLI 的参数，验证本地覆盖配置是否被注入。
//
// Returns:
//
//   - rootDir: 临时仓库根目录。
//   - runnerPath: 临时 wrapper 脚本路径。
//   - capturePath: 伪 pnpm 捕获参数的输出文件路径。
function createTauriRunnerFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "libra-tauri-runner-"));
  const runnerPath = path.join(rootDir, "scripts", "run-desktop-tauri.mjs");
  const pnpmShimPath = path.join(rootDir, "scripts", "pnpm-shim.mjs");
  const capturePath = path.join(rootDir, "captured-runner-command.json");
  const tauriDir = path.join(rootDir, "apps", "desktop", "src-tauri");
  const localConfigPath = path.join(tauriDir, "tauri.local.conf.json");
  const updaterDir = path.join(rootDir, ".tauri");
  const publicKeyPath = path.join(updaterDir, "libra-desktop-updater.key.pub");
  const publicKey = "dW50cnVzdGVkIGNvbW1lbnQ6IHRlc3QgcHVibGljIGtleQpSV1FUQWRURVNUUEtFWQ==";

  fs.mkdirSync(path.dirname(runnerPath), { recursive: true });
  fs.mkdirSync(tauriDir, { recursive: true });
  fs.mkdirSync(updaterDir, { recursive: true });
  fs.writeFileSync(runnerPath, readWrapperSource("scripts/run-desktop-tauri.mjs"), "utf8");
  fs.chmodSync(runnerPath, 0o755);
  fs.writeFileSync(
    pnpmShimPath,
    `import fs from "node:fs";
import process from "node:process";

const capturePath = process.env.CAPTURE_PATH;

if (!capturePath) {
  process.stderr.write("missing CAPTURE_PATH\\n");
  process.exit(1);
}

fs.writeFileSync(capturePath, JSON.stringify({
  argv: process.argv.slice(2),
  updaterPubkey: process.env.LIBRA_UPDATER_PUBKEY || "",
}, null, 2));
`,
    "utf8",
  );
  fs.chmodSync(pnpmShimPath, 0o755);
  fs.writeFileSync(
    localConfigPath,
    `${JSON.stringify({ identifier: "com.libra.zodileap.desktop" }, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(publicKeyPath, `${publicKey}\n`, "utf8");

  return { rootDir, runnerPath, pnpmShimPath, capturePath, localConfigPath, publicKeyPath, publicKey };
}

// 描述：
//
//   - 在临时 Tauri target 目录里写入一个引用旧工作区绝对路径的 build cache，模拟仓库重命名或 worktree 迁移后的脏缓存。
//
// Params:
//
//   - rootDir: 临时仓库根目录。
//   - staleWorkspaceRoot: 旧工作区根目录。
function writeStaleTauriTargetCache(rootDir, staleWorkspaceRoot) {
  const staleBuildDir = path.join(rootDir, "apps", "desktop", "src-tauri", "target", "debug", "build", "tauri-stale", "out");
  const staleTargetRoot = path.join(staleWorkspaceRoot, "apps", "desktop", "src-tauri", "target");

  fs.mkdirSync(staleBuildDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "apps", "desktop", "src-tauri", "target", "debug", "build", "tauri-stale", "root-output"),
    `${path.join(staleTargetRoot, "debug", "build", "tauri-stale", "out", "tauri-core-app-permission-files")}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(rootDir, "apps", "desktop", "src-tauri", "target", "debug", "build", "tauri-stale", "output"),
    `cargo:core:app__CORE_PLUGIN___PERMISSION_FILES_PATH=${path.join(staleTargetRoot, "debug", "build", "tauri-stale", "out", "tauri-core-app-permission-files")}\n`,
    "utf8",
  );
}

// 描述：
//
//   - 统一解析临时文件在当前系统中的真实路径，避免 macOS `/tmp` 与 `/private/tmp` 的别名差异导致断言误判。
//
// Params:
//
//   - filePath: 待解析的文件或目录路径。
//
// Returns:
//
//   - 真实文件系统路径。
function resolveRealPath(filePath) {
  return fs.realpathSync(filePath);
}

// 描述：
//
//   - 断言指定仓库文件未提交本机签名身份、团队标识、notarization 回执或 API 凭据实值，避免开源仓库泄露本地发布信息。
//
// Params:
//
//   - relativePaths: 待检查的仓库相对路径列表。
function assertNoLocalSigningMetadata(relativePaths) {
  const forbiddenPatterns = [
    /Authority=Developer ID Application:\s+[A-Za-z0-9][^<\n]*\([A-Z0-9]{10}\)/,
    /Developer ID Application:\s+[A-Za-z0-9][^<\n]*\([A-Z0-9]{10}\)/,
    /TeamIdentifier=\s*[A-Z0-9]{10}/,
    /export APPLE_TEAM_ID='[A-Z0-9]{10}'/,
    /export APPLE_API_ISSUER='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i,
    /export APPLE_API_KEY='[A-Z0-9]{10}'/,
    /export APPLE_API_KEY_PATH=['"][^<"\n]*AuthKey_[A-Z0-9]{10}\.p8['"]/,
    /\/Users\/[^/\n]+\/\.private_keys\/AuthKey_[A-Z0-9]{10}\.p8/,
    /Notarization Ticket=/,
  ];

  for (const relativePath of relativePaths) {
    const source = readWrapperSource(relativePath);

    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${relativePath} should not commit local signing metadata`);
    }
  }
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
  const scriptPath = path.join(rootDir, "scripts/package-desktop-release.mjs");
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
      process.execPath,
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
        process.execPath,
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

test("TestDesktopReleaseWrapperScriptsShouldDelegateToNodeCli", () => {
  const shellWrapperSource = readWrapperSource("scripts/package-desktop-release.sh");
  const windowsWrapperSource = readWrapperSource("scripts/package-desktop-release.cmd");
  const desktopPackageSource = readWrapperSource("apps/desktop/package.json");
  const tauriRunnerSource = readWrapperSource("scripts/run-desktop-tauri.mjs");

  // 描述：
  //
  //   - macOS/Linux 的 Bash 入口、Windows 的 CMD 入口和 Desktop 包脚本都应委托给统一 Node CLI，并支持本地覆盖配置。
  assert.match(shellWrapperSource, /package-desktop-release\.mjs/);
  assert.match(windowsWrapperSource, /package-desktop-release\.mjs/);
  assert.match(desktopPackageSource, /run-desktop-tauri\.mjs dev/);
  assert.match(desktopPackageSource, /run-desktop-tauri\.mjs build/);
  assert.match(desktopPackageSource, /run-desktop-tauri\.mjs build --bundles app/);
  assert.match(tauriRunnerSource, /tauri\.local\.conf\.json/);
  assert.match(tauriRunnerSource, /tauri\.\$\{platformName\}\.local\.conf\.json/);
  assert.match(tauriRunnerSource, /TAURI_UPDATER_PRIVATE_KEY_PATH/);
  assert.match(tauriRunnerSource, /TAURI_UPDATER_PUBLIC_KEY_PATH/);
  assert.match(tauriRunnerSource, /LIBRA_UPDATER_PUBKEY/);
  assert.match(tauriRunnerSource, /TAURI_SIGNING_PRIVATE_KEY/);
});

test("TestDesktopTauriRunnerShouldInjectLocalConfigIntoBuildCommand", () => {
  const fixture = createTauriRunnerFixture();

  try {
    const output = execFileSync(
      process.execPath,
      [fixture.runnerPath, "build"],
      {
        cwd: fixture.rootDir,
        encoding: "utf8",
        env: {
          ...process.env,
          npm_execpath: fixture.pnpmShimPath,
          CAPTURE_PATH: fixture.capturePath,
          HOME: fixture.rootDir,
        },
      },
    );
    const capturedCommand = JSON.parse(fs.readFileSync(fixture.capturePath, "utf8"));

    // 描述：
    //
    //   - 官方构建入口应同时注入 `tauri.local.conf.json` 与本地 `.pub` 派生的临时 updater 配置，保证 Bundle ID 与公钥都来自本地覆盖。
    assert.match(output, /Using local Tauri config overrides:/);
    assert.match(output, /tauri\.local\.conf\.json/);
    assert.match(output, /Using local updater public key source:/);
    assert.match(output, /libra-desktop-updater\.key\.pub/);
    assert.equal(capturedCommand.updaterPubkey, fixture.publicKey);
    assert.deepEqual(capturedCommand.argv.slice(0, 7), [
      "--dir",
      resolveRealPath(path.join(fixture.rootDir, "apps", "desktop")),
      "exec",
      "tauri",
      "build",
      "--config",
      resolveRealPath(fixture.localConfigPath),
    ]);
    assert.equal(capturedCommand.argv[7], "--config");
    assert.match(capturedCommand.argv[8], /tauri\.updater\.local\.conf\.json$/);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("TestDesktopTauriRunnerShouldClearStaleWorkspaceTargetCache", () => {
  const fixture = createTauriRunnerFixture();
  const targetDir = path.join(fixture.rootDir, "apps", "desktop", "src-tauri", "target");

  try {
    writeStaleTauriTargetCache(fixture.rootDir, "/Users/yoho/code/zodileap-agen");

    const output = execFileSync(
      process.execPath,
      [fixture.runnerPath, "dev"],
      {
        cwd: fixture.rootDir,
        encoding: "utf8",
        env: {
          ...process.env,
          npm_execpath: fixture.pnpmShimPath,
          CAPTURE_PATH: fixture.capturePath,
          HOME: fixture.rootDir,
        },
      },
    );
    const capturedCommand = JSON.parse(fs.readFileSync(fixture.capturePath, "utf8"));

    // 描述：
    //
    //   - 当 `src-tauri/target` 内残留旧仓库绝对路径时，wrapper 应在调用 Tauri CLI 前自动清理缓存，避免权限文件继续指向失效路径。
    assert.match(output, /Detected stale Tauri target cache from another workspace and cleared it:/);
    assert.match(output, /zodileap-agen/);
    assert.equal(fs.existsSync(targetDir), false);
    assert.deepEqual(capturedCommand.argv.slice(0, 5), [
      "--dir",
      resolveRealPath(path.join(fixture.rootDir, "apps", "desktop")),
      "exec",
      "tauri",
      "dev",
    ]);
  } finally {
    fs.rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("TestDesktopReleaseScriptShouldValidateMacosSigningEnvironment", () => {
  const releaseScriptSource = readReleaseScriptSource();

  // 描述：
  //
  //   - 本地 macOS 打包应在调用 `tauri build` 前校验 Apple 签名与 notarization 环境变量，避免构建后期才失败。
  assert.match(releaseScriptSource, /function ensureMacosSigningEnvironment\(env = process\.env\)/);
  assert.match(releaseScriptSource, /APPLE_SIGNING_IDENTITY/);
  assert.match(releaseScriptSource, /APPLE_API_ISSUER/);
  assert.match(releaseScriptSource, /APPLE_API_KEY/);
  assert.match(releaseScriptSource, /APPLE_API_KEY_PATH/);
  assert.match(releaseScriptSource, /APPLE_ID/);
  assert.match(releaseScriptSource, /APPLE_PASSWORD/);
  assert.match(releaseScriptSource, /APPLE_TEAM_ID/);
  assert.match(releaseScriptSource, /quoted "~" will not expand/);
  assert.match(releaseScriptSource, /ensureMacosSigningEnvironment\(process\.env\)/);
  assert.match(releaseScriptSource, /run-desktop-tauri\.mjs/);
  assert.match(releaseScriptSource, /TAURI_UPDATER_PUBLIC_KEY_PATH/);
  assert.match(releaseScriptSource, /tauri\.local\.conf\.json/);
  assert.match(releaseScriptSource, /function maskSensitiveValue\(value\)/);
  assert.match(releaseScriptSource, /function describeUpdaterPublicKeySource\(source\)/);
  assert.doesNotMatch(releaseScriptSource, /Apple identity:\s+\$\{readEnvValue\("APPLE_SIGNING_IDENTITY"\)\}/);
  assert.doesNotMatch(releaseScriptSource, /Apple API issuer:\s+\$\{readEnvValue\("APPLE_API_ISSUER"\)/);
  assert.doesNotMatch(releaseScriptSource, /Apple API key:\s+\$\{readEnvValue\("APPLE_API_KEY"\)/);
  assert.doesNotMatch(releaseScriptSource, /Apple API key path:\s+\$\{readEnvValue\("APPLE_API_KEY_PATH"\)/);
  assert.doesNotMatch(releaseScriptSource, /Updater private key:\s+\$\{PRIVATE_KEY_PATH\}/);
  assert.doesNotMatch(releaseScriptSource, /Updater public key:\s+\$\{localUpdaterPublicKey\.source\}/);
});

test("TestDesktopPackagingSourcesShouldNotCommitLocalSigningMetadata", () => {
  assertNoLocalSigningMetadata([
    "README.md",
    "docs/desktop-self-hosted-updates.md",
    "apps/desktop/README.md",
    "apps/desktop/package.json",
    "apps/desktop/src-tauri/tauri.conf.json",
    "scripts/run-desktop-tauri.mjs",
    "scripts/package-desktop-release.mjs",
  ]);
});
