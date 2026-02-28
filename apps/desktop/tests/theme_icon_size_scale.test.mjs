import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取 Desktop 主题覆盖文件，用于校验全局图标尺寸阶梯配置。
//
// Returns:
//
//   - 主题覆盖样式源码文本。
function readThemeOverrideSource() {
  const sourcePath = path.resolve(process.cwd(), "src/theme-overrides.css");
  return fs.readFileSync(sourcePath, "utf8");
}

test("TestDesktopThemeIconSizeShouldScaleUpOneStep", () => {
  const css = readThemeOverrideSource();

  assert.equal(
    css.includes("--z-icon-size-xs: calc(var(--z-base-font-size) * 0.75);"),
    true,
    "theme-overrides.css 必须将 --z-icon-size-xs 上调至 0.75 倍"
  );
  assert.equal(
    css.includes("--z-icon-size-sm: calc(var(--z-base-font-size) * 1.125);"),
    true,
    "theme-overrides.css 必须将 --z-icon-size-sm 上调至 1.125 倍"
  );
  assert.equal(
    css.includes("--z-icon-size: calc(var(--z-base-font-size) * 1.5);"),
    true,
    "theme-overrides.css 必须将 --z-icon-size 上调至 1.5 倍"
  );
  assert.equal(
    css.includes("--z-icon-size-lg: calc(var(--z-base-font-size) * 2.25);"),
    true,
    "theme-overrides.css 必须将 --z-icon-size-lg 上调至 2.25 倍"
  );
  assert.equal(
    css.includes("--z-icon-size-xl: calc(var(--z-base-font-size) * 3);"),
    true,
    "theme-overrides.css 必须将 --z-icon-size-xl 上调至 3 倍"
  );
  assert.equal(
    css.includes("--z-icon-size-xxl: calc(var(--z-base-font-size) * 4.5);"),
    true,
    "theme-overrides.css 必须将 --z-icon-size-xxl 上调至 4.5 倍"
  );
});
