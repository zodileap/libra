import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取仓库内源码文件，验证 iFlow API 在 Desktop 与 core/agent 两侧的接入是否完整。
//
// Params:
//
//   - relativePath: 基于 `apps/desktop` 工作目录的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readWorkspaceSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestAiKeyShouldSupportIflowProvider", () => {
  const sharedTypesSource = readWorkspaceSource("src/shared/types.ts");
  const catalogSource = readWorkspaceSource("src/shared/ai-provider-catalog.ts");
  const appSource = readWorkspaceSource("src/app.tsx");
  const aiKeyPageSource = readWorkspaceSource("src/modules/common/pages/ai-key-page.tsx");
  const sessionSource = readWorkspaceSource("src/widgets/session/page.tsx");
  const messagesSource = readWorkspaceSource("src/shared/i18n/messages.ts");
  const tauriSource = readWorkspaceSource("src-tauri/src/main.rs");
  const llmSource = readWorkspaceSource("../../crates/core/agent/src/llm.rs");
  const iflowProviderSource = readWorkspaceSource("../../crates/core/agent/src/llm/providers/iflow.rs");
  const pythonOrchestratorSource = readWorkspaceSource("../../crates/core/agent/src/python_orchestrator.rs");

  // 描述：
  //
  //   - AI Provider 类型应显式包含 iflow，确保前端缓存与会话状态可以选择该 provider。
  assert.match(sharedTypesSource, /export type AiProvider = [^;]*"iflow"[^;]*;/);
  assert.match(sharedTypesSource, /modelName\?: string;/);
  assert.match(sharedTypesSource, /modeName\?: string;/);
  assert.match(catalogSource, /iflow: \[/);
  assert.match(catalogSource, /value: "Qwen3-Coder"/);
  assert.match(catalogSource, /value: "Kimi-K2"/);
  assert.match(catalogSource, /value: "GLM4\.5"/);

  // 描述：
  //
  //   - 应用默认 AI Key 列表应补齐 iFlow 默认项，并通过共享目录表回填默认模型名。
  assert.match(appSource, /function resolveAiProviderDefaultModel\(provider: AiKeyItem\["provider"\]\): string \{/);
  assert.match(appSource, /id: "iflow-default"/);
  assert.match(appSource, /provider: "iflow"/);
  assert.match(appSource, /providerLabel: resolveAiProviderLabel\("iflow"\)/);
  assert.match(appSource, /modelName: resolveAiProviderDefaultModel\("iflow"\)/);
  assert.match(appSource, /if \(!isAiProvider\(provider\)\) \{/);

  // 描述：
  //
  //   - AI Key 页面应为支持模型/模式的 Provider 展示下拉框；iFlow 仍通过共享目录表暴露官方模型列表。
  assert.match(aiKeyPageSource, /function shouldRenderModelInput\(provider: AiKeyItem\["provider"\]\): boolean \{/);
  assert.match(aiKeyPageSource, /return supportsAiProviderModelSelection\(provider\);/);
  assert.match(aiKeyPageSource, /function shouldRenderModeInput\(provider: AiKeyItem\["provider"\]\): boolean \{/);
  assert.match(aiKeyPageSource, /return supportsAiProviderModeSelection\(provider\);/);
  assert.match(aiKeyPageSource, /shared\/ai-provider-catalog/);
  assert.match(aiKeyPageSource, /resolveAiProviderModelOptions/);
  assert.match(aiKeyPageSource, /supportsAiProviderModelSelection/);
  assert.match(aiKeyPageSource, /supportsAiProviderModeSelection/);
  assert.match(aiKeyPageSource, /onUpdateModelName: \(value: string\) => void;/);
  assert.match(aiKeyPageSource, /onUpdateModeName: \(value: string\) => void;/);
  assert.match(aiKeyPageSource, /const showModelInput = shouldRenderModelInput\(item\.provider\);/);
  assert.match(aiKeyPageSource, /const showModeInput = shouldRenderModeInput\(item\.provider\);/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-title-slot"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-model-slot"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-mode-slot"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-model-wrap"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-mode-group"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-mode-wrap"/);
  assert.match(aiKeyPageSource, /<AriSelect/);
  assert.match(aiKeyPageSource, /placeholder=\{t\("选择 \{\{providerLabel\}\} 模型", \{ providerLabel: item\.providerLabel \}\)\}/);
  assert.match(aiKeyPageSource, /onUpdateModelName=\{\(next\) => patchItem\(item\.id, \{ modelName: next \}\)\}/);
  assert.match(aiKeyPageSource, /placeholder=\{t\("选择 \{\{providerLabel\}\} 模式", \{ providerLabel: item\.providerLabel \}\)\}/);
  assert.match(aiKeyPageSource, /onUpdateModeName=\{\(next\) => patchItem\(item\.id, \{/);
  assert.match(aiKeyPageSource, /composeAiProviderModeValue\(/);
  assert.match(messagesSource, /"选择 \{\{providerLabel\}\} 模型": "选择 \{\{providerLabel\}\} 模型"/);
  assert.match(messagesSource, /"选择 \{\{providerLabel\}\} 模型": "Select \{\{providerLabel\}\} model"/);
  assert.match(messagesSource, /"选择 \{\{providerLabel\}\} 模式": "选择 \{\{providerLabel\}\} 模式"/);
  assert.match(messagesSource, /"选择 \{\{providerLabel\}\} 模式": "Select \{\{providerLabel\}\} mode"/);

  // 描述：
  //
  //   - 会话执行时应把会话级模型/模式覆盖值传给 Tauri 命令层。
  assert.match(sessionSource, /providerApiKey: provider === "codex" \|\| provider === "gemini-cli"/);
  assert.match(sessionSource, /providerModel: supportsProviderModelConfig\(provider\)/);
  assert.match(sessionSource, /\? String\(selectedModelName \|\| ""\)\.trim\(\) \|\| undefined/);
  assert.match(sessionSource, /providerMode: supportsProviderModeConfig\(provider\)/);
  assert.match(sessionSource, /\? String\(selectedModeName \|\| ""\)\.trim\(\) \|\| undefined/);

  // 描述：
  //
  //   - Tauri 命令层与 core request 结构应接收 provider_api_key / provider_model / provider_mode，并继续透传给 agent。
  assert.match(tauriSource, /provider_api_key: Option<String>,/);
  assert.match(tauriSource, /provider_model: Option<String>,/);
  assert.match(tauriSource, /provider_mode: Option<String>,/);
  assert.match(tauriSource, /AgentRunRequest \{[\s\S]*provider_api_key,[\s\S]*provider_model,[\s\S]*provider_mode,[\s\S]*\}/);

  // 描述：
  //
  //   - core LLM 网关应识别 iflow provider，并把运行时配置注入 Python workflow 调用。
  assert.match(llmSource, /pub struct LlmProviderConfig \{/);
  assert.match(llmSource, /pub struct LlmProviderConfig \{[\s\S]*pub mode: Option<String>,[\s\S]*\}/);
  assert.match(llmSource, /pub enum LlmProvider \{[\s\S]*Iflow,[\s\S]*\}/);
  assert.match(llmSource, /"iflow" \| "iflow-api" => LlmProvider::Iflow,/);
  assert.match(llmSource, /LlmProvider::Iflow => providers::iflow::call_with_retry\(/);
  assert.match(iflowProviderSource, /const DEFAULT_IFLOW_BASE_URL: &str = "https:\/\/apis\.iflow\.cn\/v1";/);
  assert.match(iflowProviderSource, /const DEFAULT_IFLOW_MODEL: &str = "Qwen3-Coder";/);
  assert.match(iflowProviderSource, /"core\.agent\.llm\.iflow_api_key_missing"/);
  assert.match(iflowProviderSource, /"core\.agent\.llm\.iflow_failed"/);
  assert.match(pythonOrchestratorSource, /let provider_config = crate::llm::LlmProviderConfig \{/);
  assert.match(pythonOrchestratorSource, /api_key: request\.provider_api_key\.clone\(\),/);
  assert.match(pythonOrchestratorSource, /model: request\.provider_model\.clone\(\),/);
  assert.match(pythonOrchestratorSource, /mode: request\.provider_mode\.clone\(\),/);
});
