import { CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

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

/**
 * Live pipeline progress for SSE-streamed legal-qa runs.
 * Each backend `stage` event appends/upgrades a row here.
 * `draft_delta` chunks are concatenated into a streaming preview with a
 * blinking caret until the `final` event arrives.
 */
export function StageProgressList({ stages, postProcessingLabel, draftText, mode = "research_deep" }: Props) {
  // De-dup by stage name, keeping the latest status (so "complete" overrides "running").
  const dedup = new Map<string, StageEvent>();
  for (const s of stages) dedup.set(s.stage, s);
  const visible = Array.from(dedup.values()).map((s) =>
    mode === "academic_chapter" && ACADEMIC_LABEL_OVERRIDES[s.stage]
      ? { ...s, label: ACADEMIC_LABEL_OVERRIDES[s.stage] }
      : s,
  );

  return (
    <Card className="mt-4 border-border" dir="rtl">
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="text-sm font-semibold text-foreground">{HEADER_BY_MODE[mode]}</div>

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
