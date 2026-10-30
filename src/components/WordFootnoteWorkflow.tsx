import { CitationRequestStatusLink } from "./CitationRequestStatusLink";
import { useEffect, useRef, useState } from "react";
import { FootnoteReviewCard, type ReviewCardCell } from "./FootnoteReviewCard";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { runCitation } from "@/lib/runCitation";
import { citationTextOnly } from "@/lib/citationSegments";
import { newTelemetryBatch, sourceTelemetry } from "@/lib/costTelemetry";
import { inspectDocxFootnotes, embedApprovedFootnotes } from "@/lib/docxFootnoteRoundtrip";

type Session = Awaited<ReturnType<typeof inspectDocxFootnotes>>;
type Span = { noteId: string; start: number; end: number };
type Row = ReviewCardCell & { noteId: string; originalText: string; start: number; end: number; crossesRuns?: boolean; allowFormattingNormalization?: boolean };
const button = "rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40";

/** Files and extracted text live only in this mounted panel, never localStorage.
 * Generation uses the existing server protocol. Import/export never call providers.
 */
export function WordFootnoteWorkflow({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { user } = useAuth();
  const { currentProject } = useProjects();
  const [session, setSession] = useState<Session | null>(null);
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [protectedSpans, setProtectedSpans] = useState<Span[]>([]);
  const [selection, setSelection] = useState<Span | null>(null);
  const nextRowId = useRef(1);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const lock = useRef(false);
  // Keep uncertain/failed request identity across clear/reimport in this account/project.
  // This panel deliberately offers no retry authority of its own.
  const blockedNotes = useRef(new Map<string, { requestId?: string; message: string }>());
  const noteKey = (row: Pick<Row, "noteId" | "originalText">) => `${row.noteId}:${row.originalText}`;
  const scope = `${user?.id ?? ""}:${currentProject?.id ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = () => {
    epoch.current++;
    lock.current = false;
    setBusy(false); setSession(null); setRows([]); setProtectedSpans([]); setSelection(null); nextRowId.current = 1; setFilename(""); setError(""); setNotice("");
    if (inputRef.current) inputRef.current.value = "";
  };
  const invalidate = () => { epoch.current++; };
  useEffect(() => { blockedNotes.current.clear(); clear(); return invalidate; }, [scope]);

  const importFile = async (file: File | undefined) => {
    if (!file || lock.current) return;
    clear();
    if (!/\.docx$/i.test(file.name)) { setError("יש לבחור קובץ DOCX בלבד."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("הקובץ גדול מדי. המגבלה היא 10 MB."); return; }
    lock.current = true; setBusy(true);
    const version = epoch.current;
    const owner = scope;
    try {
      const inspected = await inspectDocxFootnotes(await file.arrayBuffer());
      if (version !== epoch.current || owner !== currentScope.current) return;
      setSession(inspected); setFilename(file.name);
      setRows([]);
      setNotice("המסמך נקרא במכשיר. סמנו בכל הערה את האזכור לתיקון; שאר הטקסט יישאר ללא שינוי.");
    } catch (e) {
      if (version === epoch.current) setError(e instanceof Error ? e.message : "לא ניתן לקרוא את המסמך.");
    } finally { if (version === epoch.current) { lock.current = false; setBusy(false); } }
  };

  const overlaps = (a: Span, b: Span) => a.noteId === b.noteId && a.start < b.end && b.start < a.end;
  const selectSpan = (noteId: string, start: number, end: number) => {
    if (lock.current || start === end) return;
    const note = session?.notes.find(n => n.id === noteId);
    if (!note || start < 0 || end > note.text.length || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(note.text.slice(start, end))) {
      setSelection(null); setError("הבחירה חוצה תו שאינו נתמך. יש לבחור תווים שלמים."); return;
    }
    setSelection({ noteId, start, end }); setError("");
  };
  const markSelection = (kind: "citation" | "explanation", replaceId?: number) => {
    if (lock.current || !selection || !session) return;
    if ((kind === "explanation" && protectedSpans.length >= 1000) || (kind === "citation" && replaceId === undefined && rows.length >= 1000)) {
      setError("ניתן לסמן עד 1,000 אזכורים ועד 1,000 קטעי הסבר במסמך."); return;
    }
    const note = session.notes.find(n => n.id === selection.noteId)!;
    if (protectedSpans.some(s => overlaps(s, selection)) || rows.some(r => r.id !== replaceId && overlaps(r, selection))) {
      setError("הבחירה חופפת לאזכור או לטקסט הסבר שכבר סומנו. שנו את הגבולות או הסירו את הסימון הקודם."); return;
    }
    if (kind === "explanation") {
      setProtectedSpans(old => [...old, selection]); setSelection(null); setError(""); return;
    }
    if (blockedNotes.current.has(noteKey({ noteId: note.id, originalText: note.text }))) {
      setError("קיימת בקשה שלא הושלמה להערה זו. בדקו את מצב הבקשה לפני ניסיון נוסף."); return;
    }
    const ranges = note.editableRanges.filter(range => range.end > selection.start && range.start < selection.end);
    const covered = ranges.length > 0 && selection.start >= ranges[0].start && selection.end <= ranges[ranges.length - 1].end
      && ranges.every((range, i) => i === 0 || range.start === ranges[i - 1].end);
    if (!covered) { setError("הקטע חוצה פסקאות או מבנה שאינו נתמך. סמנו אזכור בתוך פסקה אחת; לא נשלחה בקשת בדיקה."); return; }
    const updated = { ...selection, originalText: note.text, input: note.text.slice(selection.start, selection.end),
      output: null, status: "empty" as const, approved: false, crossesRuns: ranges.length > 1, allowFormattingNormalization: false,
      errorMsg: undefined, warningMsg: undefined, requestId: undefined };
    setRows(old => replaceId === undefined ? [...old, { id: nextRowId.current++, ...updated }] : old.map(r => r.id === replaceId ? { ...r, ...updated } : r));
    setSelection(null); setError(""); setNotice("");
  };
  const changeRow = (id: number, update: Partial<Row>) => {
    if (lock.current) return;
    setRows(old => old.map(row => row.id === id ? { ...row, ...update, approved: false,
      ...(blockedNotes.current.has(noteKey(row)) ? { status: "error" as const, requestId: blockedNotes.current.get(noteKey(row))!.requestId, errorMsg: blockedNotes.current.get(noteKey(row))!.message } : {}) } : row));
  };
  const generate = async (onlyId?: number) => {
    if (lock.current || !session) return;
    const selected = rows.filter(row => row.end > row.start && row.input.trim() && (!row.crossesRuns || row.allowFormattingNormalization) && !blockedNotes.current.has(noteKey(row)) && (onlyId === undefined ? !row.output && row.status !== "error" : row.id === onlyId));
    if (!selected.length) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const version = epoch.current;
    const owner = scope;
    const isCurrent = () => version === epoch.current && owner === currentScope.current;
    const batch = newTelemetryBatch("footnotes");
    // Sequential, no automatic retry. Reset/navigation invalidate delivery and further dispatch.
    for (const row of selected) {
      if (!isCurrent()) break;
      if (blockedNotes.current.has(noteKey(row))) continue;
      setRows(old => old.map(r => r.id === row.id ? { ...r, status: "loading", approved: false } : r));
      blockedNotes.current.set(noteKey(row), { message: "בקשה זו עדיין בטיפול. אין ליצור ניסיון נוסף לפני בירור התוצאה." });
      try {
        const result = await runCitation({ rawInput: row.input, overrideType: row.sourceTypeOverride,
          projectId: currentProject?.id, useVerifiedStore: true, isResultCurrent: isCurrent,
          telemetry: sourceTelemetry(batch) });
        if (owner === currentScope.current) blockedNotes.current.delete(noteKey(row));
        if (!isCurrent()) break;
        setRows(old => old.map(r => r.id === row.id ? { ...r, output: result.citation,
          status: result.status, detectedType: result.sourceType, warningMsg: result.warningMsg, errorMsg: undefined, approved: false } : r));
      } catch (e) {
        const failure = e && typeof e === "object" ? e as { requestId?: string; userMessage?: string } : {};
        const requestId = failure.requestId;
        const message = failure.userMessage || "ההפקה לא הושלמה. לא ננסה שוב אוטומטית.";
        if (owner === currentScope.current) {
          blockedNotes.current.set(noteKey(row), { requestId, message });
          // May update status only for the exact same reimported note, never deliver stale text.
          setRows(old => old.map(r => r.id === row.id && noteKey(r) === noteKey(row) ? { ...r, status: "error", requestId, errorMsg: message, approved: false } : r));
        }
        if (!isCurrent()) break;
        setRows(old => old.map(r => r.id === row.id ? { ...r, status: "error", output: null, requestId, errorMsg: message, approved: false } : r));
      }
    }
    if (isCurrent()) { lock.current = false; setBusy(false); }
  };

  const download = async () => {
    if (!session || lock.current) return;
    const approved = rows.filter(r => r.approved && r.output && r.status !== "error" && r.end > r.start);
    if (!approved.length) return;
    lock.current = true; setBusy(true); setError("");
    const version = epoch.current;
    const owner = scope;
    try {
      const bytes = await embedApprovedFootnotes(session, approved.map(r => ({ id: r.noteId, originalText: r.originalText,
        start: r.start, end: r.end, replacement: citationTextOnly(r.output!), approved: true, ...(r.crossesRuns ? { allowFormattingNormalization: r.allowFormattingNormalization } : {}) })), protectedSpans.map(p => ({ ...p, id: p.noteId, originalText: session.notes.find(n => n.id === p.noteId)!.text })));
      if (version !== epoch.current || owner !== currentScope.current) return;
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url;
      link.download = filename.replace(/\.docx$/i, "") + "-ReLex.docx";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`הוכן עותק עם ${approved.length} תיקונים שאושרו. פתחו ב־Word ובדקו את המסמך לפני שימוש.`);
    } catch (e) { if (version === epoch.current) setError(e instanceof Error ? e.message : "לא ניתן להטמיע את התיקונים."); }
    finally { if (version === epoch.current) { lock.current = false; setBusy(false); } }
  };

  const approvedCount = rows.filter(r => r.approved && r.output && r.status !== "error").length;
  const preview = (noteId: string, text: string) => {
    for (const row of rows.filter(r => r.noteId === noteId && r.approved && r.output && r.status !== "error").sort((a,b) => b.start-a.start))
      text = text.slice(0,row.start) + citationTextOnly(row.output!) + text.slice(row.end);
    return text;
  };
  return <section aria-label="תיקון הערות שוליים במסמך Word" dir="rtl" className="space-y-4 rounded-xl border border-border p-4">
    <h4 className="font-semibold">העלאת מסמך Word והטמעת תיקונים</h4>
    <p className="text-sm text-muted-foreground">סמנו אזכורים לתיקון וטקסט הסבר להגנה. טקסט שלא סומן נשאר ללא שינוי — הוא לא נחשב אוטומטית למקור. רק תיקונים שאושרו יוטמעו בעותק חדש.</p>
    <p className="text-sm text-muted-foreground">החילוץ וההטמעה מקומיים. בהפקת טיוטות רק טקסט האזכורים שסימנתם יישלח למנגנון הבדיקה הרגיל בכפוף למכסה הקיימת. הסימונים אינם נשמרים לאחר סגירה. אין הבטחה לפריסה זהה או לעמידה בכללי הדגשה.</p>
    <label className="block">מסמך DOCX<input ref={inputRef} aria-label="מסמך DOCX" type="file" accept=".docx" disabled={busy} onChange={e => void importFile(e.target.files?.[0])} className="block mt-2" /></label>
    {(session || busy) && <button type="button" className={button} onClick={clear}>סגור מסמך ונקה</button>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {session && <>
      <p>{filename} · {session.notes.length} הערות ניתנות לעריכה · {session.skippedNotes?.length ?? 0} הערות דולגו ויישארו במקור.</p>
      {session.skippedNotes?.map(n => <p key={n.id} className="text-sm">הערה במזהה {n.id} דולגה: {n.reason}</p>)}
      <p className="text-xs">ניתן לסמן כמה אזכורים וכמה קטעי הסבר בכל הערה. כל אזכור צריך להיות בתוך פסקה אחת. שדות, שינויים במעקב ומבנים מסוכנים עשויים למנוע עיבוד המסמך כולו.</p>
      {session.notes.map((note, index) => <div key={note.id} className="space-y-2 border-t border-border pt-3">
        <label className="block">פריט לעריכה {index + 1} (מזהה הערה {note.id}, לא המספור המוצג במסמך): בחרו קטע ואז סמנו את תפקידו
          <textarea aria-label={`טקסט מקורי של הערה ${index + 1}`} readOnly value={note.text} disabled={busy} className="block w-full min-h-20 rounded border p-2"
            onSelect={e => selectSpan(note.id,e.currentTarget.selectionStart,e.currentTarget.selectionEnd)} />
        </label>
        <button type="button" className={button} disabled={busy} onClick={() => selectSpan(note.id,0,note.text.length)}>בחר את כל ההערה</button>
        {selection?.noteId === note.id && <div>
          <p>הקטע שנבחר: {note.text.slice(selection.start,selection.end)}</p>
          <button type="button" className={button} disabled={busy} onClick={() => markSelection("citation")}>סמן כאזכור לתיקון</button>
          <button type="button" className={button} disabled={busy} onClick={() => markSelection("explanation")}>סמן כטקסט הסבר מוגן</button>
        </div>}
        {protectedSpans.filter(p => p.noteId === note.id).map(p => <div key={`${p.start}:${p.end}`} className="rounded border p-2">
          <span>טקסט הסבר מוגן: {note.text.slice(p.start,p.end)}</span>
          <button type="button" className={button} disabled={busy} onClick={() => setProtectedSpans(old => old.filter(s => s !== p))}>הסר הגנת הסבר</button>
        </div>)}
        {blockedNotes.current.has(noteKey({noteId:note.id,originalText:note.text})) && <CitationRequestStatusLink requestId={blockedNotes.current.get(noteKey({noteId:note.id,originalText:note.text}))?.requestId} />}
        {rows.filter(r => r.noteId === note.id).map(row => <div key={row.id} className="space-y-2 rounded border p-2">
          <p className="text-xs">אזכור {row.id} — רק הקטע המסומן יוחלף: {row.originalText.slice(row.start,row.end)}</p>
          <button type="button" className={button} disabled={busy || selection?.noteId !== note.id} onClick={() => markSelection("citation",row.id)}>עדכן גבולות אזכור {row.id} לבחירה</button>
          <button type="button" className={button} disabled={busy} onClick={() => setRows(old => old.filter(r => r.id !== row.id))}>הסר סימון אזכור {row.id}</button>
          {row.crossesRuns && <label className="block rounded border p-2 text-sm">
            <input type="checkbox" aria-label={`אישור איחוד עיצוב באזכור ${row.id}`} disabled={busy} checked={!!row.allowFormattingNormalization} onChange={e => changeRow(row.id,{allowFormattingNormalization:e.target.checked})} />
            אני מאשר/ת שהאזכור המתוקן יקבל את עיצוב תחילת הקטע שנבחר. הדגשות ונטייה בתוך האזכור לא יישמרו לפי מיקומן; הטקסט שמחוץ לבחירה ועיצובו יישארו ללא שינוי.
          </label>}
          <FootnoteReviewCard cell={row} disabled={busy} regenerationDisabled={row.status === "error" || (row.crossesRuns && !row.allowFormattingNormalization)} hideRemove
            onInputChange={(id,input) => changeRow(id,{input,output:null,status:"empty"})}
            onOutputChange={(id,output) => changeRow(id,{output})}
            onSourceTypeChange={(id,sourceTypeOverride) => changeRow(id,{sourceTypeOverride,output:null,status:"empty"})}
            onApproveToggle={(id,approved) => { if (!lock.current) setRows(old => old.map(r => r.id === id ? {...r,approved:(!r.crossesRuns || !!r.allowFormattingNormalization) && !!r.output && r.status !== "error" && approved} : r)); }}
            onRegenerate={id => { if (rows.find(r => r.id === id)?.status !== "error") void generate(id); }} onRemove={() => {}} />
          {row.status === "error" && <p>אין ניסיון חוזר אוטומטי לאחר שגיאה. בדקו את מצב הבקשה.</p>}
        </div>)}
        <label className="block">תצוגה מקדימה של כל ההערה — תיקונים מאושרים בלבד
          <pre aria-label={`תצוגת הערה ${index+1}`} className="whitespace-pre-wrap rounded bg-muted p-2 font-sans">{preview(note.id,note.text)}</pre>
        </label>
      </div>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || !rows.some(r => r.end > r.start && (!r.crossesRuns || r.allowFormattingNormalization) && !r.output && r.status !== "error" && !blockedNotes.current.has(noteKey(r)))} onClick={() => void generate()}>הפק טיוטות לאזכורים שסומנו</button>
        <button type="button" className={button} disabled={busy || !approvedCount} onClick={() => void download()}>הטמע {approvedCount} תיקונים שאושרו והורד עותק</button>
      </div>
    </>}
  </section>;
}
