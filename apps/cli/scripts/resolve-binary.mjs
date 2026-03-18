import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");

// 描述：
//
//   - 返回当前平台对应的原生 runtime 二进制文件名，兼容 Windows 可执行扩展名。
export function resolveRuntimeBinaryName(platform = process.platform) {
  return platform === "win32" ? "libra-runtime.exe" : "libra-runtime";
}

// 描述：
//
//   - 解析 npm CLI 应使用的原生 runtime 二进制路径；优先显式环境变量，其次回退到仓库或 PATH 中的二进制。
export function resolveRuntimeBinary(env = process.env) {
  const explicit = String(env.LIBRA_RUNTIME_BIN || "").trim();
  if (explicit) {
    return explicit;
  }

  const binaryName = resolveRuntimeBinaryName();
  const packagedPath = path.join(PACKAGE_DIR, "vendor", `${process.platform}-${process.arch}`, binaryName);
  if (fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  const workspaceDebugBinary = path.resolve(
    PACKAGE_DIR,
    "..",
    "..",
    "crates",
    "target",
    "debug",
    binaryName,
  );
  if (fs.existsSync(workspaceDebugBinary)) {
    return workspaceDebugBinary;
  }

  const cargoBin = path.join(os.homedir(), ".cargo", "bin", binaryName);
  if (fs.existsSync(cargoBin)) {
    return cargoBin;
  }

  return binaryName;
}
