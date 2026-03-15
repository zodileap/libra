import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Description:
//
//   - Reads a source file under apps/desktop so the Windows window regression tests can assert source-level behavior.
//
// Params:
//
//   - relativePath: Path relative to apps/desktop.
//
// Returns:
//
//   - UTF-8 source text.
function readDesktopSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestDesktopWindowsPlatformClassShouldBeRegistered", () => {
  const mainSource = readDesktopSource("src/main.tsx");

  assert.match(
    mainSource,
    /navigator\.userAgent\.includes\("Windows"\)/,
    "main.tsx should detect the Windows platform"
  );
  assert.match(
    mainSource,
    /document\.documentElement\.classList\.add\("desk-platform-windows"\)/,
    "main.tsx should register the Windows platform class"
  );
});

test("TestDesktopWindowsStylesShouldKeepRootTransparentAndUseBlurTokens", () => {
  const styleSource = readDesktopSource("src/styles.css");

  assert.match(
    styleSource,
    /\.desk-platform-windows\s*\{[\s\S]*--desk-root-bg:\s*transparent;[\s\S]*\}/,
    "Windows styles should keep the root background transparent"
  );
  assert.match(
    styleSource,
    /\.desk-platform-windows\s*\{[\s\S]*--desk-sidebar-bg:\s*var\(--z-color-bg-opacity-blur\);[\s\S]*\}/,
    "Windows styles should reuse the blur token for the sidebar"
  );
  assert.doesNotMatch(
    styleSource,
    /\.desk-platform-windows\s*\{[^}]*--desk-main-bg:/,
    "Windows styles should not override the main panel background token"
  );
});

test("TestDesktopLayoutShouldDisableExtraShellShadowOnMainSurface", () => {
  const layoutSource = readDesktopSource("src/shell/layout.tsx");
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");

  assert.match(
    layoutSource,
    /className=\{`desk-app\$\{sidebarCollapsed \? " is-sidebar-collapsed" : ""\}`\}[\s\S]*showBorderRadius=\{false\}/,
    "desk-app should disable extra radius on the transparent window shell"
  );
  assert.match(
    layoutSource,
    /className="desk-app-sidebar-wrap"[\s\S]*padding=\{0\}[\s\S]*showBorderRadius=\{false\}/,
    "desk-app-sidebar-wrap should disable default container padding and extra radius on the transparent window shell"
  );
  assert.match(
    layoutSource,
    /className="desk-main"[\s\S]*shadowMode="never"[\s\S]*showBorderRadius=\{false\}/,
    "desk-main should disable extra component shadow and radius"
  );
  assert.match(
    sidebarSource,
    /className="desk-sidebar"[\s\S]*showBorderRadius=\{false\}/,
    "desk-sidebar should disable border radius so the right corners stay square on Windows"
  );
});

test("TestDesktopWindowsHeaderShouldProvideCustomWindowControls", () => {
  const headerSource = readDesktopSource("src/widgets/app-header/index.tsx");
  const i18nSource = readDesktopSource("src/shared/i18n/messages.ts");

  assert.match(
    headerSource,
    /import\s+\{\s*getCurrentWindow\s*\}\s+from\s+"@tauri-apps\/api\/window"/,
    "The custom Windows header should import getCurrentWindow"
  );
  assert.match(
    headerSource,
    /navigator\.userAgent\.includes\("Windows"\)/,
    "The header should render custom controls only on Windows"
  );
  assert.match(
    headerSource,
    /getCurrentWindow\(\)\.minimize\(\)/,
    "The custom header should expose a minimize action"
  );
  assert.match(
    headerSource,
    /getCurrentWindow\(\)\.toggleMaximize\(\)/,
    "The custom header should expose a maximize or restore action"
  );
  assert.match(
    headerSource,
    /getCurrentWindow\(\)\.close\(\)/,
    "The custom header should expose a close action"
  );
  assert.match(
    i18nSource,
    /"Minimize window":\s*"最小化窗口"/,
    "The dictionary should define the minimize window label"
  );
  assert.match(
    i18nSource,
    /"Maximize window":\s*"最大化窗口"/,
    "The dictionary should define the maximize window label"
  );
  assert.match(
    i18nSource,
    /"Restore window":\s*"还原窗口"/,
    "The dictionary should define the restore window label"
  );
  assert.match(
    i18nSource,
    /"Close window":\s*"关闭窗口"/,
    "The dictionary should define the close window label"
  );
});

test("TestDesktopWindowsEffectShouldDisableNativeShadowAndKeepEffectFallback", () => {
  const cargoSource = readDesktopSource("src-tauri/Cargo.toml");
  const rustSource = readDesktopSource("src-tauri/src/main.rs");

  assert.match(
    cargoSource,
    /\[target\.'cfg\(target_os = "windows"\)'\.dependencies\][\s\S]*windows-version\s*=\s*"0\.1\.7"/,
    "Cargo.toml should declare windows-version for the Windows material fallback"
  );
  assert.match(
    rustSource,
    /fn resolve_windows_main_window_effect\(\)\s*->\s*Effect/,
    "main.rs should define a Windows material selection helper"
  );
  assert.match(
    rustSource,
    /OsVersion::new\(10,\s*0,\s*0,\s*22000\)/,
    "main.rs should use Windows 11 build 22000 as the Mica threshold"
  );
  assert.match(
    rustSource,
    /Effect::Mica/,
    "main.rs should keep Mica on Windows 11"
  );
  assert.match(
    rustSource,
    /Effect::Acrylic/,
    "main.rs should keep Acrylic on older Windows versions"
  );
  assert.match(
    rustSource,
    /window\.set_decorations\(false\)/,
    "main.rs should disable native window decorations on Windows to remove the DWM outer shadow"
  );
  assert.match(
    rustSource,
    /window\.set_shadow\(false\)/,
    "main.rs should disable the undecorated window shadow on Windows"
  );
});
