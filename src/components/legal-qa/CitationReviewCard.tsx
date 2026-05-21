import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SOURCE_TYPE_LABELS, type SourceType } from "@/data/abbreviations";
import { detectMissingFields } from "@/lib/legalQa/footnoteRerender";

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

export interface ReviewCellState {
  id: number;
  originalNumber: number;
  citation: string;
  sourceType: SourceType | "unknown";
  url?: string;
  approved: boolean;
  removed: boolean;
  refilling: boolean;
  refillError?: string;
  refillNote?: string;
}

interface Props {
  cell: ReviewCellState;
  onCitationChange: (id: number, value: string) => void;
  onSourceTypeChange: (id: number, type: SourceType) => void;
  onApproveToggle: (id: number, approved: boolean) => void;
  onRefill: (id: number) => void;
  onRemove: (id: number) => void;
  disabled?: boolean;
}

export function CitationReviewCard({
  cell,
  onCitationChange,
  onSourceTypeChange,
  onApproveToggle,
  onRefill,
  onRemove,
  disabled,
}: Props) {
  const [draft, setDraft] = useState(cell.citation);
  useEffect(() => setDraft(cell.citation), [cell.citation]);

  const missing = detectMissingFields(cell.citation);
  const isApproved = cell.approved;
  const isLoading = cell.refilling;

  const statusPill = cell.removed
    ? { text: "הוסר", cls: "bg-destructive/15 text-destructive" }
    : isLoading
    ? { text: "טוען מחדש…", cls: "bg-muted text-muted-foreground" }
    : isApproved
    ? { text: "✓ אושר", cls: "bg-emerald-100 text-emerald-700" }
    : missing.length
    ? { text: "⚠ חסרים פרטים", cls: "bg-amber-100 text-amber-700" }
    : { text: "ממתין לאישור", cls: "bg-primary/10 text-primary" };

  if (cell.removed) {
    return (
      <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-3 text-xs flex items-center justify-between">
        <span className="text-destructive">[{cell.originalNumber}] הציטוט הוסר</span>
        <button
          onClick={() => onRemove(cell.id)}
          className="text-primary hover:underline text-[11px]"
        >
          בטל הסרה
        </button>
      </div>
    );
  }

  return (
    <div
      className={`border rounded-xl p-3 transition-colors ${
        isApproved ? "border-emerald-300 bg-emerald-50/40" : "border-border bg-card"
      }`}
      style={{ direction: "rtl" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-primary font-bold text-sm">[{cell.originalNumber}]</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusPill.cls}`}>
            {statusPill.text}
          </span>
        </div>
        <button
          onClick={() => onRemove(cell.id)}
          className="text-[11px] text-muted-foreground hover:text-destructive px-1.5 py-1 rounded transition-colors"
          title="הסר ציטוט"
        >
          ✕
        </button>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground">סוג מקור:</label>
        <div className="flex-1 max-w-[220px]">
          <Select
            value={cell.sourceType === "unknown" ? "case_law_published" : cell.sourceType}
            onValueChange={(v) => onSourceTypeChange(cell.id, v as SourceType)}
            disabled={disabled || isLoading}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {SOURCE_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-2">
        <label className="text-[11px] text-muted-foreground mb-1 block">ציטוט</label>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onCitationChange(cell.id, e.target.value);
          }}
          rows={3}
          disabled={disabled || isLoading}
          className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm leading-relaxed resize-y"
          style={{ direction: "rtl" }}
        />
        {missing.length > 0 && (
          <div className="mt-1 text-[11px] text-amber-700">
            חסרים: {missing.join(", ")}
          </div>
        )}
        {cell.refillNote && (
          <div className="mt-1 text-[11px] text-emerald-700">{cell.refillNote}</div>
        )}
        {cell.refillError && (
          <div className="mt-1 text-[11px] text-destructive">{cell.refillError}</div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onRefill(cell.id)}
          disabled={disabled || isLoading || !cell.citation.trim()}
          className="text-[11px] px-2.5 py-1 rounded-md bg-secondary/15 text-secondary hover:bg-secondary/25 disabled:opacity-40 font-medium transition-colors"
          title="חיפוש פרטים חסרים ב-Perplexity"
        >
          {isLoading ? "מחפש…" : "🔄 השלם פרטים חסרים"}
        </button>
        <button
          onClick={() => onApproveToggle(cell.id, !isApproved)}
          disabled={disabled || isLoading || !cell.citation.trim()}
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
