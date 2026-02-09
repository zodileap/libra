import { defineConfig } from "vite";
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

export default defineConfig({
  plugins: [patchAriesDynamicImport(), react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  },
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@\//,
        replacement: "/Users/yoho/code/zodileap-agen/apps/desktop/src/"
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
});
