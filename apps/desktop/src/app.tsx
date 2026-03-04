import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AriApp, AriMessage, setAppConfig, setColorTheme } from "aries_react";
import { invoke } from "@tauri-apps/api/core";
import { HashRouter } from "react-router-dom";
import { DesktopRouter } from "./router";
import { ensureBlenderBridge } from "./shared/services/blender-bridge";
import {
	clearAuthToken,
	getAuthToken,
	getCurrentUser,
	listAvailableAgents,
	loginByPassword,
	logoutCurrentUser,
	setAuthToken,
	setUnauthorizedHandler,
} from "./shared/services/backend-api";
import type { AuthState } from "./router/types";
import type {
	AiKeyItem,
	BlenderBridgeEnsureOptions,
	AuthAvailableAgentItem,
	BlenderBridgeEnsureResult,
	BlenderBridgeRuntime,
	ColorThemeMode,
	LoginUser,
	ModelMcpCapabilities,
} from "./shared/types";
import { defaultServiceUrl, STORAGE_KEYS } from "./shared/constants";

// 描述:
//
//   - 定义 Codex CLI 健康检查结果结构。
interface CodexCliHealthResponse {
	available: boolean;
	outdated: boolean;
	version: string;
	minimum_version: string;
	bin_path: string;
	message: string;
}

// 描述：
//
//   - 定义 Gemini CLI 健康检查结果结构。
interface GeminiCliHealthResponse {
	available: boolean;
	outdated: boolean;
	version: string;
	minimum_version: string;
	bin_path: string;
	message: string;
}

// 描述：
//
//   - 返回 Provider 的默认展示名称。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - 展示名称。
function resolveAiProviderLabel(provider: AiKeyItem["provider"]): string {
	if (provider === "codex") {
		return "Codex CLI";
	}
	if (provider === "gemini-cli") {
		return "Gemini CLI";
	}
	return "Google Gemini";
}

// 描述：
//
//   - 判断 Provider 是否为本地 CLI 类型（无需 API Key）。
//
// Params:
//
//   - provider: Provider 标识。
//
// Returns:
//
//   - true: 本地 CLI Provider。
function isLocalCliProvider(provider: AiKeyItem["provider"]): boolean {
	return provider === "codex" || provider === "gemini-cli";
}

// 描述：
//
//   - 构建默认 AI Key 列表，确保 Codex CLI、Gemini CLI 与 Gemini API 都有入口。
//
// Params:
//
//   - now: 更新时间文本。
//
// Returns:
//
//   - 默认 AI Key 配置列表。
function buildDefaultAiKeys(now: string): AiKeyItem[] {
	return [
		{
			id: "codex-default",
			provider: "codex",
			providerLabel: resolveAiProviderLabel("codex"),
			keyValue: "local-cli",
			enabled: true,
			updatedAt: now,
		},
		{
			id: "gemini-cli-default",
			provider: "gemini-cli",
			providerLabel: resolveAiProviderLabel("gemini-cli"),
			keyValue: "local-cli",
			enabled: false,
			updatedAt: now,
		},
		{
			id: "gemini-default",
			provider: "gemini",
			providerLabel: resolveAiProviderLabel("gemini"),
			keyValue: "",
			enabled: false,
			updatedAt: now,
		},
	];
}

// 描述：
//
//   - 规范化本地缓存中的 AI Key 列表，并自动补齐新增 Provider。
//
// Params:
//
//   - raw: 缓存原始值。
//   - now: 更新时间文本。
//
// Returns:
//
//   - 规范化后的 AI Key 列表。
function normalizeAiKeys(raw: unknown, now: string): AiKeyItem[] {
	const defaults = buildDefaultAiKeys(now);
	if (!Array.isArray(raw)) {
		return defaults;
	}

	const normalized: AiKeyItem[] = raw
		.map((item) => {
			const provider = String((item as { provider?: string })?.provider || "").trim() as AiKeyItem["provider"];
			if (provider !== "codex" && provider !== "gemini" && provider !== "gemini-cli") {
				return null;
			}
			const keyValueRaw = String((item as { keyValue?: string })?.keyValue || "");
			const keyValue = isLocalCliProvider(provider)
				? (keyValueRaw.trim() || "local-cli")
				: keyValueRaw;
			return {
				id: String((item as { id?: string })?.id || `${provider}-default`),
				provider,
				providerLabel: String((item as { providerLabel?: string })?.providerLabel || "").trim() || resolveAiProviderLabel(provider),
				keyValue,
				enabled: Boolean((item as { enabled?: boolean })?.enabled),
				updatedAt: String((item as { updatedAt?: string })?.updatedAt || now),
			} as AiKeyItem;
		})
		.filter((item): item is AiKeyItem => Boolean(item));

	// 描述：按 provider 去重，保留用户首个配置项顺序。
	const uniqueByProvider: AiKeyItem[] = [];
	const providerSet = new Set<AiKeyItem["provider"]>();
	normalized.forEach((item) => {
		if (providerSet.has(item.provider)) {
			return;
		}
		providerSet.add(item.provider);
		uniqueByProvider.push(item);
	});

	defaults.forEach((fallback) => {
		if (!providerSet.has(fallback.provider)) {
			providerSet.add(fallback.provider);
			uniqueByProvider.push(fallback);
		}
	});

	return uniqueByProvider;
}

// 描述:
//
//   - 初始化全局应用配置。
const appConfig = setAppConfig({
	baseUrl: import.meta.env.VITE_APP_API_URL || defaultServiceUrl("app"),
	localImgSrc: import.meta.env.VITE_APP_LOCAL_IMG_SRC || "",
	theme: "brand"
});

// 描述:
//
//   - 渲染桌面端应用根组件，负责认证恢复、主题同步与全局能力注入。
export default function App() {
	// 描述：当前登录用户状态。
	const [user, setUser] = useState<LoginUser | null>(null);
	// 描述：当前用户可访问的智能体列表。
	const [availableAgents, setAvailableAgents] = useState<AuthAvailableAgentItem[]>([]);
	// 描述：认证恢复中标记，用于首屏路由守卫。
	const [restoringAuth, setRestoringAuth] = useState(true);
	// 描述：主题模式（亮色/暗色/跟随系统）。
	const [colorThemeMode, setColorThemeMode] = useState<ColorThemeMode>(() => {
		const saved = localStorage.getItem(STORAGE_KEYS.COLOR_THEME_MODE);
		if (saved === "light" || saved === "dark" || saved === "system") {
			return saved;
		}
		return "system";
	});
	// 描述：模型智能体 MCP 能力开关集合。
	const [modelMcpCapabilities, setModelMcpCapabilities] = useState<ModelMcpCapabilities>(() => {
		const saved = localStorage.getItem(STORAGE_KEYS.MODEL_MCP_CAPABILITIES);
		if (saved) {
			try {
				const parsed = JSON.parse(saved);
				if (typeof parsed?.export === "boolean") {
					return {
						export: parsed.export,
						scene: typeof parsed?.scene === "boolean" ? parsed.scene : true,
						transform: typeof parsed?.transform === "boolean" ? parsed.transform : true,
						geometry: typeof parsed?.geometry === "boolean" ? parsed.geometry : true,
						mesh_opt: typeof parsed?.mesh_opt === "boolean" ? parsed.mesh_opt : true,
						material: typeof parsed?.material === "boolean" ? parsed.material : true,
						file: typeof parsed?.file === "boolean" ? parsed.file : true,
					};
				}
			} catch (_err) {
				// Ignore invalid cached value.
			}
		}
		return {
			export: true,
			scene: true,
			transform: true,
			geometry: true,
			mesh_opt: true,
			material: true,
			file: true,
		};
	});
	// 描述：AI Provider 配置与启用状态列表。
	const [aiKeys, setAiKeys] = useState<AiKeyItem[]>(() => {
		const now = new Date().toLocaleString("zh-CN", {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
		const saved = localStorage.getItem(STORAGE_KEYS.AI_KEYS);
		if (saved) {
			try {
				const parsed = JSON.parse(saved);
				return normalizeAiKeys(parsed, now);
			} catch (_err) {
				// Ignore invalid cached value.
			}
		}
		return buildDefaultAiKeys(now);
	});
	// 描述：Blender Bridge 运行态（检测中/可用性/提示文案）。
	const [blenderBridgeRuntime, setBlenderBridgeRuntime] = useState<BlenderBridgeRuntime>({
		checking: false,
		ok: null,
		message: "Bridge 未检测",
	});
	// 描述：缓存 Bridge 检测任务，避免并发触发重复检测。
	const bridgeTaskRef = useRef<Promise<BlenderBridgeEnsureResult> | null>(null);
	// 描述：记录已展示过的 Codex 提示弹窗，防止同一提示重复弹出。
	const codexPopupShownRef = useRef<Set<string>>(new Set());
	// 描述：记录已展示过的 Gemini CLI 提示弹窗，防止同一提示重复弹出。
	const geminiCliPopupShownRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		localStorage.setItem(STORAGE_KEYS.COLOR_THEME_MODE, colorThemeMode);

		// 描述：根据当前主题模式应用实际色彩主题。
		const applyMode = () => {
			if (colorThemeMode === "system") {
				const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
				setColorTheme(isDark ? "dark" : "light");
				return;
			}
			setColorTheme(colorThemeMode);
		};

		applyMode();

		if (colorThemeMode !== "system") {
			const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
			const handleChange = () => setColorTheme(colorThemeMode);
			mediaQuery.addEventListener("change", handleChange);
			return () => mediaQuery.removeEventListener("change", handleChange);
		}

		return undefined;
	}, [colorThemeMode]);

	useEffect(() => {
		localStorage.setItem(
			STORAGE_KEYS.MODEL_MCP_CAPABILITIES,
			JSON.stringify(modelMcpCapabilities)
		);
	}, [modelMcpCapabilities]);

	useEffect(() => {
		localStorage.setItem(STORAGE_KEYS.AI_KEYS, JSON.stringify(aiKeys));
	}, [aiKeys]);

	// 描述：读取当前登录态并同步用户信息与可用智能体。
	const refreshAuthState = useCallback(async () => {
		try {
			const currentUser = await getCurrentUser();
			setUser(currentUser);
			const agents = await listAvailableAgents();
			setAvailableAgents(agents);
		} catch (_err) {
			clearAuthToken();
			setUser(null);
			setAvailableAgents([]);
		} finally {
			setRestoringAuth(false);
		}
	}, []);

	useEffect(() => {
		setUnauthorizedHandler(() => {
			clearAuthToken();
			setUser(null);
			setAvailableAgents([]);
		});
		return () => {
			setUnauthorizedHandler(null);
		};
	}, []);

	useEffect(() => {
		const token = getAuthToken();
		if (!token) {
			setRestoringAuth(false);
			return;
		}
		void refreshAuthState();
	}, [refreshAuthState]);

	useEffect(() => {
		// 描述：仅当启用对应 CLI Provider 时执行本地可用性探测。
		const codexEnabled = aiKeys.some((item) => item.provider === "codex" && item.enabled);
		const geminiCliEnabled = aiKeys.some((item) => item.provider === "gemini-cli" && item.enabled);
		if (!codexEnabled && !geminiCliEnabled) {
			return;
		}

		let disposed = false;
		// 描述：执行 Codex / Gemini CLI 检查并在异常场景展示一次性提示。
		const check = async (): Promise<void> => {
			if (codexEnabled) {
				try {
					const health = await invoke<CodexCliHealthResponse>("check_codex_cli_health", {});
					if (disposed) {
						return;
					}
					const popupKey = `${health.available}-${health.outdated}-${health.version}-${health.minimum_version}-${health.bin_path}`;
					if (!codexPopupShownRef.current.has(popupKey) && (!health.available || health.outdated)) {
						codexPopupShownRef.current.add(popupKey);
						const updateHint = "建议执行：pnpm add -g @openai/codex@latest";
						const detail = health.bin_path ? `\n当前路径：${health.bin_path}` : "";
						AriMessage.warning({
							content: `${health.message}${detail}\n${updateHint}`,
							duration: 5000,
							showClose: true,
						});
					}
				} catch (err) {
					if (disposed) {
						return;
					}
					const popupKey = `codex-check-error:${String(err)}`;
					if (!codexPopupShownRef.current.has(popupKey)) {
						codexPopupShownRef.current.add(popupKey);
						AriMessage.error({
							content: `Codex CLI 检测失败：${String(err)}`,
							duration: 5000,
							showClose: true,
						});
					}
				}
			}

			if (geminiCliEnabled) {
				try {
					const health = await invoke<GeminiCliHealthResponse>("check_gemini_cli_health", {});
					if (disposed) {
						return;
					}
					const popupKey = `${health.available}-${health.outdated}-${health.version}-${health.minimum_version}-${health.bin_path}`;
					if (!geminiCliPopupShownRef.current.has(popupKey) && (!health.available || health.outdated)) {
						geminiCliPopupShownRef.current.add(popupKey);
						const detail = health.bin_path ? `\n当前路径：${health.bin_path}` : "";
						AriMessage.warning({
							content: `Gemini CLI 检测异常：${health.message}${detail}`,
							duration: 5000,
							showClose: true,
						});
					}
				} catch (err) {
					if (disposed) {
						return;
					}
					const popupKey = `gemini-cli-check-error:${String(err)}`;
					if (!geminiCliPopupShownRef.current.has(popupKey)) {
						geminiCliPopupShownRef.current.add(popupKey);
						AriMessage.error({
							content: `Gemini CLI 检测失败：${String(err)}`,
							duration: 5000,
							showClose: true,
						});
					}
				}
			}
		};

		void check();

		return () => {
			disposed = true;
		};
	}, [aiKeys]);

	// 描述：统一执行 Blender Bridge 检测并同步运行态，含并发去重。
	const ensureBlenderBridgeRuntime = useCallback(async (options?: BlenderBridgeEnsureOptions) => {
		if (bridgeTaskRef.current) {
			return bridgeTaskRef.current;
		}

		const task = (async () => {
			setBlenderBridgeRuntime({
				checking: true,
				ok: null,
				message: "正在检测 Blender Bridge...",
			});

			const result = await ensureBlenderBridge(undefined, options);
			setBlenderBridgeRuntime({
				checking: false,
				ok: result.ok,
				message: result.ok ? `Bridge 已就绪：${result.message}` : result.message,
			});
			return result;
		})().finally(() => {
			bridgeTaskRef.current = null;
		});

		bridgeTaskRef.current = task;
		return task;
	}, []);

	useEffect(() => {
		void ensureBlenderBridgeRuntime();
	}, [ensureBlenderBridgeRuntime]);

	// 描述：聚合路由层所需的认证上下文对象。
	const auth: AuthState = useMemo(
		() => ({
			user,
			restoringAuth,
			availableAgents,
			login: async (account: string, password: string) => {
				const result = await loginByPassword(account, password);
				setAuthToken(result.token);
				setUser(result.user);
				const agents = await listAvailableAgents();
				setAvailableAgents(agents);
			},
			logout: async () => {
				try {
					await logoutCurrentUser();
				} catch (_err) {
					// Ignore logout failures when token is already invalid.
				}
				clearAuthToken();
				setUser(null);
				setAvailableAgents([]);
			},
			colorThemeMode,
			setColorThemeMode,
			modelMcpCapabilities,
			setModelMcpCapabilities,
			aiKeys,
			setAiKeys,
			blenderBridgeRuntime,
			ensureBlenderBridge: ensureBlenderBridgeRuntime
		}),
		[
			user,
			restoringAuth,
			availableAgents,
			colorThemeMode,
			modelMcpCapabilities,
			aiKeys,
			blenderBridgeRuntime,
			ensureBlenderBridgeRuntime,
		]
	);

	return (
		<StrictMode>
			<AriApp appConfig={appConfig}>
				<HashRouter>
					<DesktopRouter auth={auth} />
				</HashRouter>
			</AriApp>
		</StrictMode>
	);
}
