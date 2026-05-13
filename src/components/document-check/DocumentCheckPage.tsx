import { useEffect, useRef, useState } from "react";
import { useDocumentCheck, type DocCitation, type DocNote } from "@/hooks/useDocumentCheck";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const STATUS_LABELS: Record<DocCitation["status"], string> = {
  appears_valid: "נראה תקין",
  needs_correction: "דורש תיקון",
  missing_info: "חסר מידע",
  unrecognized: "לא זוהה",
  needs_manual_review: "דורש בדיקה ידנית",
};

const STATUS_TONE: Record<DocCitation["status"], string> = {
  appears_valid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  needs_correction: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  missing_info: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  unrecognized: "bg-muted text-muted-foreground border-border",
  needs_manual_review: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
};

type Filter = "all" | DocCitation["status"] | "repeated";

function buildCorrectedList(notes: DocNote[], decisions: Record<string, DocCitation["user_decision"]>): string {
  const lines: string[] = [];
  for (const n of notes) {
    if (n.note_state === "no_citation_detected" || n.citations.length === 0) {
      lines.push(`ה"ש ${n.note_number}: ${n.original_note_text}`);
      continue;
    }
    const parts: string[] = [];
    for (const c of n.citations) {
      const key = `${n.note_id}:${c.citation_index_in_note}`;
      const d = decisions[key];
      if (d?.kind === "ignore") { parts.push(c.citation_text); continue; }
      if (d?.kind === "edit" && d.value) { parts.push(d.value); continue; }
      if (d?.kind === "accept" && c.suggested_citation) { parts.push(c.suggested_citation); continue; }
      parts.push(c.citation_text);
    }
    lines.push(`ה"ש ${n.note_number}: ${parts.join("; ")}`);
  }
  return lines.join("\n");
}

function buildSummaryReport(notes: DocNote[], summary: NonNullable<ReturnType<typeof useDocumentCheck>["summary"]>): string {
  const lines = [
    "דוח בדיקת מסמך — ReLex",
    "",
    `סה"כ הערות שוליים/סיום: ${summary.notes_count}`,
    `סה"כ אזכורים שזוהו: ${summary.citations_count}`,
    `נראים תקינים: ${summary.appears_valid}`,
    `דורש תיקון: ${summary.needs_correction}`,
    `חסר מידע: ${summary.missing_info}`,
    `דורש בדיקה ידנית: ${summary.needs_manual_review}`,
    `לא זוהה: ${summary.unrecognized}`,
    `אזכורים חוזרים (מועמדים): ${summary.repeated}`,
    `הערות ללא אזכור משפטי: ${summary.no_citation_notes}`,
    "",
  ];
  for (const n of notes) {
    if (n.citations.length === 0) continue;
    lines.push(`— ה"ש ${n.note_number} —`);
    for (const c of n.citations) {
      lines.push(`  • [${STATUS_LABELS[c.status]}] ${c.citation_text}`);
      if (c.suggested_citation && c.suggested_citation !== c.citation_text) {
        lines.push(`    הצעה: ${c.suggested_citation}`);
      }
      if (c.missing_fields.length > 0) {
        lines.push(`    חסר: ${c.missing_fields.join(", ")}`);
      }
    }
  }
  return lines.join("\n");
}

export default function DocumentCheckPage() {
  const dc = useDocumentCheck();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const onPick = () => fileRef.current?.click();
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.docx$/i.test(f.name)) { toast.error("יש להעלות קובץ DOCX בלבד."); return; }
    void dc.upload(f);
  };

  const copy = async (text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(msg); }
    catch { toast.error("ההעתקה נכשלה."); }
  };

  const filtered = dc.notes.filter((n) => {
    if (filter === "all") return true;
    if (filter === "repeated") return n.citations.some((c) => c.is_repeated_candidate);
    return n.citations.some((c) => c.status === filter);
  });

  return (
    <div className="py-6 space-y-6" style={{ direction: "rtl" }}>
      {dc.status === "idle" && (
        <div className="text-center py-10">
          <h2 className="text-2xl font-bold text-foreground mb-2">בדיקת מסמך</h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-lg mx-auto">
            העלה מסמך Word, ו־ReLex תבדוק את הערות השוליים והאזכורים לפי כללי האזכור האחיד.
          </p>
          <button
            onClick={onPick}
            className="px-5 py-3 rounded-xl text-primary-foreground font-semibold"
            style={{ background: "var(--gradient-primary)" }}
          >
            העלה מסמך Word לבדיקה
          </button>
          <p className="text-xs text-muted-foreground mt-3">DOCX בלבד בשלב זה</p>
          <input
            ref={fileRef} type="file" accept=".docx" className="hidden" onChange={onFile}
          />
        </div>
      )}

      {dc.status === "extracting" && (
        <div className="text-center py-10 text-muted-foreground">מחלץ הערות שוליים מהמסמך…</div>
      )}

      {dc.status === "awaiting_confirmation" && (
        <div className="border border-border bg-card rounded-2xl p-6 max-w-xl mx-auto text-center space-y-3">
          <h3 className="text-lg font-bold text-foreground">מוכן לבדיקה</h3>
          <p className="text-sm text-foreground">
            נמצאו <b>{dc.notesCount}</b> הערות שוליים ו־<b>{dc.candidateCount}</b> מועמדים לאזכור.
          </p>
          <p className="text-sm text-muted-foreground">
            עלות הבדיקה המשוערת: <b>{dc.estimatedCredits} קרדיטים</b>.
          </p>
          <div className="flex gap-2 justify-center pt-2">
            <button onClick={() => dc.analyze()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm">
              התחל בדיקה
            </button>
            <button onClick={() => dc.reset()} className="px-4 py-2 rounded-lg bg-muted text-foreground text-sm">
              ביטול
            </button>
          </div>
        </div>
      )}

      {dc.status === "analyzing" && (
        <div className="text-center py-10 text-muted-foreground">בודק אזכורים…</div>
      )}

      {dc.status === "error" && (
        <div className="border border-destructive/30 bg-destructive/10 rounded-xl p-4 max-w-xl mx-auto text-sm text-destructive">
          {dc.error}
          <div className="mt-3">
            <button onClick={() => dc.reset()} className="px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs">
              התחל מחדש
            </button>
          </div>
        </div>
      )}

      {dc.status === "review_ready" && dc.summary && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="border border-border bg-card rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
            <Stat label="הערות" value={dc.summary.notes_count} />
            <Stat label="אזכורים" value={dc.summary.citations_count} />
            <Stat label="נראים תקינים" value={dc.summary.appears_valid} />
            <Stat label="דורש תיקון" value={dc.summary.needs_correction} />
            <Stat label="חסר מידע" value={dc.summary.missing_info} />
            <Stat label="בדיקה ידנית" value={dc.summary.needs_manual_review} />
            <Stat label="לא זוהה" value={dc.summary.unrecognized} />
            <Stat label="חוזרים" value={dc.summary.repeated} />
          </div>

          {/* Filters */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar text-xs">
            {([
              ["all", "הכל"],
              ["appears_valid", "נראים תקינים"],
              ["needs_correction", "דורש תיקון"],
              ["missing_info", "חסר מידע"],
              ["needs_manual_review", "דורש בדיקה ידנית"],
              ["unrecognized", "לא זוהה"],
              ["repeated", "חוזרים"],
            ] as [Filter, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`px-3 py-1.5 rounded-full border whitespace-nowrap ${
                  filter === id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Outputs */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => copy(buildCorrectedList(dc.notes, dc.decisions), "רשימת הערות השוליים הועתקה.")}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium"
            >
              העתק רשימת הערות מתוקנת
            </button>
            <button
              onClick={() => copy(buildSummaryReport(dc.notes, dc.summary!), "דוח הסיכום הועתק.")}
              className="px-3 py-2 rounded-lg bg-muted text-foreground text-xs font-medium"
            >
              העתק דוח סיכום
            </button>
          </div>

          {/* Notes */}
          <div className="space-y-3">
            {filtered.map((n) => (
              <div key={n.note_id} className="border border-border bg-card rounded-xl p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs font-bold text-primary">ה"ש {n.note_number}</span>
                  <span className="text-[10px] text-muted-foreground">{n.note_type === "footnote" ? "הערת שוליים" : "הערת סיום"}</span>
                </div>
                <p className="text-sm text-foreground mb-3 leading-relaxed">{n.original_note_text}</p>

                {n.note_state === "no_citation_detected" && (
                  <div className="text-xs text-muted-foreground italic">לא זוהה אזכור משפטי בהערה זו.</div>
                )}

                {n.citations.map((c) => {
                  const key = `${n.note_id}:${c.citation_index_in_note}`;
                  const d = dc.decisions[key];
                  return (
                    <div key={key} className="border-t border-border pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_TONE[c.status]}`}>
                          {STATUS_LABELS[c.status]}
                        </span>
                        {c.is_repeated_candidate && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30">חוזר</span>
                        )}
                        {d && (
                          <span className="text-[10px] text-muted-foreground">
                            • החלטה: {d.kind === "accept" ? "התקבל" : d.kind === "edit" ? "נערך" : "התעלמות"}
                          </span>
                        )}
                      </div>

                      {c.suggested_citation && c.suggested_citation !== c.citation_text && (
                        <div className="text-sm bg-muted/50 rounded p-2 leading-relaxed">
                          <span className="text-[10px] text-muted-foreground block mb-1">הצעה לתיקון:</span>
                          {c.suggested_citation}
                        </div>
                      )}

                      {c.missing_fields.length > 0 && (
                        <div className="text-xs text-muted-foreground">חסר: {c.missing_fields.join(", ")}</div>
                      )}

                      <div className="text-xs text-muted-foreground">{c.explanation}</div>

                      {editingKey === key ? (
                        <div className="space-y-2">
                          <textarea
                            value={editText} onChange={(e) => setEditText(e.target.value)}
                            className="w-full text-sm bg-background border border-border rounded p-2"
                            rows={3}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => { dc.setDecision(n.note_id, c.citation_index_in_note, { kind: "edit", value: editText }); setEditingKey(null); }}
                              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs"
                            >שמור</button>
                            <button onClick={() => setEditingKey(null)} className="px-3 py-1.5 rounded bg-muted text-foreground text-xs">ביטול</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 flex-wrap">
                          {c.suggested_citation && c.suggested_citation !== c.citation_text && (
                            <button
                              onClick={() => dc.setDecision(n.note_id, c.citation_index_in_note, { kind: "accept" })}
                              className="px-2.5 py-1 rounded text-[11px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                            >קבל</button>
                          )}
                          <button
                            onClick={() => { setEditingKey(key); setEditText(c.suggested_citation || c.citation_text); }}
                            className="px-2.5 py-1 rounded text-[11px] bg-muted text-foreground border border-border"
                          >ערוך</button>
                          <button
                            onClick={() => dc.setDecision(n.note_id, c.citation_index_in_note, { kind: "ignore" })}
                            className="px-2.5 py-1 rounded text-[11px] bg-muted text-muted-foreground border border-border"
                          >התעלם</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
