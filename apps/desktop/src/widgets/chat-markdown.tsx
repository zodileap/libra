import { Fragment, memo, type ReactNode } from "react";
import { AriCode, AriContainer } from "@aries-kit/react";

// 描述:
//
//   - 定义聊天 Markdown 渲染组件的入参，统一承载文本内容、样式类与纯文本模式开关。
interface ChatMarkdownProps {
  content: string;
  className?: string;
  plainText?: boolean;
}

// 描述:
//
//   - 定义 Markdown 分块结果，当前仅区分普通文本块与代码块。
type MarkdownBlock =
  | { type: "text"; text: string }
  | { type: "code"; language: string; code: string };

// 描述:
//
//   - 匹配三反引号包裹的代码块，并提取语言标签与代码正文。
const CODE_FENCE_REGEX = /```([a-zA-Z0-9_+\-.#]*)\n?([\s\S]*?)```/g;

// 描述:
//
//   - 匹配 Markdown 标题行（1-6 级）。
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

// 描述:
//
//   - 匹配无序/有序列表项（"-"、"*"、"1." 等）。
const LIST_ITEM_REGEX = /^(\s*)([-*]|\d+\.)\s+(.+)$/;

// 描述：
//
//   - 定义列表行解析结果，统一记录缩进、列表类型与正文文本。
interface MarkdownListLineMatch {
  indent: number;
  marker: string;
  ordered: boolean;
  text: string;
}

// 描述：
//
//   - 定义嵌套列表节点，供文本块渲染阶段递归输出有序/无序列表。
interface MarkdownListNode {
  ordered: boolean;
  start?: number;
  items: MarkdownListItemNode[];
}

// 描述：
//
//   - 定义单个列表项节点；除正文外，还允许继续挂载子列表。
interface MarkdownListItemNode {
  text: string;
  children: MarkdownListNode[];
}

// 描述:
//
//   - 将原始 Markdown 按代码块切分，供后续分别走文本渲染与代码渲染流程。
//
// Params:
//
//   - content: 原始 Markdown 文本。
//
// Returns:
//
//   - 分块后的 Markdown 列表。
function splitMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = CODE_FENCE_REGEX.exec(content)) !== null) {
    const [raw, language = "", code = ""] = match;
    const start = match.index;

    if (start > cursor) {
      blocks.push({
        type: "text",
        text: content.slice(cursor, start),
      });
    }

    blocks.push({
      type: "code",
      language: language.trim().toLowerCase() || "plaintext",
      code: code.replace(/\n$/, ""),
    });
    cursor = start + raw.length;
  }

  if (cursor < content.length) {
    blocks.push({
      type: "text",
      text: content.slice(cursor),
    });
  }

  return blocks;
}

// 描述：
//
//   - 计算 Markdown 行首缩进宽度；当前把 tab 统一折算为 4 个空格，避免层级判断受制表符影响。
//
// Params:
//
//   - rawIndent: 原始缩进片段。
//
// Returns:
//
//   - 归一化后的缩进宽度。
function countMarkdownIndent(rawIndent: string): number {
  return String(rawIndent || "").replace(/\t/g, "    ").length;
}

// 描述：
//
//   - 判断当前编号项是否更像“分级大纲标题”。对于“2. 范围与依赖：”这类标题，
//     后面紧跟的短横线通常是它的子项，而不是新的顶层列表。
//
// Params:
//
//   - line: 当前原始文本行。
//
// Returns:
//
//   - true: 后续短横线列表应提升为当前编号项的子级。
function shouldPromoteOutlineChildren(line: string): boolean {
  return /^\s*\d+\.\s+.+[：:]$/u.test(String(line || "").trim());
}

// 描述：
//
//   - 对 AI 常见的“编号标题 + 紧随其后的短横线子项”进行缩进修正，
//     把本来语义上属于子级的短横线列表补成可稳定解析的嵌套结构。
//
// Params:
//
//   - text: 原始 Markdown 文本。
//
// Returns:
//
//   - 修正后的 Markdown 文本。
function normalizeOutlineListIndentation(text: string): string {
  const lines = String(text || "").split("\n");
  const normalizedLines = [...lines];

  for (let lineIndex = 0; lineIndex < normalizedLines.length; lineIndex += 1) {
    const currentLine = normalizedLines[lineIndex];
    if (!shouldPromoteOutlineChildren(currentLine)) {
      continue;
    }
    const currentListMatch = currentLine.match(LIST_ITEM_REGEX);
    const parentIndent = currentListMatch ? countMarkdownIndent(currentListMatch[1]) : 0;

    for (let nextIndex = lineIndex + 1; nextIndex < normalizedLines.length; nextIndex += 1) {
      const nextLine = normalizedLines[nextIndex];
      const trimmedNextLine = String(nextLine || "").trim();
      if (!trimmedNextLine) {
        break;
      }
      const nextListMatch = nextLine.match(LIST_ITEM_REGEX);
      if (!nextListMatch) {
        break;
      }
      const nextIndent = countMarkdownIndent(nextListMatch[1]);
      const nextOrdered = /^\d+\.$/.test(nextListMatch[2]);
      if (nextOrdered && nextIndent <= parentIndent) {
        break;
      }
      normalizedLines[nextIndex] = `  ${nextLine}`;
    }
  }

  return normalizedLines.join("\n");
}

// 描述：
//
//   - 解析单行 Markdown 列表项，统一提取缩进、标记与正文。
//
// Params:
//
//   - rawLine: 原始文本行。
//
// Returns:
//
//   - 命中的列表项结构；不匹配时返回 null。
function parseMarkdownListLine(rawLine: string): MarkdownListLineMatch | null {
  const listMatch = String(rawLine || "").match(LIST_ITEM_REGEX);
  if (!listMatch) {
    return null;
  }
  return {
    indent: countMarkdownIndent(listMatch[1]),
    marker: listMatch[2],
    ordered: /^\d+\.$/.test(listMatch[2]),
    text: listMatch[3],
  };
}

// 描述:
//
//   - 解析段落内联语法，支持行内代码、链接、加粗与斜体。
//
// Params:
//
//   - text: 行内文本。
//
// Returns:
//
//   - React 可渲染的节点列表。
function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let cursor = 0;
  let nodeIndex = 0;

  const flushTextBuffer = () => {
    if (!buffer) {
      return;
    }
    nodes.push(<Fragment key={`inline-text-${nodeIndex}`}>{buffer}</Fragment>);
    nodeIndex += 1;
    buffer = "";
  };

  while (cursor < text.length) {
    if (text.startsWith("`", cursor)) {
      const codeEnd = text.indexOf("`", cursor + 1);
      if (codeEnd > cursor + 1) {
        flushTextBuffer();
        nodes.push(
          <code key={`inline-code-${nodeIndex}`} className="desk-md-inline-code">
            {text.slice(cursor + 1, codeEnd)}
          </code>,
        );
        nodeIndex += 1;
        cursor = codeEnd + 1;
        continue;
      }
    }

    if (text.startsWith("**", cursor)) {
      const boldEnd = text.indexOf("**", cursor + 2);
      if (boldEnd > cursor + 2) {
        flushTextBuffer();
        nodes.push(
          <strong key={`inline-strong-${nodeIndex}`}>
            {renderInlineMarkdown(text.slice(cursor + 2, boldEnd))}
          </strong>,
        );
        nodeIndex += 1;
        cursor = boldEnd + 2;
        continue;
      }
    }

    if (text.startsWith("*", cursor)) {
      const italicEnd = text.indexOf("*", cursor + 1);
      if (italicEnd > cursor + 1) {
        flushTextBuffer();
        nodes.push(
          <em key={`inline-em-${nodeIndex}`}>
            {renderInlineMarkdown(text.slice(cursor + 1, italicEnd))}
          </em>,
        );
        nodeIndex += 1;
        cursor = italicEnd + 1;
        continue;
      }
    }

    if (text.startsWith("[", cursor)) {
      const labelEnd = text.indexOf("]", cursor + 1);
      if (labelEnd > cursor + 1 && text[labelEnd + 1] === "(") {
        const hrefEnd = text.indexOf(")", labelEnd + 2);
        if (hrefEnd > labelEnd + 2) {
          flushTextBuffer();
          const label = text.slice(cursor + 1, labelEnd);
          const href = text.slice(labelEnd + 2, hrefEnd);
          nodes.push(
            <a
              key={`inline-link-${nodeIndex}`}
              className="desk-md-link"
              href={href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {renderInlineMarkdown(label)}
            </a>,
          );
          nodeIndex += 1;
          cursor = hrefEnd + 1;
          continue;
        }
      }
    }

    buffer += text[cursor];
    cursor += 1;
  }

  flushTextBuffer();

  return nodes;
}

// 描述:
//
//   - 将标题层级映射为统一样式类，控制字号与层次视觉。
//
// Params:
//
//   - level: 标题等级。
//
// Returns:
//
//   - 对应标题样式类名。
function mapHeadingClass(level: number): string {
  if (level <= 1) return "desk-md-heading desk-md-heading-1";
  if (level === 2) return "desk-md-heading desk-md-heading-2";
  return "desk-md-heading desk-md-heading-3";
}

// 描述:
//
//   - 根据代码行数返回编辑器高度，统一使用主题变量避免硬编码像素。
//
// Params:
//
//   - code: 代码文本。
//
// Returns:
//
//   - 代码块高度表达式。
function codeBlockHeight(code: string): string {
  const lineCount = Math.max(code.split("\n").length, 1);
  const blockUnits = Math.min(Math.max(lineCount + 2, 8), 26);
  return `calc(var(--z-inset) * ${blockUnits})`;
}

// 描述：
//
//   - 渲染单棵 Markdown 列表树，支持有序/无序列表与递归子列表。
//
// Params:
//
//   - list: 当前列表节点。
//   - keyPrefix: 当前节点 key 前缀。
//
// Returns:
//
//   - React 可渲染的列表节点。
function renderMarkdownListNode(list: MarkdownListNode, keyPrefix: string): ReactNode {
  const ListTag = list.ordered ? "ol" : "ul";
  return (
    <ListTag
      key={`${keyPrefix}-list`}
      className="desk-md-list"
      start={list.start}
    >
      {list.items.map((item, itemIndex) => (
        <li key={`${keyPrefix}-item-${itemIndex}`}>
          {renderInlineMarkdown(item.text)}
          {item.children.map((child, childIndex) =>
            renderMarkdownListNode(child, `${keyPrefix}-item-${itemIndex}-child-${childIndex}`))}
        </li>
      ))}
    </ListTag>
  );
}

// 描述：
//
//   - 按缩进层级递归消费连续列表行，生成嵌套列表树。
//
// Params:
//
//   - lines: 当前文本块的行数组。
//   - startIndex: 当前列表开始位置。
//   - expectedIndent: 当前层级应消费的缩进宽度。
//
// Returns:
//
//   - list: 当前层级生成的列表节点。
//   - nextIndex: 列表消费结束后的下一行索引。
function parseMarkdownListNode(
  lines: string[],
  startIndex: number,
  expectedIndent: number,
): { list: MarkdownListNode; nextIndex: number } {
  const firstLine = parseMarkdownListLine(lines[startIndex]);
  const ordered = Boolean(firstLine?.ordered);
  const orderedStart = ordered && firstLine ? Number.parseInt(firstLine.marker, 10) || 1 : undefined;
  const items: MarkdownListItemNode[] = [];
  let lineIndex = startIndex;

  while (lineIndex < lines.length) {
    const listMatch = parseMarkdownListLine(lines[lineIndex]);
    if (!listMatch) {
      break;
    }
    if (listMatch.indent < expectedIndent) {
      break;
    }
    if (listMatch.indent > expectedIndent) {
      if (items.length === 0) {
        break;
      }
      const nested = parseMarkdownListNode(lines, lineIndex, listMatch.indent);
      items[items.length - 1].children.push(nested.list);
      lineIndex = nested.nextIndex;
      continue;
    }
    if (listMatch.ordered !== ordered) {
      break;
    }
    items.push({
      text: listMatch.text,
      children: [],
    });
    lineIndex += 1;
  }

  return {
    list: {
      ordered,
      start: orderedStart,
      items,
    },
    nextIndex: lineIndex,
  };
}

// 描述:
//
//   - 渲染 Markdown 文本块，支持段落、标题、引用和列表等结构。
//
// Params:
//
//   - text: 文本块内容。
//   - blockIndex: 块索引（用于 key 生成）。
//
// Returns:
//
//   - 文本块对应的渲染节点。
function renderTextBlock(text: string, blockIndex: number): ReactNode {
  const lines = normalizeOutlineListIndentation(text).split("\n");
  const nodes: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let lineIndex = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const normalizedLines = paragraphLines
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0);
    if (normalizedLines.length > 0) {
      nodes.push(
        <p key={`p-${blockIndex}-${lineIndex}`} className="desk-md-paragraph">
          {normalizedLines.map((item, index) => (
            <Fragment key={`p-line-${blockIndex}-${lineIndex}-${index}`}>
              {index > 0 ? <br /> : null}
              {renderInlineMarkdown(item)}
            </Fragment>
          ))}
        </p>
      );
    }
    paragraphLines = [];
  };

  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      lineIndex += 1;
      continue;
    }

    const headingMatch = line.match(HEADING_REGEX);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      nodes.push(
        <h4 key={`h-${blockIndex}-${lineIndex}`} className={mapHeadingClass(level)}>
          {renderInlineMarkdown(headingMatch[2])}
        </h4>
      );
      lineIndex += 1;
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (lineIndex < lines.length && lines[lineIndex].trim().startsWith(">")) {
        quoteLines.push(lines[lineIndex].trim().replace(/^>\s?/, ""));
        lineIndex += 1;
      }
      nodes.push(
        <blockquote key={`q-${blockIndex}-${lineIndex}`} className="desk-md-quote">
          {quoteLines.map((quote, idx) => (
            <p key={`q-line-${idx}`} className="desk-md-paragraph">
              {renderInlineMarkdown(quote)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    const listMatch = parseMarkdownListLine(rawLine);
    if (listMatch) {
      flushParagraph();
      const parsedList = parseMarkdownListNode(lines, lineIndex, listMatch.indent);
      nodes.push(
        renderMarkdownListNode(parsedList.list, `list-${blockIndex}-${lineIndex}`)
      );
      lineIndex = parsedList.nextIndex;
      continue;
    }

    paragraphLines.push(line);
    lineIndex += 1;
  }

  flushParagraph();

  if (nodes.length === 0) {
    return null;
  }

  return (
    <AriContainer className="desk-md-text-block" key={`text-${blockIndex}`} padding={0}>
      {nodes}
    </AriContainer>
  );
}

// 描述:
//
//   - 渲染聊天 Markdown 内容，按代码块与文本块分路处理，保证聊天输出可读性。
export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  className,
  plainText = false,
}: ChatMarkdownProps) {
  if (plainText) {
    return (
      <AriContainer className={`desk-chat-markdown ${className || ""}`.trim()} padding={0}>
        <pre className="desk-chat-plain-text">{content}</pre>
      </AriContainer>
    );
  }

  const blocks = splitMarkdownBlocks(content || "");

  return (
    <AriContainer className={`desk-chat-markdown ${className || ""}`.trim()} padding={0}>
      {blocks.map((block, blockIndex) => {
        if (block.type === "code") {
          return (
            <AriContainer key={`code-${blockIndex}`} className="desk-md-code-wrap" padding={0}>
              <AriCode
                language={block.language}
                value={block.code}
                editable={false}
                showToolbar={false}
                showCopyButton
                showLineNumbers
                height={codeBlockHeight(block.code)}
              />
            </AriContainer>
          );
        }
        return renderTextBlock(block.text, blockIndex);
      })}
    </AriContainer>
  );
});
