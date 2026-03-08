import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AriApp, AriMessage, setAppConfig, setColorTheme } from "aries_react";
import { invoke } from "@tauri-apps/api/core";
import { HashRouter } from "react-router-dom";
import { DesktopRouter } from "./router";
import { SetupRequiredPage } from "./modules/common/pages/setup-required-page";
import { ensureBlenderBridge } from "./shared/services/blender-bridge";
import {
	checkDesktopUpdate as requestDesktopUpdateCheck,
	clearAuthToken,
	getSetupStatus,
	getAuthToken,
	getCurrentUser,
	getLocalAvailableAgents,
	getLocalConsoleIdentities,
	getLocalDesktopUser,
	listAvailableAgents,
	listAccountIdentities,
	loginByPassword,
	logoutCurrentUser,
	setAuthToken,
	setUnauthorizedHandler,
} from "./shared/services/backend-api";
import {
	buildDesktopWebSetupUrl,
	hasEnabledDesktopBackend,
	readDesktopBackendConfig,
	resetDesktopBackendConfig,
	saveDesktopBackendConfig,
} from "./shared/services/service-endpoints";
import type { AuthState } from "./router/types";
import type {
	AiKeyItem,
	BlenderBridgeEnsureOptions,
	AuthAvailableAgentItem,
	BlenderBridgeEnsureResult,
	BlenderBridgeRuntime,
	ColorThemeMode,
	ConsoleIdentityItem,
	DesktopBackendConfig,
	DesktopUpdateState,
	LoginUser,
	DccMcpCapabilities,
	SetupStatus,
} from "./shared/types";
import {
	COMMANDS,
	defaultServiceUrl,
	STORAGE_KEYS,
} from "./shared/constants";

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
//   - 定义桌面端运行时信息结构，用于更新检查请求参数组装。
interface DesktopRuntimeInfoResponse {
	current_version: string;
	platform: string;
	arch: string;
}

// 描述：
//
//   - 定义 Tauri 更新状态响应结构，供前端状态同步复用。
interface DesktopUpdateStateResponse {
	status: DesktopUpdateState["status"];
	current_version: string;
	target_version: string;
	progress: number;
	message: string;
	download_path?: string;
}

// 描述：
//
//   - 定义桌面端启动初始化检测状态，统一承载是否已安装、提示文案和 Web 初始化地址。
interface DesktopSetupGateState {
	checking: boolean;
	installed: boolean | null;
	setupUrl: string;
	message: string;
	currentStep: string;
	systemName: string;
}

// 描述：
//
//   - 将 setup 服务状态转换为桌面端可读文案，避免把原始状态枚举直接暴露给最终用户。
//
// Params:
//
//   - status: setup 服务返回的初始化状态。
//
// Returns:
//
//   - 面向用户的提示文案。
function buildSetupGateMessage(status: SetupStatus): string {
	if (status.lastError) {
		return `系统尚未完成初始化，最近一次安装错误：${status.lastError}`;
	}
	if (status.accountAvailable === false) {
		return "系统尚未完成初始化，account 服务当前不可用，请先启动 account 和 setup 服务。";
	}
	if (status.currentStep) {
		return `系统尚未完成初始化，请继续执行 ${status.currentStep} 步骤。`;
	}
	return "系统尚未完成初始化，请先在 Web 完成安装向导。";
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

// 描述：
//
//   - 将 Tauri 更新状态响应映射为前端统一状态结构。
function mapDesktopUpdateStateResponse(payload: DesktopUpdateStateResponse): DesktopUpdateState {
	return {
		status: payload.status,
		currentVersion: String(payload.current_version || ""),
		targetVersion: String(payload.target_version || ""),
		progress: Number(payload.progress || 0),
		message: String(payload.message || ""),
		downloadPath: payload.download_path || "",
	};
}

// 描述：
//
//   - 读取当前缓存的身份 ID，用于恢复 Desktop 当前管理上下文。
//
// Returns:
//
//   - 已缓存的身份 ID；不存在时返回空字符串。
function readStoredSelectedIdentityId(): string {
	return localStorage.getItem(STORAGE_KEYS.DESKTOP_SELECTED_IDENTITY_ID) || "";
}

// 描述：
//
//   - 持久化当前选中的身份 ID；空值时清理缓存。
//
// Params:
//
//   - identityId: 当前选中的身份 ID。
function writeStoredSelectedIdentityId(identityId: string) {
	if (identityId) {
		localStorage.setItem(STORAGE_KEYS.DESKTOP_SELECTED_IDENTITY_ID, identityId);
		return;
	}
	localStorage.removeItem(STORAGE_KEYS.DESKTOP_SELECTED_IDENTITY_ID);
}

// 描述：
//
//   - 根据身份列表和缓存 ID 解析当前应选中的身份；若只有一个身份则自动选中。
//
// Params:
//
//   - identities: 当前可用身份列表。
//   - preferredIdentityId: 优先尝试恢复的身份 ID。
//
// Returns:
//
//   - 当前应使用的身份；无可用身份时返回 null。
function resolveSelectedDesktopIdentity(
	identities: ConsoleIdentityItem[],
	preferredIdentityId: string,
): ConsoleIdentityItem | null {
	if (!identities.length) {
		return null;
	}
	if (preferredIdentityId) {
		const matchedIdentity = identities.find((item) => item.id === preferredIdentityId);
		if (matchedIdentity) {
			return matchedIdentity;
		}
	}
	if (identities.length === 1) {
		return identities[0];
	}
	return identities[0];
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
	// 描述：桌面端启动前的初始化状态检测结果；未完成安装时用于阻断登录入口。
	const [desktopSetupGate, setDesktopSetupGate] = useState<DesktopSetupGateState>({
		checking: hasEnabledDesktopBackend(readDesktopBackendConfig()),
		installed: hasEnabledDesktopBackend(readDesktopBackendConfig()) ? null : true,
		setupUrl: buildDesktopWebSetupUrl(readDesktopBackendConfig()),
		message: hasEnabledDesktopBackend(readDesktopBackendConfig())
			? "正在检查系统初始化状态..."
			: "当前未接入后端，Desktop 将使用本地模式运行。",
		currentStep: "",
		systemName: "",
	});
	// 描述：桌面端后端接入配置；未启用时整体走本地模式。
	const [backendConfig, setBackendConfig] = useState<DesktopBackendConfig>(() => readDesktopBackendConfig());
	// 描述：当前登录用户状态。
	const [user, setUser] = useState<LoginUser | null>(() => (
		hasEnabledDesktopBackend(readDesktopBackendConfig()) ? null : getLocalDesktopUser()
	));
	// 描述：当前用户可访问的智能体列表。
	const [availableAgents, setAvailableAgents] = useState<AuthAvailableAgentItem[]>(() => (
		hasEnabledDesktopBackend(readDesktopBackendConfig()) ? [] : getLocalAvailableAgents()
	));
	// 描述：当前生效的身份上下文，供管理页和用户入口展示。
	const [selectedIdentity, setSelectedIdentityState] = useState<ConsoleIdentityItem | null>(() => {
		if (hasEnabledDesktopBackend(readDesktopBackendConfig())) {
			return null;
		}
		return resolveSelectedDesktopIdentity(getLocalConsoleIdentities(), readStoredSelectedIdentityId());
	});
	// 描述：认证恢复中标记，用于首屏路由守卫。
	const [restoringAuth, setRestoringAuth] = useState(hasEnabledDesktopBackend(readDesktopBackendConfig()));
	// 描述：主题模式（亮色/暗色/跟随系统）。
	const [colorThemeMode, setColorThemeMode] = useState<ColorThemeMode>(() => {
		const saved = localStorage.getItem(STORAGE_KEYS.COLOR_THEME_MODE);
		if (saved === "light" || saved === "dark" || saved === "system") {
			return saved;
		}
		return "system";
	});
	// 描述：DCC MCP 能力开关集合；统一使用单智能体存储键持久化。
	const [dccMcpCapabilities, setDccMcpCapabilities] = useState<DccMcpCapabilities>(() => {
		const saved = localStorage.getItem(STORAGE_KEYS.DCC_MCP_CAPABILITIES);
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
	// 描述：桌面端更新流程状态（检查/下载/就绪/安装）。
	const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState>({
		status: "idle",
		currentVersion: "",
		targetVersion: "",
		progress: 0,
		message: "尚未检查更新",
		downloadPath: "",
	});
	// 描述：标记更新检查进行中，避免并发触发重复下载。
	const checkingDesktopUpdateRef = useRef(false);
	// 描述：更新状态轮询定时器句柄。
	const desktopUpdatePollTimerRef = useRef<number | null>(null);
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
	// 描述：根据当前配置判断 Desktop 是否已接入远端后端。
	const backendEnabled = hasEnabledDesktopBackend(backendConfig);

	// 描述：保存当前选中的身份上下文，并同步到本地缓存供 Desktop 重启恢复。
	const updateSelectedIdentity = useCallback((value: ConsoleIdentityItem | null) => {
		setSelectedIdentityState(value);
		writeStoredSelectedIdentityId(value?.id || "");
		return value;
	}, []);

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
			STORAGE_KEYS.DCC_MCP_CAPABILITIES,
			JSON.stringify(dccMcpCapabilities)
		);
	}, [dccMcpCapabilities]);

	useEffect(() => {
		localStorage.setItem(STORAGE_KEYS.AI_KEYS, JSON.stringify(aiKeys));
	}, [aiKeys]);

	// 描述：保存桌面端后端接入配置，并立即同步到当前运行时状态。
	const updateBackendConfig = useCallback((nextConfig: DesktopBackendConfig) => {
		const saved = saveDesktopBackendConfig(nextConfig);
		setBackendConfig(saved);
		if (hasEnabledDesktopBackend(saved)) {
			setUser(null);
			setAvailableAgents([]);
			setSelectedIdentityState(null);
			setDesktopSetupGate({
				checking: true,
				installed: null,
				setupUrl: buildDesktopWebSetupUrl(saved),
				message: "正在检查系统初始化状态...",
				currentStep: "",
				systemName: "",
			});
			setRestoringAuth(true);
		}
		if (!hasEnabledDesktopBackend(saved)) {
			updateSelectedIdentity(
				resolveSelectedDesktopIdentity(getLocalConsoleIdentities(), readStoredSelectedIdentityId()),
			);
			setDesktopSetupGate({
				checking: false,
				installed: true,
				setupUrl: buildDesktopWebSetupUrl(saved),
				message: "当前未接入后端，Desktop 将使用本地模式运行。",
				currentStep: "",
				systemName: "",
			});
		}
		return saved;
	}, [updateSelectedIdentity]);

	// 描述：将桌面端后端接入配置恢复为默认值，便于快速回退到纯本地模式。
	const restoreBackendConfig = useCallback(() => {
		const restored = resetDesktopBackendConfig();
		setBackendConfig(restored);
		updateSelectedIdentity(
			resolveSelectedDesktopIdentity(getLocalConsoleIdentities(), readStoredSelectedIdentityId()),
		);
		setDesktopSetupGate({
			checking: false,
			installed: true,
			setupUrl: buildDesktopWebSetupUrl(restored),
			message: "当前未接入后端，Desktop 将使用本地模式运行。",
			currentStep: "",
			systemName: "",
		});
		return restored;
	}, [updateSelectedIdentity]);

	// 描述：按指定后端配置检查 setup 服务安装状态；未完成安装时仅提示用户去初始化，仍允许切回本地模式。
	const refreshDesktopSetupGateByConfig = useCallback(async (config: DesktopBackendConfig) => {
		if (!hasEnabledDesktopBackend(config)) {
			setDesktopSetupGate({
				checking: false,
				installed: true,
				setupUrl: buildDesktopWebSetupUrl(config),
				message: "当前未接入后端，Desktop 将使用本地模式运行。",
				currentStep: "",
				systemName: "",
			});
			return;
		}

		setDesktopSetupGate((prev) => ({
			...prev,
			checking: true,
			message: "正在检查系统初始化状态...",
			setupUrl: buildDesktopWebSetupUrl(config),
		}));

		try {
			const status = await getSetupStatus();
			const nextSetupUrl = buildDesktopWebSetupUrl(config);
			if (status.installed) {
				setDesktopSetupGate({
					checking: false,
					installed: true,
					setupUrl: nextSetupUrl,
					message: "系统初始化已完成。",
					currentStep: status.currentStep || "",
					systemName: status.systemConfig?.systemName || "",
				});
				return;
			}

			setDesktopSetupGate({
				checking: false,
				installed: false,
				setupUrl: nextSetupUrl,
				message: buildSetupGateMessage(status),
				currentStep: status.currentStep || "",
				systemName: status.systemConfig?.systemName || "",
			});
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			setDesktopSetupGate((prev) => ({
				...prev,
				checking: false,
				installed: false,
				setupUrl: buildDesktopWebSetupUrl(config),
				message: `初始化状态检查失败：${detail}`,
			}));
			console.warn("check setup status failed:", err);
		}
	}, []);

	// 描述：使用当前后端配置重新检查 setup 服务状态；本地模式下直接跳过远端初始化检测。
	const refreshDesktopSetupGate = useCallback(async () => {
		await refreshDesktopSetupGateByConfig(backendConfig);
	}, [backendConfig, refreshDesktopSetupGateByConfig]);

	useEffect(() => {
		if (!backendEnabled) {
			setRestoringAuth(false);
			setUser(getLocalDesktopUser());
			setAvailableAgents(getLocalAvailableAgents());
			updateSelectedIdentity(
				resolveSelectedDesktopIdentity(getLocalConsoleIdentities(), readStoredSelectedIdentityId()),
			);
			return;
		}
		void refreshDesktopSetupGate();
	}, [backendEnabled, refreshDesktopSetupGate, updateSelectedIdentity]);

	// 描述：在初始化引导页保存后端地址，并在保存后立即重试 setup 检查。
	const saveSetupGateBackendConfig = useCallback(
		async (nextConfig: DesktopBackendConfig) => {
			const saved = updateBackendConfig(nextConfig);
			setDesktopSetupGate((prev) => ({
				...prev,
				setupUrl: buildDesktopWebSetupUrl(saved),
			}));
			await refreshDesktopSetupGateByConfig(saved);
		},
		[refreshDesktopSetupGateByConfig, updateBackendConfig],
	);

	// 描述：从初始化引导页直接切回本地模式；保存后新的会话与工作流将仅写入本地存储。
	const switchToLocalDesktopMode = useCallback(async () => {
		restoreBackendConfig();
		clearAuthToken();
		setUser(getLocalDesktopUser());
		setAvailableAgents(getLocalAvailableAgents());
		updateSelectedIdentity(
			resolveSelectedDesktopIdentity(getLocalConsoleIdentities(), readStoredSelectedIdentityId()),
		);
		setRestoringAuth(false);
	}, [restoreBackendConfig, updateSelectedIdentity]);

	// 描述：读取当前登录态并同步用户信息与可用智能体。
	const refreshAuthState = useCallback(async () => {
		if (!backendEnabled) {
			setUser(getLocalDesktopUser());
			setAvailableAgents(getLocalAvailableAgents());
			updateSelectedIdentity(
				resolveSelectedDesktopIdentity(getLocalConsoleIdentities(), readStoredSelectedIdentityId()),
			);
			setRestoringAuth(false);
			return;
		}
		try {
			const currentUser = await getCurrentUser();
			setUser(currentUser);
			const [agents, identities] = await Promise.all([
				listAvailableAgents(),
				listAccountIdentities().catch(() => [] as ConsoleIdentityItem[]),
			]);
			setAvailableAgents(agents);
			updateSelectedIdentity(
				resolveSelectedDesktopIdentity(identities, readStoredSelectedIdentityId()),
			);
		} catch (_err) {
			clearAuthToken();
			setUser(null);
			setAvailableAgents([]);
			updateSelectedIdentity(null);
		} finally {
			setRestoringAuth(false);
		}
	}, [backendEnabled, updateSelectedIdentity]);

	useEffect(() => {
		setUnauthorizedHandler(() => {
			clearAuthToken();
			if (backendEnabled) {
				setUser(null);
				setAvailableAgents([]);
				updateSelectedIdentity(null);
				return;
			}
			setUser(getLocalDesktopUser());
			setAvailableAgents(getLocalAvailableAgents());
			updateSelectedIdentity(
				resolveSelectedDesktopIdentity(getLocalConsoleIdentities(), readStoredSelectedIdentityId()),
			);
		});
		return () => {
			setUnauthorizedHandler(null);
		};
	}, [backendEnabled]);

	useEffect(() => {
		if (!backendEnabled) {
			setUser(getLocalDesktopUser());
			setAvailableAgents(getLocalAvailableAgents());
			updateSelectedIdentity(
				resolveSelectedDesktopIdentity(getLocalConsoleIdentities(), readStoredSelectedIdentityId()),
			);
			setRestoringAuth(false);
			return;
		}
		const token = getAuthToken();
		if (!token) {
			setUser(null);
			setAvailableAgents([]);
			updateSelectedIdentity(null);
			setRestoringAuth(false);
			return;
		}
		void refreshAuthState();
	}, [backendEnabled, refreshAuthState, updateSelectedIdentity]);

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

	// 描述：轮询 Tauri 更新状态并同步到前端。
	const syncDesktopUpdateState = useCallback(async () => {
		const payload = await invoke<DesktopUpdateStateResponse>(COMMANDS.GET_DESKTOP_UPDATE_STATE, {});
		setDesktopUpdateState(mapDesktopUpdateStateResponse(payload));
		return payload;
	}, []);

	// 描述：停止更新轮询任务，避免重复定时器。
	const stopDesktopUpdatePolling = useCallback(() => {
		if (desktopUpdatePollTimerRef.current !== null) {
			window.clearInterval(desktopUpdatePollTimerRef.current);
			desktopUpdatePollTimerRef.current = null;
		}
	}, []);

	// 描述：检查桌面端更新；命中新版时自动后台下载。
	const checkDesktopUpdate = useCallback(async () => {
		if (!backendEnabled) {
			setDesktopUpdateState((prev) => ({
				...prev,
				status: "idle",
				message: "当前为本地模式，未接入后端更新服务。",
			}));
			return;
		}
		if (checkingDesktopUpdateRef.current) {
			return;
		}
		checkingDesktopUpdateRef.current = true;
		try {
			const runtimeInfo = await invoke<DesktopRuntimeInfoResponse>(COMMANDS.GET_DESKTOP_RUNTIME_INFO, {});
			setDesktopUpdateState((prev) => ({
				...prev,
				status: "checking",
				currentVersion: runtimeInfo.current_version,
				message: "正在检查更新...",
			}));

			const update = await requestDesktopUpdateCheck({
				platform: runtimeInfo.platform,
				arch: runtimeInfo.arch,
				currentVersion: runtimeInfo.current_version,
				channel: "stable",
			});

			if (!update.hasUpdate || !update.downloadUrl) {
				stopDesktopUpdatePolling();
				setDesktopUpdateState({
					status: "idle",
					currentVersion: runtimeInfo.current_version,
					targetVersion: update.latestVersion || "",
					progress: 0,
					message: update.latestVersion
						? "当前已是最新版本"
						: "未配置可用更新源",
					downloadPath: "",
				});
				return;
			}

			const downloadState = await invoke<DesktopUpdateStateResponse>(
				COMMANDS.START_DESKTOP_UPDATE_DOWNLOAD,
				{
					request: {
						version: update.latestVersion,
						downloadUrl: update.downloadUrl,
						checksumSha256: update.checksumSha256 || "",
					},
				},
			);
			setDesktopUpdateState(mapDesktopUpdateStateResponse(downloadState));
			stopDesktopUpdatePolling();
			desktopUpdatePollTimerRef.current = window.setInterval(() => {
				void syncDesktopUpdateState().then((nextState) => {
					if (nextState.status !== "downloading") {
						stopDesktopUpdatePolling();
					}
				});
			}, 2000);
		} catch (err) {
			stopDesktopUpdatePolling();
			setDesktopUpdateState((prev) => ({
				...prev,
				status: "failed",
				message: "更新检查失败，请稍后重试。",
			}));
			AriMessage.warning({
				content: "更新检查失败，请稍后重试。",
				duration: 2800,
			});
			console.warn("check desktop update failed:", err);
		} finally {
			checkingDesktopUpdateRef.current = false;
		}
	}, [backendEnabled, stopDesktopUpdatePolling, syncDesktopUpdateState]);

	// 描述：触发桌面端安装更新（打开系统安装器）。
	const installDesktopUpdate = useCallback(async () => {
		try {
			const payload = await invoke<DesktopUpdateStateResponse>(
				COMMANDS.INSTALL_DOWNLOADED_DESKTOP_UPDATE,
				{},
			);
			setDesktopUpdateState(mapDesktopUpdateStateResponse(payload));
			AriMessage.success({
				content: payload.message || "已启动更新安装器，请按系统提示完成更新。",
				duration: 3200,
			});
		} catch (_err) {
			AriMessage.warning({
				content: "启动安装失败，请重新下载更新包后重试。",
				duration: 3000,
			});
		}
	}, []);

	// 描述：打开 Web 初始化页，便于用户在未安装状态下直接进入浏览器完成 setup。
	const openDesktopSetupUrl = useCallback(async () => {
		try {
			await invoke<boolean>("open_external_url", { url: desktopSetupGate.setupUrl });
		} catch (_err) {
			AriMessage.warning({
				content: "无法打开浏览器，请手动访问初始化地址完成安装。",
				duration: 3000,
			});
		}
	}, [desktopSetupGate.setupUrl]);

	useEffect(() => {
		if (!backendEnabled || !user) {
			stopDesktopUpdatePolling();
			return;
		}
		void checkDesktopUpdate();
		const timer = window.setInterval(() => {
			void checkDesktopUpdate();
		}, 30 * 60 * 1000);
		return () => {
			window.clearInterval(timer);
		};
	}, [backendEnabled, user, checkDesktopUpdate, stopDesktopUpdatePolling]);

	useEffect(() => {
		return () => {
			stopDesktopUpdatePolling();
		};
	}, [stopDesktopUpdatePolling]);

	// 描述：聚合路由层所需的认证上下文对象。
	const auth: AuthState = useMemo(
		() => ({
			user,
			restoringAuth,
			availableAgents,
			selectedIdentity,
			login: async (account: string, password: string) => {
				const result = await loginByPassword(account, password);
				if (backendEnabled) {
					setAuthToken(result.token);
				}
				const [agents, identities] = await Promise.all([
					listAvailableAgents(),
					listAccountIdentities().catch(() => [] as ConsoleIdentityItem[]),
				]);
				setUser(result.user);
				setAvailableAgents(agents);
				const nextSelectedIdentity = updateSelectedIdentity(
					resolveSelectedDesktopIdentity(identities, readStoredSelectedIdentityId()),
				);
				AriMessage.success({
					content: nextSelectedIdentity
						? `登录成功，当前身份已切换为 ${nextSelectedIdentity.scopeName}。`
						: "登录成功。",
					duration: 2600,
				});
			},
			logout: async () => {
				if (!backendEnabled) {
					AriMessage.info({
						content: "当前为本地模式，可在设置中接入后端服务。",
						duration: 2400,
					});
					return;
				}
				try {
					await logoutCurrentUser();
				} catch (_err) {
					// Ignore logout failures when token is already invalid.
				}
				clearAuthToken();
				setUser(null);
				setAvailableAgents([]);
				updateSelectedIdentity(null);
			},
			setSelectedIdentity: updateSelectedIdentity,
			colorThemeMode,
			setColorThemeMode,
			dccMcpCapabilities,
			setDccMcpCapabilities,
			aiKeys,
			setAiKeys,
			backendConfig,
			setBackendConfig: updateBackendConfig,
			resetBackendConfig: restoreBackendConfig,
			desktopUpdateState,
			checkDesktopUpdate,
			installDesktopUpdate,
			blenderBridgeRuntime,
			ensureBlenderBridge: ensureBlenderBridgeRuntime
		}),
		[
			user,
			restoringAuth,
			availableAgents,
			selectedIdentity,
			colorThemeMode,
			dccMcpCapabilities,
			aiKeys,
			backendConfig,
			desktopUpdateState,
			checkDesktopUpdate,
			installDesktopUpdate,
			blenderBridgeRuntime,
			ensureBlenderBridgeRuntime,
			updateBackendConfig,
			restoreBackendConfig,
			updateSelectedIdentity,
			backendEnabled,
		]
	);
	// 描述：仅在已启用后端且初始化未完成时显示初始化引导页；未接入后端时直接进入本地模式。
	const shouldShowSetupGate = backendEnabled && (desktopSetupGate.checking || desktopSetupGate.installed !== true);

	return (
		<StrictMode>
			<AriApp appConfig={appConfig}>
				{shouldShowSetupGate ? (
					<SetupRequiredPage
						checking={desktopSetupGate.checking}
						setupUrl={desktopSetupGate.setupUrl}
						message={desktopSetupGate.message}
						currentStep={desktopSetupGate.currentStep}
						systemName={desktopSetupGate.systemName}
						backendConfig={backendConfig}
						onOpenSetup={openDesktopSetupUrl}
						onUseLocalMode={switchToLocalDesktopMode}
						onSaveBackendConfig={saveSetupGateBackendConfig}
					/>
				) : (
					<HashRouter>
						<DesktopRouter auth={auth} />
					</HashRouter>
				)}
			</AriApp>
		</StrictMode>
	);
}
