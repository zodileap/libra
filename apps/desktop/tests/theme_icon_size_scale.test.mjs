import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取 Desktop 应用根组件，用于校验 cssVars 中的全局图标尺寸阶梯配置。
//
// Returns:
//
//   - 应用根组件源码文本。
function readDesktopAppSource() {
  const sourcePath = path.resolve(process.cwd(), "src/app.tsx");
  return fs.readFileSync(sourcePath, "utf8");
}

test("TestDesktopThemeIconSizeShouldScaleUpOneStep", () => {
  const source = readDesktopAppSource();

  assert.equal(
    source.includes('"--z-icon-size-xs": "calc(var(--z-base-font-size) * 0.75)"'),
    true,
    "app.tsx 必须通过 cssVars 将 --z-icon-size-xs 上调至 0.75 倍"
  );
  assert.equal(
    source.includes('"--z-icon-size-sm": "calc(var(--z-base-font-size) * 1.125)"'),
    true,
    "app.tsx 必须通过 cssVars 将 --z-icon-size-sm 上调至 1.125 倍"
  );
  assert.equal(
    source.includes('"--z-icon-size": "calc(var(--z-base-font-size) * 1.5)"'),
    true,
    "app.tsx 必须通过 cssVars 将 --z-icon-size 上调至 1.5 倍"
  );
  assert.equal(
    source.includes('"--z-icon-size-lg": "calc(var(--z-base-font-size) * 2.25)"'),
    true,
    "app.tsx 必须通过 cssVars 将 --z-icon-size-lg 上调至 2.25 倍"
  );
  assert.equal(
    source.includes('"--z-icon-size-xl": "calc(var(--z-base-font-size) * 3)"'),
    true,
    "app.tsx 必须通过 cssVars 将 --z-icon-size-xl 上调至 3 倍"
  );
  assert.equal(
    source.includes('"--z-icon-size-xxl": "calc(var(--z-base-font-size) * 4.5)"'),
    true,
    "app.tsx 必须通过 cssVars 将 --z-icon-size-xxl 上调至 4.5 倍"
  );
});
