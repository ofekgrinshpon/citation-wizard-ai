import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Download, Upload, RefreshCw, Play, Pause } from "lucide-react";

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

const BATCH_SIZE = 10;

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

  // Resume state
  const [pendingItems, setPendingItems] = useState<unknown[] | null>(null);
  const [batchIndex, setBatchIndex] = useState(0);
  const [accumulated, setAccumulated] = useState<AccumulatedResults>({ inserted: 0, skipped: 0, failed: [] });
  const [paused, setPaused] = useState(false);

  const pausedRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
  }, []);

  // Wake Lock helpers
  const acquireWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      }
    } catch {
      // Wake Lock not available or denied — continue without it
    }
  };

  const releaseWakeLock = () => {
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  };

  // Re-acquire wake lock when tab becomes visible again (browsers release it on hide)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && ingesting && !pausedRef.current) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [ingesting]);

  const getAuthHeaders = async () => {
    const { data: { session }, error } = await supabase.auth.refreshSession();
    if (error || !session) {
      throw new Error("לא מחובר – יש להתחבר מחדש");
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
  };

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
        // Check if paused
        if (pausedRef.current) {
          setBatchIndex(i);
          setAccumulated({ ...acc });
          setPendingItems(items);
          setProgressMsg(`מושהה – ${acc.inserted} הועלו, ${acc.skipped} דולגו, ${acc.failed.length} נכשלו`);
          releaseWakeLock();
          return; // exit loop, keep state for resume
        }

        const batch = items.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        setBatchProgress({ current: batchNum, total: totalBatches });
        setProgressMsg(`מעבד אצווה ${batchNum}/${totalBatches} (${acc.inserted} הועלו, ${acc.skipped} דולגו, ${acc.failed.length} נכשלו)...`);

        try {
          const headers = await getAuthHeaders();
          const controller = new AbortController();
          abortRef.current = controller;
          const timeout = setTimeout(() => controller.abort(), 120_000);

          const res = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apify-ingest-cases`,
            { method: "POST", headers, body: JSON.stringify(batch), signal: controller.signal }
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
        } catch (batchErr) {
          const errMsg = batchErr instanceof Error ? batchErr.message : "שגיאה";

          // On network/auth error, pause and allow resume
          if (errMsg.includes("fetch") || errMsg.includes("abort") || errMsg.includes("מחובר") || errMsg.includes("network")) {
            toast.warning("חיבור נותק – אפשר להמשיך בלחיצה על 'המשך'");
            setPaused(true);
            pausedRef.current = true;
            setBatchIndex(i); // retry this batch
            setAccumulated({ ...acc });
            setPendingItems(items);
            setProgressMsg(`הופסק – ${acc.inserted} הועלו, ${acc.failed.length} נכשלו`);
            releaseWakeLock();
            return;
          }

          acc.failed.push(...batch.map((_, idx) => ({
            title: `אצווה ${batchNum} פריט ${idx + 1}`,
            error: errMsg,
          })));
          console.error(`Batch ${batchNum} failed:`, errMsg);
        }
      }

      // Done
      setResults(acc);
      toast.success(`הועלו ${acc.inserted} מסמכים, דולגו ${acc.skipped}, נכשלו ${acc.failed.length}`);
      setPendingItems(null);
      setBatchIndex(0);
      setAccumulated({ inserted: 0, skipped: 0, failed: [] });
      fetchFailed();
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

  const handleResume = () => {
    if (pendingItems) {
      runBatchLoop(pendingItems, batchIndex, { ...accumulated });
    }
  };

  const handlePause = () => {
    setPaused(true);
    pausedRef.current = true;
    abortRef.current?.abort();
  };

  const ingestCases = async (cases: unknown[]) => {
    const acc: AccumulatedResults = { inserted: 0, skipped: 0, failed: [] };
    setAccumulated(acc);
    setPendingItems(cases);
    setBatchIndex(0);
    await runBatchLoop(cases, 0, acc);
  };

  const handleFetchFromApify = async () => {
    if (!actorId.trim()) {
      toast.error("הזינו Actor ID או Dataset ID");
      return;
    }

    setFetching(true);
    setResults(null);
    setProgressMsg("שולף נתונים מ-Apify...");

    try {
      const headers = await getAuthHeaders();
      const isDataset = actorId.trim().length === 17 || actorId.trim().startsWith("dataset/");
      const body = isDataset
        ? { datasetId: actorId.trim().replace("dataset/", "") }
        : { actorId: actorId.trim() };

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-apify-dataset`,
        { method: "POST", headers, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch from Apify");
      }

      const data = await res.json();
      const items = data.items || [];

      if (!items.length) {
        toast.warning("לא נמצאו רשומות ב-Apify");
        setFetching(false);
        setProgressMsg("");
        return;
      }

      toast.info(`נשלפו ${items.length} רשומות, מתחיל העלאה...`);
      setFetching(false);

      await ingestCases(items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בשליפה מ-Apify");
      setFetching(false);
      setProgressMsg("");
    }
  };

  const handleManualIngest = async () => {
    let cases: unknown[];
    try {
      const parsed = JSON.parse(jsonInput);
      cases = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      toast.error("JSON לא תקין");
      return;
    }
    await ingestCases(cases);
    setJsonInput("");
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retry-failed-ingestion`,
        { method: "POST", headers, body: "{}" }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Retry failed");
      }

      const data = await res.json();
      toast.success(`נוסו שוב ${data.retried}: ${data.succeeded} הצליחו, ${data.still_failed} עדיין נכשלו`);
      fetchFailed();
      onIngested();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בניסיון חוזר");
    } finally {
      setRetrying(false);
    }
  };

  const isBusy = ingesting || fetching;
  const canResume = paused && pendingItems && !ingesting;

  return (
    <div className="space-y-4">
      {/* Auto-fetch from Apify */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
        <h3 className="text-foreground font-bold text-sm flex items-center gap-2">
          <Download className="h-4 w-4" />
          שליפה אוטומטית מ-Apify
        </h3>
        <p className="text-muted-foreground text-xs">
          הזינו את ה-Actor ID (למשל: <code className="bg-muted px-1 rounded">username/actor-name</code>) או Dataset ID כדי לשלוף את התוצאות האחרונות אוטומטית.
        </p>
        <input
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          placeholder="Actor ID (e.g. my-user/il-court-scraper) or Dataset ID"
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono"
          dir="ltr"
        />
        <div className="flex gap-2">
          <Button onClick={handleFetchFromApify} disabled={isBusy || !actorId.trim()}>
            {fetching ? "שולף..." : "🔄 שלוף והעלה מ-Apify"}
          </Button>
          {ingesting && (
            <Button variant="outline" onClick={handlePause}>
              <Pause className="h-3 w-3 mr-1" />
              השהה
            </Button>
          )}
          {canResume && (
            <Button variant="default" onClick={handleResume}>
              <Play className="h-3 w-3 mr-1" />
              המשך ({Math.floor(batchIndex / BATCH_SIZE) + 1}/{pendingItems ? Math.ceil(pendingItems.length / BATCH_SIZE) : 0})
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
