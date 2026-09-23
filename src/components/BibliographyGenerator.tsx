import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBibliography, CATEGORY_LABELS, classifyCitation, type BibSourceCategory } from "@/hooks/useBibliography";
import { FormattedCitation } from "./FormattedCitation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { runCitation, CitationRunError } from "@/lib/runCitation";
import { runPool } from "@/lib/concurrency";
import type { SourceType } from "@/data/abbreviations";

type ReviewStatus = "ok" | "needs_choice" | "error" | "loading";

interface ReviewItem {
  id: string;
  rawInput: string;
  status: ReviewStatus;
  citation: string;
  isVerified: boolean;
  options: string[];
  errorMsg?: string;
  warningMsg?: string;
  isEditing: boolean;
  editValue: string;
  sourceTypeOverride?: BibSourceCategory;
}


const CATEGORY_OPTIONS: { value: BibSourceCategory; label: string; icon: string }[] = [
  { value: "legislation_primary", label: "חקיקה ראשית", icon: "📜" },
  { value: "legislation_secondary", label: "חקיקה משנית", icon: "📋" },
  { value: "caselaw_supreme", label: "פסיקה – עליון", icon: "⚖️" },
  { value: "caselaw_district", label: "פסיקה – מחוזי", icon: "⚖️" },
  { value: "caselaw_magistrate", label: "פסיקה – שלום", icon: "⚖️" },
  { value: "caselaw_specialized", label: "פסיקה – בתי דין מיוחדים", icon: "⚖️" },
  { value: "literature", label: "ספרות משפטית", icon: "📕" },
  { value: "foreign_caselaw", label: "פסיקה לועזית", icon: "🌐" },
  { value: "foreign_legislation", label: "חקיקה לועזית", icon: "🌐" },
  { value: "foreign_books", label: "ספרים לועזיים", icon: "🌐" },
  { value: "foreign_articles", label: "מאמרים לועזיים", icon: "🌐" },
  { value: "foreign_internet", label: "מקורות מרשתת לועזיים", icon: "🌐" },
  { value: "foreign_other", label: "מקורות לועזיים אחרים", icon: "🌐" },
  { value: "misc", label: "שונות", icon: "📁" },
  { value: "unknown", label: "אחר", icon: "❔" },
];

const CONCURRENCY = 2;

/**
 * Bibliography categories → citation-engine source types. Supreme-court rows
 * stay unmapped so the engine can decide between פ"ד (published) and database.
 */
const CATEGORY_TO_SOURCE_TYPE: Partial<Record<BibSourceCategory, SourceType>> = {
  legislation_primary: "primary_legislation",
  legislation_secondary: "secondary_legislation",
  caselaw_district: "case_law_database",
  caselaw_magistrate: "case_law_database",
  caselaw_specialized: "case_law_database",
  foreign_caselaw: "foreign_case_us",
  foreign_legislation: "foreign_statute_us",
  foreign_books: "foreign_book",
  foreign_articles: "foreign_journal_article",
  foreign_internet: "foreign_internet",
  foreign_other: "foreign",
};


export function BibliographyGenerator() {
  const { sortedEntries, addEntries, removeEntry, clearAll } = useBibliography();
  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  /** Set when every row failed with the same service-level error (AI provider outage). */
  const [serviceOutage, setServiceOutage] = useState<string | null>(null);

  const sendEntryBackToReview = (id: string) => {
    const entry = sortedEntries.find((e) => e.id === id);
    if (!entry) return;
    setReviewItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        rawInput: entry.rawInput || entry.fullCitation,
        status: "ok",
        citation: entry.fullCitation,
        isVerified: Boolean(entry.isVerified),
        options: [],
        isEditing: true,
        editValue: entry.fullCitation,
        sourceTypeOverride: entry.sourceType,
      },
    ]);
    removeEntry(id);
    toast.success("המקור הוחזר לשלב 2 לעריכה");
  };

  const sendAllBackToReview = () => {
    if (sortedEntries.length === 0) return;
    const items: ReviewItem[] = sortedEntries.map((entry) => ({
      id: crypto.randomUUID(),
      rawInput: entry.rawInput || entry.fullCitation,
      status: "ok",
      citation: entry.fullCitation,
      isVerified: Boolean(entry.isVerified),
      options: [],
      isEditing: false,
      editValue: entry.fullCitation,
      sourceTypeOverride: entry.sourceType,
    }));
    setReviewItems((prev) => [...prev, ...items]);
    sortedEntries.forEach((e) => removeEntry(e.id));
    toast.success(`${items.length} מקורות הוחזרו לשלב 2 לעריכה`);
  };

  /**
   * Single source lookup — runs the exact same pipeline as the Citation Wizard
   * (input validation → source-type classification → verified store → the
   * citation-chat engine with all its grounding gates → rule validation).
   */
  const lookupOne = async (
    rawInput: string,
    sourceTypeHint?: BibSourceCategory,
  ): Promise<Omit<ReviewItem, "id" | "isEditing" | "editValue">> => {
    const overrideType =
      sourceTypeHint && sourceTypeHint !== "unknown"
        ? CATEGORY_TO_SOURCE_TYPE[sourceTypeHint]
        : undefined;

    const result = await runCitation({
      rawInput,
      overrideType,
      useVerifiedStore: true,
    });

    const citation = cleanCitation(result.citation);
    if (!citation) {
      return {
        rawInput,
        status: "error",
        citation: "",
        isVerified: false,
        options: [],
        errorMsg: "לא הוחזר אזכור",
        sourceTypeOverride: sourceTypeHint,
      };
    }
    return {
      rawInput,
      status: "ok",
      citation,
      isVerified: result.fromVerifiedStore,
      options: [],
      warningMsg: result.warningMsg,
      sourceTypeOverride: sourceTypeHint,
    };
  };

  /** Wraps lookupOne so a thrown engine error becomes an error row. */
  const lookupOneSafe = async (
    rawInput: string,
    sourceTypeHint?: BibSourceCategory,
  ): Promise<Omit<ReviewItem, "id" | "isEditing" | "editValue">> => {
    try {
      return await lookupOne(rawInput, sourceTypeHint);
    } catch (e) {
      return {
        rawInput,
        status: "error",
        citation: "",
        isVerified: false,
        options: [],
        errorMsg:
          e instanceof CitationRunError
            ? e.userMessage
            : e instanceof Error
              ? e.message
              : "שגיאה לא ידועה",
        sourceTypeOverride: sourceTypeHint,
      };
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
    setServiceOutage(null);
    setProgress({ done: 0, total: lines.length });


    try {
      let done = 0;
      const results = await runPool(
        lines,
        (line) => lookupOne(line),
        {
          concurrency: CONCURRENCY,
          retries: 1,
          onSettled: () => {
            done += 1;
            setProgress({ done, total: lines.length });
          },
        },
      );

      const newItems: ReviewItem[] = results.map((r, i) => {
        const base: Omit<ReviewItem, "id" | "isEditing" | "editValue"> = r.ok
          ? r.value!
          : {
              rawInput: lines[i],
              status: "error",
              citation: "",
              isVerified: false,
              options: [],
              errorMsg:
                r.error instanceof CitationRunError
                  ? r.error.userMessage
                  : r.error instanceof Error
                    ? r.error.message
                    : "שגיאה לא ידועה",
            };
        return {
          id: crypto.randomUUID(),
          ...base,
          isEditing: false,
          editValue: base.citation || base.rawInput,
        };
      });

      // One shared service-level failure (AI provider outage / rate limit) →
      // show a single banner instead of a wall of identical red rows.
      const serviceCodes = new Set(["AI_UNAVAILABLE", "AI_RATE_LIMITED", "CREDIT_CHARGE_FAILED"]);
      const failedCodes = results
        .filter((r) => !r.ok && r.error instanceof CitationRunError)
        .map((r) => (r.error as CitationRunError).code);
      const allFailedSameService =
        failedCodes.length === results.length &&
        failedCodes.length > 0 &&
        serviceCodes.has(failedCodes[0]) &&
        failedCodes.every((c) => c === failedCodes[0]);

      setReviewItems((prev) => [...prev, ...newItems]);
      setRawText("");

      const okCount = newItems.filter((i) => i.status === "ok").length;
      const warnCount = newItems.filter((i) => i.status === "ok" && (i.warningMsg || /\[חסר:/.test(i.citation))).length;
      const errorCount = newItems.filter((i) => i.status === "error").length;

      if (allFailedSameService) {
        const first = results.find((r) => !r.ok)?.error as CitationRunError;
        setServiceOutage(first.userMessage);
        toast.error(first.userMessage);
      } else {
        toast.success(`עובדו ${newItems.length} מקורות · ${okCount} מוכנים, ${warnCount} דורשים בדיקה, ${errorCount} נכשלו`);
      }

    } catch {
      toast.error("שגיאה בעיבוד הרשימה");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const updateItem = (id: string, patch: Partial<ReviewItem>) => {
    setReviewItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeReviewItem = (id: string) => {
    setReviewItems((prev) => prev.filter((it) => it.id !== id));
  };

  const pickDisambiguation = (id: string, chosen: string) => {
    updateItem(id, { status: "ok", citation: cleanCitation(chosen), editValue: cleanCitation(chosen), options: [] });
  };

  const startEdit = (id: string) => {
    setReviewItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, isEditing: true, editValue: it.citation || it.rawInput }
          : it,
      ),
    );
  };

  const saveEdit = (id: string) => {
    setReviewItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const v = it.editValue.trim();
        if (!v) return it;
        return { ...it, isEditing: false, citation: v, status: "ok", isVerified: false, options: [], errorMsg: undefined, warningMsg: undefined };
      }),
    );
  };

  const cancelEdit = (id: string) => {
    updateItem(id, { isEditing: false });
  };

  const retryLookup = async (id: string, hintOverride?: BibSourceCategory) => {
    const item = reviewItems.find((i) => i.id === id);
    if (!item) return;
    // Always prefer the current edit buffer if the user typed something there;
    // otherwise fall back to the existing citation, then to the original raw input.
    const editedValue = item.editValue?.trim();
    const currentCitation = item.citation?.trim();
    const query = editedValue || currentCitation || item.rawInput;
    if (!query) return;
    const hint = hintOverride ?? item.sourceTypeOverride;
    updateItem(id, { status: "loading", isEditing: false, sourceTypeOverride: hint });
    const r = await lookupOneSafe(query, hint);
    setReviewItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, ...r, rawInput: query, isEditing: false, editValue: r.citation || query }
          : it,
      ),
    );
  };

  const handleChangeCategory = (id: string, cat: BibSourceCategory) => {
    updateItem(id, { sourceTypeOverride: cat });
    if (cat !== "unknown") {
      const label = CATEGORY_OPTIONS.find((o) => o.value === cat)?.label ?? "סוג מקור";
      toast.message(`✓ ${label} — מחפש שוב...`);
      retryLookup(id, cat);
    }
  };

  const commitAll = (verifiedOnly = false) => {
    // Auto-save any in-progress edits so the latest text is what gets added.
    const flushed = reviewItems.map((it) => {
      if (!it.isEditing) return it;
      const v = it.editValue?.trim();
      if (!v) return { ...it, isEditing: false };
      return { ...it, isEditing: false, citation: v, status: "ok" as ReviewStatus, isVerified: false, options: [], errorMsg: undefined, warningMsg: undefined };
    });
    if (flushed !== reviewItems) setReviewItems(flushed);

    const ready = flushed.filter((it) => {
      if (it.status !== "ok") return false;
      if (verifiedOnly && !it.isVerified) return false;
      return true;
    });
    if (ready.length === 0) {
      toast.error("אין מקורות מוכנים להוספה");
      return;
    }
    const added = addEntries(
      ready.map((it) => ({
        rawInput: it.rawInput,
        fullCitation: it.citation,
        isVerified: it.isVerified,
        sourceTypeOverride: it.sourceTypeOverride,
      })),
    );
    const dupes = ready.length - added;
    setReviewItems((prev) => prev.filter((it) => !ready.some((r) => r.id === it.id)));
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} נוספו`);
    if (dupes > 0) parts.push(`${dupes} כפילויות`);
    toast.success(parts.join(" · "));
  };

  const stats = useMemo(() => {
    const total = reviewItems.length;
    const verified = reviewItems.filter((i) => i.status === "ok" && i.isVerified).length;
    const ok = reviewItems.filter((i) => i.status === "ok").length;
    const needsFix = reviewItems.filter(
      (i) =>
        i.status === "needs_choice" ||
        i.status === "error" ||
        (i.status === "ok" && (Boolean(i.warningMsg) || /\[חסר:/.test(i.citation))),
    ).length;

    return { total, verified, ok, needsFix };
  }, [reviewItems]);

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

      {serviceOutage && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive flex items-start justify-between gap-3"
        >
          <span className="leading-relaxed">{serviceOutage}</span>
          <button
            onClick={() => setServiceOutage(null)}
            className="shrink-0 text-destructive/70 hover:text-destructive"
            aria-label="סגור"
          >
            ✕
          </button>
        </div>
      )}



      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-4 text-xs">
        <StepBadge n={1} label="הדבק" active={reviewItems.length === 0 && !loading} done={reviewItems.length > 0} />
        <div className="h-px flex-1 bg-border" />
        <StepBadge n={2} label="בדיקה ותיקון" active={reviewItems.length > 0} done={false} />
        <div className="h-px flex-1 bg-border" />
        <StepBadge n={3} label="ביבליוגרפיה" active={false} done={sortedEntries.length > 0} />
      </div>

      {/* Step 1 — Manual input */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm mb-4">
        <label className="text-sm font-semibold text-foreground mb-2 block">
          1. הדבק מקורות (כל מקור בשורה נפרדת)
        </label>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={`למשל:\nע"א 6821/93 בנק המזרחי נ' מגדל\nחוק-יסוד: כבוד האדם וחירותו\nAharon Barak, Proportionality (2012)`}
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
            : "🔍 שלח לבדיקה"}
        </button>
      </div>

      {/* Step 2 — Review panel */}
      {reviewItems.length > 0 && (
        <div className="bg-card border-2 border-primary/20 rounded-xl shadow-sm mb-4 animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <h4 className="text-foreground text-sm font-bold">2. בדוק ותקן לפני הוספה</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                סך {stats.total} · ✓ מאומתים {stats.verified} · ⚠ דורשים תיקון {stats.needsFix}
              </p>
            </div>
            <button
              onClick={() => setReviewItems([])}
              className="text-xs text-muted-foreground hover:text-destructive px-2 py-1 rounded transition-colors"
            >
              נקה רשימה
            </button>
          </div>

          <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto">
            {reviewItems.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                onStartEdit={() => startEdit(item.id)}
                onSaveEdit={() => saveEdit(item.id)}
                onCancelEdit={() => cancelEdit(item.id)}
                onChangeEdit={(v) => updateItem(item.id, { editValue: v })}
                onRetry={() => retryLookup(item.id)}
                onRemove={() => removeReviewItem(item.id)}
                onPickOption={(opt) => pickDisambiguation(item.id, opt)}
                onChangeCategory={(cat) => handleChangeCategory(item.id, cat)}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
            <button
              onClick={() => commitAll(false)}
              disabled={stats.ok === 0}
              className="flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: stats.ok === 0 ? "hsl(var(--muted))" : "var(--gradient-primary)",
                color: stats.ok === 0 ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
              }}
            >
              ➕ הוסף הכל לביבליוגרפיה ({stats.ok})
            </button>
            {stats.verified > 0 && stats.verified < stats.ok && (
              <button
                onClick={() => commitAll(true)}
                className="py-2.5 px-3 rounded-lg text-xs font-medium border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                רק מאומתים ({stats.verified})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 3 — Bibliography output */}
      {sortedEntries.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h4 className="text-foreground text-sm font-bold font-sans">📖 3. ביבליוגרפיה מסודרת</h4>
            <div className="flex items-center gap-2">
              <button
                onClick={sendAllBackToReview}
                className="text-xs bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 px-3 py-1.5 rounded-lg transition-colors font-medium"
                title="החזר את כל המקורות לשלב 2 לעריכה"
              >
                ← חזור לעריכה
              </button>
              <button
                onClick={copyAll}
                className="text-xs bg-primary/15 text-primary hover:bg-primary/25 px-3 py-1.5 rounded-lg transition-colors font-medium"
              >
                📋 העתק הכל ל-Word
              </button>
            </div>
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
                    onEdit={sendEntryBackToReview}
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
                    onEdit={sendEntryBackToReview}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {sortedEntries.length === 0 && reviewItems.length === 0 && !loading && (
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

function StepBadge({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  const tone = active
    ? "bg-primary text-primary-foreground"
    : done
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
      : "bg-muted text-muted-foreground";
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${tone}`}>
      <span className="font-bold text-[10px] w-4 h-4 inline-flex items-center justify-center rounded-full bg-background/30">
        {done ? "✓" : n}
      </span>
      <span className="text-[11px] font-medium whitespace-nowrap">{label}</span>
    </div>
  );
}

function ReviewRow({
  item,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onChangeEdit,
  onRetry,
  onRemove,
  onPickOption,
  onChangeCategory,
}: {
  item: ReviewItem;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onChangeEdit: (v: string) => void;
  onRetry: () => void;
  onRemove: () => void;
  onPickOption: (opt: string) => void;
  onChangeCategory: (cat: BibSourceCategory) => void;
}) {
  const hasMissing = item.status === "ok" && /\[חסר:/.test(item.citation);
  const detectedCat = item.sourceTypeOverride
    ? item.sourceTypeOverride
    : item.citation
      ? classifyCitation(item.citation).sourceType
      : "unknown";
  const catLabel = CATEGORY_LABELS[detectedCat] || "אחר";

  const borderTone =
    item.status === "needs_choice"
      ? "border-amber-500/40"
      : item.status === "error"
        ? "border-destructive/40"
        : hasMissing
          ? "border-amber-500/30"
          : item.isVerified
            ? "border-emerald-500/30"
            : "border-border";

  return (
    <div className={`border ${borderTone} rounded-lg bg-background/60 p-3`}>
      {/* Top row: badges + raw input hint */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {item.status === "loading" && (
          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">⏳ מחפש...</span>
        )}
        {item.status === "ok" && item.isVerified && (
          <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
            ✓ מאומת
          </span>
        )}
        {item.status === "needs_choice" && (
          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
            ❓ דורש בחירה
          </span>
        )}
        {item.status === "error" && (
          <span className="text-[10px] font-medium text-destructive bg-destructive/10 border border-destructive/30 px-1.5 py-0.5 rounded">
            ✕ שגיאה
          </span>
        )}
        {hasMissing && (
          <span
            className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded"
            title="חסרים פרטים — תקן ידנית או חפש שוב"
          >
            ⚠ חסרים פרטים — תקן ידנית או חפש שוב
          </span>
        )}
        {!hasMissing && item.status === "ok" && item.warningMsg && (
          <span
            className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded"
            title={item.warningMsg}
          >
            ⚠ {item.warningMsg}
          </span>
        )}


        {item.status === "ok" && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-[10px] bg-muted hover:bg-accent text-foreground px-1.5 py-0.5 rounded border border-border transition-colors">
                {catLabel} ▾
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1.5" style={{ direction: "rtl" }} align="end">
              <div className="space-y-0.5">
                {CATEGORY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => onChangeCategory(opt.value)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-right transition-colors ${
                      detectedCat === opt.value
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-accent text-foreground"
                    }`}
                  >
                    <span>{opt.icon}</span>
                    <span className="flex-1">{opt.label}</span>
                    {detectedCat === opt.value && <span className="text-[10px]">✓</span>}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[60%]" title={item.rawInput}>
          הקלט: {item.rawInput}
        </span>
      </div>

      {/* Body */}
      {item.isEditing ? (
        <div className="space-y-2">
          <textarea
            value={item.editValue}
            onChange={(e) => onChangeEdit(e.target.value)}
            className="w-full min-h-[70px] bg-background border border-input rounded-md px-2.5 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/60 transition-all resize-y"
            placeholder="הקלד את האזכור המלא..."
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onSaveEdit}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-md font-medium transition-colors"
            >
              שמור
            </button>
            <button
              onClick={onCancelEdit}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md transition-colors"
            >
              ביטול
            </button>
            <button
              onClick={onRetry}
              className="text-xs text-primary hover:bg-primary/10 px-2 py-1.5 rounded-md transition-colors mr-auto"
              title="חפש מחדש לפי הטקסט שערכת"
            >
              🔍 חפש מחדש
            </button>
          </div>
        </div>
      ) : item.status === "needs_choice" ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">בחר את הפסיקה הנכונה:</p>
          {item.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onPickOption(opt)}
              className="w-full text-right border border-border hover:border-primary hover:bg-primary/5 rounded-md px-2.5 py-1.5 text-sm text-foreground transition-all"
            >
              <FormattedCitation text={opt} />
            </button>
          ))}
        </div>
      ) : item.status === "error" ? (
        <p className="text-sm text-destructive">{item.errorMsg || "שגיאה לא ידועה"}</p>
      ) : item.status === "loading" ? (
        <p className="text-sm text-muted-foreground italic">מחפש מחדש...</p>
      ) : (
        <div className="text-sm text-foreground leading-relaxed">
          <FormattedCitation text={item.citation} highlightMissing enableTooltips />
        </div>
      )}

      {/* Action bar */}
      {!item.isEditing && (
        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/60">
          <button
            onClick={onStartEdit}
            className="text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent px-2 py-1 rounded transition-colors"
          >
            ✏️ ערוך
          </button>
          <button
            onClick={onRetry}
            disabled={item.status === "loading"}
            className="text-[11px] text-muted-foreground hover:text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors disabled:opacity-50"
          >
            🔍 חפש שוב
          </button>
          <button
            onClick={onRemove}
            className="text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2 py-1 rounded transition-colors mr-auto"
          >
            ✕ הסר
          </button>
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  label,
  entries,
  onRemove,
  onEdit,
}: {
  label: string;
  entries: { id: string; fullCitation: string; addedFrom: string; isVerified?: boolean }[];
  onRemove: (id: string) => void;
  onEdit?: (id: string) => void;
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
              {onEdit && (
                <button
                  onClick={() => onEdit(entry.id)}
                  className="text-[11px] text-muted-foreground hover:text-primary px-1 py-0.5 rounded transition-colors"
                  title="ערוך מקור זה (החזר לשלב 2)"
                >
                  ✏️
                </button>
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
