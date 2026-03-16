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

// 描述：
//
//   - 读取 Desktop 全局样式文件，校验标题栏覆盖模式下的布局安全区。
//
// Returns:
//
//   - 全局样式源码文本。
function readDesktopStyleSource() {
  const sourcePath = path.resolve(process.cwd(), "src/styles.css");
  return fs.readFileSync(sourcePath, "utf8");
}

// 描述:
//
//   - 读取 Desktop Tauri 主进程源码，校验 macOS 原生窗口材质选择。
//
// Returns:
//
//   - Tauri 主进程源码文本。
function readDesktopTauriMainSource() {
  const sourcePath = path.resolve(process.cwd(), "src-tauri/src/main.rs");
  return fs.readFileSync(sourcePath, "utf8");
}

// 描述:
//
//   - 读取 Desktop 应用根组件源码，校验主题模式与 Tauri 原生窗口主题同步逻辑。
//
// Returns:
//
//   - 应用根组件源码文本。
function readDesktopAppSource() {
  const sourcePath = path.resolve(process.cwd(), "src/app.tsx");
  return fs.readFileSync(sourcePath, "utf8");
}

test("TestDesktopThemeOverrideShouldSetBorderRadiusToRem", () => {
  const source = readDesktopAppSource();
  assert.match(source, /cssVars:\s*\{/);
  assert.match(source, /"--z-border-radius": "1\.125rem"/);
  assert.match(source, /"--z-border-radius-container": "1\.125rem"/);
  assert.match(source, /"--z-color-bg-app-layout": "transparent"/);
  assert.match(source, /"--z-base-font-size": "14px"/);
});

test("TestDesktopMainShouldLoadThemeOverrideAfterAriesStyles", () => {
  const source = readDesktopMainSource();
  const indexTheme = source.indexOf('import "@aries-kit/react/theme/index.scss";');
  const indexStyle = source.indexOf('import "@aries-kit/react/style.css";');
  const indexAppStyles = source.indexOf('import "./styles.css";');

  assert.equal(indexTheme >= 0, true, "main.tsx 缺少 @aries-kit/react 主题样式引入");
  assert.equal(indexStyle >= 0, true, "main.tsx 缺少 @aries-kit/react 编译样式引入");
  assert.equal(indexAppStyles >= 0, true, "main.tsx 缺少 desktop 全局样式引入");
  assert.equal(source.includes('import "./theme-overrides.css";'), false, "main.tsx 不应继续依赖 theme-overrides.css");
  assert.equal(
    indexAppStyles > indexTheme && indexAppStyles > indexStyle,
    true,
    "styles.css 必须在 @aries-kit/react 样式之后引入，确保页面覆盖规则生效"
  );
});

test("TestDesktopTauriWindowShouldEnableTransparent", () => {
  const configPath = path.resolve(process.cwd(), "src-tauri/tauri.conf.json");
  const configRaw = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(configRaw);
  const windows = config?.app?.windows ?? [];
  const mainWindow = windows.find((item) => item?.label === "main") ?? windows[0];

  assert.equal(config?.productName, "Libra", "tauri 打包产物名称必须固定为 Libra");
  assert.equal(Boolean(mainWindow), true, "tauri.conf.json 缺少 main 窗口配置");
  assert.equal(
    mainWindow?.transparent,
    true,
    "tauri 主窗口需启用 transparent，才能看到桌面透出效果"
  );
  assert.equal(
    mainWindow?.titleBarStyle,
    "Overlay",
    "tauri 主窗口需启用 Overlay 标题栏，才能将窗口按钮区域融合进应用"
  );
  assert.equal(
    mainWindow?.hiddenTitle,
    true,
    "tauri 主窗口需隐藏默认标题文本，避免与应用内容重复"
  );
});

test("TestDesktopShouldEnableMacOsTitlebarSafeInset", () => {
  const mainSource = readDesktopMainSource();
  const styleSource = readDesktopStyleSource();

  assert.match(
    mainSource,
    /document\.documentElement\.classList\.add\("desk-platform-macos"\)/,
    "main.tsx 需在 macOS 下标记平台类名，供标题栏覆盖布局生效"
  );
  assert.match(
    styleSource,
    /\.desk-platform-macos \.desk-app \{/,
    "styles.css 需定义 macOS 标题栏覆盖模式的安全区样式"
  );
  assert.match(
    styleSource,
    /padding-top:\s*env\(titlebar-area-height,\s*calc\(var\(--z-inset\)\s*\*\s*2\.25\)\);/,
    "macOS 标题栏覆盖模式需为应用内容预留顶部安全区"
  );
});

test("TestDesktopMacosStylesShouldKeepRoundedMainSurface", () => {
  const styleSource = readDesktopStyleSource();

  assert.match(
    styleSource,
    /\.desk-platform-macos\s+\.desk-main\s*\{[\s\S]*border-radius:\s*var\(--z-border-radius-container\)\s+0\s+0\s+var\(--z-border-radius-container\)\s*!important;[\s\S]*\}/,
    "macOS 主内容区需保留左侧圆角，避免透明窗口下主内容与侧栏拼接生硬"
  );
});

test("TestDesktopMacosWindowEffectShouldUseHudWindowMaterial", () => {
  const rustSource = readDesktopTauriMainSource();

  assert.match(
    rustSource,
    /effect\(Effect::HudWindow\)/,
    "macOS 主窗口应使用 HudWindow 原生材质，维持当前标题栏与半透明窗口的统一质感"
  );
  assert.doesNotMatch(
    rustSource,
    /effect\(Effect::Sidebar\)/,
    "macOS 主窗口不应继续使用 Sidebar 原生材质"
  );
  assert.doesNotMatch(
    rustSource,
    /effect\(Effect::WindowBackground\)/,
    "macOS 主窗口不应回退到 WindowBackground 原生材质"
  );
});

test("TestDesktopThemeModeShouldSyncNativeWindowTheme", () => {
  const appSource = readDesktopAppSource();

  assert.match(
    appSource,
    /import\s+\{\s*getCurrentWindow\s*\}\s+from\s+"@tauri-apps\/api\/window"/,
    "app.tsx 需引入 getCurrentWindow，才能同步原生窗口主题"
  );
  assert.match(
    appSource,
    /import\s+\{\s*invoke,\s*isTauri\s*\}\s+from\s+"@tauri-apps\/api\/core"/,
    "app.tsx 需引入 isTauri，避免浏览器预览环境误调用原生窗口 API"
  );
  assert.match(
    appSource,
    /async function syncDesktopWindowTheme\(colorThemeMode: ColorThemeMode\): Promise<void>/,
    "app.tsx 需定义原生窗口主题同步函数"
  );
  assert.match(
    appSource,
    /getCurrentWindow\(\)\.setTheme\(colorThemeMode === "system" \? null : colorThemeMode\)/,
    "app.tsx 需在浅色、深色与跟随系统模式间同步切换原生窗口主题"
  );
  assert.match(
    appSource,
    /if \(colorThemeMode === "system"\) \{[\s\S]*matchMedia\("\(prefers-color-scheme: dark\)"\)[\s\S]*addEventListener\("change", handleChange\)/,
    "app.tsx 需在跟随系统模式下监听系统主题变化"
  );
});
