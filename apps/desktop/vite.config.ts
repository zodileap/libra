import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";

const desktopSrcDir = normalizePath(fileURLToPath(new URL("./src/", import.meta.url)));
const ariesReactRootDir = normalizePath(fileURLToPath(new URL("../../../client/aries_react/", import.meta.url)));
const ariesReactNodeModulesDir = `${ariesReactRootDir}/node_modules`;
const ariesReactDistDir = `${ariesReactRootDir}/dist`;

function normalizePath(value: string) {
  return value.replace(/\\/g, "/");
}

function patchAriesDynamicImport() {
  return {
    name: "patch-aries-react-dynamic-import",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const normalizedId = normalizePath(id);

      if (!normalizedId.includes(`${ariesReactDistDir}/index-`) || !normalizedId.endsWith(".mjs")) {
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
      dedupe: ["react", "react-dom"],
      alias: [
        {
          find: /^@\//,
          replacement: desktopSrcDir,
        },
        {
          find: /^react$/,
          replacement: `${ariesReactNodeModulesDir}/react/index.js`,
        },
        {
          find: /^react\/jsx-runtime$/,
          replacement: `${ariesReactNodeModulesDir}/react/jsx-runtime.js`,
        },
        {
          find: /^react\/jsx-dev-runtime$/,
          replacement: `${ariesReactNodeModulesDir}/react/jsx-dev-runtime.js`,
        },
        {
          find: /^react-dom$/,
          replacement: `${ariesReactNodeModulesDir}/react-dom/index.js`,
        },
        {
          find: /^react-dom\/client$/,
          replacement: `${ariesReactNodeModulesDir}/react-dom/client.js`,
        },
        {
          find: /^aries_react$/,
          replacement: `${ariesReactDistDir}/index.es.js`,
        },
        {
          find: /^aries_react\/theme\//,
          replacement: `${ariesReactDistDir}/theme/`,
        },
        {
          find: /^aries_react\/dist\//,
          replacement: `${ariesReactDistDir}/`,
        },
      ],
    },
  };
});
