import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CitationReviewCard, type ReviewCellState } from "./CitationReviewCard";
import { rerenderAnswer, type EditableFootnote } from "@/lib/legalQa/footnoteRerender";
import type { SourceType } from "@/data/abbreviations";

interface InputFootnote {
  number: number;
  citation: string;
  source_type: string;
  url?: string;
  source?: "local" | "perplexity" | "document";
}

interface Props {
  answer: string;
  footnotes: InputFootnote[];
  onApply: (next: { answer: string; footnotes: InputFootnote[] }) => void;
  onCancel: () => void;
}

export function CitationReviewPanel({ answer, footnotes, onApply, onCancel }: Props) {
  const initial = useMemo<ReviewCellState[]>(
    () =>
      footnotes.map((fn, i) => ({
        id: i,
        originalNumber: fn.number,
        citation: fn.citation,
        sourceType: (fn.source_type as SourceType) || "unknown",
        url: fn.url,
        approved: false,
        removed: false,
        refilling: false,
      })),
    [footnotes],
  );
  const [cells, setCells] = useState<ReviewCellState[]>(initial);
  const [applying, setApplying] = useState(false);

  const update = (id: number, patch: Partial<ReviewCellState>) =>
    setCells((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const handleRefill = async (id: number) => {
    const cell = cells.find((c) => c.id === id);
    if (!cell) return;
    update(id, { refilling: true, refillError: undefined, refillNote: undefined });
    try {
      const { data, error } = await supabase.functions.invoke("citation-refill", {
        body: {
          current_citation: cell.citation,
          source_type: cell.sourceType,
          missing_fields: [],
        },
      });
      if (error) throw error;
      if (!data?.ok || !data?.updated_citation) {
        throw new Error(data?.error ?? "השרת לא החזיר ציטוט מעודכן");
      }
      update(id, {
        citation: data.updated_citation as string,
        refilling: false,
        refillNote:
          typeof data.filled_count === "number" && data.filled_count > 0
            ? `הושלמו ${data.filled_count} שדות`
            : "לא נמצאו פרטים חדשים",
      });
    } catch (err) {
      update(id, {
        refilling: false,
        refillError: `שגיאה: ${(err as Error).message}`,
      });
    }
  };

  const handleApply = () => {
    setApplying(true);
    try {
      const edits: EditableFootnote[] = cells.map((c) => ({
        originalNumber: c.originalNumber,
        citation: c.citation,
        source_type: c.sourceType,
        url: c.url,
        source: footnotes.find((f) => f.number === c.originalNumber)?.source,
        removed: c.removed,
      }));
      const result = rerenderAnswer(answer, edits);
      onApply({ answer: result.answer, footnotes: result.footnotes });
      toast.success("התשובה עודכנה");
    } catch (err) {
      toast.error(`עדכון נכשל: ${(err as Error).message}`);
    } finally {
      setApplying(false);
    }
  };

  const removedCount = cells.filter((c) => c.removed).length;
  const refilling = cells.some((c) => c.refilling);

  return (
    <div className="border-t border-border pt-4 mt-4 space-y-3" style={{ direction: "rtl" }}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground text-sm">
          בדיקת ציטוטים
          <span className="text-muted-foreground font-normal mr-2">
            ({cells.length - removedCount} פעילים{removedCount > 0 ? `, ${removedCount} הוסרו` : ""})
          </span>
        </h3>
        <button
          onClick={onCancel}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          סגור
        </button>
      </div>

      <div className="space-y-2">
        {cells.map((c) => (
          <CitationReviewCard
            key={c.id}
            cell={c}
            onCitationChange={(id, value) => update(id, { citation: value, approved: false })}
            onSourceTypeChange={(id, type) => update(id, { sourceType: type })}
            onApproveToggle={(id, approved) => update(id, { approved })}
            onRefill={handleRefill}
            onRemove={(id) => update(id, { removed: !cells.find((x) => x.id === id)?.removed, approved: false })}
            disabled={applying}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <button
          onClick={handleApply}
          disabled={applying || refilling}
          className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40"
        >
          {applying ? "מעדכן…" : "עדכן תשובה"}
        </button>
        <button
          onClick={onCancel}
          disabled={applying}
          className="px-4 py-1.5 rounded-md bg-muted text-foreground text-xs font-medium hover:bg-muted/70 disabled:opacity-40"
        >
          ביטול
        </button>
        <span className="text-[11px] text-muted-foreground mr-auto">
          כל "השלם חסרים" צורך קריאת Perplexity אחת
        </span>
      </div>
    </div>
  );
}
