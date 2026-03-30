interface FormattedCitationProps {
  text: string;
  highlightMissing?: boolean;
}

export function FormattedCitation({ text, highlightMissing }: FormattedCitationProps) {
  const parts: JSX.Element[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Find next marker: **, ##, or [חסר:
    const boldIdx = remaining.indexOf("**");
    const italicIdx = remaining.indexOf("##");
    const missingIdx = highlightMissing ? remaining.indexOf("[חסר:") : -1;

    const indices = [boldIdx, italicIdx, missingIdx].filter((i) => i !== -1);

    if (indices.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    const nextIdx = Math.min(...indices);

    // Find which marker is next
    let nextType: "bold" | "italic" | "missing";
    if (nextIdx === boldIdx) nextType = "bold";
    else if (nextIdx === italicIdx) nextType = "italic";
    else nextType = "missing";

    if (nextIdx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, nextIdx)}</span>);
    }

    if (nextType === "missing") {
      const closeIdx = remaining.indexOf("]", nextIdx);
      if (closeIdx === -1) {
        parts.push(<span key={key++}>{remaining.slice(nextIdx)}</span>);
        break;
      }
      const inner = remaining.slice(nextIdx, closeIdx + 1);
      parts.push(
        <span
          key={key++}
          className="bg-destructive/20 text-destructive px-1 py-0.5 rounded text-xs font-medium"
        >
          {inner}
        </span>
      );
      remaining = remaining.slice(closeIdx + 1);
      continue;
    }

    const marker = nextType === "bold" ? "**" : "##";
    const closeIdx = remaining.indexOf(marker, nextIdx + 2);
    if (closeIdx === -1) {
      parts.push(<span key={key++}>{remaining.slice(nextIdx)}</span>);
      break;
    }
    const inner = remaining.slice(nextIdx + 2, closeIdx);
    if (nextType === "bold") {
      parts.push(
        <strong key={key++} className="font-bold">
          {inner}
        </strong>
      );
    } else {
      parts.push(
        <em key={key++} className="italic">
          {inner}
        </em>
      );
    }
    remaining = remaining.slice(closeIdx + 2);
  }

  return <>{parts}</>;
}
