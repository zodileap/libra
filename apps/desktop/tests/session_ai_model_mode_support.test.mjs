import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 与 core/agent 相关源码，验证会话级 AI 模型/模式配置链路是否完整。
//
// Params:
//
//   - relativePath: 基于 `apps/desktop` 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readWorkspaceSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestSessionShouldSupportPerConversationAiModelAndMode", () => {
  const appSource = readWorkspaceSource("src/app.tsx");
  const catalogSource = readWorkspaceSource("src/shared/ai-provider-catalog.ts");
  const dataSource = readWorkspaceSource("src/shared/data.ts");
  const messagesSource = readWorkspaceSource("src/shared/i18n/messages.ts");
  const sessionSource = readWorkspaceSource("src/widgets/session/page.tsx");
  const styleSource = readWorkspaceSource("src/styles.css");
  const tauriSource = readWorkspaceSource("src-tauri/src/main.rs");
  const llmSource = readWorkspaceSource("../../crates/core/agent/src/llm.rs");
  const codexProviderSource = readWorkspaceSource("../../crates/core/agent/src/llm/providers/codex_cli/mod.rs");

  // 描述：
  //
  //   - App 默认 AI Key 配置应为所有 Provider 预留模型/模式字段，并通过共享目录表读取默认模式。
  assert.match(appSource, /function resolveAiProviderDefaultMode\(provider: AiKeyItem\["provider"\]\): string \{/);
  assert.match(appSource, /modeName: resolveAiProviderDefaultMode\("codex"\)/);
  assert.match(appSource, /const defaultModeName = resolveAiProviderDefaultMode\(provider\);/);
  assert.match(appSource, /const modeName = String\(\(item as \{ modeName\?: string \}\)\?\.modeName \|\| ""\)\.trim\(\) \|\| defaultModeName;/);
  assert.match(catalogSource, /codex: \[/);
  assert.match(catalogSource, /value: "gpt-5\.4"/);
  assert.match(catalogSource, /value: "gpt-5\.3-codex"/);
  assert.match(catalogSource, /value: "gpt-5\.3-codex-spark"/);
  assert.match(catalogSource, /value: "low"/);
  assert.match(catalogSource, /value: "xhigh"/);
  assert.match(catalogSource, /supportsAiProviderFastModeToggle\(provider: AiProvider\): boolean \{/);
  assert.match(catalogSource, /return provider === "codex";/);
  assert.match(catalogSource, /export function resolveAiProviderModeSelectValue\(/);
  assert.match(catalogSource, /export function resolveAiProviderFastModeEnabled\(/);
  assert.match(catalogSource, /export function composeAiProviderModeValue\(/);

  // 描述：
  //
  //   - 会话元数据层应持久化线程级模型与模式覆盖值，确保同一话题内的配置不会被全局默认反向污染。
  assert.match(dataSource, /selectedAiModelBySessionId: Record<string, string>;/);
  assert.match(dataSource, /selectedAiModeBySessionId: Record<string, string>;/);
  assert.match(dataSource, /cumulativeTokenUsageBySessionId: Record<string, number>;/);
  assert.match(dataSource, /export function resolveAgentSessionSelectedAiModel\(sessionId: string\): string \{/);
  assert.match(dataSource, /export function rememberAgentSessionSelectedAiModel\(sessionId: string, modelName: string\) \{/);
  assert.match(dataSource, /export function resolveAgentSessionSelectedAiMode\(sessionId: string\): string \{/);
  assert.match(dataSource, /export function rememberAgentSessionSelectedAiMode\(sessionId: string, modeName: string\) \{/);
  assert.match(dataSource, /export function resolveAgentSessionCumulativeTokenUsage\(sessionId: string\): number \{/);
  assert.match(dataSource, /export function increaseAgentSessionCumulativeTokenUsage\(sessionId: string, tokenDelta: number\): number \{/);

  // 描述：
  //
  //   - 会话页应直接提供 Provider / 模型 / 模式下拉，并把会话维护动作移出输入区。
  assert.match(sessionSource, /const \[selectedModelName, setSelectedModelName\] = useState<string>\(/);
  assert.match(sessionSource, /const \[selectedModeName, setSelectedModeName\] = useState<string>\(/);
  assert.match(sessionSource, /const \[sessionCumulativeTokenUsage, setSessionCumulativeTokenUsage\] = useState<number>\(/);
  assert.match(sessionSource, /function applySessionAiSelection\(/);
  assert.match(sessionSource, /rememberAgentSessionSelectedAiModel\(sessionId, nextModelName\);/);
  assert.match(sessionSource, /rememberAgentSessionSelectedAiMode\(sessionId, nextModeName\);/);
  assert.match(sessionSource, /const handleChangeModel = \(value: string \| number \| \(string \| number\)\[\] \| undefined\) => \{/);
  assert.match(sessionSource, /const handleChangeMode = \(value: string \| number \| \(string \| number\)\[\] \| undefined\) => \{/);
  assert.match(sessionSource, /resolveProviderModelSelectOptions\(/);
  assert.match(sessionSource, /resolveProviderModeSelectOptions\(/);
  assert.match(sessionSource, /placeholder=\{t\("选择 \{\{providerLabel\}\} 模型"/);
  assert.match(sessionSource, /placeholder=\{t\("选择 \{\{providerLabel\}\} 模式"/);
  assert.match(sessionSource, /className="desk-prompt-toolbar-select desk-prompt-toolbar-select-model"/);
  assert.match(sessionSource, /className="desk-prompt-toolbar-select desk-prompt-toolbar-select-mode"/);
  assert.match(sessionSource, /className="desk-session-token-usage"/);
  assert.match(sessionSource, /increaseAgentSessionCumulativeTokenUsage\(sessionId, responseTotalTokens\)/);
  assert.match(sessionSource, /providerMode: supportsProviderModeConfig\(provider\)/);
  assert.doesNotMatch(sessionSource, /sessionSettingsModalVisible/);
  assert.doesNotMatch(sessionSource, /title=\{t\("会话设置"\)\}/);
  assert.doesNotMatch(sessionSource, /icon="tune"/);
  assert.doesNotMatch(sessionSource, /const \[aiConfigModalVisible, setAiConfigModalVisible\] = useState\(false\);/);

  // 描述：
  //
  //   - 文案层应补齐累计 Token 与全局设置中的沙盒维护文案，避免输入区和设置页出现裸字符串。
  assert.match(messagesSource, /"AI 设置": "AI 设置"/);
  assert.match(messagesSource, /"AI 设置": "AI settings"/);
  assert.match(messagesSource, /"累计 Token": "累计 Token"/);
  assert.match(messagesSource, /"累计 Token": "Token total"/);
  assert.match(messagesSource, /"当前会话已累计使用 \{\{value\}\} tokens。": "当前会话已累计使用 \{\{value\}\} tokens。"/);
  assert.match(messagesSource, /"当前会话已累计使用 \{\{value\}\} tokens。": "This conversation has used \{\{value\}\} tokens so far\."/);
  assert.match(messagesSource, /"重置当前会话沙盒": "重置当前会话沙盒"/);
  assert.match(messagesSource, /"重置当前会话沙盒": "Reset conversation sandbox"/);
  assert.match(messagesSource, /"会话沙盒": "会话沙盒"/);
  assert.match(messagesSource, /"会话沙盒": "Conversation sandbox"/);
  assert.match(messagesSource, /"目标会话": "目标会话"/);
  assert.match(messagesSource, /"目标会话": "Target conversation"/);
  assert.match(messagesSource, /"模式（可选）": "模式（可选）"/);
  assert.match(messagesSource, /"模式（可选）": "Mode \(optional\)"/);
  assert.match(messagesSource, /"选择 \{\{providerLabel\}\} 模型": "选择 \{\{providerLabel\}\} 模型"/);
  assert.match(messagesSource, /"选择 \{\{providerLabel\}\} 模型": "Select \{\{providerLabel\}\} model"/);
  assert.match(messagesSource, /"选择 \{\{providerLabel\}\} 模式": "选择 \{\{providerLabel\}\} 模式"/);
  assert.match(messagesSource, /"选择 \{\{providerLabel\}\} 模式": "Select \{\{providerLabel\}\} mode"/);

  // 描述：
  //
  //   - 输入区的 AI 与工作流选择框应进一步收窄，避免会话工具栏占位过宽。
  assert.match(styleSource, /\.desk-prompt-toolbar-select-provider \{[\s\S]*min-width:\s*calc\(var\(--z-inset\) \* 9\);[\s\S]*max-width:\s*calc\(var\(--z-inset\) \* 11\);/);
  assert.match(styleSource, /\.desk-prompt-toolbar-select-model \{[\s\S]*min-width:\s*calc\(var\(--z-inset\) \* 10\);[\s\S]*max-width:\s*calc\(var\(--z-inset\) \* 12\);/);
  assert.match(styleSource, /\.desk-prompt-toolbar-select-mode \{[\s\S]*min-width:\s*calc\(var\(--z-inset\) \* 7\);[\s\S]*max-width:\s*calc\(var\(--z-inset\) \* 9\);/);
  assert.match(styleSource, /\.desk-prompt-toolbar-select-strategy \{[\s\S]*min-width:\s*calc\(var\(--z-inset\) \* 9\);[\s\S]*max-width:\s*calc\(var\(--z-inset\) \* 11\);/);

  // 描述：
  //
  //   - Tauri 与 core/agent 应继续把 provider_mode 向下透传到 LLM Provider 配置。
  assert.match(tauriSource, /provider_mode: Option<String>,/);
  assert.match(llmSource, /pub struct LlmProviderConfig \{[\s\S]*pub mode: Option<String>,[\s\S]*\}/);
  assert.match(codexProviderSource, /pub fn call_with_retry\([\s\S]*provider_config: Option<&LlmProviderConfig>,/);
  assert.match(codexProviderSource, /if let Some\(model\) = resolve_codex_model\(provider_config\) \{/);
  assert.match(codexProviderSource, /command\.arg\("-m"\)\.arg\(model\);/);
  assert.match(codexProviderSource, /let resolved_mode = resolve_codex_mode_selection\(provider_config\);/);
  assert.match(codexProviderSource, /if let Some\(service_tier\) = resolved_mode\.service_tier\.as_deref\(\) \{/);
  assert.match(codexProviderSource, /service_tier=\\"/);
  assert.match(codexProviderSource, /if let Some\(mode\) = resolved_mode\.reasoning_effort\.as_deref\(\) \{/);
  assert.match(codexProviderSource, /model_reasoning_effort=\\"/);
  assert.match(codexProviderSource, /fn should_map_fast_mode_to_priority_service_tier\(\)/);
  assert.match(codexProviderSource, /fn should_split_fast_reasoning_mode_into_service_tier_and_effort\(\)/);
});
