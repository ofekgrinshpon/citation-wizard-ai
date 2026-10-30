import { useEffect, useRef, useState } from "react";

interface MarkedSpan { start: number; end: number; kind: "citation" | "explanation" }

/** The text stays in original UTF-16 coordinates; visual marks add no text. */
export function WordNoteSelection({ text, number, spans, disabled, onSelect }: {
  text: string; number: number; spans: MarkedSpan[]; disabled: boolean;
  onSelect: (start: number, end: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [tapStart,setTapStart]=useState<number|null>(null);
  useEffect(()=>setTapStart(null),[text,disabled]);
  const words=Array.from(text.matchAll(/\S+/gu));
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
      title={span.kind === "citation" ? "תוכן שיישלח לבדיקה" : "הסבר מוגן — לא ישתנה"}
      className={span.kind === "citation" ? "rounded-sm border-b-2 border-blue-600 bg-blue-100 text-blue-950" : "rounded-sm border-b-2 border-dashed border-amber-700 bg-amber-100 text-amber-950"}
    >{text.slice(span.start, span.end)}</mark>);
    offset = span.end;
  }
  if (offset < text.length) pieces.push(<span key={`text-${offset}`}>{text.slice(offset)}</span>);
  return <div className="space-y-3">
    <p className="text-sm">סמנו טקסט הסבר שתרצו להשאיר ללא שינוי.</p>
    <div ref={root} role="group" aria-label={`טקסט ההערה ${number} עם הסימונים`}
      className={`whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-4 text-base leading-8 ${disabled ? "select-none opacity-60" : "select-text"}`}>{pieces}</div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-foreground">
      <span><span aria-hidden="true" className="mr-1 inline-block h-3 w-3 border-b-2 border-blue-600 bg-blue-100" /> תוכן לבדיקה</span>
      <span><span aria-hidden="true" className="mr-1 inline-block h-3 w-3 border-b-2 border-dashed border-amber-700 bg-amber-100" /> הסבר מוגן (רשות)</span>
    </div>
    <details className="text-sm">
      <summary className="cursor-pointer rounded py-2 text-primary focus-visible:outline focus-visible:outline-2">סימון בלחיצות — גם בנייד</summary>
      <p className="py-2">לחצו על המילה הראשונה של ההסבר ולאחר מכן על האחרונה. למילה אחת, לחצו עליה פעמיים. אחר כך אשרו שזה טקסט הסבר.</p>
      <p role="status" className="text-sm">{tapStart===null?"בחרו את המילה הראשונה":"כעת בחרו את המילה האחרונה"}</p>
      <div className="flex flex-wrap gap-1 rounded-lg border p-2" aria-label="בחירת גבולות הסבר בלחיצות">
        {words.map((word,index)=><button key={word.index} type="button" aria-label={`מילה ${index+1}: ${word[0]}`} aria-pressed={tapStart===index} disabled={disabled}
          className="min-h-11 rounded border px-2 py-2 text-base aria-pressed:bg-primary/20 disabled:opacity-50"
          onClick={()=>{if(tapStart===null){setTapStart(index);return;}const first=words[Math.min(tapStart,index)],last=words[Math.max(tapStart,index)];onSelect(first.index!,last.index!+last[0].length);setTapStart(null);}}>{word[0]}</button>)}
      </div>
      {tapStart!==null && <button type="button" className="min-h-11 underline" disabled={disabled} onClick={()=>setTapStart(null)}>בטל בחירת התחלה</button>}
    </details>
    <details className="text-sm">
      <summary className="cursor-pointer rounded py-2 text-primary focus-visible:outline focus-visible:outline-2">עזרה אופציונלית: סימון במקלדת</summary>
      <p className="mb-2 text-muted-foreground">אפשר לסמן ישירות בטקסט שמעל. אם נוח לכם להשתמש במקלדת: עברו לתיבה, סמנו בעזרת Shift והחצים, ואז עברו באמצעות Tab אל ״זה טקסט הסבר — לא לשנות״.</p>
      <textarea aria-label={`טקסט מקורי של הערה ${number}`} readOnly value={text} disabled={disabled}
        className="min-h-24 w-full rounded-lg border border-border bg-background p-3 text-base leading-7 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onSelect={event => onSelect(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)} />
    </details>
  </div>;
}
