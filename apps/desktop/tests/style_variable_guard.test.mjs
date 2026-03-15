import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 收集目标目录下文件的绝对路径，供样式变量守卫测试统一扫描。
//
// Params:
//
//   - rootDir: 待扫描根目录。
//
// Returns:
//
//   - 目录内所有 CSS/TS/JS 源文件路径。
function collectSourceFiles(rootDir) {
  const result = [];
  const walk = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (/\.(css|tsx|ts|jsx|js)$/.test(entry.name)) {
        result.push(absolutePath);
      }
    }
  };
  walk(rootDir);
  return result;
}

// 描述：
//
//   - 从文本中提取 CSS 变量定义，统一规整为变量名集合。
//
// Params:
//
//   - sourceText: 待分析的文本内容。
//   - target: 输出集合。
function collectDefinedVariables(sourceText, target) {
  for (const match of sourceText.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
    target.add(match[1]);
  }
}

// 描述：
//
//   - 从文本中提取 `var(--token)` 形式的 CSS 变量引用，并记录来源文件，便于定位缺失变量。
//
// Params:
//
//   - sourceText: 待分析的文本内容。
//   - relativeFilePath: 相对仓库根目录的文件路径。
//   - target: 变量引用映射。
function collectUsedVariables(sourceText, relativeFilePath, target) {
  for (const match of sourceText.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
    const currentFiles = target.get(match[1]) || new Set();
    currentFiles.add(relativeFilePath);
    target.set(match[1], currentFiles);
  }
}

test("TestDesktopStyleVariablesShouldOnlyUseDefinedTokens", () => {
  const workspaceRoot = process.cwd();
  const desktopSourceRoot = path.resolve(workspaceRoot, "src");
  const desktopFiles = collectSourceFiles(desktopSourceRoot);
  const themeCssPath = path.resolve(workspaceRoot, "node_modules/@aries-kit/react/assets/style.css");

  const definedVariables = new Set();
  const usedVariables = new Map();

  for (const absoluteFilePath of desktopFiles) {
    const sourceText = fs.readFileSync(absoluteFilePath, "utf8");
    const relativeFilePath = path.relative(workspaceRoot, absoluteFilePath);
    collectDefinedVariables(sourceText, definedVariables);
    collectUsedVariables(sourceText, relativeFilePath, usedVariables);
  }

  const themeCssSource = fs.readFileSync(themeCssPath, "utf8");
  collectDefinedVariables(themeCssSource, definedVariables);

  const missingVariables = [...usedVariables.entries()]
    .filter(([variableName]) => !definedVariables.has(variableName))
    .map(([variableName, fileSet]) => ({
      variableName,
      files: [...fileSet].sort(),
    }))
    .sort((left, right) => left.variableName.localeCompare(right.variableName));

  assert.deepEqual(missingVariables, []);
});
