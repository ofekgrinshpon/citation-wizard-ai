import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RESEARCH_FUNCTIONS } from "@/config/researchPipeline";
import { ReLexLogo } from "@/components/ReLexLogo";
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
const RESUME_STORAGE_KEY_LEGACY = "legal-source-search:active_job";
const TURNS_STORAGE_KEY_LEGACY_GLOBAL = "legal-source-search:turns";
const turnsKeyFor = (projectId: string) => `legal-source-search:turns:${projectId}`;
const MAX_PERSISTED_TURNS = 5;
const MAX_PERSISTED_BYTES = 1_000_000; // ~1 MB sessionStorage budget
const SCROLL_BOTTOM_THRESHOLD_PX = 80;

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
  tier?: "recommended" | "additional";
  url_validation_state?: "ok" | "unreachable" | "unverified";
  url_status?: string;
  url_unreachable?: boolean;
}

interface SourcesOnlyResponse {
  mode: "sources_only";
  question: string;
  run_id: string;
  sources: SourceResult[];
  groups: Record<GroupKey, SourceResult[]>;
  additional_sources?: SourceResult[];
  additional_groups?: Partial<Record<GroupKey, SourceResult[]>>;
  summary: {
    total_candidates: number;
    verified: number;
    usable: number;
    dropped: number;
    local_count: number;
    perplexity_count: number;
    additional_count?: number;
    url_checks_failed?: number;
    url_checks_unverified?: number;
  };
  debug?: Record<string, unknown>;
}

function fmtElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}


type TurnStatus = "running" | "done" | "error";

interface Turn {
  id: string;
  question: string;
  status: TurnStatus;
  result?: SourcesOnlyResponse;
  error?: string;
  startedAt: number;
}

function genTurnId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* ignore */ }
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function pruneTurnsForStorage(turns: Turn[]): Turn[] {
  // Keep at most MAX_PERSISTED_TURNS, strip `debug` from non-tail results to save space.
  const trimmed = turns.slice(-MAX_PERSISTED_TURNS);
  return trimmed.map((t, idx) => {
    const isTail = idx === trimmed.length - 1;
    if (isTail || !t.result) return t;
    const { debug: _debug, ...rest } = t.result;
    return { ...t, result: rest as SourcesOnlyResponse };
  });
}

function safeWriteTurns(storageKey: string, turns: Turn[]) {
  try {
    let toWrite = pruneTurnsForStorage(turns);
    let serialized = JSON.stringify(toWrite);
    while (serialized.length > MAX_PERSISTED_BYTES && toWrite.length > 1) {
      toWrite = toWrite.slice(1);
      serialized = JSON.stringify(toWrite);
    }
    sessionStorage.setItem(storageKey, serialized);
  } catch { /* ignore quota */ }
}

interface LegalSourceSearchPanelProps {
  externalResult?: { question: string; payload: SourcesOnlyResponse } | null;
  onConsumeExternalResult?: () => void;
}

export function LegalSourceSearchPanel({ externalResult, onConsumeExternalResult }: LegalSourceSearchPanelProps = {}) {
  const { currentProject } = useProjects();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const progressTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const hydratedForProjectRef = useRef<string | null>(null);
  const appliedExternalRef = useRef<unknown>(null);

  const activeTurn = turns[turns.length - 1];
  const loading = activeTurn?.status === "running";
  const jobId = loading ? activeTurn?.id ?? null : null;

  const projectId = currentProject?.id ?? null;

  // Persist turns on every change, but only after hydration for this project completed,
  // and only when a real project id exists. Never persist under a shared/no-project bucket.
  useEffect(() => {
    if (!projectId) return;
    if (hydratedForProjectRef.current !== projectId) return;
    safeWriteTurns(turnsKeyFor(projectId), turns);
  }, [turns, projectId]);

  // Auto-scroll to bottom when near bottom.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distance <= SCROLL_BOTTOM_THRESHOLD_PX) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [turns, currentStage, completedStages, elapsed]);

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
          setTurns((prev) =>
            prev.map((t) => (t.id === jid ? { ...t, status: "done", result: row.result } : t)),
          );
        } else if (row.status === "error") {
          stopAll();
          setTurns((prev) =>
            prev.map((t) =>
              t.id === jid ? { ...t, status: "error", error: row.error || "אירעה שגיאה בעיבוד הבקשה." } : t,
            ),
          );
        }
      } catch (e) {
        console.warn("[lss poll threw]", e);
      }
    }, POLL_INTERVAL_MS);
  };

  // One-time cleanup of legacy unscoped keys from before per-project scoping.
  useEffect(() => {
    try { sessionStorage.removeItem(TURNS_STORAGE_KEY_LEGACY_GLOBAL); } catch { /* ignore */ }
    try { sessionStorage.removeItem(RESUME_STORAGE_KEY_LEGACY); } catch { /* ignore */ }
  }, []);

  // Project-scoped hydration. Runs whenever the active project changes:
  // 1. Cancel any in-flight polling for the previous project.
  // 2. Reset in-memory turn/stage state.
  // 3. Hydrate from the new project's sessionStorage key (if any), then enable persistence.
  // If no project id is available yet, stay empty and do not hydrate or persist.
  useEffect(() => {
    stopAll();
    setCurrentStage(null);
    setCompletedStages([]);
    setElapsed(0);
    setTurns([]);
    setQuestion("");
    hydratedForProjectRef.current = null;

    if (!projectId) return;

    try {
      const raw = sessionStorage.getItem(turnsKeyFor(projectId));
      if (raw) {
        const parsed = JSON.parse(raw) as Turn[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTurns(parsed);
          const tail = parsed[parsed.length - 1];
          if (tail.status === "running") {
            startProgress(tail.startedAt);
            pollJob(tail.id);
          }
        }
      }
    } catch { /* ignore */ }

    hydratedForProjectRef.current = projectId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Hydrate from history sidebar click — reset panel to a single completed turn.
  // Guarded by appliedExternalRef so repeated parent renders with a new object
  // identity but the same payload do not re-clobber project-switch resets.
  useEffect(() => {
    if (!externalResult?.payload) return;
    if (appliedExternalRef.current === externalResult) return;
    appliedExternalRef.current = externalResult;
    stopAll();
    setCurrentStage(null);
    setCompletedStages([]);
    setTurns([
      {
        id: genTurnId(),
        question: externalResult.question || "",
        status: "done",
        result: externalResult.payload,
        startedAt: Date.now(),
      },
    ]);
    setQuestion("");
    onConsumeExternalResult?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalResult]);

  const handleCancel = () => {
    if (!activeTurn || activeTurn.status !== "running") return;
    const tailId = activeTurn.id;
    stopAll();
    setTurns((prev) =>
      prev.map((t) =>
        t.id === tailId
          ? { ...t, status: "error", error: "הבקשה בוטלה. הפעלת חיפוש חדשה תפתח עבודה חדשה." }
          : t,
      ),
    );
  };

  const handleSubmit = async () => {
    const q = question.trim();
    if (q.length < 5) {
      // Surface as an error on a transient turn-less notice: append an error turn so user sees feedback.
      setTurns((prev) => [
        ...prev,
        {
          id: genTurnId(),
          question: q,
          status: "error",
          error: "השאלה קצרה מדי. נסו לפרט יותר.",
          startedAt: Date.now(),
        },
      ]);
      return;
    }
    if (loading) return;

    const placeholderId = genTurnId();
    const startedAt = Date.now();
    setTurns((prev) => [
      ...prev,
      { id: placeholderId, question: q, status: "running", startedAt },
    ]);
    setQuestion("");
    startProgress(startedAt);

    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<{
        job_id: string;
        run_id: string;
        status: string;
      }>(RESEARCH_FUNCTIONS.v2, {
        body: {
          question: q,
          project_id: currentProject?.id ?? null,
          mode: "source_search",
        },
      });
      if (invokeErr || !data?.job_id) {
        stopAll();
        setTurns((prev) =>
          prev.map((t) =>
            t.id === placeholderId
              ? { ...t, status: "error", error: invokeErr?.message || "לא הצלחנו לפתוח את הבקשה." }
              : t,
          ),
        );
        return;
      }
      const realId = data.job_id;
      setTurns((prev) =>
        prev.map((t) => (t.id === placeholderId ? { ...t, id: realId } : t)),
      );
      pollJob(realId);
    } catch (e) {
      stopAll();
      const msg = e instanceof Error ? e.message : String(e);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === placeholderId ? { ...t, status: "error", error: msg || "שגיאה לא ידועה." } : t,
        ),
      );
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
    setTurns([]);
    setCurrentStage(null);
    setCompletedStages([]);
    if (projectId) {
      try { sessionStorage.removeItem(turnsKeyFor(projectId)); } catch { /* ignore */ }
    }
  };

  const sendDisabled = loading || question.trim().length < 5;
  const hasContentToClear = question.trim().length > 0 || turns.length > 0;

  return (
    <div className="flex flex-col h-full min-h-0" dir="rtl">
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto space-y-6 pb-4">
        {turns.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <div className="mb-4"><ReLexLogo size={56} /></div>
          </div>
        )}
        {turns.map((turn, idx) => {
          const isTail = idx === turns.length - 1;
          const debug = (turn.result?.debug ?? {}) as Record<string, unknown>;
          return (
            <div key={turn.id} className="space-y-3">
              {turn.question ? <UserQueryBubble question={turn.question} /> : null}

              {turn.status === "running" && isTail && (
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

              {turn.status === "error" && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  {turn.error || "אירעה שגיאה."}
                </div>
              )}

              {turn.status === "done" && turn.result && (
                <SourceResultsView result={turn.result} debug={debug} />
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
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

function UserQueryBubble({ question }: { question: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl bg-primary/10 border border-primary/20 px-3.5 py-2 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
        {question}
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
  const additional = result.additional_sources ?? [];
  const additionalGroups = (result.additional_groups ?? {}) as Partial<Record<GroupKey, SourceResult[]>>;
  const additionalCount = s.additional_count ?? additional.length;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <BookMarked className="w-4 h-4 text-primary" />
          <span>נמצאו {s.usable} מקורות מומלצים</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          מתוכם {directCount} מקורות ישירים · {s.local_count} מהמאגר המקומי, {s.perplexity_count} חיצוניים
          {additionalCount > 0 ? ` · +${additionalCount} מקורות נוספים לבדיקה` : ""}
          {s.url_checks_failed && s.url_checks_failed > 0 ? ` · ${s.url_checks_failed} קישורים לא זמינים` : ""}
          {s.url_checks_unverified && s.url_checks_unverified > 0 ? ` · ${s.url_checks_unverified} קישורים שלא אומתו` : ""}
        </p>
      </div>

      {/* Main recommended list */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-foreground">מקורות מומלצים</h2>
        {GROUP_ORDER.map((g) => {
          const items = result.groups?.[g] ?? [];
          if (items.length === 0) return null;
          return (
            <section key={`main-${g}`} className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                {GROUP_LABEL[g]} <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
              </h3>
              <div className="space-y-2">
                {items.map((src) => <SourceCard key={`main-${g}-${src.rank}`} src={src} variant="recommended" />)}
              </div>
            </section>
          );
        })}

        {result.sources.length === 0 && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground text-center">
            לא נמצאו מקורות מאומתים לשאלה זו. נסו לנסח אותה אחרת או להוסיף הקשר.
          </div>
        )}
      </section>

      {/* Additional sources for inspection */}
      {additional.length > 0 && (
        <section className="space-y-2 pt-2 border-t border-border/60">
          <div>
            <h2 className="text-sm font-bold text-foreground">מקורות נוספים לבדיקה</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              מקורות אלה נמצאו כרלוונטיים אפשריים, אך לא דורגו כמקורות מומלצים על ידי מנגנון האימות.
            </p>
          </div>
          {GROUP_ORDER.map((g) => {
            const items = additionalGroups[g] ?? [];
            if (items.length === 0) return null;
            return (
              <section key={`add-${g}`} className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground">
                  {GROUP_LABEL[g]} <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
                </h3>
                <div className="space-y-2">
                  {items.map((src) => <SourceCard key={`add-${g}-${src.rank}`} src={src} variant="additional" />)}
                </div>
              </section>
            );
          })}
        </section>
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

function SourceCard({
  src,
  variant = "recommended",
}: {
  src: SourceResult;
  variant?: "recommended" | "additional";
}) {
  const isAdditional = variant === "additional";
  const cardCls = isAdditional
    ? "rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2"
    : "rounded-lg border border-border bg-card p-3 space-y-2";
  const vstate = src.url_validation_state;
  const isUnreachable = vstate === "unreachable";
  const isUnverified = vstate === "unverified";
  const linkCls = `shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline${
    isUnreachable ? " line-through opacity-70" : ""
  }`;
  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`text-sm font-semibold leading-snug ${isAdditional ? "text-foreground/90" : "text-foreground"}`}>
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
            className={linkCls}
            title={isUnreachable ? src.url : undefined}
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
        {isAdditional ? (
          <Chip variant="muted">לבדיקה</Chip>
        ) : (
          <>
            <Chip variant={src.support === "direct" ? "primary" : "muted"}>
              {src.support === "direct" ? "ישיר" : "חלקי"}
            </Chip>
            {!src.role_match && <Chip variant="muted">תפקיד שונה</Chip>}
          </>
        )}
        {isUnreachable && (
          <span
            title='ייתכן שזהו מקור שגוי שהוחזר ע"י מנוע החיפוש. מומלץ לאמת ידנית לפני שימוש.'
            className="inline-flex items-center px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/30"
          >
            קישור לא זמין
          </span>
        )}
        {isUnverified && (
          <span
            title="לא הצלחנו לאמת את הקישור בזמן סביר. ייתכן שהאתר איטי או חוסם בדיקות אוטומטיות."
            className="inline-flex items-center px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border"
          >
            הקישור לא אומת
          </span>
        )}
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
