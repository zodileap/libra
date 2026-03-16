import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供会话运行环境上下文回归测试复用。
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

test("TestSessionPromptShouldInjectDesktopRuntimeContextForCommandSafety", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const promptUtilsSource = readDesktopSource("src/widgets/session/prompt-utils.ts");
  const serviceSource = readDesktopSource("src/modules/common/services/desktop-runtime.ts");
  const servicesIndexSource = readDesktopSource("src/modules/common/services/index.ts");
  const typesSource = readDesktopSource("src/shared/types.ts");
  const i18nSource = readDesktopSource("src/shared/i18n/messages.ts");

  // 描述：
  //
  //   - 共享类型与服务层应暴露统一的桌面运行时信息读取能力，并在 Tauri 不可用时回退到浏览器推断。
  assert.match(typesSource, /export interface DesktopRuntimeInfo \{/);
  assert.match(serviceSource, /interface DesktopRuntimeInfoResponse \{/);
  assert.match(serviceSource, /invoke<DesktopRuntimeInfoResponse>\(COMMANDS\.GET_DESKTOP_RUNTIME_INFO, \{\}\)/);
  assert.match(serviceSource, /navigator\.userAgent\.includes\("Windows"\)/);
  assert.match(serviceSource, /navigator\.userAgent\.includes\("Mac"\)/);
  assert.match(serviceSource, /navigator\.userAgent\.includes\("Linux"\)/);
  assert.match(servicesIndexSource, /export \* from "\.\/desktop-runtime";/);

  // 描述：
  //
  //   - prompt 工具层应把运行系统、架构和命令约束转换为上下文片段，明确区分 Windows/macOS/Linux 命令口径。
  assert.match(promptUtilsSource, /export function normalizeDesktopRuntimePlatform\(/);
  assert.match(promptUtilsSource, /export function buildDesktopRuntimePromptContextLines\(/);
  assert.match(promptUtilsSource, /translateDesktopText\("系统：\{\{system\}\}"/);
  assert.match(promptUtilsSource, /translateDesktopText\("架构：\{\{arch\}\}"/);
  assert.match(promptUtilsSource, /translateDesktopText\("命令约束：\{\{constraint\}\}"/);
  assert.match(promptUtilsSource, /Windows 可执行形式（PowerShell \/ cmd）/);
  assert.match(promptUtilsSource, /macOS 可执行形式（zsh \/ bash）/);
  assert.match(promptUtilsSource, /Linux 可执行形式（bash \/ sh）/);

  // 描述：
  //
  //   - 会话页应预读取桌面运行时信息，并在发送 prompt 与复制项目设置时同步带上系统约束。
  assert.match(sessionSource, /const \[desktopRuntimeInfo, setDesktopRuntimeInfo\] = useState<DesktopRuntimeInfo \| null>\(null\);/);
  assert.match(sessionSource, /const desktopRuntimeInfoRef = useRef<DesktopRuntimeInfo \| null>\(null\);/);
  assert.match(sessionSource, /void getDesktopRuntimeInfo\(\)\.then\(\(runtimeInfo\) => \{/);
  assert.match(sessionSource, /const runtimeInfo = desktopRuntimeInfoRef\.current \|\| await getDesktopRuntimeInfo\(\);/);
  assert.match(sessionSource, /resolveDesktopRuntimeSystemLabel\(runtimeInfo\)/);
  assert.match(sessionSource, /buildDesktopRuntimeCommandConstraint\(runtimeInfo\)/);
  assert.match(sessionSource, /t\("- 运行系统：\{\{system\}\}"/);
  assert.match(sessionSource, /t\("- 系统架构：\{\{arch\}\}"/);
  assert.match(sessionSource, /t\("- 命令约束：\{\{constraint\}\}"/);

  // 描述：
  //
  //   - 国际化词典应同步收录新增运行环境文案，避免导出文本和提示词出现裸字符串缺失。
  assert.match(i18nSource, /"系统：\{\{system\}\}": "系统：\{\{system\}\}"/);
  assert.match(i18nSource, /"架构：\{\{arch\}\}": "架构：\{\{arch\}\}"/);
  assert.match(i18nSource, /"- 运行系统：\{\{system\}\}": "- 运行系统：\{\{system\}\}"/);
  assert.match(i18nSource, /"- 系统架构：\{\{arch\}\}": "- 系统架构：\{\{arch\}\}"/);
  assert.match(i18nSource, /"- 命令约束：\{\{constraint\}\}": "- 命令约束：\{\{constraint\}\}"/);
});
