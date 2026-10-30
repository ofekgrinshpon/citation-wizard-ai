import { CitationRequestStatusLink } from "@/components/CitationRequestStatusLink";
import { useState, useEffect } from "react";
import { SOURCE_TYPE_LABELS, type SourceType } from "@/data/abbreviations";
import { FormattedCitation } from "./FormattedCitation";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toForeignIdentity, isForeignSourceType } from "@/data/bluebook/types";
import { ForeignSourcePicker } from "./ForeignSourcePicker";
import { citationTextOnly, escapeCitationLiteral } from "@/lib/citationSegments";

export interface ReviewCardCell {
  completion?: import("@/lib/citationCompletion").CompletionAcceptance;
  pastedCitation?: import("../../supabase/functions/_shared/pastedCitation").PastedCitationContract;
  id: number;
  input: string;
  output: string | null;
  status: "empty" | "loading" | "valid" | "warning" | "verified" | "error";
  warningMsg?: string;
  errorMsg?: string;
  requestId?: string;
  approved?: boolean;
  sourceTypeOverride?: SourceType;
  detectedType?: SourceType;
}

interface Props {
  cell: ReviewCardCell;
  onInputChange: (id: number, value: string) => void;
  onOutputChange: (id: number, value: string) => void;
  onSourceTypeChange: (id: number, type: SourceType) => void;
  onApproveToggle: (id: number, approved: boolean) => void;
  onRegenerate: (id: number) => void;
  onRemove: (id: number) => void;
  disabled?: boolean;
  regenerationDisabled?: boolean;
  /** Word review shows the exact selected document text, even if the search input is edited. */
  wordOriginal?: string;
  /** Available only for an explicit retry of a server-confirmed failed request. */
  newAttempt?: { disclosure: string; onRetry: () => void };
  /** Optional per-card copy action (used by the V2 אזכור אחיד review layer). */
  onCopy?: (id: number) => void;
  /** Optional label shown next to the footnote number (original V2 source). */
  originLabel?: string;
  /** Replaces the ✕ remove button label/behavior hint when provided. */
  hideRemove?: boolean;
  /** Local foreign-source classification scope (account + stable item key). */
  foreignScope?: { accountId: string | null | undefined; itemKey: string };
}

const TYPE_OPTIONS: SourceType[] = [
  "case_law_published",
  "case_law_database",
  "primary_legislation",
  "basic_law",
  "secondary_legislation",
  "bill",
  "book",
  "article",
  "article_in_book",
  "regulation",
  "government_decision",
  "court_pleading",
  "collective_agreement",
  "treaty",
  "internet",
  "religious",
];

/** Foreign families (Rule 35.1 → current Bluebook). Family only — jurisdiction stays automatic. */
export const FOREIGN_TYPE_OPTIONS: { type: SourceType; label: string }[] = [
  // Generic choices never default to a U.S. jurisdiction.
  { type: "foreign_case_other", label: "פסיקה" },
  { type: "foreign_case_us", label: "פסיקה אמריקנית" },
  { type: "foreign_statute_us", label: "חקיקה אמריקנית" },
  { type: "foreign_statute_uk", label: "חקיקה בריטית" },
  { type: "foreign_constitution", label: "חוקה" },
  { type: "foreign_book", label: "ספר" },
  { type: "foreign_journal_article", label: "מאמר בכתב עת" },
  { type: "foreign_book_chapter", label: "פרק בספר" },
  { type: "foreign_internet", label: "מקור אינטרנטי" },
  { type: "foreign", label: "אחר לועזי" },
];

const FOREIGN_KIND_LABELS: Record<string, string> = {
  case: "פסיקה",
  constitution: "חוקה",
  statute: "חקיקה",
  book: "ספר",
  journal_article: "מאמר בכתב עת",
  book_chapter: "פרק בספר",
  internet: "מקור אינטרנטי",
  other: "מקור לועזי",
};

const FOREIGN_JURISDICTION_LABELS: Record<string, string> = {
  US: 'ארה"ב',
  UK: "אנגליה",
  OTHER: "לועזי",
};

export function FootnoteReviewCard({
  cell,
  onInputChange,
  onOutputChange,
  onSourceTypeChange,
  onApproveToggle,
  onRegenerate,
  onRemove,
  disabled,
  regenerationDisabled,
  wordOriginal,
  newAttempt,
  onCopy,
  originLabel,
  hideRemove,
  foreignScope,
}: Props) {
  const [editInput, setEditInput] = useState(false);
  const [draftOutput, setDraftOutput] = useState(wordOriginal !== undefined ? citationTextOnly(cell.output ?? "") : cell.output ?? "");

  useEffect(() => {
    setDraftOutput(wordOriginal !== undefined ? citationTextOnly(cell.output ?? "") : cell.output ?? "");
  }, [cell.output, wordOriginal]);

  const activeType: SourceType = cell.sourceTypeOverride ?? cell.detectedType ?? "unknown";
  const foreignIdentity = toForeignIdentity(activeType);
  const detectionLabel = foreignIdentity
    ? `זוהה: ${FOREIGN_KIND_LABELS[foreignIdentity.kind]} · ${
        FOREIGN_JURISDICTION_LABELS[foreignIdentity.jurisdiction]
      } · כלל מקורות לועזיים`
    : null;
  const isLoading = cell.status === "loading";
  const isError = cell.status === "error";
  const isApproved = !!cell.approved;

  const statusPill = isLoading
    ? { text: "טוען מחדש…", cls: "bg-muted text-muted-foreground" }
    : isError
    ? { text: "שגיאה", cls: "bg-destructive/15 text-destructive" }
    : isApproved
    ? { text: "✓ אושר", cls: "bg-emerald-100 text-emerald-700" }
    : cell.status === "warning"
    ? { text: "⚠ דרוש בדיקה", cls: "bg-amber-100 text-amber-700" }
    : { text: "ממתין לאישור", cls: "bg-primary/10 text-primary" };

  if (wordOriginal !== undefined) return <article aria-label={`בדיקת אזכור ${cell.id}`} className={`space-y-4 rounded-xl border p-4 ${isApproved ? "border-emerald-300 bg-emerald-50/30" : "border-border bg-background"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h5 className="font-semibold">אזכור {cell.id}</h5>
      <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusPill.cls}`}>{isLoading ? "בבדיקה…" : isError ? "הבדיקה לא הושלמה" : isApproved ? "אושר לעותק החדש" : cell.output ? "ממתין לאישור שלך" : "מוכן לבדיקה"}</span>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <div><p className="mb-2 text-sm font-medium">הנוסח במסמך</p><p className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-base leading-7">{wordOriginal}</p></div>
      <div>
        <label className="block text-sm font-medium">התיקון המוצע
          <textarea aria-label={`התיקון המוצע לאזכור ${cell.id}`} value={draftOutput} rows={3} disabled={disabled || isLoading || cell.output === null || isError}
            placeholder={isLoading ? "בודקים את האזכור…" : "התיקון יופיע לאחר הבדיקה"}
            onChange={event => { setDraftOutput(event.target.value); onOutputChange(cell.id, escapeCitationLiteral(event.target.value)); }}
            className="mt-2 w-full resize-y rounded-lg border border-border bg-background p-3 text-base font-normal leading-7 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:bg-muted/30" />
        </label>
      </div>
    </div>
    {cell.warningMsg && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{cell.warningMsg}</p>}
    {isError && <div className="space-y-2 text-sm text-destructive"><p>{cell.errorMsg || "הבדיקה לא הושלמה. לא ננסה שוב אוטומטית."}</p><CitationRequestStatusLink requestId={cell.requestId} /></div>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">עריכת ההצעה מחייבת אישור מחדש.</p>
      <button type="button" aria-label={`${isApproved ? "בטל אישור" : "אשר תיקון"} לאזכור ${cell.id}`} onClick={() => onApproveToggle(cell.id, !isApproved)} disabled={disabled || isLoading || !cell.output || isError || regenerationDisabled}
        className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 ${isApproved ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-primary bg-primary text-primary-foreground"}`}>{isApproved ? "בטל אישור" : "אשר תיקון"}</button>
    </div>
    <details className="border-t border-border pt-3 text-sm">
      <summary className="cursor-pointer rounded py-1 text-primary focus-visible:outline focus-visible:outline-2">אפשרויות בדיקה נוספות</summary>
      <div className="mt-3 space-y-3">
        <label className="block">נוסח לבדיקה חוזרת<input aria-label={`נוסח לבדיקה חוזרת לאזכור ${cell.id}`} value={cell.input} disabled={disabled || isLoading}
          onChange={event => onInputChange(cell.id, event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3" /></label>
        <p className="text-xs text-muted-foreground">שינוי כאן משפיע על הבדיקה בלבד; הקטע שנבחר במסמך נשאר אותו קטע.</p>
        <label className="block">סוג המקור<select aria-label={`סוג המקור לאזכור ${cell.id}`} value={activeType} disabled={disabled || isLoading}
          onChange={event => onSourceTypeChange(cell.id, event.target.value as SourceType)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3">
          <option value="unknown">זיהוי אוטומטי</option>
          {[...TYPE_OPTIONS, ...FOREIGN_TYPE_OPTIONS.map(option => option.type)].map(type => <option key={type} value={type}>{SOURCE_TYPE_LABELS[type]}</option>)}
        </select></label>
        <p className="text-xs text-muted-foreground">בדיקה נוספת משתמשת במכסת החשבון ושולחת את הנוסח לבדיקה.</p>
        <button type="button" aria-label={`בדוק שוב אזכור ${cell.id}`} disabled={disabled || regenerationDisabled || isLoading || !cell.input.trim()} onClick={() => onRegenerate(cell.id)}
          className="min-h-11 rounded-lg border border-border px-4 py-2 focus-visible:outline focus-visible:outline-2 disabled:opacity-50">בדוק שוב</button>
      </div>
    </details>
  </article>;

  return (
    <div
      className={`border rounded-xl p-3 transition-colors ${
        isApproved ? "border-emerald-300 bg-emerald-50/40" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-primary font-bold text-sm">[{cell.id}]</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusPill.cls}`}>
            {statusPill.text}
          </span>
          {originLabel && (
            <span className="text-[11px] text-muted-foreground truncate max-w-[220px]" title={originLabel}>
              {originLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onCopy && (
            <button
              onClick={() => onCopy(cell.id)}
              disabled={!cell.output}
              className="text-[11px] text-primary hover:bg-primary/10 px-1.5 py-1 rounded transition-colors disabled:opacity-40"
              title="העתק הערה"
            >
              📋
            </button>
          )}
          {!hideRemove && (
            <button
              onClick={() => onRemove(cell.id)}
              className="text-[11px] text-muted-foreground hover:text-destructive px-1.5 py-1 rounded transition-colors"
              title="הסר"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Input row */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] text-muted-foreground">קלט</label>
          <button
            onClick={() => setEditInput((v) => !v)}
            className="text-[11px] text-primary hover:underline"
          >
            {editInput ? "סגור" : "✎ ערוך קלט"}
          </button>
        </div>
        {editInput ? (
          <input
            type="text"
            value={cell.input}
            onChange={(e) => onInputChange(cell.id, e.target.value)}
            disabled={disabled || isLoading}
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm"
            style={{ direction: "rtl" }}
          />
        ) : (
          <div className="text-sm text-foreground/80 bg-muted/40 rounded-md px-2 py-1.5">
            {cell.input || <span className="text-muted-foreground">(ריק)</span>}
          </div>
        )}
      </div>

      {/* Source type selector */}
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <label className="text-[11px] text-muted-foreground">סוג מקור:</label>
        <div className="flex-1 max-w-[220px]">
          <Select
            value={activeType}
            onValueChange={(v) => onSourceTypeChange(cell.id, v as SourceType)}
            disabled={disabled || isLoading}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel className="text-[11px]">מקורות ישראליים</SelectLabel>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {SOURCE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel className="text-[11px]">מקורות לועזיים</SelectLabel>
                {FOREIGN_TYPE_OPTIONS.map(({ type, label }) => (
                  <SelectItem key={type} value={type} className="text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {detectionLabel && (
          <span
            className="text-[11px] text-muted-foreground"
            title="מקור לועזי מעוצב לפי כללי האזכור האחיד (כלל 35.1) והמדריך האמריקני המקובל"
          >
            {detectionLabel}
          </span>
        )}
      </div>

      {foreignScope && isForeignSourceType(activeType) && (
        <ForeignSourcePicker accountId={foreignScope.accountId} itemKey={foreignScope.itemKey} input={cell.input}
          onRegenerate={() => onRegenerate(cell.id)} regenerateDisabled={disabled || regenerationDisabled || isLoading || !cell.input.trim()} />
      )}

      {/* Output */}
      <div className="mb-2">
        <label className="text-[11px] text-muted-foreground mb-1 block">פלט מוצע</label>
        {isLoading ? (
          <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
            <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span>מפיק מחדש…</span>
          </div>
        ) : isError ? (
          <div className="py-2 space-y-2">
            <div className="text-xs text-destructive">{cell.errorMsg || "לא ניתן להפיק. נסה שוב."}</div>
            <CitationRequestStatusLink requestId={cell.requestId} />
            {newAttempt && <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{newAttempt.disclosure}</p>
              <button type="button" onClick={newAttempt.onRetry} disabled={disabled}
                className="text-[11px] px-2.5 py-1 rounded-md border border-primary text-primary disabled:opacity-40">
                ניסיון חדש
              </button>
            </div>}
            <button
              onClick={() => onRegenerate(cell.id)}
              disabled={disabled || regenerationDisabled || !cell.input.trim()}
              className="text-[11px] px-2.5 py-1 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-40 font-medium transition-colors"
            >
              🔄 נסה שוב
            </button>
          </div>
        ) : (
          <>
            <textarea
              value={draftOutput}
              onChange={(e) => {
                setDraftOutput(e.target.value);
                onOutputChange(cell.id, e.target.value);
              }}
              rows={3}
              disabled={disabled}
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm leading-relaxed resize-y"
              style={{ direction: "rtl" }}
            />
            {cell.status === "warning" && cell.warningMsg && (
              <div className="mt-1.5 text-[11px] text-amber-700">⚠️ {cell.warningMsg}</div>
            )}
            {cell.output && (
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                תצוגה מעוצבת:{" "}
                <span className="text-foreground/80">
                  <FormattedCitation text={cell.output} />
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onRegenerate(cell.id)}
          disabled={disabled || regenerationDisabled || isLoading || !cell.input.trim()}
          className="text-[11px] px-2.5 py-1 rounded-md bg-secondary/15 text-secondary hover:bg-secondary/25 disabled:opacity-40 font-medium transition-colors"
        >
          🔄 הפק מחדש
        </button>
        <button
          onClick={() => onApproveToggle(cell.id, !isApproved)}
          disabled={disabled || isLoading || !cell.output}
          className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors disabled:opacity-40 ${
            isApproved
              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
              : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
        >
          {isApproved ? "✓ אושר (בטל)" : "✓ אשר"}
        </button>
      </div>
    </div>
  );
}
