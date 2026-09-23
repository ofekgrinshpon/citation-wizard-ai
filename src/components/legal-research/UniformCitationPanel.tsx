import { useCallback, useState } from "react";
import { toast } from "sonner";
import { FootnoteReviewCard, type ReviewCardCell } from "@/components/FootnoteReviewCard";
import { runCitation, CitationRunError, type RunCitationResult } from "@/lib/runCitation";
import { runPool, isTransientError } from "@/lib/concurrency";
import { applyRepeatCitationRules, extractCitationOnly, stripPresentationWarnings } from "@/lib/footnoteRepeatRules";
import { CREDIT_COSTS } from "@/lib/creditCosts";
import { copyCitationRich, copyCitationsRich } from "@/lib/citationRichText";
import { insertCitationAsFootnote } from "@/lib/wordInsertion";
import { useOffice } from "@/hooks/useOffice";
import { useProjects } from "@/hooks/useProjects";
import type { SourceType } from "@/data/abbreviations";
import { Button } from "@/components/ui/button";

export type UniformFootnoteSource = { title: string; url?: string | null; source_type?: string };
export type UniformFootnote = {
  number: number;
  title: string;
  url?: string | null;
  sources?: UniformFootnoteSource[];
};

interface Cell extends ReviewCardCell {
  /** The untouched V2 footnote text, kept as regeneration grounding. */
  originalCitation: string;
  originalUrl?: string | null;
}

/**
 * Build the richest possible citation input from the V2 footnote metadata.
 * No new research happens — this only reshapes what V2 already verified.
 */
export function buildCitationInput(fn: UniformFootnote): string {
  const parts: string[] = [];
  const titles =
    fn.sources && fn.sources.length > 0
      ? fn.sources.map((s) => s.title).filter(Boolean)
      : [fn.title];
  parts.push(titles.join(" ; "));
  const url = fn.url ?? fn.sources?.find((s) => s.url)?.url ?? null;
  if (url) parts.push(url);
  return parts.filter(Boolean).join(" — ").trim();
}

interface Props {
  footnotes: UniformFootnote[];
}

export function UniformCitationPanel({ footnotes }: Props) {
  const { currentProject } = useProjects();
  const { isOfficeAddin, hasDocumentAccess } = useOffice();
  const projectId = currentProject?.id;

  const [confirming, setConfirming] = useState(false);
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);

  const maxCost = footnotes.length * CREDIT_COSTS.batchPerCitation;

  const applyResult = (c: Cell, res: RunCitationResult): Cell => ({
    ...c,
    output: res.reply,
    status: res.status,
    warningMsg: res.status === "warning" ? res.warningMsg : undefined,
    errorMsg: undefined,
    detectedType: res.sourceType,
    approved: false,
  });

  const errorMessageOf = (e: unknown) =>
    (e as { userMessage?: string })?.userMessage || "לא ניתן היה ליצור אזכור אחיד למקור זה";

  const start = async () => {
    setConfirming(false);
    setStarted(true);
    setRunning(true);

    const initial: Cell[] = footnotes.map((fn) => ({
      id: fn.number,
      input: buildCitationInput(fn),
      output: null,
      status: "loading",
      originalCitation: fn.title,
      originalUrl: fn.url ?? null,
    }));
    setCells(initial);
    setProgress({ done: 0, total: initial.length });

    let done = 0;
    await runPool(
      initial,
      (cell) =>
        runCitation({
          rawInput: cell.input,
          overrideType: cell.sourceTypeOverride,
          projectId,
          useVerifiedStore: true,
        }),
      {
        concurrency: 2,
        retries: 1,
        shouldRetry: (e) =>
          isTransientError(e) && !(e as CitationRunError)?.isInsufficientCredits,
        onSettled: (index, result) => {
          const cellId = initial[index].id;
          done += 1;
          setProgress({ done, total: initial.length });
          if (result.ok && result.value) {
            const value = result.value;
            setCells((prev) => prev.map((c) => (c.id === cellId ? applyResult(c, value) : c)));
          } else {
            const message = errorMessageOf(result.error);
            setCells((prev) =>
              prev.map((c) =>
                c.id === cellId
                  ? { ...c, status: "error" as const, output: null, errorMsg: message }
                  : c,
              ),
            );
          }
        },
      },
    );

    setCells((prev) => applyRepeatCitationRules(prev));
    setRunning(false);
    setProgress(null);
  };

  const regenerateOne = async (id: number) => {
    const cell = cells.find((c) => c.id === id);
    if (!cell || !cell.input.trim()) return;
    setCells((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, status: "loading", output: null, errorMsg: undefined, approved: false } : c,
      ),
    );
    try {
      const res = await runCitation({
        rawInput: cell.input,
        overrideType: cell.sourceTypeOverride,
        projectId,
        useVerifiedStore: true,
      });
      setCells((prev) =>
        applyRepeatCitationRules(prev.map((c) => (c.id === id ? applyResult(c, res) : c))),
      );
    } catch (e) {
      const message = errorMessageOf(e);
      setCells((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "error", output: null, errorMsg: message } : c)),
      );
      toast.error(`יצירת אזכור אחיד להערה ${id} נכשלה`, { description: message });
    }
  };

  const handleInputChange = useCallback((id: number, value: string) => {
    setCells((prev) => prev.map((c) => (c.id === id ? { ...c, input: value, approved: false } : c)));
  }, []);

  const handleOutputChange = useCallback((id: number, value: string) => {
    setCells((prev) =>
      applyRepeatCitationRules(
        prev.map((c) => (c.id === id ? { ...c, output: value, approved: false } : c)),
      ),
    );
  }, []);

  const handleSourceTypeChange = useCallback((id: number, t: SourceType) => {
    setCells((prev) =>
      prev.map((c) => (c.id === id ? { ...c, sourceTypeOverride: t, approved: false } : c)),
    );
  }, []);

  const handleApproveToggle = useCallback((id: number, approved: boolean) => {
    setCells((prev) => prev.map((c) => (c.id === id ? { ...c, approved } : c)));
  }, []);

  /** The final text for a footnote: the reviewed citation, or the original V2 line. */
  const finalTextOf = (c: Cell) =>
    stripPresentationWarnings(c.output ? extractCitationOnly(c.output) : c.originalCitation);

  const copySingle = async (id: number) => {
    const cell = cells.find((c) => c.id === id);
    if (!cell) return;
    await copyCitationRich(finalTextOf(cell));
    toast.success(`הערה ${id} הועתקה`);
  };

  const copyAll = async () => {
    const lines = cells.map((c) => `[${c.id}] ${finalTextOf(c)}`);
    if (!lines.join("").trim()) return;
    await copyCitationsRich(lines);
    toast.success("כל ההערות הועתקו ללוח");
  };

  const insertAllToWord = async () => {
    let inserted = 0;
    let copied = 0;
    for (const c of cells) {
      const res = await insertCitationAsFootnote(finalTextOf(c));
      if (res.mode === "manual-copy") copied++;
      else inserted++;
    }
    if (inserted > 0) toast.success(`הוכנסו ${inserted} הערות שוליים ל-Word`);
    if (copied > 0) toast.info(`${copied} הערות הועתקו ללוח — הדבק/י ב-Word ידנית`, { duration: 6000 });
  };

  const approveAll = () =>
    setCells((prev) => prev.map((c) => (c.output ? { ...c, approved: true } : c)));

  const approvedCount = cells.filter((c) => c.approved).length;
  const failedCount = cells.filter((c) => c.status === "error").length;

  if (!started) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        {!confirming ? (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)} className="text-xs">
            יצירת הערות שוליים לפי כללי האזכור האחיד
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-foreground leading-relaxed">
              נמצאו {footnotes.length} הערות שוליים. יצירת אזכור אחיד צורכת ממכסת השימוש שלך
              ועשויה להימשך מספר שניות. להמשיך?
            </p>
            <p className="text-xs text-muted-foreground">
              מקורות שכבר קיימים במאגר המקורות המאומתים אינם מחויבים.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={start} className="text-xs">
                המשך
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} className="text-xs">
                ביטול
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">אזכור אחיד</h3>
          <p className="text-[11px] text-muted-foreground">
            טיוטה לעריכה ואישור — עיצוב אזכורים בלבד, אינו אימות משפטי נוסף.
          </p>
        </div>
        {!running && cells.length > 0 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={approveAll} className="text-xs">
              ✓ אשר הכל ({approvedCount}/{cells.length})
            </Button>
            {isOfficeAddin && (
              <Button
                size="sm"
                variant="outline"
                onClick={insertAllToWord}
                disabled={!hasDocumentAccess}
                className="text-xs"
              >
                📝 הכנס הכל ל-Word
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={copyAll} className="text-xs">
              📋 העתק הכל
            </Button>
          </div>
        )}
      </div>

      {running && progress && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span>
            מעבד הערות שוליים {Math.min(progress.done + 1, progress.total)} מתוך {progress.total}…
          </span>
        </div>
      )}

      {!running && failedCount > 0 && (
        <p className="text-xs text-amber-700">
          {failedCount} הערות נכשלו — הן נשארות עם האזכור המקורי של המחקר, וניתן לנסות שוב בכל כרטיס.
        </p>
      )}

      <div className="space-y-2">
        {cells.map((c) => (
          <div key={c.id} className="space-y-1">
            <FootnoteReviewCard
              cell={c}
              onInputChange={handleInputChange}
              onOutputChange={handleOutputChange}
              onSourceTypeChange={handleSourceTypeChange}
              onApproveToggle={handleApproveToggle}
              onRegenerate={regenerateOne}
              onRemove={() => toast.info("המספור נשמר לפי התשובה — לא ניתן להסיר הערה")}
              onCopy={copySingle}
              hideRemove
              originLabel={c.originalCitation}
            />
            {c.status === "error" && (
              <p className="text-[11px] text-muted-foreground pr-1">
                נשמר האזכור המקורי: {c.originalCitation}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
