import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { IS_BROWSER, STORAGE_KEYS } from "../constants";
import {
  DESKTOP_ENGLISH_FALLBACK_MESSAGES,
  DESKTOP_I18N_MESSAGES,
  DESKTOP_LANGUAGE_NATIVE_LABELS,
  DESKTOP_LANGUAGE_PREFERENCES,
  DESKTOP_LANGUAGES,
  type DesktopLanguage,
  type DesktopLanguagePreference,
  type DesktopTranslationParams,
} from "./messages";

// 描述：
//
//   - 定义日期格式化配置结构，复用 `Intl.DateTimeFormatOptions`。
export type DesktopDateTimeFormatOptions = Intl.DateTimeFormatOptions;

// 描述：
//
//   - 定义 Desktop 国际化上下文结构，统一暴露语言状态、翻译函数和本地化格式化能力。
export interface DesktopI18nContextValue {
  language: DesktopLanguage;
  languagePreference: DesktopLanguagePreference;
  setLanguage: (value: DesktopLanguage) => void;
  setLanguagePreference: (value: DesktopLanguagePreference) => void;
  t: (key: string, params?: DesktopTranslationParams) => string;
  formatDateTime: (value: string | number | Date, options?: DesktopDateTimeFormatOptions) => string;
  compareText: (left: string, right: string) => number;
  formatList: (values: string[]) => string;
}

// 描述：
//
//   - 维护 Context 默认值；未包裹 Provider 时直接抛错，避免静默使用错误语言。
const DesktopI18nContext = createContext<DesktopI18nContextValue | null>(null);

// 描述：
//
//   - 将任意语言标识归一到 Desktop 支持集合；未知值返回 null。
//
// Params:
//
//   - value: 原始语言值。
//
// Returns:
//
//   - 归一化后的受支持语言；未命中时返回 null。
export function normalizeDesktopLanguage(value: unknown): DesktopLanguage | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "zh" || normalized === "zh-cn" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }
  if (normalized === "en" || normalized === "en-us" || normalized.startsWith("en-")) {
    return "en-US";
  }
  return null;
}

// 描述：
//
//   - 返回 Desktop 当前语言的原生名称，供菜单与设置页复用。
//
// Params:
//
//   - language: 目标语言。
//
// Returns:
//
//   - 原生展示名称。
export function getDesktopLanguageNativeLabel(language: DesktopLanguage): string {
  return DESKTOP_LANGUAGE_NATIVE_LABELS[language];
}

// 描述：
//
//   - 根据当前语言推导 `Intl` 使用的 locale 标识。
//
// Params:
//
//   - language: Desktop 语言。
//
// Returns:
//
//   - 对应的 `Intl` locale。
export function resolveDesktopIntlLocale(language: DesktopLanguage): string {
  return language;
}

// 描述：
//
//   - 从系统语言列表中解析 Desktop 默认语言；未匹配时统一回退为英文。
//
// Params:
//
//   - languages: 候选语言列表。
//
// Returns:
//
//   - Desktop 默认语言。
export function resolveSystemDesktopLanguage(languages?: readonly string[]): DesktopLanguage {
  const candidates = Array.isArray(languages) && languages.length > 0
    ? languages
    : (IS_BROWSER ? [navigator.language] : []);
  for (const item of candidates) {
    const normalized = normalizeDesktopLanguage(item);
    if (normalized) {
      return normalized;
    }
  }
  return "en-US";
}

// 描述：
//
//   - 读取本地持久化的语言选择；若不存在或非法则返回 null。
//
// Returns:
//
//   - 已保存语言；无值时返回 null。
export function readStoredDesktopLanguage(): DesktopLanguage | null {
  if (!IS_BROWSER) {
    return null;
  }
  return normalizeDesktopLanguage(window.localStorage.getItem(STORAGE_KEYS.DESKTOP_LANGUAGE));
}

// 描述：
//
//   - 清理已保存的显式语言选择，让 Desktop 回到“自动检测”模式。
export function clearStoredDesktopLanguage(): void {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEYS.DESKTOP_LANGUAGE);
}

// 描述：
//
//   - 写入当前语言到本地缓存，供应用重启后恢复。
//
// Params:
//
//   - language: 待保存语言。
export function writeStoredDesktopLanguage(language: DesktopLanguage): void {
  if (!IS_BROWSER) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEYS.DESKTOP_LANGUAGE, language);
}

// 描述：
//
//   - 解析应用启动时的初始语言；优先使用用户已保存配置，否则按系统语言匹配。
//
// Returns:
//
//   - Desktop 初始语言。
export function resolveInitialDesktopLanguage(): DesktopLanguage {
  return readStoredDesktopLanguage() || resolveSystemDesktopLanguage(IS_BROWSER ? navigator.languages : []);
}

// 描述：
//
//   - 根据语言和翻译 key 返回模板文本；当前语言缺失时按“当前语言 -> 英文 -> 中文 -> key”顺序回退。
//
// Params:
//
//   - language: 当前语言。
//   - key: 翻译 key。
//
// Returns:
//
//   - 翻译模板文本。
function resolveTranslationTemplate(language: DesktopLanguage, key: string): string {
  if (language === "en-US" && !DESKTOP_I18N_MESSAGES[language][key]) {
    const fallbackTemplate = DESKTOP_ENGLISH_FALLBACK_MESSAGES[key];
    if (fallbackTemplate) {
      return fallbackTemplate;
    }
  }
  return DESKTOP_I18N_MESSAGES[language][key]
    || DESKTOP_I18N_MESSAGES["en-US"][key]
    || DESKTOP_I18N_MESSAGES["zh-CN"][key]
    || key;
}

// 描述：
//
//   - 将模板中的 `{{name}}` 占位符替换为传入参数。
//
// Params:
//
//   - template: 模板字符串。
//   - params: 翻译插值参数。
//
// Returns:
//
//   - 替换后的文本。
function interpolateTranslationTemplate(template: string, params?: DesktopTranslationParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, token: string) => {
    if (!(token in params)) {
      return "";
    }
    return String(params[token]);
  });
}

// 描述：
//
//   - 将一组词典 key 扩展为“中文原文 + 英文翻译 + 原始值”的去重列表，并统一转为小写，
//     供会话意图识别与运行态解析在中英文输入下复用。
//
// Params:
//
//   - keys: 待展开的词典 key 或直接匹配文本。
//
// Returns:
//
//   - 去重后的标准化文本列表。
export function resolveDesktopTextVariants(keys: readonly string[]): string[] {
  const variants = new Set<string>();
  keys.forEach((item) => {
    const normalizedKey = String(item || "").trim();
    if (!normalizedKey) {
      return;
    }
    [
      normalizedKey,
      resolveTranslationTemplate("zh-CN", normalizedKey),
      resolveTranslationTemplate("en-US", normalizedKey),
    ].forEach((value) => {
      const normalizedValue = String(value || "").trim().toLowerCase();
      if (normalizedValue) {
        variants.add(normalizedValue);
      }
    });
  });
  return Array.from(variants);
}

// 描述：
//
//   - 在非 React 场景下直接翻译文本；默认使用当前缓存语言或系统语言。
//
// Params:
//
//   - key: 翻译 key。
//   - params: 插值参数。
//   - language: 可选指定语言。
//
// Returns:
//
//   - 翻译后的文本。
export function translateDesktopText(
  key: string,
  params?: DesktopTranslationParams,
  language?: DesktopLanguage,
): string {
  const resolvedLanguage = language || resolveInitialDesktopLanguage();
  const template = resolveTranslationTemplate(resolvedLanguage, key);
  return interpolateTranslationTemplate(template, params);
}

// 描述：
//
//   - 在非 React 场景下格式化时间文本，保证日期展示跟随当前界面语言。
//
// Params:
//
//   - value: 原始时间值。
//   - options: 格式化配置。
//   - language: 可选指定语言。
//
// Returns:
//
//   - 本地化后的时间文本；无效值时返回空串。
export function formatDesktopDateTime(
  value: string | number | Date,
  options?: DesktopDateTimeFormatOptions,
  language?: DesktopLanguage,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(resolveDesktopIntlLocale(language || resolveInitialDesktopLanguage()), options).format(date);
}

// 描述：
//
//   - 对文本进行本地化排序比较，供列表排序逻辑复用。
//
// Params:
//
//   - left: 左值。
//   - right: 右值。
//   - language: 可选指定语言。
//
// Returns:
//
//   - `localeCompare` 结果。
export function compareDesktopText(left: string, right: string, language?: DesktopLanguage): number {
  return String(left || "").localeCompare(String(right || ""), resolveDesktopIntlLocale(language || resolveInitialDesktopLanguage()));
}

// 描述：
//
//   - 按当前语言格式化文本列表，避免中文固定使用顿号、英文固定使用逗号的硬编码问题。
//
// Params:
//
//   - values: 文本列表。
//   - language: 可选指定语言。
//
// Returns:
//
//   - 本地化后的列表字符串。
export function formatDesktopList(values: string[], language?: DesktopLanguage): string {
  const normalized = values.map((item) => String(item || "").trim()).filter(Boolean);
  if (normalized.length === 0) {
    return "";
  }
  const formatter = new Intl.ListFormat(resolveDesktopIntlLocale(language || resolveInitialDesktopLanguage()), {
    style: "long",
    type: "conjunction",
  });
  return formatter.format(normalized);
}

// 描述：
//
//   - 创建基于当前语言的国际化上下文值，供 App 根组件与 Provider 复用。
//
// Returns:
//
//   - 可直接写入 Provider 的上下文值。
export function useDesktopI18nController(): DesktopI18nContextValue {
  const [language, setLanguageState] = useState<DesktopLanguage>(() => resolveInitialDesktopLanguage());
  const [followSystemLanguage, setFollowSystemLanguage] = useState(() => readStoredDesktopLanguage() === null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.lang = resolveDesktopIntlLocale(language);
  }, [language]);

  useEffect(() => {
    if (!IS_BROWSER || !followSystemLanguage) {
      return;
    }
    const handleLanguageChange = () => {
      setLanguageState(resolveSystemDesktopLanguage(navigator.languages));
    };
    window.addEventListener("languagechange", handleLanguageChange);
    return () => {
      window.removeEventListener("languagechange", handleLanguageChange);
    };
  }, [followSystemLanguage]);

  return useMemo(() => {
    const setLanguage = (value: DesktopLanguage) => {
      writeStoredDesktopLanguage(value);
      setFollowSystemLanguage(false);
      setLanguageState(value);
    };
    const setLanguagePreference = (value: DesktopLanguagePreference) => {
      if (value === "auto") {
        clearStoredDesktopLanguage();
        setFollowSystemLanguage(true);
        setLanguageState(resolveSystemDesktopLanguage(IS_BROWSER ? navigator.languages : []));
        return;
      }
      setLanguage(value);
    };
    return {
      language,
      languagePreference: followSystemLanguage ? "auto" : language,
      setLanguage,
      setLanguagePreference,
      t: (key: string, params?: DesktopTranslationParams) => translateDesktopText(key, params, language),
      formatDateTime: (value: string | number | Date, options?: DesktopDateTimeFormatOptions) => (
        formatDesktopDateTime(value, options, language)
      ),
      compareText: (left: string, right: string) => compareDesktopText(left, right, language),
      formatList: (values: string[]) => formatDesktopList(values, language),
    };
  }, [followSystemLanguage, language]);
}

// 描述：
//
//   - 提供 Desktop 国际化上下文，使任意页面都可通过 hook 获取语言和翻译能力。
//
// Params:
//
//   - value: 已创建的上下文值。
//   - children: 子树节点。
export function DesktopI18nProvider({
  value,
  children,
}: {
  value: DesktopI18nContextValue;
  children: ReactNode;
}) {
  return <DesktopI18nContext.Provider value={value}>{children}</DesktopI18nContext.Provider>;
}

// 描述：
//
//   - 读取 Desktop 国际化上下文；若未包裹 Provider 则抛错，避免产生静默错误。
//
// Returns:
//
//   - 当前国际化上下文值。
export function useDesktopI18n(): DesktopI18nContextValue {
  const value = useContext(DesktopI18nContext);
  if (!value) {
    throw new Error("DesktopI18nProvider is required.");
  }
  return value;
}

export { DESKTOP_LANGUAGES, DESKTOP_LANGUAGE_NATIVE_LABELS, DESKTOP_LANGUAGE_PREFERENCES };
export type { DesktopLanguage, DesktopLanguagePreference };
