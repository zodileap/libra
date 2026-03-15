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
const LIST_REGEX = /^([-*]|\d+\.)\s+(.+)$/;

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
  const lines = text.split("\n");
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

    const listMatch = line.match(LIST_REGEX);
    if (listMatch) {
      flushParagraph();
      const ordered = /^\d+\./.test(listMatch[1]);
      const items: string[] = [];
      const orderedStart = ordered ? Number.parseInt(listMatch[1], 10) || 1 : undefined;
      while (lineIndex < lines.length) {
        const itemLine = lines[lineIndex].trim();
        const itemMatch = itemLine.match(LIST_REGEX);
        if (!itemMatch) break;
        items.push(itemMatch[2]);
        lineIndex += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      nodes.push(
        <ListTag
          key={`list-${blockIndex}-${lineIndex}`}
          className="desk-md-list"
          start={orderedStart}
        >
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ListTag>
      );
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
