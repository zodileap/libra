import type { AiProvider } from "./types";

// 描述：
//
//   - 定义 AI Provider 下拉选项结构，供模型与模式选择框复用。
export interface AiProviderSelectOption {
  value: string;
  label: string;
}

// 描述：
//
//   - 维护 AI Provider 展示名称映射，确保 AI Key 页面与会话设置共享同一套文案。
const AI_PROVIDER_LABEL_MAP: Record<AiProvider, string> = {
  codex: "Codex CLI",
  gemini: "Google Gemini",
  "gemini-cli": "Gemini CLI",
  iflow: "iFlow API",
};

// 描述：
//
//   - 维护各 Provider 的官方模型选项列表，避免在设置页继续使用自由输入。
const AI_PROVIDER_MODEL_OPTIONS: Record<AiProvider, AiProviderSelectOption[]> = {
  codex: [
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
    { value: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark" },
    { value: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
    { value: "gpt-5.2", label: "GPT-5.2" },
    { value: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max" },
    { value: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini" },
  ],
  gemini: [
    { value: "gemini-3.1-pro-preview", label: "gemini-3.1-pro-preview" },
    { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
    { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite" },
  ],
  "gemini-cli": [
    { value: "gemini-3.1-pro-preview", label: "gemini-3.1-pro-preview" },
    { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
    { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite" },
  ],
  iflow: [
    { value: "qwen3-coder-plus", label: "qwen3-coder-plus" },
    { value: "qwen3-max", label: "qwen3-max" },
    { value: "qwen3-vl-plus", label: "qwen3-vl-plus" },
    { value: "qwen3-max-preview", label: "qwen3-max-preview" },
    { value: "kimi-k2", label: "kimi-k2" },
    { value: "deepseek-v3.2", label: "deepseek-v3.2" },
  ],
};

// 描述：
//
//   - 维护各 Provider 的官方模式选项；当前仅 Codex 暴露稳定的 reasoning effort 枚举。
//   - Fast 走独立开关，不混进 reasoning effort 下拉。
const AI_PROVIDER_MODE_OPTIONS: Record<AiProvider, AiProviderSelectOption[]> = {
  codex: [
    { value: "low", label: "low" },
    { value: "medium", label: "medium" },
    { value: "high", label: "high" },
    { value: "xhigh", label: "xhigh" },
  ],
  gemini: [],
  "gemini-cli": [],
  iflow: [],
};

// 描述：
//
//   - 维护 Provider 默认模型，尽量保持既有行为稳定；未预置时交给 Provider 默认值处理。
const AI_PROVIDER_DEFAULT_MODEL_MAP: Record<AiProvider, string> = {
  codex: "",
  gemini: "",
  "gemini-cli": "",
  iflow: "qwen3-coder-plus",
};

// 描述：
//
//   - 维护 Provider 默认模式；未预置时交给 Provider 默认值处理。
const AI_PROVIDER_DEFAULT_MODE_MAP: Record<AiProvider, string> = {
  codex: "",
  gemini: "",
  "gemini-cli": "",
  iflow: "",
};

const CODEX_FAST_MODE_PREFIX = "fast";

// 描述：
//
//   - 判断输入字符串是否为已支持的 AI Provider，便于处理持久化与路由层的宽松字符串。
//
// Params:
//
//   - value: 待判断的 Provider 字符串。
//
// Returns:
//
//   - true: 命中受支持 Provider。
export function isAiProvider(value: string): value is AiProvider {
  return value === "codex" || value === "gemini" || value === "gemini-cli" || value === "iflow";
}

// 描述：
//
//   - 返回 Provider 的展示名称。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - 展示名称。
export function resolveAiProviderLabel(provider: AiProvider): string {
  return AI_PROVIDER_LABEL_MAP[provider];
}

// 描述：
//
//   - 判断 Provider 是否属于本地 CLI 类型。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - true: 当前 Provider 使用本地 CLI。
export function isLocalCliAiProvider(provider: AiProvider): boolean {
  return provider === "codex" || provider === "gemini-cli";
}

// 描述：
//
//   - 读取 Provider 对应的官方模型选项。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - 模型选项数组。
export function resolveAiProviderModelOptions(provider: AiProvider): AiProviderSelectOption[] {
  return AI_PROVIDER_MODEL_OPTIONS[provider];
}

// 描述：
//
//   - 读取 Provider 对应的官方模式选项。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - 模式选项数组。
export function resolveAiProviderModeOptions(provider: AiProvider): AiProviderSelectOption[] {
  return AI_PROVIDER_MODE_OPTIONS[provider];
}

// 描述：
//
//   - 判断 Provider 是否支持独立 Fast 模式开关；当前仅 Codex 暴露 service tier 级别的 Fast 通道。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - true: 应展示 Fast 开关。
export function supportsAiProviderFastModeToggle(provider: AiProvider): boolean {
  return provider === "codex";
}

// 描述：
//
//   - 将持久化的 Provider 模式值转换成下拉框显示值。
//   - Codex 会把 `fast` / `fast:high` 这类组合模式还原为 reasoning effort 部分。
//
// Params:
//
//   - provider: Provider 标识。
//   - currentValue: 当前已保存的模式值。
//
// Returns:
//
//   - 可直接绑定到下拉框的显示值。
export function resolveAiProviderModeSelectValue(
  provider: AiProvider,
  currentValue: string,
): string {
  const normalizedCurrentValue = String(currentValue || "").trim();
  if (!normalizedCurrentValue) {
    return "";
  }
  if (provider !== "codex") {
    return normalizedCurrentValue;
  }
  if (normalizedCurrentValue === CODEX_FAST_MODE_PREFIX) {
    return "";
  }
  if (normalizedCurrentValue.startsWith(`${CODEX_FAST_MODE_PREFIX}:`)) {
    return normalizedCurrentValue.slice(CODEX_FAST_MODE_PREFIX.length + 1).trim();
  }
  return normalizedCurrentValue;
}

// 描述：
//
//   - 判断当前 Provider 的模式值是否启用了 Fast 通道。
//
// Params:
//
//   - provider: Provider 标识。
//   - currentValue: 当前已保存的模式值。
//
// Returns:
//
//   - true: 当前模式已启用 Fast。
export function resolveAiProviderFastModeEnabled(
  provider: AiProvider,
  currentValue: string,
): boolean {
  if (provider !== "codex") {
    return false;
  }
  const normalizedCurrentValue = String(currentValue || "").trim();
  return normalizedCurrentValue === CODEX_FAST_MODE_PREFIX
    || normalizedCurrentValue.startsWith(`${CODEX_FAST_MODE_PREFIX}:`);
}

// 描述：
//
//   - 根据下拉框中的 reasoning effort 与 Fast 开关，重建持久化用的模式值。
//   - Codex 会编码成 `fast` 或 `fast:high` 这样的组合值，其它 Provider 仍然直接返回模式值。
//
// Params:
//
//   - provider: Provider 标识。
//   - modeValue: 下拉框当前选择的模式值。
//   - fastModeEnabled: 是否启用 Fast。
//
// Returns:
//
//   - 应写入存储与调用链路的模式值。
export function composeAiProviderModeValue(
  provider: AiProvider,
  modeValue: string,
  fastModeEnabled: boolean,
): string {
  const normalizedModeValue = String(modeValue || "").trim();
  if (provider !== "codex") {
    return normalizedModeValue;
  }
  if (!fastModeEnabled) {
    return normalizedModeValue;
  }
  return normalizedModeValue
    ? `${CODEX_FAST_MODE_PREFIX}:${normalizedModeValue}`
    : CODEX_FAST_MODE_PREFIX;
}

// 描述：
//
//   - 返回 Provider 的默认模型名称；为空时表示沿用 Provider 自身默认配置。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - 默认模型名称。
export function resolveAiProviderDefaultModel(provider: AiProvider): string {
  return AI_PROVIDER_DEFAULT_MODEL_MAP[provider];
}

// 描述：
//
//   - 返回 Provider 的默认模式名称；为空时表示沿用 Provider 自身默认配置。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - 默认模式名称。
export function resolveAiProviderDefaultMode(provider: AiProvider): string {
  return AI_PROVIDER_DEFAULT_MODE_MAP[provider];
}

// 描述：
//
//   - 判断 Provider 是否具备模型下拉选项。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - true: 应展示模型下拉框。
export function supportsAiProviderModelSelection(provider: AiProvider): boolean {
  return resolveAiProviderModelOptions(provider).length > 0;
}

// 描述：
//
//   - 判断 Provider 是否具备模式下拉选项。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - true: 应展示模式下拉框。
export function supportsAiProviderModeSelection(provider: AiProvider): boolean {
  return resolveAiProviderModeOptions(provider).length > 0;
}

// 描述：
//
//   - 将已保存但不在官方列表中的旧值补回选项中，避免用户历史配置在切换到下拉后丢失。
//
// Params:
//
//   - options: 官方选项列表。
//   - currentValue: 当前已保存值。
//
// Returns:
//
//   - 含历史值兜底的选项列表。
export function mergeAiProviderSelectOptions(
  options: AiProviderSelectOption[],
  currentValue: string,
): AiProviderSelectOption[] {
  const normalizedCurrentValue = String(currentValue || "").trim();
  if (!normalizedCurrentValue) {
    return options;
  }
  if (options.some((item) => item.value === normalizedCurrentValue)) {
    return options;
  }
  return [
    { value: normalizedCurrentValue, label: normalizedCurrentValue },
    ...options,
  ];
}
