export function FormattedCitation({ text }: { text: string }) {
  const parts: JSX.Element[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldIdx = remaining.indexOf("**");
    const italicIdx = remaining.indexOf("##");

    if (boldIdx === -1 && italicIdx === -1) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    let nextIdx: number;
    let nextType: "bold" | "italic";
    if (boldIdx !== -1 && (italicIdx === -1 || boldIdx < italicIdx)) {
      nextIdx = boldIdx;
      nextType = "bold";
    } else {
      nextIdx = italicIdx;
      nextType = "italic";
    }

    if (nextIdx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, nextIdx)}</span>);
    }

    const marker = nextType === "bold" ? "**" : "##";
    const closeIdx = remaining.indexOf(marker, nextIdx + 2);
    if (closeIdx === -1) {
      parts.push(<span key={key++}>{remaining.slice(nextIdx)}</span>);
      break;
    }
    const inner = remaining.slice(nextIdx + 2, closeIdx);
    if (nextType === "bold") {
      parts.push(<strong key={key++} className="font-bold">{inner}</strong>);
    } else {
      parts.push(<em key={key++} className="italic">{inner}</em>);
    }
    remaining = remaining.slice(closeIdx + 2);
  }

  return <>{parts}</>;
}
