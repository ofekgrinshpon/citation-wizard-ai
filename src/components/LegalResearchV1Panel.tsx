import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Paperclip, Send, X, FileText } from "lucide-react";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPT_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const ACCEPT_EXT = /\.(pdf|docx)$/i;

type StagedFile = { id: string; file: File };

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}


// ─── Loading stages (Hebrew, ordered) ──────────────────────────────────────
const STAGES = [
  "מנתח את השאלה",
  "מתכנן חיפושים משפטיים",
  "מחפש מקורות",
  "מאמת את המקורות",
  "כותב תשובה",
  "מסדר הערות שוליים",
];

const STAGE_BUDGET_MS = 25_000;
const POLL_INTERVAL_MS = 2_000;
const SOFT_NOTICE_1_MS = 180_000; // 3 min
const SOFT_NOTICE_2_MS = 300_000; // 5 min
const RESUME_STORAGE_KEY = "lrv1:active_job";

type Footnote = { number: number; title: string; url?: string | null };
type UsedSource = {
  number: number;
  title: string;
  url?: string | null;
  source_type?: string | null;
};

type ResearchResponse = {
  answer: string;
  footnotes: Footnote[];
  used_sources?: UsedSource[];
  debug?: Record<string, unknown>;
};

function fmtElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function LegalResearchV1Panel() {
  const { currentProject } = useProjects();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResponse | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, []);

  const stopAll = (finalPct?: number) => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (typeof finalPct === "number") setProgress(finalPct);
  };

  const clearResume = () => {
    try { sessionStorage.removeItem(RESUME_STORAGE_KEY); } catch { /* ignore */ }
  };

  const handleCancel = () => {
    stopAll(progress);
    setLoading(false);
    setJobId(null);
    clearResume();
    setError("הבקשה בוטלה. הפעלת חיפוש חדשה תפתח עבודה חדשה.");
  };

  const startProgress = (startedAt?: number) => {
    startRef.current = startedAt ?? Date.now();
    const initialEl = Date.now() - startRef.current;
    setProgress(Math.min(95, 5 + (initialEl / (STAGES.length * STAGE_BUDGET_MS)) * 85));
    setStageIdx(Math.min(STAGES.length - 1, Math.floor(initialEl / STAGE_BUDGET_MS)));
    setElapsed(initialEl);
    if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => {
      const el = Date.now() - startRef.current;
      setElapsed(el);
      setStageIdx(Math.min(STAGES.length - 1, Math.floor(el / STAGE_BUDGET_MS)));
      const pct = 5 + (el / (STAGES.length * STAGE_BUDGET_MS)) * 85;
      setProgress(Math.min(95, pct));
    }, 1000);
  };

  const pollJob = (jid: string) => {
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const { data, error: qErr } = await supabase
          .from("legal_research_jobs")
          .select("status, result, error")
          .eq("id", jid)
          .maybeSingle();
        if (qErr) {
          console.warn("[lrv1 poll]", qErr.message);
          return;
        }
        if (!data) return;
        const status = (data as { status: string }).status;
        if (status === "done") {
          stopAll(100);
          setStageIdx(STAGES.length - 1);
          setResult((data as unknown as { result: ResearchResponse }).result);
          setLoading(false);
          setJobId(null);
          clearResume();
        } else if (status === "error") {
          stopAll(progress);
          setLoading(false);
          setJobId(null);
          clearResume();
          const rawErr = (data as { error?: string }).error || "";
          if (rawErr.includes("analyzer_escalation_unavailable")) {
            setError("מודל הניתוח המשפטי לא היה זמין רגעית. נסו שוב בעוד דקה.");
          } else {
            setError(rawErr || "אירעה שגיאה בעיבוד הבקשה.");
          }
        }
      } catch (e) {
        console.warn("[lrv1 poll threw]", e);
      }
    }, POLL_INTERVAL_MS);
  };

  // Resume-on-mount: if a job was active in this tab, keep polling it.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(RESUME_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { jobId: string; startedAt: number };
      if (!parsed?.jobId) return;
      setJobId(parsed.jobId);
      setLoading(true);
      setError(null);
      setResult(null);
      startProgress(parsed.startedAt);
      pollJob(parsed.jobId);
    } catch {
      /* ignore corrupt resume state */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const handleSubmit = async () => {
    const q = question.trim();
    if (q.length < 5) {
      setError("השאלה קצרה מדי. נסו לפרט יותר.");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    startProgress();

    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<{
        job_id: string;
        run_id: string;
        status: string;
      }>("legal-research-v1", {
        body: {
          question: q,
          project_id: currentProject?.id ?? null,
        },
      });

      if (invokeErr || !data?.job_id) {
        stopAll(progress);
        setLoading(false);
        setError(invokeErr?.message || "לא הצלחנו לפתוח את הבקשה.");
        return;
      }
      setJobId(data.job_id);
      try {
        sessionStorage.setItem(
          RESUME_STORAGE_KEY,
          JSON.stringify({ jobId: data.job_id, startedAt: startRef.current }),
        );
      } catch { /* ignore quota */ }
      pollJob(data.job_id);
    } catch (e) {
      stopAll(progress);
      setLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "שגיאה לא ידועה.");
    }
  };

  const debug = (result?.debug ?? {}) as Record<string, any>;
  const dbgOpenDefault = import.meta.env.DEV;

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── Input ── */}
      <div className="space-y-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={loading}
          rows={3}
          dir="rtl"
          placeholder="לדוגמה: מתי בית המשפט יפחית פיצוי מוסכם לפי סעיף 15 לחוק החוזים (תרופות)?"
          className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={loading || question.trim().length < 5}
            className="gap-1.5"
          >
            <Send className="w-4 h-4" />
            שלח לחקירה משפטית
          </Button>
        </div>
      </div>

      {/* ── Loading progress ── */}
      {loading && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {STAGES[stageIdx]}
            </span>
            <span>{fmtElapsed(elapsed)}</span>
          </div>
          <Progress value={progress} className="h-2" />
          {elapsed < SOFT_NOTICE_1_MS && (
            <p className="text-xs text-muted-foreground">
              זה עשוי לקחת 2–3 דקות
            </p>
          )}
          {elapsed >= SOFT_NOTICE_1_MS && elapsed < SOFT_NOTICE_2_MS && (
            <p className="text-xs text-muted-foreground">
              עדיין עובד… זה לוקח יותר מהרגיל
            </p>
          )}
          {elapsed >= SOFT_NOTICE_2_MS && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                עדיין עובד ברקע, אפשר להמתין או לבטל
              </p>
            </div>
          )}
          {jobId && (
            <div className="flex justify-end pt-1">
              <Button
                onClick={handleCancel}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
              >
                בטל
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Result ── */}
      {result && !loading && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-bold text-foreground mb-2">תשובה</h3>
            <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {result.answer}
            </div>
          </div>

          {result.footnotes?.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-bold text-foreground mb-2">
                הערות שוליים
              </h3>
              <ol className="space-y-1.5 text-sm text-foreground">
                {result.footnotes.map((fn) => (
                  <li key={fn.number} className="leading-relaxed">
                    <span className="font-medium">{fn.number}.</span>{" "}
                    <span>{fn.title}</span>
                    {fn.url ? (
                      <>
                        {" — "}
                        <a
                          href={fn.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline break-all"
                        >
                          {fn.url}
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* ── Debug ── */}
          <Collapsible defaultOpen={dbgOpenDefault}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className="w-3.5 h-3.5" />
              דיבאג / Debug trace
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-3">
              <DebugBlock title="run_id / qa_log_id" data={debug.run_id} />
              <DebugBlock title="phase" data={debug.phase} />
              <DebugBlock
                title="timings (ms)"
                data={{
                  total: debug.total_ms ?? null,
                  stage_runs: debug.stage_runs ?? null,
                  analyzer: debug.planning?.analyzer?.ms ?? null,
                  planner: debug.planning?.planner?.ms ?? null,
                  retrieval: debug.retrieval?.ms ?? null,
                  local: debug.retrieval?.local?.ms ?? null,
                  perplexity: debug.retrieval?.perplexity?.ms ?? null,
                  verifier: debug.verifier?.ms ?? null,
                  drafter: debug.drafter?.ms ?? null,
                }}
              />
              <DebugBlock
                title="source split (local vs Perplexity)"
                data={{
                  local_candidates: debug.retrieval?.local?.candidates ?? null,
                  perplexity_candidates:
                    debug.retrieval?.perplexity?.candidates ?? null,
                  pool: debug.retrieval?.pool ?? null,
                }}
              />
              <DebugBlock title="claims" data={debug.claims} />
              <DebugBlock title="queries" data={debug.queries} />
              <DebugBlock
                title="verifier summary"
                data={{
                  counts: debug.verifier?.counts ?? null,
                  candidates_verified:
                    debug.verifier?.candidates_verified ?? null,
                  candidates_usable: debug.verifier?.candidates_usable ?? null,
                  candidates_dropped:
                    debug.verifier?.candidates_dropped ?? null,
                }}
              />
              <DebugBlock title="used_sources" data={result.used_sources} />
              <DebugBlock title="footnotes" data={result.footnotes} />
              <DebugBlock
                title="drafter"
                data={{
                  marker_validation: debug.drafter?.marker_validation ?? null,
                  sources_passed: debug.drafter?.sources_passed ?? null,
                  sources_used: debug.drafter?.sources_used ?? null,
                  omitted_candidate_ids:
                    debug.drafter?.omitted_candidate_ids ?? null,
                }}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
}

function DebugBlock({ title, data }: { title: string; data: unknown }) {
  if (data === undefined || data === null) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
        {title}
      </div>
      <pre
        dir="ltr"
        className="text-[11px] bg-muted/40 border border-border rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all"
      >
        {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default LegalResearchV1Panel;
