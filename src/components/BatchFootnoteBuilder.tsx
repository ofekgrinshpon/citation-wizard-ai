import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAbbreviations, detectSourceType, SOURCE_TYPE_LABELS, type SourceType } from "@/data/abbreviations";
import { FormattedCitation } from "./FormattedCitation";
import { VerifiedAutocomplete } from "./VerifiedAutocomplete";
import { PublicationIntegrityCard } from "./PublicationIntegrityCard";
import { FootnoteReviewCard } from "./FootnoteReviewCard";
import { useBibliography } from "@/hooks/useBibliography";
import { useProjects } from "@/hooks/useProjects";
import { useOffice } from "@/hooks/useOffice";
import { insertCitationAsFootnote } from "@/lib/wordInsertion";
import { toast } from "sonner";
import { copyCitationRich, copyCitationsRich } from "@/lib/citationRichText";
import { ensureVerifiedSources } from "@/lib/verifiedSources";
import { applyYearPreferences, isLegislationInput, extractLawNameFromInput, type YearPreferences } from "@/lib/citationUtils";
import { runCitation, CitationRunError, type RunCitationResult } from "@/lib/runCitation";
import { runPool, isTransientError } from "@/lib/concurrency";
import { applyRepeatCitationRules, extractCitationOnly } from "@/lib/footnoteRepeatRules";

interface FootnoteCell {
  id: number;
  input: string;
  output: string | null;
  status: "empty" | "loading" | "valid" | "warning" | "verified" | "error";
  warningMsg?: string;
  errorMsg?: string;
  verifiedCitation?: string;
  approved?: boolean;
  sourceTypeOverride?: SourceType;
  detectedType?: SourceType;
}

interface PendingIntegrity {
  cellId: number;
  lawName: string;
  rawInput: string;
  fullCitation: string;
  sourceType: string | null;
}

type Phase = "input" | "review" | "final";

const createCell = (id: number): FootnoteCell => ({
  id,
  input: "",
  output: null,
  status: "empty",
});

interface BatchProps {}

const CELLS_STORAGE_PREFIX = "footnote_cells";
const SUMMARY_STORAGE_PREFIX = "footnote_summary";
const PHASE_STORAGE_PREFIX = "footnote_phase";

function getCellsKey(projectId: string | undefined) {
  return projectId ? `${CELLS_STORAGE_PREFIX}_${projectId}` : CELLS_STORAGE_PREFIX;
}
function getSummaryKey(projectId: string | undefined) {
  return projectId ? `${SUMMARY_STORAGE_PREFIX}_${projectId}` : SUMMARY_STORAGE_PREFIX;
}
function getPhaseKey(projectId: string | undefined) {
  return projectId ? `${PHASE_STORAGE_PREFIX}_${projectId}` : PHASE_STORAGE_PREFIX;
}

function loadCells(projectId: string | undefined): FootnoteCell[] {
  try {
    const raw = localStorage.getItem(getCellsKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw) as FootnoteCell[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(c => ({ ...c, status: c.status === "loading" ? "empty" : c.status }));
    }
  } catch {}
  return Array.from({ length: 5 }, (_, i) => createCell(i + 1));
}

function loadPhase(projectId: string | undefined): Phase {
  try {
    const raw = localStorage.getItem(getPhaseKey(projectId));
    if (raw === "review" || raw === "final" || raw === "input") return raw;
  } catch {}
  return "input";
}


export function BatchFootnoteBuilder({}: BatchProps) {
  const { currentProject } = useProjects();
  const { isOfficeAddin, hasDocumentAccess } = useOffice();
  const projectId = currentProject?.id;
  const [cells, setCells] = useState<FootnoteCell[]>(() => loadCells(projectId));
  const [globalLoading, setGlobalLoading] = useState(false);
  const [isInsertingAll, setIsInsertingAll] = useState(false);
  const [insertingCellId, setInsertingCellId] = useState<number | null>(null);
  const [summary, setSummary] = useState<string | null>(() => localStorage.getItem(getSummaryKey(projectId)));
  const [pendingIntegrity, setPendingIntegrity] = useState<PendingIntegrity[]>([]);
  const [phase, setPhase] = useState<Phase>(() => loadPhase(projectId));
  const [finalizing, setFinalizing] = useState(false);
  const bibliography = useBibliography();

  // Reload when project changes
  useEffect(() => {
    setCells(loadCells(projectId));
    setSummary(localStorage.getItem(getSummaryKey(projectId)));
    setPhase(loadPhase(projectId));
  }, [projectId]);

  useEffect(() => {
    localStorage.setItem(getCellsKey(projectId), JSON.stringify(cells));
  }, [cells, projectId]);

  useEffect(() => {
    const key = getSummaryKey(projectId);
    if (summary) localStorage.setItem(key, summary);
    else localStorage.removeItem(key);
  }, [summary, projectId]);

  useEffect(() => {
    localStorage.setItem(getPhaseKey(projectId), phase);
  }, [phase, projectId]);

  const updateCellInput = useCallback((id: number, value: string) => {
    setCells((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, input: value, status: "empty", verifiedCitation: undefined } : c
      )
    );
  }, []);

  const setCellVerified = useCallback((id: number, citation: string) => {
    setCells((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, output: citation, status: "verified", verifiedCitation: citation } : c
      )
    );
  }, []);

  const addCell = useCallback(() => {
    setCells((prev) => [...prev, createCell(prev.length + 1)]);
  }, []);

  const removeCell = useCallback((id: number) => {
    setCells((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((c) => c.id !== id).map((c, i) => ({ ...c, id: i + 1 }));
    });
  }, []);

  // Drag and drop
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index;
    setDragIndex(index);
  }, []);

  const handleDragEnter = useCallback((index: number) => {
    dragOverItem.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      setCells((prev) => {
        const reordered = [...prev];
        const [removed] = reordered.splice(dragItem.current!, 1);
        reordered.splice(dragOverItem.current!, 0, removed);
        const renumbered = reordered.map((c, i) => ({ ...c, id: i + 1 }));
        return applyRepeatCitationRules(renumbered);
      });
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDragIndex(null);
  }, []);

  // Run the shared citation pipeline for a single cell (same one the
  // citation wizard uses). Respects sourceTypeOverride if set.
  const runSingleCitation = async (
    input: string,
    overrideType?: SourceType
  ): Promise<RunCitationResult> =>
    runCitation({ rawInput: input, overrideType, projectId, useVerifiedStore: true });

  const applyResultToCell = (c: FootnoteCell, res: RunCitationResult): FootnoteCell => ({
    ...c,
    output: res.reply,
    status: res.status,
    warningMsg: res.status === "warning" ? res.warningMsg : undefined,
    errorMsg: undefined,
    verifiedCitation: res.fromVerifiedStore ? res.citation : undefined,
    detectedType: res.sourceType,
    approved: false,
  });

  const errorMessageOf = (e: unknown) =>
    (e as { userMessage?: string })?.userMessage || "ההפקה נכשלה. נסו שוב.";

  // Phase 1: draft all cells. No repeat-citation rules, no persistence — that
  // happens later in finalizeApproved after the user reviews each card.
  const draftAllCells = async () => {
    const activeCells = cells.filter((c) => c.input.trim() && c.status !== "verified");
    if (activeCells.length === 0) {
      toast.error("אנא הזן לפחות מקור אחד");
      return;
    }

    setGlobalLoading(true);
    setSummary(null);

    setCells((prev) =>
      prev.map((c) =>
        c.input.trim() && c.status !== "verified"
          ? { ...c, status: "loading", output: null, errorMsg: undefined, approved: false }
          : c
      )
    );

    // Bounded concurrency: each citation-chat call does grounded web lookups,
    // so firing every row at once gets the batch rate-limited.
    const results = await runPool(
      activeCells,
      (cell) => runSingleCitation(cell.input, cell.sourceTypeOverride),
      {
        concurrency: 2,
        retries: 1,
        shouldRetry: (e) =>
          isTransientError(e) && !(e as CitationRunError)?.isInsufficientCredits,
        onSettled: (index, result) => {
          const cellId = activeCells[index].id;
          if (result.ok && result.value) {
            const value = result.value;
            setCells((prev) => prev.map((c) => (c.id === cellId ? applyResultToCell(c, value) : c)));
          } else {
            const message = errorMessageOf(result.error);
            setCells((prev) =>
              prev.map((c) =>
                c.id === cellId ? { ...c, status: "error" as const, output: null, errorMsg: message } : c
              )
            );
          }
        },
      }
    );

    setCells((prev) => applyRepeatCitationRules(prev));
    setPhase("review");
    setGlobalLoading(false);

    const failed = results.filter((r) => !r.ok).length;
    const verified = results.filter((r) => r.ok && r.value.fromVerifiedStore).length;
    if (verified > 0) {
      toast.success(`${verified} מקורות הושלמו ממאגר המקורות המאומתים (ללא חיוב)`);
    }
    if (failed > 0) {
      toast.error(`${failed} מקורות נכשלו — ראו את הסיבה בכל כרטיס`);
    }
  };

  // Re-run a single cell (e.g. user changed source type or edited input).
  const regenerateOne = async (id: number) => {
    const cell = cells.find((c) => c.id === id);
    if (!cell || !cell.input.trim()) return;

    setCells((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, status: "loading", output: null, errorMsg: undefined, approved: false } : c
      )
    );

    try {
      const res = await runSingleCitation(cell.input, cell.sourceTypeOverride);
      setCells((prev) =>
        applyRepeatCitationRules(prev.map((c) => (c.id === id ? applyResultToCell(c, res) : c)))
      );
    } catch (e) {
      const message = errorMessageOf(e);
      setCells((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "error", output: null, errorMsg: message } : c))
      );
      toast.error(`הפקה מחדש של הערה ${id} נכשלה`, { description: message });
    }
  };


  // Per-cell handlers used by the review card.
  const handleReviewOutputChange = useCallback((id: number, value: string) => {
    setCells((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, output: value, approved: false } : c));
      return applyRepeatCitationRules(updated);
    });
  }, []);

  const handleReviewSourceTypeChange = useCallback((id: number, t: SourceType) => {
    setCells((prev) =>
      prev.map((c) => (c.id === id ? { ...c, sourceTypeOverride: t, approved: false } : c))
    );
  }, []);

  const handleReviewApproveToggle = useCallback((id: number, approved: boolean) => {
    setCells((prev) => prev.map((c) => (c.id === id ? { ...c, approved } : c)));
  }, []);

  const approveAll = () => {
    setCells((prev) =>
      prev.map((c) => (c.output && c.input.trim() ? { ...c, approved: true } : c))
    );
  };

  // Phase 2: finalize approved cards. Applies repeat-citation rules,
  // bibliography sync, citation_history insert, verified_sources, and the
  // legislation integrity queue. Moves UI to the "final" phase.
  const finalizeApproved = async () => {
    const activeCells = cells.filter((c) => c.input.trim() && c.output);
    if (activeCells.length === 0) {
      toast.error("אין מקורות מאושרים");
      return;
    }
    const notApproved = activeCells.filter((c) => !c.approved);
    if (notApproved.length > 0) {
      toast.error(`יש לאשר את כל ${notApproved.length} ההערות לפני יצירת הרשימה`);
      return;
    }

    setFinalizing(true);
    try {
      let warningCount = 0;
      let validCount = 0;
      const normalized = applyRepeatCitationRules(cells);
      const nextCells: FootnoteCell[] = normalized;
      const updatedCells: FootnoteCell[] = [];

      for (const cell of normalized) {
        if (!cell.input.trim() || !cell.output) continue;
        const hasWarning = /\[חסר:/.test(cell.output) || /⚠️/.test(cell.output);
        if (hasWarning) warningCount++;
        else validCount++;
        updatedCells.push({
          ...cell,
          status: hasWarning ? "warning" : cell.status === "verified" ? "verified" : "valid",
          warningMsg: hasWarning ? "חסרים פרטים – ראה סימון בתוצאה" : undefined,
        });
      }

      setCells(normalized.map((cell) => updatedCells.find((u) => u.id === cell.id) ?? cell));

      const verifiedCandidates: { rawInput: string; fullCitation: string; sourceType: string | null; yearPreferences?: YearPreferences }[] = [];
      const integrityQueue: PendingIntegrity[] = [];

      for (const cell of updatedCells) {
        if (!cell.output) continue;

        const sourceType = cell.sourceTypeOverride ?? cell.detectedType ?? detectSourceType(normalizeAbbreviations(cell.input));
        const label = SOURCE_TYPE_LABELS[sourceType];
        let fullCitation = extractCitationOnly(cell.output);
        const isVerified = cell.status === "valid" && !/\[חסר:/.test(cell.output);

        if (isVerified && (isLegislationInput(cell.input) || isLegislationInput(fullCitation))) {
          const lawName = extractLawNameFromInput(cell.input) || extractLawNameFromInput(fullCitation);
          const words = lawName.split(/[\s\-:]+/).filter((w) => w.length >= 2);
          const orConditions = words.map((w) => `source_name.ilike.%${w}%`).join(",");

          const { data: existingSources } = await supabase
            .from("verified_sources")
            .select("metadata, verification_status")
            .or(orConditions)
            .limit(1);

          const existing = existingSources?.[0];
          const existingMeta = existing?.metadata as Record<string, unknown> | null;

          if (existing?.verification_status === "verified" || (existingMeta && "hasHebrewYear" in existingMeta)) {
            const prefs: YearPreferences = {
              hasHebrewYear: (existingMeta?.hasHebrewYear as boolean) ?? true,
              hasGregorianYear: (existingMeta?.hasGregorianYear as boolean) ?? true,
            };
            fullCitation = applyYearPreferences(fullCitation, prefs);
            setCells((prev) =>
              prev.map((c) => (c.id === cell.id ? { ...c, output: applyYearPreferences(c.output!, prefs) } : c))
            );

            verifiedCandidates.push({
              rawInput: cell.input,
              fullCitation,
              sourceType: label !== "לא ידוע" ? label : null,
              yearPreferences: prefs,
            });
          } else {
            integrityQueue.push({
              cellId: cell.id,
              lawName,
              rawInput: cell.input,
              fullCitation,
              sourceType: label !== "לא ידוע" ? label : null,
            });
          }
        } else if (isVerified) {
          verifiedCandidates.push({
            rawInput: cell.input,
            fullCitation,
            sourceType: label !== "לא ידוע" ? label : null,
          });
        }

        supabase
          .from("citation_history")
          .insert({
            raw_input: cell.input,
            formatted_output: fullCitation,
            source_type: label !== "לא ידוע" ? label : null,
            is_verified: isVerified,
          })
          .then(() => {});
      }

      if (verifiedCandidates.length > 0) {
        ensureVerifiedSources(verifiedCandidates).catch(() => {});
      }

      if (integrityQueue.length > 0) {
        setPendingIntegrity(integrityQueue);
      }

      const bibItems = nextCells
        .filter((cell) => {
          if (!cell.output) return false;
          const cleaned = extractCitationOnly(cell.output);
          if (/^שם[.,\s]|^שם$/.test(cleaned.trim())) return false;
          if (/לעיל ה"ש/.test(cleaned)) return false;
          return true;
        })
        .map((cell) => ({
          rawInput: cell.input,
          fullCitation: extractCitationOnly(cell.output!),
        }));

      const syncedCount = bibliography.syncFootnoteEntries(bibItems);
      if (syncedCount > 0) {
        toast(`${syncedCount} מקורות חושבו מחדש בביבליוגרפיה`, { duration: 3000, icon: "📚" });
      }

      const total = validCount + warningCount;
      const repeatNote = nextCells.some((c) => c.output && /שם|לעיל/.test(c.output))
        ? " שים לב לתיקונים בנסיבות של אזכור חוזר."
        : "";
      setSummary(
        `בניתי עבורך ${total} הערות שוליים לפי הכללים.${
          warningCount > 0 ? ` ${warningCount} הערות דורשות השלמת פרטים.` : ""
        }${repeatNote}`
      );

      setPhase("final");
    } catch (e) {
      console.error("[finalize] failed", e);
      toast.error("שגיאה בבניית הרשימה הסופית");
    } finally {
      setFinalizing(false);
    }
  };


  const copyAll = () => {
    const outputs = cells
      .filter((c) => c.output)
      .map((c) => {
        const citation = extractCitationOnly(c.output!);
        return `[${c.id}] ${citation}`;
      })
      .join("\n\n");

    if (!outputs) {
      toast.error("אין הערות שוליים להעתקה");
      return;
    }
    copyCitationsRich(outputs.split("\n\n"));
    toast.success("כל הערות השוליים הועתקו ללוח!");
  };

  const copySingle = (cell: FootnoteCell) => {
    if (!cell.output) return;
    const citation = extractCitationOnly(cell.output);
    copyCitationRich(citation);
    toast.success(`הערה ${cell.id} הועתקה!`);
  };

  const resetAll = () => {
    setCells(Array.from({ length: 5 }, (_, i) => createCell(i + 1)));
    setSummary(null);
    setPhase("input");
    localStorage.removeItem(getCellsKey(projectId));
    localStorage.removeItem(getSummaryKey(projectId));
    localStorage.removeItem(getPhaseKey(projectId));
  };

  const hasAnyOutput = cells.some((c) => c.output);
  const hasAnyInput = cells.some((c) => c.input.trim());
  const outputCells = cells.filter((c) => c.output);
  const currentIntegrity = pendingIntegrity[0] ?? null;

  const handleIntegrityConfirm = async (prefs: YearPreferences) => {
    if (!currentIntegrity) return;
    const { cellId, rawInput, fullCitation, sourceType } = currentIntegrity;
    const adjustedCitation = applyYearPreferences(fullCitation, prefs);

    // Update cell output
    setCells(prev => prev.map(c =>
      c.id === cellId ? { ...c, output: applyYearPreferences(c.output!, prefs) } : c
    ));

    // Save to verified sources with year prefs
    ensureVerifiedSources([{
      rawInput,
      fullCitation: adjustedCitation,
      sourceType,
      autoVerified: true,
      yearPreferences: prefs,
    }]).catch(() => {});

    // Move to next
    setPendingIntegrity(prev => prev.slice(1));
  };

  const handleIntegrityCancel = async () => {
    if (!currentIntegrity) return;
    const { rawInput, fullCitation, sourceType } = currentIntegrity;

    // Save with defaults (both years present)
    ensureVerifiedSources([{
      rawInput,
      fullCitation,
      sourceType,
      autoVerified: true,
      yearPreferences: { hasHebrewYear: true, hasGregorianYear: true },
    }]).catch(() => {});

    setPendingIntegrity(prev => prev.slice(1));
  };

  return (
    <div className="py-6" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-foreground text-lg font-bold font-sans">
            בניית הערות שוליים
          </h3>
          <p className="text-muted-foreground text-xs mt-0.5">
            ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasAnyInput && (
            <button
              onClick={resetAll}
              className="text-xs text-muted-foreground hover:text-destructive px-2 py-1.5 rounded-lg transition-colors"
            >
              🗑 נקה
            </button>
          )}
        </div>
      </div>

      {/* === INPUT SECTION === */}
      {phase === "input" && (
        <>
          {!hasAnyInput && (
            <div className="mb-3 rounded-xl border border-dashed border-border bg-muted/30 p-3">
              <p className="text-sm text-foreground">
                הזינו מקורות לפי הסדר — ReLex יבנה הערות שוליים מסודרות ויחיל אוטומטית את כללי האזכור החוזר.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {[
                  'ע"א 6821/93 בנק המזרחי נ\' מגדל',
                  "חוק החוזים (חלק כללי), התשל\"ג-1973",
                  "Brown v. Board of Education, 347 U.S. 483 (1954)",
                ].map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => updateCellInput(cells[0].id, ex)}
                    className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground hover:border-primary/40 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
            <div className="space-y-2.5">
              {cells.map((cell, index) => (
                <div
                  key={`cell-${index}`}
                  draggable={!globalLoading}
                  onDragStart={() => handleDragStart(index)}
                  onDragEnter={() => handleDragEnter(index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                  className={`flex items-start gap-2 transition-opacity ${
                    dragIndex === index ? "opacity-40" : ""
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1.5 cursor-grab active:cursor-grabbing ${
                      cell.status === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"
                    }`}
                    title="גרור לשינוי סדר"
                  >
                    {cell.status === "verified" ? "✓" : cell.id}
                  </div>
                  <VerifiedAutocomplete
                    value={cell.input}
                    onChange={(v) => updateCellInput(cell.id, v)}
                    onSelectCitation={(citation) => setCellVerified(cell.id, citation)}
                    placeholder="הזן מקור (פסיקה, חקיקה, ספרות...)"
                    disabled={globalLoading}
                  />
                  {cells.length > 1 && (
                    <button
                      onClick={() => removeCell(cell.id)}
                      className="text-[11px] text-muted-foreground hover:text-destructive px-1.5 py-2 rounded transition-colors flex-shrink-0 mt-0.5"
                      title="הסר"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={addCell}
              disabled={globalLoading}
              className="mt-3 w-full py-2 border-2 border-dashed border-border hover:border-primary/40 rounded-lg text-muted-foreground hover:text-primary transition-all text-sm font-medium disabled:opacity-40"
            >
              + הוסף מקור
            </button>
          </div>

          <button
            onClick={draftAllCells}
            disabled={globalLoading || !hasAnyInput}
            className="mt-4 w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: globalLoading || !hasAnyInput ? "hsl(var(--muted))" : "var(--gradient-primary)",
              color: globalLoading || !hasAnyInput ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
            }}
          >
            {globalLoading ? "מכין טיוטות לבדיקה..." : "⚖ בנה טיוטות לבדיקה"}
          </button>
        </>
      )}

      {/* === REVIEW PHASE === */}
      {phase === "review" && (() => {
        const reviewable = cells.filter((c) => c.input.trim());
        const approvedCount = reviewable.filter((c) => c.approved).length;
        const total = reviewable.length;
        const allApproved = total > 0 && approvedCount === total;
        return (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between bg-primary/5 border border-primary/15 rounded-xl px-4 py-3">
              <div className="text-sm text-foreground">
                <span className="font-semibold">שלב בדיקה:</span> בדוק כל הערה, ערוך או הפק מחדש לפי הצורך, ואשר אותה.
                <span className="block text-xs text-muted-foreground mt-0.5">
                  אושרו {approvedCount} מתוך {total}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPhase("input")}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg transition-colors"
                >
                  ← חזור לעריכה
                </button>
                <button
                  onClick={approveAll}
                  disabled={total === 0}
                  className="text-xs bg-primary/15 text-primary hover:bg-primary/25 px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-40"
                >
                  ✓ אשר הכל
                </button>
              </div>
            </div>

            {reviewable.map((cell) => (
              <FootnoteReviewCard
                key={cell.id}
                cell={cell}
                onInputChange={updateCellInput}
                onOutputChange={handleReviewOutputChange}
                onSourceTypeChange={handleReviewSourceTypeChange}
                onApproveToggle={handleReviewApproveToggle}
                onRegenerate={regenerateOne}
                onRemove={removeCell}
                disabled={finalizing}
              />
            ))}

            <button
              onClick={finalizeApproved}
              disabled={finalizing || !allApproved}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: !allApproved || finalizing ? "hsl(var(--muted))" : "var(--gradient-primary)",
                color: !allApproved || finalizing ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
              }}
            >
              {finalizing
                ? "בונה רשימה סופית..."
                : allApproved
                ? "🏛 בנה רשימה סופית"
                : `יש לאשר את כל ההערות (${approvedCount}/${total})`}
            </button>
          </div>
        );
      })()}

      {/* === FINAL PHASE TOP BAR === */}
      {phase === "final" && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/15 rounded-xl px-4 py-2.5 mb-4">
          <span className="text-sm font-semibold text-foreground">📄 רשימה סופית</span>
          <button
            onClick={() => setPhase("review")}
            className="text-xs text-primary hover:underline px-2 py-1"
          >
            ← חזור לעריכה ובדיקה
          </button>
        </div>
      )}


      {/* === OUTPUT SECTION === */}
      {phase === "final" && (hasAnyOutput || globalLoading) && (
        <div className="mt-5 bg-card border border-border rounded-xl shadow-sm animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h4 className="text-foreground text-sm font-bold font-sans">
              📄 הערות שוליים
            </h4>
            {hasAnyOutput && (
              <div className="flex items-center gap-2">
                {isOfficeAddin && (
                  <button
                    onClick={async () => {
                      setIsInsertingAll(true);
                      let inserted = 0;
                      let copied = 0;
                      for (const cell of outputCells) {
                        if (cell.output) {
                          const result = await insertCitationAsFootnote(cell.output);
                          if (result.mode === "manual-copy") {
                            copied++;
                          } else {
                            inserted++;
                          }
                        }
                      }
                      setIsInsertingAll(false);
                      if (inserted > 0) {
                        toast.success(`הוכנסו ${inserted} הערות שוליים ל-Word`);
                      }
                      if (copied > 0) {
                        toast.info(`${copied} הערות הועתקו ללוח — הדבק/י ב-Word ידנית (Ctrl+V)`, { duration: 6000 });
                      }
                    }}
                    disabled={isInsertingAll || !hasDocumentAccess}
                    className="text-xs bg-secondary/10 text-secondary hover:bg-secondary/20 border border-secondary/30 px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-50"
                    title={!hasDocumentAccess ? "ממתין לחיבור ל-Word..." : ""}
                  >
                    {isInsertingAll ? "⏳ מכניס..." : !hasDocumentAccess ? "⏳ מתחבר ל-Word..." : "📝 הכנס הכל ל-Word"}
                  </button>
                )}
                <button
                  onClick={copyAll}
                  className="text-xs bg-primary/15 text-primary hover:bg-primary/25 px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  📋 העתק הכל
                </button>
              </div>
            )}
          </div>

          <div className="p-4 space-y-3">
            {globalLoading && !hasAnyOutput && (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span>מעבד הערות שוליים...</span>
              </div>
            )}

            {outputCells.map((cell) => (
              <div
                key={cell.id}
                className="flex items-start gap-3 group"
              >
                <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                  <span className="text-primary font-bold text-sm font-sans">[{cell.id}]</span>
                  {cell.status === "verified" && (
                    <span className="text-emerald-600 text-xs" title="מקור מאומת">✓</span>
                  )}
                  {cell.status === "warning" && (
                    <span className="text-destructive text-xs" title={cell.warningMsg}>⚠</span>
                  )}
                </div>
                <div className="flex-1 text-foreground text-sm leading-relaxed">
                  <FormattedCitation text={cell.output!} enableTooltips />
                </div>
                {isOfficeAddin && (
                  <button
                    onClick={async () => {
                      setInsertingCellId(cell.id);
                      const result = await insertCitationAsFootnote(cell.output!);
                      if (result.mode === "manual-copy") {
                        toast.info("הועתק ללוח — הדבק/י ב-Word ידנית (Ctrl+V)", { duration: 5000 });
                      } else {
                        toast.success(result.mode === "footnote" ? "הוכנס כהערת שוליים!" : "הוכנס כטקסט!");
                      }
                      setInsertingCellId(null);
                    }}
                    disabled={insertingCellId === cell.id || !hasDocumentAccess}
                    className="text-[11px] text-secondary hover:bg-secondary/10 px-2 py-1 rounded transition-colors flex-shrink-0 disabled:opacity-50"
                    title={!hasDocumentAccess ? "ממתין לחיבור ל-Word..." : "הכנס ל-Word"}
                  >
                    {insertingCellId === cell.id ? "⏳" : !hasDocumentAccess ? "⏳" : "📝"}
                  </button>
                )}
                <button
                  onClick={() => copySingle(cell)}
                  className="text-[11px] text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                >
                  📋
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className="mt-4 bg-primary/5 border border-primary/15 rounded-xl p-3 text-sm text-foreground animate-fade-in">
          <div className="flex items-start gap-2">
            <span className="text-lg">🏛</span>
            <div>
              <p className="font-semibold text-primary text-xs mb-0.5">
                העוזר המשפטי האוטומטי
              </p>
              <p className="text-foreground/80">{summary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Publication Integrity Card */}
      {currentIntegrity && (
        <div className="mt-4 animate-fade-in">
          <p className="text-xs text-muted-foreground mb-2">
            וידוא פרסום ({pendingIntegrity.length} נותרו)
          </p>
          <PublicationIntegrityCard
            lawName={currentIntegrity.lawName}
            onConfirm={handleIntegrityConfirm}
            onCancel={handleIntegrityCancel}
          />
        </div>
      )}
    </div>
  );
}
