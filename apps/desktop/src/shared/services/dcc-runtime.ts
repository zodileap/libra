import { invoke } from "@tauri-apps/api/core";
import { COMMANDS } from "../constants";

// 描述：
//
//   - 默认 DCC Provider 地址；当前主要兼容本地 DCC Bridge 场景，未显式指定时统一复用该默认值。
export const DEFAULT_DCC_PROVIDER_ADDR = "127.0.0.1:23331";

// 描述：
//
//   - 统一的 invoke 错误详情结构，便于 MCP 页和会话页复用友好错误文案。
export interface NormalizedInvokeErrorDetail {
  code?: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
}

// 描述：
//
//   - DCC Runtime 状态结构；用于 MCP 页展示“当前软件的本地运行时是否已就绪”。
export interface DccRuntimeStatus {
  available: boolean;
  software: string;
  message: string;
  resolvedPath: string;
  runtimeKind: string;
  requiredEnvKeys: string[];
  supportsAutoPrepare: boolean;
}

interface DccRuntimeStatusResponse {
  available: boolean;
  software: string;
  message: string;
  resolved_path: string;
  runtime_kind: string;
  required_env_keys?: string[];
  supports_auto_prepare?: boolean;
}

// 描述：将 invoke 抛出的任意错误对象转换为统一结构，优先保留协议错误码与建议。
export function normalizeInvokeErrorDetail(err: unknown): NormalizedInvokeErrorDetail {
  if (typeof err === "string") {
    return {
      message: err,
      retryable: false,
    };
  }
  if (err instanceof Error) {
    return {
      message: err.message,
      retryable: false,
    };
  }
  if (err && typeof err === "object") {
    const maybe = err as {
      code?: unknown;
      message?: unknown;
      suggestion?: unknown;
      retryable?: unknown;
    };
    const message =
      typeof maybe.message === "string" && maybe.message.trim()
        ? maybe.message
        : (() => {
            try {
              return JSON.stringify(err);
            } catch (_jsonErr) {
              return "未知错误";
            }
          })();
    return {
      code: typeof maybe.code === "string" ? maybe.code : undefined,
      message,
      suggestion: typeof maybe.suggestion === "string" ? maybe.suggestion : undefined,
      retryable: Boolean(maybe.retryable),
    };
  }
  return {
    message: "未知错误",
    retryable: false,
  };
}

// 描述：兼容调用方，将 invoke 错误归一为可展示字符串。
export function normalizeInvokeError(err: unknown): string {
  return normalizeInvokeErrorDetail(err).message;
}

// 描述：
//
//   - 将 Tauri 返回的 DCC Runtime 状态转换为前端统一结构。
//
// Params:
//
//   - source: Tauri 返回的原始响应。
//
// Returns:
//
//   - 归一化后的 DCC Runtime 状态。
function normalizeDccRuntimeStatus(source: DccRuntimeStatusResponse): DccRuntimeStatus {
  return {
    available: Boolean(source.available),
    software: String(source.software || "").trim().toLowerCase(),
    message: String(source.message || "").trim(),
    resolvedPath: String(source.resolved_path || "").trim(),
    runtimeKind: String(source.runtime_kind || "").trim(),
    requiredEnvKeys: Array.isArray(source.required_env_keys)
      ? source.required_env_keys
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      : [],
    supportsAutoPrepare: source.supports_auto_prepare === true,
  };
}

// 描述：
//
//   - 查询指定 DCC 软件的运行时状态；当前主要用于 MCP 页的模板展示与注册校验。
//
// Params:
//
//   - software: DCC 软件标识。
//   - dccProviderAddr: 可选的本地 Provider 地址。
//
// Returns:
//
//   - 运行时状态。
export async function checkDccRuntimeStatus(
  software: string,
  dccProviderAddr = DEFAULT_DCC_PROVIDER_ADDR,
): Promise<DccRuntimeStatus> {
  const response = await invoke<DccRuntimeStatusResponse>(COMMANDS.CHECK_DCC_RUNTIME_STATUS, {
    software,
    dccProviderAddr,
  });
  return normalizeDccRuntimeStatus(response);
}

// 描述：
//
//   - 准备指定 DCC 软件的本地运行时；当前会根据软件类型执行对应的安装或初始化逻辑。
//
// Params:
//
//   - software: DCC 软件标识。
//   - dccProviderAddr: 可选的本地 Provider 地址。
//
// Returns:
//
//   - 准备后的运行时状态。
export async function prepareDccRuntime(
  software: string,
  dccProviderAddr = DEFAULT_DCC_PROVIDER_ADDR,
): Promise<DccRuntimeStatus> {
  const response = await invoke<DccRuntimeStatusResponse>(COMMANDS.PREPARE_DCC_RUNTIME, {
    software,
    dccProviderAddr,
  });
  return normalizeDccRuntimeStatus(response);
}
