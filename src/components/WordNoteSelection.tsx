import { useEffect, useRef } from "react";

interface MarkedSpan { start: number; end: number; kind: "citation" | "explanation" }

/** The text stays in original UTF-16 coordinates; visual marks add no text. */
export function WordNoteSelection({ text, number, spans, disabled, onSelect }: {
  text: string; number: number; spans: MarkedSpan[]; disabled: boolean;
  onSelect: (start: number, end: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const readSelection = () => {
      const selection = window.getSelection(), element = root.current;
      if (disabled || !element || !selection || selection.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
      const before = range.cloneRange(); before.selectNodeContents(element);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length, end = start + range.toString().length;
      if (end <= text.length) onSelect(start, end);
    };
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [disabled, text, onSelect]);

  const pieces = [];
  let offset = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start > offset) pieces.push(<span key={`text-${offset}`}>{text.slice(offset, span.start)}</span>);
    pieces.push(<mark key={`${span.start}-${span.end}`} data-kind={span.kind}
      title={span.kind === "citation" ? "אזכור שנבחר לבדיקה" : "הסבר מוגן — לא ישתנה"}
      className={span.kind === "citation" ? "rounded-sm border-b-2 border-blue-600 bg-blue-100 text-blue-950" : "rounded-sm border-b-2 border-dashed border-amber-700 bg-amber-100 text-amber-950"}
    >{text.slice(span.start, span.end)}</mark>);
    offset = span.end;
  }
  if (offset < text.length) pieces.push(<span key={`text-${offset}`}>{text.slice(offset)}</span>);
  return <div className="space-y-3">
    <div ref={root} role="group" aria-label={`טקסט ההערה ${number} עם הסימונים`}
      className={`whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-4 text-base leading-8 ${disabled ? "select-none opacity-60" : "select-text"}`}>{pieces}</div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-foreground">
      <span><span aria-hidden="true" className="mr-1 inline-block h-3 w-3 border-b-2 border-blue-600 bg-blue-100" /> אזכור לבדיקה</span>
      <span><span aria-hidden="true" className="mr-1 inline-block h-3 w-3 border-b-2 border-dashed border-amber-700 bg-amber-100" /> הסבר מוגן (רשות)</span>
    </div>
    <details className="text-sm">
      <summary className="cursor-pointer rounded py-2 text-primary focus-visible:outline focus-visible:outline-2">בחירה באמצעות מקלדת</summary>
      <p className="mb-2 text-muted-foreground">עברו לתיבה, סמנו טקסט בעזרת Shift והחצים, ואז עברו בכפתור Tab אל ״הוסף לרשימת הבדיקה״.</p>
      <textarea aria-label={`טקסט מקורי של הערה ${number}`} readOnly value={text} disabled={disabled}
        className="min-h-24 w-full rounded-lg border border-border bg-background p-3 text-base leading-7 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onSelect={event => onSelect(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)} />
    </details>
  </div>;
}
