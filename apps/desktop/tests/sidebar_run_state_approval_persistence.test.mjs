import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，供侧边栏运行态回归测试复用。
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

test("TestSidebarRunStateShouldPreserveApprovalAcrossNavigation", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const sharedDataSource = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 会话运行片段结构必须支持透传 data，保证 approval_id/tool_args 可持久化恢复。
  assert.match(sharedDataSource, /data\?: Record<string, unknown>;/);
  assert.match(sharedDataSource, /sessionApprovedToolNames\?: string\[\];/);
  assert.match(sharedDataSource, /workflowPhaseCursor\?: SessionWorkflowPhaseCursorSnapshot \| null;/);

  // 描述：
  //
  //   - 侧边栏流式映射应过滤 started\/llm 阶段废话，避免恢复时污染执行流。
  assert.match(sidebarSource, /if \(payload\.kind === STREAM_KINDS\.STARTED\) \{\s*return null;\s*\}/s);
  assert.match(sidebarSource, /if \(payload\.kind === STREAM_KINDS\.LLM_STARTED\) \{\s*return null;\s*\}/s);
  assert.match(sidebarSource, /if \(payload\.kind === STREAM_KINDS\.LLM_FINISHED\) \{\s*return null;\s*\}/s);

  // 描述：
  //
  //   - 侧边栏应保留 require_approval 片段与关键 data，确保切页返回后仍可审批。
  assert.match(sidebarSource, /if \(payload\.kind === STREAM_KINDS\.REQUIRE_APPROVAL\) \{/);
  assert.match(sidebarSource, /intro: t\("需要人工授权"\)/);
  assert.match(sidebarSource, /const approvalToolName = String\(data\.tool_name \|\| ""\)\.trim\(\) \|\| t\("高危操作"\);/);
  assert.match(sidebarSource, /step: t\("正在请求执行 \{\{tool\}\}", \{ tool: approvalToolName \}\)/);
  assert.match(sidebarSource, /buildApprovalSegmentData\(payload\)/);
  assert.match(sidebarSource, /const APPROVAL_TOOL_ARGS_PREVIEW_MAX_CHARS = 2000;/);

  // 描述：
  //
  //   - 待审批期间应忽略心跳覆盖，并且仅在工具完成\/终态事件后才结束审批片段。
  assert.match(sidebarSource, /if \(hasPendingApproval && incomingSegmentKind === STREAM_KINDS\.HEARTBEAT\) \{\s*return current;\s*\}/s);
  assert.match(sidebarSource, /if \(!isApprovalPendingSegment\(item\)\) \{\s*return \{ \.\.\.item, status: "finished" as const \};\s*\}/s);
  assert.match(sidebarSource, /if \(!shouldResolveApprovalPending\) \{\s*return item;\s*\}/s);
  assert.match(sidebarSource, /incomingSegmentKind === STREAM_KINDS\.TOOL_CALL_FINISHED/);
  assert.match(sidebarSource, /incomingErrorCode === "core\.agent\.human_refused"/);
  assert.match(sidebarSource, /step: t\("已拒绝 \{\{tool\}\} 的执行请求。", \{ tool: toolName \|\| t\("该工具"\) \}\)/);
  assert.match(sidebarSource, /__step_type: "approval_decision"/);
  assert.match(sidebarSource, /approval_decision: "rejected"/);
  assert.match(sidebarSource, /approval_decision: "handled"/);

  // 描述：
  //
  //   - 持久化层应对 runMeta 做体积收敛，防止授权参数过大阻塞前端。
  assert.match(sharedDataSource, /function sanitizeRunMetaMapForStorage\(/);
  assert.match(sharedDataSource, /function sanitizeRunSegmentDataForStorage\(/);
  assert.match(sharedDataSource, /RUN_STATE_TOOL_ARGS_MAX_CHARS = 2000/);
  assert.match(sharedDataSource, /if \(typeof data\.__segment_role === "string"\) \{\s*next\.__segment_role = truncateRunStateText\(data\.__segment_role, 80\);\s*\}/s);
  assert.match(sharedDataSource, /if \(typeof data\.__step_type === "string"\) \{\s*next\.__step_type = truncateRunStateText\(data\.__step_type, 80\);\s*\}/s);
  assert.match(sharedDataSource, /if \(typeof data\.browse_detail === "string"\) \{\s*next\.browse_detail = truncateRunStateText\(data\.browse_detail, RUN_STATE_DETAIL_MAX_CHARS\);\s*\}/s);
  assert.match(sharedDataSource, /if \(Number\.isFinite\(Number\(data\.browse_file_delta\)\)\) \{\s*next\.browse_file_delta = Math\.max\(0, Math\.floor\(Number\(data\.browse_file_delta\)\)\);\s*\}/s);
  assert.match(sharedDataSource, /if \(Number\.isFinite\(Number\(data\.browse_search_delta\)\)\) \{\s*next\.browse_search_delta = Math\.max\(0, Math\.floor\(Number\(data\.browse_search_delta\)\)\);\s*\}/s);
  assert.match(sharedDataSource, /sessionApprovedToolNames: Array\.from\(new Set\(/);
  assert.match(sharedDataSource, /workflowPhaseCursor: input\.workflowPhaseCursor && typeof input\.workflowPhaseCursor === "object"/);
  assert.match(sharedDataSource, /workflowPhaseCursor: item\.workflowPhaseCursor && typeof item\.workflowPhaseCursor === "object"/);
});
