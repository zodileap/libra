import type {
  AiKeyItem,
  AgentKey,
  AuthAvailableAgentItem,
  BlenderBridgeEnsureOptions,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  ColorThemeMode,
  ConsoleIdentityItem,
  DesktopBackendConfig,
  DesktopUpdateState,
  LoginUser,
  DccMcpCapabilities,
} from "../shared/types";

// 描述：声明桌面端可按运行时与构建时控制的路由模块键。
export type DesktopRouteModuleKey =
  | "settings"
  | "skill"
  | "mcp"
  | "agent"
  | "session"
  | "workflow";

// 描述：统一声明 App 内部认证与个性化状态，供路由层与页面层复用。
export interface AuthState {
  user: LoginUser | null;
  restoringAuth: boolean;
  availableAgents: AuthAvailableAgentItem[];
  selectedIdentity: ConsoleIdentityItem | null;
  login: (account: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setSelectedIdentity: (value: ConsoleIdentityItem | null) => ConsoleIdentityItem | null;
  colorThemeMode: ColorThemeMode;
  setColorThemeMode: (value: ColorThemeMode) => void;
  dccMcpCapabilities: DccMcpCapabilities;
  setDccMcpCapabilities: (value: DccMcpCapabilities) => void;
  aiKeys: AiKeyItem[];
  setAiKeys: (value: AiKeyItem[]) => void;
  backendConfig: DesktopBackendConfig;
  setBackendConfig: (value: DesktopBackendConfig) => DesktopBackendConfig;
  resetBackendConfig: () => DesktopBackendConfig;
  desktopUpdateState: DesktopUpdateState;
  checkDesktopUpdate: () => Promise<void>;
  installDesktopUpdate: () => Promise<void>;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: (options?: BlenderBridgeEnsureOptions) => Promise<BlenderBridgeEnsureResult>;
}

// 描述：声明路由可见性能力，供布局层与侧边栏共享同一套判断。
export interface RouteAccess {
  enabledModules: Set<DesktopRouteModuleKey>;
  isModuleEnabled: (moduleKey: DesktopRouteModuleKey) => boolean;
  isAgentEnabled: (agentKey: AgentKey) => boolean;
}
