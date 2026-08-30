import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, BookOpen, GraduationCap, BookMarked, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { he } from "date-fns/locale";

interface QALogRecord {
  id: string;
  question: string;
  answer: string | null;
  footnotes: any;
  task_mode: string | null;
  metadata: any;
  created_at: string;
}

interface QAResult {
  answer: string;
  footnotes: { number: number; citation: string; source_type: string; url?: string; source?: "local" | "perplexity" | "document" }[];
  source_urls: string[];
  case_summary?: boolean;
  verified_source?: "user" | "local" | "external" | "none";
  case_metadata?: Record<string, any> | null;
}

interface Props {
  projectId: string | null;
  onLoadResult?: (question: string, result: QAResult, taskMode: string) => void;
  refreshKey?: number;
}

const MODE_LABELS: Record<string, { label: string; icon: typeof Search }> = {
  research: { label: "מחקר", icon: Search },
  // legal-research-v1 telemetry writes this distinct task_mode but the UI mode
  // shown to the user is still "מחקר". Map it so the badge renders correctly.
  legal_research_v1: { label: "מחקר", icon: Search },
  legal_source_search: { label: "חיפוש מקורות", icon: BookMarked },
  case_summary: { label: "סיכום", icon: BookOpen },
  academic_writing: { label: "כתיבה אקדמית", icon: GraduationCap },
};

// Hebrew labels for academic sub-steps surfaced in metadata.academic_step.
const ACADEMIC_STEP_LABELS: Record<string, string> = {
  suggest_topics: "הצעת נושאים",
  validate_question: "אימות שאלת מחקר",
  propose_outline: "בניית מתווה",
  write_chapter: "כתיבת פרק",
};

interface JobRecord {
  id: string;
  question: string;
  status: string;
  progress_label_he: string | null;
  created_at: string;
}

const ACTIVE_JOB_STATUSES = ["queued", "running", "pending"];

export function QAHistorySidebar({ projectId, onLoadResult, refreshKey }: Props) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<QALogRecord[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // Running / failed research jobs come from legal_research_jobs (the source of
  // truth while a job is in flight); finished jobs are shown from qa_logs.
  useEffect(() => {
    if (!user) {
      setJobs([]);
      return;
    }
    let cancelled = false;
    const fetchJobs = async () => {
      let q = supabase
        .from("legal_research_jobs")
        .select("id, question, status, progress_label_he, created_at")
        .eq("user_id", user.id)
        .neq("status", "done")
        .order("created_at", { ascending: false })
        .limit(10);
      q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
      const { data, error } = await q;
      if (!cancelled && !error) setJobs((data as JobRecord[]) || []);
    };
    fetchJobs();
    const t = window.setInterval(fetchJobs, 10_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [user, projectId, refreshKey]);


  useEffect(() => {
    if (!user) {
      setLogs([]);
      return;
    }

    const fetchLogs = async () => {
      setLoading(true);
      let query = supabase
        .from("qa_logs")
        .select("id, question, answer, footnotes, task_mode, metadata, created_at")
        .eq("user_id", user.id)
        .not("answer", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);

      if (projectId) {
        query = query.eq("project_id", projectId);
      } else {
        query = query.is("project_id", null);
      }

      const { data, error } = await query;
      if (error) {
        console.error("Failed to fetch QA logs:", error);
      } else {
        setLogs((data as QALogRecord[]) || []);
      }
      setLoading(false);
    };

    fetchLogs();
  }, [user, projectId, refreshKey]);

  const filtered = search.trim()
    ? logs.filter((l) => l.question.toLowerCase().includes(search.toLowerCase()))
    : logs;
  const visibleJobs = search.trim()
    ? jobs.filter((j) => (j.question || "").toLowerCase().includes(search.toLowerCase()))
    : jobs;


  const handleClick = (log: QALogRecord) => {
    if (!onLoadResult || log.answer === null || log.answer === undefined) return;
    const fn = log.footnotes;
    const sourcesEnvelope =
      Array.isArray(fn) && fn.length > 0 && fn[0] && typeof fn[0] === "object" && (fn[0] as any).__sources_only === true
        ? (fn[0] as any)
        : (fn && !Array.isArray(fn) && typeof fn === "object" && (fn as any).__sources_only === true ? (fn as any) : null);
    if (sourcesEnvelope) {
      onLoadResult(log.question, sourcesEnvelope.payload ?? sourcesEnvelope, "legal_source_search");
      return;
    }
    // legal-research-v1 history rows: pass through the raw answer + footnotes
    // in a dedicated envelope so the V1 panel can hydrate without going through
    // the legacy QAResult mapper (which would clobber the Footnote shape).
    if (log.task_mode === "legal_research_v1") {
      const v1Envelope = {
        __legal_research_v1: true,
        payload: {
          answer: log.answer,
          footnotes: Array.isArray(fn) ? (fn as any[]) : [],
        },
      } as any;
      onLoadResult(log.question, v1Envelope, "legal_research_v1");
      return;
    }
    const isCaseSummaryEnvelope = fn && !Array.isArray(fn) && typeof fn === "object" && fn.__case_summary === true;
    const result: QAResult = isCaseSummaryEnvelope
      ? {
          answer: log.answer,
          footnotes: [],
          source_urls: Array.isArray(fn.source_urls) ? fn.source_urls : [],
          case_summary: true,
          verified_source: fn.verified_source ?? "none",
          case_metadata: fn.case_metadata ?? null,
        }
      : {
          answer: log.answer,
          footnotes: Array.isArray(fn)
            ? (fn as any[]).map((f, i) => ({
                number: typeof f?.number === "number" ? f.number : i + 1,
                citation:
                  typeof f?.citation === "string" && f.citation.trim() !== ""
                    ? f.citation
                    : typeof f?.title === "string"
                    ? f.title
                    : "",
                source_type: typeof f?.source_type === "string" ? f.source_type : "unknown",
                url: typeof f?.url === "string" ? f.url : undefined,
                source: f?.source,
              }))
            : [],
          source_urls: [],
        };
    onLoadResult(log.question, result, log.task_mode || "research");
  };

  return (
    <div
      className="w-72 border-r border-border bg-card flex flex-col h-full"
      style={{ direction: "rtl" }}
    >
      <div className="px-3 pt-4 pb-2 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground mb-2">היסטוריית מחקר</h3>
        <div className="relative">
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש..."
            className="pr-8 h-8 text-xs"
            dir="rtl"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {loading && (
            <p className="text-xs text-muted-foreground text-center py-4">טוען...</p>
          )}

          {/* In-flight / failed research jobs — always resumable from the server */}
          {visibleJobs.map((job) => {
            const isActive = ACTIVE_JOB_STATUSES.includes(job.status);
            const isTimedOut = job.status === "timed_out";
            return (
              <button
                key={job.id}
                onClick={() => { window.location.href = `/app?job=${job.id}`; }}
                className={`w-full text-right rounded-lg px-3 py-2.5 transition-colors group border ${
                  isTimedOut
                    ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                    : isActive
                    ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
                    : "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
                }`}
              >
                <p className="text-xs text-foreground leading-relaxed line-clamp-2">{job.question}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                    {isActive
                      ? `רץ ברקע${job.progress_label_he ? ` — ${job.progress_label_he}` : ""}`
                      : isTimedOut
                      ? "הופסק — תקלה תשתיתית"
                      : "נכשל"}
                  </Badge>
                  <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {formatDistanceToNow(new Date(job.created_at), { addSuffix: true, locale: he })}
                  </span>
                </div>
              </button>
            );
          })}

          {!loading && filtered.length === 0 && visibleJobs.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              {search ? "לא נמצאו תוצאות" : "אין היסטוריה עדיין"}
            </p>
          )}


          {filtered.map((log) => {
            const mode = MODE_LABELS[log.task_mode || "research"] || MODE_LABELS.research;
            const Icon = mode.icon;
            const timeAgo = formatDistanceToNow(new Date(log.created_at), {
              addSuffix: true,
              locale: he,
            });

            const academicStep =
              log.task_mode === "academic_writing" && log.metadata && typeof log.metadata === "object"
                ? (log.metadata as Record<string, unknown>).academic_step as string | undefined
                : undefined;
            const isAbstract =
              log.task_mode === "academic_writing" && log.metadata && typeof log.metadata === "object"
                ? (log.metadata as Record<string, unknown>).is_abstract === true
                : false;
            const academicLabel = academicStep
              ? (isAbstract ? "תקציר" : ACADEMIC_STEP_LABELS[academicStep] ?? academicStep)
              : null;

            return (
              <button
                key={log.id}
                onClick={() => handleClick(log)}
                className="w-full text-right rounded-lg px-3 py-2.5 hover:bg-muted/60 transition-colors group"
              >
                <div className="flex items-start gap-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground leading-relaxed line-clamp-2 group-hover:text-primary transition-colors">
                      {log.question}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                        {mode.label}
                      </Badge>
                      {academicLabel && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/40 text-primary">
                          {academicLabel}
                        </Badge>
                      )}
                      <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
