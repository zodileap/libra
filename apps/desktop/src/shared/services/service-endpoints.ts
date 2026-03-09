import { IS_BROWSER, STORAGE_KEYS } from "../constants";
import type { DesktopBackendConfig } from "../types";

// 描述：
//
//   - 默认后端初始化入口；当尚未配置后端地址时，仍保留本地约定地址用于提示。
const defaultSetupUrl = "http://127.0.0.1:10001/setup";

// 描述：
//
//   - 默认桌面端静态更新清单地址；开源版默认指向公开更新源，用户也可以改成自己的私有地址。
const defaultDesktopUpdateManifestUrl = "https://open.zodileap.com/libra/updates/latest.json";

// 描述：校验并规范化后端入口地址；支持用户只输入 `ip:port` 时自动补全 `http://`。
//
// Params:
//
//   - rawValue: 原始地址输入。
//   - fallback: 回退地址。
//
// Returns:
//
//   - 规范化后的后端入口地址。
export function normalizeDesktopBackendBaseUrl(rawValue: unknown, fallback = ""): string {
  const text = String(rawValue || "").trim();
  if (!text) {
    return fallback;
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(text) ? text : `http://${text}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallback;
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_err) {
    return fallback;
  }
}

// 描述：校验并规范化静态更新清单地址；必须是完整的 HTTP(S) URL，保留路径和查询参数。
//
// Params:
//
//   - rawValue: 原始地址输入。
//   - fallback: 回退地址。
//
// Returns:
//
//   - 规范化后的静态更新清单地址。
export function normalizeDesktopUpdateManifestUrl(rawValue: unknown, fallback = ""): string {
  const text = String(rawValue || "").trim();
  if (!text) {
    return fallback;
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(text) ? text : `https://${text}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallback;
    }
    url.hash = "";
    return url.toString();
  } catch (_err) {
    return fallback;
  }
}

// 描述：返回桌面端默认后端接入配置；默认不启用后端，让 Desktop 可以独立作为本地 App 使用。
//
// Returns:
//
//   - 默认后端接入配置。
export function getDefaultDesktopBackendConfig(): DesktopBackendConfig {
  const envBaseUrl = normalizeDesktopBackendBaseUrl(import.meta.env.VITE_BACKEND_BASE_URL, "");
  const envUpdateManifestUrl = normalizeDesktopUpdateManifestUrl(
    import.meta.env.VITE_DESKTOP_UPDATE_MANIFEST_URL,
    defaultDesktopUpdateManifestUrl,
  );
  return {
    enabled: Boolean(envBaseUrl),
    baseUrl: envBaseUrl,
    updateManifestUrl: envUpdateManifestUrl,
  };
}

// 描述：从本地缓存读取桌面端后端接入配置；若无缓存则回退到默认值。
//
// Returns:
//
//   - 当前后端接入配置。
export function readDesktopBackendConfig(): DesktopBackendConfig {
  const defaults = getDefaultDesktopBackendConfig();
  if (!IS_BROWSER) {
    return defaults;
  }
  const rawValue = window.localStorage.getItem(STORAGE_KEYS.DESKTOP_BACKEND_CONFIG);
  if (!rawValue) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(rawValue) as Partial<DesktopBackendConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      baseUrl: normalizeDesktopBackendBaseUrl(parsed.baseUrl, defaults.baseUrl),
      updateManifestUrl: normalizeDesktopUpdateManifestUrl(parsed.updateManifestUrl, defaults.updateManifestUrl),
    };
  } catch (_err) {
    return defaults;
  }
}

// 描述：写入桌面端后端接入配置，并返回规范化后的结果。
//
// Params:
//
//   - nextConfig: 需要保存的后端配置。
//
// Returns:
//
//   - 已保存的后端配置。
export function saveDesktopBackendConfig(nextConfig: DesktopBackendConfig): DesktopBackendConfig {
  const normalized: DesktopBackendConfig = {
    enabled: Boolean(nextConfig.enabled),
    baseUrl: normalizeDesktopBackendBaseUrl(nextConfig.baseUrl, ""),
    updateManifestUrl: normalizeDesktopUpdateManifestUrl(nextConfig.updateManifestUrl, ""),
  };
  if (IS_BROWSER) {
    window.localStorage.setItem(STORAGE_KEYS.DESKTOP_BACKEND_CONFIG, JSON.stringify(normalized));
  }
  return normalized;
}

// 描述：将桌面端后端接入配置恢复为默认值。
//
// Returns:
//
//   - 默认后端配置。
export function resetDesktopBackendConfig(): DesktopBackendConfig {
  const defaults = getDefaultDesktopBackendConfig();
  if (IS_BROWSER) {
    window.localStorage.setItem(STORAGE_KEYS.DESKTOP_BACKEND_CONFIG, JSON.stringify(defaults));
  }
  return defaults;
}

// 描述：判断当前是否已启用远端后端接入；仅当启用且地址有效时才视为远端模式。
//
// Params:
//
//   - config: 后端配置。
//
// Returns:
//
//   - true: 当前走后端模式。
export function hasEnabledDesktopBackend(
  config: DesktopBackendConfig = readDesktopBackendConfig(),
): boolean {
  return Boolean(config.enabled && normalizeDesktopBackendBaseUrl(config.baseUrl, ""));
}

// 描述：构建桌面端请求统一后端入口地址；未来后端可在该地址上统一承载 account/runtime/setup 能力。
//
// Params:
//
//   - config: 后端配置。
//
// Returns:
//
//   - 后端入口地址；未配置时返回空字符串。
export function buildDesktopBackendBaseUrl(
  config: DesktopBackendConfig = readDesktopBackendConfig(),
): string {
  if (!hasEnabledDesktopBackend(config)) {
    return "";
  }
  return normalizeDesktopBackendBaseUrl(config.baseUrl, "");
}

// 描述：返回当前桌面端使用的静态更新清单地址；为空时表示应回退到后端 Runtime 更新接口或跳过更新检查。
//
// Params:
//
//   - config: 桌面端配置。
//
// Returns:
//
//   - 静态更新清单地址。
export function buildDesktopUpdateManifestUrl(
  config: DesktopBackendConfig = readDesktopBackendConfig(),
): string {
  return normalizeDesktopUpdateManifestUrl(config.updateManifestUrl, "");
}

// 描述：构建桌面端打开的初始化页地址；后端未接入时保留本地默认地址用于提示。
//
// Params:
//
//   - config: 后端配置。
//
// Returns:
//
//   - 指向 `/setup` 的初始化页地址。
export function buildDesktopWebSetupUrl(
  config: DesktopBackendConfig = readDesktopBackendConfig(),
): string {
  const baseUrl = buildDesktopBackendBaseUrl(config);
  if (!baseUrl) {
    return defaultSetupUrl;
  }
  return new URL("/setup", `${baseUrl}/`).toString().replace(/\/$/, "");
}
