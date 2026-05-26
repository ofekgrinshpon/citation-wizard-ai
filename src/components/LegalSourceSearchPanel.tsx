import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ArrowUp,
  Loader2,
  Check,
  ExternalLink,
  Trash2,
  BookMarked,
} from "lucide-react";

const STAGES: Array<{ key: string; label: string }> = [
  { key: "analyzer", label: "מנתח את השאלה" },
  { key: "planner", label: "מתכנן חיפושים" },
  { key: "retrieval", label: "מחפש מקורות" },
  { key: "verifier", label: "מאמת רלוונטיות" },
  { key: "ranking", label: "מסדר מקורות" },
];

const POLL_INTERVAL_MS = 2_000;
const SOFT_NOTICE_1_MS = 120_000;
const SOFT_NOTICE_2_MS = 240_000;
const RESUME_STORAGE_KEY = "legal-source-search:active_job";

type Origin = "local_db" | "perplexity";
type Support = "direct" | "partial";
type GroupKey =
  | "primary_statute"
  | "binding_case_law"
  | "persuasive_case_law"
  | "scholarship"
  | "legislative_history"
  | "government_report"
  | "other";

const GROUP_ORDER: GroupKey[] = [
  "primary_statute",
  "binding_case_law",
  "persuasive_case_law",
  "scholarship",
  "legislative_history",
  "government_report",
  "other",
];

const GROUP_LABEL: Record<GroupKey, string> = {
  primary_statute: "חקיקה ראשית ותקנות",
  binding_case_law: "פסיקה מחייבת",
  persuasive_case_law: "פסיקה משכנעת",
  scholarship: "ספרות אקדמית",
  legislative_history: "הליכי חקיקה",
  government_report: "דוחות ממשלתיים",
  other: "אחר",
};

const ROLE_LABEL: Record<string, string> = {
  primary_statute: "חקיקה ראשית",
  regulation: "תקנות",
  binding_case_law: "פסיקה מחייבת",
  persuasive_case_law: "פסיקה משכנעת",
  scholarship: "ספרות אקדמית",
  government_report: "דו״ח ממשלתי",
  factual_report: "דו״ח עובדתי",
};

interface SourceResult {
  rank: number;
  title: string;
  url: string | null;
  source_type: string;
  role: string;
  origin: Origin;
  support: Support;
  role_match: boolean;
  reason: string;
  supported_claim_ids: string[];
  snippet: string | null;
  display_citation: string | null;
}

interface SourcesOnlyResponse {
  mode: "sources_only";
  question: string;
  run_id: string;
  sources: SourceResult[];
  groups: Record<GroupKey, SourceResult[]>;
  summary: {
    total_candidates: number;
    verified: number;
    usable: number;
    dropped: number;
    local_count: number;
    perplexity_count: number;
  };
  debug?: Record<string, unknown>;
}

function fmtElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

interface LegalSourceSearchPanelProps {
  externalResult?: { question: string; payload: SourcesOnlyResponse } | null;
  onConsumeExternalResult?: () => void;
}

export function LegalSourceSearchPanel({ externalResult, onConsumeExternalResult }: LegalSourceSearchPanelProps = {}) {
  const { currentProject } = useProjects();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SourcesOnlyResponse | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  // Hydrate from history click
  useEffect(() => {
    if (externalResult?.payload) {
      setResult(externalResult.payload);
      setQuestion(externalResult.question || "");
      setLoading(false);
      setError(null);
      onConsumeExternalResult?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalResult]);

  const progressTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, []);

  const stopAll = () => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const clearResume = () => {
    try { sessionStorage.removeItem(RESUME_STORAGE_KEY); } catch { /* ignore */ }
  };

  const handleCancel = () => {
    stopAll();
    setLoading(false);
    setJobId(null);
    clearResume();
    setError("הבקשה בוטלה. הפעלת חיפוש חדשה תפתח עבודה חדשה.");
  };

  const startProgress = (startedAt?: number) => {
    startRef.current = startedAt ?? Date.now();
    setElapsed(Date.now() - startRef.current);
    setCurrentStage(null);
    setCompletedStages([]);
    if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 1000);
  };

  const pollJob = (jid: string) => {
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const { data, error: qErr } = await supabase
          .from("legal_research_jobs")
          .select("status, result, error, current_stage, completed_stages")
          .eq("id", jid)
          .maybeSingle();
        if (qErr) {
          console.warn("[lss poll]", qErr.message);
          return;
        }
        if (!data) return;
        const row = data as unknown as {
          status: string;
          result?: SourcesOnlyResponse;
          error?: string;
          current_stage?: string | null;
          completed_stages?: string[] | null;
        };
        if (Array.isArray(row.completed_stages)) setCompletedStages(row.completed_stages);
        if (typeof row.current_stage === "string" || row.current_stage === null) {
          setCurrentStage(row.current_stage ?? null);
        }
        if (row.status === "done") {
          stopAll();
          setCurrentStage(null);
          setCompletedStages(STAGES.map((s) => s.key));
          setResult(row.result as SourcesOnlyResponse);
          setLoading(false);
          setJobId(null);
          clearResume();
        } else if (row.status === "error") {
          stopAll();
          setLoading(false);
          setJobId(null);
          clearResume();
          setError(row.error || "אירעה שגיאה בעיבוד הבקשה.");
        }
      } catch (e) {
        console.warn("[lss poll threw]", e);
      }
    }, POLL_INTERVAL_MS);
  };

  // Resume-on-mount
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
    } catch { /* ignore */ }
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
          mode: "sources_only",
        },
      });
      if (invokeErr || !data?.job_id) {
        stopAll();
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
      } catch { /* ignore */ }
      pollJob(data.job_id);
    } catch (e) {
      stopAll();
      setLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "שגיאה לא ידועה.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!loading && question.trim().length >= 5) handleSubmit();
    }
  };

  const handleClearAll = () => {
    if (loading) return;
    setQuestion("");
    setResult(null);
    setError(null);
  };

  const sendDisabled = loading || question.trim().length < 5;
  const debug = (result?.debug ?? {}) as Record<string, unknown>;
  const hasContentToClear = question.trim().length > 0 || !!result || !!error;

  return (
    <div className="flex flex-col h-full min-h-0" dir="rtl">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4">
        {loading && (
          <div className="space-y-3 animate-fade-in">
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium text-foreground">מחפש מקורות…</span>
                <span>{fmtElapsed(elapsed)}</span>
              </div>
              <ol className="space-y-2">
                {STAGES.map((stage) => {
                  const isDone = completedStages.includes(stage.key);
                  const isActive = !isDone && currentStage === stage.key;
                  return (
                    <li key={stage.key} className="flex items-center gap-2.5 text-sm">
                      <span className="flex w-5 h-5 items-center justify-center shrink-0">
                        {isDone ? (
                          <Check className="w-4 h-4 text-primary" />
                        ) : isActive ? (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        ) : (
                          <span className="w-3.5 h-3.5 rounded-full border border-border" />
                        )}
                      </span>
                      <span className={isDone ? "text-foreground" : isActive ? "text-foreground font-medium" : "text-muted-foreground"}>
                        {stage.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {elapsed < SOFT_NOTICE_1_MS && (
                <p className="text-xs text-muted-foreground">לרוב זה לוקח כדקה–שתיים</p>
              )}
              {elapsed >= SOFT_NOTICE_1_MS && elapsed < SOFT_NOTICE_2_MS && (
                <p className="text-xs text-muted-foreground">עדיין עובד…</p>
              )}
              {elapsed >= SOFT_NOTICE_2_MS && (
                <p className="text-xs text-muted-foreground">עדיין עובד ברקע, אפשר להמתין או לבטל</p>
              )}
              {jobId && (
                <div className="flex justify-end pt-1">
                  <Button onClick={handleCancel} variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    בטל
                  </Button>
                </div>
              )}
            </div>
            <SourceSkeleton />
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && !loading && (
          <SourceResultsView result={result} debug={debug} />
        )}
      </div>

      {/* Composer */}
      <div className="mt-auto pt-2">
        <div className="flex gap-2 items-end pt-2">
          {hasContentToClear && (
            <button
              type="button"
              onClick={handleClearAll}
              disabled={loading}
              className="p-2.5 bg-surface border border-border rounded-xl text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-all flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title="נקה הכל"
              aria-label="נקה הכל"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <div className="input-field flex flex-1 min-w-0 items-end">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={2}
              dir="rtl"
              placeholder="הזן שאלה משפטית או נושא למחקר…"
              className="w-full flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 px-3 py-2.5 text-foreground text-sm leading-relaxed resize-none"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={sendDisabled}
              className="btn-send px-3 py-2.5 m-1 rounded-lg text-primary-foreground flex-shrink-0 disabled:text-muted-foreground"
              title="חפש מקורות"
              aria-label="חפש מקורות"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceResultsView({
  result,
  debug,
}: {
  result: SourcesOnlyResponse;
  debug: Record<string, unknown>;
}) {
  const s = result.summary;
  const directCount = result.sources.filter((x) => x.support === "direct").length;
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <BookMarked className="w-4 h-4 text-primary" />
          <span>נמצאו {s.usable} מקורות רלוונטיים</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          מתוכם {directCount} מקורות ישירים · {s.local_count} מהמאגר המקומי, {s.perplexity_count} חיצוניים
        </p>
      </div>

      {GROUP_ORDER.map((g) => {
        const items = result.groups?.[g] ?? [];
        if (items.length === 0) return null;
        return (
          <section key={g} className="space-y-2">
            <h3 className="text-sm font-bold text-foreground">
              {GROUP_LABEL[g]} <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
            </h3>
            <div className="space-y-2">
              {items.map((src) => <SourceCard key={`${g}-${src.rank}`} src={src} />)}
            </div>
          </section>
        );
      })}

      {result.sources.length === 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground text-center">
          לא נמצאו מקורות מאומתים לשאלה זו. נסו לנסח אותה אחרת או להוסיף הקשר.
        </div>
      )}

      {import.meta.env.DEV && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className="w-3.5 h-3.5" />
            דיבאג / Debug trace
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-3">
            <DebugBlock title="summary" data={result.summary} />
            <DebugBlock title="run_id" data={result.run_id} />
            <DebugBlock title="planning" data={(debug as any).planning} />
            <DebugBlock title="retrieval" data={(debug as any).retrieval} />
            <DebugBlock title="verifier" data={(debug as any).verifier} />
            <DebugBlock title="dropped_sources" data={(debug as any).dropped_sources} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function SourceCard({ src }: { src: SourceResult }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground leading-snug">
            <span className="text-muted-foreground text-xs ml-2">{src.rank}.</span>
            {src.title}
          </div>
          {src.display_citation && (
            <div className="text-xs text-muted-foreground mt-0.5">{src.display_citation}</div>
          )}
        </div>
        {src.url && (
          <a
            href={src.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            פתח מקור
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <Chip>{ROLE_LABEL[src.role] ?? src.role}</Chip>
        <Chip variant={src.origin === "local_db" ? "primary" : "muted"}>
          {src.origin === "local_db" ? "מאגר מקומי" : "Perplexity"}
        </Chip>
        <Chip variant={src.support === "direct" ? "primary" : "muted"}>
          {src.support === "direct" ? "ישיר" : "חלקי"}
        </Chip>
        {!src.role_match && <Chip variant="muted">תפקיד שונה</Chip>}
      </div>

      {src.reason && (
        <p className="text-xs text-muted-foreground leading-relaxed">{src.reason}</p>
      )}
      {src.snippet && (
        <details className="text-xs text-foreground">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">קטע מתוך המקור</summary>
          <p className="mt-1.5 whitespace-pre-wrap leading-relaxed bg-muted/30 border border-border rounded p-2">
            {src.snippet}
          </p>
        </details>
      )}
    </div>
  );
}

function Chip({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "primary" | "muted";
}) {
  const cls =
    variant === "primary"
      ? "bg-primary/10 text-primary border-primary/30"
      : variant === "muted"
      ? "bg-muted text-muted-foreground border-border"
      : "bg-card text-foreground border-border";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  );
}

function DebugBlock({ title, data }: { title: string; data: unknown }) {
  if (data === undefined || data === null) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{title}</div>
      <pre dir="ltr" className="text-[11px] bg-muted/40 border border-border rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
        {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function SourceSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
          <div className="flex gap-1.5">
            <div className="h-4 w-16 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-20 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-12 rounded-full bg-muted animate-pulse" />
          </div>
          <div className="h-3 w-full rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export default LegalSourceSearchPanel;
