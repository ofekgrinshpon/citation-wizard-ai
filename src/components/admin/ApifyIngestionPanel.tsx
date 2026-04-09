import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Download, Upload, RefreshCw, Play, Pause, Database } from "lucide-react";

interface FailedDoc {
  id: string;
  title: string;
  ingestion_error: string | null;
  created_at: string;
}

interface ApifyIngestionPanelProps {
  onIngested: () => void;
}

interface AccumulatedResults {
  inserted: number;
  skipped: number;
  failed: Array<{ title: string; error: string }>;
}

/** Full resume checkpoint for streamed Apify ingestion */
interface ApifyResumeState {
  actorId: string;
  offset: number;
  pageNum: number;
  accumulated: AccumulatedResults;
  remainingItems: unknown[];
  batchIndexInPage: number;
}

const BATCH_SIZE = 10;
const APIFY_PAGE_SIZE = 50;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

// ─── Auth helpers ───────────────────────────────────────────
let cachedToken: string | null = null;

/** Read the current session token without rotating it. */
async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    cachedToken = session.access_token;
    return session.access_token;
  }
  // fallback: try a single refresh
  const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
  if (error || !refreshed) throw new Error("AUTH_EXPIRED");
  cachedToken = refreshed.access_token;
  return refreshed.access_token;
}

function buildHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

/** Fetch wrapper that retries once on 401/403 with a fresh token. */
async function resilientFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let token = cachedToken || (await getToken());
  let res = await fetch(url, {
    ...init,
    headers: { ...buildHeaders(token), ...(init.headers as Record<string, string> || {}) },
  });

  if (res.status === 401 || res.status === 403) {
    // one refresh attempt
    token = await getToken();
    res = await fetch(url, {
      ...init,
      headers: { ...buildHeaders(token), ...(init.headers as Record<string, string> || {}) },
    });
  }
  return res;
}

// ─── Component ──────────────────────────────────────────────
export default function ApifyIngestionPanel({ onIngested }: ApifyIngestionPanelProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [failedDocs, setFailedDocs] = useState<FailedDoc[]>([]);
  const [actorId, setActorId] = useState("");
  const [progressMsg, setProgressMsg] = useState("");
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [results, setResults] = useState<AccumulatedResults | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);

  // Resume state
  const [pendingItems, setPendingItems] = useState<unknown[] | null>(null);
  const [batchIndex, setBatchIndex] = useState(0);
  const [accumulated, setAccumulated] = useState<AccumulatedResults>({ inserted: 0, skipped: 0, failed: [] });
  const [paused, setPaused] = useState(false);
  const [apifyResume, setApifyResume] = useState<ApifyResumeState | null>(null);

  const pausedRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchDocCount = async () => {
    const { count } = await supabase
      .from("legal_documents")
      .select("id", { count: "exact", head: true });
    setDocCount(count ?? 0);
  };

  const fetchFailed = async () => {
    const { data } = await supabase
      .from("legal_documents")
      .select("id, title, ingestion_error, created_at")
      .eq("ingestion_status", "partial_failure")
      .order("created_at", { ascending: false });
    setFailedDocs((data as FailedDoc[] | null) ?? []);
  };

  useEffect(() => {
    fetchFailed();
    fetchDocCount();
  }, []);

  // ─── Wake Lock ──────────────────────────────────────────
  const acquireWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      }
    } catch { /* continue without */ }
  };

  const releaseWakeLock = () => {
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  };

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && ingesting && !pausedRef.current) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [ingesting]);

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  // ─── Batch ingestion with retry ─────────────────────────
  const ingestBatchWithRetry = async (
    batch: unknown[],
    batchNum: number,
    acc: AccumulatedResults,
  ): Promise<boolean> => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          setProgressMsg(`ניסיון חוזר ${attempt}/${MAX_RETRIES} לאצווה ${batchNum}...`);
          await sleep(RETRY_DELAY_MS);
        }

        const controller = new AbortController();
        abortRef.current = controller;
        const timeout = setTimeout(() => controller.abort(), 180_000);

        const res = await resilientFetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apify-ingest-cases`,
          { method: "POST", body: JSON.stringify(batch), signal: controller.signal },
        );
        clearTimeout(timeout);
        abortRef.current = null;

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `Batch ${batchNum} failed`);
        }

        const data = await res.json();
        acc.inserted += data.inserted || 0;
        acc.skipped += data.skipped || 0;
        if (data.failed?.length) acc.failed.push(...data.failed);
        return true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "שגיאה";
        const isNetworkError =
          errMsg.includes("fetch") || errMsg.includes("abort") ||
          errMsg.includes("network") || errMsg.includes("WORKER_LIMIT") ||
          errMsg === "AUTH_EXPIRED";

        if (isNetworkError && attempt < MAX_RETRIES) {
          console.warn(`Batch ${batchNum} attempt ${attempt + 1} failed, retrying...`, errMsg);
          continue;
        }

        if (isNetworkError) {
          return false; // exhausted retries — pause for manual resume
        }

        // Non-network error — log and continue
        acc.failed.push(...batch.map((_, idx) => ({
          title: `אצווה ${batchNum} פריט ${idx + 1}`,
          error: errMsg,
        })));
        console.error(`Batch ${batchNum} failed:`, errMsg);
        return true;
      }
    }
    return true;
  };

  // ─── Manual JSON batch loop ─────────────────────────────
  const runBatchLoop = useCallback(async (
    items: unknown[],
    startIndex: number,
    acc: AccumulatedResults,
  ) => {
    setIngesting(true);
    setPaused(false);
    pausedRef.current = false;
    setResults(null);
    await acquireWakeLock();

    const totalBatches = Math.ceil(items.length / BATCH_SIZE);

    try {
      for (let i = startIndex; i < items.length; i += BATCH_SIZE) {
        if (pausedRef.current) {
          setBatchIndex(i);
          setAccumulated({ ...acc });
          setPendingItems(items);
          setProgressMsg(`מושהה – ${acc.inserted} הועלו, ${acc.skipped} דולגו, ${acc.failed.length} נכשלו`);
          releaseWakeLock();
          return;
        }

        const batch = items.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        setBatchProgress({ current: batchNum, total: totalBatches });
        setProgressMsg(`מעבד אצווה ${batchNum}/${totalBatches} (${acc.inserted} הועלו, ${acc.skipped} דולגו, ${acc.failed.length} נכשלו)...`);

        const ok = await ingestBatchWithRetry(batch, batchNum, acc);

        if (!ok) {
          toast.warning("החיבור פג זמנית – אפשר להמשיך מאותה נקודה");
          setPaused(true);
          pausedRef.current = true;
          setBatchIndex(i);
          setAccumulated({ ...acc });
          setPendingItems(items);
          setProgressMsg(`הופסק – ${acc.inserted} הועלו, ${acc.failed.length} נכשלו`);
          releaseWakeLock();
          return;
        }

        fetchDocCount();
      }

      setResults(acc);
      toast.success(`הועלו ${acc.inserted} מסמכים, דולגו ${acc.skipped}, נכשלו ${acc.failed.length}`);
      setPendingItems(null);
      setBatchIndex(0);
      setAccumulated({ inserted: 0, skipped: 0, failed: [] });
      fetchFailed();
      fetchDocCount();
      onIngested();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בהעלאה");
    } finally {
      setIngesting(false);
      setProgressMsg("");
      setBatchProgress(null);
      releaseWakeLock();
    }
  }, [onIngested]);

  // ─── Resume handlers ───────────────────────────────────
  const handleResume = () => {
    if (apifyResume) {
      // Resume streamed Apify ingestion
      handleFetchFromApify(apifyResume);
      return;
    }
    if (pendingItems) {
      runBatchLoop(pendingItems, batchIndex, { ...accumulated });
    }
  };

  const handlePause = () => {
    setPaused(true);
    pausedRef.current = true;
    abortRef.current?.abort();
  };

  // ─── Streamed Apify fetch + ingest ─────────────────────
  const handleFetchFromApify = async (resume?: ApifyResumeState) => {
    const sourceId = resume?.actorId || actorId.trim();
    if (!sourceId) {
      toast.error("הזינו Actor ID או Dataset ID");
      return;
    }

    setFetching(true);
    setIngesting(true);
    setPaused(false);
    pausedRef.current = false;
    setApifyResume(null);

    const isDataset = sourceId.length === 17 || sourceId.startsWith("dataset/");
    const baseBody = isDataset
      ? { datasetId: sourceId.replace("dataset/", "") }
      : { actorId: sourceId };

    const acc: AccumulatedResults = resume
      ? { ...resume.accumulated }
      : { inserted: 0, skipped: 0, failed: [] };
    setAccumulated(acc);
    if (!resume) setResults(null);

    let offset = resume?.offset ?? 0;
    let pageNum = resume?.pageNum ?? 0;
    let totalFetched = 0;

    // If resuming with remaining items from a partially-processed page
    let startItems: unknown[] | null = resume?.remainingItems ?? null;
    let startBatchIdx = resume?.batchIndexInPage ?? 0;

    setProgressMsg("שולף נתונים מ-Apify...");
    await acquireWakeLock();

    // Pre-warm token cache
    try { await getToken(); } catch { /* will fail on first request */ }

    try {
      // Process remaining items from a previous page first (if resuming)
      if (startItems && startItems.length > 0) {
        const ok = await processPage(startItems, startBatchIdx, pageNum, acc, sourceId, offset);
        if (!ok) return; // paused or failed — resume state already saved
        startItems = null;
        startBatchIdx = 0;
        offset += APIFY_PAGE_SIZE; // move to next page
      }

      while (true) {
        if (pausedRef.current) {
          saveApifyResume(sourceId, offset, pageNum, acc, [], 0);
          setProgressMsg(`מושהה – ${acc.inserted} הועלו, ${acc.skipped} דולגו`);
          releaseWakeLock();
          setFetching(false);
          setIngesting(false);
          return;
        }

        pageNum++;
        setProgressMsg(`שולף עמוד ${pageNum} מ-Apify (${totalFetched} נשלפו, ${acc.inserted} הועלו, ${acc.skipped} דולגו)...`);

        const res = await resilientFetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-apify-dataset`,
          { method: "POST", body: JSON.stringify({ ...baseBody, offset, limit: APIFY_PAGE_SIZE }) },
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || "Failed to fetch from Apify");
        }

        const data = await res.json();
        const items: unknown[] = data.items || [];
        totalFetched += items.length;

        if (items.length === 0) break;

        const ok = await processPage(items, 0, pageNum, acc, sourceId, offset);
        if (!ok) return; // paused — resume state saved inside processPage

        if (items.length < APIFY_PAGE_SIZE) break; // last page
        offset += APIFY_PAGE_SIZE;
      }

      // Done
      setResults(acc);
      toast.success(`הועלו ${acc.inserted} מסמכים, דולגו ${acc.skipped}, נכשלו ${acc.failed.length}`);
      setPendingItems(null);
      setApifyResume(null);
      setAccumulated({ inserted: 0, skipped: 0, failed: [] });
      fetchFailed();
      fetchDocCount();
      onIngested();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה בשליפה מ-Apify";
      if (msg === "AUTH_EXPIRED") {
        toast.warning("החיבור פג זמנית – אפשר להמשיך מאותה נקודה");
        saveApifyResume(sourceId, offset, pageNum, acc, [], 0);
      } else {
        toast.error(msg);
      }
    } finally {
      setFetching(false);
      setIngesting(false);
      setProgressMsg("");
      setBatchProgress(null);
      releaseWakeLock();
    }
  };

  /** Process a single page of items in batches. Returns false if paused/failed. */
  const processPage = async (
    items: unknown[],
    startBatch: number,
    pageNum: number,
    acc: AccumulatedResults,
    sourceId: string,
    currentOffset: number,
  ): Promise<boolean> => {
    const totalBatches = Math.ceil(items.length / BATCH_SIZE);

    for (let i = startBatch; i < items.length; i += BATCH_SIZE) {
      if (pausedRef.current) {
        const remaining = items.slice(i);
        saveApifyResume(sourceId, currentOffset, pageNum, acc, remaining, 0);
        setProgressMsg(`מושהה – ${acc.inserted} הועלו, ${acc.skipped} דולגו`);
        releaseWakeLock();
        setFetching(false);
        setIngesting(false);
        return false;
      }

      const batch = items.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      setBatchProgress({ current: batchNum, total: totalBatches });
      setProgressMsg(`עמוד ${pageNum}: אצווה ${batchNum}/${totalBatches} (סה"כ ${acc.inserted} הועלו, ${acc.skipped} דולגו, ${acc.failed.length} נכשלו)...`);

      const ok = await ingestBatchWithRetry(batch, batchNum, acc);

      if (!ok) {
        toast.warning("החיבור פג זמנית – אפשר להמשיך מאותה נקודה");
        setPaused(true);
        pausedRef.current = true;
        const remaining = items.slice(i);
        saveApifyResume(sourceId, currentOffset, pageNum, acc, remaining, 0);
        setProgressMsg(`הופסק – ${acc.inserted} הועלו, ${acc.failed.length} נכשלו`);
        releaseWakeLock();
        setFetching(false);
        setIngesting(false);
        return false;
      }

      fetchDocCount();
    }
    return true;
  };

  const saveApifyResume = (
    sourceId: string, offset: number, pageNum: number,
    acc: AccumulatedResults, remaining: unknown[], batchIdx: number,
  ) => {
    setPaused(true);
    pausedRef.current = true;
    setApifyResume({
      actorId: sourceId,
      offset,
      pageNum,
      accumulated: { ...acc },
      remainingItems: remaining,
      batchIndexInPage: batchIdx,
    });
    setAccumulated({ ...acc });
  };

  // ─── Manual JSON ingest ────────────────────────────────
  const handleManualIngest = async () => {
    let cases: unknown[];
    try {
      const parsed = JSON.parse(jsonInput);
      cases = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      toast.error("JSON לא תקין");
      return;
    }
    const acc: AccumulatedResults = { inserted: 0, skipped: 0, failed: [] };
    setAccumulated(acc);
    setPendingItems(cases);
    setBatchIndex(0);
    await runBatchLoop(cases, 0, acc);
    setJsonInput("");
  };

  // ─── Retry failed ──────────────────────────────────────
  const handleRetry = async () => {
    setRetrying(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retry-failed-ingestion`,
        { method: "POST", headers: buildHeaders(token), body: "{}" },
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Retry failed");
      }

      const data = await res.json();
      toast.success(`נוסו שוב ${data.retried}: ${data.succeeded} הצליחו, ${data.still_failed} עדיין נכשלו`);
      fetchFailed();
      fetchDocCount();
      onIngested();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בניסיון חוזר");
    } finally {
      setRetrying(false);
    }
  };

  const isBusy = ingesting || fetching;
  const canResume = paused && (pendingItems || apifyResume) && !ingesting;

  return (
    <div className="space-y-4">
      {/* DB Document Counter */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center gap-3">
        <Database className="h-5 w-5 text-primary" />
        <div>
          <span className="text-foreground font-bold text-lg">
            {docCount !== null ? docCount.toLocaleString() : "..."}
          </span>
          <span className="text-muted-foreground text-sm mr-2"> מסמכים במאגר</span>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchDocCount} className="mr-auto">
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Auto-fetch from Apify */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
          <Download className="h-4 w-4" />
          שליפה אוטומטית מ-Apify
        </h3>
        <p className="text-muted-foreground text-xs">
          הזינו את ה-Actor ID (למשל: <code className="bg-muted px-1 rounded">username/actor-name</code>) או Dataset ID כדי לשלוף את התוצאות האחרונות אוטומטית.
          <br />
          <strong>מסמכים כפולים ידולגו אוטומטית</strong> – אפשר להריץ שוב בבטחה.
        </p>
        <input
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          placeholder="Actor ID (e.g. my-user/il-court-scraper) or Dataset ID"
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono"
          dir="ltr"
        />
        <div className="flex gap-2">
          <Button onClick={() => handleFetchFromApify()} disabled={isBusy || !actorId.trim()}>
            {fetching ? "שולף..." : "🔄 שלוף והעלה מ-Apify"}
          </Button>
          {isBusy && (
            <Button variant="outline" onClick={handlePause}>
              <Pause className="h-3 w-3 mr-1" />
              השהה
            </Button>
          )}
          {canResume && (
            <Button variant="default" onClick={handleResume}>
              <Play className="h-3 w-3 mr-1" />
              המשך
            </Button>
          )}
        </div>

        {progressMsg && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{progressMsg}</p>
            <Progress value={batchProgress ? (batchProgress.current / batchProgress.total) * 100 : undefined} className="h-2" />
          </div>
        )}
      </div>

      {/* Manual JSON paste (fallback) */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
          <Upload className="h-4 w-4" />
          העלאה ידנית (JSON)
        </h3>
        <p className="text-muted-foreground text-xs">
          הדביקו את ה-JSON מה-Apify dataset. כל רשומה שכוללת "תקציר" בכותרת תדולג אוטומטית.
        </p>
        <textarea
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder='[{"title": "...", "case_number": "...", "court": "...", "docx_url": "..."}]'
          className="w-full h-32 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono resize-y"
          dir="ltr"
        />
        <Button variant="outline" onClick={handleManualIngest} disabled={isBusy || !jsonInput.trim()}>
          {ingesting ? "מעלה..." : "העלה פסיקה"}
        </Button>
      </div>

      {/* Results */}
      {results && (
        <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
          <p>✅ הועלו: <strong>{results.inserted}</strong></p>
          <p>⏭️ דולגו (תקציר): <strong>{results.skipped}</strong></p>
          <p>❌ נכשלו: <strong>{results.failed.length}</strong></p>
          {results.failed.length > 0 && (
            <ul className="mt-2 text-xs text-destructive space-y-1">
              {results.failed.map((f, i) => (
                <li key={i}>• {f.title}: {f.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Failed ingestions */}
      {failedDocs.length > 0 && (
        <div className="bg-card border border-destructive/30 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
              ⚠️ מסמכים שנכשלו
              <Badge variant="destructive">{failedDocs.length}</Badge>
            </h3>
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
              <RefreshCw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
              {retrying ? "מנסה שוב..." : "נסה שוב"}
            </Button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {failedDocs.map((doc) => (
              <div key={doc.id} className="flex items-start justify-between bg-muted/50 rounded p-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{doc.title}</p>
                  <p className="text-destructive mt-0.5">{doc.ingestion_error || "שגיאה לא ידועה"}</p>
                </div>
                <span className="text-muted-foreground mr-2 whitespace-nowrap">
                  {new Date(doc.created_at).toLocaleDateString("he-IL")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
