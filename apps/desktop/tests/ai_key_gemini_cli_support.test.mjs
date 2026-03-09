import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，验证 AI Key 对 Gemini CLI 的支持。
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

test("TestAiKeyShouldSupportGeminiCliProvider", () => {
  const sharedTypesSource = readDesktopSource("src/shared/types.ts");
  const aiKeyPageSource = readDesktopSource("src/modules/common/pages/ai-key-page.tsx");
  const appSource = readDesktopSource("src/app.tsx");
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");
  const tauriSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - Provider 类型应包含 gemini-cli，确保前端状态与存储具备类型支持。
  assert.match(sharedTypesSource, /export type AiProvider = "codex" \| "gemini" \| "gemini-cli";/);

  // 描述：
  //
  //   - AI Key 页面应将 gemini-cli 视为本地 CLI Provider，不展示 API Key 输入框。
  assert.match(aiKeyPageSource, /function isLocalCliProvider\(provider: AiKeyItem\["provider"\]\): boolean \{/);
  assert.match(aiKeyPageSource, /provider === "codex" \|\| provider === "gemini-cli"/);
  assert.match(aiKeyPageSource, /local-cli（无需 API Key）/);

  // 描述：
  //
  //   - 应用启动时应补齐 Gemini CLI 默认项，并在启用时执行健康检查。
  assert.match(appSource, /id: "gemini-cli-default"/);
  assert.match(appSource, /provider: "gemini-cli"/);
  assert.match(appSource, /providerLabel: resolveAiProviderLabel\("gemini-cli"\)/);
  assert.match(appSource, /item\.provider === "gemini-cli" && item\.enabled/);
  assert.match(appSource, /invoke<GeminiCliHealthResponse>\("check_gemini_cli_health", \{\}\)/);
  assert.match(sessionSource, /if \(provider === "codex" \|\| provider === "gemini-cli"\) \{\s*return item\.enabled;\s*\}/s);
  assert.match(dataSource, /selectedAiProviderBySessionId: Record<string, string>;/);
  assert.match(dataSource, /export function resolveAgentSessionSelectedAiProvider\(sessionId: string\): string \{/);
  assert.match(dataSource, /export function rememberAgentSessionSelectedAiProvider\(sessionId: string, provider: string\) \{/);
  assert.match(sessionSource, /const \[selectedProvider, setSelectedProvider\] = useState<string>\(\s*\(\) => resolveAgentSessionSelectedAiProvider\(sessionId\),\s*\)/s);
  assert.match(sessionSource, /setSelectedProvider\(resolveAgentSessionSelectedAiProvider\(sessionId\)\);/);
  assert.match(sessionSource, /rememberAgentSessionSelectedAiProvider\(sessionId, nextProvider\);/);
  assert.match(sessionSource, /if \(normalizedProvider && availableAiKeys\.some\(\(item\) => item\.provider === normalizedProvider\)\) \{\s*return;\s*\}/s);

  // 描述：
  //
  //   - Tauri 侧应暴露 Gemini CLI 健康检查命令，并注册到 invoke handler。
  assert.match(tauriSource, /struct GeminiCliHealthResponse \{/);
  assert.match(tauriSource, /async fn check_gemini_cli_health\(minimum_version: Option<String>\) -> GeminiCliHealthResponse/);
  assert.match(tauriSource, /fn check_gemini_cli_health_inner\(minimum_version: Option<String>\) -> GeminiCliHealthResponse/);
  assert.match(tauriSource, /check_gemini_cli_health,/);
});
