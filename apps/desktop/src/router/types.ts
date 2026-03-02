import type {
  AiKeyItem,
  AgentKey,
  AuthAvailableAgentItem,
  BlenderBridgeEnsureOptions,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  ColorThemeMode,
  LoginUser,
  ModelMcpCapabilities,
} from "../shared/types";

// 描述：声明桌面端可按运行时与构建时控制的路由模块键。
export type DesktopRouteModuleKey =
  | "settings"
  | "skill"
  | "agent"
  | "session"
  | "workflow";

// 描述：统一声明 App 内部认证与个性化状态，供路由层与页面层复用。
export interface AuthState {
  user: LoginUser | null;
  restoringAuth: boolean;
  availableAgents: AuthAvailableAgentItem[];
  login: (account: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  colorThemeMode: ColorThemeMode;
  setColorThemeMode: (value: ColorThemeMode) => void;
  modelMcpCapabilities: ModelMcpCapabilities;
  setModelMcpCapabilities: (value: ModelMcpCapabilities) => void;
  aiKeys: AiKeyItem[];
  setAiKeys: (value: AiKeyItem[]) => void;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: (options?: BlenderBridgeEnsureOptions) => Promise<BlenderBridgeEnsureResult>;
}

// 描述：声明路由可见性能力，供布局层与侧边栏共享同一套判断。
export interface RouteAccess {
  enabledModules: Set<DesktopRouteModuleKey>;
  isModuleEnabled: (moduleKey: DesktopRouteModuleKey) => boolean;
  isAgentEnabled: (agentKey: AgentKey) => boolean;
}
