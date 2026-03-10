import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";

const desktopSrcDir = normalizePath(fileURLToPath(new URL("./src/", import.meta.url)));
// 描述：
//
//   - 标记 `@aries-kit/react` 在 `node_modules` 中的路径片段，供动态导入补丁识别发布包产物。
const ariesKitReactPackageSegment = "/@aries-kit/react/";

// 描述：
//
//   - 统一将文件路径转换为 POSIX 斜杠，避免 Windows 和 pnpm 虚拟目录下的路径匹配失效。
function normalizePath(value: string) {
  return value.replace(/\\/g, "/");
}

// 描述：
//
//   - 为 `@aries-kit/react` 产物中的动态导入补上 `@vite-ignore`，兼容 Tauri `FileAccess.asBrowserUri`
//     生成的运行时脚本地址，避免构建期被 Vite 误改写。
function patchAriesDynamicImport() {
  return {
    name: "patch-aries-kit-react-dynamic-import",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const normalizedId = normalizePath(id);

      if (!normalizedId.includes(ariesKitReactPackageSegment) || !/\/index-[^/]+\.mjs$/.test(normalizedId)) {
        return null;
      }

      const target = "import(`${FileAccess.asBrowserUri(`${e}.js`).toString(!0)}`)";
      if (!code.includes(target) || code.includes("/* @vite-ignore */")) {
        return null;
      }

      return {
        code: code.replaceAll(
          target,
          "import(/* @vite-ignore */ `${FileAccess.asBrowserUri(`${e}.js`).toString(!0)}`)"
        ),
        map: null,
      };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const enabledModulesRaw = env.VITE_DESKTOP_ENABLED_MODULES || "*";

  return {
    plugins: [patchAriesDynamicImport(), react()],
    clearScreen: false,
    define: {
      __DESKTOP_ENABLED_MODULES__: JSON.stringify(enabledModulesRaw),
    },
    server: {
      host: "127.0.0.1",
      port: 1420,
      strictPort: true,
      proxy: {
        "/__api/account": {
          target: "http://127.0.0.1:10001",
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/__api\/account/, ""),
        },
        "/__api/runtime": {
          target: "http://127.0.0.1:10001",
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/__api\/runtime/, ""),
        },
      },
    },
    envPrefix: ["VITE_", "TAURI_"],
    resolve: {
      dedupe: ["react", "react-dom", "react-router-dom"],
      alias: [
        {
          find: /^@\//,
          replacement: desktopSrcDir,
        },
      ],
    },
  };
});
