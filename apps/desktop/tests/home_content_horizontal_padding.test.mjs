import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 样式源码，校验首页场景横向内边距是否统一使用变量。
//
// Returns:
//
//   - 样式文件源码文本。
function readStyleSource() {
  const sourcePath = path.resolve(process.cwd(), "src/styles.css");
  return fs.readFileSync(sourcePath, "utf8");
}

// 描述：
//
//   - 读取首页源码，校验标题容器是否接入统一横向内边距样式。
//
// Returns:
//
//   - 首页源码文本。
function readHomePageSource() {
  const sourcePath = path.resolve(process.cwd(), "src/modules/common/pages/home-page.tsx");
  return fs.readFileSync(sourcePath, "utf8");
}

test("TestHomeContentShouldUseUnifiedHorizontalPaddingVariable", () => {
  const styleSource = readStyleSource();
  const homePageSource = readHomePageSource();

  // 描述：
  //
  //   - 横向内边距变量应在 :root 定义，并在首页标题区与 desk-block 统一复用。
  assert.match(styleSource, /--desk-content-padding-x:\s*var\(--desk-layout-padding-x\);/);
  assert.match(styleSource, /\.desk-home-hero\s*\{[\s\S]*padding-left:\s*var\(--desk-content-padding-x\);/);
  assert.match(styleSource, /\.desk-home-hero\s*\{[\s\S]*padding-right:\s*var\(--desk-content-padding-x\);/);
  assert.match(styleSource, /\.desk-block\s*\{[\s\S]*padding-left:\s*var\(--desk-content-padding-x\);/);
  assert.match(styleSource, /\.desk-block\s*\{[\s\S]*padding-right:\s*var\(--desk-content-padding-x\);/);

  // 描述：
  //
  //   - 首页顶部标题容器应挂载 desk-home-hero 类名。
  assert.match(homePageSource, /className=\"desk-home-hero\"/);
});
