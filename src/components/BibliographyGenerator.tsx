import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBibliography, CATEGORY_LABELS } from "@/hooks/useBibliography";
import { FormattedCitation } from "./FormattedCitation";
import { toast } from "sonner";

type PendingDisambiguation = {
  id: string;
  rawInput: string;
  options: string[];
};

type LookupResult =
  | { kind: "ok"; rawInput: string; citation: string; isVerified: boolean }
  | { kind: "disambiguation"; rawInput: string; options: string[] }
  | { kind: "error"; rawInput: string; message: string };

const CONCURRENCY = 4;

async function processInPool<T, R>(items: T[], worker: (item: T) => Promise<R>, limit: number, onProgress?: (done: number) => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      try {
        results[i] = await worker(items[i]);
      } catch (e) {
        results[i] = e as R;
      }
      done++;
      onProgress?.(done);
    }
  });
  await Promise.all(runners);
  return results;
}

export function BibliographyGenerator() {
  const { sortedEntries, addEntries, removeEntry, clearAll } = useBibliography();
  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pendingDisambiguations, setPendingDisambiguations] = useState<PendingDisambiguation[]>([]);

  const lookupOne = async (line: string): Promise<LookupResult> => {
    try {
      const { data, error } = await supabase.functions.invoke("bibliography-lookup", {
        body: { rawSource: line, requestId: crypto.randomUUID() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.isDisambiguation && Array.isArray(data?.options) && data.options.length > 0) {
        return { kind: "disambiguation", rawInput: line, options: data.options };
      }
      const citation = cleanCitation(String(data?.citation || ""));
      if (!citation) {
        return { kind: "error", rawInput: line, message: "no citation returned" };
      }
      return { kind: "ok", rawInput: line, citation, isVerified: Boolean(data?.isVerified) };
    } catch (e) {
      return { kind: "error", rawInput: line, message: e instanceof Error ? e.message : "unknown" };
    }
  };

  const processRawList = async () => {
    const lines = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error("אנא הזן מקורות לעיבוד");
      return;
    }

    setLoading(true);
    setProgress({ done: 0, total: lines.length });

    try {
      const results = await processInPool(lines, lookupOne, CONCURRENCY, (done) =>
        setProgress({ done, total: lines.length }),
      );

      const toAdd: { rawInput: string; fullCitation: string; isVerified?: boolean }[] = [];
      const newPending: PendingDisambiguation[] = [];
      let errorCount = 0;

      for (const r of results) {
        if (!r) continue;
        if (r.kind === "ok") {
          toAdd.push({ rawInput: r.rawInput, fullCitation: r.citation, isVerified: r.isVerified });
        } else if (r.kind === "disambiguation") {
          newPending.push({ id: crypto.randomUUID(), rawInput: r.rawInput, options: r.options });
        } else {
          errorCount++;
        }
      }

      const added = toAdd.length > 0 ? addEntries(toAdd) : 0;
      const dupes = toAdd.length - added;

      if (newPending.length > 0) {
        setPendingDisambiguations((prev) => [...prev, ...newPending]);
      }

      const parts: string[] = [];
      if (added > 0) parts.push(`${added} מקורות נוספו`);
      if (newPending.length > 0) parts.push(`${newPending.length} דורשים בחירה`);
      if (dupes > 0) parts.push(`${dupes} כפילויות הוסרו`);
      if (errorCount > 0) parts.push(`${errorCount} נכשלו`);

      if (added > 0 || newPending.length > 0) {
        toast.success(parts.join(", "));
      } else if (errorCount > 0) {
        toast.error(parts.join(", ") || "שגיאה בעיבוד הרשימה");
      } else {
        toast.info("לא נוספו מקורות חדשים");
      }
      setRawText("");
    } catch {
      toast.error("שגיאה בעיבוד הרשימה");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const resolveDisambiguation = (pendingId: string, chosen: string) => {
    const item = pendingDisambiguations.find((p) => p.id === pendingId);
    if (!item) return;
    addEntries([{ rawInput: item.rawInput, fullCitation: cleanCitation(chosen) }]);
    setPendingDisambiguations((prev) => prev.filter((p) => p.id !== pendingId));
  };

  const skipDisambiguation = (pendingId: string) => {
    setPendingDisambiguations((prev) => prev.filter((p) => p.id !== pendingId));
  };

  const copyAll = () => {
    if (sortedEntries.length === 0) {
      toast.error("אין מקורות בביבליוגרפיה");
      return;
    }

    const grouped = groupEntries(sortedEntries);
    const lines: string[] = [];

    const hebrewCats = grouped.filter((g) => g.language === "hebrew");
    if (hebrewCats.length > 0) {
      lines.push("מקורות בעברית");
      lines.push("");
      for (const group of hebrewCats) {
        lines.push(CATEGORY_LABELS[group.category] || group.category);
        for (const entry of group.entries) {
          lines.push(cleanForCopy(entry.fullCitation));
        }
        lines.push("");
      }
    }

    const englishCats = grouped.filter((g) => g.language === "english");
    if (englishCats.length > 0) {
      lines.push("מקורות באנגלית");
      lines.push("");
      for (const group of englishCats) {
        lines.push(CATEGORY_LABELS[group.category] || group.category);
        for (const entry of group.entries) {
          lines.push(cleanForCopy(entry.fullCitation));
        }
        lines.push("");
      }
    }

    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("הביבליוגרפיה הועתקה ללוח!");
  };

  const grouped = groupEntries(sortedEntries);
  const hebrewGroups = grouped.filter((g) => g.language === "hebrew");
  const englishGroups = grouped.filter((g) => g.language === "english");

  return (
    <div className="py-6" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-foreground text-lg font-bold font-sans">מחולל ביבליוגרפיה</h3>
          <p className="text-muted-foreground text-xs mt-0.5">
            ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
          </p>
        </div>
        {sortedEntries.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
              {sortedEntries.length} מקורות
            </span>
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-destructive px-2 py-1.5 rounded-lg transition-colors"
            >
              🗑 נקה
            </button>
          </div>
        )}
      </div>

      {/* Manual input area */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm mb-4">
        <label className="text-sm font-semibold text-foreground mb-2 block">
          הזנה ידנית – הדבק מקורות (כל מקור בשורה נפרדת)
        </label>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={`למשל:\nע"א 6821/93 בנק המזרחי נ' מגדל, פ"ד מט(4) 221 (1995)\nחוק-יסוד: כבוד האדם וחירותו\nAharon Barak, Proportionality (2012)`}
          className="w-full min-h-[120px] bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/60 transition-all resize-none"
          disabled={loading}
        />
        <button
          onClick={processRawList}
          disabled={loading || !rawText.trim()}
          className="mt-3 w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: loading || !rawText.trim() ? "hsl(var(--muted))" : "var(--gradient-primary)",
            color: loading || !rawText.trim() ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
          }}
        >
          {loading
            ? progress
              ? `מעבד ${progress.done} מתוך ${progress.total}...`
              : "מעבד רשימה..."
            : "📚 עבד רשימה"}
        </button>
      </div>

      {/* Pending disambiguations */}
      {pendingDisambiguations.length > 0 && (
        <div className="space-y-3 mb-4">
          {pendingDisambiguations.map((pending) => (
            <div
              key={pending.id}
              className="bg-card border-2 border-primary/30 rounded-xl p-4 shadow-sm animate-fade-in"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <h4 className="text-foreground text-sm font-bold mb-1">
                    בחר את פסק הדין הנכון
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    עבור: <span className="font-medium">{pending.rawInput}</span>
                  </p>
                </div>
                <button
                  onClick={() => skipDisambiguation(pending.id)}
                  className="text-xs text-muted-foreground hover:text-destructive px-2 py-1 rounded transition-colors flex-shrink-0"
                >
                  דלג
                </button>
              </div>
              <div className="space-y-2">
                {pending.options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => resolveDisambiguation(pending.id, opt)}
                    className="w-full text-right border border-border hover:border-primary hover:bg-primary/5 rounded-lg px-3 py-2 text-sm text-foreground transition-all"
                  >
                    {cleanCitation(opt)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bibliography output */}
      {sortedEntries.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h4 className="text-foreground text-sm font-bold font-sans">📖 ביבליוגרפיה מסודרת</h4>
            <button
              onClick={copyAll}
              className="text-xs bg-primary/15 text-primary hover:bg-primary/25 px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              📋 העתק הכל ל-Word
            </button>
          </div>

          <div className="p-4">
            {hebrewGroups.length > 0 && (
              <div className="mb-4">
                <h5 className="text-primary font-bold text-sm mb-3 pb-1 border-b border-primary/20">
                  מקורות בעברית
                </h5>
                {hebrewGroups.map((group) => (
                  <CategoryGroup
                    key={group.category}
                    label={CATEGORY_LABELS[group.category] || group.category}
                    entries={group.entries}
                    onRemove={removeEntry}
                  />
                ))}
              </div>
            )}

            {englishGroups.length > 0 && (
              <div>
                <h5 className="text-primary font-bold text-sm mb-3 pb-1 border-b border-primary/20">
                  מקורות באנגלית
                </h5>
                {englishGroups.map((group) => (
                  <CategoryGroup
                    key={group.category}
                    label={CATEGORY_LABELS[group.category] || group.category}
                    entries={group.entries}
                    onRemove={removeEntry}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {sortedEntries.length === 0 && pendingDisambiguations.length === 0 && !loading && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📚</div>
          <p className="text-muted-foreground text-sm">
            הביבליוגרפיה ריקה. הזן מקורות למעלה או ייצר הערות שוליים – המקורות יתווספו אוטומטית.
          </p>
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  label,
  entries,
  onRemove,
}: {
  label: string;
  entries: { id: string; fullCitation: string; addedFrom: string; isVerified?: boolean }[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mb-3">
      <h6 className="text-foreground text-xs font-bold mb-1.5 mr-1">{label}</h6>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2 group">
            <div className="flex-1 text-foreground text-sm leading-relaxed pr-2">
              <FormattedCitation text={entry.fullCitation} enableTooltips />
              {entry.isVerified && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded mr-2 align-middle">
                  ✓ מאומת
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {entry.addedFrom === "footnote" && (
                <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  מה"ש
                </span>
              )}
              <button
                onClick={() => onRemove(entry.id)}
                className="text-[11px] text-muted-foreground hover:text-destructive px-1 py-0.5 rounded transition-colors"
                title="הסר"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface GroupedCategory {
  category: string;
  language: "hebrew" | "english";
  entries: { id: string; fullCitation: string; addedFrom: string; isVerified?: boolean }[];
}

function groupEntries(
  sorted: { id: string; fullCitation: string; sourceType: string; language: string; addedFrom: string; isVerified?: boolean }[],
): GroupedCategory[] {
  const groups: GroupedCategory[] = [];
  let currentKey = "";

  for (const entry of sorted) {
    const key = `${entry.language}:${entry.sourceType}`;
    if (key !== currentKey) {
      groups.push({
        category: entry.sourceType,
        language: entry.language as "hebrew" | "english",
        entries: [],
      });
      currentKey = key;
    }
    groups[groups.length - 1].entries.push({
      id: entry.id,
      fullCitation: entry.fullCitation,
      addedFrom: entry.addedFrom,
      isVerified: entry.isVerified,
    });
  }

  return groups;
}

function cleanCitation(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .replace(/^📐.*$/gm, "")
    .replace(/^כלל:.*$/gm, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function cleanForCopy(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .replace(/^📐.*$/gm, "")
    .trim();
}
