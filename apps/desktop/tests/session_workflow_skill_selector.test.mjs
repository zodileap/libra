import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，用于会话“工作流/技能”选择弹窗回归测试。
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

test("TestSessionPageShouldProvideWorkflowAndSkillSelectorModal", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 会话页应加载已安装技能并支持本地持久化“工作流/技能”选择。
  assert.match(sessionSource, /listInstalledSkills/);
  assert.match(sessionSource, /MODEL_SKILL_SELECTED_KEY/);
  assert.match(sessionSource, /CODE_SKILL_SELECTED_KEY/);
  assert.match(sessionSource, /readSelectedSkillIds/);
  assert.match(sessionSource, /buildSessionSkillPrompt/);

  // 描述：
  //
  //   - 输入区应通过 AriSelect 完成 AI 选择与“工作流/技能”触发；点击后只打开弹窗，不走默认下拉展开。
  assert.match(sessionSource, /<AriSelect/);
  assert.match(sessionSource, /handleChangeProvider/);
  assert.match(sessionSource, /workflowSkillSelectOptions/);
  assert.match(sessionSource, /value="workflow_skill"/);
  assert.match(sessionSource, /openOnTriggerClick=\{false\}/);
  assert.match(sessionSource, /onTriggerClick=\{\(\) => \{/);
  assert.match(sessionSource, /handleOpenWorkflowSkillModal\(\);/);
  assert.match(sessionSource, /bordered=\{false\}/);
  assert.match(sessionSource, /className="desk-prompt-toolbar-select"/);
  assert.doesNotMatch(sessionSource, /placeholder="选择 AI"[\s\S]*?searchable/s);
  assert.doesNotMatch(sessionSource, /label=\{workflowSkillSelectorLabel\}/);
  assert.doesNotMatch(sessionSource, /onClick=\{handleOpenWorkflowSkillModal\}/);
  assert.match(sessionSource, /title="选择执行策略"/);
  assert.match(sessionSource, /value="工作流"/);
  assert.match(sessionSource, /value="技能"/);
  assert.match(sessionSource, /<AriList/);
  assert.match(sessionSource, /<AriListItem/);
  assert.match(sessionSource, /actions=\{\[/);
  assert.match(sessionSource, /extra=/);
  assert.doesNotMatch(sessionSource, /value="工作流\/技能"/);
  assert.match(sessionSource, /handleConfirmWorkflowSkillModal/);
  assert.match(sessionSource, /handleToggleDraftSkill/);
  assert.match(sessionSource, /return Array\.from\(new Set\(normalized\)\)\.slice\(0, 1\);/);
  assert.match(sessionSource, /if \(current\.includes\(skillId\)\) \{\s*return \[\];\s*\}/s);
  assert.match(sessionSource, /return \[skillId\];/);
  assert.match(sessionSource, /const nextSkillIds = draftSkillIds\.slice\(0, 1\);/);
  assert.match(sessionSource, /const initialStreamText = "";/);
  assert.match(sessionSource, /mapAgentTextStreamToRunSegment\(/);
  assert.match(sessionSource, /resolveAssistantRunStageByAgentTextStream\(/);
  assert.match(sessionSource, /buildAssistantHeartbeatSegment\([\s\S]*agentKind: "model" \| "code"/);
  assert.match(sessionSource, /步骤正在执行中，等待工具返回本步结果…/);
  assert.match(sessionSource, /setAssistantRunMetaMap\(normalizedRunMetaMap\);/);
  assert.match(sessionSource, /const runSnapshot = getSessionRunState\(normalizedAgentKey, sessionId\);/);
  assert.match(sessionSource, /upsertSessionRunState\(\{/);
  assert.match(sessionSource, /removeSessionRunState\(normalizedAgentKey, sessionId\);/);
  assert.match(sessionSource, /const agentStreamSeenKeysRef = useRef<Set<string>>\(new Set\(\)\);/);
  assert.match(sessionSource, /finishAssistantRunMessage\(streamMessageId, "finished", response\.message\);/);
  assert.match(sessionSource, /if \(streamMessageIdRef\.current\) \{\s*setStreamingAssistantTarget\(`执行失败：\$\{reason\}`\);\s*finishAssistantRunMessage\(streamMessageIdRef\.current, "failed", `执行失败：\$\{reason\}`\);/s);
  assert.match(sessionSource, /if \(payload\.kind === STREAM_KINDS\.STARTED\) \{\s*setStreamingAssistantTarget\("正在准备执行\.\.\."\);/s);
  assert.match(sessionSource, /if \(payload\.kind === STREAM_KINDS\.LLM_STARTED\) \{\s*setStreamingAssistantTarget\("模型会话已开始，正在执行策略…"\);/s);
  assert.match(sessionSource, /if \(payload\.kind === STREAM_KINDS\.LLM_FINISHED\) \{/);
  assert.match(sessionSource, /buildCodeSessionContextPrompt\(/);
  assert.match(sessionSource, /if \(normalizedSkillIds\.length > 0\) \{\s*setDraftWorkflowId\(""\);\s*setDraftSkillIds\(normalizedSkillIds\);/s);
  assert.match(sessionSource, /setDraftWorkflowId\(item\.key\);\s*setDraftSkillIds\(\[\]\);/s);
  assert.match(sessionSource, /setDraftWorkflowId\(""\);/);
  assert.match(sessionSource, /if \(!nextWorkflowId && nextSkillIds\.length === 0\) \{/);
  assert.match(sessionSource, /content: "请选择一个执行策略。"/);
  assert.match(sessionSource, /\{uiHint \? \(/);
  assert.doesNotMatch(sessionSource, /\{uiHint \|\| compactActionSlotStatus \? \(/);
  assert.match(sessionSource, /handleCopyMessageContent/);
  assert.match(sessionSource, /handleRetryAssistantMessage/);
  assert.match(sessionSource, /handleEditUserMessage/);
  assert.match(sessionSource, /replaceAssistantMessageId\?: string/);
  assert.match(sessionSource, /const streamMessageId = String\(options\?\.replaceAssistantMessageId \|\| ""\)\.trim\(\)/);
  assert.match(sessionSource, /contextMessages\?: MessageItem\[\];/);
  assert.match(sessionSource, /const contextMessages = options\?\.contextMessages \|\| messages;/);
  assert.match(sessionSource, /function buildCodeSessionContextPrompt\(/);
  assert.match(sessionSource, /workspacePath\?: string/);
  assert.match(sessionSource, /路径：\$\{normalizedWorkspacePath\}/);
  assert.match(sessionSource, /buildCodeSessionContextPrompt\(\s*contextMessages,\s*normalizedContent,\s*String\(activeCodeWorkspace\?\.path \|\| ""\)\.trim\(\) \|\| undefined,\s*\)/s);
  assert.match(sessionSource, /workdir: String\(activeCodeWorkspace\?\.path \|\| ""\)\.trim\(\) \|\| undefined,/);
  assert.match(sessionSource, /function pruneAssistantRetryTail\(/);
  assert.match(sessionSource, /const prunedRetryTail = pruneAssistantRetryTail\(messages, assistantMessageIndex\);/);
  assert.match(sessionSource, /setMessages\(prunedRetryTail\.messages\);/);
  assert.match(sessionSource, /isGeminiProviderNotImplementedError/);
  assert.match(sessionSource, /setSelectedProvider\("codex"\);/);
  assert.match(sessionSource, /replaceAssistantMessageId: String\(assistantMessage\.id \|\| ""\)\.trim\(\) \|\| undefined,/);
  assert.match(sessionSource, /contextMessages: prunedRetryTail\.messages,/);
  assert.match(sessionSource, /className="desk-msg-hover-toolbar"/);
  assert.match(sessionSource, /content="编辑"/);
  assert.match(sessionSource, /content="重试"/);
  assert.match(sessionSource, /content="复制"/);
  assert.match(sessionSource, /icon="edit"/);
  assert.match(sessionSource, /icon="refresh"/);
  assert.match(sessionSource, /icon="content_copy"/);
  assert.match(sessionSource, /buildAssistantFailureSummary/);
  assert.match(sessionSource, /className="desk-msg-user-surface"/);
  assert.match(sessionSource, /className="desk-msg-assistant-surface"/);
  assert.match(sessionSource, /className="desk-run-failure-card"/);
  assert.match(sessionSource, /if \(nextSkillIds\.length > 0\) \{\s*setSelectedModelSkillIds\(nextSkillIds\);\s*setSelectedModelWorkflowId\(""\);/s);
  assert.match(sessionSource, /if \(nextSkillIds\.length > 0\) \{\s*setSelectedCodeSkillIds\(nextSkillIds\);\s*setSelectedCodeWorkflowId\(""\);/s);

  // 描述：
  //
  //   - 样式层应提供弹窗列表与选中态样式，确保与设计图一致的列表结构。
  assert.match(styleSource, /\.desk-session-strategy-modal-body/);
  assert.match(styleSource, /\.desk-session-strategy-list/);
  assert.match(styleSource, /\.desk-session-strategy-item/);
  assert.match(styleSource, /\.desk-session-strategy-item\.is-active/);
  assert.match(styleSource, /\.desk-prompt-toolbar-select/);
  assert.match(styleSource, /\.desk-msg-hover-toolbar/);
  assert.match(styleSource, /\.desk-msg\.assistant \.desk-msg-hover-toolbar/);
  assert.match(styleSource, /\.desk-msg:hover \.desk-msg-hover-toolbar/);
  assert.match(styleSource, /\.desk-msg-user-surface/);
  assert.match(styleSource, /\.desk-msg-assistant-surface/);
  assert.match(styleSource, /\.desk-run-failure-card/);
  assert.match(styleSource, /\.desk-run-summary-failed/);
});
