import { ReactNode } from "react";

/**
 * Render answer markdown with **bold** segments converted to <strong>.
 * Preserves all other characters (newlines handled by whitespace-pre-wrap on parent).
 * Unmatched ** are rendered as literal text.
 */
export function renderAnswerMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const open = remaining.indexOf("**");
    if (open === -1) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (open > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, open)}</span>);
    }
    const close = remaining.indexOf("**", open + 2);
    if (close === -1) {
      parts.push(<span key={key++}>{remaining.slice(open)}</span>);
      break;
    }
    parts.push(
      <strong key={key++} className="font-bold">
        {remaining.slice(open + 2, close)}
      </strong>
    );
    remaining = remaining.slice(close + 2);
  }

  return parts;
}
