import React from "react";

export function RenderCitation({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const idx = remaining.indexOf("**");
    if (idx === -1) { parts.push(<span key={key++}>{remaining}</span>); break; }
    if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
    const close = remaining.indexOf("**", idx + 2);
    if (close === -1) { parts.push(<span key={key++}>{remaining.slice(idx)}</span>); break; }
    parts.push(<strong key={key++} className="font-bold">{remaining.slice(idx + 2, close)}</strong>);
    remaining = remaining.slice(close + 2);
  }
  return <>{parts}</>;
}
