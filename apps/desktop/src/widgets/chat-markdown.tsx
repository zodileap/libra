import { Fragment, memo, type ReactNode } from "react";
import { AriCode, AriContainer } from "aries_react";

interface ChatMarkdownProps {
  content: string;
  className?: string;
  plainText?: boolean;
}

type MarkdownBlock =
  | { type: "text"; text: string }
  | { type: "code"; language: string; code: string };

const CODE_FENCE_REGEX = /```([a-zA-Z0-9_+\-.#]*)\n?([\s\S]*?)```/g;
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const LIST_REGEX = /^([-*]|\d+\.)\s+(.+)$/;
const LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/;
const BOLD_REGEX = /^\*\*([\s\S]+)\*\*$/;
const ITALIC_REGEX = /^\*([\s\S]+)\*$/;

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

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  const nodes: ReactNode[] = [];

  parts.forEach((part, index) => {
    if (!part) return;
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      nodes.push(
        <code key={`inline-code-${index}`} className="desk-md-inline-code">
          {part.slice(1, -1)}
        </code>
      );
      return;
    }

    const linkMatch = part.match(LINK_REGEX);
    if (linkMatch && linkMatch[0] === part) {
      nodes.push(
        <a
          key={`inline-link-${index}`}
          className="desk-md-link"
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer noopener"
        >
          {linkMatch[1]}
        </a>
      );
      return;
    }

    const boldMatch = part.match(BOLD_REGEX);
    if (boldMatch) {
      nodes.push(<strong key={`inline-strong-${index}`}>{boldMatch[1]}</strong>);
      return;
    }

    const italicMatch = part.match(ITALIC_REGEX);
    if (italicMatch) {
      nodes.push(<em key={`inline-em-${index}`}>{italicMatch[1]}</em>);
      return;
    }

    nodes.push(<Fragment key={`inline-text-${index}`}>{part}</Fragment>);
  });

  return nodes;
}

function mapHeadingClass(level: number): string {
  if (level <= 1) return "desk-md-heading desk-md-heading-1";
  if (level === 2) return "desk-md-heading desk-md-heading-2";
  return "desk-md-heading desk-md-heading-3";
}

function codeBlockHeight(code: string): string {
  // 描述:
  //
  //   - 根据代码行数返回编辑器高度，统一使用主题变量避免硬编码像素。
  const lineCount = Math.max(code.split("\n").length, 1);
  const blockUnits = Math.min(Math.max(lineCount + 2, 8), 26);
  return `calc(var(--z-inset) * ${blockUnits})`;
}

function renderTextBlock(text: string, blockIndex: number): ReactNode {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let lineIndex = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const content = paragraphLines.join(" ").trim();
    if (content) {
      nodes.push(
        <p key={`p-${blockIndex}-${lineIndex}`} className="desk-md-paragraph">
          {renderInlineMarkdown(content)}
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
      while (lineIndex < lines.length) {
        const itemLine = lines[lineIndex].trim();
        const itemMatch = itemLine.match(LIST_REGEX);
        if (!itemMatch) break;
        items.push(itemMatch[2]);
        lineIndex += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      nodes.push(
        <ListTag key={`list-${blockIndex}-${lineIndex}`} className="desk-md-list">
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
    <AriContainer className="desk-md-text-block" key={`text-${blockIndex}`}>
      {nodes}
    </AriContainer>
  );
}

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  className,
  plainText = false,
}: ChatMarkdownProps) {
  if (plainText) {
    return (
      <AriContainer className={`desk-chat-markdown ${className || ""}`.trim()}>
        <pre className="desk-chat-plain-text">{content}</pre>
      </AriContainer>
    );
  }

  const blocks = splitMarkdownBlocks(content || "");

  return (
    <AriContainer className={`desk-chat-markdown ${className || ""}`.trim()}>
      {blocks.map((block, blockIndex) => {
        if (block.type === "code") {
          return (
            <AriContainer key={`code-${blockIndex}`} className="desk-md-code-wrap">
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
