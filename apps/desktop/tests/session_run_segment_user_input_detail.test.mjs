import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供运行片段用户提问详情回归测试复用。
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

test("TestRunSegmentShouldRenderStructuredUserInputMetaAndDetail", () => {
  const runSegmentSource = readDesktopSource("src/widgets/session/run-segment.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 运行片段 rich meta 应把 user_input 归类为结构化状态，而不是普通 Markdown 正文。
  assert.match(runSegmentSource, /type: "user_input";/);
  assert.match(runSegmentSource, /if \(stepType === "user_input_request"\) \{/);
  assert.match(runSegmentSource, /label: segment\.status === "running"\s*\?\s*translateDesktopText\("正在询问"\)\s*:\s*translateDesktopText\("已询问"\)/s);
  assert.match(runSegmentSource, /suffix: resolution === "ignored"\s*\?\s*translateDesktopText\(" \{\{count\}\} 个问题（已忽略）"/s);
  assert.match(runSegmentSource, /tone: segment\.status === "running"\s*\?\s*"pending"\s*:\s*resolution === "ignored"\s*\?\s*"ignored"\s*:\s*"answered"/s);

  // 描述：
  //
  //   - 步骤正文应渲染“已询问 xx 个问题”标签，展开后显示问题和回答，ignored 需有独立提示。
  assert.match(runSegmentSource, /titleTone: richMeta\.tone === "ignored" \? "muted" : "default"/);
  assert.match(runSegmentSource, /const userInputAnswerMap = new Map\(userInputAnswers\.map\(\(item\) => \[item\.question_id, item\]\)\);/);
  assert.match(runSegmentSource, /const detail = \(userInputQuestions\.length > 0 \|\| userInputAnswers\.length > 0\) \? \(/);
  assert.match(runSegmentSource, /className="desk-run-segment-detail desk-run-segment-detail-user-input"/);
  assert.match(runSegmentSource, /translateDesktopText\("本次提问已忽略，Agent 会按 ignored 结果继续处理。"\)/);
  assert.match(runSegmentSource, /translateDesktopText\("等待回答"\)/);
  assert.match(runSegmentSource, /translateDesktopText\("无回答"\)/);
  assert.match(runSegmentSource, /translateDesktopText\("自定义：\{\{value\}\}"/);
  assert.match(runSegmentSource, /translateDesktopText\("已选：\{\{label\}\}"/);
  assert.match(runSegmentSource, /translateDesktopText\("问题 \{\{index\}\}"/);
  assert.match(runSegmentSource, /translateDesktopText\("回答：\{\{answer\}\}"/);
  assert.match(runSegmentSource, /className="desk-run-segment-detail-shell"/);
  assert.match(runSegmentSource, /<AriContainer className="desk-run-segment" padding=\{0\}>/);
  assert.match(runSegmentSource, /<AriContainer[\s\S]*className="desk-run-segment-detail-row"[\s\S]*role="button"[\s\S]*tabIndex=\{0\}[\s\S]*padding=\{0\}/s);
  assert.doesNotMatch(runSegmentSource, /<button/);
  assert.doesNotMatch(runSegmentSource, /type="button"/);

  // 描述：
  //
  //   - 相关样式类必须存在，确保“已询问”标签和详情列表不会退回到普通文本布局。
  assert.match(styleSource, /\.desk-run-segment-detail-title\.is-muted \{/);
  assert.match(styleSource, /\.desk-run-segment \{[\s\S]*padding:\s*0;/);
  assert.match(styleSource, /\.desk-run-segment-detail-shell \{[\s\S]*padding-left:\s*var\(--z-inset\)\s*!important;/);
  assert.match(styleSource, /\.desk-run-segment-detail-row \{[\s\S]*cursor:\s*default;/);
  assert.match(styleSource, /\.desk-run-segment-detail-row\[data-expandable="true"\] \{[\s\S]*cursor:\s*pointer;/);
  assert.match(styleSource, /\.desk-run-segment-detail \{[\s\S]*min-width:\s*0;/);
  assert.match(styleSource, /\.desk-run-segment-detail-user-input/);
  assert.match(styleSource, /\.desk-run-user-input-detail-status/);
  assert.match(styleSource, /\.desk-run-user-input-detail-list/);
  assert.match(styleSource, /\.desk-run-user-input-detail-item/);
  assert.match(styleSource, /\.desk-run-user-input-detail-header/);
  assert.match(styleSource, /\.desk-run-user-input-detail-question/);
  assert.match(styleSource, /\.desk-run-user-input-detail-answer/);
});
