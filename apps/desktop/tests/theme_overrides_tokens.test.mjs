import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取 Desktop 入口文件，校验样式引入顺序。
//
// Returns:
//
//   - 入口文件源码文本。
function readDesktopMainSource() {
  const sourcePath = path.resolve(process.cwd(), "src/main.tsx");
  return fs.readFileSync(sourcePath, "utf8");
}

// 描述:
//
//   - 读取 Desktop 主题覆盖样式文件，校验全局变量覆盖内容。
//
// Returns:
//
//   - 覆盖样式文件源码文本。
function readThemeOverrideSource() {
  const sourcePath = path.resolve(process.cwd(), "src/theme-overrides.css");
  return fs.readFileSync(sourcePath, "utf8");
}

test("TestDesktopThemeOverrideShouldSetBorderRadiusTo18Px", () => {
  const css = readThemeOverrideSource();
  assert.equal(
    css.includes("--z-border-radius: 18px;"),
    true,
    "theme-overrides.css 必须将 --z-border-radius 覆盖为 18px"
  );
});

test("TestDesktopMainShouldLoadThemeOverrideAfterAriesStyles", () => {
  const source = readDesktopMainSource();
  const indexTheme = source.indexOf('import "aries_react/theme/components/index.scss";');
  const indexStyle = source.indexOf('import "aries_react/dist/assets/style.css";');
  const indexOverride = source.indexOf('import "./theme-overrides.css";');

  assert.equal(indexTheme >= 0, true, "main.tsx 缺少 aries_react 主题组件样式引入");
  assert.equal(indexStyle >= 0, true, "main.tsx 缺少 aries_react 编译样式引入");
  assert.equal(indexOverride >= 0, true, "main.tsx 缺少 theme-overrides.css 引入");
  assert.equal(
    indexOverride > indexTheme && indexOverride > indexStyle,
    true,
    "theme-overrides.css 必须在 aries_react 样式之后引入，确保覆盖生效"
  );
});

test("TestDesktopTauriWindowShouldEnableTransparent", () => {
  const configPath = path.resolve(process.cwd(), "src-tauri/tauri.conf.json");
  const configRaw = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(configRaw);
  const windows = config?.app?.windows ?? [];
  const mainWindow = windows.find((item) => item?.label === "main") ?? windows[0];

  assert.equal(Boolean(mainWindow), true, "tauri.conf.json 缺少 main 窗口配置");
  assert.equal(
    mainWindow?.transparent,
    true,
    "tauri 主窗口需启用 transparent，才能看到桌面透出效果"
  );
});
