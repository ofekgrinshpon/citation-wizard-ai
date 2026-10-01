import { ReactNode } from "react";
import { normalizeHebrewNumberRanges } from "@/lib/hebrewNumberRange";

const HEADING_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const open = remaining.indexOf("**");
    if (open === -1) {
      parts.push(<span key={`${keyBase}-${key++}`}>{remaining}</span>);
      break;
    }
    if (open > 0) parts.push(<span key={`${keyBase}-${key++}`}>{remaining.slice(0, open)}</span>);
    const close = remaining.indexOf("**", open + 2);
    if (close === -1) {
      parts.push(<span key={`${keyBase}-${key++}`}>{remaining.slice(open)}</span>);
      break;
    }
    parts.push(
      <strong key={`${keyBase}-${key++}`} className="font-bold">
        {remaining.slice(open + 2, close)}
      </strong>
    );
    remaining = remaining.slice(close + 2);
  }
  return parts;
}

/**
 * Render answer markdown: **bold** → <strong>, ATX headings (# …) → a bold
 * heading line without the literal # prefix. Text only — React escapes all
 * content; no raw HTML is ever injected. Newlines are kept (parent uses
 * whitespace-pre-wrap). Also enforces Rule 1.10 (Hebrew number ranges).
 */
export function renderAnswerMarkdown(text: string): ReactNode[] {
  const lines = normalizeHebrewNumberRanges(text).split("\n");
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    const m = HEADING_RE.exec(line);
    if (m) {
      const level = m[1].length;
      out.push(
        <span
          key={`h${i}`}
          role="heading"
          aria-level={level}
          className={level <= 2 ? "font-bold text-base" : "font-bold"}
        >
          {renderInline(m[2].replace(/\*\*/g, ""), `h${i}`)}
        </span>
      );
    } else {
      out.push(...renderInline(line, `l${i}`));
    }
    if (i < lines.length - 1) out.push(<span key={`n${i}`}>{"\n"}</span>);
  });
  return out;
}
