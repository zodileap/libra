import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供会话等待队列与抢占执行回归测试复用。
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

test("TestSessionPromptQueueShouldPersistQueuedPromptsWithExecutionSnapshots", () => {
  const dataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 当前会话运行态快照应持久化等待队列与冻结执行快照，避免刷新后丢失排队项或错用最新策略。
  assert.match(dataSource, /export interface SessionQueuedPromptExecutionSelectionSnapshot \{/);
  assert.match(dataSource, /export interface SessionQueuedPromptExecutionSnapshot \{/);
  assert.match(dataSource, /export interface SessionQueuedPromptItem \{/);
  assert.match(dataSource, /status: "queued" \| "preempting";/);
  assert.match(dataSource, /executionSnapshot: SessionQueuedPromptExecutionSnapshot;/);
  assert.match(dataSource, /queuedPrompts\?: SessionQueuedPromptItem\[\];/);
  assert.match(dataSource, /function normalizeQueuedPromptItems\(/);
  assert.match(dataSource, /function sanitizeQueuedPromptItemsForStorage\(/);
  assert.match(dataSource, /queuedPrompts: normalizeQueuedPromptItems\(item\.queuedPrompts\),/);
  assert.match(dataSource, /queuedPrompts: sanitizeQueuedPromptItemsForStorage\(input\.queuedPrompts \|\| \[\]\),/);
});

test("TestSessionPageShouldQueueEditReorderAndPreemptPrompts", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const styleSource = readDesktopSource("src/styles.css");
  const messagesSource = readDesktopSource("src/shared/i18n/messages.ts");

  // 描述：
  //
  //   - 会话页应维护等待队列状态、编辑态与冻结执行快照，并在发送中或阻断中把新输入转成队列项。
  assert.match(sessionSource, /const \[queuedPrompts, setQueuedPrompts\] = useState<SessionQueuedPromptItem\[\]>\(\[\]\);/);
  assert.match(sessionSource, /const \[editingQueuedPromptId, setEditingQueuedPromptId\] = useState\(""\);/);
  assert.match(sessionSource, /function buildQueuedPromptExecutionSelectionSnapshot\(/);
  assert.match(sessionSource, /function buildQueuedPromptExecutionSnapshot\(/);
  assert.match(sessionSource, /function buildQueuedPromptItem\(/);
  assert.match(sessionSource, /function resolveQueuedPromptExecuteOptions\(/);
  assert.match(sessionSource, /function markQueuedPromptItemPreempting\(/);
  assert.match(sessionSource, /function pickNextQueuedPromptItem\(/);
  assert.match(sessionSource, /function reorderQueuedPromptItems\(/);
  assert.match(sessionSource, /const hasPendingExecutionBlocker = /);
  assert.match(sessionSource, /const buildCurrentQueuedPromptSnapshot = useCallback\(\(\) => \{/);
  assert.match(sessionSource, /const enqueueQueuedPrompt = useCallback\(\([A-Za-z_][A-Za-z0-9_]*: string\) => \{/);
  assert.match(sessionSource, /setStatus\(t\("已加入等待队列"\)\);/);
  assert.match(sessionSource, /if \(editingQueuedPromptId\) \{\s*await handleCommitQueuedPromptEdit\(\);\s*return;\s*\}/s);
  assert.match(sessionSource, /if \(sending \|\| hasPendingExecutionBlocker\) \{\s*enqueueQueuedPrompt\(content\);\s*return;\s*\}/s);

  // 描述：
  //
  //   - 等待项应支持编辑、删除、置顶、上移、下移和立即开始；抢占时先取消当前执行，再优先启动目标队列项。
  assert.match(sessionSource, /const handleEditQueuedPrompt = useCallback\(\(queueItemId: string\) => \{/);
  assert.match(sessionSource, /setStatus\(t\("已载入等待项，修改后可更新"\)\);/);
  assert.match(sessionSource, /const handleCommitQueuedPromptEdit = useCallback\(async \(\) => \{/);
  assert.match(sessionSource, /setStatus\(t\("已更新等待项"\)\);/);
  assert.match(sessionSource, /const handleDeleteQueuedPrompt = useCallback\(\(queueItemId: string\) => \{/);
  assert.match(sessionSource, /setStatus\(t\("已删除等待项"\)\);/);
  assert.match(sessionSource, /const handleReorderQueuedPrompt = useCallback\(\(\s*queueItemId: string,\s*[A-Za-z_][A-Za-z0-9_]*: "top" \| "up" \| "down",?\s*\) => \{/s);
  assert.match(sessionSource, /setStatus\(t\("已调整等待顺序"\)\);/);
  assert.match(sessionSource, /const handleStartQueuedPromptNow = useCallback\(\(queueItemId: string\) => \{/);
  assert.match(sessionSource, /setQueuedPrompts\(\(prev\) => markQueuedPromptItemPreempting\(prev, normalizedQueueItemId\)\);/);
  assert.match(sessionSource, /setStatus\(t\("正在中断当前执行并切换"\)\);/);
  assert.match(sessionSource, /void handleCancelCurrentRun\(\);/);
  assert.match(sessionSource, /setQueuedPrompts\(\(prev\) => removeQueuedPromptItemById\(prev, normalizedQueueItemId\)\);/);
  assert.match(sessionSource, /setStatus\(t\("当前执行结束，开始处理等待项"\)\);/);
  assert.match(sessionSource, /const nextItem = pickNextQueuedPromptItem\(queuedPrompts\);/);

  // 描述：
  //
  //   - 真正启动等待项时必须复用入队快照，而不是界面当前的 AI / 工作流 / 技能选择。
  assert.match(sessionSource, /const resolveAiExecutionConfig = useCallback\(\(/);
  assert.match(sessionSource, /providerOverride\?: string;/);
  assert.match(sessionSource, /modelNameOverride\?: string;/);
  assert.match(sessionSource, /modeNameOverride\?: string;/);
  assert.match(sessionSource, /providerOverride: item\.executionSnapshot\.provider,/);
  assert.match(sessionSource, /modelNameOverride: item\.executionSnapshot\.modelName,/);
  assert.match(sessionSource, /modeNameOverride: item\.executionSnapshot\.modeName,/);
  assert.match(sessionSource, /const queueOptions = resolveQueuedPromptExecuteOptions\(item\);/);
  assert.match(sessionSource, /await executePromptDirect\(\s*normalizedPrompt,\s*queueOptions,\s*\);/s);

  // 描述：
  //
  //   - 队列 UI 应独立显示在输入区上方，并暴露状态、策略标签和操作按钮。
  assert.match(sessionSource, /className="desk-action-slot desk-action-slot-info desk-action-slot-queue"/);
  assert.match(sessionSource, /value=\{t\("等待队列"\)\}/);
  assert.match(sessionSource, /value=\{t\("共 \{\{count\}\} 项", \{ count: queuedPrompts\.length \}\)\}/);
  assert.match(sessionSource, /value=\{editingQueuedPrompt\s*\?\s*t\("正在编辑等待项"\)\s*:\s*t\("当前执行结束后会自动继续处理。"\)\}/s);
  assert.match(sessionSource, /emptyMessage=\{t\("当前暂无等待项"\)\}/);
  assert.match(sessionSource, /value=\{resolveQueuedPromptStrategyLabel\(item, workflows, availableSkills, t\)\}/);
  assert.match(sessionSource, /value=\{item\.status === "preempting" \? t\("即将开始"\) : t\("等待中"\)\}/);
  assert.match(sessionSource, /label=\{t\("立即开始"\)\}/);
  assert.match(sessionSource, /label=\{t\("编辑"\)\}/);
  assert.match(sessionSource, /aria-label=\{t\("置顶"\)\}/);
  assert.match(sessionSource, /aria-label=\{t\("上移"\)\}/);
  assert.match(sessionSource, /aria-label=\{t\("下移"\)\}/);
  assert.match(sessionSource, /aria-label=\{t\("删除等待项"\)\}/);

  // 描述：
  //
  //   - 输入区主按钮应支持发送、更新等待项和取消当前执行三态语义。
  assert.match(sessionSource, /const promptPrimaryActionIcon = editingQueuedPrompt \? "check" : sending \? "pause" : "arrow_upward";/);
  assert.match(sessionSource, /const promptPrimaryActionAriaLabel = editingQueuedPrompt\s*\?\s*t\("更新等待项"\)\s*:\s*sending\s*\?\s*t\("取消当前执行"\)\s*:\s*t\("发送"\);/s);
  assert.match(sessionSource, /if \(editingQueuedPromptId\) \{\s*void handleCommitQueuedPromptEdit\(\);\s*return;\s*\}\s*if \(sending\) \{\s*void handleCancelCurrentRun\(\);\s*return;\s*\}\s*void sendMessage\(\);/s);
  assert.match(sessionSource, /icon=\{promptPrimaryActionIcon\}/);
  assert.match(sessionSource, /aria-label=\{promptPrimaryActionAriaLabel\}/);

  // 描述：
  //
  //   - 样式与国际化词条必须补齐，确保等待队列在不同主题下稳定显示。
  assert.match(styleSource, /\.desk-action-slot-queue\s*\{/);
  assert.match(styleSource, /\.desk-session-queue-head\s*\{/);
  assert.match(styleSource, /\.desk-session-queue-list\s*\{/);
  assert.match(styleSource, /\.desk-session-queue-item\s*\{/);
  assert.match(styleSource, /\.desk-session-queue-item\.is-preempting\s*\{/);
  assert.match(styleSource, /\.desk-session-queue-item\.is-editing\s*\{/);
  assert.match(styleSource, /\.desk-session-queue-item-status-preempting\s*\{/);
  assert.match(styleSource, /\.desk-session-queue-item-actions\s*\{/);
  assert.match(messagesSource, /"等待队列": "等待队列"/);
  assert.match(messagesSource, /"等待队列": "Queued prompts"/);
  assert.match(messagesSource, /"已加入等待队列": "Added to the queue"/);
  assert.match(messagesSource, /"已更新等待项": "Queued item updated"/);
  assert.match(messagesSource, /"已删除等待项": "Queued item deleted"/);
  assert.match(messagesSource, /"已调整等待顺序": "Queue order updated"/);
  assert.match(messagesSource, /"正在中断当前执行并切换": "Cancelling the current run and switching"/);
  assert.match(messagesSource, /"当前执行结束，开始处理等待项": "Current run finished\. Starting the queued item\."/);
  assert.match(messagesSource, /"普通对话": "Plain chat"/);
  assert.match(messagesSource, /"工作流：\{\{workflow\}\}": "Workflow: \{\{workflow\}\}"/);
  assert.match(messagesSource, /"技能：\{\{skill\}\}": "Skill: \{\{skill\}\}"/);
});
