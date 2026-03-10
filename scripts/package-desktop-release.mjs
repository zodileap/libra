#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DESKTOP_DIR = path.join(ROOT_DIR, "apps", "desktop");
const TAURI_DIR = path.join(DESKTOP_DIR, "src-tauri");
const BUNDLE_DIR = path.join(TAURI_DIR, "target", "release", "bundle");
const RELEASES_DIR = path.join(ROOT_DIR, "releases");
const PUBLIC_KEY_DEST = path.join(TAURI_DIR, "updater", "public.key");
const PRIVATE_KEY_PATH = process.env.TAURI_UPDATER_PRIVATE_KEY_PATH || path.join(os.homedir(), ".tauri", "libra-desktop-updater.key");
const PUBLIC_KEY_PATH = `${PRIVATE_KEY_PATH}.pub`;

// 描述：
//
//   - 输出 Desktop 发布脚本的跨平台帮助信息，统一说明 Node、Bash 与 Windows CMD 的调用方式。
function usage() {
  process.stdout.write(`Usage:
  node scripts/package-desktop-release.mjs <x.y.z>
  node scripts/package-desktop-release.mjs --version <x.y.z> [--sync-only]
  ./scripts/package-desktop-release.sh <x.y.z>
  scripts\\package-desktop-release.cmd <x.y.z>

Description:
  1. Sync Libra Desktop version files to the requested release version
  2. Generate or reuse the official Tauri updater signing key
  3. Sync the updater public key into src-tauri/updater/public.key
  4. Run \`tauri build\` to produce:
     - full install bundles (for example .dmg / .msi)
     - updater artifacts (for example .app.tar.gz + .sig)
  5. Stage upload-ready folders under:
     releases/<version>/<platform>/

Notes:
  - This script does not upload files
  - This script does not generate latest.json
  - Upload the staged platform folder to your update server manually after packaging

Examples:
  node scripts/package-desktop-release.mjs 0.1.1
  node scripts/package-desktop-release.mjs --version 0.1.1 --sync-only
  pnpm run release:desktop -- 0.1.1
`);
}

// 描述：
//
//   - 解析发版脚本参数，兼容旧的“单个版本号位置参数”写法，以及新的 `--version` / `--sync-only` 组合。
//
// Params:
//
//   - argv: 命令行参数列表。
//
// Returns:
//
//   - targetVersion: 目标版本号。
//   - syncOnly: 是否仅同步版本号。
function parseArgs(argv) {
  let targetVersion = "";
  let syncOnly = false;

  for (let index = 0; index < argv.length; ) {
    const current = argv[index];

    if (current === "--help" || current === "-h") {
      usage();
      process.exit(0);
    }

    if (current === "--version") {
      if (index + 1 >= argv.length) {
        process.stderr.write("missing value for --version\n");
        usage();
        process.exit(1);
      }
      targetVersion = argv[index + 1];
      index += 2;
      continue;
    }

    if (current === "--sync-only") {
      syncOnly = true;
      index += 1;
      continue;
    }

    if (current.startsWith("--")) {
      process.stderr.write(`unknown option: ${current}\n`);
      usage();
      process.exit(1);
    }

    if (targetVersion) {
      process.stderr.write(`unexpected extra argument: ${current}\n`);
      usage();
      process.exit(1);
    }

    targetVersion = current;
    index += 1;
  }

  if (!targetVersion) {
    usage();
    process.exit(1);
  }

  return { targetVersion, syncOnly };
}

// 描述：
//
//   - 校验目标版本是否符合三段式版本规范，避免把非发布版本写入 Desktop 的多个版本文件。
//
// Params:
//
//   - version: 待校验的版本号。
function assertReleaseVersion(version) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    process.stderr.write(`invalid version: ${version} (expected Major.Minor.Patch)\n`);
    process.exit(1);
  }
}

// 描述：
//
//   - 根据当前平台转义 Shell 参数，确保带空格的路径在 macOS、Linux 与 Windows shell 中都能安全执行。
//
// Params:
//
//   - value: 原始参数值。
//
// Returns:
//
//   - 适用于当前 shell 的安全字符串。
function quoteShellArgument(value) {
  const text = String(value);

  if (process.platform === "win32") {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

// 描述：
//
//   - 将命令与参数拼成当前平台可直接执行的 shell 字符串，便于跨平台调用 `pnpm` 这类外部命令。
//
// Params:
//
//   - commandName: 命令名。
//   - args: 参数列表。
//
// Returns:
//
//   - 可直接传给 shell 的命令字符串。
function buildShellCommand(commandName, args) {
  return [commandName, ...args].map((item) => quoteShellArgument(item)).join(" ");
}

// 描述：
//
//   - 统一执行外部命令；在需要时捕获输出，并在可恢复场景下返回失败状态而不是直接抛错。
//
// Params:
//
//   - commandName: 命令名。
//   - args: 参数列表。
//   - options.cwd: 命令工作目录。
//   - options.captureOutput: 是否捕获 stdout/stderr。
//   - options.allowFailure: 是否允许失败时以返回值方式继续处理。
//   - options.env: 额外环境变量。
//
// Returns:
//
//   - status: 退出码。
//   - stdout: 标准输出。
//   - stderr: 标准错误。
function runCommand(commandName, args, options = {}) {
  const {
    cwd = ROOT_DIR,
    captureOutput = false,
    allowFailure = false,
    env = process.env,
  } = options;
  const shellCommand = buildShellCommand(commandName, args);

  try {
    const stdout = execSync(shellCommand, {
      cwd,
      env,
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      encoding: captureOutput ? "utf8" : undefined,
    });

    return {
      status: 0,
      stdout: captureOutput ? String(stdout || "") : "",
      stderr: "",
    };
  } catch (error) {
    if (!allowFailure) {
      throw error;
    }

    return {
      status: Number(error.status || 1),
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
    };
  }
}

// 描述：
//
//   - 读取 JSON 文件，供多个版本文件的统一读写逻辑复用。
//
// Params:
//
//   - filePath: JSON 文件路径。
//
// Returns:
//
//   - 解析后的 JSON 对象。
function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// 描述：
//
//   - 以统一格式写回 JSON 文件，避免版本同步后出现缩进或换行风格不一致。
//
// Params:
//
//   - filePath: JSON 文件路径。
//   - value: 待写入的对象。
function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// 描述：
//
//   - 从 package.json 读取版本号，用于比对仓库根与 Desktop 子包版本是否一致。
//
// Params:
//
//   - filePath: package.json 路径。
//
// Returns:
//
//   - version 字段内容。
function readPackageVersion(filePath) {
  return String(readJsonFile(filePath).version || "");
}

// 描述：
//
//   - 将目标版本写入 package.json，确保根包与 Desktop 子包版本同步更新。
//
// Params:
//
//   - filePath: package.json 路径。
//   - version: 目标版本号。
function writePackageVersion(filePath, version) {
  const content = readJsonFile(filePath);
  content.version = version;
  writeJsonFile(filePath, content);
}

// 描述：
//
//   - 从 tauri.conf.json 读取应用版本，用于校验 Tauri 配置与 JS/Rust 侧版本是否保持一致。
//
// Params:
//
//   - filePath: tauri.conf.json 路径。
//
// Returns:
//
//   - version 字段内容。
function readTauriVersion(filePath) {
  return String(readJsonFile(filePath).version || "");
}

// 描述：
//
//   - 将目标版本写入 tauri.conf.json，保证 Tauri 打包产物与仓库版本标识一致。
//
// Params:
//
//   - filePath: tauri.conf.json 路径。
//   - version: 目标版本号。
function writeTauriVersion(filePath, version) {
  const content = readJsonFile(filePath);
  content.version = version;
  writeJsonFile(filePath, content);
}

// 描述：
//
//   - 从 Cargo.toml 的 `[package]` 段读取应用版本，避免误读依赖声明中的版本值。
//
// Params:
//
//   - filePath: Cargo.toml 路径。
//
// Returns:
//
//   - `[package]` 段 version 字段。
function readCargoVersion(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  let inPackage = false;

  for (const line of lines) {
    if (/^\[package\]\s*$/.test(line)) {
      inPackage = true;
      continue;
    }

    if (inPackage && /^\[[^\]]+\]\s*$/.test(line)) {
      break;
    }

    if (inPackage) {
      const matched = line.match(/^\s*version\s*=\s*"([^"]+)"/);
      if (matched) {
        return matched[1];
      }
    }
  }

  return "";
}

// 描述：
//
//   - 将目标版本写回 Cargo.toml 的 `[package]` 段，并保留文件原本的换行风格。
//
// Params:
//
//   - filePath: Cargo.toml 路径。
//   - version: 目标版本号。
function writeCargoVersion(filePath, version) {
  const source = fs.readFileSync(filePath, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  let inPackage = false;
  let updated = false;

  const nextLines = lines.map((line) => {
    if (/^\[package\]\s*$/.test(line)) {
      inPackage = true;
      return line;
    }

    if (inPackage && /^\[[^\]]+\]\s*$/.test(line)) {
      inPackage = false;
      return line;
    }

    if (inPackage && /^\s*version\s*=\s*"[^"]+"/.test(line) && !updated) {
      updated = true;
      return line.replace(/^\s*version\s*=\s*"[^"]+"/, `version = "${version}"`);
    }

    return line;
  });

  if (!updated) {
    process.stderr.write(`failed to update Cargo package version: ${filePath}\n`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, `${nextLines.join(eol)}${eol}`, "utf8");
}

// 描述：
//
//   - 将仓库根、Desktop 子包、Tauri 配置与 Rust 包的版本统一同步到目标版本。
//
// Params:
//
//   - version: 目标版本号。
function syncDesktopVersions(version) {
  writePackageVersion(path.join(ROOT_DIR, "package.json"), version);
  writePackageVersion(path.join(DESKTOP_DIR, "package.json"), version);
  writeTauriVersion(path.join(TAURI_DIR, "tauri.conf.json"), version);
  writeCargoVersion(path.join(TAURI_DIR, "Cargo.toml"), version);
}

// 描述：
//
//   - 读取 Desktop 发布相关的四处版本号，并在不一致时直接终止，避免混合版本产物被发布出去。
//
// Returns:
//
//   - 对齐后的统一版本号。
function requireAlignedDesktopVersion() {
  const rootVersion = readPackageVersion(path.join(ROOT_DIR, "package.json"));
  const desktopVersion = readPackageVersion(path.join(DESKTOP_DIR, "package.json"));
  const tauriVersion = readTauriVersion(path.join(TAURI_DIR, "tauri.conf.json"));
  const cargoVersion = readCargoVersion(path.join(TAURI_DIR, "Cargo.toml"));

  if (!rootVersion || !desktopVersion || !tauriVersion || !cargoVersion) {
    process.stderr.write("failed to read version from project files\n");
    process.exit(1);
  }

  if (rootVersion !== desktopVersion || rootVersion !== tauriVersion || rootVersion !== cargoVersion) {
    process.stderr.write(`desktop version mismatch detected:
  root package.json:      ${rootVersion}
  apps/desktop/package:   ${desktopVersion}
  tauri.conf.json:        ${tauriVersion}
  src-tauri/Cargo.toml:   ${cargoVersion}
`);
    process.exit(1);
  }

  return rootVersion;
}

// 描述：
//
//   - 确认当前环境已经安装 pnpm，避免后续所有构建命令都落到不准确的 “tauri CLI 缺失” 提示上。
function ensurePnpmCommand() {
  const result = runCommand("pnpm", ["--version"], {
    captureOutput: true,
    allowFailure: true,
  });

  if (result.status !== 0) {
    process.stderr.write("missing required command: pnpm\n");
    process.exit(1);
  }
}

// 描述：
//
//   - 确认构建主机上可以通过 pnpm 调用 Tauri CLI，缺少依赖时给出明确的补救命令。
function ensureTauriCli() {
  const result = runCommand("pnpm", ["--dir", DESKTOP_DIR, "exec", "tauri", "--help"], {
    captureOutput: true,
    allowFailure: true,
  });

  if (result.status !== 0) {
    process.stderr.write(`tauri CLI was not found in apps/desktop.

Before packaging on the build host, run:
  cd ${ROOT_DIR}
  pnpm install
`);
    process.exit(1);
  }
}

// 描述：
//
//   - 生成或复用官方 updater 签名密钥，确保首次打包时也能得到可用于热更新的签名文件。
function ensureUpdaterSigningKey() {
  fs.mkdirSync(path.dirname(PRIVATE_KEY_PATH), { recursive: true });

  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    return;
  }

  process.stdout.write(`Generating Tauri updater signing key at ${PRIVATE_KEY_PATH}\n`);
  runCommand("pnpm", ["--dir", DESKTOP_DIR, "exec", "tauri", "signer", "generate", "--ci", "-w", PRIVATE_KEY_PATH]);

  if (!fs.existsSync(PRIVATE_KEY_PATH) || !fs.existsSync(PUBLIC_KEY_PATH)) {
    process.stderr.write("failed to generate updater signing key pair\n");
    process.exit(1);
  }
}

// 描述：
//
//   - 将 updater 公钥同步到 Tauri 源码与配置文件，保证打包产物和运行时内嵌公钥保持一致。
function syncUpdaterPublicKey() {
  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    process.stderr.write(`missing updater public key: ${PUBLIC_KEY_PATH}\n`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(PUBLIC_KEY_DEST), { recursive: true });
  fs.copyFileSync(PUBLIC_KEY_PATH, PUBLIC_KEY_DEST);

  const tauriConfigPath = path.join(TAURI_DIR, "tauri.conf.json");
  const tauriConfig = readJsonFile(tauriConfigPath);
  const pubkey = fs.readFileSync(PUBLIC_KEY_PATH, "utf8").trim();

  tauriConfig.plugins ||= {};
  tauriConfig.plugins.updater ||= {};
  tauriConfig.plugins.updater.pubkey = pubkey;

  if (!Array.isArray(tauriConfig.plugins.updater.endpoints) || tauriConfig.plugins.updater.endpoints.length === 0) {
    tauriConfig.plugins.updater.endpoints = ["https://open.zodileap.com/libra/updates/latest.json"];
  }

  writeJsonFile(tauriConfigPath, tauriConfig);
}

// 描述：
//
//   - 判断 bundle 目录中的条目是否属于需要发布的安装包或 updater 产物。
//
// Params:
//
//   - artifactPath: 产物路径。
//
// Returns:
//
//   - `true`: 需要发布。
//   - `false`: 可忽略。
function isReleaseArtifact(artifactPath) {
  const artifactName = path.basename(artifactPath);
  return /\.(dmg|pkg|app\.tar\.gz|sig|exe|msi|AppImage|appimage|deb|rpm|zip)$/i.test(artifactName);
}

// 描述：
//
//   - 根据 bundle 子目录推断产物所属平台，便于后续整理到统一的上传目录结构。
//
// Params:
//
//   - artifactPath: 产物路径。
//
// Returns:
//
//   - `macos`、`windows`、`linux` 或空字符串。
function platformDirForArtifact(artifactPath) {
  const normalizedPath = path.relative(BUNDLE_DIR, artifactPath).split(path.sep).join("/");

  if (/^(dmg|macos|app)\//.test(normalizedPath)) {
    return "macos";
  }

  if (/^(nsis|msi)\//.test(normalizedPath)) {
    return "windows";
  }

  if (/^(appimage|deb|rpm)\//.test(normalizedPath)) {
    return "linux";
  }

  return "";
}

// 描述：
//
//   - 只扫描 bundle 目录第二层的文件或目录，等价于旧 Bash 脚本中的 `find -mindepth 2 -maxdepth 2` 逻辑。
//
// Returns:
//
//   - 需要发布的产物绝对路径列表。
function collectReleaseArtifacts() {
  if (!fs.existsSync(BUNDLE_DIR)) {
    return [];
  }

  const artifacts = [];

  for (const platformEntry of fs.readdirSync(BUNDLE_DIR, { withFileTypes: true })) {
    if (!platformEntry.isDirectory()) {
      continue;
    }

    const platformRoot = path.join(BUNDLE_DIR, platformEntry.name);

    for (const artifactEntry of fs.readdirSync(platformRoot, { withFileTypes: true })) {
      const artifactPath = path.join(platformRoot, artifactEntry.name);

      if (isReleaseArtifact(artifactPath)) {
        artifacts.push(artifactPath);
      }
    }
  }

  return artifacts;
}

// 描述：
//
//   - 将构建产物按平台复制到 `releases/<version>/<platform>/`，方便后续整目录上传到更新服务器。
//
// Params:
//
//   - version: 当前发布版本。
//   - artifacts: 待整理的产物绝对路径列表。
function stageReleaseArtifacts(version, artifacts) {
  const releaseRoot = path.join(RELEASES_DIR, version);

  fs.rmSync(releaseRoot, { recursive: true, force: true });
  fs.mkdirSync(releaseRoot, { recursive: true });

  for (const artifactPath of artifacts) {
    const platformDir = platformDirForArtifact(artifactPath);

    if (!platformDir) {
      continue;
    }

    const destinationDir = path.join(releaseRoot, platformDir);
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.cpSync(artifactPath, path.join(destinationDir, path.basename(artifactPath)), { recursive: true });
  }
}

// 描述：
//
//   - 输出本次发布收集到的构建产物列表，便于构建完成后快速核对实际生成的文件。
//
// Params:
//
//   - artifacts: 产物绝对路径列表。
function printArtifactSummary(artifacts) {
  process.stdout.write("\nRelease artifacts:\n");

  for (const artifactPath of artifacts) {
    process.stdout.write(`  - ${path.relative(BUNDLE_DIR, artifactPath).split(path.sep).join("/")}\n`);
  }
}

// 描述：
//
//   - 输出已整理好的平台上传目录，避免人工发布时误传 bundle 原始目录。
//
// Params:
//
//   - version: 当前发布版本。
function printReleaseFolderSummary(version) {
  process.stdout.write("\nStaged upload folders:\n");

  for (const platformDir of ["macos", "windows", "linux"]) {
    const folderPath = path.join(RELEASES_DIR, version, platformDir);
    if (fs.existsSync(folderPath)) {
      process.stdout.write(`  - ${folderPath}\n`);
    }
  }
}

// 描述：
//
//   - 执行 Desktop 发布主流程：同步版本、校验依赖、生成签名、调用 Tauri 打包并整理发布目录。
function main() {
  const { targetVersion, syncOnly } = parseArgs(process.argv.slice(2));

  assertReleaseVersion(targetVersion);
  syncDesktopVersions(targetVersion);

  const alignedVersion = requireAlignedDesktopVersion();
  process.stdout.write(`Synced Desktop version to ${alignedVersion}\n`);

  if (syncOnly) {
    process.stdout.write("Version sync completed. Skipped packaging.\n");
    return;
  }

  ensurePnpmCommand();
  ensureTauriCli();
  ensureUpdaterSigningKey();
  syncUpdaterPublicKey();

  process.env.TAURI_SIGNING_PRIVATE_KEY = PRIVATE_KEY_PATH;
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "";

  process.stdout.write(`Packaging Libra Desktop ${alignedVersion}\n`);
  process.stdout.write(`Updater private key: ${PRIVATE_KEY_PATH}\n`);
  process.stdout.write(`Updater public key:  ${PUBLIC_KEY_PATH}\n`);
  process.stdout.write(`Embedded pubkey:     ${PUBLIC_KEY_DEST}\n`);

  fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
  runCommand("pnpm", ["--dir", DESKTOP_DIR, "exec", "tauri", "build"], {
    env: process.env,
  });

  const artifacts = collectReleaseArtifacts();
  if (artifacts.length === 0) {
    process.stderr.write(`no release artifacts found under ${BUNDLE_DIR}\n`);
    process.exit(1);
  }

  stageReleaseArtifacts(alignedVersion, artifacts);
  printArtifactSummary(artifacts);
  printReleaseFolderSummary(alignedVersion);

  process.stdout.write(`
Next:
  1. Copy the needed platform folder to your server downloads/${alignedVersion}/ directory.
  2. For first-time macOS downloads, use files under macos/ ending in .dmg.
  3. For updater, use files under macos/ ending in .app.tar.gz and .sig.
  4. Update latest.json on the server manually.
`);
}

main();
