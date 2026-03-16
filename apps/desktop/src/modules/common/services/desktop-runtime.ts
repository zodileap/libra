import { invoke } from "@tauri-apps/api/core";
import { COMMANDS, IS_BROWSER } from "../../../shared/constants";
import type { DesktopRuntimeInfo } from "../../../shared/types";

// 描述：
//
//   - 定义 Tauri 桌面运行时命令响应结构，保持与 Rust 侧 snake_case 字段兼容。
interface DesktopRuntimeInfoResponse {
  current_version?: string;
  platform?: string;
  arch?: string;
}

// 描述：
//
//   - 基于浏览器 UA 构造桌面运行时兜底信息，确保在纯前端预览或 Tauri 命令失败时仍能推断系统类型。
//
// Returns:
//
//   - 浏览器侧推断出的桌面运行时信息。
export function detectBrowserDesktopRuntimeInfo(): DesktopRuntimeInfo {
  if (!IS_BROWSER) {
    return {
      currentVersion: "",
      platform: "",
      arch: "",
    };
  }

  const userAgent = String(navigator.userAgent || "");
  let platform = "";
  if (navigator.userAgent.includes("Windows")) {
    platform = "windows";
  } else if (navigator.userAgent.includes("Mac")) {
    platform = "macos";
  } else if (navigator.userAgent.includes("Linux")) {
    platform = "linux";
  }

  let arch = "";
  if (/arm64|aarch64/i.test(userAgent)) {
    arch = "arm64";
  } else if (/x86_64|win64|x64|amd64/i.test(userAgent)) {
    arch = "x64";
  }

  return {
    currentVersion: "",
    platform,
    arch,
  };
}

// 描述：
//
//   - 将任意来源的桌面运行时数据规范化为前端统一结构，缺失字段时回退到浏览器推断结果。
//
// Params:
//
//   - payload: 原始运行时数据。
//
// Returns:
//
//   - 规范化后的桌面运行时信息。
function normalizeDesktopRuntimeInfo(payload: unknown): DesktopRuntimeInfo {
  const fallback = detectBrowserDesktopRuntimeInfo();
  const value = (payload || {}) as DesktopRuntimeInfoResponse;
  return {
    currentVersion: String(value.current_version || "").trim() || fallback.currentVersion,
    platform: String(value.platform || "").trim().toLowerCase() || fallback.platform,
    arch: String(value.arch || "").trim().toLowerCase() || fallback.arch,
  };
}

// 描述：
//
//   - 读取当前桌面运行时信息，优先使用 Tauri 后端真实值，失败时自动回退到浏览器环境推断。
//
// Returns:
//
//   - 当前桌面运行时信息。
export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo> {
  try {
    const payload = await invoke<DesktopRuntimeInfoResponse>(COMMANDS.GET_DESKTOP_RUNTIME_INFO, {});
    return normalizeDesktopRuntimeInfo(payload);
  } catch (_err) {
    return detectBrowserDesktopRuntimeInfo();
  }
}
