import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_BLENDER_BRIDGE_ADDR = "127.0.0.1:23331";

interface BridgeHealthResponse {
  ok: boolean;
  message: string;
}

interface InstallBridgeResponse {
  message: string;
}

export function normalizeInvokeError(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === "object") {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
    try {
      return JSON.stringify(err);
    } catch (_jsonErr) {
      return "未知错误";
    }
  }
  return "未知错误";
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
