import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件并返回 UTF-8 文本。
//
// Params:
//
//   - relativePath: 基于 apps/desktop 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readDesktopSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestSessionHeaderShouldToggleDevDebugFloatFromHeaderExtraItem", () => {
  const headerSource = readDesktopSource("src/widgets/app-header/index.tsx");
  const layoutSource = readDesktopSource("src/shell/layout.tsx");
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const appSource = readDesktopSource("src/app.tsx");

  // 描述：
  //
  //   - 全局标题栏应提供调试窗口开关按钮，并以状态控制可见性与激活色。
  assert.match(headerSource, /icon="bug_report"/);
  assert.match(headerSource, /color=\{debugFloatVisible \? "primary" : "default"\}/);
  assert.match(layoutSource, /const \[debugFloatVisible, setDebugFloatVisible\] = useState\(false\);/);
  assert.match(layoutSource, /<DevDebugFloat visible=\{debugFloatVisible\} \/>/);

  // 描述：
  //
  //   - 会话页不应再内置调试浮窗开关，由全局标题栏统一管理。
  assert.doesNotMatch(sessionSource, /icon="bug_report"/);
  assert.doesNotMatch(sessionSource, /<DevDebugFloat visible=\{debugFloatVisible\} \/>/);

  // 描述：
  //
  //   - 调试浮窗不应继续在全局 App 层默认挂载。
  assert.doesNotMatch(appSource, /import \{ DevDebugFloat \} from "\.\/widgets\/dev-debug-float";/);
  assert.doesNotMatch(appSource, /<DevDebugFloat \/>/);
});
