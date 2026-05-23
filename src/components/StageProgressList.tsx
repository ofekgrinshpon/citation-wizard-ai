import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export interface StageEvent {
  stage: string;
  status: "running" | "complete";
  label: string;
  detail?: string;
}

type Mode = "research_fast" | "research_deep" | "academic_chapter";

interface Props {
  stages: StageEvent[];
  postProcessingLabel?: string | null;
  draftText?: string;
  mode?: Mode;
  isComplete?: boolean;
}

const HEADER_BY_MODE: Record<Mode, string> = {
  research_fast: "מחפש, מסכם ומעגן מקורות...",
  research_deep: "מבצע מחקר משפטי מקיף (מנוע Deep)...",
  academic_chapter: "כותב פרק אקדמי (מנוע Deep)...",
};

interface StageDef {
  id: string;
  label: string;
  weight: number;
  subtitle: string;
}

// Matches the stage names actually emitted by supabase/functions/legal-qa/core/runCore.ts
// plus the dedicated `post_processing` SSE event from index.ts. Weights sum to 1.0.
const DEEP_MANIFEST: StageDef[] = [
  { id: "plan",             label: "תכנון מחקר",        weight: 0.08, subtitle: "מבין את השאלה ובונה תכנית מחקר" },
  { id: "retrieval",        label: "אחזור מקורות",      weight: 0.22, subtitle: "מאחזר פסיקה, חקיקה ומקורות אקדמיים" },
  { id: "verify",           label: "אימות וסינון",       weight: 0.10, subtitle: "מסנן ומדרג את המקורות לפי רלוונטיות" },
  { id: "ledger",           label: "מיפוי טענות",        weight: 0.05, subtitle: "בונה מיפוי בין טענות למקורות" },
  { id: "draft",            label: "כתיבת התשובה",       weight: 0.30, subtitle: "כותב את התשובה ומשלב הערות שוליים" },
  { id: "enrich_citations", label: "השלמת ציטוטים",      weight: 0.15, subtitle: "מאמת ומשלים פרטי ציטוטים חסרים" },
  { id: "post_processing",  label: "בדיקת איכות סופית",  weight: 0.10, subtitle: "עיגון מקורות וניקוי טקסט סופי" },
];

const FAST_MANIFEST: StageDef[] = [
  { id: "plan",             label: "תכנון מהיר",         weight: 0.10, subtitle: "מנתח את השאלה" },
  { id: "retrieval",        label: "אחזור מקורות",      weight: 0.30, subtitle: "מאחזר מקורות רלוונטיים" },
  { id: "verify",           label: "סינון מקורות",       weight: 0.10, subtitle: "מדרג מקורות לפי רלוונטיות" },
  { id: "draft",            label: "כתיבת התשובה",       weight: 0.35, subtitle: "מנסח תשובה עם הערות שוליים" },
  { id: "enrich_citations", label: "השלמת ציטוטים",      weight: 0.10, subtitle: "משלים פרטי ציטוטים" },
  { id: "post_processing",  label: "בדיקה סופית",        weight: 0.05, subtitle: "עיגון מקורות" },
];

const ACADEMIC_MANIFEST: StageDef[] = [
  { id: "plan",             label: "ניתוח שאלת הפרק",    weight: 0.08, subtitle: "מתכנן את מבנה הפרק" },
  { id: "retrieval",        label: "אחזור מקורות אקדמיים", weight: 0.20, subtitle: "מאחזר מאמרים, פסיקה וחקיקה" },
  { id: "verify",           label: "דירוג מקורות לפרק",  weight: 0.10, subtitle: "מסנן מקורות לפי רלוונטיות אקדמית" },
  { id: "ledger",           label: "מיפוי טענות הפרק",   weight: 0.05, subtitle: "ממפה טענות למקורות" },
  { id: "draft",            label: "כתיבת טיוטת הפרק",   weight: 0.32, subtitle: "כותב את הפרק עם הערות שוליים" },
  { id: "enrich_citations", label: "השלמת ציטוטים",      weight: 0.15, subtitle: "מאמת פרטים ביבליוגרפיים" },
  { id: "post_processing",  label: "בדיקת איכות הפרק",   weight: 0.10, subtitle: "עיגון מקורות וניקוי" },
];

const MANIFEST_BY_MODE: Record<Mode, StageDef[]> = {
  research_fast: FAST_MANIFEST,
  research_deep: DEEP_MANIFEST,
  academic_chapter: ACADEMIC_MANIFEST,
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

interface ResolvedStage {
  def: StageDef;
  status: "pending" | "running" | "complete";
  detail?: string;
  bandStart: number; // percent
  bandEnd: number;
}

function resolveStages(
  manifest: StageDef[],
  stages: StageEvent[],
  postProcessingLabel?: string | null,
): { resolved: ResolvedStage[]; runningIdx: number; lastCompleteIdx: number } {
  // De-dup by stage id; last status wins.
  const byId = new Map<string, StageEvent>();
  for (const s of stages) byId.set(s.stage, s);

  // Append any unknown stages at the end with a small weight, then renormalize.
  const known = new Set(manifest.map((m) => m.id));
  const unknowns: StageDef[] = [];
  for (const id of byId.keys()) {
    if (!known.has(id)) {
      unknowns.push({
        id,
        label: id.replace(/_/g, " "),
        weight: 0.05,
        subtitle: "",
      });
    }
  }
  let full = [...manifest, ...unknowns];
  const total = full.reduce((s, d) => s + d.weight, 0);
  if (total > 0 && Math.abs(total - 1) > 1e-6) {
    full = full.map((d) => ({ ...d, weight: d.weight / total }));
  }

  // Compute percent bands.
  const resolved: ResolvedStage[] = [];
  let cursor = 0;
  for (let i = 0; i < full.length; i++) {
    const def = full[i];
    const evt = byId.get(def.id);
    let status: ResolvedStage["status"] = "pending";
    if (evt) status = evt.status === "complete" ? "complete" : "running";
    const bandStart = cursor * 100;
    cursor += def.weight;
    const bandEnd = cursor * 100;
    resolved.push({ def, status, detail: evt?.detail, bandStart, bandEnd });
  }

  // Gate post_processing: it must not be promoted to "running" (whether by a
  // direct stage event arriving out of order, or by the dedicated
  // postProcessingLabel SSE event) until all preceding manifest stages are
  // complete. Otherwise the headline would jump to "בדיקת איכות סופית"
  // while the real work is still on plan/retrieval/draft.
  const ppIdx = resolved.findIndex((r) => r.def.id === "post_processing");
  if (ppIdx >= 0) {
    const allPriorDone = resolved.slice(0, ppIdx).every((r) => r.status === "complete");
    if (!allPriorDone && resolved[ppIdx].status === "running") {
      resolved[ppIdx] = { ...resolved[ppIdx], status: "pending" };
    }
    if (allPriorDone && resolved[ppIdx].status === "pending" && postProcessingLabel) {
      resolved[ppIdx] = { ...resolved[ppIdx], status: "running" };
    }
  }

  // Pick the EARLIEST running stage as the headline wavefront. If none is
  // running, surface the next pending stage after the last complete so the
  // headline always reads forward.
  let runningIdx = resolved.findIndex((r) => r.status === "running");
  let lastCompleteIdx = -1;
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i].status === "complete") lastCompleteIdx = i;
  }
  if (runningIdx === -1 && lastCompleteIdx >= 0 && lastCompleteIdx < resolved.length - 1) {
    const nextPending = resolved.findIndex(
      (r, i) => i > lastCompleteIdx && r.status === "pending",
    );
    if (nextPending !== -1) runningIdx = nextPending;
  }
  return { resolved, runningIdx, lastCompleteIdx };
}

function computeTargetPercent(resolved: ResolvedStage[]): number {
  let pct = 0;
  for (const r of resolved) {
    const w = (r.bandEnd - r.bandStart);
    if (r.status === "complete") pct += w;
    else if (r.status === "running") pct += w * 0.5;
  }
  return pct;
}

/**
 * Live pipeline progress for SSE-streamed legal-qa runs.
 *
 * Weighted progress: each stage in the per-mode manifest has a `weight`
 * proportional to its real wall-time share. Running stage contributes 50%
 * of its weight; completed stages contribute 100%. No artificial floors —
 * the bar reflects what the backend has actually done.
 *
 * `displayedPercent` eases toward `targetPercent` and gently creeps inside
 * the running stage's band when no new event arrives, so the bar never
 * looks frozen mid-stage.
 */
export function StageProgressList({
  stages,
  postProcessingLabel,
  draftText,
  mode = "research_deep",
  isComplete = false,
}: Props) {
  const manifest = MANIFEST_BY_MODE[mode];
  const { resolved, runningIdx, lastCompleteIdx } = resolveStages(manifest, stages, postProcessingLabel);

  // Pre-start: render one synthetic "starting" row before the first event arrives.
  const hasAnyEvent = stages.length > 0 || !!postProcessingLabel;
  const showStarter = !hasAnyEvent && !isComplete;

  const rawTarget = isComplete ? 100 : computeTargetPercent(resolved);
  const targetPercent = isComplete
    ? 100
    : clamp(showStarter ? 2 : rawTarget, 1, 99);

  // ----- Smooth animation + idle creep -----
  const [displayedPercent, setDisplayedPercent] = useState(targetPercent);
  const targetRef = useRef(targetPercent);
  const lastEventAtRef = useRef(Date.now());
  const rafRef = useRef<number | null>(null);

  // Bump lastEventAt when stages array or post-processing label changes.
  useEffect(() => {
    lastEventAtRef.current = Date.now();
  }, [stages.length, postProcessingLabel, isComplete]);

  useEffect(() => {
    targetRef.current = targetPercent;
  }, [targetPercent]);

  // Animation loop: ease displayed toward target; allow idle creep up to the
  // midpoint of the currently-running stage's band.
  useEffect(() => {
    if (isComplete) {
      setDisplayedPercent(100);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setDisplayedPercent((cur) => {
        let target = targetRef.current;
        // Idle creep: if the running stage hasn't reported in >3s, allow the
        // bar to drift toward (but not past) the midpoint of its band.
        if (runningIdx >= 0) {
          const r = resolved[runningIdx];
          const midpoint = r.bandStart + (r.bandEnd - r.bandStart) * 0.85;
          const idleMs = Date.now() - lastEventAtRef.current;
          if (idleMs > 3000 && cur < midpoint) {
            // Push target up to midpoint slowly while idle.
            target = Math.max(target, Math.min(midpoint, cur + 0.4));
          }
        }
        const diff = target - cur;
        if (Math.abs(diff) < 0.05) return cur;
        // Ease: max 2% per frame, slower as we approach.
        const step = clamp(diff * 0.08, -2, 2);
        return clamp(cur + step, 0, 99);
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isComplete, runningIdx, resolved]);

  const percent = Math.round(displayedPercent);

  // Current-state caption.
  let headlineLabel = HEADER_BY_MODE[mode];
  let headlineSubtitle = "מתחיל…";
  if (isComplete) {
    headlineLabel = "הושלם";
    headlineSubtitle = "התשובה מוכנה";
  } else if (runningIdx >= 0) {
    const r = resolved[runningIdx];
    headlineLabel = r.def.label;
    headlineSubtitle = r.def.subtitle || "מעבד…";
  } else if (lastCompleteIdx >= 0 && lastCompleteIdx < resolved.length - 1) {
    // Between stages — show the previous stage with a finishing hint.
    const r = resolved[lastCompleteIdx];
    headlineLabel = r.def.label;
    headlineSubtitle = `${r.def.subtitle || "מעבד"} — מסיים…`;
  } else if (showStarter) {
    headlineLabel = "מתחיל";
    headlineSubtitle = "מתחבר למנוע המחקר";
  }

  // Visible row list: always show all manifest rows so the user sees the full pipeline.
  const visibleRows = showStarter
    ? [{ def: { id: "__starting__", label: "מתחיל…", weight: 0, subtitle: "" } as StageDef,
        status: "running" as const, detail: undefined, bandStart: 0, bandEnd: 0 }]
    : resolved;

  return (
    <Card className="mt-4 border-border" dir="rtl">
      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* Current state header */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            {isComplete ? (
              <CheckCircle2 className="w-6 h-6 text-secondary" />
            ) : (
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-semibold text-foreground truncate">
                {headlineLabel}
              </div>
              <div className="text-xs font-mono tabular-nums text-muted-foreground" aria-live="polite">
                {percent}%
              </div>
            </div>
            {headlineSubtitle && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {headlineSubtitle}
              </div>
            )}
          </div>
        </div>

        <Progress value={percent} className="h-2" aria-label={`התקדמות ${percent}%`} />

        <ol className="space-y-1.5">
          {visibleRows.map((r) => {
            const isDone = r.status === "complete";
            const isRunning = r.status === "running";
            const isPending = r.status === "pending";
            const detail =
              r.def.id === "post_processing" && postProcessingLabel && !r.detail
                ? postProcessingLabel
                : r.detail;
            return (
              <li
                key={r.def.id}
                className="flex items-center gap-2.5 text-sm animate-in fade-in slide-in-from-bottom-1 duration-200"
              >
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-secondary" aria-label="הושלם" />
                  ) : isRunning ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" aria-label="בעיבוד" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/30" aria-label="ממתין" />
                  )}
                </span>
                <span
                  className={
                    isDone
                      ? "text-muted-foreground"
                      : isRunning
                        ? "text-foreground font-medium"
                        : "text-muted-foreground/70"
                  }
                >
                  {r.def.label}
                </span>
                {detail && (
                  <span className="text-xs text-muted-foreground truncate">— {detail}</span>
                )}
              </li>
            );
          })}
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
