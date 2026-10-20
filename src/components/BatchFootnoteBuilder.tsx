import { newTelemetryBatch, sourceTelemetry, type CostTelemetry } from "@/lib/costTelemetry";
import { planForItem, recordGeneration } from "@/lib/foreignClassificationStore";
import type { GenerationPlan } from "@/lib/foreignClassification";
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
import { runCitation, CitationRunError, type RunCitationResult, type CitationRunRetry, type CitationRunRecovery } from "@/lib/runCitation";
import { citationRetryDisclosure } from "@/lib/functionError";
import { useCitationRowGuard } from "@/lib/useCitationRowGuard";
import { runPool } from "@/lib/concurrency";
import { applyRepeatCitationRules, extractCitationOnly, extractCitationPresentation } from "@/lib/footnoteRepeatRules";
import { splitCitationWarnings } from "@/lib/citationSegments";
import { useAuth } from "@/hooks/useAuth";
import { activeCitationDiagnostic, citationDiagnosticCandidate, prepareCitationDiagnostic } from "@/lib/citationDiagnostic";

interface FootnoteCell {
  id: number;
  /** Stable through display-number changes and row removal. */
  key: string;
  citationRetry?: CitationRunRetry;
  recovery?: CitationRunRecovery;
  input: string;
  output: string | null;
  status: "empty" | "loading" | "valid" | "warning" | "verified" | "error";
  warningMsg?: string;
  errorMsg?: string;
  requestId?: string;
  verifiedCitation?: string;
  approved?: boolean;
  sourceTypeOverride?: SourceType;
  detectedType?: SourceType;
  /** Cost-telemetry ids kept until later verify-source. */
  telemetry?: CostTelemetry;
}

interface PendingIntegrity {
  cellId: number;
  lawName: string;
  rawInput: string;
  fullCitation: string;
  sourceType: string | null;
  telemetry?: CostTelemetry;
}

type Phase = "input" | "review" | "final";

const createCell = (id: number): FootnoteCell => ({
  id,
  key: crypto.randomUUID(),
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
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(c => ({ ...c, key: c.key || crypto.randomUUID(), citationRetry: undefined, requestId: undefined, recovery: undefined, status: c.status === "loading" ? "empty" : c.status }));
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
  const { user, isAdmin, isAdminResolved } = useAuth();
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
  const rowGuard = useCitationRowGuard(`${user?.id ?? ""}:${projectId ?? ""}`);
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  useEffect(() => {
    const populated = cells.filter((cell) => cell.input.trim());
    if (!isAdminResolved || populated.length !== 1) return;
    const tag = citationDiagnosticCandidate(populated[0].input, isAdmin, window.location.search);
    if (tag) void prepareCitationDiagnostic(tag);
  }, [cells, isAdmin, isAdminResolved]);

  // Drop in-memory retry actions on account/project changes.
  useEffect(() => {
    rowGuard.invalidate();
    setGlobalLoading(false);
    setCells(loadCells(projectId));
    setSummary(localStorage.getItem(getSummaryKey(projectId)));
    setPhase(loadPhase(projectId));
  }, [projectId, user?.id, rowGuard]);

  useEffect(() => {
    // Retry authority and retained engine/render context must stay in memory.
    const savedCells = cells.map(({ citationRetry: _retry, recovery: _recovery, requestId: _requestId, ...cell }) => cell);
    localStorage.setItem(getCellsKey(projectId), JSON.stringify(savedCells));
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
    const cell = cellsRef.current.find((c) => c.id === id);
    if (cell) rowGuard.invalidate(cell.key);
    setCells((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, input: value, status: "empty", verifiedCitation: undefined, citationRetry: undefined, requestId: undefined, recovery: undefined } : c
      )
    );
  }, [rowGuard]);

  const setCellVerified = useCallback((id: number, citation: string) => {
    const cell = cellsRef.current.find((c) => c.id === id);
    if (cell) rowGuard.invalidate(cell.key);
    setCells((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, output: citation, status: "verified", verifiedCitation: citation, citationRetry: undefined, requestId: undefined, recovery: undefined } : c
      )
    );
  }, [rowGuard]);

  const addCell = useCallback(() => {
    setCells((prev) => [...prev, createCell(prev.length + 1)]);
  }, []);

  const removeCell = useCallback((id: number) => {
    if (cellsRef.current.length <= 1) return;
    const cell = cellsRef.current.find((c) => c.id === id);
    if (cell) rowGuard.invalidate(cell.key);
    setCells((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((c) => c.id !== id).map((c, i) => ({ ...c, id: i + 1 }));
    });
  }, [rowGuard]);

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
    overrideType?: SourceType,
    telemetry: CostTelemetry = sourceTelemetry(newTelemetryBatch("footnotes")),
    isResultCurrent?: () => boolean,
    recovery?: CitationRunRecovery,
  ): Promise<RunCitationResult> =>
    recovery ? recovery.retry(isResultCurrent) : runCitation({ rawInput: input, isResultCurrent, overrideType, projectId, useVerifiedStore: true, telemetry,
      diagnostic: activeCitationDiagnostic(input, isAdminResolved && isAdmin, window.location.search) });

  const applyResultToCell = (c: FootnoteCell, res: RunCitationResult): FootnoteCell => ({
    ...c,
    output: res.reply,
    telemetry: res.telemetry,
    status: res.status,
    warningMsg: res.status === "warning" ? res.warningMsg : undefined,
    errorMsg: undefined,
    citationRetry: undefined, requestId: undefined, recovery: undefined,
    verifiedCitation: res.fromVerifiedStore ? res.citation : undefined,
    detectedType: res.sourceType,
    approved: false,
  });

  /** Unsupported classification: keep the output but flag it (never valid). */
  const withPlanWarning = (c: FootnoteCell, plan: GenerationPlan | null): FootnoteCell =>
    plan?.warning ? { ...c, status: c.status === "error" ? c.status : "warning", warningMsg: [c.warningMsg, plan.warning].filter(Boolean).join(" · ") } : c;

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

    const batchJob = rowGuard.begin("batch");
    if (!batchJob) return;
    const rowJobs = activeCells.map((cell) => rowGuard.begin(cell.key));
    setGlobalLoading(true);
    setSummary(null);

    setCells((prev) =>
      prev.map((c) =>
        c.input.trim() && c.status !== "verified"
          ? { ...c, status: "loading", output: null, errorMsg: undefined, approved: false, citationRetry: undefined, requestId: undefined }
          : c
      )
    );

    // Bounded concurrency: each citation-chat call does grounded web lookups,
    // so firing every row at once gets the batch rate-limited.
    // One stable telemetry identity per logical row, created BEFORE retries.
    const telemetryBatch = newTelemetryBatch("footnotes");
    const rowTelemetry = activeCells.map(() => sourceTelemetry(telemetryBatch));
    const rowPlans = activeCells.map((c) => (c.recovery ? null : planForItem(user?.id, `batch:${c.key}`, c.input)));
    const results = await runPool(
      activeCells,
      (cell, i) => runSingleCitation(cell.input, rowPlans[i]?.sourceType ?? cell.sourceTypeOverride, rowTelemetry[i],
        () => batchJob.isCurrent() && !!rowJobs[i]?.isCurrent(), cell.recovery),
      {
        concurrency: 2,
        retries: 0,
        onSettled: (index, result) => {
          const rowJob = rowJobs[index];
          if (!batchJob.isCurrent() || !rowJob?.isCurrent()) return;
          const cellKey = activeCells[index].key;
          if (result.ok && result.value) {
            const value = result.value;
            const plan = rowPlans[index];
            if (plan) recordGeneration(user?.id, plan);
            setCells((prev) => prev.map((c) => (c.key === cellKey ? withPlanWarning(applyResultToCell(c, value), plan) : c)));
          } else {
            const message = errorMessageOf(result.error);
            setCells((prev) =>
              prev.map((c) =>
                c.key === cellKey ? { ...c, status: "error" as const, output: null, errorMsg: message,
                  citationRetry: result.error instanceof CitationRunError ? result.error.citationRetry : undefined,
                  recovery: result.error instanceof CitationRunError ? result.error.recovery : undefined,
                  requestId: result.error instanceof CitationRunError ? result.error.requestId : undefined } : c
              )
            );
          }
          rowJob.finish();
        },
      }
    );

    if (!batchJob.isCurrent()) { rowJobs.forEach((job) => job?.finish()); batchJob.finish(); return; }
    rowJobs.forEach((job) => job?.finish());
    batchJob.finish();
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
  const regenerateOne = async (id: number, explicitRetry?: CitationRunRetry, expectedKey?: string) => {
    const cell = cellsRef.current.find((c) => expectedKey ? c.key === expectedKey : c.id === id);
    if (!cell || !cell.input.trim() || (explicitRetry && cell.citationRetry !== explicitRetry)) return;
    const job = rowGuard.begin(cell.key);
    if (!job) return;
    setCells((prev) => prev.map((c) => c.key === cell.key
      ? { ...c, status: "loading", output: null, errorMsg: undefined, approved: false, citationRetry: undefined, requestId: undefined } : c));
    // Explicit regeneration uses the effective foreign classification (if set).
    const plan = explicitRetry || cell.recovery ? null : planForItem(user?.id, `batch:${cell.key}`, cell.input);
    try {
      const res = await runSingleCitation(cell.input, plan?.sourceType ?? cell.sourceTypeOverride, undefined, job.isCurrent, explicitRetry ?? cell.recovery);
      if (!job.isCurrent()) return;
      if (plan) recordGeneration(user?.id, plan);
      setCells((prev) => applyRepeatCitationRules(prev.map((c) => c.key === cell.key ? withPlanWarning(applyResultToCell(c, res), plan) : c)));
    } catch (e) {
      if (!job.isCurrent()) return;
      const message = errorMessageOf(e);
      setCells((prev) => prev.map((c) => c.key === cell.key
        ? { ...c, status: "error", output: null, errorMsg: message,
          citationRetry: e instanceof CitationRunError ? e.citationRetry : undefined,
          recovery: e instanceof CitationRunError ? e.recovery : undefined,
                  requestId: e instanceof CitationRunError ? e.requestId : undefined } : c));
      toast.error(`הפקה מחדש של הערה ${id} נכשלה`, { description: message });
    } finally { job.finish(); }
  };


  // Per-cell handlers used by the review card.
  const handleReviewOutputChange = useCallback((id: number, value: string) => {
    const cell = cellsRef.current.find((c) => c.id === id);
    if (cell) rowGuard.invalidate(cell.key);
    setCells((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, output: value, approved: false, citationRetry: undefined, requestId: undefined, recovery: undefined } : c));
      return applyRepeatCitationRules(updated);
    });
  }, [rowGuard]);

  const handleReviewSourceTypeChange = useCallback((id: number, t: SourceType) => {
    const cell = cellsRef.current.find((c) => c.id === id);
    if (cell) rowGuard.invalidate(cell.key);
    setCells((prev) =>
      prev.map((c) => (c.id === id ? { ...c, sourceTypeOverride: t, approved: false, citationRetry: undefined, requestId: undefined, recovery: undefined } : c))
    );
  }, [rowGuard]);

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

      const verifiedCandidates: { rawInput: string; fullCitation: string; sourceType: string | null; yearPreferences?: YearPreferences; telemetry?: CostTelemetry }[] = [];
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
              telemetry: cell.telemetry,
            });
          } else {
            integrityQueue.push({
              cellId: cell.id,
              lawName,
              rawInput: cell.input,
              fullCitation,
              sourceType: label !== "לא ידוע" ? label : null,
              telemetry: cell.telemetry,
            });
          }
        } else if (isVerified) {
          verifiedCandidates.push({
            rawInput: cell.input,
            fullCitation,
            sourceType: label !== "לא ידוע" ? label : null,
            telemetry: cell.telemetry,
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
        .map((cell) => {
          // Styles and warnings travel to the bibliography; identity checks
          // above stay on the plain reading.
          const { citation, warnings } = splitCitationWarnings(extractCitationPresentation(cell.output!));
          return { rawInput: cell.input, fullCitation: citation, ...(warnings.length ? { warnings } : {}) };
        });

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
        // Style-preserving presentation text (not the plain identity form).
        const citation = extractCitationPresentation(c.output!);
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
    const citation = extractCitationPresentation(cell.output);
    copyCitationRich(citation);
    toast.success(`הערה ${cell.id} הועתקה!`);
  };

  const resetAll = () => {
    rowGuard.invalidate();
    setGlobalLoading(false);
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
      telemetry: currentIntegrity.telemetry,
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
      telemetry: currentIntegrity.telemetry,
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
                  key={cell.key}
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
                  onClick={() => {
                    rowGuard.invalidate();
                    setGlobalLoading(false);
                    setCells((prev) => prev.map((c) => ({ ...c, citationRetry: undefined, requestId: undefined,
                      status: c.status === "loading" ? "empty" : c.status })));
                    setPhase("input");
                  }}
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
                key={cell.key}
                cell={cell}
                onInputChange={updateCellInput}
                onOutputChange={handleReviewOutputChange}
                onSourceTypeChange={handleReviewSourceTypeChange}
                foreignScope={{ accountId: user?.id, itemKey: `batch:${cell.key}` }}
                onApproveToggle={handleReviewApproveToggle}
                onRegenerate={regenerateOne}
                newAttempt={cell.status === "error" && cell.citationRetry ? {
                  disclosure: citationRetryDisclosure(cell.citationRetry.descriptor),
                  onRetry: rowGuard.bind(cell.key, () => {
                    if (cell.citationRetry) void regenerateOne(cell.id, cell.citationRetry, cell.key);
                  }),
                } : undefined}
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
