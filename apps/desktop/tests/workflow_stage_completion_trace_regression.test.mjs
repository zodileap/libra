import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供 workflow 阶段回归测试复用。
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

test("TestWorkflowStageCompletionTraceShouldRecordRawAndEffectiveControl", () => {
  const pageSource = readDesktopSource("src/widgets/session/page.tsx");
  const messagesSource = readDesktopSource("src/shared/i18n/messages.ts");

  // 描述：
  //
  //   - workflow 阶段完成态应单独写入 trace，明确记录原始 control、校验后的 effective control 与继续原因。
  //   - 这样当阶段被误判或被守门逻辑改写时，调试导出能直接看出是哪一层改写了控制流。
  assert.match(pageSource, /const responseControlLabel = responseControl === "done" \? t\("完成"\) : t\("继续"\);/);
  assert.match(pageSource, /const effectiveResponseControlLabel = effectiveResponseControl === "done" \? t\("完成"\) : t\("继续"\);/);
  assert.match(pageSource, /source: "workflow:stage_completion"/);
  assert.match(pageSource, /t\("阶段 \{\{current\}\}\/\{\{total\}\} 完成态：原始=\{\{raw\}\}，校验后=\{\{effective\}\}，原因=\{\{reason\}\}"/);
  assert.match(pageSource, /reason: completionDecision\.reason \|\| t\("无"\)/);
  assert.match(messagesSource, /"阶段 \{\{current\}\}\/\{\{total\}\} 完成态：原始=\{\{raw\}\}，校验后=\{\{effective\}\}，原因=\{\{reason\}\}": "Stage \{\{current\}\}\/\{\{total\}\} completion: raw=\{\{raw\}\}, effective=\{\{effective\}\}, reason=\{\{reason\}\}"/);
});
