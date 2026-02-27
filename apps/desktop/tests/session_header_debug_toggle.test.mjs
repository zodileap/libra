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
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const appSource = readDesktopSource("src/app.tsx");

  // 描述：
  //
  //   - 会话头部第二个 item 应提供调试窗口开关按钮，并以状态控制可见性与激活色。
  assert.match(sessionSource, /const \[debugFloatVisible, setDebugFloatVisible\] = useState\(false\);/);
  assert.match(sessionSource, /icon="bug_report"/);
  assert.match(sessionSource, /color=\{debugFloatVisible \? "primary" : "default"\}/);
  assert.match(sessionSource, /<DevDebugFloat visible=\{debugFloatVisible\} \/>/);

  // 描述：
  //
  //   - 调试浮窗不应继续在全局 App 层默认挂载。
  assert.doesNotMatch(appSource, /import \{ DevDebugFloat \} from "\.\/widgets\/dev-debug-float";/);
  assert.doesNotMatch(appSource, /<DevDebugFloat \/>/);
});
