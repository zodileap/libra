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
import { DevDebugFloat } from "./widgets/dev-debug-float";
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

interface CodexCliHealthResponse {
	available: boolean;
	outdated: boolean;
	version: string;
	minimum_version: string;
	bin_path: string;
	message: string;
}

const appConfig = setAppConfig({
	baseUrl: import.meta.env.VITE_APP_API_URL || "http://localhost:11001",
	localImgSrc: import.meta.env.VITE_APP_LOCAL_IMG_SRC || "",
	theme: "brand"
});

export default function App() {
	const [user, setUser] = useState<LoginUser | null>(null);
	const [availableAgents, setAvailableAgents] = useState<AuthAvailableAgentItem[]>([]);
	const [restoringAuth, setRestoringAuth] = useState(true);
	const [colorThemeMode, setColorThemeMode] = useState<ColorThemeMode>(() => {
		const saved = localStorage.getItem("zodileap.desktop.colorThemeMode");
		if (saved === "light" || saved === "dark" || saved === "system") {
			return saved;
		}
		return "system";
	});
	const [modelMcpCapabilities, setModelMcpCapabilities] = useState<ModelMcpCapabilities>(() => {
		const saved = localStorage.getItem("zodileap.desktop.modelMcpCapabilities");
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
	const [aiKeys, setAiKeys] = useState<AiKeyItem[]>(() => {
		const saved = localStorage.getItem("zodileap.desktop.aiKeys");
		if (saved) {
			try {
				const parsed = JSON.parse(saved);
				if (Array.isArray(parsed) && parsed.length > 0) {
					return parsed;
				}
			} catch (_err) {
				// Ignore invalid cached value.
			}
		}
		const now = new Date().toLocaleString("zh-CN", {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
		return [
			{
				id: "codex-default",
				provider: "codex",
				providerLabel: "Codex CLI",
				keyValue: "local-cli",
				enabled: true,
				updatedAt: now,
			},
			{
				id: "gemini-default",
				provider: "gemini",
				providerLabel: "Google Gemini",
				keyValue: "",
				enabled: false,
				updatedAt: now,
			},
		];
	});
	const [blenderBridgeRuntime, setBlenderBridgeRuntime] = useState<BlenderBridgeRuntime>({
		checking: false,
		ok: null,
		message: "Bridge 未检测",
	});
	const bridgeTaskRef = useRef<Promise<BlenderBridgeEnsureResult> | null>(null);
	const codexPopupShownRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		localStorage.setItem("zodileap.desktop.colorThemeMode", colorThemeMode);

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
			"zodileap.desktop.modelMcpCapabilities",
			JSON.stringify(modelMcpCapabilities)
		);
	}, [modelMcpCapabilities]);

	useEffect(() => {
		localStorage.setItem("zodileap.desktop.aiKeys", JSON.stringify(aiKeys));
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
		const codexEnabled = aiKeys.some((item) => item.provider === "codex" && item.enabled);
		if (!codexEnabled) {
			return;
		}

		let disposed = false;
		const check = async () => {
			try {
				const health = await invoke<CodexCliHealthResponse>("check_codex_cli_health", {});
				if (disposed) {
					return;
				}
				const popupKey = `${health.available}-${health.outdated}-${health.version}-${health.minimum_version}-${health.bin_path}`;
				if (codexPopupShownRef.current.has(popupKey)) {
					return;
				}
				if (!health.available || health.outdated) {
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
				if (codexPopupShownRef.current.has(popupKey)) {
					return;
				}
				codexPopupShownRef.current.add(popupKey);
				AriMessage.error({
					content: `Codex CLI 检测失败：${String(err)}`,
					duration: 5000,
					showClose: true,
				});
			}
		};

		void check();

		return () => {
			disposed = true;
		};
	}, [aiKeys]);

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
				{import.meta.env.DEV ? <DevDebugFloat /> : null}
			</AriApp>
		</StrictMode>
	);
}
