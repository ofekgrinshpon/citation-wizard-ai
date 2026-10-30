import { ForeignSourcePicker } from "./ForeignSourcePicker";
import { isForeignSourceType } from "@/data/bluebook/types";
import type { GenerationPlan, ClassificationRecord } from "@/lib/foreignClassification";
import { planWordFootnote, hasMultipleSourceSignals } from "@/lib/wordFootnotePlan";
import { CitationRequestStatusLink } from "./CitationRequestStatusLink";
import { WordNoteSelection } from "./WordNoteSelection";
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
type Row = ReviewCardCell & { classification?: GenerationPlan | null; classificationRecord?: ClassificationRecord; noteId: string; originalText: string; start: number; end: number; crossesRuns?: boolean; allowFormattingNormalization?: boolean };
const button = "min-h-11 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primaryButton = `${button} border-primary bg-primary text-primary-foreground hover:bg-primary/90`;
const steps = ["בחירת מסמך", "טקסט הסבר שלא לשנות", "בדיקת תיקונים", "הורדת עותק"];

/** Files and extracted text live only in this mounted panel, never localStorage.
 * Generation uses the existing server protocol. Import/export never call providers.
 */
export function WordFootnoteWorkflow({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { user } = useAuth();
  const { currentProject } = useProjects();
  const [session, setSession] = useState<Session | null>(null);
  const [filename, setFilename] = useState("");
  const [step, setStep] = useState(0);
  const [activeNote, setActiveNote] = useState(0);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { stepHeading.current?.focus(); }, [step]);
  const [rows, setRows] = useState<Row[]>([]);
  const [protectedSpans, setProtectedSpans] = useState<Span[]>([]);
  const [selection, setSelection] = useState<Span | null>(null);

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
    setStep(0); setActiveNote(0); setEditingRow(null);
    lock.current = false;
    setBusy(false); setSession(null); setRows([]); setProtectedSpans([]); setSelection(null); setFilename(""); setError(""); setNotice("");
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
      setSession(inspected); setFilename(file.name); setStep(1);
      setRows(inspected.notes.flatMap((note, index) => {
        const plan = planWordFootnote(note, []);
        return plan.kind === "candidate" ? [{id:index+1,noteId:note.id,originalText:note.text,...plan,output:null,status:"empty" as const,approved:false}] : [];
      }));
      setNotice("");
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
    setSelection(old => old?.noteId === noteId && old.start === start && old.end === end ? old : { noteId, start, end }); setError("");
  };
  const updateProtection = (next: Span[], noteId: string) => {
    if (lock.current || !session) return;
    const note = session.notes.find(n => n.id === noteId)!;
    const plan = planWordFootnote(note, next.filter(s => s.noteId === noteId));
    epoch.current++;
    setProtectedSpans(next);
    setRows(old => [...old.filter(row => row.noteId !== noteId), ...(plan.kind === "candidate" ? [{
      id:session.notes.indexOf(note)+1,noteId,originalText:note.text,...plan,
      output:null,status:"empty" as const,approved:false,allowFormattingNormalization:false,
    }] : [])].sort((a,b) => a.id-b.id));
    setSelection(null); setEditingRow(null); setError(""); setNotice("");
  };
  const markSelection = () => {
    if (lock.current || !selection || !session) return;
    if (protectedSpans.length >= 1000 && editingRow === null) { setError("ניתן לסמן עד 1,000 קטעי הסבר."); return; }
    const remaining = protectedSpans.filter((_, index) => index !== editingRow);
    if (remaining.some(span => overlaps(span, selection))) { setError("הבחירה חופפת לטקסט הסבר שכבר סומן."); return; }
    updateProtection([...remaining, selection], selection.noteId);
  };
  const changeRow = (id: number, update: Partial<Row>) => {
    if (lock.current) return;
    setRows(old => old.map(row => row.id === id ? { ...row, ...update, approved: false, completion: undefined, pastedCitation: undefined,
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
        const result = await runCitation({ rawInput: row.input, overrideType: row.classification?.sourceType ?? row.sourceTypeOverride, manualChoice: row.classification?.manualChoice,
          projectId: currentProject?.id, useVerifiedStore: true, isResultCurrent: isCurrent,
          telemetry: sourceTelemetry(batch) });
        if (owner === currentScope.current) blockedNotes.current.delete(noteKey(row));
        if (!isCurrent()) break;
        if (hasMultipleSourceSignals(citationTextOnly(result.citation))) {
          setRows(old => old.map(r => r.id === row.id ? {...r,output:null,status:"error",approved:false,errorMsg:"התוצאה עשויה לכלול כמה מקורות. נדרש טיפול נוסף; ההערה תישאר ללא שינוי."} : r));
          continue;
        }
        setRows(old => old.map(r => r.id === row.id ? { ...r, output: result.citation,
          completion: result.completion, pastedCitation: result.pastedCitation, status: row.classification?.warning ? "warning" : result.status, detectedType: result.sourceType, warningMsg: [result.warningMsg, row.classification?.warning].filter(Boolean).join(" · ") || undefined, errorMsg: undefined, approved: false } : r));
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
  const note = session?.notes[activeNote];
  const activePlan = note ? planWordFootnote(note, protectedSpans.filter(span => span.noteId === note.id)) : null;
  const noteRows = rows.filter(row => row.noteId === note?.id);
  const readyCount = rows.filter(row => row.input.trim() && (!row.crossesRuns || row.allowFormattingNormalization)
    && !row.output && row.status !== "error" && !blockedNotes.current.has(noteKey(row))).length;
  const goToStep = (next: number) => {
    if (lock.current) return;
    setStep(next); setSelection(null); setEditingRow(null); setError(""); setNotice("");
  };
  const goToNote = (index: number) => {
    if (lock.current) return;
    setActiveNote(index); setSelection(null); setEditingRow(null); setError("");
  };
  const formattingConsent = (row: Row) => row.crossesRuns && <label className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
    <input type="checkbox" aria-label={`אישור איחוד עיצוב באזכור ${row.id}`} className="mt-1 h-5 w-5 shrink-0" disabled={busy}
      checked={!!row.allowFormattingNormalization} onChange={event => changeRow(row.id, { allowFormattingNormalization: event.target.checked })} />
    <span><strong className="block">האזכור כולל כמה עיצובים</strong>אני מאשר/ת שהתיקון יקבל את עיצוב תחילת הקטע. הדגשות ונטייה בתוך האזכור לא יישמרו לפי מיקומן. העיצוב מחוץ לבחירה לא ישתנה.</span>
  </label>;
  return <section aria-label="תיקון הערות שוליים במסמך Word" dir="rtl" className="overflow-hidden rounded-2xl border border-border bg-card text-foreground">
    <header className="space-y-2 border-b border-border p-4 sm:p-6">
      <h3 className="text-xl font-bold">תיקון אזכורים במסמך Word</h3>
      <p className="text-sm leading-6 text-muted-foreground">ההערות מוכנות לבדיקה. סמנו דברי הסבר אם יש, אשרו תיקונים והורידו עותק חדש.</p>
    </header>
    <nav aria-label="שלבי תיקון המסמך" className="border-b border-border bg-muted/30 p-3 sm:px-6">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((label, index) => <li key={label}>
          <button type="button" aria-current={step === index ? "step" : undefined}
            disabled={busy || (index > 0 && !session) || (index === 2 && !session?.notes.length) || (index === 3 && !approvedCount)}
            onClick={() => goToStep(index)} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-right text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 ${step === index ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`}>
            <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${step === index ? "bg-primary text-primary-foreground" : "border border-border bg-background"}`}>{index + 1}</span>{label}
          </button>
        </li>)}
      </ol>
    </nav>
    <div className="space-y-5 p-4 sm:p-6">
      <input ref={inputRef} aria-label="מסמך DOCX" type="file" accept=".docx" disabled={busy} tabIndex={-1}
        onChange={event => void importFile(event.target.files?.[0])} className="hidden" />
      {(session || busy) && <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0 w-full sm:w-auto sm:flex-1"><p className="text-xs text-muted-foreground">{filename ? "המסמך שנבחר" : "קוראים את המסמך…"}</p><p dir="auto" className="break-all text-sm font-semibold">{filename}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => inputRef.current?.click()}>החלפת מסמך</button>
          <button type="button" className={button} onClick={clear}>סגירה וניקוי</button>
        </div>
        <p className="w-full text-xs text-muted-foreground">החלפה או סגירה ימחקו את הסימונים והתיקונים מהמסך. הקובץ המקורי לא ישתנה.</p>
      </div>}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      <h4 ref={stepHeading} tabIndex={-1} className="text-lg font-semibold outline-none">{steps[step]}</h4>
      {step === 0 && <div className="space-y-4">
        <div className="space-y-4 rounded-xl border-2 border-dashed border-primary/25 bg-primary/5 px-4 py-8 text-center">
          <p className="font-medium">בחרו מסמך Word עם הערות שוליים</p>
          <p className="text-sm text-muted-foreground">קובץ DOCX, עד 10 MB. קריאת המסמך מתבצעת במכשיר.</p>
          <button type="button" className={primaryButton} disabled={busy} onClick={() => inputRef.current?.click()}>{session ? "בחירת מסמך אחר" : "בחירת מסמך Word"}</button>
        </div>
        {session && <button type="button" className={button} disabled={busy} onClick={() => goToStep(1)}>המשך עם המסמך שנבחר</button>}
      </div>}
      {session && step > 0 && <>
        <details className="rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer py-1 focus-visible:outline focus-visible:outline-2">פרטי המסמך · {session.notes.length} הערות לבדיקה{session.skippedNotes?.length ? ` · ${session.skippedNotes.length} נשארו ללא שינוי` : ""}</summary>
          <div className="space-y-2 pt-3 text-muted-foreground">
            <p>סדר ההערות כאן הוא סדר הופעתן במסמך; הוא עשוי להיות שונה מהמספר שמוצג ב־Word.</p>
            {session.skippedNotes?.map(skipped => <p key={skipped.id}>הערה במזהה פנימי {skipped.id}: {skipped.reason}</p>)}
            {note && <p>המזהה הפנימי של ההערה הפתוחה: {note.id}.</p>}
            <p>אפשר לתקן אזכור בתוך פסקה אחת. שדות, שינויים במעקב והערות סיום אינם נתמכים. יש לבדוק את העותק ב־Word: הפריסה וההדגשות עשויות להשתנות.</p>
          </div>
        </details>
        {!session.notes.length && <p>לא נמצאו הערות שאפשר לערוך בבטחה. המסמך נשאר ללא שינוי. אפשר לבחור מסמך אחר או להמשיך בהזנה ידנית.</p>}
        {step === 1 && <p className="text-sm leading-6">אין חובה לסמן דבר. <strong>בלי סימוני הסבר, כל תוכן ההערה נשלח למנוע האזכור.</strong> אם יש דברי הסבר, סמנו אותם כדי שלא יישלחו ולא ישתנו. הערות שדורשות פיצול בטוח יישארו ללא שינוי.</p>}
        {step === 2 && <div className="space-y-3 rounded-xl bg-primary/5 p-4">
          <p className="text-sm">מתוכננות עד {readyCount} בקשות לבדיקת הערות. דברי הסבר מוגנים אינם נשלחים. זה אינו מספר המקורות או הבטחה למספר חיובים: המנוע הקיים קובע את פעולות האיתור וההשלמה ואת השימוש במכסת החשבון.</p>
          <button type="button" className={primaryButton} disabled={busy || !readyCount} onClick={() => void generate()}>{busy ? "הבדיקה מתבצעת…" : readyCount ? `בדוק ${readyCount} הערות` : "אין הערות נוספות לבדיקה"}</button>
          {rows.some(row => row.crossesRuns && !row.allowFormattingNormalization) && <p className="text-sm text-amber-900">חלק מהאזכורים כוללים כמה עיצובים. לפני בדיקתם נדרש אישור שינוי העיצוב בכרטיס האזכור.</p>}
        </div>}
        {step === 3 && <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <p className="text-lg font-semibold">{approvedCount} תיקונים אושרו להורדה</p>
          <p className="text-sm leading-6">רק התיקונים שאישרתם ייכנסו לעותק החדש. {rows.length - approvedCount > 0 && `${rows.length - approvedCount} אזכורים שלא אושרו יישארו כפי שהם. `}הקובץ המקורי לא ישתנה.</p>
          <button type="button" className={primaryButton} disabled={busy || !approvedCount} onClick={() => void download()}>הורדת עותק מתוקן ({approvedCount} תיקונים)</button>
          <p className="text-sm">פתחו את העותק ב־Word ובדקו את הנוסח והעיצוב לפני שימוש.</p>
        </div>}
        {note && <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-medium">הערה לבדיקה
              <select aria-label="בחירת הערה" disabled={busy} value={activeNote} onChange={event => goToNote(Number(event.target.value))}
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                {session.notes.map((item, index) => <option key={item.id} value={index}>{index + 1} מתוך {session.notes.length} · {rows.some(row => row.noteId === item.id) ? "מועמדת לבדיקה" : "נשארת ללא שינוי"}</option>)}
              </select>
            </label>
            <div className="flex justify-between gap-2 sm:justify-start">
              <button type="button" className={button} disabled={busy || activeNote === 0} onClick={() => goToNote(activeNote - 1)}>הערה קודמת</button>
              <button type="button" className={button} disabled={busy || activeNote === session.notes.length - 1} onClick={() => goToNote(activeNote + 1)}>הערה הבאה</button>
            </div>
          </div>
          {step === 1 && <>
            <WordNoteSelection key={note.id} text={note.text} number={activeNote + 1} disabled={busy}
              spans={[...noteRows.map(row => ({ ...row, kind: "citation" as const })), ...protectedSpans.filter(span => span.noteId === note.id).map(span => ({ ...span, kind: "explanation" as const }))]}
              onSelect={(start, end) => selectSpan(note.id, start, end)} />
            <div className="space-y-3 rounded-xl bg-muted/40 p-3">
              <p className="text-sm" role="status">{editingRow !== null ? "סמנו מחדש את דברי ההסבר ושמרו." : "סימון הסבר הוא רשות. הטקסט המוגן יישאר במקומו המקורי."}</p>
              {selection?.noteId === note.id && <p className="break-words text-sm"><strong>הקטע שנבחר: </strong>{note.text.slice(selection.start, selection.end)}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryButton} disabled={busy || selection?.noteId !== note.id} onClick={markSelection}>{editingRow === null ? "זה טקסט הסבר — לא לשנות" : "שמור סימון הסבר"}</button>
                {editingRow !== null && <button type="button" className={button} disabled={busy} onClick={() => {setEditingRow(null);setSelection(null);}}>בטל שינוי</button>}
              </div>
            </div>
            {protectedSpans.map((span,index) => span.noteId === note.id && <div key={`${span.start}:${span.end}`} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="break-words">הסבר מוגן: {note.text.slice(span.start,span.end)}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-label={`שינוי הסבר ${index+1}`} className={button} disabled={busy} onClick={() => {setEditingRow(index);setSelection(null);}}>שינוי הסימון</button>
                <button type="button" aria-label={`הסר הגנה ${index+1}`} className={button} disabled={busy} onClick={() => updateProtection(protectedSpans.filter((_,i) => i !== index),note.id)}>הסר הגנה</button>
              </div>
            </div>)}
            {noteRows.map(row => <div key={row.id} className="space-y-2">
              <p className="text-sm font-medium">התוכן שיישלח לבדיקה</p><p className="whitespace-pre-wrap break-words rounded-lg bg-blue-50 p-3 text-sm text-blue-950">{row.input}</p>
              {formattingConsent(row)}
            </div>)}
          </>}
          {activePlan && activePlan.kind !== "candidate" && <div role="status" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">{activePlan.kind === "protected" ? "לא נדרש שינוי" : "דורש טיפול נוסף"}</p><p>{activePlan.reason}</p>
          </div>}
          {blockedNotes.current.has(noteKey({ noteId: note.id, originalText: note.text })) && <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p>יש בקשה שטרם הושלמה בהערה הזו. לא נשלח אותה שוב אוטומטית. סגירה והעלאה מחדש לא יאפשרו בדיקה נוספת לפני בירור התוצאה.</p>
            <CitationRequestStatusLink requestId={blockedNotes.current.get(noteKey({ noteId: note.id, originalText: note.text }))?.requestId} />
          </div>}
          {step === 2 && <>
            <p className="text-sm text-muted-foreground">התוצאה היא הצעה לבדיקה ולא אישור לדיוק משפטי. השוו למקור לפני אישור.</p>
            {noteRows.map(row => <div key={row.id} className="space-y-3">
              {formattingConsent(row)}
              {isForeignSourceType(row.sourceTypeOverride ?? row.detectedType ?? "unknown") && <fieldset disabled={busy}><ForeignSourcePicker transient
                key={`${row.id}:${row.sourceTypeOverride}`} initialRecord={row.classificationRecord} accountId={user?.id} itemKey={`word:${row.id}`} input={row.input} regenerateDisabled={busy}
                onChange={({plan,record}) => {
                  if ((row.classification?.effectiveKey ?? "") !== (plan?.effectiveKey ?? "")) changeRow(row.id,{classification:plan,classificationRecord:record,output:null,status:"empty"});
                }} /></fieldset>}
              <FootnoteReviewCard cell={row} wordOriginal={row.originalText.slice(row.start, row.end)} disabled={busy}
                regenerationDisabled={row.status === "error" || blockedNotes.current.has(noteKey(row)) || (row.crossesRuns && !row.allowFormattingNormalization)} hideRemove
                onInputChange={() => { /* Input is derived exclusively from unprotected document text. */ }}
                onOutputChange={(id, output) => changeRow(id, { output })}
                onSourceTypeChange={(id, sourceTypeOverride) => changeRow(id, { sourceTypeOverride, classification:null, classificationRecord:undefined, output: null, status: "empty" })}
                onApproveToggle={(id, approved) => { if (!lock.current) setRows(old => old.map(item => item.id === id ? { ...item, approved: (!item.crossesRuns || !!item.allowFormattingNormalization) && !!item.output && item.status !== "error" && approved } : item)); }}
                onRegenerate={id => { if (rows.find(item => item.id === id)?.status !== "error") void generate(id); }} onRemove={() => {}} />
            </div>)}
          </>}
          {step >= 2 && <details open={step === 3} className="rounded-xl border border-border p-3 text-sm" key={`preview-${step}-${note.id}`}>
            <summary className="cursor-pointer py-1 font-medium focus-visible:outline focus-visible:outline-2">כך תיראה ההערה בעותק החדש</summary>
            <p className="mt-2 text-muted-foreground">מוצגים רק תיקונים שאושרו.</p>
            <pre aria-label={`תצוגת הערה ${activeNote + 1}`} className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-base leading-7">{preview(note.id, note.text)}</pre>
          </details>}
        </div>}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <button type="button" className={button} disabled={busy} onClick={() => goToStep(step - 1)}>חזרה ל{steps[step - 1]}</button>
          {step === 1 && <button type="button" className={primaryButton} disabled={busy || !session.notes.length} onClick={() => goToStep(2)}>המשך לבדיקת ההערות</button>}
          {step === 2 && <button type="button" className={primaryButton} disabled={busy || !approvedCount} onClick={() => goToStep(3)}>המשך להורדה · {approvedCount} אושרו</button>}
        </footer>
      </>}
    </div>
  </section>;
}
