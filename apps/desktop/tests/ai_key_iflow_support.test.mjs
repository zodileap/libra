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

  // 描述：
  //
  //   - 应用默认 AI Key 列表应补齐 iFlow 默认项，并自动回填默认模型名。
  assert.match(appSource, /if \(provider === "iflow"\) \{\s*return "iFlow API";\s*\}/s);
  assert.match(appSource, /function resolveAiProviderDefaultModel\(provider: AiKeyItem\["provider"\]\): string \{/);
  assert.match(appSource, /if \(provider === "iflow"\) \{\s*return "Qwen3-Coder";\s*\}/s);
  assert.match(appSource, /id: "iflow-default"/);
  assert.match(appSource, /provider: "iflow"/);
  assert.match(appSource, /providerLabel: resolveAiProviderLabel\("iflow"\)/);
  assert.match(appSource, /modelName: resolveAiProviderDefaultModel\("iflow"\)/);
  assert.match(appSource, /provider !== "codex" && provider !== "gemini" && provider !== "gemini-cli" && provider !== "iflow"/);

  // 描述：
  //
  //   - AI Key 页面应为 iFlow 额外展示模型名输入框，并复用国际化占位文案。
  assert.match(aiKeyPageSource, /function shouldRenderModelInput\(provider: AiKeyItem\["provider"\]\): boolean \{/);
  assert.match(aiKeyPageSource, /return provider === "iflow";/);
  assert.match(aiKeyPageSource, /onUpdateModelName: \(value: string\) => void;/);
  assert.match(aiKeyPageSource, /const showModelInput = shouldRenderModelInput\(item\.provider\);/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-input-stack"/);
  assert.match(aiKeyPageSource, /className="desk-ai-key-card-model-wrap"/);
  assert.match(aiKeyPageSource, /placeholder=\{t\("输入 \{\{providerLabel\}\} 模型名", \{ providerLabel: item\.providerLabel \}\)\}/);
  assert.match(aiKeyPageSource, /onUpdateModelName=\{\(next\) => patchItem\(item\.id, \{ modelName: next \}\)\}/);
  assert.match(messagesSource, /"输入 \{\{providerLabel\}\} 模型名": "输入 \{\{providerLabel\}\} 模型名"/);
  assert.match(messagesSource, /"输入 \{\{providerLabel\}\} 模型名": "Enter \{\{providerLabel\}\} model"/);

  // 描述：
  //
  //   - 会话执行时应把 iFlow 的 API Key 与模型名一并传给 Tauri 命令层。
  assert.match(sessionSource, /providerApiKey: provider === "codex" \|\| provider === "gemini-cli"/);
  assert.match(sessionSource, /providerModel: provider === "iflow"/);
  assert.match(sessionSource, /\? String\(selectedAi\?\.modelName \|\| ""\)\.trim\(\) \|\| undefined/);

  // 描述：
  //
  //   - Tauri 命令层与 core request 结构应接收 provider_api_key / provider_model，并继续透传给 agent。
  assert.match(tauriSource, /provider_api_key: Option<String>,/);
  assert.match(tauriSource, /provider_model: Option<String>,/);
  assert.match(tauriSource, /AgentRunRequest \{[\s\S]*provider_api_key,[\s\S]*provider_model,[\s\S]*\}/);

  // 描述：
  //
  //   - core LLM 网关应识别 iflow provider，并把运行时配置注入 Python workflow 调用。
  assert.match(llmSource, /pub struct LlmProviderConfig \{/);
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
});
