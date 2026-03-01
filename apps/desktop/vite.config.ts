import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";

function patchAriesDynamicImport() {
  return {
    name: "patch-aries-react-dynamic-import",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.includes("/client/aries_react/dist/index-") || !id.endsWith(".mjs")) {
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
        map: null
      };
    }
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
        rewrite: (path) => path.replace(/^\/__api\/account/, "")
      },
      "/__api/runtime": {
        target: "http://127.0.0.1:10002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__api\/runtime/, "")
      },
      "/__api/agent_code": {
        target: "http://127.0.0.1:10003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__api\/agent_code/, "")
      },
      "/__api/agent_3d": {
        target: "http://127.0.0.1:10004",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__api\/agent_3d/, "")
      }
    }
  },
    envPrefix: ["VITE_", "TAURI_"],
    resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@\//,
        replacement: "/Users/yoho/code/zodileap-agen/apps/desktop/src/"
      },
      // 描述：
      //
      //   - 强制所有 React 入口统一指向 aries_react 所在依赖目录，避免出现多份 React 导致 Invalid hook call。
      {
        find: /^react$/,
        replacement: "/Users/yoho/code/client/aries_react/node_modules/react/index.js"
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: "/Users/yoho/code/client/aries_react/node_modules/react/jsx-runtime.js"
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: "/Users/yoho/code/client/aries_react/node_modules/react/jsx-dev-runtime.js"
      },
      {
        find: /^react-dom$/,
        replacement: "/Users/yoho/code/client/aries_react/node_modules/react-dom/index.js"
      },
      {
        find: /^react-dom\/client$/,
        replacement: "/Users/yoho/code/client/aries_react/node_modules/react-dom/client.js"
      },
      {
        find: /^aries_react$/,
        replacement: "/Users/yoho/code/client/aries_react/dist/index.es.js"
      },
      {
        find: /^aries_react\/theme\//,
        replacement: "/Users/yoho/code/client/aries_react/dist/theme/"
      },
      {
        find: /^aries_react\/dist\//,
        replacement: "/Users/yoho/code/client/aries_react/dist/"
      }
    ]
    }
  };
});
