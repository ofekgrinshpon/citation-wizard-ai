import { FormattedCitation } from "@/components/FormattedCitation";
import { mapWordSources, validateWordSource, type WordMappedSource } from "@/lib/wordSourceMap";
import { proposeWordRepeats, invalidateWordDependents } from "@/lib/wordRepeatContext";
import { ForeignSourcePicker } from "./ForeignSourcePicker";
import { isForeignSourceType } from "@/data/bluebook/types";
import type { GenerationPlan, ClassificationRecord } from "@/lib/foreignClassification";
import { planWordFootnote, hasMultipleSourceSignals, isUnboundRepeatReference } from "@/lib/wordFootnotePlan";
import { CitationRequestStatusLink } from "./CitationRequestStatusLink";
import { WordNoteSelection } from "./WordNoteSelection";
import { useEffect, useId, useRef, useState } from "react";
import { FootnoteReviewCard, type ReviewCardCell } from "./FootnoteReviewCard";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { runCitation } from "@/lib/runCitation";
import { selectForeignCaseChoice, WORD_HOST } from "@/lib/citationPlanner";
import { normalizeAbbreviations, SOURCE_TYPE_LABELS } from "@/data/abbreviations";
import { lineDirection } from "@/lib/textDirection";
import { citationTextOnly, escapeCitationLiteral } from "@/lib/citationSegments";
import { newTelemetryBatch, sourceTelemetry } from "@/lib/costTelemetry";
import { inspectDocxFootnotes, embedStyledFootnotes, checkStyledFootnote, checkStyledFootnotes } from "@/lib/docxFootnoteRoundtrip";
import { styleIssueReason } from "@/lib/wordStyleIssue";

type Session = Awaited<ReturnType<typeof inspectDocxFootnotes>>;
type Span = { noteId: string; start: number; end: number };
/** Generic fail-closed notice plus the exact preflight reason, when one is known. */
function StyleIssueNotice({ issue }: { issue: string }) {
  const reason = styleIssueReason(issue);
  return <div className="space-y-1 text-sm text-amber-900">
    <p>לא ניתן לשמור את עיצוב האזכור בבטחה. ההערה תישאר ללא שינוי.</p>
    {reason && <p className="text-xs">הסיבה: {reason}.</p>}
  </div>;
}
type Row = ReviewCardCell & WordMappedSource & { fullOutput?: string | null; repeatProposal?: boolean; classification?: GenerationPlan | null; classificationRecord?: ClassificationRecord; noteId: string; originalText: string; start: number; end: number; crossesRuns?: boolean; needsStyleRevalidation?: boolean; manualDraft?: string; styleIssue?: string | null };
const button = "min-h-11 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primaryButton = `${button} border-primary bg-primary text-primary-foreground hover:bg-primary/90`;
const steps = ["בחירת מסמך", "טקסט הסבר שלא לשנות", "בדיקת תיקונים", "הורדת עותק"];

/** Files and extracted text live only in this mounted panel, never localStorage.
 * Generation uses the existing server protocol. Import/export never call providers.
 */
/** The card's own identification, shown by the foreign classification card when its local detector finds nothing. */
function hostForeignLabel(type: string | undefined): string | undefined {
  if (!type || type === "foreign" || type === "unknown") return undefined;
  return (SOURCE_TYPE_LABELS as Record<string, string>)[type];
}

export function WordFootnoteWorkflow({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { user } = useAuth();
  const { currentProject } = useProjects();
  const noteListId=useId();
  const [session, setSession] = useState<Session | null>(null);
  const [filename, setFilename] = useState("");
  const [step, setStep] = useState(0);
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { stepHeading.current?.focus(); }, [step]);
  const [rows, setRows] = useState<Row[]>([]);
  const [protectedSpans, setProtectedSpans] = useState<Span[]>([]);
  const [selection, setSelection] = useState<Span | null>(null);

  const [busy, setBusy] = useState(false);
  const [batchProgress,setBatchProgress]=useState<{current:number;total:number;stopping:boolean}|null>(null);
  const stopBatch=useRef(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [batchDone, setBatchDone] = useState(false);
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
    setStep(0); setOpenNotes(new Set()); setEditingRow(null);
    lock.current = false;stopBatch.current=false;setBatchProgress(null);
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
      const importedRows=inspected.notes.flatMap((note,index) => mapWordSources(note,[]).sources.map((source,part)=>({
        ...source,id:index+1+part*250,noteId:note.id,originalText:note.text,output:null,status:"empty" as const,approved:false,
      })));
      if(importedRows.length>1000)throw new Error("ניתן לבדוק עד 1,000 מקורות במסמך אחד.");
      setSession(inspected);setFilename(file.name);setStep(1);setRows(importedRows);setOpenNotes(new Set(inspected.notes.length===1?[inspected.notes[0].id]:[]));
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
    if(editingRow!==null && protectedSpans[editingRow]?.noteId!==noteId)setEditingRow(null);
    setSelection(old => old?.noteId === noteId && old.start === start && old.end === end ? old : { noteId, start, end }); setError("");
  };
  const updateProtection = (next: Span[], noteId: string) => {
    if (lock.current || !session) return;
    const note = session.notes.find(n => n.id === noteId)!;
    const plan = mapWordSources(note, next.filter(s => s.noteId === noteId));
    if(rows.filter(r=>r.noteId!==noteId).length+plan.sources.length>1000){setError("ניתן לבדוק עד 1,000 מקורות במסמך אחד.");return;}
    epoch.current++;
    setProtectedSpans(next);
    setRows(old => invalidateWordDependents([...old.filter(row => row.noteId !== noteId), ...plan.sources.map((source,part)=>({
      ...source,id:session.notes.indexOf(note)+1+part*250,noteId,originalText:note.text,
      output:null,status:"empty" as const,approved:false,
    }))],session.notes.map(n=>n.id),noteId).sort((a,b)=>session.notes.findIndex(n=>n.id===a.noteId)-session.notes.findIndex(n=>n.id===b.noteId)||a.start-b.start));
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
    setRows(old => {
      const changed=old.find(row=>row.id===id);if(!changed)return old;
      const invalidated=invalidateWordDependents(old,session?.notes.map(n=>n.id)??[],changed.noteId,changed.start);
      return invalidated.map(row=>row.id===id?{...row,...update,approved:false,completion:undefined,pastedCitation:undefined,foreignChoice:undefined,
        ...(Object.prototype.hasOwnProperty.call(update,"output")?{fullOutput:update.output,repeatProposal:false}:{}),
        ...(blockedNotes.current.has(noteKey(row))?{status:"error" as const,requestId:blockedNotes.current.get(noteKey(row))!.requestId,errorMsg:blockedNotes.current.get(noteKey(row))!.message}:{})}:row);
    });
  };
  const generate = async (onlyId?: number) => {
    if (lock.current || !session) return;
    const selected = rows.filter(row => row.end > row.start && row.input.trim() && !blockedNotes.current.has(noteKey(row)) && (onlyId === undefined ? !row.output && row.status !== "error" && !row.foreignChoice : row.id === onlyId));
    if (!selected.length) return;
    lock.current = true;stopBatch.current=false;setBatchProgress({current:0,total:selected.length,stopping:false}); setBusy(true); setError(""); setNotice(""); setBatchDone(false);
    setRows(old=>{
      let next=old;
      for(const row of selected)next=invalidateWordDependents(next,session.notes.map(n=>n.id),row.noteId,row.start);
      const selectedIds=new Set(selected.map(row=>row.id));
      return next.map(row=>selectedIds.has(row.id)?{...row,approved:false,foreignChoice:undefined,output:row.repeatProposal?(row.fullOutput??row.output):row.output,repeatProposal:false}:row);
    });
    const version = epoch.current;
    const owner = scope;
    const isCurrent = () => version === epoch.current && owner === currentScope.current;
    const batch = newTelemetryBatch("footnotes");
    // Sequential, no automatic retry. Reset/navigation invalidate delivery and further dispatch.
    for (const [index,row] of selected.entries()) {
      if (!isCurrent() || stopBatch.current) break;
      setBatchProgress({current:index+1,total:selected.length,stopping:false});
      if (blockedNotes.current.has(noteKey(row))) continue;
      const original=session.notes.find(n=>n.id===row.noteId);
      if(!original || !validateWordSource(original,protectedSpans.filter(p=>p.noteId===row.noteId),row))continue;
      const originalIssue=await checkStyledFootnote(session,{id:row.noteId,originalText:row.originalText,start:row.start,end:row.end,replacement:escapeCitationLiteral(row.originalText.slice(row.start,row.end)),approved:true},protectedSpans.filter(p=>p.noteId===row.noteId).map(p=>({...p,id:p.noteId,originalText:row.originalText})));
      if(!isCurrent()||stopBatch.current)break;
      if(originalIssue){setRows(old=>old.map(r=>r.id===row.id?{...r,styleIssue:originalIssue,approved:false}:r));continue;}
      setRows(old => old.map(r => r.id === row.id ? { ...r, status: "loading", approved: false } : r));
      blockedNotes.current.set(noteKey(row), { message: "בקשה זו עדיין בטיפול. אין ליצור ניסיון נוסף לפני בירור התוצאה." });
      try {
        const result = await runCitation({ rawInput: row.manualDraft ?? row.input, overrideType: row.classification?.sourceType ?? row.sourceTypeOverride, manualChoice: row.classification?.manualChoice,
          projectId: currentProject?.id, useVerifiedStore: true, isResultCurrent: isCurrent, recordChoices: true,
          telemetry: sourceTelemetry(batch) });
        if (owner === currentScope.current) blockedNotes.current.delete(noteKey(row));
        if (!isCurrent()) break;
        if (hasMultipleSourceSignals(citationTextOnly(result.citation)) || isUnboundRepeatReference(citationTextOnly(result.citation))) {
          setRows(old => old.map(r => r.id === row.id ? {...r,output:null,foreignChoice:undefined,status:"error",approved:false,errorMsg:"התוצאה עשויה לכלול כמה מקורות או הפניה למקור קודם שלא קושר. נדרש טיפול נוסף; ההערה תישאר ללא שינוי."} : r));
          continue;
        }
        const styleIssue=await checkStyledFootnote(session,{id:row.noteId,originalText:row.originalText,start:row.start,end:row.end,replacement:result.citation,approved:true},protectedSpans.filter(p=>p.noteId===row.noteId).map(p=>({...p,id:p.noteId,originalText:row.originalText})));
        if (!isCurrent()) break;
        setRows(old => old.map(r => r.id === row.id ? { ...r, output: result.citation, fullOutput:result.citation, repeatProposal:false,needsStyleRevalidation:false,manualDraft:undefined,styleIssue,
          completion: result.completion, pastedCitation: result.pastedCitation, foreignChoice: result.foreignChoice, status: row.classification?.warning ? "warning" : result.status, detectedType: result.sourceType, warningMsg: [result.warningMsg, row.classification?.warning].filter(Boolean).join(" · ") || undefined, errorMsg: undefined, approved: false } : r));
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
        setRows(old => old.map(r => r.id === row.id ? { ...r, status: "error", output: null, foreignChoice: undefined, requestId, errorMsg: message, approved: false } : r));
      }
    }
    if (isCurrent()) {
      if(!stopBatch.current&&onlyId===undefined&&selected.length){
        // Open every checked note so proposals are visible, and show a completion banner.
        const checked=new Set(selected.map(r=>r.noteId));
        setOpenNotes(old=>new Set([...old,...checked]));
        setBatchDone(true);
      }
      if(stopBatch.current)setNotice("הבדיקה נעצרה; בקשות נוספות לא נשלחו.");stopBatch.current=false;setBatchProgress(null);lock.current = false; setBusy(false); }
  };

  /** Apply a choice between foreign rulings/reports from the records already found. No request is sent. */
  const selectChoice = async (id: number, optionId: string) => {
    if (lock.current || !session) return;
    const row = rows.find(r => r.id === id);
    const choice = row?.foreignChoice;
    if (!row || !choice) return;
    const current = row.manualDraft ?? row.input;
    const outcome = selectForeignCaseChoice(choice, optionId, [current, normalizeAbbreviations(current)], WORD_HOST);
    if (outcome.kind !== "resolved") {
      setRows(old => old.map(r => r.id === id && r.foreignChoice === choice ? { ...r, foreignChoice: undefined, status: "warning", warningMsg: outcome.kind === "stale"
        ? "הנוסח השתנה מאז שהוצגו האפשרויות, ולכן הבחירה בוטלה. יש לבדוק את האזכור שוב."
        : "לא ניתן היה להשתמש באפשרות שנבחרה. יש לבדוק את האזכור שוב." } : r));
      return;
    }
    const res = outcome.resolution;
    if (res.foreignChoice) {
      // The chosen ruling still has parallel reports: ask again, from the same records.
      setRows(old => old.map(r => r.id === id && r.foreignChoice === choice ? { ...r, foreignChoice: res.foreignChoice, status: "warning", warningMsg: res.warningMsg } : r));
      return;
    }
    const citation = res.citation;
    if (!citation.trim() || hasMultipleSourceSignals(citationTextOnly(citation)) || isUnboundRepeatReference(citationTextOnly(citation))) {
      setRows(old => old.map(r => r.id === id && r.foreignChoice === choice ? { ...r, foreignChoice: undefined, output: null, status: "error", approved: false, errorMsg: "לא ניתן היה להשתמש באפשרות שנבחרה. ההערה תישאר ללא שינוי." } : r));
      return;
    }
    lock.current = true; setBusy(true);
    const version = epoch.current;
    const owner = scope;
    try {
      const styleIssue = await checkStyledFootnote(session, { id: row.noteId, originalText: row.originalText, start: row.start, end: row.end, replacement: citation, approved: true },
        protectedSpans.filter(p => p.noteId === row.noteId).map(p => ({ ...p, id: p.noteId, originalText: row.originalText })));
      if (version !== epoch.current || owner !== currentScope.current) return;
      setRows(old => old.map(r => r.id === id && r.foreignChoice === choice ? { ...r, output: citation, fullOutput: citation, repeatProposal: false, needsStyleRevalidation: false, manualDraft: undefined, styleIssue,
        foreignChoice: undefined, completion: res.completion, pastedCitation: res.pastedCitation, status: row.classification?.warning ? "warning" : res.status,
        detectedType: res.sourceType ?? r.detectedType, warningMsg: [res.warningMsg, row.classification?.warning].filter(Boolean).join(" · ") || undefined, errorMsg: undefined, approved: false } : r));
    } finally { if (version === epoch.current) { lock.current = false; setBusy(false); } }
  };

  const download = async () => {
    if (!session || lock.current) return;
    const approved = rows.filter(r => r.approved && r.output && r.status !== "error" && r.end > r.start);
    if (!approved.length) return;
    lock.current = true; setBusy(true); setError("");
    const version = epoch.current;
    const owner = scope;
    try {
      const protectedRecords=protectedSpans.map(p=>({...p,id:p.noteId,originalText:session.notes.find(n=>n.id===p.noteId)!.text}));
      const grouped = new Map<string,typeof approved>();
      for(const row of approved)grouped.set(row.noteId,[...(grouped.get(row.noteId)??[]),row]);
      const safe:typeof approved=[];const skippedIds:string[]=[];
      for(const [id,group] of grouped){
        const patches=group.map(r=>({id:r.noteId,originalText:r.originalText,start:r.start,end:r.end,replacement:r.output!,approved:true}));
        if(await checkStyledFootnotes(session,patches,protectedRecords.filter(p=>p.id===id)))skippedIds.push(id);else safe.push(...group);
      }
      if(version!==epoch.current||owner!==currentScope.current)return;
      if(skippedIds.length)setRows(old=>old.map(r=>skippedIds.includes(r.noteId)?{...r,approved:false,styleIssue:"לא ניתן לשמור את ההערה בבטחה; היא נשארה ללא שינוי."}:r));
      if(!safe.length){setError('לא ניתן לשמור את ההערות שאושרו בבטחה; הן נשארו ללא שינוי.');return;}
      const bytes=await embedStyledFootnotes(session,safe.map(r=>({id:r.noteId,originalText:r.originalText,start:r.start,end:r.end,replacement:r.output!,approved:true})),protectedRecords);
      if (version !== epoch.current || owner !== currentScope.current) return;
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url;
      link.download = filename.replace(/\.docx$/i, "") + "-ReLex.docx";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`הוכן עותק עם ${safe.length} תיקונים שאושרו.${skippedIds.length ? ` הערות ${skippedIds.map(id=>{const index=noteOrder.findIndex(n=>n.id===id),number=noteOrder[index]?.number;return number==null?`במיקום ${index+1} (מספר Word לא ידוע)`:`מספר ${number}`;}).join(", ")} נשארו ללא שינוי כי לא ניתן היה לשמר אותן בבטחה.` : ""} פתחו ב־Word ובדקו את המסמך לפני שימוש.`);
    } catch (e) { if (version === epoch.current) setError(e instanceof Error ? e.message : "לא ניתן להטמיע את התיקונים."); }
    finally { if (version === epoch.current) { lock.current = false; setBusy(false); } }
  };

  const isSafeToApprove = (r: Row) => !r.approved && !!r.output && r.status === "valid" && !r.warningMsg && !r.styleIssue && !r.needsStyleRevalidation && !r.repeatProposal && r.end > r.start;
  const safeCount = rows.filter(isSafeToApprove).length;
  const pendingCount = rows.filter(r => !r.approved && r.output && r.status !== "error").length;
  const approvedCount = rows.filter(r => r.approved && r.output && r.status !== "error").length;
  const preview = (noteId: string, text: string) => {
    let marked='';let cursor=0;
    for(const row of rows.filter(r=>r.noteId===noteId&&r.approved&&r.output&&r.status!=="error").sort((a,b)=>a.start-b.start)){
      marked+=escapeCitationLiteral(text.slice(cursor,row.start))+row.output!;cursor=row.end;
    }
    return marked+escapeCitationLiteral(text.slice(cursor));
  };
  const knownOrder = session?.documentOrder ?? [];
  const knownIds = new Set(knownOrder.map(item=>item.id));
  const noteOrder = session ? [...knownOrder,...[...session.notes,...(session.skippedNotes??[])].filter(n=>!knownIds.has(n.id)).map(n=>({id:n.id,number:null}))] : [];
  const readyRows = rows.filter(row => row.input.trim()
    && !row.output && row.status !== "error" && !row.foreignChoice && !blockedNotes.current.has(noteKey(row)));
  const readyCount=readyRows.length;
  const goToStep = (next: number) => {
    if (lock.current) return;
    setStep(next); setSelection(null); setEditingRow(null); setError(""); setNotice("");
  };
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
            <p>אפשר לתקן אזכור בתוך פסקה אחת. שדות בתוך הערות, שינויים במעקב והערות סיום אינם נתמכים. שדות תוכן עניינים והפניות עמוד בגוף המסמך מותרים רק במבנים שנבדקו.</p>
            {session.warnings?.map((warning, index) => <p key={`document-warning-${index}`}>{warning}</p>)}
          </div>
        </details>
        {!session.notes.length && <p>לא נמצאו הערות שאפשר לערוך בבטחה. המסמך נשאר ללא שינוי. אפשר לבחור מסמך אחר או להמשיך בהזנה ידנית.</p>}
        {step === 1 && <p className="text-sm leading-6">אין חובה לסמן דבר. <strong>בלי סימוני הסבר, כל תוכן ההערה נשלח למנוע האזכור.</strong> אם יש דברי הסבר, סמנו אותם כדי שלא יישלחו ולא ישתנו. הערות שדורשות פיצול בטוח יישארו ללא שינוי.</p>}
        {step === 2 && <div className="space-y-3 rounded-xl bg-primary/5 p-4">
          <p className="text-sm">מתוכננות עד {readyCount} בקשות למקורות מתוך {new Set(readyRows.map(r=>r.noteId)).size} הערות. דברי הסבר מוגנים אינם נשלחים. אין כאן הבטחה למספר חיובים: המנוע הקיים קובע את פעולות האיתור וההשלמה ואת השימוש במכסת החשבון.</p>
          <button type="button" className={primaryButton} disabled={busy || !readyCount} onClick={() => void generate()}>{busy ? "הבדיקה מתבצעת…" : readyCount ? `בדוק ${readyCount} מקורות` : "אין הערות נוספות לבדיקה"}</button>
          {batchProgress && <div role="status" aria-live="polite"><p>{batchProgress.stopping?"העצירה מתבצעת; בקשה שכבר נשלחה תושלם ועשויה להשתמש במכסת החשבון. לא יישלחו בקשות נוספות.":`בודקים מקור ${batchProgress.current} מתוך ${batchProgress.total}.`}</p><button type="button" className={button} disabled={batchProgress.stopping} onClick={()=>{stopBatch.current=true;setBatchProgress(old=>old?{...old,stopping:true}:old);}}>עצור שליחת בקשות נוספות</button></div>}
          {batchDone && !busy && <div role="status" className="rounded-lg border border-primary/30 bg-background p-3 text-sm">
            <p className="font-semibold">בדיקת ההערות הושלמה – {pendingCount} הצעות ממתינות לאישור.</p>
            <p>ההערות שנבדקו נפתחו למטה. עברו על ההצעות ואשרו אותן לפני ההורדה.</p>
          </div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={()=>setOpenNotes(new Set(session.notes.map(n=>n.id)))}>פתח את כל ההערות</button>
            <button type="button" className={button} onClick={()=>setOpenNotes(new Set())}>סגור את כל ההערות</button>
            <button type="button" className={button} disabled={busy || !safeCount} onClick={()=>{
              if(lock.current)return;
              setRows(old=>old.map(r=>isSafeToApprove(r)?{...r,approved:true}:r));
              setNotice(`${safeCount} תיקונים ללא אזהרות אושרו. תיקונים עם אזהרה או בעיה נשארו לאישור ידני.`);
            }}>אשר את כל התיקונים ללא אזהרות ({safeCount})</button>
          </div>
          <button type="button" className={button} disabled={busy || !rows.some(r=>r.output && r.status!=="error")} onClick={()=>{
            setRows(old=>proposeWordRepeats(session,old,protectedSpans));
            setNotice("הצעות לאזכור חוזר מוצגות בכרטיסים ודורשות אישור. כשזהות המקור, ההקשר או המספור אינם ידועים, נשאר הנוסח המלא. שינוי בהערה קודמת מבטל אישורים תלויים.");
          }}>הצע אזכורים חוזרים לבדיקה</button>

        </div>}
        {step === 3 && <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <p className="text-lg font-semibold">{approvedCount} תיקונים אושרו להורדה</p>
          <p className="text-sm leading-6">רק התיקונים שאישרתם ייכנסו לעותק החדש. {rows.length - approvedCount > 0 && `${rows.length - approvedCount} אזכורים שלא אושרו יישארו כפי שהם. `}הקובץ המקורי לא ישתנה.</p>
          <button type="button" className={primaryButton} disabled={busy || !approvedCount} onClick={() => void download()}>הורדת עותק מתוקן ({approvedCount} תיקונים)</button>
          <p className="text-sm">פתחו את העותק ב־Word ובדקו את הנוסח והעיצוב לפני שימוש.</p>
        </div>}
        {(step === 1 || step === 2 || step === 3) && <ol aria-label="רשימת הערות שוליים" className="space-y-3">
          {noteOrder.map((entry,position)=>{
            const note=session.notes.find(n=>n.id===entry.id);const skipped=session.skippedNotes?.find(n=>n.id===entry.id);
            const label=entry.number === null ? `הערה במיקום ${position+1} · מספר Word לא ידוע` : `הערת שוליים ${entry.number}`;
            if(!note)return <li key={entry.id} className="rounded-xl border p-4"><h5 className="font-semibold">{label}</h5><p>נשארת ללא שינוי: {skipped?.reason ?? "לא ניתן לערוך את ההערה בבטחה."}</p></li>;
            const noteRows=rows.filter(row=>row.noteId===note.id);const activePlan=mapWordSources(note,protectedSpans.filter(span=>span.noteId===note.id));
            const expanded=openNotes.has(note.id);const noteEditing=editingRow!==null&&protectedSpans[editingRow]?.noteId===note.id;
            const state=noteRows.some(r=>r.status==='error'||r.styleIssue)?'נשארת ללא שינוי או דורשת טיפול':noteRows.some(r=>r.approved)?'קיים תיקון שאושר':noteRows.some(r=>r.status==='loading')?'בבדיקה':noteRows.some(r=>r.output)?'ממתינה לאישור':activePlan.kind==='mapped'?'מוכנה לבדיקה':'נשארת ללא שינוי';
            return <li key={note.id} className="min-w-0 rounded-xl border border-border p-3 sm:p-4">
              <button type="button" aria-expanded={expanded} aria-controls={`${noteListId}-note-${position}`} className="min-h-11 w-full rounded text-right focus-visible:outline focus-visible:outline-2" onClick={()=>{setOpenNotes(old=>{const next=new Set(old);if(next.has(note.id))next.delete(note.id);else next.add(note.id);return next;});setSelection(null);setEditingRow(null);}}>
                <span className="block font-semibold">{label} · {state}</span><span dir="auto" className="block break-words text-sm text-muted-foreground">{note.text.length>160?note.text.slice(0,160)+'…':note.text}</span>
              </button>
              <div id={`${noteListId}-note-${position}`} role="region" aria-label={label} hidden={!expanded} className="space-y-4 pt-4">{expanded && <>
          {step === 1 && <>
            <WordNoteSelection key={note.id} text={note.text} number={position + 1} displayLabel={entry.number===null?`הערה במיקום ${position+1}`:`הערה ${entry.number}`} disabled={busy}
              spans={[...noteRows.map(row => ({ ...row, kind: "citation" as const })), ...protectedSpans.filter(span => span.noteId === note.id).map(span => ({ ...span, kind: "explanation" as const }))]}
              onSelect={(start, end) => selectSpan(note.id, start, end)} onInvalidSelection={()=>setSelection(old=>old?.noteId===note.id?null:old)} />
            <div className="space-y-3 rounded-xl bg-muted/40 p-3">
              <p className="text-sm" role="status">{noteEditing ? "סמנו מחדש את דברי ההסבר ושמרו." : "סימון הסבר הוא רשות. הטקסט המוגן יישאר במקומו המקורי."}</p>
              {selection?.noteId === note.id && <p className="break-words text-sm"><strong>הקטע שנבחר: </strong>{note.text.slice(selection.start, selection.end)}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-label={session.notes.length>1?`${!noteEditing ? "סמן הסבר" : "שמור סימון הסבר"} · ${label}`:undefined} className={primaryButton} disabled={busy || selection?.noteId !== note.id} onClick={markSelection}>{!noteEditing ? "זה טקסט הסבר — לא לשנות" : "שמור סימון הסבר"}</button>
                {noteEditing && <button type="button" className={button} disabled={busy} onClick={() => {setEditingRow(null);setSelection(null);}}>בטל שינוי</button>}
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
              <p className="text-sm font-medium">התוכן שיישלח לבדיקה</p><p dir={lineDirection(row.input)} className="whitespace-pre-wrap break-words rounded-lg bg-blue-50 p-3 text-start text-sm text-blue-950">{row.input}</p>
              {row.styleIssue && <StyleIssueNotice issue={row.styleIssue} />}
            </div>)}
          </>}
          {activePlan && activePlan.kind !== "mapped" && <div role="status" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">{activePlan.kind === "protected" ? "לא נדרש שינוי" : "דורש טיפול נוסף"}</p><p>{activePlan.reason}</p>
          </div>}
          {blockedNotes.current.has(noteKey({ noteId: note.id, originalText: note.text })) && <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p>יש בקשה שטרם הושלמה בהערה הזו. לא נשלח אותה שוב אוטומטית. סגירה והעלאה מחדש לא יאפשרו בדיקה נוספת לפני בירור התוצאה.</p>
            <CitationRequestStatusLink requestId={blockedNotes.current.get(noteKey({ noteId: note.id, originalText: note.text }))?.requestId} />
          </div>}
          {step === 2 && <>
            <p className="text-sm text-muted-foreground">התוצאה היא הצעה לבדיקה ולא אישור לדיוק משפטי. השוו למקור לפני אישור.</p>
            {noteRows.map(row => <div key={row.id} className="space-y-3">
              {row.repeatProposal && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-950">הצעה לאזכור חוזר לפי ההקשר במסמך — יש לאשר את הנוסח המוצג.</p>}
              {row.styleIssue && <StyleIssueNotice issue={row.styleIssue} />}
              {isForeignSourceType(row.sourceTypeOverride ?? row.detectedType ?? "unknown") && <fieldset disabled={busy}><ForeignSourcePicker transient
                key={`${row.id}:${row.sourceTypeOverride}`} initialRecord={row.classificationRecord} accountId={user?.id} itemKey={`word:${row.id}`} input={row.input} regenerateDisabled={busy}
                hostDetectedLabel={hostForeignLabel(row.sourceTypeOverride ?? row.detectedType)}
                onChange={({plan,record}) => {
                  if ((row.classification?.effectiveKey ?? "") !== (plan?.effectiveKey ?? "")) changeRow(row.id,{classification:plan,classificationRecord:record,output:null,status:"empty"});
                }} /></fieldset>}
              <FootnoteReviewCard cell={row} wordLabel={`מקור ${noteRows.indexOf(row)+1} בהערה הפתוחה`} wordOriginal={row.originalText.slice(row.start, row.end)} wordNeedsRevalidation={!!row.needsStyleRevalidation} wordApprovalDisabled={!!row.styleIssue} disabled={busy}
                regenerationDisabled={row.status === "error" || blockedNotes.current.has(noteKey(row))} hideRemove
                onInputChange={() => { /* Input is derived exclusively from unprotected document text. */ }}
                onOutputChange={(id, output) => changeRow(id, { output, manualDraft:citationTextOnly(output), needsStyleRevalidation:true,styleIssue:null })}
                onSourceTypeChange={(id, sourceTypeOverride) => changeRow(id, { sourceTypeOverride, classification:null, classificationRecord:undefined, output: null, status: "empty" })}
                onApproveToggle={(id,approved)=>{if(!lock.current)setRows(old=>{
                  const changed=old.find(r=>r.id===id);if(!changed)return old;
                  return invalidateWordDependents(old,session.notes.map(n=>n.id),changed.noteId,changed.start).map(item=>item.id===id?{...item,approved:!item.needsStyleRevalidation&&!item.styleIssue&&!!item.output&&item.status!=="error"&&approved}:item);
                });}}
                onRegenerate={id => { if (rows.find(item => item.id === id)?.status !== "error") void generate(id); }} onRemove={() => {}}
                onSelectForeignChoice={(id, optionId) => void selectChoice(id, optionId)} />
            </div>)}
          </>}
          {step >= 2 && <details open={step === 3} className="rounded-xl border border-border p-3 text-sm" key={`preview-${step}-${note.id}`}>
            <summary className="cursor-pointer py-1 font-medium focus-visible:outline focus-visible:outline-2">כך תיראה ההערה בעותק החדש</summary>
            <p className="mt-2 text-muted-foreground">מוצגים רק תיקונים שאושרו.</p>
            <pre aria-label={`תצוגת ${entry.number===null?`הערה במיקום ${position+1}`:`הערה ${entry.number}`}`} dir={lineDirection(preview(note.id, note.text))} className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-start font-sans text-base leading-7"><FormattedCitation text={preview(note.id, note.text)} /></pre>
          </details>}
              </>}</div>
            </li>;
          })}
        </ol>}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <button type="button" className={button} disabled={busy} onClick={() => goToStep(step - 1)}>חזרה ל{steps[step - 1]}</button>
          {step === 1 && <button type="button" className={primaryButton} disabled={busy || !session.notes.length} onClick={() => goToStep(2)}>המשך לבדיקת ההערות</button>}
          {step === 2 && <button type="button" className={primaryButton} disabled={busy || !approvedCount} onClick={() => goToStep(3)}>המשך להורדה · {approvedCount} אושרו</button>}
        </footer>
      </>}
    </div>
  </section>;
}
