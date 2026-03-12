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
  const catalogSource = readDesktopSource("src/shared/ai-provider-catalog.ts");
  const aiKeyPageSource = readDesktopSource("src/modules/common/pages/ai-key-page.tsx");
  const styleSource = readDesktopSource("src/styles.css");
  const messagesSource = readDesktopSource("src/shared/i18n/messages.ts");
  const appSource = readDesktopSource("src/app.tsx");
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const dataSource = readDesktopSource("src/shared/data.ts");
  const tauriSource = readDesktopSource("src-tauri/src/main.rs");
  const llmSource = readDesktopSource("../../crates/core/agent/src/llm.rs");
  const geminiProviderSource = readDesktopSource("../../crates/core/agent/src/llm/providers/gemini/mod.rs");

  // 描述：
  //
  //   - Provider 类型应包含 gemini-cli，确保前端状态与存储具备类型支持。
  assert.match(sharedTypesSource, /export type AiProvider = [^;]*"gemini-cli"[^;]*;/);
  assert.match(catalogSource, /"gemini-cli": \[/);
  assert.match(catalogSource, /value: "gemini-3\.1-pro-preview"/);
  assert.match(catalogSource, /value: "gemini-2\.5-pro"/);
  assert.match(catalogSource, /value: "gemini-2\.5-flash"/);

  // 描述：
  //
  //   - AI Key 页面应将 gemini-cli 视为本地 CLI Provider，不展示 API Key 输入框，但应展示模型下拉框与主动检测按钮。
  //   - 页面标题继续挂到全局标题栏 slot。
  assert.match(aiKeyPageSource, /function isLocalCliProvider\(provider: AiKeyItem\["provider"\]\): boolean \{/);
  assert.match(aiKeyPageSource, /return isLocalCliAiProvider\(provider\);/);
  assert.match(aiKeyPageSource, /useDesktopHeaderSlot/);
  assert.match(aiKeyPageSource, /createPortal\(headerNode, headerSlotElement\)/);
  assert.match(aiKeyPageSource, /const headerNode = useMemo\(\(\) => \(/);
  assert.match(aiKeyPageSource, /<DeskPageHeader[\s\S]*mode="slot"/);
  assert.match(aiKeyPageSource, /interface LocalCliHealthResponse \{/);
  assert.match(aiKeyPageSource, /function resolveCliCheckCommand\(provider: AiKeyItem\["provider"\]\): string \| null \{/);
  assert.match(aiKeyPageSource, /function buildCliHealthFeedback\(/);
  assert.match(aiKeyPageSource, /function AiKeyProviderCard\(/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-list"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card"/);
  assert.match(aiKeyPageSource, /className=\{`desk-ai-key-card-body\$\{localCliProvider \? " is-cli" : " is-api"\}`\}[\s\S]*justify="flex-start"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-title-slot"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-model-slot"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-mode-slot"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-mode-group"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-fast-toggle"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-actions" align="center" justify="flex-start" space=\{8\}/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-toggle" align="center" justify="flex-start" space=\{8\}/);
  assert.match(aiKeyPageSource, /icon="fact_check"/);
  assert.match(aiKeyPageSource, /label=\{checking \? t\("检测中\.\.\."\) : t\("检测"\)\}/);
  assert.match(aiKeyPageSource, /const response = await invoke<LocalCliHealthResponse>\(command, \{\}\);/);
  assert.match(aiKeyPageSource, /icon="vpn_key"/);
  assert.match(aiKeyPageSource, /<AriSelect/);
  assert.match(aiKeyPageSource, /supportsAiProviderFastModeToggle/);
  assert.match(aiKeyPageSource, /value=\{t\("Fast 模式"\)\}/);
  assert.match(aiKeyPageSource, /placeholder=\{t\("选择 \{\{providerLabel\}\} 模型", \{ providerLabel: item\.providerLabel \}\)\}/);
  assert.match(aiKeyPageSource, /AriMessage\.success\(/);
  assert.match(aiKeyPageSource, /AriMessage\.warning\(/);
  assert.match(aiKeyPageSource, /AriMessage\.error\(/);
  assert.match(aiKeyPageSource, /icon="star"/);
  assert.doesNotMatch(aiKeyPageSource, /AriTag/);
  assert.doesNotMatch(aiKeyPageSource, /DeskSettingsRow/);
  assert.match(styleSource, /\.desk-ai-key-list/);
  assert.match(styleSource, /\.desk-ai-key-card/);
  assert.match(styleSource, /\.desk-ai-key-card-body/);
  assert.match(styleSource, /\.desk-ai-key-card-primary/);
  assert.match(styleSource, /--desk-ai-key-card-title-width:/);
  assert.match(styleSource, /--desk-ai-key-card-actions-width:/);
  assert.match(styleSource, /--desk-ai-key-card-mode-group-width:/);
  assert.match(styleSource, /grid-template-columns: minmax\(0, 1fr\) var\(--desk-ai-key-card-actions-width\);/);
  assert.match(styleSource, /grid-template-columns:\s*minmax\(0, var\(--desk-ai-key-card-title-width\)\)\s*minmax\(0, var\(--desk-ai-key-card-model-max-width\)\)\s*minmax\(0, var\(--desk-ai-key-card-mode-group-width\)\);/);
  assert.match(styleSource, /\.desk-ai-key-card-mode-group/);
  assert.match(styleSource, /\.desk-ai-key-card-fast-toggle/);
  assert.match(styleSource, /\.desk-ai-key-card-actions/);
  assert.match(messagesSource, /"检测": "检测"/);
  assert.match(messagesSource, /"检测": "Check"/);
  assert.match(messagesSource, /"检测中\.\.\.": "检测中\.\.\."/);
  assert.match(messagesSource, /"检测中\.\.\.": "Checking\.\.\."/);
  assert.match(messagesSource, /"未检测到可用的 \{\{providerLabel\}\}，请先安装后再重试。"/);
  assert.match(messagesSource, /"\{\{providerLabel\}\} 检测失败，请稍后重试。"/);
  assert.match(messagesSource, /"设置 \{\{providerLabel\}\} Key": "设置 \{\{providerLabel\}\} Key"/);
  assert.match(messagesSource, /"设置 \{\{providerLabel\}\} Key": "Set \{\{providerLabel\}\} key"/);
  assert.match(messagesSource, /"保存 Key": "保存 Key"/);
  assert.match(messagesSource, /"保存 Key": "Save key"/);
  assert.match(messagesSource, /"Fast 模式": "Fast 模式"/);
  assert.match(messagesSource, /"Fast 模式": "Fast mode"/);

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
  assert.match(sessionSource, /function applySessionAiSelection\(/);
  assert.match(sessionSource, /rememberAgentSessionSelectedAiProvider\(sessionId, normalizedProvider\);/);
  assert.match(sessionSource, /if \(normalizedProvider && availableAiKeys\.some\(\(item\) => item\.provider === normalizedProvider\)\) \{\s*return;\s*\}/s);
  assert.match(sessionSource, /providerModel: supportsProviderModelConfig\(provider\)/);

  // 描述：
  //
  //   - Tauri 侧应暴露 Gemini CLI 健康检查命令，并注册到 invoke handler。
  assert.match(tauriSource, /struct GeminiCliHealthResponse \{/);
  assert.match(tauriSource, /async fn check_gemini_cli_health\(minimum_version: Option<String>\) -> GeminiCliHealthResponse/);
  assert.match(tauriSource, /fn check_gemini_cli_health_inner\(minimum_version: Option<String>\) -> GeminiCliHealthResponse/);
  assert.match(tauriSource, /check_gemini_cli_health,/);

  // 描述：
  //
  //   - core/agent 应将 Gemini provider 的 API Key 与模型透传给 CLI 命令，避免 Google Gemini 与 Gemini CLI 的下拉选择成为无效配置。
  assert.match(llmSource, /LlmProvider::Gemini => providers::gemini::call_with_retry\(/);
  assert.match(geminiProviderSource, /pub fn call_with_retry\([\s\S]*provider_config: Option<&LlmProviderConfig>,/);
  assert.match(geminiProviderSource, /command\.env\("GEMINI_API_KEY", api_key\);/);
  assert.match(geminiProviderSource, /command\.arg\("-m"\)\.arg\(model\);/);
});
