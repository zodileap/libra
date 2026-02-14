import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_BLENDER_BRIDGE_ADDR = "127.0.0.1:23331";

export interface NormalizedInvokeErrorDetail {
  code?: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
}

interface BridgeHealthResponse {
  ok: boolean;
  message: string;
}

interface InstallBridgeResponse {
  message: string;
}

/// 描述：将 invoke 抛出的任意错误对象转换为统一结构，优先保留协议错误码与建议。
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

/// 描述：兼容旧调用方，将 invoke 错误归一为可展示字符串。
export function normalizeInvokeError(err: unknown): string {
  return normalizeInvokeErrorDetail(err).message;
}

export async function checkBlenderBridge(
  blenderBridgeAddr = DEFAULT_BLENDER_BRIDGE_ADDR
): Promise<BridgeHealthResponse> {
  return invoke<BridgeHealthResponse>("check_blender_bridge", {
    blender_bridge_addr: blenderBridgeAddr,
  });
}

export async function installBlenderBridge(): Promise<string> {
  const response = await invoke<InstallBridgeResponse>("install_blender_bridge", {});
  return response.message || "Bridge 安装完成。";
}

export async function ensureBlenderBridge(
  blenderBridgeAddr = DEFAULT_BLENDER_BRIDGE_ADDR
): Promise<{ ok: boolean; message: string }> {
  let firstReason = "";

  try {
    const health = await checkBlenderBridge(blenderBridgeAddr);
    if (health.ok) {
      return { ok: true, message: health.message };
    }
    firstReason = health.message;
  } catch (err) {
    firstReason = normalizeInvokeError(err);
  }

  try {
    await installBlenderBridge();
  } catch (err) {
    const installReason = normalizeInvokeError(err);
    return {
      ok: false,
      message: `自动安装 Bridge 失败：${installReason}`,
    };
  }

  try {
    const health = await checkBlenderBridge(blenderBridgeAddr);
    if (health.ok) {
      return { ok: true, message: health.message };
    }
    return {
      ok: false,
      message: `Bridge 仍不可用：${health.message}`,
    };
  } catch (err) {
    const secondReason = normalizeInvokeError(err);
    return {
      ok: false,
      message: `Bridge 仍不可用：${secondReason}${firstReason ? `（初次检测：${firstReason}）` : ""}`,
    };
  }
}
