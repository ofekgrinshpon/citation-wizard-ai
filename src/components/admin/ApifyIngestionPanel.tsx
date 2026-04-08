import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Download, Upload, RefreshCw } from "lucide-react";

interface FailedDoc {
  id: string;
  title: string;
  ingestion_error: string | null;
  created_at: string;
}

interface ApifyIngestionPanelProps {
  onIngested: () => void;
}

export default function ApifyIngestionPanel({ onIngested }: ApifyIngestionPanelProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [failedDocs, setFailedDocs] = useState<FailedDoc[]>([]);
  const [actorId, setActorId] = useState(""); 
  const [progressMsg, setProgressMsg] = useState("");
  const [results, setResults] = useState<{ inserted: number; skipped: number; failed: Array<{ title: string; error: string }> } | null>(null);

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

  const getAuthHeaders = async () => {
    // Use refreshSession to guarantee a fresh, valid token
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

  const ingestCases = async (cases: unknown[]) => {
    setIngesting(true);
    setResults(null);
    setProgressMsg(`מעבד ${cases.length} רשומות...`);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apify-ingest-cases`,
        { method: "POST", headers, body: JSON.stringify(cases) }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Ingestion failed");
      }

      const data = await res.json();
      setResults(data);
      toast.success(`הועלו ${data.inserted} מסמכים, דולגו ${data.skipped}, נכשלו ${data.failed?.length || 0}`);
      fetchFailed();
      onIngested();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בהעלאה");
    } finally {
      setIngesting(false);
      setProgressMsg("");
    }
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
        <Button onClick={handleFetchFromApify} disabled={isBusy || !actorId.trim()}>
          {fetching ? "שולף..." : "🔄 שלוף והעלה מ-Apify"}
        </Button>

        {progressMsg && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{progressMsg}</p>
            <Progress value={undefined} className="h-2" />
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
