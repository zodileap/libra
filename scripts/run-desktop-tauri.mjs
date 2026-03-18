#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DESKTOP_DIR = path.join(ROOT_DIR, "apps", "desktop");
const TAURI_DIR = path.join(DESKTOP_DIR, "src-tauri");
const TAURI_TARGET_DIR = path.join(TAURI_DIR, "target");
const DEFAULT_UPDATER_PRIVATE_KEY_PATH = path.join(os.homedir(), ".tauri", "libra-desktop-updater.key");
const DEFAULT_UPDATER_PUBLIC_KEY_PATH = `${DEFAULT_UPDATER_PRIVATE_KEY_PATH}.pub`;
const PNPM_COMMAND = resolvePnpmCommand();

// 描述：
//
//   - 返回当前平台对应的 Tauri 本地覆盖配置后缀，供 `tauri.<platform>.local.conf.json` 自动发现复用。
//
// Returns:
//
//   - `macos`、`windows` 或 `linux`。
function resolvePlatformName() {
  if (process.platform === "darwin") {
    return "macos";
  }

  if (process.platform === "win32") {
    return "windows";
  }

  return "linux";
}

// 描述：
//
//   - 解析可选的本地 Tauri 覆盖配置文件，仅用于本机私有打包参数，不进入 git。
//
// Returns:
//
//   - 已存在的本地配置绝对路径列表。
function resolveLocalTauriConfigPaths() {
  const platformName = resolvePlatformName();
  const candidates = [
    path.join(TAURI_DIR, "tauri.local.conf.json"),
    path.join(TAURI_DIR, `tauri.${platformName}.local.conf.json`),
  ];

  return candidates.filter((filePath) => fs.existsSync(filePath));
}

// 描述：
//
//   - 读取环境变量文本值，统一裁剪空白，避免路径与密码因为前后空格导致构建失败。
//
// Params:
//
//   - name: 环境变量名。
//   - env: 环境变量对象。
//
// Returns:
//
//   - 裁剪后的环境变量值；为空时返回空字符串。
function readEnvValue(name, env = process.env) {
  return String(env[name] || "").trim();
}

// 描述：
//
//   - 统一读取 JSON 文件，供本地 Tauri 覆盖配置与临时注入配置的解析复用。
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
//   - 标准化 updater 公钥文本，过滤空白，避免把未配置状态误当成真实公钥继续打包。
//
// Params:
//
//   - value: 原始公钥文本。
//
// Returns:
//
//   - 标准化后的公钥文本；无效时返回空字符串。
function normalizeUpdaterPublicKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized;
}

// 描述：
//
//   - 解析本地 updater 公钥文件路径，优先读取显式环境变量，其次回落到默认 `~/.tauri` 目录。
//
// Params:
//
//   - env: 环境变量对象。
//
// Returns:
//
//   - 公钥文件绝对路径；不存在时返回空字符串。
function resolveUpdaterPublicKeyPath(env = process.env) {
  const explicitPath = readEnvValue("TAURI_UPDATER_PUBLIC_KEY_PATH", env);
  if (explicitPath) {
    return explicitPath;
  }

  return fs.existsSync(DEFAULT_UPDATER_PUBLIC_KEY_PATH) ? DEFAULT_UPDATER_PUBLIC_KEY_PATH : "";
}

// 描述：
//
//   - 解析本地 updater 公钥来源，优先使用显式环境变量，其次回退到本机构建机上的 `.pub` 文件。
//
// Params:
//
//   - env: 环境变量对象。
//
// Returns:
//
//   - pubkey: 解析出的公钥文本。
//   - source: 当前命中的本地公钥来源说明。
function resolveLocalUpdaterPublicKey(env = process.env) {
  const inlinePublicKey = normalizeUpdaterPublicKey(
    readEnvValue("TAURI_UPDATER_PUBLIC_KEY", env) || readEnvValue("LIBRA_UPDATER_PUBKEY", env),
  );
  if (inlinePublicKey) {
    return { pubkey: inlinePublicKey, source: "environment" };
  }

  const publicKeyPath = resolveUpdaterPublicKeyPath(env);
  if (!publicKeyPath || !fs.existsSync(publicKeyPath)) {
    return { pubkey: "", source: "" };
  }

  return {
    pubkey: normalizeUpdaterPublicKey(fs.readFileSync(publicKeyPath, "utf8")),
    source: publicKeyPath,
  };
}

// 描述：
//
//   - 生成仅存在于本次构建过程中的临时 Tauri 覆盖配置，用本地 updater 公钥覆盖仓库默认空值。
//
// Params:
//
//   - pubkey: 本地 updater 公钥文本。
//
// Returns:
//
//   - configPath: 临时配置文件路径。
//   - tempDir: 临时目录路径。
function createEphemeralUpdaterConfig(pubkey) {
  if (!pubkey) {
    return { configPath: "", tempDir: "" };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "libra-tauri-updater-config-"));
  const configPath = path.join(tempDir, "tauri.updater.local.conf.json");
  writeJsonFile(configPath, {
    plugins: {
      updater: {
        pubkey,
      },
    },
  });

  return { configPath, tempDir };
}

// 描述：
//
//   - 以统一格式写回 JSON 文件，避免临时注入配置在不同平台上出现缩进或换行差异。
//
// Params:
//
//   - filePath: JSON 文件路径。
//   - value: 待写入对象。
function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// 描述：
//
//   - 将本地 updater 私钥与公钥映射为 Tauri bundler / Rust 编译期可识别的环境变量，避免开源仓库里写死本机签名材料。
//
// Params:
//
//   - baseEnv: 原始环境变量对象。
//   - updaterPubkey: 本地 updater 公钥文本。
//
// Returns:
//
//   - 追加了本地私钥映射后的环境变量对象。
function buildCommandEnv(baseEnv = process.env, updaterPubkey = "") {
  const env = { ...baseEnv };
  const updaterKeyPath = readEnvValue("TAURI_UPDATER_PRIVATE_KEY_PATH", env)
    || (fs.existsSync(DEFAULT_UPDATER_PRIVATE_KEY_PATH) ? DEFAULT_UPDATER_PRIVATE_KEY_PATH : "");
  const updaterKeyPassword = readEnvValue("TAURI_UPDATER_PRIVATE_KEY_PASSWORD", env);

  if (!readEnvValue("TAURI_SIGNING_PRIVATE_KEY", env) && updaterKeyPath) {
    env.TAURI_SIGNING_PRIVATE_KEY = updaterKeyPath;
  }

  if (!readEnvValue("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", env) && updaterKeyPassword) {
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = updaterKeyPassword;
  }

  if (!readEnvValue("LIBRA_UPDATER_PUBKEY", env) && updaterPubkey) {
    env.LIBRA_UPDATER_PUBKEY = updaterPubkey;
  }

  return env;
}

// 描述：
//
//   - 兼容 npm/pnpm 启动场景解析 pnpm 执行入口，确保 Desktop 包脚本在不同 shell 中都能稳定调用 Tauri CLI。
//
// Returns:
//
//   - commandName: 命令名。
//   - commandArgs: 预置参数。
function resolvePnpmCommand() {
  const npmExecPath = String(process.env.npm_execpath || "");
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return { commandName: process.execPath, commandArgs: [npmExecPath] };
  }

  if (process.platform === "win32") {
    return { commandName: "pnpm.cmd", commandArgs: [] };
  }

  return { commandName: "pnpm", commandArgs: [] };
}

// 描述：
//
//   - 统一标准化路径分隔符，避免 Windows 与 POSIX 路径格式差异导致缓存路径比较失真。
//
// Params:
//
//   - value: 待比较的原始路径文本。
//
// Returns:
//
//   - 使用 `/` 作为分隔符的标准化路径文本。
function normalizePathSeparators(value) {
  return String(value || "").replaceAll("\\", "/");
}

// 描述：
//
//   - 递归收集指定目录下给定文件名的文件路径，供检查 Cargo/Tauri 构建缓存中的绝对路径引用复用。
//
// Params:
//
//   - rootDir: 起始目录。
//   - acceptedFileNames: 允许匹配的文件名集合。
//
// Returns:
//
//   - 命中的文件绝对路径列表。
function collectFilesByName(rootDir, acceptedFileNames) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const matches = [];
  const pendingDirs = [rootDir];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) {
      continue;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        pendingDirs.push(absolutePath);
        continue;
      }

      if (acceptedFileNames.has(entry.name)) {
        matches.push(absolutePath);
      }
    }
  }

  return matches;
}

// 描述：
//
//   - 检测 `src-tauri/target` 下是否残留来自其他 worktree 或旧仓库路径的 Tauri 权限缓存。
//   - 这类缓存会把插件权限文件定位到已不存在的绝对路径，导致 `tauri dev/build` 在 build script 阶段直接失败。
//
// Params:
//
//   - targetDir: 待检查的 Tauri target 目录。
//     default: 当前仓库的 `apps/desktop/src-tauri/target`
//
// Returns:
//
//   - sourceFilePath: 命中旧路径引用的缓存文件路径。
//   - referencePath: 缓存中引用的旧 target 绝对路径。
//   - 未命中时返回 `null`。
function resolveStaleTauriTargetReference(targetDir = TAURI_TARGET_DIR) {
  const debugBuildDir = path.join(targetDir, "debug", "build");
  const candidateFiles = collectFilesByName(debugBuildDir, new Set(["output", "root-output"]));
  const normalizedTargetDir = `${normalizePathSeparators(targetDir)}/`;
  const targetPathPattern = /(?:[A-Za-z]:)?\/[^\s"'`]+\/apps\/desktop\/src-tauri\/target\/[^\s"'`]*/g;

  for (const filePath of candidateFiles) {
    const source = normalizePathSeparators(fs.readFileSync(filePath, "utf8"));
    const referencedPaths = source.match(targetPathPattern) || [];

    for (const referencePath of referencedPaths) {
      if (!referencePath.startsWith(normalizedTargetDir)) {
        return {
          sourceFilePath: filePath,
          referencePath,
        };
      }
    }
  }

  return null;
}

// 描述：
//
//   - 在真正调用 Tauri CLI 前自动清理指向旧仓库绝对路径的 target 缓存，避免用户手动 `cargo clean`。
//
// Params:
//
//   - targetDir: 待修复的 Tauri target 目录。
//     default: 当前仓库的 `apps/desktop/src-tauri/target`
//
// Returns:
//
//   - 命中旧缓存时返回对应的来源文件与旧路径信息，并完成清理。
//   - 未命中时返回 `null`。
function repairStaleTauriTargetCache(targetDir = TAURI_TARGET_DIR) {
  const staleReference = resolveStaleTauriTargetReference(targetDir);
  if (!staleReference) {
    return null;
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  return staleReference;
}

// 描述：
//
//   - 将本地覆盖配置通过 `--config` 注入到 Tauri CLI，保证开源默认配置与本地私有配置分离。
//
// Params:
//
//   - argv: 透传给 wrapper 的命令行参数。
//   - configPaths: 需要注入给 Tauri CLI 的配置文件列表。
//
// Returns:
//
//   - commandArgs: 实际传给 pnpm/tauri 的参数列表。
function buildTauriCommand(argv, configPaths = []) {
  const [subcommand, ...restArgs] = argv;
  if (!subcommand) {
    process.stderr.write("missing tauri subcommand\n");
    process.exit(1);
  }

  const commandArgs = ["--dir", DESKTOP_DIR, "exec", "tauri", subcommand];

  for (const configPath of configPaths) {
    commandArgs.push("--config", configPath);
  }

  commandArgs.push(...restArgs);

  return { commandArgs };
}

// 描述：
//
//   - 运行 Desktop Tauri CLI，并在需要时打印当前命中的本地覆盖配置，便于核对本机打包实际使用的配置来源。
function main() {
  const staleTargetCache = repairStaleTauriTargetCache();
  const localConfigPaths = resolveLocalTauriConfigPaths();
  const { pubkey: updaterPubkey, source: updaterPubkeySource } = resolveLocalUpdaterPublicKey(process.env);
  const ephemeralUpdaterConfig = createEphemeralUpdaterConfig(updaterPubkey);
  const configPaths = [
    ...localConfigPaths,
    ...(ephemeralUpdaterConfig.configPath ? [ephemeralUpdaterConfig.configPath] : []),
  ];
  const { commandArgs } = buildTauriCommand(process.argv.slice(2), configPaths);
  const env = buildCommandEnv(process.env, updaterPubkey);

  if (localConfigPaths.length > 0) {
    process.stdout.write(`Using local Tauri config overrides:\n${localConfigPaths.map((item) => `  - ${item}`).join("\n")}\n`);
  }

  if (updaterPubkeySource) {
    process.stdout.write(`Using local updater public key source:\n  - ${updaterPubkeySource}\n`);
  }

  if (staleTargetCache) {
    process.stdout.write(
      `Detected stale Tauri target cache from another workspace and cleared it:\n`
      + `  - cached reference: ${staleTargetCache.referencePath}\n`
      + `  - source file: ${staleTargetCache.sourceFilePath}\n`
      + `  - removed target dir: ${TAURI_TARGET_DIR}\n`,
    );
  }

  try {
    const result = spawnSync(PNPM_COMMAND.commandName, [...PNPM_COMMAND.commandArgs, ...commandArgs], {
      cwd: ROOT_DIR,
      env,
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }

    process.exit(result.status ?? 0);
  } finally {
    if (ephemeralUpdaterConfig.tempDir) {
      fs.rmSync(ephemeralUpdaterConfig.tempDir, { recursive: true, force: true });
    }
  }
}

main();
