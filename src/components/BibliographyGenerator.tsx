import { CitationRequestStatusLink } from "@/components/CitationRequestStatusLink";
import { ForeignSourcePicker } from "./ForeignSourcePicker";
import { planForItem, recordGeneration } from "@/lib/foreignClassificationStore";
import { newTelemetryBatch, sourceTelemetry, type CostTelemetry } from "@/lib/costTelemetry";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBibliography, CATEGORY_LABELS, classifyCitation, type BibSourceCategory } from "@/hooks/useBibliography";
import { FormattedCitation } from "./FormattedCitation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { runCitation, CitationRunError, type CitationRunRetry, type CitationRunRecovery } from "@/lib/runCitation";
import { buildBibliographyCopy, type BibliographyCopyGroup } from "@/lib/bibliographyCopy";
import { copyRichText } from "@/lib/clipboard";
import { mergeWarnings, splitCitationWarnings } from "@/lib/citationSegments";
import { useAuth } from "@/hooks/useAuth";
import { useCitationRowGuard } from "@/lib/useCitationRowGuard";
import { citationRetryDisclosure } from "@/lib/functionError";
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
  requestId?: string;
  citationRetry?: CitationRunRetry;
  recovery?: CitationRunRecovery;
  warningMsg?: string;
  /** Every warning for this citation (engine reply, renderer, cache). */
  warnings?: string[];
  isEditing: boolean;
  editValue: string;
  sourceTypeOverride?: BibSourceCategory;
  /** Stable foreign-classification key (independent of row id and input). */
  classificationKey: string;
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
  // Generic foreign categories carry no jurisdiction (never a U.S. default).
  foreign_caselaw: "foreign_case_other",
  foreign_legislation: "foreign",
  foreign_books: "foreign_book",
  foreign_articles: "foreign_journal_article",
  foreign_internet: "foreign_internet",
  foreign_other: "foreign",
};


export function BibliographyGenerator() {
  const { user } = useAuth();
  const rowGuard = useCitationRowGuard(user?.id ?? null);
  const { sortedEntries, addEntries, removeEntry, clearAll } = useBibliography();
  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const reviewItemsRef = useRef(reviewItems);
  reviewItemsRef.current = reviewItems;
  useEffect(() => {
    rowGuard.invalidate();
    setReviewItems([]);
    setRawText("");
    setLoading(false);
    setProgress(null);
    setServiceOutage(null);
  }, [user?.id, rowGuard]);
  /** Set when every row failed with the same service-level error (AI provider outage). */
  const [serviceOutage, setServiceOutage] = useState<string | null>(null);

  const sendEntryBackToReview = (id: string) => {
    const entry = sortedEntries.find((e) => e.id === id);
    if (!entry) return;
    setReviewItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        classificationKey: entry.classificationKey ?? entry.id,
        rawInput: entry.rawInput || entry.fullCitation,
        status: "ok",
        citation: entry.fullCitation,
        isVerified: Boolean(entry.isVerified),
        options: [],
        isEditing: true,
        editValue: entry.fullCitation,
        sourceTypeOverride: entry.sourceType,
        warnings: entry.warnings,
        warningMsg: entry.warnings?.[0],
      },
    ]);
    removeEntry(id);
    toast.success("המקור הוחזר לשלב 2 לעריכה");
  };

  const sendAllBackToReview = () => {
    if (sortedEntries.length === 0) return;
    const items: ReviewItem[] = sortedEntries.map((entry) => ({
      id: crypto.randomUUID(),
      classificationKey: entry.classificationKey ?? entry.id,
      rawInput: entry.rawInput || entry.fullCitation,
      status: "ok",
      citation: entry.fullCitation,
      isVerified: Boolean(entry.isVerified),
      options: [],
      isEditing: false,
      editValue: entry.fullCitation,
      sourceTypeOverride: entry.sourceType,
      warnings: entry.warnings,
      warningMsg: entry.warnings?.[0],
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
    telemetry: CostTelemetry = sourceTelemetry(newTelemetryBatch("bibliography")),
    isResultCurrent?: () => boolean,
    recovery?: CitationRunRecovery,
    directType?: SourceType,
  ): Promise<Omit<ReviewItem, "id" | "isEditing" | "editValue" | "classificationKey">> => {
    const overrideType = directType ?? (
      sourceTypeHint && sourceTypeHint !== "unknown"
        ? CATEGORY_TO_SOURCE_TYPE[sourceTypeHint]
        : undefined);

    const result = recovery ? await recovery.retry(isResultCurrent) : await runCitation({
      rawInput,
      isResultCurrent,
      overrideType,
      useVerifiedStore: true,
      telemetry,
    });

    // Metadata-only cleaning: styles (##, ^^, **) stay for display/export.
    const split = splitCitationWarnings(cleanCitation(result.citation));
    const citation = split.citation;
    // runCitation may carry warnings only in reply/warningMsg: retain them all.
    const warnings = mergeWarnings(split.warnings, splitCitationWarnings(result.reply || "").warnings, result.warningMsg);
    if (!citation) {
      return {
        rawInput,
        status: "error",
        citation: "",
        isVerified: false,
        options: [],
        errorMsg: result.reply || "לא הוחזר אזכור",
        // Disambiguation/locally unusable success is already delivered. Keep
        // its exact result; the generic action may not start another paid call.
        recovery: Object.freeze({ retry: async () => result }),
        sourceTypeOverride: sourceTypeHint,
      };
    }
    return {
      rawInput,
      status: "ok",
      citation,
      isVerified: result.fromVerifiedStore,
      options: [],
      warningMsg: result.warningMsg ?? warnings[0],
      warnings,
      sourceTypeOverride: sourceTypeHint,
    };
  };

  /** Wraps lookupOne so a thrown engine error becomes an error row. */
  const lookupOneSafe = async (
    rawInput: string,
    sourceTypeHint?: BibSourceCategory,
    isResultCurrent?: () => boolean,
    recovery?: CitationRunRecovery,
    directType?: SourceType,
  ): Promise<Omit<ReviewItem, "id" | "isEditing" | "editValue" | "classificationKey">> => {
    try {
      return await lookupOne(rawInput, sourceTypeHint, undefined, isResultCurrent, recovery, directType);
    } catch (e) {
      return {
        rawInput,
        status: "error",
        citation: "",
        isVerified: false,
        options: [],
        citationRetry: e instanceof CitationRunError ? e.citationRetry : undefined,
        recovery: e instanceof CitationRunError ? e.recovery : undefined,
                  requestId: e instanceof CitationRunError ? e.requestId : undefined,
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

    const job = rowGuard.begin("raw-list");
    if (!job) return;
    setLoading(true);
    setServiceOutage(null);
    setProgress({ done: 0, total: lines.length });


    try {
      let done = 0;
      // One stable telemetry identity per logical row, created BEFORE retries.
      const telemetryBatch = newTelemetryBatch("bibliography");
      const rowTelemetry = lines.map(() => sourceTelemetry(telemetryBatch));
      const results = await runPool(
        lines,
        (line, i) => lookupOne(line, undefined, rowTelemetry[i], job.isCurrent),
        {
          concurrency: CONCURRENCY,
          retries: 0,
          onSettled: () => {
            done += 1;
            if (!job.isCurrent()) return;
            setProgress({ done, total: lines.length });
          },
        },
      );

      if (!job.isCurrent()) return;
      const newItems: ReviewItem[] = results.map((r, i) => {
        const base: Omit<ReviewItem, "id" | "isEditing" | "editValue" | "classificationKey"> = r.ok
          ? r.value!
          : {
              rawInput: lines[i],
              status: "error",
              citation: "",
              isVerified: false,
              options: [],
              citationRetry: r.error instanceof CitationRunError ? r.error.citationRetry : undefined,
              recovery: r.error instanceof CitationRunError ? r.error.recovery : undefined,
                  requestId: r.error instanceof CitationRunError ? r.error.requestId : undefined,
              errorMsg:
                r.error instanceof CitationRunError
                  ? r.error.userMessage
                  : r.error instanceof Error
                    ? r.error.message
                    : "שגיאה לא ידועה",
            };
        return {
          id: crypto.randomUUID(),
          classificationKey: crypto.randomUUID(),
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
      if (job.isCurrent()) toast.error("שגיאה בעיבוד הרשימה");
    } finally {
      if (job.isCurrent()) { setLoading(false); setProgress(null); }
      job.finish();
    }
  };

  const updateItem = (id: string, patch: Partial<ReviewItem>) => {
    if ("editValue" in patch || "sourceTypeOverride" in patch) {
      rowGuard.invalidate(id);
      patch = { ...patch, citationRetry: undefined, requestId: undefined, recovery: undefined };
    }
    setReviewItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeReviewItem = (id: string) => {
    rowGuard.invalidate(id);
    setReviewItems((prev) => prev.filter((it) => it.id !== id));
  };

  const pickDisambiguation = (id: string, chosen: string) => {
    updateItem(id, { status: "ok", citation: cleanCitation(chosen), editValue: cleanCitation(chosen), options: [] });
  };

  const startEdit = (id: string) => {
    rowGuard.invalidate(id);
    setReviewItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, citationRetry: undefined, requestId: undefined, isEditing: true, editValue: it.citation || it.rawInput,
            status: it.status === "loading" ? "error" : it.status }
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
        if (v === it.citation) return { ...it, isEditing: false };
        return { ...it, isEditing: false, citation: v, status: "ok", isVerified: false, options: [], errorMsg: undefined, warningMsg: undefined, warnings: undefined, citationRetry: undefined, requestId: undefined, recovery: undefined };
      }),
    );
  };

  const cancelEdit = (id: string) => {
    updateItem(id, { isEditing: false });
  };

  const retryLookup = async (id: string, hintOverride?: BibSourceCategory, explicitRetry?: CitationRunRetry) => {
    const item = reviewItemsRef.current.find((i) => i.id === id);
    if (!item || (explicitRetry && (item.citationRetry !== explicitRetry || hintOverride !== undefined))) return;
    const recovery = hintOverride === undefined ? item.recovery : undefined;
    const query = explicitRetry || recovery ? item.rawInput : item.editValue?.trim() || item.citation?.trim() || item.rawInput;
    if (!query) return;
    const job = rowGuard.begin(id);
    if (!job) return;
    const hint = hintOverride ?? item.sourceTypeOverride;
    // An explicit regeneration uses the effective foreign classification (if the user set one).
    const plan = hintOverride === undefined && !explicitRetry && !recovery
      ? planForItem(user?.id, `bib:${item.classificationKey}`, query) : null;
    setReviewItems((prev) => prev.map((it) => it.id === id
      ? { ...it, status: "loading", isEditing: false, sourceTypeOverride: hint, citationRetry: undefined, requestId: undefined } : it));
    try {
      const r = await lookupOneSafe(query, hint, job.isCurrent, explicitRetry ?? recovery, plan?.sourceType);
      if (!job.isCurrent()) return;
      const withPlan = plan && r.status === "ok" && plan.warning
        ? { ...r, warnings: mergeWarnings(r.warnings, plan.warning), warningMsg: r.warningMsg ?? plan.warning } : r;
      if (plan && r.status === "ok") recordGeneration(user?.id, plan);
      setReviewItems((prev) => prev.map((it) => it.id === id
        ? { ...it, ...withPlan, requestId: r.requestId, rawInput: query, isEditing: false, editValue: r.citation || query } : it));
    } finally { job.finish(); }
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
      if (v === it.citation) return { ...it, isEditing: false };
      return { ...it, isEditing: false, citation: v, status: "ok" as ReviewStatus, isVerified: false, options: [], errorMsg: undefined, warningMsg: undefined, warnings: undefined, citationRetry: undefined, requestId: undefined, recovery: undefined };
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
        warnings: mergeWarnings(it.warnings, it.warningMsg),
        classificationKey: it.classificationKey,
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
    const groups: BibliographyCopyGroup[] = [];

    const hebrewCats = grouped.filter((g) => g.language === "hebrew");
    if (hebrewCats.length > 0) {
      groups.push({ label: "מקורות בעברית", entries: [] });
      for (const group of hebrewCats) {
        groups.push({ label: CATEGORY_LABELS[group.category] || group.category, entries: group.entries });
      }
    }

    const englishCats = grouped.filter((g) => g.language === "english");
    if (englishCats.length > 0) {
      groups.push({ label: "מקורות באנגלית", entries: [] });
      for (const group of englishCats) {
        groups.push({ label: CATEGORY_LABELS[group.category] || group.category, entries: group.entries });
      }
    }

    // Rich copy keeps citation styles (italic / small caps); the plain
    // fallback is marker-free. Only metadata lines are cleaned here — style
    // markup is consumed by the serializers, and warnings are exported.
    const { html, plain } = buildBibliographyCopy(
      groups.map((g) => ({
        label: g.label,
        entries: g.entries.map((e) => ({ fullCitation: cleanForCopy(e.fullCitation), warnings: e.warnings })),
      })),
    );
    void copyRichText(html, plain);
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
        {!rawText.trim() && reviewItems.length === 0 && (
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-2">
              הדביקו רשימת מקורות — ReLex ימיין אותם לעברית ולאנגלית, לפי קטגוריות וסדר אלפביתי.
            </p>
            <button
              type="button"
              onClick={() =>
                setRawText(
                  'ע"א 6821/93 בנק המזרחי נ\' מגדל\nחוק-יסוד: כבוד האדם וחירותו\nAharon Barak, Proportionality (2012)',
                )
              }
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground hover:border-primary/40 transition-colors"
            >
              נסו עם רשימת דוגמה
            </button>
          </div>
        )}
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
              onClick={() => { reviewItems.forEach((item) => rowGuard.invalidate(item.id)); setReviewItems([]); }}
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
                onNewAttempt={rowGuard.bind(item.id, () => { if (item.citationRetry) void retryLookup(item.id, undefined, item.citationRetry); })}
                onRemove={() => removeReviewItem(item.id)}
                onPickOption={(opt) => pickDisambiguation(item.id, opt)}
                onChangeCategory={(cat) => handleChangeCategory(item.id, cat)}
                accountId={user?.id}
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
  onNewAttempt,
  onRemove,
  onPickOption,
  onChangeCategory,
  accountId,
}: {
  item: ReviewItem;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onChangeEdit: (v: string) => void;
  onRetry: () => void;
  onNewAttempt: () => void;
  onRemove: () => void;
  onPickOption: (opt: string) => void;
  onChangeCategory: (cat: BibSourceCategory) => void;
  accountId?: string | null;
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
        {item.status === "ok" && item.warningMsg && (
          <span
            className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded"
            title={item.warningMsg}
          >
            ⚠ {item.warningMsg}
          </span>
        )}


        {(item.status === "ok" || item.status === "error") && (
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

      {detectedCat.startsWith("foreign_") && (item.status === "ok" || item.status === "error") && (
        <ForeignSourcePicker accountId={accountId} itemKey={`bib:${item.classificationKey}`} input={item.rawInput}
          onRegenerate={onRetry} />
      )}

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
        <div className="space-y-2">
          <p className="text-sm text-destructive">{item.errorMsg || "שגיאה לא ידועה"}</p>
          <CitationRequestStatusLink requestId={item.requestId} />
          {item.citationRetry && <>
            <p className="text-xs text-muted-foreground">{citationRetryDisclosure(item.citationRetry.descriptor)}</p>
            <button type="button" onClick={onNewAttempt} className="text-xs px-3 py-1.5 rounded-md border border-primary text-primary">
              ניסיון חדש
            </button>
          </>}
        </div>
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
  entries: { id: string; fullCitation: string; addedFrom: string; isVerified?: boolean; warnings?: string[] }[];
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
              {entry.warnings?.map((w) => (
                <div key={w} className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">⚠ {w}</div>
              ))}
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
  entries: { id: string; fullCitation: string; addedFrom: string; isVerified?: boolean; warnings?: string[] }[];
}

function groupEntries(
  sorted: { id: string; fullCitation: string; sourceType: string; language: string; addedFrom: string; isVerified?: boolean; warnings?: string[] }[],
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
      warnings: entry.warnings,
    });
  }

  return groups;
}

/** Metadata-only cleaning: rule lines and list numbering go; style markup
 *  (**, ##, ^^) and literal escapes stay for the shared serializers. */
function cleanCitation(text: string): string {
  return text
    .replace(/^📐.*$/gm, "")
    .replace(/^כלל:.*$/gm, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

/** Metadata-only cleaning before export; styles are kept for serializers. */
function cleanForCopy(text: string): string {
  return text
    .replace(/^📐.*$/gm, "")
    .trim();
}
