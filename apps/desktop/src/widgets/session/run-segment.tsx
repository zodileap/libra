import { AriCode, AriContainer, AriTypography } from "aries_react";
import type { KeyboardEvent as ReactKeyboardEvent, JSX } from "react";
import { translateDesktopText } from "../../shared/i18n";

// 描述：
//
//   - 定义执行片段状态类型，和会话页运行状态保持一致。
export type SessionRunSegmentStatus = "running" | "finished" | "failed";

// 描述：
//
//   - 定义执行步骤渲染所需的最小字段集合，避免渲染组件直接依赖会话页完整类型。
export interface SessionRunSegmentStep {
  key: string;
  status: SessionRunSegmentStatus;
  text: string;
  detail: string;
  data?: Record<string, unknown>;
}

// 描述：
//
//   - 定义“步骤富文本”结构化元数据，供执行流渲染高亮状态与操作信息。
export type SessionRunSegmentRichMeta = null | (
  {
    type: "edit";
    prefix: string;
    filePath: string;
    added: number;
    removed: number;
  } | {
    type: "browse";
    prefix: string;
    suffix: string;
  } | {
    type: "approval";
    leading: string;
    label: string;
    suffix: string;
    tone: "approved" | "rejected" | "neutral";
  }
);

// 描述：
//
//   - 定义执行片段展示组件入参，统一处理详情展开和文件路径点击复制。
interface SessionRunSegmentItemProps {
  segment: SessionRunSegmentStep;
  detailExpanded: boolean;
  onToggleDetail: () => void;
  onCopyFilePath: (filePath: string) => void | Promise<void>;
}

// 描述：
//
//   - 运行段模板捕获占位符；用于把国际化模板转换为可提取工具名的正则。
const RUN_SEGMENT_TEMPLATE_CAPTURE_TOKEN = "__RUN_SEGMENT_CAPTURE__";

// 描述：
//
//   - 将运行段匹配文本统一转为小写并裁剪首尾空白，保证中英文前缀比较稳定。
function normalizeRunSegmentMatchText(value: string): string {
  return String(value || "").trim().toLowerCase();
}

// 描述：
//
//   - 基于已翻译文本构建去重后的匹配词表，避免运行段解析继续散落硬编码字面量。
function buildRunSegmentLocalizedVariants(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((item) => normalizeRunSegmentMatchText(item))
        .filter((item) => item.length > 0),
    ),
  );
}

// 描述：
//
//   - 转义正则元字符，供国际化模板生成捕获表达式时复用。
function escapeRunSegmentRegExp(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 描述：
//
//   - 将中英文模板文本转换为统一的捕获正则，专门用于提取“{{tool}}”这类动态片段。
function buildRunSegmentTemplatePatterns(templates: string[]): RegExp[] {
  const escapedCaptureToken = escapeRunSegmentRegExp(RUN_SEGMENT_TEMPLATE_CAPTURE_TOKEN);
  return Array.from(
    new Set(
      templates
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  ).map((template) => new RegExp(
    `^${escapeRunSegmentRegExp(template).replace(escapedCaptureToken, "(.+?)")}$`,
    "u",
  ));
}

// 描述：
//
//   - 基于本地化前缀匹配步骤文本，并保留去前缀后的原始剩余内容。
function matchRunSegmentLocalizedPrefix(
  text: string,
  prefixes: readonly string[],
): { prefix: string; suffix: string } | null {
  const normalizedText = String(text || "").trim();
  const loweredText = normalizedText.toLowerCase();
  for (const prefix of prefixes) {
    const normalizedPrefix = String(prefix || "").trim();
    if (!normalizedPrefix) {
      continue;
    }
    const loweredPrefix = normalizedPrefix.toLowerCase();
    if (loweredText === loweredPrefix) {
      return {
        prefix: normalizedText,
        suffix: "",
      };
    }
    if (loweredText.startsWith(`${loweredPrefix} `)) {
      return {
        prefix: normalizedText.slice(0, normalizedPrefix.length).trim(),
        suffix: normalizedText.slice(normalizedPrefix.length).trim(),
      };
    }
  }
  return null;
}

// 描述：
//
//   - 用中英文模板正则提取动态值；未命中时返回空串，供老数据回放场景兜底。
function matchRunSegmentTemplateCapture(text: string, patterns: readonly RegExp[]): string {
  const normalizedText = String(text || "").trim();
  for (const pattern of patterns) {
    const matched = normalizedText.match(pattern);
    if (matched?.[1]) {
      return String(matched[1] || "").trim();
    }
  }
  return "";
}

// 描述：
//
//   - 运行段“脚本”语义关键词；中英文都命中时统一按代码块展示。
const RUN_SEGMENT_SCRIPT_HINT_KEYWORDS = buildRunSegmentLocalizedVariants([
  translateDesktopText("脚本", undefined, "zh-CN"),
  translateDesktopText("脚本", undefined, "en-US"),
]);

// 描述：
//
//   - “已编辑”步骤前缀集合，供编辑结果卡片在中英文回放时都能结构化解析。
const RUN_SEGMENT_EDIT_PREFIXES = buildRunSegmentLocalizedVariants([
  translateDesktopText("已编辑", undefined, "zh-CN"),
  translateDesktopText("已编辑", undefined, "en-US"),
]);

// 描述：
//
//   - “已浏览/正在浏览”步骤前缀集合，统一覆盖浏览态与完成态。
const RUN_SEGMENT_BROWSE_PREFIXES = buildRunSegmentLocalizedVariants([
  translateDesktopText("已浏览", undefined, "zh-CN"),
  translateDesktopText("已浏览", undefined, "en-US"),
  translateDesktopText("正在浏览", undefined, "zh-CN"),
  translateDesktopText("正在浏览", undefined, "en-US"),
]);

// 描述：
//
//   - 授权结果关键词集合，用于快速识别运行段是否属于批准/拒绝类状态。
const RUN_SEGMENT_APPROVAL_KEYWORDS = buildRunSegmentLocalizedVariants([
  translateDesktopText("已批准", undefined, "zh-CN"),
  translateDesktopText("已批准", undefined, "en-US"),
  translateDesktopText("已拒绝", undefined, "zh-CN"),
  translateDesktopText("已拒绝", undefined, "en-US"),
]);

// 描述：
//
//   - “已批准”标签前缀集合，供简单结果文案直接抽取工具名。
const RUN_SEGMENT_APPROVED_PREFIXES = buildRunSegmentLocalizedVariants([
  translateDesktopText("已批准", undefined, "zh-CN"),
  translateDesktopText("已批准", undefined, "en-US"),
]);

// 描述：
//
//   - “会话内已批准”模板集合；优先用于解析老数据中的自动放行授权文案。
const RUN_SEGMENT_SESSION_APPROVED_PATTERNS = buildRunSegmentTemplatePatterns([
  translateDesktopText("会话内已批准 {{tool}}，后续将自动放行。", {
    tool: RUN_SEGMENT_TEMPLATE_CAPTURE_TOKEN,
  }, "zh-CN"),
  translateDesktopText("会话内已批准 {{tool}}，后续将自动放行。", {
    tool: RUN_SEGMENT_TEMPLATE_CAPTURE_TOKEN,
  }, "en-US"),
]);

// 描述：
//
//   - “已批准本次执行”模板集合；用于兼容一次性批准的历史步骤文本。
const RUN_SEGMENT_APPROVED_ONCE_PATTERNS = buildRunSegmentTemplatePatterns([
  translateDesktopText("已批准本次执行 {{tool}}。", {
    tool: RUN_SEGMENT_TEMPLATE_CAPTURE_TOKEN,
  }, "zh-CN"),
  translateDesktopText("已批准本次执行 {{tool}}。", {
    tool: RUN_SEGMENT_TEMPLATE_CAPTURE_TOKEN,
  }, "en-US"),
]);

// 描述：
//
//   - “已拒绝执行请求”模板集合；供无结构化 data 的旧消息仍能正确高亮。
const RUN_SEGMENT_REJECTED_PATTERNS = buildRunSegmentTemplatePatterns([
  translateDesktopText("已拒绝 {{tool}} 的执行请求。", {
    tool: RUN_SEGMENT_TEMPLATE_CAPTURE_TOKEN,
  }, "zh-CN"),
  translateDesktopText("已拒绝 {{tool}} 的执行请求。", {
    tool: RUN_SEGMENT_TEMPLATE_CAPTURE_TOKEN,
  }, "en-US"),
]);

// 描述：
//
//   - 根据详情文本推断代码块语言，优先覆盖 Python/JSON/Diff，其他回退 text。
//
// Params:
//
//   - detailText: 详情文本。
//   - introText: 当前步骤说明。
//
// Returns:
//
//   - AriCode 使用的语言标记。
export function resolveRunSegmentDetailLanguage(detailText: string, introText = ""): string {
  const normalizedDetail = String(detailText || "").trim();
  if (!normalizedDetail) {
    return "text";
  }
  if (normalizedDetail.startsWith("{") || normalizedDetail.startsWith("[")) {
    return "json";
  }
  if (
    normalizedDetail.includes("\n@@ ")
    || normalizedDetail.startsWith("*** Begin Patch")
    || normalizedDetail.includes("\n+++ ")
  ) {
    return "diff";
  }
  const intro = String(introText || "").toLowerCase();
  if (
    RUN_SEGMENT_SCRIPT_HINT_KEYWORDS.some((keyword) => intro.includes(keyword))
    || normalizedDetail.includes("def ")
    || normalizedDetail.includes("import ")
    || normalizedDetail.includes("if __name__ ==")
  ) {
    return "python";
  }
  return "text";
}

// 描述：
//
//   - 根据详情文本行数估算 AriCode 容器高度，避免超短或过高代码块影响阅读。
//
// Params:
//
//   - detailText: 详情文本。
//
// Returns:
//
//   - 代码块高度（像素）。
export function resolveRunSegmentCodeHeight(detailText: string): number {
  const lineCount = Math.max(1, String(detailText || "").split("\n").length);
  return Math.min(420, Math.max(140, lineCount * 22));
}

// 描述：
//
//   - 根据文件路径后缀推断代码语言，优先用于“已编辑”步骤的文件预览。
//
// Params:
//
//   - filePath: 文件绝对路径或相对路径。
//
// Returns:
//
//   - AriCode 支持的语言字符串；无法识别时返回 text。
export function resolveRunSegmentCodeLanguageByPath(filePath: string): string {
  const normalizedPath = String(filePath || "").trim().toLowerCase();
  const extension = normalizedPath.includes(".")
    ? normalizedPath.slice(normalizedPath.lastIndexOf("."))
    : "";
  const extensionLanguageMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".json": "json",
    ".md": "markdown",
    ".markdown": "markdown",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".swift": "swift",
    ".kt": "kotlin",
    ".sql": "sql",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".sh": "bash",
    ".bash": "bash",
    ".yml": "yaml",
    ".yaml": "yaml",
  };
  return extensionLanguageMap[extension] || "text";
}

// 描述：
//
//   - 将 unified diff / patch 详情转换为“可读代码内容 + 差异行号”，避免预览内容被大量 +/- 前缀污染。
//
// Params:
//
//   - detailText: 原始 diff 文本。
//
// Returns:
//
//   - value: 去除 diff 元信息后的代码文本。
//   - diffLines: 对应 AriCode 的新增/删除行号。
export function resolveRunSegmentDiffPreview(detailText: string): {
  value: string;
  diffLines?: {
    added?: Array<number | { start: number; end: number }>;
    removed?: Array<number | { start: number; end: number }>;
  };
  customLineNumbers?: Array<number | string>;
} {
  const rawText = String(detailText || "");
  const hasExplicitDiffMarker = [
    "*** Begin Patch",
    "*** Update File:",
    "*** Add File:",
    "*** Delete File:",
    "*** Move to:",
    "diff --git ",
    "@@ ",
    "--- ",
    "+++ ",
  ].some((marker) => rawText.includes(marker));
  if (!hasExplicitDiffMarker) {
    return {
      value: rawText,
      diffLines: undefined,
    };
  }
  const lines = rawText.split("\n");
  const normalizedLines: Array<{
    text: string;
    kind: "add" | "remove" | "context";
    lineNumber?: number;
  }> = [];
  let sourceLineNumber = 1;
  let targetLineNumber = 1;
  let hasUnifiedHunkHeader = false;

  const buildLineNumberRanges = (
    linesToGroup: number[],
  ): Array<number | { start: number; end: number }> | undefined => {
    if (linesToGroup.length === 0) {
      return undefined;
    }
    const sorted = [...new Set(linesToGroup)].sort((left, right) => left - right);
    const ranges: Array<number | { start: number; end: number }> = [];
    let rangeStart = sorted[0];
    let previous = sorted[0];
    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index];
      if (current === previous + 1) {
        previous = current;
        continue;
      }
      ranges.push(rangeStart === previous ? rangeStart : { start: rangeStart, end: previous });
      rangeStart = current;
      previous = current;
    }
    ranges.push(rangeStart === previous ? rangeStart : { start: rangeStart, end: previous });
    return ranges;
  };

  lines.forEach((line) => {
    const trimmed = String(line || "");
    const unifiedHunkHeaderMatch = trimmed.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
    if (unifiedHunkHeaderMatch) {
      sourceLineNumber = Math.max(1, Number(unifiedHunkHeaderMatch[1] || 1));
      targetLineNumber = Math.max(1, Number(unifiedHunkHeaderMatch[2] || 1));
      hasUnifiedHunkHeader = true;
      return;
    }
    if (
      trimmed.startsWith("*** Begin Patch")
      || trimmed.startsWith("*** End Patch")
      || trimmed.startsWith("*** Update File:")
      || trimmed.startsWith("*** Add File:")
      || trimmed.startsWith("*** Delete File:")
      || trimmed.startsWith("*** Move to:")
      || trimmed.startsWith("diff --git ")
      || trimmed.startsWith("index ")
      || trimmed.startsWith("@@ ")
      || trimmed.startsWith("--- ")
      || trimmed.startsWith("+++ ")
    ) {
      return;
    }
    if (trimmed === "\\ No newline at end of file") {
      return;
    }

    if (trimmed.startsWith("+")) {
      normalizedLines.push({
        text: trimmed.slice(1),
        kind: "add",
        lineNumber: hasUnifiedHunkHeader ? targetLineNumber : undefined,
      });
      if (hasUnifiedHunkHeader) {
        targetLineNumber += 1;
      }
      return;
    }

    if (trimmed.startsWith("-")) {
      normalizedLines.push({
        text: trimmed.slice(1),
        kind: "remove",
        lineNumber: hasUnifiedHunkHeader ? sourceLineNumber : undefined,
      });
      if (hasUnifiedHunkHeader) {
        sourceLineNumber += 1;
      }
      return;
    }

    if (trimmed.startsWith(" ")) {
      normalizedLines.push({
        text: trimmed.slice(1),
        kind: "context",
        lineNumber: hasUnifiedHunkHeader ? targetLineNumber : undefined,
      });
      if (hasUnifiedHunkHeader) {
        sourceLineNumber += 1;
        targetLineNumber += 1;
      }
      return;
    }

    normalizedLines.push({
      text: trimmed,
      kind: "context",
      lineNumber: hasUnifiedHunkHeader ? targetLineNumber : undefined,
    });
    if (hasUnifiedHunkHeader) {
      sourceLineNumber += 1;
      targetLineNumber += 1;
    }
  });

  const previewText = normalizedLines.map((line) => line.text).join("\n");
  const changedLineIndexes = normalizedLines
    .map((line, index) => (line.kind === "add" || line.kind === "remove" ? index : -1))
    .filter((index) => index >= 0);
  if (changedLineIndexes.length === 0) {
    return {
      value: previewText || rawText,
      diffLines: undefined,
    };
  }

  const contextRadius = 2;
  const keepLineIndexSet = new Set<number>();
  changedLineIndexes.forEach((lineIndex) => {
    const start = Math.max(0, lineIndex - contextRadius);
    const end = Math.min(normalizedLines.length - 1, lineIndex + contextRadius);
    for (let index = start; index <= end; index += 1) {
      keepLineIndexSet.add(index);
    }
  });
  const keptLineIndexes = Array.from(keepLineIndexSet).sort((left, right) => left - right);
  const focusedLines: Array<{
    text: string;
    kind: "add" | "remove" | "context" | "ellipsis";
    lineNumber?: number | string;
  }> = [];
  let previousLineIndex = -1;
  keptLineIndexes.forEach((lineIndex) => {
    if (previousLineIndex >= 0 && lineIndex > previousLineIndex + 1) {
      focusedLines.push({
        text: "…",
        kind: "ellipsis",
        lineNumber: "",
      });
    }
    focusedLines.push({
      text: normalizedLines[lineIndex]?.text || "",
      kind: normalizedLines[lineIndex]?.kind || "context",
      lineNumber: normalizedLines[lineIndex]?.lineNumber,
    });
    previousLineIndex = lineIndex;
  });

  const maxPreviewLines = 80;
  const clippedLines = focusedLines.length > maxPreviewLines
    ? focusedLines.slice(0, maxPreviewLines)
    : focusedLines.slice();
  if (focusedLines.length > maxPreviewLines) {
    const lastLine = clippedLines[clippedLines.length - 1];
    if (!lastLine || lastLine.kind !== "ellipsis") {
      clippedLines.push({
        text: "…",
        kind: "ellipsis",
        lineNumber: "",
      });
    }
  }

  const added: number[] = [];
  const removed: number[] = [];
  const focusedTextLines: string[] = [];
  const customLineNumbers = clippedLines.map((line) => line.lineNumber ?? "");
  clippedLines.forEach((line, index) => {
    focusedTextLines.push(line.text);
    if (line.kind === "add") {
      added.push(index + 1);
      return;
    }
    if (line.kind === "remove") {
      removed.push(index + 1);
    }
  });

  return {
    value: focusedTextLines.join("\n") || previewText || rawText,
    diffLines: {
      added: buildLineNumberRanges(added),
      removed: buildLineNumberRanges(removed),
    },
    customLineNumbers: customLineNumbers.some((lineNumber) => String(lineNumber).trim().length > 0)
      ? customLineNumbers
      : undefined,
  };
}

// 描述：
//
//   - 解析 diff 文本中的新增/删除行号，供 AriCode 的 diffLines 做差异高亮。
//
// Params:
//
//   - detailText: 详情文本，通常为 unified diff 或 patch 内容。
//
// Returns:
//
//   - 命中新增/删除时返回行号集合；否则返回 undefined。
export function resolveRunSegmentDiffLines(detailText: string): {
  added?: number[];
  removed?: number[];
} | undefined {
  return resolveRunSegmentDiffPreview(detailText).diffLines;
}

// 描述：
//
//   - 解析执行步骤文本的结构化展示元信息，用于“已编辑/已浏览/已批准/已拒绝”类型高亮渲染。
//
// Params:
//
//   - segment: 当前分组步骤。
//
// Returns:
//
//   - 命中则返回结构化展示字段；未命中返回 null。
export function resolveRunSegmentRichMeta(segment: SessionRunSegmentStep): SessionRunSegmentRichMeta {
  const stepText = String(segment.text || "").trim();
  if (!stepText) {
    return null;
  }
  const normalizedStepText = stepText.toLowerCase();
  const stepData = segment.data && typeof segment.data === "object"
    ? segment.data
    : {};
  const stepType = typeof stepData.__step_type === "string"
    ? String(stepData.__step_type || "").trim()
    : "";
  const editPrefixMatch = matchRunSegmentLocalizedPrefix(stepText, RUN_SEGMENT_EDIT_PREFIXES);
  const browsePrefixMatch = matchRunSegmentLocalizedPrefix(stepText, RUN_SEGMENT_BROWSE_PREFIXES);

  if (stepType === "edit" || editPrefixMatch) {
    const parsedByText = String(editPrefixMatch?.suffix || stepText).match(/^(.+?)\s+\+(\d+)\s+-(\d+)$/);
    const filePath = String(
      (typeof stepData.edit_file_path === "string"
        ? stepData.edit_file_path
        : "") || (parsedByText?.[1] || ""),
    ).trim();
    const added = Math.max(
      0,
      Math.floor(Number(
        (typeof stepData.edit_added_lines === "number"
          ? stepData.edit_added_lines
          : parsedByText?.[2]) || 0,
      )),
    );
    const removed = Math.max(
      0,
      Math.floor(Number(
        (typeof stepData.edit_removed_lines === "number"
          ? stepData.edit_removed_lines
          : parsedByText?.[3]) || 0,
      )),
    );
    if (!filePath) {
      return null;
    }
    return {
      type: "edit",
      prefix: translateDesktopText("已编辑"),
      filePath,
      added,
      removed,
    };
  }

  if (stepType === "browse" || browsePrefixMatch) {
    const prefix = String(
      (typeof stepData.browse_prefix === "string"
        ? stepData.browse_prefix
        : "") || (browsePrefixMatch?.prefix || ""),
    ).trim();
    const suffix = String(browsePrefixMatch?.suffix || "").trim();
    if (!prefix || !suffix) {
      return null;
    }
    return {
      type: "browse",
      prefix,
      suffix,
    };
  }

  if (stepType === "approval_decision" || RUN_SEGMENT_APPROVAL_KEYWORDS.some((keyword) => normalizedStepText.includes(keyword))) {
    const approvalDecision = typeof stepData.approval_decision === "string"
      ? String(stepData.approval_decision || "").trim()
      : "";
    const approvalToolName = String(
      (typeof stepData.approval_tool_name === "string"
        ? stepData.approval_tool_name
        : "") || translateDesktopText("该工具"),
    ).trim();
    if (approvalDecision === "approved") {
      return {
        type: "approval",
        leading: "",
        label: translateDesktopText("已批准"),
        suffix: translateDesktopText(" {{tool}}", { tool: approvalToolName }),
        tone: "approved",
      };
    }
    if (approvalDecision === "rejected") {
      return {
        type: "approval",
        leading: "",
        label: translateDesktopText("已拒绝"),
        suffix: translateDesktopText(" {{tool}} 的执行请求。", { tool: approvalToolName }),
        tone: "rejected",
      };
    }
    if (approvalDecision === "cancelled") {
      return {
        type: "approval",
        leading: "",
        label: translateDesktopText("已取消"),
        suffix: translateDesktopText("授权流程，未执行 {{tool}}。", { tool: approvalToolName }),
        tone: "neutral",
      };
    }
    if (approvalDecision === "handled") {
      return {
        type: "approval",
        leading: "",
        label: translateDesktopText("已处理"),
        suffix: translateDesktopText(" {{tool}} 的授权请求。", { tool: approvalToolName }),
        tone: "neutral",
      };
    }
    const sessionApprovedToolName = matchRunSegmentTemplateCapture(stepText, RUN_SEGMENT_SESSION_APPROVED_PATTERNS);
    if (sessionApprovedToolName) {
      return {
        type: "approval",
        leading: "",
        label: translateDesktopText("已批准"),
        suffix: translateDesktopText(" {{tool}}", { tool: sessionApprovedToolName }),
        tone: "approved",
      };
    }
    const approvedOnceToolName = matchRunSegmentTemplateCapture(stepText, RUN_SEGMENT_APPROVED_ONCE_PATTERNS);
    if (approvedOnceToolName) {
      return {
        type: "approval",
        leading: "",
        label: translateDesktopText("已批准"),
        suffix: translateDesktopText(" {{tool}}", { tool: approvedOnceToolName }),
        tone: "approved",
      };
    }
    const simpleApprovedMatch = matchRunSegmentLocalizedPrefix(stepText, RUN_SEGMENT_APPROVED_PREFIXES);
    if (simpleApprovedMatch?.suffix) {
      return {
        type: "approval",
        leading: "",
        label: translateDesktopText("已批准"),
        suffix: translateDesktopText(" {{tool}}", { tool: String(simpleApprovedMatch.suffix || "").trim().replace(/[，。]+$/g, "") }),
        tone: "approved",
      };
    }
    const rejectedToolName = matchRunSegmentTemplateCapture(stepText, RUN_SEGMENT_REJECTED_PATTERNS);
    if (rejectedToolName) {
      return {
        type: "approval",
        leading: "",
        label: translateDesktopText("已拒绝"),
        suffix: translateDesktopText(" {{tool}} 的执行请求。", { tool: rejectedToolName }),
        tone: "rejected",
      };
    }
  }

  return null;
}

// 描述：
//
//   - 处理编辑文件路径上的键盘操作，支持 Enter/Space 触发复制并阻断冒泡。
//
// Params:
//
//   - event: 键盘事件对象。
//   - filePath: 文件路径。
//   - onCopyFilePath: 文件复制回调。
function handleFilePathKeyDown(
  event: ReactKeyboardEvent<HTMLSpanElement>,
  filePath: string,
  onCopyFilePath: (path: string) => void | Promise<void>,
): void {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  void onCopyFilePath(filePath);
}

// 描述：
//
//   - 渲染步骤文本主体：普通步骤保持原样，编辑/浏览/授权步骤采用结构化高亮样式。
//
// Params:
//
//   - segment: 当前分组步骤。
//   - onCopyFilePath: 文件复制回调。
//
// Returns:
//
//   - 可直接嵌入执行流步骤容器的节点。
function renderRunSegmentStepContent(
  segment: SessionRunSegmentStep,
  onCopyFilePath: (filePath: string) => void | Promise<void>,
  detailExpanded = false,
): JSX.Element {
  const richMeta = resolveRunSegmentRichMeta(segment);
  const runningClass = segment.status === "running" ? "desk-run-step-running" : "";
  if (!richMeta) {
    return (
      <AriTypography
        className={`desk-run-step ${runningClass}`}
        variant="caption"
        value={segment.text}
      />
    );
  }
  if (richMeta.type === "edit") {
    if (detailExpanded) {
      return (
        <AriContainer className={`desk-run-step desk-run-step-rich ${runningClass}`} padding={0}>
          <span className="desk-run-step-prefix">{translateDesktopText("已编辑的文件")}</span>
          <span className="desk-run-step-count-add">+{richMeta.added}</span>
          <span className="desk-run-step-count-remove">-{richMeta.removed}</span>
        </AriContainer>
      );
    }
    return (
      <AriContainer className={`desk-run-step desk-run-step-rich ${runningClass}`} padding={0}>
        <span className="desk-run-step-prefix">{richMeta.prefix}</span>
        <span
          className="desk-run-step-file-link"
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            void onCopyFilePath(richMeta.filePath);
          }}
          onKeyDown={(event) => {
            handleFilePathKeyDown(event, richMeta.filePath, onCopyFilePath);
          }}
        >
          {richMeta.filePath}
        </span>
        <span className="desk-run-step-count-add">+{richMeta.added}</span>
        <span className="desk-run-step-count-remove">-{richMeta.removed}</span>
      </AriContainer>
    );
  }
  if (richMeta.type === "browse") {
    return (
      <AriContainer className={`desk-run-step desk-run-step-rich ${runningClass}`} padding={0}>
        <span className="desk-run-step-prefix">{richMeta.prefix}</span>
        <span>{richMeta.suffix}</span>
      </AriContainer>
    );
  }
  return (
    <AriContainer className={`desk-run-step desk-run-step-rich ${runningClass}`} padding={0}>
      {richMeta.leading ? <span>{richMeta.leading}</span> : null}
      <span
        className={`desk-run-step-approval-label ${richMeta.tone === "rejected" ? "desk-run-step-approval-label-rejected" : ""}`}
      >
        {richMeta.label}
      </span>
      <span>{richMeta.suffix}</span>
    </AriContainer>
  );
}

// 描述：
//
//   - 渲染执行流单条片段，统一处理“静态步骤 / 可展开详情”两种展示模式。
//
// Params:
//
//   - props: 执行片段展示入参。
//
// Returns:
//
//   - 执行片段节点。
export function SessionRunSegmentItem(props: SessionRunSegmentItemProps): JSX.Element {
  const {
    segment,
    detailExpanded,
    onToggleDetail,
    onCopyFilePath,
  } = props;
  const richMeta = resolveRunSegmentRichMeta(segment);
  const segmentData = segment.data && typeof segment.data === "object"
    ? (segment.data as Record<string, unknown>)
    : {};
  const detailPayload = String(segment.detail || "").trim();
  const editDiffPayload = typeof segmentData.edit_diff_preview === "string"
    ? String(segmentData.edit_diff_preview || "").trim()
    : "";
  const editContentPayload = typeof segmentData.edit_content_preview === "string"
    ? String(segmentData.edit_content_preview || "").trim()
    : "";
  const effectiveEditDetailPayload = editDiffPayload || editContentPayload || detailPayload;
  const detailCodeLanguage = resolveRunSegmentDetailLanguage(detailPayload, segment.text);
  const diffDetailPayload = richMeta?.type === "edit"
    ? (editDiffPayload || detailPayload)
    : detailPayload;
  const shouldUseDiffCode = resolveRunSegmentDetailLanguage(diffDetailPayload, segment.text) === "diff"
    && diffDetailPayload.length > 0;
  const detailCodePreview = shouldUseDiffCode
    ? resolveRunSegmentDiffPreview(diffDetailPayload)
    : {
      value: richMeta?.type === "edit"
        ? effectiveEditDetailPayload
        : detailPayload,
      diffLines: undefined,
      customLineNumbers: undefined,
    };
  const detailCodeValue = detailCodePreview.value;
  const detailCodePath = richMeta?.type === "edit" ? richMeta.filePath : undefined;
  const resolvedDetailCodeLanguage = detailCodePath
    ? resolveRunSegmentCodeLanguageByPath(detailCodePath)
    : (shouldUseDiffCode ? resolveRunSegmentDetailLanguage(detailCodeValue, segment.text) : detailCodeLanguage);
  const detailCodeDiffLines = shouldUseDiffCode
    ? detailCodePreview.diffLines
    : undefined;
  const detailCodeCustomLineNumbers = shouldUseDiffCode
    ? detailCodePreview.customLineNumbers
    : undefined;
  const detailCodeAddedCount = richMeta?.type === "edit" ? richMeta.added : undefined;
  const detailCodeRemovedCount = richMeta?.type === "edit" ? richMeta.removed : undefined;
  const segmentStepType = typeof segmentData.__step_type === "string"
    ? String(segmentData.__step_type || "").trim()
    : "";
  const shouldRenderPlainBrowseDetail = segmentStepType === "browse";
  const detailLines = shouldRenderPlainBrowseDetail
    ? detailPayload.split("\n")
    : [];
  const canExpand = Boolean(detailPayload);
  return (
    <AriContainer className="desk-run-segment" padding={0}>
      {canExpand ? (
        <button
          type="button"
          className="desk-run-segment-detail-toggle"
          onClick={() => {
            onToggleDetail();
          }}
        >
          <AriContainer className="desk-run-segment-detail-toggle-content" padding={0}>
            {renderRunSegmentStepContent(segment, onCopyFilePath, detailExpanded)}
          </AriContainer>
          <span className={`desk-run-segment-detail-arrow ${detailExpanded ? "open" : ""}`}>
            ▸
          </span>
        </button>
      ) : (
        <AriContainer className="desk-run-segment-static-step" padding={0}>
          {renderRunSegmentStepContent(segment, onCopyFilePath, false)}
        </AriContainer>
      )}
      {canExpand && detailExpanded ? (
        <AriContainer className="desk-run-segment-detail-panel" padding={0}>
          {shouldRenderPlainBrowseDetail ? (
            <AriContainer className="desk-run-segment-detail-plain" padding={0}>
              {detailLines.map((line, index) => (
                <AriTypography
                  key={`${segment.key}-detail-line-${index}`}
                  className="desk-run-step"
                  variant="caption"
                  value={line}
                />
              ))}
            </AriContainer>
          ) : (
            <AriContainer className="desk-run-segment-detail-code" padding={0}>
              <AriCode
                language={resolvedDetailCodeLanguage}
                path={detailCodePath}
                addedCount={detailCodeAddedCount}
                removedCount={detailCodeRemovedCount}
                diffLines={detailCodeDiffLines}
                customLineNumbers={detailCodeCustomLineNumbers}
                value={detailCodeValue}
                editable={false}
                showToolbar={false}
                showCopyButton
                showLanguageTag={false}
                showLineNumbers={resolvedDetailCodeLanguage !== "text" || Boolean(detailCodeCustomLineNumbers)}
                fontSize="sm"
                height={resolveRunSegmentCodeHeight(detailCodeValue)}
              />
            </AriContainer>
          )}
        </AriContainer>
      ) : null}
    </AriContainer>
  );
}
