import { CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export interface StageEvent {
  stage: string;
  status: "running" | "complete";
  label: string;
  detail?: string;
}

interface Props {
  stages: StageEvent[];
  postProcessingLabel?: string | null;
  /** Streaming draft text appended via draft_delta events. */
  draftText?: string;
  /** Run mode for the header copy. Defaults to research_deep. */
  mode?: "research_fast" | "research_deep" | "academic_chapter";
  /** When true, force progress bar to 100% (final event received). */
  isComplete?: boolean;
}

const HEADER_BY_MODE: Record<NonNullable<Props["mode"]>, string> = {
  research_fast: "מחפש, מסכם ומעגן מקורות...",
  research_deep: "מבצע מחקר משפטי מקיף (מנוע Deep)...",
  academic_chapter: "כותב פרק אקדמי (מנוע Deep)...",
};

// Stage-label overrides per mode. Keeps backend stage IDs untouched and
// lets the UI re-skin the same Deep pipeline for academic chapter writes.
const ACADEMIC_LABEL_OVERRIDES: Record<string, string> = {
  frame: "ניתוח שאלת הפרק",
  decompose: "פירוק טענות הפרק",
  retrieve: "אחזור מקורות אקדמיים",
  rerank: "דירוג מקורות לפרק",
  source_pack: "בחירת מקורות לפרק",
  claim_map: "מיפוי טענות הפרק",
  drafter: "כתיבת טיוטת הפרק",
  anchor_pass: "עיגון הציטוטים בפרק",
  coverage_gap: "בדיקת כיסוי הפרק",
  statute_completion: "השלמת חקיקה",
  footnote_validate: "אימות הערות שוליים",
};

// Expected stage sequences per mode — mirrors emitStage calls in
// supabase/functions/legal-qa/index.ts. Used only as a denominator for the
// progress bar; extra unexpected stages are absorbed by max().
const EXPECTED_STAGES: Record<NonNullable<Props["mode"]>, string[]> = {
  research_fast: [
    "frame", "decompose", "retrieve", "rerank", "source_pack",
    "drafter", "anchor_pass", "footnote_validate",
  ],
  research_deep: [
    "frame", "decompose", "retrieve", "rerank", "source_pack",
    "claim_map", "drafter", "anchor_pass",
    "coverage_gap", "statute_completion", "footnote_validate",
  ],
  academic_chapter: [
    "frame", "decompose", "retrieve", "rerank", "source_pack",
    "claim_map", "drafter", "anchor_pass",
    "coverage_gap", "statute_completion", "footnote_validate",
  ],
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Weighted progress model — the drafter is by far the longest phase
// (~60-120s vs. a few seconds each for everything else), so a naive
// "stages-completed / total-stages" ratio jumps to 80-90% within the first
// 10-15s and then sits there for the entire generation. Instead we carve
// the bar into bands that reflect real wall-clock weight:
//   0–40%   pre-drafter pipeline (frame → source_pack / claim_map)
//   40–90%  drafter — interpolated by streaming draft length while running
//   90–98%  post-drafter passes (anchor, coverage, statute, footnote_validate)
//   98–100% reserved until the `final` SSE event arrives (isComplete)
const DRAFTER_STAGE = "drafter";
const POST_DRAFTER_STAGES = new Set([
  "anchor_pass",
  "coverage_gap",
  "statute_completion",
  "footnote_validate",
  "critic",
  "revision",
]);
// Approx. chars in a typical finished chapter draft — used to interpolate
// the drafter band by streamed text length. Tuned generously so the bar
// keeps moving for long chapters without ever pinning at 90%.
const DRAFT_TARGET_CHARS = 6000;

function computePercent(
  visible: StageEvent[],
  postProcessingLabel: string | null,
  draftText: string,
  isComplete: boolean,
  expectedPreDrafter: number,
): number {
  if (isComplete) return 100;

  const isPre = (s: StageEvent) => s.stage !== DRAFTER_STAGE && !POST_DRAFTER_STAGES.has(s.stage) && s.stage !== "__starting__";
  const preDone = visible.filter((s) => s.status === "complete" && isPre(s)).length;
  const preRunning = visible.some((s) => s.status === "running" && isPre(s));
  const preDenom = Math.max(expectedPreDrafter, preDone + (preRunning ? 1 : 0), 1);
  let pct = Math.min(40, (preDone / preDenom) * 40);
  if (preRunning) pct = Math.min(40, pct + 40 / preDenom / 2);

  const drafter = visible.find((s) => s.stage === DRAFTER_STAGE);
  if (drafter) {
    if (drafter.status === "running") {
      pct = 40;
      if (draftText && draftText.length > 0) {
        pct += 50 * Math.min(1, draftText.length / DRAFT_TARGET_CHARS);
      } else {
        pct += 4;
      }
    } else {
      pct = 90;
    }
  }

  const postDone = visible.filter((s) => POST_DRAFTER_STAGES.has(s.stage) && s.status === "complete").length;
  const postRunning = visible.some((s) => POST_DRAFTER_STAGES.has(s.stage) && s.status === "running");
  if (postDone > 0 || postRunning) {
    const postDenom = Math.max(2, postDone + (postRunning ? 1 : 0));
    pct = Math.max(pct, 90 + (postDone / postDenom) * 8);
  }
  if (postProcessingLabel) pct = Math.max(pct, 96);

  return clamp(Math.round(pct), 1, 99);
}

/**
 * Live pipeline progress for SSE-streamed legal-qa runs.
 * Each backend `stage` event appends/upgrades a row here.
 * `draft_delta` chunks are concatenated into a streaming preview with a
 * blinking caret until the `final` event arrives.
 */
export function StageProgressList({
  stages,
  postProcessingLabel,
  draftText,
  mode = "research_deep",
  isComplete = false,
}: Props) {
  // De-dup by stage name, keeping the latest status (so "complete" overrides "running").
  const dedup = new Map<string, StageEvent>();
  for (const s of stages) dedup.set(s.stage, s);
  let visible = Array.from(dedup.values()).map((s) =>
    mode === "academic_chapter" && ACADEMIC_LABEL_OVERRIDES[s.stage]
      ? { ...s, label: ACADEMIC_LABEL_OVERRIDES[s.stage] }
      : s,
  );
  // Show a starter row immediately so the user sees the bar before the first
  // SSE stage event arrives (network warm-up, planner cold start, etc.).
  if (visible.length === 0 && !isComplete) {
    visible = [{ stage: "__starting__", status: "running", label: "מתחיל…" }];
  }

  const expectedPreDrafter = EXPECTED_STAGES[mode].filter(
    (s) => s !== DRAFTER_STAGE && !POST_DRAFTER_STAGES.has(s),
  ).length;
  const percent = computePercent(visible, postProcessingLabel ?? null, draftText ?? "", isComplete, expectedPreDrafter);

  return (
    <Card className="mt-4 border-border" dir="rtl">
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-foreground">{HEADER_BY_MODE[mode]}</div>
          <div className="text-xs font-mono tabular-nums text-muted-foreground" aria-live="polite">
            {percent}%
          </div>
        </div>

        <Progress value={percent} className="h-2" aria-label={`התקדמות ${percent}%`} />

        <ol className="space-y-1.5">
          {visible.map((s) => {
            const isDone = s.status === "complete";
            return (
              <li
                key={s.stage}
                className="flex items-center gap-2.5 text-sm animate-in fade-in slide-in-from-bottom-1 duration-200"
              >
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-secondary" aria-label="הושלם" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" aria-label="בעיבוד" />
                  )}
                </span>
                <span className={isDone ? "text-muted-foreground" : "text-foreground font-medium"}>
                  {s.label}
                </span>
                {s.detail && (
                  <span className="text-xs text-muted-foreground">— {s.detail}</span>
                )}
              </li>
            );
          })}

          {postProcessingLabel && (
            <li className="flex items-center gap-2.5 text-sm animate-in fade-in slide-in-from-bottom-1 duration-200">
              <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              </span>
              <span className="text-foreground font-medium">{postProcessingLabel}</span>
            </li>
          )}
        </ol>

        {draftText && draftText.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-xs text-muted-foreground mb-1.5">טיוטה חיה:</div>
            <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
              {draftText}
              <span className="inline-block w-1.5 h-4 bg-primary align-middle mr-0.5 animate-pulse" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
