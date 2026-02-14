import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取 Desktop 样式文件内容，供样式规范测试复用。
//
// Returns:
//
//   - 样式文件完整文本。
function readDesktopStyles() {
  const stylePath = path.resolve(process.cwd(), "src/styles.css");
  return fs.readFileSync(stylePath, "utf8");
}

// 描述:
//
//   - 收集 Desktop 前端目录下所有 TSX 文件，用于扫描是否仍存在内联 style 对象。
//
// Returns:
//
//   - TSX 文件绝对路径列表。
function collectDesktopTsxFiles() {
  const root = path.resolve(process.cwd(), "src");
  const result = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".tsx")) {
        result.push(absolutePath);
      }
    }
  }

  return result;
}

test("TestDesktopStylesUseThemeTokensWithoutHardcodedVisualValues", () => {
  const css = readDesktopStyles();

  // 描述:
  //
  //   - 视觉样式值需通过设计变量管理，避免写死颜色与像素单位。
  const hardcodedHexRegex = /#[0-9a-fA-F]{3,8}\b/g;
  const hardcodedRgbaRegex = /\brgba?\(/g;
  const hardcodedPxRegex = /\b\d+px\b/g;

  assert.equal(hardcodedHexRegex.test(css), false, "styles.css 中仍存在十六进制硬编码颜色");
  assert.equal(hardcodedRgbaRegex.test(css), false, "styles.css 中仍存在 rgb/rgba 硬编码颜色");
  assert.equal(hardcodedPxRegex.test(css), false, "styles.css 中仍存在 px 硬编码尺寸");
});

test("TestDesktopTsxNoInlineStyleObject", () => {
  const tsxFiles = collectDesktopTsxFiles();
  const inlineStyleFiles = [];

  for (const file of tsxFiles) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes("style={{")) {
      inlineStyleFiles.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(
    inlineStyleFiles,
    [],
    `以下文件仍存在 style 内联对象: ${inlineStyleFiles.join(", ")}`
  );
});

test("TestDesktopTsxNoNativeSelectControl", () => {
  const tsxFiles = collectDesktopTsxFiles();
  const nativeSelectFiles = [];

  for (const file of tsxFiles) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes("<select")) {
      nativeSelectFiles.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(
    nativeSelectFiles,
    [],
    `以下文件仍存在原生 select 控件: ${nativeSelectFiles.join(", ")}`
  );
});

test("TestDesktopStylesContainsThemeAndLayoutStabilityRules", () => {
  const css = readDesktopStyles();

  // 描述:
  //
  //   - P0 视觉整改要求保留主题切换与关键布局稳定规则，避免会话页滚动抖动。
  const requiredTokens = [
    "html[data-color-theme=\"dark\"] body",
    ".desk-main",
    "scrollbar-gutter: stable",
    ".desk-session-thread-wrap",
    "overscroll-behavior: contain",
    ".desk-settings-row",
    ".desk-settings-row-actions",
    ".desk-settings-select",
  ];

  for (const token of requiredTokens) {
    assert.equal(
      css.includes(token),
      true,
      `styles.css 缺少关键规则: ${token}`
    );
  }
});
