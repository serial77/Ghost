"use client";

import { useState } from "react";

// --- Types ---

type ContentBlock =
  | { type: "code"; lang: string; text: string }
  | { type: "text"; text: string };

// --- Block parser ---
// Splits content into fenced code blocks and text blocks.
// Line-by-line scan: safe with any content, no dangerouslySetInnerHTML.
// Unclosed code fences at end of string are treated as code-to-end.

function parseBlocks(content: string): ContentBlock[] {
  const result: ContentBlock[] = [];
  const lines = content.split("\n");
  let i = 0;
  const textBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    // Opening fence: line is exactly ```lang or ```
    const fenceOpen = /^```(\w*)$/.exec(line);

    if (fenceOpen) {
      if (textBuf.length > 0) {
        result.push({ type: "text", text: textBuf.join("\n") });
        textBuf.length = 0;
      }

      const lang = fenceOpen[1] ?? "";
      const codeLines: string[] = [];
      i++;

      while (i < lines.length) {
        // Closing fence: line is exactly ``` (with optional trailing space)
        if (/^```\s*$/.test(lines[i])) {
          i++; // consume closing fence
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }

      result.push({ type: "code", lang, text: codeLines.join("\n") });
    } else {
      textBuf.push(line);
      i++;
    }
  }

  if (textBuf.length > 0) {
    result.push({ type: "text", text: textBuf.join("\n") });
  }

  return result;
}

// --- Inline parser ---
// Handles: inline code (`code`), bold (**text**)
// Returns React nodes — NO dangerouslySetInnerHTML, all text escaped by React.

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match inline code (no backtick or newline inside) OR bold (no asterisk or newline)
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key++} className="msg-inline-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    }

    last = pattern.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// --- Code block ---

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      },
      () => {
        // Clipboard unavailable — no crash, no action
      },
    );
  }

  return (
    <div className="msg-code-block">
      <div className="msg-code-header">
        <span className="msg-code-lang">{lang || "code"}</span>
        <button
          type="button"
          className="msg-code-copy"
          onClick={handleCopy}
          aria-label={copied ? "Code copied to clipboard" : "Copy code to clipboard"}
          title="Copy code"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="msg-code-pre">
        <code>{text}</code>
      </pre>
    </div>
  );
}

// --- Text block ---
// Handles paragraph splitting (\n\n), line breaks (\n),
// unordered list detection (- or * prefix), and inline formatting.

function TextBlock({ text }: { text: string }) {
  // Split on one or more blank lines to get paragraphs
  const paragraphs = text.split(/\n{2,}/);

  return (
    <>
      {paragraphs.map((para, pi) => {
        if (!para.trim()) return null;

        const lines = para.split("\n");

        // Detect unordered list: all non-empty lines start with - or *
        const nonEmpty = lines.filter((l) => l.trim());
        const isList =
          nonEmpty.length > 0 && nonEmpty.every((l) => /^[-*]\s/.test(l));
        const isOrderedList =
          nonEmpty.length > 0 && nonEmpty.every((l) => /^\d+\.\s/.test(l));

        if (isList) {
          return (
            <ul key={pi} className="msg-list">
              {nonEmpty.map((item, ii) => (
                <li key={ii}>{parseInline(item.replace(/^[-*]\s/, ""))}</li>
              ))}
            </ul>
          );
        }

        if (isOrderedList) {
          return (
            <ol key={pi} className="msg-list">
              {nonEmpty.map((item, ii) => (
                <li key={ii}>{parseInline(item.replace(/^\d+\.\s/, ""))}</li>
              ))}
            </ol>
          );
        }

        // Regular paragraph — render each line with <br /> between
        return (
          <p key={pi} className="msg-para">
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {parseInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

// --- Parsed content ---

function ParsedContent({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === "code") {
          return <CodeBlock key={i} lang={block.lang} text={block.text} />;
        }
        return <TextBlock key={i} text={block.text} />;
      })}
    </>
  );
}

// --- Main export ---
// During reveal: renders plain text (parsing partial strings is unsafe —
// unclosed fences and backticks produce garbage).
// After reveal: full parsed rendering with code blocks, inline formatting, etc.

export function MessageContent({
  content,
  isRevealing,
  revealedContent,
}: {
  content: string;
  isRevealing: boolean;
  revealedContent: string;
}) {
  if (isRevealing) {
    // Plain text during progressive reveal — cursor is rendered by the parent
    return <span>{revealedContent}</span>;
  }

  return <ParsedContent content={content} />;
}
