// 描述：声明前端运行时的环境变量类型，避免构建工具类型缺失导致的编译报错。
interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly VITE_APP_API_URL?: string;
  readonly VITE_APP_LOCAL_IMG_SRC?: string;
  readonly VITE_DESKTOP_ENABLED_MODULES?: string;
  readonly VITE_ACCOUNT_BASE_URL?: string;
  readonly VITE_RUNTIME_BASE_URL?: string;
  readonly VITE_AGENT_CODE_BASE_URL?: string;
  readonly VITE_AGENT_3D_BASE_URL?: string;
}

// 描述：声明 import.meta 的最小类型结构。
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// 描述：声明由 Vite 在构建阶段注入的模块白名单变量。
declare const __DESKTOP_ENABLED_MODULES__: string;
