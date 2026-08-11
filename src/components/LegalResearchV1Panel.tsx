import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCredits } from "@/hooks/useCredits";
import { InsufficientCreditsDialog } from "@/components/InsufficientCreditsDialog";
import { CREDIT_COSTS } from "@/lib/creditCosts";
import { ReLexLogo } from "@/components/ReLexLogo";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Paperclip, X, FileText, Trash2, ArrowUp, Loader2, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { renderAnswerMarkdown } from "@/lib/legalQa/renderAnswerMarkdown";
import { copyPlainText } from "@/lib/clipboard";
import { normalizeHebrewNumberRanges } from "@/lib/hebrewNumberRange";

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

// Stage keys must match what the edge function writes into
// legal_research_jobs.current_stage / completed_stages.
const STAGES: Array<{ key: string; label: string }> = [
  { key: "analyzer",  label: "מנתח את השאלה" },
  { key: "planner",   label: "מתכנן חיפושים משפטיים" },
  { key: "retrieval", label: "מחפש מקורות" },
  { key: "verifier",  label: "מאמת את המקורות" },
  { key: "drafter",   label: "כותב תשובה" },
  { key: "finalize",  label: "מסדר הערות שוליים" },
];

const POLL_INTERVAL_MS = 2_000;
const SOFT_NOTICE_1_MS = 180_000; // 3 min
const SOFT_NOTICE_2_MS = 300_000; // 5 min
const RESUME_STORAGE_KEY = "lrv1:active_job";

type FootnoteSource = { title: string; url?: string | null; source_type?: string };
type Footnote = { number: number; title: string; url?: string | null; sources?: FootnoteSource[] };
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

interface LegalResearchV1PanelProps {
  externalResult?:
    | { question: string; payload: { answer: string; footnotes: Footnote[] } }
    | null;
  onConsumeExternalResult?: () => void;
}

export function LegalResearchV1Panel({
  externalResult,
  onConsumeExternalResult,
}: LegalResearchV1PanelProps = {}) {
  const { currentProject } = useProjects();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResponse | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [useAsSource, setUseAsSource] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
          console.warn("[lrv1 poll]", qErr.message);
          return;
        }
        if (!data) return;
        const row = data as {
          status: string;
          result?: ResearchResponse;
          error?: string;
          current_stage?: string | null;
          completed_stages?: string[] | null;
        };
        // Live stage progress
        if (Array.isArray(row.completed_stages)) {
          setCompletedStages(row.completed_stages);
        }
        if (typeof row.current_stage === "string" || row.current_stage === null) {
          setCurrentStage(row.current_stage ?? null);
        }
        if (row.status === "done") {
          stopAll();
          setCurrentStage(null);
          setCompletedStages(STAGES.map((s) => s.key));
          setResult(row.result as ResearchResponse);
          setLoading(false);
          setJobId(null);
          setFiles([]);
          clearResume();
        } else if (row.status === "error") {
          stopAll();
          setLoading(false);
          setJobId(null);
          clearResume();
          const rawErr = row.error || "";
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
  // Skip when a history-replay payload is being injected — the cached result
  // must win over any leftover session job state.
  useEffect(() => {
    if (externalResult) return;
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

  // History replay: hydrate cached V1 answer/footnotes from the sidebar.
  useEffect(() => {
    if (!externalResult) return;
    stopAll();
    clearResume();
    setLoading(false);
    setError(null);
    setJobId(null);
    setCurrentStage(null);
    setCompletedStages([]);
    setElapsed(0);
    setFiles([]);
    setQuestion(externalResult.question);
    setResult({
      answer: externalResult.payload?.answer ?? "",
      footnotes: Array.isArray(externalResult.payload?.footnotes)
        ? externalResult.payload.footnotes
        : [],
      used_sources: [],
      debug: {},
    });
    onConsumeExternalResult?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalResult]);


  const handleAddFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    const accepted: StagedFile[] = [];
    const rejected: string[] = [];
    for (const f of arr) {
      if (!ACCEPT_MIME.includes(f.type) && !ACCEPT_EXT.test(f.name)) {
        rejected.push(`${f.name}: סוג קובץ לא נתמך (רק PDF/DOCX)`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        rejected.push(`${f.name}: חורג מ-${fmtSize(MAX_FILE_BYTES)}`);
        continue;
      }
      accepted.push({ id: crypto.randomUUID(), file: f });
    }
    setFiles((prev) => {
      const merged = [...prev, ...accepted];
      if (merged.length > MAX_FILES) {
        rejected.push(`ניתן לצרף עד ${MAX_FILES} קבצים`);
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
    if (rejected.length) setError(rejected.join(" · "));
    else setError(null);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const uploadStagedFiles = async (uploadJobToken: string) => {
    if (files.length === 0) return [] as Array<{
      storage_path: string; file_name: string; mime_type: string; size: number;
    }>;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("יש להתחבר כדי לצרף קבצים");
    const out: Array<{ storage_path: string; file_name: string; mime_type: string; size: number }> = [];
    for (let i = 0; i < files.length; i++) {
      const sf = files[i];
      const safe = sanitizeFileName(sf.file.name);
      const path = `${user.id}/research/${uploadJobToken}/${i}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("user-documents")
        .upload(path, sf.file, {
          contentType: sf.file.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) throw new Error(`שגיאה בהעלאת ${sf.file.name}: ${upErr.message}`);
      out.push({
        storage_path: path,
        file_name: sf.file.name,
        mime_type: sf.file.type || (ACCEPT_EXT.test(sf.file.name) ? "application/pdf" : "application/octet-stream"),
        size: sf.file.size,
      });
    }
    return out;
  };

  const handleSubmit = async () => {
    const q = question.trim();
    if (q.length < 5) {
      setError("השאלה קצרה מדי. נסו לפרט יותר.");
      return;
    }
    setError(null);
    setResult(null);

    let attachmentsPayload: Array<{ storage_path: string; file_name: string; mime_type: string; size: number }> = [];
    if (files.length > 0) {
      setUploadingFiles(true);
      try {
        const token = crypto.randomUUID();
        attachmentsPayload = await uploadStagedFiles(token);
      } catch (e) {
        setUploadingFiles(false);
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      setUploadingFiles(false);
    }

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
          attachments: attachmentsPayload,
          use_as_source: useAsSource,
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
      } catch { /* ignore quota */ }
      pollJob(data.job_id);
    } catch (e) {
      stopAll();
      setLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "שגיאה לא ידועה.");
    }
  };


  const debug = (result?.debug ?? {}) as Record<string, any>;
  const dbgOpenDefault = import.meta.env.DEV;

  const hasContentToClear =
    question.trim().length > 0 || files.length > 0 || !!result || !!error;

  const handleClearAll = () => {
    if (loading || uploadingFiles) return;
    const doClear = () => {
      setQuestion("");
      setFiles([]);
      setResult(null);
      setError(null);
    };
    if (result || question.trim().length > 100) {
      toast("לנקות הכל?", {
        action: { label: "מחק", onClick: doClear },
        cancel: { label: "ביטול", onClick: () => {} },
      });
    } else {
      doClear();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!loading && !uploadingFiles && question.trim().length >= 5) {
        handleSubmit();
      }
    }
  };

  const sendDisabled = loading || uploadingFiles || question.trim().length < 5;
  const isBusy = loading || uploadingFiles;

  const handleCopyResult = async () => {
    if (!result) return;
    const parts: string[] = [];
    parts.push(result.answer.trim());
    if (result.footnotes && result.footnotes.length > 0) {
      parts.push("");
      parts.push("הערות שוליים");
      result.footnotes.forEach((fn) => {
        if (fn.sources && fn.sources.length > 1) {
          parts.push(`${fn.number}.`);
          fn.sources.forEach((s, idx) => {
            const isLast = idx === fn.sources!.length - 1;
            const sep = isLast ? "." : ";";
            const line = s.url ? `   ${s.title}${sep} ${s.url}` : `   ${s.title}${sep}`;
            parts.push(line);
          });
        } else {
          const line = fn.url ? `${fn.number}. ${fn.title} — ${fn.url}` : `${fn.number}. ${fn.title}`;
          parts.push(line);
        }
      });
    }
    await copyPlainText(parts.join("\n"));
    toast.success("התשובה והערות השוליים הועתקו ללוח");
  };

  return (
    <div className="flex flex-col h-full min-h-0" dir="rtl">
      {/* ── Top region: loading / error / result (scrollable) ── */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4">
        {!loading && !error && !result && (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <div className="mb-4"><ReLexLogo size={56} /></div>
          </div>
        )}
        {loading && (
          <div className="space-y-3 animate-fade-in">
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium text-foreground">מבצע סקירה משפטית…</span>
                <span>{fmtElapsed(elapsed)}</span>
              </div>
              <ol className="space-y-2">
                {STAGES.map((stage) => {
                  const isDone = completedStages.includes(stage.key);
                  const isActive = !isDone && currentStage === stage.key;
                  return (
                    <li
                      key={stage.key}
                      className="flex items-center gap-2.5 text-sm"
                    >
                      <span className="flex w-5 h-5 items-center justify-center shrink-0">
                        {isDone ? (
                          <Check className="w-4 h-4 text-primary" />
                        ) : isActive ? (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        ) : (
                          <span className="w-3.5 h-3.5 rounded-full border border-border" />
                        )}
                      </span>
                      <span
                        className={
                          isDone
                            ? "text-foreground"
                            : isActive
                            ? "text-foreground font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {stage.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {elapsed < SOFT_NOTICE_1_MS && (
                <p className="text-xs text-muted-foreground">זה עשוי לקחת 2–3 דקות</p>
              )}
              {elapsed >= SOFT_NOTICE_1_MS && elapsed < SOFT_NOTICE_2_MS && (
                <p className="text-xs text-muted-foreground">עדיין עובד… זה לוקח יותר מהרגיל</p>
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

            <GhostAnswer />
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && !loading && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyResult}
                className="gap-1.5 text-xs"
              >
                <Copy className="w-3.5 h-3.5" />
                העתק
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-bold text-foreground mb-2">תשובה</h3>
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {renderAnswerMarkdown(result.answer)}
              </div>
            </div>

            {result.footnotes?.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-bold text-foreground mb-2">הערות שוליים</h3>
                <ol className="space-y-1.5 text-sm text-foreground">
                  {result.footnotes.map((fn) => (
                    <li key={fn.number} className="leading-relaxed">
                      {fn.sources && fn.sources.length > 1 ? (
                        <>
                          <span className="font-medium">{fn.number}.</span>
                          <div className="pr-4 space-y-0.5">
                            {fn.sources.map((s, idx) => {
                              const isLast = idx === fn.sources!.length - 1;
                              const sep = isLast ? "." : ";";
                              return (
                                <div key={idx}>
                                  <span>{normalizeHebrewNumberRanges(s.title)}{sep}</span>
                                  {s.url ? (
                                    <>
                                      {" "}
                                      <a
                                        href={s.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary underline break-all"
                                      >
                                        {s.url}
                                      </a>
                                    </>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{fn.number}.</span>{" "}
                          <span>{normalizeHebrewNumberRanges(fn.title)}</span>
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
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {import.meta.env.DEV && (
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
                      perplexity_candidates: debug.retrieval?.perplexity?.candidates ?? null,
                      pool: debug.retrieval?.pool ?? null,
                    }}
                  />
                  <DebugBlock title="claims" data={debug.claims} />
                  <DebugBlock title="queries" data={debug.queries} />
                  <DebugBlock
                    title="verifier summary"
                    data={{
                      counts: debug.verifier?.counts ?? null,
                      candidates_verified: debug.verifier?.candidates_verified ?? null,
                      candidates_usable: debug.verifier?.candidates_usable ?? null,
                      candidates_dropped: debug.verifier?.candidates_dropped ?? null,
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
                      omitted_candidate_ids: debug.drafter?.omitted_candidate_ids ?? null,
                    }}
                  />
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </div>

      {/* ── Composer (bottom, sticky via mt-auto) ── */}
      <div className="mt-auto pt-2">
        <div className="flex gap-2 items-end pt-2">
          {hasContentToClear && (
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isBusy}
              className="p-2.5 bg-surface border border-border rounded-xl text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-all flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title="נקה הכל"
              aria-label="נקה הכל"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <div className="input-field flex flex-1 min-w-0 items-end">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy || files.length >= MAX_FILES}
              className="relative p-2.5 m-1 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              title={`צרף קובץ PDF/DOCX (עד ${MAX_FILES} · ${fmtSize(MAX_FILE_BYTES)} לקובץ)`}
              aria-label="צרף קובץ"
            >
              <Paperclip className="w-4 h-4" />
              {files.length > 0 && (
                <span className="absolute -top-0.5 -left-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {files.length}
                </span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              multiple
              className="hidden"
              onChange={(e) => {
                handleAddFiles(e.target.files);
                if (e.target) e.target.value = "";
              }}
            />

            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={2}
              dir="rtl"
              placeholder="תארו שאלה משפטית לסקירה מקיפה..."
              className="w-full flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 px-2 py-2.5 text-foreground text-sm leading-relaxed resize-none"
            />

            <button
              type="button"
              onClick={handleSubmit}
              disabled={sendDisabled}
              className="btn-send px-3 py-2.5 m-1 rounded-lg text-primary-foreground flex-shrink-0 disabled:text-muted-foreground"
              title={uploadingFiles ? "מעלה קבצים…" : "שלח"}
              aria-label="שלח"
            >
              {isBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {files.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <ul className="space-y-1">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 text-xs bg-muted/30 border border-border rounded px-2 py-1"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate" title={f.file.name}>{f.file.name}</span>
                    <span className="text-muted-foreground shrink-0">{fmtSize(f.file.size)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    disabled={isBusy}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                    aria-label="הסר קובץ"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={useAsSource}
                onChange={(e) => setUseAsSource(e.target.checked)}
                disabled={isBusy}
                className="accent-primary"
              />
              <span>השתמש בקבצים גם כמקור בתשובה (יצוטטו כהערות שוליים)</span>
            </label>
          </div>
        )}
      </div>
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


const GHOST_LINES = [
  "w-11/12",
  "w-full",
  "w-10/12",
  "w-11/12",
  "w-9/12",
  "w-full",
  "w-8/12",
  "w-11/12",
  "w-10/12",
  "w-9/12",
];

function GhostAnswer() {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    if (visibleCount >= GHOST_LINES.length) return;
    const delay = 600 + Math.random() * 350;
    const t = setTimeout(() => setVisibleCount((c) => Math.min(c + 1, GHOST_LINES.length)), delay);
    return () => clearTimeout(t);
  }, [visibleCount]);

  return (
    <div className="animate-fade-in" aria-hidden>
      <div className="rounded-lg border border-border bg-card p-4 space-y-2.5">
        <div className="h-4 w-24 rounded bg-muted blur-[1px] animate-pulse" />
        {GHOST_LINES.slice(0, visibleCount).map((w, i) => (
          <div
            key={i}
            className={`h-3 ${w} rounded bg-muted blur-[2px] animate-pulse animate-fade-in`}
          />
        ))}
      </div>
    </div>
  );
}
export default LegalResearchV1Panel;
